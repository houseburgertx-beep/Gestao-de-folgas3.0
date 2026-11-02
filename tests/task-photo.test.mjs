import assert from "node:assert/strict";
import test from "node:test";
import { createTaskPhotoCache, taskPhotoReference } from "../src/core/task-photo.js";
import { createTasksHandlers } from "../src/core/api-tasks.js";
import { runtime } from "../src/core/runtime.js";

test("foto privada usa arquivo autenticado e legado Drive vira thumbnail compatível", () => {
  const url = "https://drive.google.com/file/d/abcDEF1234567890/view";
  assert.deepEqual(taskPhotoReference({ FOTO_ID: "abcDEF1234567890", FOTO_URL: url, FOTO_PRIVADA: true }),
    { fileId: "abcDEF1234567890", isPrivate: true, publicUrl: "" });
  assert.match(taskPhotoReference({ FOTO_URL: url }).publicUrl, /^https:\/\/drive\.google\.com\/thumbnail\?id=abcDEF1234567890/);
  assert.equal(taskPhotoReference({ FOTO_URL: "javascript:alert(1)" }).publicUrl, "");
});

test("cache de fotos compartilha chamada concorrente e limpa ao mudar usuário", async () => {
  let uid = "owner-a";
  let calls = 0;
  const cache = createTaskPhotoCache({ currentUid: () => uid, load: async () => { calls++; return "data:image/jpeg;base64,AA=="; } });
  await Promise.all([cache.get("file-a"), cache.get("file-a")]);
  assert.equal(calls, 1);
  uid = "owner-b";
  await cache.get("file-a");
  assert.equal(calls, 2);
  uid = "";
  await assert.rejects(cache.get("file-a"), /sessão expirou/);
});

test("cache limita retenção, expira e evita tempestade em falhas", async () => {
  let timestamp = 0;
  let calls = 0;
  const cache = createTaskPhotoCache({ currentUid: () => "owner", now: () => timestamp, maxEntries: 2, ttlMs: 1000,
    load: async (id) => { calls++; if (id === "denied") throw new Error("forbidden"); return id; } });
  await cache.get("a"); await cache.get("b"); await cache.get("c");
  await cache.get("a");
  assert.equal(calls, 4);
  timestamp = 1001;
  await cache.get("a");
  assert.equal(calls, 5);
  await assert.rejects(cache.get("denied"), /forbidden/);
  await assert.rejects(cache.get("denied"), /forbidden/);
  assert.equal(calls, 6);
});

test("troca de conta durante carregamento nunca entrega foto à nova conta", async () => {
  let uid = "owner-a";
  let release;
  const cache = createTaskPhotoCache({ currentUid: () => uid, load: () => new Promise((resolve) => { release = resolve; }) });
  const pending = cache.get("file-a");
  await Promise.resolve();
  uid = "owner-b";
  release("data:image/jpeg;base64,AA==");
  await assert.rejects(pending, /conta conectada mudou/);
});

test("conclusão da tarefa preserva ID privado e sinaliza foto em contingência sem perder imagem", async () => {
  const original = { requireProfile: runtime.requireProfile, getById: runtime.getById, patch: runtime.patch,
    list: runtime.list, upsert: runtime.upsert, create: runtime.create };
  runtime.requireProfile = async () => ({ Nome: "Ana", FuncionarioID: "employee-a", LojaID: "store-a" });
  runtime.getById = async () => ({ LojaID: "store-a", Titulo: "Limpeza" });
  runtime.patch = async (_, __, patch) => patch;
  runtime.list = async () => [];
  runtime.upsert = async (_, row) => row;
  runtime.create = async (_, row) => row;
  try {
    const handler = createTasksHandlers().cozinhaTasksComplete;
    const privateResult = await handler([{ taskId: "task-a", fotoUrl: "https://drive.google.com/file/d/abcDEF1234567890/view",
      fotoId: "abcDEF1234567890", fotoPrivada: true }]);
    assert.equal(privateResult.data.FOTO_ID, "abcDEF1234567890");
    assert.equal(privateResult.data.FOTO_PRIVADA, true);
    const photo = "data:image/jpeg;base64,AA==";
    const fallback = await handler([{ taskId: "task-a", fotoUrl: photo, fotoPendenteDrive: true }]);
    assert.equal(fallback.data.FOTO_URL, photo);
    assert.equal(fallback.data.FOTO_PENDENTE_DRIVE, true);
    assert.equal(fallback.data.FOTO_STORAGE, "Firebase contingência");
    await assert.rejects(handler([{ taskId: "task-a", fotoUrl: "" }]), /foto comprobatória válida/);
    await assert.rejects(handler([{ taskId: "task-a", fotoUrl: photo, fotoPrivada: true }]), /sem identificação/);
  } finally {
    Object.assign(runtime, original);
  }
});
