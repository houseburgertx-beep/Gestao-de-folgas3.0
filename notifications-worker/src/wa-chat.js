import { resolveChatDates, calendarContext } from "./wa-chat-dates.js";
import { withChatLease } from "./wa-chat-lock.js";
import { active, bahiaDay, scheduleForDay, workday } from "../../src/core/reminder-policy.js";
import {
  cleanStr as clean,
  cleanMultiline,
  foldStr as fold,
  empIdOf as id,
  storeIdOf as store,
  isIsoDate as iso,
  formatDateBR,
  formatBRL,
  formatTimeBahia,
  getRoleFlags,
  extractScheduleTimes,
  resolveAuthorizedTarget,
  computeRealHourBalance,
  fetchEmployeeTakeatCredit,
  executeOperationalAction,
} from "./wa-ai-ops.js";

export const GROQ_CHAT_MODEL = "openai/gpt-oss-120b";
const CHAT_TTL = 24 * 60 * 60 * 1000;
const CHAT_SCHEMA = 3;
const schema = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const dateParam = { type: "string", description: "Data ISO AAAA-MM-DD. Resolva hoje/amanhã/ontem usando o calendário oficial." };
const tool = (name, description, parameters = schema()) => ({ type: "function", function: { name, description, parameters } });

const CONSULT_SUBJECTS = [
  "meu_cadastro",
  "minhas_folgas",
  "minha_jornada",
  "minhas_tarefas",
  "minhas_marcacoes",
  "meus_documentos",
  "banco_horas",
  "ajustes_ponto",
  "vales",
  "trocas_folga",
  "feriados_comunicados",
  "minha_equipe",
  "resumo_operacao",
  "ajuda_sistema",
];

const CONSULT_TOOL = tool(
  "consultar_sistema",
  "Consulta dados oficiais em tempo real com permissões da sessão. Gestores e administradores podem consultar qualquer colaborador autorizado informando funcionario_id ou funcionario_nome. Assuntos: meu_cadastro, minhas_folgas, minha_jornada, minhas_tarefas, minhas_marcacoes, banco_horas (cálculo real de saldo + dias incompletos), meus_documentos, ajustes_ponto (pedidos de ajuste/inclusão de ponto), vales (solicitações de vale + limite + saldo de consumo Takeat), trocas_folga, feriados_comunicados (feriados, comunicados e POPs), minha_equipe (lista de colaboradores para gestores), resumo_operacao (visão ao vivo da equipe, quem está trabalhando/intervalo/folga e pendências para gestores), ajuda_sistema.",
  schema(
    {
      assunto: { type: "string", enum: CONSULT_SUBJECTS },
      data: dateParam,
      mes: { type: "string", description: "Mês opcional AAAA-MM para filtro de banco_horas, folgas ou vales." },
      status: { type: "string", enum: ["abertas", "concluidas", "todas"], description: "Para tarefas. Padrão: abertas." },
      funcionario_id: { type: "string", description: "Opcional. Gestor/Admin pode informar ID do colaborador." },
      funcionario_nome: { type: "string", description: "Opcional. Gestor/Admin pode informar nome/parte do nome do colaborador." },
      busca: { type: "string", description: "Opcional. Filtro de texto para minha_equipe ou comunicados." },
    },
    ["assunto"]
  )
);

const LEAVE_PREP_TOOL = tool(
  "preparar_folga",
  "Prepara pedido ou concessão de folga sem gravar ainda. Resuma nome, datas e motivo e peça confirmação na mensagem seguinte. Nunca use em simples consulta ou cancelamento.",
  schema(
    {
      datas: { type: "array", items: dateParam, minItems: 1, maxItems: 7 },
      motivo: { type: "string", maxLength: 200 },
      funcionario_id: { type: "string", description: "Opcional. Só gestor/admin pode usar ID validado pela consulta minha_equipe." },
    },
    ["datas", "motivo"]
  )
);

const WA_OPS_ACTIONS = [
  "incluir_ponto",
  "alterar_ponto",
  "decidir_ajuste_ponto",
  "justificar_ausencia",
  "cancelar_folga",
  "decidir_folga",
  "solicitar_vale",
  "decidir_vale",
  "gerenciar_tarefa",
  "enviar_aviso_whatsapp",
  "publicar_comunicado",
  "decidir_troca_folga",
];

const WA_OPS_TOOL = tool(
  "executar_acao_operacional",
  "Executa ações operacionais reais no sistema oficial (com RBAC e auditoria). Use quando o usuário pedir para resolver: incluir_ponto (gestor lança direto; funcionário abre pedido de inclusão pendente), alterar_ponto (gestor altera direto; funcionário abre pedido de ajuste), decidir_ajuste_ponto (aprovar/rejeitar ajuste pendente), justificar_ausencia (atestado/folga trocada/dia concedido/outros), cancelar_folga (cancela folga e estorna saldo se aprovada), decidir_folga (aprovar/recusar folga pendente), solicitar_vale (registra pedido de vale), decidir_vale (validar pelo gerente, aprovar_pagar pela diretoria com recibo automático, ou recusar), gerenciar_tarefa (operacao: criar ou concluir), enviar_aviso_whatsapp (envia aviso individual/vale, para gerencia, para loja ou rede), publicar_comunicado (mural oficial + opcional WhatsApp), decidir_troca_folga (aprovar/recusar troca). Antes de agir em terceiros, se houver dúvida sobre o colaborador, consulte minha_equipe.",
  schema(
    {
      acao: { type: "string", enum: WA_OPS_ACTIONS },
      funcionario_id: { type: "string", description: "ID oficial do colaborador." },
      funcionario_nome: { type: "string", description: "Nome do colaborador alvo (quando gestor/admin)." },
      data: dateParam,
      horario: { type: "string", description: "Horário HH:MM para incluir_ponto ou alterar_ponto." },
      novo_horario: { type: "string", description: "Novo horário HH:MM para alterar_ponto." },
      tipo_marcacao: { type: "string", enum: ["ENTRADA", "SAIDA_INTERVALO", "RETORNO_INTERVALO", "SEM_DESCANSO", "SAIDA_FINAL"] },
      registro_ponto_id: { type: "string", description: "ID do registro de ponto para alterar_ponto (opcional)." },
      ajuste_ponto_id: { type: "string", description: "ID do ajuste de ponto para decidir_ajuste_ponto." },
      folga_id: { type: "string", description: "ID da folga para cancelar_folga ou decidir_folga." },
      vale_id: { type: "string", description: "ID do vale para decidir_vale." },
      tarefa_id: { type: "string", description: "ID da tarefa para gerenciar_tarefa." },
      troca_id: { type: "string", description: "ID da troca de folga para decidir_troca_folga." },
      decisao: { type: "string", description: "aprovar, recusar, rejeitar, validar ou aprovar_pagar." },
      tipo: { type: "string", description: "Tipo de justificativa (Atestado, Folga trocada, Dia concedido, Outros)." },
      valor: { type: "number", description: "Valor em reais para solicitar_vale." },
      data_desejada: dateParam,
      motivo: { type: "string", maxLength: 300 },
      observacao: { type: "string", maxLength: 300 },
      operacao: { type: "string", enum: ["criar", "concluir"], description: "Para gerenciar_tarefa." },
      titulo: { type: "string", maxLength: 160 },
      descricao: { type: "string", maxLength: 500 },
      prioridade: { type: "string", enum: ["Urgente", "Alta", "Normal", "Media", "Baixa"] },
      prazo: dateParam,
      hora_limite: { type: "string" },
      setor: { type: "string", maxLength: 80 },
      assunto: { type: "string", maxLength: 160 },
      mensagem: { type: "string", maxLength: 2000 },
      destino: { type: "string", description: "Para aviso/comunicado: colaborador, gerencia, loja, rede, Loja local ou Rede completa." },
      loja_id: { type: "string" },
      notificar_whatsapp: { type: "boolean", description: "Se deve notificar o colaborador/equipe no WhatsApp." },
    },
    ["acao"]
  )
);

export const CHAT_TOOLS = [CONSULT_TOOL, LEAVE_PREP_TOOL, WA_OPS_TOOL];

export const APP_CHAT_VIEWS = new Set([
  "dashboard",
  "timeoff",
  "timeclock",
  "tasks",
  "documents",
  "settings",
  "reports",
  "takeat-credit",
  "cashclosing",
  "vales",
  "whatsapp",
]);

const appActions = [
  "criarTarefaCozinha",
  "concluirTarefa",
  "solicitarFolga",
  "lancarFolga",
  "cancelarFolga",
  "decidirSolicitacaoFolga",
  "solicitarAjustePonto",
  "incluirPontoManual",
  "justificarAusencia",
  "solicitarVale",
  "decidirVale",
  "enviarAvisoWhatsApp",
  "publicarComunicado",
  "cadastrarFeriado",
  "aprovarTrocaFolga",
];

export const APP_CHAT_TOOLS = [
  CONSULT_TOOL,
  tool(
    "preparar_acao_app",
    "Prepara um cartão de ação para revisão e confirmação pelo botão no aplicativo. Nunca grava diretamente pelo chat do app. Use imediatamente quando o usuário pedir uma ação com os campos obrigatórios: criarTarefaCozinha, concluirTarefa, solicitarFolga, lancarFolga, cancelarFolga, decidirSolicitacaoFolga, solicitarAjustePonto, incluirPontoManual, justificarAusencia, solicitarVale, decidirVale, enviarAvisoWhatsApp, publicarComunicado, cadastrarFeriado, aprovarTrocaFolga. IDs devem vir das consultas oficiais.",
    schema(
      {
        acao: { type: "string", enum: appActions },
        funcionario_id: { type: "string" },
        funcionario_nome: { type: "string" },
        data: dateParam,
        horario: { type: "string", description: "Horário HH:MM para ajuste ou inclusão de ponto." },
        tipo_marcacao: { type: "string", enum: ["ENTRADA", "SAIDA_INTERVALO", "RETORNO_INTERVALO", "SEM_DESCANSO", "SAIDA_FINAL"] },
        registro_ponto_id: { type: "string" },
        folga_id: { type: "string" },
        vale_id: { type: "string" },
        valor: { type: "number" },
        decisao: { type: "string" },
        motivo: { type: "string", maxLength: 300 },
        titulo: { type: "string", maxLength: 160 },
        prioridade: { type: "string", enum: ["Urgente", "Alta", "Normal", "Media", "Baixa"] },
        prazo: { type: "string", description: "Data ISO AAAA-MM-DD, opcional." },
        mensagem: { type: "string", maxLength: 2000 },
        destino: { type: "string", enum: ["Loja local", "Rede completa", "Colaborador"] },
        nome: { type: "string", maxLength: 160 },
        tipo: { type: "string", description: "Nacional/Estadual/Municipal para feriado ou Atestado/Folga trocada/Dia concedido/Outros para ausência." },
      },
      ["acao"]
    )
  ),
];

export function createAppActionTools(options) {
  const { employee, employees = [], profile = {}, now = Date.now(), setProposal } = options;
  const { isAdmin: admin, isManager: manager, isKitchenLead } = getRoleFlags(profile, employee);
  const storeId = store(employee) || store(profile);
  const read = createEmployeeTools({ ...options, setPending: () => {} });
  const text = (value, max) => {
    if (typeof value !== "string" || !clean(value) || value.length > max) {
      throw Error("Informe os campos obrigatórios sem ultrapassar o limite de tamanho.");
    }
    return clean(value);
  };
  const date = (value) => {
    if (typeof value !== "string" || !iso(value)) throw Error("Informe uma data válida em AAAA-MM-DD.");
    return value;
  };
  return async (name, args = {}) => {
    if (name === "consultar_sistema") {
      return read(name, args);
    }
    if (name !== "preparar_acao_app") {
      return { erro: "No aplicativo, alterações só são preparadas em cartões. Nenhuma operação foi executada." };
    }
    try {
      if (!args || typeof args !== "object" || Array.isArray(args) || !appActions.includes(args.acao)) {
        throw Error("Ação indisponível. Use a aba correspondente no aplicativo.");
      }
      const action = args.acao;
      const employeeAllowed = new Set(["solicitarFolga", "cancelarFolga", "solicitarAjustePonto", "solicitarVale", "concluirTarefa"]);
      if (!employeeAllowed.has(action) && !manager && !(action === "criarTarefaCozinha" && isKitchenLead)) {
        throw Error("Essa preparação exige permissão de gestão.");
      }
      if (action === "cadastrarFeriado" && !admin) {
        throw Error("Somente a administração pode preparar cadastro de feriado.");
      }
      if (!admin && !storeId) {
        throw Error("Vincule uma unidade ao cadastro antes de preparar alterações.");
      }

      let target = employee;
      if (args.funcionario_id || args.funcionario_nome) {
        const resolved = resolveAuthorizedTarget({
          employee,
          employees,
          profile,
          targetId: args.funcionario_id,
          targetName: args.funcionario_nome,
        });
        if (!resolved.ok) throw Error(resolved.erro);
        target = resolved.target;
      }

      const result = {};
      if (action === "solicitarFolga" || action === "lancarFolga") {
        if (id(target).startsWith("app:")) throw Error("Escolha um colaborador vinculado para preparar folgas.");
        result.data = date(args.data);
        if (result.data < bahiaDay(now)) throw Error("Escolha uma data de hoje em diante.");
        result.motivo = text(args.motivo, 200);
        result.colaboradorId = id(target);
        result.colaboradorNome = clean(target.Nome);
      } else if (action === "cancelarFolga") {
        if (args.folga_id) result.folgaId = clean(args.folga_id);
        if (args.data) result.data = date(args.data);
        result.motivo = clean(args.motivo || "Cancelamento solicitado via House AI").slice(0, 200);
        result.colaboradorId = id(target);
        result.colaboradorNome = clean(target.Nome);
      } else if (action === "decidirSolicitacaoFolga") {
        result.colaboradorNome = clean(args.funcionario_nome || target?.Nome || "");
        if (args.folga_id) result.folgaId = clean(args.folga_id);
        result.decisao = fold(args.decisao) === "recusar" || fold(args.decisao) === "rejeitar" ? "recusar" : "aprovar";
        result.motivo = clean(args.motivo || "");
      } else if (action === "solicitarAjustePonto" || action === "incluirPontoManual") {
        result.data = date(args.data || bahiaDay(now));
        result.horario = text(args.horario, 10);
        result.tipoMarcacao = clean(args.tipo_marcacao || "SAIDA_FINAL");
        result.motivo = text(args.motivo, 250);
        if (args.registro_ponto_id) result.registroPontoId = clean(args.registro_ponto_id);
        result.colaboradorId = id(target);
        result.colaboradorNome = clean(target.Nome);
      } else if (action === "justificarAusencia") {
        result.nome = clean(target.Nome);
        result.funcionarioId = id(target);
        result.data = date(args.data);
        result.tipo = clean(args.tipo || "Outros");
        result.motivo = clean(args.motivo || "Justificativa via House AI");
      } else if (action === "solicitarVale") {
        const valor = Number(args.valor);
        if (!Number.isFinite(valor) || valor <= 0) throw Error("Informe um valor válido para o vale.");
        result.valor = valor;
        result.motivo = text(args.motivo, 250);
        result.dataDesejada = args.data ? date(args.data) : bahiaDay(now);
        result.colaboradorId = id(target);
        result.colaboradorNome = clean(target.Nome);
      } else if (action === "decidirVale") {
        if (args.vale_id) result.valeId = clean(args.vale_id);
        result.colaboradorId = id(target);
        result.colaboradorNome = clean(target.Nome);
        result.decisao = clean(args.decisao || (admin ? "aprovar_pagar" : "validar"));
        result.motivo = clean(args.motivo || "");
      } else if (action === "enviarAvisoWhatsApp") {
        result.mensagem = text(args.mensagem, 1500);
        result.titulo = clean(args.titulo || "Aviso House 190");
        result.destino = clean(args.destino || "Colaborador");
        if (target && !id(target).startsWith("app:")) {
          result.colaboradorId = id(target);
          result.colaboradorNome = clean(target.Nome);
        }
      } else if (action === "criarTarefaCozinha") {
        result.titulo = text(args.titulo, 160);
        result.prioridade = args.prioridade || "Normal";
        if (!["Urgente", "Alta", "Normal", "Media", "Baixa"].includes(result.prioridade)) throw Error("Prioridade inválida.");
        if (args.prazo) result.prazo = date(args.prazo);
        if (args.funcionario_id || args.funcionario_nome) {
          result.responsavelId = id(target);
          result.responsavelNome = clean(target.Nome);
        }
      } else if (action === "concluirTarefa") {
        result.titulo = clean(args.titulo || "");
      } else if (action === "aprovarTrocaFolga") {
        result.colaborador = clean(args.funcionario_nome || target?.Nome || "");
      } else if (action === "publicarComunicado") {
        result.titulo = text(args.titulo, 160);
        result.mensagem = text(args.mensagem, 2000);
        result.destino = args.destino || "Loja local";
        if (!["Loja local", "Rede completa"].includes(result.destino) || (!admin && result.destino !== "Loja local")) {
          throw Error("Destino fora do escopo autorizado.");
        }
      } else if (action === "cadastrarFeriado") {
        result.nome = text(args.nome, 160);
        result.data = date(args.data);
        result.tipo = args.tipo || "Nacional";
        if (!["Nacional", "Estadual", "Municipal"].includes(result.tipo)) throw Error("Tipo de feriado inválido.");
        if (result.tipo === "Municipal") {
          if (!storeId) throw Error("Escolha a unidade no aplicativo antes de cadastrar feriado municipal.");
          result.lojaId = storeId;
        }
      }

      const proposal = {
        type: "function_call",
        name: action,
        args: result,
        executed: false,
        reply: "Preparei a proposta no cartão abaixo para você revisar e confirmar pelo botão. Nenhuma alteração foi gravada ainda.",
      };
      setProposal?.(proposal);
      return { preparado: true, gravado: false, ...proposal };
    } catch (error) {
      return { erro: error.message || "Não foi possível preparar a proposta. Use a aba correspondente." };
    }
  };
}

export function createEmployeeTools({
  employee,
  employees = [],
  profile = {},
  database,
  env,
  tok,
  now,
  setPending,
  reasonContext,
  requestedDates,
  sendWhatsApp = null,
  fetcher = fetch,
  onScheduleQueried = null,
}) {
  const employeeId = id(employee);
  const storeId = store(employee) || store(profile);
  const today = bahiaDay(now);
  const { role, isAdmin: admin, isManager: manager } = getRoleFlags(profile, employee);
  const url = String(env.APP_URL || "https://houseburgertx-beep.github.io/Gestao-de-folgas3.0/").replace(/\/+$/, "") + "/";
  const cache = new Map();
  const rows = async (table) => {
    if (!cache.has(table)) {
      cache.set(
        table,
        Promise.resolve(database(env, tok, `tables/${table}`)).then((data) => Object.values(data || {}))
      );
    }
    return cache.get(table);
  };
  const dateOf = (value) => {
    const valueOrDefault = value || today;
    if (!iso(valueOrDefault)) throw Error("Informe data válida em AAAA-MM-DD.");
    return valueOrDefault;
  };
  const allowedEmployees = employees.filter(
    (row) => (row.Ativo === undefined || active(row.Ativo)) && (admin || (storeId && store(row) === storeId))
  );

  const resolveConsultSubject = (args) => {
    if (!args?.funcionario_id && !args?.funcionario_nome) return { ok: true, target: employee };
    if (!manager) return { ok: true, target: employee };
    return resolveAuthorizedTarget({
      employee,
      employees,
      profile,
      targetId: args.funcionario_id,
      targetName: args.funcionario_nome,
    });
  };

  return async function execute(name, args = {}) {
    try {
      if (!employeeId) {
        return { erro: "Cadastro sem vínculo de funcionário. Peça à gerência para vincular seu acesso antes de consultar registros." };
      }

      if (name === "executar_acao_operacional") {
        if (!WA_OPS_ACTIONS.includes(args.acao)) return { erro: "Ação operacional não permitida." };
        return executeOperationalAction({
          acao: args.acao,
          args,
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

      if (name === "consultar_sistema") {
        if (!CONSULT_SUBJECTS.includes(args.assunto)) return { erro: "Consulta não permitida." };
        name = args.assunto;
      }

      const syntheticSelf = employeeId.startsWith("app:") || employeeId.startsWith("wa-admin:");
      const selfLessTools = ["meu_cadastro", "minha_equipe", "resumo_operacao", "ajuda_sistema", "feriados_comunicados", "ajustes_ponto", "vales", "trocas_folga"];
      if (syntheticSelf && !selfLessTools.includes(name) && !args?.funcionario_id && !args?.funcionario_nome && name !== "preparar_folga") {
        return {
          erro: "Seu acesso administrativo não tem vínculo direto de colaborador. Informe o nome ou ID do colaborador para consultar este registro.",
        };
      }

      const subjectRes = resolveConsultSubject(args);
      if (!subjectRes.ok) return subjectRes;
      const subject = subjectRes.target;
      const subjectId = id(subject);
      const subjectStore = store(subject) || storeId;
      const belongsToSubject = (row) =>
        Boolean(subjectId) &&
        String(row?.FuncionarioID || row?.funcionarioId || "") === subjectId &&
        (!store(row) || (subjectStore && store(row) === subjectStore));

      switch (name) {
        case "meu_cadastro": {
          const units = await rows("Lojas");
          const unit = units.find((row) => store(row) === subjectStore || String(row.id || "") === subjectStore);
          return {
            nome: clean(subject.Nome),
            funcionarioId: subjectId,
            cargo: clean(subject.Cargo),
            turno: clean(subject.Turno),
            unidade: clean(unit?.NomeLoja || unit?.Nome || subject.NomeLoja),
            perfil: clean(subject.Perfil || profile.Perfil),
            folgaFixa: clean(subject.DiaFolgaPreferencial || subject.FolgaFixaSemanal || ""),
            saldoFolgas:
              subject.SaldoFolgas !== undefined && subject.SaldoFolgas !== null && subject.SaldoFolgas !== "" && Number.isFinite(Number(subject.SaldoFolgas))
                ? Number(subject.SaldoFolgas)
                : null,
          };
        }

        case "minhas_folgas": {
          const date = args.data ? dateOf(args.data) : null;
          const mes = args.mes && /^\d{4}-\d{2}$/.test(args.mes) ? args.mes : "";
          const leaves = (await rows("Folgas"))
            .filter(belongsToSubject)
            .filter((row) => {
              const ini = String(row.DataInicio || row.Data || "").slice(0, 10);
              const fim = String(row.DataFim || row.DataInicio || row.Data || "").slice(0, 10);
              if (date) return ini <= date && fim >= date;
              if (mes) return ini.startsWith(mes) || fim.startsWith(mes);
              return fim >= today.slice(0, 7) + "-01";
            })
            .sort((a, b) => String(a.DataInicio || a.Data || "").localeCompare(String(b.DataInicio || b.Data || "")));
          return {
            colaborador: clean(subject.Nome),
            data: date,
            hoje: today,
            parcial: leaves.length > 25,
            registros: leaves.slice(0, 25).map((row) => ({
              folgaId: row.FolgaID || row.id || null,
              inicio: row.DataInicio || row.Data,
              fim: row.DataFim || row.DataInicio || row.Data,
              status: row.Status,
              tipo: row.TipoFolga || row.Tipo,
              motivo: clean(row.Motivo || ""),
            })),
            saldoCadastrado:
              subject.SaldoFolgas !== undefined && subject.SaldoFolgas !== null && subject.SaldoFolgas !== "" && Number.isFinite(Number(subject.SaldoFolgas))
                ? Number(subject.SaldoFolgas)
                : null,
            observacao: "Lista de folgas cadastradas; para descanso fixo semanal, consulte minha_jornada. Pendente ainda não é aprovada.",
          };
        }

        case "minha_jornada": {
          const date = dateOf(args.data);
          const [schedules, leaves] = await Promise.all([rows("JornadasPonto"), rows("Folgas")]);
          const schedule = scheduleForDay(schedules, subjectId, date);
          onScheduleQueried?.();
          if (!schedule) {
            return {
              colaborador: clean(subject.Nome),
              data: date,
              jornadaEncontrada: false,
              folgaFixaCadastro: clean(subject.DiaFolgaPreferencial || subject.FolgaFixaSemanal || ""),
              observacao: "Não há jornada ativa/vigente cadastrada para esta data.",
            };
          }
          const times = extractScheduleTimes(schedule);
          return {
            colaborador: clean(subject.Nome),
            data: date,
            jornadaEncontrada: true,
            diaDeTrabalho: workday(subject, schedule, date, leaves.filter(belongsToSubject)),
            entrada: times.entrada,
            intervaloInicio: times.intervaloInicio,
            intervaloFim: times.intervaloFim,
            saida: times.saida,
            duracaoIntervaloMinutos: times.duracaoIntervaloMinutos,
            toleranciaMinutos: times.toleranciaMinutos,
            cargaDiariaMinutos: times.cargaDiariaMinutos,
            folgaFixa: clean(subject.DiaFolgaPreferencial || ""),
            fonte: "Jornada ativa e folgas cadastradas",
          };
        }

        case "minhas_tarefas": {
          const date = args.data ? dateOf(args.data) : null;
          const allTasks = await rows("Tarefas");
          const tasks = allTasks
            .filter((row) => {
              const status = fold(row.Status || row.STATUS || row.Coluna);
              const done = ["concluida", "concluido", "visto"].includes(status);
              const cancelled = ["cancelada", "cancelado"].includes(status);
              return args.status === "todas" ? true : args.status === "concluidas" ? done : !done && !cancelled;
            })
            .filter((row) => {
              if (manager && !args.funcionario_id && !args.funcionario_nome && syntheticSelf) {
                return admin || (storeId && store(row) === storeId);
              }
              return String(row.FuncionarioID || row.RESPONSAVEL_ID || "") === subjectId && (!store(row) || (subjectStore && store(row) === subjectStore));
            })
            .filter((row) => !date || String(row.DataTurno || row.DATA_TURNO || row.Prazo || row.PRAZO || "").slice(0, 10) === date);
          return {
            colaborador: clean(subject.Nome),
            data: date,
            total: tasks.length,
            parcial: tasks.length > 20,
            registros: tasks.slice(0, 20).map((row) => ({
              tarefaId: row.TarefaID || row.ID || row.id || null,
              titulo: clean(row.Titulo || row.TITULO),
              status: clean(row.Status || row.STATUS || row.Coluna),
              prioridade: clean(row.Prioridade || row.PRIORIDADE),
              setor: clean(row.Setor || ""),
              responsavel: clean(row.NomeFuncionario || row.RESPONSAVEL_NOME || ""),
              data: row.DataTurno || row.Prazo || null,
              horaLimite: clean(row.HoraLimite || ""),
            })),
          };
        }

        case "minhas_marcacoes": {
          const explicitDate = args.data ? dateOf(args.data) : null;
          const targetDate = explicitDate || today;
          let punches = await rows("RegistrosPonto");
          if (!punches.length) punches = await rows("RegistroPonto").catch(() => []);
          const ownPunches = punches.filter((row) => belongsToSubject(row) && row.Status !== "Substituído");
          const dayRecords = ownPunches
            .filter((row) => String(row.Data || row.DataHora || "").slice(0, 10) === targetDate)
            .sort((a, b) => String(a.DataHora || a.Hora || "").localeCompare(String(b.DataHora || b.Hora || "")));

          let ultimosDias = undefined;
          if (!explicitDate && dayRecords.length === 0) {
            ultimosDias = ownPunches
              .filter((row) => String(row.Data || row.DataHora || "").slice(0, 10) <= today)
              .sort((a, b) => String(b.DataHora || b.Data || "").localeCompare(String(a.DataHora || a.Data || "")))
              .slice(0, 12)
              .map((row) => ({
                registroPontoId: row.RegistroPontoID || row.id,
                data: String(row.Data || row.DataHora || "").slice(0, 10),
                hora: formatTimeBahia(row.DataHora || row.Hora),
                tipo: row.TipoMarcacao,
                status: row.Status,
              }));
          }

          return {
            colaborador: clean(subject.Nome),
            data: targetDate,
            registros: dayRecords.map((row) => ({
              registroPontoId: row.RegistroPontoID || row.id,
              hora: formatTimeBahia(row.DataHora || row.Hora),
              tipo: row.TipoMarcacao,
              status: row.Status,
              origem: clean(row.Origem || ""),
              ajustado: Boolean(row.Ajustado),
              observacoes: clean(row.Observacoes || ""),
            })),
            ...(ultimosDias ? { ultimosRegistrosRecentes: ultimosDias } : {}),
          };
        }

        case "banco_horas": {
          const [punchesA, punchesB, schedules, leaves, justifications, movements] = await Promise.all([
            rows("RegistrosPonto"),
            rows("RegistroPonto").catch(() => []),
            rows("JornadasPonto"),
            rows("Folgas"),
            rows("JustificativasPonto").catch(() => []),
            rows("BancoHorasMovimentos").catch(() => []),
          ]);
          const punches = punchesA.length ? punchesA : punchesB;
          const balance = computeRealHourBalance({
            employee: subject,
            punches,
            schedules,
            leaves,
            justifications,
            movements,
            today,
            month: args.mes || "",
          });
          return {
            colaborador: clean(subject.Nome),
            ...balance,
            url: `${url}?view=timeclock`,
          };
        }

        case "meus_documentos": {
          const docs = (await rows("Documentos"))
            .filter(belongsToSubject)
            .filter((row) => !/atestado|cid|diagnostico|saude/.test(fold([row.Tipo, row.Categoria, row.Titulo, row.Nome].filter(Boolean).join(" "))));
          return {
            colaborador: clean(subject.Nome),
            registros: docs.slice(0, 25).map((row) => ({
              docId: row.DocID || row.DocumentoID || row.id || null,
              titulo: clean(row.Titulo || row.Nome || row.Tipo),
              tipo: clean(row.Tipo || ""),
              status: clean(row.Status || row.StatusAssinatura || ""),
              mesReferencia: clean(row.MesReferencia || row.Competencia || ""),
            })),
            url: `${url}?view=documents`,
          };
        }

        case "ajustes_ponto": {
          const allAdj = await rows("AjustesPonto");
          const filtered = allAdj
            .filter((row) => {
              if (!manager) return empIdOfRow(row) === employeeId;
              if (args.funcionario_id || args.funcionario_nome) return empIdOfRow(row) === subjectId;
              return admin || (storeId && store(row) === storeId);
            })
            .filter((row) => !args.data || String(row.Data || "").slice(0, 10) === clean(args.data))
            .sort((a, b) => String(b.DataSolicitacao || "").localeCompare(String(a.DataSolicitacao || "")));
          return {
            total: filtered.length,
            pendentes: filtered.filter((r) => r.Status === "Pendente").length,
            registros: filtered.slice(0, 20).map((row) => ({
              ajustePontoId: row.AjustePontoID || row.id,
              colaborador: clean(row.NomeFuncionario),
              funcionarioId: empIdOfRow(row),
              data: row.Data,
              tipoAjuste: clean(row.TipoAjuste || (row.RegistroPontoID ? "Alteração" : "Inclusão")),
              tipoMarcacao: row.TipoMarcacao,
              horarioOriginal: row.DataHoraOriginal ? formatTimeBahia(row.DataHoraOriginal) : null,
              horarioSolicitado: formatTimeBahia(row.DataHoraSolicitada),
              motivo: clean(row.Motivo),
              status: row.Status,
            })),
          };
        }

        case "vales": {
          const [allVales, configs, stores] = await Promise.all([
            rows("SolicitacoesVale").catch(() => []),
            database(env, tok, "tables/Configuracoes").catch(() => ({})),
            rows("Lojas").catch(() => []),
          ]);
          const filtered = allVales
            .filter((row) => {
              if (!manager) return empIdOfRow(row) === employeeId;
              if (args.funcionario_id || args.funcionario_nome) return empIdOfRow(row) === subjectId;
              return admin || (storeId && store(row) === storeId);
            })
            .filter((row) => !args.mes || String(row.Competencia || row.DataDesejada || "").startsWith(args.mes))
            .sort((a, b) => String(b.DataCriacao || "").localeCompare(String(a.DataCriacao || "")));

          const targetStoreForLimit = subjectStore || storeId;
          const storeLimit = Number(configs?.[`LimiteMaximoVale_${targetStoreForLimit}`]?.Valor || 0);
          const globalLimit = Number(configs?.["LimiteMaximoVale"]?.Valor || 0);
          const limiteMaximoVale = storeLimit > 0 ? storeLimit : globalLimit > 0 ? globalLimit : 1000;

          const consumoTakeat =
            !syntheticSelf || args.funcionario_id || args.funcionario_nome
              ? await fetchEmployeeTakeatCredit(env, subject, stores, fetcher)
              : null;

          return {
            colaborador: syntheticSelf && !args.funcionario_id && !args.funcionario_nome ? "Visão gerencial" : clean(subject.Nome),
            limiteMaximoVale: formatBRL(limiteMaximoVale),
            totalVales: filtered.length,
            pendentes: filtered.filter((v) => ["Solicitado", "Validado pelo Gerente"].includes(String(v.Status || ""))).length,
            solicitacoesVale: filtered.slice(0, 20).map((row) => ({
              valeId: row.ValeID || row.id,
              colaborador: clean(row.FuncionarioNome),
              funcionarioId: empIdOfRow(row),
              unidade: clean(row.NomeLoja || store(row)),
              valor: formatBRL(row.Valor),
              valorNumero: Number(row.Valor || 0),
              motivo: clean(row.Motivo),
              dataDesejada: row.DataDesejada,
              competencia: row.Competencia,
              status: row.Status,
            })),
            consumoTakeat: consumoTakeat || { disponivel: false, url: `${url}?view=takeat-credit` },
          };
        }

        case "trocas_folga": {
          const allSwaps = await rows("TrocasFolga").catch(() => []);
          const filtered = allSwaps.filter((row) => {
            if (!manager) return String(row.FuncionarioOrigemID) === employeeId || String(row.FuncionarioDestinoID) === employeeId;
            return admin || (storeId && store(row) === storeId);
          });
          return {
            total: filtered.length,
            registros: filtered.slice(0, 20).map((row) => ({
              trocaId: row.TrocaID || row.id,
              origem: clean(row.NomeFuncionarioOrigem),
              dataOrigem: row.DataFolgaOrigem,
              destino: clean(row.NomeFuncionarioDestino),
              dataDestino: row.DataFolgaDestino,
              status: row.Status,
              motivo: clean(row.Motivo || ""),
            })),
          };
        }

        case "feriados_comunicados": {
          const [feriados, comunicados, pops] = await Promise.all([
            rows("Feriados").catch(() => []),
            rows("Comunicados").catch(() => []),
            rows("POPsTreinamentos").catch(() => []),
          ]);
          const q = fold(args.busca || "");
          const filterStore = (r) => !store(r) || admin || store(r) === storeId;
          return {
            feriadosProximos: feriados
              .filter((f) => filterStore(f) && String(f.Data || "") >= today)
              .sort((a, b) => String(a.Data || "").localeCompare(String(b.Data || "")))
              .slice(0, 12)
              .map((f) => ({ nome: clean(f.NomeFeriado || f.Nome), data: f.Data, tipo: clean(f.Tipo || "") })),
            comunicadosRecentes: comunicados
              .filter((c) => filterStore(c) && (!q || fold(`${c.Titulo} ${c.Corpo}`).includes(q)))
              .sort((a, b) => String(b.DataCriacao || "").localeCompare(String(a.DataCriacao || "")))
              .slice(0, 10)
              .map((c) => ({ titulo: clean(c.Titulo), corpo: clean(c.Corpo).slice(0, 350), data: String(c.DataCriacao || "").slice(0, 10), autor: clean(c.Autor || "") })),
            pops: pops
              .filter((p) => filterStore(p) && (!q || fold(`${p.Titulo} ${p.Categoria}`).includes(q)))
              .slice(0, 10)
              .map((p) => ({ titulo: clean(p.Titulo), categoria: clean(p.Categoria || "") })),
          };
        }

        case "minha_equipe": {
          if (!manager) return { erro: "Acesso restrito à gestão. Funcionário consulta apenas seus dados." };
          const q = fold(args.busca || "");
          const list = allowedEmployees
            .filter((row) => !q || fold(`${row.Nome} ${row.Cargo} ${row.NomeLoja} ${row.Turno}`).includes(q))
            .slice(0, 100);
          return {
            total: list.length,
            colaboradores: list.map((row) => ({
              id: id(row),
              nome: clean(row.Nome),
              cargo: clean(row.Cargo),
              turno: clean(row.Turno),
              lojaId: store(row),
              unidade: clean(row.NomeLoja || store(row)),
              perfil: clean(row.Perfil || "Funcionário"),
              folgaFixa: clean(row.DiaFolgaPreferencial || ""),
              saldoFolgas: row.SaldoFolgas ?? null,
              temTelefone: Boolean(row.Telefone || row.WhatsApp || row.Celular),
            })),
          };
        }

        case "resumo_operacao": {
          if (!manager) return { erro: "Visão operacional da equipe é restrita à gestão e administração." };
          const date = dateOf(args.data);
          const [punches, folgas, ajustes, vales, tarefas] = await Promise.all([
            rows("RegistrosPonto").catch(() => []),
            rows("Folgas").catch(() => []),
            rows("AjustesPonto").catch(() => []),
            rows("SolicitacoesVale").catch(() => []),
            rows("Tarefas").catch(() => []),
          ]);
          const inScopeIds = new Set(allowedEmployees.map((e) => id(e)));
          const dayPunches = punches.filter(
            (p) => inScopeIds.has(empIdOfRow(p)) && String(p.Data || p.DataHora || "").slice(0, 10) === date && p.Status !== "Substituído"
          );
          const punchesByEmp = new Map();
          for (const p of dayPunches) {
            const eid = empIdOfRow(p);
            const arr = punchesByEmp.get(eid) || [];
            arr.push(p);
            punchesByEmp.set(eid, arr);
          }

          const approvedOffToday = new Set(
            folgas
              .filter(
                (f) =>
                  inScopeIds.has(empIdOfRow(f)) &&
                  ["aprovada", "concluida"].includes(fold(f.Status)) &&
                  String(f.DataInicio || f.Data || "").slice(0, 10) <= date &&
                  String(f.DataFim || f.DataInicio || f.Data || "").slice(0, 10) >= date
              )
              .map((f) => empIdOfRow(f))
          );

          const trabalhando = [];
          const emIntervalo = [];
          const encerrados = [];
          const deFolga = [];

          for (const emp of allowedEmployees) {
            const eid = id(emp);
            const label = `${clean(emp.Nome)} (${clean(emp.NomeLoja || emp.Turno || "")})`;
            if (approvedOffToday.has(eid)) {
              deFolga.push(label);
              continue;
            }
            const list = (punchesByEmp.get(eid) || []).sort((a, b) => String(a.DataHora || "").localeCompare(String(b.DataHora || "")));
            if (!list.length) continue;
            const last = list.at(-1);
            if (last.TipoMarcacao === "SAIDA_FINAL") encerrados.push(label);
            else if (last.TipoMarcacao === "SAIDA_INTERVALO") emIntervalo.push(label);
            else trabalhando.push(label);
          }

          const folgasPendentes = folgas.filter((f) => inScopeIds.has(empIdOfRow(f)) && fold(f.Status) === "pendente");
          const ajustesPendentes = ajustes.filter((a) => inScopeIds.has(empIdOfRow(a)) && a.Status === "Pendente");
          const valesPendentes = vales.filter((v) => inScopeIds.has(empIdOfRow(v)) && ["Solicitado", "Validado pelo Gerente"].includes(String(v.Status || "")));
          const tarefasAbertas = tarefas.filter(
            (t) =>
              (admin || (storeId && store(t) === storeId)) &&
              !["concluida", "concluido", "cancelada", "cancelado", "visto"].includes(fold(t.Status || t.Coluna))
          );

          return {
            data: formatDateBR(date),
            totalEquipeAtiva: allowedEmployees.length,
            trabalhandoAgora: trabalhando.slice(0, 20),
            emIntervaloAgora: emIntervalo.slice(0, 15),
            turnoEncerrado: encerrados.slice(0, 20),
            deFolgaHoje: deFolga.slice(0, 20),
            pendencias: {
              folgasPendentes: folgasPendentes.slice(0, 10).map((f) => ({
                folgaId: f.FolgaID || f.id,
                colaborador: clean(f.NomeFuncionario),
                data: formatDateBR(f.DataInicio || f.Data),
                motivo: clean(f.Motivo),
              })),
              ajustesPontoPendentes: ajustesPendentes.slice(0, 10).map((a) => ({
                ajustePontoId: a.AjustePontoID || a.id,
                colaborador: clean(a.NomeFuncionario),
                data: formatDateBR(a.Data),
                tipo: a.TipoMarcacao,
                horarioSolicitado: formatTimeBahia(a.DataHoraSolicitada),
              })),
              valesPendentes: valesPendentes.slice(0, 10).map((v) => ({
                valeId: v.ValeID || v.id,
                colaborador: clean(v.FuncionarioNome),
                valor: formatBRL(v.Valor),
                status: v.Status,
              })),
              tarefasAbertasTotal: tarefasAbertas.length,
              tarefasUrgentes: tarefasAbertas.filter((t) => fold(t.Prioridade) === "urgente").length,
            },
          };
        }

        case "ajuda_sistema":
          return {
            empresa: "Grupo House 190 (House Burger Teixeira de Freitas, House 190 Eunápolis e House Food Park).",
            escalaFolgas: "Escala 6x1 (44h semanais / 7h20 diárias), política de 5 folgas mensais. Pedidos, aprovações e cancelamentos com estorno automático de saldo podem ser feitos direto por aqui conforme o perfil.",
            ponto: "Registro de batida ao vivo é feito exclusivamente no app com foto e GPS (Portaria 671/MTE). Porém inclusão de ponto esquecido, alteração de horário, aprovação de ajustes e justificativa de faltas podem ser abertos (funcionário) ou executados diretamente com auditoria (gestor/admin) por aqui.",
            valesConsumo: "Solicitações de vale salarial seguem fluxo Solicitado -> Validado pelo Gerente -> Pago pela Diretoria (com geração automática do Recibo de Vale para assinatura). Saldo de consumo interno nas lojas vem do Takeat.",
            documentosLGPD: "Atestados médicos, receitas e CIDs devem ser enviados apenas pela aba Meus Documentos no app (LGPD), prazo de 48h. Espelhos de ponto mensais e recibos de vale são assinados eletronicamente no app.",
            cozinhaFlow: "Tarefas operacionais de cozinha e salão podem ser consultadas, criadas e concluídas direto pelo chat.",
            app: url,
          };

        case "preparar_folga": {
          const dates = [...new Set(requestedDates?.length ? requestedDates : args.datas || [])];
          if (!dates.length || dates.length > 7 || dates.some((d) => !iso(d) || d < today)) {
            return { erro: "Escolha entre uma e sete datas válidas, de hoje em diante." };
          }
          const target = args.funcionario_id || employeeId;
          const person = target === employeeId ? employee : manager ? allowedEmployees.find((row) => id(row) === target) : null;
          if (!person) return { erro: "Funcionário não autorizado. Não crie nem altere pedidos para essa pessoa." };
          const reason = clean(args.motivo).slice(0, 200);
          if (reason && reasonContext !== undefined && !fold(reasonContext).includes(fold(reason))) {
            return {
              erro: "O motivo não foi informado nessas palavras pela pessoa. Pergunte o motivo se ainda estiver faltando; se já foi informado, use o trecho exato da mensagem dela. Não invente nem preencha motivo genérico.",
            };
          }
          if (!reason) return { erro: "Pergunte o motivo antes de preparar." };
          const days = dates.map((d) => d.split("-").reverse().join("/")).join(" e ");
          const prefix = manager ? `dar folga para ${fold(person.Nome)} nos dias` : "quero folga nos dias";
          const proposal = {
            targetEmployeeId: id(person),
            authorizationRole: role,
            legacyText: `${prefix} ${days} motivo: ${reason}`,
            nome: clean(person.Nome),
            datas: dates,
            motivo: reason,
            createdAt: now,
          };
          setPending(proposal);
          return {
            preparado: true,
            gravado: false,
            ...proposal,
            orientacao: "Apresente nome, datas e motivo. Diga que ainda não foi enviado e pergunte se pode confirmar. Somente a próxima mensagem explícita de confirmação permite gravar.",
          };
        }

        default:
          return { erro: "Ferramenta não permitida." };
      }
    } catch {
      return { erro: "Não foi possível consultar os registros agora. Não conclua que não existem dados; informe a indisponibilidade e ofereça nova tentativa." };
    }
  };
}

function empIdOfRow(row) {
  return String(row?.FuncionarioID || row?.funcionarioId || row?.id || "").trim();
}

export function hasUnsupportedGuidance(reply, preparedThisTurn = false, scheduleQueried = false) {
  const value = fold(reply);
  if (preparedThisTurn && /\b(enviei|solicitei|registrei|aprovei|concedi)\b/.test(value)) return true;
  if (/(?:posso|podemos|vou|vamos) abrir (?:um )?registro de atraso/.test(value)) return true;
  if (!scheduleQueried) {
    if (/(?:tolerancia|prazo|limite permitido)[^.?!\n]{0,100}\d|\b\d+\s*(?:minutos?|horas?|dias?)[^.?!\n]{0,100}(?:tolerancia|sem justificativa)|dentro d[ao] (?:limite de )?tolerancia|sem (?:precisar de )?justificativa/.test(value)) {
      return true;
    }
  }
  return false;
}

function validHistory(state, employee, now, identity) {
  if (
    !state ||
    state.version !== CHAT_SCHEMA ||
    !state.identity ||
    ["uid", "role", "channel"].some((key) => state.identity[key] !== identity[key]) ||
    state.employeeId !== id(employee) ||
    state.storeId !== store(employee) ||
    !Number.isFinite(state.at) ||
    now - state.at < 0 ||
    now - state.at > CHAT_TTL
  ) {
    return [];
  }
  return (Array.isArray(state.messages) ? state.messages : [])
    .filter((message) => ["user", "assistant"].includes(message.role) && typeof message.content === "string")
    .slice(-18)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 2400) }));
}

export async function runGroqConversation(options) {
  return withChatLease(options.env, options.memory?.key, () => runGroqConversationUnlocked(options));
}

async function runGroqConversationUnlocked({
  env,
  employee,
  employees,
  profile,
  database,
  tok,
  now = Date.now(),
  text,
  memory,
  executeLegacy,
  fetcher = fetch,
  channel = "whatsapp",
  authScope = {},
  appContext = {},
  sendWhatsApp = null,
}) {
  if (!env.GROQ_API_KEY) return null;
  if (!memory?.load || !memory?.save) {
    return {
      handled: true,
      authorized: true,
      action: "chat_memory_unavailable",
      replyText: "A memória da conversa está indisponível. Tente novamente em instantes; seus registros não foram alterados.",
    };
  }

  const started = Date.now();
  const messages = [];
  let providerStatus = null;
  let repairUsed = false;
  let preparedThisTurn = false;
  let scheduleQueried = false;
  let state;

  try {
    state = await memory?.load();
  } catch {
    return {
      handled: true,
      authorized: true,
      action: "chat_memory_unavailable",
      replyText: "Não consegui recuperar nossa conversa agora. Tente novamente em alguns instantes; seus registros não foram alterados.",
    };
  }

  const { role, isAdmin, isManager } = getRoleFlags(profile, employee);
  const identity = { uid: clean(authScope.uid || id(employee)), role, channel: channel === "app" ? "app" : "whatsapp" };
  let history = validHistory(state, employee, now, identity);
  let appProposal = null;
  let pending =
    channel !== "app" &&
    history.length &&
    state?.pending &&
    now - state.pending.createdAt <= 10 * 60000 &&
    state.pending.authorizationRole === role
      ? state.pending
      : null;

  const normalized = fold(text).replace(/[!.?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  const changedDates = resolveChatDates(text, now);
  if (pending && changedDates && JSON.stringify([...pending.datas].sort()) !== JSON.stringify([...changedDates].sort())) {
    pending = null;
  }

  const persist = async (reply) => {
    if (memory) {
      await memory.save({
        version: CHAT_SCHEMA,
        identity,
        employeeId: id(employee),
        storeId: store(employee),
        at: now,
        messages: [...history, { role: "user", content: clean(text).slice(0, 2400) }, { role: "assistant", content: reply.slice(0, 2800) }].slice(-20),
        pending,
      });
    }
  };

  if (/^(limpar conversa|reiniciar conversa|nova conversa|apagar contexto|recomecar)$/.test(normalized)) {
    history = [];
    pending = null;
    await memory.save({ version: CHAT_SCHEMA, identity, employeeId: id(employee), storeId: store(employee), at: now, messages: [], pending: null });
    return {
      handled: true,
      authorized: true,
      action: "chat_reset",
      replyText: "Reiniciei o contexto desta conversa. Seus registros no sistema continuam iguais. Como posso ajudar?",
    };
  }

  if (
    pending &&
    /^(sim(?: pode (?:enviar|mandar|confirmar))?(?: por favor)?|confirmo(?: o pedido| a solicitacao)?|confirmar|confirmado|envia(?: por favor)?|envie(?: por favor)?|enviar|manda(?: por favor)?|mande|pode (?:enviar|mandar|confirmar)|isso mesmo|ok pode enviar)$/.test(
      normalized
    )
  ) {
    const proposal = pending;
    pending = null;
    try {
      await persist("Confirmação recebida. Vou consultar o resultado da operação.");
    } catch {
      return { handled: true, authorized: true, action: "chat_memory_unavailable", replyText: "Não consegui validar a confirmação agora. Nenhuma alteração foi enviada." };
    }
    const target =
      proposal.targetEmployeeId === id(employee)
        ? employee
        : isManager
          ? employees.find((person) => id(person) === proposal.targetEmployeeId && (person.Ativo === undefined || active(person.Ativo)) && (isAdmin || store(person) === store(employee)))
          : null;
    if (!target) {
      const reply = "O cadastro ou a autorização dessa proposta mudou. Não enviei a alteração. Vamos conferir os dados e preparar novamente?";
      await persist(reply);
      return { handled: true, authorized: true, action: "chat_proposal_invalid", replyText: reply };
    }
    const days = proposal.datas.map((d) => d.split("-").reverse().join("/")).join(" e ");
    const requestText = `${isManager ? "dar folga para " + fold(target.Nome) : "quero folga"} nos dias ${days} motivo: ${clean(proposal.motivo)}`;
    const result = await executeLegacy(requestText);
    await persist(result.replyText).catch(() => {});
    return result;
  }

  if (/^(cancelar|cancela|nao|nao (?:confirmar|enviar|envia|envie|manda|mande)|desistir)$/.test(normalized) && pending) {
    pending = null;
    const reply = "Tudo bem, descartei a proposta. Nenhuma alteração foi enviada. Como posso ajudar?";
    await persist(reply);
    return { handled: true, authorized: true, action: "chat_cancelled", replyText: reply };
  }

  const today = bahiaDay(now);
  const currentView = APP_CHAT_VIEWS.has(appContext.currentView) ? appContext.currentView : "dashboard";
  const authorityDesc = isAdmin
    ? "ADMINISTRADOR / DIRETORIA (autoridade TOTAL em TODAS as unidades: Teixeira de Freitas, Eunápolis e Food Park. Pode consultar qualquer colaborador, incluir/alterar ponto direto com auditoria, aprovar/rejeitar ajustes e folgas, cancelar folgas com estorno de saldo, aprovar/pagar/recusar vales com recibo automático, enviar avisos individuais ou em massa pelo WhatsApp, criar/concluir tarefas e publicar comunicados)."
    : isManager
      ? `GERENTE / RESPONSÁVEL DE LOJA (autoridade operacional completa na sua unidade ${clean(employee.NomeLoja || store(employee))}: consultar equipe e operação ao vivo, incluir/alterar ponto direto, aprovar/rejeitar ajustes e folgas, cancelar folgas com estorno, validar/recusar vales, criar/concluir tarefas, publicar comunicados e enviar avisos pelo WhatsApp para sua equipe).`
      : "COLABORADOR (pode consultar todos os seus próprios registros — escala, batidas, banco de horas real, folgas, vales, consumo Takeat, tarefas e documentos — solicitar folgas, cancelar próprios pedidos pendentes, abrir pedidos oficiais de inclusão ou alteração de ponto para aprovação da gerência, solicitar vale, concluir próprias tarefas e enviar aviso à gerência).";

  const system = `Você é a House AI, assistente executiva inteligente e operacional do Grupo House 190 (House Burger Teixeira de Freitas, House 190 Eunápolis e House Food Park), conversando ${channel === "app" ? "no aplicativo oficial (tela " + currentView + ")" : "no WhatsApp"} em português brasileiro.

PERSONALIDADE, INTELIGÊNCIA E CONHECIMENTO GERAL:
- Seja genuinamente inteligente, proativa, clara, natural e resolutiva. Entenda contexto implícito, continuações, pronomes, gírias comuns e correções de mensagens anteriores pelo histórico.
- Nunca repita menus genéricos ou apresentações robóticas. Jamais use emojis.
- Além de dominar 100% o sistema House 190, você possui amplo conhecimento geral: gestão de restaurantes e hamburguerias, boas práticas de cozinha e vigilância sanitária, atendimento ao cliente, liderança, redação de comunicados/avisos, matemática, cálculos de escala/faturamento e noções gerais de CLT (sempre deixando claro quando algo exige conferência com RH/contador). Responda perguntas gerais de forma útil e natural, sem bloquear o usuário.

CALENDÁRIO OFICIAL (Bahia, UTC-3) — Hoje é ${today}:
${calendarContext(now)}
Use exatamente estas datas ao resolver hoje, ontem, amanhã e dias da semana. Nunca calcule dia da semana de cabeça.

USUÁRIO AUTENTICADO E NÍVEL DE AUTORIDADE:
- Nome: ${clean(employee.Nome)} | Cargo: ${clean(employee.Cargo || "Não informado")} | Perfil: ${clean(profile.Perfil || employee.Perfil)} | Unidade: ${clean(employee.NomeLoja || store(employee) || "Todas")} | ID: ${id(employee)}
- Autoridade: ${authorityDesc}

USO DE FERRAMENTAS E RESOLUÇÃO REAL DE PROBLEMAS:
- Para QUALQUER dado do sistema (ponto, banco de horas, folgas, escala, equipe, vales, consumo Takeat, tarefas, ajustes pendentes, documentos, operação ao vivo), consulte primeiro a ferramenta consultar_sistema. Nunca invente números, horários ou status.
- Nunca invente regras de tolerância de atraso sem antes consultar minha_jornada. Se alguém disser que vai atrasar, acolha, consulte a jornada se útil, calcule a diferença de minutos e ofereça enviar o aviso à gerência ou redigir a mensagem.
- ${
    channel === "app"
      ? "NO APLICATIVO: use preparar_acao_app para preparar o cartão de confirmação de qualquer ação (criarTarefaCozinha, concluirTarefa, solicitarFolga, lancarFolga, cancelarFolga, decidirSolicitacaoFolga, solicitarAjustePonto, incluirPontoManual, justificarAusencia, solicitarVale, decidirVale, enviarAvisoWhatsApp, publicarComunicado, cadastrarFeriado, aprovarTrocaFolga). Quando tiver os campos obrigatórios, chame preparar_acao_app imediatamente sem pedir permissão antes. Nunca grave nem diga que já executou antes do clique no botão do cartão."
      : "NO WHATSAPP: você tem autoridade para RESOLVER problemas de verdade usando ferramentas!\n  1) Para PEDIR ou CONCEDER nova folga: use preparar_folga (quando data e motivo foram informados pela pessoa; nunca invente motivo genérico — se faltar motivo, pergunte apenas o motivo). Depois de preparar_folga, resuma e peça confirmação.\n  2) Para TODAS AS OUTRAS OPERAÇÕES (alterar_ponto, incluir_ponto, decidir_ajuste_ponto, justificar_ausencia, cancelar_folga, decidir_folga, solicitar_vale, decidir_vale, gerenciar_tarefa, enviar_aviso_whatsapp, publicar_comunicado, decidir_troca_folga): use executar_acao_operacional diretamente assim que identificar sem ambiguidade o colaborador e os campos obrigatórios! Se houver dúvida (ex.: mais de um colaborador com o mesmo nome, falta horário, falta valor ou motivo), faça UMA pergunta curta e objetiva antes de executar.\n  3) Se um gestor pedir para incluir ou alterar ponto, cancelar folga, aprovar/avisar vale ou mandar aviso para alguém, RESOLVA na hora usando as ferramentas (consulte minha_equipe/minhas_marcacoes/vales/minhas_folgas se precisar confirmar IDs antes de executar) e informe o resultado confirmado pelo sistema com os detalhes."
  }
- Nunca afirme que gravou, alterou, cancelou, aprovou ou enviou algo sem retorno ok:true da ferramenta.
- Segurança e privacidade inegociáveis: nunca registre batida de ponto ao vivo como se fosse o relógio biométrico (Portaria 671/MTE; inclusão/ajuste de ponto esquecido segue a ferramenta oficial auditada); nunca solicite nem exponha CPF, senhas ou dados médicos/CIDs (atestados vão para a aba Meus Documentos); nunca ignore permissões RBAC.
${pending ? `\nPROPOSTA DE FOLGA PENDENTE (AINDA NÃO ENVIADA): ${JSON.stringify({ nome: pending.nome, datas: pending.datas, motivo: pending.motivo })}. Se a pessoa confirmar ("sim", "envia", "pode mandar"), ela será gravada.` : ""}`;

  messages.push({ role: "system", content: system }, ...history, { role: "user", content: clean(text).slice(0, 3000) });

  const priorDateRequest = [...history]
    .reverse()
    .find((m) => m.role === "user" && /folga|folgar|vez de|troca|na verdade/i.test(m.content) && resolveChatDates(m.content, now));
  const requestedDates = resolveChatDates(text, now) || resolveChatDates(priorDateRequest?.content, now);

  const toolOptions = {
    employee,
    employees,
    profile,
    database,
    env,
    tok,
    now,
    requestedDates,
    reasonContext: [...history.filter((m) => m.role === "user").map((m) => m.content), text].join("\n"),
    sendWhatsApp,
    fetcher,
    onScheduleQueried: () => {
      scheduleQueried = true;
    },
    setPending: (proposal) => {
      pending = proposal;
      preparedThisTurn = true;
    },
  };

  const executeTool =
    channel === "app"
      ? createAppActionTools({
          ...toolOptions,
          setProposal: (proposal) => {
            appProposal = proposal;
            preparedThisTurn = true;
          },
        })
      : createEmployeeTools(toolOptions);

  const MAX_ROUNDS = 6;
  const BUDGET_MS = 45000;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (Date.now() - started > BUDGET_MS) throw Error("chat_timeout");
      const modelName = env.GROQ_MODEL || GROQ_CHAT_MODEL;
      const response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages,
          tools: channel === "app" ? APP_CHAT_TOOLS : CHAT_TOOLS,
          tool_choice: round === MAX_ROUNDS - 1 ? "none" : "auto",
          parallel_tool_calls: false,
          temperature: 0.25,
          max_completion_tokens: 2200,
          ...(modelName.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
        }),
        signal: AbortSignal.timeout(Math.max(1, Math.min(18000, BUDGET_MS - (Date.now() - started)))),
      });
      if (!response.ok) {
        providerStatus = response.status;
        throw Error(`groq_http_${response.status}`);
      }
      const payload = await response.json();
      const message = payload.choices?.[0]?.message;
      if (!message) throw Error("invalid_model_response");
      const calls = message.tool_calls;

      if (Array.isArray(calls) && calls.length && round < MAX_ROUNDS - 1) {
        messages.push({ role: "assistant", content: message.content || null, tool_calls: calls.slice(0, 4) });
        for (const call of calls.slice(0, 4)) {
          let result;
          try {
            const args = JSON.parse(call.function?.arguments || "{}");
            let timer;
            try {
              result = await Promise.race([
                executeTool(call.function?.name, args),
                new Promise((_, reject) => {
                  timer = setTimeout(() => reject(Error("tool_timeout")), Math.max(1, BUDGET_MS - (Date.now() - started)));
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
          } catch {
            result = { erro: "Argumentos inválidos. Peça esclarecimento sem executar alterações." };
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12000) });
        }

        if (channel !== "app" && preparedThisTurn && pending) {
          const dates = pending.datas
            .map((d) =>
              new Intl.DateTimeFormat("pt-BR", {
                timeZone: "America/Bahia",
                weekday: "long",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              }).format(new Date(`${d}T12:00:00Z`))
            )
            .join(" e ");
          const reply = `Preparei o pedido de ${pending.nome} para ${dates}. Motivo: ${pending.motivo}. Ainda não foi enviado. Posso enviar?`;
          await persist(reply);
          return { handled: true, authorized: true, action: "groq_conversation", provider: "groq", model: modelName, replyText: reply };
        }

        if (channel === "app" && appProposal) {
          const reply = appProposal.reply;
          await persist(reply);
          return {
            handled: true,
            authorized: true,
            action: "groq_conversation",
            provider: "groq",
            model: modelName,
            replyText: reply,
            data: { ...appProposal, provider: "groq", model: modelName },
          };
        }
        continue;
      }

      const reply = cleanMultiline(String(message.content || "").replace(/<think>[\s\S]*?<\/think>/g, "")).slice(0, 3200);
      if (!reply) throw Error("empty_model_response");

      if (
        channel !== "app" &&
        !pending &&
        /folga/i.test(reply) &&
        /posso (?:confirmar|enviar|preparar)|vou preparar|ainda n[aã]o foi enviad|voc[eê] (?:pediu|solicitou)/i.test(reply) &&
        !/cancelad|aprovad|recusad|rejeitad/i.test(reply)
      ) {
        if (repairUsed || round === MAX_ROUNDS - 1) throw Error("missing_leave_proposal");
        repairUsed = true;
        messages.push(
          { role: "assistant", content: reply },
          {
            role: "system",
            content:
              "Não existe pedido de folga preparado no sistema. Não apresente confirmação fictícia. Use preparar_folga se a pessoa informou data e motivo; se o motivo não foi informado, pergunte apenas o motivo, mantendo a data correta do calendário.",
          }
        );
        continue;
      }

      if (channel === "app" && !appProposal && /\b(?:vou preparar|preparei|posso enviar|preparar um cart[aã]o|cart[aã]o de a[cç][aã]o)\b/i.test(reply)) {
        if (repairUsed || round === MAX_ROUNDS - 1) throw Error("missing_app_proposal");
        repairUsed = true;
        messages.push(
          { role: "assistant", content: reply },
          {
            role: "system",
            content:
              "Nenhum cartão foi preparado. Se os campos obrigatórios estão disponíveis, chame preparar_acao_app agora. Se faltar um campo, pergunte apenas por ele. Não prometa cartão inexistente e não peça autorização para preparar; a confirmação será pelo botão do aplicativo.",
          }
        );
        continue;
      }

      if (hasUnsupportedGuidance(reply, preparedThisTurn, scheduleQueried)) {
        if (repairUsed || round === MAX_ROUNDS - 1) throw Error("unsupported_model_guidance");
        repairUsed = true;
        messages.push(
          { role: "assistant", content: reply },
          {
            role: "system",
            content:
              "Revise a resposta anterior antes do envio: ela contém regra de tolerância sem fonte consultada, ação fictícia ou afirmação de que uma proposta pendente já foi executada. Remova a regra inventada e responda de forma natural com os fatos consultados.",
          }
        );
        continue;
      }

      await persist(reply);
      return {
        handled: true,
        authorized: true,
        action: "groq_conversation",
        provider: "groq",
        model: modelName,
        replyText: reply,
        ...(channel === "app"
          ? {
              data: appProposal
                ? { ...appProposal, reply, provider: "groq", model: modelName }
                : { type: "query", reply, provider: "groq", model: modelName },
            }
          : {}),
      };
    }
  } catch (error) {
    console.warn("House AI chat unavailable:", /^groq_http_\d+$/.test(error.message) ? error.message : "chat_unavailable");
  }

  const failureReply =
    providerStatus === 429
      ? "Meu limite de atendimento está temporariamente ocupado. Tente novamente em instantes; nenhuma alteração foi feita no sistema."
      : "Não consegui concluir sua resposta agora. Pode tentar novamente em instantes? Nenhuma alteração foi feita no sistema.";
  pending = preparedThisTurn ? null : pending;
  await persist(failureReply).catch(() => {});
  return { handled: true, authorized: true, action: "groq_unavailable", providerStatus, replyText: failureReply };
}
