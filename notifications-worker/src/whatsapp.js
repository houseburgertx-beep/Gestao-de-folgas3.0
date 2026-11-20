import { composeWhatsAppMessage } from "./wa-message-composer.js";

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

const RESOLVED_JID_TTL_MS = 6 * 60 * 60 * 1000;
const resolvedJidCache = new Map();

export function resetResolvedJidCacheForTests() {
  resolvedJidCache.clear();
}

/**
 * Gera candidatos de dígitos (com e sem o 9º dígito) para celulares brasileiros,
 * priorizando o formato mais comum por faixa de DDD (12 dígitos para DDD >= 31
 * como Bahia 71/73/74/75/77, e 13 dígitos para DDD <= 28).
 *
 * @param {string} digits
 * @returns {string[]}
 */
export function buildBrazilWhatsAppCandidates(digits) {
  const clean = String(digits || "").replace(/\D/g, "");
  if (!clean) return [];

  // 13 dígitos: 55 + DDD (2) + 9 + 8 dígitos
  const match13 = clean.match(/^55(\d{2})9(\d{8})$/);
  if (match13) {
    const ddd = Number(match13[1]);
    const without9 = `55${match13[1]}${match13[2]}`;
    const with9 = clean;
    return ddd >= 31 ? [without9, with9] : [with9, without9];
  }

  // 12 dígitos celular: 55 + DDD (2) + [6-9] + 7 dígitos
  const match12 = clean.match(/^55(\d{2})([6-9]\d{7})$/);
  if (match12) {
    const ddd = Number(match12[1]);
    const without9 = clean;
    const with9 = `55${match12[1]}9${match12[2]}`;
    return ddd >= 31 ? [without9, with9] : [with9, without9];
  }

  return [clean];
}

function stripJidDeviceSuffix(rawJid) {
  const s = String(rawJid || "").trim();
  if (!s.includes("@")) return "";
  const [userPart, domain] = s.split("@");
  const cleanUser = userPart.split(":")[0];
  return cleanUser && domain ? `${cleanUser}@${domain}` : "";
}

/**
 * Consulta o endpoint /api/chat/{sessionId}/check (Baileys onWhatsApp) para resolver
 * o JID canônico real no WhatsApp (resolvendo automaticamente a divergência de 9º dígito
 * no Brasil, onde contas de DDD >= 31 costumam estar registradas com 12 dígitos).
 *
 * @param {object} options
 * @returns {Promise<{ jid: string, digits: string, resolvedVia: string, checkResults?: any[] }>}
 */
export async function resolveWhatsAppRecipientJid({
  apiEndpoint,
  sessionId,
  apiKey,
  target,
  timeoutMs = 4500,
}) {
  if (!target?.jid || !target?.digits) {
    return { jid: "", digits: "", resolvedVia: "invalid" };
  }

  const candidates = buildBrazilWhatsAppCandidates(target.digits);
  if (candidates.length <= 1) {
    return { jid: target.jid, digits: target.digits, resolvedVia: "normalized" };
  }

  const cacheKey = `${apiEndpoint}|${sessionId}|${target.digits}`;
  const now = Date.now();
  const cached = resolvedJidCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { jid: cached.jid, digits: cached.digits, resolvedVia: "cache" };
  }

  const sessionsToTry =
    sessionId === "house190-bot" ? [sessionId, "house190"] : [sessionId];

  for (const candidateSession of sessionsToTry) {
    try {
      const checkUrl = `${apiEndpoint}/chat/${encodeURIComponent(candidateSession)}/check`;
      const res = await fetch(checkUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "bypass-tunnel-reminder": "true",
        },
        body: JSON.stringify({ numbers: candidates }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;

      const resJson = await res.json().catch(() => null);
      const results = resJson?.data?.results || resJson?.results;
      if (!Array.isArray(results) || results.length === 0) {
        return { jid: target.jid, digits: target.digits, resolvedVia: "fallback_no_results" };
      }

      const matched = results.find(
        (item) => item?.exists === true && typeof item?.jid === "string" && item.jid.includes("@"),
      );
      if (matched) {
        const cleanJid = stripJidDeviceSuffix(matched.jid);
        if (cleanJid) {
          const cleanDigits = cleanJid.split("@")[0];
          resolvedJidCache.set(cacheKey, {
            jid: cleanJid,
            digits: cleanDigits,
            expiresAt: now + RESOLVED_JID_TTL_MS,
          });
          return {
            jid: cleanJid,
            digits: cleanDigits,
            resolvedVia: "onWhatsApp",
            checkResults: results,
          };
        }
      }
      return {
        jid: target.jid,
        digits: target.digits,
        resolvedVia: "fallback_not_found",
        checkResults: results,
      };
    } catch (_) {
      // Continua para próxima sessão ou fallback seguro
    }
  }

  return { jid: target.jid, digits: target.digits, resolvedVia: "fallback_error" };
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
 * @returns {Promise<{ success: boolean, status?: number, error?: string, skipped?: boolean, resolvedJid?: string, resolvedVia?: string }>}
 */
export async function sendWhatsAppMessage(env, { phone, text, timeoutMs = 10000, gwConfig = null, aiPrepared = false }) {
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

  const composed = await composeWhatsAppMessage(env, text, { aiPrepared });
  text = composed.text;

  const apiEndpoint = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
  const resolved = await resolveWhatsAppRecipientJid({
    apiEndpoint,
    sessionId,
    apiKey,
    target,
  });
  const targetJid = resolved.jid || target.jid;
  const endpoint = `${apiEndpoint}/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(targetJid)}/send`;

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
        resolvedJid: targetJid,
        resolvedVia: resolved.resolvedVia,
        error: `upstream_error_${res.status}: ${errText.slice(0, 100)}`,
      };
    }

    const resJson = await res.json().catch(() => ({}));
    const messageId = resJson?.data?.key?.id || resJson?.data?.id || "";
    if (resJson.status === false || (!messageId && resJson.status !== true && resJson.status !== "success")) {
      return {
        success: false,
        status: res.status,
        resolvedJid: targetJid,
        resolvedVia: resolved.resolvedVia,
        error: "gateway_did_not_confirm_send",
      };
    }

    return {
      success: true,
      status: res.status,
      messageId,
      resolvedJid: targetJid,
      resolvedVia: resolved.resolvedVia,
      composition: composed.composition,
    };
  } catch (err) {
    return {
      success: false,
      resolvedJid: targetJid,
      resolvedVia: resolved.resolvedVia,
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
  { phone, text, footer = "Grupo House 190", buttons = [], timeoutMs = 10000, gwConfig = null, aiPrepared = false },
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
    return sendWhatsAppMessage(env, { phone, text, timeoutMs, gwConfig, aiPrepared });
  }

  const composed = await composeWhatsAppMessage(env, text, { aiPrepared });
  text = composed.text;
  aiPrepared = true;

  const apiEndpoint = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
  const resolved = await resolveWhatsAppRecipientJid({
    apiEndpoint,
    sessionId,
    apiKey,
    target,
  });
  const targetJid = resolved.jid || target.jid;
  const endpoint = `${apiEndpoint}/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(targetJid)}/buttons`;

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
      const fallbackEndpoint = `${apiEndpoint}/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(targetJid)}/send`;
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
        return sendWhatsAppMessage(env, { phone, text, timeoutMs, gwConfig, aiPrepared });
      }
      return { success: true, status: fallbackRes.status, composition: composed.composition };
    }

    return { success: true, status: res.status, composition: composed.composition };
  } catch (err) {
    return sendWhatsAppMessage(env, { phone, text, timeoutMs, gwConfig, aiPrepared });
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
  { phone, question, options = [], selectableCount = 1, timeoutMs = 10000, gwConfig = null, aiPrepared = false },
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

  const composed = await composeWhatsAppMessage(env, question || "Selecione uma opção", { aiPrepared });

  const apiEndpoint = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
  const resolved = await resolveWhatsAppRecipientJid({
    apiEndpoint,
    sessionId,
    apiKey,
    target,
  });
  const targetJid = resolved.jid || target.jid;
  const endpoint = `${apiEndpoint}/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(targetJid)}/poll`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "bypass-tunnel-reminder": "true",
      },
      body: JSON.stringify({
        question: (composed.text.length<=255?composed.text:String(question||"Selecione uma opção")).slice(0, 255),
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

    return { success: true, status: res.status, composition: composed.composition };
  } catch (err) {
    return {
      success: false,
      error: err.name === "TimeoutError" ? "timeout" : err.message,
    };
  }
}
