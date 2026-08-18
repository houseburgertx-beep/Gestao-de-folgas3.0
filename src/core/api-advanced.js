import { APP } from "./constants.js";
import { runtime } from "./runtime.js";
import {
  asBoolean,
  assert,
  csvDataUrl,
  dateRange,
  nowIso,
  todayIso,
  uuid,
} from "./utils.js";
import {
  audit,
  createNotification,
  dropClientToken,
  isAdmin,
  isManager,
  requireAdmin,
  requireManager,
  scopeRecord,
  success,
} from "./api-base.js";
import { clockContext } from "./api-clock.js";

const filterAudience = (rows, profile) =>
  rows.filter((item) => {
    if (item.Ativo === false) return false;
    if (item.ExpiraEm && new Date(item.ExpiraEm).getTime() < Date.now()) {
      return false;
    }
    if (item.LojaID && item.LojaID !== profile.LojaID && !isAdmin(profile)) {
      return false;
    }
    const audience = String(item.PublicoAlvo || "Todos").toLowerCase();
    if (audience === "todos") return true;
    if (audience.includes("funcion")) {
      return String(profile.Perfil).toLowerCase().includes("funcion");
    }
    if (audience.includes("gest")) return isManager(profile);
    return true;
  });

const employeeById = async (id) => {
  const employee = await runtime.getById("Funcionarios", id);
  assert(employee, "Funcionário não encontrado.");
  return employee;
};

const normalizedDateKey = (value) => {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
};

const shiftDateRange = (record, newStart) => {
  const originalDays = Math.max(
    1,
    dateRange(record.DataInicio, record.DataFim || record.DataInicio).length,
  );
  const end = new Date(`${newStart}T12:00:00`);
  end.setDate(end.getDate() + originalDays - 1);
  return {
    DataInicio: newStart,
    DataFim: todayIso(end),
  };
};

const swapWeekdays = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];

const normalizedWeekday = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const employeeHasFixedDay = (employee, dateKey) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return false;
  const expected = normalizedWeekday(
    swapWeekdays[new Date(`${dateKey}T12:00:00`).getDay()],
  ).slice(0, 5);
  return [
    employee?.DiaFolgaPreferencial,
    employee?.SegundoDiaFolgaPreferencial,
  ]
    .filter(Boolean)
    .some((day) => normalizedWeekday(day).startsWith(expected));
};

const activeTimeOff = (record) =>
  ![APP.status.cancelled, APP.status.rejected].includes(record?.Status);

const fixedDateWasSwapped = (records, employeeId, dateKey) =>
  records.some(
    (item) =>
      String(item.FuncionarioID || "") === String(employeeId || "") &&
      [APP.status.approved, APP.status.completed].includes(item.Status) &&
      normalizedDateKey(item.FolgaFixaSubstituidaData) === dateKey,
  );

const fixedSwapId = (employeeId, dateKey) =>
  `FIXA-${employeeId}-${dateKey}`;

const fixedSwapParts = (id) => {
  const match = String(id || "").match(
    /^FIXA-(.+)-(\d{4}-\d{2}-\d{2})$/,
  );
  return match ? { employeeId: match[1], date: match[2] } : null;
};

const weekStartKey = (dateKey) => {
  const date = new Date(`${dateKey}T12:00:00`);
  const weekday = date.getDay();
  date.setDate(date.getDate() - (weekday === 0 ? 6 : weekday - 1));
  return todayIso(date);
};

const sameSwapWeek = (left, right) =>
  weekStartKey(left) === weekStartKey(right);

const timeOffList = (value) =>
  Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];

const sanitizedSwapTimeOff = (record, employee) => ({
  FolgaID: record.FolgaID,
  FuncionarioID: employee.FuncionarioID,
  NomeFuncionario: employee.Nome || record.NomeFuncionario || "",
  LojaID: employee.LojaID || record.LojaID || "",
  NomeLoja: employee.NomeLoja || record.NomeLoja || "",
  DataInicio: normalizedDateKey(record.DataInicio),
  DataFim: normalizedDateKey(record.DataFim || record.DataInicio),
  TipoFolga: record.TipoFolga || "Folga",
  Periodo: record.Periodo || "Dia inteiro",
  Status: record.Status,
  TipoSelecao: "Cadastrada",
});

export const fixedTimeOffCandidates = (
  employee,
  records = [],
  currentDay = todayIso(),
  horizonDays = 84,
) => {
  const candidates = [];
  const cursor = new Date(`${currentDay}T12:00:00`);
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() + offset);
    const dateKey = todayIso(date);
    if (
      !employeeHasFixedDay(employee, dateKey) ||
      fixedDateWasSwapped(records, employee.FuncionarioID, dateKey)
    ) {
      continue;
    }
    candidates.push({
      FolgaID: fixedSwapId(employee.FuncionarioID, dateKey),
      FuncionarioID: employee.FuncionarioID,
      NomeFuncionario: employee.Nome || "",
      LojaID: employee.LojaID || "",
      NomeLoja: employee.NomeLoja || "",
      DataInicio: dateKey,
      DataFim: dateKey,
      TipoFolga: "Folga fixa",
      Periodo: "Dia inteiro",
      Status: APP.status.approved,
      TipoSelecao: "Fixa",
      FolgaFixaData: dateKey,
      _virtualFixed: true,
    });
  }
  return candidates;
};

const swapTimeOffForEmployee = (employee, records, currentDay = todayIso()) => {
  const registered = records
    .filter(
      (item) =>
        String(item.FuncionarioID || "") ===
          String(employee.FuncionarioID || "") &&
        item.Status === APP.status.approved &&
        normalizedDateKey(item.DataInicio) >= currentDay &&
        !item.FolgaFixaSubstituidaData,
    )
    .map((item) => sanitizedSwapTimeOff(item, employee));
  return [
    ...registered,
    ...fixedTimeOffCandidates(employee, records, currentDay),
  ].sort((a, b) =>
    normalizedDateKey(a.DataInicio).localeCompare(
      normalizedDateKey(b.DataInicio),
    ),
  );
};

const swapDirectoryRecord = (employee, records) => ({
  FuncionarioID: employee.FuncionarioID,
  Nome: employee.Nome || "",
  LojaID: employee.LojaID || "",
  NomeLoja: employee.NomeLoja || "",
  Ativo: asBoolean(employee.Ativo),
  DiaFolgaPreferencial: employee.DiaFolgaPreferencial || "",
  SegundoDiaFolgaPreferencial:
    employee.SegundoDiaFolgaPreferencial || "",
  folgas: asBoolean(employee.Ativo)
    ? swapTimeOffForEmployee(employee, records)
    : [],
  DataAtualizacao: nowIso(),
});

const SWAP_DIRECTORY_CATEGORY = "Sistema: Diretório de trocas";

const fallbackSwapDirectoryRecord = (record) => ({
  ComID: `DIRETORIO-TROCA-${record.FuncionarioID}`,
  Categoria: SWAP_DIRECTORY_CATEGORY,
  Titulo: "Diretório interno de trocas",
  Corpo: "",
  PublicoAlvo: "Todos",
  ExigeConfirmacao: false,
  Ativo: false,
  FuncionarioID: record.FuncionarioID,
  Nome: record.Nome,
  LojaID: record.LojaID,
  NomeLoja: record.NomeLoja,
  FuncionarioAtivo: record.Ativo,
  DiaFolgaPreferencial: record.DiaFolgaPreferencial,
  SegundoDiaFolgaPreferencial: record.SegundoDiaFolgaPreferencial,
  folgas: record.folgas,
  DataHora: record.DataAtualizacao,
  DataAtualizacao: record.DataAtualizacao,
});

const directoryFromFallback = (record) => ({
  FuncionarioID: record.FuncionarioID,
  Nome: record.Nome || "",
  LojaID: record.LojaID || "",
  NomeLoja: record.NomeLoja || "",
  Ativo: asBoolean(record.FuncionarioAtivo),
  DiaFolgaPreferencial: record.DiaFolgaPreferencial || "",
  SegundoDiaFolgaPreferencial:
    record.SegundoDiaFolgaPreferencial || "",
  folgas: timeOffList(record.folgas),
  DataAtualizacao: record.DataAtualizacao || record.DataHora || "",
});

const swapCandidateRows = async (profile) => {
  if (isManager(profile)) {
    const [employees, records] = await Promise.all([
      runtime.list("Funcionarios", { profile }),
      runtime.list("Folgas", { profile }),
    ]);
    const directory = employees.map((employee) =>
      swapDirectoryRecord(employee, records),
    );
    await Promise.all([
      Promise.all(
        directory.map((record) =>
          runtime.upsert("DiretorioTrocasFolga", record),
        ),
      ).catch((error) =>
        console.warn(
          "Diretório dedicado de trocas indisponível:",
          error.message,
        ),
      ),
      Promise.all(
        directory.map((record) =>
          runtime.upsert(
            "Comunicados",
            fallbackSwapDirectoryRecord(record),
          ),
        ),
      ),
    ]);
    return directory.filter((record) => record.Ativo);
  }

  const [directory, fallbackRows, ownEmployees, ownRecords] =
    await Promise.all([
      runtime
        .list("DiretorioTrocasFolga", { profile })
        .catch(() => []),
      runtime.list("Comunicados", { profile }),
      runtime.list("Funcionarios", { profile }),
      runtime.list("Folgas", { profile }),
    ]);
  const byEmployee = new Map(
    fallbackRows
      .filter((record) => record.Categoria === SWAP_DIRECTORY_CATEGORY)
      .map(directoryFromFallback)
      .map((record) => [
        String(record.FuncionarioID || ""),
        record,
      ]),
  );
  directory.forEach((record) => {
    byEmployee.set(
      String(record.FuncionarioID || ""),
      {
        ...record,
        folgas: timeOffList(record.folgas),
      },
    );
  });
  ownEmployees.forEach((employee) => {
    byEmployee.set(
      String(employee.FuncionarioID || ""),
      swapDirectoryRecord(employee, ownRecords),
    );
  });
  return [...byEmployee.values()].filter(
    (record) =>
      asBoolean(record.Ativo) &&
      String(record.LojaID || "") === String(profile.LojaID || ""),
  );
};

const swapSelection = (rows, employeeId, timeOffId) => {
  const employee = rows.find(
    (item) =>
      String(item.FuncionarioID || "") === String(employeeId || ""),
  );
  if (!employee) return null;
  const timeOff = timeOffList(employee.folgas).find(
    (item) => String(item.FolgaID || "") === String(timeOffId || ""),
  );
  return timeOff ? { employee, timeOff } : null;
};

const selectionType = (timeOff, storedType = "") =>
  storedType === "Fixa" ||
  timeOff?.TipoSelecao === "Fixa" ||
  !!fixedSwapParts(timeOff?.FolgaID)
    ? "Fixa"
    : "Cadastrada";

const singleDaySelection = (record) =>
  normalizedDateKey(record.DataInicio) ===
  normalizedDateKey(record.DataFim || record.DataInicio);

const fixedOverrideRecord = ({
  swapId,
  employee,
  sourceDate,
  targetDate,
  actor,
  changedAt,
}) => ({
  FolgaID: `TROCA-FIXA-${swapId}-${employee.FuncionarioID}`,
  FuncionarioID: employee.FuncionarioID,
  NomeFuncionario: employee.Nome || "",
  EmailFuncionario: employee.Email || "",
  LojaID: employee.LojaID || "",
  NomeLoja: employee.NomeLoja || "",
  DataInicio: targetDate,
  DataFim: targetDate,
  TipoFolga: "Troca de folga fixa",
  Periodo: "Dia inteiro",
  Motivo: "Troca semanal de folga fixa aprovada",
  Origem: "Troca semanal de folga fixa",
  Status: APP.status.approved,
  TrocaFolgaID: swapId,
  FolgaFixaSubstituidaData: sourceDate,
  ImpactaSaldoFolgas: false,
  DataAprovacao: changedAt,
  AprovadoPor: actor.Email || "",
  DataCriacao: changedAt,
  CriadoPor: actor.Email || "",
  DataAtualizacao: changedAt,
});

const sha256 = async (value) => {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
};

const nextTimeOffSummary = (records, employeeId, currentDay = todayIso()) => {
  const next = records
    .filter(
      (item) =>
        item.FuncionarioID === employeeId &&
        item.Status === APP.status.approved &&
        normalizedDateKey(item.DataInicio) >= currentDay,
    )
    .sort((a, b) =>
      normalizedDateKey(a.DataInicio).localeCompare(
        normalizedDateKey(b.DataInicio),
      ),
    )[0];
  if (!next) return null;

  const dateKey = normalizedDateKey(next.DataInicio);
  const nextDate = new Date(`${dateKey}T12:00:00`);
  const currentDate = new Date(`${currentDay}T12:00:00`);
  const days =
    Math.max(0, Math.round((nextDate - currentDate) / 86400000)) + 1;
  const weekdays = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ];
  return {
    ...next,
    dias: days,
    diaSemana: weekdays[nextDate.getDay()],
    data: dateKey,
  };
};

export function createAdvancedHandlers() {
  return {
    async getOperationalRules() {
      return success(await runtime.list("RegrasOperacionais"));
    },

    async saveOperationalRule(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const payload = args[0] || {};
      if (payload.LojaID) scopeRecord(profile, payload);
      const current = payload.RegraOperacionalID
        ? await runtime.getById(
            "RegrasOperacionais",
            payload.RegraOperacionalID,
          )
        : null;
      const store = payload.LojaID
        ? await runtime.getById("Lojas", payload.LojaID)
        : null;
      const saved = await runtime.upsert("RegrasOperacionais", {
        ...(current || {}),
        ...payload,
        RegraOperacionalID: current?.RegraOperacionalID || uuid(),
        NomeLoja: store?.NomeLoja || payload.NomeLoja || "",
        Ativa: payload.Ativa !== false,
        DataCriacao: current?.DataCriacao || nowIso(),
        CriadoPor: current?.CriadoPor || profile.Email,
        DataAtualizacao: nowIso(),
      });
      return success(saved, "Regra operacional guardada.");
    },

    async getTimeOffSwaps() {
      const profile = await runtime.requireProfile();
      const rows = await runtime.list("TrocasFolga", { profile });
      if (isManager(profile)) {
        return success(rows.filter((item) => !item.TrocaPrincipalID));
      }
      const primaryIds = [
        ...new Set(
          rows.map((item) => item.TrocaPrincipalID || item.TrocaID),
        ),
      ].filter(Boolean);
      const resolved = await Promise.all(
        primaryIds.map((id) => runtime.getById("TrocasFolga", id)),
      );
      return success(resolved.filter(Boolean));
    },

    async getTimeOffSwapCandidates() {
      const profile = await runtime.requireProfile();
      return success(await swapCandidateRows(profile));
    },

    async createTimeOffSwap(args) {
      const profile = await runtime.requireProfile();
      const payload = args[0] || {};
      const rows = await swapCandidateRows(profile);
      const originId =
        payload.folgaOrigemId || payload.FolgaOrigemID || "";
      const destinationEmployeeId =
        payload.funcionarioDestinoId || payload.FuncionarioDestinoID || "";
      const destinationTimeOffId =
        payload.folgaDestinoId || payload.FolgaDestinoID || "";
      const inferredOrigin = rows.find((employee) =>
        timeOffList(employee.folgas).some(
          (item) => String(item.FolgaID || "") === String(originId),
        ),
      );
      const originEmployeeId =
        payload.funcionarioOrigemId ||
        payload.FuncionarioOrigemID ||
        profile.FuncionarioID ||
        inferredOrigin?.FuncionarioID;
      const originSelection = swapSelection(
        rows,
        originEmployeeId,
        originId,
      );
      assert(originSelection, "Folga de origem não encontrada.");
      const { employee: originEmployee, timeOff: origin } =
        originSelection;
      scopeRecord(profile, {
        FuncionarioID: originEmployee.FuncionarioID,
        LojaID: originEmployee.LojaID,
      });
      assert(
        origin.Status === APP.status.approved &&
          normalizedDateKey(origin.DataInicio) >= todayIso(),
        "Selecione uma folga futura e aprovada.",
      );
      const destinationSelection = swapSelection(
        rows,
        destinationEmployeeId,
        destinationTimeOffId,
      );
      assert(
        destinationSelection,
        "Selecione uma folga válida do funcionário de destino.",
      );
      const {
        employee: destinationEmployee,
        timeOff: destinationTimeOff,
      } = destinationSelection;
      assert(asBoolean(destinationEmployee.Ativo), "Funcionário inativo.");
      assert(
        destinationEmployee.FuncionarioID !==
          originEmployee.FuncionarioID,
        "Selecione outro funcionário para a troca.",
      );
      assert(
        originEmployee.LojaID === destinationEmployee.LojaID,
        "A troca deve ocorrer entre funcionários da mesma loja.",
      );
      assert(
        destinationTimeOff.Status === APP.status.approved &&
          normalizedDateKey(destinationTimeOff.DataInicio) >= todayIso(),
        "A folga de destino não é válida para esta troca.",
      );
      const originType = selectionType(origin);
      const destinationType = selectionType(destinationTimeOff);
      const fixedInvolved =
        originType === "Fixa" || destinationType === "Fixa";
      assert(
        normalizedDateKey(origin.DataInicio) !==
          normalizedDateKey(destinationTimeOff.DataInicio),
        "Escolha duas datas diferentes para a troca.",
      );
      if (fixedInvolved) {
        assert(
          singleDaySelection(origin) &&
            singleDaySelection(destinationTimeOff),
          "A troca de folga fixa deve usar dias inteiros.",
        );
        assert(
          sameSwapWeek(
            normalizedDateKey(origin.DataInicio),
            normalizedDateKey(destinationTimeOff.DataInicio),
          ),
          "A folga fixa só pode ser trocada por outro dia da mesma semana.",
        );
      }
      const swapId = uuid();
      const swapRecord = {
        TrocaID: swapId,
        FolgaOrigemID: origin.FolgaID,
        FolgaDestinoOriginalID: destinationTimeOff.FolgaID,
        TipoFolgaOrigem: originType,
        TipoFolgaDestino: destinationType,
        FuncionarioOrigemID: originEmployee.FuncionarioID,
        NomeFuncionarioOrigem: originEmployee.Nome,
        FuncionarioDestinoID: destinationEmployee.FuncionarioID,
        NomeFuncionarioDestino: destinationEmployee.Nome,
        LojaID: originEmployee.LojaID,
        DataFolgaOrigem: normalizedDateKey(origin.DataInicio),
        DataFolgaDestino: normalizedDateKey(
          destinationTimeOff.DataInicio,
        ),
        EscopoTroca: fixedInvolved ? "Semana selecionada" : "Datas selecionadas",
        Motivo: String(payload.motivo || payload.Motivo || ""),
        Status: "Aguardando aceite",
        AceiteDestino: "",
        DataAceiteDestino: "",
        DecididoPor: "",
        DataDecisao: "",
        ObservacaoGestor: "",
        DataCriacao: nowIso(),
        CriadoPor: profile.Email,
        DataAtualizacao: nowIso(),
      };
      const pointerRecord = (employeeId) => ({
        ...swapRecord,
        TrocaID: `${swapId}__${employeeId}`,
        TrocaPrincipalID: swapId,
        FuncionarioID: employeeId,
      });
      const [saved] = await runtime.patchMany([
        {
          table: "TrocasFolga",
          id: swapId,
          createIfMissing: true,
          record: swapRecord,
        },
        {
          table: "TrocasFolga",
          id: `${swapId}__${originEmployee.FuncionarioID}`,
          createIfMissing: true,
          record: pointerRecord(originEmployee.FuncionarioID),
        },
        {
          table: "TrocasFolga",
          id: `${swapId}__${destinationEmployee.FuncionarioID}`,
          createIfMissing: true,
          record: pointerRecord(destinationEmployee.FuncionarioID),
        },
      ]);
      await createNotification({
        employeeId: destinationEmployee.FuncionarioID,
        email: "",
        storeId: originEmployee.LojaID,
        subject: "Proposta de troca de folga",
        message: `${originEmployee.Nome} enviou uma proposta de troca válida somente para as datas selecionadas.`,
        type: "Troca",
        relatedId: saved.TrocaID,
      }).catch((error) =>
        console.warn(
          "A proposta ficará disponível na central de pendências:",
          error.message,
        ),
      );
      return success(saved, "Proposta de troca enviada.");
    },

    async respondTimeOffSwap(args) {
      const profile = await runtime.requireProfile();
      const [id, accept] = args;
      const current = await runtime.getById("TrocasFolga", id);
      assert(current, "Proposta não encontrada.");
      assert(
        current.FuncionarioDestinoID === profile.FuncionarioID,
        "Somente o destinatário pode responder.",
      );
      assert(
        current.Status === "Aguardando aceite",
        "Esta proposta já recebeu uma resposta.",
      );
      const accepted = asBoolean(accept);
      const saved = await runtime.patch("TrocasFolga", id, {
        AceiteDestino: accepted,
        DataAceiteDestino: nowIso(),
        Status: accepted ? "Aguardando gestor" : "Recusada",
        DataAtualizacao: nowIso(),
      });
      return success(saved, accepted ? "Troca aceita." : "Troca recusada.");
    },

    async decideTimeOffSwap(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const [id, approve, observation] = args;
      const current = await runtime.getById("TrocasFolga", id);
      assert(current, "Troca não encontrada.");
      scopeRecord(profile, current);
      assert(
        current.Status === "Aguardando gestor" &&
          asBoolean(current.AceiteDestino),
        "A troca precisa ser aceita pelo funcionário antes da decisão.",
      );
      const approved = asBoolean(approve);
      if (!approved) {
        const rejected = await runtime.patch("TrocasFolga", id, {
          Status: "Rejeitada",
          DecididoPor: profile.Email,
          DataDecisao: nowIso(),
          ObservacaoGestor: String(observation || ""),
          DataAtualizacao: nowIso(),
        });
        return success(rejected, "Troca rejeitada.");
      }

      const [originEmployee, destinationEmployee, allTimeOff] =
        await Promise.all([
          employeeById(current.FuncionarioOrigemID),
          employeeById(current.FuncionarioDestinoID),
          runtime.list("Folgas", { profile }),
        ]);
      const resolveCurrentSelection = (
        employee,
        timeOffId,
        expectedDate,
        type,
      ) => {
        if (type === "Fixa" || fixedSwapParts(timeOffId)) {
          const parts = fixedSwapParts(timeOffId);
          assert(
            parts &&
              String(parts.employeeId) ===
                String(employee.FuncionarioID) &&
              parts.date === expectedDate &&
              employeeHasFixedDay(employee, expectedDate) &&
              !fixedDateWasSwapped(
                allTimeOff,
                employee.FuncionarioID,
                expectedDate,
              ),
            "A folga fixa selecionada não está mais disponível.",
          );
          return {
            FolgaID: timeOffId,
            FuncionarioID: employee.FuncionarioID,
            LojaID: employee.LojaID,
            DataInicio: expectedDate,
            DataFim: expectedDate,
            Status: APP.status.approved,
            TipoSelecao: "Fixa",
          };
        }
        const record = allTimeOff.find(
          (item) => String(item.FolgaID) === String(timeOffId),
        );
        assert(
          record &&
            record.Status === APP.status.approved &&
            String(record.FuncionarioID) ===
              String(employee.FuncionarioID) &&
            normalizedDateKey(record.DataInicio) === expectedDate &&
            !record.FolgaFixaSubstituidaData,
          "A folga cadastrada selecionada não está mais disponível.",
        );
        return { ...record, TipoSelecao: "Cadastrada" };
      };
      const originType =
        current.TipoFolgaOrigem ||
        (fixedSwapParts(current.FolgaOrigemID) ? "Fixa" : "Cadastrada");
      const destinationType =
        current.TipoFolgaDestino ||
        (fixedSwapParts(current.FolgaDestinoOriginalID)
          ? "Fixa"
          : "Cadastrada");
      const origin = resolveCurrentSelection(
        originEmployee,
        current.FolgaOrigemID,
        normalizedDateKey(current.DataFolgaOrigem),
        originType,
      );
      const destination = resolveCurrentSelection(
        destinationEmployee,
        current.FolgaDestinoOriginalID,
        normalizedDateKey(current.DataFolgaDestino),
        destinationType,
      );
      assert(
        String(originEmployee.LojaID) === String(current.LojaID) &&
          String(destinationEmployee.LojaID) === String(current.LojaID),
        "Os funcionários não pertencem mais à loja da proposta.",
      );
      const fixedInvolved =
        originType === "Fixa" || destinationType === "Fixa";
      if (fixedInvolved) {
        assert(
          singleDaySelection(origin) &&
            singleDaySelection(destination) &&
            sameSwapWeek(origin.DataInicio, destination.DataInicio),
          "A troca de folga fixa deve permanecer na mesma semana.",
        );
      }
      const originDates = shiftDateRange(origin, destination.DataInicio);
      const destinationDates = shiftDateRange(destination, origin.DataInicio);
      const movingIds = new Set(
        [origin, destination]
          .filter((item) => item.TipoSelecao !== "Fixa")
          .map((item) => item.FolgaID),
      );
      const hasConflict = (employee, dates) =>
        allTimeOff.some(
          (item) =>
            !movingIds.has(item.FolgaID) &&
            String(item.FuncionarioID) ===
              String(employee.FuncionarioID) &&
            activeTimeOff(item) &&
            normalizedDateKey(item.DataInicio) <= dates.DataFim &&
            normalizedDateKey(item.DataFim || item.DataInicio) >=
              dates.DataInicio,
        ) ||
        (employeeHasFixedDay(employee, dates.DataInicio) &&
          !fixedDateWasSwapped(
            allTimeOff,
            employee.FuncionarioID,
            dates.DataInicio,
          ));
      assert(
        !hasConflict(originEmployee, originDates) &&
          !hasConflict(destinationEmployee, destinationDates),
        "A troca passou a conflitar com outra folga cadastrada ou fixa.",
      );
      const changedAt = nowIso();
      const applicationItem = (
        selection,
        employee,
        sourceDate,
        targetDate,
      ) => {
        if (selection.TipoSelecao === "Fixa") {
          const record = fixedOverrideRecord({
            swapId: id,
            employee,
            sourceDate,
            targetDate,
            actor: profile,
            changedAt,
          });
          return {
            table: "Folgas",
            id: record.FolgaID,
            createIfMissing: true,
            record,
          };
        }
        return {
          table: "Folgas",
          id: selection.FolgaID,
          changes: {
            ...shiftDateRange(selection, targetDate),
            TrocaFolgaID: id,
            DataAtualizacao: changedAt,
          },
        };
      };
      const [updatedOrigin, updatedDestination, saved] =
        await runtime.patchMany([
          applicationItem(
            origin,
            originEmployee,
            origin.DataInicio,
            destination.DataInicio,
          ),
          applicationItem(
            destination,
            destinationEmployee,
            destination.DataInicio,
            origin.DataInicio,
          ),
          {
            table: "TrocasFolga",
            id,
            changes: {
              Status: "Aprovada",
              DecididoPor: profile.Email,
              DataDecisao: changedAt,
              ObservacaoGestor: String(observation || ""),
              EscopoTroca: fixedInvolved
                ? "Somente a semana selecionada"
                : "Somente as datas selecionadas",
              DataAtualizacao: changedAt,
            },
          },
        ]);
      await Promise.all([
        createNotification({
          employeeId: originEmployee.FuncionarioID,
          email: originEmployee.Email,
          storeId: originEmployee.LojaID,
          subject: "Troca de folga aprovada",
          message: `Sua folga desta semana foi transferida para ${updatedOrigin.DataInicio}. A folga fixa das próximas semanas não mudou.`,
          type: "Troca",
          relatedId: id,
        }),
        createNotification({
          employeeId: destinationEmployee.FuncionarioID,
          email: destinationEmployee.Email,
          storeId: destinationEmployee.LojaID,
          subject: "Troca de folga aprovada",
          message: `Sua folga desta semana foi transferida para ${updatedDestination.DataInicio}. A folga fixa das próximas semanas não mudou.`,
          type: "Troca",
          relatedId: id,
        }),
      ]).catch((error) =>
        console.warn("Notificação da troca não gravada:", error.message),
      );
      await audit("Aplicar troca de folga", "TrocasFolga", id, {
        before: current,
        after: saved,
      });
      return success(
        saved,
        fixedInvolved
          ? "Troca aprovada somente para a semana selecionada."
          : "Troca aprovada e aplicada.",
      );
    },

    async acknowledgeTimeOff(args) {
      const profile = await runtime.requireProfile();
      const id = args[0];
      const timeOff = await runtime.getById("Folgas", id);
      assert(timeOff, "Folga não encontrada.");
      scopeRecord(profile, timeOff);
      const existing = (
        await runtime.list("CienciasFolga", { profile })
      ).find((item) => item.FolgaID === id);
      const saved = await runtime.upsert("CienciasFolga", {
        ...(existing || {}),
        CienciaID: existing?.CienciaID || uuid(),
        FolgaID: id,
        FuncionarioID: timeOff.FuncionarioID,
        LojaID: timeOff.LojaID,
        StatusCiencia: "Confirmada",
        ObservacaoFuncionario: String(args[1] || ""),
        VisualizadoEm: nowIso(),
        DataCiencia: nowIso(),
        DataCriacao: existing?.DataCriacao || nowIso(),
        DataAtualizacao: nowIso(),
      });
      return success(saved, "Ciência confirmada.");
    },

    async getMyNotifications(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const limit = Number(values[0]?.limit || 100);
      const rows = await runtime.list("Notificacoes", { profile });
      return success(
        rows
          .filter(
            (item) =>
              !item.DestinatarioID ||
              item.DestinatarioID === profile.FuncionarioID ||
              item.Destinatario === profile.Email,
          )
          .sort((a, b) =>
            String(b.DataCriacao || "").localeCompare(
              String(a.DataCriacao || ""),
            ),
          )
          .slice(0, limit),
      );
    },

    async markNotificationRead(args) {
      const profile = await runtime.requireProfile();
      const id = args[0];
      const current = await runtime.getById("Notificacoes", id);
      assert(current, "Notificação não encontrada.");
      scopeRecord(profile, {
        ...current,
        FuncionarioID: current.DestinatarioID,
      });
      const saved = await runtime.patch("Notificacoes", id, {
        Status: "Lida",
        DataLeitura: nowIso(),
        LidoPor: profile.Email,
      });
      return success(saved, "Notificação marcada como lida.");
    },

    async getProximaFolgaFuncionario(args) {
      dropClientToken(args);
      const profile = await runtime.requireProfile();
      const records = await runtime.list("Folgas", { profile });
      return success(
        nextTimeOffSummary(records, profile.FuncionarioID),
      );
    },

    async anexarDocumento(args) {
      dropClientToken(args);
      throw new Error(
        "O envio de documentos foi desativado para não armazenar arquivos no Realtime Database.",
      );
    },

    async listarDocumentos(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const employeeId = values[0] || "";
      const rows = await runtime.list("Documentos", { profile });
      return success(
        rows
          .filter(
            (item) => !employeeId || item.FuncionarioID === employeeId,
          )
          .sort((a, b) =>
            String(b.DataCriacao).localeCompare(String(a.DataCriacao)),
          ),
      );
    },

    async obterDocumento(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const id = values[0];
      const metadata = await runtime.getById("Documentos", id);
      assert(metadata, "Documento não encontrado.");
      scopeRecord(profile, metadata);
      const blob = await runtime.getBlob("documents", id);
      assert(blob?.base64, "Conteúdo do documento não encontrado.");
      return success({
        nome: blob.nome || metadata.NomeArquivo,
        tipo: blob.tipo || metadata.MimeType,
        base64: blob.base64,
      });
    },

    async progressoOnboarding(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const employee = await employeeById(values[0]);
      scopeRecord(profile, employee);
      let items = (await runtime.list("Onboarding", { profile })).filter(
        (item) => item.FuncionarioID === employee.FuncionarioID,
      );
      if (!items.length) {
        const defaults = [
          ["Documentos cadastrais", "Documentação"],
          ["Integração com a equipe", "Integração"],
          ["Treinamento de segurança", "Treinamento"],
          ["Configuração do ponto", "Sistemas"],
          ["Ciência das regras internas", "Políticas"],
        ];
        for (const [name, category] of defaults) {
          items.push(
            await runtime.upsert("Onboarding", {
              OnbID: uuid(),
              FuncionarioID: employee.FuncionarioID,
              LojaID: employee.LojaID,
              Item: name,
              Categoria: category,
              Concluido: false,
              ConcluidoPor: "",
              ConcluidoEm: "",
              Observacao: "",
            }),
          );
        }
      }
      const completed = items.filter((item) =>
        asBoolean(item.Concluido),
      ).length;
      return success({
        concluidos: completed,
        total: items.length,
        pct: items.length ? Math.round((completed / items.length) * 100) : 0,
        itens: items,
      });
    },

    async marcarOnboardingItem(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const [id, done, observation] = values;
      const current = await runtime.getById("Onboarding", id);
      assert(current, "Item não encontrado.");
      scopeRecord(profile, current);
      const saved = await runtime.patch("Onboarding", id, {
        Concluido: asBoolean(done),
        ConcluidoPor: profile.Email,
        ConcluidoEm: asBoolean(done) ? nowIso() : "",
        Observacao: String(observation || ""),
      });
      return success(saved, "Item atualizado.");
    },

    async solicitarFerias(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const employee = await employeeById(
        payload.FuncionarioID || profile.FuncionarioID,
      );
      scopeRecord(profile, employee);
      const days = dateRange(payload.DataInicio, payload.DataFim).length;
      assert(days > 0 && days <= 30, "O período deve ter entre 1 e 30 dias.");
      const saved = await runtime.upsert("Ferias", {
        FeriasID: uuid(),
        FuncionarioID: employee.FuncionarioID,
        NomeFuncionario: employee.Nome,
        LojaID: employee.LojaID,
        PeriodoAquisitivoInicio: payload.PeriodoAquisitivoInicio || "",
        PeriodoAquisitivoFim: payload.PeriodoAquisitivoFim || "",
        DataInicio: payload.DataInicio,
        DataFim: payload.DataFim,
        Dias: days,
        Parcela: Number(payload.Parcela || 1),
        TotalParcelas: Number(payload.TotalParcelas || 1),
        AbonoPecuniario: Number(payload.AbonoPecuniario || 0),
        Status: "Pendente",
        SolicitadoPor: profile.Email,
        DataSolicitacao: nowIso(),
        Observacoes: String(payload.Observacoes || ""),
      });
      return success(saved, "Solicitação de férias enviada.");
    },

    async listarSolicitacoesFerias(args) {
      dropClientToken(args);
      const rows = await runtime.list("Ferias");
      return success(
        rows.sort((a, b) =>
          String(b.DataSolicitacao).localeCompare(String(a.DataSolicitacao)),
        ),
      );
    },

    async decidirFerias(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [id, decision, observation] = values;
      const current = await runtime.getById("Ferias", id);
      assert(current, "Solicitação não encontrada.");
      scopeRecord(profile, current);
      assert(
        current.Status === "Pendente",
        "Somente solicitações pendentes podem receber uma decisão.",
      );
      const approved = String(decision).toLowerCase() === "aprovar";
      const saved = await runtime.patch("Ferias", id, {
        Status: approved ? "Aprovada" : "Rejeitada",
        AprovadoPor: profile.Email,
        DataAprovacao: nowIso(),
        ObservacaoDecisao: String(observation || ""),
      });
      return success(saved, approved ? "Férias aprovadas." : "Férias rejeitadas.");
    },

    async cancelarFerias(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const [id, reason] = values;
      const current = await runtime.getById("Ferias", id);
      assert(current, "Solicitação não encontrada.");
      scopeRecord(profile, current);
      if (!isManager(profile)) {
        assert(
          current.Status === "Pendente",
          "Somente solicitações pendentes podem ser canceladas pelo funcionário.",
        );
      }
      const saved = await runtime.patch("Ferias", id, {
        Status: "Cancelada",
        CanceladoPor: profile.Email,
        DataCancelamento: nowIso(),
        ObservacaoDecisao: String(reason || ""),
      });
      return success(saved, "Solicitação cancelada.");
    },

    async sugerirSubstitutos(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const timeOff = await runtime.getById("Folgas", values[0]);
      assert(timeOff, "Folga não encontrada.");
      scopeRecord(profile, timeOff);
      const employees = await runtime.list("Funcionarios", { profile });
      return success(
        employees
          .filter(
            (item) =>
              item.FuncionarioID !== timeOff.FuncionarioID &&
              item.LojaID === timeOff.LojaID &&
              asBoolean(item.Ativo),
          )
          .map((item) => ({
            FuncionarioID: item.FuncionarioID,
            Nome: item.Nome,
            Cargo: item.Cargo,
            horasSemana: 0,
            saldoFolgas: Number(item.SaldoFolgas || 0),
          }))
          .sort((a, b) => b.saldoFolgas - a.saldoFolgas),
      );
    },

    async escalarSubstituto(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [timeOffId, employeeId] = values;
      const timeOff = await runtime.getById("Folgas", timeOffId);
      const employee = await employeeById(employeeId);
      assert(timeOff && timeOff.LojaID === employee.LojaID, "Dados incompatíveis.");
      scopeRecord(profile, timeOff);
      scopeRecord(profile, employee);
      const saved = await runtime.upsert("Substituicoes", {
        SubID: uuid(),
        FolgaID: timeOffId,
        FuncionarioOrigem: timeOff.FuncionarioID,
        FuncionarioSubstituto: employee.FuncionarioID,
        LojaID: timeOff.LojaID,
        Data: timeOff.DataInicio,
        ConfirmadoPor: profile.Email,
        DataConfirmacao: nowIso(),
        Status: "Confirmada",
      });
      return success(saved, "Substituto escalado.");
    },

    async publicarComunicado(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      if (payload.LojaID) scopeRecord(profile, payload);
      assert(String(payload.Titulo || "").trim(), "Informe o título.");
      assert(String(payload.Corpo || "").trim(), "Informe o comunicado.");
      const saved = await runtime.upsert("Comunicados", {
        ComID: uuid(),
        DataHora: nowIso(),
        Autor: profile.Email,
        Titulo: String(payload.Titulo || "").trim(),
        Corpo: String(payload.Corpo || "").trim(),
        LojaID: payload.LojaID || profile.LojaID || "",
        PublicoAlvo: payload.PublicoAlvo || "Todos",
        ExigeConfirmacao: asBoolean(payload.ExigeConfirmacao),
        Ativo: true,
        ExpiraEm: payload.ExpiraEm || "",
      });
      return success(saved, "Comunicado publicado.");
    },

    async listarComunicadosAtivos(args) {
      const profile = await runtime.requireProfile();
      dropClientToken(args);
      const [rows, reads] = await Promise.all([
        runtime.list("Comunicados", { profile }),
        runtime.list("ComunicadosLeituras", { profile }),
      ]);
      const readIds = new Set(
        reads
          .filter((item) => item.FuncionarioID === profile.FuncionarioID)
          .map((item) => item.ComID),
      );
      return success(
        filterAudience(rows, profile)
          .map((item) => ({ ...item, jaLido: readIds.has(item.ComID) }))
          .sort((a, b) => String(b.DataHora).localeCompare(String(a.DataHora))),
      );
    },

    async confirmarLeituraComunicado(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const announcement = await runtime.getById("Comunicados", values[0]);
      assert(announcement, "Comunicado não encontrado.");
      const existing = (
        await runtime.list("ComunicadosLeituras", { profile })
      ).find(
        (item) =>
          item.ComID === announcement.ComID &&
          item.FuncionarioID === profile.FuncionarioID,
      );
      if (existing) return success(existing, "Leitura já confirmada.");
      const saved = await runtime.upsert("ComunicadosLeituras", {
        LeituraID: `${announcement.ComID}__${profile.FuncionarioID}`,
        ComID: announcement.ComID,
        FuncionarioID: profile.FuncionarioID,
        LojaID: profile.LojaID,
        LidoEm: nowIso(),
        UserAgent: navigator.userAgent.slice(0, 300),
      });
      return success(saved, "Leitura confirmada.");
    },

    async criarEnquete(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const options = Array.isArray(payload.Opcoes)
        ? payload.Opcoes
        : String(payload.Opcoes || "")
            .split("|")
            .filter(Boolean);
      const normalizedOptions = [
        ...new Set(options.map((item) => String(item).trim()).filter(Boolean)),
      ];
      assert(String(payload.Titulo || "").trim(), "Informe o título.");
      assert(
        normalizedOptions.length >= 2 && normalizedOptions.length <= 10,
        "Informe de duas a dez opções diferentes.",
      );
      if (payload.LojaID) scopeRecord(profile, payload);
      const saved = await runtime.upsert("Enquetes", {
        EnqID: uuid(),
        DataHora: nowIso(),
        Titulo: String(payload.Titulo || "").trim(),
        Opcoes: JSON.stringify(normalizedOptions),
        opcoesLista: normalizedOptions,
        FechaEm: payload.FechaEm || "",
        CriadoPor: profile.Email,
        LojaID: payload.LojaID || profile.LojaID || "",
        Ativa: true,
      });
      return success({ ...saved, id: saved.EnqID }, "Enquete criada.");
    },

    async listarEnquetesAtivas(args) {
      const profile = await runtime.requireProfile();
      dropClientToken(args);
      const [polls, votes] = await Promise.all([
        runtime.list("Enquetes", { profile }),
        runtime.list("EnquetesVotos", { profile }),
      ]);
      const voted = new Set(
        votes
          .filter((item) => item.FuncionarioID === profile.FuncionarioID)
          .map((item) => item.EnqID),
      );
      return success(
        polls
          .filter(
            (item) =>
              asBoolean(item.Ativa) &&
              (!item.LojaID ||
                item.LojaID === profile.LojaID ||
                isAdmin(profile)) &&
              (!item.FechaEm || new Date(item.FechaEm).getTime() > Date.now()),
          )
          .map((item) => ({
            ...item,
            opcoesLista: Array.isArray(item.opcoesLista)
              ? item.opcoesLista
              : JSON.parse(item.Opcoes || "[]"),
            jaVotou: voted.has(item.EnqID),
          })),
      );
    },

    async votarEnquete(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const [id, option] = values;
      const poll = await runtime.getById("Enquetes", id);
      assert(poll && asBoolean(poll.Ativa), "Enquete encerrada.");
      assert(
        !poll.FechaEm || new Date(poll.FechaEm).getTime() > Date.now(),
        "Enquete encerrada.",
      );
      const options = Array.isArray(poll.opcoesLista)
        ? poll.opcoesLista
        : JSON.parse(poll.Opcoes || "[]");
      assert(options.includes(option), "Opção inválida.");
      const votes = await runtime.list("EnquetesVotos", { profile });
      assert(
        !votes.some(
          (item) =>
            item.EnqID === id &&
            item.FuncionarioID === profile.FuncionarioID,
        ),
        "Você já votou nesta enquete.",
      );
      const saved = await runtime.upsert("EnquetesVotos", {
        VotoID: `${id}__${profile.FuncionarioID}`,
        EnqID: id,
        FuncionarioID: profile.FuncionarioID,
        LojaID: profile.LojaID,
        Opcao: option,
        DataHora: nowIso(),
      });
      return success(saved, "Voto registrado.");
    },

    async resultadoEnquete(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const poll = await runtime.getById("Enquetes", values[0]);
      assert(poll, "Enquete não encontrada.");
      const votes = (await runtime.list("EnquetesVotos", { profile })).filter(
        (item) => item.EnqID === poll.EnqID,
      );
      const options = Array.isArray(poll.opcoesLista)
        ? poll.opcoesLista
        : JSON.parse(poll.Opcoes || "[]");
      const results = Object.fromEntries(options.map((item) => [item, 0]));
      votes.forEach((item) => {
        results[item.Opcao] = Number(results[item.Opcao] || 0) + 1;
      });
      return success({ resultados: results, total: votes.length });
    },

    async fecharMesLoja(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [storeId, month] = values;
      scopeRecord(profile, { LojaID: storeId });
      assert(/^\d{4}-\d{2}$/.test(String(month || "")), "Informe o mês.");
      const existing = (await runtime.list("FechamentosMensais", { profile })).find(
        (item) => item.LojaID === storeId && item.AnoMes === month,
      );
      if (existing?.Status === "Fechado") {
        return success(existing, "Este mês já está fechado.");
      }
      const context = await clockContext({ month });
      const employees = context.employees.filter(
        (item) => item.LojaID === storeId,
      );
      const days = context.days.filter((item) =>
        employees.some(
          (employee) => employee.FuncionarioID === item.funcionarioId,
        ),
      );
      const summary = {
        TotalFuncionarios: employees.length,
        TotalHorasTrabalhadas:
          Math.round(
            (days.reduce(
              (sum, item) => sum + Number(item.trabalhadoMinutos || 0),
              0,
            ) /
              60) *
              100,
          ) / 100,
        TotalHorasExtras:
          Math.round(
            (days.reduce(
              (sum, item) => sum + Math.max(0, Number(item.saldoMinutos || 0)),
              0,
            ) /
              60) *
              100,
          ) / 100,
        TotalFolgas: days.filter((item) => item.folga || item.folgaFixa).length,
        TotalFaltas: days.filter(
          (item) =>
            !item.folga &&
            !item.folgaFixa &&
            item.previstoMinutos > 0 &&
            item.trabalhadoMinutos === 0,
        ).length,
      };
      const saved = await runtime.upsert("FechamentosMensais", {
        ...(existing || {}),
        FechamentoID:
          existing?.FechamentoID || `fechamento-${storeId}-${month}`,
        AnoMes: month,
        LojaID: storeId,
        GeradoEm: nowIso(),
        GeradoPor: profile.Email,
        HashSHA256: await sha256(
          JSON.stringify({ LojaID: storeId, AnoMes: month, ...summary }),
        ),
        ...summary,
        Status: "Fechado",
        Observacoes: "",
      });
      return success(saved, "Mês fechado.");
    },

    async listarFechamentos(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const storeId = values[0] || "";
      const rows = await runtime.list("FechamentosMensais", { profile });
      return success(
        rows
          .filter((item) => !storeId || item.LojaID === storeId)
          .sort((a, b) => String(b.AnoMes).localeCompare(String(a.AnoMes))),
      );
    },

    async reabrirFechamento(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const values = dropClientToken(args);
      const [id, reason] = values;
      assert(String(reason || "").trim().length >= 10, "Justifique a reabertura.");
      const saved = await runtime.patch("FechamentosMensais", id, {
        Status: "Reaberto",
        Observacoes: reason,
      });
      return success(saved, "Fechamento reaberto.");
    },

    async rankingAssiduidadeLoja(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [storeId, month] = values;
      scopeRecord(profile, { LojaID: storeId });
      const context = await clockContext({ month });
      return success(
        context.employees
          .filter((item) => item.LojaID === storeId)
          .map((employee) => {
            const days = context.days.filter(
              (item) => item.funcionarioId === employee.FuncionarioID,
            );
            const expectedDays = days.filter(
              (item) =>
                !item.folga &&
                !item.folgaFixa &&
                item.previstoMinutos > 0,
            );
            const present = expectedDays.filter(
              (item) => item.trabalhadoMinutos > 0,
            ).length;
            return {
              FuncionarioID: employee.FuncionarioID,
              Nome: employee.Nome,
              diasPrevistos: expectedDays.length,
              diasPresentes: present,
              assiduidade: expectedDays.length
                ? Math.round((present / expectedDays.length) * 100)
                : 100,
            };
          })
          .sort((a, b) => b.assiduidade - a.assiduidade),
      );
    },

    async exportarAFD(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [storeId, start, end] = values;
      scopeRecord(profile, { LojaID: storeId });
      const records = (await runtime.list("RegistrosPonto", { profile })).filter(
        (item) =>
          item.LojaID === storeId &&
          item.Data >= start &&
          item.Data <= end &&
          item.Status !== "Substituído",
      );
      const columns = [
        "RegistroPontoID",
        "FuncionarioID",
        "NomeFuncionario",
        "Data",
        "TipoMarcacao",
        "DataHora",
        "Origem",
        "Status",
      ];
      return success({
        fileId: `AFD-${storeId}-${start}-${end}.csv`,
        url: csvDataUrl(records, columns),
        registros: records.length,
      });
    },

    async compensarFolgaComBanco(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [employeeId, date, hours] = values;
      const employee = await employeeById(employeeId);
      scopeRecord(profile, employee);
      const numericHours = Number(hours);
      assert(
        /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")),
        "Informe uma data válida.",
      );
      assert(
        Number.isFinite(numericHours) &&
          numericHours >= 0.5 &&
          numericHours <= 24,
        "Informe de 0,5 a 24 horas.",
      );
      const saved = await runtime.upsert("BancoHorasMovimentos", {
        MovID: uuid(),
        FuncionarioID: employee.FuncionarioID,
        LojaID: employee.LojaID,
        Data: date,
        HorasTrabalhadas: 0,
        JornadaContratual: 0,
        SaldoDia: -Math.abs(numericHours),
        SaldoAcumulado: 0,
        Origem: "Compensação de folga",
        Observacao: `Compensação registrada por ${profile.Email}`,
      });
      return success(saved, "Compensação registrada.");
    },

    async delegarPerfil(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const saved = await runtime.upsert("Delegacoes", {
        DelID: uuid(),
        DelegantePerfil: profile.Perfil,
        DelegantePor: profile.Email,
        DelegadoPara: payload.DelegadoPara,
        Perfil: payload.Perfil,
        LojaID: payload.LojaID || "",
        ValidoDe: payload.ValidoDe,
        ValidoAte: payload.ValidoAte,
        Motivo: payload.Motivo,
        Revogada: false,
      });
      return success(saved, "Delegação criada.");
    },

    async getWhatsAppWeeklyScheduleWithSession(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const filters = values[0] || {};
      const targetStoreId = String(
        filters.storeId || filters.LojaID || profile.LojaID || "",
      );
      const startDate = normalizedDateKey(filters.startDate || todayIso());
      const [employees, timeOff, schedules, stores] = await Promise.all([
        runtime.list("Funcionarios", { profile }),
        runtime.list("Folgas", { profile }),
        runtime.list("JornadasPonto", { profile }),
        runtime.list("Lojas", { profile }),
      ]);
      return success(
        generateWhatsAppWeeklySchedule({
          employees,
          timeOff,
          schedules,
          stores,
          startDate,
          storeId: targetStoreId,
        }),
      );
    },
  };
}

export const generateWhatsAppWeeklySchedule = ({
  employees = [],
  timeOff = [],
  schedules = [],
  stores = [],
  startDate = todayIso(),
  storeId = "",
}) => {
  const start = new Date(`${startDate}T12:00:00`);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(todayIso(d));
  }
  const periodText = `${days[0].split("-").reverse().join("/")} a ${days[6].split("-").reverse().join("/")}`;

  let targetEmployees = employees.filter((e) => asBoolean(e.Ativo));
  if (storeId) {
    targetEmployees = targetEmployees.filter(
      (e) => String(e.LojaID || "") === String(storeId),
    );
  }
  const store = stores.find((s) => String(s.LojaID || "") === String(storeId));
  const storeName = store?.Nome || targetEmployees[0]?.NomeLoja || "HOUSE 190";

  const byRole = new Map();
  targetEmployees.forEach((emp) => {
    const roleName = String(emp.Cargo || "Equipe Geral").trim();
    const list = byRole.get(roleName) || [];
    list.push(emp);
    byRole.set(roleName, list);
  });

  const lines = [
    `🍔 *${storeName.toUpperCase()} — ESCALA DA SEMANA*`,
    `📅 *Período:* ${periodText}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  const weekdayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  for (const [roleName, roleEmployees] of byRole.entries()) {
    lines.push(`\n📌 *${roleName.toUpperCase()}*`);
    roleEmployees.forEach((emp) => {
      const empSchedules = schedules.filter(
        (s) => String(s.FuncionarioID || "") === String(emp.FuncionarioID),
      );
      const sched = empSchedules[0];
      const hoursText =
        sched?.HoraEntrada && sched?.HoraSaida
          ? ` (${sched.HoraEntrada.slice(0, 5)} às ${sched.HoraSaida.slice(0, 5)})`
          : "";

      const offDaysThisWeek = [];
      days.forEach((dayKey) => {
        const approvedOff = timeOff.find(
          (item) =>
            item.FuncionarioID === emp.FuncionarioID &&
            ["Aprovada", "Concluída"].includes(item.Status) &&
            normalizedDateKey(item.DataInicio) <= dayKey &&
            normalizedDateKey(item.DataFim || item.DataInicio) >= dayKey,
        );
        const isFixed = !approvedOff && employeeHasFixedDay(emp, dayKey);
        if (approvedOff || isFixed) {
          const wDay = weekdayNames[new Date(`${dayKey}T12:00:00`).getDay()];
          const dayBR = dayKey.split("-").reverse().slice(0, 2).join("/");
          offDaysThisWeek.push(`${wDay} (${dayBR})`);
        }
      });

      const offText = offDaysThisWeek.length
        ? ` — 🏖️ *Folga:* ${offDaysThisWeek.join(", ")}`
        : ` — *Sem folga na semana*`;

      lines.push(`• *${emp.Nome}*${hoursText}${offText}`);
    });
  }

  lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`📲 _Consulte suas folgas e saldo no portal Gestão de Folgas!_`);

  return {
    period: periodText,
    storeName,
    message: lines.join("\n"),
  };
};

export { nextTimeOffSummary };

