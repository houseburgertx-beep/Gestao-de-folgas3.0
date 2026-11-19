import test from "node:test";
import assert from "node:assert/strict";
import webpush from "web-push";
import worker from "../src/index.js";

const vapidKeys = webpush.generateVAPIDKeys();

const env = {
  APP_ORIGIN: "https://houseburgertx-beep.github.io",
  WA_SERVICE_TOKEN: "valid-secret-token-190",
  WA_ENABLED: "false",
  FIREBASE_WEB_API_KEY: "fake-web-api-key",
  FIREBASE_CLIENT_EMAIL: "test@example.com",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7\n-----END PRIVATE KEY-----\n",
  FIREBASE_DATABASE_URL: "https://test.firebaseio.com",
  FIREBASE_ROOT: "gestao-folgas/v2",
  VAPID_PUBLIC_KEY: vapidKeys.publicKey,
  VAPID_PRIVATE_KEY: vapidKeys.privateKey,
  DB: {
    prepare: () => ({
      bind: () => ({
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
  },
};

test("/cash-notify rejeita método diferente de POST com 405", async () => {
  const res = await worker.fetch(
    new Request("https://worker/cash-notify", {
      method: "GET",
      headers: { Origin: "https://houseburgertx-beep.github.io" },
    }),
    env
  );
  assert.equal(res.status, 405);
});

test("/cash-notify rejeita requisição sem X-Service-Token com 401", async () => {
  const res = await worker.fetch(
    new Request("https://worker/cash-notify", {
      method: "POST",
      headers: {
        Origin: "https://houseburgertx-beep.github.io",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventKind: "cash_closing",
        unitId: "teixeira",
      }),
    }),
    env
  );
  assert.equal(res.status, 401);
});

test("/cash-notify rejeita X-Service-Token incorreto com 401", async () => {
  const res = await worker.fetch(
    new Request("https://worker/cash-notify", {
      method: "POST",
      headers: {
        Origin: "https://houseburgertx-beep.github.io",
        "Content-Type": "application/json",
        "X-Service-Token": "token-falso-invalido",
      },
      body: JSON.stringify({
        eventKind: "cash_closing",
        unitId: "teixeira",
      }),
    }),
    env
  );
  assert.equal(res.status, 401);
});

test("/cash-notify rejeita payload incompleto com 400", async () => {
  const res = await worker.fetch(
    new Request("https://worker/cash-notify", {
      method: "POST",
      headers: {
        Origin: "https://houseburgertx-beep.github.io",
        "Content-Type": "application/json",
        "X-Service-Token": "valid-secret-token-190",
      },
      body: JSON.stringify({
        eventKind: "cash_closing",
      }),
    }),
    env
  );
  assert.equal(res.status, 400);
});

test("/cash-notify rejeita tipo de evento desconhecido com 400", async () => {
  const res = await worker.fetch(
    new Request("https://worker/cash-notify", {
      method: "POST",
      headers: {
        Origin: "https://houseburgertx-beep.github.io",
        "Content-Type": "application/json",
        "X-Service-Token": "valid-secret-token-190",
      },
      body: JSON.stringify({
        eventKind: "evento_desconhecido",
        unitId: "teixeira",
      }),
    }),
    env
  );
  assert.equal(res.status, 400);
});

test("/cash-notify envia completo ao financeiro e resumo de faturamento/divergencia para Bruno e Abigail", async () => {
  const originalFetch = globalThis.fetch;
  const sentMessages = [];
  globalThis.fetch = async (url, init) => {
    const s = String(url);
    if (s.includes("/api/messages/house190/")) {
      const body = JSON.parse(init?.body || "{}");
      sentMessages.push({ url: s, text: body?.message?.text || "" });
      return new Response(JSON.stringify({ status: true, data: { key: { id: `msg-${sentMessages.length}` } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(null), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = await worker.fetch(
      new Request("https://worker/cash-notify", {
        method: "POST",
        headers: {
          Origin: "https://houseburgertx-beep.github.io",
          "Content-Type": "application/json",
          "X-Service-Token": "cash-dedicated-secret-190",
        },
        body: JSON.stringify({
          eventKind: "cash_closing",
          unitId: "teixeira",
          unitName: "House 190 Teixeira",
          operatorName: "Maria Silva",
          date: "2026-11-19",
          shift: "Noite",
          revenueTotal: 1245050,
          difference: -2500,
          closingId: "closing-2026-11-19-teixeira-1",
        }),
      }),
      {
        ...env,
        CASH_NOTIFY_SECRET: "cash-dedicated-secret-190",
        WA_ENABLED: "true",
        WA_API_URL: "https://wa-gw.example.com/api",
        WA_API_KEY: "test-wa-key",
        WA_SESSION_ID: "house190",
      }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.sent, 3);
    assert.equal(data.targets, 3);
    assert.equal(sentMessages.length, 3);

    const finMsg = sentMessages.find((m) => m.url.includes("5573982113316"));
    const brunoMsg = sentMessages.find((m) => m.url.includes("5573991915552"));
    const abigailMsg = sentMessages.find((m) => m.url.includes("5573999136785"));
    assert.ok(finMsg, "Financeiro (5573982113316) deve receber a notificacao");
    assert.ok(brunoMsg, "Bruno (5573991915552) deve receber a notificacao");
    assert.ok(abigailMsg, "Abigail (5573999136785) deve receber a notificacao");

    assert.match(finMsg.text, /House 190 Teixeira/);
    assert.match(finMsg.text, /19\/11\/2026 - Noite/);
    assert.match(finMsg.text, /Operador: Maria Silva/);
    assert.match(finMsg.text, /Valor faturado: R\$ 12\.450,50/);
    assert.match(finMsg.text, /falta de R\$ 25,00/);
    assert.match(finMsg.text, /conferencia-caixa/);

    for (const execMsg of [brunoMsg, abigailMsg]) {
      assert.match(execMsg.text, /Valor faturado: R\$ 12\.450,50/);
      assert.match(execMsg.text, /falta de R\$ 25,00/);
      assert.doesNotMatch(execMsg.text, /[\u{1F300}-\u{1FAFF}]/u);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/cash-notify envia devolucao e conferencia concluida sem divergencia", async () => {
  const originalFetch = globalThis.fetch;
  const sentMessages = [];
  globalThis.fetch = async (url, init) => {
    const s = String(url);
    if (s.includes("/api/messages/house190/")) {
      const body = JSON.parse(init?.body || "{}");
      sentMessages.push({ url: s, text: body?.message?.text || "" });
      return new Response(JSON.stringify({ status: true, data: { key: { id: `msg-${sentMessages.length}` } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(null), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const testEnv = {
      ...env,
      CASH_NOTIFY_SECRET: "cash-dedicated-secret-190",
      WA_ENABLED: "true",
      WA_API_URL: "https://wa-gw.example.com/api",
      WA_API_KEY: "test-wa-key",
      WA_SESSION_ID: "house190",
    };
    const resConf = await worker.fetch(
      new Request("https://worker/cash-notify", {
        method: "POST",
        headers: {
          Origin: "https://houseburgertx-beep.github.io",
          "Content-Type": "application/json",
          "X-Service-Token": "cash-dedicated-secret-190",
        },
        body: JSON.stringify({
          eventKind: "cash_conference",
          unitId: "foodpark",
          unitName: "House Foodpark",
          operatorName: "Joao",
          reviewedBy: "Ana Financeiro",
          date: "2026-11-19",
          revenueTotal: 890000,
          difference: 0,
        }),
      }),
      testEnv
    );
    assert.equal(resConf.status, 200);
    assert.equal((await resConf.json()).sent, 3);

    const finConf = sentMessages.find((m) => m.url.includes("5573982113316"));
    assert.match(finConf.text, /Conferencia de Caixa Concluida/);
    assert.match(finConf.text, /Conferido por: Ana Financeiro/);
    assert.match(finConf.text, /Valor faturado: R\$ 8\.900,00/);
    assert.match(finConf.text, /Sem divergencia/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
