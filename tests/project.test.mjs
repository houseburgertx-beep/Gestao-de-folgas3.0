import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApi } from "../src/core/api.js";
import { nextTimeOffSummary } from "../src/core/api-advanced.js";
import { periodFieldsFor } from "../src/core/runtime.js";
import {
  balanceDays,
  dayMetrics,
  operationalDayFor,
  scheduleExpectedMinutes,
} from "../src/core/api-clock.js";
import {
  dateRange,
  haversineMeters,
  minutesText,
  todayIso,
} from "../src/core/utils.js";

test("a API cobre todas as funções declaradas pela interface", async () => {
  const source = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  const block = source.match(/const FN = \{([\s\S]*?)\n  \};/)?.[1] || "";
  const declared = [...block.matchAll(/:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)].map(
    (match) => match[1],
  );
  const handlers = createApi(() => ({})).handlers;
  const missing = declared.filter((name) => typeof handlers[name] !== "function");
  assert.deepEqual(missing, []);
  assert.ok(Object.keys(handlers).length >= 90);
});

test("o JavaScript legado possui sintaxe válida", async () => {
  const source = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  const javascript = source
    .replace(/^\s*<script>\s*/, "")
    .replace(/\s*<\/script>\s*$/, "");
  assert.doesNotThrow(() => new Function(javascript));
});

test("as regras do Realtime Database são JSON válido e começam bloqueadas", async () => {
  const rules = JSON.parse(
    await readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
  );
  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  assert.ok(rules.rules["gestao-folgas"].v2.access);
  assert.ok(rules.rules["gestao-folgas"].v2.tables);
});

test("registros de ponto recebem índices mensais de acesso", () => {
  assert.deepEqual(
    periodFieldsFor("RegistrosPonto", {
      Data: "2026-07-28",
      FuncionarioID: "func-1",
      LojaID: "loja-1",
    }),
    {
      PeriodoChave: "2026-07",
    },
  );
  assert.deepEqual(periodFieldsFor("Funcionarios", { Data: "2026-07-28" }), {});
});

test("ponto consulta somente os meses necessários", async () => {
  const runtime = await readFile(
    new URL("../src/core/runtime.js", import.meta.url),
    "utf8",
  );
  const clock = await readFile(
    new URL("../src/core/api-clock.js", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /async listPeriods\(table, periods/);
  assert.match(runtime, /timeClockPeriodIndexesV1/);
  assert.match(
    runtime,
    /if \(!isAdminProfile\(profile\)\) \{\s*return this\.list\(table, \{ profile \}\);/,
  );
  assert.match(clock, /listPeriods\("RegistrosPonto", \[\.\.\.recordPeriods\]/);
  assert.match(
    clock,
    /listPeriods\([\s\S]*?"RegistrosPonto"[\s\S]*?previousDateKey\(todayIso\(\)\)/,
  );
});

test("login continua se a gravação do último acesso for negada", async () => {
  const runtime = await readFile(
    new URL("../src/core/runtime.js", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /const isPermissionDenied = \(error\)/);
  assert.match(
    runtime,
    /try \{[\s\S]*?UltimoAcesso: nowIso\(\)[\s\S]*?if \(!isPermissionDenied\(error\)\) throw error;/,
  );
  assert.doesNotMatch(
    runtime,
    /update\(this\.appRef\(`access\/\$\{pathKey\(credential\.user\.uid\)\}`\), \{\s*FotoPerfil:/,
  );
});

test("o index preserva a interface sem marcação de template do Apps Script", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /Gestão de Folgas/);
  assert.match(html, /src\/main\.js/);
  assert.doesNotMatch(html, /<\?(?:=|!=)/);
  assert.match(html, /id="view-timeclock"/);
  assert.match(html, /id="view-house-arena"/);
});

test("utilitários de data, duração e geolocalização", () => {
  assert.equal(todayIso(new Date(2026, 6, 28, 12)), "2026-07-28");
  assert.deepEqual(dateRange("2026-07-28", "2026-07-30"), [
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
  ]);
  assert.equal(minutesText(125), "2h 05min");
  assert.equal(Math.round(haversineMeters(-3.73, -38.52, -3.73, -38.52)), 0);
});

test("registro de ponto usa localização sem capturar selfie", async () => {
  const client = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  const api = await readFile(
    new URL("../src/core/api-clock.js", import.meta.url),
    "utf8",
  );
  const interfaceHtml = await readFile(
    new URL("../src/legacy/Index.html", import.meta.url),
    "utf8",
  );
  assert.match(client, /enableHighAccuracy:\s*true/);
  assert.match(client, /latitude:\s*pos\.coords\.latitude/);
  assert.match(client, /longitude:\s*pos\.coords\.longitude/);
  assert.match(api, /Aplicação web · localização/);
  assert.doesNotMatch(client, /selfie/i);
  assert.doesNotMatch(api, /SelfieData|SelfieMimeType|selfieDataUrl/i);
  assert.doesNotMatch(interfaceHtml, /selfie/i);
});

test("dashboard do funcionário inicia o carregamento rápido do ponto", async () => {
  const client = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  assert.match(
    client,
    /function scheduleSecondaryLoads_\(\)[\s\S]*?if \(isEmployee\(\)\) loadTimeClockQuick_\(\);/,
  );
  assert.match(
    client,
    /if \(CLOCK_QUICK_PROMISE_\) return CLOCK_QUICK_PROMISE_;/,
  );
});

test("turno aberto continua no mesmo dia operacional depois da meia-noite", () => {
  const employeeId = "ana";
  const schedule = {
    JornadaID: "jornada-ana",
    FuncionarioID: employeeId,
    Ativa: true,
    VigenteDe: "2026-07-01",
  };
  const openRecords = [
    {
      FuncionarioID: employeeId,
      Data: "2026-07-28",
      TipoMarcacao: "ENTRADA",
      DataHora: "2026-07-28T23:00:00-03:00",
      Status: "Válido",
    },
  ];
  assert.equal(
    operationalDayFor(
      openRecords,
      [schedule],
      employeeId,
      new Date("2026-07-29T01:30:00-03:00"),
    ),
    "2026-07-28",
  );
  assert.equal(
    operationalDayFor(
      [
        ...openRecords,
        {
          FuncionarioID: employeeId,
          Data: "2026-07-28",
          TipoMarcacao: "SAIDA_FINAL",
          DataHora: "2026-07-29T01:20:00-03:00",
          Status: "Válido",
        },
      ],
      [schedule],
      employeeId,
      new Date("2026-07-29T01:30:00-03:00"),
    ),
    "2026-07-29",
  );
});

test("foto de perfil e envio de documentos não aparecem na interface", async () => {
  const [interfaceHtml, dialogs, client, advancedApi] = await Promise.all([
    readFile(new URL("../src/legacy/Index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/core/api-advanced.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(interfaceHtml, /documentForm|documentFile/i);
  assert.doesNotMatch(dialogs, /profilePhoto|Escolher foto/i);
  assert.doesNotMatch(client, /submitDocument_|readDocumentUpload_/i);
  assert.match(advancedApi, /O envio de documentos foi desativado/);
});

test("regras restringem ponto ao próprio funcionário e a uma criação idempotente", async () => {
  const rules = await readFile(
    new URL("../database.rules.json", import.meta.url),
    "utf8",
  );
  assert.match(rules, /\$table === 'RegistrosPonto' && !data\.exists\(\)/);
  assert.match(
    rules,
    /newData\.child\('RegistroPontoID'\)\.val\(\) === newData\.child\('RequestID'\)\.val\(\)/,
  );
  assert.doesNotMatch(
    rules,
    /\$table === 'Documentos'[\s\S]*newData\.child\('FuncionarioID'\)/,
  );
});

test("banco de horas usa a jornada líquida e arredonda apenas o total", () => {
  const schedule = {
    HoraEntrada: "1899-12-30T18:34:04.000Z",
    HoraSaida: "1899-12-30T02:34:04.000Z",
    DuracaoIntervaloMinutos: 60,
    CargaDiariaMinutos: 480,
  };
  assert.equal(scheduleExpectedMinutes(schedule), 420);

  const metrics = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-07-20T19:15:14.049Z" },
      {
        TipoMarcacao: "SAIDA_INTERVALO",
        DataHora: "2026-07-21T02:05:58.264Z",
      },
      {
        TipoMarcacao: "RETORNO_INTERVALO",
        DataHora: "2026-07-21T02:07:19.519Z",
      },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-07-21T03:11:17.612Z" },
    ],
    schedule,
  );
  assert.equal(Math.round(metrics.worked), 475);
  assert.equal(Math.round(metrics.balance), 55);
});

test("dashboard não desconta folgas aprovadas ou folgas fixas", () => {
  const counted = balanceDays([
    { saldoMinutos: 90, folga: false, folgaFixa: false },
    { saldoMinutos: -420, folga: false, folgaFixa: true },
    { saldoMinutos: -420, folga: true, folgaFixa: false },
  ]);
  assert.equal(
    counted.reduce((total, item) => total + item.saldoMinutos, 0),
    90,
  );
});

test("próxima folga mostra apenas a aprovada com dias e data", () => {
  const employeeId = "ana";
  const result = nextTimeOffSummary(
    [
      {
        FuncionarioID: employeeId,
        Status: "Pendente",
        DataInicio: "2026-09-07T03:00:00.000Z",
      },
      {
        FuncionarioID: employeeId,
        Status: "Aprovada",
        DataInicio: "2026-09-11T03:00:00.000Z",
      },
    ],
    employeeId,
    "2026-07-28",
  );
  assert.equal(result.dias, 46);
  assert.equal(result.diaSemana, "Sexta");
  assert.equal(result.data, "2026-09-11");
});
