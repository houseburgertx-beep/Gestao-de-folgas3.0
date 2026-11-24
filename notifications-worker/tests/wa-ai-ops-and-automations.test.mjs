import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createECDH } from "node:crypto";
import webpush from "web-push";
import worker, { tick } from "../src/index.js";
import { createEmployeeTools, runGroqConversation } from "../src/wa-chat.js";
import { processInboundHouseAI } from "../src/house-ai.js";
import { isAutomationEnabled } from "../src/notification-relay.js";

const now = Date.parse("2026-11-24T18:00:00Z"); // 15:00 Bahia

const adminEmp = {
  FuncionarioID: "wa-admin:5573991915552",
  LojaID: "",
  Nome: "Bruno Admin",
  Email: "bruno@house190.test",
  Perfil: "Administrador",
  Ativo: true,
};
const managerEmp = {
  FuncionarioID: "mgr1",
  LojaID: "loja-tx",
  Nome: "Carlos Gerente",
  NomeLoja: "House 190 Teixeira",
  Email: "carlos@house190.test",
  Perfil: "Gerente",
  Telefone: "5573999000001",
  Ativo: true,
};
const workerEmp = {
  FuncionarioID: "emp1",
  LojaID: "loja-tx",
  Nome: "Maria Souza",
  NomeLoja: "House 190 Teixeira",
  Email: "maria@house190.test",
  Cargo: "Atendente",
  Turno: "Noite",
  Perfil: "Funcionário",
  Telefone: "5573999111222",
  SaldoFolgas: 3,
  Ativo: true,
};
const otherStoreEmp = {
  FuncionarioID: "emp2",
  LojaID: "loja-eun",
  Nome: "João Eunapolis",
  NomeLoja: "House 190 Eunápolis",
  Email: "joao@house190.test",
  Perfil: "Funcionário",
  Telefone: "5573999333444",
  SaldoFolgas: 4,
  Ativo: true,
};

const baseEnv = {
  GROQ_API_KEY: "test-groq-key",
  FIREBASE_DATABASE_URL: "https://fixture.test",
  FIREBASE_ROOT: "gestao-folgas/v2",
  APP_URL: "https://house.test/",
};

function createFakePatchFetcher(patches) {
  return async (url, opts) => {
    if (opts?.method === "PATCH" && String(url).endsWith("/tables.json")) {
      patches.push(JSON.parse(opts.body));
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
}

test("isAutomationEnabled trata false, 0, 'false' e undefined corretamente", () => {
  assert.equal(isAutomationEnabled({ aut_ponto: false }, "aut_ponto"), false);
  assert.equal(isAutomationEnabled({ aut_ponto: "false" }, "aut_ponto"), false);
  assert.equal(isAutomationEnabled({ aut_ponto: 0 }, "aut_ponto"), false);
  assert.equal(isAutomationEnabled({ aut_ponto: true }, "aut_ponto"), true);
  assert.equal(isAutomationEnabled({}, "aut_ponto"), true);
  assert.equal(isAutomationEnabled(null, "aut_ponto"), true);
});

test("tick() nao envia mensagem de intervalo no WhatsApp quando aut_ponto esta desativado", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_push.sql", import.meta.url), "utf8"));
  const DB = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => stmt.get(...args),
            all: async () => ({ results: stmt.all(...args) }),
            run: async () => ({ meta: { changes: stmt.run(...args).changes } }),
          };
        },
      };
    },
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
  };

  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/interval-test",
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: Buffer.alloc(16, 2).toString("base64url"),
    },
  };
  const tickNow = Date.parse("2026-09-06T18:58:00-03:00");
  db.prepare("INSERT INTO devices VALUES(?,?,?,?,?,?,?)").run(
    sub.endpoint,
    "u1",
    JSON.stringify(sub),
    JSON.stringify({ clock: true, interval: true, notices: false }),
    tickNow - 60000,
    tickNow,
    0
  );

  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const privateKey = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const vapid = webpush.generateVAPIDKeys();

  const env = {
    DB,
    FIREBASE_WEB_API_KEY: "key",
    FIREBASE_CLIENT_EMAIL: "test@example.test",
    FIREBASE_PRIVATE_KEY: privateKey,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "https://house.test",
    FIREBASE_DATABASE_URL: "https://fixture.test",
    FIREBASE_ROOT: "root",
    WA_ENABLED: "true",
    WA_API_URL: "https://wa.fixture.test/api",
    WA_API_KEY: "wa-key",
    WA_SESSION_ID: "house190",
  };

  let pushes = 0;
  const waPayloads = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "tok" });
    if (url.hostname === "fcm.googleapis.com") {
      pushes++;
      return new Response(null, { status: 201 });
    }
    if (url.hostname === "wa.fixture.test") {
      if (url.pathname.includes("/messages/")) waPayloads.push(JSON.parse(init.body));
      return Response.json({ status: true, data: { key: { id: "wa-msg" }, results: [] } });
    }
    if (url.pathname.endsWith("/access.json")) {
      return Response.json({ u1: { FuncionarioID: "f1", LojaID: "l1", Ativo: true, Telefone: "5573999111222" } });
    }
    if (url.pathname.endsWith("/WhatsAppAutomations.json")) {
      return Response.json({ aut_ponto: false, aut_espelho_ponto: false, aut_folga_nova: true });
    }
    const table = url.pathname.split("/").at(-1).replace(".json", "");
    const tables = {
      Funcionarios: { f: { FuncionarioID: "f1", LojaID: "l1", Nome: "Maria", Telefone: "5573999111222", Ativo: true } },
      JornadasPonto: { j: { FuncionarioID: "f1", Ativa: true, HoraEntrada: "16:00", HoraSaida: "23:00", DuracaoIntervaloMinutos: 60 } },
      Folgas: {},
      RegistrosPonto: {
        r: { FuncionarioID: "f1", Data: "2026-09-06", TipoMarcacao: "SAIDA_INTERVALO", DataHora: "2026-09-06T18:03:00-03:00", RegistroPontoID: "r" },
      },
      Notificacoes: {},
    };
    return Response.json(tables[table] || {});
  };

  try {
    await tick(env, tickNow);
    assert.equal(pushes, 1, "Web Push do dispositivo continua funcionando");
    assert.equal(waPayloads.length, 0, "WhatsApp de intervalo e espelho devem ser bloqueados quando aut_ponto=false e aut_espelho_ponto=false");
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("/wa-clock-event bloqueia envio de SAIDA_INTERVALO e RETORNO_INTERVALO quando aut_ponto=false", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const privateKey = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");

  const env = {
    APP_ORIGIN: "https://house.test",
    FIREBASE_WEB_API_KEY: "key",
    FIREBASE_CLIENT_EMAIL: "test@example.test",
    FIREBASE_PRIVATE_KEY: privateKey,
    FIREBASE_DATABASE_URL: "https://fixture.test",
    FIREBASE_ROOT: "root",
    VAPID_PUBLIC_KEY: "x",
    VAPID_PRIVATE_KEY: "x",
    DB: {},
    WA_ENABLED: "true",
    WA_API_URL: "https://wa.fixture.test/api",
    WA_API_KEY: "wa-key",
    WA_SESSION_ID: "house190",
  };

  let waCalled = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "identitytoolkit.googleapis.com") return Response.json({ users: [{ localId: "u1" }] });
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "tok" });
    if (url.hostname === "wa.fixture.test") {
      waCalled++;
      return Response.json({ status: true, data: { key: { id: "msg" } } });
    }
    if (url.pathname.endsWith("/access/u1.json")) {
      return Response.json({ FuncionarioID: "emp1", Nome: "Maria", Telefone: "5573999111222", Ativo: true, Perfil: "Funcionário" });
    }
    if (url.pathname.endsWith("/WhatsAppAutomations.json")) {
      return Response.json({ aut_ponto: false });
    }
    return Response.json({ FuncionarioID: "emp1", Nome: "Maria", Telefone: "5573999111222" });
  };

  try {
    const res = await worker.fetch(
      new Request("https://worker.test/wa-clock-event", {
        method: "POST",
        headers: { Origin: "https://house.test", Authorization: "Bearer fake-jwt", "Content-Type": "application/json" },
        body: JSON.stringify({ type: "SAIDA_INTERVALO", timeStr: "12:00" }),
      }),
      env
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.skipped, true);
    assert.equal(body.reason, "automation_disabled");
    assert.equal(waCalled, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("minha_jornada le HoraEntrada/HoraSaida reais e banco_horas calcula saldo real + dias incompletos", async () => {
  const db = async (_e, _t, path) => {
    const t = path.split("/").at(-1);
    if (t === "JornadasPonto") {
      return {
        j1: {
          FuncionarioID: "emp1",
          Ativa: true,
          VigenteDe: "2026-01-01",
          HoraEntrada: "15:00",
          HoraSaidaIntervalo: "19:00",
          HoraRetornoIntervalo: "20:00",
          HoraSaida: "23:20",
          DuracaoIntervaloMinutos: 60,
          ToleranciaMinutos: 10,
          DiasTrabalho: "0,1,2,3,4,5,6",
        },
      };
    }
    if (t === "RegistrosPonto") {
      return {
        r1: { RegistroPontoID: "r1", FuncionarioID: "emp1", LojaID: "loja-tx", Data: "2026-11-22", TipoMarcacao: "ENTRADA", DataHora: "2026-11-22T15:00:00-03:00", Status: "Válido" },
        r2: { RegistroPontoID: "r2", FuncionarioID: "emp1", LojaID: "loja-tx", Data: "2026-11-22", TipoMarcacao: "SAIDA_INTERVALO", DataHora: "2026-11-22T19:00:00-03:00", Status: "Válido" },
        r3: { RegistroPontoID: "r3", FuncionarioID: "emp1", LojaID: "loja-tx", Data: "2026-11-22", TipoMarcacao: "RETORNO_INTERVALO", DataHora: "2026-11-22T20:00:00-03:00", Status: "Válido" },
        r4: { RegistroPontoID: "r4", FuncionarioID: "emp1", LojaID: "loja-tx", Data: "2026-11-22", TipoMarcacao: "SAIDA_FINAL", DataHora: "2026-11-22T23:50:00-03:00", Status: "Válido" },
        r5: { RegistroPontoID: "r5", FuncionarioID: "emp1", LojaID: "loja-tx", Data: "2026-11-23", TipoMarcacao: "ENTRADA", DataHora: "2026-11-23T15:00:00-03:00", Status: "Válido" },
      };
    }
    return {};
  };

  const exec = createEmployeeTools({ employee: workerEmp, employees: [workerEmp], profile: workerEmp, database: db, env: baseEnv, tok: "tok", now, setPending: () => {} });
  const jornada = await exec("consultar_sistema", { assunto: "minha_jornada", data: "2026-11-24" });
  assert.equal(jornada.entrada, "15:00");
  assert.equal(jornada.intervaloInicio, "19:00");
  assert.equal(jornada.intervaloFim, "20:00");
  assert.equal(jornada.saida, "23:20");

  const saldo = await exec("consultar_sistema", { assunto: "banco_horas" });
  assert.equal(saldo.diasCompletosApurados, 1);
  assert.equal(saldo.saldoMinutos, 30);
  assert.equal(saldo.saldoFormatado, "+00:30");
  assert.equal(saldo.diasComBatidaIncompleta.length, 1);
  assert.equal(saldo.diasComBatidaIncompleta[0].data, "2026-11-23");
});

test("incluir_ponto e alterar_ponto: admin aplica direto auditado; funcionario cria pedido pendente e nao altera colega", async () => {
  const patches = [];
  const waSent = [];
  const db = async (_e, _t, path) => {
    if (path.endsWith("RegistrosPonto")) {
      return {
        p1: { RegistroPontoID: "p1", FuncionarioID: "emp1", NomeFuncionario: "Maria Souza", LojaID: "loja-tx", Data: "2026-11-23", TipoMarcacao: "ENTRADA", DataHora: "2026-11-23T15:00:00-03:00", Status: "Válido" },
      };
    }
    return {};
  };

  // Admin inclui SAIDA_FINAL de Maria direto
  const adminExec = createEmployeeTools({
    employee: adminEmp,
    employees: [workerEmp, otherStoreEmp],
    profile: adminEmp,
    database: db,
    env: baseEnv,
    tok: "tok",
    now,
    setPending: () => {},
    sendWhatsApp: async (m) => { waSent.push(m); return { success: true, messageId: "w1" }; },
    fetcher: createFakePatchFetcher(patches),
  });
  const incRes = await adminExec("executar_acao_operacional", {
    acao: "incluir_ponto",
    funcionario_nome: "Maria",
    data: "2026-11-23",
    horario: "23:15",
    tipo_marcacao: "SAIDA_FINAL",
    motivo: "Esqueceu de bater a saída",
  });
  assert.equal(incRes.ok, true);
  assert.equal(incRes.executadoDireto, true);
  assert.ok(Object.keys(patches[0]).some((k) => k.startsWith("RegistrosPonto/ponto-ai-")));
  assert.equal(waSent.length, 1);

  // Admin altera ENTRADA existente de Maria
  const altRes = await adminExec("executar_acao_operacional", {
    acao: "alterar_ponto",
    funcionario_nome: "Maria",
    data: "2026-11-23",
    tipo_marcacao: "ENTRADA",
    novo_horario: "14:50",
    motivo: "Ajuste autorizado pela gerência",
  });
  assert.equal(altRes.ok, true);
  assert.equal(altRes.executadoDireto, true);
  assert.equal(patches[1]["RegistrosPonto/p1/Hora"], "14:50");
  assert.equal(patches[1]["RegistrosPonto/p1/Ajustado"], true);

  // Funcionário solicita alteração própria -> vai como Pendente em AjustesPonto (nunca altera RegistrosPonto direto)
  const empPatches = [];
  const empExec = createEmployeeTools({
    employee: workerEmp,
    employees: [workerEmp, otherStoreEmp],
    profile: workerEmp,
    database: db,
    env: baseEnv,
    tok: "tok",
    now,
    setPending: () => {},
    fetcher: createFakePatchFetcher(empPatches),
  });
  const empAlt = await empExec("executar_acao_operacional", {
    acao: "alterar_ponto",
    data: "2026-11-23",
    tipo_marcacao: "ENTRADA",
    novo_horario: "14:55",
    motivo: "Celular travou na chegada",
  });
  assert.equal(empAlt.ok, true);
  assert.equal(empAlt.executadoDireto, false);
  assert.ok(Object.keys(empPatches[0]).some((k) => k.startsWith("AjustesPonto/ajuste-ai-")));
  assert.ok(!Object.keys(empPatches[0]).some((k) => k.startsWith("RegistrosPonto/")));

  // Funcionário bloqueado ao tentar alterar ponto de colega
  const blocked = await empExec("executar_acao_operacional", {
    acao: "incluir_ponto",
    funcionario_id: "emp2",
    data: "2026-11-23",
    horario: "18:00",
    tipo_marcacao: "SAIDA_FINAL",
    motivo: "Teste",
  });
  assert.ok(blocked.erro);
});

test("cancelar_folga estorna saldo atomicamente para folga aprovada e respeita RBAC", async () => {
  const patches = [];
  const waSent = [];
  const db = async (_e, _t, path) => {
    if (path.endsWith("Folgas")) {
      return {
        f1: { FolgaID: "f1", FuncionarioID: "emp1", NomeFuncionario: "Maria Souza", LojaID: "loja-tx", DataInicio: "2026-11-28", DataFim: "2026-11-28", Status: "Aprovada" },
        f2: { FolgaID: "f2", FuncionarioID: "emp1", NomeFuncionario: "Maria Souza", LojaID: "loja-tx", DataInicio: "2026-11-29", DataFim: "2026-11-29", Status: "Pendente" },
      };
    }
    return {};
  };

  // Funcionário não pode cancelar folga já aprovada
  const empExec = createEmployeeTools({
    employee: workerEmp,
    employees: [workerEmp],
    profile: workerEmp,
    database: db,
    env: baseEnv,
    tok: "tok",
    now,
    setPending: () => {},
    fetcher: createFakePatchFetcher(patches),
  });
  const denied = await empExec("executar_acao_operacional", { acao: "cancelar_folga", data: "2026-11-28", motivo: "Desisti" });
  assert.ok(denied.erro);
  assert.equal(patches.length, 0);

  // Admin cancela folga aprovada -> estorna +1 no SaldoFolgas e registra MovimentosSaldoFolgas
  const adminExec = createEmployeeTools({
    employee: adminEmp,
    employees: [workerEmp],
    profile: adminEmp,
    database: db,
    env: baseEnv,
    tok: "tok",
    now,
    setPending: () => {},
    sendWhatsApp: async (m) => { waSent.push(m); return { success: true, messageId: "w2" }; },
    fetcher: createFakePatchFetcher(patches),
  });
  const okRes = await adminExec("executar_acao_operacional", {
    acao: "cancelar_folga",
    funcionario_nome: "Maria",
    data: "2026-11-28",
    motivo: "Mudança na escala da noite",
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.estornouSaldo, true);
  assert.equal(patches[0]["Folgas/f1/Status"], "Cancelada");
  assert.deepEqual(patches[0]["Funcionarios/emp1/SaldoFolgas"], { ".sv": { increment: 1 } });
  assert.ok(Object.keys(patches[0]).some((k) => k.startsWith("MovimentosSaldoFolgas/mov-estorno-")));
  assert.equal(waSent.length, 1);
});

test("vales: solicitar, aprovar/pagar com recibo SHA-256 e enviar aviso de vale pelo WhatsApp", async () => {
  const patches = [];
  const waSent = [];
  const db = async (_e, _t, path) => {
    if (path.endsWith("Configuracoes")) return { LimiteMaximoVale: { Valor: "500" } };
    if (path.endsWith("SolicitacoesVale")) {
      return {
        v1: {
          ValeID: "v1",
          FuncionarioID: "emp1",
          FuncionarioNome: "Maria Souza",
          LojaID: "loja-tx",
          NomeLoja: "House 190 Teixeira",
          Valor: 200,
          Motivo: "Despesa médica",
          DataDesejada: "2026-11-25",
          Competencia: "2026-11",
          Status: "Solicitado",
        },
      };
    }
    return {};
  };

  // Gerente não pode aprovar_pagar (só validar)
  const mgrExec = createEmployeeTools({
    employee: managerEmp,
    employees: [workerEmp, otherStoreEmp],
    profile: managerEmp,
    database: db,
    env: baseEnv,
    tok: "tok",
    now,
    setPending: () => {},
    fetcher: createFakePatchFetcher(patches),
  });
  const mgrDenied = await mgrExec("executar_acao_operacional", { acao: "decidir_vale", vale_id: "v1", decisao: "aprovar_pagar" });
  assert.ok(mgrDenied.erro);

  // Admin aprova e paga -> gera Recibo de Vale em Documentos e avisa no WhatsApp
  const adminExec = createEmployeeTools({
    employee: adminEmp,
    employees: [workerEmp, otherStoreEmp],
    profile: adminEmp,
    database: db,
    env: baseEnv,
    tok: "tok",
    now,
    setPending: () => {},
    sendWhatsApp: async (m) => { waSent.push(m); return { success: true, messageId: "w3" }; },
    fetcher: createFakePatchFetcher(patches),
  });
  const payRes = await adminExec("executar_acao_operacional", {
    acao: "decidir_vale",
    funcionario_nome: "Maria",
    decisao: "aprovar_pagar",
    observacao: "Pix realizado",
  });
  assert.equal(payRes.ok, true);
  assert.equal(payRes.novoStatus, "Pago");
  assert.ok(payRes.reciboDocId);
  assert.ok(patches[0][`Documentos/${payRes.reciboDocId}`]);
  assert.equal(patches[0][`Documentos/${payRes.reciboDocId}`].Tipo, "Recibo de Vale");
  assert.equal(patches[0][`Documentos/${payRes.reciboDocId}`].HashSHA256Original.length, 64);
  assert.equal(waSent.length, 1);

  // Aviso direto de vale pelo WhatsApp
  const avisoRes = await adminExec("executar_acao_operacional", {
    acao: "enviar_aviso_whatsapp",
    funcionario_nome: "João Eunapolis",
    assunto: "Aviso de Vale",
    mensagem: "Seu vale de R$ 150,00 foi liberado no caixa. Passe para assinar o recibo.",
  });
  assert.equal(avisoRes.ok, true);
  assert.equal(avisoRes.enviadosComSucesso, 1);
  assert.equal(waSent[1].phone, "5573999333444");
});

test("administrador cadastrado apenas em access (sem FuncionarioID) opera House AI no WhatsApp normalmente", async () => {
  const db = async (_e, _t, path) => {
    if (path === "tables/Funcionarios") return { emp1: workerEmp };
    if (path === "access") {
      return {
        uidAdmin: { Nome: "Bruno Admin", Email: "bruno@house190.test", Perfil: "Administrador", Telefone: "5573991915552", Ativo: true },
      };
    }
    return {};
  };

  let state = null;
  const mem = { load: async () => state, save: async (v) => { state = v; } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.groq.com")) {
      return Response.json({ choices: [{ message: { role: "assistant", content: "Tudo certo, Bruno. Estou pronta para ajudar na operação." } }] });
    }
    return Response.json({});
  };

  try {
    const res = await processInboundHouseAI({
      from: "5573991915552",
      text: "Oi, tudo certo por ai?",
      env: baseEnv,
      database: db,
      tok: "tok",
      now,
      conversationStore: mem,
    });
    assert.equal(res.authorized, true);
    assert.equal(res.action, "groq_conversation");
    assert.match(res.replyText, /Bruno/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
