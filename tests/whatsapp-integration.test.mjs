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

test("WhatsApp Connection Tab: ciclo de pareamento com QR Code, código de 8 dígitos e teste de envio", async () => {
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
    requireProfile: runtime.requireProfile,
  };
  runtime.getById = async (table, id) => getTable(table).get(String(id)) || null;
  runtime.list = async (table) => [...getTable(table).values()];
  runtime.upsert = async (table, record) => {
    const idKey = table === "Configuracoes" ? "Chave" : "id";
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
  runtime.requireProfile = async () => ({
    Nome: "Administrador Geral",
    Perfil: "Administrador",
    LojaID: "CENTRO",
  });

  try {
    const handlers = createWhatsAppHandlers();

    // 1. Status inicial desconectado
    const initialStatus = await handlers.getWhatsAppConnectionStatus();
    assert.equal(initialStatus.connected, false);

    // 2. Geração de QR Code e código de 8 dígitos
    const qrResult = await handlers.generateWhatsAppQrCode();
    assert.equal(qrResult.success, true);
    assert.equal(qrResult.status, "qrcode");
    assert.ok(qrResult.pairingCode.startsWith("H190-"), "Código deve ter prefixo H190-");
    assert.ok(qrResult.qrcode.includes("house190-bot"), "QR payload deve conter nome da instância");

    // 3. Confirmação do pareamento
    const confirmResult = await handlers.confirmWhatsAppConnection([{ phone: "5573988776655" }]);
    assert.equal(confirmResult.success, true);
    assert.equal(confirmResult.status, "connected");

    // 4. Verificação de status conectado
    const activeStatus = await handlers.getWhatsAppConnectionStatus();
    assert.equal(activeStatus.connected, true);
    assert.equal(activeStatus.phone, "5573988776655");

    // 5. Disparo de teste
    const testResult = await handlers.sendTestWhatsAppMessage([{
      phone: "73999887766",
      message: "Mensagem de teste de conexão",
    }]);
    assert.equal(testResult.success, true);
    assert.equal(testResult.phone, "5573999887766");
    assert.ok(testResult.waUrl.includes("wa.me"), "Deve gerar link de contingência wa.me");

    // 6. Desconexão
    const discResult = await handlers.disconnectWhatsApp();
    assert.equal(discResult.success, true);
    assert.equal(discResult.status, "disconnected");
  } finally {
    Object.assign(runtime, originalMethods);
  }
});

test("WhatsApp Connection Tab: marcação visual em Index.html e Scripts.html", async () => {
  const [indexHtml, scriptsHtml] = await Promise.all([
    readFile(new URL("../src/legacy/Index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
  ]);

  // 1. Botão de navegação na aba de Administração
  assert.match(indexHtml, /data-view="whatsapp"/, "Index.html deve conter item de navegação com data-view whatsapp");
  assert.match(indexHtml, /Conexão WhatsApp/, "Index.html deve exibir o rótulo Conexão WhatsApp");

  // 2. Seção de visualização dedicada
  assert.match(indexHtml, /id="view-whatsapp"/, "Index.html deve conter a seção id view-whatsapp");
  assert.match(indexHtml, /id="waStatusBadge"/, "Index.html deve conter badge de status");
  assert.match(indexHtml, /id="waBtnGenerateQr"/, "Index.html deve conter botão para gerar QR Code");
  assert.match(indexHtml, /id="waPairingCodeDisplay"/, "Index.html deve conter exibição do código de pareamento");
  assert.match(indexHtml, /id="waTestMessageForm"/, "Index.html deve conter formulário de teste de envio");

  // 3. Controle e roteamento em Scripts.html
  assert.match(scriptsHtml, /"whatsapp"/, "Scripts.html deve incluir whatsapp nas views restritas");
  assert.match(scriptsHtml, /loadWhatsAppConnectionView/, "Scripts.html deve implementar loadWhatsAppConnectionView");
  assert.match(scriptsHtml, /renderSvgQrCode/, "Scripts.html deve conter gerador visual de QR Code em SVG");

  // 4. Central de Automações (Documentos, Tarefas, Avisos, Ponto, Folgas)
  assert.match(indexHtml, /id="waAutomationsForm"/, "Index.html deve conter formulário de automações");
  assert.match(indexHtml, /name="aut_ponto"/, "Deve ter toggle de ponto");
  assert.match(indexHtml, /name="aut_folga_nova"/, "Deve ter toggle de folga nova");
  assert.match(indexHtml, /name="aut_folga_aprovada"/, "Deve ter toggle de folga aprovada");
  assert.match(indexHtml, /name="aut_folga_recusada"/, "Deve ter toggle de folga recusada");
  assert.match(indexHtml, /name="aut_troca_folga"/, "Deve ter toggle de troca de folga");
  assert.match(indexHtml, /name="aut_comunicados"/, "Deve ter toggle de comunicados");
  assert.match(indexHtml, /name="aut_espelho_ponto"/, "Deve ter toggle de espelho de ponto");
  assert.match(indexHtml, /name="aut_documentos"/, "Deve ter toggle de documentos e holerites");
  assert.match(indexHtml, /name="aut_tarefas"/, "Deve ter toggle de tarefas");

  // 5. Integração com o Worker no Scripts.html
  assert.match(scriptsHtml, /\/wa-status/, "Scripts.html deve consultar status real via Worker");
  assert.match(scriptsHtml, /\/wa-qr/, "Scripts.html deve solicitar QR Code real via Worker");
  assert.match(scriptsHtml, /\/wa-automations/, "Scripts.html deve persistir automações via Worker");
});
