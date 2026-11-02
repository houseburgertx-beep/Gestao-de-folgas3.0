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
    patch: runtime.patch,
    requireProfile: runtime.requireProfile,
  };
  runtime.requireProfile = async () => ({ Perfil: "Administrador", FuncionarioID: "EMP_TEST_WPP_01", LojaID: "CENTRO", Ativo: true });
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

  runtime.patch = runtime.update;

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
    patch: runtime.patch,
    requireProfile: runtime.requireProfile,
  };
  runtime.requireProfile = async () => ({ Perfil: "Administrador", FuncionarioID: "EMP_TEST_WPP_01", LojaID: "CENTRO", Ativo: true });
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

  runtime.patch = runtime.update;

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
    patch: runtime.patch,
    requireProfile: runtime.requireProfile,
  };
  runtime.requireProfile = async () => ({ Perfil: "Administrador", FuncionarioID: "EMP_TEST_WPP_01", LojaID: "CENTRO", Ativo: true });
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

  runtime.patch = runtime.update;

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

test("WhatsApp Connection Tab: QR, conexão e desconexão refletem respostas reais autenticadas", async () => {
  const originals = { auth: runtime.auth, requireProfile: runtime.requireProfile, fetch: globalThis.fetch };
  runtime.auth = { currentUser: { getIdToken: async () => "firebase-test-token" } };
  runtime.requireProfile = async () => ({ Perfil: "Administrador", Ativo: true });
  const seen = [];
  let connected = false;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer firebase-test-token");
    assert.equal(options.headers["X-API-Key"], undefined);
    const path = new URL(url).pathname;
    seen.push(path);
    if (path === "/wa-status") return Response.json({ connected, status: connected ? "connected" : "disconnected", phone: connected ? "5573988776655" : "" });
    if (path === "/wa-qr") return Response.json({ success: true, status: "qrcode", qrcode: "data:image/png;base64,dGVzdA==", pairingCode: "" });
    if (path === "/wa-disconnect") { connected = false; return Response.json({ success: true, status: "disconnected" }); }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const handlers = createWhatsAppHandlers();
    assert.equal((await handlers.getWhatsAppConnectionStatus()).connected, false);
    const qr = await handlers.generateWhatsAppQrCode();
    assert.ok(qr.qrcode.startsWith("data:image/png"));
    assert.equal(qr.pairingCode, "");
    await assert.rejects(handlers.confirmWhatsAppConnection(), /ainda não confirmou/);
    connected = true;
    assert.equal((await handlers.confirmWhatsAppConnection()).phone, "5573988776655");
    await handlers.disconnectWhatsApp();
    assert.equal((await handlers.getWhatsAppConnectionStatus()).connected, false);
    assert.ok(seen.includes("/wa-disconnect"));
  } finally {
    runtime.auth = originals.auth; runtime.requireProfile = originals.requireProfile; globalThis.fetch = originals.fetch;
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
  assert.doesNotMatch(scriptsHtml, /renderSvgQrCode/, "Nunca exibir QR ilustrativo como pareamento real");
  assert.match(scriptsHtml, /activeQr/, "Pareamento deve usar QR recebido do gateway");

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

test("WhatsApp Broadcast: disparo em massa de comunicado para colaboradores", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalAuth = runtime.auth;
  globalThis.window = {};
  runtime.auth = { currentUser: { getIdToken: async () => "broadcast-test" } };
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, "/wa-send");
    assert.equal(options.headers.Authorization, "Bearer broadcast-test");
    return Response.json({ success: true, messageId: "mock-confirmed-message" });
  };
  const tables = new Map();
  const getTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const originalMethods = {
    getById: runtime.getById,
    list: runtime.list,
    upsert: runtime.upsert,
    create: runtime.create,
    update: runtime.update,
    patch: runtime.patch,
    requireProfile: runtime.requireProfile,
    requireProfile: runtime.requireProfile,
  };
  runtime.requireProfile = async () => ({ Perfil: "Administrador", FuncionarioID: "EMP_TEST_WPP_01", LojaID: "CENTRO", Ativo: true });
  runtime.getById = async (table, id) => getTable(table).get(String(id)) || null;
  runtime.list = async (table) => [...getTable(table).values()];
  runtime.create = async (table, record) => {
    const idKey = table === "Funcionarios" ? "FuncionarioID" : table === "Auditoria" ? "AuditoriaID" : "id";
    const id = String(record[idKey] || record.id || `rec_${Date.now()}_${Math.random()}`);
    const saved = { ...record, [idKey]: id };
    getTable(table).set(id, saved);
    return saved;
  };
  runtime.upsert = async (table, record) => {
    const idKey = table === "Funcionarios" ? "FuncionarioID" : table === "Auditoria" ? "AuditoriaID" : "id";
    const id = String(record[idKey] || record.id || `rec_${Date.now()}_${Math.random()}`);
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

  runtime.patch = runtime.update;

  try {
    const handlers = createWhatsAppHandlers();

    // Colaboradores fictícios
    await runtime.upsert("Funcionarios", {
      FuncionarioID: "EMP_01",
      Nome: "Ana Silva",
      WhatsApp: "73999112233",
      Status: "Ativo",
      LojaID: "CENTRO",
    });
    await runtime.upsert("Funcionarios", {
      FuncionarioID: "EMP_02",
      Nome: "Bruno Costa",
      Telefone: "(73) 98822-3344",
      Status: "Ativo",
      LojaID: "PRAIA",
    });
    await runtime.upsert("Funcionarios", {
      FuncionarioID: "EMP_03",
      Nome: "Carlos Inativo",
      WhatsApp: "73999999999",
      Status: "Inativo",
      LojaID: "CENTRO",
    });
    await runtime.upsert("Funcionarios", {
      FuncionarioID: "EMP_04",
      Nome: "Daniel Sem Telefone",
      Status: "Ativo",
      LojaID: "CENTRO",
    });

    // 1. Falha sem título ou mensagem
    await assert.rejects(
      () => handlers.broadcastWhatsAppAnnouncement([{ titulo: "", mensagem: "" }]),
      /Informe o título do comunicado/
    );

    // 2. Disparo para todas as lojas
    const resAll = await handlers.broadcastWhatsAppAnnouncement([{
      titulo: "Reunião Geral",
      mensagem: "Reunião de alinhamento amanhã às 15h.",
      lojaId: "TODAS",
    }]);

    assert.equal(resAll.success, true);
    assert.equal(resAll.total, 2); // Apenas Ana e Bruno (ativos com telefone)
    assert.equal(resAll.sentCount, 2);
    assert.equal(resAll.failedCount, 0);

    // 3. Disparo filtrado por loja
    const resCentro = await handlers.broadcastWhatsAppAnnouncement([{
      titulo: "Aviso Centro",
      mensagem: "Manutenção na unidade Centro hoje.",
      lojaId: "CENTRO",
    }]);

    assert.equal(resCentro.success, true);
    assert.equal(resCentro.total, 1); // Apenas Ana Silva
    assert.equal(resCentro.sentCount, 1);
    assert.equal(resCentro.results[0].nome, "Ana Silva");

    // 4. Histórico de disparos
    const historyRes = await handlers.getWhatsAppHistory();
    const history = historyRes.history || [];
    assert.ok(history.length >= 3, "Deve retornar os registros de disparo na Auditoria");
    assert.ok(history.some((h) => h.Acao?.includes("WhatsApp")), "Deve conter ações de WhatsApp");
  } finally {
    Object.assign(runtime, originalMethods);
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    runtime.auth = originalAuth;
  }
});

test("WhatsApp Broadcast: elementos visuais e handlers em Index.html e Scripts.html", async () => {
  const [indexHtml, scriptsHtml] = await Promise.all([
    readFile(new URL("../src/legacy/Index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
  ]);

  // Card de disparo em massa na aba WhatsApp
  assert.match(indexHtml, /id="waBroadcastForm"/, "Index.html deve conter o formulário waBroadcastForm");
  assert.match(indexHtml, /id="waBtnSendBroadcast"/, "Index.html deve conter o botão de disparo em massa");
  assert.match(indexHtml, /id="waBroadcastTargetCount"/, "Index.html deve conter o contador de destinatários");

  // Checkbox de envio WhatsApp na criação de comunicados
  assert.match(indexHtml, /id="announcementSendWhatsApp"/, "Index.html deve conter checkbox de envio WhatsApp no mural de avisos");

  // Handlers e bindings em Scripts.html
  assert.match(scriptsHtml, /broadcastWhatsAppAnnouncement/, "Scripts.html deve registrar a action de broadcast");
  assert.match(scriptsHtml, /broadcastExistingAnnouncement_/, "Scripts.html deve implementar broadcastExistingAnnouncement_");
  assert.match(scriptsHtml, /Disparar WhatsApp/, "Scripts.html deve renderizar o botão Disparar WhatsApp nos comunicados");
});

test("WhatsApp Magic: geração exige proprietário ou gestão da loja e usa identidade canônica", async () => {
  const original = { requireProfile: runtime.requireProfile, getById: runtime.getById, list: runtime.list, upsert: runtime.upsert, resolveStorageKey: runtime.resolveStorageKey };
  const employee = { FuncionarioID: "employee-real", Nome: "Ana", LojaID: "A", Telefone: "71988887777" };
  let profile = { Perfil: "Gerente", LojaID: "A" };
  let saved;
  runtime.requireProfile = async () => profile;
  runtime.getById = async () => employee;
  runtime.list = async () => [employee];
  runtime.resolveStorageKey = async () => "legacy-storage-key";
  runtime.upsert = async (_table, record) => { saved = record; return record; };
  try {
    const handlers = createWhatsAppHandlers();
    await handlers.generateWhatsAppMagicLink([{ funcionarioId: "alias-name", validadeHoras: Infinity }]);
    assert.equal(saved.FuncionarioID, "employee-real");
    assert.equal(saved.FuncionarioStorageKey, "legacy-storage-key");
    assert.ok(new Date(saved.ExpiraEm).getTime() - Date.now() <= 48 * 3600000);
    profile = { Perfil: "Gerente", LojaID: "B" };
    await assert.rejects(handlers.generateWhatsAppMagicLink([{ funcionarioId: "employee-real" }]), /sua loja/);
    profile = { Perfil: "Funcionário", FuncionarioID: "other", LojaID: "A" };
    await assert.rejects(handlers.generateWhatsAppMagicLink([{ funcionarioId: "employee-real" }]), /sua loja/);
    profile.FuncionarioID = "employee-real";
    assert.equal((await handlers.generateWhatsAppMagicLink([{ funcionarioId: "employee-real" }])).success, true);
  } finally { Object.assign(runtime, original); }
});

test("WhatsApp Magic: consumo exige conta destinatária, preserva repetição e propaga falha de gravação", async () => {
  const original = { requireProfile: runtime.requireProfile, getById: runtime.getById, patch: runtime.patch, auth: runtime.auth };
  const record = { TokenID: "wpp_test", Token: "wpp_test", FuncionarioID: "owner", ExpiraEm: new Date(Date.now() + 3600000).toISOString(), Acessos: 0 };
  let profile = { Perfil: "Administrador", FuncionarioID: "foreign" };
  let writes = 0;
  runtime.auth = { currentUser: { uid: "uid-owner" } };
  runtime.requireProfile = async () => profile;
  runtime.getById = async (table) => table === "WhatsAppMagicTokens" ? record : { FuncionarioID: "owner", Nome: "Ana" };
  runtime.patch = async (_table, _id, delta) => { writes++; Object.assign(record, delta); };
  try {
    const handlers = createWhatsAppHandlers();
    await assert.rejects(handlers.consumeWhatsAppMagicLink([record.Token]), /outro colaborador/);
    assert.equal(writes, 0);
    profile = { Perfil: "Funcionário", FuncionarioID: "owner" };
    assert.equal((await handlers.consumeWhatsAppMagicLink([record.Token])).success, true);
    assert.equal((await handlers.consumeWhatsAppMagicLink([record.Token])).success, true);
    assert.equal(record.Acessos, 2);
    runtime.patch = async () => { throw new Error("permission-denied-test"); };
    await assert.rejects(handlers.consumeWhatsAppMagicLink([record.Token]), /permission-denied-test/);
    runtime.getById = async () => { runtime.auth.currentUser = { uid: "different-account" }; return record; };
    await assert.rejects(handlers.consumeWhatsAppMagicLink([record.Token]), /conta conectada mudou/);
  } finally { Object.assign(runtime, original); }
});

test("WhatsApp numbers: rejeita números arbitrários e preserva fixo/DDD e país explícito", () => {
  assert.equal(normalizeWhatsAppNumber("123"), "");
  assert.equal(normalizeWhatsAppNumber("55123"), "");
  assert.equal(normalizeWhatsAppNumber("00000000000"), "");
  assert.equal(normalizeWhatsAppNumber("(71) 3333-4444"), "557133334444");
  assert.equal(normalizeWhatsAppNumber("+55 71 98888-7777"), "5571988887777");
  assert.equal(normalizeWhatsAppNumber("+1 202 555 0123"), "12025550123");
});
