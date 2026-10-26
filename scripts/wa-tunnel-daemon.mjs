#!/usr/bin/env node
/**
 * wa-tunnel-daemon.mjs
 * Monitor de resiliência e sincronização automática da conexão WhatsApp (WA-AKG)
 * com o Cloudflare Worker e Firebase RTDB.
 */

import { spawn } from "node:child_process";

const WORKER_URL = "https://house-folgas-notifications.brunohouse.workers.dev";
const API_KEY = "wag_lHoXJO4s0S0yX1cD1PMLkAu4ghGmrhBl";
const INSTANCE = "house190";
const DEFAULT_SUBDOMAIN = "house190-bot";
const DEFAULT_GATEWAY_URL = `https://${DEFAULT_SUBDOMAIN}.loca.lt/api`;

export async function syncGatewayConfig(tunnelUrl = DEFAULT_GATEWAY_URL) {
  const cleanUrl = tunnelUrl.replace(/\/+$/, "");
  const gatewayUrl = cleanUrl.endsWith("/api") ? cleanUrl : `${cleanUrl}/api`;
  
  console.log(`[WA Daemon] Sincronizando gateway URL com o Worker e Firebase RTDB: ${gatewayUrl}`);

  // Tenta obter o telefone e status real da sessão do WA-AKG
  let detectedPhone = "557197069291";
  let isConnected = true;
  try {
    const sRes = await fetch(`${gatewayUrl}/sessions/${encodeURIComponent(INSTANCE)}`, {
      headers: {
        "X-API-Key": API_KEY,
        "bypass-tunnel-reminder": "true",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (sRes.ok) {
      const sData = await sRes.json();
      const sess = sData?.data || sData || {};
      isConnected = sess.status === "CONNECTED" || Boolean(sess.me);
      if (sess.me?.id) {
        detectedPhone = sess.me.id.split("@")[0].split(":")[0];
      }
    }
  } catch (_) {}
  
  try {
    const res = await fetch(`${WORKER_URL}/wa-gateway-config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
      },
      body: JSON.stringify({
        gatewayUrl,
        instanceName: INSTANCE,
        apiKey: API_KEY,
        connectionStatus: isConnected ? "connected" : "disconnected",
        phone: detectedPhone,
      }),
      signal: AbortSignal.timeout(10000),
    });
    
    if (res.ok) {
      const data = await res.json();
      console.log(`[WA Daemon] Sincronização concluída com sucesso:`, data);
      return true;
    } else {
      const err = await res.text();
      console.error(`[WA Daemon] Erro na sincronização: HTTP ${res.status} - ${err}`);
      return false;
    }
  } catch (err) {
    console.error(`[WA Daemon] Falha de rede ao sincronizar:`, err.message);
    return false;
  }
}

export function runTunnelSupervisor() {
  console.log(`[WA Supervisor] Iniciando supervisor resiliente do túnel Localtunnel (${DEFAULT_SUBDOMAIN})...`);
  
  let currentChild = null;
  let isStopping = false;

  function spawnTunnel() {
    if (isStopping) return;
    console.log(`[WA Supervisor] Lançando novo processo localtunnel na porta 3000...`);
    
    currentChild = spawn("npx", ["localtunnel", "--port", "3000", "--subdomain", DEFAULT_SUBDOMAIN], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    currentChild.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      console.log(`[Localtunnel] ${text.trim()}`);
      const match = text.match(/your url is:\s*(https:\/\/[^\s]+)/i);
      if (match) {
        const liveUrl = match[1].trim();
        console.log(`[WA Supervisor] Túnel ativo detectado: ${liveUrl}. Sincronizando com o Cloudflare Worker...`);
        syncGatewayConfig(liveUrl).catch(() => {});
      }
    });

    currentChild.stderr.on("data", (chunk) => {
      console.warn(`[Localtunnel Warning] ${chunk.toString().trim()}`);
    });

    currentChild.on("close", (code) => {
      console.warn(`[WA Supervisor] Processo localtunnel encerrou com código ${code}. Reiniciando em 3s...`);
      currentChild = null;
      if (!isStopping) {
        setTimeout(spawnTunnel, 3000);
      }
    });

    currentChild.on("error", (err) => {
      console.error(`[WA Supervisor] Erro no processo localtunnel:`, err.message);
    });
  }

  // Heartbeat a cada 25 segundos para manter o socket do túnel aquecido e evitar timeout de ociosidade
  const heartbeatTimer = setInterval(async () => {
    try {
      await fetch(`${DEFAULT_GATEWAY_URL}/sessions/${encodeURIComponent(INSTANCE)}`, {
        headers: {
          "X-API-Key": API_KEY,
          "bypass-tunnel-reminder": "true",
        },
        signal: AbortSignal.timeout(4000),
      });
    } catch (_) {}
  }, 25000);

  process.on("SIGINT", () => {
    isStopping = true;
    clearInterval(heartbeatTimer);
    if (currentChild) currentChild.kill();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    isStopping = true;
    clearInterval(heartbeatTimer);
    if (currentChild) currentChild.kill();
    process.exit(0);
  });

  spawnTunnel();
}

// Se executado diretamente via linha de comando
if (process.argv[1]?.endsWith("wa-tunnel-daemon.mjs")) {
  const arg = process.argv[2] || "";
  if (arg === "--daemon" || arg === "--watch" || arg === "-d") {
    runTunnelSupervisor();
  } else {
    let customUrl = arg;
    if (!customUrl || customUrl.startsWith("--")) {
      customUrl = DEFAULT_GATEWAY_URL;
    }
    syncGatewayConfig(customUrl).then((ok) => {
      process.exit(ok ? 0 : 1);
    });
  }
}
