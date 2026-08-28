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

const warmSelfieDriveService = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    await fetch(selfieDriveEndpoint(), {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
  } catch {
    // O POST continuará funcionando mesmo se o aquecimento for bloqueado.
  } finally {
    clearTimeout(timeout);
  }
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch(selfieDriveEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      redirect: "follow",
      credentials: "omit",
      signal: controller.signal,
      body: JSON.stringify({
        action: "uploadClockSelfie",
        idToken,
        requestId,
        day,
        clockType: type,
        selfieDataUrl: selfie,
      }),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "O Google Drive demorou demais para responder. Tente novamente; a selfie não será duplicada.",
      );
    }
    throw new Error(
      "Não foi possível enviar a selfie ao Google Drive. Verifique a internet e tente novamente.",
    );
  } finally {
    clearTimeout(timeout);
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

const formatScheduleTime = (schedule) => {
  if (!schedule?.HoraEntrada || !schedule?.HoraSaida) return "";
  const fmt = (val) => {
    const s = String(val || "");
    // Already "HH:MM" or "HH:MM:SS"
    const hhmm = s.match(/^(\d{1,2}:\d{2})/);
    if (hhmm) return hhmm[1];
    // ISO timestamp like "1899-12-31T18:34:00"
    const tv = timeValue(s);
    if (tv) return tv;
    return s.slice(0, 5);
  };
  const entry = fmt(schedule.HoraEntrada);
  const exit = fmt(schedule.HoraSaida);
  return entry && exit ? `${entry} às ${exit}` : "";
};

const normalizedDateKey = (value) => {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
};

const normalizedWeekday = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const isFixedOffForDate = (
  employee,
  dateKey,
  timeOffRecords = [],
) => {
  if (
    !employee ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))
  ) {
    return false;
  }
  const weekday = [
    "domingo",
    "segunda",
    "terça",
    "quarta",
    "quinta",
    "sexta",
    "sábado",
  ][new Date(`${dateKey}T12:00:00`).getDay()];
  const recurring = [
    employee.DiaFolgaPreferencial,
    employee.SegundoDiaFolgaPreferencial,
  ]
    .filter(Boolean)
    .some((day) =>
      normalizedWeekday(day).startsWith(
        normalizedWeekday(weekday).slice(0, 5),
      ),
    );
  if (!recurring) return false;
  return !timeOffRecords.some(
    (item) =>
      String(item.FuncionarioID || "") ===
        String(employee.FuncionarioID || "") &&
      ["Aprovada", "Concluída"].includes(item.Status) &&
      normalizedDateKey(item.FolgaFixaSubstituidaData) === dateKey,
  );
};

const firstPunchDatesByEmployee = (records = []) => {
  const starts = new Map();
  records
    .filter(
      (item) =>
        item.FuncionarioID &&
        item.Status !== "Substituído" &&
        item.TipoMarcacao === "ENTRADA" &&
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

const hasRecurringFixedOff = (employee) =>
  Boolean(
    String(employee?.DiaFolgaPreferencial || "").trim() ||
      String(employee?.SegundoDiaFolgaPreferencial || "").trim(),
  );

const isScheduledWorkday = (schedule, employee, weekday) =>
  Boolean(schedule) &&
  (hasRecurringFixedOff(employee) ||
    workdayIndexes(schedule).includes(weekday));

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

const dateTimeNumber = (value) => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const compareRecordsByDateTime = (a, b) =>
  dateTimeNumber(a?.DataHora) - dateTimeNumber(b?.DataHora);

const nextClockAction = (records, schedule) => {
  const types = records
    .filter((item) => item.Status !== "Substituído")
    .sort(compareRecordsByDateTime)
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
    .sort(compareRecordsByDateTime);
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
  const embedded = text.match(/[T\s](\d{1,2}):(\d{2})(?::\d{2})?/);
  if (embedded) return Number(embedded[1]) * 60 + Number(embedded[2]);
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
      (!item.folga || item.trabalhou) &&
      (!item.folgaFixa || item.trabalhou) &&
      !item.justificado &&
      !item.saldoPendente,
  );

const MAX_DAILY_WORK_MINUTES = 12 * 60;

const dayMetrics = (records, schedule, options = {}) => {
  const ordered = records
    .filter((item) => item.Status !== "Substituído")
    .sort(compareRecordsByDateTime);
  const scheduledBreak = Math.max(
    0,
    Number(schedule?.DuracaoIntervaloMinutos || 0),
  );
  const shifts = [];
  let openShift = null;
  let unmatchedEntry = false;

  ordered.forEach((record) => {
    if (record.TipoMarcacao === "ENTRADA") {
      if (openShift) unmatchedEntry = true;
      openShift = { entry: record, records: [] };
      return;
    }
    if (!openShift) return;
    if (record.TipoMarcacao === "SAIDA_FINAL") {
      shifts.push({ ...openShift, exit: record });
      openShift = null;
      return;
    }
    openShift.records.push(record);
  });

  const rawWorked = shifts.reduce((total, shift) => {
    const breakOut = shift.records.find(
      (item) => item.TipoMarcacao === "SAIDA_INTERVALO",
    );
    const breakIn = breakOut
      ? shift.records.find(
          (item) =>
            item.TipoMarcacao === "RETORNO_INTERVALO" &&
            dateTimeNumber(item.DataHora) >= dateTimeNumber(breakOut.DataHora),
        )
      : null;
    const breakMinutes = breakOut
      ? breakIn
        ? exactMinutesBetween(breakOut.DataHora, breakIn.DataHora)
        : scheduledBreak
      : 0;
    return (
      total +
      Math.max(
        0,
        exactMinutesBetween(shift.entry.DataHora, shift.exit.DataHora) -
          breakMinutes,
      )
    );
  }, 0);

  const entry = shifts[0]?.entry || openShift?.entry || null;
  const exit = shifts[shifts.length - 1]?.exit || null;
  const displayRecords = shifts.flatMap((shift) => shift.records);
  if (openShift) displayRecords.push(...openShift.records);
  const breakOut = displayRecords.find(
    (item) => item.TipoMarcacao === "SAIDA_INTERVALO",
  );
  const breakIn = displayRecords.find(
    (item) => item.TipoMarcacao === "RETORNO_INTERVALO",
  );
  const noBreak = displayRecords.find(
    (item) => item.TipoMarcacao === "SEM_DESCANSO",
  );
  const reviewRequired = rawWorked > MAX_DAILY_WORK_MINUTES;
  const worked = Math.min(rawWorked, MAX_DAILY_WORK_MINUTES);
  const expected =
    options.expectedMinutes === undefined
      ? scheduleExpectedMinutes(schedule)
      : Math.max(0, Number(options.expectedMinutes || 0));
  const rawBalance = worked - expected;
  const tolerance = Math.max(0, Number(schedule?.ToleranciaMinutos || 0));
  const balance = Math.abs(rawBalance) <= tolerance ? 0 : rawBalance;
  return {
    entrada: entry ? timeValue(entry.DataHora) : "",
    saidaIntervalo: breakOut ? timeValue(breakOut.DataHora) : noBreak ? "Sem descanso" : "",
    retornoIntervalo: breakIn ? timeValue(breakIn.DataHora) : "",
    saida: exit ? timeValue(exit.DataHora) : "",
    worked,
    rawWorked,
    expected,
    rawBalance,
    tolerance,
    balance,
    hasPunches: ordered.length > 0,
    complete: shifts.length > 0 && !openShift && !unmatchedEntry,
    reviewRequired,
  };
};

const dayBalanceState = (dateKey, metrics, currentDate = todayIso()) => {
  // Sem ENTRADA e SAIDA_FINAL, a duração da jornada não é confiável.
  // Ela deve continuar pendente após a virada do dia, em vez de virar
  // automaticamente um débito equivalente à jornada inteira.
  const pending = !metrics.complete || metrics.reviewRequired;
  return {
    pending,
    minutes: pending ? 0 : metrics.balance,
    text: pending
      ? "—"
      : (metrics.balance >= 0 ? "+" : "") + minutesText(metrics.balance),
  };
};

const lastDateOfMonth = (month) => {
  const [year, monthNumber] = String(month || "")
    .split("-")
    .map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    return todayIso();
  }
  return todayIso(new Date(year, monthNumber, 0, 12));
};

const nextDateKey = (dateKey) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return todayIso(date);
};

const hourBankMovementMinutes = (movement) => {
  const rawMinutes = movement?.SaldoMinutos;
  const explicitMinutes = Number(rawMinutes);
  if (
    rawMinutes !== "" &&
    rawMinutes !== undefined &&
    Number.isFinite(explicitMinutes)
  ) {
    return explicitMinutes;
  }
  const hours = Number(movement?.SaldoDia);
  return Number.isFinite(hours) ? Math.round(hours * 60) : 0;
};

const accumulatedHourBalance = ({
  employees = [],
  records = [],
  schedules = [],
  timeOff = [],
  justifications = [],
  movements = [],
  throughMonth = monthIso(),
  employeeId = "",
  currentDate = todayIso(),
} = {}) => {
  const month = /^\d{4}-\d{2}$/.test(String(throughMonth || ""))
    ? String(throughMonth)
    : monthIso();
  const throughDate = [lastDateOfMonth(month), currentDate].sort()[0];
  // O painel administrativo precisa representar o cadastro inteiro. A
  // ausência de marcações significa saldo ainda não iniciado, não ausência do
  // funcionário no relatório.
  const allowed = employees.filter(
    (item) =>
      !employeeId || String(item.FuncionarioID) === String(employeeId),
  );
  const allowedIds = new Set(
    allowed.map((item) => String(item.FuncionarioID || "")),
  );
  const validRecords = records.filter((item) => {
    const date = normalizedDateKey(item.Data || item.DataHora);
    return (
      allowedIds.has(String(item.FuncionarioID || "")) &&
      item.Status !== "Substituído" &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      date <= throughDate
    );
  });
  const firstPunches = firstPunchDatesByEmployee(validRecords);
  const recordsByEmployeeDate = new Map();
  validRecords.forEach((item) => {
    const date = normalizedDateKey(item.Data || item.DataHora);
    const key = `${item.FuncionarioID}|${date}`;
    const rows = recordsByEmployeeDate.get(key) || [];
    rows.push(item);
    recordsByEmployeeDate.set(key, rows);
  });
  const schedulesByEmployee = new Map();
  schedules.forEach((item) => {
    const id = String(item.FuncionarioID || "");
    if (!allowedIds.has(id)) return;
    const rows = schedulesByEmployee.get(id) || [];
    rows.push(item);
    schedulesByEmployee.set(id, rows);
  });
  const timeOffByEmployee = new Map();
  timeOff.forEach((item) => {
    const id = String(item.FuncionarioID || "");
    if (!allowedIds.has(id)) return;
    const rows = timeOffByEmployee.get(id) || [];
    rows.push(item);
    timeOffByEmployee.set(id, rows);
  });
  const justifiedDates = new Set(
    justifications
      .filter((item) => item.Status === "Aprovada")
      .map(
        (item) =>
          `${item.FuncionarioID}|${normalizedDateKey(item.Data)}`,
      ),
  );
  const movementTotals = new Map();
  movements.forEach((item) => {
    const id = String(item.FuncionarioID || "");
    const date = normalizedDateKey(item.Data);
    if (!allowedIds.has(id) || (date && date > throughDate)) return;
    movementTotals.set(
      id,
      Number(movementTotals.get(id) || 0) + hourBankMovementMinutes(item),
    );
  });

  const totals = [];
  allowed.forEach((employee) => {
    const id = String(employee.FuncionarioID || "");
    const start = firstPunches.get(id);
    const employeeSchedules = schedulesByEmployee.get(id) || [];
    const employeeTimeOff = timeOffByEmployee.get(id) || [];
    const adjustments = Number(movementTotals.get(id) || 0);
    let balance = adjustments;
    let worked = 0;
    let expected = 0;
    let pending = 0;
    for (let date = start; date && date <= throughDate; date = nextDateKey(date)) {
      const schedule = scheduleFor(employeeSchedules, id, date);
      const rows = recordsByEmployeeDate.get(`${id}|${date}`) || [];
      const approvedOff = employeeTimeOff.find(
        (item) =>
          ["Aprovada", "Concluída"].includes(item.Status) &&
          normalizedDateKey(item.DataInicio) <= date &&
          normalizedDateKey(item.DataFim || item.DataInicio) >= date,
      );
      const fixed =
        !approvedOff && isFixedOffForDate(employee, date, employeeTimeOff);
      const weekday = new Date(`${date}T12:00:00`).getDay();
      const scheduledDay = isScheduledWorkday(
        schedule,
        employee,
        weekday,
      );
      if (
        !rows.length &&
        !approvedOff &&
        !fixed &&
        !scheduledDay
      ) {
        continue;
      }
      if (
        justifiedDates.has(`${id}|${date}`) ||
        ((approvedOff || fixed) && !rows.length)
      ) {
        continue;
      }
      const metrics = dayMetrics(rows, schedule, {
        expectedMinutes:
          scheduledDay && !approvedOff && !fixed
            ? scheduleExpectedMinutes(schedule)
            : 0,
      });
      const state = dayBalanceState(date, metrics, currentDate);
      if (state.pending) {
        pending += 1;
      } else {
        worked += Number(metrics.worked || 0);
        expected += Number(metrics.expected || 0);
        balance += Number(state.minutes || 0);
      }
    }
    totals.push({
      FuncionarioID: employee.FuncionarioID,
      Nome: employee.Nome,
      LojaID: employee.LojaID || "",
      NomeLoja: employee.NomeLoja || "",
      Ativo: asBoolean(employee.Ativo),
      trabalhadoMinutos: worked,
      trabalhadoTexto: minutesText(worked),
      previstoMinutos: expected,
      previstoTexto: minutesText(expected),
      ajustesMinutos: adjustments,
      ajustesTexto:
        (adjustments >= 0 ? "+" : "") + minutesText(adjustments),
      pendencias: pending,
      saldoMinutos: balance,
      saldoTexto: (balance >= 0 ? "+" : "") + minutesText(balance),
      desde: start || "",
      ate: throughDate,
    });
  });
  const totalMinutos = totals.reduce(
    (sum, item) => sum + Number(item.saldoMinutos || 0),
    0,
  );
  return {
    month,
    throughDate,
    employees: totals,
    totalMinutos,
    totalTexto:
      (totalMinutos >= 0 ? "+" : "") + minutesText(totalMinutos),
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
  const [employees, records, schedules, adjustments, timeOff, justifications, bankMovements] =
    await Promise.all([
      runtime.list("Funcionarios", { profile }),
      runtime.listPeriods("RegistrosPonto", [...recordPeriods], { profile }),
      runtime.list("JornadasPonto", { profile }),
      runtime.list("AjustesPonto", { profile }),
      runtime.list("Folgas", { profile }),
      runtime.list("JustificativasPonto", { profile }),
      runtime.list("BancoHorasMovimentos", { profile }),
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
    .sort(compareRecordsByDateTime);
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
        .sort(compareRecordsByDateTime)
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
    isFixedOffForDate(ownEmployee, operationalDay, timeOff);

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
        !approvedOff && isFixedOffForDate(employee, dateKey, timeOff);
      const scheduledDay = isScheduledWorkday(
        schedule,
        employee,
        weekday,
      );
      if (
        !rows.length &&
        !approvedOff &&
        !fixed &&
        !scheduledDay
      ) {
        continue;
      }
      const metrics = dayMetrics(rows, schedule, {
        expectedMinutes:
          scheduledDay && !approvedOff && !fixed
            ? scheduleExpectedMinutes(schedule)
            : 0,
      });
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
        revisaoObrigatoria: metrics.reviewRequired,
        folga: !!approvedOff,
        folgaFixa: fixed,
        trabalhou: rows.length > 0,
        justificado: !!justification,
        justificativaId: justification?.JustificativaPontoID || "",
        justificativaTipo: justification?.Tipo || "",
        justificativaObservacao: justification?.Observacao || "",
      });
    }
  }
  const validDays = balanceDays(days);
  const totals = validDays.reduce(
    (result, item) => {
      result.worked += Number(item.trabalhadoMinutos || 0);
      result.expected += Number(item.previstoMinutos || 0);
      result.balance += Number(item.saldoMinutos || 0);
      return result;
    },
    { worked: 0, expected: 0, balance: 0 },
  );
  const monthBankMovements = bankMovements.filter(
    (item) =>
      allowedIds.has(String(item.FuncionarioID || "")) &&
      normalizedDateKey(item.Data).slice(0, 7) === month,
  );
  const movementsBalance = monthBankMovements.reduce(
    (sum, item) => sum + hourBankMovementMinutes(item),
    0,
  );
  const finalBalanceMinutes = totals.balance + movementsBalance;
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
    bankMovements: monthBankMovements,
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
      saldoMinutos: finalBalanceMinutes,
      trabalhadoTexto: minutesText(totals.worked),
      previstoTexto: minutesText(totals.expected),
      saldoTexto:
        (finalBalanceMinutes >= 0 ? "+" : "") +
        minutesText(finalBalanceMinutes),
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
    .sort(compareRecordsByDateTime);
  const approvedOff = timeOff.find(
    (item) =>
      item.FuncionarioID === employee.FuncionarioID &&
      ["Aprovada", "Concluída"].includes(item.Status) &&
      normalizedDateKey(item.DataInicio) <= operationalDay &&
      normalizedDateKey(item.DataFim || item.DataInicio) >= operationalDay,
  );
  const fixedOff =
    !approvedOff &&
    isFixedOffForDate(employee, operationalDay, timeOff);
  const operationalWeekday = new Date(`${operationalDay}T12:00:00`).getDay();
  const scheduledDay = isScheduledWorkday(
    schedule,
    employee,
    operationalWeekday,
  );
  const metrics = dayMetrics(todayRecords, schedule, {
    expectedMinutes:
      scheduledDay && !approvedOff && !fixedOff
        ? scheduleExpectedMinutes(schedule)
        : 0,
  });
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

    async prepareTimeClockSelfieUpload(args) {
      dropClientToken(args);
      await warmSelfieDriveService();
      return success({ ready: true }, "Serviço de selfie preparado.");
    },

    async registerTimeClockPunch(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const employeeId = String(profile.FuncionarioID || "");
      const storeId = String(profile.LojaID || "");
      assert(employeeId, "Usuário sem funcionário vinculado.");
      assert(storeId, "Usuário sem loja vinculada.");
      const [employee, location, schedules, allRecords] = await Promise.all([
        runtime.getById("Funcionarios", employeeId),
        runtime.findOne("LocaisPonto", "LojaID", storeId),
        runtime.list("JornadasPonto", { profile }),
        runtime.listPeriods(
          "RegistrosPonto",
          [monthIso(), previousDateKey(todayIso()).slice(0, 7)],
          { profile },
        ),
      ]);
      assert(employee && asBoolean(employee.Ativo), "Funcionário inativo.");
      assert(
        String(employee.LojaID || "") === storeId,
        "O funcionário está vinculado a outra loja. Atualize o acesso.",
      );
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
        return success(
          {
            ...repeated,
            ProximaMarcacao: nextClockAction(records, schedule),
          },
          `Ponto já registrado: ${repeated.TipoMarcacao}.`,
        );
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
      const record = {
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
      };
      let saved;
      try {
        saved = await runtime.create("RegistrosPonto", record);
      } catch (error) {
        const existing = await runtime.getById("RegistrosPonto", requestId);
        if (existing?.RequestID !== requestId) throw error;
        saved = existing;
      }
      void audit("Registrar ponto", "Ponto", saved.RegistroPontoID, {
        after: saved,
      }).catch((error) =>
        console.warn("Auditoria do ponto:", error?.message || error),
      );
      return success(
        {
          ...saved,
          ProximaMarcacao: nextClockAction([...records, saved], schedule),
        },
        `Ponto registrado: ${type}.`,
      );
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
        .sort(compareRecordsByDateTime)) {
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
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const filters = values[0] || {};
      const [employees, records, schedules, timeOff, justifications, movements] =
        await Promise.all([
          runtime.list("Funcionarios", { profile }),
          runtime.list("RegistrosPonto", { profile }),
          runtime.list("JornadasPonto", { profile }),
          runtime.list("Folgas", { profile }),
          runtime.list("JustificativasPonto", { profile }),
          runtime.list("BancoHorasMovimentos", { profile }),
        ]);
      const result = accumulatedHourBalance({
        employees,
        records,
        schedules,
        timeOff,
        justifications,
        movements,
        throughMonth: filters.month || monthIso(),
        employeeId: filters.funcionarioId || "",
      });
      // Para gestores e administradores, calcular também o saldo individual
      // do próprio usuário logado, para exibir no card "Meu saldo" do dashboard.
      if (!filters.funcionarioId && isManager(profile) && profile.FuncionarioID) {
        const selfResult = accumulatedHourBalance({
          employees,
          records,
          schedules,
          timeOff,
          justifications,
          movements,
          throughMonth: filters.month || monthIso(),
          employeeId: String(profile.FuncionarioID),
        });
        const selfEntry = (selfResult.employees || [])[0] || null;
        result.selfBalance = selfEntry
          ? {
              saldoMinutos: selfEntry.saldoMinutos,
              saldoTexto: selfEntry.saldoTexto,
              desde: selfEntry.desde || "",
            }
          : null;
      }
      return success(result);
    },

    async adjustHourBalanceWithSession(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const employee = await runtime.getById(
        "Funcionarios",
        payload.funcionarioId || payload.FuncionarioID,
      );
      assert(employee, "Funcionário não encontrado.");
      const date = normalizedDateKey(payload.data || todayIso());
      const minutes = Math.trunc(Number(payload.minutos));
      const reason = String(payload.motivo || "").trim();
      const requestId = String(payload.requestId || "").trim();
      assert(
        /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayIso(),
        "Informe uma data válida, sem usar uma data futura.",
      );
      assert(
        Number.isFinite(minutes) && minutes !== 0 && Math.abs(minutes) <= 240 * 60,
        "Informe um ajuste entre -240h e +240h.",
      );
      assert(reason.length >= 5, "Explique o motivo do ajuste.");
      assert(
        /^[A-Za-z0-9_-]{16,100}$/.test(requestId),
        "Identificador do ajuste inválido. Atualize a página e tente novamente.",
      );
      const movement = await runtime.upsert("BancoHorasMovimentos", {
        // A mesma tentativa sempre usa a mesma chave. Se a resposta se perder
        // e o navegador reenviar, o Firebase substitui o registro em vez de
        // somar o ajuste outra vez.
        MovID: `ajuste-${requestId}`,
        RequestID: requestId,
        FuncionarioID: employee.FuncionarioID,
        NomeFuncionario: employee.Nome,
        LojaID: employee.LojaID || "",
        NomeLoja: employee.NomeLoja || "",
        Data: date,
        HorasTrabalhadas: 0,
        JornadaContratual: 0,
        SaldoMinutos: minutes,
        SaldoDia: minutes / 60,
        SaldoAcumulado: 0,
        Origem: "Ajuste manual do saldo de horas",
        Observacao: reason,
        DataCriacao: nowIso(),
        CriadoPor: profile.Email,
      });
      await audit(
        "Ajustar saldo de horas",
        "BancoHorasMovimentos",
        movement.MovID,
        { after: movement },
      );
      return success(movement, "Saldo de horas ajustado.");
    },

    async getIncompletePunchesWithSession(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const filters = values[0] || {};
      const currentMonth = monthIso();
      const prevMonth = previousDateKey(todayIso()).slice(0, 7);
      const periods = new Set([currentMonth, prevMonth]);
      if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
        periods.add(filters.month);
      }
      const [employees, records, schedules] = await Promise.all([
        runtime.list("Funcionarios", { profile }),
        runtime.listPeriods("RegistrosPonto", [...periods], { profile }),
        runtime.list("JornadasPonto", { profile }),
      ]);
      const allowedEmployees = employees.filter((e) =>
        isAdmin(profile) ? true : String(e.LojaID || "") === String(profile.LojaID || ""),
      );
      const incomplete = findIncompletePunches(
        records,
        schedules,
        allowedEmployees,
        todayIso(),
      );
      return success({
        incompletos: incomplete,
        total: incomplete.length,
      });
    },

    async quickFixIncompletePunch(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const employeeId = String(
        payload.funcionarioId || payload.FuncionarioID || "",
      ).trim();
      const employee = await runtime.getById("Funcionarios", employeeId);
      assert(employee, "Funcionário não encontrado.");
      scopeRecord(profile, employee);
      const date = normalizedDateKey(payload.data);
      assert(
        /^\d{4}-\d{2}-\d{2}$/.test(date) && date < todayIso(),
        "Informe uma data válida de um dia anterior.",
      );
      const time = String(
        payload.horaSaida || payload.horario || "23:00",
      ).trim();
      assert(
        /^([01]\d|2[0-3]):[0-5]\d$/.test(time),
        "Informe um horário válido no formato HH:MM.",
      );
      const exitDateTime = `${date}T${time}:00`;
      const observation = String(payload.observacao || "").trim();

      const record = {
        RegistroPontoID: uuid(),
        FuncionarioID: employee.FuncionarioID,
        NomeFuncionario: employee.Nome,
        EmailFuncionario: employee.Email,
        LojaID: employee.LojaID || "",
        NomeLoja: employee.NomeLoja || "",
        Data: date,
        TipoMarcacao: "SAIDA_FINAL",
        DataHora: exitDateTime,
        Latitude: 0,
        Longitude: 0,
        PrecisaoMetros: 0,
        DistanciaLojaMetros: 0,
        DentroRaio: true,
        Origem: "Ajuste rápido pelo gestor (saída esquecida)",
        SelfieStorage: "Nenhum",
        Status: "Válido",
        Observacoes:
          observation ||
          `Saída registrada pelo gestor ${profile.Email} por esquecimento de batida.`,
        Ajustado: true,
        RegistroOriginalID: "",
        DataCriacao: nowIso(),
        ForaHorario: false,
        CriadoPor: profile.Email,
        RequestID: uuid(),
      };

      const saved = await runtime.create("RegistrosPonto", record);
      await audit(
        "Ajuste rápido de saída esquecida",
        "RegistrosPonto",
        saved.RegistroPontoID,
        { after: saved },
      );

      return success(saved, "Saída registrada com sucesso.");
    },

    async settleOrConvertHourBalanceWithSession(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const employeeId = String(
        payload.funcionarioId || payload.FuncionarioID || "",
      ).trim();
      const employee = await runtime.getById("Funcionarios", employeeId);
      assert(employee, "Funcionário não encontrado.");
      scopeRecord(profile, employee);
      const month = String(payload.month || monthIso()).slice(0, 7);
      assert(/^\d{4}-\d{2}$/.test(month), "Competência inválida.");
      const mode = String(payload.modo || "converter_folga");
      const minutes = Math.trunc(Number(payload.minutos || 0));
      assert(minutes > 0, "Informe uma quantidade de minutos maior que zero.");
      const reason = String(payload.motivo || "").trim();
      const requestId = String(payload.requestId || uuid()).trim();

      let resultFolgas = null;
      if (mode === "converter_folga") {
        const leaveUnits = Math.max(0.5, Number(payload.folgas || 1));
        const movementKey = `conversao-banco-${requestId}`;
        resultFolgas = await runtime.applyEmployeeLeaveBalance({
          employeeId: employee.FuncionarioID,
          movementKey,
          desiredDelta: leaveUnits,
          metadata: {
            Tipo: "Conversão de banco de horas em folga",
            Competencia: month,
            MinutosAbatidos: minutes,
          },
        });
        await runtime
          .upsert("MovimentosSaldoFolgas", {
            MovimentoID: movementKey,
            FuncionarioID: employee.FuncionarioID,
            NomeFuncionario: employee.Nome || "",
            LojaID: employee.LojaID || "",
            Tipo: "Conversão de banco de horas em folga",
            Competencia: month,
            Delta: leaveUnits,
            AjusteAplicado: leaveUnits,
            SaldoAntes: resultFolgas.balanceBefore,
            SaldoDepois: resultFolgas.balanceAfter,
            DataMovimento: nowIso(),
            CriadoPor: profile.Email,
            Status: "Aplicado",
          })
          .catch(() => {});
      }

      const bankMovement = await runtime.upsert("BancoHorasMovimentos", {
        MovID: `fechamento-${requestId}`,
        RequestID: requestId,
        FuncionarioID: employee.FuncionarioID,
        NomeFuncionario: employee.Nome,
        LojaID: employee.LojaID || "",
        NomeLoja: employee.NomeLoja || "",
        Data: todayIso(),
        HorasTrabalhadas: 0,
        JornadaContratual: 0,
        SaldoMinutos: -minutes,
        SaldoDia: -minutes / 60,
        SaldoAcumulado: 0,
        Origem:
          mode === "converter_folga"
            ? "Conversão em folga compensatória"
            : "Quitação de horas extras em folha",
        Observacao:
          reason ||
          (mode === "converter_folga"
            ? `Conversão de ${minutesText(minutes)} em folga(s) compensatória(s) da competência ${month}.`
            : `Quitação de ${minutesText(minutes)} em folha da competência ${month}.`),
        DataCriacao: nowIso(),
        CriadoPor: profile.Email,
      });

      await audit(
        mode === "converter_folga"
          ? "Converter banco em folga"
          : "Quitar banco de horas",
        "BancoHorasMovimentos",
        bankMovement.MovID,
        { after: bankMovement, folgas: resultFolgas },
      );

      return success(
        {
          banco: bankMovement,
          folgas: resultFolgas,
        },
        mode === "converter_folga"
          ? "Horas convertidas em folga compensatória com sucesso."
          : "Horas quitadas com sucesso.",
      );
    },

    async getLiveStorePresenceWithSession(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const filters = values[0] || {};
      const targetStoreId = String(
        filters.storeId || filters.LojaID || profile.LojaID || "",
      );
      const currentDay = todayIso();
      const [employees, records, schedules, timeOff] = await Promise.all([
        runtime.list("Funcionarios", { profile }),
        runtime.listPeriods("RegistrosPonto", [currentDay.slice(0, 7)], {
          profile,
        }),
        runtime.list("JornadasPonto", { profile }),
        runtime.list("Folgas", { profile }),
      ]);
      let allowedEmployees = employees.filter((e) => asBoolean(e.Ativo));
      if (!isAdmin(profile) && targetStoreId) {
        allowedEmployees = allowedEmployees.filter(
          (e) => String(e.LojaID || "") === targetStoreId,
        );
      } else if (targetStoreId) {
        allowedEmployees = allowedEmployees.filter(
          (e) => String(e.LojaID || "") === targetStoreId,
        );
      }
      return success(
        calculateLivePresence(
          allowedEmployees,
          records,
          schedules,
          timeOff,
          new Date(),
        ),
      );
    },
  };
}

export const calculateLivePresence = (
  employees = [],
  records = [],
  schedules = [],
  timeOff = [],
  now = new Date(),
) => {
  const currentDay = todayIso(now);
  const nowTs = now.getTime();
  const validRecords = records.filter(
    (item) =>
      item.FuncionarioID &&
      item.Status !== "Substituído" &&
      normalizedDateKey(item.Data || item.DataHora) === currentDay,
  );

  const byEmployee = new Map();
  validRecords.forEach((r) => {
    const list = byEmployee.get(String(r.FuncionarioID)) || [];
    list.push(r);
    byEmployee.set(String(r.FuncionarioID), list);
  });

  const presenceList = [];
  employees.forEach((emp) => {
    if (!asBoolean(emp.Ativo)) return;
    const empId = String(emp.FuncionarioID);
    const rows = (byEmployee.get(empId) || []).sort(compareRecordsByDateTime);
    const approvedOff = timeOff.find(
      (item) =>
        item.FuncionarioID === emp.FuncionarioID &&
        ["Aprovada", "Concluída"].includes(item.Status) &&
        normalizedDateKey(item.DataInicio) <= currentDay &&
        normalizedDateKey(item.DataFim || item.DataInicio) >= currentDay,
    );
    const fixedOff =
      !approvedOff && isFixedOffForDate(emp, currentDay, timeOff);
    const sched = scheduleFor(schedules, empId, currentDay);

    let status = "ausente";
    let statusLabel = "Não iniciou";
    let entryTime = "";
    let lastPunchType = "";
    let lastPunchTime = "";
    let elapsedMinutes = 0;
    let alertLevel = "normal";
    let alertMessage = "";

    if (approvedOff || fixedOff) {
      status = "folga";
      statusLabel = approvedOff ? "De folga" : "Folga fixa";
    }

    if (rows.length > 0) {
      const entry = rows.find((r) => r.TipoMarcacao === "ENTRADA");
      const last = rows[rows.length - 1];
      lastPunchType = last.TipoMarcacao;
      lastPunchTime = timeValue(last.DataHora);
      if (entry) entryTime = timeValue(entry.DataHora);

      if (lastPunchType === "SAIDA_FINAL") {
        status = "concluido";
        statusLabel = "Turno encerrado";
      } else if (lastPunchType === "SAIDA_INTERVALO") {
        status = "intervalo";
        statusLabel = "Em intervalo";
      } else {
        status = "trabalhando";
        statusLabel = "Trabalhando agora";

        if (entry?.DataHora) {
          const entryTs = new Date(entry.DataHora).getTime();
          const breakOut = rows.find(
            (r) => r.TipoMarcacao === "SAIDA_INTERVALO",
          );
          const breakIn = rows.find(
            (r) => r.TipoMarcacao === "RETORNO_INTERVALO",
          );
          let breakDuration = 0;
          if (breakOut && breakIn) {
            breakDuration = exactMinutesBetween(
              breakOut.DataHora,
              breakIn.DataHora,
            );
          }
          if (Number.isFinite(entryTs) && nowTs >= entryTs) {
            elapsedMinutes = Math.max(
              0,
              Math.round((nowTs - entryTs) / 60000) - breakDuration,
            );
          }

          if (elapsedMinutes >= 10 * 60) {
            alertLevel = "danger";
            alertMessage = `🚨 ${minutesText(elapsedMinutes)} em turno (Limite excessivo)`;
          } else if (elapsedMinutes >= 8 * 60) {
            alertLevel = "warning";
            alertMessage = `⚠️ ${minutesText(elapsedMinutes)} em turno (Hora extra)`;
          }
        }
      }
    }

    const empName =
      emp.Nome ||
      emp.nome ||
      emp.NomeFuncionario ||
      emp.nomeFuncionario ||
      emp.NomeCompleto ||
      emp.nomeCompleto ||
      emp["Nome Completo"] ||
      emp.Funcionario ||
      emp.funcionario ||
      rows[0]?.NomeFuncionario ||
      rows[0]?.Nome ||
      rows[0]?.nomeFuncionario ||
      "";

    presenceList.push({
      FuncionarioID: emp.FuncionarioID || emp.funcionarioId || emp.id || "",
      Nome: empName,
      Cargo: emp.Cargo || emp.cargo || "Equipe",
      LojaID: emp.LojaID || emp.lojaId || "",
      NomeLoja: emp.NomeLoja || emp.nomeLoja || "",
      status,
      statusLabel,
      entryTime,
      lastPunchType,
      lastPunchTime,
      elapsedMinutes,
      elapsedTexto: elapsedMinutes > 0 ? minutesText(elapsedMinutes) : "",
      alertLevel,
      alertMessage,
      horarioEscala: formatScheduleTime(sched),
    });
  });

  const order = {
    trabalhando: 0,
    intervalo: 1,
    concluido: 2,
    ausente: 3,
    folga: 4,
  };
  presenceList.sort((a, b) => {
    const diff = (order[a.status] ?? 99) - (order[b.status] ?? 99);
    if (diff !== 0) return diff;
    return (b.elapsedMinutes || 0) - (a.elapsedMinutes || 0);
  });

  const totals = {
    trabalhando: presenceList.filter((p) => p.status === "trabalhando").length,
    intervalo: presenceList.filter((p) => p.status === "intervalo").length,
    concluido: presenceList.filter((p) => p.status === "concluido").length,
    ausente: presenceList.filter((p) => p.status === "ausente").length,
    folga: presenceList.filter((p) => p.status === "folga").length,
    alertas: presenceList.filter((p) => p.alertLevel !== "normal").length,
    total: presenceList.length,
  };

  return {
    date: currentDay,
    presence: presenceList,
    totals,
  };
};

export const findIncompletePunches = (
  records = [],
  schedules = [],
  employees = [],
  currentDay = todayIso(),
) => {
  const employeeMap = new Map(
    employees.map((e) => [String(e.FuncionarioID || ""), e]),
  );
  const validRecords = records.filter(
    (item) =>
      item.FuncionarioID &&
      item.Status !== "Substituído" &&
      normalizedDateKey(item.Data || item.DataHora) < currentDay,
  );
  const byEmployeeDate = new Map();
  validRecords.forEach((record) => {
    const date = normalizedDateKey(record.Data || record.DataHora);
    const key = `${record.FuncionarioID}|${date}`;
    const list = byEmployeeDate.get(key) || [];
    list.push(record);
    byEmployeeDate.set(key, list);
  });

  const incomplete = [];
  for (const [key, rows] of byEmployeeDate.entries()) {
    const [empId, date] = key.split("|");
    const emp = employeeMap.get(empId);
    if (!emp || !asBoolean(emp.Ativo)) continue;
    const sorted = rows.sort(compareRecordsByDateTime);
    const hasEntry = sorted.some((r) => r.TipoMarcacao === "ENTRADA");
    const hasExit = sorted.some((r) => r.TipoMarcacao === "SAIDA_FINAL");
    if (hasEntry && !hasExit) {
      const entry = sorted.find((r) => r.TipoMarcacao === "ENTRADA");
      const last = sorted[sorted.length - 1];
      const sched = scheduleFor(schedules, empId, date);
      let suggestedExit = "23:00";
      if (sched?.HoraSaida) {
        suggestedExit = String(sched.HoraSaida).slice(0, 5);
      } else if (entry?.DataHora) {
        const entryDate = new Date(entry.DataHora);
        const dailyMinutes =
          Number(sched?.CargaDiariaMinutos || 440) +
          Number(sched?.DuracaoIntervaloMinutos || 60);
        entryDate.setMinutes(entryDate.getMinutes() + dailyMinutes);
        suggestedExit = `${String(entryDate.getHours()).padStart(2, "0")}:${String(
          entryDate.getMinutes(),
        ).padStart(2, "0")}`;
      }
      incomplete.push({
        FuncionarioID: emp.FuncionarioID,
        NomeFuncionario: emp.Nome,
        LojaID: emp.LojaID || "",
        NomeLoja: emp.NomeLoja || "",
        Data: date,
        DataBR: date.split("-").reverse().join("/"),
        EntradaDataHora: entry.DataHora,
        EntradaTexto: timeValue(entry.DataHora),
        UltimaMarcacao: last.TipoMarcacao,
        UltimaMarcacaoTexto: timeValue(last.DataHora),
        HorarioSugeridoSaida: suggestedExit,
        SugestaoDataHora: `${date}T${suggestedExit}:00`,
      });
    }
  }
  return incomplete.sort((a, b) => b.Data.localeCompare(a.Data));
};

export {
  accumulatedHourBalance,
  balanceDays,
  clockContext,
  dayBalanceState,
  dayMetrics,
  firstPunchDatesByEmployee,
  operationalDayFor,
  scheduleExpectedMinutes,
};

