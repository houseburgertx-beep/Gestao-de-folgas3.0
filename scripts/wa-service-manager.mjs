#!/usr/bin/env node
/**
 * wa-service-manager.mjs
 * Gerenciador de alta performance, auto-recuperação e resiliência do WhatsApp House 190.
 * Monitora continuamente MySQL, WA-AKG e o Túnel Cloudflare Edge com health-checks ativos.
 */

import { spawn, execSync } from "node:child_process";
import { openSync, closeSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const WORKER_URL = "https://house-folgas-notifications.brunohouse.workers.dev";
const API_KEY = process.env.WA_API_KEY || "";
const SERVICE_TOKEN = process.env.WA_SERVICE_TOKEN || "";
const INSTANCE = "house190";
const SUBDOMAIN = "house190-bot";
const DEFAULT_GATEWAY_URL = `https://${SUBDOMAIN}.loca.lt/api`;
const WA_AKG_DIR = "/Users/gleuce/Downloads/wa-akg";

function log(msg) {
  const ts = new Date().toLocaleTimeString("pt-BR");
  console.log(`[${ts}] [WA Manager] ${msg}`);
}

// Ativa Caffeinate do macOS em segundo plano para impedir suspensão de rede no carregador
try {
  spawn("caffeinate", ["-s", "-i"], { stdio: "ignore", detached: true }).unref();
  log("Modo de alta disponibilidade macOS ativado (caffeinate).");
} catch (_) {}

async function isPortOpen(port) {
  try {
    const res = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { stdio: "pipe" });
    return Boolean(res.toString().trim());
  } catch {
    return false;
  }
}

async function ensureMysql() {
  const isOpen = await isPortOpen(3306);
  if (!isOpen) {
    log("Iniciando serviço MySQL local...");
    try {
      execSync("brew services start mysql", { stdio: "ignore" });
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      log(`Aviso ao iniciar MySQL: ${e.message}`);
    }
  }
}

let akgProcess = null;

async function ensureWaAkg() {
  const isOpen = await isPortOpen(3000);
  if (isOpen) {
    return;
  }

  log("Iniciando WA-AKG em MODO PRODUÇÃO compilado na porta 3000...");
  const logPath = join(homedir(), "Library/Logs/house190-akg.log");
  const logFd = openSync(logPath, "a", 0o600);
  chmodSync(logPath, 0o600);
  try {
  akgProcess = spawn("npm", ["start"], {
    cwd: WA_AKG_DIR,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "3000",
      NODE_OPTIONS: "--max-old-space-size=4096",
    },
  });

  } finally { closeSync(logFd); }

  // Baileys restores its saved session asynchronously after the port opens.
  lastStartAttempt = Date.now();
  akgProcess.on("error", () => log("Falha ao iniciar WA-AKG."));
  akgProcess.on("exit", (code) => {
    log(`WA-AKG encerrou com código ${code}. Tentando reiniciar em 3s...`);
    akgProcess = null;
  });

  await new Promise((r) => setTimeout(r, 4000));
}

let lastStartAttempt = Date.now();
let disconnectedSince = 0;

export function sessionRecoveryAction(session, elapsed) {
  if (["CONNECTED", "WORKING", "SCAN_QR", "LOGGED_OUT"].includes(session.status)) return null;
  if (session.hasInstance && elapsed < 300000) return null;
  return session.status === "STOPPED" || !session.hasInstance ? "start" : "restart";
}

async function startSessionIfStopped() {
  const now = Date.now();
  if (now - lastStartAttempt < 60000) {
    return;
  }

  try {
    const check = await fetch(`http://127.0.0.1:3000/api/sessions/${INSTANCE}`, {
      headers: { "X-API-Key": API_KEY },
      signal: AbortSignal.timeout(3000),
    });
    if (check.ok) {
      const data = await check.json();
      const sess = data?.data || data || {};
      const connected = sess.status === "CONNECTED" || sess.status === "WORKING";
      if (connected || sess.status === "SCAN_QR" || sess.status === "LOGGED_OUT") disconnectedSince = 0;
      else if (!disconnectedSince) disconnectedSince = now;
      const endpoint = sessionRecoveryAction(sess, now - disconnectedSince);
      if (endpoint) {
        lastStartAttempt = now;
        disconnectedSince = now;
        log(`Sessão com status '${sess.status}'. Recuperação controlada: ${endpoint}.`);
        await fetch(`http://127.0.0.1:3000/api/sessions/${INSTANCE}/${endpoint}`, {
          method: "POST",
          headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(6000),
        }).catch(() => {});
      }
    }
  } catch (_) {}
}

let activeTunnelUrl = null;
let tunnelFailures = 0;

export async function syncConfig(url = DEFAULT_GATEWAY_URL) {
  const cleanUrl = url.replace(/\/+$/, "");
  const gatewayUrl = cleanUrl.endsWith("/api") ? cleanUrl : `${cleanUrl}/api`;
  activeTunnelUrl = gatewayUrl;
  // A successful config write does not prove that the public tunnel works.

  let phone = "";
  let isConnected = false;

  try {
    const sRes = await fetch(`http://127.0.0.1:3000/api/sessions/${encodeURIComponent(INSTANCE)}`, {
      headers: { "X-API-Key": API_KEY },
      signal: AbortSignal.timeout(3000),
    });
    if (sRes.ok) {
      const data = await sRes.json();
      const sess = data?.data || data || {};
      isConnected = sess.status === "CONNECTED" || sess.status === "WORKING";
      if (sess.me?.id) {
        phone = sess.me.id.split("@")[0].split(":")[0];
      }
    }
  } catch (_) {}

  try {
    const res = await fetch(`${WORKER_URL}/wa-gateway-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Token": SERVICE_TOKEN },
      body: JSON.stringify({
        gatewayUrl,
        instanceName: INSTANCE,
        apiKey: API_KEY,
        connectionStatus: isConnected ? "connected" : "disconnected",
        phone,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      log(`Sincronização OK: ${isConnected ? "Conectado" : "Desconectado"} -> ${gatewayUrl}`);
      return true;
    }
  } catch (err) {
    log(`Falha ao sincronizar: ${err.message}`);
  }
  return false;
}

let tunnelChild = null;
let tunnelRestartTimer = null;
let stopping = false;

function runTunnel() {
  if (stopping) return;
  clearTimeout(tunnelRestartTimer);
  activeTunnelUrl = null;
  if (tunnelChild) {
    const oldChild = tunnelChild;
    tunnelChild = null;
    try { oldChild.kill("SIGTERM"); } catch (_) {}
  }

  const hasCloudflared = (() => {
    try {
      execSync("which cloudflared", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();

  if (hasCloudflared) {
    log("Iniciando túnel Cloudflare Edge (cloudflared)...");
    tunnelChild = spawn("cloudflared", ["tunnel", "--protocol", "http2", "--url", "http://127.0.0.1:3000"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        const liveUrl = match[0].trim();
        log(`Túnel Cloudflare ativo: ${liveUrl}`);
        syncConfig(liveUrl).catch(() => {});
      }
    };

    tunnelChild.stdout.on("data", onData);
    tunnelChild.stderr.on("data", onData);

    const child = tunnelChild;
    child.on("error", () => log("Falha ao iniciar cloudflared."));
    child.on("close", (code) => {
      if (stopping || tunnelChild !== child) return;
      log(`Túnel Cloudflare encerrou (código ${code}). Reiniciando em 2s...`);
      tunnelChild = null;
      activeTunnelUrl = null;
      tunnelRestartTimer = setTimeout(runTunnel, 2000);
    });
    return;
  }

  log(`Iniciando túnel alternativo (${SUBDOMAIN}.loca.lt)...`);
  tunnelChild = spawn("npx", ["localtunnel", "--port", "3000", "--subdomain", SUBDOMAIN], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  tunnelChild.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    const match = text.match(/your url is:\s*(https:\/\/[^\s]+)/i);
    if (match) {
      const liveUrl = match[1].trim();
      log(`Túnel ativo: ${liveUrl}`);
      syncConfig(liveUrl).catch(() => {});
    }
  });
  tunnelChild.stderr.resume();

  const child = tunnelChild;
  child.on("error", () => log("Falha ao iniciar túnel alternativo."));
  child.on("close", (code) => {
    if (stopping || tunnelChild !== child) return;
    log(`Túnel encerrou (código ${code}). Reiniciando em 2s...`);
    tunnelChild = null;
    activeTunnelUrl = null;
    tunnelRestartTimer = setTimeout(runTunnel, 2000);
  });
}

// Health check ativo do túnel público a cada 15 segundos
async function checkTunnelHealth() {
  if (!activeTunnelUrl) {
    return;
  }
  try {
    const res = await fetch(`${activeTunnelUrl}/sessions/${encodeURIComponent(INSTANCE)}`, {
      headers: { "X-API-Key": API_KEY, "bypass-tunnel-reminder": "true" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      tunnelFailures = 0;
      return;
    }
    tunnelFailures++;
    log(`Alerta: túnel respondeu com status ${res.status} (falhas consecutivas: ${tunnelFailures})`);
  } catch (err) {
    tunnelFailures++;
    log(`Alerta: falha na conectividade externa do túnel (${err.message}) [falhas: ${tunnelFailures}]`);
  }

  // Se falhou 2 vezes consecutivas (30s), força reinicialização imediata do túnel
  if (tunnelFailures >= 2) {
    log("Túnel externo inacessível. Reiniciando túnel automaticamente...");
    tunnelFailures = 0;
    activeTunnelUrl = null;
    runTunnel();
  }
}

export async function startSupervisor() {
  log("Iniciando supervisão resiliente da House 190...");
  await ensureMysql();
  await ensureWaAkg();
  await startSessionIfStopped();
  runTunnel();

  // Never overlap health/recovery cycles when a network request is slow.
  let checking = false;
  setInterval(async () => {
    if (checking || stopping) return;
    checking = true;
    try {
      await ensureMysql();
      await ensureWaAkg();
      await startSessionIfStopped();
      await checkTunnelHealth();
      if (activeTunnelUrl) {
        await syncConfig(activeTunnelUrl);
      }
    } catch (_) {} finally { checking = false; }
  }, 15000);
}

// Tratamento de sinais de encerramento
function cleanup() {
  stopping = true;
  clearTimeout(tunnelRestartTimer);
  log("Encerrando serviços supervisionados...");
  if (tunnelChild) {
    try { tunnelChild.kill("SIGKILL"); } catch (_) {}
  }
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

if (process.argv[1]?.endsWith("wa-service-manager.mjs")) {
  startSupervisor();
}
