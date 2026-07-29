import { APP, PERMISSIONS } from "./constants.js";
import { isPermissionDenied, runtime } from "./runtime.js";
import {
  asBoolean,
  assert,
  csvDataUrl,
  dateRange,
  normalizeEmail,
  nowIso,
  todayIso,
  uuid,
} from "./utils.js";

export const success = (data, message = "") => ({
  success: true,
  message,
  data,
});

export const sessionUser = (profile) => ({
  id: profile.FuncionarioID || profile.UsuarioID,
  usuarioId: profile.UsuarioID,
  funcionarioId: profile.FuncionarioID || "",
  nome: profile.Nome || "",
  email: profile.Email || "",
  perfil: profile.Perfil || "",
  lojaId: profile.LojaID || "",
  nomeLoja: profile.NomeLoja || "",
  cargo: profile.Cargo || "",
  fotoPerfil: "",
  ativo: asBoolean(profile.Ativo),
});

const dropClientToken = (args) => {
  const values = Array.isArray(args) ? [...args] : [];
  if (
    typeof values[0] === "string" &&
    (values[0].split(".").length === 3 || values[0].length > 80)
  ) {
    values.shift();
  }
  return values;
};

const role = (profile) => String(profile?.Perfil || "").toLowerCase();
const isAdmin = (profile) => role(profile).includes("admin");
const isManager = (profile) =>
  isAdmin(profile) ||
  role(profile).includes("respons") ||
  role(profile).includes("gerente");

const requireAdmin = (profile) =>
  assert(isAdmin(profile), "Somente o Administrador pode executar esta ação.");

const requireManager = (profile) =>
  assert(
    isManager(profile),
    "Esta ação exige perfil de responsável ou administrador.",
  );

const scopeRecord = (profile, record) => {
  if (isAdmin(profile)) return true;
  if (isManager(profile)) {
    assert(
      !record?.LojaID ||
        String(record.LojaID) === String(profile.LojaID || ""),
      "Este perfil só pode operar dados da própria loja.",
    );
    return true;
  }
  assert(
    !record?.FuncionarioID ||
      String(record.FuncionarioID) === String(profile.FuncionarioID || ""),
    "O funcionário só pode operar os próprios registros.",
  );
  return true;
};

export const timeOffBalanceUnits = (record = {}) => {
  const type = String(record.TipoFolga || "Folga").toLowerCase();
  if (!type.includes("folga")) return 0;
  const start = String(record.DataInicio || "");
  const end = String(record.DataFim || start);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    end < start
  ) {
    return 0;
  }
  const period = String(record.Periodo || "Dia inteiro").toLowerCase();
  const fraction =
    type.includes("meia") ||
    period.includes("manhã") ||
    period.includes("manha") ||
    period.includes("tarde") ||
    period.includes("personalizado")
      ? 0.5
      : 1;
  return Math.round(dateRange(start, end).length * fraction * 100) / 100;
};

const saveLeaveBalanceMovement = async ({
  movementId,
  employee,
  type,
  competence,
  referenceId,
  result,
  actor,
}) => {
  if (!result?.applied) return;
  await runtime
    .upsert("MovimentosSaldoFolgas", {
      MovimentoID: movementId,
      FuncionarioID: employee.FuncionarioID,
      NomeFuncionario: employee.Nome || "",
      LojaID: employee.LojaID || "",
      Tipo: type,
      Competencia: competence || "",
      ReferenciaID: referenceId || "",
      Delta: result.desiredDelta,
      AjusteAplicado: result.adjustment,
      SaldoAntes: result.balanceBefore,
      SaldoDepois: result.balanceAfter,
      DataMovimento: result.appliedAt || nowIso(),
      CriadoPor: actor?.Email || "",
      Status: "Aplicado",
    })
    .catch((error) =>
      console.warn("Histórico do saldo de folgas não gravado:", error.message),
    );
};

const applyMonthlyLeaveCredit = async (employee, profile, month) => {
  const movementId = `credito-mensal-${employee.FuncionarioID}-${month}`;
  if (
    Number(employee.SaldoFolgasLancamentos?.[movementId]?.Delta || 0) === 1
  ) {
    return {
      applied: false,
      adjustment: 0,
      balanceBefore: Number(employee.SaldoFolgas || 0),
      balanceAfter: Number(employee.SaldoFolgas || 0),
      desiredDelta: 1,
    };
  }
  const result = await runtime.applyEmployeeLeaveBalance({
    employeeId: employee.FuncionarioID,
    movementKey: movementId,
    desiredDelta: 1,
    metadata: {
      Tipo: "Crédito mensal da quinta folga",
      Competencia: month,
    },
  });
  await saveLeaveBalanceMovement({
    movementId,
    employee,
    type: "Crédito mensal da quinta folga",
    competence: month,
    result,
    actor: profile,
  });
  return result;
};

const ensureMonthlyLeaveCredits = async (profile, employees) => {
  if (!isManager(profile)) return 0;
  const month = todayIso().slice(0, 7);
  const eligible = employees.filter(
    (employee) =>
      employee?.FuncionarioID &&
      asBoolean(employee.Ativo) &&
      !role(employee).includes("admin"),
  );
  const results = await Promise.all(
    eligible.map((employee) =>
      applyMonthlyLeaveCredit(employee, profile, month).catch((error) => {
        console.warn(
          `Crédito mensal não aplicado para ${employee.FuncionarioID}:`,
          error.message,
        );
        return { applied: false };
      }),
    ),
  );
  return results.filter((result) => result.applied).length;
};

const reconcileTimeOffBalance = async (record, profile) => {
  const employee = await runtime.getById(
    "Funcionarios",
    record.FuncionarioID,
  );
  assert(employee, "Funcionário não encontrado para atualizar o saldo.");
  if (!role(employee).includes("admin")) {
    await applyMonthlyLeaveCredit(employee, profile, todayIso().slice(0, 7));
  }
  const units = timeOffBalanceUnits(record);
  const approved = record.Status === APP.status.approved;
  const movementId = `folga-${record.FolgaID}`;
  const result = await runtime.applyEmployeeLeaveBalance({
    employeeId: employee.FuncionarioID,
    movementKey: movementId,
    desiredDelta: approved ? -units : 0,
    metadata: {
      Tipo: approved ? "Débito de folga aprovada" : "Estorno de folga",
      FolgaID: record.FolgaID,
      DataInicio: record.DataInicio,
      DataFim: record.DataFim,
      Quantidade: units,
    },
  });
  await saveLeaveBalanceMovement({
    movementId,
    employee,
    type: approved ? "Débito de folga aprovada" : "Estorno de folga",
    competence: String(record.DataInicio || "").slice(0, 7),
    referenceId: record.FolgaID,
    result,
    actor: profile,
  });
  return result;
};

export async function audit(action, module, recordId, details = {}) {
  const profile = await runtime.requireProfile();
  const entry = {
    AuditoriaID: uuid(),
    DataHora: nowIso(),
    EmailUtilizador: profile.Email,
    NomeUtilizador: profile.Nome,
    LojaID: profile.LojaID || details.LojaID || "",
    FuncionarioID: profile.FuncionarioID || "",
    Acao: action,
    Modulo: module,
    RegistoID: recordId || "",
    DadosAnteriores: details.before || "",
    DadosNovos: details.after || details,
    EnderecoOuOrigem: "Aplicação Firebase",
    Resultado: "Sucesso",
    Mensagem: details.message || "",
  };
  await runtime.upsert("Auditoria", entry).catch((error) => {
    console.warn("Auditoria não gravada:", error.message);
  });
}

export async function createNotification({
  employeeId = "",
  email = "",
  storeId = "",
  subject,
  message,
  type = "Sistema",
  relatedId = "",
}) {
  return runtime.upsert("Notificacoes", {
    NotificacaoID: uuid(),
    Destinatario: normalizeEmail(email),
    DestinatarioID: employeeId,
    LojaID: storeId,
    Assunto: subject,
    Mensagem: message,
    Tipo: type,
    Status: "Pendente",
    DataCriacao: nowIso(),
    DataEnvio: nowIso(),
    DataLeitura: "",
    LidoPor: "",
    Canal: "Aplicação",
    TentativasEnvio: 0,
    LinkAcao: "",
    Erro: "",
    RegistoRelacionadoID: relatedId,
  });
}

const dashboardFrom = (stores, employees, records) => {
  const today = todayIso();
  const next = new Date(`${today}T12:00:00`);
  next.setDate(next.getDate() + 7);
  const nextKey = todayIso(next);
  const active = records.filter((record) =>
    [APP.status.approved, APP.status.pending].includes(record.Status),
  );
  return {
    cards: {
      totalFuncionariosAtivos: employees.filter((item) =>
        asBoolean(item.Ativo),
      ).length,
      totalLojasAtivas: stores.filter((item) => asBoolean(item.Ativa)).length,
      folgasHoje: active.filter(
        (item) =>
          String(item.DataInicio || "") <= today &&
          String(item.DataFim || item.DataInicio || "") >= today,
      ).length,
      folgasProximos7Dias: active.filter(
        (item) =>
          String(item.DataInicio || "") >= today &&
          String(item.DataInicio || "") <= nextKey,
      ).length,
      pedidosPendentes: records.filter(
        (item) => item.Status === APP.status.pending,
      ).length,
    },
    proximasFolgas: active
      .filter(
        (item) => String(item.DataFim || item.DataInicio || "") >= today,
      )
      .sort((a, b) =>
        String(a.DataInicio || "").localeCompare(String(b.DataInicio || "")),
      )
      .slice(0, 10),
  };
};

async function bootstrap() {
  const profile = await runtime.requireProfile();
  const [stores, initialEmployees, timeOff, holidays] = await Promise.all([
    runtime.list("Lojas", { profile }),
    runtime.list("Funcionarios", { profile }),
    runtime.list("Folgas", { profile }),
    runtime.list("Feriados", { profile }),
  ]);
  const credited = await ensureMonthlyLeaveCredits(profile, initialEmployees);
  const employees = credited
    ? await runtime.list("Funcionarios", { profile })
    : initialEmployees;
  const currentEmployee =
    employees.find(
      (employee) =>
        (profile.FuncionarioID &&
          String(employee.FuncionarioID || "") ===
            String(profile.FuncionarioID)) ||
        (profile.Email &&
          normalizeEmail(employee.Email) === normalizeEmail(profile.Email)),
    ) ||
    employees[0] ||
    {};
  const ownStoreId = String(profile.LojaID || currentEmployee.LojaID || "");
  const ownStoreName = String(
    profile.NomeLoja || currentEmployee.NomeLoja || "",
  );
  const effectiveProfile = {
    ...profile,
    Nome: profile.Nome || currentEmployee.Nome || "",
    Email: profile.Email || currentEmployee.Email || "",
    LojaID: ownStoreId,
    NomeLoja: ownStoreName,
    Cargo: profile.Cargo || currentEmployee.Cargo || "",
  };
  const visibleStores =
    stores.length || !ownStoreId
      ? stores
      : [{ LojaID: ownStoreId, NomeLoja: ownStoreName || "Minha loja", Ativa: true }];
  return {
    app: { name: APP.name, version: APP.version },
    user: sessionUser(effectiveProfile),
    permissions: PERMISSIONS[profile.Perfil] || [],
    stores: visibleStores,
    employees,
    timeOff,
    holidays,
    users: [],
    dashboard: dashboardFrom(visibleStores, employees, timeOff),
    deferred: false,
    usersDeferred: isAdmin(profile),
    performance: { mode: "firebase-direct", serverMs: 0 },
  };
}

const normalizeStore = (payload, current, profile) => ({
  ...(current || {}),
  ...payload,
  LojaID: current?.LojaID || payload.LojaID || uuid(),
  NomeLoja: String(payload.NomeLoja || "").trim(),
  CodigoLoja: String(payload.CodigoLoja || "").trim(),
  CNPJ: String(payload.CNPJ || "").trim(),
  Morada: String(payload.Morada || "").trim(),
  Cidade: String(payload.Cidade || "").trim(),
  ResponsavelNome: String(payload.ResponsavelNome || "").trim(),
  ResponsavelEmail: normalizeEmail(payload.ResponsavelEmail),
  CalendarID: String(payload.CalendarID || "").trim(),
  LimiteFolgasPorDia: Math.max(1, Number(payload.LimiteFolgasPorDia || 1)),
  DiasFuncionamento: payload.DiasFuncionamento || "1,2,3,4,5,6",
  HorarioAbertura: payload.HorarioAbertura || "",
  HorarioFecho: payload.HorarioFecho || "",
  Ativa: payload.Ativa !== false,
  DataCriacao: current?.DataCriacao || nowIso(),
  CriadoPor: current?.CriadoPor || profile.Email,
  DataAtualizacao: nowIso(),
});

const normalizeEmployee = async (payload, current, profile) => {
  const store = payload.LojaID
    ? await runtime.getById("Lojas", payload.LojaID)
    : null;
  return {
    ...(current || {}),
    ...payload,
    FuncionarioID: current?.FuncionarioID || payload.FuncionarioID || uuid(),
    Nome: String(payload.Nome || "").trim(),
    Email: normalizeEmail(payload.Email),
    Telefone: String(payload.Telefone || "").trim(),
    LojaID: String(payload.LojaID || ""),
    NomeLoja: store?.NomeLoja || payload.NomeLoja || "",
    Cargo: String(payload.Cargo || "").trim(),
    Perfil: payload.Perfil || APP.profiles.employee,
    DataAdmissao: payload.DataAdmissao || "",
    TipoContrato: payload.TipoContrato || "",
    DiasTrabalhoSemana: payload.DiasTrabalhoSemana || "",
    DiaFolgaPreferencial: payload.DiaFolgaPreferencial || "",
    SegundoDiaFolgaPreferencial: payload.SegundoDiaFolgaPreferencial || "",
    SaldoFolgas: Number(payload.SaldoFolgas || 0),
    Ativo: payload.Ativo !== false,
    DataCriacao: current?.DataCriacao || nowIso(),
    CriadoPor: current?.CriadoPor || profile.Email,
    DataAtualizacao: nowIso(),
    CPF: String(payload.CPF || "").trim(),
  };
};

const configValue = (rows, key, fallback) => {
  const record = rows.find(
    (item) =>
      String(item.Chave || "").trim().toLowerCase() === key.toLowerCase(),
  );
  return record ? record.Valor : fallback;
};

const dayDistance = (from, to) => {
  const first = new Date(`${from}T12:00:00`).getTime();
  const last = new Date(`${to}T12:00:00`).getTime();
  return Number.isFinite(first) && Number.isFinite(last)
    ? Math.round((last - first) / 86400000)
    : 0;
};

const dateKey = (value) => String(value || "").slice(0, 10);

const weekdayLabels = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

const operationalRuleMatches = (rule, employee, day) => {
  if (!asBoolean(rule.Ativa)) return false;
  if (rule.LojaID && String(rule.LojaID) !== String(employee.LojaID)) {
    return false;
  }
  if (
    rule.Cargo &&
    String(rule.Cargo).toLowerCase() !== String(employee.Cargo || "").toLowerCase()
  ) {
    return false;
  }
  const configuredDay = String(rule.DiaSemana || "Todos").toLowerCase();
  if (!configuredDay || configuredDay === "todos") return true;
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return (
    configuredDay === String(weekday) ||
    weekdayLabels[weekday].toLowerCase().startsWith(configuredDay.slice(0, 5))
  );
};

const validateTimeOffPolicies = async ({
  profile,
  employee,
  start,
  end,
  current = null,
  approving = false,
}) => {
  const requestedDays = dateRange(start, end);
  const employeeRequest = role(profile).includes("funcion");
  const [config, holidays] = await Promise.all([
    runtime.list("Configuracoes", { profile }),
    runtime.list("Feriados", { profile }),
  ]);

  if (employeeRequest && !current) {
    const today = todayIso();
    const minimum = Math.max(
      0,
      Number(configValue(config, "Prazo mínimo de antecedência", 0)),
    );
    const maximum = Math.max(
      minimum,
      Number(configValue(config, "Prazo máximo para pedido", 180)),
    );
    const distance = dayDistance(today, start);
    assert(
      distance >= minimum,
      `O pedido precisa ser feito com pelo menos ${minimum} dia(s) de antecedência.`,
    );
    assert(
      distance <= maximum,
      `O pedido só pode ser feito com até ${maximum} dia(s) de antecedência.`,
    );
    if (
      !asBoolean(
        configValue(config, "Permitir pedidos aos fins de semana", false),
      )
    ) {
      assert(
        !requestedDays.some((day) =>
          [0, 6].includes(new Date(`${day}T12:00:00`).getDay()),
        ),
        "Pedidos de folga aos fins de semana não estão permitidos.",
      );
    }
    if (
      !asBoolean(configValue(config, "Permitir folga em feriado", true))
    ) {
      const holidayDays = new Set(
        holidays
          .filter((item) => item.Ativo !== false)
          .filter(
            (item) =>
              !item.LojaID || String(item.LojaID) === String(employee.LojaID),
          )
          .map((item) => String(item.Data || "").slice(0, 10)),
      );
      assert(
        !requestedDays.some((day) => holidayDays.has(day)),
        "Pedidos de folga em feriados não estão permitidos.",
      );
    }
  }

  if (!approving) return;
  const [store, records, employees, rules] = await Promise.all([
    runtime.getById("Lojas", employee.LojaID),
    runtime.list("Folgas", { profile }),
    runtime.list("Funcionarios", { profile }),
    runtime.list("RegrasOperacionais", { profile }),
  ]);
  const baseLimit = Math.max(
    1,
    Number(
      store?.LimiteFolgasPorDia ||
        configValue(
          config,
          "Limite padrão de funcionários de folga por dia",
          1,
        ),
    ),
  );
  const activeEmployees = employees.filter(
    (item) =>
      asBoolean(item.Ativo) &&
      String(item.LojaID) === String(employee.LojaID),
  );

  requestedDays.forEach((day) => {
    const matchingRules = rules.filter((rule) =>
      operationalRuleMatches(rule, employee, day),
    );
    const blockingRules = matchingRules.filter((rule) =>
      String(rule.ModoValidacao || "Bloquear")
        .toLowerCase()
        .includes("bloque"),
    );
    const configuredLimits = blockingRules
      .map((rule) => Number(rule.LimiteFolgasDia || 0))
      .filter((value) => value > 0);
    const dailyLimit = configuredLimits.length
      ? Math.min(baseLimit, ...configuredLimits)
      : baseLimit;
    const approvedEmployeeIds = new Set(
      records
        .filter(
          (item) =>
            item.FolgaID !== current?.FolgaID &&
            item.Status === APP.status.approved &&
            String(item.LojaID) === String(employee.LojaID) &&
            dateKey(item.DataInicio) <= day &&
            dateKey(item.DataFim || item.DataInicio) >= day,
        )
        .map((item) => item.FuncionarioID),
    );
    approvedEmployeeIds.add(employee.FuncionarioID);
    assert(
      approvedEmployeeIds.size <= dailyLimit,
      `O limite de ${dailyLimit} funcionário(s) de folga em ${day} foi atingido.`,
    );
    const requiredWorking = Math.max(
      0,
      ...blockingRules.map((rule) => Number(rule.MinimoTrabalhando || 0)),
    );
    if (requiredWorking) {
      const working = activeEmployees.filter(
        (item) => !approvedEmployeeIds.has(item.FuncionarioID),
      ).length;
      assert(
        working >= requiredWorking,
        `A aprovação deixaria somente ${working} funcionário(s) trabalhando em ${day}; o mínimo é ${requiredWorking}.`,
      );
    }
  });
};

const createOrUpdateTimeOff = async (payload, current = null) => {
  const profile = await runtime.requireProfile();
  const employeeId =
    payload.FuncionarioID ||
    payload.funcionarioId ||
    current?.FuncionarioID ||
    profile.FuncionarioID;
  const employee = await runtime.getById("Funcionarios", employeeId);
  assert(employee, "Funcionário não encontrado.");
  scopeRecord(profile, employee);
  const start = String(payload.DataInicio || payload.dataInicio || "");
  const end = String(payload.DataFim || payload.dataFim || start);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(start), "Informe a data inicial.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(end), "Informe a data final.");
  assert(end >= start, "A data final não pode ser anterior à data inicial.");
  assert(
    dateRange(start, end).length <= 30,
    "Uma folga pode ter no máximo 30 dias.",
  );
  const records = await runtime.list("Folgas", { profile });
  const conflict = records.find(
    (item) =>
      item.FolgaID !== current?.FolgaID &&
      item.FuncionarioID === employeeId &&
      ![APP.status.cancelled, APP.status.rejected].includes(item.Status) &&
      dateKey(item.DataInicio) <= end &&
      dateKey(item.DataFim || item.DataInicio) >= start,
  );
  assert(!conflict, "Já existe uma folga deste funcionário nesse período.");

  const employeeRequest = role(profile).includes("funcion");
  const type = payload.TipoFolga || current?.TipoFolga || "Folga";
  const period = payload.Periodo || current?.Periodo || "Dia inteiro";
  if (
    employeeRequest &&
    !asBoolean(
      configValue(
        await runtime.list("Configuracoes", { profile }),
        "Permitir meia folga",
        true,
      ),
    )
  ) {
    assert(
      !String(type).toLowerCase().includes("meia") &&
        !["manhã", "manha", "tarde", "personalizado"].includes(
          String(period).toLowerCase(),
        ),
      "Pedidos de meia folga não estão permitidos.",
    );
  }
  const intendedStatus =
    current?.Status ||
    (employeeRequest ? APP.status.pending : payload.Status || APP.status.approved);
  await validateTimeOffPolicies({
    profile,
    employee,
    start,
    end,
    current,
    approving: intendedStatus === APP.status.approved,
  });
  return {
    ...(current || {}),
    ...payload,
    FolgaID: current?.FolgaID || payload.FolgaID || uuid(),
    FuncionarioID: employee.FuncionarioID,
    NomeFuncionario: employee.Nome,
    EmailFuncionario: employee.Email,
    LojaID: employee.LojaID,
    NomeLoja: employee.NomeLoja,
    DataInicio: start,
    DataFim: end,
    TipoFolga: type,
    Periodo: period,
    Motivo: String(payload.Motivo || ""),
    Origem: employeeRequest ? "Pedido do funcionário" : payload.Origem || "Manual",
    Status: intendedStatus,
    SolicitadoPor: current?.SolicitadoPor || profile.Email,
    DataSolicitacao: current?.DataSolicitacao || nowIso(),
    DataCriacao: current?.DataCriacao || nowIso(),
    DataAtualizacao: nowIso(),
  };
};

const timeOffDecision = async (id, approved, observation = "") => {
  const profile = await runtime.requireProfile();
  requireManager(profile);
  const current = await runtime.getById("Folgas", id);
  assert(current, "Pedido de folga não encontrado.");
  scopeRecord(profile, current);
  assert(
    current.Status === APP.status.pending,
    "Somente pedidos pendentes podem receber uma decisão.",
  );
  if (approved) {
    const employee = await runtime.getById(
      "Funcionarios",
      current.FuncionarioID,
    );
    assert(employee, "Funcionário não encontrado.");
    await validateTimeOffPolicies({
      profile,
      employee,
      start: current.DataInicio,
      end: current.DataFim || current.DataInicio,
      current,
      approving: true,
    });
  }
  const updated = await runtime.patch("Folgas", id, {
    Status: approved ? APP.status.approved : APP.status.rejected,
    AprovadoPor: profile.Email,
    DataAprovacao: nowIso(),
    ObservacaoAprovacao: String(observation || ""),
    DataAtualizacao: nowIso(),
  });
  try {
    await reconcileTimeOffBalance(updated, profile);
  } catch (error) {
    await runtime.upsert("Folgas", current).catch(() => {});
    throw error;
  }
  await createNotification({
    employeeId: updated.FuncionarioID,
    email: updated.EmailFuncionario,
    storeId: updated.LojaID,
    subject: approved ? "Folga aprovada" : "Folga rejeitada",
    message: `Seu pedido para ${updated.DataInicio} foi ${
      approved ? "aprovado" : "rejeitado"
    }.`,
    type: "Folga",
    relatedId: id,
  }).catch((error) =>
    console.warn("Notificação da decisão não gravada:", error.message),
  );
  await audit(
    approved ? "Aprovar folga" : "Rejeitar folga",
    "Folgas",
    id,
    { before: current, after: updated },
  );
  return updated;
};

const preferredWeekdayIndex = (value) => {
  const normalized = String(value || "").toLowerCase();
  const names = [
    "domingo",
    "segunda",
    "terça",
    "quarta",
    "quinta",
    "sexta",
    "sábado",
  ];
  const index = names.findIndex((name) => normalized.startsWith(name.slice(0, 5)));
  return index >= 0 ? index : null;
};

async function simulateSchedule(payload) {
  const profile = await runtime.requireProfile();
  requireManager(profile);
  const employees = (await runtime.list("Funcionarios", { profile })).filter(
    (item) =>
      asBoolean(item.Ativo) &&
      String(item.LojaID) === String(payload.LojaID || profile.LojaID),
  );
  const start = String(payload.DataInicio || "");
  const end = String(payload.DataFim || start);
  const days = dateRange(start, end);
  const used = {};
  const maximum = Math.max(1, Number(payload.MaximoPorDia || 1));
  return employees.map((employee, index) => {
    const preferred = preferredWeekdayIndex(employee.DiaFolgaPreferencial);
    const candidates = days.filter((day) => {
      const weekday = new Date(`${day}T12:00:00`).getDay();
      return (
        (preferred === null || weekday === preferred) &&
        (asBoolean(payload.PermitirFimDeSemana) || ![0, 6].includes(weekday)) &&
        Number(used[day] || 0) < maximum
      );
    });
    const fallback = days.filter(
      (day) => Number(used[day] || 0) < maximum,
    );
    const day =
      candidates[index % Math.max(1, candidates.length)] ||
      fallback[index % Math.max(1, fallback.length)] ||
      days[index % Math.max(1, days.length)];
    used[day] = Number(used[day] || 0) + 1;
    return {
      FuncionarioID: employee.FuncionarioID,
      Funcionario: employee.Nome,
      NomeFuncionario: employee.Nome,
      LojaID: employee.LojaID,
      DataSugerida: day,
      DataInicio: day,
      DataFim: day,
      FolgaFixa: preferred !== null,
      SaldoAntes: Number(employee.SaldoFolgas || 0),
      Pontuacao: Math.max(10, 100 - Number(used[day] || 1) * 5),
      MotivoEscolha:
        preferred !== null
          ? "Preferência de folga fixa respeitada"
          : "Distribuição equilibrada na equipe",
    };
  });
}

export function createBaseHandlers(getArenaBundle) {
  return {
    async loginUser(args) {
      const payload = args[0] || {};
      const user = await runtime.login(
        payload.email || payload.Email,
        payload.senha || payload.password || payload.Senha,
        asBoolean(payload.remember || payload.ManterConectado),
      );
      const data = await bootstrap();
      const token = await user.getIdToken();
      return success(
        {
          token,
          sessionToken: token,
          user: data.user,
          rememberPersisted: asBoolean(
            payload.remember || payload.ManterConectado,
          ),
          rememberExpiresAt: asBoolean(
            payload.remember || payload.ManterConectado,
          )
            ? Date.now() + 7 * 24 * 60 * 60 * 1000
            : 0,
          bootstrap: data,
        },
        "Login realizado.",
      );
    },

    async logoutUser() {
      await runtime.logout();
      return success({}, "Sessão encerrada.");
    },

    async requestPasswordReset(args) {
      await runtime.sendPasswordReset(args[0]?.email || args[0]?.Email);
      return success({}, "E-mail de redefinição enviado.");
    },

    async confirmPasswordReset() {
      throw new Error(
        "Use o link seguro enviado pelo Firebase para concluir a redefinição.",
      );
    },

    async getBootstrapDataWithSession() {
      return success(await bootstrap(), "Aplicação carregada.");
    },

    async getClientModuleBundle(args) {
      assert(args[0] === "house-arena", "Módulo de interface inválido.");
      return success(getArenaBundle(), "Módulo carregado.");
    },

    async getDashboardData() {
      const data = await bootstrap();
      return success(data.dashboard, "Dashboard carregado.");
    },

    async getStores() {
      return success(await runtime.list("Lojas"));
    },

    async createStore(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const payload = args[0] || {};
      assert(String(payload.NomeLoja || "").trim(), "Informe o nome da loja.");
      const saved = await runtime.upsert(
        "Lojas",
        normalizeStore(payload, null, profile),
      );
      await audit("Criar loja", "Lojas", saved.LojaID, { after: saved });
      return success(saved, "Loja criada.");
    },

    async updateStore(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const [id, payload] = args;
      const current = await runtime.getById("Lojas", id);
      assert(current, "Loja não encontrada.");
      const saved = await runtime.upsert(
        "Lojas",
        normalizeStore(payload || {}, current, profile),
      );
      await audit("Atualizar loja", "Lojas", id, {
        before: current,
        after: saved,
      });
      return success(saved, "Loja atualizada.");
    },

    async disableStore(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const saved = await runtime.patch("Lojas", args[0], {
        Ativa: false,
        DataAtualizacao: nowIso(),
      });
      return success(saved, "Loja desativada.");
    },

    async activateStore(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const saved = await runtime.patch("Lojas", args[0], {
        Ativa: true,
        DataAtualizacao: nowIso(),
      });
      return success(saved, "Loja ativada.");
    },

    async getEmployees() {
      return success(await runtime.list("Funcionarios"));
    },

    async createEmployee(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const payload = args[0] || {};
      assert(String(payload.Nome || "").trim(), "Informe o nome.");
      assert(normalizeEmail(payload.Email), "Informe um e-mail válido.");
      const saved = await runtime.upsert(
        "Funcionarios",
        await normalizeEmployee(payload, null, profile),
      );
      await audit("Criar funcionário", "Funcionarios", saved.FuncionarioID, {
        after: saved,
      });
      return success(saved, "Funcionário criado.");
    },

    async updateEmployee(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const [id, payload] = args;
      const current = await runtime.getById("Funcionarios", id);
      assert(current, "Funcionário não encontrado.");
      scopeRecord(profile, current);
      const saved = await runtime.upsert(
        "Funcionarios",
        await normalizeEmployee(payload || {}, current, profile),
      );
      await audit("Atualizar funcionário", "Funcionarios", id, {
        before: current,
        after: saved,
      });
      return success(saved, "Funcionário atualizado.");
    },

    async disableEmployee(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const id = args[0];
      const saved = await runtime.patch("Funcionarios", id, {
        Ativo: false,
        DataAtualizacao: nowIso(),
      });
      const access = (await runtime.listAccess()).find(
        (item) => item.FuncionarioID === id,
      );
      if (access) {
        await runtime.saveAccess(access.UsuarioID, {
          ...access,
          Ativo: false,
          DataAtualizacao: nowIso(),
        });
      }
      return success(saved, "Funcionário desativado.");
    },

    async activateEmployee(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const id = args[0];
      const saved = await runtime.patch("Funcionarios", id, {
        Ativo: true,
        DataAtualizacao: nowIso(),
      });
      const access = (await runtime.listAccess()).find(
        (item) => item.FuncionarioID === id,
      );
      if (access) {
        await runtime.saveAccess(access.UsuarioID, {
          ...access,
          Ativo: true,
          DataAtualizacao: nowIso(),
        });
      }
      return success(saved, "Funcionário ativado.");
    },

    async getTimeOffRecords() {
      return success(await runtime.list("Folgas"));
    },

    async validateTimeOffRequest(args) {
      const payload = args[0] || {};
      await createOrUpdateTimeOff(payload);
      return success({ valid: true }, "Pedido válido.");
    },

    async createTimeOff(args) {
      const profile = await runtime.requireProfile();
      const saved = await runtime.upsert(
        "Folgas",
        await createOrUpdateTimeOff(args[0] || {}),
      );
      if (isManager(profile)) {
        try {
          await reconcileTimeOffBalance(saved, profile);
        } catch (error) {
          await runtime.delete("Folgas", saved.FolgaID).catch(() => {});
          throw error;
        }
      }
      await audit("Criar folga", "Folgas", saved.FolgaID, { after: saved });
      return success(saved, "Folga criada.");
    },

    async createEmployeeTimeOffRequest(args) {
      const values = dropClientToken(args);
      const saved = await runtime.upsert(
        "Folgas",
        await createOrUpdateTimeOff(values[0] || {}),
      );
      await audit("Solicitar folga", "Folgas", saved.FolgaID, {
        after: saved,
      });
      return success(saved, "Pedido de folga enviado.");
    },

    async updateTimeOff(args) {
      const [id, payload] = args;
      const profile = await runtime.requireProfile();
      const current = await runtime.getById("Folgas", id);
      assert(current, "Folga não encontrada.");
      scopeRecord(profile, current);
      if (!isManager(profile)) {
        assert(
          current.Status === APP.status.pending,
          "Somente pedidos pendentes podem ser alterados pelo funcionário.",
        );
        assert(
          !payload?.Status ||
            [APP.status.pending, APP.status.cancelled].includes(payload.Status),
          "O funcionário não pode aprovar nem reabrir o próprio pedido.",
        );
      }
      const saved = await runtime.upsert(
        "Folgas",
        await createOrUpdateTimeOff(payload || {}, current),
      );
      if (isManager(profile)) {
        try {
          await reconcileTimeOffBalance(saved, profile);
        } catch (error) {
          await runtime.upsert("Folgas", current).catch(() => {});
          throw error;
        }
      }
      await audit("Atualizar folga", "Folgas", id, {
        before: current,
        after: saved,
      });
      return success(saved, "Folga atualizada.");
    },

    async cancelTimeOff(args) {
      const [id, reason] = args;
      const profile = await runtime.requireProfile();
      const current = await runtime.getById("Folgas", id);
      assert(current, "Folga não encontrada.");
      scopeRecord(profile, current);
      if (!isManager(profile)) {
        assert(
          current.Status === APP.status.pending,
          "Somente pedidos pendentes podem ser cancelados pelo funcionário.",
        );
      }
      const saved = await runtime.patch("Folgas", id, {
        Status: APP.status.cancelled,
        CanceladoPor: profile.Email,
        DataCancelamento: nowIso(),
        MotivoCancelamento: String(reason || ""),
        DataAtualizacao: nowIso(),
      });
      if (isManager(profile)) {
        try {
          await reconcileTimeOffBalance(saved, profile);
        } catch (error) {
          await runtime.upsert("Folgas", current).catch(() => {});
          throw error;
        }
      }
      await audit("Cancelar folga", "Folgas", id, {
        before: current,
        after: saved,
      });
      return success(saved, "Folga cancelada.");
    },

    async approveTimeOff(args) {
      return success(
        await timeOffDecision(args[0], true, args[1]),
        "Pedido aprovado.",
      );
    },

    async rejectTimeOff(args) {
      return success(
        await timeOffDecision(args[0], false, args[1]),
        "Pedido rejeitado.",
      );
    },

    async decideTimeOffWithSession(args) {
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const approved =
        String(payload.acao || "").toLowerCase() === "aprovar" ||
        payload.approved === true;
      return success(
        await timeOffDecision(
          payload.folgaId || payload.FolgaID || payload.id,
          approved,
          payload.observacao || payload.ObservacaoAprovacao,
        ),
        approved ? "Pedido aprovado." : "Pedido rejeitado.",
      );
    },

    async getHolidays() {
      return success(await runtime.list("Feriados"));
    },

    async createHoliday(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const payload = args[0] || {};
      const saved = await runtime.upsert("Feriados", {
        ...payload,
        FeriadoID: payload.FeriadoID || uuid(),
        Nacional: payload.Tipo === "Nacional",
        Regional: payload.Tipo === "Regional",
        Municipal: payload.Tipo === "Municipal",
        Ativo: payload.Ativo !== false,
        DataCriacao: nowIso(),
        CriadoPor: profile.Email,
      });
      return success(saved, "Feriado criado.");
    },

    async updateHoliday(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const [id, payload] = args;
      const current = await runtime.getById("Feriados", id);
      assert(current, "Feriado não encontrado.");
      const saved = await runtime.upsert("Feriados", {
        ...current,
        ...payload,
        FeriadoID: id,
      });
      return success(saved, "Feriado atualizado.");
    },

    async simulateAutomaticTimeOff(args) {
      const suggestions = await simulateSchedule(args[0] || {});
      return success(
        { suggestions, simulacao: suggestions },
        "Simulação concluída.",
      );
    },

    async simulateAutomaticTimeOffWithAI(args) {
      const suggestions = (await simulateSchedule(args[0] || {})).map(
        (item) => ({
          ...item,
          AnaliseIA: "Aprovado",
          ObservacaoIA:
            "Distribuição revisada localmente, sem enviar dados a serviços externos.",
        }),
      );
      return success({
        sugestoes: suggestions,
        resumoIA:
          "A escala foi revisada com regras locais para preservar o plano gratuito.",
        alertasIA: [],
      });
    },

    async generateAutomaticTimeOff(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const suggestions = Array.isArray(args[1]) ? args[1] : [];
      const saved = [];
      for (const item of suggestions) {
        const record = await runtime.upsert(
          "Folgas",
          await createOrUpdateTimeOff({
            ...item,
            DataInicio: item.DataInicio || item.DataSugerida,
            DataFim: item.DataFim || item.DataSugerida,
            Origem: "Geração automática",
            Status: APP.status.approved,
          }),
        );
        await reconcileTimeOffBalance(record, profile);
        saved.push(record);
      }
      return success(saved, `${saved.length} folga(s) gerada(s).`);
    },

    async getAuditLogs() {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const rows = await runtime.list("Auditoria", { profile });
      return success(
        rows
          .sort((a, b) => String(b.DataHora).localeCompare(String(a.DataHora)))
          .slice(0, 500),
      );
    },

    async exportReportToCsv() {
      const profile = await runtime.requireProfile();
      const rows = await runtime.list("Folgas", { profile });
      const columns = [
        "FolgaID",
        "NomeFuncionario",
        "NomeLoja",
        "DataInicio",
        "DataFim",
        "TipoFolga",
        "Status",
        "Motivo",
      ];
      return success({
        url: csvDataUrl(rows, columns),
        name: "relatorio-folgas.csv",
      });
    },

    async exportReportToPdf() {
      throw new Error(
        "Use a opção de impressão do navegador e escolha “Salvar como PDF”.",
      );
    },

    async exportCalendarToPdf() {
      throw new Error("Use a versão de impressão do calendário.");
    },

    async getUsers() {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      return success(await runtime.listAccess());
    },

    async createUser(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      assert(
        String(payload.Senha || "").length >= 10,
        "A senha inicial deve ter pelo menos 10 caracteres.",
      );
      const employee = payload.FuncionarioID
        ? await runtime.getById("Funcionarios", payload.FuncionarioID)
        : null;
      if (payload.FuncionarioID) {
        assert(employee, "Funcionário não encontrado.");
      }
      let saved = null;
      const uid = await runtime.createAuthUser(
        payload.Email,
        payload.Senha,
        async (createdUid) => {
          saved = {
            UsuarioID: createdUid,
            FuncionarioID: payload.FuncionarioID || "",
            Nome: payload.Nome || employee?.Nome || "",
            Email: normalizeEmail(payload.Email || employee?.Email),
            Perfil: payload.Perfil || employee?.Perfil || APP.profiles.employee,
            LojaID: payload.LojaID || employee?.LojaID || "",
            NomeLoja: employee?.NomeLoja || "",
            Cargo: employee?.Cargo || "",
            PrimeiroAcesso: payload.PrimeiroAcesso !== false,
            Ativo: payload.Ativo !== false,
            DataCriacao: nowIso(),
            DataAtualizacao: nowIso(),
          };
          let accessCreated = false;
          try {
            await runtime.saveAccess(createdUid, saved);
            accessCreated = true;
            if (employee) {
              await runtime.patch("Funcionarios", employee.FuncionarioID, {
                AuthUID: createdUid,
                Email: saved.Email,
                Perfil: saved.Perfil,
              });
            }
          } catch (error) {
            if (accessCreated) {
              await runtime.deleteAccess(createdUid).catch(() => {});
            }
            throw error;
          }
        },
      );
      await audit("Criar acesso", "Usuarios", uid, { after: saved });
      return success(saved, "Acesso criado.");
    },

    async updateUser(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const values = dropClientToken(args);
      const [id, payload] = values;
      const current = await runtime.getAccess(id);
      assert(current, "Acesso não encontrado.");
      const saved = {
        ...current,
        ...payload,
        UsuarioID: id,
        // O administrador não consegue trocar com segurança o e-mail do
        // Firebase Auth de outra pessoa. Preserve o endereço já vinculado.
        Email: normalizeEmail(current.Email),
        Ativo: payload.Ativo !== false,
        DataAtualizacao: nowIso(),
      };
      delete saved.Senha;
      delete saved.EnviarRedefinicao;
      await runtime.saveAccess(id, saved);
      if (asBoolean(payload.EnviarRedefinicao)) {
        await runtime.sendPasswordReset(current.Email);
      }
      if (saved.FuncionarioID) {
        await runtime.patch("Funcionarios", saved.FuncionarioID, {
          Email: saved.Email,
          Perfil: saved.Perfil,
          LojaID: saved.LojaID,
          Ativo: saved.Ativo,
          DataAtualizacao: nowIso(),
        });
      }
      await audit("Atualizar acesso", "Usuarios", id, {
        before: current,
        after: saved,
      });
      return success(saved, "Acesso atualizado.");
    },

    async updateOwnProfile(args) {
      const profile = await runtime.requireProfile();
      const payload = args[0] || {};
      const email = normalizeEmail(payload.Email || profile.Email);
      const password =
        payload.NovaSenha || payload.novaSenha || payload.newPassword || "";
      if (password) {
        assert(password.length >= 10, "A nova senha deve ter 10 caracteres.");
        assert(
          password ===
            (payload.ConfirmarNovaSenha ||
              payload.confirmarNovaSenha ||
              payload.passwordConfirmation),
          "A confirmação da nova senha não confere.",
        );
      }
      const currentPassword =
        payload.SenhaAtual ||
        payload.senhaAtual ||
        payload.currentPassword ||
        "";
      assert(
        !password || email === normalizeEmail(profile.Email),
        "Altere o e-mail e a senha em etapas separadas.",
      );
      const saved = {
        ...profile,
        Email: email,
        FotoPerfil: "",
        PrimeiroAcesso: password ? false : profile.PrimeiroAcesso,
        DataAtualizacao: nowIso(),
      };
      await runtime.saveAccess(profile.UsuarioID, saved);
      try {
        await runtime.updateOwnAuth({
          email,
          password,
          currentPassword,
        });
      } catch (error) {
        await runtime.saveAccess(profile.UsuarioID, profile).catch(() => {});
        throw error;
      }
      if (saved.FuncionarioID) {
        await runtime
          .patch("Funcionarios", saved.FuncionarioID, {
            Email: email,
            DataAtualizacao: nowIso(),
          })
          .catch((error) => {
            if (!isPermissionDenied(error)) {
              console.warn(
                "Cadastro administrativo não sincronizado:",
                error.message,
              );
            }
          });
      }
      return success(saved, "Perfil atualizado.");
    },
  };
}

export { bootstrap, dropClientToken, isAdmin, isManager, requireAdmin, requireManager, scopeRecord };
