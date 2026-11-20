import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWhatsAppPhone,
  buildBrazilWhatsAppCandidates,
  resetResolvedJidCacheForTests,
  sendWhatsAppMessage,
  sendWhatsAppButtons,
} from "../src/whatsapp.js";

test("normalizeWhatsAppPhone normaliza telefones brasileiros em diversos formatos", () => {
  // Com DDD e 9 dígitos (Bahia 71)
  assert.deepEqual(normalizeWhatsAppPhone("(71) 98888-7777"), {
    jid: "5571988887777@s.whatsapp.net",
    digits: "5571988887777",
  });

  // Sem parênteses ou traço
  assert.deepEqual(normalizeWhatsAppPhone("71988887777"), {
    jid: "5571988887777@s.whatsapp.net",
    digits: "5571988887777",
  });

  // Com zero na frente
  assert.deepEqual(normalizeWhatsAppPhone("071988887777"), {
    jid: "5571988887777@s.whatsapp.net",
    digits: "5571988887777",
  });

  // Já com DDI 55
  assert.deepEqual(normalizeWhatsAppPhone("+55 (71) 98888-7777"), {
    jid: "5571988887777@s.whatsapp.net",
    digits: "5571988887777",
  });

  // Fixo (8 dígitos com DDD)
  assert.deepEqual(normalizeWhatsAppPhone("7133334444"), {
    jid: "557133334444@s.whatsapp.net",
    digits: "557133334444",
  });

  // Inválidos
  assert.equal(normalizeWhatsAppPhone(""), null);
  assert.equal(normalizeWhatsAppPhone(null), null);
  assert.equal(normalizeWhatsAppPhone("123"), null);
});

test("sendWhatsAppMessage ignora envio se WA_ENABLED estiver desligado", async () => {
  const result = await sendWhatsAppMessage(
    { WA_ENABLED: false },
    { phone: "71988887777", text: "Teste" },
  );
  assert.equal(result.success, false);
  assert.equal(result.skipped, true);
  assert.equal(result.error, "wa_disabled");
});

test("sendWhatsAppMessage acusa configuração ausente se faltar URL, chave ou sessão", async () => {
  const result = await sendWhatsAppMessage(
    { WA_ENABLED: true, WA_API_URL: "" },
    { phone: "71988887777", text: "Teste" },
  );
  assert.equal(result.success, false);
  assert.equal(result.skipped, true);
  assert.equal(result.error, "wa_config_missing");
});

test("sendWhatsAppMessage envia requisição correta para a API do WA-AKG", async () => {
  let capturedUrl = "";
  let capturedHeaders = {};
  let capturedBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ status: "success" }), { status: 200 });
  };

  try {
    const env = {
      WA_ENABLED: "true",
      WA_API_URL: "http://localhost:3000/api",
      WA_SESSION_ID: "house190",
      WA_API_KEY: "wag_teste123",
    };

    const result = await sendWhatsAppMessage(env, {
      phone: "(71) 98888-7777",
      text: "Lembrete: Entrada em 5 minutos",
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 200);
    assert.equal(
      capturedUrl,
      "http://localhost:3000/api/messages/house190/5571988887777%40s.whatsapp.net/send",
    );
    assert.equal(capturedHeaders["X-API-Key"], "wag_teste123");
    assert.equal(capturedHeaders["Content-Type"], "application/json");
    assert.equal(capturedBody.message.text, "Lembrete: Entrada em 5 minutos");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendWhatsAppButtons envia requisição correta para a API de buttons do WA-AKG", async () => {
  let capturedUrl = "";
  let capturedHeaders = {};
  let capturedBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ status: true, message: "Buttons sent successfully" }), { status: 200 });
  };

  try {
    const env = {
      WA_ENABLED: "true",
      WA_API_URL: "http://localhost:3000/api",
      WA_SESSION_ID: "house190",
      WA_API_KEY: "wag_teste123",
    };

    const result = await sendWhatsAppButtons(env, {
      phone: "(71) 98888-7777",
      text: "Escolha uma opção:",
      footer: "Grupo House 190",
      buttons: ["Minhas Folgas", "Banco de Horas", "Minha Escala"],
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 200);
    assert.equal(
      capturedUrl,
      "http://localhost:3000/api/messages/house190/5571988887777%40s.whatsapp.net/buttons",
    );
    assert.equal(capturedHeaders["X-API-Key"], "wag_teste123");
    assert.equal(capturedBody.text, "Escolha uma opção:");
    assert.equal(capturedBody.footer, "Grupo House 190");
    assert.equal(capturedBody.buttons.length, 3);
    assert.equal(capturedBody.buttons[0].text, "Minhas Folgas");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendWhatsAppMessage não confunde HTTP200 vazio ou statusfalse com envio confirmado", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of [{}, { status: false }]) {
      globalThis.fetch = async () => Response.json(body);
      const result = await sendWhatsAppMessage({ WA_ENABLED: "true", WA_API_URL: "https://gateway.test/api", WA_SESSION_ID: "test", WA_API_KEY: "test-only" }, { phone: "71988887777", text: "test" });
      assert.equal(result.success, false);
      assert.equal(result.error, "gateway_did_not_confirm_send");
    }
  } finally { globalThis.fetch = original; }
});

test("sendWhatsAppMessage resolve JID real sem 9o digito na Bahia (DDD 73) via /api/chat/{sessionId}/check", async () => {
  resetResolvedJidCacheForTests();
  assert.deepEqual(buildBrazilWhatsAppCandidates("5573999136785"), [
    "557399136785",
    "5573999136785",
  ]);
  assert.deepEqual(buildBrazilWhatsAppCandidates("5511988887777"), [
    "5511988887777",
    "551188887777",
  ]);

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const s = String(url);
    calls.push({ url: s, body: JSON.parse(options.body) });
    if (s.endsWith("/chat/house190/check")) {
      return new Response(
        JSON.stringify({
          status: true,
          data: {
            results: [
              { number: "557399136785", exists: true, jid: "557399136785@s.whatsapp.net" },
              { number: "5573999136785", exists: false, jid: null },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (s.includes("/messages/house190/")) {
      return new Response(
        JSON.stringify({ status: true, data: { key: { id: "msg-resolved-12" } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const result = await sendWhatsAppMessage(
      {
        WA_ENABLED: "true",
        WA_API_URL: "https://gateway.test/api",
        WA_SESSION_ID: "house190",
        WA_API_KEY: "test-key",
      },
      {
        phone: "5573999136785",
        text: "House 190 - Fechamento de Caixa",
        aiPrepared: true,
      },
    );
    assert.equal(result.success, true);
    assert.equal(result.resolvedJid, "557399136785@s.whatsapp.net");
    assert.equal(result.resolvedVia, "onWhatsApp");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://gateway.test/api/chat/house190/check");
    assert.deepEqual(calls[0].body.numbers, ["557399136785", "5573999136785"]);
    assert.equal(
      calls[1].url,
      "https://gateway.test/api/messages/house190/557399136785%40s.whatsapp.net/send",
    );
  } finally {
    globalThis.fetch = originalFetch;
    resetResolvedJidCacheForTests();
  }
});
