import test from "node:test";
import assert from "node:assert/strict";
import webpush from "web-push";
import worker from "../src/index.js";
import { resetTakeatSalesCacheForTests } from "../src/takeat-sales.js";

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

test("/cash-notify envia completo ao financeiro e somente unidade/operador/data/faturamento por canal Takeat para Bruno e Abigail", async () => {
  resetTakeatSalesCacheForTests();
  const originalFetch = globalThis.fetch;
  const sentMessages = [];
  globalThis.fetch = async (url, init) => {
    const s = String(url);
    if (s === "https://public-api.takeat.app/oauth/token") {
      return new Response(JSON.stringify({ access_token: "mock-takeat-jwt", expires_in: 900 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (s.startsWith("https://public-api.takeat.app/v1/reports/payments/channels")) {
      assert.match(s, /restaurant_id=94485/);
      assert.match(s, /start_date=2026-11-19/);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            restaurant_id: 94485,
            records: [
              { channel_group: "delivery_takeat", gross_revenue: 1364.58 },
              { channel_group: "marketplaces", gross_revenue: 1325.9 },
              { channel_group: "presencial", gross_revenue: 1315.05 },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
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
          revenueTotal: 399000,
          difference: -2500,
          closingId: "closing-2026-11-19-teixeira-1",
        }),
      }),
      {
        ...env,
        CASH_NOTIFY_SECRET: "cash-dedicated-secret-190",
        TAKEAT_MULTISTORE_API_KEY: "tk_test_mock_key",
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
    assert.match(finMsg.text, /Operador: Maria Silva/);
    assert.match(finMsg.text, /Valor faturado: R\$ 4\.005,53/);
    assert.match(finMsg.text, /Divergência: Falta de R\$ 25,00/);
    assert.match(finMsg.text, /Delivery Takeat: R\$ 1\.364,58/);
    assert.match(finMsg.text, /conferencia-caixa/);

    for (const execMsg of [brunoMsg, abigailMsg]) {
      assert.match(execMsg.text, /Unidade: \*House 190 Teixeira\*/);
      assert.match(execMsg.text, /Operador: Maria Silva/);
      assert.match(execMsg.text, /Data: 19\/11\/2026 - Noite/);
      assert.match(execMsg.text, /Valor faturado: R\$ 4\.005,53/);
      assert.match(execMsg.text, /Faturamento por canal \(Takeat\):/);
      assert.match(execMsg.text, /- Delivery Takeat: R\$ 1\.364,58/);
      assert.match(execMsg.text, /- iFood \/ Marketplaces: R\$ 1\.325,90/);
      assert.match(execMsg.text, /- Presencial: R\$ 1\.315,05/);
      assert.doesNotMatch(execMsg.text, /Diverg|Falta|Sobra|conferencia-caixa/i);
      assert.doesNotMatch(execMsg.text, /[\u{1F300}-\u{1FAFF}]/u);
    }
  } finally {
    globalThis.fetch = originalFetch;
    resetTakeatSalesCacheForTests();
  }
});

test("/cash-notify envia devolucao e conferencia apenas para o financeiro (sem duplicar para Bruno/Abigail)", async () => {
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
    const dataConf = await resConf.json();
    assert.equal(dataConf.sent, 1);
    assert.equal(dataConf.targets, 1);

    const finConf = sentMessages.find((m) => m.url.includes("5573982113316"));
    assert.ok(finConf);
    assert.match(finConf.text, /Conferência de Caixa Concluída/);
    assert.match(finConf.text, /Conferido por: Ana Financeiro/);
    assert.match(finConf.text, /Valor faturado: R\$ 8\.900,00/);
    assert.match(finConf.text, /Divergência final: Sem divergência/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/cash-notify funciona via Service Binding (sem header Origin) para Eunapolis e recai nos numeros padrao se config RTDB vier vazia", async () => {
  resetTakeatSalesCacheForTests();
  const originalFetch = globalThis.fetch;
  const sentMessages = [];
  globalThis.fetch = async (url, init) => {
    const s = String(url);
    if (s === "https://public-api.takeat.app/oauth/token") {
      return new Response(JSON.stringify({ access_token: "mock-takeat-jwt", expires_in: 900 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (s.startsWith("https://public-api.takeat.app/v1/reports/payments/channels")) {
      assert.match(s, /restaurant_id=97686/);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            restaurant_id: 97686,
            records: [
              { channel_group: "delivery_takeat", gross_revenue: 2100.5 },
              { channel_group: "presencial", gross_revenue: 1850.25 },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (s.includes("WhatsAppCashNotify")) {
      return new Response(JSON.stringify({ financeiroPhones: "", executivePhones: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (s.includes("/api/messages/house190/")) {
      const body = JSON.parse(init?.body || "{}");
      sentMessages.push({ url: s, text: body?.message?.text || "" });
      return new Response(JSON.stringify({ status: true, data: { key: { id: `msg-eun-${sentMessages.length}` } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(null), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = await worker.fetch(
      new Request("https://house-folgas-notifications.brunohouse.workers.dev/cash-notify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Token": "cash-dedicated-secret-190",
        },
        body: JSON.stringify({
          eventKind: "cash_closing",
          unitId: "eunapolis",
          unitName: "House 190 Eunápolis",
          operatorName: "Ana Claudia",
          date: "2026-11-19",
          shift: "Único",
          revenueTotal: 395075,
          difference: 0,
          closingId: "closing-eunapolis-2026-11-19",
        }),
      }),
      {
        ...env,
        CASH_NOTIFY_SECRET: "cash-dedicated-secret-190",
        TAKEAT_MULTISTORE_API_KEY: "tk_test_mock_key",
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
    assert.ok(sentMessages.some((m) => m.url.includes("5573982113316")));
    assert.ok(sentMessages.some((m) => m.url.includes("5573991915552")));
    assert.ok(sentMessages.some((m) => m.url.includes("5573999136785")));
  } finally {
    globalThis.fetch = originalFetch;
    resetTakeatSalesCacheForTests();
  }
});
