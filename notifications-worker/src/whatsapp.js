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
export async function sendWhatsAppMessage(env, { phone, text, timeoutMs = 10000 }) {
  const isEnabled =
    env.WA_ENABLED === true ||
    env.WA_ENABLED === 1 ||
    ["true", "1", "sim", "yes"].includes(String(env.WA_ENABLED || "").toLowerCase());

  if (!isEnabled) {
    return { success: false, skipped: true, error: "wa_disabled" };
  }

  if (!env.WA_API_URL || !env.WA_SESSION_ID || !env.WA_API_KEY) {
    return { success: false, skipped: true, error: "wa_config_missing" };
  }

  const target = normalizeWhatsAppPhone(phone);
  if (!target) {
    return { success: false, error: "invalid_phone" };
  }

  const baseUrl = env.WA_API_URL.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/messages/${encodeURIComponent(env.WA_SESSION_ID)}/${encodeURIComponent(target.jid)}/send`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.WA_API_KEY,
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

    return {
      success: true,
      status: res.status,
    };
  } catch (err) {
    return {
      success: false,
      error: err.name === "TimeoutError" ? "timeout" : err.message,
    };
  }
}
