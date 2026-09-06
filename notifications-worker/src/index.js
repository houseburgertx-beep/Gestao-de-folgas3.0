import webpush from "web-push";
import {
  active,
  bahiaDay,
  shiftDate,
  remindersFor,
} from "../../src/core/reminder-policy.js";
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
async function googleToken(env) {
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
    signal: AbortSignal.timeout(10000),
  });
  return (await boundedJson(response, 16384)).access_token;
}
async function database(env, token, path, params = {}) {
  const url = new URL(
    `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/${path}.json`,
  );
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, JSON.stringify(value));
  return (
    (await boundedJson(
      await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
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
        signal: AbortSignal.timeout(10000),
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
    await fetch(url, { signal: AbortSignal.timeout(10000) }),
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
async function send(env, sub, message, ttl = 120) {
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
const ready = (env) =>
  [
    "DB",
    "FIREBASE_WEB_API_KEY",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
  ].every((key) => Boolean(env[key]));
async function handle(request, env) {
  const origin = request.headers.get("Origin");
  if (origin !== env.APP_ORIGIN)
    return new Response("Forbidden", { status: 403 });
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  const json = (body, status = 200) => Response.json(body, { status, headers });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  if (!ready(env)) return json({ error: "not_configured" }, 503);
  try {
    const { uid } = await authenticate(request, env);
    const body = await boundedJson(new Response(request.body), 8192);
    const route = new URL(request.url).pathname,
      now = Date.now();
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
      return json({
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
      return json(
        { ok: code >= 200 && code < 300 },
        code >= 200 && code < 300 ? 200 : 502,
      );
    }
    return json({ error: "not_found" }, 404);
  } catch {
    return json({ error: "request_failed" }, 400);
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
  const [employees, schedules, timeOff, records, access, notices] =
    await Promise.all([
      database(env, token, "tables/Funcionarios"),
      database(env, token, "tables/JornadasPonto"),
      database(env, token, "tables/Folgas"),
      database(env, token, "tables/RegistrosPonto", {
        orderBy: "Data",
        startAt: shiftDate(day, -1),
        endAt: day,
      }),
      database(env, token, "access"),
      database(env, token, "tables/Notificacoes", {
        orderBy: "DataCriacao",
        startAt: new Date(now - 5 * 60000).toISOString(),
      }),
    ]);
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
        events.push({
          key: `aviso:${n.NotificacaoID}`,
          title: "House 190 · Novo aviso",
          body: "Você tem uma atualização. Abra o aplicativo para conferir.",
          view: "notifications",
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
    }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM deliveries WHERE expires_at<?").bind(now),
    env.DB.prepare("DELETE FROM devices WHERE updated_at<?").bind(
      now - 90 * 86400000,
    ),
  ]);
  console.log(JSON.stringify({ event: "reminders_tick", attempted: sent }));
}
export default {
  fetch: handle,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};
