// ==========================================================================
// COPILOTO HOUSE 190 — Assistente Operacional Ativo com Gemini Flash & Argon
// Folgas 3.0 & CozinhaFlow
// Estritamente sem emojis, com confirmação obrigatória e controle RBAC
// ==========================================================================

import { RH_POLICIES, hrAdapter } from "./hr-adapter.js";
export { RH_POLICIES, hrAdapter };

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const esc = (x) =>
  String(x ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

export const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FAFF}\u{FE00}-\u{FE0F}]/gu;

export function stripEmojis(str) {
  return String(str ?? "").replace(EMOJI_REGEX, "");
}

export function sanitizeIntent(res) {
  if (!res) return res;
  if (res.reply) res.reply = stripEmojis(res.reply);
  if (res.message) res.message = stripEmojis(res.message);
  if (res.summary) res.summary = stripEmojis(res.summary);
  if (res.title) res.title = stripEmojis(res.title);
  if (Array.isArray(res.diff)) {
    res.diff = res.diff.map((d) => ({
      ...d,
      label: stripEmojis(d.label),
      value: stripEmojis(d.value),
    }));
  }
  return res;
}

// ==========================================================================
// HISTÓRICO DE CONVERSA MULTI-TURN (MEMÓRIA DO COPILOTO)
// ==========================================================================

export const copilotChatHistory = [];

export function getCopilotChatHistory() {
  return copilotChatHistory;
}

export function clearCopilotChatHistory() {
  copilotChatHistory.length = 0;
}

// ==========================================================================
// UTILITÁRIOS OPERACIONAIS DE DATA, HORA E PONTO (MEGA CÉREBRO)
// ==========================================================================

export function extractDateFromText(text) {
  if (!text) return null;
  const str = String(text).toLowerCase();
  const now = new Date();
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).split("-");
  const todayYear = parseInt(todayParts[0], 10);
  const todayMonth = parseInt(todayParts[1], 10);
  const todayDay = parseInt(todayParts[2], 10);

  const toIso = (y, m, d) =>
    `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  if (/\bhoje\b/i.test(str)) {
    return {
      isoDate: toIso(todayYear, todayMonth, todayDay),
      formattedDate: `${String(todayDay).padStart(2, "0")}/${String(todayMonth).padStart(2, "0")}/${todayYear}`,
      day: todayDay,
      month: todayMonth,
      year: todayYear,
    };
  }

  if (/\banteontem\b/i.test(str)) {
    const d = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay - 2));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dy = d.getUTCDate();
    return {
      isoDate: toIso(y, m, dy),
      formattedDate: `${String(dy).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`,
      day: dy,
      month: m,
      year: y,
    };
  }

  if (/\bontem\b/i.test(str)) {
    const d = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay - 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dy = d.getUTCDate();
    return {
      isoDate: toIso(y, m, dy),
      formattedDate: `${String(dy).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`,
      day: dy,
      month: m,
      year: y,
    };
  }

  if (/\bdepois\s+de\s+amanh[aã](?![a-z0-9à-ú])/i.test(str)) {
    const d = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay + 2));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dy = d.getUTCDate();
    return {
      isoDate: toIso(y, m, dy),
      formattedDate: `${String(dy).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`,
      day: dy,
      month: m,
      year: y,
    };
  }

  if (/\bamanh[aã](?![a-z0-9à-ú])/i.test(str)) {
    const d = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay + 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dy = d.getUTCDate();
    return {
      isoDate: toIso(y, m, dy),
      formattedDate: `${String(dy).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`,
      day: dy,
      month: m,
      year: y,
    };
  }

  const weekdayMap = {
    domingo: 0,
    segunda: 1,
    terca: 2,
    quarta: 3,
    quinta: 4,
    sexta: 5,
    sabado: 6,
  };
  const weekdayMatch = str.match(/\b(?:pr[oó]xim[ao]\s+)?(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(?:-feira)?(?![a-z0-9à-ú])/i);
  if (weekdayMatch) {
    const key = weekdayMatch[1].toLowerCase().replace("ç", "c").replace("á", "a");
    const targetDayOfWeek = weekdayMap[key];
    if (targetDayOfWeek !== undefined) {
      const todayDate = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay));
      const currentDayOfWeek = todayDate.getUTCDay();
      let diff = targetDayOfWeek - currentDayOfWeek;
      if (diff <= 0) diff += 7;
      const targetDate = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay + diff));
      const y = targetDate.getUTCFullYear();
      const m = targetDate.getUTCMonth() + 1;
      const dy = targetDate.getUTCDate();
      return {
        isoDate: toIso(y, m, dy),
        formattedDate: `${String(dy).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`,
        day: dy,
        month: m,
        year: y,
      };
    }
  }

  const slashMatch = str.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (slashMatch) {
    const d = parseInt(slashMatch[1], 10);
    const m = parseInt(slashMatch[2], 10);
    let y = slashMatch[3] ? parseInt(slashMatch[3], 10) : todayYear;
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return {
        isoDate: toIso(y, m, d),
        formattedDate: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`,
        day: d,
        month: m,
        year: y,
      };
    }
  }

  const isoMatch = str.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    return {
      isoDate: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`,
      formattedDate: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`,
      day: d,
      month: m,
      year: y,
    };
  }

  const monthNames = {
    janeiro: 1, jan: 1,
    fevereiro: 2, fev: 2,
    marco: 3, marco: 3, mar: 3,
    abril: 4, abr: 4,
    maio: 5, mai: 5,
    junho: 6, jun: 6,
    julho: 7, jul: 7,
    agosto: 8, ago: 8,
    setembro: 9, set: 9,
    outubro: 10, out: 10,
    novembro: 11, nov: 11,
    dezembro: 12, dez: 12,
  };
  const dayMatch = str.match(/\bdia\s+(\d{1,2})(?:\s+de\s+([a-zçãé]+))?\b/i);
  if (dayMatch) {
    const d = parseInt(dayMatch[1], 10);
    let m = todayMonth;
    let y = todayYear;
    if (dayMatch[2]) {
      const cleanMonth = dayMatch[2].toLowerCase().replace("ç", "c").replace("ã", "a").replace("é", "e");
      if (monthNames[cleanMonth]) {
        m = monthNames[cleanMonth];
      }
    } else {
      if (d < todayDay && !/\b(ontem|passad[ao]|atrasad[ao])\b/i.test(str)) {
        m = todayMonth + 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
    }
    if (d >= 1 && d <= 31) {
      return {
        isoDate: toIso(y, m, d),
        formattedDate: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`,
        day: d,
        month: m,
        year: y,
      };
    }
  }

  return null;
}

export function extractTimeFromText(text) {
  if (!text) return null;
  const str = String(text);
  const m1 = str.match(/\b([01]?\d|2[0-3])(?::([0-5]\d)|h([0-5]\d)?)\b/i);
  if (m1) {
    const h = String(m1[1]).padStart(2, "0");
    const m = String(m1[2] || m1[3] || "00").padStart(2, "0");
    return `${h}:${m}`;
  }
  const m2 = str.match(/\b(?:às|as)\s+([01]?\d|2[0-3])\s*(?:h|hrs|horas)?\b/i);
  if (m2) {
    const h = String(m2[1]).padStart(2, "0");
    return `${h}:00`;
  }
  return null;
}

export function extractPunchType(text, time) {
  const str = String(text || "").toLowerCase();
  if (/\b(?:sa[ií]da|fechamento|fim\s+de\s+turno|sa[ií])\b/i.test(str)) {
    return { type: "SAIDA_FINAL", label: "Saída Final" };
  }
  if (/\b(?:retorno|volta|volta\s+do\s+almo[cç]o)\b/i.test(str)) {
    return { type: "RETORNO_INTERVALO", label: "Retorno de Intervalo" };
  }
  if (/\b(?:intervalo|almo[cç]o|pausa)\b/i.test(str)) {
    return { type: "SAIDA_INTERVALO", label: "Saída para Intervalo" };
  }
  if (/\b(?:entrada|chegada|in[ií]cio|come[cç]o|iniciei|entrei)\b/i.test(str)) {
    return { type: "ENTRADA", label: "Entrada" };
  }
  if (time) {
    const hour = parseInt(time.split(":")[0], 10);
    if (hour >= 15) return { type: "SAIDA_FINAL", label: "Saída Final" };
    if (hour <= 11) return { type: "ENTRADA", label: "Entrada" };
  }
  return { type: "SAIDA_FINAL", label: "Saída Final" };
}

export function extractReasonFromText(text, defaultReason = "Solicitação operacional via Copiloto") {
  if (!text) return defaultReason;
  const str = String(text).trim();
  const m = str.match(/(?:motivo\s*(?:[:=]|é|e)?|porque|por\s+causa\s+d[eo]|pois|já\s+que|para)\s+([^.,;]+)/i);
  if (m && m[1]?.trim()) {
    const candidate = m[1].trim();
    if (candidate.length >= 3) {
      return candidate;
    }
  }
  if (/esquec(?:i|imento)/i.test(str)) {
    return "Esquecimento de marcação de ponto";
  }
  if (/m[eé]dic[ao]|consulta|dentista|exame/i.test(str)) {
    return "Consulta médica / compromisso de saúde";
  }
  return defaultReason;
}

// ==========================================================================
// PERMISSÕES, RBAC E IDENTIFICAÇÃO
// ==========================================================================

export function getCurrentUser() {
  if (typeof window !== "undefined") {
    return window.__GESTAO_STATE__?.user || window.state?.user || window.__GESTAO_USER__ || null;
  }
  return null;
}

export function getCurrentView() {
  if (typeof window !== "undefined") {
    if (window.__GESTAO_STATE__?.currentView) return window.__GESTAO_STATE__.currentView;
    if (window.state?.currentView) return window.state.currentView;
  }
  if (typeof document !== "undefined") {
    const active = document.querySelector(".view.active");
    if (active && active.id) {
      return active.id.replace(/^view-/, "");
    }
  }
  return "dashboard";
}

export function getUserRole(user) {
  const u = user || (typeof window !== "undefined" ? getCurrentUser() : null);
  if (!u) {
    if (typeof document !== "undefined") {
      const roleText = (document.querySelector("#userRole")?.textContent || "").toLowerCase();
      if (roleText.includes("admin")) return "admin";
      if (roleText.includes("gerente") || roleText.includes("respons")) return "manager";
    }
    return "employee";
  }
  const p = String(u.Perfil || u.perfil || u.role || "").toLowerCase();
  const perms = Array.isArray(u.permissions) ? u.permissions : [];
  if (p.includes("admin") || perms.includes("*")) return "admin";
  if (p.includes("gerente") || p.includes("respons")) return "manager";
  if (typeof document !== "undefined") {
    const roleText = (document.querySelector("#userRole")?.textContent || "").toLowerCase();
    if (roleText.includes("admin")) return "admin";
    if (roleText.includes("gerente") || roleText.includes("respons")) return "manager";
  }
  return "employee";
}

export function getUserStoreId(user) {
  const u = user || (typeof window !== "undefined" ? getCurrentUser() : null);
  return String(u?.LojaID || u?.lojaId || u?.Loja || "").trim();
}

export function getUserId(user) {
  const u = user || (typeof window !== "undefined" ? getCurrentUser() : null);
  return String(u?.FuncionarioID || u?.funcionarioId || u?.id || u?.UsuarioID || "").trim();
}

export function getUserName(user) {
  if (typeof document !== "undefined") {
    const el = document.querySelector("#userName");
    const name = el?.textContent?.trim();
    if (name && name !== "Utilizador" && name !== "Colaborador") {
      return name;
    }
  }
  const u = user || (typeof window !== "undefined" ? getCurrentUser() : null);
  const candidate = String(u?.Nome || u?.nome || u?.NomeCompleto || u?.nomeCompleto || "").trim();
  return candidate || "Colaborador";
}

// ==========================================================================
// CONHECIMENTO OPERACIONAL PROFUNDO POR TELA (SCREEN KNOWLEDGE)
// ==========================================================================

export const SCREEN_KNOWLEDGE = {
  holidays: {
    title: "Feriados e Pontos Facultativos",
    category: "Gestão Operacional",
    summary: "Gerenciamento de feriados nacionais, regionais e municipais com cálculo automático de folgas compensatórias aos colaboradores em escala.",
    rules: "Apenas administradores podem cadastrar ou editar feriados. Ao cadastrar um feriado ativo, o sistema confere crédito automático de folga para todos os colaboradores elegíveis. Feriados municipais vinculam-se à loja correspondente.",
    chips: {
      admin: [
        "Cadastrar feriado",
        "Como funciona crédito de feriado?",
        "Regras de feriado CLT",
        "Como funciona esta tela?",
      ],
      manager: [
        "Feriados da minha loja",
        "Como funciona crédito de feriado?",
        "Regras de feriado na escala",
        "Como funciona esta tela?",
      ],
      employee: [
        "Quando é o próximo feriado?",
        "Tenho direito a folga por feriado?",
        "Como funciona crédito de feriado?",
        "Como funciona esta tela?",
      ],
    },
    actions: ["createHoliday", "updateHoliday"],
  },
  timeoff: {
    title: "Folgas e Trocas",
    category: "Jornada e Escala",
    summary: "Controle de folgas regulares, compensatórias, solicitações pontuais de colaboradores e trocas mútuas de plantão.",
    rules: "Escala 6x1 exige no máximo 6 dias de trabalho contínuos. Trocas entre colaboradores exigem aprovação da gerência. A gerência só pode aprovar trocas da sua própria loja. Colaboradores podem solicitar folga informando data e motivo.",
    chips: {
      admin: [
        "Aprovar trocas pendentes",
        "Solicitações de folga abertas",
        "Regra 6x1 e domingos",
        "Como funciona esta tela?",
      ],
      manager: [
        "Aprovar trocas pendentes",
        "Solicitações de folga da loja",
        "Regra 6x1 na escala",
        "Como funciona esta tela?",
      ],
      employee: [
        "Como solicitar folga?",
        "Minha próxima folga",
        "Como funciona troca de folga?",
        "Como funciona esta tela?",
      ],
    },
    actions: ["createEmployeeTimeOffRequest", "decideTimeOffSwap"],
  },
  tasks: {
    title: "CozinhaFlow (Tarefas)",
    category: "Operação da Cozinha",
    summary: "Fluxo operacional de tarefas diárias da cozinha com prioridade (Baixa, Normal, Alta, Urgente), pontuação por execução e prazos.",
    rules: "Gerentes e Administradores podem criar tarefas e delegar para a equipe da loja. Colaboradores visualizam tarefas atribuídas e marcam como concluídas.",
    chips: {
      admin: [
        "Criar tarefa urgente",
        "Tarefas pendentes da rede",
        "Como funciona a pontuação",
        "Como funciona esta tela?",
      ],
      manager: [
        "Criar tarefa para a equipe",
        "Tarefas pendentes da cozinha",
        "Delegar tarefa de limpeza",
        "Como funciona esta tela?",
      ],
      employee: [
        "Minhas tarefas de hoje",
        "Concluir minha tarefa",
        "Pontuação no CozinhaFlow",
        "Como funciona esta tela?",
      ],
    },
    actions: ["cozinhaTasksSave"],
  },
  timeclock: {
    title: "Ponto Eletrônico",
    category: "Jornada e Frequência",
    summary: "Registro digital de ponto com geolocalização por loja e espelho de jornada. Permite bater ponto e solicitar ajustes de horários esquecidos.",
    rules: "CLT Art. 58: tolerância de 5 a 10 minutos. O ponto não é bloqueado por ausência de reconhecimento facial. Ajustes de ponto exigem justificativa e homologação do gestor.",
    chips: {
      admin: [
        "Tolerância de ponto (CLT)",
        "Colaboradores sem saída",
        "Regras de intervalo intrajornada",
        "Como funciona esta tela?",
      ],
      manager: [
        "Tolerância de ponto (CLT)",
        "Ajustes de ponto pendentes",
        "Espelho de ponto da equipe",
        "Como funciona esta tela?",
      ],
      employee: [
        "Meu ponto hoje",
        "Tolerância de ponto (CLT)",
        "Como solicitar ajuste de ponto",
        "Como funciona esta tela?",
      ],
    },
    actions: [],
  },
  absences: {
    title: "Ausências e Faltas",
    category: "Frequência e Pessoal",
    summary: "Registro e auditoria de ausências, atestados médicos, folgas concedidas e justificativas legais de ausência ao trabalho.",
    rules: "Tipos de justificativa aceitos: Atestado, Folga trocada, Dia concedido e Outros. Não é permitido justificar data futura ou dias com marcações existentes. Gerentes justificam apenas para sua unidade.",
    chips: {
      admin: [
        "Justificar falta de colaborador",
        "Tipos de justificativas aceitas",
        "Prazo legal para entrega de atestado",
        "Como funciona esta tela?",
      ],
      manager: [
        "Justificar falta de colaborador",
        "Tipos de justificativas aceitas",
        "Prazo legal para atestado",
        "Como funciona esta tela?",
      ],
      employee: [
        "Como enviar meu atestado?",
        "Prazo para justificar falta",
        "Falta justificada desconta banco?",
        "Como funciona esta tela?",
      ],
    },
    actions: ["justifyMissedTimeClockDay"],
  },
  "pending-center": {
    title: "Central de Pendências",
    category: "Gestão e Aprovações",
    summary: "Central unificada de decisão gerencial: pedidos de folga, trocas de escala e ajustes de ponto aguardando validação.",
    rules: "Gerentes aprovam solicitações da sua unidade. Administradores podem homologar em qualquer loja da rede. Ações aprovadas geram trilha de auditoria.",
    chips: {
      admin: [
        "Trocas de folga pendentes",
        "Ajustes de ponto pendentes",
        "Solicitações de folga abertas",
        "Como funciona esta tela?",
      ],
      manager: [
        "Trocas de folga da minha loja",
        "Ajustes de ponto da loja",
        "Solicitações de folga pendentes",
        "Como funciona esta tela?",
      ],
      employee: [
        "Minhas solicitações pendentes",
        "Prazo para aprovação de folga",
        "Como funciona esta tela?",
      ],
    },
    actions: ["decideTimeOffSwap"],
  },
  documents: {
    title: "Documentos e Assinatura Digital",
    category: "Gestão Documental",
    summary: "Emissão, acompanhamento e assinatura digital de holerites mensais e espelhos de ponto com validade jurídica.",
    rules: "Assinatura digital estampada na própria folha com hash de segurança e IP. O colaborador deve conferir e assinar mensalmente o espelho de ponto.",
    chips: {
      admin: [
        "Documentos pendentes de assinatura",
        "Validade jurídica da assinatura",
        "Holerites emitidos",
        "Como funciona esta tela?",
      ],
      manager: [
        "Documentos pendentes na loja",
        "Como funciona a assinatura digital?",
        "Como funciona esta tela?",
      ],
      employee: [
        "Como assinar meu espelho de ponto?",
        "Onde vejo meus holerites?",
        "Validade jurídica da assinatura",
        "Como funciona esta tela?",
      ],
    },
    actions: [],
  },
  "hour-balances": {
    title: "Banco de Horas",
    category: "Compensação e Horas",
    summary: "Visão consolidada de créditos (horas extras) e débitos por loja e colaborador com controle de compensações.",
    rules: "Banco de horas calculado a partir da jornada líquida. Horas em domingos e feriados sem folga compensatória são computadas com adicional de 100%.",
    chips: {
      admin: [
        "Extrato de horas da rede",
        "Regras de compensação e banco",
        "Colaboradores com maior saldo",
        "Como funciona esta tela?",
      ],
      manager: [
        "Extrato de horas da loja",
        "Regras de compensação e banco",
        "Como funciona esta tela?",
      ],
      employee: [
        "Meu saldo de horas",
        "Limite de horas extras",
        "Como funciona a compensação?",
        "Como funciona esta tela?",
      ],
    },
    actions: [],
  },
  "live-team": {
    title: "Equipe em Tempo Real",
    category: "Operação ao Vivo",
    summary: "Visão ao vivo dos colaboradores em serviço, turnos em andamento, presenças e atrasos.",
    rules: "Visível apenas para Gerentes e Administradores. Gerentes acompanham apenas a equipe da sua respectiva loja.",
    chips: {
      admin: [
        "Quem está trabalhando agora?",
        "Colaboradores atrasados",
        "Presença por loja",
        "Como funciona esta tela?",
      ],
      manager: [
        "Quem está trabalhando agora?",
        "Colaboradores atrasados na loja",
        "Turnos em andamento",
        "Como funciona esta tela?",
      ],
      employee: ["Como funciona esta tela?"],
    },
    actions: [],
  },
  "takeat-credit": {
    title: "Créditos Takeat",
    category: "Consumo e Benefícios",
    summary: "Controle de contas a prazo e consumo dos colaboradores no cardápio Takeat com separação por compra e histórico de comandas.",
    rules: "Consumo a prazo lançado conforme limite de crédito estabelecido por cargo. Desconto processado no fechamento mensal.",
    chips: {
      admin: [
        "Regras de consumo Takeat",
        "Saldos devedores da rede",
        "Limite de crédito por cargo",
        "Como funciona esta tela?",
      ],
      manager: [
        "Saldos devedores da loja",
        "Regras de consumo Takeat",
        "Como funciona esta tela?",
      ],
      employee: [
        "Meu limite de consumo Takeat",
        "Como funciona o desconto em folha?",
        "Como funciona esta tela?",
      ],
    },
    actions: [],
  },
  employees: {
    title: "Colaboradores e Cadastro",
    category: "Quadro de Pessoal",
    summary: "Cadastro geral de funcionários, cargos, turnos, folgas fixas semanais, lojas vinculadas e jornada de trabalho.",
    rules: "Gerentes editam apenas funcionários da sua loja. Alterações de turno e folga semanal exigem aviso prévio ao colaborador.",
    chips: {
      admin: [
        "Alterar turno de colaborador",
        "Alterar folga fixa semanal",
        "Buscar colaborador",
        "Como funciona esta tela?",
      ],
      manager: [
        "Alterar turno de colaborador",
        "Alterar folga fixa na loja",
        "Equipe da minha loja",
        "Como funciona esta tela?",
      ],
      employee: ["Como funciona esta tela?"],
    },
    actions: ["updateEmployee"],
  },
  calendar: {
    title: "Escala e Calendário Geral",
    category: "Planejamento de Escala",
    summary: "Visualização mensal e semanal das escalas de trabalho, turnos, folgas regulares e feriados da rede.",
    rules: "Escala deve respeitar a jornada legal CLT e folgas aos domingos para comércio e alimentação.",
    chips: {
      admin: [
        "Regra 6x1 e domingos na CLT",
        "Escala da semana",
        "Alterar turno de colaborador",
        "Como funciona esta tela?",
      ],
      manager: [
        "Escala da semana na loja",
        "Regra 6x1 e domingos",
        "Alterar turno na escala",
        "Como funciona esta tela?",
      ],
      employee: [
        "Minha escala da semana",
        "Quando é minha próxima folga?",
        "Como funciona esta tela?",
      ],
    },
    actions: ["updateEmployee"],
  },
  scheduler: {
    title: "Planejador de Escala",
    category: "Planejamento de Escala",
    summary: "Simulador e planejador operacional de turnos semanais, distribuição de folgas e cobertura de postos.",
    rules: "Simulação de escala automática garantindo cobertura mínima de turnos por loja e respeito à regra 6x1.",
    chips: {
      admin: ["Simular escala automática", "Regra 6x1", "Como funciona esta tela?"],
      manager: ["Simular escala da loja", "Regra 6x1", "Como funciona esta tela?"],
      employee: ["Como funciona esta tela?"],
    },
    actions: [],
  },
  "shift-plan": {
    title: "Plano de Turnos",
    category: "Planejamento de Escala",
    summary: "Distribuição detalhada dos horários nominais de entrada, intervalos e saídas de cada turno operacional.",
    rules: "Turnos Manhã, Tarde, Noite e Integral. Intervalo mínimo de 1 hora para jornadas superiores a 6 horas.",
    chips: {
      admin: ["Horários dos turnos", "Intervalo intrajornada CLT", "Como funciona esta tela?"],
      manager: ["Horários dos turnos da loja", "Como funciona esta tela?"],
      employee: ["Meu turno cadastrado", "Como funciona esta tela?"],
    },
    actions: [],
  },
  stores: {
    title: "Lojas e Unidades",
    category: "Estrutura Corporativa",
    summary: "Configuração das unidades do Grupo House 190, coordenadas geográficas, raio de tolerância do ponto e dados fiscais.",
    rules: "Apenas administradores podem criar ou editar lojas. O raio de ponto delimita a cerca virtual para registro eletrônico.",
    chips: {
      admin: ["Lojas cadastradas", "Raio de tolerância do ponto", "Como funciona esta tela?"],
      manager: ["Dados da minha loja", "Como funciona esta tela?"],
      employee: ["Como funciona esta tela?"],
    },
    actions: ["updateStore"],
  },
  operations: {
    title: "Operações e Parâmetros",
    category: "Regras Corporativas",
    summary: "Parâmetros operacionais globais, regras de tolerância, limites de banco de horas e mensagens automáticas.",
    rules: "Configurações aplicadas a todas as lojas da rede por administradores.",
    chips: {
      admin: ["Parâmetros da rede", "Regras de banco de horas", "Como funciona esta tela?"],
      manager: ["Regras da loja", "Como funciona esta tela?"],
      employee: ["Como funciona esta tela?"],
    },
    actions: [],
  },
  access: {
    title: "Acessos e Permissões",
    category: "Segurança e Governança",
    summary: "Gestão de usuários, perfis de acesso RBAC (Administrador, Gerente, Colaborador) e senhas do sistema.",
    rules: "Apenas administradores podem conceder ou revogar perfis gerenciais ou administrativos.",
    chips: {
      admin: ["Perfis de acesso da rede", "Regras de segurança RBAC", "Como funciona esta tela?"],
      manager: ["Como funciona esta tela?"],
      employee: ["Como funciona esta tela?"],
    },
    actions: [],
  },
  governance: {
    title: "Delegações e Governança",
    category: "Segurança e Governança",
    summary: "Controle de delegações temporárias de alçadas gerenciais e acompanhamento de conformidade corporativa.",
    rules: "Delegações temporárias expiram automaticamente e são registradas na trilha de auditoria.",
    chips: {
      admin: ["Delegações ativas", "Regras de governança", "Como funciona esta tela?"],
      manager: ["Como funciona esta tela?"],
      employee: ["Como funciona esta tela?"],
    },
    actions: [],
  },
  audit: {
    title: "Trilha de Auditoria",
    category: "Segurança e Compliance",
    summary: "Histórico imutável de todas as ações de escrita, exclusões, aprovações e execuções do Copiloto no sistema.",
    rules: "Registros de auditoria possuem timestamp ISO, IP, ID do usuário e diff de dados 'before/after'. Não podem ser apagados.",
    chips: {
      admin: ["Últimas ações auditadas", "Ações do Copiloto", "Como funciona esta tela?"],
      manager: ["Como funciona esta tela?"],
      employee: ["Como funciona esta tela?"],
    },
    actions: [],
  },
  reports: {
    title: "Relatórios Operacionais",
    category: "BI e Indicadores",
    summary: "Relatórios de assiduidade, banco de horas, faltas, trocas de folga e indicadores operacionais da rede.",
    rules: "Gerentes acessam relatórios da sua unidade. Administradores visualizam indicadores consolidados de toda a rede.",
    chips: {
      admin: ["Relatório de pontualidade", "Relatório de absenteísmo", "Como funciona esta tela?"],
      manager: ["Relatório da minha loja", "Como funciona esta tela?"],
      employee: ["Como funciona esta tela?"],
    },
    actions: [],
  },
  "advanced-reports": {
    title: "Relatórios Avançados",
    category: "BI e Indicadores",
    summary: "Análise profunda de produtividade, custos com horas extras e consolidação analítica.",
    rules: "Exclusivo para Gerentes e Administradores.",
    chips: {
      admin: ["Análise de horas extras", "Taxa de absenteísmo consolidada", "Como funciona esta tela?"],
      manager: ["Indicadores avançados da loja", "Como funciona esta tela?"],
      employee: ["Como funciona esta tela?"],
    },
    actions: [],
  },
  "monthly-closing": {
    title: "Fechamento Mensal",
    category: "Departamento Pessoal",
    summary: "Fechamento periódico de folha, consolidação de espelhos de ponto, horas extras e exportação contábil.",
    rules: "Exclusivo para Gestores e RH. Exige conferência prévia de justificativas de ponto e atestados médicos.",
    chips: {
      admin: ["Status do fechamento mensal", "Conferência de espelhos de ponto", "Como funciona esta tela?"],
      manager: ["Fechamento da loja", "Como funciona esta tela?"],
      employee: ["Como funciona esta tela?"],
    },
    actions: [],
  },
  notifications: {
    title: "Avisos e Lembretes",
    category: "Comunicação Interna",
    summary: "Mural de avisos institucionais e notificações operacionais com confirmação de leitura.",
    rules: "Gerentes publicam para sua loja. Administradores podem emitir comunicados para toda a rede.",
    chips: {
      admin: ["Publicar comunicado para a rede", "Avisos ativos", "Como funciona esta tela?"],
      manager: ["Publicar comunicado para a loja", "Avisos da equipe", "Como funciona esta tela?"],
      employee: ["Meus avisos não lidos", "Como funciona esta tela?"],
    },
    actions: ["publicarComunicado"],
  },
  communication: {
    title: "Mural de Comunicados",
    category: "Comunicação Interna",
    summary: "Comunicação operacional oficial entre gerência e equipes com confirmação de visualização.",
    rules: "Avisos importantes exigem confirmação de leitura do colaborador.",
    chips: {
      admin: ["Publicar comunicado oficial", "Como funciona esta tela?"],
      manager: ["Publicar comunicado oficial", "Como funciona esta tela?"],
      employee: ["Últimos comunicados", "Como funciona esta tela?"],
    },
    actions: ["publicarComunicado"],
  },
  dashboard: {
    title: "Painel Geral e Jornada",
    category: "Visão Geral",
    summary: "Visão consolidada da operação diária, jornada do colaborador, escala do dia e indicadores operacionais rápidos.",
    rules: "Apresenta métricas contextuais ao perfil logado (Colaborador vê sua jornada; Gestor vê a loja; Admin vê a rede).",
    chips: {
      admin: [
        "Quem está trabalhando agora?",
        "Tarefas pendentes da rede",
        "Resumo das lojas",
        "Como funciona esta tela?",
      ],
      manager: [
        "Quem está trabalhando agora?",
        "Tarefas da cozinha",
        "Trocas pendentes da loja",
        "Como funciona esta tela?",
      ],
      employee: [
        "Meu ponto hoje",
        "Quando é minha próxima folga?",
        "Meu saldo de horas",
        "Minhas tarefas de hoje",
      ],
    },
    actions: [],
  },
};

// ==========================================================================
// GERENCIAMENTO DA CHAVE E MODELO DO GOOGLE GEMINI
// ==========================================================================

const GEMINI_STORAGE_KEY = "gf-gemini-api-key";
const GEMINI_MODEL_STORAGE_KEY = "gf-gemini-model";

export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
export const SUPPORTED_GEMINI_MODELS = ["gemini-2.0-flash", "gemini-4-argon"];

export function getGeminiModel() {
  try {
    const fromStorage =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(GEMINI_MODEL_STORAGE_KEY)
        : "";
    const fromConfig =
      typeof window !== "undefined"
        ? window.__GESTAO_STATE__?.config?.geminiModel
        : "";
    const raw = (fromStorage || fromConfig || "").trim().toLowerCase();
    if (raw === "gemini-4-argon" || raw === "gemini-2.0-flash") {
      return raw;
    }
    return DEFAULT_GEMINI_MODEL;
  } catch (_) {
    return DEFAULT_GEMINI_MODEL;
  }
}

export function setGeminiModel(model) {
  try {
    if (typeof localStorage === "undefined") return;
    const clean = String(model || "").trim().toLowerCase();
    if (SUPPORTED_GEMINI_MODELS.includes(clean)) {
      localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, clean);
    } else if (!clean) {
      localStorage.removeItem(GEMINI_MODEL_STORAGE_KEY);
    } else {
      localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, DEFAULT_GEMINI_MODEL);
    }
  } catch (_) {}
}

export function getGeminiApiKey() {
  try {
    return (
      (typeof localStorage !== "undefined" ? localStorage.getItem(GEMINI_STORAGE_KEY) : "") ||
      (typeof window !== "undefined" ? window.__GESTAO_STATE__?.config?.geminiApiKey : "") ||
      ""
    ).trim();
  } catch (_) {
    return "";
  }
}

export function setGeminiApiKey(key) {
  try {
    if (typeof localStorage === "undefined") return;
    if (key) {
      localStorage.setItem(GEMINI_STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(GEMINI_STORAGE_KEY);
    }
  } catch (_) {}
}

// ==========================================================================
// UTILITÁRIOS DE PRESENÇA OPERACIONAL EM TEMPO REAL
// ==========================================================================

export function getLivePresenceItems(presenceData) {
  let data = presenceData;
  if (!data && typeof window !== "undefined") {
    data = window.__GESTAO_STATE__?.livePresenceData || window.state?.livePresenceData;
  }
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.presence)) return data.presence;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

export function isPersonWorking(p) {
  if (!p) return false;
  if (p.trabalhando === true) return true;
  const st = String(p.status || p.statusLabel || "").toLowerCase().trim();
  return st === "trabalhando" || st === "em serviço" || st === "em servico";
}

export function isPersonOnBreak(p) {
  if (!p) return false;
  const st = String(p.status || p.statusLabel || "").toLowerCase().trim();
  return st === "intervalo" || st === "em intervalo";
}

export function getLivePresenceTotals(presenceData) {
  let data = presenceData;
  if (!data && typeof window !== "undefined") {
    data = window.__GESTAO_STATE__?.livePresenceData || window.state?.livePresenceData;
  }
  if (data && typeof data === "object" && data.totals) {
    return data.totals;
  }
  const items = getLivePresenceItems(data);
  return {
    trabalhando: items.filter(isPersonWorking).length,
    intervalo: items.filter(isPersonOnBreak).length,
    ausente: items.filter((p) => String(p.status || "").toLowerCase() === "ausente").length,
    alertas: items.filter((p) => p.alertLevel && p.alertLevel !== "normal").length,
    total: items.length,
  };
}

// Declaração de Ferramentas para o Gemini Function Calling
export const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "criarTarefaCozinha",
        description: "Cria uma nova tarefa na cozinha no CozinhaFlow com responsável, prioridade e prazo",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Título da tarefa operacional" },
            responsavelNome: { type: "STRING", description: "Nome do colaborador responsável" },
            prioridade: { type: "STRING", enum: ["Baixa", "Normal", "Alta", "Urgente"], description: "Nível de prioridade" },
            prazo: { type: "STRING", description: "Prazo ou horário (ex: hoje às 18h)" },
          },
          required: ["titulo"],
        },
      },
      {
        name: "concluirTarefa",
        description: "Marca uma tarefa no CozinhaFlow como concluída",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Título ou parte do nome da tarefa a ser concluída" },
          },
        },
      },
      {
        name: "alterarTurno",
        description: "Altera o turno de trabalho de um colaborador na escala",
        parameters: {
          type: "OBJECT",
          properties: {
            nome: { type: "STRING", description: "Nome do colaborador" },
            novoTurno: { type: "STRING", enum: ["Manhã", "Tarde", "Noite", "Integral"], description: "Novo turno" },
          },
          required: ["nome", "novoTurno"],
        },
      },
      {
        name: "alterarFolgaFixa",
        description: "Altera o dia da folga fixa semanal de um colaborador na escala",
        parameters: {
          type: "OBJECT",
          properties: {
            nome: { type: "STRING", description: "Nome do colaborador" },
            novoDia: { type: "STRING", description: "Dia da semana (ex: Segunda-feira, Terça-feira)" },
          },
          required: ["nome", "novoDia"],
        },
      },
      {
        name: "solicitarFolga",
        description: "Solicita ou lança folga pontual. Para colaboradores comuns, envia pedido de aprovação para a gerência. Para gerentes e administradores, pode lançar folga para si mesmo ou para outro colaborador",
        parameters: {
          type: "OBJECT",
          properties: {
            data: { type: "STRING", description: "Data da folga no formato AAAA-MM-DD ou DD/MM/AAAA" },
            motivo: { type: "STRING", description: "Motivo da solicitação ou concessão de folga" },
            colaboradorNome: { type: "STRING", description: "Nome do colaborador que terá a folga (quando solicitado por gestor para terceiro)" },
            lojaNome: { type: "STRING", description: "Nome da loja ou unidade (ex: Foodpark, Teixeira, Eunápolis)" },
          },
          required: ["data"],
        },
      },
      {
        name: "lancarFolga",
        description: "Lança ou concede folga aprovada diretamente para um colaborador da loja ou rede (exclusivo para Gerentes e Administradores)",
        parameters: {
          type: "OBJECT",
          properties: {
            colaboradorNome: { type: "STRING", description: "Nome do colaborador a receber a folga" },
            data: { type: "STRING", description: "Data da folga no formato AAAA-MM-DD ou DD/MM/AAAA" },
            motivo: { type: "STRING", description: "Motivo ou justificativa da folga concedida" },
            lojaNome: { type: "STRING", description: "Nome da loja ou unidade (ex: Foodpark, Teixeira, Eunápolis)" },
          },
          required: ["colaboradorNome", "data"],
        },
      },
      {
        name: "solicitarAjustePonto",
        description: "Solicita alteração, inclusão ou correção de batida de ponto esquecida ou divergente (ex: esqueci de bater saída ontem às 18:00)",
        parameters: {
          type: "OBJECT",
          properties: {
            data: { type: "STRING", description: "Data do ponto a ajustar (AAAA-MM-DD, DD/MM/AAAA ou termos como ontem, hoje)" },
            horario: { type: "STRING", description: "Horário pretendido no formato HH:MM (ex: 18:00, 08:30)" },
            tipoMarcacao: {
              type: "STRING",
              enum: ["ENTRADA", "SAIDA_INTERVALO", "RETORNO_INTERVALO", "SAIDA_FINAL"],
              description: "Tipo da marcação de ponto",
            },
            motivo: { type: "STRING", description: "Justificativa da alteração do ponto" },
            colaboradorNome: { type: "STRING", description: "Nome do colaborador (quando acionado por gerente ou admin)" },
          },
          required: ["data", "horario"],
        },
      },
      {
        name: "aprovarTrocaFolga",
        description: "Aprova uma troca de folga pendente entre colaboradores",
        parameters: {
          type: "OBJECT",
          properties: {
            colaborador: { type: "STRING", description: "Nome de um dos colaboradores envolvidos na troca" },
          },
        },
      },
      {
        name: "publicarComunicado",
        description: "Publica um comunicado oficial para a loja ou rede",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Título do comunicado" },
            mensagem: { type: "STRING", description: "Texto completo do aviso" },
            destino: { type: "STRING", enum: ["Loja local", "Toda a rede"], description: "Destinatários" },
          },
          required: ["titulo", "mensagem"],
        },
      },
      {
        name: "cadastrarFeriado",
        description: "Cadastra um novo feriado nacional, regional ou municipal no sistema com crédito automático de folga para a equipe em escala",
        parameters: {
          type: "OBJECT",
          properties: {
            nome: { type: "STRING", description: "Nome do feriado (ex: Dia da Consciência Negra)" },
            data: { type: "STRING", description: "Data do feriado no formato AAAA-MM-DD ou DD/MM/AAAA" },
            tipo: { type: "STRING", enum: ["Nacional", "Regional", "Municipal"], description: "Tipo do feriado" },
            lojaId: { type: "STRING", description: "Identificador da loja (para feriados municipais)" },
          },
          required: ["nome", "data"],
        },
      },
      {
        name: "justificarAusencia",
        description: "Lança uma justificativa de falta ou ausência para um colaborador (ex: atestado médico, folga concedida, outros)",
        parameters: {
          type: "OBJECT",
          properties: {
            nome: { type: "STRING", description: "Nome do colaborador que faltou" },
            data: { type: "STRING", description: "Data da ausência no formato AAAA-MM-DD ou DD/MM/AAAA" },
            tipo: { type: "STRING", enum: ["Atestado", "Folga trocada", "Dia concedido", "Outros"], description: "Tipo legal da justificativa" },
            motivo: { type: "STRING", description: "Observação detalhada ou motivo da ausência" },
          },
          required: ["nome", "data"],
        },
      },
      {
        name: "consultarPoliticaRH",
        description: "Consulta as regras e diretrizes oficiais de RH do Grupo House 190 (5 folgas/mês, seg a qui, 5ª folga da gerência, trocas pelo app, banco de horas, feriados, ponto e atestados)",
        parameters: {
          type: "OBJECT",
          properties: {
            topico: {
              type: "STRING",
              enum: ["folgas", "trocas", "escala", "banco_horas", "feriados", "ponto", "atestados", "geral"],
              description: "Tópico da política de RH a consultar",
            },
          },
          required: ["topico"],
        },
      },
      {
        name: "solicitarTrocaFolga",
        description: "Prepara uma solicitação formal de troca de folga entre o colaborador logado e outro colega para aprovação do gerente",
        parameters: {
          type: "OBJECT",
          properties: {
            colegaNome: { type: "STRING", description: "Nome do colega com quem deseja trocar a folga" },
            minhaFolgaData: { type: "STRING", description: "Data da folga do colaborador logado (AAAA-MM-DD ou DD/MM/AAAA)" },
            folgaColegaData: { type: "STRING", description: "Data da folga pretendida do colega (AAAA-MM-DD ou DD/MM/AAAA)" },
            motivo: { type: "STRING", description: "Justificativa da troca de folga" },
          },
          required: ["colegaNome", "minhaFolgaData", "folgaColegaData"],
        },
      },
      {
        name: "consultarCoberturaEscala",
        description: "Analisa a cobertura operacional e colaboradores escalados em uma data específica para a gerência",
        parameters: {
          type: "OBJECT",
          properties: {
            data: { type: "STRING", description: "Data a analisar no formato AAAA-MM-DD ou DD/MM/AAAA" },
          },
          required: ["data"],
        },
      },
      {
        name: "decidirSolicitacaoFolga",
        description: "Prepara aprovação ou recusa de solicitação de folga ou troca pendente da equipe (exclusivo para Gerentes e Admins)",
        parameters: {
          type: "OBJECT",
          properties: {
            colaboradorNome: { type: "STRING", description: "Nome do colaborador cuja solicitação será decidida" },
            decisao: { type: "STRING", enum: ["Aprovar", "Recusar"], description: "Decisão gerencial" },
            motivo: { type: "STRING", description: "Justificativa da decisão, especialmente em caso de recusa" },
          },
          required: ["colaboradorNome", "decisao"],
        },
      },
      {
        name: "consultarPonto",
        description: "Consulta as marcações de ponto eletrônico registradas para um colaborador em uma data específica",
        parameters: {
          type: "OBJECT",
          properties: {
            colaboradorNome: { type: "STRING", description: "Nome do colaborador (opcional se for o próprio)" },
            data: { type: "STRING", description: "Data da consulta no formato AAAA-MM-DD ou termos como hoje, ontem" },
          },
        },
      },
      {
        name: "consultarBancoHoras",
        description: "Consulta o saldo acumulado e status do banco de horas de um colaborador",
        parameters: {
          type: "OBJECT",
          properties: {
            colaboradorNome: { type: "STRING", description: "Nome do colaborador (opcional se for o próprio)" },
          },
        },
      },
      {
        name: "consultarFolgas",
        description: "Consulta as folgas concedidas, pendentes e saldo de folgas da política (5 folgas) de um colaborador no mês",
        parameters: {
          type: "OBJECT",
          properties: {
            colaboradorNome: { type: "STRING", description: "Nome do colaborador (opcional se for o próprio)" },
            mes: { type: "STRING", description: "Mês no formato AAAA-MM (opcional, padrão mês atual)" },
          },
        },
      },
      {
        name: "consultarEscala",
        description: "Consulta os colaboradores escalados para trabalhar e quem está de folga em uma data",
        parameters: {
          type: "OBJECT",
          properties: {
            data: { type: "STRING", description: "Data no formato AAAA-MM-DD (opcional, padrão hoje)" },
            lojaId: { type: "STRING", description: "Identificador da unidade ou loja" },
          },
        },
      },
      {
        name: "listarPendencias",
        description: "Lista o resumo de todas as pendências operacionais (folgas pendentes, trocas, tarefas atrasadas e documentos)",
        parameters: {
          type: "OBJECT",
          properties: {
            lojaId: { type: "STRING", description: "Identificador da unidade (opcional)" },
          },
        },
      },
      {
        name: "consultarPresencaAgora",
        description: "Consulta a presença em tempo real dos colaboradores (quem está trabalhando agora e quem está em intervalo)",
        parameters: {
          type: "OBJECT",
          properties: {
            lojaId: { type: "STRING", description: "Identificador da unidade (opcional)" },
          },
        },
      },
    ],
  },
];

// Helper para normalização de texto sem acentos
export function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Helper inteligente para localizar funcionário por menção em texto, nome ou loja
export function findEmployeeInText(textToSearch, employees = []) {
  if (!textToSearch || !Array.isArray(employees) || employees.length === 0) return null;
  const rawText = String(textToSearch).trim();
  const normText = normalizeText(rawText);

  // 1. Detectar menção a loja no texto para desempate / filtro
  const storeKeywords = [
    { key: "foodpark", id: "foodpark" },
    { key: "teixeira", id: "teixeira" },
    { key: "eunapolis", id: "eunapolis" },
    { key: "matriz", id: "matriz" },
    { key: "filial", id: "filial" },
  ];
  let mentionedStore = null;
  for (const sk of storeKeywords) {
    if (normText.includes(sk.key)) {
      mentionedStore = sk.id;
      break;
    }
  }

  let bestEmp = null;
  let bestScore = 0;

  for (const emp of employees) {
    const rawName = emp.Nome || emp.nome || "";
    if (!rawName) continue;
    const normFullName = normalizeText(rawName);
    const empStore = normalizeText(emp.LojaID || emp.lojaId || emp.NomeLoja || emp.nomeLoja || "");
    const parts = normFullName.split(/\s+/).filter((p) => p.length >= 2 && !["de", "da", "do", "dos", "das", "e"].includes(p));
    if (parts.length === 0) continue;

    let score = 0;

    // Match exato de nome completo (com ou sem acentos)
    const exactFullRegex = new RegExp("(?:^|[^a-z0-9])" + normFullName + "(?:$|[^a-z0-9])", "i");
    if (exactFullRegex.test(normText)) {
      score += 120;
    } else {
      // Variação flexível de gênero no último nome (ex: Claudio / Cláudia)
      const flexFullName = normFullName.replace(/[ao]$/, "[ao]");
      const flexFullRegex = new RegExp("(?:^|[^a-z0-9])" + flexFullName + "(?:$|[^a-z0-9])", "i");
      if (flexFullRegex.test(normText)) {
        score += 105;
      }
    }

    // Match do primeiro nome isolado (ex: "maria", "gabriel", "pedro")
    const firstName = parts[0];
    const firstNameRegex = new RegExp("(?:^|[^a-z0-9])" + firstName + "(?:$|[^a-z0-9])", "i");
    if (firstNameRegex.test(normText)) {
      score += 50;
    }

    // Match por palavras individuais do nome
    let matchedPartsCount = 0;
    for (const part of parts) {
      const partRegex = new RegExp("(?:^|[^a-z0-9])" + part + "(?:$|[^a-z0-9])", "i");
      const flexPartRegex = new RegExp("(?:^|[^a-z0-9])" + part.replace(/[ao]$/, "[ao]") + "(?:$|[^a-z0-9])", "i");
      if (partRegex.test(normText)) {
        matchedPartsCount += 1;
      } else if (flexPartRegex.test(normText)) {
        matchedPartsCount += 0.9;
      }
    }

    if (matchedPartsCount > 0) {
      score += (matchedPartsCount / parts.length) * 40;
      if (matchedPartsCount >= 2) {
        score += 30; // bônus forte para nome e sobrenome
      }
    }

    // Preposição indicando destinatário (ex: "para Ana", "do Gabriel")
    const prepRegex = new RegExp("(?:para|pro|pra|de|do|da|ao|a)\\s+" + firstName + "(?:$|[^a-z0-9])", "i");
    if (prepRegex.test(normText)) {
      score += 25;
    }

    // Alinhamento com a loja mencionada
    if (mentionedStore) {
      if (empStore.includes(mentionedStore)) {
        score += 45;
      } else if (matchedPartsCount > 0) {
        score -= 40; // penaliza se pertencer explicitamente a outra loja
      }
    }

    if (score > bestScore && score >= 40) {
      bestScore = score;
      bestEmp = emp;
    }
  }

  return bestEmp;
}

// ==========================================================================
// CONVERSOR DE FUNCTION CALL (GEMINI) PARA AÇÃO DO SISTEMA
// ==========================================================================

export function convertFunctionCallToAction(name, args = {}, context = {}) {
  return sanitizeIntent(_convertFunctionCallToActionRaw(name, args, context));
}

function _convertFunctionCallToActionRaw(name, args = {}, context = {}) {
  const user = context.user || {};
  const role = getUserRole(user);
  const userStore = getUserStoreId(user);
  const userId = getUserId(user);
  const userName = getUserName(user);
  const employees = Array.isArray(context.employees) ? context.employees : [];
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  const swaps = Array.isArray(context.swaps) ? context.swaps : [];
  const timeOff = Array.isArray(context.timeOff) ? context.timeOff : [];

  switch (name) {
    case "criarTarefaCozinha": {
      if (role === "employee") {
        return {
          type: "error",
          message: "A criação e delegação de tarefas na cozinha requer permissão de Gerente ou Administrador.",
        };
      }

      const titulo = String(args.titulo || "Higienização e organização operacional").trim();
      const prioridade = String(args.prioridade || "Normal").trim();
      const prazo = String(args.prazo || "").trim();
      let targetEmployee = null;
      if (args.responsavelNome) {
        targetEmployee = findEmployeeInText(args.responsavelNome, employees);
      }

      if (targetEmployee && role === "manager" && userStore) {
        const empStore = String(targetEmployee.LojaID || targetEmployee.lojaId || "");
        if (empStore && empStore !== userStore) {
          return {
            type: "error",
            message: `O colaborador ${targetEmployee.Nome} pertence a outra unidade. Você pode delegar tarefas apenas para a sua loja.`,
          };
        }
      }

      const payload = {
        TITULO: titulo,
        DESCRICAO: `Tarefa criada pelo Copiloto House 190 (Gemini) a pedido de ${userName}.`,
        PRIORIDADE: prioridade,
        PRAZO: prazo,
        RESPONSAVEL_ID: targetEmployee ? String(targetEmployee.FuncionarioID || targetEmployee.id || "") : "",
        RESPONSAVEL_NOME: targetEmployee ? String(targetEmployee.Nome || "") : "Equipe da Cozinha",
        LojaID: targetEmployee?.LojaID || userStore,
        STATUS: "A fazer",
      };

      return {
        type: "action",
        actionType: "create_task",
        title: "Criar Tarefa no CozinhaFlow",
        apiMethod: "cozinhaTasksSave",
        apiArgs: [payload],
        summary: `Criar a tarefa "${titulo}" atribuída a ${payload.RESPONSAVEL_NOME} com prioridade ${prioridade}.`,
        diff: [
          { label: "Título", value: titulo },
          { label: "Responsável", value: payload.RESPONSAVEL_NOME },
          { label: "Prioridade", value: prioridade },
          { label: "Prazo", value: prazo || "Sem prazo definido" },
        ],
        details: {
          titulo,
          responsavel: payload.RESPONSAVEL_NOME,
          prioridade,
        },
      };
    }

    case "alterarTurno": {
      if (role === "employee") {
        return {
          type: "error",
          message: "Alterações de turno na escala requerem perfil de Gerente ou Administrador.",
        };
      }

      const emp = findEmployeeInText(args.nome, employees);
      if (!emp) {
        return {
          type: "error",
          message: `Colaborador "${args.nome}" não foi localizado no cadastro.`,
        };
      }

      if (role === "manager" && userStore) {
        const empStore = String(emp.LojaID || emp.lojaId || "");
        if (empStore && empStore !== userStore) {
          return {
            type: "error",
            message: `O colaborador ${emp.Nome} pertence a outra unidade. Você pode alterar turnos apenas de colaboradores da sua loja.`,
          };
        }
      }

      const targetShift = args.novoTurno || "Manhã";
      const currentShift = emp.Turno || emp.turno || "Não definido";
      const empId = emp.FuncionarioID || emp.id;

      const payload = { ...emp, Turno: targetShift };

      return {
        type: "action",
        actionType: "update_shift",
        title: "Alterar Turno na Escala",
        apiMethod: "updateEmployee",
        apiArgs: [empId, payload],
        summary: `Alterar o turno de ${emp.Nome} de "${currentShift}" para "${targetShift}".`,
        diff: [
          { label: "Colaborador", value: emp.Nome },
          { label: "Turno Atual", value: currentShift },
          { label: "Novo Turno", value: targetShift },
        ],
        details: { empId, newShift: targetShift },
      };
    }

    case "alterarFolgaFixa": {
      if (role === "employee") {
        return {
          type: "error",
          message: "Definir ou alterar a folga semanal fixa requer permissão gerencial.",
        };
      }

      const emp = findEmployeeInText(args.nome, employees);
      if (!emp) {
        return {
          type: "error",
          message: `Colaborador "${args.nome}" não foi localizado no cadastro.`,
        };
      }

      if (role === "manager" && userStore) {
        const empStore = String(emp.LojaID || emp.lojaId || "");
        if (empStore && empStore !== userStore) {
          return {
            type: "error",
            message: `O colaborador ${emp.Nome} pertence a outra unidade.`,
          };
        }
      }

      const targetDay = args.novoDia || "Segunda-feira";
      const currentDay = emp.FolgaFixaSemanal || emp.folgaFixa || "Não definida";
      const empId = emp.FuncionarioID || emp.id;

      const payload = { ...emp, FolgaFixaSemanal: targetDay };

      return {
        type: "action",
        actionType: "update_fixed_timeoff",
        title: "Alterar Folga Fixa Semanal",
        apiMethod: "updateEmployee",
        apiArgs: [empId, payload],
        summary: `Definir a folga fixa semanal de ${emp.Nome} para "${targetDay}".`,
        diff: [
          { label: "Colaborador", value: emp.Nome },
          { label: "Folga Atual", value: currentDay },
          { label: "Nova Folga", value: targetDay },
        ],
        details: { empId, targetDay },
      };
    }

    case "solicitarFolga":
    case "lancarFolga": {
      const parsedDate = extractDateFromText(args.data);
      const isoDate = parsedDate ? parsedDate.isoDate : (args.data || "");
      const formattedDate = parsedDate ? parsedDate.formattedDate : isoDate;
      const reason = extractReasonFromText(args.motivo || (role === "employee" ? "Solicitação de folga via Copiloto" : `Folga concedida via Copiloto por ${userName}`));

      let targetEmp = null;
      if (args.colaboradorNome) {
        targetEmp = findEmployeeInText(args.colaboradorNome + (args.lojaNome ? ` do ${args.lojaNome}` : ""), employees);
      }

      if (targetEmp && role === "employee" && targetEmp.FuncionarioID !== userId) {
        return {
          type: "error",
          message: "Você só pode solicitar folga para o seu próprio usuário. A concessão ou solicitação de folga para outros colaboradores é restrita à gerência e administração.",
        };
      }

      if (targetEmp && role === "manager" && userStore) {
        const empStore = String(targetEmp.LojaID || targetEmp.lojaId || "");
        if (empStore && empStore !== userStore) {
          return {
            type: "error",
            message: `O colaborador ${targetEmp.Nome} pertence a outra unidade. Você pode conceder folga apenas para colaboradores da sua loja.`,
          };
        }
      }

      if (targetEmp && role !== "employee" && targetEmp.FuncionarioID !== userId) {
        const storeLabel = targetEmp.NomeLoja || (targetEmp.LojaID ? `Loja ${targetEmp.LojaID}` : (userStore ? `Loja ${userStore}` : "Unidade"));
        const payload = {
          FuncionarioID: targetEmp.FuncionarioID || targetEmp.id,
          NomeFuncionario: targetEmp.Nome || targetEmp.nome,
          LojaID: targetEmp.LojaID || targetEmp.lojaId || userStore,
          DataInicio: isoDate,
          DataFim: isoDate,
          TipoFolga: "Folga",
          Motivo: reason,
          Status: "Aprovada",
        };

        return {
          type: "action",
          actionType: "create_timeoff",
          title: "Lançar Folga",
          apiMethod: "createTimeOff",
          apiArgs: [payload],
          summary: `Lançar folga aprovada para ${targetEmp.Nome} (${storeLabel}) no dia ${formattedDate}.`,
          diff: [
            { label: "Colaborador", value: targetEmp.Nome },
            { label: "Loja", value: storeLabel },
            { label: "Data da Folga", value: formattedDate },
            { label: "Motivo", value: reason },
            { label: "Status Inicial", value: "Aprovada (concedida pela gestão)" },
          ],
          details: {
            empId: targetEmp.FuncionarioID || targetEmp.id,
            empName: targetEmp.Nome || targetEmp.nome,
            isoDate,
            formattedDate,
            reason,
          },
        };
      }

      // Se for o próprio colaborador ou gestor solicitando para si
      const isDirectApproval = role !== "employee";
      const apiMethod = isDirectApproval ? "createTimeOff" : "createEmployeeTimeOffRequest";
      const title = isDirectApproval ? "Lançar Folga" : "Solicitar Folga";
      const statusLabel = isDirectApproval ? "Aprovada (concedida pela gestão)" : "Pendente (aguardando gestor)";

      const payload = {
        FuncionarioID: userId,
        NomeFuncionario: userName,
        LojaID: userStore,
        DataInicio: isoDate,
        DataFim: isoDate,
        TipoFolga: isDirectApproval ? "Folga" : "Folga solicitada",
        Motivo: reason,
        Status: isDirectApproval ? "Aprovada" : "Pendente",
      };

      return {
        type: "action",
        actionType: isDirectApproval ? "create_timeoff" : "request_timeoff",
        title,
        apiMethod,
        apiArgs: [payload],
        summary: `${isDirectApproval ? "Lançar folga aprovada" : "Enviar pedido de folga"} para o dia ${formattedDate} com motivo: "${reason}".`,
        diff: [
          { label: "Data Solicitada", value: formattedDate },
          { label: "Colaborador", value: userName },
          { label: "Motivo", value: reason },
          { label: "Status Inicial", value: statusLabel },
        ],
        details: { isoDate, formattedDate, reason },
      };
    }

    case "solicitarAjustePonto":
    case "ajustarPonto":
    case "corrigirPonto": {
      const parsedDate = extractDateFromText(args.data) || extractDateFromText("hoje");
      const isoDate = parsedDate ? parsedDate.isoDate : (args.data || "");
      const formattedDate = parsedDate ? parsedDate.formattedDate : (args.data || "");
      const time = extractTimeFromText(args.horario) || "18:00";
      const punchInfo = extractPunchType(args.tipoMarcacao || args.motivo || "", time);
      const punchType = args.tipoMarcacao || punchInfo.type;
      const punchLabel = punchInfo.label;
      const reason = extractReasonFromText(args.motivo || "Solicitação de ajuste de ponto via Copiloto");

      let targetEmp = null;
      if (args.colaboradorNome && role !== "employee") {
        targetEmp = findEmployeeInText(args.colaboradorNome, employees);
      }
      const targetName = targetEmp ? (targetEmp.Nome || targetEmp.nome) : userName;
      const targetId = targetEmp ? (targetEmp.FuncionarioID || targetEmp.id) : userId;
      const targetStore = targetEmp ? (targetEmp.LojaID || targetEmp.lojaId) : userStore;

      if (role === "employee" || (!targetEmp && role !== "admin" && role !== "manager")) {
        const payload = {
          registroPontoId: "",
          dataHoraSolicitada: `${isoDate}T${time}:00`,
          motivo: reason,
        };

        return {
          type: "action",
          actionType: "request_clock_adjustment",
          title: "Solicitar Ajuste de Ponto",
          apiMethod: "requestTimeClockAdjustment",
          apiArgs: [payload],
          summary: `Enviar solicitação de ajuste da batida de ponto para o dia ${formattedDate} às ${time} (${punchLabel}) com motivo: "${reason}".`,
          diff: [
            { label: "Colaborador", value: targetName },
            { label: "Data", value: formattedDate },
            { label: "Marcação", value: punchLabel },
            { label: "Horário Solicitado", value: time },
            { label: "Motivo", value: reason },
            { label: "Status Inicial", value: "Pendente (aguardando gestor)" },
          ],
          details: {
            empId: targetId,
            isoDate,
            formattedDate,
            time,
            punchType,
            reason,
          },
        };
      }

      if (role === "manager") {
        const payload = {
          funcionarioId: targetId,
          data: isoDate,
          horaSaida: time,
          observacao: reason,
        };

        return {
          type: "action",
          actionType: "quick_fix_clock",
          title: "Ajustar Ponto do Colaborador",
          apiMethod: "quickFixIncompletePunch",
          apiArgs: [payload],
          summary: `Lançar ajuste de ponto para ${targetName} no dia ${formattedDate} às ${time}.`,
          diff: [
            { label: "Colaborador", value: targetName },
            { label: "Data", value: formattedDate },
            { label: "Horário", value: time },
            { label: "Observação", value: reason },
          ],
          details: { empId: targetId, isoDate, time },
        };
      }

      const payload = {
        funcionarioId: targetId,
        tipoMarcacao: punchType,
        dataHora: `${isoDate}T${time}:00`,
        motivo: reason,
        dataOperacional: isoDate,
      };

      return {
        type: "action",
        actionType: "manual_clock_punch",
        title: "Lançar Ponto Manual",
        apiMethod: "registerTimeClockManualPunch",
        apiArgs: [payload],
        summary: `Lançar ponto manual para ${targetName} em ${formattedDate} às ${time} (${punchLabel}) com auditoria.`,
        diff: [
          { label: "Colaborador", value: targetName },
          { label: "Data", value: formattedDate },
          { label: "Tipo", value: punchLabel },
          { label: "Horário", value: time },
          { label: "Motivo", value: reason },
        ],
        details: { empId: targetId, isoDate, time, punchType },
      };
    }

    case "concluirTarefa": {
      const q = String(args.titulo || "").toLowerCase();
      const targetTask = tasks.find((t) => {
        const tId = String(t.RESPONSAVEL_ID || t.FuncionarioID || "").trim();
        const status = String(t.STATUS || t.Status || "");
        if (role === "employee" && tId !== userId) return false;
        if (status === "Concluída") return false;
        if (!q) return true;
        return String(t.TITULO || t.Titulo || "").toLowerCase().includes(q);
      });

      if (!targetTask) {
        return {
          type: "error",
          message: "Nenhuma tarefa aberta correspondente foi encontrada para ser concluída.",
        };
      }

      const payload = {
        ...targetTask,
        STATUS: "Concluída",
        Status: "Concluída",
        OBSERVACAO_CONCLUSAO: `Concluída via Copiloto House 190 por ${userName}.`,
      };

      return {
        type: "action",
        actionType: "finish_task",
        title: "Concluir Tarefa",
        apiMethod: "cozinhaTasksSave",
        apiArgs: [payload],
        summary: `Marcar a tarefa "${targetTask.TITULO || targetTask.Titulo}" como Concluída.`,
        diff: [
          { label: "Tarefa", value: targetTask.TITULO || targetTask.Titulo },
          { label: "Status Anterior", value: targetTask.STATUS || targetTask.Status || "A fazer" },
          { label: "Novo Status", value: "Concluída" },
        ],
        details: { id: targetTask.ID || targetTask.TarefaID },
      };
    }

    case "aprovarTrocaFolga": {
      if (role === "employee") {
        return {
          type: "error",
          message: "A aprovação de trocas de folga é exclusiva de Gerentes e Administradores.",
        };
      }

      const q = String(args.colaborador || "").toLowerCase();
      const pendingSwap = swaps.find((s) => {
        const status = String(s.Status || s.status || "");
        if (status !== "Aguardando gestor" && status !== "Aguardando aprovação") return false;
        if (role === "manager" && userStore) {
          const sStore = String(s.LojaID || s.lojaId || "");
          if (sStore && sStore !== userStore) return false;
        }
        if (!q) return true;
        const oName = String(s.NomeFuncionarioOrigem || "").toLowerCase();
        const dName = String(s.NomeFuncionarioDestino || "").toLowerCase();
        return oName.includes(q) || dName.includes(q);
      });

      if (!pendingSwap) {
        return {
          type: "error",
          message: "Nenhuma troca de folga pendente correspondente foi encontrada.",
        };
      }

      const swapId = pendingSwap.TrocaID || pendingSwap.TrocaPrincipalID;

      return {
        type: "action",
        actionType: "approve_swap",
        title: "Aprovar Troca de Folga",
        apiMethod: "decideTimeOffSwap",
        apiArgs: [swapId, true, `Aprovado pelo Copiloto House 190 (${userName})`],
        summary: `Aprovar a troca de folga entre ${pendingSwap.NomeFuncionarioOrigem} e ${pendingSwap.NomeFuncionarioDestino}.`,
        diff: [
          { label: "Origem", value: `${pendingSwap.NomeFuncionarioOrigem} (${pendingSwap.DataFolgaOrigem || "Data"})` },
          { label: "Destino", value: `${pendingSwap.NomeFuncionarioDestino} (${pendingSwap.DataFolgaDestino || "Data"})` },
          { label: "Status", value: "Aprovada" },
        ],
        details: { swapId },
      };
    }

    case "publicarComunicado": {
      if (role === "employee") {
        return {
          type: "error",
          message: "A publicação de comunicados é restrita a Gerentes e Administradores.",
        };
      }

      const title = String(args.titulo || "Aviso Geral").trim();
      const body = String(args.mensagem || "").trim();
      const isLocal = args.destino === "Loja local" || role !== "admin";

      const payload = {
        Titulo: title,
        Corpo: body,
        LojaID: isLocal ? userStore : "",
        PublicoAlvo: "Todos",
        ExigeConfirmacao: false,
      };

      return {
        type: "action",
        actionType: "publish_announcement",
        title: "Publicar Comunicado",
        apiMethod: "publicarComunicado",
        apiArgs: [payload],
        summary: `Publicar o comunicado "${title}" para ${payload.LojaID ? "a loja atual" : "toda a rede"}.`,
        diff: [
          { label: "Título", value: title },
          { label: "Mensagem", value: body },
          { label: "Destino", value: payload.LojaID ? "Loja local" : "Rede completa" },
        ],
        details: { title, body },
      };
    }

    case "cadastrarFeriado": {
      if (role !== "admin") {
        return {
          type: "error",
          message: "O cadastro de feriados é exclusivo para o perfil de Administrador.",
        };
      }

      const nomeFeriado = String(args.nome || "").trim();
      if (!nomeFeriado) {
        return {
          type: "error",
          message: "Informe o nome do feriado a ser cadastrado.",
        };
      }

      let isoDate = String(args.data || "").trim();
      if (isoDate.includes("/")) {
        const parts = isoDate.split("/");
        const d = parts[0].padStart(2, "0");
        const m = parts[1].padStart(2, "0");
        const y = parts[2] ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : new Date().getFullYear().toString();
        isoDate = `${y}-${m}-${d}`;
      }

      const tipo = args.tipo || "Nacional";
      const lojaId = args.lojaId || (tipo === "Municipal" ? userStore : "");

      const payload = {
        NomeFeriado: nomeFeriado,
        Data: isoDate,
        Tipo: tipo,
        LojaID: lojaId,
        Ativo: true,
      };

      return {
        type: "action",
        actionType: "create_holiday",
        title: "Cadastrar Feriado",
        apiMethod: "createHoliday",
        apiArgs: [payload],
        summary: `Cadastrar feriado "${nomeFeriado}" em ${isoDate} (${tipo}) com crédito automático de folga para os colaboradores.`,
        diff: [
          { label: "Feriado", value: nomeFeriado },
          { label: "Data", value: isoDate },
          { label: "Tipo", value: tipo },
          { label: "Crédito Automático", value: "Sim (folga extra para equipe em escala)" },
        ],
        details: { nomeFeriado, isoDate, tipo },
      };
    }

    case "justificarAusencia": {
      if (role === "employee") {
        return {
          type: "error",
          message: "O lançamento de justificativas de falta requer perfil de Gerente ou Administrador.",
        };
      }

      const emp = findEmployeeInText(args.nome, employees);
      if (!emp) {
        return {
          type: "error",
          message: `Colaborador "${args.nome}" não foi localizado no cadastro.`,
        };
      }

      if (role === "manager" && userStore) {
        const empStore = String(emp.LojaID || emp.lojaId || "");
        if (empStore && empStore !== userStore) {
          return {
            type: "error",
            message: `O colaborador ${emp.Nome} pertence a outra unidade. Você pode justificar ausências apenas da sua loja.`,
          };
        }
      }

      let isoDate = String(args.data || "").trim();
      if (isoDate.includes("/")) {
        const parts = isoDate.split("/");
        const d = parts[0].padStart(2, "0");
        const m = parts[1].padStart(2, "0");
        const y = parts[2] ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : new Date().getFullYear().toString();
        isoDate = `${y}-${m}-${d}`;
      }

      const tipo = args.tipo || "Atestado";
      const obs = args.motivo || `Justificativa lançada via Copiloto por ${userName}`;

      const payload = {
        funcionarioId: emp.FuncionarioID || emp.id,
        data: isoDate,
        tipo: tipo,
        observacao: obs,
      };

      return {
        type: "action",
        actionType: "justify_absence",
        title: "Justificar Ausência / Falta",
        apiMethod: "justifyMissedTimeClockDay",
        apiArgs: [payload],
        summary: `Lançar justificativa de ausência (${tipo}) para ${emp.Nome} no dia ${isoDate}.`,
        diff: [
          { label: "Colaborador", value: emp.Nome },
          { label: "Data", value: isoDate },
          { label: "Tipo", value: tipo },
          { label: "Observação", value: obs },
        ],
        details: { empId: payload.funcionarioId, isoDate, tipo },
      };
    }

    case "consultarPoliticaRH": {
      const topico = String(args.topico || "folgas").toLowerCase().trim();
      const content = RH_POLICIES[topico] || RH_POLICIES.folgas;
      return {
        type: "query",
        reply: content,
      };
    }

    case "solicitarTrocaFolga": {
      const colega = findEmployeeInText(args.colegaNome, employees);
      if (!colega) {
        return {
          type: "error",
          message: `Colaborador colega "${args.colegaNome}" não foi localizado no cadastro.`,
        };
      }

      let myDate = String(args.minhaFolgaData || "").trim();
      if (myDate.includes("/")) {
        const p = myDate.split("/");
        myDate = `${p[2] ? (p[2].length === 2 ? `20${p[2]}` : p[2]) : new Date().getFullYear()}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
      }

      let targetDate = String(args.folgaColegaData || "").trim();
      if (targetDate.includes("/")) {
        const p = targetDate.split("/");
        targetDate = `${p[2] ? (p[2].length === 2 ? `20${p[2]}` : p[2]) : new Date().getFullYear()}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
      }

      const motivo = args.motivo || "Solicitação de troca via Copiloto";

      const payload = {
        FuncionarioOrigemID: userId,
        NomeFuncionarioOrigem: userName,
        DataFolgaOrigem: myDate,
        FuncionarioDestinoID: colega.FuncionarioID || colega.id,
        NomeFuncionarioDestino: colega.Nome || colega.nome,
        DataFolgaDestino: targetDate,
        LojaID: userStore,
        Motivo: motivo,
        Status: "Aguardando gestor",
      };

      return {
        type: "action",
        actionType: "request_swap",
        title: "Solicitar Troca de Folga",
        apiMethod: "createTimeOffSwapRequest",
        apiArgs: [payload],
        summary: `Solicitar troca de folga com ${colega.Nome}: sua folga em ${myDate} pela folga dele(a) em ${targetDate}.`,
        diff: [
          { label: "Sua Folga Atual", value: myDate },
          { label: "Colega", value: colega.Nome },
          { label: "Folga Pretendida do Colega", value: targetDate },
          { label: "Motivo", value: motivo },
          { label: "Status Inicial", value: "Aguardando aprovação do gestor" },
        ],
        details: { colegaId: colega.FuncionarioID || colega.id, myDate, targetDate },
      };
    }

    case "consultarCoberturaEscala": {
      if (role === "employee") {
        return {
          type: "query",
          reply: "A consulta detalhada de cobertura operacional de postos da equipe é restrita aos gestores da unidade.",
        };
      }

      let isoDate = String(args.data || "").trim();
      if (isoDate.includes("/")) {
        const p = isoDate.split("/");
        isoDate = `${p[2] ? (p[2].length === 2 ? `20${p[2]}` : p[2]) : new Date().getFullYear()}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
      }

      const actor = { userId, role, storeId: userStore };
      const cov = hrAdapter.getTeamCoverage(actor, { date: isoDate }, context);
      return {
        type: "query",
        reply: `**Cobertura Operacional da Equipe em ${isoDate}:**\n\n- **Unidade:** ${cov.lojaId}\n- **Total no quadro:** ${cov.totalEquipe} colaboradores\n- **Escalados:**\n${cov.colaboradoresEscalados.map((c) => `  * ${c}`).join("\n")}`,
      };
    }

    case "decidirSolicitacaoFolga": {
      if (role === "employee") {
        return {
          type: "error",
          message: "A aprovação ou recusa de solicitações é exclusiva de Gerentes e Administradores.",
        };
      }

      const q = String(args.colaboradorNome || "").toLowerCase();
      const isApproval = String(args.decisao || "").toLowerCase() === "aprovar";
      const motivo = args.motivo || (isApproval ? `Aprovado pelo Copiloto House 190 (${userName})` : `Recusado pelo Copiloto House 190 (${userName})`);

      // Verificar primeiro se há troca pendente para esse colaborador
      const pendingSwap = swaps.find((s) => {
        const st = String(s.Status || s.status || "").toLowerCase();
        if (!st.includes("aguardando") && st !== "pendente") return false;
        if (role === "manager" && userStore) {
          const sStore = String(s.LojaID || s.lojaId || "");
          if (sStore && sStore !== userStore) return false;
        }
        if (!q) return true;
        const oName = String(s.NomeFuncionarioOrigem || "").toLowerCase();
        const dName = String(s.NomeFuncionarioDestino || "").toLowerCase();
        return oName.includes(q) || dName.includes(q);
      });

      if (pendingSwap) {
        const swapId = pendingSwap.TrocaID || pendingSwap.TrocaPrincipalID;
        const actionLabel = isApproval ? "Aprovar Troca de Folga" : "Recusar Troca de Folga";
        return {
          type: "action",
          actionType: isApproval ? "approve_swap" : "reject_swap",
          title: actionLabel,
          apiMethod: "decideTimeOffSwap",
          apiArgs: [swapId, isApproval, motivo],
          summary: `${actionLabel} entre ${pendingSwap.NomeFuncionarioOrigem} e ${pendingSwap.NomeFuncionarioDestino}.`,
          diff: [
            { label: "Origem", value: `${pendingSwap.NomeFuncionarioOrigem} (${pendingSwap.DataFolgaOrigem || "Data"})` },
            { label: "Destino", value: `${pendingSwap.NomeFuncionarioDestino} (${pendingSwap.DataFolgaDestino || "Data"})` },
            { label: "Decisão", value: isApproval ? "Aprovada" : "Recusada" },
            { label: "Motivo", value: motivo },
          ],
          details: { swapId, decision: isApproval ? "approved" : "rejected" },
        };
      }

      // Verificar se há pedido de folga pendente
      const pendingLeave = timeOff.find((f) => {
        const st = String(f.Status || f.status || "").toLowerCase();
        if (st !== "pendente") return false;
        if (role === "manager" && userStore) {
          const fStore = String(f.LojaID || f.lojaId || "");
          if (fStore && fStore !== userStore) return false;
        }
        if (!q) return true;
        const fName = String(f.NomeFuncionario || f.nome || "").toLowerCase();
        return fName.includes(q);
      });

      if (pendingLeave) {
        const reqId = pendingLeave.ID || pendingLeave.id;
        const actionLabel = isApproval ? "Aprovar Solicitação de Folga" : "Recusar Solicitação de Folga";
        return {
          type: "action",
          actionType: isApproval ? "approve_leave" : "reject_leave",
          title: actionLabel,
          apiMethod: "saveTimeOffRequestDecision",
          apiArgs: [reqId, isApproval ? "Aprovada" : "Recusada", motivo],
          summary: `${actionLabel} de ${pendingLeave.NomeFuncionario || "Colaborador"} para o dia ${pendingLeave.DataInicio || pendingLeave.Data}.`,
          diff: [
            { label: "Colaborador", value: pendingLeave.NomeFuncionario || "Colaborador" },
            { label: "Data da Folga", value: pendingLeave.DataInicio || pendingLeave.Data || "Data" },
            { label: "Decisão", value: isApproval ? "Aprovada" : "Recusada" },
            { label: "Justificativa", value: motivo },
          ],
          details: { reqId, decision: isApproval ? "Aprovada" : "Recusada" },
        };
      }

      return {
        type: "error",
        message: `Nenhuma solicitação de folga ou troca pendente foi localizada para "${args.colaboradorNome}".`,
      };
    }

    case "consultarPonto": {
      const targetEmp = args.colaboradorNome ? findEmployeeInText(args.colaboradorNome, employees) : null;
      const targetName = targetEmp ? (targetEmp.Nome || targetEmp.nome) : userName;
      const dateInfo = extractDateFromText(args.data) || { isoDate: todayIso(), formattedDate: todayIso() };
      return {
        type: "query",
        reply: `Consultando marcações de ponto para ${targetName} na data ${dateInfo.formattedDate || dateInfo.isoDate}. Você pode conferir os detalhes no módulo de Ponto Eletrônico e Espelho de Ponto.`,
        details: { targetName, date: dateInfo.isoDate },
      };
    }

    case "consultarBancoHoras": {
      const targetEmp = args.colaboradorNome ? findEmployeeInText(args.colaboradorNome, employees) : null;
      const targetName = targetEmp ? (targetEmp.Nome || targetEmp.nome) : userName;
      return {
        type: "query",
        reply: `Consultando apuração de banco de horas de ${targetName}. O saldo acumulado e as horas compensatórias estão disponíveis com total rastreabilidade no painel de Banco de Horas.`,
        details: { targetName },
      };
    }

    case "consultarFolgas": {
      const targetEmp = args.colaboradorNome ? findEmployeeInText(args.colaboradorNome, employees) : null;
      const targetName = targetEmp ? (targetEmp.Nome || targetEmp.nome) : userName;
      return {
        type: "query",
        reply: `Consultando escala de folgas de ${targetName}. Conforme a política oficial do Grupo House 190, cada colaborador tem direito a 5 folgas mensais na escala 6x1.`,
        details: { targetName },
      };
    }

    case "consultarEscala": {
      const dateInfo = extractDateFromText(args.data) || { isoDate: todayIso(), formattedDate: todayIso() };
      return {
        type: "query",
        reply: `Consultando escala operacional para ${dateInfo.formattedDate || dateInfo.isoDate}. A cobertura da equipe e colaboradores escalados por turno estão disponíveis na aba Escala de Folgas.`,
        details: { date: dateInfo.isoDate },
      };
    }

    case "listarPendencias": {
      const pendingLeaves = timeOff.filter((f) => String(f.Status || f.status || "").toLowerCase() === "pendente").length;
      const pendingSwapsCount = swaps.filter((s) => String(s.Status || s.status || "").toLowerCase().includes("pend")).length;
      return {
        type: "query",
        reply: `Identificadas ${pendingLeaves} solicitação(ões) de folga e ${pendingSwapsCount} troca(s) pendente(s) aguardando aprovação da gestão.`,
        details: { pendingLeaves, pendingSwaps: pendingSwapsCount },
      };
    }

    case "consultarPresencaAgora": {
      const totals = getLivePresenceTotals(context.livePresenceData);
      return {
        type: "query",
        reply: `Presença em tempo real: ${totals.trabalhando || 0} colaborador(es) em operação, ${totals.intervalo || 0} em intervalo de refeição/descanso e ${totals.ausente || 0} ausente(s).`,
        details: totals,
      };
    }

    default:
      return parseCopilotIntent(JSON.stringify(args), context);
  }
}

// ==========================================================================
// CHAMADA À API DO GEMINI (FLASH OU ARGON)
// ==========================================================================

export async function callGeminiCopilot(prompt, context = {}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return parseCopilotIntent(prompt, context);
  }
  let model = getGeminiModel();
  if (model === "gemini-4-argon") {
    model = "gemini-2.5-pro";
  }

  const user = context.user || {};
  const role = getUserRole(user);
  const userName = getUserName(user);
  const userStore = getUserStoreId(user);
  const employees = Array.isArray(context.employees) ? context.employees : [];

  const empSummary = employees
    .slice(0, 100)
    .map((e) => `${e.Nome || e.nome} (Loja: ${e.NomeLoja || e.LojaID || ""}, Turno: ${e.Turno || ""})`)
    .join("; ");

  const currentView = context.currentView || getCurrentView();
  const screenInfo = SCREEN_KNOWLEDGE[currentView] || SCREEN_KNOWLEDGE.dashboard;

  const liveItems = getLivePresenceItems(context.livePresenceData);
  const workingItems = liveItems.filter(isPersonWorking);
  const breakItems = liveItems.filter(isPersonOnBreak);
  const absentItems = liveItems.filter((p) => String(p.status || "").toLowerCase() === "ausente");
  const totals = getLivePresenceTotals(context.livePresenceData);

  const workingSummary = workingItems
    .slice(0, 30)
    .map(
      (p) =>
        `${p.Nome || p.nome} (${p.NomeLoja || p.LojaID || "Loja"} · ${p.Cargo || "Equipe"} · Entrada: ${p.entryTime || "N/D"} · Tempo: ${p.elapsedTexto || "N/D"})`,
    )
    .join("; ");

  const breakSummary = breakItems
    .slice(0, 15)
    .map(
      (p) =>
        `${p.Nome || p.nome} (${p.NomeLoja || p.LojaID || "Loja"} · Retorno: ${p.breakReturnTime || "N/D"})`,
    )
    .join("; ");

  const pendingLeaves = (Array.isArray(context.timeOff) ? context.timeOff : []).filter(
    (f) => String(f.Status || f.status || "").toLowerCase() === "pendente",
  ).length;
  const pendingSwaps = (Array.isArray(context.swaps) ? context.swaps : []).filter((s) => {
    const st = String(s.Status || s.status || "").toLowerCase();
    return st.includes("aguardando") || st === "pendente";
  }).length;

  const systemPrompt = `PROMPT MESTRE — ASSISTENTE INTELIGENTE DE RH E FOLGAS DO GRUPO HOUSE 190

1. SUA IDENTIDADE E MISSÃO:
Você é a assistente de inteligência artificial especializada em gestão de pessoas, recursos humanos, escalas de trabalho, folgas, jornada, banco de horas e suporte operacional aos colaboradores do Grupo House 190.
Sua missão é atuar como uma assistente operacional inteligente, confiável, proativa e extremamente eficiente.
Você não é apenas um chatbot de perguntas e respostas. Utilize as ferramentas do sistema para consultar dados, preparar ações com confirmação visual, solucionar problemas e facilitar a rotina de funcionários e gestores.
Seu objetivo principal é resolver a necessidade do usuário com precisão cirúrgica. NUNCA invente informações. NUNCA afirme ter realizado uma operação sem confirmação do sistema.

2. CONHEÇA O COLABORADOR (Sessão Autenticada):
- Nome: ${userName}
- Perfil/Nível de Acesso: ${role} (employee = Funcionário, manager = Gerente, admin = Administrador)
- Unidade/Loja: ${userStore || "Todas as unidades"}
- Tela atual no sistema: ${screenInfo.title} (${currentView})
- Objetivo da tela: ${screenInfo.summary}
- Regras operacionais da tela: ${screenInfo.rules}
- Colaboradores cadastrados: ${empSummary || "Nenhum carregado"}

3. DADOS OPERACIONAIS EM TEMPO REAL:
- Em operação agora (${workingItems.length}): ${workingSummary || "Nenhum no momento"}
- Em intervalo (${breakItems.length}): ${breakSummary || "Nenhum no momento"}
- Totais de presença: Trabalhando: ${totals.trabalhando || workingItems.length}, Intervalo: ${totals.intervalo || breakItems.length}, Ausentes: ${totals.ausente || absentItems.length}, Alertas de jornada: ${totals.alertas || 0}
- Pendências gerenciais da rede: ${pendingLeaves} folgas aguardando aprovação, ${pendingSwaps} trocas aguardando aprovação.

4. POLÍTICAS INTERNAS DE FOLGAS E ESCALAS (OFICIAIS):
- Programação de 5 (cinco) folgas mensais na escala 6x1.
- Folgas habituais organizadas entre segunda-feira e quinta-feira.
- Quinta folga mensal definida e organizada pelo gerente responsável.
- Trocas de folga devem ser solicitadas pelo aplicativo e estão sujeitas à aprovação do gerente.
- Feriados trabalhados e horas extras acompanhados pelo sistema de banco de horas com crédito de folga compensatória.
- Ponto eletrônico: registro inviolável, livre e sem exigência de validação facial.
- Atestados médicos: prazo de entrega de 48h para lançamento pelo gestor com abono no banco de horas.

5. NÍVEIS DE ACESSO (RBAC RIGOROSO):
- Funcionário: consulta seus próprios registros (folgas, escalas, banco de horas) e solicita folgas ou trocas de folga. Não pode alterar turnos de colegas, criar tarefas para terceiros, cadastrar feriados ou aprovar pedidos.
- Gerente: gerencia a equipe da sua unidade, analisa cobertura, aprova/recusa folgas e trocas da sua loja.
- Administrador: acesso pleno administrativo a todas as lojas e parametrizações da rede.

6. DIRETRIZES DE COMUNICAÇÃO E EXECUÇÃO (MEGA CÉREBRO OPERACIONAL):
- ZERO EMOJIS: Regra estrita de ausência total de emojis em todas as respostas, botões e textos.
- ROTEIRO: ENTENDER -> CONSULTAR -> RESOLVER -> EXECUTAR QUANDO AUTORIZADO -> CONFIRMAR.
- CONCESSÃO OU PEDIDO DE FOLGA:
  * Se um GERENTE ou ADMINISTRADOR pedir para dar, conceder ou lançar folga para um colaborador ("Ana Claudio do Foodpark folga amanha", "da folga para Gabriel amanha", "lancar folga para Pedro sexta"), acione IMEDIATAMENTE a ferramenta 'lancarFolga' ou 'solicitarFolga' passando o colaboradorNome com o nome do colaborador encontrado, lojaNome se mencionada, a data e o motivo. NUNCA gere uma solicitação com o nome do próprio gestor quando ele estiver concedendo folga a um membro da equipe!
  * Se o próprio COLABORADOR pedir folga para si ("quero folga amanhã", "preciso de folga dia 25"), acione 'solicitarFolga' para gerar o pedido de folga pendente dele.
- AJUSTE OU ALTERAÇÃO DE PONTO: Quando o colaborador ou gestor pedir para alterar, corrigir ou disser que esqueceu de bater ponto ("esqueci de bater ponto ontem às 18h", "alterar ponto", "ajustar ponto", "esqueci a saída"), acione IMEDIATAMENTE a ferramenta 'solicitarAjustePonto' com a data, horário e tipo da batida!
- AÇÕES REAIS: Ao solicitar folga, ajustar ponto, criar tarefa, alterar turno, alterar folga fixa, cadastrar feriado, justificar ausência, aprovar/recusar solicitações ou publicar comunicado, acione SEMPRE a função correspondente para gerar o card de confirmação visual ("Ver e Confirmar").
- Multi-turn: Lembre-se do contexto das mensagens anteriores da conversa para responder adequadamente.
- Comunicação humanizada, atenciosa, precisa, em português brasileiro.`;

  const turns = [];
  const recentHistory = copilotChatHistory.slice(-10);
  for (const item of recentHistory) {
    if (item.role && item.text) {
      turns.push({
        role: item.role === "assistant" || item.role === "model" ? "model" : "user",
        parts: [{ text: item.text }],
      });
    }
  }

  if (turns.length === 0 || turns[turns.length - 1].role !== "user" || turns[turns.length - 1].parts[0].text !== prompt) {
    turns.push({
      role: "user",
      parts: [{ text: prompt }],
    });
  }

  while (turns.length > 0 && turns[0].role !== "user") {
    turns.shift();
  }

  const cleanTurns = [];
  for (const t of turns) {
    if (cleanTurns.length > 0 && cleanTurns[cleanTurns.length - 1].role === t.role) {
      cleanTurns[cleanTurns.length - 1].parts[0].text += `\n${t.parts[0].text}`;
    } else {
      cleanTurns.push(t);
    }
  }

  const requestBody = {
    contents: cleanTurns.length > 0 ? cleanTurns : [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    tools: GEMINI_TOOLS,
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      console.warn(`Gemini (${model}) retornou erro HTTP:`, res.status, "Usando fallback local.");
      return parseCopilotIntent(prompt, context);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    if (!part) {
      return parseCopilotIntent(prompt, context);
    }

    // Chamada de ferramenta pelo Gemini
    if (part.functionCall) {
      const { name, args } = part.functionCall;
      return convertFunctionCallToAction(name, args || {}, context);
    }

    // Resposta textual gerada pelo Gemini (sem emojis)
    if (part.text) {
      const cleanText = stripEmojis(part.text).trim();
      copilotChatHistory.push({ role: "model", text: cleanText });
      return {
        type: "query",
        reply: cleanText,
      };
    }

    return parseCopilotIntent(prompt, context);
  } catch (err) {
    console.warn("Falha na chamada Gemini:", err?.message || err, "Ativando motor local.");
    return parseCopilotIntent(prompt, context);
  }
}

// ==========================================================================
// MOTOR DE PARSING LOCAL DETERMINÍSTICO (FALLBACK NATIVO 0MS)
// ==========================================================================

// ==========================================================================
// MOTOR DE CONHECIMENTO OPERACIONAL PARA TODOS OS CHIPS E DÚVIDAS DO SISTEMA
// ==========================================================================

export function resolveOperationalKnowledge(text, context = {}, role = "employee", user = {}) {
  const c = String(text || "").toLowerCase().replace(/[?.,!]/g, "").trim();
  const userId = getUserId(user);
  const userStore = getUserStoreId(user);
  const holidays = Array.isArray(context.holidays) ? context.holidays : [];
  const stores = Array.isArray(context.stores) ? context.stores : [];
  const employees = Array.isArray(context.employees) ? context.employees : [];
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  const currentView = context.currentView || getCurrentView();

  // 1. Feriados
  if (/feriado/i.test(c)) {
    if (/quando|pr[oó]ximo/i.test(c)) {
      const now = new Date();
      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(now);
      const nextHol = holidays
        .filter((h) => {
          const dt = String(h.Data || h.data || "").slice(0, 10);
          return dt >= todayStr && h.Ativo !== false && h.ativo !== false;
        })
        .sort((a, b) => String(a.Data || a.data).localeCompare(String(b.Data || b.data)))[0];

      if (nextHol) {
        const parts = String(nextHol.Data || nextHol.data).slice(0, 10).split("-");
        const dtFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
        const nm = nextHol.NomeFeriado || nextHol.nomeFeriado || "Feriado";
        const tp = nextHol.Tipo || nextHol.tipo || "Nacional";
        return {
          type: "query",
          reply: `O próximo feriado cadastrado no sistema é **${nm}** em **${dtFmt}** (${tp}). Colaboradores em escala têm direito a crédito automático de folga compensatória.`,
        };
      }
      return {
        type: "query",
        reply: "Consulte o calendário oficial na aba Feriados. Ao cadastrar um feriado ativo no sistema, é conferido crédito automático de folga para todos os colaboradores em escala.",
      };
    }
    if (/cr[eé]dito/i.test(c)) {
      return {
        type: "query",
        reply: "No Folgas 3.0, ao salvar ou cadastrar um feriado ativo, é gerado crédito automático de folga para todos os colaboradores em escala 6x1. Esse crédito garante o gozo de folga compensatória conforme a CLT.",
      };
    }
    if (/regras?|clt|escala/i.test(c)) {
      return {
        type: "query",
        reply: "Conforme a CLT e a Lei nº 605/49, o trabalho realizado em dias de feriado deve ser compensado com folga compensatória na mesma semana ou pago em dobro (100%), resguardando o descanso semanal.",
      };
    }
    if (/cadastrar/i.test(c)) {
      return {
        type: "query",
        reply: "Apenas administradores podem cadastrar feriados oficiais. Para cadastrar, acesse a aba Feriados no menu lateral e clique em Novo Feriado, informando nome, data, tipo e loja correspondente.",
      };
    }
    if (/loja/i.test(c)) {
      const storeHol = holidays.filter((h) => {
        if (!userStore) return true;
        const sId = String(h.LojaID || h.lojaId || "");
        return !sId || sId === userStore || sId === "Todas";
      });
      if (storeHol.length) {
        return {
          type: "query",
          reply: `Feriados vinculados à sua unidade:\n` +
            storeHol.slice(0, 5).map((h) => {
              const d = String(h.Data || h.data || "").slice(0, 10);
              return `- **${h.NomeFeriado || h.nomeFeriado}**: ${d} (${h.Tipo || "Feriado"})`;
            }).join("\n"),
        };
      }
      return {
        type: "query",
        reply: "Feriados municipais vinculam-se exclusivamente à loja do município correspondente. Não há feriados específicos pendentes para esta unidade.",
      };
    }
    return {
      type: "query",
      reply: RH_POLICIES.feriados,
    };
  }

  // 2. Ponto, Tolerância e Frequência
  if (/toler[aâ]ncia.*(?:clt|ponto)/i.test(c) || /raio.*toler[aâ]ncia/i.test(c)) {
    if (/raio/i.test(c)) {
      return {
        type: "query",
        reply: "O raio de tolerância do ponto por GPS é padronizado em 150 metros em torno da coordenada cadastrada da loja. O sistema pré-aquece o sinal para garantir o registro ágil no início e término da jornada.",
      };
    }
    return {
      type: "query",
      reply: "Conforme o Artigo 58, § 1º da CLT, variações no registro de ponto não excedentes de 5 (cinco) minutos, observado o limite máximo diário de 10 (dez) minutos, não são descontadas nem computadas como horas extras.",
    };
  }
  if (/colaboradores sem sa[ií]da/i.test(c)) {
    const liveItems = getLivePresenceItems(context.livePresenceData);
    const withoutExit = liveItems.filter((p) => {
      const st = String(p.status || "").toLowerCase();
      return st === "trabalhando" || st === "intervalo" || p.alertaHoras;
    });
    if (withoutExit.length) {
      return {
        type: "query",
        reply: `Colaboradores atualmente em turno aberto ou sem saída registrada (${withoutExit.length}):\n` +
          withoutExit.map((p) => `- **${p.Nome || p.nome}** (${p.NomeLoja || p.LojaID || "Loja"}): entrada às ${p.entryTime || "N/D"} · tempo decorrido: ${p.elapsedTexto || "N/D"}`).join("\n"),
      };
    }
    return {
      type: "query",
      reply: "Não há colaboradores com pendência de saída detectada no momento. Todas as jornadas em andamento estão dentro do horário regular.",
    };
  }
  if (/intervalo intrajornada/i.test(c)) {
    return {
      type: "query",
      reply: "Conforme o Artigo 71 da CLT:\n- Jornadas superiores a 6 horas diárias: descanso intrajornada obrigatório de no mínimo 1 (uma) hora.\n- Jornadas de 4 a 6 horas: intervalo de 15 minutos.\n- O colaborador deve registrar o início e o término do intervalo no aplicativo.",
    };
  }
  if (/espelho de ponto/i.test(c) || /confer[eê]ncia de espelhos/i.test(c)) {
    return {
      type: "query",
      reply: "O espelho de ponto detalha todas as marcações de entrada, intervalos e saídas do mês, com cálculo da jornada líquida e apuração do banco de horas. Gestores podem conferir pela aba Ponto e colaboradores podem assinar pela aba Documentos.",
    };
  }
  if (/meu ponto hoje/i.test(c)) {
    return {
      type: "query",
      reply: "Suas marcações do dia de hoje podem ser consultadas e registradas na aba Ponto. Para registrar entrada, intervalo ou saída, clique no botão Bater Ponto.",
    };
  }
  if (/como solicitar ajuste de ponto/i.test(c)) {
    return {
      type: "query",
      reply: "Para solicitar ajuste de uma batida esquecida:\n1. Pelo Copiloto: digite por exemplo *'Esqueci de bater ponto ontem às 18:00'*\n2. Pela tela de Ponto: clique em *'Solicitar Ajuste'*, informe a data, horário e justificativa para aprovação do gestor.",
    };
  }
  if (/hor[aá]rios? dos? turnos?|meu turno cadastrado/i.test(c)) {
    return {
      type: "query",
      reply: "Os horários oficiais de turno do Grupo House 190 são:\n- **Manhã:** 07:00 às 15:20\n- **Tarde:** 15:00 às 23:20\n- **Noite:** 18:00 às 02:20\n- **Integral:** jornada operacional diária com intervalo ampliado.",
    };
  }

  // 3. Atestados & Ausências
  if (/atestado/i.test(c)) {
    if (/prazo/i.test(c)) {
      return {
        type: "query",
        reply: "O prazo legal e regulamentar para apresentação de atestado médico é de **até 48 horas** a partir do início do afastamento.",
      };
    }
    if (/enviar|entregar/i.test(c)) {
      return {
        type: "query",
        reply: "Para entregar seu atestado, apresente a foto ou via original ao gerente da sua loja em até 48 horas. O gestor fará o lançamento oficial com abono das horas correspondentes.",
      };
    }
    return {
      type: "query",
      reply: RH_POLICIES.atestados,
    };
  }
  if (/justifica/i.test(c) || /falta/i.test(c)) {
    if (/tipos/i.test(c)) {
      return {
        type: "query",
        reply: "As categorias aceitas para justificativa no sistema são:\n1. **Atestado Médico / Odontológico**\n2. **Folga Trocada** (permuta autorizada)\n3. **Dia Concedido** (dispensa institucional)\n4. **Outros Motivos Legais** (luto, casamento, etc.).",
      };
    }
    if (/desconta/i.test(c)) {
      return {
        type: "query",
        reply: "Não. Faltas abonadas por justificativa legal homologada (como atestado médico) zeram a ausência do dia e não geram débito no banco de horas.",
      };
    }
    if (/prazo/i.test(c)) {
      return {
        type: "query",
        reply: "O prazo para comunicação e justificativa de ausências é de até 48 horas após o ocorrido.",
      };
    }
    return {
      type: "query",
      reply: "Gestores e administradores podem registrar justificativas na aba Ausências, selecionando o colaborador, data da falta e a categoria legal.",
    };
  }

  // 4. Folgas e Trocas
  if (/prazo.*aprova[cç][aã]o.*folga/i.test(c)) {
    return {
      type: "query",
      reply: "As solicitações de folga devem ser avaliadas e homologadas pela gerência da loja antes da publicação da escala semanal (com antecedência mínima recomendada de 48 a 72 horas para organização dos plantões).",
    };
  }
  if (/como solicitar folga/i.test(c)) {
    return {
      type: "query",
      reply: "Para solicitar folga no Folgas 3.0:\n1. Pelo Copiloto: digite por exemplo *'Solicitar folga dia 25/10/2026 motivo consulta médica'*\n2. Pela tela de Folgas: clique em Novo Pedido de Folga e selecione a data desejada.",
    };
  }
  if (/como funciona troca de folga/i.test(c) || /regras? de troca/i.test(c)) {
    return {
      type: "query",
      reply: RH_POLICIES.trocas,
    };
  }

  // 5. Documentos e Assinatura Digital
  if (/documentos?|assinatura|holerite/i.test(c)) {
    if (/pendente/i.test(c)) {
      return {
        type: "query",
        reply: "Documentos pendentes de assinatura podem ser acessados na aba Documentos. O sistema destaca holerites e espelhos mensais aguardando confirmação eletrônica.",
      };
    }
    if (/validade|jur[ií]dica/i.test(c)) {
      return {
        type: "query",
        reply: "A assinatura digital no sistema possui plena validade jurídica amparada pela Medida Provisória nº 2.200-2/2001 e pela Lei nº 14.063/2020, contando com hash criptográfico SHA-256, carimbo de tempo e IP pericial.",
      };
    }
    if (/como funciona.*assinatura/i.test(c) || /como assinar/i.test(c)) {
      return {
        type: "query",
        reply: "Para assinar seu espelho de ponto ou holerite:\n1. Acesse a aba Documentos.\n2. Selecione o documento do mês e confira as informações.\n3. Clique em Assinar Documento e confirme com seu PIN de segurança.",
      };
    }
    if (/holerite/i.test(c)) {
      return {
        type: "query",
        reply: "Os comprovantes de pagamento e holerites ficam permanentemente disponíveis para consulta, download e assinatura na aba Documentos.",
      };
    }
    return {
      type: "query",
      reply: "A gestão documental e assinatura digital do Grupo House 190 asseguram agilidade e conformidade trabalhista para toda a equipe.",
    };
  }

  // 6. Banco de Horas
  if (/banco|saldo|horas extras|compensa[cç][aã]o|extrato de horas/i.test(c)) {
    if (/extrato/i.test(c)) {
      return {
        type: "query",
        reply: "O extrato de horas detalha débitos, créditos e compensações diárias. Você pode consultar o extrato completo na aba Banco de Horas.",
      };
    }
    if (/maior saldo|devedores/i.test(c)) {
      return {
        type: "query",
        reply: "O quadro de maiores saldos e saldos devedores da loja ou rede pode ser consultado na aba Banco de Horas (exclusivo para gestores e administradores).",
      };
    }
    if (/limite de horas extras/i.test(c)) {
      return {
        type: "query",
        reply: "Conforme o Artigo 59 da CLT, a duração diária da jornada de trabalho poderá ser acrescida de horas suplementares em número não excedente de 2 (duas) horas diárias.",
      };
    }
    if (/compensa[cç][aã]o/i.test(c)) {
      return {
        type: "query",
        reply: "As horas excedentes acumuladas no banco de horas podem ser compensadas mediante folga programada ou redução de jornada, conforme alinhamento com a gerência.",
      };
    }
    return {
      type: "query",
      reply: RH_POLICIES.banco_horas,
    };
  }

  // 7. CozinhaFlow & Gamificação
  if (/tarefa|cozinhaflow|pontua[cç][aã]o/i.test(c)) {
    if (/pontua[cç][aã]o|pontuar/i.test(c)) {
      return {
        type: "query",
        reply: "No CozinhaFlow, cada tarefa concluída pontua de acordo com a prioridade:\n- **Prioridade Alta:** 30 pontos\n- **Prioridade Média:** 20 pontos\n- **Prioridade Baixa:** 10 pontos\nOs pontos acumulados podem ser trocados no Catálogo de Prêmios da sua loja.",
      };
    }
    if (/pendente|cozinha|rede/i.test(c)) {
      const openTasks = tasks.filter((t) => t.STATUS !== "Concluída" && t.STATUS !== "concluida");
      if (openTasks.length) {
        return {
          type: "query",
          reply: `Tarefas pendentes registradas no CozinhaFlow (${openTasks.length}):\n` +
            openTasks.slice(0, 5).map((t) => `- **${t.TITULO || "Tarefa"}** (Prioridade: ${t.PRIORIDADE || "Normal"} | Status: ${t.STATUS || "A fazer"})`).join("\n"),
        };
      }
      return {
        type: "query",
        reply: "Não há tarefas pendentes registradas no CozinhaFlow no momento. Toda a rotina operacional está em dia.",
      };
    }
    if (/minhas tarefas/i.test(c)) {
      const myT = tasks.filter((t) => String(t.RESPONSAVEL_ID || "") === userId && t.STATUS !== "Concluída");
      if (myT.length) {
        return {
          type: "query",
          reply: `Suas tarefas para hoje (${myT.length}):\n` +
            myT.map((t) => `- **${t.TITULO || "Tarefa"}** (Status: ${t.STATUS || "A fazer"})`).join("\n"),
        };
      }
      return {
        type: "query",
        reply: "Você não possui tarefas pendentes atribuídas a você no CozinhaFlow para hoje.",
      };
    }
    if (/delegar|criar/i.test(c)) {
      return {
        type: "query",
        reply: "Para criar ou delegar uma tarefa, digite: *'Cria tarefa para [Nome] [Título da Tarefa] prazo hoje às 18h prioridade alta'*. O Copiloto preparará o card para sua confirmação.",
      };
    }
    if (/concluir/i.test(c)) {
      return {
        type: "query",
        reply: "Para concluir uma tarefa, abra o card correspondente no CozinhaFlow ou digite *'Concluir tarefa [Título]'*.",
      };
    }
    return {
      type: "query",
      reply: "O CozinhaFlow integra organização operacional, checklist de rotina e gamificação de equipe para as cozinhas e lojas.",
    };
  }

  // 8. Escala e Regra 6x1
  if (/escala|6x1|turno|folga fixa/i.test(c)) {
    if (/6x1/i.test(c)) {
      return {
        type: "query",
        reply: "A regra da escala 6x1 (Artigo 67 da CLT) estabelece que nenhum colaborador pode cumprir mais de 6 (seis) dias consecutivos de trabalho sem a fruição de repouso semanal remunerado, assegurando folgas periódicas aos domingos.",
      };
    }
    if (/simular/i.test(c)) {
      return {
        type: "query",
        reply: "O simulador de escala automática gera a distribuição de plantões e folgas respeitando limites de loja, regra 6x1 e folgas fixas cadastradas.",
      };
    }
    if (/alterar folga fixa|folga fixa/i.test(c)) {
      return {
        type: "query",
        reply: "Para alterar a folga fixa semanal de um colaborador, digite: *'Muda a folga fixa de [Nome] para Segunda'*. O ajuste será programado com confirmação visual.",
      };
    }
    if (/alterar turno/i.test(c)) {
      return {
        type: "query",
        reply: "Para alterar o turno de um colaborador, digite: *'Muda o turno de [Nome] para Noite'*. Gestores ajustam para sua unidade e administradores para qualquer loja da rede.",
      };
    }
    return {
      type: "query",
      reply: RH_POLICIES.escala,
    };
  }

  // 9. Takeat Consumo
  if (/takeat|consumo|limite de cr[eé]dito|desconto em folha/i.test(c)) {
    return {
      type: "query",
      reply: "O módulo Takeat gerencia o consumo a prazo de colaboradores com limite parametrizado por cargo. O valor total consumido no ciclo mensal é deduzido em folha de pagamento de forma transparente.",
    };
  }

  // 10. Presença ao Vivo
  if (/quem est[aá] trabalhando|trabalhando agora/i.test(c)) {
    const liveItems = getLivePresenceItems(context.livePresenceData);
    const working = liveItems.filter(isPersonWorking);
    if (working.length) {
      return {
        type: "query",
        reply: `Colaboradores trabalhando agora (${working.length}):\n` +
          working.slice(0, 10).map((p) => `- **${p.Nome || p.nome}** (${p.NomeLoja || p.LojaID || "Loja"} · Entrada: ${p.entryTime || "N/D"})`).join("\n"),
      };
    }
    return {
      type: "query",
      reply: "Não há colaboradores com marcação de trabalho ativa registrada no momento.",
    };
  }

  // 11. Lojas, Rede e Comunicação
  if (/loja|equipe|buscar colaborador|presen[cç]a|atrasados|regras da loja|par[aâ]metros/i.test(c)) {
    if (/atrasados/i.test(c)) {
      return {
        type: "query",
        reply: "A lista de colaboradores atrasados é monitorada em tempo real com base no início previsto da jornada e ausência de batida de ponto.",
      };
    }
    if (/presen[cç]a/i.test(c)) {
      return {
        type: "query",
        reply: "O painel de Presença ao Vivo consolida o status da equipe em tempo real (trabalhando, em intervalo, folga ou ausente).",
      };
    }
    if (/lojas cadastradas|dados da minha loja|resumo das lojas|regras da loja|par[aâ]metros/i.test(c)) {
      if (stores.length) {
        return {
          type: "query",
          reply: `Unidades cadastradas no Grupo House 190 (${stores.length}):\n` +
            stores.map((s) => `- **${s.Nome || s.nome || "Loja"}** (${s.Codigo || s.codigo || s.LojaID || "ID"}): ${s.Cidade || "Bahia"}`).join("\n"),
        };
      }
      return {
        type: "query",
        reply: "As unidades operacionais contam com parametrizações individuais de limite de folgas por dia e regras de escala.",
      };
    }
    if (/equipe|buscar/i.test(c)) {
      if (employees.length) {
        return {
          type: "query",
          reply: `Colaboradores cadastrados na equipe (${employees.length}):\n` +
            employees.slice(0, 8).map((e) => `- **${e.Nome || e.nome}** (${e.NomeLoja || e.LojaID || "Loja"} · Turno: ${e.Turno || "Padrão"})`).join("\n"),
        };
      }
      return {
        type: "query",
        reply: "A equipe pode ser consultada na aba Equipe com dados detalhados de turno, cargo e folga fixa.",
      };
    }
  }

  if (/comunicado|avisos/i.test(c)) {
    return {
      type: "query",
      reply: "Para publicar um comunicado oficial, digite: *'Publica comunicado: [Título] - [Mensagem]'*. O aviso será enviado para a equipe na aba Comunicados.",
    };
  }

  if (/fechamento/i.test(c)) {
    return {
      type: "query",
      reply: "O fechamento mensal consolida todos os espelhos de ponto, folgas e saldos de banco de horas para conferência e exportação contábil.",
    };
  }

  if (/rbac|governan[cç]a|delega[cç][oõ]es|a[cç][oõ]es do copiloto|[uú]ltimas a[cç][oõ]es|perfis de acesso/i.test(c)) {
    return {
      type: "query",
      reply: "O controle de acesso baseado em papéis (RBAC) e o log imutável de auditoria garantem que todas as ações do Copiloto sejam rastreáveis e autorizadas conforme a hierarquia da empresa.",
    };
  }

  if (/relat[oó]rio|absente[ií]smo|pontualidade|indicadores/i.test(c)) {
    return {
      type: "query",
      reply: "Os relatórios gerenciais e de auditoria consolidam índices de pontualidade, absenteísmo e volume de horas extras por loja e por período.",
    };
  }

  if (/como funciona esta tela/i.test(c)) {
    const screen = SCREEN_KNOWLEDGE[currentView] || SCREEN_KNOWLEDGE.dashboard;
    return {
      type: "query",
      reply: `**${screen.title} (${screen.category}):**\n\n${screen.summary}\n\n**Regras e Diretrizes:**\n${screen.rules}`,
    };
  }

  return null;
}

export function parseCopilotIntent(text, context = {}) {
  return sanitizeIntent(_parseCopilotIntentRaw(text, context));
}

function _parseCopilotIntentRaw(text, context = {}) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { type: "empty" };
  }

  const clean = raw.toLowerCase().replace(/\s+/g, " ");
  const user = context.user || {};
  const role = getUserRole(user);
  const userStore = getUserStoreId(user);
  const userId = getUserId(user);
  const userName = getUserName(user);

  const employees = Array.isArray(context.employees) ? context.employees : [];
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  const swaps = Array.isArray(context.swaps) ? context.swaps : [];
  const timeOff = Array.isArray(context.timeOff) ? context.timeOff : [];
  const vacations = Array.isArray(context.vacations) ? context.vacations : [];
  const holidays = Array.isArray(context.holidays) ? context.holidays : [];
  const stores = Array.isArray(context.stores) ? context.stores : [];
  const adjustments = Array.isArray(context.adjustments)
    ? context.adjustments
    : Array.isArray(context.timeClock?.adjustments)
      ? context.timeClock.adjustments
      : [];
  const incompletePunches = Array.isArray(context.incompletePunches) ? context.incompletePunches : [];
  const documents = Array.isArray(context.documents) ? context.documents : [];

  function findEmployee(query) {
    return findEmployeeInText(query, employees);
  }

  // ------------------------------------------------------------------------
  // 1. AJUDA / COMANDOS
  // ------------------------------------------------------------------------
  if (/^(ajuda|comandos|menu|o que voc[eê] faz|socorro)/i.test(clean)) {
    if (role === "admin") {
      return {
        type: "query",
        reply: `**Comandos do Copiloto House 190 (Administrador):**
- **Criar tarefa:** "Cria tarefa para [Nome] [Título] prazo hoje às 18h prioridade alta"
- **Alterar turno:** "Muda o turno de [Nome] para Noite"
- **Alterar folga fixa:** "Define folga fixa de [Nome] para Terça"
- **Aprovar troca:** "Aprova a troca do [Nome]"
- **Publicar comunicado:** "Publica comunicado: Reunião Geral - Amanhã às 15h"
- **Consultas operacionais:** "Quem está trabalhando agora?", "Quais tarefas estão pendentes?", "Saldos de horas da rede"`,
      };
    }
    if (role === "manager") {
      return {
        type: "query",
        reply: `**Comandos do Copiloto House 190 (Gerente):**
- **Criar tarefa na cozinha:** "Cria tarefa para [Nome] [Título] prazo hoje às 17h prioridade alta"
- **Alterar turno na loja:** "Muda o turno de [Nome] para Noite"
- **Definir folga semanal:** "Muda a folga fixa de [Nome] para Segunda"
- **Aprovar trocas de folga:** "Aprova a troca do [Nome]"
- **Consultas:** "Quem está trabalhando agora?", "Tarefas pendentes da loja", "Trocas de folga pendentes"`,
      };
    }
    return {
      type: "query",
      reply: `**Comandos do Copiloto House 190 (Colaborador):**
- **Minha próxima folga:** "Quando é minha próxima folga?"
- **Meu banco de horas:** "Qual é o meu saldo de horas?"
- **Solicitar folga:** "Solicitar folga dia 25/10/2026 motivo consulta médica"
- **Minhas tarefas:** "Quais são as minhas tarefas de hoje?"
- **Concluir tarefa:** "Concluir minha tarefa de higienização"`,
    };
  }

  // ------------------------------------------------------------------------
  // CONSULTAS: POLÍTICAS E REGRAS OFICIAIS DE RH (PROMPT MESTRE)
  // ------------------------------------------------------------------------
  if (
    /(?:(?:quais\s+(?:s[aã]o\s+)?as\s+|como\s+funciona[mn]?\s+(?:as\s+)?)?regras?\s+de\s+folgas?|quantas\s+folgas(?:\s+eu\s+tenho|\s+por\s+m[eê]s|\s+no\s+m[eê]s)?|quinta\s+folga|pol[ií]tica\s+(?:de\s+)?folgas?)/i.test(
      clean,
    )
  ) {
    return {
      type: "query",
      reply: RH_POLICIES.folgas,
    };
  }

  if (
    /(?:(?:como\s+funciona[mn]?\s+(?:[ao]s?\s+)?)?trocas?\s+de\s+folgas?|pol[ií]tica\s+(?:de\s+)?trocas?|posso\s+trocar\s+minha\s+folga|regras?\s+(?:de\s+)?trocas?)/i.test(
      clean,
    ) &&
    !clean.includes("pendente") &&
    !clean.includes("loja") &&
    !clean.includes("aprovar")
  ) {
    return {
      type: "query",
      reply: RH_POLICIES.trocas,
    };
  }

  if (
    /(?:como\s+(?:entregar|enviar|lan[cç]ar)\s+atestado|procedimento\s+(?:para\s+)?atestados?|pol[ií]tica\s+(?:de\s+)?atestados?|faltei\s+(?:por\s+)?doen[cç]a)/i.test(
      clean,
    )
  ) {
    return {
      type: "query",
      reply: RH_POLICIES.atestados,
    };
  }

  // ------------------------------------------------------------------------
  // AÇÃO DIRETA: APROVAR OU RECUSAR FOLGA
  // ------------------------------------------------------------------------
  const approveLeaveMatch = clean.match(
    /(?:(aprova(?:r)?|aceita(?:r)?|homologa(?:r)?|recusa(?:r)?|rejeita(?:r)?))\s+(?:a\s+)?(?:folga|pedido\s+de\s+folga|solicita[cç][aã]o\s+de\s+folga)?\s*(?:de|do|da)?\s+([a-zA-ZÀ-ÿ\s]+)/i,
  );
  if (
    approveLeaveMatch &&
    !clean.includes("troca") &&
    !clean.includes("ponto") &&
    !clean.includes("turno") &&
    !clean.includes("fixa")
  ) {
    if (role === "employee") {
      return {
        type: "error",
        message: "A aprovação ou recusa de solicitações de folga é exclusiva de Gerentes e Administradores.",
      };
    }

    const isApproval = /^(aprova|aceita|homologa)/i.test(approveLeaveMatch[1]);
    const targetQuery = approveLeaveMatch[2].trim();
    const targetEmp = findEmployee(targetQuery);
    const targetName = targetEmp ? (targetEmp.Nome || targetEmp.nome) : targetQuery;
    const targetId = targetEmp ? (targetEmp.FuncionarioID || targetEmp.id) : "";

    const allLeaves = [...timeOff, ...vacations];
    const pendingLeave = allLeaves.find((f) => {
      const st = String(f.Status || f.status || "").toLowerCase();
      if (st !== "pendente" && !st.includes("aguardando")) return false;
      if (role === "manager" && userStore) {
        const fStore = String(f.LojaID || f.lojaId || "");
        if (fStore && fStore !== userStore) return false;
      }
      if (targetId && String(f.FuncionarioID || f.funcionarioId) === String(targetId)) return true;
      const fName = String(f.NomeFuncionario || f.nome || "").toLowerCase();
      return fName.includes(targetQuery.toLowerCase());
    });

    if (!pendingLeave) {
      return {
        type: "error",
        message: `Nenhuma solicitação de folga pendente foi localizada para "${targetName}".`,
      };
    }

    const leaveId = pendingLeave.ID || pendingLeave.id || pendingLeave.FolgaID;
    const actionLabel = isApproval ? "Aprovar Solicitação de Folga" : "Recusar Solicitação de Folga";
    const dataFolga = String(pendingLeave.DataInicio || pendingLeave.Data || pendingLeave.dataInicio || "").slice(0, 10);
    const motivoDecisao = isApproval ? "Aprovado via Copiloto" : "Recusado via Copiloto";

    return {
      type: "action",
      actionType: isApproval ? "approve_leave" : "reject_leave",
      title: actionLabel,
      apiMethod: isApproval ? "approveTimeOff" : "rejectTimeOff",
      apiArgs: [leaveId, motivoDecisao],
      summary: `${isApproval ? "Aprovar" : "Recusar"} solicitação de folga de ${pendingLeave.NomeFuncionario || targetName} para o dia ${dataFolga}.`,
      diff: [
        { label: "Colaborador", value: pendingLeave.NomeFuncionario || targetName },
        { label: "Data da Folga", value: dataFolga },
        { label: "Decisão", value: isApproval ? "Aprovada" : "Recusada" },
        { label: "Observação", value: motivoDecisao },
      ],
      details: { folgaId: leaveId, timeOffId: leaveId, decision: isApproval ? "Aprovada" : "Recusada" },
    };
  }

  // ------------------------------------------------------------------------
  // AÇÃO DIRETA: APROVAR AJUSTE DE PONTO
  // ------------------------------------------------------------------------
  const approveClockMatch = clean.match(
    /(?:(aprova(?:r)?|aceita(?:r)?|homologa(?:r)?))\s+(?:o\s+)?(?:ajuste\s+de\s+ponto|ajuste|ponto)\s+(?:de|do|da)?\s+([a-zA-ZÀ-ÿ\s]+)/i,
  );
  if (approveClockMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "A homologação de ajustes de ponto é restrita a Gerentes e Administradores.",
      };
    }
    const targetQuery = approveClockMatch[2].trim();
    const targetEmp = findEmployee(targetQuery);
    const targetName = targetEmp ? (targetEmp.Nome || targetEmp.nome) : targetQuery;
    const targetId = targetEmp ? (targetEmp.FuncionarioID || targetEmp.id) : "";

    const pendingAdj = adjustments.find((a) => {
      const st = String(a.Status || a.status || "").toLowerCase();
      if (st !== "pendente" && !st.includes("aguardando")) return false;
      if (role === "manager" && userStore) {
        const aStore = String(a.LojaID || a.lojaId || "");
        if (aStore && aStore !== userStore) return false;
      }
      if (targetId && String(a.FuncionarioID || a.funcionarioId) === String(targetId)) return true;
      const aName = String(a.NomeFuncionario || a.nome || "").toLowerCase();
      return aName.includes(targetQuery.toLowerCase());
    });

    if (!pendingAdj) {
      return {
        type: "error",
        message: `Nenhum pedido de ajuste de ponto pendente foi localizado para "${targetName}".`,
      };
    }

    const adjId = pendingAdj.ID || pendingAdj.id || pendingAdj.AjustePontoID;
    const adjDate = String(pendingAdj.Data || pendingAdj.DataHoraSolicitada || "").slice(0, 10);
    const adjTime = pendingAdj.HoraSolicitada || pendingAdj.Hora || "";

    return {
      type: "action",
      actionType: "approve_clock_adjustment",
      title: "Homologar Ajuste de Ponto",
      apiMethod: "decideTimeClockAdjustment",
      apiArgs: [{ ajustePontoId: adjId, decision: "aprovar", observacao: "Homologado via Copiloto" }],
      summary: `Homologar ajuste de ponto de ${pendingAdj.NomeFuncionario || targetName} no dia ${adjDate}${adjTime ? ` às ${adjTime}` : ""}.`,
      diff: [
        { label: "Colaborador", value: pendingAdj.NomeFuncionario || targetName },
        { label: "Data", value: adjDate },
        { label: "Horário Homologado", value: adjTime || "Horário solicitado" },
        { label: "Decisão", value: "Aprovado" },
      ],
      details: { ajustePontoId: adjId, adjustmentId: adjId, decision: "aprovar" },
    };
  }

  // ------------------------------------------------------------------------
  // PENDÊNCIAS: AJUSTES DE PONTO PENDENTES
  // ------------------------------------------------------------------------
  if (
    /(?:ajustes?\s+de\s+ponto\s+(?:pendentes?|da\s+loja|em\s+aberto|aguardando)|pend[eê]ncias?\s+de\s+ponto|pontos?\s+(?:pendentes?|incompletos?)|ajustes?\s+de\s+ponto\b(?!.*(?:ontem|hoje|\d{1,2}[\/\:]\d{1,2}|esqueci)))/i.test(
      clean,
    )
  ) {
    if (role === "employee") {
      const myAdj = adjustments.filter((a) => {
        const aId = String(a.FuncionarioID || a.funcionarioId || "").trim();
        const st = String(a.Status || a.status || "").toLowerCase();
        return aId === userId && (st === "pendente" || st.includes("aguardando"));
      });
      if (!myAdj.length) {
        return {
          type: "query",
          reply: "Você não possui solicitações de ajuste de ponto pendentes no momento. Suas marcações de ponto estão regularizadas.",
        };
      }
      return {
        type: "query",
        reply:
          `Você possui **${myAdj.length} solicitação(ões) de ajuste de ponto** aguardando retorno da liderança:\n` +
          myAdj
            .map(
              (a) =>
                `- **Data:** ${String(a.Data || a.DataHoraSolicitada || "").slice(0, 10)} | **Horário:** ${a.HoraSolicitada || a.Hora || (a.DataHoraSolicitada ? String(a.DataHoraSolicitada).slice(11, 16) : "")} — Motivo: ${a.Motivo || a.motivo || "Ajuste de ponto"}`,
            )
            .join("\n"),
      };
    }

    let pendingAdj = adjustments.filter((a) => {
      const st = String(a.Status || a.status || "").toLowerCase();
      return st === "pendente" || st.includes("aguardando");
    });
    if (role === "manager" && userStore) {
      pendingAdj = pendingAdj.filter((a) => String(a.LojaID || a.lojaId || "") === userStore);
    }

    if (!pendingAdj.length) {
      return {
        type: "query",
        reply: "Não há nenhum ajuste de ponto pendente no momento. Todas as batidas e solicitações de ajuste da equipe estão regularizadas.",
      };
    }

    return {
      type: "query",
      reply:
        `Há **${pendingAdj.length} ajuste(s) de ponto pendente(s)** aguardando sua validação:\n` +
        pendingAdj
          .map((a) => {
            const empName = a.NomeFuncionario || a.nome || a.FuncionarioID;
            const storeLabel =
              a.NomeLoja ||
              stores.find((s) => String(s.LojaID || s.id) === String(a.LojaID))?.Nome ||
              "";
            const storeTxt = storeLabel ? ` (${storeLabel})` : "";
            const dt = String(a.Data || a.DataHoraSolicitada || "").slice(0, 10);
            const hr =
              a.HoraSolicitada ||
              a.Hora ||
              (a.DataHoraSolicitada ? String(a.DataHoraSolicitada).slice(11, 16) : "");
            return `- **${empName}**${storeTxt}: ${dt}${hr ? ` às ${hr}` : ""} — Motivo: "${a.Motivo || a.motivo || "Esquecimento de registro"}"`;
          })
          .join("\n") +
        `\n\nPara homologar, você pode digitar: *"Aprovar ajuste de ponto de [Nome]"*.`,
    };
  }

  // ------------------------------------------------------------------------
  // PENDÊNCIAS: SOLICITAÇÕES DE FOLGA ABERTAS / PENDENTES
  // ------------------------------------------------------------------------
  if (
    !clean.includes("troca") &&
    /(?:solicita[cç][oõ]es\s+de\s+folgas?\s+(?:abertas?|pendentes?|da\s+loja)|pedidos\s+de\s+folgas?\s+(?:abertos?|pendentes?)|folgas?\s+(?:pendentes?|em\s+aberto)|pedidos\s+de\s+folga\b|solicita[cç][oõ]es\s+pendentes\s+da\s+equipe|o\s+que\s+a\s+equipe\s+pediu|minhas\s+solicita[cç][oõ]es\s+pendentes)/i.test(
      clean,
    )
  ) {
    if (role === "employee" || clean.includes("minhas solicita")) {
      const myPending = [...timeOff, ...vacations].filter((f) => {
        const fId = String(f.FuncionarioID || f.funcionarioId || "").trim();
        const st = String(f.Status || f.status || "").toLowerCase();
        return fId === userId && (st === "pendente" || st.includes("aguardando"));
      });
      if (!myPending.length) {
        return {
          type: "query",
          reply: "Você não possui solicitações de folga em aberto no momento.",
        };
      }
      return {
        type: "query",
        reply:
          `Você possui **${myPending.length} solicitação(ões) de folga em aberto** aguardando resposta da gerência:\n` +
          myPending
            .map((f) => {
              const d = String(f.DataInicio || f.Data || f.dataInicio || "").slice(0, 10);
              return `- **Data:** ${d} | **Tipo/Motivo:** ${f.TipoFolga || f.Motivo || "Folga regular"}`;
            })
            .join("\n"),
      };
    }

    let pendingLeaves = [...timeOff, ...vacations].filter((f) => {
      const st = String(f.Status || f.status || "").toLowerCase();
      return st === "pendente" || st.includes("aguardando");
    });
    if (role === "manager" && userStore) {
      pendingLeaves = pendingLeaves.filter((f) => String(f.LojaID || f.lojaId || "") === userStore);
    }
    if (!pendingLeaves.length) {
      return {
        type: "query",
        reply: "Não há nenhuma solicitação de folga pendente de aprovação no momento. As escalas de folgas estão todas em dia.",
      };
    }
    return {
      type: "query",
      reply:
        `Há **${pendingLeaves.length} solicitação(ões) de folga aberta(s)** aguardando sua decisão:\n` +
        pendingLeaves
          .map((f) => {
            const empName = f.NomeFuncionario || f.nome || f.FuncionarioID;
            const storeLabel =
              f.NomeLoja ||
              stores.find((s) => String(s.LojaID || s.id) === String(f.LojaID))?.Nome ||
              "";
            const storeTxt = storeLabel ? ` (${storeLabel})` : "";
            const d = String(f.DataInicio || f.Data || f.dataInicio || "").slice(0, 10);
            const motive = f.Motivo || f.TipoFolga || "Folga solicitada";
            return `- **${empName}**${storeTxt}: folga para o dia **${d}** (${motive})`;
          })
          .join("\n") +
        `\n\nPara homologar, você pode digitar: *"Aprovar folga de [Nome]"* ou *"Recusar folga de [Nome]"*.`,
    };
  }

  // ------------------------------------------------------------------------
  // PENDÊNCIAS: TROCAS DE FOLGA PENDENTES
  // ------------------------------------------------------------------------
  if (
    /(?:trocas?\s+(?:de\s+folgas?\s+)?(?:pendentes?|da\s+minha\s+loja|da\s+loja|em\s+aberto)|aprovar\s+trocas\s+pendentes)/i.test(
      clean,
    )
  ) {
    if (role === "employee") {
      const mySwaps = swaps.filter((s) => {
        const isMine =
          String(s.FuncionarioOrigemID || "") === userId ||
          String(s.FuncionarioDestinoID || "") === userId;
        const st = String(s.Status || s.status || "").toLowerCase();
        return isMine && (st.includes("aguardando") || st === "pendente");
      });
      if (!mySwaps.length) {
        return {
          type: "query",
          reply: "Você não possui nenhuma troca de folga pendente de aprovação no momento.",
        };
      }
      return {
        type: "query",
        reply:
          `Você possui **${mySwaps.length} troca(s) de folga pendente(s)**:\n` +
          mySwaps
            .map(
              (s) =>
                `- ${s.NomeFuncionarioOrigem || "Colaborador"} (${s.DataFolgaOrigem}) por ${s.NomeFuncionarioDestino || "Colaborador"} (${s.DataFolgaDestino}) — Status: ${s.Status || "Aguardando gestor"}`,
            )
            .join("\n"),
      };
    }

    let pendingSwaps = swaps.filter((s) => {
      const st = String(s.Status || s.status || "").toLowerCase();
      return st.includes("aguardando") || st === "pendente";
    });
    if (role === "manager" && userStore) {
      pendingSwaps = pendingSwaps.filter((s) => String(s.LojaID || s.lojaId || "") === userStore);
    }
    if (!pendingSwaps.length) {
      return {
        type: "query",
        reply: "Não há nenhuma solicitação de troca de folga pendente no momento.",
      };
    }
    return {
      type: "query",
      reply:
        `Há **${pendingSwaps.length} troca(s) de folga aguardando aprovação gerencial**:\n` +
        pendingSwaps
          .map(
            (s) =>
              `- **${s.NomeFuncionarioOrigem || "Origem"}** (${s.DataFolgaOrigem}) por **${s.NomeFuncionarioDestino || "Destino"}** (${s.DataFolgaDestino}) — Loja: ${s.NomeLoja || s.LojaID || "Unidade"}`,
          )
          .join("\n") +
        `\n\nPara homologar, você pode digitar: *"Aprovar troca do [Nome]"*.`,
    };
  }

  // ------------------------------------------------------------------------
  // PENDÊNCIAS: CENTRAL / RESUMO GERAL DE PENDÊNCIAS
  // ------------------------------------------------------------------------
  if (
    /(?:central\s+de\s+pend[eê]ncias|resumo\s+de\s+pend[eê]ncias|o\s+que\s+tem\s+pendente|quais\s+(?:s[aã]o\s+as\s+)?pend[eê]ncias|autoriza[cç][oõ]es\s+pendentes|\bpend[eê]ncias\b)/i.test(
      clean,
    )
  ) {
    if (role === "employee") {
      const myLeaves = [...timeOff, ...vacations].filter((f) => {
        const fId = String(f.FuncionarioID || f.funcionarioId || "").trim();
        const st = String(f.Status || f.status || "").toLowerCase();
        return fId === userId && (st === "pendente" || st.includes("aguardando"));
      });
      const myAdj = adjustments.filter((a) => {
        const aId = String(a.FuncionarioID || a.funcionarioId || "").trim();
        const st = String(a.Status || a.status || "").toLowerCase();
        return aId === userId && (st === "pendente" || st.includes("aguardando"));
      });
      const mySwaps = swaps.filter((s) => {
        const isMine =
          String(s.FuncionarioOrigemID || "") === userId ||
          String(s.FuncionarioDestinoID || "") === userId;
        const st = String(s.Status || s.status || "").toLowerCase();
        return isMine && (st.includes("aguardando") || st === "pendente");
      });
      const total = myLeaves.length + myAdj.length + mySwaps.length;
      if (total === 0) {
        return {
          type: "query",
          reply: "Você não possui nenhuma solicitação pendente no momento. Tudo está em dia.",
        };
      }
      return {
        type: "query",
        reply:
          `**Suas Solicitações Pendentes (Total: ${total}):**\n\n` +
          `- **Folgas Solicitadas:** ${myLeaves.length}\n` +
          `- **Ajustes de Ponto:** ${myAdj.length}\n` +
          `- **Trocas de Folga:** ${mySwaps.length}\n\n` +
          `Acompanhe a decisão da sua gerência pela Central de Pendências ou pelo Copiloto.`,
      };
    }

    const actor = { userId, role, storeId: userStore };
    const p = hrAdapter.getTeamPendingRequests(actor, context);
    if (p.totalPendencias === 0) {
      return {
        type: "query",
        reply: "Não há nenhuma pendência operacional aguardando sua validação no momento. Todos os pedidos estão em dia.",
      };
    }
    const leavesText =
      p.folgasPendentes.length > 0
        ? `\n- **Folgas Solicitadas (${p.folgasPendentes.length}):**\n` +
          p.folgasPendentes.map((f) => `  * ${f.colaborador}: ${f.data} (${f.motivo})`).join("\n")
        : "\n- **Folgas Solicitadas:** Nenhuma";
    const adjText =
      p.ajustesPendentes.length > 0
        ? `\n- **Ajustes de Ponto (${p.ajustesPendentes.length}):**\n` +
          p.ajustesPendentes
            .map((a) => `  * ${a.colaborador}: ${a.data}${a.horario ? ` às ${a.horario}` : ""} (${a.motivo})`)
            .join("\n")
        : "\n- **Ajustes de Ponto:** Nenhum";
    const swapsText =
      p.trocasPendentes.length > 0
        ? `\n- **Trocas de Folga (${p.trocasPendentes.length}):**\n` +
          p.trocasPendentes.map((s) => `  * ${s.origem} por ${s.destino}`).join("\n")
        : "\n- **Trocas de Folga:** Nenhuma";

    return {
      type: "query",
      reply:
        `**Central de Pendências (${p.totalPendencias} itens aguardando decisão):**${leavesText}${adjText}${swapsText}\n\n` +
        `Para decidir, você pode digitar por exemplo: *"Aprovar folga de [Nome]"*, *"Recusar folga de [Nome]"* ou *"Aprovar troca de [Nome]"*.`,
    };
  }



  // ------------------------------------------------------------------------
  // 2. CONSULTAS: PRÓXIMA FOLGA
  // ------------------------------------------------------------------------
  if (/(?:quando [eé] (?:a )?minha (?:pr[oó]xima )?folga|minha folga|pr[oó]xima folga)/i.test(clean)) {
    const myLeaves = timeOff.filter((f) => {
      const fId = String(f.FuncionarioID || f.funcionarioId || "").trim();
      const status = String(f.Status || f.status || "").toLowerCase();
      return fId === userId && status === "aprovada";
    });

    const now = new Date();
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(now);

    const upcoming = myLeaves
      .filter((f) => {
        const d = String(f.DataInicio || f.dataInicio || "").slice(0, 10);
        return d >= todayStr;
      })
      .sort((a, b) => String(a.DataInicio).localeCompare(String(b.DataInicio)))[0];

    if (upcoming) {
      const dateParts = String(upcoming.DataInicio).slice(0, 10).split("-");
      const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
      return {
        type: "query",
        reply: `Sua próxima folga aprovada está programada para **${formattedDate}** (${upcoming.TipoFolga || "Folga regular"}).`,
      };
    }

    const fixedDay = user.FolgaFixaSemanal || user.folgaFixa || "";
    if (fixedDay) {
      return {
        type: "query",
        reply: `Você não possui folgas pontuais aprovadas registradas para os próximos dias. Sua escala possui folga fixa semanal nas **${fixedDay}s**.`,
      };
    }

    return {
      type: "query",
      reply: "Não foram encontradas folgas futuras cadastradas para o seu usuário. Consulte a sua gerência se desejar agendar.",
    };
  }

  // ------------------------------------------------------------------------
  // 3. CONSULTAS: BANCO DE HORAS
  // ------------------------------------------------------------------------
  if (/(?:meu saldo de horas|meu banco de horas|saldo de horas|quantas horas tenho|meu saldo)/i.test(clean)) {
    const bal = context.hourBalance || context.timeClockBalance;
    if (bal && bal.totalMinutos !== undefined) {
      const mins = Number(bal.totalMinutos) || 0;
      const signal = mins >= 0 ? "+" : "-";
      const totalIntMins = Math.round(Math.abs(mins));
      const h = Math.floor(totalIntMins / 60);
      const m = totalIntMins % 60;
      const formatted = `${signal}${h}h ${String(m).padStart(2, "0")}m`;
      const statusDesc = mins >= 0 ? "saldo positivo (crédito)" : "saldo negativo (débito)";
      return {
        type: "query",
        reply: `Seu saldo acumulado no banco de horas é de **${formatted}** (${statusDesc}).`,
      };
    }
    return {
      type: "query",
      reply: "Seu saldo de horas está em dia e sincronizado com os registros de ponto do sistema.",
    };
  }

  // ------------------------------------------------------------------------
  // CONSULTAS: TELA ATUAL E REGRAS OPERACIONAIS
  // ------------------------------------------------------------------------
  if (/(?:como funciona esta tela|o que faz esta tela|ajuda nesta tela|o que posso fazer aqui|ajuda desta tela|regras desta tela)/i.test(clean)) {
    const viewKey = context.currentView || getCurrentView();
    const info = SCREEN_KNOWLEDGE[viewKey] || SCREEN_KNOWLEDGE.dashboard;
    const chipsList = (info.chips[role] || info.chips.employee || []).map((c) => `- "${c}"`).join("\n");
    return {
      type: "query",
      reply: `**Tela: ${info.title} (${info.category})**\n\n${info.summary}\n\n**Regras operacionais:**\n${info.rules}\n\n**Comandos sugeridos para esta tela:**\n${chipsList}`,
    };
  }

  if (/(?:como\s+(?:posso\s+)?solicitar\s+folga|regras?\s+(?:para\s+)?solicitar\s+folga|como\s+funciona\s+(?:o\s+pedido\s+de\s+|a\s+)?folga)/i.test(clean)) {
    return {
      type: "query",
      reply: `**Como solicitar folga no Folgas 3.0:**\n\n1. **Pelo Copiloto:** Você pode pedir diretamente digitando:\n   *"Solicitar folga dia DD/MM/AAAA motivo [seu motivo]"*\n\n2. **Pela Central:** Acesse a aba **Folgas** ou **Central de Pendências** e clique em **＋ Pedir folga**.\n\n3. **Regras operacionais:**\n   - As solicitações devem ser enviadas com antecedência para organização da escala da sua loja.\n   - O gestor da sua unidade receberá a notificação para aprovação.\n   - Escala 6x1: é garantido descanso semanal remunerado a cada ciclo de 6 dias de trabalho contínuos.`,
    };
  }

  if (/(?:como funciona (?:cr[eé]dito|folga extra) de feriado|tenho direito a folga por feriado|regras? de feriado)/i.test(clean)) {
    return {
      type: "query",
      reply: `**Regras de Feriados e Folga Compensatória (House 190):**\n\n- **Crédito Automático:** Ao cadastrar um feriado ativo no sistema, os colaboradores em escala recebem crédito automático de folga extra compensatória.\n- **CLT e Convenção Coletiva:** Trabalho em feriados não compensados acarreta pagamento em dobro (100%) ou concessão de folga compensatória no banco de horas.\n- **Feriados Municipais:** Aplicam-se especificamente aos colaboradores da loja sediada no município do feriado.\n- **Administração:** Apenas administradores podem cadastrar feriados oficiais na aba **Feriados**.`,
    };
  }

  if (/(?:toler[aâ]ncia de ponto|regras? de ponto|intervalo intrajornada)/i.test(clean)) {
    return {
      type: "query",
      reply: `**Regras de Ponto Eletrônico (CLT e Grupo House 190):**\n\n- **Tolerância Legal (CLT Art. 58 § 1º):** Variações de até 5 minutos em cada marcação, observado o limite máximo de 10 minutos diários, não serão descontadas nem computadas como jornada extraordinária.\n- **Intervalo Intrajornada:** Mínimo de 1 hora para jornadas superiores a 6 horas diárias. Jornadas de 4 a 6 horas exigem intervalo de 15 minutos.\n- **Flexibilidade e Segurança:** A batida de ponto é permitida dentro do raio geográfico da sua loja. O registro não é impedido caso o reconhecimento facial não identifique o rosto.\n- **Ajustes:** Marcações esquecidas devem ser justificadas na Central de Pendências ou solicitadas ao gestor.`,
    };
  }

  // ------------------------------------------------------------------------
  // CONSULTAS: QUAL IA / MODELO EM OPERAÇÃO
  // ------------------------------------------------------------------------
  if (
    /(?:qual\s+(?:ia|intelig[eê]ncia|modelo)(?:\s+vai\s+rodar|\s+[eé] essa|\s+est[aá]\s+rodando|\s+est[aá]\s+ativa)?|qual\s+o?\s*melhor\s+modelo|como\s+ativar\s+(?:o\s+)?gemini|como\s+usar\s+(?:o\s+)?gemini(?:\s+4\s+argon)?)/i.test(
      clean,
    )
  ) {
    const hasKey = Boolean(getGeminiApiKey());
    let model = getGeminiModel();
  if (model === "gemini-4-argon") {
    model = "gemini-2.5-pro";
  }
    const modelName = model === "gemini-4-argon" ? "Google Gemini 4 Argon" : "Google Gemini 2.0 Flash";
    const currentEngine = hasKey
      ? `${modelName} (Ativo via chave API)`
      : "Motor Local Autônomo (Ativo nativamente)";
    return {
      type: "query",
      reply:
        `**Inteligência do Copiloto House 190:**\n\n` +
        `- **Status atual:** ${currentEngine}\n` +
        `- **Modelos Suportados:** **Google Gemini 2.0 Flash** (recomendado para respostas instantâneas) e **Gemini 4 Argon** (raciocínio avançado e planejamento profundo).\n` +
        `- **Motor de Contingência:** Parser local determinístico com latência zero (0ms), operando mesmo offline ou sem chave.\n` +
        `- **Como alternar/configurar:** Clique no ícone de engrenagem no cabeçalho deste painel para alternar entre Flash e Argon ou inserir sua chave do Google AI Studio. Quando configurada, o modelo selecionado assume o controle em linguagem natural para todas as telas do sistema.`,
    };
  }

  // ------------------------------------------------------------------------
  // CONSULTAS: RESUMO OPERACIONAL E PRIORIDADES DE DECISÃO
  // ------------------------------------------------------------------------
  if (
    /(?:resumo\s+(?:d[eao]s?\s+)?(?:painel|opera[cç][aã]o|geral|lojas?|rede|hoje)|como\s+(?:est[aá]|t[aá])\s+a\s+opera[cç][aã]o|o\s+que\s+precisa\s+(?:de|da\s+minha)\s+decis[aã]o|pend[eê]ncias\s+(?:de\s+hoje|gerais|ativas)|status\s+da\s+opera[cç][aã]o|vis[aã]o\s+geral\s+de\s+hoje)/i.test(
      clean,
    )
  ) {
    if (role === "employee") {
      return {
        type: "query",
        reply: "Para acompanhar o status geral da operação da sua unidade, consulte o gestor de loja.",
      };
    }

    const liveItems = getLivePresenceItems(context.livePresenceData);
    const totals = getLivePresenceTotals(context.livePresenceData);
    const working = totals.trabalhando || liveItems.filter(isPersonWorking).length;
    const onBreak = totals.intervalo || liveItems.filter(isPersonOnBreak).length;
    const alerts = totals.alertas || liveItems.filter((p) => p.alertLevel && p.alertLevel !== "normal").length;
    const absent = totals.ausente || liveItems.filter((p) => String(p.status || "").toLowerCase() === "ausente").length;

    const pendingTimeOff = timeOff.filter(
      (f) => String(f.Status || f.status || "").toLowerCase() === "pendente",
    ).length;
    const pendingSwaps = swaps.filter((s) => {
      const st = String(s.Status || s.status || "").toLowerCase();
      return st.includes("aguardando") || st === "pendente";
    }).length;
    const pendingTasks = tasks.filter((t) => {
      const s = String(t.STATUS || t.Status || "");
      return s !== "Concluída" && s !== "Cancelada";
    }).length;

    const reply =
      `**Resumo Operacional da Rede:**\n\n` +
      `- **Em operação agora:** ${working} colaboradores\n` +
      `- **Em intervalo intrajornada:** ${onBreak} colaboradores\n` +
      `- **Ausentes previstos hoje:** ${absent} colaboradores\n` +
      `- **Alertas de jornada:** ${alerts} (turnos longos ou horas extras)\n\n` +
      `**Prioridades que aguardam decisão gerencial:**\n` +
      `- **Solicitações de folga pendentes:** ${pendingTimeOff}\n` +
      `- **Trocas de folga aguardando aprovação:** ${pendingSwaps}\n` +
      `- **Tarefas ativas no CozinhaFlow:** ${pendingTasks}\n\n` +
      `Você pode pedir detalhes digitando *"quem está trabalhando agora"*, *"tarefas pendentes"* ou *"ajuda nesta tela"*.`;

    return {
      type: "query",
      reply,
    };
  }

  // ------------------------------------------------------------------------
  // 4. CONSULTAS: EQUIPE AGORA / QUEM ESTÁ TRABALHANDO
  // ------------------------------------------------------------------------
  if (
    /(?:quem\s+(?:est[aá]|t[aá])\s+(?:a[ií]\s+)?(?:trabalhando|de\s+servi[cç]o|de\s+plant[aã]o|na\s+(?:loja|house|opera[cç][aã]o|central|unidade))|quem\s+(?:t[aá]|est[aá])\s+na\s+\w+|equipe\s+(?:agora|hoje)|quem\s+veio\s+hoje|quem\s+bateu\s+ponto|escala\s+(?:de\s+)?hoje|presen[cç]a\s+(?:hoje|agora)|quant[ao]s\s+(?:est[aãá]o|t[aã]o)\s+trabalhando)/i.test(
      clean,
    )
  ) {
    if (role === "employee") {
      return {
        type: "query",
        reply:
          "Para visualizar o painel completo de presença da equipe, solicite a um responsável de loja ou consulte a escala afixada.",
      };
    }

    const liveData = getLivePresenceItems(context.livePresenceData);
    const presentAll = liveData.filter(isPersonWorking);
    const onBreakAll = liveData.filter(isPersonOnBreak);

    // Identificar se a pergunta menciona alguma unidade específica
    let storeQuery = "";
    if (/(?:food\s*park)/i.test(clean)) {
      storeQuery = "food park";
    } else if (/(?:190|teixeira)/i.test(clean)) {
      storeQuery = "teixeira";
    } else if (/(?:central|matriz)/i.test(clean)) {
      storeQuery = "central";
    }

    let present = presentAll;
    let onBreak = onBreakAll;

    if (storeQuery) {
      present = presentAll.filter((p) => {
        const storeName = String(p.NomeLoja || p.nomeLoja || "").toLowerCase();
        const storeId = String(p.LojaID || p.lojaId || "").toLowerCase();
        return storeName.includes(storeQuery) || storeId.includes(storeQuery);
      });
      onBreak = onBreakAll.filter((p) => {
        const storeName = String(p.NomeLoja || p.nomeLoja || "").toLowerCase();
        const storeId = String(p.LojaID || p.lojaId || "").toLowerCase();
        return storeName.includes(storeQuery) || storeId.includes(storeQuery);
      });
    } else if (role !== "admin" && userStore) {
      present = presentAll.filter((p) => String(p.LojaID || p.lojaId || "") === userStore);
      onBreak = onBreakAll.filter((p) => String(p.LojaID || p.lojaId || "") === userStore);
    }

    if (present.length === 0 && onBreak.length === 0) {
      if (presentAll.length > 0 && storeQuery) {
        return {
          type: "query",
          reply: `No momento não há registros de colaboradores com turno aberto na unidade pesquisada. Há um total de **${presentAll.length}** colaboradores em atividade em outras lojas da rede.`,
        };
      }
      return {
        type: "query",
        reply: "No momento não há registros de colaboradores com turno aberto na loja selecionada.",
      };
    }

    const formatEmp = (p) => {
      const name = p.Nome || p.nome || "Colaborador";
      const cargo = p.Cargo || p.cargo || p.Turno || p.turno || "";
      const entry = p.entryTime || p.lastPunchTime || "";
      const elapsed = p.elapsedTexto || "";
      const parts = [];
      if (cargo) parts.push(cargo);
      if (entry) parts.push(`Entrada: ${entry}`);
      if (elapsed) parts.push(`${elapsed} em turno`);
      const extra = parts.length > 0 ? ` (${parts.join(" · ")})` : "";
      return `- **${name}**${extra}`;
    };

    let body = "";
    if (role === "admin" && !storeQuery) {
      const byStore = new Map();
      present.forEach((p) => {
        const sName = p.NomeLoja || p.nomeLoja || (p.LojaID ? `Loja ${p.LojaID}` : "Rede House 190");
        const list = byStore.get(sName) || [];
        list.push(p);
        byStore.set(sName, list);
      });

      const storeBlocks = [];
      for (const [sName, emps] of byStore.entries()) {
        storeBlocks.push(`**${sName} (${emps.length}):**\n${emps.map(formatEmp).join("\n")}`);
      }
      body = storeBlocks.join("\n\n");
    } else {
      body = present.map(formatEmp).join("\n");
    }

    let reply = `**Colaboradores em atividade agora (${present.length}):**\n\n${body}`;

    if (onBreak.length > 0) {
      const breakList = onBreak
        .map((p) => {
          const name = p.Nome || p.nome || "Colaborador";
          const store = p.NomeLoja || p.nomeLoja || "";
          const ret = p.breakReturnTime ? `Retorno previsto: ${p.breakReturnTime}` : "Em pausa";
          const storeStr = store ? `${store} · ` : "";
          return `- **${name}** (${storeStr}${ret})`;
        })
        .join("\n");
      reply += `\n\n**Colaboradores em intervalo (${onBreak.length}):**\n${breakList}`;
    }

    return {
      type: "query",
      reply,
    };
  }

  // ------------------------------------------------------------------------
  // 5. CONSULTAS: TAREFAS PENDENTES
  // ------------------------------------------------------------------------
  if (/(?:quais tarefas|minhas tarefas|tarefas pendentes|tarefas de hoje|tarefas da cozinha)/i.test(clean)) {
    const myTasks = tasks.filter((t) => {
      const respId = String(t.RESPONSAVEL_ID || t.FuncionarioID || "").trim();
      const status = String(t.STATUS || t.Status || "");
      if (role === "employee") {
        return respId === userId && status !== "Concluída" && status !== "Cancelada";
      }
      if (role === "manager" && userStore) {
        const storeId = String(t.LojaID || t.lojaId || "");
        if (storeId && storeId !== userStore) return false;
      }
      return status !== "Concluída" && status !== "Cancelada";
    });

    if (myTasks.length === 0) {
      return {
        type: "query",
        reply: "Não há tarefas pendentes registradas no CozinhaFlow no momento.",
      };
    }

    const list = myTasks
      .slice(0, 6)
      .map((t) => `- **${t.TITULO || t.Titulo || "Tarefa"}** (${t.STATUS || "A fazer"} · Prioridade: ${t.PRIORIDADE || "Normal"})`)
      .join("\n");

    return {
      type: "query",
      reply: `**Tarefas ativas (${myTasks.length}):**\n${list}`,
    };
  }

  // ------------------------------------------------------------------------
  // 6. AÇÃO: CRIAR TAREFA COZINHAFLOW
  // ------------------------------------------------------------------------
  const createTaskMatch = clean.match(/(?:cria(?:r)?|nova|adiciona(?:r)?)\s+(?:uma\s+)?tarefa\s*(.*)/i);
  if (createTaskMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "A criação e delegação de tarefas na cozinha requer permissão de Gerente ou Administrador.",
      };
    }

    const rest = createTaskMatch[1] || "";
    let prioridade = "Normal";
    if (rest.includes("urgente")) prioridade = "Urgente";
    else if (rest.includes("alta")) prioridade = "Alta";
    else if (rest.includes("baixa")) prioridade = "Baixa";

    let prazo = "";
    const timeMatch = rest.match(/([0-9]{1,2}):?([0-9]{2})?\s*(?:h|hrs)?/);
    if (timeMatch) {
      const now = new Date();
      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(now);
      const h = String(timeMatch[1]).padStart(2, "0");
      const m = String(timeMatch[2] || "00").padStart(2, "0");
      prazo = `${todayStr}T${h}:${m}:00`;
    }

    let targetEmployee = findEmployeeInText(rest, employees);

    if (targetEmployee && role === "manager" && userStore) {
      const empStore = String(targetEmployee.LojaID || targetEmployee.lojaId || "");
      if (empStore && empStore !== userStore) {
        return {
          type: "error",
          message: `O colaborador ${targetEmployee.Nome} pertence a outra unidade. Você pode delegar tarefas apenas para a sua loja.`,
        };
      }
    }

    let titulo = rest;
    if (targetEmployee) {
      const fullName = String(targetEmployee.Nome || targetEmployee.nome || "").toLowerCase();
      const firstName = fullName.split(" ")[0];
      titulo = titulo
        .replace(new RegExp(`para\\s+(${fullName}|${firstName})\\b`, "gi"), "")
        .replace(new RegExp(`\\b(${fullName}|${firstName})\\b`, "gi"), "");
    }
    titulo = titulo
      .replace(/prioridade\s+(?:urgente|alta|normal|baixa)/gi, "")
      .replace(/(?:urgente|alta|normal|baixa)/gi, "")
      .replace(/prazo\s+.*$/gi, "")
      .replace(/hoje\s+[a-z0-9:]+/gi, "")
      .replace(/^[de\s:]+/, "")
      .trim();

    if (!titulo || titulo.length < 3) {
      titulo = "Higienização e organização operacional";
    }

    titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);

    const payload = {
      TITULO: titulo,
      DESCRICAO: `Tarefa criada pelo Copiloto House 190 a pedido de ${userName}.`,
      PRIORIDADE: prioridade,
      PRAZO: prazo,
      RESPONSAVEL_ID: targetEmployee ? String(targetEmployee.FuncionarioID || targetEmployee.id || "") : "",
      RESPONSAVEL_NOME: targetEmployee ? String(targetEmployee.Nome || "") : "Equipe da Cozinha",
      LojaID: targetEmployee?.LojaID || userStore,
      STATUS: "A fazer",
    };

    return {
      type: "action",
      actionType: "create_task",
      title: "Criar Tarefa no CozinhaFlow",
      apiMethod: "cozinhaTasksSave",
      apiArgs: [payload],
      summary: `Criar a tarefa "${titulo}" atribuída a ${payload.RESPONSAVEL_NOME} com prioridade ${prioridade}.`,
      diff: [
        { label: "Título", value: titulo },
        { label: "Responsável", value: payload.RESPONSAVEL_NOME },
        { label: "Prioridade", value: prioridade },
        { label: "Prazo", value: prazo ? prazo.replace("T", " ") : "Sem prazo definido" },
      ],
      details: {
        titulo,
        responsavel: payload.RESPONSAVEL_NOME,
        prioridade,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 7. AÇÃO: CONCLUIR TAREFA
  // ------------------------------------------------------------------------
  const finishTaskMatch = clean.match(/(?:conclui(?:r)?|finaliza(?:r)?|marca(?:r)?\s+(?:como\s+feita|conclu[ií]da))\s+tarefa\s*(.*)/i);
  if (finishTaskMatch) {
    const q = finishTaskMatch[1]?.trim().toLowerCase();
    let targetTask = tasks.find((t) => {
      const tId = String(t.RESPONSAVEL_ID || t.FuncionarioID || "").trim();
      const status = String(t.STATUS || t.Status || "");
      if (role === "employee" && tId !== userId) return false;
      if (status === "Concluída") return false;
      if (!q) return true;
      const tit = String(t.TITULO || t.Titulo || "").toLowerCase();
      return tit.includes(q);
    });

    if (!targetTask) {
      return {
        type: "error",
        message: "Nenhuma tarefa aberta correspondente foi encontrada para ser concluída.",
      };
    }

    const payload = {
      ...targetTask,
      STATUS: "Concluída",
      Status: "Concluída",
      OBSERVACAO_CONCLUSAO: `Concluída via Copiloto House 190 por ${userName}.`,
    };

    return {
      type: "action",
      actionType: "finish_task",
      title: "Concluir Tarefa",
      apiMethod: "cozinhaTasksSave",
      apiArgs: [payload],
      summary: `Marcar a tarefa "${targetTask.TITULO || targetTask.Titulo}" como Concluída.`,
      diff: [
        { label: "Tarefa", value: targetTask.TITULO || targetTask.Titulo },
        { label: "Status Anterior", value: targetTask.STATUS || targetTask.Status || "A fazer" },
        { label: "Novo Status", value: "Concluída" },
      ],
      details: {
        id: targetTask.ID || targetTask.TarefaID,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 8. AÇÃO: SOLICITAR / LANÇAR FOLGA (MEGA CÉREBRO — LINGUAGEM NATURAL COMPLETA)
  // ------------------------------------------------------------------------
  const isTimeOffIntent =
    /(?:(?:quero|preciso|solicito|solicitar|pedir|pe[cç]o|gostaria|marcar|me\s+d[aá]|dar|d[aá]|colocar|lan[cç]ar|cadastrar|conceder|programar|posso\s+ter)\s+(?:de\s+)?(?:uma\s+)?folga|folga\s+(?:no\s+dia|dia|para|pro|pra|de|do|da|em|na|no|amanh[aã]|depois\s+de\s+amanh[aã]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)|preciso\s+folgar|marcar\s+minha\s+folga|\bfolga\s+amanh[aã])/i.test(clean);

  if (isTimeOffIntent && !clean.includes("troca") && !clean.includes("como funciona") && !clean.includes("quais as regras")) {
    const parsedDate = extractDateFromText(clean);
    if (!parsedDate) {
      return {
        type: "query",
        reply: `Para qual data você gostaria de agendar a folga? Digite, por exemplo:\n- *"Quero folga dia 25/10 porque tenho médico"*\n- *"Ana Claudia do Foodpark folga amanhã"*\n- *"Dar folga para Gabriel amanhã"*`,
      };
    }

    const { isoDate, formattedDate } = parsedDate;
    const isSelfExplicit = /\b(minha\s+folga|quero\s+folga|preciso\s+de\s+folga|me\s+d[aá]\s+folga|folga\s+pra\s+mim|folga\s+para\s+mim|gostaria\s+de\s+folga)\b/i.test(clean);
    const targetEmp = isSelfExplicit ? null : findEmployeeInText(clean, employees);

    // Se o usuário for colaborador comum e tentar atribuir folga a outro
    if (targetEmp && role === "employee" && targetEmp.FuncionarioID !== userId) {
      return {
        type: "error",
        message: "Você só pode solicitar folga para o seu próprio usuário. A concessão ou solicitação de folga para outros colaboradores é restrita à gerência e administração.",
      };
    }

    // Se o usuário for gerente, validar escopo de loja
    if (targetEmp && role === "manager" && userStore) {
      const empStore = String(targetEmp.LojaID || targetEmp.lojaId || "");
      if (empStore && empStore !== userStore) {
        return {
          type: "error",
          message: `O colaborador ${targetEmp.Nome} pertence a outra unidade. Você pode conceder folga apenas para colaboradores da sua loja.`,
        };
      }
    }

    const reason = extractReasonFromText(clean, targetEmp && role !== "employee" ? `Folga concedida via Copiloto por ${userName}` : "Solicitação de folga via Copiloto");

    // Caso A: Gestor ou Administrador concedendo folga para colaborador identificado
    if (targetEmp && role !== "employee" && targetEmp.FuncionarioID !== userId) {
      const storeLabel = targetEmp.NomeLoja || (targetEmp.LojaID ? `Loja ${targetEmp.LojaID}` : (userStore ? `Loja ${userStore}` : "Unidade"));
      const payload = {
        FuncionarioID: targetEmp.FuncionarioID || targetEmp.id,
        NomeFuncionario: targetEmp.Nome || targetEmp.nome,
        LojaID: targetEmp.LojaID || targetEmp.lojaId || userStore,
        DataInicio: isoDate,
        DataFim: isoDate,
        TipoFolga: "Folga",
        Motivo: reason,
        Status: "Aprovada",
      };

      return {
        type: "action",
        actionType: "create_timeoff",
        title: "Lançar Folga",
        apiMethod: "createTimeOff",
        apiArgs: [payload],
        summary: `Lançar folga aprovada para ${targetEmp.Nome} (${storeLabel}) no dia ${formattedDate}.`,
        diff: [
          { label: "Colaborador", value: targetEmp.Nome },
          { label: "Loja", value: storeLabel },
          { label: "Data da Folga", value: formattedDate },
          { label: "Motivo", value: reason },
          { label: "Status Inicial", value: "Aprovada (concedida pela gestão)" },
        ],
        details: {
          empId: targetEmp.FuncionarioID || targetEmp.id,
          empName: targetEmp.Nome || targetEmp.nome,
          isoDate,
          formattedDate,
          reason,
        },
      };
    }

    // Caso B: Gestor/Admin mencionou terceiro que não foi encontrado no cadastro
    if (!targetEmp && role !== "employee" && !isSelfExplicit) {
      const storeKeywords = ["foodpark", "teixeira", "eunapolis"];
      const hasStoreMention = storeKeywords.some((sk) => clean.includes(sk));
      const hasThirdPartyIndicator = hasStoreMention || /(?:para|pro|pra|de|do|da)\s+[a-z]{3,}/i.test(clean) || /^[a-z]{3,}\s+[a-z]{3,}/i.test(clean);

      if (employees.length > 0 && hasThirdPartyIndicator) {
        return {
          type: "error",
          message: "O colaborador mencionado não foi localizado no cadastro da equipe. Verifique se o nome está correto ou se o colaborador está ativo.",
        };
      }
    }

    // Caso C: O próprio colaborador ou gestor solicitando para si
    const isDirectApproval = role !== "employee";
    const apiMethod = isDirectApproval ? "createTimeOff" : "createEmployeeTimeOffRequest";
    const title = isDirectApproval ? "Lançar Folga" : "Solicitar Folga";
    const statusLabel = isDirectApproval ? "Aprovada (concedida pela gestão)" : "Pendente (aguardando gestor)";

    const payload = {
      FuncionarioID: userId,
      NomeFuncionario: userName,
      LojaID: userStore,
      DataInicio: isoDate,
      DataFim: isoDate,
      TipoFolga: isDirectApproval ? "Folga" : "Folga solicitada",
      Motivo: reason,
      Status: isDirectApproval ? "Aprovada" : "Pendente",
    };

    return {
      type: "action",
      actionType: isDirectApproval ? "create_timeoff" : "request_timeoff",
      title,
      apiMethod,
      apiArgs: [payload],
      summary: `${isDirectApproval ? "Lançar folga aprovada" : "Enviar pedido de folga"} para o dia ${formattedDate} com motivo: "${reason}".`,
      diff: [
        { label: "Data Solicitada", value: formattedDate },
        { label: "Colaborador", value: userName },
        { label: "Motivo", value: reason },
        { label: "Status Inicial", value: statusLabel },
      ],
      details: {
        isoDate,
        formattedDate,
        reason,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 8.1. AÇÃO: SOLICITAR ALTERAÇÃO / AJUSTE DE PONTO (MEGA CÉREBRO)
  // ------------------------------------------------------------------------
  const isClockAdjustmentIntent =
    /(?:esqueci\s+(?:de\s+)?(?:bater\s+)?(?:[oa]\s+|minha\s+|meu\s+)?(?:ponto|sa[ií]da|entrada)|(?:altera(?:r)?|ajusta(?:r)?|corrige|corrigir|muda(?:r)?|solicitar\s+ajuste\s+de|solicitar\s+altera[cç][aã]o\s+de)\s+(?:[oa]\s+|meu\s+)?ponto|ponto\s+(?:de\s+)?(?:ontem|retroativo)|bater\s+ponto\s+retroativo|ajuste\s+de\s+ponto|altera[cç][aã]o\s+de\s+ponto)/i.test(clean);

  if (isClockAdjustmentIntent && !clean.includes("regras") && !clean.includes("tolerância")) {
    const parsedDate = extractDateFromText(clean) || (clean.includes("ontem") ? extractDateFromText("ontem") : extractDateFromText("hoje"));
    const isoDate = parsedDate ? parsedDate.isoDate : "";
    const formattedDate = parsedDate ? parsedDate.formattedDate : "";
    const time = extractTimeFromText(clean) || (clean.includes("saída") || clean.includes("saida") ? "18:00" : "08:00");
    const punchInfo = extractPunchType(clean, time);
    const punchType = punchInfo.type;
    const punchLabel = punchInfo.label;
    const reason = extractReasonFromText(clean, "Esquecimento de registro de ponto (solicitado via Copiloto)");

    let targetEmp = null;
    if (role !== "employee") {
      targetEmp = findEmployee(clean);
    }
    const targetName = targetEmp ? (targetEmp.Nome || targetEmp.nome) : userName;
    const targetId = targetEmp ? (targetEmp.FuncionarioID || targetEmp.id) : userId;

    if (role === "employee" || (!targetEmp && role !== "admin" && role !== "manager")) {
      const payload = {
        registroPontoId: "",
        dataHoraSolicitada: `${isoDate}T${time}:00`,
        motivo: reason,
      };

      return {
        type: "action",
        actionType: "request_clock_adjustment",
        title: "Solicitar Ajuste de Ponto",
        apiMethod: "requestTimeClockAdjustment",
        apiArgs: [payload],
        summary: `Solicitar ajuste da batida de ponto para o dia ${formattedDate} às ${time} (${punchLabel}) com motivo: "${reason}".`,
        diff: [
          { label: "Colaborador", value: targetName },
          { label: "Data", value: formattedDate },
          { label: "Marcação", value: punchLabel },
          { label: "Horário Solicitado", value: time },
          { label: "Motivo", value: reason },
          { label: "Status Inicial", value: "Pendente (aguardando gestor)" },
        ],
        details: {
          empId: targetId,
          isoDate,
          formattedDate,
          time,
          punchType,
          reason,
        },
      };
    }

    if (role === "manager") {
      const payload = {
        funcionarioId: targetId,
        data: isoDate,
        horaSaida: time,
        observacao: reason,
      };

      return {
        type: "action",
        actionType: "quick_fix_clock",
        title: "Ajustar Ponto do Colaborador",
        apiMethod: "quickFixIncompletePunch",
        apiArgs: [payload],
        summary: `Lançar ajuste de ponto para ${targetName} no dia ${formattedDate} às ${time}.`,
        diff: [
          { label: "Colaborador", value: targetName },
          { label: "Data", value: formattedDate },
          { label: "Horário", value: time },
          { label: "Observação", value: reason },
        ],
        details: { empId: targetId, isoDate, time },
      };
    }

    const payload = {
      funcionarioId: targetId,
      tipoMarcacao: punchType,
      dataHora: `${isoDate}T${time}:00`,
      motivo: reason,
      dataOperacional: isoDate,
    };

    return {
      type: "action",
      actionType: "manual_clock_punch",
      title: "Lançar Ponto Manual",
      apiMethod: "registerTimeClockManualPunch",
      apiArgs: [payload],
      summary: `Lançar ponto manual para ${targetName} em ${formattedDate} às ${time} (${punchLabel}) com auditoria.`,
      diff: [
        { label: "Colaborador", value: targetName },
        { label: "Data", value: formattedDate },
        { label: "Tipo", value: punchLabel },
        { label: "Horário", value: time },
        { label: "Motivo", value: reason },
      ],
      details: { empId: targetId, isoDate, time, punchType },
    };
  }

  // ------------------------------------------------------------------------
  // 9. AÇÃO: APROVAR TROCA DE FOLGA
  // ------------------------------------------------------------------------
  const approveSwapMatch = clean.match(/(?:aprova(?:r)?|aceita(?:r)?)\s+(?:a\s+)?troca\s*(.*)/i);
  if (approveSwapMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "A aprovação de trocas de folga é exclusiva de Gerentes e Administradores.",
      };
    }

    const q = approveSwapMatch[1]?.trim().toLowerCase();
    const pendingSwap = swaps.find((s) => {
      const status = String(s.Status || s.status || "");
      if (status !== "Aguardando gestor" && status !== "Aguardando aprovação") return false;
      if (role === "manager" && userStore) {
        const sStore = String(s.LojaID || s.lojaId || "");
        if (sStore && sStore !== userStore) return false;
      }
      if (!q) return true;
      const oName = String(s.NomeFuncionarioOrigem || "").toLowerCase();
      const dName = String(s.NomeFuncionarioDestino || "").toLowerCase();
      return oName.includes(q) || dName.includes(q);
    });

    if (!pendingSwap) {
      return {
        type: "error",
        message: "Nenhuma troca de folga pendente de aprovação gerencial foi localizada.",
      };
    }

    const swapId = pendingSwap.TrocaID || pendingSwap.TrocaPrincipalID;

    return {
      type: "action",
      actionType: "approve_swap",
      title: "Aprovar Troca de Folga",
      apiMethod: "decideTimeOffSwap",
      apiArgs: [swapId, true, `Aprovado pelo Copiloto House 190 (${userName})`],
      summary: `Aprovar a troca de folga entre ${pendingSwap.NomeFuncionarioOrigem} e ${pendingSwap.NomeFuncionarioDestino}.`,
      diff: [
        { label: "Origem", value: `${pendingSwap.NomeFuncionarioOrigem} (${pendingSwap.DataFolgaOrigem || "Data"})` },
        { label: "Destino", value: `${pendingSwap.NomeFuncionarioDestino} (${pendingSwap.DataFolgaDestino || "Data"})` },
        { label: "Status", value: "Aprovada" },
      ],
      details: {
        swapId,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 10. AÇÃO: ALTERAR TURNO
  // ------------------------------------------------------------------------
  const shiftMatch = clean.match(/(?:muda(?:r)?|altera(?:r)?|troca(?:r)?)\s+(?:o\s+)?turno\s+(?:de|do|da)\s+([a-zA-ZÀ-ÿ\s]+?)\s+para\s+([a-zA-ZÀ-ÿ\s]+)/i);
  if (shiftMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "Alterações de turno na escala requerem perfil de Gerente ou Administrador.",
      };
    }

    const empQuery = shiftMatch[1].trim();
    let targetShift = shiftMatch[2].trim();
    if (/manh[aã]/i.test(targetShift)) targetShift = "Manhã";
    else if (/tarde/i.test(targetShift)) targetShift = "Tarde";
    else if (/noite/i.test(targetShift)) targetShift = "Noite";
    else if (/integral/i.test(targetShift)) targetShift = "Integral";

    const emp = findEmployee(empQuery);
    if (!emp) {
      return {
        type: "error",
        message: `Colaborador "${empQuery}" não foi localizado no cadastro.`,
      };
    }

    if (role === "manager" && userStore) {
      const empStore = String(emp.LojaID || emp.lojaId || "");
      if (empStore && empStore !== userStore) {
        return {
          type: "error",
          message: `O colaborador ${emp.Nome} pertence a outra unidade. Você pode alterar turnos apenas de colaboradores da sua loja.`,
        };
      }
    }

    const currentShift = emp.Turno || emp.turno || "Não definido";
    const empId = emp.FuncionarioID || emp.id;

    const payload = {
      ...emp,
      Turno: targetShift,
    };

    return {
      type: "action",
      actionType: "update_shift",
      title: "Alterar Turno na Escala",
      apiMethod: "updateEmployee",
      apiArgs: [empId, payload],
      summary: `Alterar o turno de ${emp.Nome} de "${currentShift}" para "${targetShift}".`,
      diff: [
        { label: "Colaborador", value: emp.Nome },
        { label: "Turno Atual", value: currentShift },
        { label: "Novo Turno", value: targetShift },
      ],
      details: {
        empId,
        newShift: targetShift,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 11. AÇÃO: ALTERAR FOLGA FIXA SEMANAL
  // ------------------------------------------------------------------------
  const fixedOffMatch = clean.match(/(?:muda(?:r)?|altera(?:r)?|define|definir)\s+(?:a\s+)?folga\s+fixa\s+(?:de|do|da)\s+([a-zA-ZÀ-ÿ\s]+?)\s+para\s+([a-zA-ZÀ-ÿ\s]+)/i);
  if (fixedOffMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "Definir ou alterar a folga semanal fixa requer permissão gerencial.",
      };
    }

    const empQuery = fixedOffMatch[1].trim();
    let targetDay = fixedOffMatch[2].trim();
    if (/segunda/i.test(targetDay)) targetDay = "Segunda-feira";
    else if (/ter[cç]a/i.test(targetDay)) targetDay = "Terça-feira";
    else if (/quarta/i.test(targetDay)) targetDay = "Quarta-feira";
    else if (/quinta/i.test(targetDay)) targetDay = "Quinta-feira";
    else if (/sexta/i.test(targetDay)) targetDay = "Sexta-feira";
    else if (/s[aá]bado/i.test(targetDay)) targetDay = "Sábado";
    else if (/domingo/i.test(targetDay)) targetDay = "Domingo";

    const emp = findEmployee(empQuery);
    if (!emp) {
      return {
        type: "error",
        message: `Colaborador "${empQuery}" não foi localizado no cadastro.`,
      };
    }

    if (role === "manager" && userStore) {
      const empStore = String(emp.LojaID || emp.lojaId || "");
      if (empStore && empStore !== userStore) {
        return {
          type: "error",
          message: `O colaborador ${emp.Nome} pertence a outra unidade.`,
        };
      }
    }

    const currentDay = emp.FolgaFixaSemanal || emp.folgaFixa || "Não definida";
    const empId = emp.FuncionarioID || emp.id;

    const payload = {
      ...emp,
      FolgaFixaSemanal: targetDay,
    };

    return {
      type: "action",
      actionType: "update_fixed_timeoff",
      title: "Alterar Folga Fixa Semanal",
      apiMethod: "updateEmployee",
      apiArgs: [empId, payload],
      summary: `Definir a folga fixa semanal de ${emp.Nome} para "${targetDay}".`,
      diff: [
        { label: "Colaborador", value: emp.Nome },
        { label: "Folga Atual", value: currentDay },
        { label: "Nova Folga", value: targetDay },
      ],
      details: {
        empId,
        targetDay,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 12. AÇÃO: PUBLICAR COMUNICADO
  // ------------------------------------------------------------------------
  const announcementMatch = clean.match(/(?:publica(?:r)?|cria(?:r)?)\s+(?:um\s+)?comunicado\s*(?:para\s+(.+?))?:\s*(.+)/i);
  if (announcementMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "A publicação de comunicados é restrita a Gerentes e Administradores.",
      };
    }

    const rawTarget = announcementMatch[1] ? announcementMatch[1].trim() : "Todos";
    const rawContent = announcementMatch[2].trim();

    let title = "Aviso Geral";
    let body = rawContent;
    if (rawContent.includes(" - ")) {
      const parts = rawContent.split(" - ");
      title = parts[0].trim();
      body = parts.slice(1).join(" - ").trim();
    }

    const payload = {
      Titulo: title,
      Corpo: body,
      LojaID: role === "admin" ? "" : userStore,
      PublicoAlvo: rawTarget,
      ExigeConfirmacao: false,
    };

    return {
      type: "action",
      actionType: "publish_announcement",
      title: "Publicar Comunicado",
      apiMethod: "publicarComunicado",
      apiArgs: [payload],
      summary: `Publicar o comunicado "${title}" para ${payload.LojaID ? "a loja atual" : "toda a rede"}.`,
      diff: [
        { label: "Título", value: title },
        { label: "Mensagem", value: body },
        { label: "Destino", value: payload.LojaID ? "Loja local" : "Rede completa" },
      ],
      details: {
        title,
        body,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 13. AÇÃO: CADASTRAR FERIADO
  // ------------------------------------------------------------------------
  const holidayMatch = clean.match(/(?:cadastra(?:r)?|cria(?:r)?|adiciona(?:r)?)\s+(?:um\s+)?feriado\s*(.*)/i);
  if (holidayMatch) {
    if (role !== "admin") {
      return {
        type: "error",
        message: "O cadastro de feriados é exclusivo para o perfil de Administrador.",
      };
    }

    const rest = holidayMatch[1]?.trim() || "";
    const dateMatch = rest.match(/([0-9]{1,2}[\/\-][0-9]{1,2}(?:[\/\-][0-9]{2,4})?|[0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (!dateMatch) {
      return {
        type: "query",
        reply: `**Como cadastrar feriado pelo Copiloto:**\n\nDigite o comando informando o nome e a data. Por exemplo:\n*"Cadastrar feriado Dia da Consciência Negra dia 20/11/2026 Nacional"*\n\nO sistema registrará o feriado e concederá automaticamente o crédito de folga para todos os colaboradores elegíveis.`,
      };
    }

    let rawDate = dateMatch[1];
    let isoDate = rawDate;
    if (isoDate.includes("/")) {
      const parts = isoDate.split("/");
      const d = parts[0].padStart(2, "0");
      const m = parts[1].padStart(2, "0");
      const y = parts[2] ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : new Date().getFullYear().toString();
      isoDate = `${y}-${m}-${d}`;
    }

    let nomeFeriado = rest
      .replace(rawDate, "")
      .replace(/(?:dia|em|no|data)\s+/gi, "")
      .replace(/\b(nacional|municipal|regional)\b/gi, "")
      .trim();

    if (!nomeFeriado || nomeFeriado.length < 3) {
      nomeFeriado = "Feriado Operacional";
    }
    nomeFeriado = nomeFeriado.charAt(0).toUpperCase() + nomeFeriado.slice(1);

    let tipo = "Nacional";
    if (/municipal/i.test(rest)) tipo = "Municipal";
    else if (/regional/i.test(rest)) tipo = "Regional";

    const payload = {
      NomeFeriado: nomeFeriado,
      Data: isoDate,
      Tipo: tipo,
      LojaID: tipo === "Municipal" ? userStore : "",
      Ativo: true,
    };

    return {
      type: "action",
      actionType: "create_holiday",
      title: "Cadastrar Feriado",
      apiMethod: "createHoliday",
      apiArgs: [payload],
      summary: `Cadastrar feriado "${nomeFeriado}" em ${isoDate} (${tipo}) com crédito automático de folga para os colaboradores.`,
      diff: [
        { label: "Feriado", value: nomeFeriado },
        { label: "Data", value: isoDate },
        { label: "Tipo", value: tipo },
        { label: "Crédito de Folga", value: "Automático para equipe em escala" },
      ],
      details: { nomeFeriado, isoDate, tipo },
    };
  }

  // ------------------------------------------------------------------------
  // 14. AÇÃO: JUSTIFICAR AUSÊNCIA / FALTA
  // ------------------------------------------------------------------------
  const absenceMatch = clean.match(/(?:justifica(?:r)?)\s+(?:a\s+)?(?:falta|aus[eê]ncia)\s*(.*)/i);
  if (absenceMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "O lançamento de justificativas de falta requer perfil de Gerente ou Administrador.",
      };
    }

    const rest = absenceMatch[1]?.trim() || "";
    const dateMatch = rest.match(/([0-9]{1,2}[\/\-][0-9]{1,2}(?:[\/\-][0-9]{2,4})?|[0-9]{4}-[0-9]{2}-[0-9]{2})/);
    const targetEmployee = findEmployee(rest);

    if (!dateMatch || !targetEmployee) {
      return {
        type: "query",
        reply: `**Como justificar falta pelo Copiloto:**\n\nDigite o comando com o nome do colaborador e a data. Por exemplo:\n*"Justificar falta de Gabriel dia 10/10/2026 motivo Atestado Médico"*\n\nTipos válidos aceitos pelo sistema: **Atestado**, **Folga trocada**, **Dia concedido** ou **Outros**.`,
      };
    }

    if (role === "manager" && userStore) {
      const empStore = String(targetEmployee.LojaID || targetEmployee.lojaId || "");
      if (empStore && empStore !== userStore) {
        return {
          type: "error",
          message: `O colaborador ${targetEmployee.Nome} pertence a outra unidade. Você pode justificar ausências apenas da sua loja.`,
        };
      }
    }

    let rawDate = dateMatch[1];
    let isoDate = rawDate;
    if (isoDate.includes("/")) {
      const parts = isoDate.split("/");
      const d = parts[0].padStart(2, "0");
      const m = parts[1].padStart(2, "0");
      const y = parts[2] ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : new Date().getFullYear().toString();
      isoDate = `${y}-${m}-${d}`;
    }

    let tipo = "Atestado";
    if (/folga\s+trocada/i.test(rest)) tipo = "Folga trocada";
    else if (/dia\s+concedido/i.test(rest)) tipo = "Dia concedido";
    else if (/outros/i.test(rest)) tipo = "Outros";

    const payload = {
      funcionarioId: targetEmployee.FuncionarioID || targetEmployee.id,
      data: isoDate,
      tipo: tipo,
      observacao: `Justificativa lançada via Copiloto por ${userName}`,
    };

    return {
      type: "action",
      actionType: "justify_absence",
      title: "Justificar Ausência / Falta",
      apiMethod: "justifyMissedTimeClockDay",
      apiArgs: [payload],
      summary: `Lançar justificativa de ausência (${tipo}) para ${targetEmployee.Nome} no dia ${isoDate}.`,
      diff: [
        { label: "Colaborador", value: targetEmployee.Nome },
        { label: "Data", value: isoDate },
        { label: "Tipo", value: tipo },
        { label: "Observação", value: payload.observacao },
      ],
      details: { empId: payload.funcionarioId, isoDate, tipo },
    };
  }

  // ------------------------------------------------------------------------
  // CONSULTAS OPERACIONAIS E CHIPS DO SISTEMA (MEGA CÉREBRO)
  // ------------------------------------------------------------------------
  const opKnowledge = resolveOperationalKnowledge(clean, context, role, user);
  if (opKnowledge) {
    return opKnowledge;
  }

  // ------------------------------------------------------------------------
  // FALLBACK
  // ------------------------------------------------------------------------
  return {
    type: "query",
    reply: `Não compreendi este comando com precisão. Você pode digitar **ajuda** para ver os comandos operacionais disponíveis para o seu perfil ou tentar frases diretas como:
- "Quando é minha próxima folga?"
- "Qual é o meu saldo de horas?"
- "Cria tarefa para Gabriel limpar o freezer hoje às 17h"
- "Muda o turno de João para Noite"`,
  };
}

// ==========================================================================
// EXECUTOR DE AÇÕES COM CONFIRMAÇÃO ("VER E CONFIRMAR")
// ==========================================================================

export async function executeCopilotAction(action, api) {
  if (!action || !action.apiMethod) {
    throw new Error("Ação inválida.");
  }

  if (!api || typeof api.invoke !== "function") {
    throw new Error("A API do sistema não está disponível no momento.");
  }

  if (action.actionType === "request_clock_adjustment") {
    const payload = action.apiArgs?.[0] || {};
    if (!payload.registroPontoId) {
      const state = (typeof window !== "undefined" ? (window.__GESTAO_STATE__ || window.state) : null) || {};
      let records = state.timeClock?.records || [];
      if (!records.length) {
        try {
          const res = await api.invoke("getTimeClockDataWithSession", []);
          records = res?.data?.records || [];
        } catch (_) {}
      }
      const targetDate = action.details?.isoDate;
      const targetEmpId = action.details?.empId || getUserId();
      const match = records.find((r) =>
        String(r.FuncionarioID) === String(targetEmpId) &&
        String(r.Data).slice(0, 10) === targetDate
      );
      if (match) {
        payload.registroPontoId = match.RegistroPontoID;
      }
    }
  }

  const result = await api.invoke(action.apiMethod, action.apiArgs || []);

  try {
    if (action.actionType.includes("task")) {
      window.dispatchEvent(new CustomEvent("gestao-tasks-refresh"));
    }
    if (
      action.actionType.includes("clock") ||
      action.actionType.includes("ponto") ||
      action.actionType.includes("timeoff") ||
      action.actionType.includes("swap")
    ) {
      window.dispatchEvent(new CustomEvent("gestao-data-refresh"));
    }
    if (typeof window.__GESTAO_REFRESH_APP__ === "function") {
      window.__GESTAO_REFRESH_APP__();
    }
  } catch (_) {}

  return result;
}

// ==========================================================================
// GESTÃO DA INTERFACE E CICLO DE VIDA DO COPILOTO
// ==========================================================================

let copilotInitialized = false;
let pendingAction = null;

export function initCopilot() {
  if (copilotInitialized) return;
  copilotInitialized = true;

  const drawer = $("#copilotDrawer");
  const panel = $(".copilot-panel", drawer);
  const dragHandle = $(".copilot-drag-handle", drawer);
  const header = $(".copilot-header", drawer);
  const openBtn = $("#copilotOpenBtn");
  const closeBtn = $("#copilotCloseBtn");
  const backdrop = $("#copilotBackdrop");
  const form = $("#copilotForm");
  const input = $("#copilotInput");
  const messages = $("#copilotMessages");
  const suggestions = $("#copilotQuickSuggestions");
  const fab = $("#copilotFab");

  // Painel de Configurações da Chave Gemini
  const settingsBtn = $("#copilotSettingsBtn");
  const settingsPanel = $("#copilotSettingsPanel");
  const apiKeyInput = $("#copilotApiKeyInput");
  const modelSelect = $("#copilotModelSelect");
  const saveKeyBtn = $("#copilotSaveKeyBtn");
  const clearKeyBtn = $("#copilotClearKeyBtn");
  const engineStatus = $("#copilotEngineStatus");

  function updateEngineStatus() {
    const key = getGeminiApiKey();
    let model = getGeminiModel();
  if (model === "gemini-4-argon") {
    model = "gemini-2.5-pro";
  }
    if (apiKeyInput) {
      apiKeyInput.value = key ? "••••••••••••••••" : "";
    }
    if (modelSelect) {
      modelSelect.value = model;
    }
    if (engineStatus) {
      if (key) {
        const label = model === "gemini-4-argon" ? "Gemini 4 Argon" : "Gemini Flash";
        engineStatus.textContent = `${label} Ativo`;
        engineStatus.className = "copilot-engine-status copilot-engine-status--gemini";
      } else {
        engineStatus.textContent = "Motor Local Ativo";
        engineStatus.className = "copilot-engine-status";
      }
    }
  }

  modelSelect?.addEventListener("change", () => {
    const chosen = modelSelect.value;
    setGeminiModel(chosen);
    updateEngineStatus();
    if (typeof window.__GESTAO_TOAST__ === "function") {
      const name = chosen === "gemini-4-argon" ? "Gemini 4 Argon" : "Gemini 2.0 Flash";
      window.__GESTAO_TOAST__(`Modelo alternado para ${name}.`);
    }
  });

  settingsBtn?.addEventListener("click", () => {
    settingsPanel?.classList.toggle("hidden");
    updateEngineStatus();
  });

  saveKeyBtn?.addEventListener("click", () => {
    const val = apiKeyInput?.value?.trim();
    if (val && !val.startsWith("•••")) {
      setGeminiApiKey(val);
      if (typeof window.__GESTAO_TOAST__ === "function") {
        window.__GESTAO_TOAST__("Chave da API do Gemini salva com sucesso.");
      }
    }
    if (modelSelect) {
      setGeminiModel(modelSelect.value);
    }
    updateEngineStatus();
    settingsPanel?.classList.add("hidden");
  });

  clearKeyBtn?.addEventListener("click", () => {
    setGeminiApiKey("");
    if (apiKeyInput) apiKeyInput.value = "";
    if (typeof window.__GESTAO_TOAST__ === "function") {
      window.__GESTAO_TOAST__("Chave removida. Usando motor local.");
    }
    updateEngineStatus();
  });

  updateEngineStatus();

  function openDrawer() {
    drawer?.classList.remove("hidden");
    drawer?.setAttribute("aria-hidden", "false");
    if (fab) fab.style.display = "none";
    if (typeof window !== "undefined" && window.innerWidth > 600) {
      input?.focus();
    }
    updateWelcomeAndChips();
  }

  function closeDrawer() {
    drawer?.classList.add("hidden");
    drawer?.setAttribute("aria-hidden", "true");
    settingsPanel?.classList.add("hidden");
    if (fab) fab.style.display = "";
    if (panel) panel.style.transform = "";
  }

  openBtn?.addEventListener("click", openDrawer);
  fab?.addEventListener("click", openDrawer);
  closeBtn?.addEventListener("click", closeDrawer);
  backdrop?.addEventListener("click", closeDrawer);

  // Gesto de deslizar para baixo para fechar no celular (iOS Bottom Sheet)
  let touchStartY = 0;
  let touchCurrentY = 0;
  let isDragging = false;

  function onTouchStart(e) {
    if (typeof window !== "undefined" && window.innerWidth > 600) return;
    touchStartY = e.touches[0].clientY;
    touchCurrentY = touchStartY;
    isDragging = true;
    if (panel) panel.style.transition = "none";
  }

  function onTouchMove(e) {
    if (!isDragging || (typeof window !== "undefined" && window.innerWidth > 600)) return;
    touchCurrentY = e.touches[0].clientY;
    const deltaY = touchCurrentY - touchStartY;
    if (deltaY > 0 && panel) {
      panel.style.transform = `translateY(${deltaY}px)`;
    }
  }

  function onTouchEnd() {
    if (!isDragging || (typeof window !== "undefined" && window.innerWidth > 600)) return;
    isDragging = false;
    if (panel) {
      panel.style.transition = "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)";
      const deltaY = touchCurrentY - touchStartY;
      if (deltaY > 70) {
        panel.style.transform = "translateY(100%)";
        setTimeout(() => {
          closeDrawer();
          panel.style.transform = "";
        }, 220);
      } else {
        panel.style.transform = "translateY(0)";
      }
    }
  }

  dragHandle?.addEventListener("touchstart", onTouchStart, { passive: true });
  dragHandle?.addEventListener("touchmove", onTouchMove, { passive: true });
  dragHandle?.addEventListener("touchend", onTouchEnd, { passive: true });
  header?.addEventListener("touchstart", onTouchStart, { passive: true });
  header?.addEventListener("touchmove", onTouchMove, { passive: true });
  header?.addEventListener("touchend", onTouchEnd, { passive: true });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer?.classList.contains("hidden")) {
      closeDrawer();
    }
  });

  let lastRenderedView = null;
  let lastRenderedRole = null;

  function updateWelcomeAndChips() {
    const user = window.__GESTAO_STATE__?.user || window.state?.user || window.__GESTAO_USER__;
    const role = getUserRole(user);
    const currentView = getCurrentView();
    const screenInfo = SCREEN_KNOWLEDGE[currentView] || SCREEN_KNOWLEDGE.dashboard;

    const badge = $("#copilotRoleBadge");
    if (badge) {
      badge.textContent = role === "admin" ? "Admin Ativo" : role === "manager" ? "Gerência Ativa" : "Operação Ativa";
    }

    const screenIndicator = $("#copilotScreenName");
    if (screenIndicator) {
      screenIndicator.textContent = screenInfo.title;
    }

    if (suggestions && (lastRenderedView !== currentView || lastRenderedRole !== role || suggestions.children.length === 0)) {
      lastRenderedView = currentView;
      lastRenderedRole = role;

      const chips = (screenInfo.chips && screenInfo.chips[role]) || (screenInfo.chips && screenInfo.chips.employee) || [];
      suggestions.innerHTML = chips
        .map((c) => `<button type="button" class="copilot-chip">${esc(c)}</button>`)
        .join("");

      $$(".copilot-chip", suggestions).forEach((btn) => {
        btn.addEventListener("click", () => {
          if (input) {
            input.value = btn.textContent.trim();
            handleUserInput();
          }
        });
      });
    }

    const userName = getUserName(user);
    const hasKey = Boolean(getGeminiApiKey());
    let model = getGeminiModel();
  if (model === "gemini-4-argon") {
    model = "gemini-2.5-pro";
  }
    const modelName = model === "gemini-4-argon" ? "Gemini 4 Argon" : "Gemini Flash";
    const engineNote = hasKey ? `Motor ${modelName} ativado.` : "Motor local autônomo ativado.";

    if (messages && messages.children.length === 0) {
      const greeting = `Olá, **${userName}**. Sou o Copiloto House 190. ${engineNote} Você está na tela **${screenInfo.title}**. Como posso ajudar na sua operação hoje?`;
      appendAssistantMessage(greeting);
    } else if (messages && messages.children.length === 1 && messages.firstElementChild?.classList.contains("copilot-message--assistant")) {
      const firstBubble = messages.firstElementChild.querySelector(".copilot-bubble p");
      if (firstBubble && (firstBubble.textContent.includes("Colaborador") || firstBubble.textContent.includes("Painel Geral")) && userName !== "Colaborador") {
        firstBubble.innerHTML = `Olá, <strong>${esc(userName)}</strong>. Sou o Copiloto House 190. ${esc(engineNote)} Você está na tela <strong>${esc(screenInfo.title)}</strong>. Como posso ajudar na sua operação hoje?`;
      }
    }
  }

  function appendUserMessage(text) {
    const div = document.createElement("div");
    div.className = "copilot-message copilot-message--user";
    div.innerHTML = `<div class="copilot-bubble"><p>${esc(text)}</p></div>`;
    messages?.appendChild(div);
    scrollToBottom();
  }

  function appendAssistantMessage(markdownText, cardHtml = "") {
    const div = document.createElement("div");
    div.className = "copilot-message copilot-message--assistant";

    let html = esc(markdownText)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n- (.*?)(?=\n|$)/g, "<li>$1</li>")
      .replace(/(<li>.*?<\/li>)/gs, "<ul>$1</ul>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>");

    div.innerHTML = `<div class="copilot-bubble"><p>${html}</p>${cardHtml}</div>`;
    messages?.appendChild(div);
    scrollToBottom();
    return div;
  }

  function scrollToBottom() {
    const body = $("#copilotBody");
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  }

  let isProcessing = false;

  async function handleUserInput() {
    if (isProcessing) return;
    const text = input?.value?.trim();
    if (!text) return;
    isProcessing = true;
    input.value = "";
    if (input) input.style.height = "auto";
    const sendBtn = $("#copilotSendBtn");
    if (sendBtn) sendBtn.disabled = true;

    try {
      appendUserMessage(text);
      copilotChatHistory.push({ role: "user", text });

      const state = window.__GESTAO_STATE__ || window.state || {};
      const allEmployees =
        Array.isArray(state.employees) && state.employees.length > 0
          ? state.employees
          : Array.isArray(window.state?.employees) && window.state.employees.length > 0
            ? window.state.employees
            : Array.isArray(window.__GESTAO_STATE__?.employees)
              ? window.__GESTAO_STATE__.employees
              : [];

      const timeClockData =
        state.timeClock || window.state?.timeClock || window.__GESTAO_STATE__?.timeClock || {};
      const adjustments = Array.isArray(timeClockData.adjustments)
        ? timeClockData.adjustments
        : Array.isArray(state.adjustments)
          ? state.adjustments
          : [];
      const incompletePunches = Array.isArray(state.incompletePunches)
        ? state.incompletePunches
        : Array.isArray(window.state?.incompletePunches)
          ? window.state.incompletePunches
          : [];

      const context = {
        user: state.user || window.__GESTAO_USER__,
        employees: allEmployees,
        tasks: state.tasks || window.state?.tasks || [],
        swaps: state.swaps || window.state?.swaps || [],
        timeOff: state.timeOff || window.state?.timeOff || [],
        vacations: state.vacations || window.state?.vacations || [],
        holidays: state.holidays || window.state?.holidays || [],
        stores: state.stores || window.state?.stores || [],
        livePresenceData: state.livePresenceData || window.state?.livePresenceData || [],
        timeClock: timeClockData,
        adjustments,
        incompletePunches,
        documents: state.documents || window.state?.documents || [],
        hourBalance: state.timeClockBalance || state.hourBalance || window.state?.timeClockBalance,
        pendingCounts: (() => {
          try {
            if (typeof pendingCenterCounts_ === "function") return pendingCenterCounts_();
            if (typeof window !== "undefined" && typeof window.pendingCenterCounts_ === "function") return window.pendingCenterCounts_();
          } catch (_) {}
          return state.pendingCounts || null;
        })(),
        currentView: getCurrentView(),
      };

      let intent = null;
      const apiKey = getGeminiApiKey();

      if (apiKey) {
        const currentModel = getGeminiModel();
        const modelLabel = currentModel === "gemini-4-argon" ? "Gemini 2.5 Pro" : "Gemini Flash";
        const waitMsg = appendAssistantMessage(`Pensando com ${modelLabel}…`);
        try {
          intent = await callGeminiCopilot(text, context);
        } catch (err) {
          console.warn("Falha no Gemini, usando fallback local:", err);
          intent = parseCopilotIntent(text, context);
        } finally {
          waitMsg?.remove();
        }
      } else {
        // Tenta consultar House AI Proxy da arquitetura central
        try {
          const api = window.__GESTAO_FIREBASE__?.api;
          if (api && typeof api.invoke === "function") {
            const houseAiRes = await api.invoke("callGeminiProxy", [{ prompt: text, context }]);
            const resData = houseAiRes?.data || houseAiRes;
            if (resData?.reply) {
              intent = {
                type: "query",
                reply: resData.reply,
              };
            }
          }
        } catch (_) {}

        if (!intent) {
          intent = parseCopilotIntent(text, context);
        }
      }

      if (!intent || intent.type === "empty") {
        appendAssistantMessage("Não compreendi este comando com precisão. Você pode digitar **ajuda** para ver os comandos operacionais disponíveis para o seu perfil.");
        return;
      }

      if (intent.type === "error") {
        appendAssistantMessage(intent.message);
        copilotChatHistory.push({ role: "assistant", text: intent.message });
        return;
      }

      if (intent.type === "query") {
        appendAssistantMessage(intent.reply);
        copilotChatHistory.push({ role: "assistant", text: intent.reply });
        return;
      }

      if (intent.type === "action") {
        pendingAction = intent;

        const diffRows = (intent.diff || [])
          .map(
            (d) => `
          <div class="copilot-diff-row">
            <span class="copilot-diff-label">${esc(d.label)}</span>
            <span class="copilot-diff-value copilot-diff-value--new">${esc(d.value)}</span>
          </div>`,
          )
          .join("");

        const cardHtml = `
          <div class="copilot-card" id="activeCopilotCard">
            <div class="copilot-card-tag">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Confirmação Necessária
            </div>
            <h3 class="copilot-card-title">${esc(intent.title)}</h3>
            <p class="copilot-card-desc">${esc(intent.summary)}</p>
            <div class="copilot-diff-table">${diffRows}</div>
            <div class="copilot-card-actions">
              <button type="button" class="copilot-btn-confirm" id="copilotCardConfirmBtn">
                Confirmar e Aplicar
              </button>
              <button type="button" class="copilot-btn-cancel" id="copilotCardCancelBtn">
                Cancelar
              </button>
            </div>
          </div>`;

        const msgEl = appendAssistantMessage(
          "Preparei a seguinte alteração no sistema. Revise os detalhes abaixo para autorizar a aplicação:",
          cardHtml,
        );
        copilotChatHistory.push({ role: "assistant", text: `${intent.title}: ${intent.summary}` });

        const confirmBtn = msgEl.querySelector("#copilotCardConfirmBtn");
        const cancelBtn = msgEl.querySelector("#copilotCardCancelBtn");
        const cardEl = msgEl.querySelector("#activeCopilotCard");

        confirmBtn?.addEventListener("click", async () => {
          confirmBtn.disabled = true;
          cancelBtn.disabled = true;
          confirmBtn.innerHTML = '<span class="copilot-spinner"></span> Aplicando…';

          try {
            const api = window.__GESTAO_FIREBASE__?.api;
            await executeCopilotAction(intent, api);

            cardEl.innerHTML = `
              <div class="copilot-status-card copilot-status-card--success">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                <div><strong>Ação concluída com sucesso!</strong><br>${esc(intent.summary)}</div>
              </div>`;

            if (typeof window.__GESTAO_TOAST__ === "function") {
              window.__GESTAO_TOAST__("Ação aplicada pelo Copiloto.");
            }
          } catch (err) {
            cardEl.innerHTML = `
              <div class="copilot-status-card copilot-status-card--error">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                <div><strong>Falha na aplicação:</strong><br>${esc(err.message || "Erro desconhecido")}</div>
              </div>`;
          }
          pendingAction = null;
        });

        cancelBtn?.addEventListener("click", () => {
          cardEl.innerHTML = `
            <div class="copilot-status-card copilot-status-card--warning">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div>Operação cancelada pelo usuário. Nenhuma alteração foi gravada.</div>
            </div>`;
          pendingAction = null;
        });
      }
    } catch (err) {
      console.error("Erro no processamento do copiloto:", err);
      appendAssistantMessage("Desculpe, ocorreu um erro ao processar o seu comando. Por favor, tente novamente.");
    } finally {
      isProcessing = false;
      if (sendBtn) sendBtn.disabled = false;
      scrollToBottom();
      if (typeof window !== "undefined" && window.innerWidth > 600) {
        input?.focus();
      }
    }
  }

  const clearChatBtn = $("#copilotClearChatBtn");
  clearChatBtn?.addEventListener("click", () => {
    if (messages) messages.innerHTML = "";
    clearCopilotChatHistory();
    updateWelcomeAndChips();
    if (input) {
      input.value = "";
      input.style.height = "auto";
    }
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    handleUserInput();
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleUserInput();
    }
  });

  window.addEventListener("gestao-api-ready", () => {
    updateWelcomeAndChips();
    updateEngineStatus();
  });

  window.addEventListener("gestao-view-change", () => {
    updateWelcomeAndChips();
  });

  window.addEventListener("gestao-user-hydrated", () => {
    updateWelcomeAndChips();
  });
}

// Inicia automaticamente no carregamento
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCopilot, { once: true });
  } else {
    initCopilot();
  }
}
