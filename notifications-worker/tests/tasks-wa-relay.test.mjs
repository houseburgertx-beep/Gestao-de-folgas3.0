import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const baseEnv = {
  DB: {},
  APP_ORIGIN: "https://houseburgertx-beep.github.io",
  FIREBASE_WEB_API_KEY: "test",
  FIREBASE_CLIENT_EMAIL: "test@example.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "invalid-key-falls-back-to-env",
  VAPID_PUBLIC_KEY: "test",
  VAPID_PRIVATE_KEY: "test",
  WA_ENABLED: "true",
  WA_API_URL: "https://wa-mock.example.test/api",
  WA_SESSION_ID: "house190",
  WA_API_KEY: "mock-wa-key",
  TASKS_RELAY_SECRET: "relay-secret-256bit",
};

const req = (body, headers = {}, method = "POST") =>
  new Request("https://worker/tasks-wa-relay", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });

test("/tasks-wa-relay rejeita GET e requisicoes sem X-Relay-Secret valido", async () => {
  assert.equal((await worker.fetch(req({}, {}, "GET"), baseEnv)).status, 405);
  assert.equal((await worker.fetch(req({ action: "status" }), baseEnv)).status, 401);
  assert.equal((await worker.fetch(req({ action: "status" }, { "X-Relay-Secret": "wrong" }), baseEnv)).status, 401);
});

test("/tasks-wa-relay envia texto para contato e grupo e consulta status/qr/session no WA-AKG", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET", headers: init?.headers, body: init?.body });
    if (String(url).endsWith("/sessions/house190")) {
      return Response.json({ status: true, data: { status: "CONNECTED", uptime: 120, me: { id: "5573982113316:1@s.whatsapp.net", name: "House 190" } } });
    }
    if (String(url).endsWith("/sessions/house190/qr")) {
      return Response.json({ success: true, qr: "2@qr", base64: "data:image/png;base64,AAA" });
    }
    if (String(url).endsWith("/sessions/house190/restart")) {
      return Response.json({ status: true });
    }
    if (String(url).endsWith("/send")) {
      return Response.json({ status: true, data: { key: { id: "MSG_OK_1" } } });
    }
    return new Response("not found", { status: 404 });
  };
  try {
    const auth = { "X-Relay-Secret": "relay-secret-256bit" };
    const statusRes = await (await worker.fetch(req({ action: "status" }, auth), baseEnv)).json();
    assert.equal(statusRes.connected, true);
    assert.equal(statusRes.phone, "5573982113316");

    const qrRes = await (await worker.fetch(req({ action: "qr" }, auth), baseEnv)).json();
    assert.equal(qrRes.success, true);

    const restartRes = await (await worker.fetch(req({ action: "session", sessionAction: "restart" }, auth), baseEnv)).json();
    assert.equal(restartRes.ok, true);

    const sendContact = await (await worker.fetch(req({ action: "send", recipient: "73991740014", text: "Ola Gleuce" }, auth), baseEnv)).json();
    assert.equal(sendContact.ok, true);
    assert.equal(sendContact.messageId, "MSG_OK_1");
    assert.ok(calls.some((c) => c.url.includes("5573991740014%40s.whatsapp.net/send")));

    const sendGroup = await (await worker.fetch(req({ action: "send", recipient: "120363012345678901@g.us", text: "Aviso grupo" }, auth), baseEnv)).json();
    assert.equal(sendGroup.ok, true);
    assert.ok(calls.some((c) => c.url.includes("120363012345678901%40g.us/send")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
