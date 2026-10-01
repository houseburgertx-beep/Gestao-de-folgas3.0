import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runtime } from "../src/core/runtime.js";
import {
  createNotification,
  createNotificationOnce,
} from "../src/core/api-base.js";
import { createTasksHandlers } from "../src/core/api-tasks.js";
import { createAdvancedHandlers } from "../src/core/api-advanced.js";

// Helper to mock runtime in-memory database
function createMockRuntime() {
  const store = new Map();
  let currentProfile = {
    FuncionarioID: "EMP_ADMIN",
    UsuarioID: "USR_ADMIN",
    Email: "admin@house.test",
    Nome: "Administrador",
    Perfil: "Administrador",
    LojaID: "LOJA_1",
    Ativo: true,
  };

  const mock = {
    auth: { currentUser: { email: "admin@house.test" } },
    setProfile(p) { currentProfile = p; },
    async requireProfile() { return currentProfile; },
    async list(table) {
      return Array.from(store.get(table)?.values() || []);
    },
    async getById(table, id) {
      return store.get(table)?.get(String(id)) || null;
    },
    async upsert(table, record) {
      if (!store.has(table)) store.set(table, new Map());
      const keyField = table === "Notificacoes" ? "NotificacaoID" : (table === "Tarefas" ? "TarefaID" : (table === "Folgas" ? "FolgaID" : (table === "Funcionarios" ? "FuncionarioID" : "ID")));
      const id = String(record[keyField] || record.ID || record.id || `gen_${Date.now()}_${Math.random()}`);
      const entry = { ...record, [keyField]: id };
      store.get(table).set(id, entry);
      return entry;
    },
    async patch(table, id, changes) {
      const current = await this.getById(table, id) || {};
      const updated = { ...current, ...changes };
      store.get(table)?.set(String(id), updated);
      return updated;
    },
    async remove(table, id) {
      store.get(table)?.delete(String(id));
      return { ok: true };
    },
    dump(table) {
      return Array.from(store.get(table)?.values() || []);
    }
  };
  return mock;
}

test("createNotificationOnce é idempotente e evita duplicações de notificações pendentes", async () => {
  const mock = createMockRuntime();
  const originalList = runtime.list;
  const originalUpsert = runtime.upsert;
  runtime.list = mock.list.bind(mock);
  runtime.upsert = mock.upsert.bind(mock);

  try {
    const notif1 = await createNotificationOnce({
      employeeId: "EMP_01",
      email: "colab@house.test",
      storeId: "LOJA_1",
      subject: "Nova tarefa para você",
      message: "Limpeza da bancada",
      type: "Tarefa",
      relatedId: "TASK_100",
      severity: "info",
    });

    assert.ok(notif1.NotificacaoID);
    assert.equal(notif1.Severidade, "info");
    assert.equal(notif1.Tipo, "Tarefa");

    // Segunda chamada para a mesma tarefa e colaborador não deve criar duplicata
    const notif2 = await createNotificationOnce({
      employeeId: "EMP_01",
      email: "colab@house.test",
      storeId: "LOJA_1",
      subject: "Nova tarefa para você",
      message: "Limpeza da bancada",
      type: "Tarefa",
      relatedId: "TASK_100",
      severity: "info",
    });

    assert.equal(notif2.NotificacaoID, notif1.NotificacaoID, "Não deve criar segunda notificação se já existe pendente");
    const all = mock.dump("Notificacoes");
    assert.equal(all.length, 1, "Deve existir apenas uma notificação salva");
  } finally {
    runtime.list = originalList;
    runtime.upsert = originalUpsert;
  }
});

test("Fluxo CozinhaFlow: atribuição, envio para visto, aprovação com pontos e devolução geram notificações", async () => {
  const mock = createMockRuntime();
  const originalList = runtime.list;
  const originalGetById = runtime.getById;
  const originalUpsert = runtime.upsert;
  const originalPatch = runtime.patch;
  const originalRequireProfile = runtime.requireProfile;

  runtime.list = mock.list.bind(mock);
  runtime.getById = mock.getById.bind(mock);
  runtime.upsert = mock.upsert.bind(mock);
  runtime.patch = mock.patch.bind(mock);
  runtime.requireProfile = mock.requireProfile.bind(mock);

  try {
    const handlers = createTasksHandlers();

    // 1. Criar tarefa com responsável -> Notificação TAREFA_ATRIBUIDA
    mock.setProfile({
      FuncionarioID: "EMP_ADMIN",
      Nome: "Chef Gestor",
      Perfil: "Administrador",
      LojaID: "LOJA_1",
    });

    const savedResult = await handlers.cozinhaTasksSave([
      {
        ID: "TASK_BURGER_01",
        TITULO: "Preparar 50 blends artesanais",
        DESCRICAO: "Padrão 160g com tempero da casa",
        RESPONSAVEL_ID: "EMP_COZINHA_01",
        RESPONSAVEL_NOME: "Pedro Chapa",
        PRIORIDADE: "Alta",
        PRAZO: "2026-10-01T17:00:00",
        LojaID: "LOJA_1",
      },
    ]);

    assert.ok(savedResult.success);
    const notificationsAfterCreate = mock.dump("Notificacoes");
    const assignNotif = notificationsAfterCreate.find(
      (n) => n.Tipo === "Tarefa" && n.DestinatarioID === "EMP_COZINHA_01"
    );
    assert.ok(assignNotif, "Deve ter criado notificação de tarefa para o responsável");
    assert.equal(assignNotif.Severidade, "warning", "Prioridade Alta deve gerar severidade warning");
    assert.match(assignNotif.Assunto, /Nova tarefa para você/);
    assert.match(assignNotif.Mensagem, /Preparar 50 blends/);

    // 2. Colaborador conclui tarefa com foto -> Notificação para o gestor
    mock.setProfile({
      FuncionarioID: "EMP_COZINHA_01",
      Nome: "Pedro Chapa",
      Perfil: "Operador",
      LojaID: "LOJA_1",
    });

    const completeResult = await handlers.cozinhaTasksComplete([
      {
        id: "TASK_BURGER_01",
        fotoUrl: "https://drive.google.com/test_proof.jpg",
        observacao: "Todos os blends pesados e organizados",
      },
    ]);
    assert.ok(completeResult.success);

    const notificationsAfterComplete = mock.dump("Notificacoes");
    const reviewNotif = notificationsAfterComplete.find(
      (n) => n.Assunto === "Tarefa enviada para conferência"
    );
    assert.ok(reviewNotif, "Deve gerar notificação avisando que a tarefa foi enviada para conferência");
    assert.match(reviewNotif.Mensagem, /Pedro Chapa concluiu a tarefa/);

    // 3. Gestor devolve/recusa a tarefa solicitando melhor ângulo -> Notificação para o colaborador com motivo
    mock.setProfile({
      FuncionarioID: "EMP_ADMIN",
      Nome: "Chef Gestor",
      Perfil: "Administrador",
      LojaID: "LOJA_1",
    });

    const rejectResult = await handlers.cozinhaTasksReject([
      {
        id: "TASK_BURGER_01",
        reason: "Foto cortou a etiqueta com a validade. Favor reenviar mostrando a etiqueta.",
      },
    ]);
    assert.ok(rejectResult.success);

    const notificationsAfterReject = mock.dump("Notificacoes");
    const rejectNotif = notificationsAfterReject.find(
      (n) => n.Assunto === "Tarefa devolvida para revisão"
    );
    assert.ok(rejectNotif, "Deve gerar notificação de devolução para o operador");
    assert.equal(rejectNotif.DestinatarioID, "EMP_COZINHA_01");
    assert.equal(rejectNotif.Severidade, "warning");
    assert.match(rejectNotif.Mensagem, /etiqueta com a validade/);

    // 4. Gestor aprova a tarefa -> Notificação comemorativa com pontos
    const approveResult = await handlers.cozinhaTasksApprove(["TASK_BURGER_01"]);
    assert.ok(approveResult.success);

    const notificationsAfterApprove = mock.dump("Notificacoes");
    const approveNotif = notificationsAfterApprove.find(
      (n) => n.Assunto.includes("Tarefa aprovada")
    );
    assert.ok(approveNotif, "Deve gerar notificação de aprovação com pontos");
    assert.equal(approveNotif.DestinatarioID, "EMP_COZINHA_01");
    assert.equal(approveNotif.Severidade, "success");
    assert.match(approveNotif.Mensagem, /\+2 pontos/);
  } finally {
    runtime.list = originalList;
    runtime.getById = originalGetById;
    runtime.upsert = originalUpsert;
    runtime.patch = originalPatch;
    runtime.requireProfile = originalRequireProfile;
  }
});

test("Aviso automático: Amanhã é sua folga é gerado na consulta de notificações", async () => {
  const mock = createMockRuntime();
  const originalList = runtime.list;
  const originalGetById = runtime.getById;
  const originalUpsert = runtime.upsert;
  const originalRequireProfile = runtime.requireProfile;

  runtime.list = mock.list.bind(mock);
  runtime.getById = mock.getById.bind(mock);
  runtime.upsert = mock.upsert.bind(mock);
  runtime.requireProfile = mock.requireProfile.bind(mock);

  try {
    // Cadastro do funcionário
    await mock.upsert("Funcionarios", {
      FuncionarioID: "EMP_FOLGA_01",
      Nome: "Mariana Souza",
      Email: "mariana@house.test",
      LojaID: "LOJA_1",
      Ativo: true,
      DiaFolgaPreferencial: "Segunda-feira",
    });

    // Calcula amanhã no fuso da aplicação
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    // Cadastra uma folga aprovada para amanhã
    await mock.upsert("Folgas", {
      FolgaID: "FOLGA_TOMORROW",
      FuncionarioID: "EMP_FOLGA_01",
      DataInicio: tomorrowStr,
      DataFim: tomorrowStr,
      Status: "Aprovada",
      TipoFolga: "Folga mensal",
    });

    mock.setProfile({
      FuncionarioID: "EMP_FOLGA_01",
      Email: "mariana@house.test",
      Nome: "Mariana Souza",
      Perfil: "Operador",
      LojaID: "LOJA_1",
    });

    const advanced = createAdvancedHandlers();
    const result = await advanced.getMyNotifications([]);
    assert.ok(result.success);

    const notifications = mock.dump("Notificacoes");
    const leaveAlert = notifications.find(
      (n) => n.Tipo === "Folga" && n.DestinatarioID === "EMP_FOLGA_01" && n.Assunto.includes("Amanhã é sua folga")
    );
    assert.ok(leaveAlert, "Deve gerar o lembrete de que amanhã é a folga do colaborador");
    assert.match(leaveAlert.Mensagem, /Lembrete: amanhã/);
  } finally {
    runtime.list = originalList;
    runtime.getById = originalGetById;
    runtime.upsert = originalUpsert;
    runtime.requireProfile = originalRequireProfile;
  }
});

test("Aviso automático: Falta pouco para o fim do intervalo (5 minutos)", async () => {
  const mock = createMockRuntime();
  const originalList = runtime.list;
  const originalGetById = runtime.getById;
  const originalUpsert = runtime.upsert;
  const originalRequireProfile = runtime.requireProfile;

  runtime.list = mock.list.bind(mock);
  runtime.getById = mock.getById.bind(mock);
  runtime.upsert = mock.upsert.bind(mock);
  runtime.requireProfile = mock.requireProfile.bind(mock);

  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // Funcionário saiu para intervalo de 60 minutos há 57 minutos (faltam 3 minutos para voltar)
    const breakStartTime = new Date(Date.now() - 57 * 60000).toISOString();

    await mock.upsert("Funcionarios", {
      FuncionarioID: "EMP_INTERVALO_01",
      Nome: "Carlos Intervalo",
      Email: "carlos@house.test",
      LojaID: "LOJA_1",
      Ativo: true,
    });

    await mock.upsert("JornadasPonto", {
      ID: "JORNADA_01",
      FuncionarioID: "EMP_INTERVALO_01",
      DuracaoIntervaloMinutos: 60,
      Ativa: true,
    });

    await mock.upsert("RegistrosPonto", {
      RegistroPontoID: "PUNCH_BREAK_OUT",
      FuncionarioID: "EMP_INTERVALO_01",
      Data: todayStr,
      DataHora: breakStartTime,
      TipoMarcacao: "SAIDA_INTERVALO",
      Status: "Válido",
    });

    mock.setProfile({
      FuncionarioID: "EMP_INTERVALO_01",
      Email: "carlos@house.test",
      Nome: "Carlos Intervalo",
      Perfil: "Operador",
      LojaID: "LOJA_1",
    });

    const advanced = createAdvancedHandlers();
    const result = await advanced.getMyNotifications([]);
    assert.ok(result.success);

    const notifications = mock.dump("Notificacoes");
    const breakAlert = notifications.find(
      (n) => n.Tipo === "Ponto" && n.DestinatarioID === "EMP_INTERVALO_01" && n.Assunto.includes("fim do intervalo")
    );
    assert.ok(breakAlert, "Deve gerar o aviso de intervalo prestes a terminar");
    assert.match(breakAlert.Mensagem, /para encerrar seu intervalo/);
    assert.equal(breakAlert.Severidade, "warning");
  } finally {
    runtime.list = originalList;
    runtime.getById = originalGetById;
    runtime.upsert = originalUpsert;
    runtime.requireProfile = originalRequireProfile;
  }
});

test("A interface HTML e scripts contêm botões de ação e aviso visual de intervalo", async () => {
  const scriptsHtml = await readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8");
  const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const cozinhaCss = await readFile(new URL("../src/cozinhaflow.css", import.meta.url), "utf8");
  const journeyJs = await readFile(new URL("../src/journey.js", import.meta.url), "utf8");

  // 1. Botão Ver tarefa, Ver folga e Ver ponto nas notificações
  assert.match(scriptsHtml, /function notificationActionButton_/, "notificationActionButton_ deve estar definida em Scripts.html");
  assert.match(scriptsHtml, /Ver tarefa/, "Deve existir ação Ver tarefa");
  assert.match(scriptsHtml, /Ver folga/, "Deve existir ação Ver folga");
  assert.match(scriptsHtml, /Ver ponto/, "Deve existir ação Ver ponto");

  // 2. Classes de severidade estilizadas
  assert.match(cozinhaCss, /\.notification-item\.severity-danger/, "CSS deve conter estilo para severidade danger");
  assert.match(cozinhaCss, /\.notification-item\.severity-success/, "CSS deve conter estilo para severidade success");
  assert.match(cozinhaCss, /\.clock-interval-warning/, "CSS deve conter estilo para alerta de intervalo");

  // 3. Aviso visual de intervalo no card da jornada e painel do ponto
  assert.match(journeyJs, /clock-interval-warning/, "journey.js deve renderizar alerta de intervalo");
  assert.match(scriptsHtml, /clock-interval-warning/, "Scripts.html deve renderizar alerta de intervalo");
});
