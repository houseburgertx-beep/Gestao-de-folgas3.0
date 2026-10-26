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
const PHONE = "557391740014";

export async function syncGatewayConfig(tunnelUrl) {
  const cleanUrl = tunnelUrl.replace(/\/+$/, "");
  const gatewayUrl = cleanUrl.endsWith("/api") ? cleanUrl : `${cleanUrl}/api`;
  
  console.log(`[WA Daemon] Sincronizando gateway URL com o Worker e Firebase RTDB: ${gatewayUrl}`);
  
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
        connectionStatus: "connected",
        phone: PHONE,
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

// Se executado diretamente via linha de comando
if (process.argv[1]?.endsWith("wa-tunnel-daemon.mjs")) {
  let customUrl = process.argv[2];
  if (!customUrl || customUrl.startsWith("--")) {
    customUrl = "https://house190-bot.loca.lt";
  }
  syncGatewayConfig(customUrl).then((ok) => {
    process.exit(ok ? 0 : 1);
  });
}
