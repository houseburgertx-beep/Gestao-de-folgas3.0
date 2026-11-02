import assert from "node:assert/strict";
import test from "node:test";
import { createTasksHandlers } from "../src/core/api-tasks.js";
import { runtime } from "../src/core/runtime.js";

test("métricas da equipe preservam aliases, critérios legados e saldos ao agrupar histórico", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-04T15:00:00Z") });
  const employees = [
    { FuncionarioID: "a", Nome: "Ana", Cargo: "Chef", Email: "ana@example.test", LojaID: "loja" },
    { id: 7, nome: "Bruna", Perfil: "Operador" },
    { Nome: "Sem identificador" },
    { FuncionarioID: "inactive", Ativo: false },
    { FuncionarioID: "inactive-status", Status: "INATIVO" },
  ];
  const tasks = [
    { FuncionarioID: "a", Status: "Concluída", Prioridade: "Urgente", DataConclusao: "2026-11-04T12:00:00Z" },
    { RESPONSAVEL_ID: "a", Status: "Concluída", PRIORIDADE: "Alta", DataConclusao: "2000-01-01" },
    { FuncionarioID: "a", Coluna: "concluido", CONCLUIDO_EM: "2026-11-04", Prioridade: "Desconhecida" },
    { FuncionarioID: "a", Status: "A fazer", Prazo: "2000-01-01" },
    { FuncionarioID: "a", Coluna: "visto", STATUS: "Cancelada", PRAZO: "2000-01-01" },
    { FuncionarioID: "a", Status: "Em andamento", Prazo: "2099-01-01" },
    { RESPONSAVEL_ID: 7, Coluna: "concluido", PRIORIDADE: "Alta", CONCLUIDO_EM: "2026-11-04" },
    { FuncionarioID: "a", RESPONSAVEL_ID: 7, Status: "Cancelada" },
    { Status: "Concluída", Prioridade: "Urgente" },
    { FuncionarioID: "", RESPONSAVEL_ID: 0, Status: "Concluída" },
    { FuncionarioID: "inactive", Status: "Concluída" },
  ];
  const adjustments = [
    { USUARIO_ID: "a", PONTOS: "10", CRIADO_EM: "2000-01-01" },
    { USUARIO_ID: "a", PONTOS: 7, CRIADO_EM: "2026-11-03" },
    { USUARIO_ID: "a", PONTOS: -4, CRIADO_EM: "2026-11-03" },
    { USUARIO_ID: 7, PONTOS: -9, CRIADO_EM: "2026-11-03" },
    { USUARIO_ID: "", PONTOS: 1, CRIADO_EM: "2026-11-03" },
    { PONTOS: 99, CRIADO_EM: "2026-11-03" },
  ];
  const before = structuredClone({ employees, tasks, adjustments });
  t.mock.method(runtime, "requireProfile", async () => ({ Perfil: "admin" }));
  const tables = { Funcionarios: employees, Tarefas: tasks, PontosAjustes: adjustments };
  t.mock.method(runtime, "list", async (table) => tables[table]);

  const result = await createTasksHandlers().cozinhaTeamMetrics([]);
  assert.equal(result.success, true);
  assert.deepEqual(result.data.map(({ id, name, role, email, store, doneToday, pending, late, totalPoints, weeklyPoints, progress }) =>
    ({ id, name, role, email, store, doneToday, pending, late, totalPoints, weeklyPoints, progress })), [
    { id: "a", name: "Ana", role: "Chef", email: "ana@example.test", store: "loja", doneToday: 2, pending: 3, late: 1, totalPoints: 19, weeklyPoints: 11, progress: 32 },
    { id: "", name: "Sem identificador", role: "Operador", email: "", store: "", doneToday: 0, pending: 0, late: 0, totalPoints: 1, weeklyPoints: 1, progress: 2 },
    { id: "7", name: "Bruna", role: "Operador", email: "", store: "", doneToday: 1, pending: 0, late: 0, totalPoints: 0, weeklyPoints: 2, progress: 0 },
  ]);
  assert.deepEqual({ employees, tasks, adjustments }, before);
});

test("métricas percorrem IDs de tarefas uma vez independentemente do tamanho da equipe", async (t) => {
  const employees = Array.from({ length: 40 }, (_, id) => ({ FuncionarioID: String(id) }));
  let taskIdReads = 0;
  let adjustmentIdReads = 0;
  const tasks = Array.from({ length: 1000 }, (_, index) => ({
    get FuncionarioID() { taskIdReads++; return String(index % 40); },
    Coluna: "pendente",
  }));
  const adjustments = Array.from({ length: 200 }, (_, index) => ({
    get USUARIO_ID() { adjustmentIdReads++; return String(index % 40); },
    PONTOS: 1,
  }));
  t.mock.method(runtime, "requireProfile", async () => ({ Perfil: "admin" }));
  const tables = { Funcionarios: employees, Tarefas: tasks, PontosAjustes: adjustments };
  t.mock.method(runtime, "list", async (table) => tables[table]);
  const result = await createTasksHandlers().cozinhaTeamMetrics([]);
  assert.equal(result.data.length, 40);
  assert.ok(result.data.every((employee) => employee.pending === 25 && employee.totalPoints === 5));
  assert.equal(taskIdReads, tasks.length);
  assert.equal(adjustmentIdReads, adjustments.length);
});
