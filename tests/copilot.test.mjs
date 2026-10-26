import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseCopilotIntent,
  getUserRole,
  getUserName,
  executeCopilotAction,
  convertFunctionCallToAction,
  getGeminiApiKey,
  setGeminiApiKey,
  getGeminiModel,
  setGeminiModel,
  DEFAULT_GEMINI_MODEL,
  SUPPORTED_GEMINI_MODELS,
  callGeminiCopilot,
  GEMINI_TOOLS,
  SCREEN_KNOWLEDGE,
  getLivePresenceItems,
  isPersonWorking,
  isPersonOnBreak,
  getLivePresenceTotals,
  RH_POLICIES,
  hrAdapter,
  extractDateFromText,
  extractTimeFromText,
  extractPunchType,
  extractReasonFromText,
  copilotChatHistory,
  clearCopilotChatHistory,
} from "../src/copilot.js";

// Mock de dados operacionais
const mockEmployees = [
  { FuncionarioID: "emp_1", Nome: "Gabriel Silva", LojaID: "loja_matriz", Turno: "Manhã", FolgaFixaSemanal: "Segunda-feira" },
  { FuncionarioID: "emp_2", Nome: "Pedro Santos", LojaID: "loja_matriz", Turno: "Tarde", FolgaFixaSemanal: "Terça-feira" },
  { FuncionarioID: "emp_3", Nome: "Maria Souza", LojaID: "loja_filial", Turno: "Noite", FolgaFixaSemanal: "Quarta-feira" },
  { FuncionarioID: "emp_4", Nome: "Ana Cláudia", LojaID: "foodpark", NomeLoja: "House Foodpark", Turno: "Manhã", FolgaFixaSemanal: "Quinta-feira" },
];

const mockTasks = [
  { ID: "t1", TarefaID: "t1", TITULO: "Limpeza do freezer", RESPONSAVEL_ID: "emp_1", STATUS: "A fazer", LojaID: "loja_matriz" },
  { ID: "t2", TarefaID: "t2", TITULO: "Higienização bancada", RESPONSAVEL_ID: "emp_2", STATUS: "Em andamento", LojaID: "loja_matriz" },
];

const mockSwaps = [
  {
    TrocaID: "sw_1",
    NomeFuncionarioOrigem: "Gabriel Silva",
    FuncionarioOrigemID: "emp_1",
    NomeFuncionarioDestino: "Pedro Santos",
    FuncionarioDestinoID: "emp_2",
    LojaID: "loja_matriz",
    Status: "Aguardando gestor",
    DataFolgaOrigem: "2026-10-20",
    DataFolgaDestino: "2026-10-21",
  },
];

const futureLeaveDate = new Date(Date.now() + 86400000 * 2);
const futureLeaveIso = futureLeaveDate.toISOString().slice(0, 10);
const futureLeaveDisplay = `${String(futureLeaveDate.getDate()).padStart(2, "0")}/${String(futureLeaveDate.getMonth() + 1).padStart(2, "0")}/${futureLeaveDate.getFullYear()}`;

const mockTimeOff = [
  { FuncionarioID: "emp_1", DataInicio: futureLeaveIso, TipoFolga: "Folga regular", Status: "Aprovada" },
];

test("Copiloto: detecção correta de papéis RBAC", () => {
  assert.equal(getUserRole({ Perfil: "Administrador" }), "admin");
  assert.equal(getUserRole({ Perfil: "Gerente Geral" }), "manager");
  assert.equal(getUserRole({ Perfil: "Responsável de Loja" }), "manager");
  assert.equal(getUserRole({ Perfil: "Funcionário" }), "employee");
  assert.equal(getUserRole({ Perfil: "Cozinheiro" }), "employee");
  assert.equal(getUserRole(null), "employee");
});

test("Copiloto RBAC: Colaborador é bloqueado de ações de gestão", () => {
  const employeeUser = { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Funcionário", LojaID: "loja_matriz" };
  const ctx = { user: employeeUser, employees: mockEmployees, tasks: mockTasks, swaps: mockSwaps };

  // Tentativa de criar tarefa para colega
  const res1 = parseCopilotIntent("Cria tarefa para Pedro limpar a bancada", ctx);
  assert.equal(res1.type, "error");
  assert.match(res1.message, /requer permissão de Gerente ou Administrador/i);

  // Tentativa de aprovar troca
  const res2 = parseCopilotIntent("Aprova a troca do Gabriel", ctx);
  assert.equal(res2.type, "error");
  assert.match(res2.message, /exclusiva de Gerentes e Administradores/i);

  // Tentativa de alterar escala/turno
  const res3 = parseCopilotIntent("Muda o turno do Pedro para Noite", ctx);
  assert.equal(res3.type, "error");
  assert.match(res3.message, /requerem perfil de Gerente ou Administrador/i);

  // Tentativa de alterar folga fixa
  const res4 = parseCopilotIntent("Muda a folga fixa do Pedro para Sexta", ctx);
  assert.equal(res4.type, "error");
  assert.match(res4.message, /requer permissão gerencial/i);
});

test("Copiloto RBAC: Gerente tem escopo restrito à sua própria loja", () => {
  const managerUser = { FuncionarioID: "mgr_1", Nome: "Gestor Matriz", Perfil: "Gerente", LojaID: "loja_matriz" };
  const ctx = { user: managerUser, employees: mockEmployees, tasks: mockTasks, swaps: mockSwaps };

  // Permitido na própria loja
  const okTask = parseCopilotIntent("Cria tarefa para Gabriel limpar o forno hoje às 17h prioridade alta", ctx);
  assert.equal(okTask.type, "action");
  assert.equal(okTask.apiMethod, "cozinhaTasksSave");
  assert.equal(okTask.details.responsavel, "Gabriel Silva");

  // Bloqueado para funcionário de outra unidade (Maria pertence a loja_filial)
  const blockedTask = parseCopilotIntent("Cria tarefa para Maria limpar a bancada", ctx);
  assert.equal(blockedTask.type, "error");
  assert.match(blockedTask.message, /pertence a outra unidade/i);

  // Bloqueado para alterar turno de outra unidade
  const blockedShift = parseCopilotIntent("Muda o turno da Maria para Manhã", ctx);
  assert.equal(blockedShift.type, "error");
  assert.match(blockedShift.message, /pertence a outra unidade/i);
});

test("Copiloto Ações: Criação de tarefa gera card com diff e dados estruturados", () => {
  const managerUser = { FuncionarioID: "mgr_1", Nome: "Gestor Matriz", Perfil: "Gerente", LojaID: "loja_matriz" };
  const ctx = { user: managerUser, employees: mockEmployees, tasks: mockTasks };

  const res = parseCopilotIntent("Nova tarefa para Pedro organização do estoque prioridade alta", ctx);
  assert.equal(res.type, "action");
  assert.equal(res.actionType, "create_task");
  assert.equal(res.apiMethod, "cozinhaTasksSave");
  assert.equal(res.details.responsavel, "Pedro Santos");
  assert.equal(res.details.prioridade, "Alta");
  assert.ok(res.diff.length >= 3);
  assert.ok(res.summary.includes("Pedro Santos"));
});

test("Copiloto Ações: Alteração de turno gera diff de antes e depois", () => {
  const managerUser = { FuncionarioID: "mgr_1", Nome: "Gestor Matriz", Perfil: "Gerente", LojaID: "loja_matriz" };
  const ctx = { user: managerUser, employees: mockEmployees };

  const res = parseCopilotIntent("Muda o turno de Gabriel para Noite", ctx);
  assert.equal(res.type, "action");
  assert.equal(res.actionType, "update_shift");
  assert.equal(res.apiMethod, "updateEmployee");
  assert.equal(res.details.newShift, "Noite");

  const diffCurrent = res.diff.find((d) => d.label === "Turno Atual");
  const diffNew = res.diff.find((d) => d.label === "Novo Turno");
  assert.equal(diffCurrent.value, "Manhã");
  assert.equal(diffNew.value, "Noite");
});

test("Copiloto Ações: Colaborador pode solicitar folga e concluir sua própria tarefa", () => {
  const employeeUser = { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Funcionário", LojaID: "loja_matriz" };
  const ctx = { user: employeeUser, employees: mockEmployees, tasks: mockTasks };

  // Solicitar folga
  const timeOffRes = parseCopilotIntent("Solicitar folga dia 28/10/2026 motivo consulta oftalmológica", ctx);
  assert.equal(timeOffRes.type, "action");
  assert.equal(timeOffRes.actionType, "request_timeoff");
  assert.equal(timeOffRes.apiMethod, "createEmployeeTimeOffRequest");
  assert.equal(timeOffRes.details.isoDate, "2026-10-28");
  assert.equal(timeOffRes.details.reason, "consulta oftalmológica");

  // Concluir própria tarefa
  const finishRes = parseCopilotIntent("Concluir tarefa limpeza do freezer", ctx);
  assert.equal(finishRes.type, "action");
  assert.equal(finishRes.actionType, "finish_task");
  assert.equal(finishRes.apiMethod, "cozinhaTasksSave");
  assert.equal(finishRes.apiArgs[0].STATUS, "Concluída");
});

test("Copiloto Consultas: Consulta de próxima folga e saldo de horas em memória (zero Firebase)", () => {
  const employeeUser = { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Funcionário", LojaID: "loja_matriz" };
  const ctx = {
    user: employeeUser,
    timeOff: mockTimeOff,
    hourBalance: { totalMinutos: 150 },
  };

  const folgaRes = parseCopilotIntent("Quando é minha próxima folga?", ctx);
  assert.equal(folgaRes.type, "query");
  assert.match(folgaRes.reply, new RegExp(futureLeaveDisplay.replace(/\//g, "\\/")));

  const saldoRes = parseCopilotIntent("Qual é o meu saldo de horas?", ctx);
  assert.equal(saldoRes.type, "query");
  assert.match(saldoRes.reply, /\+2h 30m/);
});

test("Copiloto Execução: executeCopilotAction invoca api.invoke e dispara atualização", async () => {
  let invokedMethod = "";
  let invokedArgs = null;
  const mockApi = {
    async invoke(method, args) {
      invokedMethod = method;
      invokedArgs = args;
      return { ok: true };
    },
  };

  const action = {
    actionType: "create_task",
    apiMethod: "cozinhaTasksSave",
    apiArgs: [{ TITULO: "Teste" }],
  };

  const res = await executeCopilotAction(action, mockApi);
  assert.equal(res.ok, true);
  assert.equal(invokedMethod, "cozinhaTasksSave");
  assert.deepEqual(invokedArgs, [{ TITULO: "Teste" }]);
});

test("Gemini Flash: Function Calling mapeia ferramentas para ações operacionais com RBAC", () => {
  const managerUser = { FuncionarioID: "mgr_1", Nome: "Gestor Matriz", Perfil: "Gerente", LojaID: "loja_matriz" };
  const ctx = { user: managerUser, employees: mockEmployees, tasks: mockTasks, swaps: mockSwaps };

  // Ferramenta criarTarefaCozinha
  const taskAction = convertFunctionCallToAction(
    "criarTarefaCozinha",
    { titulo: "Higienizar coifa", responsavelNome: "Gabriel", prioridade: "Alta", prazo: "hoje às 20h" },
    ctx,
  );
  assert.equal(taskAction.type, "action");
  assert.equal(taskAction.actionType, "create_task");
  assert.equal(taskAction.apiMethod, "cozinhaTasksSave");
  assert.equal(taskAction.details.responsavel, "Gabriel Silva");
  assert.equal(taskAction.details.prioridade, "Alta");

  // Ferramenta alterarTurno
  const shiftAction = convertFunctionCallToAction(
    "alterarTurno",
    { nome: "Pedro", novoTurno: "Noite" },
    ctx,
  );
  assert.equal(shiftAction.type, "action");
  assert.equal(shiftAction.actionType, "update_shift");
  assert.equal(shiftAction.apiMethod, "updateEmployee");
  assert.equal(shiftAction.details.newShift, "Noite");

  // Bloqueio RBAC para colaborador no Gemini Function Calling
  const employeeUser = { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Funcionário", LojaID: "loja_matriz" };
  const empCtx = { user: employeeUser, employees: mockEmployees };
  const blockedGemini = convertFunctionCallToAction(
    "criarTarefaCozinha",
    { titulo: "Test", responsavelNome: "Pedro" },
    empCtx,
  );
  assert.equal(blockedGemini.type, "error");
  assert.match(blockedGemini.message, /requer permissão de Gerente ou Administrador/i);
});

test("Gemini Flash: Fallback para o motor local quando sem chave configurada", async () => {
  const employeeUser = { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Funcionário", LojaID: "loja_matriz" };
  const ctx = { user: employeeUser, timeOff: mockTimeOff };

  // Sem chave: chama callGeminiCopilot e obtém resultado do motor local diretamente
  const res = await callGeminiCopilot("Quando é minha próxima folga?", ctx);
  assert.equal(res.type, "query");
  assert.match(res.reply, new RegExp(futureLeaveDisplay.replace(/\//g, "\\/")));
});

test("Copiloto: SCREEN_KNOWLEDGE cobre todas as telas do sistema com regras e chips", () => {
  const requiredScreens = [
    "holidays",
    "timeoff",
    "tasks",
    "timeclock",
    "absences",
    "pending-center",
    "documents",
    "hour-balances",
    "live-team",
    "takeat-credit",
    "employees",
    "calendar",
    "stores",
    "operations",
    "access",
    "dashboard",
  ];

  for (const s of requiredScreens) {
    const info = SCREEN_KNOWLEDGE[s];
    assert.ok(info, `Tela ${s} deve constar no SCREEN_KNOWLEDGE`);
    assert.ok(info.title, `Tela ${s} deve ter título`);
    assert.ok(info.summary, `Tela ${s} deve ter resumo`);
    assert.ok(info.rules, `Tela ${s} deve ter regras operacionais`);
    assert.ok(info.chips, `Tela ${s} deve ter chips configurados`);
    assert.ok(Array.isArray(info.chips.employee) || Array.isArray(info.chips.admin), `Tela ${s} deve ter lista de chips`);
  }
});

test("Copiloto: consulta 'como funciona esta tela' retorna conhecimento contextual da tela ativa", () => {
  const ctx = {
    user: { Perfil: "Administrador" },
    currentView: "holidays",
  };

  const res = parseCopilotIntent("como funciona esta tela", ctx);
  assert.equal(res.type, "query");
  assert.match(res.reply, /Feriados e Pontos Facultativos/i);
  assert.match(res.reply, /Apenas administradores podem cadastrar/i);
});

test("Copiloto: consulta 'como solicitar folga' orienta o usuário e não dá erro de comando não compreendido", () => {
  const ctx = {
    user: { Perfil: "Funcionário" },
    currentView: "timeoff",
  };

  const res = parseCopilotIntent("Como solicitar folga?", ctx);
  assert.equal(res.type, "query");
  assert.match(res.reply, /Como solicitar folga no Folgas 3.0/i);
  assert.match(res.reply, /Solicitar folga dia DD\/MM\/AAAA/i);
});

test("Copiloto: saldo de horas arredonda minutos decimais e não exibe dízimas", () => {
  const ctx = {
    user: { Perfil: "Funcionário" },
    hourBalance: { totalMinutos: -16673.084349999997 },
  };

  const res = parseCopilotIntent("Qual é o meu saldo de horas?", ctx);
  assert.equal(res.type, "query");
  assert.match(res.reply, /-277h 53m/);
  assert.doesNotMatch(res.reply, /\d+\.\d+/, "Não deve conter números decimais com ponto");
});

test("Copiloto Ações: Administrador pode cadastrar feriado com crédito automático", () => {
  const adminUser = { Perfil: "Administrador", FuncionarioID: "adm_1", Nome: "Diretor" };
  const ctx = { user: adminUser };

  // Local parser
  const resLocal = parseCopilotIntent("Cadastrar feriado Tiradentes dia 21/04/2026 Nacional", ctx);
  assert.equal(resLocal.type, "action");
  assert.equal(resLocal.apiMethod, "createHoliday");
  assert.equal(resLocal.details.isoDate, "2026-04-21");
  assert.equal(resLocal.details.tipo, "Nacional");
  assert.match(resLocal.summary, /Tiradentes/i);

  // Gemini tool function calling
  const resGemini = convertFunctionCallToAction(
    "cadastrarFeriado",
    { nome: "Consciência Negra", data: "2026-11-20", tipo: "Nacional" },
    ctx,
  );
  assert.equal(resGemini.type, "action");
  assert.equal(resGemini.apiMethod, "createHoliday");
  assert.equal(resGemini.details.isoDate, "2026-11-20");

  // Bloqueio para colaborador
  const empCtx = { user: { Perfil: "Funcionário" } };
  const resBlocked = parseCopilotIntent("Cadastrar feriado Teste dia 21/04/2026", empCtx);
  assert.equal(resBlocked.type, "error");
  assert.match(resBlocked.message, /exclusivo para o perfil de Administrador/i);
});

test("Copiloto Ações: Gerente pode justificar ausência na sua loja e é bloqueado em outra", () => {
  const mgrUser = { Perfil: "Gerente", FuncionarioID: "mgr_1", Nome: "Gestor", LojaID: "loja_matriz" };
  const ctx = { user: mgrUser, employees: mockEmployees };

  // Sucesso na própria loja
  const resLocal = parseCopilotIntent("Justificar falta de Gabriel dia 10/10/2026 motivo Atestado", ctx);
  assert.equal(resLocal.type, "action");
  assert.equal(resLocal.apiMethod, "justifyMissedTimeClockDay");
  assert.equal(resLocal.details.empId, "emp_1");
  assert.equal(resLocal.details.tipo, "Atestado");

  // Bloqueado em outra loja (Maria é de loja_filial)
  const resBlockedStore = parseCopilotIntent("Justificar falta de Maria dia 10/10/2026 motivo Atestado", ctx);
  assert.equal(resBlockedStore.type, "error");
  assert.match(resBlockedStore.message, /pertence a outra unidade/i);

  // Bloqueado para colaborador
  const empCtx = { user: { Perfil: "Funcionário" }, employees: mockEmployees };
  const resBlockedEmp = parseCopilotIntent("Justificar falta de Gabriel dia 10/10/2026", empCtx);
  assert.equal(resBlockedEmp.type, "error");
  assert.match(resBlockedEmp.message, /requer perfil de Gerente ou Administrador/i);
});

test("Copiloto Presença: getLivePresenceItems extrai corretamente listas de presença em objeto ou array", () => {
  // Formato objeto retornado por calculateLivePresence
  const objPresence = {
    date: "2026-10-14",
    presence: [
      { FuncionarioID: "1", Nome: "Gabriel", status: "trabalhando", LojaID: "loja_1" },
      { FuncionarioID: "2", Nome: "Mariana", status: "intervalo", LojaID: "loja_2" },
      { FuncionarioID: "3", Nome: "Pedro", status: "ausente", LojaID: "loja_1" },
    ],
    totals: { trabalhando: 1, intervalo: 1, ausente: 1, total: 3 },
  };

  const items = getLivePresenceItems(objPresence);
  assert.equal(items.length, 3);
  assert.equal(isPersonWorking(items[0]), true);
  assert.equal(isPersonOnBreak(items[1]), true);
  assert.equal(isPersonWorking(items[2]), false);

  const totals = getLivePresenceTotals(objPresence);
  assert.equal(totals.trabalhando, 1);
  assert.equal(totals.intervalo, 1);
  assert.equal(totals.ausente, 1);

  // Formato array direto
  const arrPresence = [
    { FuncionarioID: "4", Nome: "Lucas", status: "Trabalhando", LojaID: "loja_1" },
    { FuncionarioID: "5", Nome: "Carlos", status: "Em serviço", LojaID: "loja_2" },
  ];
  const arrItems = getLivePresenceItems(arrPresence);
  assert.equal(arrItems.length, 2);
  assert.equal(isPersonWorking(arrItems[0]), true);
  assert.equal(isPersonWorking(arrItems[1]), true);
});

test("Copiloto Presença: 'quem ta trabalhando na house hoje ?' lista os 9 colaboradores agrupados por loja para Admin", () => {
  const adminUser = { Perfil: "Administrador", FuncionarioID: "adm_1", Nome: "GLEUCE DIAS DE SOUZA" };
  const mockPresenceData = {
    date: "2026-10-14",
    presence: [
      { FuncionarioID: "p1", Nome: "Gabriel Silva", NomeLoja: "House Food Park", LojaID: "loja_fp", status: "trabalhando", Cargo: "Cozinha", entryTime: "16:00", elapsedTexto: "4h 27min" },
      { FuncionarioID: "p2", Nome: "Lucas Mendes", NomeLoja: "House Food Park", LojaID: "loja_fp", status: "trabalhando", Cargo: "Chapa", entryTime: "16:30", elapsedTexto: "3h 57min" },
      { FuncionarioID: "p3", Nome: "Ana Souza", NomeLoja: "House Food Park", LojaID: "loja_fp", status: "trabalhando", Cargo: "Atendimento", entryTime: "16:45", elapsedTexto: "3h 42min" },
      { FuncionarioID: "p4", Nome: "Carlos Pereira", NomeLoja: "House Food Park", LojaID: "loja_fp", status: "trabalhando", Cargo: "Cozinha", entryTime: "17:00", elapsedTexto: "3h 27min" },
      { FuncionarioID: "p5", Nome: "Beatriz Lima", NomeLoja: "House Food Park", LojaID: "loja_fp", status: "trabalhando", Cargo: "Caixa", entryTime: "17:15", elapsedTexto: "3h 12min" },
      { FuncionarioID: "p6", Nome: "Rodrigo Santos", NomeLoja: "House Food Park", LojaID: "loja_fp", status: "trabalhando", Cargo: "Auxiliar", entryTime: "17:30", elapsedTexto: "2h 57min" },
      { FuncionarioID: "p7", Nome: "Mariana Costa", NomeLoja: "House 190 Teixeira", LojaID: "loja_tx", status: "trabalhando", Cargo: "Atendimento", entryTime: "16:00", elapsedTexto: "4h 27min" },
      { FuncionarioID: "p8", Nome: "Felipe Alves", NomeLoja: "House 190 Teixeira", LojaID: "loja_tx", status: "trabalhando", Cargo: "Cozinha", entryTime: "16:15", elapsedTexto: "4h 12min" },
      { FuncionarioID: "p9", Nome: "Juliana Rocha", NomeLoja: "House 190 Teixeira", LojaID: "loja_tx", status: "trabalhando", Cargo: "Gerência", entryTime: "15:30", elapsedTexto: "4h 57min" },
      { FuncionarioID: "p10", Nome: "Thiago Oliveira", NomeLoja: "House Food Park", LojaID: "loja_fp", status: "intervalo", Cargo: "Cozinha", breakReturnTime: "21:00" },
    ],
    totals: { trabalhando: 9, intervalo: 1, ausente: 11, alertas: 5 },
  };

  const ctx = { user: adminUser, livePresenceData: mockPresenceData };

  // Frase informal dita pelo usuário no print:
  const res = parseCopilotIntent("quem ta trabalhando na house hoje ?", ctx);
  assert.equal(res.type, "query");
  assert.match(res.reply, /Colaboradores em atividade agora \(9\)/i);
  assert.match(res.reply, /House Food Park \(6\)/i);
  assert.match(res.reply, /House 190 Teixeira \(3\)/i);
  assert.match(res.reply, /Gabriel Silva/i);
  assert.match(res.reply, /4h 27min em turno/i);
  assert.match(res.reply, /Thiago Oliveira/i);
  assert.match(res.reply, /Colaboradores em intervalo \(1\)/i);

  // Variação rápida do chip
  const resChip = parseCopilotIntent("Quem está trabalhando agora?", ctx);
  assert.equal(resChip.type, "query");
  assert.match(resChip.reply, /Colaboradores em atividade agora \(9\)/i);

  // Filtro específico para uma das unidades
  const resFp = parseCopilotIntent("quem ta trabalhando no food park", ctx);
  assert.equal(resFp.type, "query");
  assert.match(resFp.reply, /Colaboradores em atividade agora \(6\)/i);
  assert.match(resFp.reply, /Gabriel Silva/i);
  assert.doesNotMatch(resFp.reply, /Mariana Costa/i);
});

test("Copiloto Decisão: 'o que precisa da minha decisão' e 'resumo do painel' apresentam resumo operacional completo", () => {
  const adminUser = { Perfil: "Administrador", FuncionarioID: "adm_1", Nome: "GLEUCE DIAS DE SOUZA" };
  const mockPresenceData = {
    date: "2026-10-14",
    presence: [],
    totals: { trabalhando: 9, intervalo: 0, ausente: 11, alertas: 5 },
  };

  const ctx = {
    user: adminUser,
    livePresenceData: mockPresenceData,
    tasks: mockTasks,
    swaps: mockSwaps,
    timeOff: [{ Status: "Pendente" }, { Status: "Aprovada" }],
  };

  const res = parseCopilotIntent("o que precisa da minha decisão", ctx);
  assert.equal(res.type, "query");
  assert.match(res.reply, /Resumo Operacional da Rede/i);
  assert.match(res.reply, /Em operação agora:\*{0,2}\s*9/i);
  assert.match(res.reply, /Ausentes previstos hoje:\*{0,2}\s*11/i);
  assert.match(res.reply, /Alertas de jornada:\*{0,2}\s*5/i);
  assert.match(res.reply, /Solicitações de folga pendentes:\*{0,2}\s*1/i);
  assert.match(res.reply, /Trocas de folga aguardando aprovação:\*{0,2}\s*1/i);

  // Variação "resumo do painel"
  const resPainel = parseCopilotIntent("resumo do painel", ctx);
  assert.equal(resPainel.type, "query");
  assert.match(resPainel.reply, /Resumo Operacional da Rede/i);

  // Variação "como tá a operação"
  const resOperacao = parseCopilotIntent("como tá a operação hoje", ctx);
  assert.equal(resOperacao.type, "query");
  assert.match(resOperacao.reply, /Resumo Operacional da Rede/i);
});

test("Copiloto IA Info: esclarece qual modelo de IA roda no sistema", () => {
  const ctx = { user: { Perfil: "Administrador" } };
  const res = parseCopilotIntent("qual ia vai rodar ?", ctx);
  assert.equal(res.type, "query");
  assert.match(res.reply, /Google Gemini 2\.0 Flash/i);
  assert.match(res.reply, /Gemini 4 Argon/i);
  assert.match(res.reply, /Motor Local Autônomo/i);
});

test("Copiloto IA Info: suporte a consultas sobre o Gemini 4 Argon", () => {
  const ctx = { user: { Perfil: "Administrador" } };
  const res = parseCopilotIntent("como usar o gemini 4 argon para trabalhar nesse projeto", ctx);
  assert.equal(res.type, "query");
  assert.match(res.reply, /Gemini 4 Argon/i);
  assert.match(res.reply, /Google Gemini 2\.0 Flash/i);
});

test("Copiloto Model Config: getter e setter de modelo Gemini com validação", () => {
  const originalStorage = globalThis.localStorage;
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  try {
    assert.equal(DEFAULT_GEMINI_MODEL, "gemini-2.0-flash");
    assert.deepEqual(SUPPORTED_GEMINI_MODELS, ["gemini-2.0-flash", "gemini-4-argon"]);

    // Default quando vazio
    assert.equal(getGeminiModel(), "gemini-2.0-flash");

    // Selecionar Argon
    setGeminiModel("gemini-4-argon");
    assert.equal(getGeminiModel(), "gemini-4-argon");

    // Selecionar Flash
    setGeminiModel("gemini-2.0-flash");
    assert.equal(getGeminiModel(), "gemini-2.0-flash");

    // Fallback para modelo desconhecido
    setGeminiModel("modelo-invalido");
    assert.equal(getGeminiModel(), "gemini-2.0-flash");

    // Limpeza com string vazia
    setGeminiModel("");
    assert.equal(getGeminiModel(), "gemini-2.0-flash");
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test("PROMPT MESTRE & HR Adapter: Políticas oficiais de RH do Grupo House 190", () => {
  const policyFolgas = hrAdapter.getPolicy({}, { topic: "folgas" });
  assert.match(policyFolgas.conteudo, /5 \(cinco\) folgas mensais/i);
  assert.match(policyFolgas.conteudo, /segunda-feira e quinta-feira/i);
  assert.match(policyFolgas.conteudo, /quinta folga mensal/i);

  const policyTrocas = hrAdapter.getPolicy({}, { topic: "trocas" });
  assert.match(policyTrocas.conteudo, /solicita[cç][aã]o pelo aplicativo/i);
  assert.match(policyTrocas.conteudo, /aprova[cç][aã]o prévia do gerente/i);

  const policyAtestados = hrAdapter.getPolicy({}, { topic: "atestados" });
  assert.match(policyAtestados.conteudo, /48 horas/i);
  assert.match(policyAtestados.conteudo, /Atestado Médico/i);
});

test("PROMPT MESTRE & HR Adapter: Consultas de perfil, escala e banco de horas", () => {
  const ctx = {
    employees: mockEmployees,
    timeOff: mockTimeOff,
    timeBalance: { emp_1: 90 }, // +1h 30m
  };

  const profile = hrAdapter.getProfile({ userId: "emp_1", role: "employee", storeId: "loja_matriz" }, ctx);
  assert.equal(profile.nome, "Gabriel Silva");
  assert.equal(profile.folgaFixa, "Segunda-feira");

  const schedule = hrAdapter.getSchedule({ userId: "emp_1", role: "employee" }, { from: "2026-10-01", to: "2026-10-31" }, ctx);
  assert.equal(schedule.colaborador, "Gabriel Silva");
  assert.equal(schedule.solicitacoesPeriodo.length, 1);

  const tb = hrAdapter.getTimeBank({ userId: "emp_1" }, ctx);
  assert.equal(tb.saldoMinutos, 90);
  assert.equal(tb.saldoFormatado, "+01h 30m");
});

test("PROMPT MESTRE & HR Adapter: Pendências e cobertura da equipe com controle RBAC", () => {
  const ctx = {
    employees: mockEmployees,
    timeOff: [{ ID: "f1", FuncionarioID: "emp_1", NomeFuncionario: "Gabriel Silva", LojaID: "loja_matriz", Status: "Pendente", DataInicio: "2026-10-25" }],
    swaps: mockSwaps,
  };

  // Funcionário é bloqueado
  assert.throws(
    () => hrAdapter.getTeamPendingRequests({ userId: "emp_1", role: "employee" }, ctx),
    /Acesso restrito/i
  );

  // Gerente acessa sua loja
  const mgrActor = { userId: "emp_2", role: "manager", storeId: "loja_matriz" };
  const p = hrAdapter.getTeamPendingRequests(mgrActor, ctx);
  assert.equal(p.totalPendencias, 2);
  assert.equal(p.folgasPendentes.length, 1);
  assert.equal(p.trocasPendentes.length, 1);

  // Cobertura de equipe
  const cov = hrAdapter.getTeamCoverage(mgrActor, { date: "2026-10-25" }, ctx);
  assert.equal(cov.totalEquipe, 2);
  assert.equal(cov.colaboradoresEscalados.length, 2);
});

test("PROMPT MESTRE Intents: consultas de regras de folga e atestados respondem com política oficial", () => {
  const resFolgas = parseCopilotIntent("quais as regras de folga do grupo house ?");
  assert.equal(resFolgas.type, "query");
  assert.match(resFolgas.reply, /5 \(cinco\) folgas mensais/i);
  assert.match(resFolgas.reply, /quinta folga mensal/i);

  const resTrocas = parseCopilotIntent("como funciona a troca de folga ?");
  assert.equal(resTrocas.type, "query");
  assert.match(resTrocas.reply, /solicita[cç][aã]o pelo aplicativo/i);
  assert.match(resTrocas.reply, /aprova[cç][aã]o prévia do gerente/i);

  const resAtestado = parseCopilotIntent("como entregar atestado médico ?");
  assert.equal(resAtestado.type, "query");
  assert.match(resAtestado.reply, /48 horas/i);
});

test("PROMPT MESTRE Function Calling: novas ferramentas solicitarTrocaFolga e decidirSolicitacaoFolga", () => {
  const ctx = {
    user: { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Gerente Geral", LojaID: "loja_matriz" },
    employees: mockEmployees,
    swaps: mockSwaps,
    timeOff: [{ ID: "f1", FuncionarioID: "emp_2", NomeFuncionario: "Pedro Santos", LojaID: "loja_matriz", Status: "Pendente", DataInicio: "2026-10-28" }],
  };

  // Solicitar troca de folga
  const actionSwap = convertFunctionCallToAction(
    "solicitarTrocaFolga",
    { colegaNome: "Pedro Santos", minhaFolgaData: "2026-10-20", folgaColegaData: "2026-10-21", motivo: "Compromisso pessoal" },
    ctx
  );
  assert.equal(actionSwap.type, "action");
  assert.equal(actionSwap.actionType, "request_swap");
  assert.equal(actionSwap.apiMethod, "createTimeOffSwapRequest");
  assert.match(actionSwap.summary, /Pedro Santos/i);

  // Decidir troca pendente
  const actionDecideSwap = convertFunctionCallToAction(
    "decidirSolicitacaoFolga",
    { colaboradorNome: "Pedro Santos", decisao: "Aprovar" },
    ctx
  );
  assert.equal(actionDecideSwap.type, "action");
  assert.equal(actionDecideSwap.actionType, "approve_swap");
  assert.equal(actionDecideSwap.apiMethod, "decideTimeOffSwap");
  assert.match(actionDecideSwap.summary, /Pedro Santos/i);

  // Decidir folga pendente (recusa com motivo)
  const actionDecideLeave = convertFunctionCallToAction(
    "decidirSolicitacaoFolga",
    { colaboradorNome: "Maria Souza", decisao: "Recusar", motivo: "Falta de cobertura na loja" },
    {
      ...ctx,
      swaps: [],
      timeOff: [{ ID: "f2", FuncionarioID: "emp_3", NomeFuncionario: "Maria Souza", LojaID: "loja_matriz", Status: "Pendente", DataInicio: "2026-10-29" }],
    }
  );
  assert.equal(actionDecideLeave.type, "action");
  assert.equal(actionDecideLeave.actionType, "reject_leave");
  assert.equal(actionDecideLeave.apiMethod, "saveTimeOffRequestDecision");
  assert.match(actionDecideLeave.summary, /Maria Souza/i);
});

test("ZERO EMOJIS: Verificação estrita de ausência de emojis nos arquivos do Copiloto", async () => {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;

  const [copilotJs, copilotCss, indexHtml] = await Promise.all([
    readFile(new URL("../src/copilot.js", import.meta.url), "utf8"),
    readFile(new URL("../src/copilot.css", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Index.html", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(copilotJs, emojiRegex, "src/copilot.js não deve conter nenhum emoji");
  assert.doesNotMatch(copilotCss, emojiRegex, "src/copilot.css não deve conter nenhum emoji");

  // Garante que o trecho do copiloto no Index.html também não tem emojis
  const copilotSection = indexHtml.match(/<!-- Gaveta do Copiloto[\s\S]*?<\/aside>/);
  assert.ok(copilotSection, "Gaveta do copiloto deve existir no Index.html");
  assert.doesNotMatch(copilotSection[0], emojiRegex, "Seção do Copiloto no Index.html não deve conter nenhum emoji");
});

test("Copiloto Mega Cérebro: Pedido de folga com linguagem natural variada", () => {
  const employeeUser = { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Funcionário", LojaID: "loja_matriz" };
  const ctx = { user: employeeUser, employees: mockEmployees };

  // "Quero folga dia 25"
  const res1 = parseCopilotIntent("Quero folga dia 25", ctx);
  assert.equal(res1.type, "action");
  assert.equal(res1.actionType, "request_timeoff");
  assert.equal(res1.apiMethod, "createEmployeeTimeOffRequest");
  assert.match(res1.details.isoDate, /-\d{2}-25$/);
  assert.match(res1.summary, /25\//);

  // "Preciso de folga dia 25/10 porque tenho médico"
  const res2 = parseCopilotIntent("Preciso de folga dia 25/10 porque tenho médico", ctx);
  assert.equal(res2.type, "action");
  assert.equal(res2.actionType, "request_timeoff");
  assert.match(res2.details.isoDate, /2026-10-25/);
  assert.match(res2.details.reason, /médico/i);

  // "Gostaria de folga amanhã"
  const res3 = parseCopilotIntent("Gostaria de folga amanhã", ctx);
  assert.equal(res3.type, "action");
  assert.equal(res3.actionType, "request_timeoff");
  assert.ok(res3.details.isoDate);

  // "Quero folga na próxima terça"
  const res4 = parseCopilotIntent("Quero folga na próxima terça", ctx);
  assert.equal(res4.type, "action");
  assert.equal(res4.actionType, "request_timeoff");
  assert.ok(res4.details.isoDate);

  // "Me dá folga dia 20"
  const res5 = parseCopilotIntent("me dá folga dia 20", ctx);
  assert.equal(res5.type, "action");
  assert.equal(res5.actionType, "request_timeoff");
  assert.match(res5.details.isoDate, /-\d{2}-20$/);
});

test("Copiloto Mega Cérebro: Concessão de folga para colaborador por gestor/administrador (ex: ANA CLAUDIO DO FOODPARK FOLGA AMANHA)", () => {
  const adminUser = { FuncionarioID: "admin_1", Nome: "GLEUCE DIAS DE SOUZA", Perfil: "Administrador", LojaID: "" };
  const adminCtx = { user: adminUser, employees: mockEmployees };

  // Administrador concedendo folga com nome e loja
  const resAdmin = parseCopilotIntent("ANA CLAUDIO DO FOODPARK FOLGA AMANHA", adminCtx);
  assert.equal(resAdmin.type, "action");
  assert.equal(resAdmin.actionType, "create_timeoff");
  assert.equal(resAdmin.title, "Lançar Folga");
  assert.equal(resAdmin.apiMethod, "createTimeOff");
  assert.equal(resAdmin.apiArgs[0].FuncionarioID, "emp_4");
  assert.equal(resAdmin.apiArgs[0].NomeFuncionario, "Ana Cláudia");
  assert.equal(resAdmin.apiArgs[0].Status, "Aprovada");
  assert.equal(resAdmin.diff[0].label, "Colaborador");
  assert.equal(resAdmin.diff[0].value, "Ana Cláudia");
  assert.equal(resAdmin.diff[1].label, "Loja");
  assert.equal(resAdmin.diff[1].value, "House Foodpark");
  assert.match(resAdmin.diff[4].value, /Aprovada/);

  // Gerente da mesma unidade (foodpark) concedendo folga
  const mgrFoodpark = { FuncionarioID: "mgr_1", Nome: "Gerente Foodpark", Perfil: "Gerente", LojaID: "foodpark" };
  const resMgrSame = parseCopilotIntent("Ana Claudia folga amanhã", { user: mgrFoodpark, employees: mockEmployees });
  assert.equal(resMgrSame.type, "action");
  assert.equal(resMgrSame.actionType, "create_timeoff");
  assert.equal(resMgrSame.title, "Lançar Folga");
  assert.equal(resMgrSame.apiMethod, "createTimeOff");
  assert.equal(resMgrSame.diff[0].value, "Ana Cláudia");

  // Gerente de outra loja (matriz) tentando conceder folga a colaborador do foodpark
  const mgrMatriz = { FuncionarioID: "mgr_2", Nome: "Gerente Matriz", Perfil: "Gerente", LojaID: "loja_matriz" };
  const resMgrOther = parseCopilotIntent("ANA CLAUDIO DO FOODPARK FOLGA AMANHA", { user: mgrMatriz, employees: mockEmployees });
  assert.equal(resMgrOther.type, "error");
  assert.match(resMgrOther.message, /outra unidade/i);

  // Colaborador comum tentando conceder folga para colega
  const employeeUser = { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Funcionário", LojaID: "loja_matriz" };
  const resEmpForbidden = parseCopilotIntent("ANA CLAUDIO DO FOODPARK FOLGA AMANHA", { user: employeeUser, employees: mockEmployees });
  assert.equal(resEmpForbidden.type, "error");
  assert.match(resEmpForbidden.message, /próprio usuário/i);

  // Function Calling Gemini com lancarFolga
  const geminiRes = convertFunctionCallToAction("lancarFolga", {
    colaboradorNome: "Ana Claudio",
    lojaNome: "Foodpark",
    data: "amanhã",
    motivo: "Folga programada pela gerência"
  }, adminCtx);
  assert.equal(geminiRes.type, "action");
  assert.equal(geminiRes.actionType, "create_timeoff");
  assert.equal(geminiRes.title, "Lançar Folga");
  assert.equal(geminiRes.diff[0].value, "Ana Cláudia");
  assert.equal(geminiRes.diff[1].value, "House Foodpark");
});

test("Copiloto Mega Cérebro: Solicitação de ajuste de ponto em linguagem natural", () => {
  const employeeUser = { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Funcionário", LojaID: "loja_matriz" };
  const ctx = { user: employeeUser, employees: mockEmployees };

  // "Esqueci de bater ponto ontem às 18:00, altera pra mim"
  const res1 = parseCopilotIntent("Esqueci de bater ponto ontem às 18:00, altera pra mim", ctx);
  assert.equal(res1.type, "action");
  assert.equal(res1.actionType, "request_clock_adjustment");
  assert.equal(res1.apiMethod, "requestTimeClockAdjustment");
  assert.equal(res1.details.time, "18:00");
  assert.equal(res1.details.punchType, "SAIDA_FINAL");
  assert.match(res1.summary, /18:00/);

  // "esqueci a saída de ontem às 18h"
  const res2 = parseCopilotIntent("esqueci a saída de ontem às 18h", ctx);
  assert.equal(res2.type, "action");
  assert.equal(res2.actionType, "request_clock_adjustment");
  assert.equal(res2.details.time, "18:00");
  assert.equal(res2.details.punchType, "SAIDA_FINAL");

  // "alterar ponto dia 14/10 às 08:30"
  const res3 = parseCopilotIntent("alterar ponto dia 14/10 às 08:30", ctx);
  assert.equal(res3.type, "action");
  assert.equal(res3.actionType, "request_clock_adjustment");
  assert.equal(res3.details.time, "08:30");
  assert.equal(res3.details.punchType, "ENTRADA");
  assert.match(res3.details.isoDate, /2026-10-14/);

  // "Bater ponto retroativo ontem às 18:00"
  const res4 = parseCopilotIntent("bater ponto retroativo ontem às 18:00", ctx);
  assert.equal(res4.type, "action");
  assert.equal(res4.actionType, "request_clock_adjustment");
  assert.equal(res4.details.time, "18:00");

  // Gerente ajustando ponto de funcionário
  const mgrUser = { FuncionarioID: "mgr_1", Nome: "Gestor", Perfil: "Gerente", LojaID: "loja_matriz" };
  const mgrCtx = { user: mgrUser, employees: mockEmployees };
  const resMgr = parseCopilotIntent("Ajustar ponto de Gabriel ontem às 18:00", mgrCtx);
  assert.equal(resMgr.type, "action");
  assert.equal(resMgr.actionType, "quick_fix_clock");
  assert.equal(resMgr.apiMethod, "quickFixIncompletePunch");
  assert.equal(resMgr.details.empId, "emp_1");
  assert.equal(resMgr.details.time, "18:00");
});

test("Copiloto Mega Cérebro: Function Calling Gemini para solicitarAjustePonto e solicitarFolga", () => {
  const employeeUser = { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Funcionário", LojaID: "loja_matriz" };
  const ctx = { user: employeeUser, employees: mockEmployees };

  // Ferramenta solicitarAjustePonto
  const punchAction = convertFunctionCallToAction(
    "solicitarAjustePonto",
    { data: "ontem", horario: "18:00", tipoMarcacao: "SAIDA_FINAL", motivo: "Esquecimento de registro" },
    ctx
  );
  assert.equal(punchAction.type, "action");
  assert.equal(punchAction.actionType, "request_clock_adjustment");
  assert.equal(punchAction.apiMethod, "requestTimeClockAdjustment");
  assert.equal(punchAction.details.time, "18:00");
  assert.match(punchAction.summary, /18:00/);

  // Ferramenta solicitarFolga com data relativa e motivo
  const leaveAction = convertFunctionCallToAction(
    "solicitarFolga",
    { data: "2026-10-25", motivo: "Consulta médica" },
    ctx
  );
  assert.equal(leaveAction.type, "action");
  assert.equal(leaveAction.actionType, "request_timeoff");
  assert.equal(leaveAction.apiMethod, "createEmployeeTimeOffRequest");
  assert.equal(leaveAction.details.isoDate, "2026-10-25");
});

test("Copiloto Consecutivo: Envio de múltiplas mensagens (> 2, 5 e 10 mensagens) sem bloqueio ou falha", () => {
  const employeeUser = { FuncionarioID: "emp_1", Nome: "Gabriel Silva", Perfil: "Funcionário", LojaID: "loja_matriz" };
  const ctx = { user: employeeUser, employees: mockEmployees, timeOff: mockTimeOff, hourBalance: { totalMinutos: 60 } };

  clearCopilotChatHistory();

  const sequence = [
    "Olá, tudo bem?",
    "Quando é minha próxima folga?",
    "Qual é o meu saldo de horas?",
    "Quais as regras de folga?",
    "Como funciona a troca de folga?",
    "Quero folga dia 25/10 porque tenho médico",
    "Esqueci de bater ponto ontem às 18:00, altera pra mim",
    "Como entregar atestado?",
    "Quero folga amanhã",
    "Obrigado pela ajuda",
  ];

  for (let i = 0; i < sequence.length; i++) {
    const msg = sequence[i];
    const res = parseCopilotIntent(msg, ctx);
    assert.ok(res, `Turno ${i + 1} (${msg}) deve retornar uma resposta válida`);
    assert.ok(res.type === "query" || res.type === "action" || res.type === "empty", `Turno ${i + 1} tipo esperado`);
    copilotChatHistory.push({ role: "user", text: msg });
    copilotChatHistory.push({ role: "assistant", text: res.reply || res.summary || "Ok" });
  }

  assert.equal(copilotChatHistory.length, 20, "Deve registrar exatamente 10 turnos de ida e volta");
});

test("Copiloto CSS Layout: painel possui overflow hidden e corpo possui min-height 0 para garantir que o rodapé não suma", async () => {
  const css = await readFile(new URL("../src/copilot.css", import.meta.url), "utf8");

  // .copilot-panel desktop e mobile devem ter overflow: hidden
  assert.match(css, /\.copilot-panel\s*\{[\s\S]*?overflow:\s*hidden;/i, ".copilot-panel deve conter overflow: hidden");

  // .copilot-body deve ter min-height: 0 para que flexbox encolha o conteúdo e não empurre o rodapé
  assert.match(css, /\.copilot-body\s*\{[\s\S]*?min-height:\s*0;/i, ".copilot-body deve conter min-height: 0");

  // .copilot-footer deve ter flex-shrink: 0 para nunca ser comprimido
  assert.match(css, /\.copilot-footer\s*\{[\s\S]*?flex-shrink:\s*0;/i, ".copilot-footer deve conter flex-shrink: 0");
});

test("Copiloto Mega Cérebro: Consulta de pendências operacionais (ponto, folgas, trocas e central)", () => {
  const adminUser = { FuncionarioID: "adm_1", Nome: "Administrador", Perfil: "Administrador" };
  const mockAdjustments = [
    { ID: "adj_1", FuncionarioID: "emp_1", NomeFuncionario: "Gabriel Silva", Data: "2026-10-14", HoraSolicitada: "18:00", Status: "Pendente", LojaID: "loja_matriz", Motivo: "Esqueci de bater ponto" }
  ];
  const mockPendingTimeOff = [
    { ID: "to_1", FolgaID: "to_1", FuncionarioID: "emp_1", NomeFuncionario: "Gabriel Silva", DataInicio: "2026-10-25", Status: "Pendente", LojaID: "loja_matriz", Motivo: "Consulta médica" }
  ];

  const fullCtx = {
    user: adminUser,
    employees: mockEmployees,
    adjustments: mockAdjustments,
    timeOff: mockPendingTimeOff,
    swaps: mockSwaps
  };

  // 1. Ajustes de ponto pendentes (com dados)
  const resAdj = parseCopilotIntent("Ajustes de ponto pendentes", fullCtx);
  assert.equal(resAdj.type, "query");
  assert.match(resAdj.reply, /Gabriel Silva/);
  assert.match(resAdj.reply, /18:00/);

  // 1b. Ajustes de ponto pendentes (vazio)
  const resAdjEmpty = parseCopilotIntent("Ajustes de ponto pendentes", { ...fullCtx, adjustments: [] });
  assert.equal(resAdjEmpty.type, "query");
  assert.match(resAdjEmpty.reply, /Nenhum ajuste de ponto pendente/i);

  // 2. Solicitações de folga abertas (com dados)
  const resFolga = parseCopilotIntent("Solicitações de folga abertas", fullCtx);
  assert.equal(resFolga.type, "query");
  assert.match(resFolga.reply, /Gabriel Silva/);
  assert.match(resFolga.reply, /2026-10-25/);

  // 2b. Solicitações de folga abertas (vazio)
  const resFolgaEmpty = parseCopilotIntent("Solicitações de folga abertas", { ...fullCtx, timeOff: [] });
  assert.equal(resFolgaEmpty.type, "query");
  assert.match(resFolgaEmpty.reply, /Nenhuma solicitação de folga pendente/i);

  // 3. Trocas de folga pendentes
  const resTroca = parseCopilotIntent("Trocas de folga pendentes", fullCtx);
  assert.equal(resTroca.type, "query");
  assert.match(resTroca.reply, /Gabriel Silva/);

  // 4. Central de pendências consolidada
  const resCentral = parseCopilotIntent("Central de pendências", fullCtx);
  assert.equal(resCentral.type, "query");
  assert.match(resCentral.reply, /Central de Pendências/i);
  assert.match(resCentral.reply, /Folgas Solicitadas\s*\(1\)/i);
  assert.match(resCentral.reply, /Trocas de Folga\s*\(1\)/i);
  assert.match(resCentral.reply, /Ajustes de Ponto\s*\(1\)/i);
});

test("Copiloto Mega Cérebro: Aprovação direta de folga e ajuste de ponto por Gestor/Admin", () => {
  const adminUser = { FuncionarioID: "adm_1", Nome: "Administrador", Perfil: "Administrador" };
  const mockAdjustments = [
    { ID: "adj_1", FuncionarioID: "emp_1", NomeFuncionario: "Gabriel Silva", Data: "2026-10-14", HoraSolicitada: "18:00", Status: "Pendente", LojaID: "loja_matriz" }
  ];
  const mockPendingTimeOff = [
    { ID: "to_1", FolgaID: "to_1", FuncionarioID: "emp_1", NomeFuncionario: "Gabriel Silva", DataInicio: "2026-10-25", Status: "Pendente", LojaID: "loja_matriz" }
  ];

  const fullCtx = {
    user: adminUser,
    employees: mockEmployees,
    adjustments: mockAdjustments,
    timeOff: mockPendingTimeOff,
    swaps: mockSwaps
  };

  // Aprovar folga
  const resApproveFolga = parseCopilotIntent("Aprovar folga de Gabriel", fullCtx);
  assert.equal(resApproveFolga.type, "action");
  assert.equal(resApproveFolga.actionType, "approve_leave");
  assert.equal(resApproveFolga.apiMethod, "approveTimeOff");
  assert.equal(resApproveFolga.details.timeOffId, "to_1");
  assert.match(resApproveFolga.summary, /Gabriel Silva/);

  // Aprovar ajuste de ponto
  const resApproveAdj = parseCopilotIntent("Aprovar ajuste de ponto de Gabriel", fullCtx);
  assert.equal(resApproveAdj.type, "action");
  assert.equal(resApproveAdj.actionType, "approve_clock_adjustment");
  assert.equal(resApproveAdj.apiMethod, "decideTimeClockAdjustment");
  assert.equal(resApproveAdj.details.adjustmentId, "adj_1");
  assert.equal(resApproveAdj.details.decision, "aprovar");
  assert.match(resApproveAdj.summary, /Gabriel Silva/);
});

test("Copiloto Mega Cérebro: Cobertura de 100% de todos os chips de todas as telas sem fallback", () => {
  const roles = [
    { role: "admin", perfil: "Administrador" },
    { role: "manager", perfil: "Gerente" },
    { role: "employee", perfil: "Funcionário" }
  ];

  let totalChips = 0;
  let passedChips = 0;
  const failures = [];

  for (const [screenKey, screenData] of Object.entries(SCREEN_KNOWLEDGE)) {
    if (!screenData.chips) continue;
    for (const r of roles) {
      const list = screenData.chips[r.role] || [];
      const user = { FuncionarioID: "u_test", Nome: "Teste", Perfil: r.perfil, LojaID: "loja_matriz" };
      const ctx = {
        user,
        employees: mockEmployees,
        tasks: mockTasks,
        swaps: mockSwaps,
        timeOff: mockTimeOff,
        hourBalance: { totalMinutos: 120 }
      };

      for (const chip of list) {
        totalChips++;
        const res = parseCopilotIntent(chip, ctx);
        if (res.type === "fallback" || (res.reply && res.reply.includes("Não compreendi este comando com precisão"))) {
          failures.push({ screen: screenKey, role: r.role, chip, reply: res.reply });
        } else {
          passedChips++;
        }
      }
    }
  }

  assert.equal(failures.length, 0, `Nenhum chip deve retornar fallback. Falhas: ${JSON.stringify(failures)}`);
  assert.equal(passedChips, totalChips, `Todos os ${totalChips} chips devem ser compreendidos com sucesso`);
  assert.ok(totalChips >= 200, "Deve cobrir a totalidade dos chips operacionais por perfil");
});

