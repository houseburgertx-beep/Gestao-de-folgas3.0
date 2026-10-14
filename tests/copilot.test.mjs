import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseCopilotIntent, getUserRole, executeCopilotAction } from "../src/copilot.js";

// Mock de dados operacionais
const mockEmployees = [
  { FuncionarioID: "emp_1", Nome: "Gabriel Silva", LojaID: "loja_matriz", Turno: "Manhã", FolgaFixaSemanal: "Segunda-feira" },
  { FuncionarioID: "emp_2", Nome: "Pedro Santos", LojaID: "loja_matriz", Turno: "Tarde", FolgaFixaSemanal: "Terça-feira" },
  { FuncionarioID: "emp_3", Nome: "Maria Souza", LojaID: "loja_filial", Turno: "Noite", FolgaFixaSemanal: "Quarta-feira" },
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

const mockTimeOff = [
  { FuncionarioID: "emp_1", DataInicio: "2026-10-25", TipoFolga: "Folga regular", Status: "Aprovada" },
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
  assert.match(folgaRes.reply, /25\/10\/2026/);

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
