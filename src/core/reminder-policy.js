// Pure scheduling policy shared by the sender and tests. Bahia uses UTC−03.
const minute = 60000;
const dayMs = 86400000;
export const active = (value) =>
  value === true ||
  value === 1 ||
  ["true", "1", "sim", "yes"].includes(String(value || "").toLowerCase());
export const bahiaDay = (timestamp) =>
  new Date(timestamp - 3 * 3600000).toISOString().slice(0, 10);
export const shiftDate = (day, delta) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + delta * dayMs)
    .toISOString()
    .slice(0, 10);
const clock = (value) => {
  const m = String(value || "").match(/(?:^|T|\s)(\d{1,2}):(\d{2})/);
  return m && +m[1] < 24 && +m[2] < 60
    ? `${m[1].padStart(2, "0")}:${m[2]}`
    : null;
};
const at = (day, time) =>
  clock(time) ? Date.parse(`${day}T${clock(time)}:00-03:00`) : NaN;
export const scheduleForDay = (schedules, id, day) =>
  schedules
    .filter(
      (s) =>
        String(s.FuncionarioID) === String(id) &&
        active(s.Ativa) &&
        (!s.VigenteDe || s.VigenteDe.slice(0, 10) <= day) &&
        (!s.VigenteAte || s.VigenteAte.slice(0, 10) >= day),
    )
    .sort((a, b) =>
      String(b.VigenteDe || "").localeCompare(String(a.VigenteDe || "")),
    )[0];
export function workday(employee, schedule, day, timeOff) {
  const offs = timeOff.filter(
    (o) =>
      String(o.FuncionarioID) === String(employee.FuncionarioID) &&
      ["Aprovada", "Concluída"].includes(o.Status),
  );
  // Partial-day leave is deliberately not guessed: suppress the scheduled reminder.
  if (
    offs.some(
      (o) =>
        (o.DataInicio || "").slice(0, 10) <= day &&
        (o.DataFim || o.DataInicio || "").slice(0, 10) >= day,
    )
  )
    return false;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const names = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  const fixed = [
    employee.DiaFolgaPreferencial,
    employee.SegundoDiaFolgaPreferencial,
  ]
    .filter(Boolean)
    .map((s) =>
      names.indexOf(
        String(s)
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .slice(0, 3),
      ),
    )
    .filter((n) => n >= 0);
  return fixed.length
    ? !fixed.includes(weekday)
    : String(schedule.DiasTrabalho || "1,2,3,4,5,6")
        .split(/[,;|\s]+/)
        .map(Number)
        .includes(weekday);
}
export function remindersFor({
  employee,
  schedules = [],
  records = [],
  timeOff = [],
  now = Date.now(),
  preferences = { clock: true, interval: true },
}) {
  if (!employee || !active(employee.Ativo)) return [];
  const result = [],
    today = bahiaDay(now);
  for (const day of [shiftDate(today, -1), today]) {
    const schedule = scheduleForDay(schedules, employee.FuncionarioID, day);
    if (!schedule) continue;
    const rows = records
      .filter(
        (r) =>
          String(r.FuncionarioID) === String(employee.FuncionarioID) &&
          r.Status !== "Substituído" &&
          String(r.Data || "").slice(0, 10) === day,
      )
      .sort((a, b) => Date.parse(a.DataHora) - Date.parse(b.DataHora));
    const last = rows.at(-1),
      types = new Set(rows.map((r) => r.TipoMarcacao));
    if (types.has("SAIDA_FINAL")) continue;
    const add = (kind, due, body, event = "", expires = due + 2 * minute) => {
      if (!Number.isFinite(due) || now < due || now >= expires) return;
      result.push({
        key: `${employee.FuncionarioID}:${day}:${kind}:${event}`,
        due,
        expires,
        title: "House 190 · Seu ponto",
        body,
        view: "timeclock",
        tag: `ponto-${kind}`,
      });
    };
    const start = at(day, schedule.HoraEntrada);
    let end = at(day, schedule.HoraSaida);
    if (end <= start) end += dayMs;
    if (preferences.clock && workday(employee, schedule, day, timeOff)) {
      if (!types.has("ENTRADA"))
        add(
          "entrada",
          start,
          `Seu turno começa às ${clock(schedule.HoraEntrada)}. Lembre-se de registrar a entrada.`,
        );
      if (types.has("ENTRADA") && last?.TipoMarcacao !== "SAIDA_INTERVALO")
        add(
          "saida",
          end,
          `Seu turno está previsto para terminar às ${clock(schedule.HoraSaida)}. Ao encerrar, registre a saída.`,
        );
    }
    // Break reminders follow the latest actual break, including shifts past midnight.
    if (preferences.interval && last?.TipoMarcacao === "SAIDA_INTERVALO") {
      const duration = Number(schedule.DuracaoIntervaloMinutos);
      if (!(duration > 0 && duration <= 240)) continue;
      const returnedAt = Date.parse(last.DataHora) + duration * minute;
      const id = last.RegistroPontoID || last.DataHora;
      if (duration >= 5) {
        const remaining = Math.max(1, Math.ceil((returnedAt - now) / minute));
        add(
          "intervalo-5",
          returnedAt - 5 * minute,
          `Falta${remaining === 1 ? "" : "m"} ${remaining} minuto${remaining === 1 ? "" : "s"} para encerrar seu intervalo. Prepare-se para registrar o retorno.`,
          id,
          returnedAt,
        );
      }
      add(
        "intervalo-fim",
        returnedAt,
        "Seu intervalo terminou. Lembre-se de registrar o retorno ao trabalho.",
        id,
      );
    }
  }
  return result;
}
