/**
 * Módulo de Integração com o Gateway WhatsApp (WA-AKG)
 * Permite envio de mensagens via API REST para números de colaboradores da House 190.
 */

/**
 * Normaliza número de telefone brasileiro para o formato JID do WhatsApp.
 * Suporta formatos como:
 * - "(71) 98888-7777" -> "5571988887777@s.whatsapp.net"
 * - "71988887777"     -> "5571988887777@s.whatsapp.net"
 * - "+55 71 98888-7777" -> "5571988887777@s.whatsapp.net"
 * - "5571988887777"   -> "5571988887777@s.whatsapp.net"
 *
 * @param {string|number} phone
 * @returns {{ jid: string, digits: string } | null}
 */
export function normalizeWhatsAppPhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");

  // Se o número começar com 0 (ex: 071988887777), remove o zero inicial
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // DDD (2 dígitos) + número (8 ou 9 dígitos) = 10 ou 11 dígitos -> adiciona DDI 55 (Brasil)
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }

  // Número brasileiro completo com DDI (55) deve ter 12 (fixo/antigo) ou 13 dígitos (celular com 9)
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return {
      jid: `${digits}@s.whatsapp.net`,
      digits,
    };
  }

  // Outros números internacionais válidos (mínimo 10, máximo 15 dígitos E.164)
  if (digits.length >= 10 && digits.length <= 15) {
    return {
      jid: `${digits}@s.whatsapp.net`,
      digits,
    };
  }

  return null;
}

/**
 * Envia mensagem de texto via WhatsApp usando o endpoint do WA-AKG.
 *
 * Endpoint WA-AKG:
 * POST /api/messages/{sessionId}/{recipient}/send
 * Header: X-API-Key: {apiKey}
 * Body: { message: { text: "..." } }
 *
 * @param {object} env - Variáveis de ambiente do Worker
 * @param {object} options
 * @param {string} options.phone - Telefone do destinatário
 * @param {string} options.text - Texto da mensagem
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<{ success: boolean, status?: number, error?: string, skipped?: boolean }>}
 */
export async function sendWhatsAppMessage(env, { phone, text, timeoutMs = 10000, gwConfig = null }) {
  const isEnabled =
    env.WA_ENABLED === true ||
    env.WA_ENABLED === 1 ||
    ["true", "1", "sim", "yes"].includes(String(env.WA_ENABLED || "").toLowerCase());

  if (!isEnabled) {
    return { success: false, skipped: true, error: "wa_disabled" };
  }

  const baseUrl = (gwConfig?.url || env.WA_API_URL || "").trim().replace(/\/+$/, "");
  const sessionId = gwConfig?.instance || env.WA_SESSION_ID;
  const apiKey = gwConfig?.apiKey || env.WA_API_KEY;

  if (!baseUrl || !sessionId || !apiKey) {
    return { success: false, skipped: true, error: "wa_config_missing" };
  }

  const target = normalizeWhatsAppPhone(phone);
  if (!target) {
    return { success: false, error: "invalid_phone" };
  }

  const apiEndpoint = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
  const endpoint = `${apiEndpoint}/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(target.jid)}/send`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "bypass-tunnel-reminder": "true",
      },
      body: JSON.stringify({
        message: {
          text,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        success: false,
        status: res.status,
        error: `upstream_error_${res.status}: ${errText.slice(0, 100)}`,
      };
    }

    const resJson = await res.json().catch(() => ({}));
    const messageId = resJson?.data?.key?.id || resJson?.data?.id || "";

    return {
      success: true,
      status: res.status,
      messageId,
    };
  } catch (err) {
    return {
      success: false,
      error: err.name === "TimeoutError" ? "timeout" : err.message,
    };
  }
}

/**
 * Envia mensagem com botões interativos de resposta rápida do WhatsApp (Quick Reply Buttons).
 * Exatamente como na imagem (botões acoplados à bolha com ícone de resposta).
 *
 * @param {object} env
 * @param {object} options
 * @param {string} options.phone - Destinatário
 * @param {string} options.text - Texto principal da mensagem
 * @param {string} [options.footer="Grupo House 190"] - Rodapé da mensagem
 * @param {Array<{ id: string, text: string }|string>} options.buttons - Lista de 1 a 3 botões
 * @param {number} [options.timeoutMs=10000]
 * @param {object} [options.gwConfig]
 */
export async function sendWhatsAppButtons(
  env,
  { phone, text, footer = "Grupo House 190", buttons = [], timeoutMs = 10000, gwConfig = null },
) {
  const isEnabled =
    env.WA_ENABLED === true ||
    env.WA_ENABLED === 1 ||
    ["true", "1", "sim", "yes"].includes(String(env.WA_ENABLED || "").toLowerCase());

  if (!isEnabled) {
    return { success: false, skipped: true, error: "wa_disabled" };
  }

  const baseUrl = (gwConfig?.url || env.WA_API_URL || "").trim().replace(/\/+$/, "");
  const sessionId = gwConfig?.instance || env.WA_SESSION_ID;
  const apiKey = gwConfig?.apiKey || env.WA_API_KEY;

  if (!baseUrl || !sessionId || !apiKey) {
    return { success: false, skipped: true, error: "wa_config_missing" };
  }

  const target = normalizeWhatsAppPhone(phone);
  if (!target) {
    return { success: false, error: "invalid_phone" };
  }

  const validButtons = Array.isArray(buttons)
    ? buttons.slice(0, 3).map((b, i) => {
        const title = typeof b === "string" ? b : (b.text || b.displayText || b.title || `Opção ${i + 1}`);
        const id = typeof b === "string" ? b : (b.id || `btn_${i + 1}`);
        return { id, text: title };
      })
    : [];

  if (validButtons.length === 0) {
    return sendWhatsAppMessage(env, { phone, text, timeoutMs, gwConfig });
  }

  const apiEndpoint = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
  const endpoint = `${apiEndpoint}/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(target.jid)}/buttons`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "bypass-tunnel-reminder": "true",
      },
      body: JSON.stringify({
        text,
        footer,
        buttons: validButtons,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      // Fallback para envio padrão via /send com objeto de botões
      const fallbackEndpoint = `${apiEndpoint}/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(target.jid)}/send`;
      const fallbackRes = await fetch(fallbackEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "bypass-tunnel-reminder": "true",
        },
        body: JSON.stringify({
          message: {
            text,
            footer,
            buttons: validButtons,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!fallbackRes.ok) {
        return sendWhatsAppMessage(env, { phone, text, timeoutMs, gwConfig });
      }
      return { success: true, status: fallbackRes.status };
    }

    return { success: true, status: res.status };
  } catch (err) {
    return sendWhatsAppMessage(env, { phone, text, timeoutMs, gwConfig });
  }
}

/**
 * Envia caixa de seleção interativa nativa do WhatsApp (Poll) via WA-AKG.
 *
 * @param {object} env
 * @param {object} options
 * @param {string} options.phone - Destinatário
 * @param {string} options.question - Título/pergunta da enquete
 * @param {string[]} options.options - Lista de opções (2 a 12 itens)
 * @param {number} [options.selectableCount=1] - 1 para escolha única (radio button)
 * @param {number} [options.timeoutMs=10000]
 * @param {object} [options.gwConfig]
 */
export async function sendWhatsAppPoll(
  env,
  { phone, question, options = [], selectableCount = 1, timeoutMs = 10000, gwConfig = null },
) {
  const isEnabled =
    env.WA_ENABLED === true ||
    env.WA_ENABLED === 1 ||
    ["true", "1", "sim", "yes"].includes(String(env.WA_ENABLED || "").toLowerCase());

  if (!isEnabled) {
    return { success: false, skipped: true, error: "wa_disabled" };
  }

  const baseUrl = (gwConfig?.url || env.WA_API_URL || "").trim().replace(/\/+$/, "");
  const sessionId = gwConfig?.instance || env.WA_SESSION_ID;
  const apiKey = gwConfig?.apiKey || env.WA_API_KEY;

  if (!baseUrl || !sessionId || !apiKey) {
    return { success: false, skipped: true, error: "wa_config_missing" };
  }

  const target = normalizeWhatsAppPhone(phone);
  if (!target) {
    return { success: false, error: "invalid_phone" };
  }

  const validOptions = Array.isArray(options)
    ? options.filter((o) => typeof o === "string" && o.trim()).slice(0, 12)
    : [];

  if (validOptions.length < 2) {
    return { success: false, error: "poll_requires_at_least_2_options" };
  }

  const apiEndpoint = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
  const endpoint = `${apiEndpoint}/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(target.jid)}/poll`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "bypass-tunnel-reminder": "true",
      },
      body: JSON.stringify({
        question: String(question || "Selecione uma opção").slice(0, 255),
        options: validOptions,
        selectableCount: Math.min(validOptions.length, Math.max(1, selectableCount || 1)),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        success: false,
        status: res.status,
        error: `upstream_error_${res.status}: ${errText.slice(0, 100)}`,
      };
    }

    return { success: true, status: res.status };
  } catch (err) {
    return {
      success: false,
      error: err.name === "TimeoutError" ? "timeout" : err.message,
    };
  }
}
