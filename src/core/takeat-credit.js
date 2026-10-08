/**
 * takeat-credit.js
 * Integração direta do Gestão de Folgas 3.0 com a API Takeat
 * Consulta contas a prazo (limites, consumo e saldo devedor) das 3 lojas.
 */

import { runtime } from "./runtime.js";

export const TAKEEAT_STORES = {
  teixeira: {
    id: "teixeira",
    name: "House 190 Teixeira",
    email: "gleucehouse@gmail.com",
    password: "99596114",
  },
  eunapolis: {
    id: "eunapolis",
    name: "House 190 Eunápolis",
    email: "gleucehouse1@gmail.com",
    password: "99596114",
  },
  foodpark: {
    id: "foodpark",
    name: "House Foodpark",
    email: "gleucedias1@gmail.com",
    password: "99596114",
  },
};

const BASE_URL = "https://backend-pdv-2.takeat.app";
const tokenCache = new Map();

/**
 * Realiza autenticação com a Takeat para uma unidade e retorna o Bearer token
 */
export async function getTakeatToken(storeKey) {
  const store = TAKEEAT_STORES[storeKey];
  if (!store) throw new Error(`Unidade inválida: ${storeKey}`);

  const cached = tokenCache.get(storeKey) || sessionStorage.getItem(`takeat_token_${storeKey}`);
  if (cached) return cached;

  const res = await fetch(`${BASE_URL}/public/sessions/restaurants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: store.email,
      password: store.password,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`Falha no login Takeat (${store.name}): HTTP ${res.status} ${errorBody}`);
  }

  const data = await res.json();
  const token = data.token;
  if (!token) throw new Error(`Token não retornado pela Takeat para ${store.name}`);

  tokenCache.set(storeKey, token);
  try {
    sessionStorage.setItem(`takeat_token_${storeKey}`, token);
  } catch {}
  return token;
}

/**
 * Busca a lista de contas a prazo de uma loja específica na Takeat
 */
export async function fetchStoreCreditRegister(storeKey) {
  const store = TAKEEAT_STORES[storeKey];
  if (!store) return [];

  let token = await getTakeatToken(storeKey);
  let res = await fetch(`${BASE_URL}/restaurants/credit-register`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  // Se o token expirou, limpa cache e tenta login uma vez mais
  if (res.status === 401) {
    tokenCache.delete(storeKey);
    try { sessionStorage.removeItem(`takeat_token_${storeKey}`); } catch {}
    token = await getTakeatToken(storeKey);
    res = await fetch(`${BASE_URL}/restaurants/credit-register`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  }

  if (!res.ok) {
    throw new Error(`Erro ao buscar contas a prazo de ${store.name}: HTTP ${res.status}`);
  }

  const list = await res.json();
  if (!Array.isArray(list)) return [];

  return list.map((item) => {
    const totalLimit = parseFloat(item.total_limit || "0") || 0;
    const balance = parseFloat(item.balance || "0") || 0;
    const debt = balance < 0 ? Math.abs(balance) : 0;
    const percentUsed = totalLimit > 0 && debt > 0 ? Math.min(100, (debt / totalLimit) * 100) : 0;

    return {
      id: item.id,
      name: (item.name || "").trim(),
      phone: item.phone || "",
      cnpj: item.cnpj || "",
      totalLimit,
      balance,
      debt,
      percentUsed,
      storeKey,
      storeName: store.name,
      expiresAt: item.expires_at || null,
    };
  });
}

/**
 * Consulta todas as lojas ou a loja selecionada
 */
export async function fetchAllTakeatCredit(storeFilter = "all") {
  const targetKeys =
    storeFilter && storeFilter !== "all"
      ? [storeFilter]
      : Object.keys(TAKEEAT_STORES);

  const results = await Promise.allSettled(
    targetKeys.map(async (key) => {
      const items = await fetchStoreCreditRegister(key);
      return { key, items };
    }),
  );

  let merged = [];
  const errors = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      merged = merged.concat(r.value.items);
    } else {
      errors.push(r.reason?.message || "Erro desconhecido");
    }
  }

  // Ordena por maior débito primeiro
  merged.sort((a, b) => b.debt - a.debt);

  return {
    items: merged,
    errors,
  };
}

/**
 * Função utilitária para normalizar nomes removendo acentos e sufixos
 */
function cleanName(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(house|foodpark|gerente|bruno|fp|tx|loja|burger)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tenta vincular o nome da conta do Takeat com um colaborador cadastrado no Folgas 3.0
 */
export function matchEmployeeWithFolgas(takeatName, folgasEmployees = []) {
  if (!takeatName || !Array.isArray(folgasEmployees)) return null;

  const cleanedTakeat = cleanName(takeatName);
  if (!cleanedTakeat || cleanedTakeat.length < 3) return null;

  const takeatTokens = cleanedTakeat.split(" ").filter((t) => t.length > 2);
  if (takeatTokens.length === 0) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const emp of folgasEmployees) {
    const empName = emp.Nome || emp.nome || "";
    const cleanedEmp = cleanName(empName);
    if (!cleanedEmp) continue;

    const empTokens = cleanedEmp.split(" ").filter((t) => t.length > 2);

    // Contagem de tokens em comum
    let matches = 0;
    for (const t of takeatTokens) {
      if (empTokens.some((et) => et === t || et.startsWith(t) || t.startsWith(et))) {
        matches++;
      }
    }

    if (matches > 0 && matches > bestScore) {
      bestScore = matches;
      bestMatch = emp;
    }
  }

  return bestMatch;
}

/**
 * Carrega os mapeamentos personalizados (vínculos manuais) do Firebase / LocalStorage
 */
export async function loadMappings() {
  let mappings = {};
  try {
    const local = localStorage.getItem("takeat_credit_mappings");
    if (local) mappings = JSON.parse(local);
  } catch {}

  try {
    const record = await runtime.getById("Configuracoes", "takeat_credit_mappings");
    if (record && record.Valor) {
      const remote = typeof record.Valor === "string" ? JSON.parse(record.Valor) : record.Valor;
      mappings = { ...mappings, ...remote };
      localStorage.setItem("takeat_credit_mappings", JSON.stringify(mappings));
    }
  } catch (err) {
    // Mantém mappings locais se Firebase não responder
  }

  return mappings;
}

/**
 * Salva um vínculo manual de conta no Firebase e LocalStorage
 */
export async function saveMapping(accountKey, employeeId) {
  const mappings = await loadMappings();
  if (!employeeId) {
    delete mappings[accountKey];
  } else {
    mappings[accountKey] = employeeId;
  }

  try {
    localStorage.setItem("takeat_credit_mappings", JSON.stringify(mappings));
  } catch {}

  try {
    await runtime.upsert("Configuracoes", {
      Chave: "takeat_credit_mappings",
      Valor: JSON.stringify(mappings),
      AtualizadoEm: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("Aviso ao salvar mapeamento no Firebase:", err);
  }

  return mappings;
}

/**
 * Resolve o vínculo de uma conta: primeiro verifica mapeamento manual, depois auto matching
 */
export function resolveAccountMatch(item, employees = [], mappings = {}) {
  const accountKey = `${item.storeKey}_${item.id}`;
  const nameKey = `${item.storeKey}_${cleanName(item.name)}`;
  const rawKey = item.name;

  const manualValue = mappings[accountKey] ?? mappings[nameKey] ?? mappings[rawKey];

  if (manualValue === "ignored") {
    return {
      matchedEmployee: { isIgnored: true, Nome: "Desconsiderado (Operacional)" },
      isManual: true,
      isIgnored: true,
    };
  }

  if (manualValue) {
    const emp = employees.find((e) => String(e.FuncionarioID) === String(manualValue));
    if (emp) {
      return {
        matchedEmployee: emp,
        isManual: true,
        isIgnored: false,
      };
    }
  }

  const autoMatch = matchEmployeeWithFolgas(item.name, employees);
  return {
    matchedEmployee: autoMatch,
    isManual: false,
    isIgnored: false,
  };
}

const summaryCache = new Map();
const sessionDetailsCache = new Map();

export function clearTakeatSummaryCache() {
  summaryCache.clear();
  sessionDetailsCache.clear();
}

/**
 * Busca o extrato de compras e pagamentos de uma conta a prazo específica
 */
export async function fetchCreditRegisterSummary(storeKey, creditRegisterId, forceRefresh = false) {
  const cacheKey = `${storeKey}_${creditRegisterId}`;
  if (!forceRefresh && summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey);
  }

  const store = TAKEEAT_STORES[storeKey];
  if (!store) throw new Error(`Unidade inválida: ${storeKey}`);

  let token = await getTakeatToken(storeKey);
  let res = await fetch(`${BASE_URL}/restaurants/credit-register/summary/${creditRegisterId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (res.status === 401) {
    tokenCache.delete(storeKey);
    try { sessionStorage.removeItem(`takeat_token_${storeKey}`); } catch {}
    token = await getTakeatToken(storeKey);
    res = await fetch(`${BASE_URL}/restaurants/credit-register/summary/${creditRegisterId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  }

  if (!res.ok) {
    throw new Error(`Erro ao buscar extrato da conta #${creditRegisterId} (${store.name}): HTTP ${res.status}`);
  }

  const list = await res.json();
  if (!Array.isArray(list)) return [];

  const parsed = list.map((item) => {
    const rawVal = parseFloat(item.value || "0") || 0;
    const isConsumption = rawVal < 0 || (item.status && item.status.toLowerCase().includes("consumo"));
    const value = Math.abs(rawVal);
    const discountedValue = value * 0.8;

    return {
      id: item.id,
      rawValue: rawVal,
      value,
      discountedValue,
      isConsumption,
      sessionId: item.session_id || null,
      sessionNumber: item.session_number || null,
      serie: item.serie ?? null,
      createdAt: item.created_at || null,
      total: parseFloat(item.total || "0") || 0,
      status: item.status || (isConsumption ? "Consumo" : "Pagamento"),
    };
  });

  summaryCache.set(cacheKey, parsed);
  return parsed;
}

/**
 * Busca os detalhes e itens consumidos de uma comanda / sessão específica
 */
export async function fetchTableSessionDetails(storeKey, sessionId) {
  if (!sessionId) return null;
  const cacheKey = `${storeKey}_${sessionId}`;
  if (sessionDetailsCache.has(cacheKey)) {
    return sessionDetailsCache.get(cacheKey);
  }

  const store = TAKEEAT_STORES[storeKey];
  if (!store) throw new Error(`Unidade inválida: ${storeKey}`);

  let token = await getTakeatToken(storeKey);
  let res = await fetch(`${BASE_URL}/restaurants/table-sessions/${sessionId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (res.status === 401) {
    tokenCache.delete(storeKey);
    try { sessionStorage.removeItem(`takeat_token_${storeKey}`); } catch {}
    token = await getTakeatToken(storeKey);
    res = await fetch(`${BASE_URL}/restaurants/table-sessions/${sessionId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  }

  if (!res.ok) {
    throw new Error(`Erro ao consultar comanda #${sessionId}: HTTP ${res.status}`);
  }

  const data = await res.json();
  const tableSession = data.tableSession || {};
  const bill = tableSession.bills?.[0] || {};
  const rawOrders = bill.order_baskets?.flatMap((b) => b.orders || []) || [];

  const orders = rawOrders.map((o) => {
    const complements =
      o.complement_categories
        ?.flatMap((cc) => cc.order_complements?.map((oc) => oc.complement?.name).filter(Boolean))
        .filter(Boolean) || [];

    return {
      id: o.id,
      productName: o.product?.name || "Item",
      amount: o.amount || 1,
      price: parseFloat(o.price || o.total_price || "0") || 0,
      totalPrice: parseFloat(o.total_price || o.price || "0") || 0,
      details: (o.details || "").trim(),
      complements,
    };
  });

  const details = {
    sessionId: tableSession.id || sessionId,
    sessionNumber: tableSession.session_number || null,
    attendancePassword: tableSession.attendance_password || null,
    totalPrice: parseFloat(tableSession.total_price || "0") || 0,
    startTime: bill.start_time || tableSession.start_time || tableSession.createdAt,
    buyerName: bill.buyer?.name || null,
    buyerPhone: bill.buyer?.phone || null,
    orders,
  };

  sessionDetailsCache.set(cacheKey, details);
  return details;
}
