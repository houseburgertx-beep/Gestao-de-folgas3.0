import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import {
  completeClockAttempt,
  createClockAttemptStore,
  withClockPunchLock,
  validateClockSelfie,
  clockAttemptStore,
} from "../src/core/clock-punch-recovery.js";
import { createClockHandlers, uploadClockSelfieToDrive } from "../src/core/api-clock.js";
import { runtime } from "../src/core/runtime.js";

const image = "data:image/jpeg;base64," + Buffer.alloc(1100, 1).toString("base64");
const attempt = () => ({
  requestId: "12345678-abcd-1234-abcd-123456789012", employeeId: "employee-1",
  createdAt: "2026-11-02T12:00:00.000Z", day: "2026-11-02", type: "ENTRADA",
  selfieDataUrl: image, record: { DataHora: "2026-11-02T12:00:00.000Z" },
});

test("ponto preserva foto e horário quando upload falha; reenvio confirma e limpa", async () => {
  const store = createClockAttemptStore();
  const entry = attempt();
  let writes = 0;
  await assert.rejects(completeClockAttempt({ uid: "owner", attempt: entry, store,
    upload: async () => { throw new Error("offline"); }, save: async () => { writes++; } }), /offline/);
  assert.equal(writes, 0);
  assert.equal((await store.get("owner", entry.requestId)).selfieDataUrl, image);
  const saved = await completeClockAttempt({ uid: "owner", attempt: { ...entry, createdAt: "2026-11-02T15:00:00Z" }, store,
    upload: async () => ({ fileId: "real-drive-file" }),
    save: async (pending) => { writes++; return pending.record; } });
  assert.equal(saved.DataHora, entry.record.DataHora);
  assert.equal(writes, 1);
  assert.equal(await store.get("owner", entry.requestId), null);
});

test("falha no banco preserva recibo; repetir não envia segunda foto", async () => {
  const store = createClockAttemptStore();
  const entry = attempt();
  let uploads = 0;
  const upload = async () => { uploads++; return { fileId: "real-drive-file" }; };
  await assert.rejects(completeClockAttempt({ uid: "owner", attempt: entry, store, upload,
    save: async () => { throw new Error("database offline"); } }), /database offline/);
  const pending = await store.get("owner", entry.requestId);
  assert.equal(pending.selfieDataUrl, undefined);
  assert.equal(pending.selfie.fileId, "real-drive-file");
  await completeClockAttempt({ uid: "owner", attempt: entry, store, upload, save: async (row) => row.record });
  assert.equal(uploads, 1);
});

test("recuperação é isolada por conta e recusa foto/recibo inválido", async () => {
  const store = createClockAttemptStore();
  const entry = attempt();
  await store.put("owner", entry);
  assert.deepEqual(await store.list("other-user"), []);
  assert.equal(await store.get("other-user", entry.requestId), null);
  await assert.rejects(completeClockAttempt({ uid: "owner", attempt: { ...entry, employeeId: "other-employee" }, store,
    upload: async () => {}, save: async () => {} }), /outro funcionário/);
  assert.throws(() => validateClockSelfie("CONTINGENCIA"), /Capture/);
  assert.throws(() => validateClockSelfie("data:image/jpeg;base64," + "A".repeat(950000)), /grande/);
  await assert.rejects(completeClockAttempt({ uid: "owner", attempt: entry, store,
    upload: async () => ({}), save: async () => { throw new Error("must not save"); } }), /não confirmou/);
});

test("pontos concorrentes do mesmo usuário são serializados sem bloquear outro usuário", async () => {
  const events = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const a = withClockPunchLock("owner", async () => { events.push("a-start"); await gate; events.push("a-end"); });
  const b = withClockPunchLock("owner", async () => { events.push("b"); });
  await withClockPunchLock("other", async () => { events.push("other"); });
  assert.ok(!events.includes("b"));
  release();
  await Promise.all([a, b]);
  assert.ok(events.indexOf("a-end") < events.indexOf("b"));
});

test("upload repete HTTP transitório e resposta inválida, mas recusa erro de autorização", async () => {
  const originalFetch = globalThis.fetch;
  const originalAuth = runtime.auth;
  runtime.auth = { currentUser: { uid: "upload-owner", getIdToken: async () => "test-token" } };
  try {
    for (const first of [new Response("busy", { status: 503 }), new Response("not-json", { status: 200 })]) {
      let calls = 0;
      const ids = [];
      globalThis.fetch = async (_, options) => {
        ids.push(JSON.parse(options.body).requestId);
        return ++calls === 1 ? first : new Response(JSON.stringify({ ok: true, fileId: "real-file" }));
      };
      const result = await uploadClockSelfieToDrive({ ...attempt(), selfieDataUrl: image });
      assert.equal(result.fileId, "real-file");
      assert.equal(calls, 2);
      assert.equal(ids[0], ids[1]);
    }
    let deniedCalls = 0;
    globalThis.fetch = async () => { deniedCalls++; return new Response(JSON.stringify({ ok: false, error: "Sessão expirada" }), { status: 403 }); };
    await assert.rejects(uploadClockSelfieToDrive({ ...attempt(), selfieDataUrl: image }), /Sessão expirada/);
    assert.equal(deniedCalls, 1);
  } finally {
    runtime.auth = originalAuth;
    globalThis.fetch = originalFetch;
  }
});

test("handler recupera tentativa real com foto confirmada, horário original e uma única gravação", async () => {
  const names = ["auth", "requireProfile", "getById", "findOne", "list", "listPeriods", "create", "getByIdFromServer", "requestServerRecord", "createClockRecord", "invalidateTableCache", "invoke"];
  const original = Object.fromEntries(names.map((name) => [name, runtime[name]]));
  const originalFetch = globalThis.fetch;
  const entry = attempt();
  entry.createdAt = new Date(Date.now() - 180000).toISOString();
  const records = [];
  runtime.auth = { currentUser: { uid: "recovery-owner", getIdToken: async () => "test-token" } };
  runtime.requireProfile = async () => ({ UsuarioID: "recovery-owner", FuncionarioID: "employee-1", LojaID: "store-1", Email: "ana@example.test" });
  runtime.getById = async (table, id) => table === "Funcionarios"
    ? { FuncionarioID: "employee-1", LojaID: "store-1", Nome: "Ana", Ativo: true }
    : records.find((row) => row.RegistroPontoID === id) || null;
  runtime.getByIdFromServer = async (_, id) => records.find((row) => row.RegistroPontoID === id) || null;
  runtime.requestServerRecord = async (_, id) => ({ data: records.find((row) => row.RegistroPontoID === id) || null, etag: '"empty-version"' });
  runtime.createClockRecord = async (row, options) => {
    assert.equal(options.expectedAbsentEtag, '"empty-version"');
    assert.equal(options.ownerUid, "recovery-owner");
    records.push(row); return row;
  };
  runtime.findOne = async () => ({ Latitude: -12.97, Longitude: -38.5, RaioMetros: 150, Ativo: true });
  runtime.list = async () => [];
  runtime.listPeriods = async () => records;
  runtime.create = async (table, row) => { if (table === "RegistrosPonto") records.push(row); return row; };
  runtime.invalidateTableCache = () => {};
  runtime.invoke = async () => {};
  const payload = { requestId: entry.requestId, capturedAt: entry.createdAt, expectedAction: "ENTRADA",
    latitude: -12.97, longitude: -38.5, accuracy: 20, selfieDataUrl: image };
  try {
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    const handler = createClockHandlers().registerTimeClockPunch;
    await assert.rejects(handler([payload]), /Não foi possível enviar/);
    assert.equal(records.length, 0);
    assert.equal((await clockAttemptStore.get("recovery-owner", entry.requestId)).selfieDataUrl, image);
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, fileId: "confirmed-file", fileUrl: "https://drive.google.com/file/d/confirmed-file/view" }));
    const recovered = await handler([{ ...payload, capturedAt: new Date().toISOString(), selfieDataUrl: "" }]);
    assert.equal(recovered.data.DataHora, entry.createdAt);
    assert.equal(recovered.data.SelfieDriveFileID, "confirmed-file");
    assert.equal(recovered.data.SelfieSincronizada, true);
    assert.equal(records.length, 1);
    assert.equal(await clockAttemptStore.get("recovery-owner", entry.requestId), null);
    await handler([payload]);
    assert.equal(records.length, 1);
  } finally {
    await clockAttemptStore.remove("recovery-owner", entry.requestId);
    Object.assign(runtime, original);
    globalThis.fetch = originalFetch;
  }
});

async function driveService(overrides = {}) {
  const source = await readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8");
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (body) => ({ body, setMimeType() { return this; } }) },
    ...overrides,
  });
  vm.runInContext(source, context);
  return context;
}

test("serviço Drive exige autenticação também em fotos de tarefas", async () => {
  let touchedDrive = false;
  const service = await driveService({ DriveApp: { getFoldersByName() { touchedDrive = true; throw new Error("must not access"); } } });
  const result = JSON.parse(service.doPost({ postData: { contents: JSON.stringify({ action: "driveUpload", base64: "A".repeat(2000) }) } }).body);
  assert.equal(result.ok, false);
  assert.match(result.error, /Sessão ausente/);
  assert.equal(touchedDrive, false);
});

test("Drive get-or-create sob lock mantém foto privada e reutiliza arquivo", async () => {
  let created = 0;
  let locked = false;
  let exists = false;
  const file = { setDescription(value) { assert.equal(locked, true); this.description = value; },
    setSharing(access) { assert.equal(access, "private"); assert.equal(locked, true); } };
  const destination = { getFilesByName() { assert.equal(locked, true); return { hasNext: () => exists, next: () => file }; },
    createFile() { assert.equal(locked, true); created++; exists = true; return file; } };
  const service = await driveService({
    DriveApp: { Access: { PRIVATE: "private" }, Permission: { VIEW: "view" } },
    Utilities: { newBlob: () => ({}) },
    LockService: { getScriptLock: () => ({ tryLock: () => { locked = true; return true; }, releaseLock: () => { locked = false; } }) },
  });
  const metadata = { uid: "owner", employeeId: "employee", storeId: "store", kind: "clock" };
  service.privateImageFile_(destination, "stable-request.jpg", [], "image/jpeg", metadata);
  service.privateImageFile_(destination, "stable-request.jpg", [], "image/jpeg", metadata);
  assert.equal(created, 1);
  assert.equal(locked, false);
  assert.equal(JSON.parse(file.description).uid, "owner");
});

test("preview Drive recusa outra conta/loja e permite dono ou gestor da loja", async () => {
  const service = await driveService({
    DriveApp: { getFileById: () => ({
      getDescription: () => JSON.stringify({ uid: "owner", employeeId: "employee", storeId: "store-a" }),
      getBlob: () => ({ getContentType: () => "image/jpeg", getBytes: () => [1, 2, 3] }), getName: () => "photo.jpg",
    }) }, Utilities: { base64Encode: () => "AQID" },
  });
  assert.throws(() => service.readPrivateImage_("other", { Perfil: "Colaborador", LojaID: "store-a" }, "file123456789"), /Sem permissão/);
  assert.throws(() => service.readPrivateImage_("manager", { Perfil: "Gerente", LojaID: "store-b" }, "file123456789"), /Sem permissão/);
  assert.equal(service.readPrivateImage_("owner", {}, "file123456789").dataUrl, "data:image/jpeg;base64,AQID");
  assert.equal(service.readPrivateImage_("manager", { Perfil: "Gerente", LojaID: "store-a" }, "file123456789").ok, true);
});


test("manifesto mantém endpoint HTTP com autorização Firebase em vez de exigir sessão Google", async () => {
  const manifest = JSON.parse(await readFile(new URL("../google-apps-script/appsscript.json", import.meta.url), "utf8"));
  assert.equal(manifest.timeZone, "America/Bahia");
  assert.equal(manifest.webapp.executeAs, "USER_DEPLOYING");
  assert.equal(manifest.webapp.access, "ANYONE_ANONYMOUS");
});

test('espera de outra tentativa tem prazo e callback atrasado não executa um segundo ponto',async()=>{
 let release;let secondCalls=0;
 const first=withClockPunchLock('deadline-owner',()=>new Promise(resolve=>{release=resolve;}));
 await new Promise(resolve=>setTimeout(resolve,0));
 const second=withClockPunchLock('deadline-owner',()=>{secondCalls++;},{waitMs:5});
 await assert.rejects(second,/Outra tentativa/);release();await first;await new Promise(resolve=>setTimeout(resolve,0));assert.equal(secondCalls,0);
});
