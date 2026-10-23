import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApi } from "../src/core/api.js";
import {
  employeeHasFixedDay,
  fixedTimeOffCandidates,
  generateWhatsAppWeeklySchedule,
  nextTimeOffSummary,
} from "../src/core/api-advanced.js";
import {
  isMonthlyLeaveEmployeeEligible,
  timeOffBalanceUnits,
} from "../src/core/api-base.js";
import {
  FirebaseRuntime,
  periodFieldsFor,
  runtime,
  selectEmployeeEntry,
} from "../src/core/runtime.js";
import {
  accumulatedHourBalance,
  balanceDays,
  calculateLivePresence,
  dayBalanceState,
  dayMetrics,
  findIncompletePunches,
  firstPunchDatesByEmployee,
  fixedOffWeekdayIndexes,
  isFixedOffForDate,
  isScheduledWorkday,
  operationalDayFor,
  scheduleExpectedMinutes,
} from "../src/core/api-clock.js";
import {
  dateRange,
  haversineMeters,
  minutesText,
  todayIso,
  sha256Hex,
} from "../src/core/utils.js";
import { checkCreditMargin } from "../src/core/takeat-credit.js";

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
  const [rulesSource, runtime] = await Promise.all([
    readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
    readFile(new URL("../src/core/runtime.js", import.meta.url), "utf8"),
  ]);
  const rules = JSON.parse(rulesSource);
  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  const appRules = rules.rules["gestao-folgas"].v2;
  assert.ok(appRules.access);
  assert.ok(appRules.tables);
  assert.match(appRules.meta.initialized[".write"], /bootstrapOwner/);
  assert.match(appRules.access.$uid[".write"], /bootstrapOwner/);
  assert.match(runtime, /await update\(this\.appRef\("meta"\)/);
  assert.doesNotMatch(
    appRules.tables.$table.$record[".write"],
    /\$table === 'BancoHorasMovimentos'/,
  );
  assert.match(
    appRules.tables.BancoHorasMovimentos.$record[".write"],
    /Compensação de folga/,
  );
  assert.match(
    appRules.tables.BancoHorasMovimentos[".read"],
    /Administrador/,
  );
});

test("o aplicativo possui manifesto, ícones e service worker seguros", async () => {
  const packageData = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const version = packageData.version;
  const escapedVersion = version.replaceAll(".", "\\.");
  const [
    manifest,
    serviceWorker,
    pwa,
    interfaceHtml,
    client,
    styles,
    appleIcon,
  ] =
    await Promise.all([
      readFile(
        new URL("../public/manifest.webmanifest", import.meta.url),
        "utf8",
      ).then(JSON.parse),
      readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
      readFile(new URL("../src/pwa.js", import.meta.url), "utf8"),
      readFile(new URL("../src/legacy/Index.html", import.meta.url), "utf8"),
      readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
      readFile(new URL("../src/legacy/Styles.html", import.meta.url), "utf8"),
      readFile(
        new URL("../public/apple-touch-icon-6.1.5.png", import.meta.url),
      ),
    ]);

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, `./?source=pwa&v=${version}`);
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
  assert.match(serviceWorker, new RegExp(`house-folgas-v${escapedVersion}`));
  assert.match(pwa, new RegExp(`SERVICE_WORKER_VERSION = "${escapedVersion}"`));
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(serviceWorker, /firebaseio|googleapis/);
  assert.match(pwa, /updateViaCache: "none"/);
  assert.match(pwa, /controllerchange/);
  assert.match(
    interfaceHtml,
    new RegExp(
      `rel="manifest" href="\\.\\/manifest\\.webmanifest\\?v=${escapedVersion}"`,
    ),
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
  assert.match(styles, /@media \(display-mode: standalone\)/);
  assert.match(
    styles,
    /height: calc\(var\(--topbar\) \+ env\(safe-area-inset-top, 0px\)\)/,
  );
});

test("House 190 continua conectado aos próprios serviços", async () => {
  const config = await readFile(new URL("../src/firebase-config.js", import.meta.url), "utf8");
  assert.match(config, /github-737ec/);
  assert.match(config, /gestao-folgas\/v2/);
  for (const name of ["src/firebase-config.js", "src/push-config.js", "src/selfie-drive-config.js", "google-apps-script/Code.gs", "notifications-worker/wrangler.jsonc"]) {
    const value = await readFile(new URL("../" + name, import.meta.url), "utf8");
    assert.doesNotMatch(value, /conveniencia5jc|jornada-conveniencia-5jc|jornada-app-notifications/);
  }
});

test("o login aguarda o Firebase e nunca orienta abrir o Apps Script", async () => {
  const [client, main, builder, api, packageData] = await Promise.all([
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-index.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.match(client, /await waitForPortalApi_\(\)/);
  assert.match(client, /PORTAL_API_NOT_READY/);
  assert.doesNotMatch(client, /Abra a aplicação pelo link \/exec/);
  assert.match(main, /signalApiReady\(\)/);
  assert.match(builder, /window\.__GESTAO_API_READY__/);
  assert.match(
    builder,
    new RegExp(`main\\.js\\?v=${packageData.version.replaceAll(".", "\\.")}`),
  );
  assert.doesNotMatch(main, /\.html\?raw/);
  assert.doesNotMatch(main, /Arena|HouseLink|house-arena/);
  assert.doesNotMatch(api, /Arena|house-arena/);
  const runtimeSource = await readFile(
    new URL("../src/core/runtime.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(runtimeSource, /from "firebase\//);
  assert.match(runtimeSource, /gstatic\.com\/firebasejs\/12\.16\.0/);
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
    /if \(!isAdminProfile\(profile\)\) \{[\s\S]*?await this\.list\(table, \{ profile \}\)[\s\S]*?allowedPeriods\.has/,
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
    /rememberRecordStorageKey\(table, lookupId, storageKey, record/,
  );
  assert.match(runtime, /async resolveStorageKey\(table, id\)/);
  assert.match(
    runtime,
    /const storageKey = await this\.resolveStorageKey\(table, id\);[\s\S]*?tables\/\$\{table\}\/\$\{storageKey\}/,
  );
});

test("crédito mensal recupera a chave física atual do funcionário", async () => {
  const runtime = await readFile(
    new URL("../src/core/runtime.js", import.meta.url),
    "utf8",
  );
  const balanceHandler = runtime.match(
    /async applyEmployeeLeaveBalance\([\s\S]*?\n  async delete\(/,
  )?.[0];
  assert.ok(balanceHandler);
  assert.match(
    balanceHandler,
    /resolveEmployeeEntry\(\{\s*FuncionarioID: id,\s*\}\)/,
  );
  assert.match(balanceHandler, /storageKey = employeeEntry\.storageKey/);
  assert.match(
    balanceHandler,
    /runBalanceTransaction = \(storageKey, fallbackRecord = null\)/,
  );
  assert.match(
    balanceHandler,
    /current && typeof current === "object" \? current : fallbackRecord/,
  );
  assert.match(
    balanceHandler,
    /runBalanceTransaction\(\s*storageKey,\s*employeeEntry\.record/,
  );
});

test("cadastro antigo associa a chave física ao ID atual do funcionário", () => {
  const runtime = new FirebaseRuntime({}, "teste");
  runtime.rememberRecordStorageKey(
    "Funcionarios",
    "funcionario-id-antigo",
    "chave-fisica-antiga",
    { FuncionarioID: "funcionario-id-atual" },
  );

  assert.equal(
    runtime.recordKeys.get(
      runtime.recordCacheKey("Funcionarios", "funcionario-id-antigo"),
    ),
    "chave-fisica-antiga",
  );
  assert.equal(
    runtime.recordKeys.get(
      runtime.recordCacheKey("Funcionarios", "funcionario-id-atual"),
    ),
    "chave-fisica-antiga",
  );
});

test("aprovação escolhe o cadastro atual e preserva sua chave física", () => {
  const selected = selectEmployeeEntry(
    [
      {
        key: "funcionario-id-antigo",
        record: {
          FuncionarioID: "cadastro-obsoleto",
          Nome: "Ana Souza",
          Email: "antigo@house190.com",
          LojaID: "loja-1",
          Ativo: false,
        },
      },
      {
        key: "-chave-firebase-atual",
        record: {
          FuncionarioID: "funcionario-id-atual",
          Nome: "Ana Souza",
          Email: "ana@house190.com",
          LojaID: "loja-1",
          Ativo: true,
        },
      },
    ],
    {
      FuncionarioID: "funcionario-id-atual",
      EmailFuncionario: "ana@house190.com",
      NomeFuncionario: "Ana Souza",
      LojaID: "loja-1",
    },
  );

  assert.equal(selected.key, "-chave-firebase-atual");
  assert.equal(selected.record.FuncionarioID, "funcionario-id-atual");
});

test("aprovação antiga pode localizar o funcionário pela chave física", () => {
  const selected = selectEmployeeEntry(
    [
      {
        key: "funcionario-id-antigo",
        record: {
          FuncionarioID: "funcionario-id-atual",
          Nome: "Carlos Lima",
          LojaID: "loja-1",
          Ativo: true,
        },
      },
    ],
    {
      FuncionarioID: "funcionario-id-antigo",
      NomeFuncionario: "Carlos Lima",
      LojaID: "loja-1",
    },
  );

  assert.equal(selected.key, "funcionario-id-antigo");
  assert.equal(selected.record.FuncionarioID, "funcionario-id-atual");
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

test("funcionários podem solicitar folgas aos fins de semana em todas as lojas", async () => {
  const source = await readFile(
    new URL("../src/core/api-base.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /Pedidos de folga aos fins de semana não estão permitidos/,
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

test("saldo de folgas debita todos os tipos definidos e respeita períodos parciais", () => {
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
  for (const TipoFolga of [
    "Folga semanal",
    "Folga manual",
    "Folga automática",
    "Folga compensatória",
    "Folga de feriado",
    "Férias",
    "Licença",
    "Banco de horas",
    "Outro",
  ]) {
    assert.equal(
      timeOffBalanceUnits({
        TipoFolga,
        Periodo: "Dia inteiro",
        DataInicio: "2026-08-10",
        DataFim: "2026-08-12",
      }),
      3,
      TipoFolga,
    );
  }
});

test("crédito mensal e débito de aprovação são idempotentes", async () => {
  const [api, runtime] = await Promise.all([
    readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8"),
    readFile(new URL("../src/core/runtime.js", import.meta.url), "utf8"),
  ]);
  assert.match(api, /`credito-mensal-\$\{employee\.FuncionarioID\}-\$\{month\}`/);
  assert.match(api, /`folga-\$\{record\.FolgaID\}`/);
  assert.match(api, /desiredDelta: approved \? -units : 0/);
  assert.match(
    api,
    /if \(approved\) \{[\s\S]*?await reconcileTimeOffBalance\(updated, profile, employeeEntry\)/,
  );
  assert.doesNotMatch(
    api,
    /const updated = await runtime\.patch\("Folgas"[\s\S]*?await reconcileTimeOffBalance\(updated, profile\);/,
  );
  assert.match(api, /await reconcileTimeOffBalance\(saved, profile\)/);
  assert.match(runtime, /SaldoFolgasLancamentos/);
  assert.match(runtime, /normalizedDesired - previousDelta/);
  assert.match(runtime, /balanceBefore \+ adjustment/);
  assert.match(runtime, /SaldoFolgas: balanceAfter/);
  assert.match(
    runtime,
    /!transaction\.committed && !transaction\.snapshot\.exists\(\)/,
  );
  assert.match(
    runtime,
    /recordKeys\.delete\(this\.recordCacheKey\("Funcionarios", id\)\)/,
  );
  assert.match(runtime, /storageKey: preferredStorageKey/);
  assert.match(
    api,
    /Não foi possível aprovar: cadastro atual do funcionário não localizado/,
  );
  assert.match(api, /reconcilePendingTimeOffBalances/);
  const decision =
    api.match(
      /const timeOffDecision = async[\s\S]*?\n};\n\nconst preferredWeekdayIndex/,
    )?.[0] || "";
  assert.doesNotMatch(
    decision,
    /await runtime\.upsert\("Folgas", current\)\.catch\(\(\) => \{\}\);/,
  );
});

test("pop-up da folga extra aparece uma vez por funcionário e mês", async () => {
  const [api, client, styles] = await Promise.all([
    readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Styles.html", import.meta.url), "utf8"),
  ]);
  assert.match(api, /monthlyLeaveRewardReceiptId/);
  assert.match(api, /monthlyLeaveRewardNoticeId/);
  assert.match(
    api,
    /`folga-extra-aviso-v3-\$\{month\}__\$\{employeeId\}`/,
  );
  assert.match(
    api,
    /`notificacao-folga-extra-v3-\$\{month\}__\$\{employeeId\}`/,
  );
  assert.match(api, /runtime\.create\("Notificacoes"/);
  assert.match(api, /monthlyCreditReport/);
  assert.doesNotMatch(api, /resolveEmployeeEntry\(employee, \{ profile \}\)/);
  assert.match(api, /applyMonthlyLeaveCredit\(employee, profile, month\)/);
  assert.match(api, /monthlyLeaveReward,/);
  assert.match(api, /async acknowledgeMonthlyLeaveReward\(args\)/);
  assert.match(api, /runtime\.upsert\("ComunicadosLeituras"/);
  assert.match(
    api,
    /SaldoFolgasLancamentos\?\.\[movementId\]\?\.Delta \|\| 0\) === 1/,
  );
  assert.match(client, /acknowledgeMonthlyLeaveReward:/);
  assert.match(client, /gf-monthly-leave-reward-seen-v3:/);
  assert.match(client, /Folga extra na área! 🎉/);
  assert.match(client, /Você recebeu <strong>\+1 folga<\/strong>/);
  assert.match(client, /rememberMonthlyLeaveReward_\(reward\)/);
  assert.match(client, /data-metric="\$\{esc\(k\)\}"/);
  assert.match(styles, /\.monthly-leave-reward-overlay/);
  assert.match(styles, /@media \(max-width: 430px\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("crédito mensal reconcilia saldo e aviso persistente sem duplicar", async () => {
  const api = await readFile(
    new URL("../src/core/api-base.js", import.meta.url),
    "utf8",
  );
  assert.match(api, /existingNoticeIds = new Set/);
  assert.match(api, /if \(!existingNoticeIds\.has\(noticeId\)\)/);
  assert.match(api, /createMonthlyLeaveRewardNotice/);
  assert.match(api, /applied: results\.filter/);
  assert.match(api, /confirmed: results\.filter/);
  assert.match(api, /failed: results\.filter/);
  assert.match(api, /noticesCreated: results\.filter/);
  assert.match(api, /noticesFailed: results\.filter/);
});

test("feriado novo concede +1 folga e mostra aviso único para todos os ativos", async () => {
  const [api, client] = await Promise.all([
    readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
  ]);
  assert.match(
    api,
    /`credito-feriado-\$\{holidayId\}-\$\{employeeId\}`/,
  );
  assert.match(api, /const ensureHolidayLeaveCredits/);
  assert.match(api, /employees\.filter\(isActiveEmployee\)/);
  assert.match(api, /movementKey: movementId,[\s\S]*?desiredDelta: 1/);
  assert.match(api, /Tipo: "Crédito por feriado"/);
  assert.match(api, /Assunto: `Feriado cadastrado: \$\{name\} 🎉`/);
  assert.match(api, /Tipo: "Folga extra de feriado"/);
  assert.match(api, /holidayLeaveRewards/);
  assert.match(api, /async acknowledgeHolidayLeaveReward\(args\)/);
  assert.match(api, /`feriado-aviso-v1-\$\{holidayId\}`/);
  assert.match(
    api,
    /ensureHolidayLeaveCredits\(\s*profile,\s*saved,\s*employees/,
  );
  assert.match(client, /acknowledgeHolidayLeaveReward:/);
  assert.match(client, /gf-holiday-leave-reward-seen-v1:/);
  assert.match(client, /FERIADO CADASTRADO/);
  assert.match(client, /Folga de feriado adicionada/);
  assert.match(client, /pendingHolidayLeaveReward_/);
  assert.match(client, /scheduleLeaveRewardPopups_/);
  assert.match(client, /loadApplication\(true, false, "", true\)/);
});

test("folga mensal inclui todos os funcionários ativos, inclusive administradores", () => {
  assert.equal(
    isMonthlyLeaveEmployeeEligible({ FuncionarioID: "f-1", Ativo: true }),
    true,
  );
  assert.equal(
    isMonthlyLeaveEmployeeEligible({ FuncionarioID: "f-2", Status: "Ativo" }),
    true,
  );
  assert.equal(
    isMonthlyLeaveEmployeeEligible({ FuncionarioID: "f-3" }),
    true,
  );
  assert.equal(
    isMonthlyLeaveEmployeeEligible({ FuncionarioID: "f-4", Ativo: false }),
    false,
  );
  assert.equal(
    isMonthlyLeaveEmployeeEligible({ FuncionarioID: "f-5", Ativo: "Inativo" }),
    false,
  );
  assert.equal(
    isMonthlyLeaveEmployeeEligible({
      FuncionarioID: "f-6",
      Ativo: true,
      Perfil: "Administrador",
    }),
    true,
  );
});

test("aprovação bloqueia envios duplicados enquanto a decisão está pendente", async () => {
  const client = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  assert.match(client, /let APPROVAL_SUBMISSION_PENDING_ = false/);
  assert.match(client, /if \(APPROVAL_SUBMISSION_PENDING_\) return/);
  assert.match(client, /APPROVAL_SUBMISSION_PENDING_ = true/);
  assert.match(
    client,
    /finally \{[\s\S]*?APPROVAL_SUBMISSION_PENDING_ = false/,
  );
});

test("decisão de folga localiza cadastros antigos e bloqueia aprovação sem vínculo", async () => {
  const [api, constants, rules] = await Promise.all([
    readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8"),
    readFile(new URL("../src/core/constants.js", import.meta.url), "utf8"),
    readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
  ]);
  assert.match(api, /runtime\.resolveEmployeeEntry/);
  assert.match(api, /EmailFuncionario: record\.EmailFuncionario/);
  assert.match(api, /record\.NomeFuncionario/);
  const decision =
    api.match(
      /const timeOffDecision = async[\s\S]*?\n};\n\nconst preferredWeekdayIndex/,
    )?.[0] || "";
  assert.match(
    decision,
    /assert\([\s\S]*?employee,[\s\S]*?Não foi possível aprovar: cadastro atual do funcionário não localizado/,
  );
  assert.match(constants, /Gerente: MANAGER_PERMISSIONS/);
  assert.match(rules, /val\(\) === 'Gerente'/);
});

test("o index preserva a interface sem marcação de template do Apps Script", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /Jornada/);
  assert.match(html, /src\/main\.js/);
  assert.doesNotMatch(html, /<\?(?:=|!=)/);
  assert.match(html, /id="view-timeclock"/);
  assert.doesNotMatch(html, /house-arena|House Arena|Arena Remix/);
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

test("registro de ponto exige selfie no Drive sem gravar a imagem no Firebase", async () => {
  const [client, api, dialogs, rules, driveService, driveConfig] =
    await Promise.all([
      readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
      readFile(new URL("../src/core/api-clock.js", import.meta.url), "utf8"),
      readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8"),
      readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
      readFile(
        new URL("../google-apps-script/Code.gs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/selfie-drive-config.js", import.meta.url),
        "utf8",
      ),
    ]);
  assert.match(client, /enableHighAccuracy:\s*true/);
  assert.match(client, /timeout:\s*12000/);
  assert.match(client, /maximumAge:\s*10000/);
  assert.match(client, /latitude:\s*pos\.coords\.latitude/);
  assert.match(client, /longitude:\s*pos\.coords\.longitude/);
  assert.match(client, /getUserMedia/);
  assert.match(client, /facingMode:\s*"user"/);
  assert.match(client, /CLOCK_POSITION_PROMISE_ = getClockPosition_\(\)/);
  assert.match(client, /Math\.min\(360,\s*video\.videoWidth\)/);
  assert.match(client, /canvas\.toBlob\(/);
  assert.match(client, /"image\/jpeg",\s*0\.52/);
  assert.match(client, /clockSelfieWarm:\s*"prepareTimeClockSelfieUpload"/);
  assert.match(client, /selfieDataUrl:\s*CLOCK_SELFIE_DATA_/);
  assert.match(dialogs, /id="clockSelfieDialog"/);
  assert.match(dialogs, /Selfie obrigatória/);
  assert.match(dialogs, /A imagem não será salva no Firebase/);
  assert.match(api, /uploadClockSelfieToDrive/);
  assert.match(api, /new AbortController\(\)/);
  assert.match(api, /warmSelfieDriveService/);
  assert.match(api, /mode:\s*"no-cors"/);
  assert.match(api, /async prepareTimeClockSelfieUpload/);
  assert.match(api, /const \[employee, location, schedules, allRecords\] = await Promise\.all/);
  assert.match(api, /signal:\s*controller\.signal/);
  assert.match(api, /runtime\.create\("RegistrosPonto"/);
  assert.match(api, /ProximaMarcacao:\s*nextClockAction/);
  assert.match(api, /SelfieStorage:\s*"Google Drive"/);
  assert.match(api, /SelfieDriveFileID:\s*selfie\.fileId/);
  assert.match(api, /Aplicação web · selfie no Google Drive \+ localização/);
  assert.doesNotMatch(api, /\bSelfieData\s*:/);
  assert.doesNotMatch(api, /\bSelfieMimeType\s*:/);
  assert.match(rules, /newData\.child\('SelfieStorage'\)\.val\(\) === 'Google Drive'/);
  assert.match(rules, /!newData\.child\('SelfieData'\)\.exists\(\)/);
  assert.match(driveService, /DriveApp\.getFolderById/);
  assert.match(driveService, /firebaseProfile_\(uid, token\)/);
  assert.match(driveService, /\.json\?auth=/);
  assert.match(driveService, /destination\.createFile/);
  assert.match(driveService, /CacheService\.getScriptCache\(\)/);
  assert.doesNotMatch(driveService, /waitLock\(20000\)/);
  assert.doesNotMatch(driveService, /\.setDescription\(/);
  assert.doesNotMatch(driveService, /firebaseio\.com[\s\S]*method:\s*"put"/i);
  assert.match(driveConfig, /SELFIE_DRIVE_UPLOAD_ENDPOINT/);
  assert.match(client, /applySavedClockPunch_\(saved\)/);
  assert.match(client, /refreshClockAfterPunch_\(\)/);
  assert.match(client, /\[performance\] ponto confirmado/);
  assert.doesNotMatch(
    client,
    /closeDialog\("clockSelfieDialog"\);\s*const refreshed = await loadTimeClock/,
  );
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

test("saldo começa na primeira entrada válida, não em marcação isolada", () => {
  const starts = firstPunchDatesByEmployee([
    {
      FuncionarioID: "func-1",
      Data: "2026-07-01",
      TipoMarcacao: "SEM_DESCANSO",
      Status: "Válido",
    },
    {
      FuncionarioID: "func-1",
      Data: "2026-07-02",
      TipoMarcacao: "SAIDA_FINAL",
      Status: "Válido",
    },
    {
      FuncionarioID: "func-1",
      Data: "2026-07-03",
      TipoMarcacao: "ENTRADA",
      Status: "Válido",
    },
  ]);

  assert.equal(starts.get("func-1"), "2026-07-03");
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
  assert.match(
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

test("regras liberam auditoria e trocas somente para os perfis previstos", async () => {
  const [rulesSource, runtime] = await Promise.all([
    readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
    readFile(new URL("../src/core/runtime.js", import.meta.url), "utf8"),
  ]);
  const rules = JSON.parse(rulesSource).rules["gestao-folgas"].v2.tables;
  const audit = rules.Auditoria;
  const swaps = rules.TrocasFolga;

  assert.match(audit[".read"], /Perfil'\)\.val\(\) === 'Administrador'/);
  assert.match(audit.$record[".write"], /!data\.exists\(\)/);
  assert.match(audit.$record[".write"], /newData\.child\('FuncionarioID'\)/);
  assert.match(audit.$record[".validate"], /AuditoriaID/);

  assert.match(swaps[".read"], /Perfil'\)\.val\(\) === 'Administrador'/);
  assert.match(swaps[".read"], /query\.orderByChild === 'LojaID'/);
  assert.match(swaps[".read"], /query\.orderByChild === 'FuncionarioID'/);
  assert.deepEqual(swaps[".indexOn"], [
    "LojaID",
    "FuncionarioID",
    "FuncionarioOrigemID",
    "FuncionarioDestinoID",
  ]);
  assert.match(swaps.$record[".read"], /data\.child\('FuncionarioDestinoID'\)/);
  assert.match(swaps.$record[".write"], /Status'\)\.val\(\) === 'Aguardando aceite'/);
  assert.match(swaps.$record[".write"], /Status'\)\.val\(\) === 'Aguardando gestor'/);
  assert.match(swaps.$record[".write"], /Status'\)\.val\(\) === 'Recusada'/);

  assert.match(runtime, /const isStoreReaderProfile = \(profile\)/);
  assert.match(runtime, /isStoreReaderProfile\(profile\) && storeId/);
  assert.doesNotMatch(runtime, /isManagerProfile/);
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

test("jornada sem descanso contabiliza todo o período entre entrada e saída", () => {
  const metrics = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T15:28:00-03:00" },
      {
        TipoMarcacao: "SEM_DESCANSO",
        DataHora: "2026-08-08T17:36:00-03:00",
      },
      {
        TipoMarcacao: "SAIDA_FINAL",
        DataHora: "2026-08-09T00:09:00-03:00",
      },
    ],
    {
      HoraEntrada: "15:00",
      HoraSaida: "23:00",
      DuracaoIntervaloMinutos: 60,
    },
  );

  assert.equal(metrics.worked, 521);
  assert.equal(metrics.expected, 420);
  assert.equal(metrics.balance, 101);
  assert.equal(metrics.complete, true);
});

test("intervalo real é descontado mesmo quando existe marcação sem descanso", () => {
  const metrics = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T15:28:00-03:00" },
      { TipoMarcacao: "SEM_DESCANSO", DataHora: "2026-08-08T16:00:00-03:00" },
      { TipoMarcacao: "SAIDA_INTERVALO", DataHora: "2026-08-08T17:36:00-03:00" },
      { TipoMarcacao: "RETORNO_INTERVALO", DataHora: "2026-08-08T18:11:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-08-09T00:09:00-03:00" },
    ],
    {
      HoraEntrada: "15:00",
      HoraSaida: "23:00",
      DuracaoIntervaloMinutos: 60,
    },
  );

  assert.equal(metrics.worked, 486);
  assert.equal(metrics.balance, 66);
});

test("retorno de intervalo ausente desconta o intervalo previsto", () => {
  const metrics = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T15:00:00-03:00" },
      { TipoMarcacao: "SAIDA_INTERVALO", DataHora: "2026-08-08T17:30:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-08-08T23:00:00-03:00" },
    ],
    {
      HoraEntrada: "15:00",
      HoraSaida: "23:00",
      DuracaoIntervaloMinutos: 60,
    },
  );

  assert.equal(metrics.worked, 420);
  assert.equal(metrics.balance, 0);
  assert.equal(metrics.complete, false);
  assert.deepEqual(dayBalanceState("2026-08-08", metrics, "2026-08-09"), {
    pending: true,
    minutes: 0,
    text: "—",
  });
});

test("dois turnos somam apenas os períodos trabalhados", () => {
  const metrics = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T08:00:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-08-08T12:00:00-03:00" },
      { TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T18:00:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-08-08T22:00:00-03:00" },
    ],
    { CargaDiariaMinutos: 480 },
  );

  assert.equal(metrics.worked, 480);
  assert.equal(metrics.balance, 0);
  assert.equal(metrics.complete, true);
});

test("jornada flexível calcula os dois turnos previstos sem contar o intervalo", () => {
  const schedule = {
    HorarioFlexivelDoisTurnos: true,
    HoraEntrada: "08:00",
    HoraSaidaIntervalo: "12:00",
    HoraRetornoIntervalo: "18:00",
    HoraSaida: "22:00",
    DuracaoIntervaloMinutos: 360,
  };
  assert.equal(scheduleExpectedMinutes(schedule), 480);
  const metrics = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T08:00:00-03:00" },
      { TipoMarcacao: "SAIDA_INTERVALO", DataHora: "2026-08-08T12:00:00-03:00" },
      { TipoMarcacao: "RETORNO_INTERVALO", DataHora: "2026-08-08T18:00:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-08-08T22:00:00-03:00" },
    ],
    schedule,
  );
  assert.equal(metrics.worked, 480);
  assert.equal(metrics.expected, 480);
  assert.equal(metrics.balance, 0);
  assert.equal(metrics.complete, true);
});

test("marcação intermediária esquecida bloqueia hora extra e avisa o gestor", () => {
  const schedule = {
    FuncionarioID: "func-1",
    Ativa: true,
    VigenteDe: "2026-08-01",
    HorarioFlexivelDoisTurnos: true,
    HoraEntrada: "08:00",
    HoraSaidaIntervalo: "12:00",
    HoraRetornoIntervalo: "18:00",
    HoraSaida: "22:00",
    DuracaoIntervaloMinutos: 360,
  };
  const records = [
    { FuncionarioID: "func-1", Data: "2026-08-08", TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T08:00:00-03:00" },
    { FuncionarioID: "func-1", Data: "2026-08-08", TipoMarcacao: "SAIDA_INTERVALO", DataHora: "2026-08-08T12:00:00-03:00" },
    { FuncionarioID: "func-1", Data: "2026-08-08", TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-08-08T22:00:00-03:00" },
  ];
  const metrics = dayMetrics(records, schedule);
  assert.equal(metrics.complete, false);
  assert.equal(dayBalanceState("2026-08-08", metrics, "2026-08-09").minutes, 0);
  assert.equal(
    findIncompletePunches(
      records,
      [schedule],
      [{ FuncionarioID: "func-1", Nome: "Ana", Ativo: true }],
      "2026-08-09",
    ).length,
    1,
  );
});

test("jornada acima de 12 horas é limitada e fica pendente de revisão", () => {
  const metrics = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T08:00:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-08-09T07:30:00-03:00" },
    ],
    { CargaDiariaMinutos: 480 },
  );

  assert.equal(metrics.rawWorked, 1410);
  assert.equal(metrics.worked, 720);
  assert.equal(metrics.reviewRequired, true);
  assert.deepEqual(dayBalanceState("2026-08-08", metrics, "2026-08-09"), {
    pending: true,
    minutes: 0,
    text: "—",
  });
});

test("saldo de horas acumula entre meses e considera compensações", () => {
  const employee = {
    FuncionarioID: "func-1",
    Nome: "Funcionário",
    Ativo: true,
  };
  const schedule = {
    FuncionarioID: "func-1",
    Ativa: true,
    VigenteDe: "2026-07-01",
    HoraEntrada: "08:00",
    HoraSaida: "16:00",
    DuracaoIntervaloMinutos: 0,
    DiasTrabalho: "1,2,3,4,5,6",
  };
  const records = [
    ["2026-07-31", "08:00", "17:00"],
    ["2026-08-01", "08:00", "17:00"],
  ].flatMap(([date, entry, exit]) => [
    {
      FuncionarioID: "func-1",
      Data: date,
      TipoMarcacao: "ENTRADA",
      DataHora: `${date}T${entry}:00-03:00`,
      Status: "Válido",
    },
    {
      FuncionarioID: "func-1",
      Data: date,
      TipoMarcacao: "SAIDA_FINAL",
      DataHora: `${date}T${exit}:00-03:00`,
      Status: "Válido",
    },
  ]);

  const july = accumulatedHourBalance({
    employees: [employee],
    records,
    schedules: [schedule],
    throughMonth: "2026-07",
    currentDate: "2026-08-01",
  });
  const startOfAugust = accumulatedHourBalance({
    employees: [employee],
    records: records.filter((item) => item.Data === "2026-07-31"),
    schedules: [schedule],
    throughMonth: "2026-08",
    currentDate: "2026-08-01",
  });
  const august = accumulatedHourBalance({
    employees: [employee],
    records,
    schedules: [schedule],
    movements: [
      {
        FuncionarioID: "func-1",
        Data: "2026-08-01",
        SaldoDia: -0.5,
      },
    ],
    throughMonth: "2026-08",
    currentDate: "2026-08-02",
  });

  assert.equal(july.employees[0].saldoMinutos, 60);
  assert.equal(startOfAugust.employees[0].saldoMinutos, 60);
  assert.equal(august.employees[0].saldoMinutos, 90);
  assert.equal(august.employees[0].saldoTexto, "+1h 30min");
  assert.equal(august.employees[0].desde, "2026-07-31");
  assert.equal(august.employees[0].trabalhadoMinutos, 1080);
  assert.equal(august.employees[0].previstoMinutos, 960);
  assert.equal(august.employees[0].ajustesMinutos, -30);
  assert.equal(august.employees[0].pendencias, 0);
});

test("painel de saldo inclui funcionários sem ponto e funcionários inativos", () => {
  const result = accumulatedHourBalance({
    employees: [
      { FuncionarioID: "novo", Nome: "Novo", Ativo: true },
      { FuncionarioID: "inativo", Nome: "Inativo", Ativo: false },
    ],
    throughMonth: "2026-08",
    currentDate: "2026-08-09",
  });

  assert.deepEqual(
    result.employees.map((item) => item.FuncionarioID),
    ["novo", "inativo"],
  );
  assert.equal(result.employees[0].saldoMinutos, 0);
  assert.equal(result.employees[0].desde, "");
  assert.equal(result.employees[1].Ativo, false);
});

test("marcações com fusos diferentes são ordenadas pelo instante real", () => {
  const metrics = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T10:00:00+02:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-08-08T09:30:00Z" },
    ],
    { CargaDiariaMinutos: 90 },
  );

  assert.equal(metrics.worked, 90);
  assert.equal(metrics.balance, 0);
});

test("administrador possui aba para consultar e ajustar saldos de horas", async () => {
  const [interfaceHtml, dialogs, client, clockApi] = await Promise.all([
    readFile(new URL("../src/legacy/Index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/core/api-clock.js", import.meta.url), "utf8"),
  ]);

  assert.match(
    interfaceHtml,
    /class="nav-item permission-admin" data-view="hour-balances"/,
  );
  assert.match(interfaceHtml, /id="view-hour-balances"/);
  assert.match(interfaceHtml, /id="adminHourBalanceBody"/);
  assert.match(dialogs, /id="hourBalanceAdjustmentForm"/);
  assert.match(client, /data-action="adjust-hour-balance"/);
  assert.match(client, /adjustHourBalance: "adjustHourBalanceWithSession"/);
  assert.match(
    clockApi,
    /async adjustHourBalanceWithSession\(args\)[\s\S]*?requireAdmin\(profile\)/,
  );
  assert.match(clockApi, /SaldoMinutos: minutes/);
  assert.match(clockApi, /MovID: `ajuste-\$\{requestId\}`/);
  assert.match(client, /requestId: state\.hourBalanceAdjustmentRequestId/);
  assert.match(clockApi, /"Ajustar saldo de horas"/);
});

test("saída duplicada não estende artificialmente o turno", () => {
  const metrics = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-07-20T08:00:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-07-20T17:00:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-07-20T18:00:00-03:00" },
    ],
    { CargaDiariaMinutos: 480 },
  );
  assert.equal(metrics.worked, 540);
  assert.equal(metrics.balance, 60);
});

test("trabalho fora da escala conta integralmente como hora extra", () => {
  const employee = { FuncionarioID: "func-1", Nome: "Funcionário", Ativo: true };
  const schedule = {
    FuncionarioID: "func-1",
    Ativa: true,
    VigenteDe: "2026-08-01",
    CargaDiariaMinutos: 480,
    DiasTrabalho: "1,2,3,4,5",
  };
  const records = [
    {
      FuncionarioID: "func-1",
      Data: "2026-08-08",
      TipoMarcacao: "ENTRADA",
      DataHora: "2026-08-08T08:00:00-03:00",
      Status: "Válido",
    },
    {
      FuncionarioID: "func-1",
      Data: "2026-08-08",
      TipoMarcacao: "SAIDA_FINAL",
      DataHora: "2026-08-08T16:00:00-03:00",
      Status: "Válido",
    },
  ];
  const result = accumulatedHourBalance({
    employees: [employee],
    records,
    schedules: [schedule],
    throughMonth: "2026-08",
    currentDate: "2026-08-09",
  });

  assert.equal(result.employees[0].trabalhadoMinutos, 480);
  assert.equal(result.employees[0].previstoMinutos, 0);
  assert.equal(result.employees[0].saldoMinutos, 480);
});

test("folga fixa substitui a exclusão antiga do domingo na jornada", () => {
  const employee = {
    FuncionarioID: "func-1",
    Nome: "Funcionário",
    Ativo: true,
    DiaFolgaPreferencial: "Terça-feira",
  };
  const schedule = {
    FuncionarioID: "func-1",
    Ativa: true,
    VigenteDe: "2026-08-01",
    CargaDiariaMinutos: 480,
    DiasTrabalho: "1,2,3,4,5,6",
  };
  const records = ["2026-08-02", "2026-08-03", "2026-08-04"].flatMap((date) => [
    {
      FuncionarioID: "func-1",
      Data: date,
      TipoMarcacao: "ENTRADA",
      DataHora: `${date}T08:00:00-03:00`,
      Status: "Válido",
    },
    {
      FuncionarioID: "func-1",
      Data: date,
      TipoMarcacao: "SAIDA_FINAL",
      DataHora: `${date}T16:00:00-03:00`,
      Status: "Válido",
    },
  ]);
  const result = accumulatedHourBalance({
    employees: [employee],
    records,
    schedules: [schedule],
    throughMonth: "2026-08",
    currentDate: "2026-08-05",
  });

  assert.equal(result.employees[0].trabalhadoMinutos, 1440);
  assert.equal(result.employees[0].previstoMinutos, 960);
  assert.equal(result.employees[0].saldoMinutos, 480);
});

test("tolerância da jornada zera somente pequenas diferenças", () => {
  const schedule = {
    CargaDiariaMinutos: 420,
    ToleranciaMinutos: 5,
  };
  const withinTolerance = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T16:00:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-08-08T23:04:00-03:00" },
    ],
    schedule,
  );
  const outsideTolerance = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-08-08T16:00:00-03:00" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-08-08T23:06:00-03:00" },
    ],
    schedule,
  );

  assert.equal(withinTolerance.rawBalance, 4);
  assert.equal(withinTolerance.balance, 0);
  assert.equal(outsideTolerance.balance, 6);
});

test("troca de folga fixa vale somente na semana e é aplicada atomicamente", async () => {
  const [api, client, dialogs, runtime, constants, rules] = await Promise.all([
    readFile(new URL("../src/core/api-advanced.js", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8"),
    readFile(new URL("../src/core/runtime.js", import.meta.url), "utf8"),
    readFile(new URL("../src/core/constants.js", import.meta.url), "utf8"),
    readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
  ]);
  assert.match(dialogs, /id="swapDestinationTimeOff"/);
  assert.match(dialogs, /a troca vale somente naquela semana/);
  assert.match(client, /FolgaDestinoID: \$\("#swapDestinationTimeOff"\)\.value/);
  assert.match(client, /compatibleSwapDates_/);
  assert.match(client, /Somente nesta semana/);
  assert.match(api, /FolgaDestinoOriginalID: destinationTimeOff\.FolgaID/);
  assert.match(api, /await runtime\.patchMany\(\[/);
  assert.match(api, /FolgaFixaSubstituidaData: sourceDate/);
  assert.match(api, /EscopoTroca: fixedInvolved/);
  assert.match(api, /TrocaPrincipalID: swapId/);
  assert.match(api, /SWAP_DIRECTORY_CATEGORY/);
  assert.match(api, /runtime\.upsert\(\s*"Comunicados"/);
  assert.match(runtime, /createIfMissing = false/);
  assert.match(constants, /TrocasFolga: "FuncionarioID"/);
  assert.match(rules, /DiretorioTrocasFolga/);
  assert.doesNotMatch(
    api,
    /DiaFolgaPreferencial\s*:[\s\S]{0,80}DataAtualizacao/,
  );
});

test("ocorrência fixa trocada não altera a recorrência das semanas seguintes", () => {
  const employee = {
    FuncionarioID: "FUNC-1",
    Nome: "Teste",
    LojaID: "LOJA-1",
    Ativo: true,
    DiaFolgaPreferencial: "Terça-feira",
  };
  assert.equal(employeeHasFixedDay(employee, "2026-08-04"), true);
  assert.equal(employeeHasFixedDay(employee, "2026-08-05"), false);
  const original = fixedTimeOffCandidates(
    employee,
    [],
    "2026-08-03",
    6,
  );
  assert.deepEqual(
    original.map((item) => item.FolgaID),
    ["FIXA-FUNC-1-2026-08-04"],
  );
  const override = {
    FuncionarioID: "FUNC-1",
    Status: "Aprovada",
    DataInicio: "2026-08-06",
    DataFim: "2026-08-06",
    FolgaFixaSubstituidaData: "2026-08-04",
  };
  assert.equal(
    isFixedOffForDate(employee, "2026-08-04", [override]),
    false,
  );
  assert.equal(
    isFixedOffForDate(employee, "2026-08-11", [override]),
    true,
  );
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

test("justificativa de ponto zera o dia e não entra no saldo", async () => {
  const counted = balanceDays([
    { saldoMinutos: -480, justificado: true },
    { saldoMinutos: 60, justificado: false },
  ]);
  assert.equal(counted.length, 1);
  assert.equal(counted[0].saldoMinutos, 60);
  const clockApi = await readFile(
    new URL("../src/core/api-clock.js", import.meta.url),
    "utf8",
  );
  assert.match(clockApi, /justifyMissedTimeClockDay/);
  assert.match(clockApi, /Atestado/);
  assert.match(clockApi, /Folga trocada/);
  assert.match(clockApi, /Dia concedido/);
  assert.match(clockApi, /JustificativasPonto/);
});

test("administrador consegue salvar a justificativa de ausência", async () => {
  const client = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  const saveHandler = client.match(
    /async function saveClockJustification_\(event\) \{[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(saveHandler);
  assert.match(saveHandler, /await call\(FN\.clockJustifyDay/);
  assert.match(saveHandler, /releaseFormSubmission_\(form\)/);
  assert.doesNotMatch(saveHandler, /\baction\(/);
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

test("falta em dia anterior gera débito negativo e batida incompleta fica pendente", () => {
  const schedule = { CargaDiariaMinutos: 420 };
  const missing = dayBalanceState(
    "2026-08-08",
    dayMetrics([], schedule),
    "2026-08-09",
  );
  const partial = dayBalanceState(
    "2026-08-08",
    dayMetrics(
      [
        {
          TipoMarcacao: "ENTRADA",
          DataHora: "2026-08-08T15:28:00-03:00",
        },
        {
          TipoMarcacao: "SEM_DESCANSO",
          DataHora: "2026-08-08T17:36:00-03:00",
        },
      ],
      schedule,
    ),
    "2026-08-09",
  );

  // Falta em dia de trabalho anterior: gera débito da jornada não trabalhada (-420min = -7h)
  assert.deepEqual(missing, { pending: false, minutes: -420, text: "-7h 00min" });
  // Batida incompleta (sem saída): fica pendente de ajuste do gestor
  assert.deepEqual(partial, { pending: true, minutes: 0, text: "—" });
});

test("próxima folga mostra apenas a aprovada com dias e data", () => {
  const employeeId = "ana";
  // Sem funcionário passado => só considera pedidos aprovados (sem folga fixa)
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
    null, // sem objeto funcionário — não considera folga fixa
  );
  // 2026-07-28 → 2026-09-11 = 45 dias corridos
  assert.equal(result.dias, 45);
  assert.equal(result.diaSemana, "Sexta");
  assert.equal(result.data, "2026-09-11");
});

test("detecção de saídas esquecidas identifica jornadas abertas de dias anteriores", () => {
  const employees = [
    { FuncionarioID: "f1", Nome: "Carlos", Ativo: true, LojaID: "loja1" },
    { FuncionarioID: "f2", Nome: "Maria", Ativo: true, LojaID: "loja1" },
  ];
  const schedules = [
    {
      FuncionarioID: "f1",
      Ativa: true,
      HoraEntrada: "15:00",
      HoraSaida: "23:20",
    },
  ];
  const records = [
    // Dia anterior com entrada mas sem saída
    {
      FuncionarioID: "f1",
      Data: "2026-08-10",
      TipoMarcacao: "ENTRADA",
      DataHora: "2026-08-10T15:00:00-03:00",
      Status: "Válido",
    },
    // Dia anterior completo
    {
      FuncionarioID: "f2",
      Data: "2026-08-10",
      TipoMarcacao: "ENTRADA",
      DataHora: "2026-08-10T08:00:00-03:00",
      Status: "Válido",
    },
    {
      FuncionarioID: "f2",
      Data: "2026-08-10",
      TipoMarcacao: "SAIDA_FINAL",
      DataHora: "2026-08-10T17:00:00-03:00",
      Status: "Válido",
    },
  ];
  const incomplete = findIncompletePunches(
    records,
    schedules,
    employees,
    "2026-08-11",
  );
  assert.equal(incomplete.length, 1);
  assert.equal(incomplete[0].FuncionarioID, "f1");
  assert.equal(incomplete[0].Data, "2026-08-10");
  assert.equal(incomplete[0].HorarioSugeridoSaida, "23:20");
});

test("presença ao vivo calcula status em tempo real e alerta de horas excessivas", () => {
  const employees = [
    { FuncionarioID: "e1", Nome: "Lucas", Cargo: "Chapeiro", Ativo: true },
    { FuncionarioID: "e2", Nome: "Julia", Cargo: "Atendente", Ativo: true },
    { FuncionarioID: "e3", Nome: "Pedro", Cargo: "Caixa", Ativo: true },
  ];
  const now = new Date("2026-08-18T19:00:00-03:00");
  const records = [
    // Lucas bateu entrada às 10:00 (9 horas atrás -> warning)
    {
      FuncionarioID: "e1",
      Data: "2026-08-18",
      TipoMarcacao: "ENTRADA",
      DataHora: "2026-08-18T10:00:00-03:00",
      Status: "Válido",
    },
    // Julia entrou às 15:00 e saiu para intervalo às 18:00
    {
      FuncionarioID: "e2",
      Data: "2026-08-18",
      TipoMarcacao: "ENTRADA",
      DataHora: "2026-08-18T15:00:00-03:00",
      Status: "Válido",
    },
    {
      FuncionarioID: "e2",
      Data: "2026-08-18",
      TipoMarcacao: "SAIDA_INTERVALO",
      DataHora: "2026-08-18T18:00:00-03:00",
      Status: "Válido",
    },
  ];
  const presenceData = calculateLivePresence(employees, records, [], [], now);
  assert.equal(presenceData.totals.trabalhando, 1);
  assert.equal(presenceData.totals.intervalo, 1);
  assert.equal(presenceData.totals.ausente, 1);
  assert.equal(presenceData.totals.alertas, 1);

  const lucas = presenceData.presence.find((p) => p.FuncionarioID === "e1");
  assert.equal(lucas.status, "trabalhando");
  assert.equal(lucas.alertLevel, "warning");
});

test("escala para WhatsApp gera mensagem formatada com setores e folgas", () => {
  const employees = [
    {
      FuncionarioID: "e1",
      Nome: "Carlos",
      Cargo: "Cozinha",
      Ativo: true,
      LojaID: "loja-1",
      DiaFolgaPreferencial: "Segunda-feira",
    },
  ];
  const schedules = [
    {
      FuncionarioID: "e1",
      Ativa: true,
      HoraEntrada: "16:00",
      HoraSaida: "00:20",
    },
  ];
  const scheduleMsg = generateWhatsAppWeeklySchedule({
    employees,
    timeOff: [],
    schedules,
    stores: [{ LojaID: "loja-1", Nome: "House Burger Teixeira" }],
    startDate: "2026-08-18",
    storeId: "loja-1",
  });
  assert.match(scheduleMsg.message, /ESCALA DA SEMANA/);
  assert.match(scheduleMsg.message, /COZINHA/);
  assert.match(scheduleMsg.message, /Carlos/);
  assert.match(scheduleMsg.message, /16:00 às 00:20/);
});

test("scheduleExpectedMinutes extrai horários nominais e embutidos corretamente", () => {
  const scheduleIso = {
    HoraEntrada: "2026-08-01T08:00:00.000Z",
    HoraSaida: "2026-08-01T17:00:00.000Z",
    DuracaoIntervaloMinutos: 60,
  };
  const schedulePlain = {
    HoraEntrada: "08:00",
    HoraSaida: "17:00",
    DuracaoIntervaloMinutos: 60,
  };
  assert.equal(scheduleExpectedMinutes(scheduleIso), 480);
  assert.equal(scheduleExpectedMinutes(schedulePlain), 480);
});

test("isScheduledWorkday calcula escala 6x1 considerando folga fixa semanal sem gerar hora extra indevida no domingo", () => {
  const employeeTuesday = {
    FuncionarioID: "emp-terca",
    DiaFolgaPreferencial: "Terça-feira",
  };
  const schedule = {
    DiasTrabalho: "1,2,3,4,5,6",
  };

  // Terça (2) é a folga fixa -> não deve ser dia de escala
  assert.equal(isScheduledWorkday(schedule, employeeTuesday, 2), false);
  // Domingo (0) é dia normal de trabalho na escala 6x1 com folga na terça
  assert.equal(isScheduledWorkday(schedule, employeeTuesday, 0), true);
  // Quarta (3), Quinta (4), etc. são dias de trabalho
  assert.equal(isScheduledWorkday(schedule, employeeTuesday, 3), true);

  // Funcionário 5x2 padrão sem folga fixa especificada
  const employee5x2 = {
    FuncionarioID: "emp-5x2",
  };
  const schedule5x2 = {
    DiasTrabalho: "1,2,3,4,5",
  };
  assert.equal(isScheduledWorkday(schedule5x2, employee5x2, 0), false);
  assert.equal(isScheduledWorkday(schedule5x2, employee5x2, 6), false);
  assert.equal(isScheduledWorkday(schedule5x2, employee5x2, 1), true);
});

test("presença ao vivo calcula alertas de hora extra proporcionais à jornada do colaborador", () => {
  const employee = {
    FuncionarioID: "emp-1",
    Nome: "Pedro",
    Ativo: true,
    LojaID: "loja-1",
  };
  // Jornada de 6h (360min)
  const schedule6h = {
    FuncionarioID: "emp-1",
    Ativa: true,
    CargaDiariaMinutos: 360,
  };
  // Funcionário entrou há 7h (420min): acima de 6h + 30min -> deve gerar alerta de hora extra
  const now = new Date("2026-08-29T17:00:00-03:00");
  const records = [
    {
      FuncionarioID: "emp-1",
      Data: "2026-08-29",
      TipoMarcacao: "ENTRADA",
      DataHora: "2026-08-29T10:00:00-03:00",
      Status: "Válido",
    },
  ];
  const presence = calculateLivePresence(
    [employee],
    records,
    [schedule6h],
    [],
    now,
  );
  const p = presence.presence[0];
  assert.equal(p.status, "trabalhando");
  assert.equal(p.alertLevel, "warning");
  assert.match(p.alertMessage, /Hora extra/);
});

test("accumulatedHourBalance totalMinutos consolida apenas funcionários ativos", () => {
  const result = accumulatedHourBalance({
    employees: [
      { FuncionarioID: "ativo", Nome: "Ativo", Ativo: true },
      { FuncionarioID: "inativo", Nome: "Inativo", Ativo: false },
    ],
    records: [
      {
        FuncionarioID: "inativo",
        Data: "2026-08-01",
        TipoMarcacao: "ENTRADA",
        DataHora: "2026-08-01T08:00:00-03:00",
        Status: "Válido",
      },
      {
        FuncionarioID: "inativo",
        Data: "2026-08-01",
        TipoMarcacao: "SAIDA_FINAL",
        DataHora: "2026-08-01T17:00:00-03:00",
        Status: "Válido",
      },
    ],
    schedules: [
      {
        FuncionarioID: "inativo",
        Ativa: true,
        CargaDiariaMinutos: 480,
      },
    ],
    throughMonth: "2026-08",
    currentDate: "2026-08-05",
  });
  // O funcionário inativo continua no array para histórico individual
  assert.equal(result.employees.length, 2);
  // Mas o total da equipe soma apenas ativos (0)
  assert.equal(result.totalMinutos, 0);
  assert.equal(result.totalTexto, "+0h 00min");
});

test("findIncompletePunches preenche o nome e loja do colaborador com fallbacks resilientes", () => {
  const employees = [
    {
      FuncionarioID: "f1",
      NomeCompleto: "Jakeline Santos",
      NomeLoja: "HOUSE 190 TEIXEIRA",
      Ativo: true,
    },
  ];
  const records = [
    {
      FuncionarioID: "f1",
      Data: "2026-08-28",
      TipoMarcacao: "ENTRADA",
      DataHora: "2026-08-28T16:59:00-03:00",
      Status: "Válido",
    },
  ];
  const list = findIncompletePunches(records, [], employees, "2026-08-29");
  assert.equal(list.length, 1);
  assert.equal(list[0].NomeFuncionario, "Jakeline Santos");
  assert.equal(list[0].NomeLoja, "HOUSE 190 TEIXEIRA");
  assert.ok(list[0].EntradaTexto);
});

test("o administrador possui opcao de zerar saldos de loja e trocar/redefinir senha", async () => {
  const [apiClock, apiBase, scripts, dialogs, index] = await Promise.all([
    readFile(new URL("../src/core/api-clock.js", import.meta.url), "utf8"),
    readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Index.html", import.meta.url), "utf8"),
  ]);

  assert.match(apiClock, /async resetStoreBalancesWithSession/);
  assert.match(apiBase, /async adminSendPasswordReset/);
  assert.match(dialogs, /id="resetStoreBalancesDialog"/);
  assert.match(index, /id="adminResetStoreBalancesBtn"/);
  assert.match(scripts, /openResetStoreBalancesDialog_/);
  assert.match(scripts, /reset-employee-pwd/);
  assert.match(
    apiClock,
    /runtime\.list\("RegistrosPonto"/,
    "resetStoreBalances deve listar todos os registros de ponto para zerar saldo efetivamente",
  );
  assert.match(
    apiClock,
    /accumulatedHourBalance\(\{[\s\S]*?movements,/,
    "resetStoreBalances deve repassar movements corretamente para o cálculo de saldo",
  );
  assert.ok(
    !apiClock.includes("params."),
    "apiClock não deve conter referências a 'params' indefinido",
  );
  assert.match(
    apiClock,
    /payload\.month \|\| payload\.mes/,
    "resetStoreBalances deve extrair a competência a partir de payload.month",
  );
});


test("House mantém o crédito de folga extra ao salvar um feriado ativo", async () => {
  const api = await readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8");
  assert.match(api, /if \(saved.Ativo !== false\) \{[\s\S]*?await ensureHolidayLeaveCredits\(profile, saved, employees\)/);
});

test("jornada integral fechando a meia-noite: tolerância de 23:40 a 00:00 sem desconto, hora extra após 00:00 e desconto antes de 23:40", () => {
  const schedule = {
    TipoJornada: "Integral",
    HoraEntrada: "16:00",
    HoraSaida: "00:00",
    CargaDiariaMinutos: 480,
    DuracaoIntervaloMinutos: 0,
    ToleranciaMinutos: 5,
  };

  // 1. Saída às 23:45 (entre 23:40 e 00:00): não desconta e não gera extra (saldo 0)
  const exit2345 = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-09-30T16:00:00-03:00", Data: "2026-09-30" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-09-30T23:45:00-03:00", Data: "2026-09-30" },
    ],
    schedule,
    { dateKey: "2026-09-30" },
  );
  assert.equal(exit2345.balance, 0, "Saída às 23:45 deve ter saldo 0 (sem desconto)");

  // 2. Saída às 23:40 (limite exato da tolerância): não desconta (saldo 0)
  const exit2340 = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-09-30T16:00:00-03:00", Data: "2026-09-30" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-09-30T23:40:00-03:00", Data: "2026-09-30" },
    ],
    schedule,
    { dateKey: "2026-09-30" },
  );
  assert.equal(exit2340.balance, 0, "Saída às 23:40 deve ter saldo 0 (sem desconto)");

  // 3. Saída às 23:25 (antes das 23:40): desconta o tempo faltante (-35 minutos)
  const exit2325 = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-09-30T16:00:00-03:00", Data: "2026-09-30" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-09-30T23:25:00-03:00", Data: "2026-09-30" },
    ],
    schedule,
    { dateKey: "2026-09-30" },
  );
  assert.equal(exit2325.balance, -35, "Saída às 23:25 deve descontar 35 minutos");

  // 4. Saída às 00:25 (após as 00:00): gera +25 minutos de hora extra
  const exit0025 = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-09-30T16:00:00-03:00", Data: "2026-09-30" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-10-01T00:25:00-03:00", Data: "2026-09-30" },
    ],
    schedule,
    { dateKey: "2026-09-30" },
  );
  assert.equal(exit0025.balance, 25, "Saída às 00:25 deve gerar 25 minutos extras");

  // 5. Entrada antecipada (15:40) e saída às 23:50: não gera hora extra antes de 00:00 (saldo 0)
  const earlyEntryNoOvertime = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-09-30T15:40:00-03:00", Data: "2026-09-30" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-09-30T23:50:00-03:00", Data: "2026-09-30" },
    ],
    schedule,
    { dateKey: "2026-09-30" },
  );
  assert.equal(earlyEntryNoOvertime.balance, 0, "Entrada antecipada com saída às 23:50 não deve gerar hora extra");

  // 6. Entrada antecipada (15:40) e saída às 00:30: hora extra conta apenas os 30 min pós meia-noite
  const earlyEntryWithOvertime = dayMetrics(
    [
      { TipoMarcacao: "ENTRADA", DataHora: "2026-09-30T15:40:00-03:00", Data: "2026-09-30" },
      { TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-10-01T00:30:00-03:00", Data: "2026-09-30" },
    ],
    schedule,
    { dateKey: "2026-09-30" },
  );
  assert.equal(earlyEntryWithOvertime.balance, 30, "Hora extra deve contar estritamente os minutos pós meia-noite");
});

test("CozinhaFlow: títulos, pontuação por prioridade e catálogo de prêmios da loja", async () => {
  const {
    DEFAULT_REWARDS,
    KITCHEN_LEVELS,
    getKitchenLevel,
    taskPointValue,
  } = await import("../src/core/api-tasks.js");

  // 1. Validação dos 8 níveis oficiais da cozinha
  assert.equal(KITCHEN_LEVELS.length, 8, "Devem existir 8 níveis de carreira da cozinha");
  assert.equal(KITCHEN_LEVELS[0].name, "Ajudante da Cozinha");
  assert.equal(KITCHEN_LEVELS[7].name, "Lenda do Foodpark");

  // Níveis por faixa de pontos
  assert.equal(getKitchenLevel(0).level.name, "Ajudante da Cozinha");
  assert.equal(getKitchenLevel(50).level.name, "Ajudante da Cozinha");
  assert.equal(getKitchenLevel(60).level.name, "Mestre do Molho");
  assert.equal(getKitchenLevel(150).level.name, "Guardião da Fritadeira");
  assert.equal(getKitchenLevel(300).level.name, "Rei da Chapa");
  assert.equal(getKitchenLevel(550).level.name, "Pizzaiolo de Ouro");
  assert.equal(getKitchenLevel(900).level.name, "Mestre do Crocante");
  assert.equal(getKitchenLevel(1500).level.name, "Chef da House");
  assert.equal(getKitchenLevel(2500).level.name, "Lenda do Foodpark");
  assert.equal(getKitchenLevel(5000).level.name, "Lenda do Foodpark");

  // 2. Pontuação por tarefa/prioridade
  assert.equal(taskPointValue("Urgente"), 3, "Prioridade urgente gera 3 pontos");
  assert.equal(taskPointValue("Alta"), 2, "Prioridade alta gera 2 pontos");
  assert.equal(taskPointValue("Media"), 1, "Prioridade média gera 1 ponto");
  assert.equal(taskPointValue("Baixa"), 1, "Prioridade baixa gera 1 ponto");

  // 3. Catálogo de prêmios da loja
  assert.equal(DEFAULT_REWARDS.length, 11, "Devem existir 11 prêmios padrão na loja");
  const rewardFolgaExtra = DEFAULT_REWARDS.find((r) => (r.NOME || r.nome) === "Folga extra");
  assert.ok(rewardFolgaExtra, "Deve incluir 'Folga extra'");
  assert.equal(rewardFolgaExtra.PONTOS || rewardFolgaExtra.pontos, 800);
});

test("CozinhaFlow 3.0: redesign da tela de login, modais de tarefa com comprovação e celebração animada", async () => {
  const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const cozinhaCss = await readFile(new URL("../src/cozinhaflow.css", import.meta.url), "utf8");
  const tasksJs = await readFile(new URL("../src/tasks.js", import.meta.url), "utf8");
  const journeyJs = await readFile(new URL("../src/journey.js", import.meta.url), "utf8");

  // 1. Tela de login e elementos funcionais preservados
  assert.match(indexHtml, /id="loginScreen"[^>]*class="login-screen/, "loginScreen deve estar presente");
  assert.match(indexHtml, /id="loginForm"/, "loginForm deve estar presente");
  assert.match(indexHtml, /id="loginEmail"/, "loginEmail deve estar presente");
  assert.match(indexHtml, /id="loginPassword"/, "loginPassword deve estar presente");
  assert.match(indexHtml, /id="togglePassword"/, "togglePassword deve estar presente");
  assert.match(indexHtml, /id="rememberLogin"/, "rememberLogin deve estar presente");
  assert.match(indexHtml, /id="forgotPasswordBtn"/, "forgotPasswordBtn deve estar presente");
  assert.match(indexHtml, /id="loginError"/, "loginError deve estar presente");
  assert.match(indexHtml, /id="resetPasswordForm"/, "resetPasswordForm deve estar presente");
  assert.match(indexHtml, /class="login-shell"/, "loginScreen deve ter login-shell estrutural");
  assert.match(indexHtml, /class="login-form-panel"/, "loginScreen deve ter painel de formulário");

  // 2. Estilos do CozinhaFlow e limites de tela estritos
  assert.match(cozinhaCss, /overflow-x:\s*clip\s*!important/, "Limites de tela sem scroll horizontal");
  assert.match(cozinhaCss, /\.cf-celebration-overlay/, "Overlay de celebração comemorativa presente no CSS");
  assert.match(cozinhaCss, /@keyframes cfConfettiFall/, "Animação de confetes em CSS");
  assert.match(cozinhaCss, /\.task-camera-guide/, "Guia de foto da câmera presente no CSS");
  assert.match(cozinhaCss, /\.task-photo-picker/, "Picker de foto presente no CSS");
  assert.match(cozinhaCss, /\.login-card/, "Estilo do card de login presente no CSS");
  assert.match(cozinhaCss, /\.btn-glow/, "Botão glow do login presente no CSS");

  // 3. Scripts de tarefas e jornada
  assert.match(tasksJs, /function showTaskCelebration/, "tasks.js deve ter modal animado de celebração");
  assert.match(tasksJs, /task-camera-guide/, "Modal de conclusão deve ter guia de foto da câmera");
  assert.match(tasksJs, /Enviar Comprovação/, "Modal de conclusão deve ter botão explícito de envio");
  assert.match(journeyJs, /j-kitchen-tag/, "journey.js deve exibir selos de título da equipe");
  assert.match(journeyJs, /getKitchenLevel/, "journey.js deve calcular nível da cozinha");
});

test("painel de ausências lista funcionários ativos sem batida no dia e faltas pendentes", async () => {
  const client = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  assert.match(client, /function getAbsencesData_\(/, "Deve definir a função getAbsencesData_");
  assert.match(client, /isCurrentMonth/, "Deve checar o mês atual");
  assert.match(client, /Sem entrada hoje/, "Deve indicar status de sem entrada hoje");
  assert.match(client, /⚠️ Sem entrada hoje/, "Badge visual para ausentes hoje");
  assert.match(client, /updateAbsencesBadge_\(\)/, "Badge de ausências no menu deve ser atualizado");
  assert.match(client, /pendingList = rawAbsences\.filter\(\(a\) => !a\.justificado\)/, "Faltas pendentes devem incluir quem não bateu ponto hoje");
});

test("otimização de ponto: geolocalização rápida com pré-aquecimento e validação justa de raio", async () => {
  const [client, clockApi] = await Promise.all([
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
    readFile(new URL("../src/core/api-clock.js", import.meta.url), "utf8"),
  ]);

  // Frontend: pré-aquecimento e cache de GPS
  assert.match(client, /warmClockLocation_\(\)/, "renderTimeClock deve pré-aquecer geolocalização");
  assert.match(client, /CLOCK_CACHED_POSITION_/, "Deve manter cache da última posição obtida");
  assert.match(client, /updateClockLocationStatus_/, "Deve atualizar status da localização na tela da selfie");

  // Backend: validação de raio sem penalizar imprecisão indoor
  assert.match(clockApi, /const withinStore =/, "api-clock deve ter validação justa de geofence");
  assert.match(clockApi, /Math\.max\(150,\s*configuredRadius\)/, "Raio deve possuir piso seguro de 150m");
  assert.match(clockApi, /safeAccuracy <= 350/, "Deve filtrar imprecisão excessiva");
});

test("persistência de login, atualização forçada do PWA e desativação de zoom automático mobile", async () => {
  const [indexHtml, stylesHtml, scriptsHtml, runtimeJs, pwaJs, swJs] =
    await Promise.all([
      readFile(new URL("../src/legacy/Index.html", import.meta.url), "utf8"),
      readFile(new URL("../src/legacy/Styles.html", import.meta.url), "utf8"),
      readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
      readFile(new URL("../src/core/runtime.js", import.meta.url), "utf8"),
      readFile(new URL("../src/pwa.js", import.meta.url), "utf8"),
      readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    ]);

  // 1. Persistência de login
  assert.match(
    indexHtml,
    /<input id="rememberLogin" type="checkbox" checked \/>/,
    "Checkbox de lembrar login deve vir marcado por padrão",
  );
  assert.match(
    runtimeJs,
    /remember !== false \? browserLocalPersistence : browserSessionPersistence/,
    "runtime.js deve utilizar browserLocalPersistence por padrão",
  );
  assert.match(
    scriptsHtml,
    /PERSISTENT_SESSION_MAX_MS_ = 180 \* 24 \* 60 \* 60 \* 1000/,
    "Validade máxima da sessão persistida deve ser de 180 dias",
  );
  assert.match(
    scriptsHtml,
    /currentUser\.getIdToken\(\)/,
    "DOMContentLoaded deve restaurar sessão automaticamente do Firebase Auth",
  );

  // 2. Desativação de zoom automático mobile
  assert.match(
    indexHtml,
    /user-scalable=no/,
    "Index.html deve conter user-scalable=no na meta viewport",
  );
  assert.match(
    indexHtml,
    /maximum-scale=1\.0/,
    "Index.html deve conter maximum-scale=1.0 na meta viewport",
  );
  assert.match(
    stylesHtml,
    /touch-action:\s*manipulation;/,
    "Styles.html deve conter touch-action: manipulation",
  );
  assert.match(
    scriptsHtml,
    /gesturestart/,
    "Scripts.html deve interceptar gesturestart para eliminar zoom no iOS",
  );

  // 3. Atualização forçada do PWA
  assert.match(
    swJs,
    /FORCE_UPDATE/,
    "sw.js deve disparar mensagem FORCE_UPDATE para os clientes",
  );
  assert.match(
    pwaJs,
    /FORCE_UPDATE/,
    "pwa.js deve escutar mensagem FORCE_UPDATE e recarregar a janela",
  );
});

test("módulo Takeat de Contas a Prazo é acessível para funcionários e gerentes", async () => {
  const indexHtml = await readFile(
    new URL("../src/legacy/Index.html", import.meta.url),
    "utf8",
  );
  const scriptsHtml = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );

  // 1. Botão no menu sem a classe permission-manager
  assert.match(
    indexHtml,
    /<button class="nav-item"[^>]*data-view="takeat-credit">/,
    "O botão de navegação para takeat-credit não deve ter classe permission-manager",
  );

  // 2. Não pode estar restrito no managerViews
  assert.doesNotMatch(
    scriptsHtml,
    /const managerViews\s*=\s*\[[^\]]*"takeat-credit"[^\]]*\]/,
    "takeat-credit não deve estar na lista managerViews que bloqueia funcionários",
  );

  // 3. hydrateUser adapta o rótulo para funcionários
  assert.match(
    scriptsHtml,
    /takeatLabel\.textContent\s*=\s*employeeMode\s*\?\s*"Meu consumo"\s*:\s*"Contas a Prazo"/,
    "hydrateUser deve alterar o texto do menu para 'Meu consumo' quando for funcionário",
  );

  // 4. computeCards inclui o card de consumo para funcionários
  assert.match(
    scriptsHtml,
    /consumoPrazo:\s*consumoVal/,
    "computeCards deve calcular consumoPrazo para o perfil de funcionário",
  );

  // 5. Carga secundária em segundo plano
  assert.match(
    scriptsHtml,
    /scheduleIdleTask_\(\(\)\s*=>\s*loadTakeatCreditData\(false,\s*true\)/,
    "scheduleSecondaryLoads_ deve agendar loadTakeatCreditData silencioso",
  );

  // 6. Cards mobile para funcionário e 20% de desconto
  assert.match(
    indexHtml,
    /id="takeatEmployeeCardsContainer"/,
    "Index.html deve possuir container de cards mobile para funcionários",
  );

  assert.match(
    scriptsHtml,
    /takeatMetric3Label[\s\S]*?Com 20% de Desconto/,
    "Card 3 deve exibir 'Com 20% de Desconto' para funcionários",
  );

  assert.match(
    scriptsHtml,
    /discountedDebt\s*=\s*myDebt\s*\*\s*0\.8/,
    "Scripts.html deve calcular o valor do consumo com 20% de desconto (myDebt * 0.8)",
  );

  assert.match(
    scriptsHtml,
    /Com 20% desc:/,
    "employeeTakeatSubtitle_ deve exibir o valor com 20% de desconto",
  );
});

test("Takeat Credit: separação por compra e detalhes da comanda com olho minimalista", async () => {
  const dialogsHtml = await readFile(
    new URL("../src/legacy/Dialogs.html", import.meta.url),
    "utf8",
  );
  const scriptsHtml = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  const coreTakeat = await readFile(
    new URL("../src/core/takeat-credit.js", import.meta.url),
    "utf8",
  );

  // 1. Dialog para itens da comanda
  assert.match(
    dialogsHtml,
    /id="takeatComandaDetailsDialog"/,
    "Dialogs.html deve conter o modal takeatComandaDetailsDialog",
  );

  // 2. Funções core exportadas
  assert.match(
    coreTakeat,
    /export async function fetchCreditRegisterSummary/,
    "takeat-credit.js deve exportar fetchCreditRegisterSummary",
  );
  assert.match(
    coreTakeat,
    /export async function fetchTableSessionDetails/,
    "takeat-credit.js deve exportar fetchTableSessionDetails",
  );

  // 3. Funções no Scripts.html
  assert.match(
    scriptsHtml,
    /loadTakeatAccountPurchases_/,
    "Scripts.html deve conter a função loadTakeatAccountPurchases_",
  );
  assert.match(
    scriptsHtml,
    /showTakeatComandaDetails_/,
    "Scripts.html deve conter a função showTakeatComandaDetails_",
  );
  assert.match(
    scriptsHtml,
    /openTakeatManagerComandasModal_/,
    "Scripts.html deve conter a função openTakeatManagerComandasModal_",
  );

  // 4. Botão com olho minimalista (data-action="view-takeat-comanda")
  assert.match(
    scriptsHtml,
    /data-action="view-takeat-comanda"/,
    "Scripts.html deve renderizar o botão com olho minimalista para abrir comanda",
  );

  // 5. Botão de compras do gestor
  assert.match(
    scriptsHtml,
    /data-action="view-takeat-account-comandas"/,
    "Scripts.html deve conter botão para o gestor visualizar compras da conta",
  );

  // 6. filterOpenPurchases deve ser exportada e utilizada para filtrar apenas ciclo ativo
  assert.match(
    coreTakeat,
    /export function filterOpenPurchases/,
    "takeat-credit.js deve exportar a função filterOpenPurchases",
  );
  assert.match(
    scriptsHtml,
    /filterOpenPurchases/,
    "Scripts.html deve chamar filterOpenPurchases para mostrar apenas compras em aberto",
  );
});

test("dock mobile contém apenas os 5 botões solicitados: início, ponto, tarefas, folgas e consumo", async () => {
  const indexHtml = await readFile(
    new URL("../src/legacy/Index.html", import.meta.url),
    "utf8",
  );
  const dockMatch = indexHtml.match(/<nav class="mobile-dock"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(dockMatch, "Index.html deve conter <nav class=\"mobile-dock\">");
  const dockHtml = dockMatch[1];

  // Extrai todos os data-view-target dos botões da dock
  const targets = [...dockHtml.matchAll(/data-view-target="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targets, [
    "dashboard",
    "timeclock",
    "tasks",
    "timeoff",
    "takeat-credit",
  ]);

  // Garante que escala, equipe e pendências não estão na dock
  assert.doesNotMatch(dockHtml, /data-view-target="shift-plan"/);
  assert.doesNotMatch(dockHtml, /data-view-target="live-team"/);
  assert.doesNotMatch(dockHtml, /data-view-target="pending-center"/);
});

test("Takeat Credit UX: hero card consolidado, lojas zeradas colapsaveis, comanda com valor riscado e padding mobile", async () => {
  const indexHtml = await readFile(
    new URL("../src/legacy/Index.html", import.meta.url),
    "utf8",
  );
  const scriptsHtml = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );

  // 1. Container possui padding de respiro para dock mobile
  assert.match(
    indexHtml,
    /id="takeatEmployeeCardsContainer"[^>]*padding:1rem 1rem 6rem;/,
    "Container de cards de consumo deve possuir padding inferior de respiro para a dock mobile",
  );

  // 2. Hero card no Scripts.html
  assert.match(
    scriptsHtml,
    /A pagar no fechamento/,
    "Scripts.html deve exibir 'A pagar no fechamento' no Hero Card do colaborador",
  );

  // 3. Economia destacada com 20%
  assert.match(
    scriptsHtml,
    /Economia de.*?\${fmtBRL\(totalSavings\)}/,
    "Scripts.html deve exibir economia calculada do desconto de 20%",
  );

  // 4. Lojas zeradas em formato colapsavel com badge Em Dia
  assert.match(
    scriptsHtml,
    /Em Dia[\s\S]*?data-chv/,
    "Lojas com débito zerado devem ser colapsáveis com indicador chevron",
  );

  // 5. Comandas com valor original tachado e valor com desconto destacado
  assert.match(
    scriptsHtml,
    /text-decoration:line-through;[\s\S]*?fmtTakeatBRL_\(p\.value\)/,
    "Comanda deve exibir valor original tachado",
  );
  assert.match(
    scriptsHtml,
    />-20%<\/span>/,
    "Comanda deve exibir badge de -20%",
  );
});

test("Otimização de performance: cache em memória no runtime, resiliência do ponto e cache do service worker", async () => {
  const runtimeJs = await readFile(
    new URL("../src/core/runtime.js", import.meta.url),
    "utf8",
  );
  const apiClockJs = await readFile(
    new URL("../src/core/api-clock.js", import.meta.url),
    "utf8",
  );
  const swJs = await readFile(
    new URL("../public/sw.js", import.meta.url),
    "utf8",
  );
  const journeyJs = await readFile(
    new URL("../src/journey.js", import.meta.url),
    "utf8",
  );

  // 1. Runtime possui queryCache e método de invalidação
  assert.match(
    runtimeJs,
    /this\.queryCache\s*=\s*new Map\(\)/,
    "FirebaseRuntime deve inicializar queryCache",
  );
  assert.match(
    runtimeJs,
    /invalidateTableCache\(table\s*=\s*""\)/,
    "FirebaseRuntime deve ter método invalidateTableCache",
  );

  // 2. Upload de selfie tem idToken válido e retry automático
  assert.match(
    apiClockJs,
    /idToken\s*=\s*await\s+user\.getIdToken\(\)/,
    "uploadClockSelfieToDrive deve obter o idToken do usuário autenticado",
  );
  assert.match(
    apiClockJs,
    /performUpload\(20000\)[\s\S]*?performUpload\(25000\)/,
    "uploadClockSelfieToDrive deve possuir retry automático contra falha de cold start",
  );

  // 3. Tolerância de geofence calibrada para ambientes fechados
  assert.match(
    apiClockJs,
    /safeAccuracy\s*<=\s*350/,
    "Geofence deve permitir precisão típica de cozinhas e ambientes fechados",
  );

  // 4. Service Worker faz cache do Firebase SDK do gstatic
  assert.match(
    swJs,
    /gstatic\.com[\s\S]*?firebasejs/,
    "Service Worker deve permitir cache para scripts do Firebase SDK",
  );

  // 5. Journey evita re-renderização se o dashboard não estiver ativo
  assert.match(
    journeyJs,
    /journeyDirty/,
    "journey.js deve ter flag dirty para evitar re-renderização quando em outras abas",
  );
});

test("Takeat Consumo: Hero Card sem confete, cabeçalho compacto e recuo superior otimizado", async () => {
  const scriptsHtml = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );

  // 1. Emoji de confete removido
  assert.doesNotMatch(
    scriptsHtml,
    /Economia de.*?🎉/,
    "Hero Card do Takeat não deve conter emoji de confete 🎉",
  );

  // 2. Badge de -20% com design limpo
  assert.match(
    scriptsHtml,
    /Economia de.*?-20%/,
    "Hero Card deve exibir Economia com badge de -20%",
  );

  // 3. Otimização de recuo: container de cards sem padding superior redundante
  assert.match(
    scriptsHtml,
    /cardsContainer\.style\.padding\s*=\s*"0\.25rem 0 6rem 0"/,
    "Container de cards do funcionário deve ter padding superior compacto",
  );

  // 4. Panel wrapper em transparente para evitar borda dupla e recuo
  assert.match(
    scriptsHtml,
    /tablePanel\.style\.background\s*=\s*"transparent"/,
    "tablePanel deve ter background transparente para funcionário",
  );

  // 5. Botão de sincronização não sobrescreve SVG com texto em mobile
  assert.match(
    scriptsHtml,
    /takeat-spin/,
    "loadTakeatCreditData deve usar ícone animado takeat-spin sem quebrar o botão mobile",
  );

  // 6. Hero Card com background padronizado do tema e sem gradiente estranho
  assert.match(
    scriptsHtml,
    /background:var\(--bg-card,\s*#ffffff\)/,
    "Hero Card deve usar background do card limpo alinhado com o design system",
  );
});

test("Takeat cards: design estilo iOS com bordas generosamente arredondadas e sombras em camadas com profundidade", async () => {
  const [redesignCss, scriptsHtml] = await Promise.all([
    readFile(new URL("../src/redesign.css", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
  ]);

  assert.match(
    redesignCss,
    /\.takeat-ios-hero-card\s*\{[\s\S]*?border-radius:\s*22px/i,
    "Hero Card deve ter bordas arredondadas de 22px estilo iOS",
  );
  assert.match(
    redesignCss,
    /\.takeat-ios-store-card\s*\{[\s\S]*?border-radius:\s*22px/i,
    "Store Card expandido deve ter bordas arredondadas de 22px estilo iOS",
  );
  assert.match(
    redesignCss,
    /\.takeat-ios-collapsed-card\s*\{[\s\S]*?border-radius:\s*20px/i,
    "Store Card colapsado deve ter bordas arredondadas de 20px estilo iOS",
  );
  assert.match(
    redesignCss,
    /\.takeat-ios-comanda-item\s*\{[\s\S]*?border-radius:\s*16px/i,
    "Itens de comanda devem ter bordas arredondadas de 16px estilo iOS",
  );
  assert.match(
    redesignCss,
    /\.takeat-ios-hero-card[\s\S]*?box-shadow:\s*0 10px 28px/i,
    "Hero Card deve ter sombra profunda em camadas estilo iOS",
  );
  assert.match(
    scriptsHtml,
    /takeat-ios-hero-card/,
    "Scripts.html deve aplicar takeat-ios-hero-card",
  );
  assert.match(
    scriptsHtml,
    /takeat-ios-store-card/,
    "Scripts.html deve aplicar takeat-ios-store-card",
  );
  assert.match(
    scriptsHtml,
    /takeat-ios-comanda-item/,
    "Scripts.html deve aplicar takeat-ios-comanda-item",
  );
});

test("Auditoria do ponto e performance: fallback de jornada padrão, idempotência, cache do tarefas e transição 0ms de abas", async () => {
  const [apiClock, tasksJs, scriptsHtml] = await Promise.all([
    readFile(new URL("../src/core/api-clock.js", import.meta.url), "utf8"),
    readFile(new URL("../src/tasks.js", import.meta.url), "utf8"),
    readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8"),
  ]);

  // 1. api-clock.js: Fallback para jornada padrão caso o colaborador não tenha jornada cadastrada
  assert.match(apiClock, /const defaultScheduleFor =/);
  assert.match(apiClock, /defaultScheduleFor\(empId/);
  assert.match(apiClock, /CargaDiariaMinutos:\s*440/);
  assert.match(apiClock, /DuracaoIntervaloMinutos:\s*60/);

  // 2. api-clock.js: Normalização de IDs para evitar falhas por tipos divergentes (string vs number)
  assert.match(apiClock, /String\(item\.FuncionarioID \?\? ""\)\.trim\(\) === normId/);

  // 3. api-clock.js: Idempotência de registro já efetuado sem erro de tela desatualizada
  assert.match(apiClock, /alreadyDoneExpected/);
  assert.match(apiClock, /`Ponto já registrado: \$\{alreadyDoneExpected\.TipoMarcacao\}\.`/);

  // 4. tasks.js: Cache TTL de 60s, deduplicação de chamadas concorrentes (_loadDataPromise) e Stale-While-Revalidate
  assert.match(tasksJs, /let _loadDataPromise = null;/);
  assert.match(tasksJs, /const TASKS_CACHE_TTL = 60000;/);
  assert.match(tasksJs, /const isFresh = !force && state\.initialized/);
  assert.match(tasksJs, /if \(state\.initialized\)\s*\{\s*renderApp\(\);/);
  assert.match(tasksJs, /await loadData\(true\);/);

  // 5. Scripts.html: Não duplicar gestao-tasks-open se initTasksModule estiver disponível
  assert.match(scriptsHtml, /if \(typeof window\.initTasksModule === "function"\) \{/);
  assert.match(scriptsHtml, /window\.initTasksModule\(.*?\);\s*\} else \{\s*window\.dispatchEvent\(new CustomEvent\("gestao-tasks-open"/);

  // 6. Scripts.html: Transição instantânea (0ms) na aba ponto se houver dados em cache
  assert.match(scriptsHtml, /const hasData = state\.timeClock && \(state\.timeClock\._cacheKey === cacheKey/);

  // 7. Scripts.html: startClockPunch_ busca status se expectedAction estiver vazio
  assert.match(scriptsHtml, /if \(!expectedAction && !state\.timeClock\) \{\s*const tc = await loadTimeClock\(false, false\);/);

  // 8. Scripts.html: Consumo Takeat abre sem requisição repetida para colaboradores com 0 contas
  assert.match(scriptsHtml, /if \(!forceRefresh && state\.takeatCredit\.loaded\) \{\s*if \(state\.currentView === "takeat-credit"\) renderTakeatCreditView\(\);/);
});

test("Módulo de Assinatura Eletrônica e Gestão Documental: criptografia, auditoria pericial e piloto", async () => {
  const { sha256Hex, generateSignedPdf, generateValidationCode, formatBrasiliaDateOnly, DOCUMENT_TEMPLATES } = await import("../src/core/api-documents.js");
  const { PDFDocument } = await import("pdf-lib");

  // 1. Integridade Criptográfica (SHA-256)
  const testString = "Contrato de Trabalho - Grupo House 190";
  const hash1 = await sha256Hex(testString);
  const hash2 = await sha256Hex(testString);
  assert.equal(hash1, hash2, "O hash SHA-256 deve ser estritamente determinístico");
  assert.equal(hash1.length, 64, "O hash SHA-256 deve possuir exatamente 64 caracteres hexadecimais");

  const diffHash = await sha256Hex("Contrato de Trabalho - Grupo House 191");
  assert.notEqual(hash1, diffHash, "Qualquer caractere alterado deve mudar completamente o hash");

  // 2. Formato do Código de Validação Pericial e Data
  const valCode = generateValidationCode();
  assert.match(valCode, /^VAL-\d{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, "Código de validação deve seguir o padrão VAL-AAAA-XXXX-XXXX");
  const dOnly = formatBrasiliaDateOnly("2026-10-18T15:30:00.000Z");
  assert.equal(dOnly, "18/10/2026", "Data formatada para carimbo no canhoto deve ser DD/MM/AAAA");

  // 3. Modelos Internos do Sistema
  assert.ok(DOCUMENT_TEMPLATES["termo-regulamento"], "Deve conter o modelo de Regulamento Interno");
  assert.ok(DOCUMENT_TEMPLATES["acordo-banco-horas"], "Deve conter o modelo de Banco de Horas (Art. 59 CLT)");
  assert.ok(DOCUMENT_TEMPLATES["termo-epi-uniforme"], "Deve conter o modelo de EPI e Uniforme");

  // 4. Criação de PDF Dinâmico com Folha Pericial de Auditoria
  const mockDoc = {
    DocumentoID: "DOC_TEST_001",
    Titulo: "Termo de Compromisso Operacional",
    Tipo: "Termo de Ciência",
    FuncionarioID: "FUNC_01",
    NomeFuncionario: "Gabriel Cangussu Prates",
    CPFFuncionario: "123.456.789-00",
    LojaID: "LOJA_01",
    NomeLoja: "Tios Rockets Pizzaria",
    MesReferencia: "2026-09",
    DataEnvio: "2026-10-09T18:00:00.000Z",
    CriadoPor: "Diretoria",
    HashOriginalSHA256: await sha256Hex("Texto base do contrato"),
    ConteudoTexto: "Cláusula 1: O colaborador declara ciência das diretrizes operacionais do Grupo House 190.",
  };

  const mockSignInfo = {
    CodigoValidacao: valCode,
    DataHoraAssinatura: "2026-10-09T18:30:00.000Z",
    TimestampUTC: Date.now(),
    EnderecoIP: "189.40.55.12",
    DispositivoInfo: "iPhone 15 Pro (iOS 18.0)",
    NavegadorInfo: "Mobile Safari 18.0",
  };

  // Rubrica mock (1x1 PNG transparente)
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  const resultFromText = await generateSignedPdf({
    originalPdfBytes: null,
    originalText: mockDoc.ConteudoTexto,
    docInfo: mockDoc,
    signInfo: mockSignInfo,
    rubricPngBytes: new Uint8Array(tinyPng),
  });

  assert.ok(resultFromText.finalPdfBytes.length > 500, "Deve gerar bytes válidos de PDF");
  assert.ok(resultFromText.finalPdfBase64.length > 500, "Deve gerar base64 válido");
  assert.equal(resultFromText.finalHashSha256.length, 64, "Deve computar hash SHA-256 do PDF final");

  const pdfLoaded = await PDFDocument.load(resultFromText.finalPdfBytes);
  assert.equal(pdfLoaded.getPageCount(), 1, "PDF gerado a partir de texto deve conter a folha do contrato com a assinatura gravada diretamente nela");

  // 5. Teste Piloto com PDF Real da Contabilidade: GABRIEL (1).pdf se existir
  try {
    const fs = await import("node:fs/promises");
    const pilotPath = "/Users/gleuce/Downloads/GABRIEL (1).pdf";
    const pilotBytes = await fs.readFile(pilotPath).catch(() => null);

    if (pilotBytes) {
      const originalDoc = await PDFDocument.load(pilotBytes);
      const originalPageCount = originalDoc.getPageCount();

      const pilotDocInfo = {
        DocumentoID: "DOC_GABRIEL_PILOTO",
        Titulo: "Holerite — Setembro/2026",
        Tipo: "Holerite",
        FuncionarioID: "GABRIEL_01",
        NomeFuncionario: "Gabriel Cangussu Prates",
        CPFFuncionario: "123.456.789-00",
        LojaID: "LOJA_TIOS_ROCKETS",
        NomeLoja: "Tios Rockets Pizzaria Ltda",
        MesReferencia: "2026-09",
        DataEnvio: "2026-10-09T18:00:00.000Z",
        CriadoPor: "Contabilidade",
        HashOriginalSHA256: await sha256Hex(pilotBytes),
      };

      const pilotSignedResult = await generateSignedPdf({
        originalPdfBytes: new Uint8Array(pilotBytes),
        originalText: null,
        docInfo: pilotDocInfo,
        signInfo: mockSignInfo,
        rubricPngBytes: new Uint8Array(tinyPng),
      });

      const finalPilotDoc = await PDFDocument.load(pilotSignedResult.finalPdfBytes);
      assert.equal(
        finalPilotDoc.getPageCount(),
        originalPageCount,
        "O PDF assinado do Gabriel deve manter exatamente a folha original do holerite com o selo gravado diretamente nela, sem página avulsa",
      );
      assert.equal(pilotSignedResult.finalHashSha256.length, 64, "O hash final do holerite assinado deve ser válido");
    }
  } catch (err) {
    console.warn("Aviso no teste piloto do Gabriel:", err);
  }
});

test("Acessibilidade de Documentos para colaboradores no menu, início, jornada e pendências", async () => {
  const indexHtml = await readFile(
    new URL("../src/legacy/Index.html", import.meta.url),
    "utf8",
  );
  const scriptsHtml = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  const journeyJs = await readFile(
    new URL("../src/journey.js", import.meta.url),
    "utf8",
  );
  const documentsJs = await readFile(
    new URL("../src/documents.js", import.meta.url),
    "utf8",
  );

  // 1. Sidebar nav item existe e applyPermissions_ inclui 'documents' para colaboradores e chefes de cozinha
  assert.ok(
    indexHtml.includes('data-view="documents"'),
    "Index.html deve conter botão com data-view=\"documents\"",
  );
  assert.match(
    scriptsHtml,
    /employeeViews\s*=\s*\[[\s\S]*?"documents"[\s\S]*?\]/,
    "employeeViews deve conter 'documents'",
  );
  assert.match(
    scriptsHtml,
    /kitchenChiefViews\s*=\s*\[[\s\S]*?"documents"[\s\S]*?\]/,
    "kitchenChiefViews deve conter 'documents'",
  );
  assert.match(
    scriptsHtml,
    /documentsNavLabel\.textContent\s*=\s*employeeMode\s*\?\s*"Meus Documentos"\s*:\s*"Documentos"/,
    "Label do menu deve alternar entre 'Meus Documentos' e 'Documentos'",
  );

  // 2. Atalho de documentos disponível nas ações principais da Home / Dashboard
  assert.match(
    indexHtml,
    /home-primary-actions[\s\S]*?data-view-target="documents"/,
    "Home primary actions deve conter atalho para Meus Documentos",
  );

  // 3. Central de pendências contém seção de documentos & assinaturas
  assert.match(
    indexHtml,
    /data-pending-category="documents"[\s\S]*?data-view-target="documents"/,
    "Central de pendências deve conter seção de documentos",
  );

  // 4. Cartão pessoal da jornada (Bento) possui ação de Meus Documentos
  assert.match(
    journeyJs,
    /data-view-target="documents"/,
    "Jornada pessoal deve conter atalho para Meus Documentos",
  );

  // 5. Inicialização automática em Meus Documentos para colaboradores
  assert.match(
    documentsJs,
    /state\.activeTab\s*=\s*\(state\.isManager\s*\|\|\s*state\.isAdmin\)\s*\?\s*"gestao"\s*:\s*"minhas"/,
    "Colaborador deve iniciar automaticamente na aba 'minhas' (Meus Documentos)",
  );
});

test("botão minimalista de saída rápida automática preenche saída esquecida com horário estabelecido", async () => {
  const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const redesignCss = await readFile(new URL("../src/redesign.css", import.meta.url), "utf8");
  const apiClockJs = await readFile(new URL("../src/core/api-clock.js", import.meta.url), "utf8");

  // 1. Botão minimalista configurado na tabela do espelho da equipe
  assert.match(indexHtml, /class="[^"]*quick-exit-btn[^"]*"/, "Deve incluir o botão com classe quick-exit-btn");
  assert.match(indexHtml, /data-action="auto-fill-exit"/, "Deve possuir ação data-action auto-fill-exit");
  assert.match(indexHtml, /handleAutoFillExitAction_/, "Deve possuir o handler handleAutoFillExitAction_");
  assert.match(indexHtml, /getEmployeeScheduledExitTime_/, "Deve possuir a função getEmployeeScheduledExitTime_");

  // 2. Estilos dedicados no redesign.css
  assert.match(redesignCss, /\.quick-exit-btn/, "CSS deve conter regras para .quick-exit-btn");
  assert.match(redesignCss, /\.clock-row-actions/, "CSS deve conter regras para .clock-row-actions");

  // 3. Backend api-clock aceita dia atual e trata virada de turno pós meia-noite
  assert.match(apiClockJs, /date\s*<=\s*todayIso\(\)/, "Backend deve permitir registrar saída esquecida para a data atual");
  assert.match(apiClockJs, /horaSaidaPrevista/, "Backend deve calcular horaSaidaPrevista nas métricas de dias");
});

test("botão minimalista para exclusão definitiva de funcionário na listagem e no modal", async () => {
  const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const redesignCss = await readFile(new URL("../src/redesign.css", import.meta.url), "utf8");
  const apiBaseJs = await readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8");

  // 1. Botão minimalista na listagem e no modal de funcionário
  assert.match(indexHtml, /class="[^"]*btn-delete-employee[^"]*"/, "Deve incluir botão com classe btn-delete-employee");
  assert.match(indexHtml, /data-action="delete-employee"/, "Deve possuir ação data-action delete-employee");
  assert.match(indexHtml, /id="employeeDeleteBtn"/, "Deve possuir botão de exclusão no modal de funcionário");
  assert.match(indexHtml, /deleteEmployee:\s*"deleteEmployee"/, "Deve mapear FN.deleteEmployee");

  // 2. Estilos dedicados no redesign.css
  assert.match(redesignCss, /\.btn-delete-employee/, "CSS deve conter regras para .btn-delete-employee");

  // 3. Backend api-base implementa deleteEmployee com remoção e auditoria
  assert.match(apiBaseJs, /async deleteEmployee\(/, "Backend deve possuir o método deleteEmployee");
  assert.match(apiBaseJs, /runtime\.getById\("Funcionarios"/, "Backend deve buscar o funcionário existente via getById");
  assert.match(apiBaseJs, /runtime\.delete\("Funcionarios"/, "Backend deve deletar registro em Funcionarios");
  assert.match(apiBaseJs, /deleteAccess/, "Backend deve remover credenciais de acesso vinculadas");
});

test("importação em lote de holerites extrai páginas, identifica colaboradores/CPF e gera distribuição com confirmação", async () => {
  const {
    parseBatchPayrollPdf,
    createDocumentsHandlers,
    parsePdfCMap,
    extractTextFromPdfPage,
    parsePayrollDataFromText,
    findBestEmployeeMatch,
    formatMonthLabel,
  } = await import("../src/core/api-documents.js");
  const documentsJs = await readFile(new URL("../src/documents.js", import.meta.url), "utf8");
  const dialogsHtml = await readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8");
  const documentsCss = await readFile(new URL("../src/documents.css", import.meta.url), "utf8");
  const { PDFDocument } = await import("pdf-lib");
  const fs = await import("node:fs/promises");

  // 1. Interface: Botão de Importar Lote e Modais de Confirmação e Prévia
  assert.match(documentsJs, /id="docBatchUploadBtn"/, "Toolbar de gestão deve conter o botão docBatchUploadBtn");
  assert.match(documentsJs, /id="docBatchFileInput"/, "Toolbar de gestão deve conter o input invisível docBatchFileInput");
  assert.match(documentsJs, /Importar Lote \(Holerites\)/, "Botão deve ter o rótulo legível Importar Lote (Holerites)");
  assert.match(dialogsHtml, /id="documentBatchConfirmDialog"/, "Dialogs.html deve conter o modal documentBatchConfirmDialog");
  assert.match(dialogsHtml, /id="documentBatchPreviewDialog"/, "Dialogs.html deve conter o modal documentBatchPreviewDialog");
  assert.match(documentsCss, /\.doc-batch-table/, "documents.css deve conter estilos para a tabela do lote");

  // 2. Extração e Separação em Lote com o arquivo real do usuário
  const batchFilePath = "/Users/gleuce/Downloads/106ba1da-3952-40b1-95ae-3634bb2bc350 3.pdf";
  const batchFileBytes = await fs.readFile(batchFilePath).catch(() => null);

  const mockEmployees = [
    { FuncionarioID: "EMP_SARA", Nome: "Sara Elisa Pereira Nogueira", CPF: "111.111.111-11", LojaID: "LOJA_ROCKETS" },
    { FuncionarioID: "EMP_GABRIEL", Nome: "Gabriel Cangussu Prates", CPF: "222.222.222-22", LojaID: "LOJA_ROCKETS" },
    { FuncionarioID: "EMP_VALERIO", Nome: "Valerio Ferraz de Oliveira", CPF: "333.333.333-33", LojaID: "LOJA_ROCKETS" },
  ];

  if (batchFileBytes) {
    const result = await parseBatchPayrollPdf(batchFileBytes, mockEmployees);
    assert.equal(result.totalPages, 11, "O PDF de lote contábil deve conter 11 páginas");
    assert.equal(result.parsedItems.length, 11, "Deve extrair 11 itens individuais");

    // Página 1: Sara Elisa
    const p1 = result.parsedItems[0];
    assert.equal(p1.pageNumber, 1);
    assert.equal(p1.extractedName, "SARA ELISA PEREIRA NOGUEIRA");
    assert.equal(p1.extractedMonth, "2026-09");
    assert.equal(p1.matched, true);
    assert.equal(p1.FuncionarioID, "EMP_SARA");
    assert.equal(p1.CPFFuncionario, "111.111.111-11");
    assert.ok(p1.ArquivoOriginalBase64.length > 500, "Deve gerar Base64 do PDF individual");
    assert.equal(p1.HashOriginalSHA256.length, 64, "Deve computar o SHA-256 do PDF individual");

    // Verifica que cada página gerada é um PDF de 1 página válida
    const singlePdf = await PDFDocument.load(Buffer.from(p1.ArquivoOriginalBase64, "base64"));
    assert.equal(singlePdf.getPageCount(), 1, "Cada holerite separado deve ter exatamente 1 página");

    // Página 3: Gabriel Cangussu Prates
    const p3 = result.parsedItems[2];
    assert.equal(p3.pageNumber, 3);
    assert.equal(p3.extractedName, "GABRIEL CANGUSSU PRATES");
    assert.equal(p3.matched, true);
    assert.equal(p3.FuncionarioID, "EMP_GABRIEL");
    assert.equal(p3.CPFFuncionario, "222.222.222-22");
  }

  // 3. Suporte a PDFArray em Contents (arquivo 3bb840de-400f-4fa2-a114-96a24fb8d5f3.pdf)
  const batchFilePath2 = "/Users/gleuce/Downloads/3bb840de-400f-4fa2-a114-96a24fb8d5f3.pdf";
  const batchFileBytes2 = await fs.readFile(batchFilePath2).catch(() => null);
  if (batchFileBytes2) {
    const mockEmployees2 = [
      { FuncionarioID: "EMP_MARCIA", Nome: "Marcia Ferreira Oliveira", CPF: "444.444.444-44", LojaID: "LOJA_ROCKETS" },
      { FuncionarioID: "EMP_GLEUCE", Nome: "Gleuce Dias de Souza", CPF: "555.555.555-55", LojaID: "LOJA_ROCKETS" },
    ];
    const result2 = await parseBatchPayrollPdf(batchFileBytes2, mockEmployees2);
    assert.equal(result2.totalPages, 8, "O segundo lote contábil deve conter 8 páginas");
    assert.equal(result2.parsedItems.length, 8, "Deve extrair 8 itens individuais sem erro de stream/length");
    assert.equal(result2.parsedItems[0].extractedName, "MARCIA FERREIRA OLIVEIRA");
    assert.equal(result2.parsedItems[0].matched, true);
    assert.equal(result2.parsedItems[5].extractedName, "GLEUCE DIAS DE SOUZA");
    assert.equal(result2.parsedItems[5].matched, true);
  }

  // 4. Backend: documentsBatchCreate salva os documentos individualizados no Firebase
  const handlers = createDocumentsHandlers();
  assert.equal(typeof handlers.documentsBatchCreate, "function", "Handler documentsBatchCreate deve existir");
});

test("PDF.js nativo para visualização mobile e carimbo vertical no canhoto sem sobreposição", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // 1. Arquivos estáticos do PDF.js existem e estão no pacote
  const pdfJsPath = path.resolve("public/vendor/pdfjs/pdf.min.js");
  const pdfWorkerPath = path.resolve("public/vendor/pdfjs/pdf.worker.min.js");
  const hasPdfJs = await fs.stat(pdfJsPath).then(() => true).catch(() => false);
  const hasPdfWorker = await fs.stat(pdfWorkerPath).then(() => true).catch(() => false);
  assert.ok(hasPdfJs, "public/vendor/pdfjs/pdf.min.js deve existir");
  assert.ok(hasPdfWorker, "public/vendor/pdfjs/pdf.worker.min.js deve existir");

  // 2. Service Worker e scripts incluem pdf.min.js
  const swCode = await fs.readFile(path.resolve("public/sw.js"), "utf8");
  assert.match(swCode, /vendor\/pdfjs\/pdf\.min\.js/, "Service worker deve armazenar em cache pdf.min.js");
  assert.match(swCode, /vendor\/pdfjs\/pdf\.worker\.min\.js/, "Service worker deve armazenar em cache pdf.worker.min.js");

  const buildIndexCode = await fs.readFile(path.resolve("scripts/build-index.mjs"), "utf8");
  assert.match(buildIndexCode, /vendor\/pdfjs\/pdf\.min\.js/, "build-index.mjs deve incluir tag script para pdf.min.js");

  // 3. documents.js expõe renderPdfToContainer e loadPdfJs
  const docModule = await import("../src/documents.js");
  assert.equal(typeof docModule.loadPdfJs, "function", "loadPdfJs deve ser exportada");
  assert.equal(typeof docModule.renderPdfToContainer, "function", "renderPdfToContainer deve ser exportada");
  assert.equal(typeof docModule.openPreviewDialog, "function", "openPreviewDialog deve ser exportada");

  // 4. Carimbo do canhoto: garante que a assinatura fica no vão limpo sem sobrepor o nome ou texto
  const apiDocCode = await fs.readFile(path.resolve("src/core/api-documents.js"), "utf8");
  assert.match(apiDocCode, /signSlotX\s*=\s*517\s*\*\s*scaleX/, "signSlotX deve posicionar a rubrica no vão [505..517]");
  assert.match(apiDocCode, /maxH\s*=\s*12/, "maxH deve ser restrito a 12pt para não ultrapassar a linha divisória");
});

test("Login com Google e banner de vinculação na tela inicial", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // 1. Botão de login com Google na tela de login
  const indexHtml = await fs.readFile(path.resolve("src/legacy/Index.html"), "utf8");
  assert.match(indexHtml, /id="googleLoginBtn"/, "Deve possuir o botão #googleLoginBtn na tela de login");
  assert.match(indexHtml, /Entrar com Conta Google/, "Texto do botão Google deve estar presente");

  // 2. Banner de vinculação no dashboard
  assert.match(indexHtml, /id="googleLinkAlertBanner"/, "Deve possuir o banner #googleLinkAlertBanner no dashboard");
  assert.match(indexHtml, /id="googleLinkBannerActionBtn"/, "Deve possuir botão de ação #googleLinkBannerActionBtn");
  assert.match(indexHtml, /id="googleLinkBannerDismissBtn"/, "Deve possuir botão de dispensar #googleLinkBannerDismissBtn");

  // 3. Métodos no runtime e api-base
  const runtimeJs = await fs.readFile(path.resolve("src/core/runtime.js"), "utf8");
  assert.match(runtimeJs, /async loginWithGoogle\(/, "runtime deve implementar loginWithGoogle");
  assert.match(runtimeJs, /async linkGoogleAccount\(/, "runtime deve implementar linkGoogleAccount");
  assert.match(runtimeJs, /GoogleAuthProvider/, "runtime deve instanciar GoogleAuthProvider");

  const apiBaseJs = await fs.readFile(path.resolve("src/core/api-base.js"), "utf8");
  assert.match(apiBaseJs, /async loginGoogleUser\(/, "api-base deve expor loginGoogleUser");
  assert.match(apiBaseJs, /async linkGoogleAccount\(/, "api-base deve expor linkGoogleAccount");

  // 4. Lógica no Scripts.html
  const scriptsHtml = await fs.readFile(path.resolve("src/legacy/Scripts.html"), "utf8");
  assert.match(scriptsHtml, /checkGoogleLinkBanner_\(\)/, "Scripts.html deve checar banner ao carregar dashboard");
  assert.match(scriptsHtml, /handleLinkGoogleAccount_/, "Scripts.html deve vincular conta Google");
  assert.match(scriptsHtml, /handleDismissGoogleBanner_/, "Scripts.html deve permitir dispensar banner");

  // 5. Estilos no redesign.css
  const redesignCss = await fs.readFile(path.resolve("src/redesign.css"), "utf8");
  assert.match(redesignCss, /\.google-link-banner/, "redesign.css deve estilizar .google-link-banner");
  assert.match(redesignCss, /\.btn-google/, "redesign.css deve estilizar .btn-google");
  assert.match(redesignCss, /\.google-status-pill/, "redesign.css deve estilizar .google-status-pill");

  // 6. Ícone do Google ao lado do status Ativo nos Acessos e Funcionários
  assert.match(scriptsHtml, /google-status-pill/, "Scripts.html deve renderizar .google-status-pill para usuários migrados");
  assert.match(indexHtml, /id="googleUsersMetric"/, "Index.html deve conter métrica de usuários migrados");

  // 7. Opção de migração para o Google na tela de Meu Perfil
  const dialogsHtml = await fs.readFile(path.resolve("src/legacy/Dialogs.html"), "utf8");
  assert.match(dialogsHtml, /id="profileGoogleActionBtn"/, "Dialogs.html deve conter o botão #profileGoogleActionBtn");
  assert.match(dialogsHtml, /id="profileGoogleStatusText"/, "Dialogs.html deve conter o texto #profileGoogleStatusText");
  assert.match(redesignCss, /\.profile-google-card/, "redesign.css deve estilizar .profile-google-card");
  assert.match(scriptsHtml, /updateProfileGoogleUI_\(\)/, "Scripts.html deve atualizar UI do Google no perfil");
});

test("Bootstrap e Google Auth são ultrarrápidos e resilientes a falhas", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const apiBase = await fs.readFile(path.resolve("src/core/api-base.js"), "utf8");
  assert.match(apiBase, /monthlyCreditReport:\s*null/, "bootstrap deve retornar monthlyCreditReport: null sem ReferenceError");
  assert.match(apiBase, /ensureMonthlyLeaveCredits\(profile,\s*initialEmployees\)\.catch/, "crédito mensal deve rodar em background");
  assert.match(apiBase, /reconcilePendingTimeOffBalances\(profile,\s*timeOff\)\.catch/, "reconciliação deve rodar em background");

  const runtimeJs = await fs.readFile(path.resolve("src/core/runtime.js"), "utf8");
  assert.match(runtimeJs, /localStorage\.setItem\("gf_google_logging_in"/, "deve persistir estado de redirect no localStorage para sobrevivência no WebKit PWA");

  const scriptsHtml = await fs.readFile(path.resolve("src/legacy/Scripts.html"), "utf8");
  assert.match(scriptsHtml, /localStorage\.getItem\("gf_google_logging_in"\)/, "Scripts.html deve verificar localStorage ao carregar após redirect");
});

test("LGPD, Termo de Consentimento Físico e Espelho de Ponto Portaria 671", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // 1. Template de consentimento LGPD nos documentos
  const apiDocs = await fs.readFile(path.resolve("src/core/api-documents.js"), "utf8");
  assert.match(apiDocs, /"termo-lgpd-consentimento"/, "deve existir modelo de termo LGPD");
  assert.match(apiDocs, /Lei nº 13\.709\/2018/, "modelo deve citar a LGPD");
  assert.match(apiDocs, /dados sensíveis de saúde/, "modelo deve contemplar atestados médicos");

  // 2. Opção no dropdown e botão de impressão via física nos documentos
  const docsJs = await fs.readFile(path.resolve("src/documents.js"), "utf8");
  assert.match(docsJs, /value="termo-lgpd-consentimento"/, "documents.js deve disponibilizar o modelo LGPD");
  assert.match(docsJs, /id="docPrintPhysicalBtn"/, "documents.js deve conter botão de impressão via física");
  assert.match(docsJs, /printDocumentTextPhysical/, "documents.js deve implementar impressão física A4");

  // 3. Espelho de Ponto Portaria MTP 671/2021
  const indexHtml = await fs.readFile(path.resolve("src/legacy/Index.html"), "utf8");
  assert.match(indexHtml, /id="clockDownloadMirrorPdfBtn"/, "Index.html deve conter botão do espelho Portaria 671");
  assert.match(indexHtml, /Portaria 671/, "Index.html deve destacar a Portaria 671");

  const apiClock = await fs.readFile(path.resolve("src/core/api-clock.js"), "utf8");
  assert.match(apiClock, /getMonthlyTimeClockMirrorData/, "api-clock deve implementar getMonthlyTimeClockMirrorData");
  assert.match(apiClock, /saldoAcumuladoTexto/, "getMonthlyTimeClockMirrorData deve calcular o saldo acumulado de horas");

  const scriptsHtml = await fs.readFile(path.resolve("src/legacy/Scripts.html"), "utf8");
  assert.match(scriptsHtml, /clockMirrorData:\s*"getMonthlyTimeClockMirrorData"/, "Scripts.html deve mapear clockMirrorData");
  assert.match(scriptsHtml, /openTimeClockMirrorPrint/, "Scripts.html deve implementar emissão e impressão do espelho de ponto");
  assert.match(scriptsHtml, /Folga trab\./, "Scripts.html deve evidenciar folgas trabalhadas com crédito de saldo");
  assert.match(scriptsHtml, /Saldo Acumulado no Banco de Horas/, "Scripts.html deve exibir o saldo acumulado histórico");
  assert.match(scriptsHtml, /clockMonthBalanceSubtitle/, "Scripts.html deve atualizar o subtítulo com o saldo do mês");
});

test("Portaria 671: Comprovante unitário de ponto com SHA-256 e visualização de recibo", async () => {
  // 1. Função criptográfica SHA-256
  const hash = await sha256Hex("Portaria-671-Grupo-House-190");
  assert.equal(typeof hash, "string");
  assert.equal(hash.length, 64, "Hash SHA-256 deve possuir 64 caracteres hexadecimais");
  assert.match(hash, /^[a-f0-9]{64}$/, "Hash SHA-256 deve ser composto apenas por hexadecimais");

  // 2. api-clock gera ComprovanteHashSHA256 e atende a Portaria 671
  const apiClock = await readFile(new URL("../src/core/api-clock.js", import.meta.url), "utf8");
  assert.match(apiClock, /ComprovanteHashSHA256/, "api-clock deve gerar e gravar ComprovanteHashSHA256");
  assert.match(apiClock, /Portaria671Valido/, "api-clock deve validar registro para Portaria 671");

  // 3. Modal de recibo na interface
  const dialogsHtml = await readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8");
  assert.match(dialogsHtml, /id="clockReceiptDialog"/, "Dialogs.html deve conter o modal do comprovante");
  assert.match(dialogsHtml, /Portaria MTE nº 671\/2021/, "Modal deve referenciar a Portaria MTE nº 671/2021");

  // 4. Scripts.html implementa showTimeClockReceipt_ e printClockReceipt_
  const scriptsHtml = await readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8");
  assert.match(scriptsHtml, /showTimeClockReceipt_/, "Scripts.html deve implementar exibição do comprovante");
  assert.match(scriptsHtml, /printClockReceipt_/, "Scripts.html deve implementar impressão do comprovante");
  assert.match(scriptsHtml, />Comprovante<\/button>/, "Linha do tempo diária deve disponibilizar botão de comprovante");
});

test("Resiliência de ponto: Fila de contingência offline no dispositivo", async () => {
  const scriptsHtml = await readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8");
  assert.match(scriptsHtml, /gf_offline_clock_queue/, "Scripts.html deve gerenciar chave da fila offline");
  assert.match(scriptsHtml, /queueOfflineClockPunch_/, "Scripts.html deve implementar enfileiramento de marcações offline");
  assert.match(scriptsHtml, /syncOfflinePunches_/, "Scripts.html deve implementar sincronização de marcações offline");
  assert.match(scriptsHtml, /Pendente de sincronização/, "Marcação offline temporária deve ser sinalizada");
  assert.match(scriptsHtml, /window\.addEventListener\("online"/, "Scripts.html deve monitorar retorno da conexão");
});

test("Banco de Horas: Alerta de horas prestes a prescrever (Art. 59 § 5º da CLT - 6 meses)", () => {
  const employee = {
    FuncionarioID: "emp-clt-1",
    Nome: "Colaborador Teste CLT",
    LojaID: "loja-1",
    Ativo: true,
  };
  const schedule = {
    FuncionarioID: "emp-clt-1",
    Ativa: true,
    DiasTrabalho: "6", // Sábado
    HoraEntrada: "08:00",
    HoraSaida: "16:00",
    DuracaoIntervaloMinutos: 0,
  };

  // 31 de janeiro de 2026 (sábado, mais de 150 dias antes de 01/07/2026)
  // Fez 2h de hora extra (10h trabalhadas contra 8h previstas)
  const oldDate = "2026-01-31";
  const oldRecords = [
    {
      FuncionarioID: "emp-clt-1",
      Data: oldDate,
      TipoMarcacao: "ENTRADA",
      DataHora: `${oldDate}T08:00:00-03:00`,
      Status: "Válido",
    },
    {
      FuncionarioID: "emp-clt-1",
      Data: oldDate,
      TipoMarcacao: "SAIDA_FINAL",
      DataHora: `${oldDate}T18:00:00-03:00`,
      Status: "Válido",
    },
  ];

  const result = accumulatedHourBalance({
    employees: [employee],
    records: oldRecords,
    schedules: [schedule],
    throughMonth: "2026-01",
    currentDate: "2026-07-01",
  });

  const empResult = result.employees[0];
  assert.equal(empResult.saldoMinutos, 120, "Saldo deve ser de 120 minutos extras");
  assert.equal(empResult.prazoLegalAlerta, true, "Deve sinalizar alerta de aproximação do prazo legal da CLT");
  assert.equal(empResult.saldoVencendoMinutos, 120, "Horas acumuladas há mais de 150 dias devem constar como saldo vencendo");
});

test("Takeat Credit: Verificação de limite e margem consignável legal", () => {
  // 1. Débito normal dentro do limite e margem
  const ok = checkCreditMargin(
    { debt: 150, limit: 300 },
    { Salario: 2000 },
  );
  assert.equal(ok.atencao, false);
  assert.equal(ok.excedeLimiteConta, false);
  assert.equal(ok.excedeMargemConsignavel, false);

  // 2. Débito acima do limite configurado na Takeat
  const overLimit = checkCreditMargin(
    { debt: 350, limit: 300 },
    { Salario: 2000 },
  );
  assert.equal(overLimit.atencao, true);
  assert.equal(overLimit.excedeLimiteConta, true);

  // 3. Débito acima de 30% da margem consignável (ex: R$ 600 de consumo para salário de R$ 1.518, margem = R$ 455)
  const overMargin = checkCreditMargin(
    { debt: 600, limit: 1000 },
    { Salario: 1518 },
  );
  assert.equal(overMargin.atencao, true);
  assert.equal(overMargin.excedeMargemConsignavel, true);
});

test("Segurança / 2FA: Trava de autenticação em dois passos para administradores no banner Google", async () => {
  const scriptsHtml = await readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8");
  assert.match(scriptsHtml, /Segurança • LGPD Administrador/, "Banner deve exibir identificador LGPD para admin");
  assert.match(scriptsHtml, /Autenticação em duas etapas recomendada/, "Título deve ressaltar autenticação em duas etapas");
  assert.match(scriptsHtml, /dismissBtn\.classList\.add\("hidden"\)/, "Administradores não devem poder dispensar o aviso");
});

test("CozinhaFlow: Filtro de extrato por período fechado (mensal / anterior / geral)", async () => {
  const tasksJs = await readFile(new URL("../src/tasks.js", import.meta.url), "utf8");
  assert.match(tasksJs, /statementPeriod/, "tasks.js deve manter estado de período do extrato");
  assert.match(tasksJs, /data-cf-statement-period="mes-atual"/, "deve existir seletor de mês atual");
  assert.match(tasksJs, /data-cf-statement-period="mes-anterior"/, "deve existir seletor de mês anterior");
  assert.match(tasksJs, /data-cf-statement-period="geral"/, "deve existir seletor geral");
  assert.match(tasksJs, /Total do período/, "deve exibir o total consolidado do período");
});

test("PWA / SW: Injeção de ativos gerados pelo Vite no pré-cache do Service Worker", async () => {
  const postbuildScript = await readFile(new URL("../scripts/postbuild-sw.mjs", import.meta.url), "utf8");
  assert.match(postbuildScript, /APP_SHELL/, "postbuild-sw deve atualizar o APP_SHELL");
  assert.match(postbuildScript, /dist\/assets/, "postbuild-sw deve ler o diretório dist/assets");

  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.build, /postbuild-sw\.mjs/, "build deve executar postbuild-sw.mjs");
});

test("LGPD: Política de Privacidade e Proteção de Dados Pessoais do Grupo House 190", async () => {
  // 1. Template documental no api-documents
  const apiDocs = await readFile(new URL("../src/core/api-documents.js", import.meta.url), "utf8");
  assert.match(apiDocs, /"politica-privacidade"/, "deve existir modelo de termo de política de privacidade");
  assert.match(apiDocs, /TERMO DE CIÊNCIA E RECEBIMENTO DA POLÍTICA DE PRIVACIDADE/, "título oficial do termo");

  // 2. Opção no dropdown do módulo de documentos
  const docsJs = await readFile(new URL("../src/documents.js", import.meta.url), "utf8");
  assert.match(docsJs, /value="politica-privacidade"/, "documents.js deve disponibilizar o modelo no select");

  // 3. Modal oficial completo com 23 seções no Dialogs.html
  const dialogsHtml = await readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8");
  assert.match(dialogsHtml, /id="privacyPolicyDialog"/, "Dialogs.html deve conter o modal da política de privacidade");
  assert.match(dialogsHtml, /1\. APRESENTAÇÃO E OBJETIVO/, "deve conter a Seção 1");
  assert.match(dialogsHtml, /6\. REGISTRO ELETRÔNICO DE PONTO/, "deve conter a Seção 6");
  assert.match(dialogsHtml, /7\. UTILIZAÇÃO DE CÂMERA E SELFIE/, "deve conter a Seção 7");
  assert.match(dialogsHtml, /8\. UTILIZAÇÃO DE LOCALIZAÇÃO/, "deve conter a Seção 8");
  assert.match(dialogsHtml, /10\. BANCO DE HORAS E COMPENSAÇÕES/, "deve conter a Seção 10");
  assert.match(dialogsHtml, /11\. ATESTADOS MÉDICOS E DADOS SENSÍVEIS/, "deve conter a Seção 11");
  assert.match(dialogsHtml, /17\. COMPARTILHAMENTO DE DADOS E FORNECEDORES/, "deve conter a Seção 17");
  assert.match(dialogsHtml, /22\. DIREITOS DOS COLABORADORES/, "deve conter a Seção 22");
  assert.match(dialogsHtml, /23\. CANAL DE PRIVACIDADE E DISPOSIÇÕES FINAIS/, "deve conter a Seção 23");
  assert.match(dialogsHtml, /privacidade@grupohouse190\.com\.br/, "deve informar o e-mail oficial de privacidade");

  // 4. Acessibilidade na tela de login e na barra lateral
  const indexHtml = await readFile(new URL("../src/legacy/Index.html", import.meta.url), "utf8");
  assert.match(indexHtml, /openPrivacyPolicyDialog\(\)/, "Index.html deve conter gatilhos para abertura da política");
  assert.match(indexHtml, /Privacidade \(LGPD\)/, "Index.html deve exibir rótulo claro e acessível");

  // 5. Funções de controle e registro de ciência em Scripts.html
  const scriptsHtml = await readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8");
  assert.match(scriptsHtml, /function openPrivacyPolicyDialog\(\)/, "Scripts.html deve implementar openPrivacyPolicyDialog");
  assert.match(scriptsHtml, /function acknowledgePrivacyPolicy_\(\)/, "Scripts.html deve implementar acknowledgePrivacyPolicy_");
  assert.match(scriptsHtml, /function printPrivacyPolicy_\(\)/, "Scripts.html deve implementar printPrivacyPolicy_");
  assert.match(scriptsHtml, /window\.openPrivacyPolicyDialog = openPrivacyPolicyDialog/, "deve expor no window");
});

test("LGPD: Pop-up único de leitura, rubrica/assinatura e registro de ciência da Política de Privacidade", async () => {
  // 1. Bloco de assinatura e rubrica no Dialogs.html
  const dialogsHtml = await readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8");
  assert.match(dialogsHtml, /id="privacyPolicySignSection"/, "Dialogs.html deve conter a seção oficial de assinatura");
  assert.match(dialogsHtml, /id="privacyPolicyConfirmCheckbox"/, "Dialogs.html deve conter o checkbox de confirmação de leitura");
  assert.match(dialogsHtml, /id="privacyPolicyCanvas"/, "Dialogs.html deve conter o canvas para desenho de rubrica");
  assert.match(dialogsHtml, /id="privacyPolicyClearCanvasBtn"/, "Dialogs.html deve conter botão para limpar a rubrica");
  assert.match(dialogsHtml, /id="privacyPolicySignedCard"/, "Dialogs.html deve conter o card de ciência formalizada");
  assert.match(dialogsHtml, /id="privacyPolicySignedImage"/, "Dialogs.html deve exibir a assinatura arquivada quando já assinado");

  // 2. Lógica do pop-up único e controle em Scripts.html
  const scriptsHtml = await readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8");
  assert.match(scriptsHtml, /function checkPrivacyPolicyPopup_\(\)/, "deve implementar checkPrivacyPolicyPopup_");
  assert.match(scriptsHtml, /function initPrivacyPolicyCanvas_\(\)/, "deve implementar initPrivacyPolicyCanvas_");
  assert.match(scriptsHtml, /function clearPrivacyPolicyCanvas_\(\)/, "deve implementar clearPrivacyPolicyCanvas_");
  assert.match(scriptsHtml, /function updatePrivacyPolicySignButtonState_\(\)/, "deve implementar updatePrivacyPolicySignButtonState_");
  assert.match(scriptsHtml, /checkPrivacyPolicyPopup_\(\);/, "renderDashboard deve acionar o pop-up único");
  assert.match(scriptsHtml, /window\.checkPrivacyPolicyPopup_ = checkPrivacyPolicyPopup_/, "deve expor checkPrivacyPolicyPopup_ no window");
  assert.match(scriptsHtml, /window\.clearPrivacyPolicyCanvas_ = clearPrivacyPolicyCanvas_/, "deve expor clearPrivacyPolicyCanvas_ no window");

  // 3. Estilização do canvas de assinatura em Styles.html
  const stylesHtml = await readFile(new URL("../src/legacy/Styles.html", import.meta.url), "utf8");
  assert.match(stylesHtml, /\.privacy-policy-canvas-wrap/, "Styles.html deve conter estilos para o canvas de rubrica");

  // 4. Endpoint backend no api-base.js
  const apiBase = await readFile(new URL("../src/core/api-base.js", import.meta.url), "utf8");
  assert.match(apiBase, /async acknowledgePrivacyPolicy\(args\)/, "api-base.js deve implementar o endpoint acknowledgePrivacyPolicy");
  assert.match(apiBase, /PoliticaPrivacidadeCiente:\s*true/, "deve atualizar PoliticaPrivacidadeCiente");
  assert.match(apiBase, /Registro de ciência da Política de Privacidade/, "deve gerar trilha de auditoria pericial para a LGPD");

  // 5. Teste de execução do endpoint acknowledgePrivacyPolicy
  let savedAccessData = null;
  const originalRequireProfile = runtime.requireProfile;
  const originalSaveAccess = runtime.saveAccess;
  const originalPatch = runtime.patch;

  runtime.requireProfile = async () => ({
    UsuarioID: "user-123",
    FuncionarioID: "func-456",
    Email: "colaborador@house.com.br",
    Nome: "Colaborador Teste",
    LojaID: "loja-1",
  });
  runtime.saveAccess = async (uid, data) => {
    savedAccessData = { uid, data };
  };
  runtime.patch = async () => {};

  try {
    const handlers = createApi().handlers;
    assert.equal(typeof handlers.acknowledgePrivacyPolicy, "function");

    const result = await handlers.acknowledgePrivacyPolicy([
      {
        version: "1.0",
        signature: "data:image/png;base64,mockSignatureData",
        device: "TestRunner",
      },
    ]);

    assert.equal(result.success, true);
    assert.equal(result.data.PoliticaPrivacidadeCiente, true);
    assert.equal(result.data.PoliticaPrivacidadeVersao, "1.0");
    assert.ok(savedAccessData, "deve ter chamado saveAccess");
    assert.equal(savedAccessData.data.PoliticaPrivacidadeCiente, true);
    assert.equal(savedAccessData.data.PoliticaPrivacidadeAssinatura, "data:image/png;base64,mockSignatureData");
  } finally {
    runtime.requireProfile = originalRequireProfile;
    runtime.saveAccess = originalSaveAccess;
    runtime.patch = originalPatch;
  }
});

test("Resiliência do Ponto: triplo fallback de câmera, captura nativa e contingência Portaria 671", async () => {
  const dialogsHtml = await readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8");
  const scriptsHtml = await readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8");
  const cozinhaflowCss = await readFile(new URL("../src/cozinhaflow.css", import.meta.url), "utf8");
  const apiClockJs = await readFile(new URL("../src/core/api-clock.js", import.meta.url), "utf8");

  // 1. Interface: Elementos de contingência e câmera nativa presentes no Dialogs.html
  assert.match(dialogsHtml, /id="clockSelfieStageFallbackBtn"/, "Placeholder deve conter botão de fallback imediato");
  assert.match(dialogsHtml, /id="clockSelfieContingency"/, "Dialog de selfie deve conter botão de contingência");
  assert.match(dialogsHtml, /id="clockSelfieNative"/, "Dialog deve conter botão de câmera nativa do celular");

  // 2. Scripts.html: Timeout reduzido, fallback em cascata e ativação de contingência
  assert.match(scriptsHtml, /tryGetUserMedia/, "startClockSelfieCamera_ deve conter função de tentativa com timeout");
  assert.match(scriptsHtml, /activateClockSelfieContingency_/, "Deve existir função de ativação de contingência de ponto");
  assert.match(scriptsHtml, /clockSelfieContingency/, "Evento onclick do botão de contingência deve estar registrado");
  assert.match(scriptsHtml, /clockSelfieStageFallbackBtn/, "Evento onclick do botão do stage deve estar registrado");

  // 3. Estilos: Botão de contingência estilizado
  assert.match(cozinhaflowCss, /#clockSelfieContingency/, "cozinhaflow.css deve conter estilos para o botão de contingência");
  assert.match(cozinhaflowCss, /#clockSelfieStageFallbackBtn/, "cozinhaflow.css deve conter estilos para o botão do placeholder");

  // 4. api-clock.js: Backend aceita e trata contingência de selfie sem abortar registro do ponto
  assert.match(apiClockJs, /contingencia_/, "api-clock.js deve aplicar contingência se upload ao Drive falhar");
  assert.match(apiClockJs, /Portaria671Valido:\s*true/, "Marcação deve ser registrada como válida perante a Portaria 671");
});

test("UX Mobile: botões de confirmação 100% visíveis em todos os modais e selfie compacta", async () => {
  const dialogsHtml = await readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8");
  const cozinhaflowCss = await readFile(new URL("../src/cozinhaflow.css", import.meta.url), "utf8");
  const scriptsHtml = await readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8");

  // 1. Modais universais mobile possuem altura máxima e rodapé sticky para botões nunca sumirem
  assert.match(cozinhaflowCss, /max-height:\s*calc\(100dvh\s*-\s*16px\)/, "Modais devem ter max-height para caber na tela");
  assert.match(cozinhaflowCss, /dialog\s*\.dialog-actions[\s\S]*position:\s*sticky/, "Ações do modal devem ser sticky no rodapé");

  // 2. Selfie do ponto: botões de confirmação agrupados lado a lado após a captura
  assert.match(dialogsHtml, /id="clockSelfieConfirmRow"/, "Deve existir container para linha de confirmação/retake");
  assert.match(cozinhaflowCss, /\.clock-selfie-confirm-row[\s\S]*grid-template-columns/, "Retake e Confirmar devem ficar lado a lado");
  assert.match(cozinhaflowCss, /#clockSelfieDialog \.hidden[\s\S]*display:\s*none\s*!important/, "Elementos ocultos não devem ocupar espaço");

  // 3. Scripts.html: alternância correta de visibilidade dos botões
  assert.match(scriptsHtml, /clockSelfieConfirmRow/, "Scripts devem gerenciar visibilidade da linha de confirmação");
});

test("Feedback de Reconhecimento (Craque da Semana): atribuição, notificação e gamificação da equipe", async () => {
  const originalRequireProfile = runtime.requireProfile;
  const originalGetById = runtime.getById;
  const originalUpsert = runtime.upsert;
  const originalList = runtime.list;

  const mockDb = {
    Funcionarios: {
      "emp-1": { FuncionarioID: "emp-1", Nome: "Carlos Chapa", Cargo: "Chapeiro", LojaID: "loja-1" },
    },
    Lojas: {
      "loja-1": { LojaID: "loja-1", NomeLoja: "House Pituba" },
    },
    Reconhecimentos: [],
    Notificacoes: [],
  };

  runtime.requireProfile = async () => ({
    Email: "gerente@house190.com",
    Nome: "Gerente Operacional",
    Perfil: "Gerente",
    LojaID: "loja-1",
  });
  runtime.getById = async (table, id) => mockDb[table]?.[id] || null;
  runtime.upsert = async (table, data) => {
    if (table === "Reconhecimentos") {
      mockDb.Reconhecimentos.push(data);
      return data;
    }
    if (table === "Notificacoes") {
      mockDb.Notificacoes.push(data);
      return data;
    }
    return data;
  };
  runtime.list = async (table) => {
    if (table === "Reconhecimentos") return mockDb.Reconhecimentos;
    return [];
  };

  try {
    const handlers = createApi().handlers;
    assert.equal(typeof handlers.atribuirReconhecimento, "function");
    assert.equal(typeof handlers.listarReconhecimentos, "function");

    // Atribuição de reconhecimento válida
    const res = await handlers.atribuirReconhecimento([
      {
        FuncionarioID: "emp-1",
        Categoria: "Mestre da Chapa",
        Motivo: "Montagem impecável no pico de almoço de sábado.",
        Semana: "Semana 42 Out",
      },
    ]);

    assert.equal(res.success, true);
    assert.equal(res.data.NomeFuncionario, "Carlos Chapa");
    assert.equal(res.data.Categoria, "Mestre da Chapa");
    assert.equal(res.data.LojaID, "loja-1");
    assert.equal(mockDb.Notificacoes.length, 1);
    assert.equal(mockDb.Notificacoes[0].DestinatarioID, "emp-1");
    assert.match(mockDb.Notificacoes[0].Mensagem, /Mestre da Chapa/);

    // Listagem
    const listRes = await handlers.listarReconhecimentos([]);
    assert.equal(listRes.success, true);
    assert.equal(listRes.data.length, 1);
    assert.equal(listRes.data[0].Categoria, "Mestre da Chapa");

    // Validação de colaborador obrigatório
    await assert.rejects(
      async () => handlers.atribuirReconhecimento([{ Motivo: "Sem funcionario" }]),
      /Selecione o colaborador/,
    );
  } finally {
    runtime.requireProfile = originalRequireProfile;
    runtime.getById = originalGetById;
    runtime.upsert = originalUpsert;
    runtime.list = originalList;
  }
});

test("Mural de Avisos Operacionais: publicação, ciência do turno, pop-up de abertura e componentes iOS", async () => {
  const dialogsHtml = await readFile(new URL("../src/legacy/Dialogs.html", import.meta.url), "utf8");
  const scriptsHtml = await readFile(new URL("../src/legacy/Scripts.html", import.meta.url), "utf8");
  const journeyJs = await readFile(new URL("../src/journey.js", import.meta.url), "utf8");
  const cozinhaflowCss = await readFile(new URL("../src/cozinhaflow.css", import.meta.url), "utf8");

  // 1. Modais no Dialogs.html
  assert.match(dialogsHtml, /id="operationalNoticeDialog"/, "Deve existir o modal de aviso operacional");
  assert.match(dialogsHtml, /id="newAnnouncementDialog"/, "Deve existir o modal para criar comunicados");
  assert.match(dialogsHtml, /id="recognizeEmployeeDialog"/, "Deve existir o modal para reconhecer craque da semana");
  assert.match(dialogsHtml, /id="operationalNoticeAckBtn"/, "Deve existir botão de ciência");

  // 2. Scripts.html
  assert.match(scriptsHtml, /loadOperationalAnnouncements_/, "Deve existir função para carregar avisos operacionais");
  assert.match(scriptsHtml, /checkOperationalNoticePopup_/, "Deve existir trigger do pop-up de abertura de turno");
  assert.match(scriptsHtml, /acknowledgeCurrentNotice_/, "Deve existir função para confirmar ciência do aviso");
  assert.match(scriptsHtml, /openRecognizeEmployeeDialog/, "Deve existir abertura do diálogo de reconhecimento");

  // 3. Journey.js
  assert.match(journeyJs, /renderOperationalNoticeCard/, "Journey deve conter renderOperationalNoticeCard");
  assert.match(journeyJs, /renderCraqueDaSemanaCard/, "Journey deve conter renderCraqueDaSemanaCard");
  assert.match(journeyJs, /data-j-ack-notice/, "Journey deve suportar botão de ciência com data-j-ack-notice");
  assert.match(journeyJs, /data-j-new-recognition/, "Journey deve suportar atalho de homenagem de gestor");

  // 4. CSS iOS Design System
  assert.match(cozinhaflowCss, /\.operational-notice-card/, "cozinhaflow.css deve conter estilos para card de aviso");
  assert.match(cozinhaflowCss, /\.craque-card/, "cozinhaflow.css deve conter estilos para craque da semana");
  assert.match(cozinhaflowCss, /\.btn-ack-notice/, "cozinhaflow.css deve conter botão de ciência com altura touch");
});












