const TAKEAT_API_BASE = "https://public-api.takeat.app";
const TAKEAT_PDV_BASES = [
  "https://backend-pdv-2.takeat.app",
  "https://backend-pdv.takeat.app",
];

const KNOWN_TAKEAT_RESTAURANTS = {
  eunapolis: "97686",
  teixeira: "94485",
  foodpark: "92142",
};

const CHANNEL_LABELS = {
  delivery_takeat: "Delivery próprio",
  marketplaces: "iFood / Marketplaces",
  presencial: "Presencial",
  salao: "Salão",
  ifood: "iFood",
  nine_nine: "99Food",
  neemo: "Neemo",
  keeta: "Keeta",
  wabiz: "Wabiz",
  cardapioweb: "Cardápio Web",
  pickngo: "PickNGo",
  agilizone: "Agilizone",
  balcony: "Balcão",
  table: "Salão",
  takeaway: "Retirada",
  other: "Outros",
  outros: "Outros",
};

let cachedOAuthToken = { key: "", token: "", expiresAt: 0 };
const cachedPdvTokens = new Map();

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseNumericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const trimmed = value.trim().replace(/^R\$\s*/i, "");
  if (!trimmed) return 0;
  if (trimmed.includes(",") && trimmed.includes(".")) {
    const normalized = trimmed.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  if (trimmed.includes(",")) {
    const n = Number(trimmed.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

function getBahiaDay(iso) {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  // America/Bahia is fixed UTC-3 year-round (no DST)
  return new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function shiftIsoDate(isoDate, deltaDays) {
  const baseMs = Date.parse(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(baseMs)) return isoDate;
  return new Date(baseMs + deltaDays * 86400 * 1000).toISOString().slice(0, 10);
}

export function formatReaisBRL(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return `R$ ${Math.abs(n).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function labelTakeatChannel(channelKey) {
  const key = normalizeText(channelKey);
  if (CHANNEL_LABELS[key]) return CHANNEL_LABELS[key];
  if (!key) return "Outros";
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function resolveTakeatUnitKey(unitId, unitName = "") {
  const rawId = normalizeText(unitId);
  if (KNOWN_TAKEAT_RESTAURANTS[rawId]) return rawId;
  for (const [k, restId] of Object.entries(KNOWN_TAKEAT_RESTAURANTS)) {
    if (rawId === restId) return k;
  }

  const combined = `${rawId} ${normalizeText(unitName)}`;
  if (combined.includes("eunap") || combined.includes("eun")) return "eunapolis";
  if (combined.includes("food") || combined.includes("park") || combined.includes("fdp")) {
    return "foodpark";
  }
  if (combined.includes("teix") || combined.includes("tx") || combined.includes("hamburgueria")) {
    return "teixeira";
  }
  return "";
}

export function resolveKnownTakeatRestaurantId(unitId, unitName = "") {
  const rawId = normalizeText(unitId);
  if (/^\d{4,10}$/.test(rawId)) return rawId;
  const unitKey = resolveTakeatUnitKey(unitId, unitName);
  return unitKey ? KNOWN_TAKEAT_RESTAURANTS[unitKey] || "" : "";
}

function parsePdvCredentialsMap(env) {
  const raw = env?.TAKEAT_PDV_CREDENTIALS;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function authenticateTakeatPdv(unitKey, creds, now = Date.now()) {
  const email = String(creds?.email || "").trim();
  const password = String(creds?.password || "").trim();
  if (!email || !password) return null;

  const cacheKey = `${unitKey}:${email}`;
  const cached = cachedPdvTokens.get(cacheKey);
  if (cached && cached.token && cached.expiresAt > now + 60000) {
    return cached.token;
  }

  for (const base of TAKEAT_PDV_BASES) {
    try {
      const res = await fetch(`${base}/public/sessions/restaurants`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      const token = String(data?.token || data?.access_token || "").trim();
      if (!token) continue;
      cachedPdvTokens.set(cacheKey, {
        token,
        expiresAt: now + 20 * 60 * 1000,
      });
      return token;
    } catch {
      // try fallback cluster
    }
  }
  return null;
}

async function fetchTakeatPdvJson(path, unitKey, creds, now = Date.now()) {
  let token = await authenticateTakeatPdv(unitKey, creds, now);
  if (!token) return null;

  const cacheKey = `${unitKey}:${String(creds?.email || "").trim()}`;

  for (const base of TAKEAT_PDV_BASES) {
    try {
      let res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(4500),
      });
      if (res.status === 401) {
        cachedPdvTokens.delete(cacheKey);
        token = await authenticateTakeatPdv(unitKey, creds, now);
        if (!token) return null;
        res = await fetch(`${base}${path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(4500),
        });
      }
      if (res.ok) {
        return await res.json().catch(() => null);
      }
    } catch {
      // try fallback cluster
    }
  }
  return null;
}

export function extractChannelsFromGeneralCards(gc) {
  const pwt =
    gc?.payment_without_tax ||
    gc?.data?.payment_without_tax ||
    gc?.report?.payment_without_tax;
  if (!pwt || typeof pwt !== "object") return null;

  const labels = gc?.channel_labels && typeof gc.channel_labels === "object" ? gc.channel_labels : {};
  const salao = round2(parseNumericValue(pwt.table) + parseNumericValue(pwt.balcony));
  const delivery = round2(parseNumericValue(pwt.delivery_takeat ?? pwt.delivery));
  const ifood = round2(parseNumericValue(pwt.ifood));

  const channels = [];
  if (ifood > 0) channels.push({ key: "ifood", label: "iFood", revenue: ifood });
  if (salao > 0) channels.push({ key: "salao", label: "Salão", revenue: salao });
  if (delivery > 0) channels.push({ key: "delivery_takeat", label: "Delivery próprio", revenue: delivery });

  const handledKeys = new Set(["table", "balcony", "delivery_takeat", "delivery", "ifood", "client", "total"]);
  for (const [rawKey, rawVal] of Object.entries(pwt)) {
    const key = normalizeText(rawKey);
    if (!key || handledKeys.has(key)) continue;
    const val = round2(parseNumericValue(rawVal));
    if (val <= 0) continue;
    const label = typeof labels[rawKey] === "string" && labels[rawKey].trim()
      ? labels[rawKey].trim()
      : labelTakeatChannel(key);
    channels.push({ key, label, revenue: val });
  }

  channels.sort((a, b) => b.revenue - a.revenue);
  if (!channels.length) return null;

  const sumChannels = round2(channels.reduce((sum, c) => sum + c.revenue, 0));
  const clientTotal = round2(parseNumericValue(pwt.client));
  const total = clientTotal > 0 ? clientTotal : sumChannels;

  return {
    total,
    totalCents: Math.round(total * 100),
    channels,
  };
}

function pickBestAudit(candidates, expectedPdv) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const sorted = [...candidates];
  if (expectedPdv > 0) {
    sorted.sort((a, b) => {
      const aVal = parseNumericValue(a?.total_system_value);
      const bVal = parseNumericValue(b?.total_system_value);
      const diff = Math.abs(aVal - expectedPdv) - Math.abs(bVal - expectedPdv);
      if (Math.abs(diff) > 0.01) return diff;
      return bVal - aVal;
    });
  } else {
    sorted.sort((a, b) => parseNumericValue(b?.total_system_value) - parseNumericValue(a?.total_system_value));
  }
  return sorted[0];
}

async function resolveTakeatPdvShiftWindow(unitKey, creds, { date, revenueTotal = null, now = Date.now() }) {
  const auditStart = shiftIsoDate(date, -3);
  const auditEnd = shiftIsoDate(date, 2);
  const prevDate = shiftIsoDate(date, -1);
  const nextDate = shiftIsoDate(date, 1);
  const nowIso = new Date(now).toISOString();
  const expectedPdv =
    typeof revenueTotal === "number" && Number.isFinite(revenueTotal) && revenueTotal > 0
      ? revenueTotal / 100
      : 0;

  const [verifyData, auditRaw] = await Promise.all([
    fetchTakeatPdvJson("/restaurants/cashier-opening-verify", unitKey, creds, now),
    fetchTakeatPdvJson(
      `/restaurants/cashier-audit?start_date=${encodeURIComponent(auditStart)}&end_date=${encodeURIComponent(auditEnd)}`,
      unitKey,
      creds,
      now
    ),
  ]);

  let openCashier = null;
  if (verifyData?.id) {
    const openSummary = await fetchTakeatPdvJson(
      "/restaurants/cashier-opening-event/summary/null",
      unitKey,
      creds,
      now
    );
    if (openSummary?.opening?.opened_at) {
      openCashier = {
        cashierOpeningId: openSummary.opening.id || verifyData.id,
        start: openSummary.opening.opened_at,
        end: nowIso,
        isOpen: true,
        pdv: parseNumericValue(openSummary?.totals?.automatic_deposit),
      };
    }
  }

  const audits = Array.isArray(auditRaw) ? auditRaw.filter((a) => a && a.opened_at) : [];

  // 1. Caixa aberto hoje na mesma data do fechamento
  if (openCashier && getBahiaDay(openCashier.start) === date) {
    // Caso raro: um novo turno abriu mais tarde no mesmo dia, mas o fechamento se refere ao turno
    // da madrugada (aberto no dia anterior e fechado nesta data).
    if (expectedPdv > 100 && openCashier.pdv < expectedPdv * 0.5) {
      const prevClosedOnDate = audits.filter(
        (a) => getBahiaDay(a.closed_at) === date && getBahiaDay(a.opened_at) === prevDate
      );
      const bestPrev = pickBestAudit(prevClosedOnDate, expectedPdv);
      if (bestPrev) {
        const prevVal = parseNumericValue(bestPrev.total_system_value);
        if (Math.abs(prevVal - expectedPdv) < Math.abs(openCashier.pdv - expectedPdv)) {
          return {
            cashierOpeningId: bestPrev.cashier_opening_id ?? null,
            start: bestPrev.opened_at,
            end: bestPrev.closed_at || nowIso,
          };
        }
      }
    }
    return {
      cashierOpeningId: openCashier.cashierOpeningId,
      start: openCashier.start,
      end: openCashier.end,
    };
  }

  // 2. Caixas fechados que abriram na data do fechamento
  const openedOnDate = audits.filter((a) => getBahiaDay(a.opened_at) === date);
  if (openedOnDate.length) {
    const best = pickBestAudit(openedOnDate, expectedPdv);
    if (best) {
      return {
        cashierOpeningId: best.cashier_opening_id ?? null,
        start: best.opened_at,
        end: best.closed_at || nowIso,
      };
    }
  }

  // 3a. Fechamento após a meia-noite salvo na data do dia seguinte enquanto o caixa ainda está aberto no PDV
  if (openCashier && getBahiaDay(openCashier.start) === prevDate) {
    return {
      cashierOpeningId: openCashier.cashierOpeningId,
      start: openCashier.start,
      end: openCashier.end,
    };
  }

  // 3b. Fechamento após a meia-noite salvo na data do dia seguinte com caixa já fechado no PDV (ex: Foodpark 00:48)
  const closedOnDate = audits.filter((a) => getBahiaDay(a.closed_at) === date);
  if (closedOnDate.length) {
    const openedPrevClosedToday = closedOnDate.filter((a) => getBahiaDay(a.opened_at) === prevDate);
    const best = pickBestAudit(
      openedPrevClosedToday.length ? openedPrevClosedToday : closedOnDate,
      expectedPdv
    );
    if (best) {
      return {
        cashierOpeningId: best.cashier_opening_id ?? null,
        start: best.opened_at,
        end: best.closed_at || nowIso,
      };
    }
  }

  // 3c. Fallback por correspondência de faturamento no dia anterior (turno da noite)
  if (expectedPdv > 0) {
    const openedPrev = audits.filter((a) => getBahiaDay(a.opened_at) === prevDate);
    const best = pickBestAudit(openedPrev, expectedPdv);
    if (best) {
      const sysVal = parseNumericValue(best.total_system_value);
      if (Math.abs(sysVal - expectedPdv) <= Math.max(500, expectedPdv * 0.3)) {
        return {
          cashierOpeningId: best.cashier_opening_id ?? null,
          start: best.opened_at,
          end: best.closed_at || nowIso,
        };
      }
    }
  }

  // 4. Fallback: janela completa do dia no fuso da Bahia (UTC-3)
  return {
    cashierOpeningId: null,
    start: `${date}T03:00:00.000Z`,
    end: `${nextDate}T02:59:59.999Z`,
  };
}

async function fetchTakeatPdvShiftChannelSales(
  unitKey,
  creds,
  { restaurantId, date, revenueTotal = null, now = Date.now() }
) {
  const window = await resolveTakeatPdvShiftWindow(unitKey, creds, { date, revenueTotal, now });
  if (!window?.start || !window?.end) return null;

  const gc = await fetchTakeatPdvJson(
    `/restaurants/v2/reports/general-cards?start_date=${encodeURIComponent(window.start)}&end_date=${encodeURIComponent(window.end)}`,
    unitKey,
    creds,
    now
  );
  const extracted = extractChannelsFromGeneralCards(gc);
  if (!extracted) return null;

  return {
    restaurantId: restaurantId || KNOWN_TAKEAT_RESTAURANTS[unitKey] || "",
    unitKey,
    date,
    total: extracted.total,
    totalCents: extracted.totalCents,
    channels: extracted.channels,
    source: "takeat_pdv_general_cards",
    cashierOpeningId: window.cashierOpeningId ?? null,
    windowStart: window.start,
    windowEnd: window.end,
  };
}

function normalizeProvidedChannelBreakdown(payloadBreakdown, { restaurantId, date }) {
  if (!payloadBreakdown || typeof payloadBreakdown !== "object") return null;
  const rawChannels = Array.isArray(payloadBreakdown.channels) ? payloadBreakdown.channels : [];
  const channels = rawChannels
    .map((ch) => ({
      key: normalizeText(ch?.key || ch?.label || "outros") || "outros",
      label: String(ch?.label || labelTakeatChannel(ch?.key)).trim() || "Outros",
      revenue: round2(parseNumericValue(ch?.revenue)),
    }))
    .filter((ch) => ch.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);

  if (!channels.length) return null;
  const sumChannels = round2(channels.reduce((sum, c) => sum + c.revenue, 0));
  const providedTotal = round2(parseNumericValue(payloadBreakdown.total));
  const total = providedTotal > 0 ? providedTotal : sumChannels;
  return {
    restaurantId: restaurantId || "",
    date,
    total,
    totalCents: Math.round(total * 100),
    channels,
    source: String(payloadBreakdown.source || "payload_channel_breakdown"),
  };
}

async function getTakeatAccessToken(apiKey, now = Date.now()) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) return null;
  if (
    cachedOAuthToken.token &&
    cachedOAuthToken.key === cleanKey &&
    cachedOAuthToken.expiresAt > now + 60000
  ) {
    return cachedOAuthToken.token;
  }

  const res = await fetch(`${TAKEAT_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "api_key",
      api_key: cleanKey,
    }),
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data?.access_token) return null;

  const expiresInMs = Math.max(60, Number(data.expires_in || 900)) * 1000;
  cachedOAuthToken = {
    key: cleanKey,
    token: data.access_token,
    expiresAt: now + expiresInMs,
  };
  return data.access_token;
}

async function resolveRestaurantIdDynamic(token, unitId, unitName) {
  const known = resolveKnownTakeatRestaurantId(unitId, unitName);
  if (known) return known;

  const res = await fetch(`${TAKEAT_API_BASE}/v1/restaurants`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) return "";
  const list = await res.json().catch(() => null);
  if (!Array.isArray(list)) return "";

  const needleId = normalizeText(unitId);
  const needleName = normalizeText(unitName);
  const matched = list.find((r) => {
    const rId = normalizeText(r?.id);
    const rName = normalizeText(r?.fantasy_name || r?.name);
    if (needleId && rId === needleId) return true;
    if (needleName && rName && (rName.includes(needleName) || needleName.includes(rName))) return true;
    return false;
  });
  return matched?.id ? String(matched.id) : "";
}

/**
 * Consulta o faturamento por canal de vendas real da Takeat.
 * Prioridade:
 * 1. Breakdown já validado enviado pelo chamador (quando presente).
 * 2. Painel oficial PDV Takeat (backend-pdv-2.takeat.app/restaurants/v2/reports/general-cards)
 *    alinhado exatamente à janela do turno de caixa (opened_at..closed_at || now).
 * 3. Fallback legado (public-api.takeat.app) apenas quando TAKEAT_PDV_CREDENTIALS não está configurado para a loja.
 */
export async function fetchTakeatDailyChannelSales(
  env,
  { unitId, unitName = "", date = "", revenueTotal = null, channelBreakdown = null, now = Date.now() }
) {
  const isoDate = String(date || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;

  const unitKey = resolveTakeatUnitKey(unitId, unitName);
  const knownRestaurantId = resolveKnownTakeatRestaurantId(unitId, unitName);

  // 1. Breakdown enviado explicitamente
  const fromPayload = normalizeProvidedChannelBreakdown(channelBreakdown, {
    restaurantId: knownRestaurantId,
    date: isoDate,
  });
  if (fromPayload) return fromPayload;

  // 2. Painel oficial PDV Takeat (fonte fiel ao caixa e ao painel real)
  const pdvCredsMap = parsePdvCredentialsMap(env);
  const unitPdvCreds = unitKey && pdvCredsMap ? pdvCredsMap[unitKey] : null;
  if (unitPdvCreds?.email && unitPdvCreds?.password) {
    try {
      return await fetchTakeatPdvShiftChannelSales(unitKey, unitPdvCreds, {
        restaurantId: knownRestaurantId,
        date: isoDate,
        revenueTotal,
        now,
      });
    } catch {
      return null;
    }
  }

  // 3. Fallback legado (apenas quando credenciais do PDV não estão configuradas para a unidade)
  const apiKey = String(env?.TAKEAT_MULTISTORE_API_KEY || "").trim();
  if (!apiKey) return null;

  try {
    const token = await getTakeatAccessToken(apiKey, now);
    if (!token) return null;

    const restaurantId = await resolveRestaurantIdDynamic(token, unitId, unitName);
    if (!restaurantId) return null;

    const params = new URLSearchParams({
      restaurant_id: restaurantId,
      granularity: "daily",
      start_date: isoDate,
      end_date: isoDate,
    });
    const res = await fetch(`${TAKEAT_API_BASE}/v1/reports/payments/channels?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;

    const json = await res.json().catch(() => null);
    const records = Array.isArray(json?.data?.records) ? json.data.records : [];
    if (!records.length) return null;

    const byChannel = new Map();
    for (const rec of records) {
      const key = normalizeText(rec?.channel_group || rec?.channel || "outros") || "outros";
      const gross = Number(rec?.gross_revenue ?? rec?.net_revenue ?? 0);
      if (!Number.isFinite(gross)) continue;
      byChannel.set(key, (byChannel.get(key) || 0) + gross);
    }

    const channels = Array.from(byChannel.entries())
      .map(([key, revenue]) => ({
        key,
        label: labelTakeatChannel(key),
        revenue: round2(revenue),
      }))
      .filter((c) => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);

    if (!channels.length) return null;

    const total = round2(channels.reduce((sum, c) => sum + c.revenue, 0));
    return {
      restaurantId,
      date: isoDate,
      total,
      totalCents: Math.round(total * 100),
      channels,
      source: "takeat_public_api_fallback",
    };
  } catch {
    return null;
  }
}

export function resetTakeatSalesCacheForTests() {
  cachedOAuthToken = { key: "", token: "", expiresAt: 0 };
  cachedPdvTokens.clear();
}
