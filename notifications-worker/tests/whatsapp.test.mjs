import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWhatsAppPhone, sendWhatsAppMessage } from "../src/whatsapp.js";

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
