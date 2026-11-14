import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { runtime } from "../src/core/runtime.js";
import {
  clearDriveFileCache,
  inferMimeTypeFromDataUrl,
  isGoogleDriveUrl,
  parseDriveFileId,
  readPrivateDriveFile,
  uploadOnboardingDocumentToDrive,
  uploadPrivateDocumentToDrive,
} from "../src/core/drive-storage.js";
import { isInlineBase64Asset, migrarAnexosParaGoogleDrive } from "../src/core/drive-migration.js";

function loadGasRuntime({ profile, invite = null, driveFiles = {} }) {
  const code = fs.readFileSync(path.resolve("google-apps-script/Code.gs"), "utf8");
  const filesById = new Map();
  const folderFiles = new Map();
  let seq = 1;

  const makeBlob = (bytes, mimeType, name) => ({
    getBytes: () => bytes,
    getContentType: () => mimeType,
    getDataAsString: () => Buffer.from(bytes).toString("utf8"),
    getName: () => name,
  });

  const wrapFile = (record) => ({
    getId: () => record.id,
    getName: () => record.name,
    getDateCreated: () => new Date("2026-11-14T15:00:00Z"),
    setDescription: (d) => {
      record.description = d;
    },
    getDescription: () => record.description || "",
    setSharing: (acc, perm) => {
      record.access = acc;
      record.permission = perm;
    },
    getBlob: () => makeBlob(record.bytes, record.mimeType, record.name),
  });

  for (const [id, rec] of Object.entries(driveFiles)) {
    filesById.set(id, rec);
  }

  const makeFolder = (folderName) => ({
    getId: () => `folder-${folderName}`,
    getFoldersByName: () => ({ hasNext: () => false }),
    createFolder: (sub) => makeFolder(`${folderName}/${sub}`),
    getFilesByName: (fileName) => {
      const key = `${folderName}/${fileName}`;
      const existing = folderFiles.get(key);
      return existing
        ? { hasNext: () => true, next: () => wrapFile(existing) }
        : { hasNext: () => false };
    },
    createFile: (blob) => {
      const id = `DriveFileId_000${seq++}`;
      const rec = {
        id,
        name: blob.getName(),
        bytes: blob.getBytes(),
        mimeType: blob.getContentType(),
        description: "",
      };
      filesById.set(id, rec);
      folderFiles.set(`${folderName}/${rec.name}`, rec);
      return wrapFile(rec);
    },
  });

  const rootFolder = makeFolder("ROOT");
  const sandbox = {
    CacheService: {
      getScriptCache: () => ({
        get: () => null,
        put: () => {},
        remove: () => {},
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        waitLock: () => {},
        releaseLock: () => {},
      }),
    },
    DriveApp: {
      Access: { PRIVATE: "PRIVATE" },
      Permission: { VIEW: "VIEW" },
      getFolderById: () => rootFolder,
      getFoldersByName: () => ({ hasNext: () => true, next: () => rootFolder }),
      createFolder: () => rootFolder,
      getFileById: (id) => {
        const rec = filesById.get(id);
        if (!rec) throw new Error("Not found");
        return wrapFile(rec);
      },
    },
    UrlFetchApp: {
      fetch: (url) => {
        if (String(url).includes("/onboardingConvites/")) {
          return {
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify(invite),
          };
        }
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify(profile),
        };
      },
    },
    ContentService: {
      MimeType: { JSON: "JSON" },
      createTextOutput: (txt) => ({
        setMimeType: () => ({ getContent: () => txt }),
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      newBlob: (bytes, mimeType, name) => makeBlob(bytes, mimeType, name),
      base64DecodeWebSafe: (str) => Buffer.from(str, "base64url"),
      base64Decode: (str) => Array.from(Buffer.from(str, "base64")),
      base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
      computeDigest: (_alg, bytes) => {
        const crypto = require_crypto();
        return Array.from(crypto.createHash("sha256").update(Buffer.from(bytes)).digest());
      },
      formatDate: () => "2026-11",
    },
  };

  vm.runInNewContext(code, sandbox);
  return { sandbox, filesById };
}

import crypto from "node:crypto";
function require_crypto() {
  return crypto;
}

function fakeJwt(uid) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ sub: uid })).toString("base64url");
  return `${header}.${claims}.sig`;
}

function minimalPdfBase64() {
  const text = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n" + " ".repeat(80);
  return Buffer.from(text, "utf8").toString("base64");
}

test("parseDriveFileId and isGoogleDriveUrl parse all Drive URL formats", () => {
  assert.equal(parseDriveFileId("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view"), "1AbCdEfGhIjKlMnOpQrStUvWxYz");
  assert.equal(parseDriveFileId("https://drive.google.com/uc?export=view&id=1AbCdEfGhIjKlMnOpQrStUvWxYz"), "1AbCdEfGhIjKlMnOpQrStUvWxYz");
  assert.equal(parseDriveFileId("https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz&sz=w1000"), "1AbCdEfGhIjKlMnOpQrStUvWxYz");
  assert.equal(parseDriveFileId("1AbCdEfGhIjKlMnOpQrStUvWxYz"), "1AbCdEfGhIjKlMnOpQrStUvWxYz");
  assert.equal(isGoogleDriveUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view"), true);
  assert.equal(isGoogleDriveUrl("data:application/pdf;base64,JVBERi0x"), false);
  assert.equal(inferMimeTypeFromDataUrl("data:image/jpg;base64,abc"), "image/jpeg");
});

test("Code.gs uploadPrivateDocument & readPrivateFile support private PDFs and employee authorization", () => {
  const { sandbox } = loadGasRuntime({
    profile: {
      UsuarioID: "uid-admin",
      FuncionarioID: "func-admin",
      LojaID: "loja-1",
      Perfil: "Administrador",
      Ativo: true,
    },
  });

  const upRes = JSON.parse(
    sandbox.doPost({
      postData: {
        contents: JSON.stringify({
          action: "uploadPrivateDocument",
          idToken: fakeJwt("uid-admin"),
          category: "holerite",
          employeeId: "func-emp-99",
          storeId: "loja-1",
          fileName: "Holerite Novembro.pdf",
          dataUrl: `data:application/pdf;base64,${minimalPdfBase64()}`,
        }),
      },
    }).getContent(),
  );

  assert.equal(upRes.ok, true);
  assert.equal(upRes.private, true);
  assert.equal(upRes.mimeType, "application/pdf");
  assert.ok(upRes.fileId);

  // Employee who owns employeeId="func-emp-99" can read the private PDF
  const empGas = loadGasRuntime({
    profile: {
      UsuarioID: "uid-emp-99",
      FuncionarioID: "func-emp-99",
      LojaID: "loja-1",
      Perfil: "Funcionário",
      Ativo: true,
    },
    driveFiles: {
      [upRes.fileId]: {
        id: upRes.fileId,
        name: upRes.fileName,
        bytes: Array.from(Buffer.from(minimalPdfBase64(), "base64")),
        mimeType: "application/pdf",
        description: JSON.stringify({
          uid: "uid-admin",
          employeeId: "func-emp-99",
          storeId: "loja-1",
          kind: "document",
        }),
      },
    },
  });

  const readRes = JSON.parse(
    empGas.sandbox.doPost({
      postData: {
        contents: JSON.stringify({
          action: "readPrivateFile",
          idToken: fakeJwt("uid-emp-99"),
          fileId: upRes.fileId,
        }),
      },
    }).getContent(),
  );

  assert.equal(readRes.ok, true);
  assert.ok(readRes.dataUrl.startsWith("data:application/pdf;base64,"));

  // Another unrelated employee cannot read the private PDF
  const otherGas = loadGasRuntime({
    profile: {
      UsuarioID: "uid-other",
      FuncionarioID: "func-other",
      LojaID: "loja-2",
      Perfil: "Funcionário",
      Ativo: true,
    },
    driveFiles: {
      [upRes.fileId]: {
        id: upRes.fileId,
        name: upRes.fileName,
        bytes: Array.from(Buffer.from(minimalPdfBase64(), "base64")),
        mimeType: "application/pdf",
        description: JSON.stringify({
          uid: "uid-admin",
          employeeId: "func-emp-99",
          storeId: "loja-1",
          kind: "document",
        }),
      },
    },
  });

  const denied = JSON.parse(
    otherGas.sandbox.doPost({
      postData: {
        contents: JSON.stringify({
          action: "readPrivateFile",
          idToken: fakeJwt("uid-other"),
          fileId: upRes.fileId,
        }),
      },
    }).getContent(),
  );
  assert.equal(denied.ok, false);
  assert.match(denied.error, /Sem permissão/);
});

test("Code.gs uploadOnboardingDocument allows active inviteToken (TokenID or ConviteID) and blocks finalized invites", () => {
  const { sandbox } = loadGasRuntime({
    profile: null,
    invite: {
      TokenID: "onb_token_real_1234567890",
      Token: "onb_token_real_1234567890",
      LojaID: "loja-1",
      Status: "Aguardando Candidato",
      CadastroValidado: false,
    },
  });

  const upRes = JSON.parse(
    sandbox.doPost({
      postData: {
        contents: JSON.stringify({
          action: "uploadOnboardingDocument",
          inviteToken: "onb_token_real_1234567890",
          docCode: "RG_CNH",
          dataUrl: `data:application/pdf;base64,${minimalPdfBase64()}`,
        }),
      },
    }).getContent(),
  );
  assert.equal(upRes.ok, true);
  assert.equal(upRes.private, true);

  const readOnb = JSON.parse(
    sandbox.doPost({
      postData: {
        contents: JSON.stringify({
          action: "readPrivateFile",
          inviteToken: "onb_token_real_1234567890",
          fileId: upRes.fileId,
        }),
      },
    }).getContent(),
  );
  assert.equal(readOnb.ok, true);
  assert.ok(readOnb.dataUrl.startsWith("data:application/pdf;base64,"));

  const finalizedGas = loadGasRuntime({
    profile: null,
    invite: {
      TokenID: "onb_token_real_1234567890",
      LojaID: "loja-1",
      Status: "Aprovado",
      CadastroValidado: true,
    },
  });
  const blocked = JSON.parse(
    finalizedGas.sandbox.doPost({
      postData: {
        contents: JSON.stringify({
          action: "uploadOnboardingDocument",
          inviteToken: "onb_token_real_1234567890",
          docCode: "RG_CNH",
          dataUrl: `data:application/pdf;base64,${minimalPdfBase64()}`,
        }),
      },
    }).getContent(),
  );
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /já foi finalizado/);
});

test("drive-storage client helpers upload, retry transient 503, and cache private Drive reads", async () => {
  clearDriveFileCache();
  const origAuth = runtime.auth;
  const origFetch = globalThis.fetch;
  let fetchCalls = 0;

  runtime.auth = {
    currentUser: {
      uid: "uid-test-1",
      getIdToken: async () => "fake-firebase-id-token",
    },
  };

  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    const body = JSON.parse(init.body);
    if (body.action === "uploadPrivateDocument" && fetchCalls === 1) {
      return new Response("Service busy", { status: 503 });
    }
    if (body.action === "uploadPrivateDocument") {
      return new Response(
        JSON.stringify({
          ok: true,
          fileId: "1DriveTestFileId_12345",
          url: "https://drive.google.com/file/d/1DriveTestFileId_12345/view",
          fileName: "atestado.pdf",
          mimeType: "application/pdf",
          bytes: 1200,
          sha256: "abc123",
        }),
        { status: 200 },
      );
    }
    if (body.action === "readPrivateFile") {
      return new Response(
        JSON.stringify({
          ok: true,
          dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
          mimeType: "application/pdf",
          fileName: "atestado.pdf",
          bytes: 1200,
        }),
        { status: 200 },
      );
    }
    if (body.action === "uploadOnboardingDocument") {
      return new Response(
        JSON.stringify({
          ok: true,
          fileId: "1DriveOnboardingId_99999",
          url: "https://drive.google.com/file/d/1DriveOnboardingId_99999/view",
          fileName: "rg.pdf",
          mimeType: "application/pdf",
          bytes: 900,
          sha256: "def456",
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 400 });
  };

  try {
    const uploaded = await uploadPrivateDocumentToDrive({
      dataUrl: `data:application/pdf;base64,${minimalPdfBase64()}`,
      category: "atestado",
      employeeId: "func-1",
      storeId: "loja-1",
      fileName: "atestado.pdf",
    });
    assert.equal(uploaded.fileId, "1DriveTestFileId_12345");
    assert.equal(uploaded.storage, "Google Drive");
    assert.equal(fetchCalls, 2); // 1 transient 503 + 1 retry success

    const read1 = await readPrivateDriveFile(uploaded.url);
    const read2 = await readPrivateDriveFile(uploaded.fileId);
    assert.equal(read1.dataUrl, "data:application/pdf;base64,JVBERi0xLjQK");
    assert.equal(read2.dataUrl, read1.dataUrl);
    assert.equal(fetchCalls, 3); // Cached second read

    runtime.auth = null;
    const onb = await uploadOnboardingDocumentToDrive({
      inviteToken: "convite_token_1234567890",
      dataUrl: `data:application/pdf;base64,${minimalPdfBase64()}`,
      docCode: "RG_CNH",
      fileName: "rg.pdf",
    });
    assert.equal(onb.fileId, "1DriveOnboardingId_99999");
  } finally {
    runtime.auth = origAuth;
    globalThis.fetch = origFetch;
    clearDriveFileCache();
  }
});

test("migrarAnexosParaGoogleDrive offloads Base64 payloads across tables and tolerates immutable signatures", async () => {
  clearDriveFileCache();
  const origAuth = runtime.auth;
  const origFetch = globalThis.fetch;
  const origRequireProfile = runtime.requireProfile;
  const origList = runtime.list;
  const origUpdate = runtime.update;
  const origReadPath = runtime.readPath;
  const origPatchPath = runtime.patchPath;

  const pdfDataUrl = `data:application/pdf;base64,${minimalPdfBase64()}`;
  const updates = [];
  const pathPatches = [];
  let seq = 1;

  const tables = {
    Documentos: [
      {
        DocumentoID: "doc-1",
        FuncionarioID: "func-1",
        LojaID: "loja-1",
        Tipo: "Holerite",
        Titulo: "Holerite Nov",
        ArquivoOriginalBase64: pdfDataUrl,
        ArquivoFinalBase64: pdfDataUrl,
      },
    ],
    Funcionarios: [
      {
        FuncionarioID: "func-1",
        LojaID: "loja-1",
        OnboardingToken: "onb_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
        DossieDocumentos: {
          RG_CNH: {
            codigo: "RG_CNH",
            arquivoUrl: pdfDataUrl,
            arquivos: [{ arquivoUrl: pdfDataUrl, nomeArquivo: "rg.pdf" }],
          },
        },
      },
    ],
    FolhaPagamentos: [
      {
        PagamentoID: "pag-1",
        FuncionarioID: "func-1",
        LojaID: "loja-1",
        ComprovanteURL: pdfDataUrl,
        ComprovanteNome: "pix.pdf",
      },
    ],
    JustificativasPonto: [
      {
        JustificativaPontoID: "just-1",
        FuncionarioID: "func-1",
        LojaID: "loja-1",
        ArquivoURL: pdfDataUrl,
      },
    ],
    Tarefas: [
      {
        TarefaID: "task-1",
        LojaID: "loja-1",
        FuncionarioID: "func-1",
        FOTO_URL: "data:image/jpeg;base64," + "A".repeat(400),
      },
    ],
    DocumentosAssinaturas: [
      {
        AssinaturaID: "ASS_1",
        DocumentoID: "doc-1",
        FuncionarioID: "func-1",
        LojaID: "loja-1",
        ArquivoFinalBase64: pdfDataUrl,
      },
    ],
  };

  runtime.auth = {
    currentUser: {
      uid: "uid-admin-1",
      getIdToken: async () => "fake-admin-token",
    },
  };
  runtime.requireProfile = async () => ({
    UsuarioID: "uid-admin-1",
    Perfil: "Administrador",
    Ativo: true,
  });
  runtime.list = async (table) => tables[table] || [];
  runtime.update = async (table, id, patch) => {
    if (table === "DocumentosAssinaturas") {
      throw new Error("PERMISSION_DENIED");
    }
    updates.push({ table, id, patch });
    return patch;
  };
  runtime.readPath = async (p) => {
    if (p === "onboardingConvites/onb_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456") {
      return {
        TokenID: "onb_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
        FuncionarioID: "func-1",
        LojaID: "loja-1",
        Submissao: {
          Documentos: {
            RG_CNH: {
              codigo: "RG_CNH",
              arquivoUrl: pdfDataUrl,
              arquivos: [{ arquivoUrl: pdfDataUrl, nomeArquivo: "frente.pdf" }],
            },
          },
        },
      };
    }
    return null;
  };
  runtime.patchPath = async (p, patch) => {
    pathPatches.push({ p, patch });
  };
  globalThis.fetch = async () => {
    const id = `1MigratedDriveId_000${seq++}`;
    return new Response(
      JSON.stringify({
        ok: true,
        fileId: id,
        url: `https://drive.google.com/file/d/${id}/view`,
        mimeType: "application/pdf",
        bytes: 512,
        sha256: "a".repeat(64),
      }),
      { status: 200 },
    );
  };

  try {
    assert.equal(isInlineBase64Asset(pdfDataUrl), true);
    assert.equal(isInlineBase64Asset("https://drive.google.com/file/d/123/view"), false);

    const res = await migrarAnexosParaGoogleDrive();
    assert.equal(res.byTable.Documentos, 1);
    assert.equal(res.byTable.Funcionarios, 1);
    assert.equal(res.byTable.onboardingConvites, 1);
    assert.equal(res.byTable.FolhaPagamentos, 1);
    assert.equal(res.byTable.JustificativasPonto, 1);
    assert.equal(res.byTable.Tarefas, 1);
    assert.equal(res.protectedSignatureRecords, 1);
    assert.equal(res.errors.length, 0);

    const docPatch = updates.find((u) => u.table === "Documentos").patch;
    assert.equal(docPatch.ArquivoOriginalBase64, "");
    assert.equal(docPatch.ArquivoFinalBase64, "");
    assert.ok(docPatch.ArquivoDriveFileID);
    assert.ok(docPatch.ArquivoFinalDriveFileID);
    assert.equal(pathPatches.length, 1);
  } finally {
    runtime.auth = origAuth;
    globalThis.fetch = origFetch;
    runtime.requireProfile = origRequireProfile;
    runtime.list = origList;
    runtime.update = origUpdate;
    runtime.readPath = origReadPath;
    runtime.patchPath = origPatchPath;
    clearDriveFileCache();
  }
});
