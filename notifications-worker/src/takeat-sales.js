const TAKEAT_API_BASE = "https://public-api.takeat.app";

const KNOWN_TAKEAT_RESTAURANTS = {
  eunapolis: "97686",
  teixeira: "94485",
  foodpark: "92142",
};

const CHANNEL_LABELS = {
  delivery_takeat: "Delivery Takeat",
  marketplaces: "iFood / Marketplaces",
  presencial: "Presencial",
  ifood: "iFood",
  balcony: "Balcão",
  table: "Salão",
  takeaway: "Retirada",
};

let cachedOAuthToken = { key: "", token: "", expiresAt: 0 };

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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

export function resolveKnownTakeatRestaurantId(unitId, unitName = "") {
  const rawId = normalizeText(unitId);
  if (/^\d{4,10}$/.test(rawId)) return rawId;
  if (KNOWN_TAKEAT_RESTAURANTS[rawId]) return KNOWN_TAKEAT_RESTAURANTS[rawId];

  const combined = `${rawId} ${normalizeText(unitName)}`;
  if (combined.includes("eunap") || combined.includes("eun")) return KNOWN_TAKEAT_RESTAURANTS.eunapolis;
  if (combined.includes("food") || combined.includes("park") || combined.includes("fdp")) {
    return KNOWN_TAKEAT_RESTAURANTS.foodpark;
  }
  if (combined.includes("teix") || combined.includes("tx") || combined.includes("hamburgueria")) {
    return KNOWN_TAKEAT_RESTAURANTS.teixeira;
  }
  return "";
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
    signal: AbortSignal.timeout(6000),
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
    signal: AbortSignal.timeout(6000),
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
 * Consulta o faturamento diário por canal de vendas via API Multilojas Takeat.
 * Retorna null de forma segura se a chave não estiver configurada, a loja não for mapeada
 * ou a API estiver temporariamente indisponível.
 */
export async function fetchTakeatDailyChannelSales(env, { unitId, unitName = "", date = "", now = Date.now() }) {
  const apiKey = String(env?.TAKEAT_MULTISTORE_API_KEY || "").trim();
  const isoDate = String(date || "").trim().slice(0, 10);
  if (!apiKey || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;

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
      signal: AbortSignal.timeout(6000),
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
        revenue: Math.round(revenue * 100) / 100,
      }))
      .filter((c) => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);

    if (!channels.length) return null;

    const total = Math.round(channels.reduce((sum, c) => sum + c.revenue, 0) * 100) / 100;
    return {
      restaurantId,
      date: isoDate,
      total,
      totalCents: Math.round(total * 100),
      channels,
    };
  } catch (_) {
    return null;
  }
}

export function resetTakeatSalesCacheForTests() {
  cachedOAuthToken = { key: "", token: "", expiresAt: 0 };
}
