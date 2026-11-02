import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { relayNotification } from "../src/notification-relay.js";
test("notice relay uses persisted data, confines creator to own store and deduplicates recipients", async (t) => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../migrations/0001_push.sql", import.meta.url), "utf8"));
  t.after(() => sql.close());
  const env = { DB: { prepare(query) { const stmt = sql.prepare(query); return { bind(...args) { return { run: async () => ({ meta: { changes: stmt.run(...args).changes } }) }; } }; } } };
  const sent = [];
  const args = { env, uid: "creator", profile: { Perfil: "Colaborador", LojaID: "A", FuncionarioID: "employee-a" }, notice: { NotificacaoID: "notice-1", CriadoPorUID: "creator", LojaID: "A", DestinatarioID: "employee-a", Assunto: "Folga", Mensagem: "Mensagem persistida", Tipo: "Folga" }, employees: [{ FuncionarioID: "employee-a", Telefone: "71988887777", LojaID: "A" }, { FuncionarioID: "employee-b", Telefone: "11988887777", LojaID: "B" }], access: [], send: async (_env, data) => { sent.push(data); return { success: true }; }, now: 1800000000000 };
  assert.equal((await relayNotification(args)).body.sent, 1);
  assert.equal(sent[0].phone, "5571988887777");
  assert.ok(sent[0].text.includes("Consulte os detalhes com segurança"));
  assert.equal((await relayNotification(args)).body.sent, 0);
  assert.equal(sent.length, 1);
  assert.equal((await relayNotification({ ...args, uid: "other" })).status, 403);
  assert.equal((await relayNotification({ ...args, profile: { Perfil: "Gerente", LojaID: "B" } })).status, 403);
  assert.equal((await relayNotification({ ...args, notice: { ...args.notice, NotificacaoID: "notice-2", DestinatarioID: "employee-b" } })).status, 403);
});

test("relay verifica ajuste, espelho, atestado e troca vinculados sem autorizar outra loja", async () => {
  const { verifyCreatorNotificationEvent } = await import("../src/notification-relay.js");
  const profile = { FuncionarioID: "employee", LojaID: "store" };
  for (const [type, table] of [["Ponto", "AjustesPonto"], ["Ponto", "Documentos"], ["Atestado", "Folgas"], ["Troca", "TrocasFolga"]]) {
    const notice = { Tipo: type, RegistoRelacionadoID: "event" };
    const read = async (candidate) => candidate === table ? { FuncionarioID: "employee", LojaID: "store" } : null;
    assert.equal(await verifyCreatorNotificationEvent({ notice, profile, read }), true);
    assert.equal(await verifyCreatorNotificationEvent({ notice, profile: { ...profile, LojaID: "other" }, read }), false);
    assert.equal(await verifyCreatorNotificationEvent({ notice, profile: { ...profile, FuncionarioID: "other" }, read }), false);
  }
});
