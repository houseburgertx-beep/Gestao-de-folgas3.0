import assert from "node:assert/strict";
import test from "node:test";
import { uploadClockSelfieToDrive, loadPrivateDriveImage, nextClockActionAfterSave } from "../src/core/api-clock.js";
import { clockAttemptStore, createClockAttemptStore, saveClockDraft, listClockDrafts, removeClockDraft } from "../src/core/clock-punch-recovery.js";
import { runtime } from "../src/core/runtime.js";

const image = "data:image/jpeg;base64," + Buffer.alloc(1100, 1).toString("base64");
const payload = () => ({ requestId: "12345678-abcd-1234-abcd-123456789012", day: "2026-11-03", type: "ENTRADA", selfieDataUrl: image });

test("upload renova token só após 401; falha transitória mantém token em cache", async () => {
  const originalAuth = runtime.auth;
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 503]) {
      const refreshes = [];
      const requests = [];
      runtime.auth = { currentUser: { uid: "owner", getIdToken: async (force) => { refreshes.push(force); return force ? "renewed" : "cached"; } } };
      globalThis.fetch = async (_, options) => {
        requests.push(JSON.parse(options.body));
        return requests.length === 1
          ? new Response(JSON.stringify({ ok: false, error: "temporarily unavailable" }), { status })
          : new Response(JSON.stringify({ ok: true, fileId: "confirmed-file" }));
      };
      assert.equal((await uploadClockSelfieToDrive(payload())).fileId, "confirmed-file");
      assert.deepEqual(refreshes, [false, status === 401]);
      assert.equal(requests[0].requestId, requests[1].requestId);
      assert.equal(requests[0].selfieDataUrl, requests[1].selfieDataUrl);
    }
  } finally { runtime.auth = originalAuth; globalThis.fetch = originalFetch; }
});

test("troca de conta durante token impede envio da selfie com a sessão anterior", async () => {
  const originalAuth = runtime.auth;
  const originalFetch = globalThis.fetch;
  let sent = false;
  runtime.auth = { currentUser: { uid: "owner-a", getIdToken: async () => {
    runtime.auth.currentUser = { uid: "owner-b" };
    return "old-token";
  } } };
  globalThis.fetch = async () => { sent = true; throw new Error("must not fetch"); };
  try {
    await assert.rejects(uploadClockSelfieToDrive(payload()), /conta conectada mudou/);
    assert.equal(sent, false);
  } finally { runtime.auth = originalAuth; globalThis.fetch = originalFetch; }
});

test("token pendurado tem prazo e nunca inicia upload atrasado após timeout", async () => {
  const originalAuth = runtime.auth;
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  let release;
  let sent = 0;
  const token = new Promise((resolve) => { release = resolve; });
  runtime.auth = { currentUser: { uid: "owner", getIdToken: () => token } };
  globalThis.fetch = async () => { sent++; return new Response("{}"); };
  globalThis.setTimeout = (callback, delay, ...args) => originalTimeout(callback, [20000, 25000].includes(delay) ? 5 : delay, ...args);
  try {
    await assert.rejects(uploadClockSelfieToDrive(payload()), { code: "clock/request-timeout" });
    release("late-token");
    await new Promise((resolve) => originalTimeout(resolve, 1));
    assert.equal(sent, 0);
  } finally {
    runtime.auth = originalAuth;
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout;
  }
});

test("preview privado não entrega foto se a sessão mudar durante leitura da resposta", async () => {
  const originalAuth = runtime.auth;
  const originalFetch = globalThis.fetch;
  const originalProfile = runtime.requireProfile;
  runtime.requireProfile = async () => ({});
  runtime.auth = { currentUser: { uid: "owner-a", getIdToken: async () => "token-a" } };
  globalThis.fetch = async () => ({ ok: true, json: async () => {
    runtime.auth.currentUser = { uid: "owner-b" };
    return { ok: true, dataUrl: image };
  } });
  try {
    await assert.rejects(loadPrivateDriveImage("file1234567890"), /conta conectada mudou/);
  } finally { runtime.auth = originalAuth; runtime.requireProfile = originalProfile; globalThis.fetch = originalFetch; }
});

test("recuperar saída da madrugada não encerra nem avança a jornada de hoje", () => {
  const previousEntry = { RegistroPontoID: "entry-yesterday", RequestID: "entry-yesterday", FuncionarioID: "employee", Data: "2026-11-02", DataHora: "2026-11-02T22:00:00Z", TipoMarcacao: "ENTRADA" };
  const recoveredExit = { RegistroPontoID: "exit-yesterday", RequestID: "exit-yesterday", FuncionarioID: "employee", Data: "2026-11-02", DataHora: "2026-11-03T02:00:00Z", TipoMarcacao: "SAIDA_FINAL" };
  const currentEntry = { RegistroPontoID: "entry-today", RequestID: "entry-today", FuncionarioID: "employee", Data: "2026-11-03", DataHora: "2026-11-03T08:00:00Z", TipoMarcacao: "ENTRADA" };
  const now = new Date("2026-11-03T09:00:00Z");
  assert.equal(nextClockActionAfterSave([previousEntry], [], "employee", recoveredExit, now), "ENTRADA");
  assert.equal(nextClockActionAfterSave([previousEntry, currentEntry], [], "employee", recoveredExit, now), "SAIDA_INTERVALO");
  assert.equal(nextClockActionAfterSave([previousEntry, recoveredExit, currentEntry], [], "employee", recoveredExit, now), "SAIDA_INTERVALO");
});

test("rascunho preserva primeira captura e exclui tokens/metadata do armazenamento", async () => {
  const uid = "draft-resilience-owner";
  const requestId = payload().requestId;
  try {
    await saveClockDraft(uid, { requestId, capturedAt: "2026-11-03T12:00:00Z", idToken: "never-persist", payload: {
      ...payload(), idToken: "never-persist", sessionToken: "never-persist", latitude: -12, longitude: -38,
      accuracy: 20, locationTimestamp: 123456, expectedAction: "ENTRADA",
    } });
    await saveClockDraft(uid, { requestId, capturedAt: "2026-11-03T12:05:00Z", payload: { ...payload(), selfieDataUrl: image + "A" } });
    const [draft] = await listClockDrafts(uid);
    assert.equal(draft.capturedAt, "2026-11-03T12:00:00.000Z");
    assert.equal(draft.payload.selfieDataUrl, image);
    assert.equal(draft.payload.locationTimestamp, 123456);
    assert.equal(draft.payload.idToken, undefined);
    assert.equal(draft.payload.sessionToken, undefined);
    assert.equal(draft.idToken, undefined);
    assert.deepEqual(await listClockDrafts("another-owner"), []);
  } finally { await removeClockDraft(uid, requestId); }
});

test("IndexedDB que não abre ou não conclui transação retorna erro com prazo", async () => {
  const unopened = createClockAttemptStore({ open: () => ({}) }, { timeoutMs: 5 });
  await assert.rejects(unopened.list("owner"), /armazenamento do ponto demorou/);
  let aborted = false;
  const db = { close() {}, transaction() {
    const tx = { objectStore: () => ({ index: () => ({ getAll: () => ({}) }) }), abort() { aborted = true; tx.onabort?.(); } };
    return tx;
  } };
  const fake = { open: () => {
    const request = { result: db };
    queueMicrotask(() => request.onsuccess());
    return request;
  } };
  const stalled = createClockAttemptStore(fake, { timeoutMs: 5 });
  await assert.rejects(stalled.list("owner"), /armazenamento do ponto demorou/);
  assert.equal(aborted, true);
});

test("IndexedDB consulta o índice UID sem trazer fotos de outras contas", async () => {
  const queried = [];
  const row = { uid: "owner-a", key: "owner-a:request", attempt: { requestId: "request", createdAt: "2026-11-03" } };
  const db = { close() {}, transaction() {
    const tx = { objectStore: () => ({
      getAll() { throw new Error("must not read every user's photos"); },
      index(name) {
        assert.equal(name, "uid");
        return { getAll(uid) {
          queried.push(uid);
          const request = { result: uid === row.uid ? [row] : [] };
          queueMicrotask(() => tx.oncomplete());
          return request;
        } };
      },
    }) };
    return tx;
  } };
  const fake = { open: (_, version) => {
    assert.equal(version, 2);
    const request = { result: db };
    queueMicrotask(() => request.onsuccess());
    return request;
  } };
  const store = createClockAttemptStore(fake);
  assert.equal((await store.list("owner-a"))[0].requestId, "request");
  assert.deepEqual(await store.list("owner-b"), []);
  assert.deepEqual(queried, ["owner-a", "owner-b"]);
  assert.equal((await clockAttemptStore.list("not-a-real-owner")).length, 0);
});

test('captura é preservada antes de haver GPS e renovar localização não troca foto nem horário',async()=>{
 const {refreshClockDraftLocation,markClockDraftLocationIssue}=await import('../src/core/clock-punch-recovery.js');
 const uid='gps-recovery-owner',requestId='12345678-abcd-1234-abcd-123456789013';const capturedAt='2026-11-04T12:00:00Z';
 const first=await saveClockDraft(uid,{requestId,capturedAt,payload:{selfieDataUrl:image,expectedAction:'ENTRADA',requestId,capturedAt}});
 assert.equal(first.requiresLocationRefresh,true);assert.equal(first.payload.selfieDataUrl,image);
 const refreshed=await refreshClockDraftLocation(uid,requestId,{timestamp:Date.now(),coords:{latitude:-17.5,longitude:-39.7,accuracy:20}});
 assert.equal(refreshed.requiresLocationRefresh,false);assert.equal(refreshed.capturedAt,new Date(capturedAt).toISOString());assert.equal(refreshed.payload.selfieDataUrl,image);assert.equal(refreshed.originalRequestId,requestId);
 await markClockDraftLocationIssue(uid,requestId);assert.equal((await listClockDrafts(uid)).find(r=>r.requestId===requestId).requiresLocationRefresh,true);
 assert.equal((await listClockDrafts('other-owner')).some(r=>r.requestId===requestId),false);
 await removeClockDraft(uid,requestId);
});
