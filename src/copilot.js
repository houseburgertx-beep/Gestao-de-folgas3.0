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
        description: "Solicita um dia de folga pontual para o colaborador logado",
        parameters: {
          type: "OBJECT",
          properties: {
            data: { type: "STRING", description: "Data da folga no formato AAAA-MM-DD ou DD/MM/AAAA" },
            motivo: { type: "STRING", description: "Motivo da solicitação de folga" },
          },
          required: ["data"],
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
    ],
  },
];

// Helper para localizar funcionário por menção em texto ou nome
export function findEmployeeInText(textToSearch, employees = []) {
  if (!textToSearch) return null;
  const cleanText = String(textToSearch).toLowerCase();
  for (const emp of employees) {
    const fullName = String(emp.Nome || emp.nome || "").toLowerCase();
    const firstName = fullName.split(" ")[0];
    if (new RegExp(`(?:para|de|do|da)\\s+${fullName}\\b`, "i").test(cleanText)) return emp;
    if (new RegExp(`(?:para|de|do|da)\\s+${firstName}\\b`, "i").test(cleanText)) return emp;
  }
  for (const emp of employees) {
    const fullName = String(emp.Nome || emp.nome || "").toLowerCase();
    const firstName = fullName.split(" ")[0];
    if (new RegExp(`\\b${fullName}\\b`, "i").test(cleanText)) return emp;
    if (new RegExp(`\\b${firstName}\\b`, "i").test(cleanText)) return emp;
  }
  return null;
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

    case "solicitarFolga": {
      let isoDate = args.data || "";
      if (isoDate.includes("/")) {
        const parts = isoDate.split("/");
        const d = parts[0].padStart(2, "0");
        const m = parts[1].padStart(2, "0");
        const y = parts[2] ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : new Date().getFullYear().toString();
        isoDate = `${y}-${m}-${d}`;
      }

      const reason = args.motivo || "Solicitação via Copiloto";

      const payload = {
        FuncionarioID: userId,
        NomeFuncionario: userName,
        LojaID: userStore,
        DataInicio: isoDate,
        DataFim: isoDate,
        TipoFolga: "Folga solicitada",
        Motivo: reason,
        Status: "Pendente",
      };

      return {
        type: "action",
        actionType: "request_timeoff",
        title: "Solicitar Folga",
        apiMethod: "createEmployeeTimeOffRequest",
        apiArgs: [payload],
        summary: `Enviar pedido de folga para ${isoDate} com motivo: "${reason}".`,
        diff: [
          { label: "Data Solicitada", value: isoDate },
          { label: "Colaborador", value: userName },
          { label: "Motivo", value: reason },
        ],
        details: { isoDate, reason },
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
  const model = getGeminiModel();

  const user = context.user || {};
  const role = getUserRole(user);
  const userName = getUserName(user);
  const userStore = getUserStoreId(user);
  const employees = Array.isArray(context.employees) ? context.employees : [];

  const empSummary = employees
    .slice(0, 30)
    .map((e) => `${e.Nome || e.nome} (Loja: ${e.LojaID || ""}, Turno: ${e.Turno || ""})`)
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

6. DIRETRIZES DE COMUNICAÇÃO E EXECUÇÃO:
- ZERO EMOJIS: Regra estrita de ausência total de emojis em todas as respostas, botões e textos.
- ROTEIRO: ENTENDER -> CONSULTAR -> RESOLVER -> EXECUTAR QUANDO AUTORIZADO -> CONFIRMAR.
- AÇÕES REAIS: Ao solicitar folga, solicitar troca de folga, criar tarefa, alterar turno, alterar folga fixa, cadastrar feriado, justificar ausência, aprovar/recusar solicitações ou publicar comunicado, acione SEMPRE a função correspondente para gerar o card de confirmação visual ("Ver e Confirmar").
- Comunicação humanizada, atenciosa, precisa, em português brasileiro.`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
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
    /(?:(?:como\s+funciona[mn]?\s+(?:as\s+)?)?trocas?\s+de\s+folgas?|pol[ií]tica\s+(?:de\s+)?trocas?|posso\s+trocar\s+minha\s+folga)/i.test(
      clean,
    )
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

  if (
    /(?:solicita[cç][oõ]es\s+pendentes\s+da\s+equipe|pedidos\s+(?:de\s+folgas?\s+)?aguardando\s+aprova[cç][aã]o|o\s+que\s+a\s+equipe\s+pediu|pedidos\s+pendentes\s+da\s+loja)/i.test(
      clean,
    )
  ) {
    if (role === "employee") {
      return {
        type: "query",
        reply: "A consulta de solicitações pendentes da equipe é restrita aos gestores da unidade.",
      };
    }
    const actor = { userId, role, storeId: userStore };
    const p = hrAdapter.getTeamPendingRequests(actor, context);
    if (p.totalPendencias === 0) {
      return {
        type: "query",
        reply: "Não há nenhuma solicitação de folga ou troca pendente de aprovação para a sua unidade no momento.",
      };
    }
    const leavesText = p.folgasPendentes.length > 0
      ? `\n- **Folgas Solicitadas (${p.folgasPendentes.length}):**\n` + p.folgasPendentes.map((f) => `  * ${f.colaborador}: ${f.data} (${f.motivo})`).join("\n")
      : "";
    const swapsText = p.trocasPendentes.length > 0
      ? `\n- **Trocas de Folga (${p.trocasPendentes.length}):**\n` + p.trocasPendentes.map((s) => `  * ${s.origem} por ${s.destino}`).join("\n")
      : "";
    return {
      type: "query",
      reply: `**Solicitações Pendentes da Equipe (${p.totalPendencias}):**${leavesText}${swapsText}\n\nPara aprovar ou recusar, digite: "Aprovar folga de [Nome]" ou "Aprovar troca de [Nome]".`,
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
    const model = getGeminiModel();
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
  // 8. AÇÃO: SOLICITAR FOLGA
  // ------------------------------------------------------------------------
  const requestTimeOffMatch = clean.match(/(?:solicita(?:r)?|pedir|quero)\s+folga\s+(?:para\s+(?:o\s+dia\s+)?|no\s+dia\s+|dia\s+|em\s+|o\s+dia\s+)?([0-9]{1,2}[\/\-][0-9]{1,2}(?:[\/\-][0-9]{2,4})?)(?:\s+(?:motivo|por)\s+(.+))?/i);
  if (requestTimeOffMatch) {
    const rawDate = requestTimeOffMatch[1].replace(/-/g, "/");
    const reason = requestTimeOffMatch[2] ? requestTimeOffMatch[2].trim() : "Solicitação operacional via Copiloto";

    const parts = rawDate.split("/");
    let d = parts[0].padStart(2, "0");
    let m = parts[1].padStart(2, "0");
    let y = parts[2] ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : new Date().getFullYear().toString();
    const isoDate = `${y}-${m}-${d}`;

    const payload = {
      FuncionarioID: userId,
      NomeFuncionario: userName,
      LojaID: userStore,
      DataInicio: isoDate,
      DataFim: isoDate,
      TipoFolga: "Folga solicitada",
      Motivo: reason,
      Status: "Pendente",
    };

    return {
      type: "action",
      actionType: "request_timeoff",
      title: "Solicitar Folga",
      apiMethod: "createEmployeeTimeOffRequest",
      apiArgs: [payload],
      summary: `Enviar pedido de folga para o dia ${d}/${m}/${y} com motivo: "${reason}".`,
      diff: [
        { label: "Data Solicitada", value: `${d}/${m}/${y}` },
        { label: "Colaborador", value: userName },
        { label: "Motivo", value: reason },
      ],
      details: {
        isoDate,
        reason,
      },
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

  const result = await api.invoke(action.apiMethod, action.apiArgs || []);

  try {
    if (action.actionType.includes("task")) {
      window.dispatchEvent(new CustomEvent("gestao-tasks-refresh"));
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
    const model = getGeminiModel();
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
    const model = getGeminiModel();
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

  async function handleUserInput() {
    const text = input?.value?.trim();
    if (!text) return;
    input.value = "";

    appendUserMessage(text);

    const state = window.__GESTAO_STATE__ || window.state || {};
    const context = {
      user: state.user || window.__GESTAO_USER__,
      employees: state.employees || [],
      tasks: state.tasks || [],
      swaps: state.swaps || [],
      timeOff: state.timeOff || [],
      stores: state.stores || [],
      livePresenceData: state.livePresenceData || [],
      hourBalance: state.timeClockBalance || state.hourBalance,
      currentView: getCurrentView(),
    };

    let intent = null;
    const apiKey = getGeminiApiKey();

    if (apiKey) {
      const currentModel = getGeminiModel();
      const modelLabel = currentModel === "gemini-4-argon" ? "Gemini 4 Argon" : "Gemini Flash";
      const waitMsg = appendAssistantMessage(`Pensando com ${modelLabel}…`);
      try {
        intent = await callGeminiCopilot(text, context);
      } catch (err) {
        console.warn("Falha no Gemini, usando fallback local:", err);
        intent = parseCopilotIntent(text, context);
      } finally {
        waitMsg.remove();
      }
    } else {
      intent = parseCopilotIntent(text, context);
    }

    if (!intent || intent.type === "empty") return;

    if (intent.type === "error") {
      appendAssistantMessage(intent.message);
      return;
    }

    if (intent.type === "query") {
      appendAssistantMessage(intent.reply);
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
  }

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
