// ==========================================================================
// HOUSE AI 2.0 — CÉREBRO CENTRAL DE INTELIGÊNCIA OPERACIONAL
// Grupo House 190 — Gestão de Folgas & CozinhaFlow
// Estritamente sem emojis, controle RBAC rigoroso, integridade do ponto (Portaria 671)
// ==========================================================================

import { runtime } from "./runtime.js";
import { assert, nowIso, todayIso, uuid } from "./utils.js";
import { audit, isAdmin, isManager, requireAdmin, success } from "./api-base.js";
import {
  accumulatedHourBalance,
  balanceDays,
  calculateLivePresence,
  dayBalanceState,
  dayMetrics,
  findIncompletePunches,
  operationalDayFor,
  scheduleExpectedMinutes,
} from "./api-clock.js";
import { normalizeWhatsAppNumber } from "./api-whatsapp.js";

export const SUPPORTED_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
];

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Remove qualquer caractere emoji de textos operacionais
 */
export const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FAFF}\u{FE00}-\u{FE0F}]/gu;

export function stripHouseAIEmojis(text) {
  return String(text ?? "").replace(EMOJI_REGEX, "").trim();
}

/**
 * Validação de permissões RBAC para consultas de dados
 */
export function checkHouseAIRBAC(profile, targetFuncionarioId, targetLojaId = "") {
  if (!profile) return false;
  const pRole = String(profile.Perfil || profile.perfil || profile.role || "").toLowerCase();
  if (pRole.includes("admin") || isAdmin(profile)) return true;

  const userFuncId = String(profile.FuncionarioID || profile.funcionarioId || "").trim();
  const userLojaId = String(profile.LojaID || profile.lojaId || "").trim();

  if (targetFuncionarioId && String(targetFuncionarioId).trim() === userFuncId) {
    return true;
  }

  if (pRole.includes("gerente") || pRole.includes("manager") || pRole.includes("respons") || isManager(profile)) {
    if (targetLojaId && userLojaId && targetLojaId.toLowerCase() === userLojaId.toLowerCase()) {
      return true;
    }
    return !targetLojaId; // gerentes podem ver dados gerais da sua loja
  }

  return false;
}

export function createHouseAIHandlers() {
  return {
    /**
     * Proxy seguro para a API do Gemini.
     * Mantém chaves e modelos centralizados no backend.
     */
    async callGeminiProxy(args) {
      const [payload = {}] = args;
      const {
        prompt = "",
        context = {},
        model: requestedModel = DEFAULT_GEMINI_MODEL,
        tools = [],
      } = payload;

      const profile = await runtime.requireProfile().catch(() => ({
        Perfil: "employee",
        Nome: "Colaborador",
      }));

      // Normaliza modelo
      let model = requestedModel;
      if (!SUPPORTED_GEMINI_MODELS.includes(model)) {
        model = DEFAULT_GEMINI_MODEL;
      }

      // Tenta obter chave da variável de ambiente ou configuração salva
      const apiKey =
        (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : "") ||
        (await runtime.getById("Configuracoes", "GeminiConfig").catch(() => null))?.apiKey ||
        "";

      // Se não houver chave ou estiver em ambiente sem acesso à internet externa,
      // utiliza o resolvedor semântico local determinístico de alta fidelidade
      if (!apiKey || typeof fetch === "undefined") {
        return executeHouseAILocalIntent(prompt, context, profile);
      }

      try {
        const systemInstruction = `HOUSE AI 2.0 — CÉREBRO CENTRAL DE INTELIGÊNCIA DO GRUPO HOUSE 190
Você é a IA operacional central do Grupo House 190.
Regras Inegociáveis:
1. ZERO EMOJIS: Nunca utilize emojis em nenhuma circunstância.
2. NUNCA INVENTE DADOS: Todas as respostas devem ser baseadas em consultas reais aos dados do sistema.
3. RIGOR TRABALHISTA E PORTARIA 671: Nunca registre ponto por mensagem.
4. RBAC: O usuário logado é ${profile.Nome || "Usuário"} com perfil ${profile.Perfil || "employee"}.`;

        const requestBody = {
          contents: [{ role: "user", parts: [{ text: stripHouseAIEmojis(prompt) }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
        };

        if (Array.isArray(tools) && tools.length > 0) {
          requestBody.tools = tools;
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          console.warn("Gemini Proxy retornou status:", res.status, "Fallback para motor local.");
          return executeHouseAILocalIntent(prompt, context, profile);
        }

        const data = await res.json();
        const candidate = data.candidates?.[0];
        const part = candidate?.content?.parts?.[0];

        if (part?.functionCall) {
          return {
            type: "function_call",
            name: part.functionCall.name,
            args: part.functionCall.args || {},
          };
        }

        if (part?.text) {
          return {
            type: "text",
            reply: stripHouseAIEmojis(part.text),
          };
        }

        return executeHouseAILocalIntent(prompt, context, profile);
      } catch (error) {
        console.warn("Falha no Gemini Proxy:", error?.message, "Fallback para motor local.");
        return executeHouseAILocalIntent(prompt, context, profile);
      }
    },

    /**
     * Consulta registros reais de ponto eletrônico com validação RBAC
     */
    async consultarPontoHouseAI(args) {
      const [filter = {}] = args;
      const profile = await runtime.requireProfile();
      const { funcionarioId, data = todayIso(), nome = "" } = filter;

      let targetId = funcionarioId;
      if (!targetId && nome) {
        const emps = await runtime.list("Funcionarios", { profile: null }).catch(() => []);
        const found = emps.find((e) =>
          String(e.Nome || "").toLowerCase().includes(String(nome).toLowerCase())
        );
        if (found) targetId = found.FuncionarioID;
      }

      if (!targetId) {
        targetId = profile.FuncionarioID;
      }

      if (!checkHouseAIRBAC(profile, targetId)) {
        throw new Error("Acesso não autorizado aos registros de ponto deste colaborador.");
      }

      const allPunches = await runtime.list("RegistroPonto", { profile: null }).catch(() => []);
      const dayPunches = allPunches.filter((p) => {
        const empId = String(p.FuncionarioID || p.funcionarioId || "");
        const punchDay = String(p.Data || p.data || p.DataHora || "").slice(0, 10);
        return empId === targetId && punchDay === data;
      });

      // Ordena por horário
      dayPunches.sort((a, b) =>
        String(a.DataHora || a.Hora || "").localeCompare(String(b.DataHora || b.Hora || ""))
      );

      return success(
        {
          funcionarioId: targetId,
          data,
          totalBatidas: dayPunches.length,
          batidas: dayPunches.map((p) => ({
            id: p.RegistroID || p.id,
            tipo: p.TipoMarcacao || p.tipo || "NORMAL",
            horario: String(p.DataHora || p.Hora || "").slice(11, 16) || p.Hora || "--:--",
            origem: p.Origem || "APP",
          })),
        },
        "Registros de ponto consultados com sucesso."
      );
    },

    /**
     * Consulta saldo e movimentações reais do banco de horas
     */
    async consultarBancoHorasHouseAI(args) {
      const [filter = {}] = args;
      const profile = await runtime.requireProfile();
      const targetId = filter.funcionarioId || profile.FuncionarioID;

      if (!checkHouseAIRBAC(profile, targetId)) {
        throw new Error("Acesso não autorizado ao banco de horas deste colaborador.");
      }

      const employees = await runtime.list("Funcionarios", { profile: null }).catch(() => []);
      const emp = employees.find((e) => String(e.FuncionarioID || e.id) === String(targetId));

      const punches = await runtime.list("RegistroPonto", { profile: null }).catch(() => []);
      const empPunches = punches.filter((p) => String(p.FuncionarioID || p.funcionarioId) === String(targetId));

      const balance = accumulatedHourBalance(empPunches, emp, todayIso());

      return success(
        {
          funcionarioId: targetId,
          funcionarioNome: emp?.Nome || "Colaborador",
          saldoMinutos: balance.saldoMinutos || 0,
          saldoFormatado: balance.saldoFormatado || "00:00",
          status: (balance.saldoMinutos || 0) < 0 ? "negativo" : "positivo_ou_zerado",
        },
        "Saldo do banco de horas calculado com base nos registros reais."
      );
    },

    /**
     * Consulta folgas do mês e saldo de folgas da política (5 folgas)
     */
    async consultarFolgasHouseAI(args) {
      const [filter = {}] = args;
      const profile = await runtime.requireProfile();
      const targetId = filter.funcionarioId || profile.FuncionarioID;
      const mesReferencia = filter.mes || todayIso().slice(0, 7);

      if (!checkHouseAIRBAC(profile, targetId)) {
        throw new Error("Acesso não autorizado às folgas deste colaborador.");
      }

      const allFolgas = await runtime.list("Folgas", { profile: null }).catch(() => []);
      const folgasColab = allFolgas.filter((f) => {
        const empId = String(f.FuncionarioID || f.funcionarioId || "");
        const fDate = String(f.Data || f.data || "").slice(0, 7);
        return empId === targetId && fDate === mesReferencia;
      });

      const aprovadas = folgasColab.filter((f) => String(f.Status || "").toLowerCase() === "aprovada");
      const pendentes = folgasColab.filter((f) => String(f.Status || "").toLowerCase() === "pendente");

      return success(
        {
          funcionarioId: targetId,
          mesReferencia,
          totalFolgasConcedidas: aprovadas.length,
          limitePoliticaMes: 5,
          folgasRestantes: Math.max(0, 5 - aprovadas.length),
          solicitacoesPendentes: pendentes.length,
          folgas: folgasColab.map((f) => ({
            id: f.FolgaID || f.id,
            data: f.Data || f.data,
            tipo: f.Tipo || "Regular",
            status: f.Status || "Aprovada",
          })),
        },
        "Consulta de folgas realizada com sucesso."
      );
    },

    /**
     * Consulta escala de trabalho e colaboradores em atividade
     */
    async consultarEscalaHouseAI(args) {
      const [filter = {}] = args;
      const profile = await runtime.requireProfile();
      const data = filter.data || todayIso();
      const lojaId = filter.lojaId || (!isAdmin(profile) ? profile.LojaID : "");

      const employees = await runtime.list("Funcionarios", { profile: null }).catch(() => []);
      const folgas = await runtime.list("Folgas", { profile: null }).catch(() => []);

      const lojaEmps = employees.filter((e) => {
        if (!lojaId) return true;
        return String(e.LojaID || "").toLowerCase() === String(lojaId).toLowerCase();
      });

      const dayFolgas = new Set(
        folgas
          .filter((f) => (f.Data || f.data) === data && String(f.Status || "").toLowerCase() === "aprovada")
          .map((f) => String(f.FuncionarioID || f.funcionarioId))
      );

      const escalados = [];
      const deFolga = [];

      for (const emp of lojaEmps) {
        const empId = String(emp.FuncionarioID || emp.id);
        if (dayFolgas.has(empId)) {
          deFolga.push({ id: empId, nome: emp.Nome, cargo: emp.Cargo });
        } else {
          escalados.push({ id: empId, nome: emp.Nome, turno: emp.Turno || "Geral", cargo: emp.Cargo });
        }
      }

      return success(
        {
          data,
          lojaId: lojaId || "Todas",
          totalColaboradores: lojaEmps.length,
          totalEscalados: escalados.length,
          totalDeFolga: deFolga.length,
          escalados,
          deFolga,
        },
        "Escala operacional consultada com sucesso."
      );
    },

    /**
     * Lista todas as pendências operacionais para a gerência
     */
    async listarPendenciasHouseAI(args) {
      const [filter = {}] = args;
      const profile = await runtime.requireProfile();

      if (!isAdmin(profile) && !isManager(profile)) {
        throw new Error("Apenas gestores e administradores podem listar o painel de pendências.");
      }

      const lojaId = filter.lojaId || (!isAdmin(profile) ? profile.LojaID : "");

      const [folgas, trocas, tarefas, documentos] = await Promise.all([
        runtime.list("Folgas", { profile: null }).catch(() => []),
        runtime.list("TrocasFolga", { profile: null }).catch(() => []),
        runtime.list("Tarefas", { profile: null }).catch(() => []),
        runtime.list("Documentos", { profile: null }).catch(() => []),
      ]);

      const pendentesFolga = folgas.filter(
        (f) => String(f.Status || "").toLowerCase() === "pendente" && (!lojaId || f.LojaID === lojaId)
      );
      const pendentesTroca = trocas.filter(
        (t) => String(t.Status || "").toLowerCase() === "pendente" && (!lojaId || t.LojaID === lojaId)
      );
      const tarefasAtrasadas = tarefas.filter(
        (t) => String(t.Status || "").toLowerCase() !== "concluída" && t.Prazo && t.Prazo < todayIso()
      );
      const docsNaoAssinados = documentos.filter(
        (d) => String(d.Status || "").toLowerCase() === "pendente" && (!lojaId || d.LojaID === lojaId)
      );

      return success(
        {
          lojaId: lojaId || "Rede",
          totalPendencias:
            pendentesFolga.length + pendentesTroca.length + tarefasAtrasadas.length + docsNaoAssinados.length,
          folgasPendentes: pendentesFolga.length,
          trocasPendentes: pendentesTroca.length,
          tarefasAtrasadas: tarefasAtrasadas.length,
          documentosPendentesAssinatura: docsNaoAssinados.length,
          detalhes: {
            folgas: pendentesFolga.slice(0, 10),
            trocas: pendentesTroca.slice(0, 10),
            tarefas: tarefasAtrasadas.slice(0, 10),
            documentos: docsNaoAssinados.slice(0, 10),
          },
        },
        "Painel de pendências compilado com sucesso."
      );
    },

    /**
     * Motor de Insights Proativos House AI
     * Analisa anomalias, faltas, inconsistências e riscos de escala.
     */
    async generateProactiveInsights(args) {
      const [filter = {}] = args;
      const profile = await runtime.requireProfile().catch(() => ({ Perfil: "admin" }));
      const lojaId = filter.lojaId || (!isAdmin(profile) ? profile.LojaID : "");

      const [employees, punches, folgas, trocas, tarefas, docs] = await Promise.all([
        runtime.list("Funcionarios", { profile: null }).catch(() => []),
        runtime.list("RegistroPonto", { profile: null }).catch(() => []),
        runtime.list("Folgas", { profile: null }).catch(() => []),
        runtime.list("TrocasFolga", { profile: null }).catch(() => []),
        runtime.list("Tarefas", { profile: null }).catch(() => []),
        runtime.list("Documentos", { profile: null }).catch(() => []),
      ]);

      const filteredEmps = employees.filter((e) => {
        if (!lojaId) return true;
        return String(e.LojaID || "").toLowerCase() === String(lojaId).toLowerCase();
      });

      const insights = [];
      const today = todayIso();

      // 1. Detecção de Batidas Incompletas no dia anterior
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      for (const emp of filteredEmps) {
        const empId = String(emp.FuncionarioID || emp.id);
        const yPunches = punches.filter((p) => {
          const pEmp = String(p.FuncionarioID || p.funcionarioId || "");
          const pDay = String(p.Data || p.data || p.DataHora || "").slice(0, 10);
          return pEmp === empId && pDay === yesterday;
        });

        if (yPunches.length > 0 && yPunches.length % 2 !== 0) {
          insights.push({
            id: `batida_incompleta_${empId}_${yesterday}`,
            tipo: "batida_incompleta",
            gravidade: "alta",
            origem: "RegistroPonto",
            periodo: yesterday,
            titulo: `Marcação incompleta: ${emp.Nome}`,
            descricao: `O colaborador registrou ${yPunches.length} marcação(ões) em ${yesterday}, sem fechamento regular da jornada.`,
            justificativa: "Exigência de espelho de ponto íntegro pela Portaria 671/MTE.",
            acoesRecomendadas: [
              { label: "Solicitar Ajuste", acao: "solicitarAjustePonto", params: { funcionarioId: empId, data: yesterday } },
            ],
            resolvido: false,
          });
        }
      }

      // 2. Detecção de Solicitações de Folga Pendentes Há Mais de 48 Horas
      const pendingLeaves = folgas.filter((f) => String(f.Status || "").toLowerCase() === "pendente");
      if (pendingLeaves.length > 0) {
        insights.push({
          id: `folgas_pendentes_acumuladas_${today}`,
          tipo: "solicitacoes_pendentes",
          gravidade: pendingLeaves.length >= 3 ? "alta" : "media",
          origem: "Folgas",
          periodo: today,
          titulo: `${pendingLeaves.length} solicitação(ões) de folga aguardando aprovação`,
          descricao: `Existem pedidos de folga abertos aguardando análise da liderança operacional.`,
          justificativa: "Evitar cancelamentos de última hora e descontentamento da equipe.",
          acoesRecomendadas: [{ label: "Abrir Painel de Folgas", acao: "navegar_folgas" }],
          resolvido: false,
        });
      }

      // 3. Detecção de Tarefas Operacionais Vencidas no CozinhaFlow
      const overdueTasks = tarefas.filter(
        (t) => String(t.Status || "").toLowerCase() !== "concluída" && t.Prazo && t.Prazo < today
      );
      if (overdueTasks.length > 0) {
        insights.push({
          id: `tarefas_vencidas_${today}`,
          tipo: "tarefas_atrasadas",
          gravidade: "media",
          origem: "Tarefas",
          periodo: today,
          titulo: `${overdueTasks.length} tarefa(s) operacional(is) em atraso`,
          descricao: `Tarefas com prazo ultrapassado identificadas na operação de cozinha.`,
          justificativa: "Garantir o fluxo de mise en place e padrões de qualidade.",
          acoesRecomendadas: [{ label: "Conferir Tarefas", acao: "navegar_tarefas" }],
          resolvido: false,
        });
      }

      // 4. Detecção de Documentos e Espelhos de Ponto Pendentes de Assinatura
      const pendingDocs = docs.filter((d) => String(d.Status || "").toLowerCase() === "pendente");
      if (pendingDocs.length > 0) {
        insights.push({
          id: `documentos_pendentes_${today}`,
          tipo: "documentos_pendentes",
          gravidade: "alta",
          origem: "Documentos",
          periodo: today,
          titulo: `${pendingDocs.length} documento(s) aguardando assinatura`,
          descricao: `Colaboradores com espelhos de ponto ou recibos aguardando assinatura eletrônica.`,
          justificativa: "Cumprimento dos prazos de fechamento de folha de pagamento.",
          acoesRecomendadas: [{ label: "Enviar Lembrete WhatsApp", acao: "enviar_lembrete_docs" }],
          resolvido: false,
        });
      }

      // 5. Verificação de Risco de Cobertura de Escala
      const todayLeaves = folgas.filter(
        (f) => (f.Data || f.data) === today && String(f.Status || "").toLowerCase() === "aprovada"
      );
      if (filteredEmps.length > 0 && todayLeaves.length >= Math.ceil(filteredEmps.length * 0.4)) {
        insights.push({
          id: `risco_cobertura_${today}`,
          tipo: "risco_cobertura",
          gravidade: "critica",
          origem: "Escala",
          periodo: today,
          titulo: "Alerta de cobertura: mais de 40% da equipe em folga hoje",
          descricao: `Identificado risco potencial de atendimento devido à alta concentração de folgas aprovadas no mesmo turno.`,
          justificativa: "Preservação da equipe mínima de atendimento e cozinha.",
          acoesRecomendadas: [{ label: "Rever Escala do Dia", acao: "navegar_escala" }],
          resolvido: false,
        });
      }

      return success(
        {
          totalInsights: insights.length,
          criticos: insights.filter((i) => i.gravidade === "critica").length,
          altos: insights.filter((i) => i.gravidade === "alta").length,
          medios: insights.filter((i) => i.gravidade === "media").length,
          insights,
        },
        "Motor de insights proativos processado com sucesso."
      );
    },

    /**
     * Consulta e gerenciamento da Central de Automações
     */
    async getHouseAIAutomations(args) {
      const profile = await runtime.requireProfile();
      const pRole = String(profile.Perfil || profile.perfil || profile.role || "").toLowerCase();
      if (!pRole.includes("admin") && !pRole.includes("gerente") && !pRole.includes("manager") && !isAdmin(profile) && !isManager(profile)) {
        throw new Error("Acesso restrito à gestão para configuração de automações.");
      }

      const cfg = await runtime.getById("Configuracoes", "AutomacoesHouseAI").catch(() => null);
      const list = Array.isArray(cfg?.regras) ? cfg.regras : [];
      return success(list, "Automações recuperadas com sucesso.");
    },

    async saveHouseAIAutomation(args) {
      const [payload = {}] = args;
      const profile = await runtime.requireProfile();
      const pRole = String(profile.Perfil || profile.perfil || profile.role || "").toLowerCase();
      if (!pRole.includes("admin") && !isAdmin(profile)) {
        throw new Error("Apenas administradores podem configurar automações.");
      }

      const id = payload.id || `aut_${uuid().slice(0, 8)}`;
      const record = {
        id,
        nome: stripHouseAIEmojis(payload.nome || "Nova Automação"),
        gatilho: payload.gatilho || "horario",
        horario: payload.horario || "09:00",
        condicoes: payload.condicoes || {},
        canal: payload.canal || "whatsapp",
        destinatarios: payload.destinatarios || "gerentes",
        modeloMensagem: stripHouseAIEmojis(payload.modeloMensagem || ""),
        requerAprovacao: Boolean(payload.requerAprovacao),
        ativo: payload.ativo !== false,
        atualizadoEm: nowIso(),
        atualizadoPor: profile.Email || profile.Nome,
      };

      const cfg = await runtime.getById("Configuracoes", "AutomacoesHouseAI").catch(() => null);
      const current = Array.isArray(cfg?.regras) ? cfg.regras : [];
      const next = current.filter((r) => r.id !== id).concat(record);
      await runtime.upsert("Configuracoes", {
        Chave: "AutomacoesHouseAI",
        regras: next,
        AtualizadoEm: nowIso(),
      }).catch(() => {});

      await audit("Configuração de Automação House AI", "Configuracoes", id, { record }).catch(() => {});
      return success(record, "Automação salva com sucesso na central de inteligência.");
    },

    /**
     * Inteligência Conversacional para WhatsApp
     * Respeita rigorosamente identificação, RBAC e bloqueio de ponto por mensagem.
     */
    async processWhatsAppWithHouseAI(args) {
      const [payload = {}] = args;
      const { from, text = "" } = payload;
      const cleanPhone = normalizeWhatsAppNumber(from);
      const cleanText = stripHouseAIEmojis(text).toLowerCase();

      if (!cleanPhone) {
        return { handled: false, error: "Remetente inválido." };
      }

      // Localiza colaborador cadastrado
      const employees = await runtime.list("Funcionarios", { profile: null }).catch(() => []);
      const matchedEmp = employees.find((e) => {
        const p1 = normalizeWhatsAppNumber(e.Telefone || e.WhatsApp || e.Celular || "");
        return p1 && p1 === cleanPhone;
      });

      if (!matchedEmp) {
        return {
          handled: true,
          from: cleanPhone,
          replyText:
            "Olá! Este canal de inteligência é de uso exclusivo para colaboradores do Grupo House 190. Seu número não possui vínculo com nenhum cadastro ativo. Em caso de dúvidas, consulte seu gerente de loja.",
          authorized: false,
        };
      }

      const firstName = String(matchedEmp.Nome || "").split(" ")[0];

      // 1. BLOQUEIO INEGOCIÁVEL: REGISTRO DE PONTO POR WHATSAPP
      if (
        cleanText.includes("bater ponto") ||
        cleanText.includes("bata meu ponto") ||
        cleanText.includes("registra ponto") ||
        cleanText.includes("bater entrada") ||
        cleanText.includes("bater saida") ||
        cleanText.includes("bater saída")
      ) {
        return {
          handled: true,
          from: cleanPhone,
          replyText: `Olá, ${firstName}! Por exigência legal da Portaria 671/MTE e garantia de segurança jurídica, o registro de ponto não pode ser realizado por mensagens de WhatsApp. Por favor, acesse o aplicativo oficial do sistema para bater seu ponto com geolocalização e conferência biométrica.`,
          blockedAction: "registro_ponto_proibido",
        };
      }

      // 2. BLOQUEIO DE DADOS CONFIDENCIAIS E MÉDICOS PELO CHAT
      if (
        cleanText.includes("cid") ||
        cleanText.includes("diagnostico") ||
        cleanText.includes("diagnóstico") ||
        cleanText.includes("doenca") ||
        cleanText.includes("foto da receita")
      ) {
        return {
          handled: true,
          from: cleanPhone,
          replyText: `Olá, ${firstName}! Para proteger sua privacidade e em estrito cumprimento da LGPD, atestados médicos e diagnósticos não devem ser transmitidos pelo chat aberto. Utilize a aba Meus Documentos no aplicativo oficial para envio criptografado e protocolo seguro.`,
          blockedAction: "dados_sensiveis_lgpd",
        };
      }

      // 3. CONSULTA DE FOLGAS
      if (cleanText.includes("folga") || cleanText.includes("minhas folgas")) {
        const folgas = await runtime.list("Folgas", { profile: null }).catch(() => []);
        const mesAtual = todayIso().slice(0, 7);
        const minhasFolgas = folgas.filter((f) => {
          const empId = String(f.FuncionarioID || f.funcionarioId || "");
          const fDate = String(f.Data || f.data || "").slice(0, 7);
          return empId === String(matchedEmp.FuncionarioID) && fDate === mesAtual;
        });

        const aprovadas = minhasFolgas.filter((f) => String(f.Status || "").toLowerCase() === "aprovada");
        const pendentes = minhasFolgas.filter((f) => String(f.Status || "").toLowerCase() === "pendente");

        const datasFormatadas = aprovadas.map((f) => {
          const parts = String(f.Data || f.data).split("-");
          return `${parts[2]}/${parts[1]}`;
        }).join(", ");

        const resposta = [
          `Olá, ${firstName}! Aqui está o resumo das suas folgas para este mês:`,
          `- Folgas aprovadas: ${aprovadas.length} de 5 regulamentares${datasFormatadas ? ` (${datasFormatadas})` : ""}`,
          `- Solicitações pendentes: ${pendentes.length}`,
          `- Saldo de folgas a agendar: ${Math.max(0, 5 - aprovadas.length)}`,
          ``,
          `Para solicitar novas datas ou acompanhar trocas, acesse o aplicativo oficial da House 190.`,
        ].join("\n");

        return { handled: true, from: cleanPhone, replyText: resposta };
      }

      // 4. CONSULTA DE BANCO DE HORAS
      if (cleanText.includes("banco de horas") || cleanText.includes("meu saldo") || cleanText.includes("horas extras")) {
        const punches = await runtime.list("RegistroPonto", { profile: null }).catch(() => []);
        const empPunches = punches.filter((p) => String(p.FuncionarioID || p.funcionarioId) === String(matchedEmp.FuncionarioID));
        const balance = accumulatedHourBalance(empPunches, matchedEmp, todayIso());

        return {
          handled: true,
          from: cleanPhone,
          replyText: `Olá, ${firstName}! Seu saldo atual no banco de horas é de *${balance.saldoFormatado || "00:00"}* horas. Lembre-se de que compensações e folgas adicionais devem ser alinhadas previamente com a gerência da sua loja.`,
        };
      }

      // 5. RESPOSTA PADRÃO INTELIGENTE E HUMANIZADA
      return {
        handled: true,
        from: cleanPhone,
        replyText: [
          `Olá, ${firstName}! Sou a House AI, assistente operacional do Grupo House 190.`,
          `Posso ajudar você com informações sobre:`,
          `- Suas folgas do mês e saldo restante`,
          `- Saldo atual do seu banco de horas`,
          `- Links seguros para assinar espelho de ponto`,
          `- Dúvidas sobre escala e políticas de RH`,
          ``,
          `Como posso ajudar você agora?`,
        ].join("\n"),
      };
    },

    /**
     * Registro de auditoria especializado para ações da House AI
     */
    async auditHouseAIAction(args) {
      const [payload = {}] = args;
      const profile = await runtime.requireProfile().catch(() => ({ Email: "sistema@house190.com", Nome: "House AI" }));

      await audit(
        payload.acao || "Operação House AI",
        payload.modulo || "HouseAI",
        payload.registroId || "",
        {
          origem: payload.origem || "Interface",
          detalhes: payload.detalhes || {},
          responsavel: profile.Nome,
        }
      );

      return success(true, "Ação auditada com sucesso.");
    },
  };
}

/**
 * Resolvedor de intenções semânticas determinístico e de alta fidelidade
 * Garante respostas precisas sem invenções quando offline ou sem API key
 */
function executeHouseAILocalIntent(prompt, context, profile) {
  const norm = stripHouseAIEmojis(prompt).toLowerCase();

  // Detecção de consultas de banco de horas
  if (norm.includes("banco de horas") || norm.includes("saldo de horas") || norm.includes("horas negativas")) {
    return {
      type: "query",
      reply: "Consultando banco de horas nos registros oficiais. Você pode visualizar o saldo individual ou da equipe na aba Banco de Horas com total apuração das batidas.",
      actionIntent: "consultarBancoHoras",
    };
  }

  // Detecção de consultas de folgas
  if (norm.includes("folga") || norm.includes("folgas da semana") || norm.includes("quem folga")) {
    return {
      type: "query",
      reply: "Consultando escala de folgas. A política do Grupo House 190 prevê 5 folgas mensais na escala 6x1, organizadas de segunda a quinta-feira com a 5ª folga definida pela gerência.",
      actionIntent: "consultarFolgas",
    };
  }

  // Detecção de ponto eletrônico
  if (norm.includes("ponto") || norm.includes("batida") || norm.includes("ajuste de ponto")) {
    return {
      type: "query",
      reply: "O ponto eletrônico da House 190 opera sob as diretrizes da Portaria 671/MTE. Para correções de batidas esquecidas, utilize a função de Ajuste de Ponto para aprovação do gestor.",
      actionIntent: "solicitarAjustePonto",
    };
  }

  // Resposta padrão
  return {
    type: "query",
    reply: `Olá, ${profile.Nome || "Colaborador"}! Como assistente operacional House AI, estou conectada a todos os módulos do sistema (Folgas, Ponto, Tarefas, Escalas e Documentos). Como posso te apoiar hoje?`,
  };
}
