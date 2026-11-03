import {runGroqConversation,GROQ_CHAT_MODEL} from "./wa-chat.js";
import { relayNotification, verifyCreatorNotificationEvent } from "./notification-relay.js";
import { handleIntegrity } from "./whistleblower-service.js";
import webpush from "web-push";
import {
  active,
  bahiaDay,
  shiftDate,
  remindersFor,
  scheduleForDay,
} from "../../src/core/reminder-policy.js";
import { normalizeWhatsAppPhone, sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppPoll } from "./whatsapp.js";
import { processInboundHouseAI, generateMotivationalTimeClockMessage, findEmployeeByPhone } from "./house-ai.js";
const encoder = new TextEncoder();
const b64 = (value) =>
  btoa(String.fromCharCode(...value))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
const claim = (object) => b64(encoder.encode(JSON.stringify(object)));
const MAX_BYTES = 8 * 1024 * 1024;
export async function boundedJson(response, max = MAX_BYTES) {
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  const reader = response.body.getReader();
  let size = 0;
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    parts.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder().decode(joined));
}
export async function boundedText(stream, max) {
  const reader = stream.getReader();
  const parts = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new Error("request_too_large"); }
    parts.push(value);
  }
  const joined = new Uint8Array(size); let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
  return new TextDecoder().decode(joined);
}
export async function equalSecret(left, right) {
  const digest = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export async function verifyWebhookSignature(body, signature, secret) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/i.test(signature || "")) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.slice(7).match(/../g), (v) => parseInt(v, 16));
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(body));
}
const googleTokens = new WeakMap();
async function googleToken(env) {
  const cached = googleTokens.get(env);
  if (cached && cached.expiresAt > Date.now() && cached.email === env.FIREBASE_CLIENT_EMAIL && cached.privateKey === env.FIREBASE_PRIVATE_KEY) return cached.promise;
  const entry = {
    email: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY,
    expiresAt: Date.now() + 50 * 60000, promise: fetchGoogleToken(env),
  };
  googleTokens.set(env, entry);
  try { return await entry.promise; }
  catch (error) { if (googleTokens.get(env) === entry) googleTokens.delete(env); throw error; }
}
async function fetchGoogleToken(env) {
  const seconds = Math.floor(Date.now() / 1000);
  const input = `${claim({ alg: "RS256", typ: "JWT" })}.${claim({ iss: env.FIREBASE_CLIENT_EMAIL, scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email", aud: "https://oauth2.googleapis.com/token", iat: seconds, exp: seconds + 3600 })}`;
  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = b64(
    new Uint8Array(
      await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(input)),
    ),
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${input}.${signed}`,
    }),
    signal: AbortSignal.timeout(6000),
  });
  const token = (await boundedJson(response, 16384)).access_token;
  if (!token || typeof token !== "string") throw new Error("invalid_google_token");
  return token;
}
async function database(env, token, path, params = {}, timeoutMs = 15000) {
  const url = new URL(
    `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/${path}.json`,
  );
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, JSON.stringify(value));
  return (
    (await boundedJson(
      await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    )) || {}
  );
}
async function authenticate(request, env) {
  const idToken = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!idToken || idToken.length > 8192) throw new Error("unauthorized");
  const account = await boundedJson(
    await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(4000),
      },
    ),
    32768,
  );
  const user = account.users?.[0];
  if (!user || user.disabled) throw new Error("unauthorized");
  // Token is validated by Firebase, including expiry/revocation. RTDB additionally
  // checks the same token against this project's existing access rules.
  const url = new URL(
    `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/access/${encodeURIComponent(user.localId)}.json`,
  );
  url.searchParams.set("auth", idToken);
  const profile = await boundedJson(
    await fetch(url, { signal: AbortSignal.timeout(4000) }),
    65536,
  );
  if (!profile || !active(profile.Ativo)) throw new Error("unauthorized");
  return { uid: user.localId, profile };
}
export function validSubscription(sub) {
  if (!sub || typeof sub.endpoint !== "string" || sub.endpoint.length > 2048)
    return false;
  let url;
  try {
    url = new URL(sub.endpoint);
  } catch {
    return false;
  }
  // Prevent authenticated requests from turning the sender into an SSRF proxy.
  const allowed =
    url.hostname === "fcm.googleapis.com" ||
    url.hostname === "updates.push.services.mozilla.com" ||
    url.hostname.endsWith(".notify.windows.com") ||
    url.hostname === "web.push.apple.com" ||
    url.hostname.endsWith(".push.apple.com");
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    allowed &&
    /^[A-Za-z0-9_-]{87}=?$/.test(sub.keys?.p256dh || "") &&
    /^[A-Za-z0-9_-]{22}={0,2}$/.test(sub.keys?.auth || "")
  );
}
export async function deliver(env, sub, message, ttl = 120) {
  if (!validSubscription(sub)) return 410;
  const details = webpush.generateRequestDetails(sub, JSON.stringify(message), {
    TTL: Math.max(1, ttl),
    urgency: "high",
    vapidDetails: {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    },
  });
  const response = await fetch(details.endpoint, {
    method: "POST",
    headers: details.headers,
    body: details.body,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  await response.body?.cancel();
  return response.status;
}
async function send(env, sub, message, ttl = 120) {
  if (!env.DELIVERY) return deliver(env, sub, message, ttl);
  const response = await env.DELIVERY.fetch("https://internal/send", {
    method: "POST", body: JSON.stringify({sub, message, ttl}),
  });
  await response.body?.cancel();
  return response.status;
}
const ready = (env) =>
  [
    "DB",
    "FIREBASE_WEB_API_KEY",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
  ].every((key) => Boolean(env[key]));
async function getGatewayConfig(env) {
  let dbConfig = null;
  let privateConfig = null;
  try {
    const tok = await googleToken(env);
    [dbConfig, privateConfig] = await Promise.all([
      database(env, tok, "tables/Configuracoes/WhatsAppGateway", {}, 6000),
      database(env, tok, "workerPrivate/WhatsAppGateway", {}, 6000),
    ]);
  } catch (err) {
    console.warn("Failed to fetch WhatsAppGateway from RTDB:", err);
  }

  let baseUrl = (dbConfig?.GatewayUrl || env.WA_API_URL || "https://house190-bot.loca.lt/api").trim().replace(/\/+$/, "");
  if (!baseUrl.endsWith("/api") && !baseUrl.includes("/api/")) {
    baseUrl = `${baseUrl}/api`;
  }
  const sessionId = (dbConfig?.InstanceName || env.WA_SESSION_ID || "house190").trim();
  const apiKey = (env.WA_API_KEY || privateConfig?.ApiKey || dbConfig?.ApiKey || "").trim();

  return {
    url: baseUrl,
    instance: sessionId,
    apiKey,
    ativo: dbConfig?.Ativo !== false,
  };
}

async function handle(request, env) {
  const origin = request.headers.get("Origin") || "";
  const isAllowedOrigin =
    !origin ||
    origin === env.APP_ORIGIN ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  if (!isAllowedOrigin)
    return new Response("Forbidden", { status: 403 });

  const headers = {
    "Access-Control-Allow-Origin": origin || env.APP_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Service-Token, X-Webhook-Signature, bypass-tunnel-reminder",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  const json = (body, status = 200) => Response.json(body, { status, headers });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (request.method !== "POST" && request.method !== "GET")
    return json({ error: "method_not_allowed" }, 405);
  if (!ready(env)) return json({ error: "not_configured" }, 503);

  let body = {};
  let rawBody = "";
  if (request.method === "POST" && request.body) {
    try {
      rawBody = await boundedText(request.body, 65536);
      body = JSON.parse(rawBody);
    } catch (_) {
      return json({ error: "invalid_json" }, 400);
    }
  }
  const route = new URL(request.url).pathname,
    now = Date.now();

  if (["/integrity/create", "/integrity/consult", "/integrity/message"].includes(route)) {
    if (request.method !== "POST") return json({ success: false, message: "method_not_allowed" }, 405);
    try {
      let cachedToken;
      const token = async () => cachedToken ||= await googleToken(env);
      return json(await handleIntegrity({ route, request, payload: body, env, database, token, now }));
    } catch (error) {
      return json({ success: false, message: error.status ? error.message : "Serviço indisponível. Tente novamente." }, error.status || 502);
    }
  }

  if (route === "/wa-inbound" || route === "/wa-webhook") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!env.WA_WEBHOOK_SECRET) return json({ error: "webhook_not_configured" }, 503);
    if (!await verifyWebhookSignature(rawBody, request.headers.get("X-Webhook-Signature"), env.WA_WEBHOOK_SECRET)) return json({ error: "unauthorized" }, 401);
    const eventTime = Date.parse(body.timestamp);
    if (!Number.isFinite(eventTime) || Math.abs(now - eventTime) > 300000) return json({ error: "stale_webhook" }, 401);
    try {
      if (body.event && body.event !== "message.received" && body.event !== "message") {
        return json({ ok: true, ignored: true, reason: `event_${body.event}` });
      }

      const isFromMe = body.data?.key?.fromMe === true || body.fromMe === true;
      if (isFromMe) {
        return json({ ok: true, ignored: true, reason: "from_me" });
      }

      const rawFrom =
        body.data?.from ||
        body.data?.key?.remoteJid ||
        body.from ||
        body.phone ||
        "";
      let interactiveText = "";
      try {
        const rawParams = body.data?.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
        if (rawParams) {
          const parsed = JSON.parse(rawParams);
          interactiveText = parsed?.display_text || parsed?.id || "";
        }
      } catch (_) {}

      const rawText =
        body.data?.content ||
        body.data?.caption ||
        body.data?.message?.conversation ||
        body.data?.message?.extendedTextMessage?.text ||
        body.data?.message?.buttonsResponseMessage?.selectedDisplayText ||
        body.data?.message?.buttonsResponseMessage?.selectedButtonId ||
        body.data?.message?.templateButtonReplyMessage?.selectedDisplayText ||
        body.data?.message?.templateButtonReplyMessage?.selectedId ||
        interactiveText ||
        body.data?.message?.interactiveResponseMessage?.body?.text ||
        body.text ||
        body.body ||
        "";
      const pushName = body.data?.pushName || body.pushName || "";
      const messageId = body.data?.key?.id || body.messageId || "";

      if (body.data?.isGroup || String(rawFrom).endsWith("@g.us")) return json({ ok: true, ignored: true, reason: "group" });
      if (typeof rawFrom !== "string" || typeof rawText !== "string" || !messageId || typeof messageId !== "string" || messageId.length > 200 || !rawFrom || !rawText) {
        return json({ error: "missing_from_or_text" }, 400);
      }

      // Deduplicação pelo ID da mensagem no D1
      if (messageId && env.DB) {
        try {
          const eventKey = `wa_inbound:${messageId}`;
          const lock = await env.DB.prepare(
            "INSERT INTO deliveries(event_key,endpoint,state,lease_until,expires_at) VALUES(?,?,'sending',?,?) ON CONFLICT(event_key,endpoint) DO UPDATE SET state='sending',lease_until=excluded.lease_until WHERE deliveries.state!='sent' AND deliveries.lease_until<?"
          )
            .bind(eventKey, rawFrom, now + (env.GROQ_API_KEY ? 120000 : 60000), now + 86400000, now)
            .run();

          if (!lock.meta.changes) {
            return json({ ok: true, deduplicated: true });
          }
        } catch (_) { return json({ error: "deduplication_unavailable" }, 503); }
      }

      const tok = await googleToken(env);
      const aiResult = await processInboundHouseAI({
        from: rawFrom,
        text: rawText,
        pushName,
        env,
        database,
        tok,
        now,
      });

      if (aiResult?.replyText) {
        const gw = await getGatewayConfig(env);
        const sendRes = await sendWhatsAppMessage(env, {
          phone: rawFrom,
          text: aiResult.replyText,
          gwConfig: gw,
        });

        // Grava auditoria no Firebase RTDB
        const auditUrl = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/Auditoria.json`;
        await fetch(auditUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            Acao: "WhatsApp Inbound House AI",
            Modulo: "HouseAI",
            Telefone: rawFrom,
            MensagemRecebida: aiResult.action === "bloqueio_lgpd_saude" ? "[conteúdo de saúde omitido]" : rawText,
            RespostaGerada: aiResult.replyText,
            DisparoStatus: sendRes.success ? "enviado" : "erro",
            DataHora: new Date(now).toISOString(),
          }),
          signal: AbortSignal.timeout(6000),
        }).catch(() => {});

        // Marca entrega como enviada no D1
        if (messageId && env.DB && sendRes.success) {
          await env.DB.prepare(
            "UPDATE deliveries SET state='sent' WHERE event_key=? AND endpoint=?"
          )
            .bind(`wa_inbound:${messageId}`, rawFrom)
            .run()
            .catch(() => {});
        }

        return json({
          ok: true,
          action: aiResult.action,
          replyText: aiResult.replyText,
          sent: sendRes.success,
        });
      }

      return json({ ok: true, handled: false });
    } catch (err) {
      return json({ error: "inbound_failed", details: String(err.message || err) }, 502);
    }
  }

  if (route === "/wa-ai-diagnostic") {
    const serviceToken=request.headers.get("X-Service-Token");
    if (!env.WA_SERVICE_TOKEN || !serviceToken || !await equalSecret(serviceToken,env.WA_SERVICE_TOKEN)) return json({error:"forbidden"},403);
    if (request.method !== "POST") return json({error:"method_not_allowed"},405);
    if (!env.GROQ_API_KEY) return json({configured:false,provider:"groq"},503);
    // No real employee records and no WhatsApp delivery in diagnostics.
    const sample={FuncionarioID:"synthetic-ai-test",Nome:"Lucas Teste",LojaID:"synthetic-store",Ativo:true,Perfil:"Funcionário",Cargo:"Atendente"};
    const today=new Date(now-3*3600000).toISOString().slice(0,10);
    const tomorrow=new Date(Date.parse(`${today}T12:00:00Z`)+86400000).toISOString().slice(0,10);
    const fixtures={JornadasPonto:{a:{FuncionarioID:sample.FuncionarioID,Ativa:true,VigenteDe:"2020-01-01",DiasTrabalho:"0,1,2,3,4,5,6",Entrada:"08:00",Saida:"17:00"}},Folgas:{a:{FuncionarioID:sample.FuncionarioID,DataInicio:tomorrow,DataFim:tomorrow,Status:"Aprovada"}},Tarefas:{a:{FuncionarioID:sample.FuncionarioID,Titulo:"Conferir freezers",Status:"A fazer",LojaID:sample.LojaID}}};
    let state;const memory={load:async()=>state,save:async value=>{state=value;}};
    const turns=[];
    const questions=body.scenario==="conversation" ? ["Meu ônibus atrasou, acho que vou chegar às 08:20.","Quantos minutos de atraso em relação ao meu horário?","Então escreva uma mensagem curta para avisar meu gerente, com isso."] : ["Qual é meu horário hoje?","E amanhã?","Quais são minhas tarefas?"];
    for(const question of questions) {
      const result=await runGroqConversation({env,employee:sample,employees:[sample],profile:sample,database:async(_e,_t,path)=>fixtures[path.split("/").at(-1)]||{},now,text:question,memory,executeLegacy:async()=>({replyText:"Diagnóstico não grava alterações."})});
      turns.push({question,action:result?.action,reply:result?.replyText,providerStatus:result?.providerStatus});
      if(result?.action!=="groq_conversation")break;
    }
    return json({configured:true,provider:"groq",model:env.GROQ_MODEL||GROQ_CHAT_MODEL,turns});
  }

  if (route === "/wa-clock-event") {
    try {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const { profile } = await authenticate(request, env);
      const tok = await googleToken(env);
      const employee = profile.FuncionarioID ? await database(env, tok, `tables/Funcionarios/${encodeURIComponent(profile.FuncionarioID)}`) : null;
      const phone = employee?.Telefone || employee?.WhatsApp || profile.Telefone;
      const employeeName = employee?.Nome || profile.Nome;
      const { type, timeStr } = body || {};
      if (!phone || !type) return json({ error: "missing_phone_or_type" }, 400);

      const motivationalText = generateMotivationalTimeClockMessage({
        type,
        employeeName,
        timeStr,
      });

      if (!motivationalText) {
        return json({ error: "invalid_clock_type" }, 400);
      }

      const gw = await getGatewayConfig(env);
      const sendRes = await sendWhatsAppMessage(env, {
        phone,
        text: motivationalText,
        gwConfig: gw,
      });

      return json({
        success: sendRes.success,
        messageId: sendRes.messageId,
        text: motivationalText,
      }, sendRes.success ? 200 : 502);
    } catch (err) {
      return json({ error: err.message === "unauthorized" ? "unauthorized" : "clock_event_failed" }, err.message === "unauthorized" ? 401 : 502);
    }
  }

  if (route === "/wa-gateway-config") {
    try {
      let isAllowed = false;
      let updaterName = "ServiceManager";
      const serviceToken = request.headers.get("X-Service-Token");
      if (env.WA_SERVICE_TOKEN && serviceToken && await equalSecret(serviceToken, env.WA_SERVICE_TOKEN)) {
        isAllowed = true;
      } else {
        try {
          const auth = await authenticate(request, env);
          if (auth.profile?.Perfil === "Administrador") {
            isAllowed = true;
            updaterName = auth.profile?.Nome || "Admin";
          }
        } catch (_) {}
      }

      if (!isAllowed) {
        return json({ error: "forbidden" }, 403);
      }

      const tok = await googleToken(env);
      if (request.method === "POST" && Object.hasOwn(body, "gatewayUrl")) {
        const { gatewayUrl, instanceName, apiKey } = body || {};
        let toSave = {
          Chave: "WhatsAppGateway",
          GatewayUrl: String(gatewayUrl || "").trim(),
          InstanceName: String(instanceName || "house190").trim(),
          Ativo: true,
          AtualizadoEm: new Date().toISOString(),
          AtualizadoPor: updaterName,
        };
        let parsedGateway;
        try { parsedGateway = new URL(toSave.GatewayUrl); } catch (_) { return json({ error: "invalid_gateway_url" }, 400); }
        if (parsedGateway.protocol !== "https:" || parsedGateway.username || parsedGateway.password || parsedGateway.hash || parsedGateway.search) return json({ error: "invalid_gateway_url" }, 400);
        const [existing, privateGateway] = await Promise.all([
          database(env, tok, "tables/Configuracoes/WhatsAppGateway"),
          database(env, tok, "workerPrivate/WhatsAppGateway"),
        ]);
        const newApiKey = apiKey && !String(apiKey).includes("***") ? String(apiKey).trim() : privateGateway?.ApiKey || existing?.ApiKey || "";
        const effectiveKey = env.WA_API_KEY || newApiKey;
        toSave.ApiKeyMasked = effectiveKey ? "********" + effectiveKey.slice(-4) : "";
        const updates = { "tables/Configuracoes/WhatsAppGateway": toSave };
        // Keep credentials out of the client-readable configuration tree. This
        // also removes the legacy public ApiKey on the first successful save.
        if (newApiKey) updates["workerPrivate/WhatsAppGateway/ApiKey"] = newApiKey;
        const putRes = await fetch(`${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}.json`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
          body: JSON.stringify(updates), signal: AbortSignal.timeout(10000),
        });
        if (!putRes.ok) throw new Error(`firebase_${putRes.status}`);

        if (body.phone || body.connectionStatus) {
          const connToSave = {
            Chave: "WhatsAppConnection",
            Connected: body.connectionStatus === "connected" || body.connectionStatus === true,
            Status: body.connectionStatus || "connected",
            Phone: String(body.phone || ""),
            PairingCode: "",
            QrCode: "",
            AtualizadoEm: new Date().toISOString(),
            AtualizadoPor: updaterName,
          };
          const connPutUrl = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/Configuracoes/WhatsAppConnection.json`;
          await fetch(connPutUrl, {
            method: "PUT",
            headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
            body: JSON.stringify(connToSave),
            signal: AbortSignal.timeout(10000),
          }).catch(() => {});
        }

        return json({ success: true, config: { gatewayUrl: toSave.GatewayUrl, instanceName: toSave.InstanceName, apiKeyMasked: toSave.ApiKeyMasked, ativo: toSave.Ativo } });
      } else {
        // GET
        const current = await database(env, tok, "tables/Configuracoes/WhatsAppGateway").catch(() => null);
        return json({
          success: true,
          gatewayUrl: current?.GatewayUrl || env.WA_API_URL || "https://house190-bot.loca.lt/api",
          instanceName: current?.InstanceName || env.WA_SESSION_ID || "house190",
          apiKeyMasked: current?.ApiKeyMasked || "",
          ativo: current?.Ativo !== false,
        });
      }
    } catch (err) {
      return json({ success: false, error: String(err.message || err) }, 502);
    }
  }

  try {
    const { uid, profile } = await authenticate(request, env);
    if (route === "/subscribe") {
      if (!validSubscription(body.subscription))
        return json({ error: "invalid_subscription" }, 400);
      const count = await env.DB.prepare(
        "SELECT count(*) AS n FROM devices WHERE uid=?",
      )
        .bind(uid)
        .first();
      const existing = await env.DB.prepare(
        "SELECT uid FROM devices WHERE endpoint=?",
      )
        .bind(body.subscription.endpoint)
        .first();
      if (existing && existing.uid !== uid)
        return json({ error: "device_belongs_to_other_account" }, 409);
      if (count.n >= 5 && !existing)
        return json({ error: "device_limit" }, 429);
      const preferences = Object.fromEntries(
        ["clock", "interval", "notices"].map((k) => [
          k,
          body.preferences?.[k] === true,
        ]),
      );
      await env.DB.prepare(
        "INSERT INTO devices(endpoint,uid,subscription,preferences,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET preferences=excluded.preferences,subscription=excluded.subscription,updated_at=excluded.updated_at",
      )
        .bind(
          body.subscription.endpoint,
          uid,
          JSON.stringify(body.subscription),
          JSON.stringify(preferences),
          now,
          now,
        )
        .run();
      return json({ ok: true });
    }
    if (route === "/status") {
      const device = await env.DB.prepare(
        "SELECT preferences FROM devices WHERE endpoint=? AND uid=?",
      )
        .bind(String(body.endpoint || ""), uid)
        .first();
      const schedules = device ? await database(env, await googleToken(env), "tables/JornadasPonto") : {};
      const schedule = profile.FuncionarioID && scheduleForDay(Object.values(schedules), profile.FuncionarioID, bahiaDay(now));
      return json({
        clockReady: Boolean(schedule),
        enabled: Boolean(device),
        preferences: device ? JSON.parse(device.preferences) : null,
      });
    }
    if (route === "/unsubscribe") {
      await env.DB.prepare("DELETE FROM devices WHERE endpoint=? AND uid=?")
        .bind(String(body.endpoint || ""), uid)
        .run();
      return json({ ok: true });
    }
    if (route === "/test") {
      const device = await env.DB.prepare(
        "SELECT * FROM devices WHERE endpoint=? AND uid=?",
      )
        .bind(String(body.endpoint || ""), uid)
        .first();
      if (!device) return json({ error: "not_found" }, 404);
      const lock = await env.DB.prepare(
        "UPDATE devices SET last_test=? WHERE endpoint=? AND last_test<?",
      )
        .bind(now, device.endpoint, now - 60000)
        .run();
      if (!lock.meta.changes) return json({ error: "wait_one_minute" }, 429);
      const code = await send(env, JSON.parse(device.subscription), {
        title: "House 190 · Lembretes ativados",
        body: "Este é um teste. Seus lembretes de ponto e intervalo aparecerão aqui.",
        view: "notifications",
        tag: "house-teste",
      });
      if (code === 404 || code === 410) {
        await env.DB.prepare("DELETE FROM devices WHERE endpoint=? AND uid=?").bind(device.endpoint, uid).run();
        return json({error: "subscription_expired"}, 410);
      }
      if (code < 200 || code >= 300) console.warn(JSON.stringify({event:"push_test_failed", status:code}));
      return json({ok: code >= 200 && code < 300, ...(code >= 200 && code < 300 ? {} : {error:"push_provider_rejected"})}, code >= 200 && code < 300 ? 200 : 502);
    }
    if (route === "/test-whatsapp") {
      const phone = profile.Telefone;
      if (!phone) return json({ error: "phone_missing" }, 400);
      const gw = await getGatewayConfig(env);
      const res = await sendWhatsAppMessage(env, {
        phone,
        text: "👋 *House 190*\nEste é um teste de integração com o WhatsApp via WA-AKG!",
        gwConfig: gw,
      });
      return json(res, res.success ? 200 : 502);
    }
    const isAdminOrManager = (p) =>
      ["Administrador", "Responsável de loja", "Gerente"].includes(p?.Perfil);

    if (route === "/wa-status") {
      try {
        if (!isAdminOrManager(profile)) return json({ error: "forbidden" }, 403);
        const gw = await getGatewayConfig(env);
        const res = await fetch(
          `${gw.url}/sessions/${encodeURIComponent(gw.instance)}`,
          {
            headers: {
              "X-API-Key": gw.apiKey,
              "bypass-tunnel-reminder": "true",
            },
            signal: AbortSignal.timeout(4000),
          },
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => String(res.status));
          return json({
            configured: true,
            connected: false,
            status: "gateway_unreachable",
            instanceName: gw.instance,
            gatewayUrl: gw.url,
            httpStatus: res.status,
            error: errText || `HTTP ${res.status}`,
          });
        }
        const data = await res.json();
        const session = data?.data || data || {};
        const isConnected =
          session.status === "CONNECTED" ||
          session.status === "WORKING" ||
          Boolean(session.me) ||
          Boolean(data.connected);

        let qrCode = session.qr || "";
        let status = isConnected ? "connected" : (session.status === "SCAN_QR" ? "qrcode" : (session.status || "disconnected").toLowerCase());

        // Se a sessão aguarda QR, busca a imagem base64 diretamente de /qr
        if (!isConnected) {
          try {
            const qrFetch = await fetch(
              `${gw.url}/sessions/${encodeURIComponent(gw.instance)}/qr`,
              {
                headers: {
                  "X-API-Key": gw.apiKey,
                  "bypass-tunnel-reminder": "true",
                },
                signal: AbortSignal.timeout(4000),
              },
            );
            if (qrFetch.ok) {
              const qrJson = await qrFetch.json();
              if (qrJson.base64) {
                qrCode = qrJson.base64;
                status = "qrcode";
              } else if (qrJson.qr) {
                qrCode = qrJson.qr;
                status = "qrcode";
              }
            }
          } catch (_) {}
        }

        const phone = session.me?.id ? session.me.id.split("@")[0].split(":")[0] : (session.phoneNumber || "");

        return json({
          configured: true,
          connected: isConnected,
          status,
          phone,
          pairingCode: session.pairingCode || "",
          qrcode: qrCode,
          instanceName: gw.instance,
          gatewayUrl: gw.url,
        });
      } catch (err) {
        return json({ configured: true, connected: false, status: "error", error: String(err.message || err) }, 502);
      }
    }

    if (route === "/wa-qr") {
      try {
        if (!isAdminOrManager(profile)) return json({ error: "forbidden" }, 403);
        const gw = await getGatewayConfig(env);
        const forceDisconnect = body.force === true;

        if (forceDisconnect) {
          // Desconecta a sessão existente no WA-AKG para permitir gerar um novo QR Code
          await fetch(`${gw.url}/sessions/${encodeURIComponent(gw.instance)}/logout`, {
            method: "POST",
            headers: {
              "X-API-Key": gw.apiKey,
              "Content-Type": "application/json",
              "bypass-tunnel-reminder": "true",
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(4000),
          }).catch(() => null);

          await new Promise((r) => setTimeout(r, 800));

          await fetch(`${gw.url}/sessions/${encodeURIComponent(gw.instance)}/start`, {
            method: "POST",
            headers: {
              "X-API-Key": gw.apiKey,
              "Content-Type": "application/json",
              "bypass-tunnel-reminder": "true",
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(4000),
          }).catch(() => null);

          // Limpa registro de conexão anterior no Firebase RTDB
          const tok = await googleToken(env).catch(() => null);
          if (tok) {
            const connUrl = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/Configuracoes/WhatsAppConnection.json`;
            await fetch(connUrl, {
              method: "PUT",
              headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                Chave: "WhatsAppConnection",
                Connected: false,
                Status: "qrcode",
                Phone: "",
                PairingCode: "",
                QrCode: "",
                AtualizadoEm: new Date().toISOString(),
                AtualizadoPor: profile?.Nome || "Admin",
              }),
              signal: AbortSignal.timeout(4000),
            }).catch(() => null);
          }
        } else {
          // Inicia ou retoma a sessão se não estiver rodando
          await fetch(`${gw.url}/sessions/${encodeURIComponent(gw.instance)}/start`, {
            method: "POST",
            headers: {
              "X-API-Key": gw.apiKey,
              "Content-Type": "application/json",
              "bypass-tunnel-reminder": "true",
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(4000),
          }).catch(() => null);
        }

        // Polling de até 3 tentativas para aguardar o Baileys gerar o QR Code
        let qrData = null;
        let isAlreadyConnected = false;
        let lastErrText = "";

        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 800));
          }

          const qrRes = await fetch(
            `${gw.url}/sessions/${encodeURIComponent(gw.instance)}/qr`,
            {
              headers: {
                "X-API-Key": gw.apiKey,
                "bypass-tunnel-reminder": "true",
              },
              signal: AbortSignal.timeout(4000),
            },
          ).catch((e) => {
            lastErrText = String(e.message || e);
            return null;
          });

          if (!qrRes) continue;

          if (qrRes.ok) {
            const data = await qrRes.json().catch(() => null);
            if (data && (data.base64 || data.qr || data.qrcode)) {
              qrData = data;
              break;
            }
          } else {
            const errText = await qrRes.text().catch(() => String(qrRes.status));
            lastErrText = errText;
            if (errText.includes("Already connected") || errText.includes('"connected":true')) {
              isAlreadyConnected = true;
              break;
            }
          }
        }

        if (isAlreadyConnected && !forceDisconnect) {
          // Busca o telefone conectado
          let phone = "";
          try {
            const statusRes = await fetch(`${gw.url}/sessions/${encodeURIComponent(gw.instance)}`, {
              headers: { "X-API-Key": gw.apiKey, "bypass-tunnel-reminder": "true" },
              signal: AbortSignal.timeout(4000),
            });
            if (statusRes.ok) {
              const sData = await statusRes.json();
              const sess = sData?.data || sData || {};
              phone = sess.me?.id ? sess.me.id.split("@")[0].split(":")[0] : (sess.phoneNumber || phone);
            }
          } catch (_) {}

          return json({
            success: true,
            connected: true,
            alreadyConnected: true,
            status: "connected",
            phone,
            message: "WhatsApp já está conectado com sucesso!",
            qrcode: "",
            configured: true,
          });
        }

        if (qrData) {
          const qrcode = qrData.base64 || qrData.qr || qrData.qrcode || "";
          return json({
            success: true,
            qrcode,
            base64: qrData.base64 || null,
            rawQr: qrData.qr || null,
            status: "qrcode",
            configured: true,
          });
        }

        // Se após tentativas ainda não veio QR, checa se a sessão conectou
        try {
          const sRes = await fetch(`${gw.url}/sessions/${encodeURIComponent(gw.instance)}`, {
            headers: { "X-API-Key": gw.apiKey, "bypass-tunnel-reminder": "true" },
            signal: AbortSignal.timeout(4000),
          });
          if (sRes.ok) {
            const sData = await sRes.json();
            const sess = sData?.data || sData || {};
            if (sess.status === "CONNECTED" || Boolean(sess.me)) {
              const ph = sess.me?.id ? sess.me.id.split("@")[0].split(":")[0] : (sess.phoneNumber || "");
              return json({
                success: true,
                connected: true,
                status: "connected",
                phone: ph,
                qrcode: "",
                configured: true,
              });
            }
          }
        } catch (_) {}

        return json({
          success: false,
          error: "gateway_unreachable",
          details: lastErrText || "Timeout aguardando inicialização do QR Code.",
          configured: true,
        }, 502);
      } catch (err) {
        return json({ success: false, error: String(err.message || err) }, 502);
      }
    }

    if (route === "/wa-pair-code") {
      try {
        if (!isAdminOrManager(profile)) return json({ error: "forbidden" }, 403);
        const gw = await getGatewayConfig(env);
        const phone = String(body.phone || "").replace(/\D/g, "");
        if (!phone) return json({ success: false, error: "phone_missing" }, 400);

        if (body.force === true) {
          await fetch(`${gw.url}/sessions/${encodeURIComponent(gw.instance)}/logout`, {
            method: "POST",
            headers: { "X-API-Key": gw.apiKey, "Content-Type": "application/json", "bypass-tunnel-reminder": "true" },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(8000),
          }).catch(() => null);
          await new Promise((r) => setTimeout(r, 1200));
          await fetch(`${gw.url}/sessions/${encodeURIComponent(gw.instance)}/start`, {
            method: "POST",
            headers: { "X-API-Key": gw.apiKey, "Content-Type": "application/json", "bypass-tunnel-reminder": "true" },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(8000),
          }).catch(() => null);
          await new Promise((r) => setTimeout(r, 1200));
        }

        const pairRes = await fetch(
          `${gw.url}/sessions/${encodeURIComponent(gw.instance)}/pair`,
          {
            method: "POST",
            headers: {
              "X-API-Key": gw.apiKey,
              "Content-Type": "application/json",
              "bypass-tunnel-reminder": "true",
            },
            body: JSON.stringify({ phoneNumber: phone }),
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!pairRes.ok) {
          const errText = await pairRes.text().catch(() => String(pairRes.status));
          if (errText.includes("Already connected") || errText.includes('"connected":true')) {
            return json({
              success: true,
              connected: true,
              alreadyConnected: true,
              status: "connected",
              message: "WhatsApp já está conectado com sucesso!",
            });
          }
          return json({ success: false, error: "pair_failed", details: errText });
        }
        const pairData = await pairRes.json();
        const pairingCode = pairData.data?.pairingCode || pairData.pairingCode || "";
        return json({ success: true, pairingCode });
      } catch (err) {
        return json({ success: false, error: String(err.message || err) }, 502);
      }
    }

    if (route === "/wa-disconnect") {
      try {
        if (!isAdminOrManager(profile)) return json({ error: "forbidden" }, 403);
        const gw = await getGatewayConfig(env);
        // Executa logout e stop na instância
        await fetch(
          `${gw.url}/sessions/${encodeURIComponent(gw.instance)}/logout`,
          {
            method: "POST",
            headers: {
              "X-API-Key": gw.apiKey,
              "Content-Type": "application/json",
              "bypass-tunnel-reminder": "true",
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(8000),
          },
        ).catch(() => null);

        await fetch(
          `${gw.url}/sessions/${encodeURIComponent(gw.instance)}/stop`,
          {
            method: "POST",
            headers: {
              "X-API-Key": gw.apiKey,
              "Content-Type": "application/json",
              "bypass-tunnel-reminder": "true",
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(8000),
          },
        ).catch(() => null);

        const tok = await googleToken(env);
        const url = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/Configuracoes/WhatsAppConnection.json`;
        await fetch(url, {
          method: "PUT",
          headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            Chave: "WhatsAppConnection",
            Connected: false,
            Status: "disconnected",
            Phone: "",
            PairingCode: "",
            QrCode: "",
            AtualizadoEm: new Date().toISOString(),
            AtualizadoPor: profile?.Nome || "Admin",
          }),
          signal: AbortSignal.timeout(8000),
        }).catch(() => null);

        return json({ success: true, status: "disconnected" });
      } catch (err) {
        return json({ success: false, error: String(err.message || err) }, 502);
      }
    }

    if (route === "/wa-notify") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const noticeId = String(body.notificationId || "");
      if (!noticeId || noticeId.length > 250 || /[.#$\[\]\/]/.test(noticeId)) return json({ error: "invalid_notification" }, 400);
      const tok = await googleToken(env);
      const notice = await database(env, tok, `tables/Notificacoes/${encodeURIComponent(noticeId)}`);
      // Check authorization before fetching recipient/profile data.
      const sameStore = profile.LojaID && String(notice.LojaID || "") === String(profile.LojaID);
      if (profile.Perfil !== "Administrador" && !(sameStore && (isAdminOrManager(profile) || notice.CriadoPorUID === uid))) return json({ error: "forbidden" }, 403);
      let creatorEventVerified = false;
      if (notice.CriadoPorUID === uid && !isAdminOrManager(profile)) {
        creatorEventVerified = await verifyCreatorNotificationEvent({ notice, profile,
          read: (table, id) => database(env, tok, `tables/${table}/${encodeURIComponent(id)}`),
        });
      }
      const [employees, access, automations, gateway] = await Promise.all([
        database(env, tok, "tables/Funcionarios", notice.LojaID ? { orderBy: "LojaID", equalTo: notice.LojaID } : {}),
        database(env, tok, "access"),
        database(env, tok, "tables/Configuracoes/WhatsAppAutomations"),
        getGatewayConfig(env),
      ]);
      const result = await relayNotification({ env, uid, profile, notice, employees: Object.values(employees), access: Object.values(access), automations, gateway, creatorEventVerified, now });
      return json(result.body, result.status);
    }

    if (route === "/wa-send") {
      try {
        if (!isAdminOrManager(profile)) return json({ error: "forbidden" }, 403);
        if (!body.phone || !body.text) return json({ error: "phone_or_text_missing" }, 400);
        if (profile.Perfil !== "Administrador") {
          if (!profile.LojaID) return json({ error: "forbidden" }, 403);
          const employees = await database(env, await googleToken(env), "tables/Funcionarios", { orderBy: "LojaID", equalTo: profile.LojaID });
          if (!findEmployeeByPhone(Object.values(employees), body.phone)) return json({ error: "recipient_outside_store" }, 403);
        }
        const text = String(body.text).slice(0, 1600);
        const gw = await getGatewayConfig(env);
        const res = await sendWhatsAppMessage(env, { phone: body.phone, text, gwConfig: gw });
        return json(res, res.success ? 200 : 502);
      } catch (err) {
        return json({ configured: true, connected: false, status: "error", error: String(err.message || err) }, 502);
      }
    }

    if (route === "/trigger-monthly-mirrors") {
      try {
        if (profile.Perfil !== "Administrador") return json({ error: "forbidden" }, 403);

        const token = await googleToken(env);
        await checkAndGenerateMonthlyTimeCards(env, token, Date.now());
        return json({ ok: true, message: "Espelhos mensais processados com sucesso." });
      } catch (err) {
        return json({ error: "monthly_mirrors_failed", details: String(err.message || err) }, 500);
      }
    }

    if (route === "/wa-automations") {
      try {
        if (!isAdminOrManager(profile) || profile.Perfil !== "Administrador")
          return json({ error: "forbidden" }, 403);
        if (!body.automations || typeof body.automations !== "object")
          return json({ error: "automations_missing" }, 400);
        const tok = await googleToken(env);
        const url = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/Configuracoes/WhatsAppAutomations.json`;
        const putRes = await fetch(url, {
          method: "PUT",
          headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ...body.automations, AtualizadoEm: new Date().toISOString() }),
          signal: AbortSignal.timeout(10000),
        });
        if (!putRes.ok) throw new Error(`firebase_${putRes.status}`);
        return json({ ok: true });
      } catch (err) {
        return json({ configured: Boolean(env.WA_API_URL), connected: false, status: "error", error: String(err.message || err) }, 502);
      }
    }

    if (route === "/wa-automations-get") {
      try {
        if (!isAdminOrManager(profile)) return json({ error: "forbidden" }, 403);
        const tok = await googleToken(env);
        const data = await database(env, tok, "tables/Configuracoes/WhatsAppAutomations");
        return json({ ok: true, automations: data || {} });
      } catch (err) {
        return json({ configured: Boolean(env.WA_API_URL), connected: false, status: "error", error: String(err.message || err) }, 502);
      }
    }

    return json({ error: "not_found" }, 404);
  } catch (error) {
    return json({ error: error.message === "unauthorized" ? "unauthorized" : "request_failed" }, error.message === "unauthorized" ? 401 : 400);
  }
}
export async function tick(env, now = Date.now()) {
  if (!ready(env)) throw new Error("notification_service_not_configured");
  const { results: devices } = await env.DB.prepare(
    "SELECT * FROM devices WHERE updated_at>?",
  )
    .bind(now - 90 * 86400000)
    .all();
  if (!devices.length) return;
  const token = await googleToken(env),
    day = bahiaDay(now);
  const needsClock = devices.some((device) => {
    const prefs = JSON.parse(device.preferences);
    return prefs.clock || prefs.interval;
  });
  const [schedules, records, access, notices] = await Promise.all([
    needsClock ? database(env, token, "tables/JornadasPonto") : {},
    needsClock
      ? database(env, token, "tables/RegistrosPonto", {
          orderBy: "Data",
          // The existing operational-day policy allows up to 18h into yesterday's shift.
          startAt:
            new Date(now - 3 * 3600000).getUTCHours() < 18
              ? shiftDate(day, -1)
              : day,
          endAt: day,
        })
      : {},
    database(env, token, "access"),
    devices.some((device) => JSON.parse(device.preferences).notices)
      ? database(env, token, "tables/Notificacoes", {
          orderBy: "DataCriacao",
          startAt: new Date(now - 5 * 60000).toISOString(),
        })
      : {},
  ]);
  // First identify a potential clock event using current schedules and punches.
  // Only then fetch employee/leave data. No cache can hide a new leave or deactivation.
  const hasClockCandidate =
    needsClock &&
    devices.some((device) => {
      const profile = access[device.uid];
      if (!profile || !active(profile.Ativo) || !profile.FuncionarioID)
        return false;
      return (
        remindersFor({
          employee: { FuncionarioID: profile.FuncionarioID, Ativo: true },
          schedules: Object.values(schedules).map((schedule) => ({
            ...schedule,
            DiasTrabalho: "0,1,2,3,4,5,6",
          })),
          records: Object.values(records),
          now,
          preferences: JSON.parse(device.preferences),
        }).length > 0
      );
    });
  const [employees, timeOff] = hasClockCandidate
    ? await Promise.all([
        database(env, token, "tables/Funcionarios"),
        database(env, token, "tables/Folgas"),
      ])
    : [{}, {}];
  let sent = 0;
  for (const device of devices) {
    const profile = access[device.uid];
    if (!profile || !active(profile.Ativo)) continue;
    const employee = Object.values(employees).find(
      (e) =>
        String(e.FuncionarioID) === String(profile.FuncionarioID) &&
        String(e.LojaID) === String(profile.LojaID),
    );
    const preferences = JSON.parse(device.preferences);
    const events = remindersFor({
      employee,
      schedules: Object.values(schedules),
      records: Object.values(records),
      timeOff: Object.values(timeOff),
      now,
      preferences,
    });
    if (preferences.notices)
      for (const n of Object.values(notices)) {
        const date = Date.parse(n.DataCriacao);
        const byId =
          profile.FuncionarioID &&
          String(n.DestinatarioID) === String(profile.FuncionarioID);
        const byEmail =
          profile.Email &&
          String(n.Destinatario || "").toLowerCase() ===
            String(profile.Email).toLowerCase();
        if (
          !(byId || byEmail) ||
          n.Status === "Lida" ||
          !Number.isFinite(date) ||
          date < device.created_at ||
          date > now ||
          now - date > 300000
        )
          continue;
        const viewType = (n.Tipo === "Tarefa" || String(n.Tipo || "").startsWith("TAREFA"))
          ? "tasks"
          : (n.Tipo === "Folga" ? "timeoff" : (n.Tipo === "Ponto" ? "timeclock" : "notifications"));
        events.push({
          key: `aviso:${n.NotificacaoID}`,
          title: n.Assunto || (n.Tipo ? `House 190 · ${n.Tipo}` : "House 190 · Novo aviso"),
          body: n.Mensagem || "Você tem uma atualização. Abra o aplicativo para conferir.",
          view: viewType,
          tag: `aviso-${n.NotificacaoID}`,
          expires: date + 300000,
        });
      }
    for (const event of events) {
      if (sent >= 20) break; // Keep each free-plan invocation below external request limits.
      const lock = await env.DB.prepare(
        "INSERT INTO deliveries(event_key,endpoint,state,lease_until,expires_at) VALUES(?,?,'sending',?,?) ON CONFLICT(event_key,endpoint) DO UPDATE SET state='sending',lease_until=excluded.lease_until WHERE deliveries.state!='sent' AND deliveries.lease_until<?",
      )
        .bind(event.key, device.endpoint, now + 90000, now + 2 * 86400000, now)
        .run();
      if (!lock.meta.changes) continue;
      sent++;
      try {
        const code = await send(
          env,
          JSON.parse(device.subscription),
          { ...event, tag: event.key },
          Math.ceil((event.expires - now) / 1000),
        );
        if (code === 404 || code === 410)
          await env.DB.prepare("DELETE FROM devices WHERE endpoint=?")
            .bind(device.endpoint)
            .run();
        if (code < 200 || code >= 300) throw new Error(`push_${code}`);
        await env.DB.prepare(
          "UPDATE deliveries SET state='sent' WHERE event_key=? AND endpoint=?",
        )
          .bind(event.key, device.endpoint)
          .run();
      } catch {
        // Preserve lease after uncertain delivery; tag coalesces retries on the phone.
        console.warn(JSON.stringify({ event: "push_delivery_failed" }));
      }

      const isWaEnabled =
        env.WA_ENABLED === true ||
        env.WA_ENABLED === 1 ||
        ["true", "1", "sim", "yes"].includes(String(env.WA_ENABLED || "").toLowerCase());
      const phone = isWaEnabled && (employee?.Telefone || profile.Telefone);
      const waTarget = phone ? normalizeWhatsAppPhone(phone) : null;
      if (waTarget && sent < 20) {
        const waEndpoint = `wa:${waTarget.digits}`;
        const waLock = await env.DB.prepare(
          "INSERT INTO deliveries(event_key,endpoint,state,lease_until,expires_at) VALUES(?,?,'sending',?,?) ON CONFLICT(event_key,endpoint) DO UPDATE SET state='sending',lease_until=excluded.lease_until WHERE deliveries.state!='sent' AND deliveries.lease_until<?",
        )
          .bind(event.key, waEndpoint, now + 90000, now + 2 * 86400000, now)
          .run();
        if (waLock.meta.changes) {
          sent++;
          try {
            const rawName = (employee?.Nome || profile?.Nome || "").trim();
            const firstName = rawName ? rawName.split(/\s+/)[0] : "";
            const greeting = firstName ? `Olá, *${firstName}*! 👋\n\n` : "Olá! 👋\n\n";
            const footer = event.view === "tasks" ? "\n\n_House 190 · CozinhaFlow_" : "\n\n_House 190_";
            const text = `${greeting}*${event.title}*\n${event.body}${footer}`;
            const gw = await getGatewayConfig(env);
            const waRes = await sendWhatsAppMessage(env, {
              phone: waTarget.digits,
              text,
              gwConfig: gw,
            });
            if (waRes.success) {
              await env.DB.prepare(
                "UPDATE deliveries SET state='sent' WHERE event_key=? AND endpoint=?",
              )
                .bind(event.key, waEndpoint)
                .run();
            }
          } catch {
            console.warn(JSON.stringify({ event: "wa_delivery_failed" }));
          }
        }
      }
    }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM deliveries WHERE expires_at<?").bind(now),
    env.DB.prepare("DELETE FROM devices WHERE updated_at<?").bind(
      now - 90 * 86400000,
    ),
  ]);

  // Rotina Automática de Virada de Mês (Portaria 671 MTE): Gerar espelhos de ponto para todos
  try {
    await checkAndGenerateMonthlyTimeCards(env, token, now);
  } catch (err) {
    console.warn("Fechamento mensal automático falhou:", err?.message || err);
  }

  console.log(JSON.stringify({ event: "reminders_tick", attempted: sent }));
}

/**
 * Verifica e gera automaticamente os documentos de Espelho de Ponto do mês anterior
 */
async function checkAndGenerateMonthlyTimeCards(env, token, now) {
  // Executa uma checagem diária (ou se ainda não foi gerado para o mês anterior)
  const d = new Date(now - 3 * 3600000); // Horário de Brasília
  const curDay = d.getDate();
  const curMonth = d.toISOString().slice(0, 7);

  // Calcula o mês anterior
  const prevDate = new Date(d);
  prevDate.setDate(0); // Último dia do mês anterior
  const targetMonth = prevDate.toISOString().slice(0, 7);

  const lockKey = `auto_monthly_mirror_${targetMonth}`;
  if (env.DB) {
    const lock = await env.DB.prepare(
      "INSERT INTO deliveries(event_key,endpoint,state,lease_until,expires_at) VALUES(?,'worker_cron','sent',?,?) ON CONFLICT(event_key,endpoint) DO UPDATE SET lease_until=excluded.lease_until WHERE 1=0"
    )
      .bind(lockKey, now + 30 * 86400000, now + 35 * 86400000)
      .run()
      .catch(() => null);

    // Se já foi processado neste ciclo mensal, encerra
    if (lock && !lock.meta.changes) {
      return;
    }
  }

  // Busca Funcionários, Registros de Ponto e Documentos existentes do Firebase RTDB
  const [employeesData, recordsData, docsData] = await Promise.all([
    database(env, token, "tables/Funcionarios").catch(() => ({})),
    database(env, token, `tables/RegistrosPonto/${targetMonth}`).catch(() => ({})),
    database(env, token, "tables/Documentos").catch(() => ({})),
  ]);

  const employees = Object.values(employeesData || {});
  const records = Object.values(recordsData || {});
  const docs = Object.values(docsData || {});

  const [y, mNum] = targetMonth.split("-");
  const mNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const mLabel = `${mNames[Number(mNum) - 1] || mNum} de ${y}`;

  const workedEmpIds = new Set();
  records.forEach((r) => {
    if (r.FuncionarioID && r.Status !== "Substituído") {
      workedEmpIds.add(String(r.FuncionarioID));
    }
  });

  const existingDocIds = new Set(
    docs
      .filter((doc) => doc.OrigemTipo === "ESPELHO_PONTO" || String(doc.DocID || doc.DocumentoID || "").startsWith(`ESPELHO_${targetMonth}_`))
      .map((doc) => String(doc.DocID || doc.DocumentoID))
  );

  for (const emp of employees) {
    const empId = String(emp.FuncionarioID || emp.id || "").trim();
    if (!empId) continue;

    const docId = `ESPELHO_${targetMonth}_${empId}`;
    if (existingDocIds.has(docId)) continue;

    // Apenas quem trabalhou ou está ativo
    const hasWorked = workedEmpIds.has(empId);
    if (!hasWorked && !active(emp.Ativo)) continue;

    const newDoc = {
      DocID: docId,
      DocumentoID: docId,
      Titulo: `Espelho de Ponto — ${mLabel}`,
      Tipo: "Espelho de Ponto",
      Descricao: `Espelho de ponto mensal referente a ${mLabel} disponível para conferência e assinatura eletrônica (Portaria 671 MTE).`,
      FuncionarioID: empId,
      NomeFuncionario: emp.Nome || "Colaborador",
      CPFFuncionario: emp.CPF || "",
      CargoFuncionario: emp.Cargo || "Colaborador",
      LojaID: emp.LojaID || "",
      NomeLoja: emp.NomeLoja || "Grupo House 190",
      MesReferencia: targetMonth,
      Status: "Pendente",
      OrigemTipo: "ESPELHO_PONTO",
      DataEnvio: new Date(now).toISOString(),
      CriadoPor: "Fechamento Mensal Automático",
    };

    const docUrl = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/Documentos/${docId}.json`;
    await fetch(docUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(newDoc),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});

    // Notificação RTDB
    const notifId = `notif_espelho_${targetMonth}_${empId}`;
    const notifUrl = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/Notificacoes/${notifId}.json`;
    await fetch(notifUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        NotificacaoID: notifId,
        DestinatarioID: empId,
        Destinatario: emp.Email || emp.Nome,
        Assunto: `Espelho de Ponto Disponível — ${mLabel}`,
        Mensagem: `Olá, ${emp.Nome}! Seu espelho de ponto oficial referente a ${mLabel} já está fechado e aguarda sua conferência e assinatura eletrônica obrigatória.`,
        Tipo: "Documento",
        Status: "Não lida",
        DataCriacao: new Date(now).toISOString(),
        CriadoPor: "Fechamento Mensal Automático",
      }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});

    // Disparo no WhatsApp
    const phone = emp.Telefone || emp.WhatsApp || emp.Celular;
    const waTarget = phone ? normalizeWhatsAppPhone(phone) : null;
    if (waTarget) {
      const gw = await getGatewayConfig(env);
      const firstName = String(emp.Nome || "Colaborador").trim().split(/\s+/)[0];
      const appUrl = (env.APP_URL || "https://houseburgertx-beep.github.io/Gestao-de-folgas3.0/").replace(/\/+$/, "") + "/";
      const waText = [
        `Olá, ${firstName}!`,
        `Seu espelho de ponto referente a *${mLabel}* já está disponível para conferência e assinatura eletrônica (Portaria 671 MTE).`,
        ``,
        `Acesse o aplicativo oficial para conferir e assinar direto pelo celular:`,
        `${appUrl}?tab=documents`,
        ``,
        `_Grupo House 190 • Departamento Pessoal_`,
      ].join("\n");

      await sendWhatsAppMessage(env, {
        phone: waTarget.digits,
        text: waText,
        gwConfig: gw,
      }).catch(() => {});
    }
  }
}
export default {
  fetch: handle,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};
