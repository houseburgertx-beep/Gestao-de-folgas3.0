import test from "node:test";
import assert from "node:assert/strict";
import { FirebaseRuntime } from "../src/core/runtime.js";

const profile = { Perfil: "Funcionário", FuncionarioID: "employee", LojaID: "store" };
test("leituras simultâneas compartilham requisição e retornam cópias independentes", async () => {
  const runtime = new FirebaseRuntime();
  let release;
  let calls = 0;
  runtime.fetchScopedRows_ = async () => { calls++; return new Promise((resolve) => { release = resolve; }); };
  const a = runtime.scopedRows("Folgas", profile);
  const b = runtime.scopedRows("Folgas", profile);
  assert.equal(calls, 1);
  release([{ FolgaID: "original" }]);
  const [first, second] = await Promise.all([a, b]);
  first[0].FolgaID = "changed";
  assert.equal(second[0].FolgaID, "original");
  assert.equal((await runtime.scopedRows("Folgas", profile))[0].FolgaID, "original");
});
test("invalidação durante leitura impede resposta antiga de repovoar cache", async () => {
  const runtime = new FirebaseRuntime();
  let release;
  runtime.fetchScopedRows_ = async () => new Promise((resolve) => { release = resolve; });
  const stale = runtime.scopedRows("Folgas", profile);
  runtime.invalidateTableCache("Folgas");
  release([{ FolgaID: "stale" }]);
  await stale;
  runtime.fetchScopedRows_ = async () => [{ FolgaID: "fresh" }];
  assert.equal((await runtime.scopedRows("Folgas", profile))[0].FolgaID, "fresh");
});
test("troca de UID não reutiliza cache de outro usuário com mesmo papel e loja", async () => {
  const runtime = new FirebaseRuntime();
  runtime.auth = { currentUser: { uid: "one" } };
  let calls = 0;
  runtime.fetchScopedRows_ = async () => [{ owner: ++calls }];
  assert.equal((await runtime.scopedRows("Folgas", profile))[0].owner, 1);
  runtime.auth.currentUser = { uid: "two" };
  assert.equal((await runtime.scopedRows("Folgas", profile))[0].owner, 2);
});
