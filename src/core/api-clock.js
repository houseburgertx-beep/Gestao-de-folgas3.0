import { runtime } from "./runtime.js";
import {
  asBoolean,
  assert,
  csvDataUrl,
  haversineMeters,
  minutesBetween,
  minutesText,
  monthIso,
  nowIso,
  todayIso,
  uuid,
} from "./utils.js";
import {
  audit,
  dropClientToken,
  isAdmin,
  requireAdmin,
  requireManager,
  scopeRecord,
  success,
} from "./api-base.js";
import { SELFIE_DRIVE_UPLOAD_ENDPOINT } from "../selfie-drive-config.js";

const clockTypes = [
  "ENTRADA",
  "SAIDA_INTERVALO",
  "RETORNO_INTERVALO",
  "SEM_DESCANSO",
  "SAIDA_FINAL",
];

const clockJustificationTypes = [
  "Atestado",
  "Folga trocada",
  "Dia concedido",
  "Outros",
];

const selfieDriveEndpoint = () => {
  const endpoint = String(SELFIE_DRIVE_UPLOAD_ENDPOINT || "").trim();
  assert(
    /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(
      endpoint,
    ),
    "O envio seguro das selfies ao Google Drive ainda não foi configurado.",
  );
  return endpoint;
};

const uploadClockSelfieToDrive = async ({
  selfieDataUrl,
  requestId,
  day,
  type,
}) => {
  const selfie = String(selfieDataUrl || "");
  assert(
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=\s]+$/.test(selfie),
    "Capture a selfie antes de confirmar o ponto.",
  );
  assert(
    selfie.length <= 950000,
    "A selfie ficou muito grande. Tire outra foto para continuar.",
  );
  const user = runtime.auth?.currentUser;
  assert(user, "Sua sessão expirou. Entre novamente.");
  const idToken = await user.getIdToken();
  let response;
  try {
    response = await fetch(selfieDriveEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      redirect: "follow",
      credentials: "omit",
      body: JSON.stringify({
        action: "uploadClockSelfie",
        idToken,
        requestId,
        day,
        clockType: type,
        selfieDataUrl: selfie,
      }),
    });
  } catch {
    throw new Error(
      "Não foi possível enviar a selfie ao Google Drive. Verifique a internet e tente novamente.",
    );
  }
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("O Google Drive devolveu uma resposta inválida.");
  }
  assert(
    response.ok && result?.ok && result?.fileId,
    result?.error || "O Google Drive não confirmou o envio da selfie.",
  );
  return {
    fileId: String(result.fileId),
    fileUrl: String(result.fileUrl || ""),
    fileName: String(result.fileName || ""),
    uploadedAt: String(result.uploadedAt || nowIso()),
  };
};

const timeValue = (dateTime) => {
  const date = new Date(dateTime);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
};

const normalizedDateKey = (value) => {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
};

const firstPunchDatesByEmployee = (records = []) => {
  const starts = new Map();
  records
    .filter(
      (item) =>
        item.FuncionarioID &&
        item.Status !== "Substituído" &&
        /^\d{4}-\d{2}-\d{2}$/.test(
          normalizedDateKey(item.Data || item.DataHora),
        ),
    )
    .forEach((item) => {
      const employeeId = String(item.FuncionarioID);
      const date = normalizedDateKey(item.Data || item.DataHora);
      const current = starts.get(employeeId);
      if (!current || date < current) starts.set(employeeId, date);
    });
  return starts;
};

const workdayIndexes = (schedule) =>
  String(schedule?.DiasTrabalho || "1,2,3,4,5,6")
    .split(/[,;|\s]+/)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

const scheduleFor = (schedules, employeeId, dateKey = todayIso()) => {
  const candidates = schedules
    .filter(
      (item) =>
        item.FuncionarioID === employeeId &&
        asBoolean(item.Ativa) &&
        (!item.VigenteDe || normalizedDateKey(item.VigenteDe) <= dateKey) &&
        (!item.VigenteAte || normalizedDateKey(item.VigenteAte) >= dateKey),
    )
    .sort((a, b) =>
      String(b.VigenteDe || "").localeCompare(String(a.VigenteDe || "")),
    );
  return candidates[0] || null;
};

const sequenceFor = (schedule) =>
  Number(schedule?.DuracaoIntervaloMinutos || 0) > 0
    ? ["ENTRADA", "SAIDA_INTERVALO", "RETORNO_INTERVALO", "SAIDA_FINAL"]
    : ["ENTRADA", "SAIDA_FINAL"];

const nextClockAction = (records, schedule) => {
  const types = records
    .filter((item) => item.Status !== "Substituído")
    .sort((a, b) => String(a.DataHora).localeCompare(String(b.DataHora)))
    .map((item) => item.TipoMarcacao);
  if (types.includes("SAIDA_FINAL")) return "";
  if (types.includes("SEM_DESCANSO")) return "SAIDA_FINAL";
  return sequenceFor(schedule).find((type) => !types.includes(type)) || "";
};

const previousDateKey = (dateKey) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return todayIso(date);
};

const operationalDayFor = (
  records,
  schedules,
  employeeId,
  now = new Date(),
) => {
  const currentDay = todayIso(now);
  const previousDay = previousDateKey(currentDay);
  const previousRecords = records
    .filter(
      (item) =>
        item.FuncionarioID === employeeId &&
        normalizedDateKey(item.Data) === previousDay &&
        item.Status !== "Substituído",
    )
    .sort((a, b) => String(a.DataHora).localeCompare(String(b.DataHora)));
  const hasOpenShift =
    previousRecords.some((item) => item.TipoMarcacao === "ENTRADA") &&
    !previousRecords.some((item) => item.TipoMarcacao === "SAIDA_FINAL");
  if (!hasOpenShift) return currentDay;

  const lastTimestamp = Math.max(
    ...previousRecords.map((item) => new Date(item.DataHora).getTime()),
  );
  const withinSameShift =
    Number.isFinite(lastTimestamp) &&
    now.getTime() - lastTimestamp >= 0 &&
    now.getTime() - lastTimestamp <= 18 * 60 * 60 * 1000;
  return withinSameShift &&
    scheduleFor(schedules, employeeId, previousDay)
    ? previousDay
    : currentDay;
};

const exactMinutesBetween = (start, end) => {
  const first = new Date(start).getTime();
  const last = new Date(end).getTime();
  return Number.isFinite(first) && Number.isFinite(last)
    ? Math.max(0, (last - first) / 60000)
    : 0;
};

const clockMinutes = (value) => {
  const text = String(value || "");
  const plain = text.match(/^(\d{1,2}):(\d{2})/);
  if (plain) return Number(plain[1]) * 60 + Number(plain[2]);
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.getUTCHours() * 60 + date.getUTCMinutes()
    : null;
};

const scheduleExpectedMinutes = (schedule) => {
  const start = clockMinutes(schedule?.HoraEntrada);
  const end = clockMinutes(schedule?.HoraSaida);
  if (start !== null && end !== null) {
    const gross = (end - start + 24 * 60) % (24 * 60);
    const net = gross - Number(schedule?.DuracaoIntervaloMinutos || 0);
    if (net > 0) return net;
  }
  return Number(schedule?.CargaDiariaMinutos || 0);
};

const balanceDays = (days) =>
  days.filter(
    (item) =>
      !item.folga &&
      !item.folgaFixa &&
      !item.justificado &&
      !item.saldoPendente,
  );

const dayMetrics = (records, schedule) => {
  const ordered = records
    .filter((item) => item.Status !== "Substituído")
    .sort((a, b) => String(a.DataHora).localeCompare(String(b.DataHora)));
  const firstOf = (type, after = "") =>
    ordered.find(
      (item) =>
        item.TipoMarcacao === type &&
        (!after || String(item.DataHora) >= String(after)),
    );
  const entry = firstOf("ENTRADA");
  const breakOut = firstOf("SAIDA_INTERVALO", entry?.DataHora);
  const breakIn = firstOf("RETORNO_INTERVALO", breakOut?.DataHora);
  const noBreak = firstOf("SEM_DESCANSO", entry?.DataHora);
  const exits = ordered.filter(
    (item) =>
      item.TipoMarcacao === "SAIDA_FINAL" &&
      (!entry || String(item.DataHora) >= String(entry.DataHora)),
  );
  const exit = exits[exits.length - 1];
  let worked = 0;
  if (entry && exit) {
    worked = exactMinutesBetween(entry.DataHora, exit.DataHora);
    if (breakOut && breakIn && !noBreak) {
      worked -= exactMinutesBetween(breakOut.DataHora, breakIn.DataHora);
    }
  } else if (entry) {
    const last = ordered[ordered.length - 1];
    worked = Math.min(
      24 * 60,
      exactMinutesBetween(entry.DataHora, last?.DataHora || entry.DataHora),
    );
  }
  const expected = scheduleExpectedMinutes(schedule);
  return {
    entrada: entry ? timeValue(entry.DataHora) : "",
    saidaIntervalo: breakOut ? timeValue(breakOut.DataHora) : noBreak ? "Sem descanso" : "",
    retornoIntervalo: breakIn ? timeValue(breakIn.DataHora) : "",
    saida: exit ? timeValue(exit.DataHora) : "",
    worked,
    expected,
    balance: worked - expected,
    complete: !!entry && !!exit,
  };
};

const dayBalanceState = (dateKey, metrics, currentDate = todayIso()) => {
  const pending = dateKey === currentDate && !metrics.complete;
  return {
    pending,
    minutes: pending ? 0 : metrics.balance,
    text: pending
      ? "—"
      : (metrics.balance >= 0 ? "+" : "") + minutesText(metrics.balance),
  };
};

async function clockContext(filters = {}) {
  const profile = await runtime.requireProfile();
  const month = /^\d{4}-\d{2}$/.test(String(filters.month || ""))
    ? String(filters.month)
    : monthIso();
  const recordPeriods = new Set([month]);
  if (month === monthIso()) {
    recordPeriods.add(previousDateKey(todayIso()).slice(0, 7));
  }
  const [employees, records, schedules, adjustments, timeOff, justifications] =
    await Promise.all([
      runtime.list("Funcionarios", { profile }),
      runtime.listPeriods("RegistrosPonto", [...recordPeriods], { profile }),
      runtime.list("JornadasPonto", { profile }),
      runtime.list("AjustesPonto", { profile }),
      runtime.list("Folgas", { profile }),
      runtime.list("JustificativasPonto", { profile }),
    ]);
  const trackingRecords =
    filters.includeHistoricalStart === true && isAdmin(profile)
      ? await runtime.list("RegistrosPonto", { profile })
      : records;
  let allowed = employees.filter((item) => asBoolean(item.Ativo));
  if (filters.funcionarioId) {
    allowed = allowed.filter(
      (item) => item.FuncionarioID === filters.funcionarioId,
    );
  }
  const allowedIds = new Set(allowed.map((item) => item.FuncionarioID));
  const monthRecords = records
    .filter(
      (item) =>
        allowedIds.has(item.FuncionarioID) &&
        normalizedDateKey(item.Data).slice(0, 7) === month &&
        item.Status !== "Substituído",
    )
    .sort((a, b) => String(a.DataHora).localeCompare(String(b.DataHora)));
  const monthAdjustments = adjustments.filter(
    (item) =>
      allowedIds.has(item.FuncionarioID) &&
      (normalizedDateKey(item.Data).slice(0, 7) === month ||
        item.Status === "Pendente"),
  );
  const ownEmployee = allowed.find(
    (item) => item.FuncionarioID === profile.FuncionarioID,
  );
  const operationalDay = ownEmployee
    ? operationalDayFor(
        records,
        schedules,
        ownEmployee.FuncionarioID,
      )
    : todayIso();
  const ownSchedule = ownEmployee
    ? scheduleFor(schedules, ownEmployee.FuncionarioID, operationalDay)
    : null;
  const todayRecords = ownEmployee
    ? records
        .filter(
          (item) =>
            item.FuncionarioID === ownEmployee.FuncionarioID &&
            normalizedDateKey(item.Data) === operationalDay &&
            item.Status !== "Substituído",
        )
        .sort((a, b) => String(a.DataHora).localeCompare(String(b.DataHora)))
    : [];
  const todayTimeOff = ownEmployee
    ? timeOff.find(
        (item) =>
          item.FuncionarioID === ownEmployee.FuncionarioID &&
          ["Aprovada", "Concluída"].includes(item.Status) &&
          normalizedDateKey(item.DataInicio) <= operationalDay &&
          normalizedDateKey(item.DataFim || item.DataInicio) >= operationalDay,
      )
    : null;
  const fixedOff =
    !!ownEmployee &&
    !todayTimeOff &&
    [ownEmployee.DiaFolgaPreferencial, ownEmployee.SegundoDiaFolgaPreferencial]
      .filter(Boolean)
      .some((day) => {
        const weekday = [
          "domingo",
          "segunda",
          "terça",
          "quarta",
          "quinta",
          "sexta",
          "sábado",
        ][new Date(`${operationalDay}T12:00:00`).getDay()];
        return String(day).toLowerCase().startsWith(weekday.slice(0, 5));
      });

  const days = [];
  const [year, monthNumber] = month.split("-").map(Number);
  const monthDays = new Date(year, monthNumber, 0).getDate();
  const trackingStartByEmployee =
    firstPunchDatesByEmployee(trackingRecords);
  for (const employee of allowed) {
    for (let day = 1; day <= monthDays; day += 1) {
      const dateKey = `${month}-${String(day).padStart(2, "0")}`;
      if (dateKey > todayIso()) continue;
      const trackingStart = trackingStartByEmployee.get(
        employee.FuncionarioID,
      );
      // Sem batida não existe saldo a apurar. A admissão e o início da jornada
      // não podem gerar horas negativas antes do primeiro registro real.
      if (!trackingStart || dateKey < trackingStart) continue;
      const schedule = scheduleFor(schedules, employee.FuncionarioID, dateKey);
      const rows = monthRecords.filter(
        (item) =>
          item.FuncionarioID === employee.FuncionarioID &&
          normalizedDateKey(item.Data) === dateKey,
      );
      const approvedOff = timeOff.find(
        (item) =>
          item.FuncionarioID === employee.FuncionarioID &&
          ["Aprovada", "Concluída"].includes(item.Status) &&
          normalizedDateKey(item.DataInicio) <= dateKey &&
          normalizedDateKey(item.DataFim || item.DataInicio) >= dateKey,
      );
      const weekday = new Date(`${dateKey}T12:00:00`).getDay();
      const fixed =
        !approvedOff &&
        [employee.DiaFolgaPreferencial, employee.SegundoDiaFolgaPreferencial]
          .filter(Boolean)
          .some((name) =>
            String(name)
              .toLowerCase()
              .startsWith(
                [
                  "domingo",
                  "segunda",
                  "terça",
                  "quarta",
                  "quinta",
                  "sexta",
                  "sábado",
                ][weekday].slice(0, 5),
              ),
          );
      if (
        !rows.length &&
        !approvedOff &&
        !fixed &&
        (!schedule || !workdayIndexes(schedule).includes(weekday))
      ) {
        continue;
      }
      const metrics = dayMetrics(rows, schedule);
      const justification = justifications.find(
        (item) =>
          item.FuncionarioID === employee.FuncionarioID &&
          normalizedDateKey(item.Data) === dateKey &&
          item.Status === "Aprovada",
      );
      const balanceState = justification
        ? { minutes: 0, text: "Justificado", pending: false }
        : dayBalanceState(dateKey, metrics);
      days.push({
        funcionarioId: employee.FuncionarioID,
        nome: employee.Nome,
        data: dateKey,
        entrada: metrics.entrada,
        saidaIntervalo: metrics.saidaIntervalo,
        retornoIntervalo: metrics.retornoIntervalo,
        saida: metrics.saida,
        trabalhadoMinutos: metrics.worked,
        trabalhadoTexto: minutesText(metrics.worked),
        previstoMinutos: metrics.expected,
        previstoTexto: minutesText(metrics.expected),
        saldoMinutos: balanceState.minutes,
        saldoTexto: balanceState.text,
        saldoPendente: balanceState.pending,
        folga: !!approvedOff,
        folgaFixa: fixed,
        justificado: !!justification,
        justificativaId: justification?.JustificativaPontoID || "",
        justificativaTipo: justification?.Tipo || "",
        justificativaObservacao: justification?.Observacao || "",
      });
    }
  }
  const totals = balanceDays(days).reduce(
    (result, item) => {
      result.worked += item.trabalhadoMinutos;
      result.expected += item.previstoMinutos;
      return result;
    },
    { worked: 0, expected: 0 },
  );
  return {
    month,
    date: operationalDay,
    employees: allowed,
    records: monthRecords,
    schedules: schedules.filter((item) =>
      allowedIds.has(item.FuncionarioID),
    ),
    locations: [],
    adjustments: monthAdjustments,
    justifications: justifications.filter(
      (item) =>
        allowedIds.has(item.FuncionarioID) &&
        normalizedDateKey(item.Data).slice(0, 7) === month,
    ),
    days,
    todayRecords,
    nextAction:
      ownEmployee && !todayTimeOff && !fixedOff
        ? nextClockAction(todayRecords, ownSchedule)
        : "",
    breakDurationMinutes: Number(ownSchedule?.DuracaoIntervaloMinutos || 0),
    offToday: !!todayTimeOff || fixedOff,
    offTodayLabel: todayTimeOff
      ? "De folga hoje"
      : fixedOff
        ? "Folga fixa hoje"
        : "",
    summary: {
      trabalhadoMinutos: totals.worked,
      previstoMinutos: totals.expected,
      saldoMinutos: totals.worked - totals.expected,
      trabalhadoTexto: minutesText(totals.worked),
      previstoTexto: minutesText(totals.expected),
      saldoTexto:
        (totals.worked - totals.expected >= 0 ? "+" : "") +
        minutesText(totals.worked - totals.expected),
    },
  };
}

async function quickClockContext() {
  const profile = await runtime.requireProfile();
  const employee = await runtime.getById(
    "Funcionarios",
    profile.FuncionarioID,
  );
  if (!employee || !asBoolean(employee.Ativo)) {
    return {
      month: monthIso(),
      date: todayIso(),
      todayRecords: [],
      records: [],
      days: [],
      adjustments: [],
      nextAction: "",
      offToday: false,
      offTodayLabel: "",
      breakDurationMinutes: 0,
      summary: {},
    };
  }
  const [records, schedules, timeOff] = await Promise.all([
    runtime.listPeriods(
      "RegistrosPonto",
      [monthIso(), previousDateKey(todayIso()).slice(0, 7)],
      { profile },
    ),
    runtime.list("JornadasPonto", { profile }),
    runtime.list("Folgas", { profile }),
  ]);
  const operationalDay = operationalDayFor(
    records,
    schedules,
    employee.FuncionarioID,
  );
  const schedule = scheduleFor(
    schedules,
    employee.FuncionarioID,
    operationalDay,
  );
  const todayRecords = records
    .filter(
      (item) =>
        item.FuncionarioID === employee.FuncionarioID &&
        normalizedDateKey(item.Data) === operationalDay &&
        item.Status !== "Substituído",
    )
    .sort((a, b) => String(a.DataHora).localeCompare(String(b.DataHora)));
  const approvedOff = timeOff.find(
    (item) =>
      item.FuncionarioID === employee.FuncionarioID &&
      ["Aprovada", "Concluída"].includes(item.Status) &&
      normalizedDateKey(item.DataInicio) <= operationalDay &&
      normalizedDateKey(item.DataFim || item.DataInicio) >= operationalDay,
  );
  const weekdayName = [
    "domingo",
    "segunda",
    "terça",
    "quarta",
    "quinta",
    "sexta",
    "sábado",
  ][new Date(`${operationalDay}T12:00:00`).getDay()];
  const fixedOff =
    !approvedOff &&
    [
      employee.DiaFolgaPreferencial,
      employee.SegundoDiaFolgaPreferencial,
    ]
      .filter(Boolean)
      .some((day) =>
        String(day).toLowerCase().startsWith(weekdayName.slice(0, 5)),
      );
  const metrics = dayMetrics(todayRecords, schedule);
  return {
    month: operationalDay.slice(0, 7),
    date: operationalDay,
    todayRecords,
    records: todayRecords,
    days: [],
    adjustments: [],
    nextAction:
      !approvedOff && !fixedOff
        ? nextClockAction(todayRecords, schedule)
        : "",
    breakDurationMinutes: Number(schedule?.DuracaoIntervaloMinutos || 0),
    offToday: !!approvedOff || fixedOff,
    offTodayLabel: approvedOff
      ? "De folga hoje"
      : fixedOff
        ? "Folga fixa hoje"
        : "",
    summary: {
      trabalhadoMinutos: metrics.worked,
      previstoMinutos: metrics.expected,
      saldoMinutos: metrics.balance,
      trabalhadoTexto: minutesText(metrics.worked),
      previstoTexto: minutesText(metrics.expected),
      saldoTexto:
        (metrics.balance >= 0 ? "+" : "") + minutesText(metrics.balance),
    },
  };
}

export function createClockHandlers() {
  return {
    async getTimeClockSettingsWithSession(args) {
      dropClientToken(args);
      const profile = await runtime.requireProfile();
      const [schedules, locations] = await Promise.all([
        runtime.list("JornadasPonto", { profile }),
        runtime.list("LocaisPonto", { profile }),
      ]);
      return success({ schedules, locations }, "Configurações carregadas.");
    },

    async saveTimeClockEmployeeConfig(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const employee = await runtime.getById(
        "Funcionarios",
        payload.funcionarioId || payload.FuncionarioID,
      );
      assert(employee, "Funcionário não encontrado.");
      scopeRecord(profile, employee);
      const employeeSchedules = (
        await runtime.list("JornadasPonto", { profile })
      ).filter(
        (item) => item.FuncionarioID === employee.FuncionarioID,
      );
      const existing =
        scheduleFor(
          employeeSchedules,
          employee.FuncionarioID,
          todayIso(),
        ) ||
        employeeSchedules.sort((a, b) =>
          String(b.DataAtualizacao || b.VigenteDe || "").localeCompare(
            String(a.DataAtualizacao || a.VigenteDe || ""),
          ),
        )[0];
      const schedule = await runtime.upsert("JornadasPonto", {
        ...(existing || {}),
        JornadaPontoID: existing?.JornadaPontoID || uuid(),
        FuncionarioID: employee.FuncionarioID,
        EmailFuncionario: payload.email || employee.Email,
        LojaID: employee.LojaID,
        TipoJornada: payload.tipoJornada || "Completa",
        CargaDiariaMinutos: Number(payload.cargaDiariaMinutos || 0),
        CargaSemanalMinutos: Number(payload.cargaSemanalMinutos || 0),
        HoraEntrada: payload.horaEntrada || "",
        HoraSaidaIntervalo: payload.horaSaidaIntervalo || "",
        HoraRetornoIntervalo: payload.horaRetornoIntervalo || "",
        HoraSaida: payload.horaSaida || "",
        DuracaoIntervaloMinutos: Number(payload.duracaoIntervaloMinutos || 0),
        DiasTrabalho: payload.diasTrabalho || "1,2,3,4,5,6",
        ToleranciaMinutos: Number(payload.toleranciaMinutos || 0),
        BancoHorasAtivo: payload.bancoHorasAtivo !== false,
        Ativa: true,
        DataAtualizacao: nowIso(),
        AtualizadoPor: profile.Email,
        VigenteDe: existing?.VigenteDe || todayIso(),
        VigenteAte: "",
      });
      await audit(
        "Configurar jornada",
        "Ponto",
        schedule.JornadaPontoID,
        { after: schedule },
      );
      return success(schedule, "Jornada guardada.");
    },

    async saveTimeClockStoreLocation(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const store = await runtime.getById(
        "Lojas",
        payload.lojaId || payload.LojaID,
      );
      assert(store, "Loja não encontrada.");
      scopeRecord(profile, store);
      const latitude = Number(payload.latitude);
      const longitude = Number(payload.longitude);
      assert(
        Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          Math.abs(latitude) <= 90 &&
          Math.abs(longitude) <= 180,
        "Informe latitude e longitude válidas.",
      );
      const existing = await runtime.findOne(
        "LocaisPonto",
        "LojaID",
        store.LojaID,
      );
      const location = await runtime.upsert("LocaisPonto", {
        ...(existing || {}),
        LocalPontoID: existing?.LocalPontoID || uuid(),
        LojaID: store.LojaID,
        NomeLoja: store.NomeLoja,
        Latitude: latitude,
        Longitude: longitude,
        RaioMetros: Math.max(20, Number(payload.raioMetros || 150)),
        Ativo: true,
        DataAtualizacao: nowIso(),
        AtualizadoPor: profile.Email,
      });
      return success(location, "Local do ponto guardado.");
    },

    async getTimeClockDataWithSession(args) {
      const values = dropClientToken(args);
      return success(await clockContext(values[0] || {}), "Ponto carregado.");
    },

    async getTimeClockQuickStatusWithSession(args) {
      dropClientToken(args);
      return success(await quickClockContext(), "Ponto pronto.");
    },

    async registerTimeClockPunch(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const employee = await runtime.getById(
        "Funcionarios",
        profile.FuncionarioID,
      );
      assert(employee && asBoolean(employee.Ativo), "Funcionário inativo.");
      const [location, schedules, allRecords] = await Promise.all([
        runtime.findOne("LocaisPonto", "LojaID", employee.LojaID),
        runtime.list("JornadasPonto", { profile }),
        runtime.listPeriods(
          "RegistrosPonto",
          [monthIso(), previousDateKey(todayIso()).slice(0, 7)],
          { profile },
        ),
      ]);
      assert(location && asBoolean(location.Ativo), "Configure o local do ponto.");
      const day = operationalDayFor(
        allRecords,
        schedules,
        employee.FuncionarioID,
      );
      const schedule = scheduleFor(
        schedules,
        employee.FuncionarioID,
        day,
      );
      assert(schedule && asBoolean(schedule.Ativa), "Configure a jornada.");
      const latitude = Number(payload.latitude);
      const longitude = Number(payload.longitude);
      const accuracy = Number(payload.accuracy);
      assert(
        Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          Number.isFinite(accuracy),
        "Autorize a localização precisa para bater o ponto.",
      );
      const distance = Math.round(
        haversineMeters(
          latitude,
          longitude,
          Number(location.Latitude),
          Number(location.Longitude),
        ),
      );
      const radius = Number(location.RaioMetros || 150);
      assert(
        distance + Math.ceil(Math.max(0, accuracy)) <= radius,
        `Você está a ${distance} m da loja (precisão ±${Math.ceil(
          accuracy,
        )} m), fora do raio de ${radius} m.`,
      );
      const records = allRecords.filter(
        (item) =>
          item.FuncionarioID === employee.FuncionarioID &&
          normalizedDateKey(item.Data) === day &&
          item.Status !== "Substituído",
      );
      const requestId = String(payload.requestId || "").trim();
      assert(requestId, "Atualize a tela e tente registrar o ponto novamente.");
      const repeated = requestId
        ? records.find((item) => item.RequestID === requestId)
        : null;
      if (repeated) {
        return success(repeated, `Ponto já registrado: ${repeated.TipoMarcacao}.`);
      }
      const next = nextClockAction(records, schedule);
      const expected = String(payload.expectedAction || next).toUpperCase();
      let type = next;
      if (expected === "SEM_DESCANSO" && next === "SAIDA_INTERVALO") {
        type = "SEM_DESCANSO";
      } else {
        assert(expected === next, "A tela estava desatualizada. Atualize o ponto.");
      }
      assert(type, "A jornada de hoje já foi concluída.");
      const selfie = await uploadClockSelfieToDrive({
        selfieDataUrl: payload.selfieDataUrl,
        requestId,
        day,
        type,
      });
      const saved = await runtime.upsert("RegistrosPonto", {
        RegistroPontoID: requestId,
        FuncionarioID: employee.FuncionarioID,
        NomeFuncionario: employee.Nome,
        EmailFuncionario: employee.Email,
        LojaID: employee.LojaID,
        NomeLoja: employee.NomeLoja,
        Data: day,
        TipoMarcacao: type,
        DataHora: nowIso(),
        Latitude: latitude,
        Longitude: longitude,
        PrecisaoMetros: accuracy,
        DistanciaLojaMetros: distance,
        DentroRaio: true,
        Origem: "Aplicação web · selfie no Google Drive + localização",
        SelfieStorage: "Google Drive",
        SelfieDriveFileID: selfie.fileId,
        SelfieDriveURL: selfie.fileUrl,
        SelfieDriveFileName: selfie.fileName,
        SelfieDriveUploadedAt: selfie.uploadedAt,
        Status: "Válido",
        Observacoes:
          type === "SEM_DESCANSO"
            ? "Descanso não realizado; período mantido como trabalhado."
            : "",
        Ajustado: false,
        RegistroOriginalID: "",
        DataCriacao: nowIso(),
        ForaHorario: false,
        CriadoPor: profile.Email,
        RequestID: requestId,
      });
      await audit("Registrar ponto", "Ponto", saved.RegistroPontoID, {
        after: saved,
      });
      return success(saved, `Ponto registrado: ${type}.`);
    },

    async registerTimeClockManualPunch(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const employee = await runtime.getById(
        "Funcionarios",
        payload.funcionarioId,
      );
      assert(employee, "Funcionário não encontrado.");
      assert(clockTypes.includes(payload.tipoMarcacao), "Tipo inválido.");
      assert(String(payload.motivo || "").trim(), "Informe o motivo.");
      const dateTime = new Date(payload.dataHora);
      assert(
        Number.isFinite(dateTime.getTime()) &&
          dateTime.getTime() <= Date.now() + 5 * 60000,
        "Informe um horário válido e não futuro.",
      );
      const saved = await runtime.upsert("RegistrosPonto", {
        RegistroPontoID: uuid(),
        FuncionarioID: employee.FuncionarioID,
        NomeFuncionario: employee.Nome,
        EmailFuncionario: employee.Email,
        LojaID: employee.LojaID,
        NomeLoja: employee.NomeLoja,
        Data: payload.dataOperacional || todayIso(dateTime),
        TipoMarcacao: payload.tipoMarcacao,
        DataHora: dateTime.toISOString(),
        Latitude: "",
        Longitude: "",
        PrecisaoMetros: "",
        DistanciaLojaMetros: "",
        DentroRaio: true,
        Origem: "Lançamento administrativo",
        Status: "Válido",
        Observacoes: payload.motivo,
        Ajustado: true,
        RegistroOriginalID: "",
        DataCriacao: nowIso(),
        ForaHorario: false,
        CriadoPor: profile.Email,
      });
      await audit(
        "Lançar ponto manual",
        "Ponto",
        saved.RegistroPontoID,
        { after: saved },
      );
      return success(saved, "Ponto lançado com auditoria.");
    },

    async requestTimeClockAdjustment(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const record = await runtime.getById(
        "RegistrosPonto",
        payload.registroPontoId,
      );
      assert(record, "Registro de ponto não encontrado.");
      scopeRecord(profile, record);
      const requestedDate = new Date(payload.dataHoraSolicitada);
      const reason = String(payload.motivo || "").trim();
      assert(
        Number.isFinite(requestedDate.getTime()),
        "Informe a data e hora solicitadas.",
      );
      assert(reason, "Informe o motivo do ajuste.");
      const adjustment = await runtime.upsert("AjustesPonto", {
        AjustePontoID: uuid(),
        RegistroPontoID: record.RegistroPontoID,
        FuncionarioID: record.FuncionarioID,
        NomeFuncionario: record.NomeFuncionario,
        LojaID: record.LojaID,
        Data: record.Data,
        TipoMarcacao: record.TipoMarcacao,
        DataHoraOriginal: record.DataHora,
        DataHoraSolicitada: requestedDate.toISOString(),
        Motivo: reason,
        Status: "Pendente",
        SolicitadoPor: profile.Email,
        DataSolicitacao: nowIso(),
        DecididoPor: "",
        DataDecisao: "",
        ObservacaoDecisao: "",
        DataHoraAprovada: "",
      });
      return success(adjustment, "Pedido de ajuste enviado.");
    },

    async decideTimeClockAdjustment(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const adjustment = await runtime.getById(
        "AjustesPonto",
        payload.ajustePontoId,
      );
      assert(adjustment, "Pedido de ajuste não encontrado.");
      scopeRecord(profile, adjustment);
      assert(
        adjustment.Status === "Pendente",
        "Este pedido de ajuste já recebeu uma decisão.",
      );
      const approved =
        String(payload.decision || "").toLowerCase() === "aprovar";
      const approvedDate = approved
        ? new Date(payload.dataHoraAprovada || adjustment.DataHoraSolicitada)
        : null;
      if (approved) {
        assert(
          Number.isFinite(approvedDate.getTime()),
          "Informe uma data e hora válidas para a aprovação.",
        );
      }
      const decisionChanges = {
        Status: approved ? "Aprovado" : "Rejeitado",
        DecididoPor: profile.Email,
        DataDecisao: nowIso(),
        ObservacaoDecisao: String(payload.observacao || ""),
        DataHoraAprovada: approved ? approvedDate.toISOString() : "",
      };
      let updated;
      if (approved) {
        [updated] = await runtime.patchMany([
          {
            table: "AjustesPonto",
            id: adjustment.AjustePontoID,
            changes: decisionChanges,
          },
          {
            table: "RegistrosPonto",
            id: adjustment.RegistroPontoID,
            changes: {
              DataHora: decisionChanges.DataHoraAprovada,
              Data: todayIso(new Date(decisionChanges.DataHoraAprovada)),
              Ajustado: true,
              Observacoes: `Ajustado por ${profile.Email}: ${
                payload.observacao || ""
              }`,
            },
          },
        ]);
      } else {
        updated = await runtime.patch(
          "AjustesPonto",
          adjustment.AjustePontoID,
          decisionChanges,
        );
      }
      await audit(
        approved ? "Aprovar ajuste de ponto" : "Rejeitar ajuste de ponto",
        "Ponto",
        adjustment.AjustePontoID,
        { before: adjustment, after: updated },
      );
      return success(
        { ...updated, message: approved ? "Ajuste aprovado." : "Pedido rejeitado." },
        approved ? "Ajuste aprovado." : "Pedido rejeitado.",
      );
    },

    async justifyMissedTimeClockDay(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const employee = await runtime.getById(
        "Funcionarios",
        payload.funcionarioId,
      );
      assert(employee && asBoolean(employee.Ativo), "Funcionário não encontrado.");
      scopeRecord(profile, employee);
      const date = normalizedDateKey(payload.data);
      assert(/^\d{4}-\d{2}-\d{2}$/.test(date), "Informe uma data válida.");
      assert(date <= todayIso(), "Não é possível justificar uma data futura.");
      const type = String(payload.tipo || "").trim();
      assert(clockJustificationTypes.includes(type), "Tipo de justificativa inválido.");
      const observation = String(payload.observacao || "").trim();
      if (type === "Outros") {
        assert(observation.length >= 5, "Descreva o motivo em Outros.");
      }
      const records = await runtime.listPeriods(
        "RegistrosPonto",
        [date.slice(0, 7)],
        { profile },
      );
      assert(
        !records.some(
          (item) =>
            item.FuncionarioID === employee.FuncionarioID &&
            normalizedDateKey(item.Data) === date &&
            item.Status !== "Substituído",
        ),
        "Este dia possui marcações. Use o ajuste de ponto.",
      );
      const id = `${employee.FuncionarioID}__${date}`;
      const existing = await runtime.getById("JustificativasPonto", id);
      if (existing) scopeRecord(profile, existing);
      const saved = await runtime.upsert("JustificativasPonto", {
        ...(existing || {}),
        JustificativaPontoID: id,
        FuncionarioID: employee.FuncionarioID,
        NomeFuncionario: employee.Nome,
        LojaID: employee.LojaID,
        NomeLoja: employee.NomeLoja,
        Data: date,
        Tipo: type,
        Observacao: observation,
        Status: "Aprovada",
        DataCriacao: existing?.DataCriacao || nowIso(),
        DataAtualizacao: nowIso(),
        JustificadoPor: profile.Email,
      });
      await audit(
        existing ? "Atualizar justificativa de ponto" : "Justificar ausência de ponto",
        "Ponto",
        saved.JustificativaPontoID,
        { before: existing || null, after: saved },
      );
      return success(saved, "Dia justificado sem gerar saldo negativo.");
    },

    async generateMonthlyTimeClockSheet(args) {
      const values = dropClientToken(args);
      const filters = values[0] || {};
      const context = await clockContext(filters);
      const rows = context.days.map((item) => ({
        Funcionário: item.nome,
        Data: item.data,
        Entrada: item.entrada,
        "Saída intervalo": item.saidaIntervalo,
        "Retorno intervalo": item.retornoIntervalo,
        Saída: item.saida,
        Trabalhado: item.trabalhadoTexto,
        Saldo: item.saldoTexto,
        Justificativa: item.justificado
          ? `${item.justificativaTipo}${item.justificativaObservacao ? ` — ${item.justificativaObservacao}` : ""}`
          : "",
      }));
      const columns = Object.keys(rows[0] || { Funcionário: "", Data: "" });
      return success({
        sheetName: `Espelho-${context.month}`,
        url: csvDataUrl(rows, columns),
      });
    },

    async corrigirEntradasDuplicadasPonto() {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const records = await runtime.list("RegistrosPonto", { profile });
      const first = new Map();
      let corrected = 0;
      const affected = new Set();
      for (const record of records
        .filter(
          (item) =>
            item.TipoMarcacao === "ENTRADA" &&
            item.Status !== "Substituído",
        )
        .sort((a, b) => String(a.DataHora).localeCompare(String(b.DataHora)))) {
        const key = `${record.FuncionarioID}|${record.Data}`;
        if (!first.has(key)) first.set(key, record);
        else {
          await runtime.patch("RegistrosPonto", record.RegistroPontoID, {
            Status: "Substituído",
            Ajustado: true,
            RegistroOriginalID: first.get(key).RegistroPontoID,
            Observacoes: "Entrada duplicada desconsiderada pela correção.",
          });
          corrected += 1;
          affected.add(key);
        }
      }
      return success({
        corrigidas: corrected,
        funcionariosAfetados: affected.size,
      });
    },

    async getHourBalanceOverviewWithSession(args) {
      dropClientToken(args);
      const context = await clockContext({
        month: monthIso(),
        includeHistoricalStart: true,
      });
      const employeeTotals = new Map();
      balanceDays(context.days).forEach((item) => {
          const current = employeeTotals.get(item.funcionarioId) || {
            FuncionarioID: item.funcionarioId,
            Nome: item.nome,
            saldoMinutos: 0,
            desde: item.data,
          };
          current.saldoMinutos += Number(item.saldoMinutos || 0);
          if (item.data < current.desde) current.desde = item.data;
          employeeTotals.set(item.funcionarioId, current);
        });
      const employees = [...employeeTotals.values()].map((item) => ({
        ...item,
        saldoTexto:
          (item.saldoMinutos >= 0 ? "+" : "") + minutesText(item.saldoMinutos),
      }));
      const totalMinutos = employees.reduce(
        (sum, item) => sum + item.saldoMinutos,
        0,
      );
      return success({
        employees,
        totalMinutos,
        totalTexto:
          (totalMinutos >= 0 ? "+" : "") + minutesText(totalMinutos),
      });
    },
  };
}

export {
  balanceDays,
  clockContext,
  dayBalanceState,
  dayMetrics,
  firstPunchDatesByEmployee,
  operationalDayFor,
  scheduleExpectedMinutes,
};
