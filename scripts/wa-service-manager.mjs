#!/usr/bin/env node
/**
 * wa-service-manager.mjs
 * Gerenciador de alta performance e resiliência do WhatsApp House 190.
 * Roda em modo de produção compilado com auto-wake protegido, caffeinate e túnel persistente.
 */

import { spawn, execSync } from "node:child_process";

const WORKER_URL = "https://house-folgas-notifications.brunohouse.workers.dev";
const API_KEY = "wag_lHoXJO4s0S0yX1cD1PMLkAu4ghGmrhBl";
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
  akgProcess = spawn("npm", ["start"], {
    cwd: WA_AKG_DIR,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "3000",
      NODE_OPTIONS: "--max-old-space-size=4096",
    },
  });

  akgProcess.on("exit", (code) => {
    log(`WA-AKG encerrou com código ${code}. Tentando reiniciar em 3s...`);
    akgProcess = null;
  });

  await new Promise((r) => setTimeout(r, 4000));
}

let lastStartAttempt = 0;

async function startSessionIfStopped() {
  const now = Date.now();
  if (now - lastStartAttempt < 120000) {
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
      const isOk = sess.status === "CONNECTED" || sess.status === "WORKING" || Boolean(sess.me);
      if (!isOk && sess.status === "STOPPED") {
        lastStartAttempt = now;
        log("Sessão em STOPPED. Disparando auto-wake com debounce...");
        await fetch(`http://127.0.0.1:3000/api/sessions/${INSTANCE}/start`, {
          method: "POST",
          headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(4000),
        }).catch(() => {});
      }
    }
  } catch (_) {}
}

export async function syncConfig(url = DEFAULT_GATEWAY_URL) {
  const cleanUrl = url.replace(/\/+$/, "");
  const gatewayUrl = cleanUrl.endsWith("/api") ? cleanUrl : `${cleanUrl}/api`;

  let phone = "557197069291";
  let isConnected = true;

  try {
    const sRes = await fetch(`${gatewayUrl}/sessions/${encodeURIComponent(INSTANCE)}`, {
      headers: { "X-API-Key": API_KEY, "bypass-tunnel-reminder": "true" },
      signal: AbortSignal.timeout(5000),
    });
    if (sRes.ok) {
      const data = await sRes.json();
      const sess = data?.data || data || {};
      isConnected = sess.status === "CONNECTED" || sess.status === "WORKING" || Boolean(sess.me);
      if (sess.me?.id) {
        phone = sess.me.id.split("@")[0].split(":")[0];
      }
    }
  } catch (_) {}

  try {
    const res = await fetch(`${WORKER_URL}/wa-gateway-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
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
      log(`Sincronização OK: ${isConnected ? "Conectado" : "Desconectado"} (${phone})`);
      return true;
    }
  } catch (err) {
    log(`Falha ao sincronizar: ${err.message}`);
  }
  return false;
}

let tunnelChild = null;

function runTunnel() {
  const hasCloudflared = (() => {
    try {
      execSync("which cloudflared", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();

  if (hasCloudflared) {
    log("Iniciando túnel seguro Cloudflare Edge (cloudflared)...");
    tunnelChild = spawn("cloudflared", ["tunnel", "--url", "http://localhost:3000"], {
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

    tunnelChild.on("close", (code) => {
      log(`Túnel Cloudflare encerrou (código ${code}). Reiniciando em 3s...`);
      tunnelChild = null;
      setTimeout(runTunnel, 3000);
    });
    return;
  }

  log(`Iniciando túnel seguro (${SUBDOMAIN}.loca.lt)...`);

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

  tunnelChild.on("close", (code) => {
    log(`Túnel encerrou (código ${code}). Reiniciando em 3s...`);
    tunnelChild = null;
    setTimeout(runTunnel, 3000);
  });
}

export async function startSupervisor() {
  log("Iniciando supervisão de alta performance da House 190...");
  await ensureMysql();
  await ensureWaAkg();
  await startSessionIfStopped();
  runTunnel();

  // Monitoramento a cada 30 segundos
  setInterval(async () => {
    try {
      await ensureMysql();
      await ensureWaAkg();
      await startSessionIfStopped();
    } catch (_) {}
  }, 30000);
}

if (process.argv[1]?.endsWith("wa-service-manager.mjs")) {
  startSupervisor();
}
