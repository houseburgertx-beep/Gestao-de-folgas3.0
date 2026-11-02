import test from "node:test";
import assert from "node:assert/strict";
import { requestWorker } from "../src/core/worker-client.js";
import { runtime } from "../src/core/runtime.js";

test("worker envia token Firebase sem credencial gateway e não repete POST em erro", async () => {
  const original = { auth: runtime.auth, fetch: globalThis.fetch };
  let calls = 0;
  runtime.auth = { currentUser: { uid: "one", getIdToken: async () => "firebase-token" } };
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, "Bearer firebase-token");
    assert.equal(options.headers["X-API-Key"], undefined);
    return Response.json({ error: "gateway_unreachable" }, { status: 502 });
  };
  try {
    await assert.rejects(requestWorker("/wa-send", { phone: "test", text: "test" }), /gateway_unreachable/);
    assert.equal(calls, 1);
  } finally { runtime.auth = original.auth; globalThis.fetch = original.fetch; }
});
test("prazo do worker inclui renovação do token sem pendurar a tela", async () => {
  const auth = runtime.auth;
  runtime.auth = { currentUser: { uid: "one", getIdToken: () => new Promise(() => {}) } };
  try { await assert.rejects(requestWorker("/wa-status", {}, { timeout: 5 }), /demorou/); }
  finally { runtime.auth = auth; }
});
test("canal público não envia identidade da conta conectada", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ success: true, data: { protocolo: "test" } });
  };
  try { assert.equal((await requestWorker("/integrity/create", {}, { public: true })).data.protocolo, "test"); }
  finally { globalThis.fetch = originalFetch; }
});
test("troca de conta enquanto token renova não inicia envio", async () => {
  const original = { auth: runtime.auth, fetch: globalThis.fetch };
  let release;
  let calls = 0;
  runtime.auth = { currentUser: { uid: "one", getIdToken: () => new Promise((resolve) => { release = resolve; }) } };
  globalThis.fetch = async () => { calls++; return Response.json({ success: true }); };
  try {
    const result = requestWorker("/wa-send", {});
    runtime.auth.currentUser = { uid: "two" };
    release("old-token");
    await assert.rejects(result, /sessão mudou/);
    assert.equal(calls, 0);
  } finally { runtime.auth = original.auth; globalThis.fetch = original.fetch; }
});
