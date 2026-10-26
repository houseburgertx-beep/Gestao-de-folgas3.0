import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createApi } from "../src/core/api.js";
import { runtime } from "../src/core/runtime.js";

test("Canal de Denúncias (Whistleblowing): envio anônimo, protocolo, PIN, consulta e réplica", async () => {
  const tables = new Map();
  const getTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };

  const originalMethods = {
    getById: runtime.getById,
    list: runtime.list,
    create: runtime.create,
    upsert: runtime.upsert,
    patch: runtime.patch,
    requireProfile: runtime.requireProfile,
  };

  runtime.getById = async (table, id) => getTable(table).get(String(id)) || null;
  runtime.list = async (table) => [...getTable(table).values()];
  runtime.create = async (table, record) => {
    const key =
      table === "Denuncias"
        ? record.DenunciaID
        : table === "DenunciasMensagens"
        ? record.MensagemID
        : table === "Documentos"
        ? record.DocumentoID
        : table === "Notificacoes"
        ? record.NotificacaoID
        : record.id || record.ID || `${Date.now()}`;
    getTable(table).set(String(key), { ...record });
    return record;
  };
  runtime.upsert = async (table, record) => {
    const key =
      table === "Notificacoes"
        ? record.NotificacaoID
        : record.id || record.ID || `${Date.now()}`;
    getTable(table).set(String(key), { ...record });
    return record;
  };
  runtime.patch = async (table, id, patch) => {
    const current = getTable(table).get(String(id)) || {};
    const updated = { ...current, ...patch };
    getTable(table).set(String(id), updated);
    return updated;
  };

  const api = createApi();

  try {
    // 1. Envio de relato anônimo
    const resCriar = await api.invoke("denunciaCriar", [
      {
        categoria: "Assédio moral",
        lojaId: "LOJA_1",
        descricao: "Relato detalhado sobre cobrança abusiva de metas durante o horário de almoço.",
        envolvidos: "Supervisor do turno",
        anonimo: true,
      },
    ]);

    assert.equal(resCriar.success, true);
    const dataCriar = resCriar.data;
    assert.equal(dataCriar.status, "Recebida");
    assert.ok(dataCriar.protocolo.startsWith("DEN-"), "Protocolo deve iniciar com DEN-");
    assert.equal(dataCriar.pin.length, 4, "PIN deve conter 4 dígitos numéricos");
    assert.equal(dataCriar.categoria, "Assédio moral");

    // 2. Consulta pelo denunciante com PIN correto
    const resConsulta = await api.invoke("denunciaConsultar", [
      {
        protocolo: dataCriar.protocolo,
        pin: dataCriar.pin,
      },
    ]);

    assert.equal(resConsulta.success, true);
    const dataConsulta = resConsulta.data;
    assert.equal(dataConsulta.protocolo, dataCriar.protocolo);
    assert.equal(dataConsulta.status, "Recebida");
    assert.equal(dataConsulta.mensagens.length, 1);
    assert.equal(dataConsulta.mensagens[0].autorTipo, "Denunciante");

    // 3. Consulta com PIN incorreto deve falhar
    await assert.rejects(
      async () => {
        await api.invoke("denunciaConsultar", [
          {
            protocolo: dataCriar.protocolo,
            pin: "0000",
          },
        ]);
      },
      /PIN incorreto/,
    );

    // 4. Denunciante envia réplica/mensagem complementar
    const resMsg = await api.invoke("denunciaEnviarMensagem", [
      {
        protocolo: dataCriar.protocolo,
        pin: dataCriar.pin,
        texto: "Acrescento que o fato ocorreu na última sexta-feira às 13h.",
      },
    ]);
    assert.equal(resMsg.data.enviada, true);

    // 5. Gestor / Comitê de Ética lista e atualiza denúncia
    runtime.requireProfile = async () => ({
      uid: "admin-1",
      FuncionarioID: "func-admin",
      Nome: "Gestor de Compliance",
      Perfil: "Administrador",
    });

    const resListarAdmin = await api.invoke("denunciasAdminListar", [{}]);
    assert.equal(resListarAdmin.data.total, 1);
    assert.equal(resListarAdmin.data.denuncias[0].DenunciaID, dataCriar.protocolo);

    // Gestor emite parecer e responde
    const resAtualizar = await api.invoke("denunciaAdminAtualizar", [
      {
        protocolo: dataCriar.protocolo,
        status: "Em Investigação",
        parecer: "Iniciada apuração preliminar com a gerência geral.",
        respostaTexto: "Recebemos sua mensagem adicional e as medidas cabíveis estão em andamento com total sigilo.",
      },
    ]);
    assert.equal(resAtualizar.data.atualizada, true);
    assert.equal(resAtualizar.data.denuncia.Status, "Em Investigação");

    // 6. Denunciante consulta novamente e vê o parecer e resposta do comitê
    const resConsultaFinal = await api.invoke("denunciaConsultar", [
      {
        protocolo: dataCriar.protocolo,
        pin: dataCriar.pin,
      },
    ]);
    const dataConsultaFinal = resConsultaFinal.data;
    assert.equal(dataConsultaFinal.status, "Em Investigação");
    assert.equal(dataConsultaFinal.parecerComite, "Iniciada apuração preliminar com a gerência geral.");
    assert.equal(dataConsultaFinal.mensagens.length, 3); // Inicial + Réplica + Resposta do RH
  } finally {
    Object.assign(runtime, originalMethods);
  }
});

test("Gestão Documental: modelos dinâmicos de RH e geração para assinatura digital pendente", async () => {
  const tables = new Map();
  const getTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };

  const originalMethods = {
    getById: runtime.getById,
    list: runtime.list,
    create: runtime.create,
    upsert: runtime.upsert,
    requireProfile: runtime.requireProfile,
  };

  runtime.getById = async (table, id) => getTable(table).get(String(id)) || null;
  runtime.list = async (table) => [...getTable(table).values()];
  runtime.create = async (table, record) => {
    const key = record.DocumentoID || record.DocID || `${Date.now()}`;
    getTable(table).set(String(key), { ...record });
    return record;
  };
  runtime.upsert = async (table, record) => {
    const key = record.NotificacaoID || `${Date.now()}`;
    getTable(table).set(String(key), { ...record });
    return record;
  };

  const api = createApi();

  try {
    runtime.requireProfile = async () => ({
      uid: "admin-1",
      FuncionarioID: "func-admin",
      Nome: "Gestor de RH",
      Perfil: "Administrador",
      LojaID: "LOJA_1",
    });

    // Salva funcionário de teste
    getTable("Funcionarios").set("func-123", {
      FuncionarioID: "func-123",
      Nome: "Carlos Eduardo da Silva",
      CPF: "123.456.789-00",
      Cargo: "Cozinheiro Líder",
      LojaID: "LOJA_1",
      NomeLoja: "House 190 - Unidade Centro",
    });

    // 1. Listagem de modelos
    const resTemplates = await api.invoke("documentsTemplatesList", []);
    assert.equal(resTemplates.success, true);
    assert.ok(resTemplates.data.templates.length >= 4);

    // 2. Geração de Termo LGPD
    const resGerar = await api.invoke("documentsGenerateFromTemplate", [
      {
        templateId: "TERMO_LGPD",
        funcionarioId: "func-123",
      },
    ]);

    assert.equal(resGerar.success, true);
    const doc = resGerar.data.documento;
    assert.ok(doc);
    assert.equal(doc.Status, "Pendente");
    assert.equal(doc.FuncionarioID, "func-123");
    assert.ok(doc.ConteudoTexto.includes("Carlos Eduardo da Silva"));
    assert.ok(doc.ConteudoTexto.includes("123.456.789-00"));
    assert.ok(doc.HashOriginalSHA256, "Deve calcular hash SHA-256 do texto original");
  } finally {
    Object.assign(runtime, originalMethods);
  }
});

test("ZERO EMOJIS: Verificação estrita nos novos arquivos do Canal de Denúncias e Documentos", async () => {
  const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

  const filesToCheck = [
    "src/core/api-whistleblower.js",
    "src/whistleblower.js",
  ];

  for (const file of filesToCheck) {
    const content = await readFile(file, "utf8");
    const match = content.match(emojiRegex);
    assert.equal(
      match,
      null,
      `Emoji encontrado no arquivo ${file}: ${match?.[0]}`,
    );
  }

  const indexHtml = await readFile("src/legacy/Index.html", "utf8");
  const wbSection = indexHtml.match(/<section id="view-whistleblower"[\s\S]*?<\/section>/);
  assert.ok(wbSection, "Seção whistleblower deve existir");
  assert.doesNotMatch(wbSection[0], emojiRegex, "Seção Whistleblower não deve conter emojis");
});

test("Integração do Canal de Denúncias no App Shell e scripts", async () => {
  const indexHtml = await readFile("index.html", "utf8");
  assert.ok(
    indexHtml.includes('id="view-whistleblower"'),
    "index.html deve conter a section id='view-whistleblower'",
  );
  assert.ok(
    indexHtml.includes('id="whistleblowerAppRoot"'),
    "index.html deve conter o root whistleblowerAppRoot",
  );
  assert.ok(
    indexHtml.includes('data-view="whistleblower"'),
    "index.html deve conter botão com data-view='whistleblower'",
  );

  const mainJs = await readFile("src/main.js", "utf8");
  assert.ok(
    mainJs.includes('import "./whistleblower.js";'),
    "src/main.js deve importar whistleblower.js",
  );

  const scriptsHtml = await readFile("src/legacy/Scripts.html", "utf8");
  assert.ok(
    scriptsHtml.includes('"whistleblower"'),
    "src/legacy/Scripts.html deve incluir a rota whistleblower",
  );
});
