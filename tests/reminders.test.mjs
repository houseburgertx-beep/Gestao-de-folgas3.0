import test from "node:test";
import assert from "node:assert/strict";
import { remindersFor, bahiaDay } from "../src/core/reminder-policy.js";
const employee = { FuncionarioID: "f1", Ativo: true, LojaID: "l1" };
const schedule = {
  FuncionarioID: "f1",
  Ativa: true,
  HoraEntrada: "16:00",
  HoraSaida: "00:00",
  DuracaoIntervaloMinutos: 60,
  DiasTrabalho: "0,1,2,3,4,5,6",
};
const timestamp = (time) => Date.parse(`2026-09-06T${time}:00-03:00`);
const record = (type, time, id = type, day = "2026-09-06") => ({
  FuncionarioID: "f1",
  TipoMarcacao: type,
  Data: day,
  DataHora: `${day}T${time}:00-03:00`,
  RegistroPontoID: id,
  Status: "Válido",
});
const run = (time, extra = {}) =>
  remindersFor({
    employee,
    schedules: [schedule],
    now: timestamp(time),
    ...extra,
  });
test("lembra entrada somente na janela da jornada e antes de bater ponto", () => {
  assert.equal(run("15:59").length, 0);
  assert.match(run("16:00")[0].body, /registrar a entrada/);
  assert.equal(
    run("16:00", { records: [record("ENTRADA", "15:59")] }).length,
    0,
  );
  assert.equal(run("16:02").length, 0);
});
test("intervalo usa batida real e duração cadastrada; avisa 5 minutos antes", () => {
  const records = [
    record("ENTRADA", "16:00"),
    record("SAIDA_INTERVALO", "18:03"),
  ];
  assert.equal(run("18:57", { records }).length, 0);
  assert.match(run("18:58", { records })[0].body, /Faltam 5 minutos/);
  assert.match(run("19:00", { records })[0].body, /Faltam 3 minutos/);
  assert.match(run("19:03", { records })[0].body, /intervalo terminou/);
  assert.equal(run("19:05", { records }).length, 0);
});
test("retorno antecipado, saída final e intervalo sem duração cancelam avisos", () => {
  const rows = [record("SAIDA_INTERVALO", "18:03")];
  for (const type of ["RETORNO_INTERVALO", "SAIDA_FINAL"])
    assert.equal(
      run("18:58", { records: [...rows, record(type, "18:50")] }).length,
      0,
    );
  assert.equal(
    run("18:58", {
      records: rows,
      schedules: [{ ...schedule, DuracaoIntervaloMinutos: 0 }],
    }).length,
    0,
  );
});
test("respeita folga aprovada, folga fixa, dias de trabalho e desativação", () => {
  assert.equal(
    run("16:00", {
      timeOff: [
        { FuncionarioID: "f1", Status: "Aprovada", DataInicio: "2026-09-06" },
      ],
    }).length,
    0,
  );
  assert.equal(
    run("16:00", { employee: { ...employee, DiaFolgaPreferencial: "Domingo" } })
      .length,
    0,
  );
  assert.equal(
    run("16:00", { schedules: [{ ...schedule, DiasTrabalho: "1,2,3,4,5" }] })
      .length,
    0,
  );
  assert.equal(
    run("16:00", { employee: { ...employee, Ativo: false } }).length,
    0,
  );
  assert.equal(run("16:00", { schedules: [] }).length, 0);
});
test("intervalo e saída continuam funcionando depois da meia-noite", () => {
  const records = [
    record("ENTRADA", "16:00", "entry", "2026-09-05"),
    record("SAIDA_INTERVALO", "23:30", "break", "2026-09-05"),
  ];
  assert.match(run("00:25", { records })[0].body, /Faltam 5 minutos/);
  assert.match(run("00:30", { records })[0].body, /intervalo terminou/);
  assert.match(
    run("00:00", { records: [records[0]] })[0].body,
    /registre a saída/,
  );
  assert.equal(bahiaDay(Date.parse("2026-09-07T01:00:00Z")), "2026-09-06");
});
test("preferências, substituições e isolamento de funcionário são respeitados", () => {
  assert.equal(
    run("16:00", { preferences: { clock: false, interval: false } }).length,
    0,
  );
  assert.equal(
    run("18:58", {
      records: [
        { ...record("SAIDA_INTERVALO", "18:03"), FuncionarioID: "other" },
      ],
    }).length,
    0,
  );
  assert.equal(
    run("18:58", {
      records: [
        { ...record("SAIDA_INTERVALO", "18:03"), Status: "Substituído" },
      ],
    }).length,
    0,
  );
});
test("chaves não mudam a cada minuto e diferenciam novo intervalo", () => {
  const records = [record("SAIDA_INTERVALO", "18:03")];
  assert.equal(
    run("18:58", { records })[0].key,
    run("18:59", { records })[0].key,
  );
  assert.notEqual(
    run("18:58", { records })[0].key,
    run("18:58", { records: [record("SAIDA_INTERVALO", "18:03", "novo")] })[0]
      .key,
  );
});
test("jornada vigente prevalece e jornada futura não dispara", () => {
  assert.equal(
    run("16:00", { schedules: [{ ...schedule, VigenteDe: "2026-09-07" }] })
      .length,
    0,
  );
  assert.equal(
    run("16:00", {
      schedules: [
        schedule,
        { ...schedule, VigenteDe: "2026-09-01", HoraEntrada: "17:00" },
      ],
    }).length,
    0,
  );
});
