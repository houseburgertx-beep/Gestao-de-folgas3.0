import assert from "node:assert/strict";
import test from "node:test";
import { FirebaseRuntime } from "../src/core/runtime.js";

function setup() {
  const app = new FirebaseRuntime({ databaseURL: "https://example.firebaseio.com" }, "gestao-folgas/v2");
  app.auth = { currentUser: { uid: "owner", getIdToken: async () => "test-token" } };
  return app;
}
const record = () => ({ RegistroPontoID: "12345678-abcd-1234-abcd-123456789012", RequestID: "12345678-abcd-1234-abcd-123456789012",
  FuncionarioID: "employee-a", LojaID: "store-a", Data: "2026-11-02", DataHora: "2026-11-02T12:00:00Z" });

test("leitura de confirmação nunca usa cache otimista quando servidor está offline", async () => {
  const app = setup();
  const row = record();
  app.queryCache.set("RegistrosPonto:cached", { data: [row] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  try {
    await assert.rejects(app.getByIdFromServer("RegistrosPonto", row.RequestID), /Sem confirmação do servidor/);
    assert.equal(app.queryCache.get("RegistrosPonto:cached").data[0].RequestID, row.RequestID);
  } finally { globalThis.fetch = originalFetch; }
});

test("criação do ponto usa GET ETag e PUT condicional sem sobrescrever registro", async () => {
  const app = setup();
  const row = record();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === "GET") return new Response("null", { headers: { ETag: '"empty-version"' } });
    return new Response(options.body);
  };
  try {
    const result = await app.createClockRecord(row);
    assert.equal(result.DataHora, row.DataHora);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "PUT"]);
    assert.equal(calls[0].headers["X-Firebase-ETag"], "true");
    assert.equal(calls[1].headers["If-Match"], '"empty-version"');
    assert.equal(calls[0].cache, "no-store");
    assert.equal(calls[1].cache, "no-store");
    assert.equal(new URL(calls[0].url).searchParams.get("auth"), "test-token");
    assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
    assert.equal(result.PeriodoChave, "2026-11");
  } finally { globalThis.fetch = originalFetch; }
});

test("registro já confirmado retorna original sem novo PUT, mesmo para administrador", async () => {
  const app = setup();
  const originalFetch = globalThis.fetch;
  const confirmed = record();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(confirmed)); };
  try {
    const saved = await app.createClockRecord({ ...record(), DataHora: "2026-11-02T13:00:00Z" });
    assert.equal(saved.DataHora, confirmed.DataHora);
    assert.equal(calls, 1);
    await assert.rejects(app.createClockRecord({ ...record(), FuncionarioID: "employee-b" }), /outro registro/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("CAS concorrente aceita apenas recibo servidor do mesmo ponto", async () => {
  const app = setup();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_, options) => options.method === "GET"
    ? new Response("null", { headers: { ETag: '"empty-version"' } })
    : new Response(JSON.stringify(record()), { status: 412 });
  try {
    assert.equal((await app.createClockRecord(record())).RequestID, record().RequestID);
    globalThis.fetch = async (_, options) => options.method === "GET"
      ? new Response("null", { headers: { ETag: '"empty-version"' } })
      : new Response(JSON.stringify({ ...record(), FuncionarioID: "other" }), { status: 412 });
    await assert.rejects(app.createClockRecord(record()), /não confirmou esta tentativa/);
  } finally { globalThis.fetch = originalFetch; }
});

test("confirmação tem prazo e erro de autorização nunca retorna cache", async () => {
  const app = setup();
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Permission denied" }), { status: 401 });
    await assert.rejects(app.getByIdFromServer("RegistrosPonto", record().RequestID), /servidor recusou/);
    globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 15000); queueMicrotask(callback); return -1; };
    globalThis.clearTimeout = () => {};
    globalThis.fetch = () => new Promise(() => {});
    await assert.rejects(app.getByIdFromServer("RegistrosPonto", record().RequestID), /demorou para confirmar/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
