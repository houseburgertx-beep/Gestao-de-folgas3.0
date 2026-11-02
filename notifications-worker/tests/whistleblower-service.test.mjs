import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleIntegrity, pinHash } from "../src/whistleblower-service.js";
function setup(t) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../migrations/0002_integrity_limits.sql", import.meta.url), "utf8"));
  t.after(() => sql.close());
  const env = { INTEGRITY_PIN_SECRET: "unit-test-private-pepper-at-least-32-characters", FIREBASE_DATABASE_URL: "https://test", FIREBASE_ROOT: "root", DB: { prepare(query) { const stmt = sql.prepare(query); return { bind(...args) { return { first: async () => stmt.get(...args), run: async () => stmt.run(...args) }; } }; } } };
  const tables = { Denuncias: {}, DenunciasMensagens: {} };
  const original = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, "PATCH");
    const updates = JSON.parse(options.body); writes.push(updates);
    for (const [path, value] of Object.entries(updates)) {
      const parts = path.split("/"); let node = tables;
      for (const key of parts.slice(0, -1)) node = node[key] ||= {};
      if (value === null) delete node[parts.at(-1)]; else node[parts.at(-1)] = value;
    }
    return new Response("{}");
  };
  t.after(() => { globalThis.fetch = original; });
  const call = (route, payload, ip = "192.0.2.1", now = 1800000000000) => handleIntegrity({ route: `/integrity/${route}`, request: new Request("https://worker", { headers: { "CF-Connecting-IP": ip } }), payload, env, token: async () => "service-test", now, database: async (_e, _t, path, params) => { const parts = path.replace(/^tables\//, "").split("/"); let result = tables; for (const part of parts) result = result?.[part]; return params?.equalTo ? Object.fromEntries(Object.entries(result || {}).filter(([, m]) => m.DenunciaID === params.equalTo)) : result || {}; } });
  return { call, env, tables, writes, sql };
}
test("anonymous create stores salted hash, consult requires PIN and only exposes own messages", async (t) => {
  const { call, tables, writes } = setup(t);
  const created = await call("create", { categoria: "Outro", descricao: "Relato de teste seguro", anonimo: true, lojaId: "LOJA-A", nomeContato: "Never persist this" });
  assert.equal(created.success, true);
  const { protocolo, pin } = created.data;
  assert.match(protocolo, /^DEN-[A-F0-9]{16}$/);
  assert.match(pin, /^\d{6}$/);
  assert.equal(writes.length, 1);
  assert.equal(tables.Denuncias[protocolo].PIN, undefined);
  assert.equal(tables.Denuncias[protocolo].NomeContato, "Anônimo");
  assert.ok(tables.Denuncias[protocolo].PinHash);
  await assert.rejects(call("consult", { protocolo, pin: "wrong" }), /inválido/);
  const result = await call("consult", { protocolo, pin });
  assert.equal(result.data.mensagens.length, 1);
  assert.equal(result.data.mensagens[0].texto, "Relato de teste seguro");
  assert.equal(/PinHash|PinSalt|"pin"|"PIN"/.test(JSON.stringify(result)), false);
  const message = await call("message", { protocolo, pin, texto: "Esclarecimento adicional" });
  assert.equal(message.data.enviada, true);
  assert.equal(tables.DenunciasMensagens[message.data.mensagemId].LojaID, "LOJA-A");
  assert.equal((await call("consult", { protocolo, pin })).data.mensagens.length, 2);
});
test("legacy four-digit PIN is migrated only after verification and removed atomically", async (t) => {
  const { call, tables } = setup(t);
  tables.Denuncias["DEN-123456"] = { DenunciaID: "DEN-123456", PIN: "1234", Categoria: "Outro", LojaID: "A" };
  await assert.rejects(call("consult", { protocolo: "DEN-123456", pin: "9999" }), /inválido/);
  assert.equal(tables.Denuncias["DEN-123456"].PIN, "1234");
  await call("consult", { protocolo: "DEN-123456", pin: "1234" });
  assert.equal(tables.Denuncias["DEN-123456"].PIN, undefined);
  assert.equal(tables.Denuncias["DEN-123456"].PinHash, await pinHash("1234", tables.Denuncias["DEN-123456"].PinSalt, "unit-test-private-pepper-at-least-32-characters"));
});
test("PIN attempts are limited per protocol across multiple source IPs", async (t) => {
  const { call } = setup(t);
  for (let i = 0; i < 5; i++) await assert.rejects(call("consult", { protocolo: "DEN-123456", pin: "0000" }, `192.0.2.${i}`), /inválido/);
  await assert.rejects(call("consult", { protocolo: "DEN-123456", pin: "0000" }, "192.0.2.99"), (error) => error.status === 429);
});
test("failed Firebase commit never returns a created protocol and PIN", async (t) => {
  const { call, tables } = setup(t);
  globalThis.fetch = async () => new Response("", { status: 503 });
  await assert.rejects(call("create", { categoria: "Outro", descricao: "Mensagem de teste" }), (error) => error.status === 502);
  assert.equal(Object.keys(tables.Denuncias).length, 0);
});
