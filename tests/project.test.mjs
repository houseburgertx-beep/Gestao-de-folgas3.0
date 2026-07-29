import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApi } from "../src/core/api.js";
import { nextTimeOffSummary } from "../src/core/api-advanced.js";
import { timeOffBalanceUnits } from "../src/core/api-base.js";
import { periodFieldsFor } from "../src/core/runtime.js";
import {
  balanceDays,
  dayBalanceState,
  dayMetrics,
  firstPunchDatesByEmployee,
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

test("o aplicativo possui manifesto, ícones e service worker seguros", async () => {
  const [manifest, serviceWorker, pwa, interfaceHtml, client, appleIcon] =
    await Promise.all([
      readFile(
        new URL("../public/manifest.webmanifest", import.meta.url),
        "utf8",
      ).then(JSON.parse),
      readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
      readFile(new URL("../src/pwa.js", import.meta.url), "utf8"),
      readFile(new URL("../src/legacy/Index.html", import.meta.url), "utf8"),
      readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
      readFile(
        new URL("../public/apple-touch-icon-6.1.5.png", import.meta.url),
      ),
    ]);

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./?source=pwa&v=6.1.5");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "180x180"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  assert.ok(
    manifest.icons.some(
      (icon) =>
        icon.src === "./icons/app-icon-maskable-512.png" &&
        icon.purpose === "maskable",
    ),
  );
  assert.match(serviceWorker, /house-folgas-v6\.1\.5/);
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(serviceWorker, /firebaseio|googleapis/);
  assert.match(pwa, /navigator\.serviceWorker\.register\("\.\/sw\.js"/);
  assert.match(
    interfaceHtml,
    /rel="manifest" href="\.\/manifest\.webmanifest\?v=6\.1\.5"/,
  );
  assert.match(interfaceHtml, /apple-mobile-web-app-capable/);
  assert.match(interfaceHtml, /rel="apple-touch-icon"/);
  assert.match(interfaceHtml, /apple-touch-icon-6\.1\.5\.png/);
  assert.equal(appleIcon.readUInt32BE(16), 180);
  assert.equal(appleIcon.readUInt32BE(20), 180);
  assert.match(client, /beforeinstallprompt/);
  assert.match(client, /No iPhone, instale pelo Safari/);
  assert.match(client, /Não use o Chrome para adicionar o aplicativo/);
  assert.match(client, /house-pwa-install-notice-seen-v1/);
  assert.match(client, /localStorage\.setItem\(INSTALL_NOTICE_KEY, "1"\)/);
  assert.match(client, /icons\/app-icon-192\.png/);
  assert.match(client, /prompt\.prompt\(\)/);
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

test("login recupera a loja pelo cadastro do funcionário sem alterar o acesso", async () => {
  const runtime = await readFile(
    new URL("../src/core/runtime.js", import.meta.url),
    "utf8",
  );
  assert.match(
    runtime,
    /this\.appRef\("tables\/Funcionarios"\)[\s\S]*?orderByChild\("FuncionarioID"\)[\s\S]*?equalTo\(profile\.FuncionarioID\)/,
  );
  assert.match(
    runtime,
    /LojaID: profile\.LojaID \|\| employee\.LojaID \|\| ""/,
  );
  assert.match(
    runtime,
    /table === "Lojas" && storeId && !isEmployeeProfile\(profile\)/,
  );
  assert.doesNotMatch(
    runtime,
    /saveAccess\([^)]*profile\.FuncionarioID[\s\S]*?employee\.LojaID/,
  );
});

test("registros antigos conservam a chave física ao serem atualizados", async () => {
  const runtime = await readFile(
    new URL("../src/core/runtime.js", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /recordsFromSnapshot\(table, snapshot\)/);
  assert.match(
    runtime,
    /this\.recordKeys\.set\(this\.recordCacheKey\(table, id\), key\)/,
  );
  assert.match(runtime, /async resolveStorageKey\(table, id\)/);
  assert.match(
    runtime,
    /const storageKey = await this\.resolveStorageKey\(table, id\);[\s\S]*?tables\/\$\{table\}\/\$\{storageKey\}/,
  );
});

test("selecionar funcionário preenche a loja no pedido de folga", async () => {
  const client = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  assert.match(
    client,
    /\$\("#timeOffEmployee"\)\.onchange = \(\) => \{[\s\S]*?val\(employee, "LojaID", "lojaId"\)[\s\S]*?\$\("#timeOffStore"\)\.value = storeId;/,
  );
  assert.match(
    client,
    /employeeStoreId \|\|[\s\S]*?idOf\(matchedEmployeeStore, "Loja"\)/,
  );
});

test("ícone da House Arena usa a cor do menu desde o carregamento inicial", async () => {
  const styles = await readFile(
    new URL("../src/legacy/Styles.html", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /\.sidebar \.nav-item > \.arena-nav-icon svg \{[\s\S]*?fill: none;[\s\S]*?stroke: currentColor;/,
  );
  assert.match(
    styles,
    /\.sidebar \.nav-item > \.arena-nav-icon circle \{[\s\S]*?fill: currentColor;/,
  );
});

test("notificações exibem o texto completo com campos compatíveis", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Styles.html", import.meta.url), "utf8"),
  ]);
  assert.match(client, /function notificationMessage_\(notification\)/);
  assert.match(client, /function notificationPlainText_\(value\)/);
  assert.match(client, /template\.content\.textContent/);
  assert.match(client, /function normalizeLegacyNotificationTimes_\(value\)/);
  assert.match(client, /1899-12-30\[T\\s\]/);
  assert.match(
    client,
    /"Mensagem",[\s\S]*?"mensagem",[\s\S]*?"Texto",[\s\S]*?"Corpo"/,
  );
  assert.match(client, /class="notification-message"/);
  assert.match(
    styles,
    /\.notification-item \.notification-message \{[\s\S]*?white-space: pre-wrap;[\s\S]*?overflow-wrap: anywhere;/,
  );
});

test("saldo de folgas conta somente folgas e respeita períodos parciais", () => {
  assert.equal(
    timeOffBalanceUnits({
      TipoFolga: "Folga",
      Periodo: "Dia inteiro",
      DataInicio: "2026-08-10",
      DataFim: "2026-08-10",
    }),
    1,
  );
  assert.equal(
    timeOffBalanceUnits({
      TipoFolga: "Folga",
      Periodo: "Dia inteiro",
      DataInicio: "2026-08-10",
      DataFim: "2026-08-12",
    }),
    3,
  );
  assert.equal(
    timeOffBalanceUnits({
      TipoFolga: "Meia folga",
      Periodo: "Manhã",
      DataInicio: "2026-08-10",
      DataFim: "2026-08-10",
    }),
    0.5,
  );
  assert.equal(
    timeOffBalanceUnits({
      TipoFolga: "Férias",
      Periodo: "Dia inteiro",
      DataInicio: "2026-08-10",
      DataFim: "2026-08-20",
    }),
    0,
  );
});

test("crédito mensal e débito de aprovação são idempotentes", async () => {
  const [api, runtime] = await Promise.all([
    readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8"),
    readFile(new URL("../src/core/runtime.js", import.meta.url), "utf8"),
  ]);
  assert.match(api, /`credito-mensal-\$\{employee\.FuncionarioID\}-\$\{month\}`/);
  assert.match(api, /`folga-\$\{record\.FolgaID\}`/);
  assert.match(api, /desiredDelta: approved \? -units : 0/);
  assert.match(api, /await reconcileTimeOffBalance\(updated, profile\)/);
  assert.match(api, /await reconcileTimeOffBalance\(saved, profile\)/);
  assert.match(runtime, /SaldoFolgasLancamentos/);
  assert.match(runtime, /normalizedDesired - previousDelta/);
  assert.match(runtime, /SaldoFolgas: balanceAfter/);
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

test("saldo de horas começa somente na primeira marcação do funcionário", () => {
  const starts = firstPunchDatesByEmployee([
    {
      FuncionarioID: "leticia",
      Data: "2026-07-01",
      TipoMarcacao: "ENTRADA",
      Status: "Substituído",
    },
    {
      FuncionarioID: "leticia",
      Data: "2026-07-15",
      TipoMarcacao: "SAIDA_FINAL",
      Status: "Válido",
    },
    {
      FuncionarioID: "leticia",
      DataHora: "2026-07-12T08:00:00-03:00",
      TipoMarcacao: "ENTRADA",
      Status: "Válido",
    },
  ]);

  assert.equal(starts.get("leticia"), "2026-07-12");
  assert.equal(starts.has("sem-marcacao"), false);
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
  assert.match(rules, /newData\.child\('TipoMarcacao'\)\.val\(\) === 'SEM_DESCANSO'/);
  assert.doesNotMatch(
    rules,
    /\$table === 'ArenaRanking' && newData\.child\('UsuarioID'\)/,
  );
  assert.match(
    rules,
    /\$table === 'EnquetesVotos'[\s\S]*?\$record === newData\.child\('VotoID'\)\.val\(\)/,
  );
  assert.match(
    rules,
    /\$table === 'Comunicados' \|\| \$table === 'Enquetes'\)[\s\S]*?query\.orderByChild === 'LojaID'/,
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

test("ponto duplicado usa a última saída final válida", () => {
  const metrics = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-07-20T08:00:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-07-20T17:00:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-07-20T18:00:00-03:00" },
    ],
    { CargaDiariaMinutos: 480 },
  );
  assert.equal(metrics.worked, 600);
  assert.equal(metrics.balance, 120);
});

test("troca de folga exige duas folgas e é aplicada atomicamente", async () => {
  const [api, client, dialogs] = await Promise.all([
    readFile(new URL("../src/core/api-advanced.js", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8"),
  ]);
  assert.match(dialogs, /id="swapDestinationTimeOff"/);
  assert.match(client, /FolgaDestinoID: \$\("#swapDestinationTimeOff"\)\.value/);
  assert.match(api, /FolgaDestinoOriginalID: destinationTimeOff\.FolgaID/);
  assert.match(api, /await runtime\.patchMany\(\[/);
  assert.match(api, /Status: "Aprovada"[\s\S]*?Troca aprovada e aplicada/);
});

test("redefinição de senha existente usa link e preserva o e-mail vinculado", async () => {
  const [api, client, dialogs] = await Promise.all([
    readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8"),
  ]);
  assert.match(dialogs, /id="accessSendReset"/);
  assert.match(client, /\$\("#accessEmail"\)\.readOnly = !!user/);
  assert.match(api, /Email: normalizeEmail\(current\.Email\)/);
  assert.match(api, /runtime\.sendPasswordReset\(current\.Email\)/);
  assert.match(api, /Altere o e-mail e a senha em etapas separadas/);
});

test("dashboard não desconta folgas aprovadas ou folgas fixas", () => {
  const counted = balanceDays([
    { saldoMinutos: 90, folga: false, folgaFixa: false },
    { saldoMinutos: -420, folga: false, folgaFixa: true },
    { saldoMinutos: -420, folga: true, folgaFixa: false },
    {
      saldoMinutos: -240,
      folga: false,
      folgaFixa: false,
      saldoPendente: true,
    },
  ]);
  assert.equal(
    counted.reduce((total, item) => total + item.saldoMinutos, 0),
    90,
  );
});

test("dia atual só entra no saldo depois da saída final", () => {
  const schedule = { CargaDiariaMinutos: 240 };
  const notStarted = dayBalanceState(
    "2026-07-29",
    dayMetrics([], schedule),
    "2026-07-29",
  );
  const started = dayBalanceState(
    "2026-07-29",
    dayMetrics(
      [
        {
          TipoMarcacao: "ENTRADA",
          DataHora: "2026-07-29T08:00:00-03:00",
        },
      ],
      schedule,
    ),
    "2026-07-29",
  );
  const completed = dayBalanceState(
    "2026-07-29",
    dayMetrics(
      [
        {
          TipoMarcacao: "ENTRADA",
          DataHora: "2026-07-29T08:00:00-03:00",
        },
        {
          TipoMarcacao: "SAIDA_FINAL",
          DataHora: "2026-07-29T12:00:00-03:00",
        },
      ],
      schedule,
    ),
    "2026-07-29",
  );

  assert.deepEqual(notStarted, { pending: true, minutes: 0, text: "—" });
  assert.deepEqual(started, { pending: true, minutes: 0, text: "—" });
  assert.deepEqual(completed, {
    pending: false,
    minutes: 0,
    text: "+0h 00min",
  });
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
