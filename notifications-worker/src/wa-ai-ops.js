import { active, bahiaDay, scheduleForDay, workday } from "../../src/core/reminder-policy.js";
import { normalizeWhatsAppPhone } from "./whatsapp.js";

const EMOJI_RE =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FAFF}\u{FE00}-\u{FE0F}]/gu;

export const cleanStr = (value) =>
  String(value ?? "")
    .replace(EMOJI_RE, "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim();

export const cleanMultiline = (value) =>
  String(value ?? "")
    .replace(EMOJI_RE, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\r\n/g, "\n")
    .trim();

export const foldStr = (value) =>
  cleanStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const empIdOf = (row) => String(row?.FuncionarioID || row?.funcionarioId || row?.id || "").trim();
export const storeIdOf = (row) => String(row?.LojaID || row?.LOJA_ID || row?.lojaId || "").trim();

export const isIsoDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === String(value);

export const normalizeTimeHHMM = (value) => {
  const m = String(value || "").trim().match(/^(\d{1,2})[:hH](\d{2})(?::\d{2})?$/);
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
};

export const formatDateBR = (isoDate) => {
  const s = String(isoDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

export const formatBRL = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatTimeBahia = (value) => {
  if (!value) return "";
  const plain = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (plain) return `${plain[1].padStart(2, "0")}:${plain[2]}`;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value).slice(0, 5);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
};

export const formatMinutesSigned = (totalMinutes) => {
  const rounded = Math.round(Number(totalMinutes) || 0);
  const sign = rounded < 0 ? "-" : "+";
  const abs = Math.abs(rounded);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

export function getRoleFlags(profile = {}, employee = {}) {
  const raw = String(profile?.Perfil || employee?.Perfil || "");
  const role = foldStr(raw);
  const isAdmin = role === "administrador" || role === "admin" || role === "diretoria";
  const isManager = isAdmin || /gerente|manager|responsavel/.test(role);
  const isKitchenLead = isManager || /chefe de cozinha/.test(role);
  return { raw, role, isAdmin, isManager, isKitchenLead };
}

export function extractScheduleTimes(schedule) {
  if (!schedule) return null;
  const fmt = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    const m = s.match(/(?:^|T|\s)(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
  };
  return {
    entrada: fmt(schedule.HoraEntrada || schedule.Entrada),
    intervaloInicio: fmt(schedule.HoraSaidaIntervalo || schedule.SaidaIntervalo),
    intervaloFim: fmt(schedule.HoraRetornoIntervalo || schedule.RetornoIntervalo),
    saida: fmt(schedule.HoraSaida || schedule.Saida),
    duracaoIntervaloMinutos: Number(schedule.DuracaoIntervaloMinutos || 0) || null,
    toleranciaMinutos: schedule.ToleranciaMinutos !== undefined && schedule.ToleranciaMinutos !== "" ? Number(schedule.ToleranciaMinutos) : null,
    cargaDiariaMinutos: Number(schedule.CargaDiariaMinutos || 0) || null,
  };
}

export function resolveAuthorizedTarget({ employee, employees = [], profile = {}, targetId = "", targetName = "" }) {
  const { isAdmin, isManager } = getRoleFlags(profile, employee);
  const selfId = empIdOf(employee);
  const selfStore = storeIdOf(employee) || storeIdOf(profile);
  const allowedPool = employees.filter(
    (row) => (row.Ativo === undefined || active(row.Ativo)) && (isAdmin || (selfStore && storeIdOf(row) === selfStore))
  );

  const wantedId = cleanStr(targetId);
  const wantedName = cleanStr(targetName);

  if (!wantedId && !wantedName) {
    if (!selfId || selfId.startsWith("app:") || selfId.startsWith("wa-admin:")) {
      return { ok: false, erro: "Informe o nome ou identificador do colaborador para executar esta ação." };
    }
    return { ok: true, target: employee };
  }

  if (wantedId && wantedId === selfId) {
    return { ok: true, target: employee };
  }

  if (!isManager) {
    if (wantedName && foldStr(employee.Nome).includes(foldStr(wantedName))) {
      return { ok: true, target: employee };
    }
    return { ok: false, erro: "Você só tem permissão para consultar ou alterar registros do seu próprio cadastro." };
  }

  if (wantedId) {
    const exact = [employee, ...allowedPool].find((row) => empIdOf(row) === wantedId);
    if (!exact) {
      return { ok: false, erro: "Colaborador não encontrado ou fora da sua unidade autorizada." };
    }
    return { ok: true, target: exact };
  }

  const q = foldStr(wantedName);
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const exactFull = allowedPool.filter((row) => foldStr(row.Nome) === q);
  if (exactFull.length === 1) return { ok: true, target: exactFull[0] };

  const scored = allowedPool
    .map((row) => {
      const nameFold = foldStr(row.Nome);
      const parts = nameFold.split(/\s+/);
      let score = 0;
      if (nameFold === q) score = 100;
      else if (nameFold.startsWith(q)) score = 85;
      else if (tokens.length > 0 && tokens.every((tok) => parts.some((p) => p.startsWith(tok)))) score = 75;
      else if (nameFold.includes(q)) score = 60;
      else if (tokens.length > 0 && parts[0] === tokens[0]) score = 50;
      return { row, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { ok: false, erro: `Não encontrei colaborador ativo com o nome "${wantedName}" na sua unidade autorizada.` };
  }
  const topScore = scored[0].score;
  const tied = scored.filter((item) => item.score === topScore);
  if (tied.length > 1) {
    return {
      ok: false,
      erro: "Encontrei mais de um colaborador com esse nome. Confirme qual deles você quer atender.",
      candidatos: tied.slice(0, 6).map((item) => ({
        id: empIdOf(item.row),
        nome: cleanStr(item.row.Nome),
        cargo: cleanStr(item.row.Cargo),
        unidade: cleanStr(item.row.NomeLoja || storeIdOf(item.row)),
      })),
    };
  }
  return { ok: true, target: scored[0].row };
}

function clockToMinutes(value) {
  if (!value) return null;
  const m = String(value).trim().match(/(?:^|T|\s)(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function expectedMinutesFromSchedule(schedule) {
  if (!schedule) return 440;
  const start = clockToMinutes(schedule.HoraEntrada || schedule.Entrada);
  const end = clockToMinutes(schedule.HoraSaida || schedule.Saida);
  const brk = Math.max(0, Number(schedule.DuracaoIntervaloMinutos || 0));
  if (start !== null && end !== null) {
    const gross = (end - start + 1440) % 1440;
    const net = gross - brk;
    if (net > 0) return net;
  }
  return Number(schedule.CargaDiariaMinutos || 440) || 440;
}

export function computeRealHourBalance({
  employee,
  punches = [],
  schedules = [],
  leaves = [],
  justifications = [],
  movements = [],
  today,
  month = "",
}) {
  const targetId = empIdOf(employee);
  const targetMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : "";
  const validPunches = punches.filter(
    (p) => empIdOf(p) === targetId && p.Status !== "Substituído"
  );
  const byDay = new Map();
  for (const p of validPunches) {
    const day = String(p.Data || p.DataHora || "").slice(0, 10);
    if (!isIsoDate(day)) continue;
    if (targetMonth && !day.startsWith(targetMonth)) continue;
    if (day > today) continue;
    const list = byDay.get(day) || [];
    list.push(p);
    byDay.set(day, list);
  }

  const justifiedDays = new Set(
    justifications
      .filter((j) => empIdOf(j) === targetId && String(j.Status || "Aprovada").toLowerCase() !== "rejeitada")
      .map((j) => String(j.Data || "").slice(0, 10))
  );
  const ownLeaves = leaves.filter((l) => empIdOf(l) === targetId);
  const rank = { ENTRADA: 0, SAIDA_INTERVALO: 1, RETORNO_INTERVALO: 2, SEM_DESCANSO: 2, SAIDA_FINAL: 3 };

  let totalWorked = 0;
  let totalExpected = 0;
  let totalBalance = 0;
  let completedDays = 0;
  const incompleteDays = [];

  for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ordered = [...list].sort((a, b) => {
      const ta = Date.parse(a.DataHora || "");
      const tb = Date.parse(b.DataHora || "");
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return (rank[a.TipoMarcacao] ?? 9) - (rank[b.TipoMarcacao] ?? 9);
    });
    const entry = ordered.find((r) => r.TipoMarcacao === "ENTRADA");
    const exit = [...ordered].reverse().find((r) => r.TipoMarcacao === "SAIDA_FINAL");
    const brkOut = ordered.find((r) => r.TipoMarcacao === "SAIDA_INTERVALO");
    const brkIn = ordered.find((r) => r.TipoMarcacao === "RETORNO_INTERVALO");
    const noBrk = ordered.find((r) => r.TipoMarcacao === "SEM_DESCANSO");
    const sched = scheduleForDay(schedules, targetId, day);
    const schedBreak = Math.max(0, Number(sched?.DuracaoIntervaloMinutos || 0));

    if (!entry || !exit || (schedBreak > 0 && brkOut && !brkIn && !noBrk)) {
      if (day < today) {
        incompleteDays.push({
          data: day,
          batidas: ordered.map((r) => `${r.TipoMarcacao} ${formatTimeBahia(r.DataHora || r.Hora)}`),
        });
      }
      continue;
    }

    const tStart = Date.parse(entry.DataHora || "");
    const tEnd = Date.parse(exit.DataHora || "");
    let grossMin = 0;
    if (Number.isFinite(tStart) && Number.isFinite(tEnd) && tEnd >= tStart) {
      grossMin = (tEnd - tStart) / 60000;
    } else {
      const mStart = clockToMinutes(entry.Hora || entry.DataHora);
      const mEnd = clockToMinutes(exit.Hora || exit.DataHora);
      if (mStart !== null && mEnd !== null) grossMin = (mEnd - mStart + 1440) % 1440;
    }
    let breakMin = 0;
    if (brkOut && brkIn) {
      const b1 = Date.parse(brkOut.DataHora || "");
      const b2 = Date.parse(brkIn.DataHora || "");
      if (Number.isFinite(b1) && Number.isFinite(b2) && b2 >= b1) breakMin = (b2 - b1) / 60000;
      else {
        const m1 = clockToMinutes(brkOut.Hora || brkOut.DataHora);
        const m2 = clockToMinutes(brkIn.Hora || brkIn.DataHora);
        if (m1 !== null && m2 !== null) breakMin = (m2 - m1 + 1440) % 1440;
      }
    } else if (brkOut && !brkIn) {
      breakMin = schedBreak;
    }

    const worked = Math.min(12 * 60, Math.max(0, grossMin - breakMin));
    const isDayOff = sched ? !workday(employee, sched, day, ownLeaves) : false;
    const expected = justifiedDays.has(day) ? worked : isDayOff ? 0 : expectedMinutesFromSchedule(sched);
    const tolerance = Math.max(0, Number(sched?.ToleranciaMinutos ?? 10));
    const rawDiff = worked - expected;
    const dayDiff = Math.abs(rawDiff) <= tolerance ? 0 : rawDiff;

    totalWorked += worked;
    totalExpected += expected;
    totalBalance += dayDiff;
    completedDays++;
  }

  let manualMovementsMinutes = 0;
  for (const mv of movements) {
    if (empIdOf(mv) !== targetId) continue;
    const mvDate = String(mv.Data || mv.DataCriacao || "").slice(0, 10);
    if (targetMonth && mvDate && !mvDate.startsWith(targetMonth)) continue;
    const mins = Number(mv.Minutos ?? mv.DeltaMinutos ?? 0);
    if (!Number.isFinite(mins)) continue;
    const tipo = foldStr(mv.Tipo || "");
    if (tipo.includes("debito") || tipo.includes("compensacao") || tipo.includes("desconto")) {
      manualMovementsMinutes -= Math.abs(mins);
    } else {
      manualMovementsMinutes += mins;
    }
  }

  const finalBalance = Math.round(totalBalance + manualMovementsMinutes);
  return {
    periodo: targetMonth || "acumulado_registros",
    diasCompletosApurados: completedDays,
    horasTrabalhadas: `${Math.floor(totalWorked / 60)}h${String(Math.round(totalWorked % 60)).padStart(2, "0")}m`,
    horasEsperadas: `${Math.floor(totalExpected / 60)}h${String(Math.round(totalExpected % 60)).padStart(2, "0")}m`,
    movimentosManuaisFormatado: formatMinutesSigned(manualMovementsMinutes),
    saldoMinutos: finalBalance,
    saldoFormatado: formatMinutesSigned(finalBalance),
    situacao: finalBalance > 0 ? "positivo" : finalBalance < 0 ? "negativo" : "zerado",
    diasComBatidaIncompleta: incompleteDays.slice(-10),
    observacao: "Apuração baseada nos registros de ponto, jornadas vigentes, folgas, justificativas e movimentos de banco de horas do sistema.",
  };
}

const TAKEAT_PDV_BASE = "https://backend-pdv-2.takeat.app";

export async function fetchEmployeeTakeatCredit(env, employee, stores = [], fetcher = fetch) {
  try {
    const rawCreds = env?.TAKEAT_PDV_CREDENTIALS;
    if (!rawCreds) return null;
    const credsMap = typeof rawCreds === "object" ? rawCreds : JSON.parse(String(rawCreds));
    if (!credsMap || typeof credsMap !== "object") return null;

    const unit = stores.find((s) => storeIdOf(s) === storeIdOf(employee) || String(s.id || "") === storeIdOf(employee));
    const storeText = foldStr(`${unit?.NomeLoja || unit?.Nome || employee?.NomeLoja || ""} ${storeIdOf(employee)}`);
    let unitKeys = Object.keys(credsMap);
    if (storeText.includes("eunapolis")) unitKeys = unitKeys.filter((k) => foldStr(k).includes("eunapolis"));
    else if (storeText.includes("food") || storeText.includes("park")) unitKeys = unitKeys.filter((k) => foldStr(k).includes("food"));
    else if (storeText.includes("teixeira") || storeText.includes("gourmet")) unitKeys = unitKeys.filter((k) => foldStr(k).includes("teixeira"));
    if (!unitKeys.length) unitKeys = Object.keys(credsMap);

    const empNameFold = foldStr(employee?.Nome || "");
    const empTokens = empNameFold.split(/\s+/).filter((t) => t.length > 2);
    const empPhoneDigits = normalizeWhatsAppPhone(employee?.Telefone || employee?.WhatsApp || employee?.Celular || "")?.digits || "";

    for (const key of unitKeys.slice(0, 3)) {
      const cred = credsMap[key];
      if (!cred?.email || !cred?.password) continue;
      const loginRes = await fetcher(`${TAKEAT_PDV_BASE}/public/sessions/restaurants`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: cred.email, password: cred.password }),
        signal: AbortSignal.timeout(4000),
      });
      if (!loginRes.ok) continue;
      const loginData = await loginRes.json().catch(() => null);
      const token = loginData?.token || loginData?.access_token;
      if (!token) continue;

      const listRes = await fetcher(`${TAKEAT_PDV_BASE}/restaurants/credit-register`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      });
      if (!listRes.ok) continue;
      const list = await listRes.json().catch(() => null);
      if (!Array.isArray(list)) continue;

      const match = list.find((item) => {
        const itemPhone = normalizeWhatsAppPhone(item.phone || "")?.digits || "";
        if (empPhoneDigits && itemPhone && itemPhone.slice(-8) === empPhoneDigits.slice(-8)) return true;
        const itemFold = foldStr(item.name || "");
        if (!itemFold || empTokens.length === 0) return false;
        const hits = empTokens.filter((t) => itemFold.includes(t)).length;
        return hits >= Math.min(2, empTokens.length);
      });
      if (match) {
        const limiteTotal = parseFloat(match.total_limit || "0") || 0;
        const balance = parseFloat(match.balance || "0") || 0;
        const consumido = balance < 0 ? Math.abs(balance) : 0;
        const disponivel = Math.max(0, limiteTotal - consumido);
        return {
          unidadeTakeat: key,
          conta: cleanStr(match.name),
          limiteTotal: formatBRL(limiteTotal),
          consumido: formatBRL(consumido),
          disponivel: formatBRL(disponivel),
          percentualUso: limiteTotal > 0 ? `${Math.round((consumido / limiteTotal) * 100)}%` : "0%",
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function patchTables(env, tok, updates, fetcher = fetch) {
  if (!env?.FIREBASE_DATABASE_URL || !env?.FIREBASE_ROOT) {
    throw new Error("firebase_not_configured");
  }
  const url = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables.json`;
  const res = await fetcher(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(updates),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`firebase_patch_${res.status}`);
  return true;
}

function buildBahiaIso(isoDate, hhmm, referenceEntryIso = "") {
  let targetDate = isoDate;
  const hour = Number(hhmm.slice(0, 2));
  if (referenceEntryIso && hour < 6) {
    const entryHour = Number(formatTimeBahia(referenceEntryIso).slice(0, 2));
    if (Number.isFinite(entryHour) && entryHour >= 15) {
      const next = new Date(`${isoDate}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      targetDate = next.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(`${targetDate}T${hhmm}:00-03:00`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Data ou horário inválido.");
  return parsed.toISOString();
}

function createAuditEntry({ acao, modulo, tabela, registroId, actor, target, detalhes = {}, now }) {
  const id = `aud-ai-${crypto.randomUUID()}`;
  return {
    id,
    record: {
      AuditoriaID: id,
      Acao: cleanStr(acao),
      Modulo: cleanStr(modulo || "HouseAI"),
      Tabela: cleanStr(tabela || ""),
      RegistroID: cleanStr(registroId || ""),
      Usuario: cleanStr(actor?.Nome || actor?.Email || "House AI"),
      EmailUsuario: cleanStr(actor?.Email || ""),
      PerfilUsuario: cleanStr(actor?.Perfil || ""),
      LojaID: storeIdOf(target) || storeIdOf(actor) || "",
      FuncionarioID: empIdOf(target) || empIdOf(actor) || "",
      Detalhes: detalhes,
      DataHora: new Date(now).toISOString(),
    },
  };
}

function createNoticeEntry({ lojaId, destinatarioId = "", destinatario = "", tipo, assunto, mensagem, relacionadoId = "", actor, now }) {
  const id = `notif-ai-${crypto.randomUUID()}`;
  return {
    id,
    record: {
      NotificacaoID: id,
      LojaID: cleanStr(lojaId),
      DestinatarioID: cleanStr(destinatarioId),
      Destinatario: cleanStr(destinatario),
      Tipo: cleanStr(tipo || "Aviso"),
      Assunto: cleanStr(assunto),
      Mensagem: cleanStr(mensagem),
      RegistoRelacionadoID: cleanStr(relacionadoId),
      Status: "Não lida",
      DataCriacao: new Date(now).toISOString(),
      CriadoPor: cleanStr(actor?.Nome || actor?.Email || "House AI"),
    },
  };
}

async function notifyPhone(sendWhatsApp, target, text) {
  if (typeof sendWhatsApp !== "function") return { attempted: false, sent: false };
  const rawPhone = target?.WhatsApp || target?.Telefone || target?.Celular || "";
  const norm = normalizeWhatsAppPhone(rawPhone);
  if (!norm?.digits) return { attempted: false, sent: false, motivo: "sem_telefone" };
  try {
    const res = await sendWhatsApp({ phone: norm.digits, text: cleanMultiline(text) });
    return { attempted: true, sent: Boolean(res?.success), messageId: res?.messageId || "" };
  } catch (err) {
    return { attempted: true, sent: false, erro: String(err?.message || err) };
  }
}

export async function executeOperationalAction({
  acao,
  args = {},
  employee,
  employees = [],
  profile = {},
  database,
  env,
  tok,
  now = Date.now(),
  sendWhatsApp = null,
  fetcher = fetch,
}) {
  const { isAdmin, isManager, isKitchenLead } = getRoleFlags(profile, employee);
  const today = bahiaDay(now);
  const nowIso = new Date(now).toISOString();
  const actor = {
    Nome: cleanStr(profile?.Nome || employee?.Nome || "Usuário"),
    Email: cleanStr(profile?.Email || employee?.Email || ""),
    Perfil: cleanStr(profile?.Perfil || employee?.Perfil || "Funcionário"),
    LojaID: storeIdOf(profile) || storeIdOf(employee),
    FuncionarioID: empIdOf(employee),
  };
  const rows = async (table) => Object.values((await database(env, tok, `tables/${table}`).catch(() => ({}))) || {});

  try {
    switch (acao) {
      case "incluir_ponto": {
        const resolved = resolveAuthorizedTarget({
          employee,
          employees,
          profile,
          targetId: args.funcionario_id,
          targetName: args.funcionario_nome,
        });
        if (!resolved.ok) return resolved;
        const target = resolved.target;
        const data = cleanStr(args.data || today);
        const horario = normalizeTimeHHMM(args.horario);
        const tipo = cleanStr(args.tipo_marcacao).toUpperCase();
        const motivo = cleanStr(args.motivo);
        const validTypes = ["ENTRADA", "SAIDA_INTERVALO", "RETORNO_INTERVALO", "SEM_DESCANSO", "SAIDA_FINAL"];

        if (!isIsoDate(data)) return { erro: "Informe a data válida no formato AAAA-MM-DD." };
        if (data > today) return { erro: "Não é possível incluir marcação de ponto em data futura." };
        if (!horario) return { erro: "Informe o horário no formato HH:MM (ex.: 18:00)." };
        if (!validTypes.includes(tipo)) {
          return { erro: `Tipo de marcação inválido. Use um de: ${validTypes.join(", ")}.` };
        }
        if (motivo.length < 3) return { erro: "Informe o motivo/justificativa da inclusão de ponto." };

        const existingDay = (await rows("RegistrosPonto")).filter(
          (r) => empIdOf(r) === empIdOf(target) && String(r.Data || "").slice(0, 10) === data && r.Status !== "Substituído"
        );
        const sameType = existingDay.find((r) => r.TipoMarcacao === tipo);
        if (sameType) {
          return {
            erro: `${cleanStr(target.Nome)} já possui batida de ${tipo} em ${formatDateBR(data)} às ${formatTimeBahia(sameType.DataHora || sameType.Hora)} (ID: ${sameType.RegistroPontoID}). Use alterar_ponto para corrigir esse horário.`,
          };
        }

        const entryPunch = existingDay.find((r) => r.TipoMarcacao === "ENTRADA");
        const dataHoraIso = buildBahiaIso(data, horario, tipo === "SAIDA_FINAL" ? entryPunch?.DataHora : "");
        const updates = {};

        if (isManager) {
          const punchId = `ponto-ai-${crypto.randomUUID()}`;
          const record = {
            RegistroPontoID: punchId,
            FuncionarioID: empIdOf(target),
            NomeFuncionario: cleanStr(target.Nome),
            EmailFuncionario: cleanStr(target.Email || ""),
            LojaID: storeIdOf(target),
            NomeLoja: cleanStr(target.NomeLoja || ""),
            Data: data,
            TipoMarcacao: tipo,
            DataHora: dataHoraIso,
            Hora: horario,
            Latitude: "",
            Longitude: "",
            PrecisaoMetros: "",
            DistanciaLojaMetros: "",
            DentroRaio: true,
            Origem: "Lançamento administrativo (House AI)",
            Status: "Válido",
            Observacoes: motivo,
            Ajustado: true,
            RegistroOriginalID: "",
            DataCriacao: nowIso,
            ForaHorario: false,
            CriadoPor: actor.Email || actor.Nome,
          };
          updates[`RegistrosPonto/${punchId}`] = record;

          const notice = createNoticeEntry({
            lojaId: storeIdOf(target),
            destinatarioId: empIdOf(target),
            destinatario: target.Email || target.Nome,
            tipo: "Ponto",
            assunto: "Inclusão de ponto registrada",
            mensagem: `A gestão registrou sua batida de ${tipo} em ${formatDateBR(data)} às ${horario}. Motivo: ${motivo}.`,
            relacionadoId: punchId,
            actor,
            now,
          });
          updates[`Notificacoes/${notice.id}`] = notice.record;

          const aud = createAuditEntry({
            acao: "Lançar ponto manual via House AI",
            tabela: "RegistrosPonto",
            registroId: punchId,
            actor,
            target,
            detalhes: { data, horario, tipo, motivo },
            now,
          });
          updates[`Auditoria/${aud.id}`] = aud.record;
          await patchTables(env, tok, updates, fetcher);

          const waRes =
            args.notificar_whatsapp !== false && empIdOf(target) !== actor.FuncionarioID
              ? await notifyPhone(
                  sendWhatsApp,
                  target,
                  `Olá, ${cleanStr(target.Nome).split(/\s+/)[0]}!\nA gestão incluiu sua marcação de ponto (${tipo}) referente a ${formatDateBR(data)} às ${horario}.\nMotivo: ${motivo}.`
                )
              : { attempted: false, sent: false };

          return {
            ok: true,
            acao: "incluir_ponto",
            executadoDireto: true,
            protocolo: punchId,
            colaborador: cleanStr(target.Nome),
            data: formatDateBR(data),
            tipoMarcacao: tipo,
            horario,
            motivo,
            avisoWhatsApp: waRes,
          };
        }

        // Funcionário: abre solicitação oficial de inclusão em AjustesPonto para aprovação da gerência (Portaria 671)
        const ajusteId = `ajuste-ai-${crypto.randomUUID()}`;
        updates[`AjustesPonto/${ajusteId}`] = {
          AjustePontoID: ajusteId,
          RegistroPontoID: "",
          TipoAjuste: "Inclusão",
          FuncionarioID: empIdOf(target),
          NomeFuncionario: cleanStr(target.Nome),
          LojaID: storeIdOf(target),
          Data: data,
          TipoMarcacao: tipo,
          DataHoraOriginal: "",
          DataHoraSolicitada: dataHoraIso,
          Motivo: motivo,
          Status: "Pendente",
          SolicitadoPor: actor.Email || actor.Nome,
          DataSolicitacao: nowIso,
          DecididoPor: "",
          DataDecisao: "",
          ObservacaoDecisao: "",
          DataHoraAprovada: "",
        };
        const notice = createNoticeEntry({
          lojaId: storeIdOf(target),
          tipo: "Ponto",
          assunto: "Solicitação de inclusão de ponto",
          mensagem: `${cleanStr(target.Nome)} solicitou inclusão de ponto (${tipo}) em ${formatDateBR(data)} às ${horario}. Motivo: ${motivo}.`,
          relacionadoId: ajusteId,
          actor,
          now,
        });
        updates[`Notificacoes/${notice.id}`] = notice.record;
        const aud = createAuditEntry({
          acao: "Solicitar inclusão de ponto via House AI",
          tabela: "AjustesPonto",
          registroId: ajusteId,
          actor,
          target,
          detalhes: { data, horario, tipo, motivo },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);

        return {
          ok: true,
          acao: "solicitar_inclusao_ponto",
          executadoDireto: false,
          status: "Pendente de aprovação da gerência",
          protocolo: ajusteId,
          colaborador: cleanStr(target.Nome),
          data: formatDateBR(data),
          tipoMarcacao: tipo,
          horario,
          motivo,
        };
      }

      case "alterar_ponto": {
        const resolved = resolveAuthorizedTarget({
          employee,
          employees,
          profile,
          targetId: args.funcionario_id,
          targetName: args.funcionario_nome,
        });
        if (!resolved.ok) return resolved;
        const target = resolved.target;
        const novoHorario = normalizeTimeHHMM(args.novo_horario || args.horario);
        const motivo = cleanStr(args.motivo);
        if (!novoHorario) return { erro: "Informe o novo horário válido no formato HH:MM." };
        if (motivo.length < 3) return { erro: "Informe o motivo da alteração do ponto." };

        const allPunches = await rows("RegistrosPonto");
        let punch = null;
        if (args.registro_ponto_id) {
          punch = allPunches.find((r) => String(r.RegistroPontoID || r.id) === cleanStr(args.registro_ponto_id));
        } else {
          const data = cleanStr(args.data || today);
          const tipo = cleanStr(args.tipo_marcacao).toUpperCase();
          if (!isIsoDate(data)) return { erro: "Informe a data da batida no formato AAAA-MM-DD." };
          const dayPunches = allPunches.filter(
            (r) => empIdOf(r) === empIdOf(target) && String(r.Data || "").slice(0, 10) === data && r.Status !== "Substituído"
          );
          punch = tipo ? dayPunches.find((r) => r.TipoMarcacao === tipo) : dayPunches.length === 1 ? dayPunches[0] : null;
          if (!punch) {
            return {
              erro: dayPunches.length
                ? `Não encontrei batida de ${tipo || "tipo especificado"} em ${formatDateBR(data)} para ${cleanStr(target.Nome)}. Batidas existentes nesse dia: ${dayPunches.map((p) => `${p.TipoMarcacao} às ${formatTimeBahia(p.DataHora || p.Hora)} (ID ${p.RegistroPontoID})`).join("; ")}.`
                : `${cleanStr(target.Nome)} não possui nenhuma batida em ${formatDateBR(data)}. Se precisa adicionar uma marcação que faltou, use incluir_ponto.`,
            };
          }
        }

        if (!punch) return { erro: "Registro de ponto não encontrado." };
        if (empIdOf(punch) !== empIdOf(target) && !isManager) {
          return { erro: "Você não tem permissão para alterar batidas de outro colaborador." };
        }
        if (!isAdmin && storeIdOf(punch) && actor.LojaID && storeIdOf(punch) !== actor.LojaID) {
          return { erro: "Registro de ponto pertence a outra unidade." };
        }

        const punchDate = String(punch.Data || punch.DataHora || "").slice(0, 10);
        const dayEntry = allPunches.find(
          (r) => empIdOf(r) === empIdOf(punch) && String(r.Data || "").slice(0, 10) === punchDate && r.TipoMarcacao === "ENTRADA" && r.Status !== "Substituído"
        );
        const novaDataHoraIso = buildBahiaIso(punchDate, novoHorario, punch.TipoMarcacao === "SAIDA_FINAL" ? dayEntry?.DataHora : "");
        const horarioAnterior = formatTimeBahia(punch.DataHora || punch.Hora);
        const ajusteId = `ajuste-ai-${crypto.randomUUID()}`;
        const updates = {};

        if (isManager) {
          updates[`AjustesPonto/${ajusteId}`] = {
            AjustePontoID: ajusteId,
            RegistroPontoID: punch.RegistroPontoID,
            TipoAjuste: "Alteração",
            FuncionarioID: empIdOf(punch),
            NomeFuncionario: cleanStr(punch.NomeFuncionario || target.Nome),
            LojaID: storeIdOf(punch) || storeIdOf(target),
            Data: punchDate,
            TipoMarcacao: punch.TipoMarcacao,
            DataHoraOriginal: punch.DataHora || "",
            DataHoraSolicitada: novaDataHoraIso,
            DataHoraAprovada: novaDataHoraIso,
            Motivo: motivo,
            Status: "Aprovado",
            SolicitadoPor: actor.Email || actor.Nome,
            DataSolicitacao: nowIso,
            DecididoPor: actor.Email || actor.Nome,
            DataDecisao: nowIso,
            ObservacaoDecisao: `Alterado diretamente via House AI por ${actor.Nome}: ${motivo}`,
          };
          updates[`RegistrosPonto/${punch.RegistroPontoID}/DataHora`] = novaDataHoraIso;
          updates[`RegistrosPonto/${punch.RegistroPontoID}/Hora`] = novoHorario;
          updates[`RegistrosPonto/${punch.RegistroPontoID}/Ajustado`] = true;
          updates[`RegistrosPonto/${punch.RegistroPontoID}/Observacoes`] = `Ajustado por ${actor.Email || actor.Nome}: ${motivo}`;

          const notice = createNoticeEntry({
            lojaId: storeIdOf(punch) || storeIdOf(target),
            destinatarioId: empIdOf(punch),
            destinatario: target.Email || target.Nome,
            tipo: "Ponto",
            assunto: "Ponto ajustado pela gestão",
            mensagem: `Sua batida de ${punch.TipoMarcacao} em ${formatDateBR(punchDate)} foi ajustada de ${horarioAnterior} para ${novoHorario}. Motivo: ${motivo}.`,
            relacionadoId: ajusteId,
            actor,
            now,
          });
          updates[`Notificacoes/${notice.id}`] = notice.record;

          const aud = createAuditEntry({
            acao: "Alterar ponto via House AI",
            tabela: "RegistrosPonto",
            registroId: punch.RegistroPontoID,
            actor,
            target,
            detalhes: { ajusteId, data: punchDate, tipo: punch.TipoMarcacao, horarioAnterior, novoHorario, motivo },
            now,
          });
          updates[`Auditoria/${aud.id}`] = aud.record;
          await patchTables(env, tok, updates, fetcher);

          const waRes =
            args.notificar_whatsapp !== false && empIdOf(target) !== actor.FuncionarioID
              ? await notifyPhone(
                  sendWhatsApp,
                  target,
                  `Olá, ${cleanStr(target.Nome).split(/\s+/)[0]}!\nA gestão ajustou sua batida de ${punch.TipoMarcacao} em ${formatDateBR(punchDate)} de ${horarioAnterior} para ${novoHorario}.\nMotivo: ${motivo}.`
                )
              : { attempted: false, sent: false };

          return {
            ok: true,
            acao: "alterar_ponto",
            executadoDireto: true,
            protocolo: ajusteId,
            registroPontoId: punch.RegistroPontoID,
            colaborador: cleanStr(target.Nome),
            data: formatDateBR(punchDate),
            tipoMarcacao: punch.TipoMarcacao,
            horarioAnterior,
            novoHorario,
            motivo,
            avisoWhatsApp: waRes,
          };
        }

        // Funcionário: cria pedido pendente em AjustesPonto
        updates[`AjustesPonto/${ajusteId}`] = {
          AjustePontoID: ajusteId,
          RegistroPontoID: punch.RegistroPontoID,
          TipoAjuste: "Alteração",
          FuncionarioID: empIdOf(punch),
          NomeFuncionario: cleanStr(punch.NomeFuncionario || target.Nome),
          LojaID: storeIdOf(punch) || storeIdOf(target),
          Data: punchDate,
          TipoMarcacao: punch.TipoMarcacao,
          DataHoraOriginal: punch.DataHora || "",
          DataHoraSolicitada: novaDataHoraIso,
          Motivo: motivo,
          Status: "Pendente",
          SolicitadoPor: actor.Email || actor.Nome,
          DataSolicitacao: nowIso,
          DecididoPor: "",
          DataDecisao: "",
          ObservacaoDecisao: "",
          DataHoraAprovada: "",
        };
        const notice = createNoticeEntry({
          lojaId: storeIdOf(punch) || storeIdOf(target),
          tipo: "Ponto",
          assunto: "Solicitação de ajuste de ponto",
          mensagem: `${cleanStr(target.Nome)} solicitou ajuste em ${formatDateBR(punchDate)} (${punch.TipoMarcacao}) de ${horarioAnterior} para ${novoHorario}. Motivo: ${motivo}.`,
          relacionadoId: ajusteId,
          actor,
          now,
        });
        updates[`Notificacoes/${notice.id}`] = notice.record;
        const aud = createAuditEntry({
          acao: "Solicitar ajuste de ponto via House AI",
          tabela: "AjustesPonto",
          registroId: ajusteId,
          actor,
          target,
          detalhes: { registroPontoId: punch.RegistroPontoID, data: punchDate, horarioAnterior, novoHorario, motivo },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);

        return {
          ok: true,
          acao: "solicitar_ajuste_ponto",
          executadoDireto: false,
          status: "Pendente de aprovação da gerência",
          protocolo: ajusteId,
          colaborador: cleanStr(target.Nome),
          data: formatDateBR(punchDate),
          tipoMarcacao: punch.TipoMarcacao,
          horarioAnterior,
          novoHorario,
          motivo,
        };
      }

      case "decidir_ajuste_ponto": {
        if (!isManager) return { erro: "Somente gerentes e administradores podem aprovar ou rejeitar ajustes de ponto." };
        const decisao = foldStr(args.decisao);
        const approved = decisao === "aprovar" || decisao === "aprovado";
        const rejected = decisao === "rejeitar" || decisao === "recusar" || decisao === "rejeitado";
        if (!approved && !rejected) return { erro: "Informe a decisão: aprovar ou rejeitar." };

        const allAdj = await rows("AjustesPonto");
        let adj = null;
        if (args.ajuste_ponto_id) {
          adj = allAdj.find((a) => String(a.AjustePontoID || a.id) === cleanStr(args.ajuste_ponto_id));
        } else {
          const resolved = resolveAuthorizedTarget({
            employee,
            employees,
            profile,
            targetId: args.funcionario_id,
            targetName: args.funcionario_nome,
          });
          if (!resolved.ok) return resolved;
          const matches = allAdj.filter(
            (a) =>
              empIdOf(a) === empIdOf(resolved.target) &&
              a.Status === "Pendente" &&
              (!args.data || String(a.Data || "").slice(0, 10) === cleanStr(args.data))
          );
          if (matches.length > 1) {
            return {
              erro: "Há mais de um ajuste de ponto pendente para este colaborador. Informe qual ajuste decidir.",
              pendentes: matches.map((a) => ({
                ajustePontoId: a.AjustePontoID,
                data: formatDateBR(a.Data),
                tipo: a.TipoMarcacao,
                horarioSolicitado: formatTimeBahia(a.DataHoraSolicitada),
                motivo: a.Motivo,
              })),
            };
          }
          adj = matches[0] || null;
        }

        if (!adj) return { erro: "Pedido de ajuste de ponto pendente não encontrado." };
        if (adj.Status !== "Pendente") return { erro: `Este pedido de ajuste já está com status ${adj.Status}.` };
        if (!isAdmin && storeIdOf(adj) !== actor.LojaID) return { erro: "Ajuste pertence a outra unidade." };

        const obs = cleanStr(args.observacao || "");
        const target = employees.find((e) => empIdOf(e) === empIdOf(adj)) || { FuncionarioID: empIdOf(adj), Nome: adj.NomeFuncionario, LojaID: storeIdOf(adj) };
        const updates = {};
        updates[`AjustesPonto/${adj.AjustePontoID}/Status`] = approved ? "Aprovado" : "Rejeitado";
        updates[`AjustesPonto/${adj.AjustePontoID}/DecididoPor`] = actor.Email || actor.Nome;
        updates[`AjustesPonto/${adj.AjustePontoID}/DataDecisao`] = nowIso;
        updates[`AjustesPonto/${adj.AjustePontoID}/ObservacaoDecisao`] = obs;
        updates[`AjustesPonto/${adj.AjustePontoID}/DataHoraAprovada`] = approved ? adj.DataHoraSolicitada : "";

        if (approved) {
          const approvedTime = formatTimeBahia(adj.DataHoraSolicitada);
          if (adj.RegistroPontoID) {
            updates[`RegistrosPonto/${adj.RegistroPontoID}/DataHora`] = adj.DataHoraSolicitada;
            updates[`RegistrosPonto/${adj.RegistroPontoID}/Hora`] = approvedTime;
            updates[`RegistrosPonto/${adj.RegistroPontoID}/Ajustado`] = true;
            updates[`RegistrosPonto/${adj.RegistroPontoID}/Observacoes`] = `Ajustado por ${actor.Email || actor.Nome}${obs ? ": " + obs : ""}`;
          } else {
            const newPunchId = `ponto-ai-${crypto.randomUUID()}`;
            updates[`RegistrosPonto/${newPunchId}`] = {
              RegistroPontoID: newPunchId,
              FuncionarioID: empIdOf(adj),
              NomeFuncionario: cleanStr(adj.NomeFuncionario || target.Nome),
              EmailFuncionario: cleanStr(target.Email || ""),
              LojaID: storeIdOf(adj),
              NomeLoja: cleanStr(target.NomeLoja || ""),
              Data: String(adj.Data || "").slice(0, 10),
              TipoMarcacao: adj.TipoMarcacao || "SAIDA_FINAL",
              DataHora: adj.DataHoraSolicitada,
              Hora: approvedTime,
              DentroRaio: true,
              Origem: "Inclusão aprovada via House AI",
              Status: "Válido",
              Observacoes: adj.Motivo || obs || "Inclusão aprovada",
              Ajustado: true,
              RegistroOriginalID: "",
              DataCriacao: nowIso,
              ForaHorario: false,
              CriadoPor: actor.Email || actor.Nome,
            };
          }
        }

        const notice = createNoticeEntry({
          lojaId: storeIdOf(adj),
          destinatarioId: empIdOf(adj),
          destinatario: target.Email || target.Nome,
          tipo: "Ponto",
          assunto: approved ? "Ajuste de ponto aprovado" : "Ajuste de ponto rejeitado",
          mensagem: approved
            ? `Seu pedido de ajuste de ponto em ${formatDateBR(adj.Data)} (${adj.TipoMarcacao}) foi aprovado.`
            : `Seu pedido de ajuste de ponto em ${formatDateBR(adj.Data)} foi rejeitado.${obs ? " Motivo: " + obs : ""}`,
          relacionadoId: adj.AjustePontoID,
          actor,
          now,
        });
        updates[`Notificacoes/${notice.id}`] = notice.record;
        const aud = createAuditEntry({
          acao: approved ? "Aprovar ajuste de ponto via House AI" : "Rejeitar ajuste de ponto via House AI",
          tabela: "AjustesPonto",
          registroId: adj.AjustePontoID,
          actor,
          target,
          detalhes: { decisao: approved ? "Aprovado" : "Rejeitado", observacao: obs },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);

        const waRes =
          args.notificar_whatsapp !== false
            ? await notifyPhone(sendWhatsApp, target, `Olá, ${cleanStr(target.Nome).split(/\s+/)[0]}!\n${notice.record.Mensagem}`)
            : { attempted: false, sent: false };

        return {
          ok: true,
          acao: "decidir_ajuste_ponto",
          decisao: approved ? "Aprovado" : "Rejeitado",
          protocolo: adj.AjustePontoID,
          colaborador: cleanStr(target.Nome),
          data: formatDateBR(adj.Data),
          tipoMarcacao: adj.TipoMarcacao,
          avisoWhatsApp: waRes,
        };
      }

      case "justificar_ausencia": {
        if (!isManager) return { erro: "Somente gerentes e administradores podem justificar faltas/ausências." };
        const resolved = resolveAuthorizedTarget({
          employee,
          employees,
          profile,
          targetId: args.funcionario_id,
          targetName: args.funcionario_nome,
        });
        if (!resolved.ok) return resolved;
        const target = resolved.target;
        const data = cleanStr(args.data);
        const tipo = cleanStr(args.tipo || "Outros");
        const observacao = cleanStr(args.observacao || args.motivo);
        const validTypes = ["Atestado", "Folga trocada", "Dia concedido", "Outros"];
        if (!isIsoDate(data) || data > today) return { erro: "Informe uma data válida de hoje ou anterior (AAAA-MM-DD)." };
        if (!validTypes.includes(tipo)) return { erro: `Tipo inválido. Use: ${validTypes.join(", ")}.` };
        if (tipo === "Outros" && observacao.length < 5) return { erro: "Descreva o motivo da justificativa." };

        const justId = `${empIdOf(target)}__${data}`;
        const updates = {};
        updates[`JustificativasPonto/${justId}`] = {
          JustificativaPontoID: justId,
          FuncionarioID: empIdOf(target),
          NomeFuncionario: cleanStr(target.Nome),
          LojaID: storeIdOf(target),
          NomeLoja: cleanStr(target.NomeLoja || ""),
          Data: data,
          Tipo: tipo,
          Observacao: observacao,
          Status: "Aprovada",
          DataCriacao: nowIso,
          DataAtualizacao: nowIso,
          JustificadoPor: actor.Email || actor.Nome,
        };
        const aud = createAuditEntry({
          acao: "Justificar ausência via House AI",
          tabela: "JustificativasPonto",
          registroId: justId,
          actor,
          target,
          detalhes: { data, tipo, observacao },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);
        return {
          ok: true,
          acao: "justificar_ausencia",
          protocolo: justId,
          colaborador: cleanStr(target.Nome),
          data: formatDateBR(data),
          tipo,
          observacao,
        };
      }

      case "cancelar_folga": {
        const motivo = cleanStr(args.motivo || `Cancelada via House AI por ${actor.Nome}`);
        const allFolgas = await rows("Folgas");
        let leave = null;

        if (args.folga_id) {
          leave = allFolgas.find((f) => String(f.FolgaID || f.id) === cleanStr(args.folga_id));
        } else {
          const resolved = resolveAuthorizedTarget({
            employee,
            employees,
            profile,
            targetId: args.funcionario_id,
            targetName: args.funcionario_nome,
          });
          if (!resolved.ok) return resolved;
          const targetId = empIdOf(resolved.target);
          const targetDate = cleanStr(args.data);
          const candidates = allFolgas.filter((f) => {
            if (empIdOf(f) !== targetId) return false;
            const st = foldStr(f.Status);
            if (st === "cancelada" || st === "rejeitada") return false;
            if (!targetDate) return String(f.DataFim || f.DataInicio || f.Data || "").slice(0, 10) >= today;
            const ini = String(f.DataInicio || f.Data || "").slice(0, 10);
            const fim = String(f.DataFim || ini).slice(0, 10);
            return ini <= targetDate && fim >= targetDate;
          });
          if (candidates.length === 0) {
            return { erro: `Não encontrei folga ativa para ${cleanStr(resolved.target.Nome)}${targetDate ? " em " + formatDateBR(targetDate) : ""}.` };
          }
          if (candidates.length > 1) {
            return {
              erro: "Há mais de uma folga ativa. Informe a data exata da folga que deseja cancelar.",
              folgasAtivas: candidates.slice(0, 8).map((f) => ({
                folgaId: f.FolgaID || f.id,
                data: formatDateBR(f.DataInicio || f.Data),
                status: f.Status,
              })),
            };
          }
          leave = candidates[0];
        }

        if (!leave) return { erro: "Folga não encontrada." };
        const leaveId = String(leave.FolgaID || leave.id || "");
        const leaveStatus = foldStr(leave.Status);
        if (leaveStatus === "cancelada" || leaveStatus === "rejeitada") {
          return { erro: `Esta folga já está com status ${leave.Status}.` };
        }
        if (!isManager) {
          if (empIdOf(leave) !== actor.FuncionarioID) {
            return { erro: "Você só pode cancelar suas próprias solicitações de folga." };
          }
          if (leaveStatus !== "pendente") {
            return { erro: "Somente pedidos pendentes podem ser cancelados pelo colaborador. Para folgas já aprovadas, procure a gerência." };
          }
        } else if (!isAdmin && storeIdOf(leave) && actor.LojaID && storeIdOf(leave) !== actor.LojaID) {
          return { erro: "Esta folga pertence a outra unidade." };
        }

        const target = employees.find((e) => empIdOf(e) === empIdOf(leave)) || {
          FuncionarioID: empIdOf(leave),
          Nome: leave.NomeFuncionario,
          LojaID: storeIdOf(leave),
        };
        const shouldRefund = leaveStatus === "aprovada" || leaveStatus === "concluida";
        const leaveDate = String(leave.DataInicio || leave.Data || "").slice(0, 10);
        const updates = {};
        updates[`Folgas/${leaveId}/Status`] = "Cancelada";
        updates[`Folgas/${leaveId}/CanceladoPor`] = actor.Email || actor.Nome;
        updates[`Folgas/${leaveId}/DataCancelamento`] = nowIso;
        updates[`Folgas/${leaveId}/MotivoCancelamento`] = motivo;
        updates[`Folgas/${leaveId}/DataAtualizacao`] = nowIso;

        let estornouSaldo = false;
        if (shouldRefund && empIdOf(target)) {
          estornouSaldo = true;
          updates[`Folgas/${leaveId}/SaldoFolgasStatus`] = "Estornado";
          const currentBalance = Number(target.SaldoFolgas);
          if (Number.isFinite(currentBalance)) {
            updates[`Funcionarios/${empIdOf(target)}/SaldoFolgas`] = { ".sv": { increment: 1 } };
          }
          const movId = `mov-estorno-${leaveId}-${Date.now().toString(36)}`;
          updates[`MovimentosSaldoFolgas/${movId}`] = {
            MovimentoID: movId,
            FolgaID: leaveId,
            FuncionarioID: empIdOf(target),
            LojaID: storeIdOf(leave),
            Tipo: "Estorno",
            Quantidade: 1,
            SaldoAnterior: Number.isFinite(currentBalance) ? currentBalance : null,
            SaldoNovo: Number.isFinite(currentBalance) ? currentBalance + 1 : null,
            Motivo: `Estorno por cancelamento de folga (${formatDateBR(leaveDate)}) via House AI: ${motivo}`,
            DataCriacao: nowIso,
          };
        }

        const notice = createNoticeEntry({
          lojaId: storeIdOf(leave),
          destinatarioId: empIdOf(target),
          destinatario: target.Email || target.Nome,
          tipo: "Folga",
          assunto: "Folga cancelada",
          mensagem: `A folga de ${cleanStr(target.Nome)} prevista para ${formatDateBR(leaveDate)} foi cancelada.${estornouSaldo ? " 1 dia de folga foi estornado ao saldo." : ""} Motivo: ${motivo}.`,
          relacionadoId: leaveId,
          actor,
          now,
        });
        updates[`Notificacoes/${notice.id}`] = notice.record;
        const aud = createAuditEntry({
          acao: "Cancelar folga via House AI",
          tabela: "Folgas",
          registroId: leaveId,
          actor,
          target,
          detalhes: { data: leaveDate, statusAnterior: leave.Status, estornouSaldo, motivo },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);

        const waRes =
          args.notificar_whatsapp !== false && empIdOf(target) !== actor.FuncionarioID
            ? await notifyPhone(
                sendWhatsApp,
                target,
                `Olá, ${cleanStr(target.Nome).split(/\s+/)[0]}!\nSua folga prevista para ${formatDateBR(leaveDate)} foi cancelada pela gestão.${estornouSaldo ? " Seu saldo de folgas recebeu o estorno de +1 dia." : ""}\nMotivo: ${motivo}.`
              )
            : { attempted: false, sent: false };

        return {
          ok: true,
          acao: "cancelar_folga",
          folgaId: leaveId,
          colaborador: cleanStr(target.Nome),
          data: formatDateBR(leaveDate),
          statusAnterior: leave.Status,
          estornouSaldo,
          motivo,
          avisoWhatsApp: waRes,
        };
      }

      case "decidir_folga": {
        if (!isManager) return { erro: "Somente gerentes e administradores podem aprovar ou recusar pedidos de folga." };
        const dec = foldStr(args.decisao);
        const approved = dec === "aprovar" || dec === "aprovada";
        const rejected = dec === "recusar" || dec === "rejeitar" || dec === "rejeitada";
        if (!approved && !rejected) return { erro: "Informe a decisão: aprovar ou recusar." };

        const allFolgas = await rows("Folgas");
        let leave = null;
        if (args.folga_id) {
          leave = allFolgas.find((f) => String(f.FolgaID || f.id) === cleanStr(args.folga_id));
        } else {
          const resolved = resolveAuthorizedTarget({
            employee,
            employees,
            profile,
            targetId: args.funcionario_id,
            targetName: args.funcionario_nome,
          });
          if (!resolved.ok) return resolved;
          const matches = allFolgas.filter(
            (f) =>
              empIdOf(f) === empIdOf(resolved.target) &&
              foldStr(f.Status) === "pendente" &&
              (!args.data || String(f.DataInicio || f.Data || "").slice(0, 10) === cleanStr(args.data))
          );
          if (matches.length > 1) {
            return {
              erro: "Há mais de um pedido de folga pendente para este colaborador. Informe a data exata.",
              pendentes: matches.map((f) => ({ folgaId: f.FolgaID || f.id, data: formatDateBR(f.DataInicio || f.Data), motivo: f.Motivo })),
            };
          }
          leave = matches[0] || null;
        }

        if (!leave) return { erro: "Pedido de folga pendente não encontrado." };
        if (foldStr(leave.Status) !== "pendente") return { erro: `Esta folga já está com status ${leave.Status}.` };
        if (!isAdmin && storeIdOf(leave) !== actor.LojaID) return { erro: "Pedido pertence a outra unidade." };

        const leaveId = String(leave.FolgaID || leave.id);
        const leaveDate = String(leave.DataInicio || leave.Data || "").slice(0, 10);
        const obs = cleanStr(args.observacao || "");
        const target = employees.find((e) => empIdOf(e) === empIdOf(leave)) || {
          FuncionarioID: empIdOf(leave),
          Nome: leave.NomeFuncionario,
          LojaID: storeIdOf(leave),
        };
        const updates = {};
        updates[`Folgas/${leaveId}/Status`] = approved ? "Aprovada" : "Rejeitada";
        updates[`Folgas/${leaveId}/AprovadoPor`] = actor.Email || actor.Nome;
        updates[`Folgas/${leaveId}/DataAprovacao`] = nowIso;
        updates[`Folgas/${leaveId}/ObservacaoAprovacao`] = obs;
        updates[`Folgas/${leaveId}/DataAtualizacao`] = nowIso;

        if (approved && empIdOf(target)) {
          updates[`Folgas/${leaveId}/SaldoFolgasStatus`] = "Aplicado";
          const currentBalance = Number(target.SaldoFolgas);
          if (Number.isFinite(currentBalance)) {
            updates[`Funcionarios/${empIdOf(target)}/SaldoFolgas`] = { ".sv": { increment: -1 } };
          }
          const movId = `mov-${leaveId}`;
          updates[`MovimentosSaldoFolgas/${movId}`] = {
            MovimentoID: movId,
            FolgaID: leaveId,
            FuncionarioID: empIdOf(target),
            LojaID: storeIdOf(leave),
            Tipo: "Debito",
            Quantidade: 1,
            SaldoAnterior: Number.isFinite(currentBalance) ? currentBalance : null,
            SaldoNovo: Number.isFinite(currentBalance) ? Math.max(0, currentBalance - 1) : null,
            Motivo: `Folga aprovada via House AI para ${formatDateBR(leaveDate)}`,
            DataCriacao: nowIso,
          };
        }

        const notice = createNoticeEntry({
          lojaId: storeIdOf(leave),
          destinatarioId: empIdOf(target),
          destinatario: target.Email || target.Nome,
          tipo: approved ? "FolgaAprovada" : "FolgaRecusada",
          assunto: approved ? "Folga aprovada" : "Folga recusada",
          mensagem: approved
            ? `Sua folga para ${formatDateBR(leaveDate)} foi aprovada.`
            : `Seu pedido de folga para ${formatDateBR(leaveDate)} foi recusado.${obs ? " Motivo: " + obs : ""}`,
          relacionadoId: leaveId,
          actor,
          now,
        });
        updates[`Notificacoes/${notice.id}`] = notice.record;
        const aud = createAuditEntry({
          acao: approved ? "Aprovar folga via House AI" : "Recusar folga via House AI",
          tabela: "Folgas",
          registroId: leaveId,
          actor,
          target,
          detalhes: { data: leaveDate, decisao: approved ? "Aprovada" : "Rejeitada", observacao: obs },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);

        const waRes =
          args.notificar_whatsapp !== false
            ? await notifyPhone(sendWhatsApp, target, `Olá, ${cleanStr(target.Nome).split(/\s+/)[0]}!\n${notice.record.Mensagem}`)
            : { attempted: false, sent: false };

        return {
          ok: true,
          acao: "decidir_folga",
          decisao: approved ? "Aprovada" : "Rejeitada",
          folgaId: leaveId,
          colaborador: cleanStr(target.Nome),
          data: formatDateBR(leaveDate),
          avisoWhatsApp: waRes,
        };
      }

      case "solicitar_vale": {
        const resolved = resolveAuthorizedTarget({
          employee,
          employees,
          profile,
          targetId: args.funcionario_id,
          targetName: args.funcionario_nome,
        });
        if (!resolved.ok) return resolved;
        const target = resolved.target;
        const valor = Number(String(args.valor ?? "").replace(",", "."));
        const motivo = cleanStr(args.motivo);
        const dataDesejada = isIsoDate(args.data_desejada) ? cleanStr(args.data_desejada) : today;
        if (!Number.isFinite(valor) || valor <= 0) return { erro: "Informe um valor válido maior que zero para o vale." };
        if (motivo.length < 3) return { erro: "Informe o motivo da solicitação de vale." };

        const configs = (await database(env, tok, "tables/Configuracoes").catch(() => ({}))) || {};
        const storeLimit = Number(configs[`LimiteMaximoVale_${storeIdOf(target)}`]?.Valor || 0);
        const globalLimit = Number(configs["LimiteMaximoVale"]?.Valor || 0);
        const limiteMaximo = storeLimit > 0 ? storeLimit : globalLimit > 0 ? globalLimit : 1000;
        if (valor > limiteMaximo && !isAdmin) {
          return {
            erro: `O valor solicitado (${formatBRL(valor)}) ultrapassa o limite máximo configurado (${formatBRL(limiteMaximo)}).`,
          };
        }

        const valeId = `vale-ai-${crypto.randomUUID()}`;
        const updates = {};
        updates[`SolicitacoesVale/${valeId}`] = {
          ValeID: valeId,
          FuncionarioID: empIdOf(target),
          FuncionarioNome: cleanStr(target.Nome),
          CPF: cleanStr(target.CPF || ""),
          LojaID: storeIdOf(target),
          NomeLoja: cleanStr(target.NomeLoja || ""),
          Valor: valor,
          Motivo: motivo,
          DataDesejada: dataDesejada,
          Competencia: dataDesejada.slice(0, 7),
          Status: "Solicitado",
          ValidadoGerentePor: "",
          ValidadoGerenteEm: "",
          AprovadoDiretoriaPor: "",
          AprovadoDiretoriaEm: "",
          ComprovanteURL: "",
          ReciboDocID: "",
          DataCriacao: nowIso,
          DataAtualizacao: nowIso,
        };
        const notice = createNoticeEntry({
          lojaId: storeIdOf(target),
          tipo: "Aviso",
          assunto: "Nova solicitação de vale",
          mensagem: `${cleanStr(target.Nome)} solicitou vale de ${formatBRL(valor)} para ${formatDateBR(dataDesejada)}. Motivo: ${motivo}.`,
          relacionadoId: valeId,
          actor,
          now,
        });
        updates[`Notificacoes/${notice.id}`] = notice.record;
        const aud = createAuditEntry({
          acao: "VALE_SOLICITADO",
          tabela: "SolicitacoesVale",
          registroId: valeId,
          actor,
          target,
          detalhes: { valor, motivo, dataDesejada },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);

        return {
          ok: true,
          acao: "solicitar_vale",
          valeId,
          colaborador: cleanStr(target.Nome),
          valor: formatBRL(valor),
          dataDesejada: formatDateBR(dataDesejada),
          status: "Solicitado (aguardando validação/aprovação)",
          limiteMaximo: formatBRL(limiteMaximo),
        };
      }

      case "decidir_vale": {
        if (!isManager) return { erro: "Somente gerentes e administradores podem validar, aprovar ou recusar vales." };
        const dec = foldStr(args.decisao);
        const isPay = ["aprovar_pagar", "aprovar", "pagar", "pago"].includes(dec);
        const isValidate = dec === "validar";
        const isReject = ["recusar", "rejeitar"].includes(dec);
        if (!isPay && !isValidate && !isReject) {
          return { erro: "Informe a decisão: validar (gerente), aprovar_pagar (admin/diretoria) ou recusar." };
        }
        if (isPay && !isAdmin) {
          return { erro: "Apenas Administração/Diretoria pode aprovar e pagar o vale. Como gerente, use decisao: validar ou recusar." };
        }

        const allVales = await rows("SolicitacoesVale");
        let vale = null;
        if (args.vale_id) {
          vale = allVales.find((v) => String(v.ValeID || v.id) === cleanStr(args.vale_id));
        } else {
          const resolved = resolveAuthorizedTarget({
            employee,
            employees,
            profile,
            targetId: args.funcionario_id,
            targetName: args.funcionario_nome,
          });
          if (!resolved.ok) return resolved;
          const matches = allVales.filter(
            (v) =>
              empIdOf(v) === empIdOf(resolved.target) &&
              ["Solicitado", "Validado pelo Gerente"].includes(String(v.Status || ""))
          );
          if (matches.length > 1) {
            return {
              erro: "Há mais de um vale em aberto para este colaborador. Informe qual vale decidir.",
              valesAbertos: matches.map((v) => ({
                valeId: v.ValeID,
                valor: formatBRL(v.Valor),
                status: v.Status,
                data: formatDateBR(v.DataDesejada),
              })),
            };
          }
          vale = matches[0] || null;
        }
        if (!vale) return { erro: "Solicitação de vale em aberto não encontrada." };
        if (!isAdmin && storeIdOf(vale) !== actor.LojaID) return { erro: "Vale pertence a outra unidade." };

        const target = employees.find((e) => empIdOf(e) === empIdOf(vale)) || {
          FuncionarioID: empIdOf(vale),
          Nome: vale.FuncionarioNome,
          LojaID: storeIdOf(vale),
          NomeLoja: vale.NomeLoja,
        };
        const obs = cleanStr(args.observacao || "");
        const competencia = String(vale.Competencia || vale.DataDesejada || today).slice(0, 7);
        const updates = {};
        let novoStatus = "";
        let reciboDocId = vale.ReciboDocID || "";

        if (isValidate || (!isAdmin && isReject)) {
          novoStatus = isValidate ? "Validado pelo Gerente" : "Recusado pelo Gerente";
          updates[`SolicitacoesVale/${vale.ValeID}/Status`] = novoStatus;
          updates[`SolicitacoesVale/${vale.ValeID}/ValidadoGerentePor`] = actor.Nome || actor.Email;
          updates[`SolicitacoesVale/${vale.ValeID}/ValidadoGerenteEm`] = nowIso;
          updates[`SolicitacoesVale/${vale.ValeID}/ObservacaoGerente`] = obs;
          updates[`SolicitacoesVale/${vale.ValeID}/DataAtualizacao`] = nowIso;
        } else {
          novoStatus = isPay ? "Pago" : "Recusado pela Diretoria";
          if (isPay) {
            const reciboTexto = [
              "RECIBO DE ADIANTAMENTO SALARIAL / VALE",
              `Colaborador: ${cleanStr(target.Nome)}`,
              `Unidade/Loja: ${cleanStr(vale.NomeLoja || target.NomeLoja || storeIdOf(vale))}`,
              `Valor Recebido: ${formatBRL(vale.Valor)}`,
              `Competência para Desconto em Folha: ${competencia}`,
              `Data da Aprovação/Pagamento: ${nowIso}`,
              `Aprovado por: ${actor.Nome || actor.Email}`,
              obs ? `Observação: ${obs}` : "",
              "",
              `Declaro para os devidos fins ter recebido a importância líquida de ${formatBRL(vale.Valor)} a título de adiantamento salarial (vale), autorizando o respectivo desconto integral na folha de pagamento da competência ${competencia}.`,
            ]
              .filter(Boolean)
              .join("\n");
            const hashRecibo = await sha256Hex(reciboTexto);
            reciboDocId = `doc-vale-${crypto.randomUUID()}`;
            updates[`Documentos/${reciboDocId}`] = {
              DocID: reciboDocId,
              DocumentoID: reciboDocId,
              FuncionarioID: empIdOf(target),
              FuncionarioNome: cleanStr(target.Nome),
              NomeFuncionario: cleanStr(target.Nome),
              CPF: cleanStr(vale.CPF || target.CPF || ""),
              CargoFuncionario: cleanStr(target.Cargo || ""),
              LojaID: storeIdOf(vale),
              NomeLoja: cleanStr(vale.NomeLoja || target.NomeLoja || ""),
              Tipo: "Recibo de Vale",
              Titulo: `Recibo de Vale (${formatBRL(vale.Valor)}) - ${competencia}`,
              Descricao: `Confirmação de recebimento de vale de ${formatBRL(vale.Valor)} com desconto na folha de ${competencia}.`,
              Competencia: competencia,
              MesReferencia: competencia,
              ValeID: vale.ValeID,
              ValorVale: Number(vale.Valor || 0),
              OrigemTipo: "TEXTO_SISTEMA",
              ConteudoTexto: reciboTexto,
              HashSHA256Original: hashRecibo,
              HashOriginalSHA256: hashRecibo,
              RequerAssinatura: true,
              Status: "Pendente",
              StatusAssinatura: "Pendente",
              DataEnvio: nowIso,
              CriadoPor: actor.Nome || actor.Email,
              DataCriacao: nowIso,
            };
          }
          updates[`SolicitacoesVale/${vale.ValeID}/Status`] = novoStatus;
          updates[`SolicitacoesVale/${vale.ValeID}/AprovadoDiretoriaPor`] = actor.Nome || actor.Email;
          updates[`SolicitacoesVale/${vale.ValeID}/AprovadoDiretoriaEm`] = nowIso;
          updates[`SolicitacoesVale/${vale.ValeID}/ObservacaoDiretoria`] = obs;
          updates[`SolicitacoesVale/${vale.ValeID}/ReciboDocID`] = reciboDocId;
          updates[`SolicitacoesVale/${vale.ValeID}/DataAtualizacao`] = nowIso;
        }

        const appUrl = String(env?.APP_URL || "https://houseburgertx-beep.github.io/Gestao-de-folgas3.0/").replace(/\/+$/, "") + "/";
        const msgColab = isPay
          ? `Seu vale de ${formatBRL(vale.Valor)} foi aprovado e liberado (desconto na folha ${competencia}). Acesse Meus Documentos no aplicativo para assinar o recibo: ${appUrl}?tab=documents`
          : isValidate
            ? `Seu pedido de vale de ${formatBRL(vale.Valor)} foi validado pela gerência e encaminhado à Diretoria.`
            : `Seu pedido de vale de ${formatBRL(vale.Valor)} foi recusado.${obs ? " Motivo: " + obs : ""}`;

        const notice = createNoticeEntry({
          lojaId: storeIdOf(vale),
          destinatarioId: empIdOf(target),
          destinatario: target.Email || target.Nome,
          tipo: isPay ? "Documentos" : "Aviso",
          assunto: `Atualização de Vale - ${novoStatus}`,
          mensagem: msgColab,
          relacionadoId: reciboDocId || vale.ValeID,
          actor,
          now,
        });
        updates[`Notificacoes/${notice.id}`] = notice.record;
        const aud = createAuditEntry({
          acao: isPay || isAdmin ? "VALE_DECISAO_DIRETORIA" : "VALE_VALIDACAO_GERENTE",
          tabela: "SolicitacoesVale",
          registroId: vale.ValeID,
          actor,
          target,
          detalhes: { valor: vale.Valor, statusAnterior: vale.Status, novoStatus, reciboDocId, observacao: obs },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);

        const waRes =
          args.notificar_whatsapp !== false
            ? await notifyPhone(sendWhatsApp, target, `Olá, ${cleanStr(target.Nome).split(/\s+/)[0]}!\n${msgColab}`)
            : { attempted: false, sent: false };

        return {
          ok: true,
          acao: "decidir_vale",
          valeId: vale.ValeID,
          colaborador: cleanStr(target.Nome),
          valor: formatBRL(vale.Valor),
          novoStatus,
          reciboDocId: reciboDocId || null,
          avisoWhatsApp: waRes,
        };
      }

      case "gerenciar_tarefa": {
        const sub = foldStr(args.operacao || args.subacao || "criar");
        if (sub === "criar") {
          if (!isKitchenLead) return { erro: "Somente gerentes, administradores ou chefes de cozinha podem criar tarefas." };
          const titulo = cleanStr(args.titulo);
          if (titulo.length < 2) return { erro: "Informe o título da tarefa." };
          let target = null;
          if (args.funcionario_id || args.funcionario_nome) {
            const resolved = resolveAuthorizedTarget({
              employee,
              employees,
              profile,
              targetId: args.funcionario_id,
              targetName: args.funcionario_nome,
            });
            if (!resolved.ok) return resolved;
            target = resolved.target;
          }
          const lojaId = storeIdOf(target) || actor.LojaID;
          if (!lojaId) return { erro: "Informe o colaborador ou unidade da tarefa." };
          const tarefaId = `TASK_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
          const prioridade = ["Urgente", "Alta", "Media", "Normal", "Baixa"].includes(cleanStr(args.prioridade))
            ? cleanStr(args.prioridade) === "Normal"
              ? "Media"
              : cleanStr(args.prioridade)
            : "Media";
          const dataTurno = isIsoDate(args.prazo || args.data) ? cleanStr(args.prazo || args.data) : today;
          const updates = {};
          updates[`Tarefas/${tarefaId}`] = {
            TarefaID: tarefaId,
            LojaID: lojaId,
            Titulo: titulo,
            Descricao: cleanStr(args.descricao || `Criada via House AI por ${actor.Nome}`),
            Setor: cleanStr(args.setor || "Geral"),
            Tipo: "operacional",
            Coluna: "pendente",
            Status: "A fazer",
            Prioridade: prioridade,
            FuncionarioID: target ? empIdOf(target) : "",
            NomeFuncionario: target ? cleanStr(target.Nome) : "",
            DataTurno: dataTurno,
            HoraLimite: normalizeTimeHHMM(args.hora_limite) || "",
            ExigeVistoGerente: false,
            VistoPor: "",
            DataConclusao: null,
            Checklist: [],
            FotoEvidencia: "",
            CriadoPor: actor.Nome,
            CriadoEm: nowIso,
            AtualizadoEm: nowIso,
          };
          if (target) {
            const notice = createNoticeEntry({
              lojaId,
              destinatarioId: empIdOf(target),
              destinatario: target.Email || target.Nome,
              tipo: "Tarefa",
              assunto: "Nova tarefa atribuída",
              mensagem: `${titulo}${args.hora_limite ? " - até " + args.hora_limite : ""} (Prioridade: ${prioridade}).`,
              relacionadoId: tarefaId,
              actor,
              now,
            });
            updates[`Notificacoes/${notice.id}`] = notice.record;
          }
          const aud = createAuditEntry({
            acao: "Criar tarefa via House AI",
            tabela: "Tarefas",
            registroId: tarefaId,
            actor,
            target: target || actor,
            detalhes: { titulo, prioridade, dataTurno },
            now,
          });
          updates[`Auditoria/${aud.id}`] = aud.record;
          await patchTables(env, tok, updates, fetcher);

          const waRes =
            target && args.notificar_whatsapp !== false
              ? await notifyPhone(
                  sendWhatsApp,
                  target,
                  `Olá, ${cleanStr(target.Nome).split(/\s+/)[0]}!\nNova tarefa atribuída a você no CozinhaFlow:\n*${titulo}*\nPrioridade: ${prioridade}\nData: ${formatDateBR(dataTurno)}`
                )
              : { attempted: false, sent: false };

          return {
            ok: true,
            acao: "criar_tarefa",
            tarefaId,
            titulo,
            responsavel: target ? cleanStr(target.Nome) : "Equipe da loja",
            prioridade,
            dataTurno: formatDateBR(dataTurno),
            avisoWhatsApp: waRes,
          };
        }

        if (sub === "concluir") {
          const allTasks = await rows("Tarefas");
          const q = foldStr(args.titulo || "");
          let task = null;
          if (args.tarefa_id) {
            task = allTasks.find((t) => String(t.TarefaID || t.id) === cleanStr(args.tarefa_id));
          } else {
            const candidates = allTasks.filter((t) => {
              const st = foldStr(t.Status || t.Coluna);
              if (["concluido", "concluida", "cancelada", "cancelado"].includes(st)) return false;
              if (!isKitchenLead && empIdOf(t) !== actor.FuncionarioID) return false;
              if (!isAdmin && storeIdOf(t) && actor.LojaID && storeIdOf(t) !== actor.LojaID) return false;
              if (q && !foldStr(t.Titulo || t.TITULO).includes(q)) return false;
              return true;
            });
            task = candidates[0] || null;
          }
          if (!task) return { erro: "Nenhuma tarefa em aberto correspondente foi encontrada." };
          const tid = String(task.TarefaID || task.id);
          const updates = {
            [`Tarefas/${tid}/Coluna`]: "concluido",
            [`Tarefas/${tid}/Status`]: "Concluída",
            [`Tarefas/${tid}/DataConclusao`]: nowIso,
            [`Tarefas/${tid}/AtualizadoEm`]: nowIso,
          };
          const aud = createAuditEntry({
            acao: "Concluir tarefa via House AI",
            tabela: "Tarefas",
            registroId: tid,
            actor,
            target: actor,
            detalhes: { titulo: task.Titulo || task.TITULO },
            now,
          });
          updates[`Auditoria/${aud.id}`] = aud.record;
          await patchTables(env, tok, updates, fetcher);
          return { ok: true, acao: "concluir_tarefa", tarefaId: tid, titulo: cleanStr(task.Titulo || task.TITULO) };
        }

        return { erro: "Operação de tarefa inválida. Use operacao: criar ou concluir." };
      }

      case "enviar_aviso_whatsapp": {
        const mensagem = cleanStr(args.mensagem);
        const assunto = cleanStr(args.assunto || "Aviso House 190");
        const destino = foldStr(args.destino || "colaborador");
        if (mensagem.length < 3) return { erro: "Informe o texto do aviso que deseja enviar." };

        let recipients = [];
        if (destino === "gerencia" || (!isManager && !args.funcionario_id && !args.funcionario_nome)) {
          // Colaborador pode avisar a gerência da própria loja
          const accessRows = Object.values((await database(env, tok, "access").catch(() => ({}))) || {});
          const storeManagers = accessRows.filter(
            (p) =>
              active(p.Ativo) &&
              ["Gerente", "Responsável de loja", "Administrador"].includes(p.Perfil) &&
              (String(p.LojaID || "") === actor.LojaID || (actor.LojaID === "" && p.Perfil === "Administrador"))
          );
          recipients = storeManagers
            .map((m) => ({ ...employees.find((e) => empIdOf(e) === empIdOf(m)), ...m }))
            .filter((m) => Boolean(m.Telefone || m.WhatsApp || m.Celular))
            .slice(0, 3);
        } else if (destino === "loja" || destino === "rede") {
          if (!isManager) return { erro: "Somente gerentes e administradores podem enviar avisos para a equipe." };
          if (destino === "rede" && !isAdmin) return { erro: "Somente administradores podem enviar avisos para toda a rede." };
          const targetStore = destino === "rede" ? "" : cleanStr(args.loja_id || actor.LojaID);
          recipients = employees
            .filter((e) => (e.Ativo === undefined || active(e.Ativo)) && (!targetStore || storeIdOf(e) === targetStore))
            .filter((e) => Boolean(e.Telefone || e.WhatsApp || e.Celular))
            .slice(0, 60);
        } else {
          if (!isManager) return { erro: "Para enviar aviso direto a outro colaborador, é necessário perfil de gestão. Use destino: gerencia para avisar seu gerente." };
          const resolved = resolveAuthorizedTarget({
            employee,
            employees,
            profile,
            targetId: args.funcionario_id,
            targetName: args.funcionario_nome,
          });
          if (!resolved.ok) return resolved;
          recipients = [resolved.target];
        }

        if (!recipients.length) {
          return { erro: "Nenhum destinatário com telefone cadastrado foi encontrado para este aviso." };
        }

        const updates = {};
        const results = [];
        let sentCount = 0;
        for (const rec of recipients) {
          const first = cleanStr(rec.Nome || "Colaborador").split(/\s+/)[0];
          const formatted =
            destino === "gerencia"
              ? `Aviso de ${actor.Nome} (${cleanStr(employee.NomeLoja || actor.LojaID || "Unidade")}):\n${mensagem}`
              : `*Grupo House 190 - ${assunto}*\n\nOlá, ${first}!\n\n${mensagem}\n\nEnviado por ${actor.Nome}.`;
          const wa = await notifyPhone(sendWhatsApp, rec, formatted);
          if (wa.sent) sentCount++;
          results.push({ nome: cleanStr(rec.Nome), enviado: wa.sent, motivo: wa.motivo || wa.erro || null });
          const notice = createNoticeEntry({
            lojaId: storeIdOf(rec) || actor.LojaID,
            destinatarioId: empIdOf(rec),
            destinatario: rec.Email || rec.Nome,
            tipo: "Aviso",
            assunto,
            mensagem,
            actor,
            now,
          });
          updates[`Notificacoes/${notice.id}`] = notice.record;
        }
        const aud = createAuditEntry({
          acao: "Aviso WhatsApp via House AI",
          modulo: "WhatsAppDisparos",
          tabela: "WhatsAppDisparos",
          registroId: `aviso-${Date.now()}`,
          actor,
          target: recipients[0],
          detalhes: { assunto, destino, totalDestinatarios: recipients.length, enviados: sentCount },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);

        return {
          ok: sentCount > 0,
          acao: "enviar_aviso_whatsapp",
          assunto,
          totalDestinatarios: recipients.length,
          enviadosComSucesso: sentCount,
          detalhes: results.slice(0, 15),
          erro: sentCount === 0 ? "O gateway WhatsApp não confirmou o envio para nenhum destinatário (verifique telefone cadastrado ou conexão do WhatsApp)." : undefined,
        };
      }

      case "publicar_comunicado": {
        if (!isManager) return { erro: "Somente gerentes e administradores podem publicar comunicados oficiais." };
        const titulo = cleanStr(args.titulo);
        const mensagem = cleanStr(args.mensagem);
        const destino = cleanStr(args.destino || "Loja local");
        if (titulo.length < 3 || mensagem.length < 3) return { erro: "Informe título e mensagem do comunicado." };
        if (destino === "Rede completa" && !isAdmin) return { erro: "Somente administradores podem publicar comunicado para toda a rede." };
        const lojaId = destino === "Rede completa" ? "" : actor.LojaID;
        const comId = `com-ai-${crypto.randomUUID()}`;
        const updates = {
          [`Comunicados/${comId}`]: {
            ComID: comId,
            Titulo: titulo,
            Corpo: mensagem,
            LojaID: lojaId,
            PublicoAlvo: "Todos",
            ExigeConfirmacao: false,
            Autor: actor.Nome,
            CriadoPor: actor.Email || actor.Nome,
            DataCriacao: nowIso,
          },
        };
        const aud = createAuditEntry({
          acao: "Publicar comunicado via House AI",
          tabela: "Comunicados",
          registroId: comId,
          actor,
          target: actor,
          detalhes: { titulo, destino },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);

        let waResumo = null;
        if (args.notificar_whatsapp === true) {
          waResumo = await executeOperationalAction({
            acao: "enviar_aviso_whatsapp",
            args: { assunto: titulo, mensagem, destino: destino === "Rede completa" ? "rede" : "loja", loja_id: lojaId },
            employee,
            employees,
            profile,
            database,
            env,
            tok,
            now,
            sendWhatsApp,
            fetcher,
          });
        }

        return {
          ok: true,
          acao: "publicar_comunicado",
          comunicadoId: comId,
          titulo,
          destino,
          disparoWhatsApp: waResumo ? { enviados: waResumo.enviadosComSucesso, total: waResumo.totalDestinatarios } : null,
        };
      }

      case "decidir_troca_folga": {
        if (!isManager) return { erro: "Somente gerentes e administradores podem aprovar ou recusar trocas de folga." };
        const dec = foldStr(args.decisao);
        const approved = dec === "aprovar" || dec === "aprovada";
        const rejected = dec === "recusar" || dec === "rejeitar";
        if (!approved && !rejected) return { erro: "Informe a decisão: aprovar ou recusar." };
        const allSwaps = await rows("TrocasFolga");
        const q = foldStr(args.funcionario_nome || "");
        const swap = args.troca_id
          ? allSwaps.find((s) => String(s.TrocaID || s.id) === cleanStr(args.troca_id))
          : allSwaps.find((s) => {
              const st = foldStr(s.Status);
              if (!st.includes("aguardando") && st !== "pendente") return false;
              if (!isAdmin && storeIdOf(s) !== actor.LojaID) return false;
              if (!q) return true;
              return foldStr(s.NomeFuncionarioOrigem).includes(q) || foldStr(s.NomeFuncionarioDestino).includes(q);
            });
        if (!swap) return { erro: "Troca de folga pendente não encontrada." };
        const swapId = String(swap.TrocaID || swap.id);
        const obs = cleanStr(args.observacao || "");
        const updates = {
          [`TrocasFolga/${swapId}/Status`]: approved ? "Aprovada" : "Recusada",
          [`TrocasFolga/${swapId}/DecididoPor`]: actor.Email || actor.Nome,
          [`TrocasFolga/${swapId}/DataDecisao`]: nowIso,
          [`TrocasFolga/${swapId}/ObservacaoGestor`]: obs,
          [`TrocasFolga/${swapId}/DataAtualizacao`]: nowIso,
        };
        const aud = createAuditEntry({
          acao: approved ? "Aprovar troca de folga via House AI" : "Recusar troca de folga via House AI",
          tabela: "TrocasFolga",
          registroId: swapId,
          actor,
          target: actor,
          detalhes: { origem: swap.NomeFuncionarioOrigem, destino: swap.NomeFuncionarioDestino, observacao: obs },
          now,
        });
        updates[`Auditoria/${aud.id}`] = aud.record;
        await patchTables(env, tok, updates, fetcher);
        return {
          ok: true,
          acao: "decidir_troca_folga",
          trocaId: swapId,
          decisao: approved ? "Aprovada" : "Recusada",
          origem: cleanStr(swap.NomeFuncionarioOrigem),
          destino: cleanStr(swap.NomeFuncionarioDestino),
        };
      }

      default:
        return { erro: `Ação operacional não suportada: ${acao}` };
    }
  } catch (err) {
    return { erro: `Não foi possível concluir a operação: ${cleanStr(err?.message || err)}` };
  }
}
