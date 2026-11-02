import test from "node:test";
import assert from "node:assert/strict";
import { createNotification } from "../src/core/api-base.js";
import { runtime } from "../src/core/runtime.js";
test("notificações do mesmo evento não sobrescrevem destinatários ou decisões diferentes", async () => {
  const original = { upsert: runtime.upsert, auth: runtime.auth };
  runtime.auth = null;
  runtime.upsert = async (_table, record) => record;
  const common = { subject: "Atualização", message: "Confira no app", relatedId: "same-event", type: "Troca", storeId: "store" };
  try {
    const one = await createNotification({ ...common, employeeId: "one" });
    const two = await createNotification({ ...common, employeeId: "two" });
    assert.notEqual(one.NotificacaoID, two.NotificacaoID);
    assert.equal((await createNotification({ ...common, employeeId: "one" })).NotificacaoID, one.NotificacaoID);
    assert.notEqual((await createNotification({ ...common, employeeId: "one", type: "Folga" })).NotificacaoID, one.NotificacaoID);
    await assert.rejects(createNotification({}), /assunto e mensagem/);
  } finally { runtime.upsert = original.upsert; runtime.auth = original.auth; }
});
