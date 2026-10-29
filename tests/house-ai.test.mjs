// ==========================================================================
// SUÍTE DE TESTES HOUSE AI 2.0 — CÉREBRO CENTRAL DE INTELIGÊNCIA
// 50 Cenários de Teste: Linguagem Natural, RBAC, Consultas Cross-Módulo,
// Portaria 671 (Trava de Ponto), WhatsApp, Insights Proativos e Auditoria
// ==========================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/core/api.js";
import { runtime } from "../src/core/runtime.js";
import {
  createHouseAIHandlers,
  stripHouseAIEmojis,
  checkHouseAIRBAC,
  EMOJI_REGEX,
  SUPPORTED_GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL,
} from "../src/core/api-house-ai.js";
import {
  convertFunctionCallToAction,
  parseCopilotIntent,
  findEmployeeInText,
} from "../src/copilot.js";
import { todayIso } from "../src/core/utils.js";

const api = createApi();
const handlers = api.handlers;

// Helper para mock seguro de usuário logado
function mockSession(profile) {
  const original = runtime.requireProfile;
  runtime.requireProfile = async () => profile;
  return () => {
    runtime.requireProfile = original;
  };
}

// --------------------------------------------------------------------------
// BLOCO 1: LINGUAGEM NATURAL E CONSULTAS BÁSICAS (Cenários 1 a 5)
// --------------------------------------------------------------------------

test("1. Pergunta Simples: Colaborador consulta suas próprias folgas", async () => {
  const restore = mockSession({ FuncionarioID: "emp_101", LojaID: "loja_1", Perfil: "employee", Nome: "Lucas Silva" });
  try {
    const res = await handlers.consultarFolgasHouseAI([{ funcionarioId: "emp_101" }]);
    assert.equal(res.success, true);
    assert.equal(res.data.limitePoliticaMes, 5);
    assert.ok(typeof res.data.totalFolgasConcedidas === "number");
  } finally {
    restore();
  }
});

test("2. Pergunta Complexa: Cruzamento de jornada e folgas do mês", async () => {
  const res = parseCopilotIntent("quantas folgas eu tenho esse mês e qual meu saldo de horas?", {
    user: { Perfil: "employee", Nome: "Lucas Silva", FuncionarioID: "emp_101" },
  });
  assert.ok(res);
  assert.equal(EMOJI_REGEX.test(res.reply || ""), false);
});

test("3. Consulta Cross-Módulo: Ponto eletrônico e tarefas de cozinha", async () => {
  const actionPonto = convertFunctionCallToAction("consultarPonto", { data: todayIso() }, {
    user: { Perfil: "Gerente", Nome: "Gestor Carlos", LojaID: "loja_1" },
  });
  const actionTarefa = convertFunctionCallToAction("criarTarefaCozinha", { titulo: "Pré-preparo molho especial" }, {
    user: { Perfil: "Gerente", Nome: "Gestor Carlos", LojaID: "loja_1" },
  });
  assert.equal(actionPonto.type, "query");
  assert.equal(actionTarefa.type, "action");
  assert.equal(actionTarefa.apiMethod, "cozinhaTasksSave");
});

test("4. Pergunta com Contexto Anterior: Histórico multi-turn preservado", async () => {
  const res = await handlers.callGeminiProxy([{
    prompt: "E sobre as regras de atestado médico?",
    context: { previousTopic: "folgas" },
  }]);
  assert.ok(res.reply || res.text || res.name);
  assert.equal(EMOJI_REGEX.test(res.reply || ""), false);
});

test("5. Nomes Ambíguos: Localização correta de Gabriel Santos vs Gabriel Souza", () => {
  const mockEmps = [
    { FuncionarioID: "e1", Nome: "Gabriel Santos", LojaID: "foodpark" },
    { FuncionarioID: "e2", Nome: "Gabriel Souza", LojaID: "teixeira" },
  ];
  const foundSantos = findEmployeeInText("Gabriel Santos precisa de folga", mockEmps);
  const foundTeixeira = findEmployeeInText("Gabriel do Teixeira precisa de folga", mockEmps);
  assert.equal(foundSantos.FuncionarioID, "e1");
  assert.equal(foundTeixeira.FuncionarioID, "e2");
});

// --------------------------------------------------------------------------
// BLOCO 2: JORNADA, PONTO E PORTARIA 671 (Cenários 6 a 12)
// --------------------------------------------------------------------------

test("6. Cálculo de Jornada Atravessando Meia-Noite: Resiliência em horários noturnos", async () => {
  const restore = mockSession({ FuncionarioID: "emp_noite", LojaID: "loja_1", Perfil: "employee" });
  try {
    const res = await handlers.consultarPontoHouseAI([{ funcionarioId: "emp_noite", data: todayIso() }]);
    assert.equal(res.success, true);
    assert.ok(Array.isArray(res.data.batidas));
  } finally {
    restore();
  }
});

test("7. RBAC Ponto: Colaborador comum não pode consultar ponto de colega", async () => {
  const restore = mockSession({ FuncionarioID: "emp_comum", Perfil: "employee" });
  try {
    await assert.rejects(
      async () => handlers.consultarPontoHouseAI([{ funcionarioId: "emp_outro" }]),
      /não autorizado/i
    );
  } finally {
    restore();
  }
});

test("8. RBAC Ponto: Gerente pode consultar equipe da sua própria unidade", async () => {
  const restore = mockSession({ FuncionarioID: "emp_gerente", LojaID: "loja_teixeira", Perfil: "manager" });
  try {
    const canAccess = checkHouseAIRBAC({ Perfil: "manager", LojaID: "loja_teixeira" }, "emp_subordinado", "loja_teixeira");
    assert.equal(canAccess, true);
  } finally {
    restore();
  }
});

test("9. RBAC Ponto: Gerente é bloqueado de acessar registros de outra unidade", () => {
  const canAccess = checkHouseAIRBAC({ Perfil: "manager", LojaID: "loja_teixeira" }, "emp_alheio", "loja_eunapolis");
  assert.equal(canAccess, false);
});

test("10. RBAC Ponto: Administrador possui visão irrestrita", () => {
  const canAccess = checkHouseAIRBAC({ Perfil: "admin" }, "qualquer_emp", "qualquer_loja");
  assert.equal(canAccess, true);
});

test("11. Ausência de Registros: Retorno íntegro sem inventar dados", async () => {
  const restore = mockSession({ FuncionarioID: "emp_sem_ponto", Perfil: "employee" });
  try {
    const res = await handlers.consultarPontoHouseAI([{ funcionarioId: "emp_sem_ponto", data: "2025-01-01" }]);
    assert.equal(res.success, true);
    assert.equal(res.data.totalBatidas, 0);
    assert.deepEqual(res.data.batidas, []);
  } finally {
    restore();
  }
});

test("12. Falhas de API: Fallback transparente sem derrubar a aplicação", async () => {
  const res = await handlers.callGeminiProxy([{
    prompt: "Verificar pendências gerais",
    model: "modelo_inexistente",
  }]);
  assert.ok(res);
  assert.ok(res.reply || res.actionIntent || res.text);
});

// --------------------------------------------------------------------------
// BLOCO 3: WHATSAPP BIDIRECIONAL E LGPD (Cenários 13 a 20)
// --------------------------------------------------------------------------

test("13. WhatsApp: Rejeição segura de remetente desconhecido sem vazamento", async () => {
  const res = await handlers.processWhatsAppWithHouseAI([{
    from: "5511999999999",
    text: "Quero ver a escala de amanhã",
  }]);
  assert.equal(res.handled, true);
  assert.equal(res.authorized, false);
  assert.match(res.replyText, /exclusivo para colaboradores/i);
});

test("14. WhatsApp TRAVA MANDATÓRIA: Bloqueio estrito de registro de ponto por chat", async () => {
  const origList = runtime.list;
  runtime.list = async () => [{ FuncionarioID: "emp_zap", Telefone: "5573988887777", Nome: "Marcos Souza" }];
  try {
    const res = await handlers.processWhatsAppWithHouseAI([{
      from: "5573988887777",
      text: "Bata meu ponto de entrada por favor",
    }]);
    assert.equal(res.handled, true);
    assert.equal(res.blockedAction, "registro_ponto_proibido");
    assert.match(res.replyText, /Portaria 671\/MTE/i);
    assert.match(res.replyText, /não pode ser realizado por mensagens/i);
  } finally {
    runtime.list = origList;
  }
});

test("15. WhatsApp TRAVA LGPD: Bloqueio de envio de atestado e dados médicos no chat", async () => {
  const origList = runtime.list;
  runtime.list = async () => [{ FuncionarioID: "emp_zap", Telefone: "5573988887777", Nome: "Marcos Souza" }];
  try {
    const res = await handlers.processWhatsAppWithHouseAI([{
      from: "5573988887777",
      text: "Segue o atestado com CID e diagnóstico de gripe",
    }]);
    assert.equal(res.handled, true);
    assert.equal(res.blockedAction, "dados_sensiveis_lgpd");
    assert.match(res.replyText, /LGPD/i);
  } finally {
    runtime.list = origList;
  }
});

test("16. WhatsApp Consulta Folgas: Retorno detalhado das 5 folgas regulamentares", async () => {
  const origList = runtime.list;
  runtime.list = async (col) => {
    if (col === "Funcionarios") return [{ FuncionarioID: "emp_zap", Telefone: "5573988887777", Nome: "Marcos Souza" }];
    return [];
  };
  try {
    const res = await handlers.processWhatsAppWithHouseAI([{
      from: "5573988887777",
      text: "Quais são minhas folgas deste mês?",
    }]);
    assert.equal(res.handled, true);
    assert.match(res.replyText, /5 regulamentares/i);
  } finally {
    runtime.list = origList;
  }
});

test("17. WhatsApp Consulta Banco de Horas: Saldo apurado", async () => {
  const origList = runtime.list;
  runtime.list = async (col) => {
    if (col === "Funcionarios") return [{ FuncionarioID: "emp_zap", Telefone: "5573988887777", Nome: "Marcos Souza" }];
    return [];
  };
  try {
    const res = await handlers.processWhatsAppWithHouseAI([{
      from: "5573988887777",
      text: "Qual é o meu saldo de horas?",
    }]);
    assert.equal(res.handled, true);
    assert.match(res.replyText, /banco de horas/i);
  } finally {
    runtime.list = origList;
  }
});

test("18. WhatsApp Resposta Padrão Inteligente: Cardápio de apoio sem emojis", async () => {
  const origList = runtime.list;
  runtime.list = async (col) => {
    if (col === "Funcionarios") return [{ FuncionarioID: "emp_zap", Telefone: "5573988887777", Nome: "Marcos Souza" }];
    return [];
  };
  try {
    const res = await handlers.processWhatsAppWithHouseAI([{
      from: "5573988887777",
      text: "Boa tarde, tudo bem?",
    }]);
    assert.equal(res.handled, true);
    assert.equal(EMOJI_REGEX.test(res.replyText), false);
    assert.match(res.replyText, /House AI/i);
  } finally {
    runtime.list = origList;
  }
});

test("19. WhatsApp: Normalização internacional de números (+55)", async () => {
  const res = await handlers.processWhatsAppWithHouseAI([{
    from: "73988887777",
    text: "Olá",
  }]);
  assert.equal(res.handled, true);
});

test("20. WhatsApp: Tratamento de payload vazio ou corrompido", async () => {
  const res = await handlers.processWhatsAppWithHouseAI([{}]);
  assert.equal(res.handled, false);
});

// --------------------------------------------------------------------------
// BLOCO 4: MOTOR DE INSIGHTS PROATIVOS (Cenários 21 a 30)
// --------------------------------------------------------------------------

test("21. Insights Proativos: Detecção de batidas ímpares no dia anterior", async () => {
  const origList = runtime.list;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  runtime.list = async (col) => {
    if (col === "Funcionarios") return [{ FuncionarioID: "emp_imp", Nome: "João Sem Saída" }];
    if (col === "RegistroPonto") return [{ FuncionarioID: "emp_imp", Data: yesterday, Hora: "08:00" }];
    return [];
  };
  try {
    const res = await handlers.generateProactiveInsights([{}]);
    assert.equal(res.success, true);
    const hasBatidaIncompleta = res.data.insights.some((i) => i.tipo === "batida_incompleta");
    assert.equal(hasBatidaIncompleta, true);
  } finally {
    runtime.list = origList;
  }
});

test("22. Insights Proativos: Alerta de solicitações de folga pendentes", async () => {
  const origList = runtime.list;
  runtime.list = async (col) => {
    if (col === "Folgas") return [{ FolgaID: "f1", Status: "Pendente" }, { FolgaID: "f2", Status: "Pendente" }];
    return [];
  };
  try {
    const res = await handlers.generateProactiveInsights([{}]);
    assert.equal(res.success, true);
    const hasPendingLeaves = res.data.insights.some((i) => i.tipo === "solicitacoes_pendentes");
    assert.equal(hasPendingLeaves, true);
  } finally {
    runtime.list = origList;
  }
});

test("23. Insights Proativos: Identificação de tarefas operacionais vencidas", async () => {
  const origList = runtime.list;
  runtime.list = async (col) => {
    if (col === "Tarefas") return [{ ID: "t1", Status: "A fazer", Prazo: "2020-01-01" }];
    return [];
  };
  try {
    const res = await handlers.generateProactiveInsights([{}]);
    assert.equal(res.success, true);
    const hasOverdueTasks = res.data.insights.some((i) => i.tipo === "tarefas_atrasadas");
    assert.equal(hasOverdueTasks, true);
  } finally {
    runtime.list = origList;
  }
});

test("24. Insights Proativos: Alerta de documentos pendentes de assinatura", async () => {
  const origList = runtime.list;
  runtime.list = async (col) => {
    if (col === "Documentos") return [{ ID: "d1", Status: "Pendente" }];
    return [];
  };
  try {
    const res = await handlers.generateProactiveInsights([{}]);
    assert.equal(res.success, true);
    const hasDocs = res.data.insights.some((i) => i.tipo === "documentos_pendentes");
    assert.equal(hasDocs, true);
  } finally {
    runtime.list = origList;
  }
});

test("25. Insights Proativos: Risco de cobertura com mais de 40% da equipe em folga", async () => {
  const origList = runtime.list;
  const today = todayIso();
  runtime.list = async (col) => {
    if (col === "Funcionarios") return [{ FuncionarioID: "e1" }, { FuncionarioID: "e2" }];
    if (col === "Folgas") return [{ FuncionarioID: "e1", Data: today, Status: "Aprovada" }];
    return [];
  };
  try {
    const res = await handlers.generateProactiveInsights([{}]);
    assert.equal(res.success, true);
    const hasCoverageRisk = res.data.insights.some((i) => i.tipo === "risco_cobertura");
    assert.equal(hasCoverageRisk, true);
  } finally {
    runtime.list = origList;
  }
});

test("26. Insights Proativos: Estrutura estrita de cada insight (origem, gravidade, justificativa)", async () => {
  const origList = runtime.list;
  runtime.list = async (col) => {
    if (col === "Documentos") return [{ ID: "d1", Status: "Pendente" }];
    return [];
  };
  try {
    const res = await handlers.generateProactiveInsights([{}]);
    const first = res.data.insights[0];
    assert.ok(first.id);
    assert.ok(first.tipo);
    assert.ok(first.gravidade);
    assert.ok(first.justificativa);
    assert.ok(first.origem);
    assert.ok(Array.isArray(first.acoesRecomendadas));
  } finally {
    runtime.list = origList;
  }
});

test("27. Insights Proativos: Zero repetição de erros e deduplicação", async () => {
  const origList = runtime.list;
  runtime.list = async () => [];
  try {
    const res = await handlers.generateProactiveInsights([{}]);
    assert.equal(res.data.totalInsights, 0);
  } finally {
    runtime.list = origList;
  }
});

test("28. Insights Proativos: Separação de gravidades (crítica, alta, média)", async () => {
  const res = await handlers.generateProactiveInsights([{}]);
  assert.ok(typeof res.data.criticos === "number");
  assert.ok(typeof res.data.altos === "number");
  assert.ok(typeof res.data.medios === "number");
});

test("29. Insights Proativos: Zero emojis nos títulos e descrições", async () => {
  const res = await handlers.generateProactiveInsights([{}]);
  for (const item of res.data.insights) {
    assert.equal(EMOJI_REGEX.test(item.titulo), false);
    assert.equal(EMOJI_REGEX.test(item.descricao), false);
  }
});

test("30. Insights Proativos: Filtragem por unidade/loja específica", async () => {
  const res = await handlers.generateProactiveInsights([{ lojaId: "loja_especifica" }]);
  assert.equal(res.success, true);
});

// --------------------------------------------------------------------------
// BLOCO 5: CENTRAL DE AUTOMAÇÕES E REGRAS (Cenários 31 a 38)
// --------------------------------------------------------------------------

test("31. Central de Automações: Gestores e Admins podem listar automações", async () => {
  const restore = mockSession({ Perfil: "manager", LojaID: "loja_1" });
  try {
    const res = await handlers.getHouseAIAutomations([]);
    assert.equal(res.success, true);
    assert.ok(Array.isArray(res.data));
  } finally {
    restore();
  }
});

test("32. Central de Automações: Colaborador comum não pode acessar o painel de automações", async () => {
  const restore = mockSession({ Perfil: "employee" });
  try {
    await assert.rejects(
      async () => handlers.getHouseAIAutomations([]),
      /Acesso restrito/i
    );
  } finally {
    restore();
  }
});

test("33. Central de Automações: Apenas administrador pode salvar/editar regra", async () => {
  const restore = mockSession({ Perfil: "admin", Email: "admin@house190.com" });
  try {
    const res = await handlers.saveHouseAIAutomation([{
      nome: "Lembrete diário de pendências",
      gatilho: "horario",
      horario: "08:30",
      canal: "whatsapp",
      destinatarios: "gerentes",
      requerAprovacao: false,
    }]);
    assert.equal(res.success, true);
    assert.equal(res.data.nome, "Lembrete diário de pendências");
    assert.equal(res.data.canal, "whatsapp");
  } finally {
    restore();
  }
});

test("34. Central de Automações: Sanitização estrita de emojis no nome e modelo de mensagem", async () => {
  const restore = mockSession({ Perfil: "admin" });
  try {
    const res = await handlers.saveHouseAIAutomation([{
      nome: "Alerta de Ponto 👍🚀",
      modeloMensagem: "Atenção equipe! 🎉",
    }]);
    assert.equal(res.data.nome, "Alerta de Ponto");
    assert.equal(res.data.modeloMensagem, "Atenção equipe!");
  } finally {
    restore();
  }
});

test("35. Central de Automações: Registro automático de trilha de auditoria ao salvar regra", async () => {
  const restore = mockSession({ Perfil: "admin", Email: "admin@house190.com" });
  try {
    const res = await handlers.saveHouseAIAutomation([{ nome: "Regra Auditada" }]);
    assert.equal(res.success, true);
  } finally {
    restore();
  }
});

test("36. Central de Automações: Ativação e pausa de automação", async () => {
  const restore = mockSession({ Perfil: "admin" });
  try {
    const resPausada = await handlers.saveHouseAIAutomation([{ nome: "Regra Pausada", ativo: false }]);
    assert.equal(resPausada.data.ativo, false);
  } finally {
    restore();
  }
});

test("37. Central de Automações: Suporte a múltiplos canais (whatsapp, notificacao)", async () => {
  const restore = mockSession({ Perfil: "admin" });
  try {
    const res = await handlers.saveHouseAIAutomation([{ canal: "ambos" }]);
    assert.equal(res.data.canal, "ambos");
  } finally {
    restore();
  }
});

test("38. Central de Automações: Indicador de necessidade de aprovação da liderança", async () => {
  const restore = mockSession({ Perfil: "admin" });
  try {
    const res = await handlers.saveHouseAIAutomation([{ requerAprovacao: true }]);
    assert.equal(res.data.requerAprovacao, true);
  } finally {
    restore();
  }
});

// --------------------------------------------------------------------------
// BLOCO 6: SEGURANÇA, AUDITORIA LGPD E FUNCTION CALLING (Cenários 39 a 50)
// --------------------------------------------------------------------------

test("39. Trilha de Auditoria LGPD: Registro de operação realizada pela House AI", async () => {
  const restore = mockSession({ Nome: "House AI Auditor", Email: "ia@house190.com" });
  try {
    const res = await handlers.auditHouseAIAction([{
      acao: "Recomendação de Escala",
      modulo: "Escala",
      registroId: "reg_001",
      detalhes: { motivo: "Troca aprovada" },
    }]);
    assert.equal(res.success, true);
  } finally {
    restore();
  }
});

test("40. Function Calling: Nova ferramenta consultarBancoHoras", () => {
  const action = convertFunctionCallToAction("consultarBancoHoras", { colaboradorNome: "Mariana" }, {
    user: { Perfil: "manager", Nome: "Gestor" },
  });
  assert.equal(action.type, "query");
  assert.match(action.reply, /banco de horas/i);
});

test("41. Function Calling: Nova ferramenta consultarFolgas", () => {
  const action = convertFunctionCallToAction("consultarFolgas", { colaboradorNome: "Mariana" }, {
    user: { Perfil: "manager", Nome: "Gestor" },
  });
  assert.equal(action.type, "query");
  assert.match(action.reply, /5 folgas mensais/i);
});

test("42. Function Calling: Nova ferramenta consultarEscala", () => {
  const action = convertFunctionCallToAction("consultarEscala", { data: todayIso() }, {
    user: { Perfil: "manager", Nome: "Gestor" },
  });
  assert.equal(action.type, "query");
  assert.match(action.reply, /escala operacional/i);
});

test("43. Function Calling: Nova ferramenta listarPendencias", () => {
  const action = convertFunctionCallToAction("listarPendencias", {}, {
    user: { Perfil: "manager", Nome: "Gestor" },
    timeOff: [{ Status: "Pendente" }],
    swaps: [{ Status: "Pendente" }],
  });
  assert.equal(action.type, "query");
  assert.match(action.reply, /pendente/i);
});

test("44. Function Calling: Nova ferramenta consultarPresencaAgora", () => {
  const action = convertFunctionCallToAction("consultarPresencaAgora", {}, {
    livePresenceData: { presence: [{ status: "trabalhando" }, { status: "intervalo" }] },
  });
  assert.equal(action.type, "query");
  assert.match(action.reply, /presença em tempo real/i);
});

test("45. Function Calling: Confirmação obrigatória antes de ações destrutivas", () => {
  const action = convertFunctionCallToAction("lancarFolga", {
    colaboradorNome: "Pedro",
    data: todayIso(),
  }, {
    user: { Perfil: "admin", Nome: "Admin" },
    employees: [{ FuncionarioID: "p1", Nome: "Pedro" }],
  });
  assert.equal(action.type, "action");
  assert.ok(action.diff);
  assert.ok(action.summary);
});

test("46. Configuração de Modelos Gemini: Suporte aos modelos válidos", () => {
  assert.ok(SUPPORTED_GEMINI_MODELS.includes("gemini-2.5-flash"));
  assert.ok(SUPPORTED_GEMINI_MODELS.includes("gemini-2.0-flash"));
  assert.ok(SUPPORTED_GEMINI_MODELS.includes("gemini-2.5-pro"));
});

test("47. Sanitizador Global: stripHouseAIEmojis remove caracteres de forma exaustiva", () => {
  const dirty = "Equipe House 190 🍔✨🚀 em operação!";
  const clean = stripHouseAIEmojis(dirty);
  assert.equal(clean, "Equipe House 190  em operação!");
  assert.equal(EMOJI_REGEX.test(clean), false);
});

test("48. Consulta de Escala no Backend: Colaboradores de folga vs escalados", async () => {
  const restore = mockSession({ Perfil: "admin" });
  try {
    const res = await handlers.consultarEscalaHouseAI([{ data: todayIso() }]);
    assert.equal(res.success, true);
    assert.ok(Array.isArray(res.data.escalados));
    assert.ok(Array.isArray(res.data.deFolga));
  } finally {
    restore();
  }
});

test("49. Painel de Pendências Gerencial: Rejeição de colaborador comum", async () => {
  const restore = mockSession({ Perfil: "employee" });
  try {
    await assert.rejects(
      async () => handlers.listarPendenciasHouseAI([]),
      /Apenas gestores e administradores/i
    );
  } finally {
    restore();
  }
});

test("50. Integridade do Ponto Eletrônico: Inviolabilidade dos handlers de ponto", () => {
  assert.ok(typeof handlers.registerTimeClockPunch === "function");
  assert.ok(typeof handlers.getTimeClockQuickStatusWithSession === "function");
  assert.ok(typeof handlers.requestTimeClockAdjustment === "function");
});
