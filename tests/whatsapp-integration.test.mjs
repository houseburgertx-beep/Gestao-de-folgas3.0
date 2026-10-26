import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWhatsAppHandlers, normalizeWhatsAppNumber } from "../src/core/api-whatsapp.js";
import { runtime } from "../src/core/runtime.js";

test("WhatsApp Integration: normalização de números telefônicos para padrão E.164", () => {
  assert.equal(normalizeWhatsAppNumber("73988776655"), "5573988776655");
  assert.equal(normalizeWhatsAppNumber("(73) 98877-6655"), "5573988776655");
  assert.equal(normalizeWhatsAppNumber("+55 73 98877-6655"), "5573988776655");
  assert.equal(normalizeWhatsAppNumber("5573988776655"), "5573988776655");
  assert.equal(normalizeWhatsAppNumber(""), "");
});

test("WhatsApp Integration: geração, expiração e consumo de Magic Links seguros", async () => {
  const tables = new Map();
  const getTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const originalMethods = {
    getById: runtime.getById,
    list: runtime.list,
    upsert: runtime.upsert,
    update: runtime.update,
  };
  runtime.getById = async (table, id) => getTable(table).get(String(id)) || null;
  runtime.list = async (table) => [...getTable(table).values()];
  runtime.upsert = async (table, record) => {
    const idKey = table === "Funcionarios" ? "FuncionarioID" : table === "WhatsAppMagicTokens" ? "TokenID" : "id";
    const id = String(record[idKey] || record.id || `rec_${Date.now()}`);
    const saved = { ...record, [idKey]: id };
    getTable(table).set(id, saved);
    return saved;
  };
  runtime.update = async (table, id, data) => {
    const existing = getTable(table).get(String(id)) || {};
    const updated = { ...existing, ...data };
    getTable(table).set(String(id), updated);
    return updated;
  };

  try {
    const handlers = createWhatsAppHandlers();

    // Cria colaborador fictício para o teste
    const fakeEmpId = "EMP_TEST_WPP_01";
    await runtime.upsert("Funcionarios", {
      FuncionarioID: fakeEmpId,
      Nome: "Carlos Cozinheiro",
      Telefone: "73999887766",
      LojaID: "CENTRO",
      Perfil: "Funcionário",
    });

    // 1. Geração do Magic Link
    const genResult = await handlers.generateWhatsAppMagicLink([{
      funcionarioId: fakeEmpId,
      destino: "documents",
      filtroStatus: "Pendente",
      mesReferencia: "2026-09",
      origin: "https://gestao.house190.com.br",
      tipo: "ESPELHO_PONTO",
      validadeHoras: 24,
    }]);

    assert.equal(genResult.success, true);
    assert.ok(genResult.token.startsWith("wpp_"), "Token deve iniciar com prefixo wpp_");
    assert.ok(genResult.magicUrl.includes("magic_token="), "URL deve conter parâmetro magic_token");

    // 2. Consumo do Magic Link
    const consumeResult = await handlers.consumeWhatsAppMagicLink([genResult.token]);
    assert.equal(consumeResult.success, true);
    assert.equal(consumeResult.funcionarioId, fakeEmpId);
    assert.equal(consumeResult.destino, "documents");
    assert.equal(consumeResult.filtroStatus, "Pendente");
    assert.equal(consumeResult.mesReferencia, "2026-09");
    assert.equal(consumeResult.employee?.Nome, "Carlos Cozinheiro");

    // 3. Rejeição de token inválido
    await assert.rejects(
      () => handlers.consumeWhatsAppMagicLink(["token_inexistente"]),
      /não encontrado/
    );
  } finally {
    Object.assign(runtime, originalMethods);
  }
});

test("WhatsApp Integration: formatação de mensagens de cobrança e link de ação direta", async () => {
  const tables = new Map();
  const getTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const originalMethods = {
    getById: runtime.getById,
    list: runtime.list,
    upsert: runtime.upsert,
    update: runtime.update,
  };
  runtime.getById = async (table, id) => getTable(table).get(String(id)) || null;
  runtime.list = async (table) => [...getTable(table).values()];
  runtime.upsert = async (table, record) => {
    const idKey = table === "Funcionarios" ? "FuncionarioID" : table === "WhatsAppMagicTokens" ? "TokenID" : "id";
    const id = String(record[idKey] || record.id || `rec_${Date.now()}`);
    const saved = { ...record, [idKey]: id };
    getTable(table).set(id, saved);
    return saved;
  };
  runtime.update = async (table, id, data) => {
    const existing = getTable(table).get(String(id)) || {};
    const updated = { ...existing, ...data };
    getTable(table).set(String(id), updated);
    return updated;
  };

  try {
    const handlers = createWhatsAppHandlers();

    const fakeEmpId = "EMP_TEST_WPP_02";
    await runtime.upsert("Funcionarios", {
      FuncionarioID: fakeEmpId,
      Nome: "Mariana Barista",
      Telefone: "73988112233",
      LojaID: "FOODPARK",
      Perfil: "Funcionário",
    });

    const msgResult = await handlers.generateWhatsAppNotificationMessage([{
      funcionarioId: fakeEmpId,
      tipo: "ESPELHO_PONTO",
      mesReferencia: "2026-09",
      origin: "https://gestao.house190.com.br",
    }]);

    assert.equal(msgResult.success, true);
    assert.equal(msgResult.phone, "5573988112233");
    assert.ok(msgResult.message.includes("Mariana"), "Mensagem deve conter primeiro nome do colaborador");
    assert.ok(msgResult.message.includes("Setembro de 2026"), "Mensagem deve converter mês para extenso");
    assert.ok(msgResult.message.includes("Portaria 671 MTE"), "Mensagem deve citar a Portaria 671 MTE");
    assert.ok(msgResult.waUrl.startsWith("https://wa.me/5573988112233"), "waUrl deve iniciar com endpoint do WhatsApp");
  } finally {
    Object.assign(runtime, originalMethods);
  }
});

test("WhatsApp Integration: Webhook receptivo e autoatendimento com menu estruturado", async () => {
  const tables = new Map();
  const getTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const originalMethods = {
    getById: runtime.getById,
    list: runtime.list,
    upsert: runtime.upsert,
    update: runtime.update,
  };
  runtime.getById = async (table, id) => getTable(table).get(String(id)) || null;
  runtime.list = async (table) => [...getTable(table).values()];
  runtime.upsert = async (table, record) => {
    const idKey = table === "Funcionarios" ? "FuncionarioID" : table === "WhatsAppMagicTokens" ? "TokenID" : "id";
    const id = String(record[idKey] || record.id || `rec_${Date.now()}`);
    const saved = { ...record, [idKey]: id };
    getTable(table).set(id, saved);
    return saved;
  };
  runtime.update = async (table, id, data) => {
    const existing = getTable(table).get(String(id)) || {};
    const updated = { ...existing, ...data };
    getTable(table).set(String(id), updated);
    return updated;
  };

  try {
    const handlers = createWhatsAppHandlers();

    const fakeEmpId = "EMP_TEST_WPP_03";
    await runtime.upsert("Funcionarios", {
      FuncionarioID: fakeEmpId,
      Nome: "Lucas Chapa",
      Telefone: "73977665544",
      LojaID: "CENTRO",
      Perfil: "Funcionário",
    });

    // 1. Mensagem de colaborador cadastrado solicitando espelho de ponto
    const webhookRes = await handlers.processIncomingWhatsAppWebhook([{
      from: "5573977665544",
      text: "Quero assinar meu espelho de ponto",
    }]);

    assert.equal(webhookRes.handled, true);
    assert.equal(webhookRes.funcionarioId, fakeEmpId);
    assert.ok(webhookRes.replyText.includes("Aqui está o seu link seguro"), "Resposta deve conter confirmação e link");
    assert.ok(webhookRes.replyText.includes("magic_token="), "Resposta deve conter o Magic Link gerado");

    // 2. Mensagem de número não cadastrado
    const unknownRes = await handlers.processIncomingWhatsAppWebhook([{
      from: "5511900000000",
      text: "Olá",
    }]);

    assert.equal(unknownRes.handled, true);
    assert.equal(unknownRes.matched, false);
    assert.ok(unknownRes.replyText.includes("exclusivo para colaboradores"), "Deve orientar que o canal é exclusivo");
  } finally {
    Object.assign(runtime, originalMethods);
  }
});

test("WhatsApp UI: ação de cobrança no painel de documentos e tratamento no bootstrap", async () => {
  const [scriptsHtml, documentsJs] = await Promise.all([
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/documents.js", import.meta.url), "utf8"),
  ]);

  // 1. Botão notify-whatsapp configurado na listagem de documentos
  assert.match(documentsJs, /data-action="notify-whatsapp"/, "documents.js deve possuir data-action notify-whatsapp");
  assert.match(documentsJs, /window\.notifyDocumentViaWhatsApp/, "documents.js deve delegar clique a window.notifyDocumentViaWhatsApp");

  // 2. Handler no Scripts.html
  assert.match(scriptsHtml, /function notifyDocumentViaWhatsApp\(docId\)/, "Scripts.html deve implementar notifyDocumentViaWhatsApp");
  assert.match(scriptsHtml, /function checkWhatsAppMagicTokenArrival_\(\)/, "Scripts.html deve detectar chegada de magic_token");
});
