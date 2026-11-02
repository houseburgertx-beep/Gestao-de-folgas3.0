import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker, { verifyWebhookSignature } from "../src/index.js";
import { findEmployeeByPhone, processInboundHouseAI } from "../src/house-ai.js";
const configured = { DB: {}, APP_ORIGIN: "https://house.test", FIREBASE_WEB_API_KEY: "test", FIREBASE_CLIENT_EMAIL: "test", FIREBASE_PRIVATE_KEY: "test", VAPID_PUBLIC_KEY: "test", VAPID_PRIVATE_KEY: "test", WA_API_KEY: "gateway-only", WA_WEBHOOK_SECRET: "webhook-secret" };
const post = (route, body = {}, headers = {}) => new Request(`https://worker${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
test("webhook validates WA-AKG HMAC over exact bytes and rejects body modification", async () => {
  const raw = JSON.stringify({ event: "message.received", text: "teste" });
  const signature = `sha256=${createHmac("sha256", configured.WA_WEBHOOK_SECRET).update(raw).digest("hex")}`;
  assert.equal(await verifyWebhookSignature(raw, signature, configured.WA_WEBHOOK_SECRET), true);
  assert.equal(await verifyWebhookSignature(`${raw} `, signature, configured.WA_WEBHOOK_SECRET), false);
  assert.equal(await verifyWebhookSignature(raw, null, configured.WA_WEBHOOK_SECRET), false);
  assert.equal(await verifyWebhookSignature(raw, signature, "different"), false);
});
test("unsigned webhooks, stale signed events and unauthenticated clock cannot reach upstream", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("unexpected network"); };
  try {
    for (const route of ["/wa-inbound", "/wa-webhook", "/wa-clock-event"]) {
      const response = await worker.fetch(post(route, { from: "5571988887777", text: "conceder folga dia 10/11", phone: "5571988887777", type: "Entrada" }), configured);
      assert.equal(response.status, 401);
    }
    const body = { event: "message.received", timestamp: "2020-01-01T00:00:00Z" };
    const signature = `sha256=${createHmac("sha256", configured.WA_WEBHOOK_SECRET).update(JSON.stringify(body)).digest("hex")}`;
    assert.equal((await worker.fetch(post("/wa-inbound", body, { "X-Webhook-Signature": signature }), configured)).status, 401);
    for (const route of ["/wa-status", "/wa-gateway-config", "/trigger-monthly-mirrors"]) {
      assert.ok([401,403].includes((await worker.fetch(post(route, {}, { "X-API-Key": "gateway-only" }), configured)).status));
    }
  } finally { globalThis.fetch = original; }
});
test("CORS rejects hostname substrings including localhost.evil", async () => {
  for (const origin of ["https://houseburgertx-beep.github.io.evil.test", "https://localhost.evil.test", "http://127.0.0.1.evil.test"]) {
    assert.equal((await worker.fetch(post("/wa-status", {}, { Origin: origin }), configured)).status, 403);
  }
});
test("phone matching preserves DDD and historical Brazilian ninth digit", () => {
  const employee = { Telefone: "71988887777" };
  assert.equal(findEmployeeByPhone([employee], "11988887777"), null);
  assert.equal(findEmployeeByPhone([employee], "557188887777"), employee);
});
test("known legacy admin phone no longer creates an administrator", async () => {
  const result = await processInboundHouseAI({ from: "5573991740014", text: "conceder folga dia 10/11", env: {}, database: async () => ({}), tok: "test" });
  assert.equal(result.authorized, false);
});
test("manager cannot grant another store's leave and inactive employee cannot access bot", async () => {
  const records = { a: { FuncionarioID: "a", Nome: "Gestor", Telefone: "71988887777", Perfil: "Gerente", LojaID: "A" }, b: { FuncionarioID: "b", Nome: "Raquel Silva", Telefone: "73999998888", LojaID: "B" } };
  const database = async (_e, _t, path) => path === "tables/Funcionarios" ? records : {};
  const result = await processInboundHouseAI({ from: "5571988887777", text: "conceder folga para Raquel dia 10/11", env: {}, database, tok: "test" });
  assert.equal(result.action, "loja_nao_autorizada");
  records.a.Ativo = false;
  assert.equal((await processInboundHouseAI({ from: "5571988887777", text: "1", env: {}, database, tok: "test" })).authorized, false);
});
test("leave approval rejects failed atomic commit without reporting success", async () => {
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (_url, options) => { writes++; assert.equal(options.method, "PATCH"); return new Response("", { status: 503 }); };
  try {
    await assert.rejects(processInboundHouseAI({ from: "5571988887777", text: "conceder folga para Raquel dia 10/11", env: { FIREBASE_DATABASE_URL: "https://mock", FIREBASE_ROOT: "test" }, database: async (_e, _t, path) => path === "tables/Funcionarios" ? { a: { FuncionarioID: "a", Nome: "Admin", Telefone: "71988887777", Perfil: "Administrador" }, b: { FuncionarioID: "b", Nome: "Raquel Silva", SaldoFolgas: 2 } } : {}, tok: "test" }), /firebase_atomic_write_503/);
    assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});
test("leave consultation uses the same explicit balance enforced by booking", async () => {
  const result = await processInboundHouseAI({ from: "5571988887777", text: "1", env: {}, database: async (_e, _t, path) => path === "tables/Funcionarios" ? { a: { FuncionarioID: "a", Nome: "Pessoa", Telefone: "71988887777", SaldoFolgas: 0 } } : {}, tok: "test" });
  assert.ok(result.replyText.includes("Saldo de folgas a agendar: 0"));
});

test("an inactive access account cannot retain WhatsApp access through an active employee", async () => {
  const result = await processInboundHouseAI({ from: "5571988887777", text: "1", env: {}, database: async (_e, _t, path) => path === "tables/Funcionarios" ? { a: { FuncionarioID: "a", Nome: "Pessoa", Telefone: "71988887777", Perfil: "Administrador", Ativo: true } } : { account: { FuncionarioID: "a", Perfil: "Administrador", Ativo: false } }, tok: "test" });
  assert.equal(result.authorized, false);
});

test("forced QR pairing reuses service OAuth and returns only the real gateway QR", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const env = { ...configured, FIREBASE_DATABASE_URL: "https://database.test", FIREBASE_ROOT: "root", FIREBASE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }) };
  const original = globalThis.fetch;
  let tokens = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("identitytoolkit.googleapis.com")) return Response.json({ users: [{ localId: "admin-user" }] });
    if (target.includes("/access/")) return Response.json({ Ativo: true, Perfil: "Administrador" });
    if (target.includes("oauth2.googleapis.com")) { tokens++; return Response.json({ access_token: "test-service-token" }); }
    if (target.includes("/tables/Configuracoes/WhatsAppGateway")) return Response.json({ GatewayUrl: "https://gateway.test/api", InstanceName: "test" });
    if (target.endsWith("/qr")) return Response.json({ base64: "data:image/png;base64,dGVzdA==" });
    return Response.json({});
  };
  try {
    const response = await worker.fetch(post("/wa-qr", { force: true }, { Authorization: "Bearer firebase-test" }), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).qrcode, "data:image/png;base64,dGVzdA==");
    assert.equal(tokens, 1);
  } finally { globalThis.fetch = original; }
});
