import test from "node:test";
import assert from "node:assert/strict";
import {
  stripHouseAIEmojis,
  getPhoneVariants,
  findEmployeeByPhone,
  formatMinutesBalance,
  generateMotivationalTimeClockMessage,
  processInboundHouseAI,
} from "../src/house-ai.js";

test("House AI: stripHouseAIEmojis elimina todos os emojis mantendo texto e pontuação", () => {
  const withEmojis = "Olá! 👋 Este é um teste 🚀 de ponto 👍 na House 190! 🍔";
  const cleaned = stripHouseAIEmojis(withEmojis);
  assert.equal(cleaned, "Olá!  Este é um teste  de ponto  na House 190!");
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(cleaned), false);
});

test("House AI: getPhoneVariants gera variantes com e sem nono dígito", () => {
  const v13 = getPhoneVariants("5573991740014");
  assert.ok(v13.includes("5573991740014"));
  assert.ok(v13.includes("557391740014")); // sem 9

  const v12 = getPhoneVariants("557391740014");
  assert.ok(v12.includes("557391740014"));
  assert.ok(v12.includes("5573991740014")); // com 9
});

test("House AI: findEmployeeByPhone localiza colaborador com qualquer formato de telefone", () => {
  const employees = [
    { FuncionarioID: "emp-1", Nome: "Bruno House", Telefone: "(73) 99174-0014", WhatsApp: "5573991740014" },
    { FuncionarioID: "emp-2", Nome: "Ana Cozinha", Telefone: "71988887777" },
  ];

  // Busca com 5573991740014
  const found1 = findEmployeeByPhone(employees, "5573991740014");
  assert.equal(found1?.FuncionarioID, "emp-1");

  // Busca sem nono dígito (557391740014)
  const found2 = findEmployeeByPhone(employees, "557391740014");
  assert.equal(found2?.FuncionarioID, "emp-1");

  // Busca apenas números locais
  const found3 = findEmployeeByPhone(employees, "73991740014");
  assert.equal(found3?.FuncionarioID, "emp-1");

  // Telefone não cadastrado
  const notFound = findEmployeeByPhone(employees, "5511999999999");
  assert.equal(notFound, null);
});

test("House AI: formatMinutesBalance formata saldos positivos e negativos", () => {
  assert.equal(formatMinutesBalance(120), "+02:00");
  assert.equal(formatMinutesBalance(-75), "-01:15");
  assert.equal(formatMinutesBalance(0), "+00:00");
});

test("House AI: Bloqueio estrito de marcação de ponto via WhatsApp (Portaria 671 MTE)", async () => {
  const mockEnv = { APP_URL: "https://house190.com/app" };
  const mockDb = async () => ({
    "emp-1": { FuncionarioID: "emp-1", Nome: "Bruno House", Telefone: "5573991740014" },
  });

  const res = await processInboundHouseAI({
    from: "5573991740014",
    text: "bater ponto agora por favor",
    env: mockEnv,
    database: mockDb,
    tok: "mock-token",
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "bloqueio_ponto_mte_671");
  assert.ok(res.replyText.includes("Portaria 671/MTE"));
  assert.ok(res.replyText.includes("não pode ser realizado por mensagens de WhatsApp"));
  assert.ok(res.replyText.includes("geolocalização e foto biométrica"));
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.replyText), false);
});

test("House AI: Bloqueio LGPD e direcionamento seguro para atestados médicos", async () => {
  const mockEnv = { APP_URL: "https://house190.com/app" };
  const mockDb = async () => ({
    "emp-1": { FuncionarioID: "emp-1", Nome: "Bruno House", Telefone: "5573991740014" },
  });

  const res = await processInboundHouseAI({
    from: "5573991740014",
    text: "estou doente, segue o atestado com cid",
    env: mockEnv,
    database: mockDb,
    tok: "mock-token",
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "bloqueio_lgpd_saude");
  assert.ok(res.replyText.includes("LGPD"));
  assert.ok(res.replyText.includes("Meus Documentos"));
  assert.ok(res.replyText.includes("?tab=documents"));
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.replyText), false);
});

test("House AI: Consulta real de folgas do mês e saldo de política de 5 folgas", async () => {
  const mockEnv = { APP_URL: "https://house190.com/app" };
  const fixedNow = new Date("2026-10-29T12:00:00Z").getTime();

  const mockDb = async (_env, _tok, table) => {
    if (table === "tables/Funcionarios") {
      return { "emp-1": { FuncionarioID: "emp-1", Nome: "Bruno House", Telefone: "5573991740014" } };
    }
    if (table === "tables/Folgas") {
      return {
        "f-1": { FuncionarioID: "emp-1", Data: "2026-10-05", Status: "Aprovada" },
        "f-2": { FuncionarioID: "emp-1", Data: "2026-10-12", Status: "Aprovada" },
        "f-3": { FuncionarioID: "emp-1", Data: "2026-10-31", Status: "Aprovada" },
        "f-4": { FuncionarioID: "emp-1", Data: "2026-10-20", Status: "Pendente" },
      };
    }
    return {};
  };

  const res = await processInboundHouseAI({
    from: "5573991740014",
    text: "quantas folgas eu tenho esse mes? qual minha proxima folga?",
    env: mockEnv,
    database: mockDb,
    tok: "mock-token",
    now: fixedNow,
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "consulta_folgas");
  assert.ok(res.replyText.includes("Folgas aprovadas no mês: 3 de 5 regulamentares"));
  assert.ok(res.replyText.includes("Solicitações pendentes: 1"));
  assert.ok(res.replyText.includes("Saldo de folgas a agendar: 2"));
  assert.ok(res.replyText.includes("Próxima folga programada: 31/10/2026"));
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.replyText), false);
});

test("House AI: Consulta de banco de horas apura batidas e saldo acumulado", async () => {
  const mockEnv = { APP_URL: "https://house190.com/app" };
  const mockDb = async (_env, _tok, table) => {
    if (table === "tables/Funcionarios") {
      return { "emp-1": { FuncionarioID: "emp-1", Nome: "Bruno House", Telefone: "5573991740014" } };
    }
    if (table === "tables/RegistroPonto") {
      return {
        // Dia 1: 08:00 às 12:00 (4h) + 13:00 às 17:00 (4h) = 8h (480 min) vs 440 min (+40 min)
        "p-1": { FuncionarioID: "emp-1", Data: "2026-10-28", Hora: "08:00" },
        "p-2": { FuncionarioID: "emp-1", Data: "2026-10-28", Hora: "12:00" },
        "p-3": { FuncionarioID: "emp-1", Data: "2026-10-28", Hora: "13:00" },
        "p-4": { FuncionarioID: "emp-1", Data: "2026-10-28", Hora: "17:00" },
      };
    }
    return {};
  };

  const res = await processInboundHouseAI({
    from: "5573991740014",
    text: "qual meu saldo de horas?",
    env: mockEnv,
    database: mockDb,
    tok: "mock-token",
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "consulta_banco_horas");
  assert.ok(res.replyText.includes("+00:40"));
  assert.ok(res.replyText.includes("positivo"));
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.replyText), false);
});

test("House AI: Consulta de escala de trabalho", async () => {
  const mockEnv = { APP_URL: "https://house190.com/app" };
  const fixedNow = new Date("2026-10-29T12:00:00Z").getTime(); // Quinta-feira

  const mockDb = async (_env, _tok, table) => {
    if (table === "tables/Funcionarios") {
      return { "emp-1": { FuncionarioID: "emp-1", Nome: "Bruno House", Telefone: "5573991740014", Turno: "Fechamento" } };
    }
    if (table === "tables/JornadasPonto") {
      return {
        "j-1": { FuncionarioID: "emp-1", DiaSemana: 4, Entrada: "16:00", SaidaIntervalo: "20:00", RetornoIntervalo: "21:00", Saida: "00:20" },
      };
    }
    return {};
  };

  const res = await processInboundHouseAI({
    from: "5573991740014",
    text: "qual minha escala de hoje?",
    env: mockEnv,
    database: mockDb,
    tok: "mock-token",
    now: fixedNow,
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "consulta_escala");
  assert.ok(res.replyText.includes("16:00"));
  assert.ok(res.replyText.includes("20:00 às 21:00"));
  assert.ok(res.replyText.includes("00:20"));
  assert.ok(res.replyText.includes("Fechamento"));
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.replyText), false);
});

test("House AI: Número não cadastrado é educadamente informado", async () => {
  const mockEnv = { APP_URL: "https://house190.com/app" };
  const mockDb = async () => ({
    "emp-1": { FuncionarioID: "emp-1", Nome: "Bruno House", Telefone: "5573991740014" },
  });

  const res = await processInboundHouseAI({
    from: "5571999999999",
    text: "olá, gostaria de saber minhas folgas",
    env: mockEnv,
    database: mockDb,
    tok: "mock-token",
  });

  assert.equal(res.handled, true);
  assert.equal(res.authorized, false);
  assert.ok(res.replyText.includes("uso exclusivo para colaboradores cadastrados"));
  assert.ok(res.replyText.includes("procure o gerente da sua loja"));
});

test("House AI: Mensagens motivacionais de Ponto (Entrada, Saída e Intervalo)", () => {
  const msgEntrada = generateMotivationalTimeClockMessage({
    type: "ENTRADA",
    employeeName: "Ana Claudia",
    timeStr: "16:00",
  });
  assert.ok(msgEntrada.includes("Olá, Ana!"));
  assert.ok(msgEntrada.includes("ENTRADA"));
  assert.ok(msgEntrada.includes("16:00"));
  assert.ok(msgEntrada.includes("House 190"));
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(msgEntrada), false);

  const msgSaida = generateMotivationalTimeClockMessage({
    type: "SAIDA",
    employeeName: "Ana Claudia",
    timeStr: "00:20",
  });
  assert.ok(msgSaida.includes("Ana"));
  assert.ok(msgSaida.includes("SAÍDA") || msgSaida.includes("finalizada"));
  assert.ok(msgSaida.includes("00:20"));
  assert.ok(msgSaida.includes("descanso"));
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(msgSaida), false);
});

test("House AI: Opções rápidas interativas por número (1 = Folgas, 2 = Banco de Horas, 7 = Políticas)", async () => {
  const mockEnv = { APP_URL: "https://house190.com/app" };
  const mockDb = async (_env, _tok, table) => {
    if (table === "tables/Funcionarios") {
      return { "emp-1": { FuncionarioID: "emp-1", Nome: "Bruno House", Telefone: "5573991740014" } };
    }
    return {};
  };

  // Digitando apenas "1" aciona Folgas
  const res1 = await processInboundHouseAI({
    from: "5573991740014",
    text: "1",
    env: mockEnv,
    database: mockDb,
    tok: "mock-token",
  });
  assert.equal(res1.action, "consulta_folgas");
  assert.ok(res1.replyText.includes("Folgas aprovadas"));

  // Digitando apenas "7" aciona Políticas
  const res7 = await processInboundHouseAI({
    from: "5573991740014",
    text: "7",
    env: mockEnv,
    database: mockDb,
    tok: "mock-token",
  });
  assert.equal(res7.action, "politicas_rh");
  assert.ok(res7.replyText.includes("Escala: 6x1 com 44h semanais"));
});

test("House AI: Colaborador solicita folga pelo WhatsApp e grava no Firebase RTDB", async () => {
  const puts = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    puts.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({}) };
  };

  try {
    const mockEnv = {
      APP_URL: "https://house190.com/app",
      FIREBASE_DATABASE_URL: "https://mock-rtdb.firebaseio.com",
      FIREBASE_ROOT: "gestao-folgas/v2",
    };
    const mockDb = async (_env, _tok, table) => {
      if (table === "tables/Funcionarios") {
        return { "emp-1": { FuncionarioID: "emp-1", Nome: "Raquel Silva", Telefone: "73998698229", Perfil: "Colaborador" } };
      }
      return {};
    };

    const res = await processInboundHouseAI({
      from: "5573998698229",
      text: "quero pedir folga dia 15/11",
      env: mockEnv,
      database: mockDb,
      tok: "mock-token",
    });

    assert.equal(res.action, "folga_solicitada_whatsapp");
    assert.ok(res.replyText.includes("Pendente de aprovação da gerência"));
    assert.ok(res.replyText.includes("15/11"));
    assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.replyText), false);

    // Verifica se gravou no Firebase RTDB tables/Folgas
    const folgaPut = puts.find((p) => p.url.includes("tables/Folgas"));
    assert.ok(folgaPut);
    assert.equal(folgaPut.body.FuncionarioID, "emp-1");
    assert.equal(folgaPut.body.Status, "Pendente");
    assert.ok(folgaPut.body.DataInicio.includes("11-15"));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("House AI: Gestor concede folga diretamente para colaborador via WhatsApp", async () => {
  const puts = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    puts.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({}) };
  };

  try {
    const mockEnv = {
      APP_URL: "https://house190.com/app",
      FIREBASE_DATABASE_URL: "https://mock-rtdb.firebaseio.com",
      FIREBASE_ROOT: "gestao-folgas/v2",
    };
    const mockDb = async (_env, _tok, table) => {
      if (table === "tables/Funcionarios") {
        return {
          "admin-1": { FuncionarioID: "admin-1", Nome: "Bruno House", Telefone: "5573991740014", Perfil: "Administrador" },
          "emp-2": { FuncionarioID: "emp-2", Nome: "Raquel Silva", Telefone: "73998698229", Perfil: "Colaborador" },
        };
      }
      return {};
    };

    const res = await processInboundHouseAI({
      from: "5573991740014",
      text: "conceder folga para Raquel dia 10/11",
      env: mockEnv,
      database: mockDb,
      tok: "mock-token",
    });

    assert.equal(res.action, "folga_aprovada_whatsapp");
    assert.ok(res.replyText.includes("APROVADA"));
    assert.ok(res.replyText.includes("Raquel Silva"));
    assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.replyText), false);

    const folgaPut = puts.find((p) => p.url.includes("tables/Folgas"));
    assert.ok(folgaPut);
    assert.equal(folgaPut.body.FuncionarioID, "emp-2");
    assert.equal(folgaPut.body.Status, "Aprovada");
    assert.ok(folgaPut.body.DataInicio.includes("11-10"));
  } finally {
    globalThis.fetch = origFetch;
  }
});
