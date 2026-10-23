import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/core/api.js";
import { runtime } from "../src/core/runtime.js";
import { timeOffBalanceUnits } from "../src/core/api-base.js";
import { parseDriveUrl } from "../src/documents.js";

test("Atestado Médico: envio, preservação de saldo de folgas e abono automático de faltas pelo gestor", async () => {
  const storeId = "loja-teste-atestado";
  const employeeId = "func-atestado-1";
  const managerId = "gerente-atestado-1";

  // Armazenamento em memória para o teste
  const tables = new Map();
  const getTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };

  const originalMethods = {
    getById: runtime.getById,
    list: runtime.list,
    upsert: runtime.upsert,
    patch: runtime.patch,
    requireProfile: runtime.requireProfile,
    resolveEmployeeEntry: runtime.resolveEmployeeEntry,
    applyEmployeeLeaveBalance: runtime.applyEmployeeLeaveBalance,
  };

  runtime.getById = async (table, id) => getTable(table).get(String(id)) || null;
  runtime.list = async (table) => [...getTable(table).values()];
  runtime.upsert = async (table, record) => {
    const idKey =
      table === "Folgas"
        ? "FolgaID"
        : table === "Documentos"
        ? "DocumentoID"
        : table === "JustificativasPonto"
        ? "JustificativaPontoID"
        : table === "Funcionarios"
        ? "FuncionarioID"
        : "id";
    const id = String(record[idKey] || record.id || `rec_${Date.now()}`);
    const saved = { ...record, [idKey]: id };
    getTable(table).set(id, saved);
    return saved;
  };
  runtime.patch = async (table, id, data) => {
    const existing = getTable(table).get(String(id)) || {};
    const updated = { ...existing, ...data };
    getTable(table).set(String(id), updated);
    return updated;
  };
  runtime.applyEmployeeLeaveBalance = async () => ({ credited: true, current: 2 });
  runtime.resolveEmployeeEntry = async (lookup) => {
    const emp = getTable("Funcionarios").get(String(lookup.FuncionarioID || ""));
    return { storageKey: lookup.FuncionarioID, record: emp };
  };

  try {
    // 1. Cadastra loja e colaboradores
    await runtime.upsert("Lojas", {
      LojaID: storeId,
      Nome: "House Burger Teste",
      Ativo: true,
    });

    await runtime.upsert("Funcionarios", {
      FuncionarioID: employeeId,
      Nome: "Carlos Cozinheiro",
      Email: "carlos@house.com",
      LojaID: storeId,
      Ativo: true,
      SaldoFolgas: 2,
      Perfil: "Colaborador",
    });

    await runtime.upsert("Funcionarios", {
      FuncionarioID: managerId,
      Nome: "Gerente Ana",
      Email: "ana@house.com",
      LojaID: storeId,
      Ativo: true,
      Perfil: "Gerente",
    });

    // 2. Colaborador autenticado envia atestado de 2 dias (2026-10-20 a 2026-10-21)
    runtime.requireProfile = async () => ({
      FuncionarioID: employeeId,
      Nome: "Carlos Cozinheiro",
      Email: "carlos@house.com",
      LojaID: storeId,
      Perfil: "Colaborador",
      Ativo: true,
    });

    const handlers = createApi().handlers;
    assert.equal(typeof handlers.submitMedicalCertificate, "function", "API deve conter submitMedicalCertificate");

    const submitResult = await handlers.submitMedicalCertificate([
      {
        dataInicio: "2026-10-20",
        dataFim: "2026-10-21",
        documentoUrl: "https://drive.google.com/file/d/test_atestado_123/view",
        documentoBase64: "data:image/jpeg;base64,dGVzdGVfZm90b19hdGVzdGFkbw==",
        crm: "CRM-BA 99887",
        motivo: "Amigdalite aguda e febre alta",
      },
    ]);

    assert.equal(submitResult.success, true);
    const { documento, folga } = submitResult.data;

    // Valida o documento gravado
    assert.equal(documento.Tipo, "Atestado Médico");
    assert.equal(documento.Status, "Pendente");
    assert.equal(documento.FuncionarioID, employeeId);
    assert.equal(documento.DiasAbono, 2);
    assert.equal(documento.ArquivoUrl, "https://drive.google.com/file/d/test_atestado_123/view");

    // Valida a solicitação de folga/afastamento
    assert.equal(folga.TipoFolga, "Atestado Médico");
    assert.equal(folga.Status, "Pendente");
    assert.equal(folga.DataInicio, "2026-10-20");
    assert.equal(folga.DataFim, "2026-10-21");

    // CLT: Atestado NÃO desconta o saldo de folgas da pessoa!
    const units = timeOffBalanceUnits(folga);
    assert.equal(units, 0, "Atestado médico não deve descontar o saldo de folgas");

    // 3. Gestor assume a sessão e aprova o atestado
    runtime.requireProfile = async () => ({
      FuncionarioID: managerId,
      Nome: "Gerente Ana",
      Email: "ana@house.com",
      LojaID: storeId,
      Perfil: "Gerente",
      Ativo: true,
    });

    const approveResult = await handlers.approveTimeOff([folga.FolgaID, "Atestado validado e faltas abonadas"]);
    assert.equal(approveResult.success, true);

    // 4. Verifica que as faltas foram automaticamente abonadas em JustificativasPonto
    const just1 = await runtime.getById("JustificativasPonto", `${employeeId}__2026-10-20`);
    const just2 = await runtime.getById("JustificativasPonto", `${employeeId}__2026-10-21`);

    assert.ok(just1, "Justificativa de ausência para 2026-10-20 deve existir");
    assert.equal(just1.Tipo, "Atestado");
    assert.equal(just1.Status, "Aprovada");
    assert.equal(just1.JustificadoPor, "ana@house.com");

    assert.ok(just2, "Justificativa de ausência para 2026-10-21 deve existir");
    assert.equal(just2.Tipo, "Atestado");
    assert.equal(just2.Status, "Aprovada");

    // 5. Verifica que o documento em Documentos passou para Aprovado
    const updatedDoc = await runtime.getById("Documentos", documento.DocumentoID);
    assert.equal(updatedDoc.Status, "Aprovado");
    assert.equal(updatedDoc.AprovadoPor, "ana@house.com");
  } finally {
    Object.assign(runtime, originalMethods);
  }
});

test("Atestado Médico: rejeição pelo gestor atualiza o status do documento para Rejeitado", async () => {
  const storeId = "loja-teste-atestado-2";
  const employeeId = "func-atestado-2";
  const managerId = "gerente-atestado-2";

  const tables = new Map();
  const getTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };

  const originalMethods = {
    getById: runtime.getById,
    list: runtime.list,
    upsert: runtime.upsert,
    patch: runtime.patch,
    requireProfile: runtime.requireProfile,
  };

  runtime.getById = async (table, id) => getTable(table).get(String(id)) || null;
  runtime.list = async (table) => [...getTable(table).values()];
  runtime.upsert = async (table, record) => {
    const idKey =
      table === "Folgas"
        ? "FolgaID"
        : table === "Documentos"
        ? "DocumentoID"
        : table === "Funcionarios"
        ? "FuncionarioID"
        : "id";
    const id = String(record[idKey] || record.id || `rec_${Date.now()}`);
    const saved = { ...record, [idKey]: id };
    getTable(table).set(id, saved);
    return saved;
  };
  runtime.patch = async (table, id, data) => {
    const existing = getTable(table).get(String(id)) || {};
    const updated = { ...existing, ...data };
    getTable(table).set(String(id), updated);
    return updated;
  };

  try {
    await runtime.upsert("Funcionarios", {
      FuncionarioID: employeeId,
      Nome: "Beatriz Salão",
      Email: "beatriz@house.com",
      LojaID: storeId,
      Ativo: true,
      Perfil: "Colaborador",
    });

    runtime.requireProfile = async () => ({
      FuncionarioID: employeeId,
      Nome: "Beatriz Salão",
      Email: "beatriz@house.com",
      LojaID: storeId,
      Perfil: "Colaborador",
      Ativo: true,
    });

    const handlers = createApi().handlers;

    const submitResult = await handlers.submitMedicalCertificate([
      {
        dataInicio: "2026-10-22",
        dataFim: "2026-10-22",
        documentoUrl: "https://drive.google.com/file/d/test_atestado_recusado/view",
        documentoBase64: "data:image/jpeg;base64,dGVzdGVfcmVjdXNhZG8=",
        crm: "Sem CRM legível",
        motivo: "Dor de cabeça",
      },
    ]);

    const { documento, folga } = submitResult.data;

    // Gestor rejeita
    runtime.requireProfile = async () => ({
      FuncionarioID: managerId,
      Nome: "Gerente Carlos",
      Email: "gerente.carlos@house.com",
      LojaID: storeId,
      Perfil: "Gerente",
      Ativo: true,
    });

    const rejectResult = await handlers.rejectTimeOff([folga.FolgaID, "Foto ilegível, apresentar segunda via"]);
    assert.equal(rejectResult.success, true);

    const updatedDoc = await runtime.getById("Documentos", documento.DocumentoID);
    assert.equal(updatedDoc.Status, "Rejeitado");
    assert.equal(updatedDoc.ObservacaoRejeicao, "Foto ilegível, apresentar segunda via");
  } finally {
    Object.assign(runtime, originalMethods);
  }
});

test("Atestado Médico & Google Drive: parseDriveUrl extrai corretamente ID e URLs de visualização direta e preview", () => {
  const url1 = "https://drive.google.com/file/d/1X5X8v48abcDEF123456789012/view?usp=drivesdk";
  const res1 = parseDriveUrl(url1);
  assert.ok(res1);
  assert.equal(res1.fileId, "1X5X8v48abcDEF123456789012");
  assert.equal(res1.thumbnailUrl, "https://drive.google.com/thumbnail?id=1X5X8v48abcDEF123456789012&sz=w1600");
  assert.equal(res1.previewUrl, "https://drive.google.com/file/d/1X5X8v48abcDEF123456789012/preview");
  assert.equal(res1.directViewUrl, "https://lh3.googleusercontent.com/d/1X5X8v48abcDEF123456789012");

  const url2 = "https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz99";
  const res2 = parseDriveUrl(url2);
  assert.ok(res2);
  assert.equal(res2.fileId, "1AbCdEfGhIjKlMnOpQrStUvWxYz99");

  assert.equal(parseDriveUrl(""), null);
  assert.equal(parseDriveUrl("https://example.com/arquivo.png"), null);
});

test("Atestado Médico: preservação de base64 de imagem de alta resolução até 2MB no banco", async () => {
  const tables = new Map();
  const getTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };

  const originalMethods = {
    getById: runtime.getById,
    list: runtime.list,
    upsert: runtime.upsert,
    requireProfile: runtime.requireProfile,
  };

  runtime.getById = async (table, id) => getTable(table).get(String(id)) || null;
  runtime.list = async (table) => [...getTable(table).values()];
  runtime.upsert = async (table, record) => {
    const idKey =
      table === "Folgas"
        ? "FolgaID"
        : table === "Documentos"
        ? "DocumentoID"
        : table === "Funcionarios"
        ? "FuncionarioID"
        : "id";
    const id = String(record[idKey] || record.id || `rec_${Date.now()}`);
    const saved = { ...record, [idKey]: id };
    getTable(table).set(id, saved);
    return saved;
  };

  try {
    await runtime.upsert("Funcionarios", {
      FuncionarioID: "func-hd-1",
      Nome: "Danilo Chapa",
      Email: "danilo@house.com",
      LojaID: "loja-hd",
      Ativo: true,
      Perfil: "Colaborador",
    });

    runtime.requireProfile = async () => ({
      FuncionarioID: "func-hd-1",
      Nome: "Danilo Chapa",
      Email: "danilo@house.com",
      LojaID: "loja-hd",
      Perfil: "Colaborador",
      Ativo: true,
    });

    const handlers = createApi().handlers;
    // Imagem com 700KB em base64 (passava do limite antigo de 500k e ficava vazia gerando imagem quebrada)
    const largeBase64 = "data:image/jpeg;base64," + "A".repeat(700000);

    const submitResult = await handlers.submitMedicalCertificate([
      {
        dataInicio: "2026-10-23",
        dataFim: "2026-10-23",
        documentoUrl: "https://drive.google.com/file/d/1X5X8v48abcDEF123456789012/view?usp=drivesdk",
        documentoBase64: largeBase64,
        crm: "CRM-SP 123456",
        motivo: "Consulta médica",
      },
    ]);

    assert.equal(submitResult.success, true);
    const { documento } = submitResult.data;

    // Confirma que ArquivoOriginalBase64 foi mantido integralmente para renderização instantânea
    assert.equal(documento.ArquivoOriginalBase64.length, largeBase64.length);
    assert.equal(documento.ArquivoOriginalBase64, largeBase64);
  } finally {
    Object.assign(runtime, originalMethods);
  }
});
