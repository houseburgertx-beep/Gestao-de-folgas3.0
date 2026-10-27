#!/usr/bin/env node
/**
 * wa-service-manager.mjs
 * Gerenciador completo e supervisor autônomo do serviço WhatsApp da House 190.
 * Garante que MySQL, WA-AKG e Túnel estejam sempre rodando e sincronizados.
 */

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
  } else {
    log("MySQL já está ativo na porta 3306.");
  }
}

let akgProcess = null;

async function ensureWaAkg() {
  const isOpen = await isPortOpen(3000);
  if (isOpen) {
    log("WA-AKG já está respondendo na porta 3000.");
    return;
  }

  log("Iniciando WA-AKG Gateway na porta 3000...");
  akgProcess = spawn("npm", ["run", "dev"], {
    cwd: WA_AKG_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
  });

  akgProcess.stdout.on("data", (chunk) => {
    const txt = chunk.toString();
    if (txt.includes("opened connection to WA") || txt.includes("Session details")) {
      log(`[WA-AKG] ${txt.trim().slice(0, 100)}`);
    }
  });

  akgProcess.stderr.on("data", (chunk) => {
    // suppress verbose debug logs
  });

  akgProcess.on("exit", (code) => {
    log(`WA-AKG encerrou com código ${code}. Tentando reiniciar em 3s...`);
    akgProcess = null;
  });

  // Aguarda 5 segundos para o gateway subir
  await new Promise((r) => setTimeout(r, 5000));
}

export async function syncConfig(url = DEFAULT_GATEWAY_URL) {
  const cleanUrl = url.replace(/\/+$/, "");
  const gatewayUrl = cleanUrl.endsWith("/api") ? cleanUrl : `${cleanUrl}/api`;

  log(`Sincronizando com Worker e Firebase RTDB: ${gatewayUrl}`);

  let phone = "557197069291";
  let isConnected = true;

  try {
    const sRes = await fetch(`${gatewayUrl}/sessions/${encodeURIComponent(INSTANCE)}`, {
      headers: { "X-API-Key": API_KEY, "bypass-tunnel-reminder": "true" },
      signal: AbortSignal.timeout(6000),
    });
    if (sRes.ok) {
      const data = await sRes.json();
      const sess = data?.data || data || {};
      isConnected = sess.status === "CONNECTED" || Boolean(sess.me);
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
      signal: AbortSignal.timeout(10000),
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

  tunnelChild.on("close", (code) => {
    log(`Túnel encerrou (código ${code}). Reiniciando em 3s...`);
    tunnelChild = null;
    setTimeout(runTunnel, 3000);
  });
}

export async function startSupervisor() {
  log("Iniciando supervisão contínua do WhatsApp...");
  await ensureMysql();
  await ensureWaAkg();
  runTunnel();

  // Heartbeat a cada 30 segundos
  setInterval(async () => {
    try {
      const ping = await fetch(`http://localhost:3000/api/sessions/${INSTANCE}`, {
        headers: { "X-API-Key": API_KEY },
        signal: AbortSignal.timeout(3000),
      });
      if (!ping.ok) {
        log("Alerta: WA-AKG não respondeu ao ping interno. Verificando...");
        await ensureWaAkg();
      }
    } catch {
      await ensureWaAkg();
    }
  }, 30000);
}

if (process.argv[1]?.endsWith("wa-service-manager.mjs")) {
  startSupervisor();
}
