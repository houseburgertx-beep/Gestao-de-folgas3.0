/**
 * ==========================================================================
 * ADAPTADOR OPERACIONAL DE RH — GRUPO HOUSE 190
 * Conexão oficial do kit_ia_folgas com os dados reais do sistema
 * Estritamente sem emojis, com validação de RBAC e auditoria
 * ==========================================================================
 */

import { stripEmojis } from "./copilot.js";

export const RH_POLICIES = {
  folgas: `POLÍTICA OFICIAL DE FOLGAS — GRUPO HOUSE 190
1. Programação Mensal: Todo colaborador em escala 6x1 tem direito à programação de 5 (cinco) folgas mensais.
2. Dias Habituais: As folgas habituais são organizadas entre segunda-feira e quinta-feira.
3. Quinta Folga: A quinta folga mensal é definida e organizada pelo gerente responsável da unidade.
4. Escala Contínua CLT: O limite máximo é de 6 dias contínuos de trabalho sem folga.
5. Folga Fixa Semanal: Cada colaborador tem um dia fixo semanal de folga estabelecido em cadastro.`,

  trocas: `POLÍTICA OFICIAL DE TROCAS DE FOLGA — GRUPO HOUSE 190
1. Solicitação pelo Aplicativo: Toda solicitação de troca deve ser enviada exclusivamente pelo aplicativo.
2. Aprovação Gerencial: Toda troca está estritamente condicionada à aprovação prévia do gerente de loja.
3. Manutenção de Cobertura: O gerente verifica a escala e a cobertura da unidade antes de deferir a troca.
4. Ciclo Semanal: A troca de folga semanal opera no ciclo da semana e não altera as semanas seguintes.`,

  escala: `POLÍTICA DE ESCALA E JORNADA — GRUPO HOUSE 190
1. Turnos de Trabalho: Manhã, Tarde, Noite e Integral, conforme escala vigente da unidade.
2. Intervalo Intrajornada: O descanso para refeição é obrigatório e respeita os horários pré-assinalados.
3. Conflitos de Escala: O sistema impede sobreposição de jornadas e escalas acima do limite permitido por lei.`,

  banco_horas: `POLÍTICA DE BANCO DE HORAS — GRUPO HOUSE 190
1. Apuração Líquida: O banco de horas apura a jornada líquida diária baseada nas marcações de ponto.
2. Compensações: Horas extras e saídas antecipadas são compensadas conforme o acordo coletivo vigente.
3. Saldo Transparente: O saldo de horas acumula mensalmente e pode ser consultado no painel do colaborador.`,

  feriados: `POLÍTICA DE FERIADOS — GRUPO HOUSE 190
1. Crédito Automático: Ao salvar um feriado ativo no sistema, é gerado crédito automático de folga para todos os colaboradores em escala.
2. Feriados Municipais: Feriados municipais vinculam-se exclusivamente à unidade/loja do município.
3. Trabalho em Feriado: Acompanhado pelo banco de horas ou folga compensatória conforme legislação aplicável.`,

  ponto: `POLÍTICA DE PONTO ELETRÔNICO — GRUPO HOUSE 190
1. Liberdade e Respeito: A marcação de ponto é livre, célere e sem exigência de validação facial.
2. Tolerância CLT: Aplica-se a tolerância legal para variações de até 5 a 10 minutos na entrada e saída.
3. Correção de Batida: Marcações esquecidas ou incompletas devem ser justificadas pelo gestor da unidade.`,

  atestados: `PROCEDIMENTOS PARA ATESTADOS E AUSÊNCIAS — GRUPO HOUSE 190
1. Prazo de Entrega: Atestados médicos ou odontológicos devem ser comunicados ao gestor em até 48 horas.
2. Lançamento no Sistema: O gestor registra a justificativa com a categoria legal 'Atestado Médico'.
3. Abono de Falta: O atestado médico legal abona a ausência sem gerar débito indevido no banco de horas.`,

  geral: `DIRETRIZES GERAIS DE PESSOAS — GRUPO HOUSE 190
- Atendimento focado em resolver a rotina operacional com precisão e segurança.
- Regra de ouro: Consultar antes de responder, nunca inventar dados e exigir confirmação para ações reais.
- Respeito à CLT, aos acordos coletivos e à dignidade de todos os colaboradores do grupo.`
};

export const hrAdapter = {
  getProfile(actor, context = {}) {
    const employees = Array.isArray(context.employees) ? context.employees : [];
    const emp = employees.find((e) => String(e.FuncionarioID || e.id || "") === String(actor.userId));
    if (!emp) {
      return {
        id: actor.userId,
        nome: actor.userName || "Colaborador",
        cargo: "Equipe",
        lojaId: actor.storeId || "",
        turno: "Padrão",
        folgaFixa: "Segunda-feira",
        perfil: actor.role || "employee"
      };
    }
    return {
      id: emp.FuncionarioID || emp.id,
      nome: emp.Nome || emp.nome,
      cargo: emp.Cargo || emp.Funcao || "Colaborador",
      lojaId: emp.LojaID || emp.lojaId || actor.storeId,
      turno: emp.Turno || "Manhã",
      folgaFixa: emp.FolgaFixaSemanal || "Segunda-feira",
      perfil: actor.role || "employee"
    };
  },

  getSchedule(actor, { from, to }, context = {}) {
    const profile = hrAdapter.getProfile(actor, context);
    const timeOff = Array.isArray(context.timeOff) ? context.timeOff : [];
    const userLeaves = timeOff.filter(
      (f) => String(f.FuncionarioID || f.funcionarioId || "") === String(actor.userId)
    );

    return {
      colaborador: profile.nome,
      periodo: { from, to },
      turno: profile.turno,
      folgaFixaSemanal: profile.folgaFixa,
      solicitacoesPeriodo: userLeaves.map((f) => ({
        dataInicio: f.DataInicio || f.dataInicio,
        dataFim: f.DataFim || f.dataFim,
        tipo: f.TipoFolga || "Folga",
        status: f.Status || "Pendente"
      }))
    };
  },

  getTimeBank(actor, context = {}) {
    const rawBalance = context.timeBalance?.[actor.userId];
    const minutes = typeof rawBalance === "number" ? rawBalance : 0;
    const sign = minutes >= 0 ? "+" : "-";
    const absMin = Math.abs(minutes);
    const h = String(Math.floor(absMin / 60)).padStart(2, "0");
    const m = String(absMin % 60).padStart(2, "0");
    return {
      colaboradorId: actor.userId,
      saldoMinutos: minutes,
      saldoFormatado: `${sign}${h}h ${m}m`,
      status: minutes >= 0 ? "Positivo (horas a compensar)" : "Negativo (horas a cumprir)"
    };
  },

  getRequests(actor, { status = "all" }, context = {}) {
    const timeOff = Array.isArray(context.timeOff) ? context.timeOff : [];
    const swaps = Array.isArray(context.swaps) ? context.swaps : [];

    let userLeaves = timeOff.filter(
      (f) => String(f.FuncionarioID || f.funcionarioId || "") === String(actor.userId)
    );
    let userSwaps = swaps.filter(
      (s) =>
        String(s.FuncionarioOrigemID || "") === String(actor.userId) ||
        String(s.FuncionarioDestinoID || "") === String(actor.userId)
    );

    if (status !== "all") {
      userLeaves = userLeaves.filter((f) => String(f.Status || "").toLowerCase() === status.toLowerCase());
      userSwaps = userSwaps.filter((s) => String(s.Status || "").toLowerCase().includes(status.toLowerCase()));
    }

    return {
      folgas: userLeaves.map((f) => ({
        id: f.ID || f.id,
        data: f.DataInicio || f.Data,
        motivo: f.Motivo || f.TipoFolga,
        status: f.Status || "Pendente"
      })),
      trocas: userSwaps.map((s) => ({
        id: s.TrocaID || s.TrocaPrincipalID,
        origem: `${s.NomeFuncionarioOrigem} (${s.DataFolgaOrigem})`,
        destino: `${s.NomeFuncionarioDestino} (${s.DataFolgaDestino})`,
        status: s.Status || "Pendente"
      }))
    };
  },

  getPolicy(actor, { topic = "folgas" }) {
    const cleanTopic = String(topic || "folgas").toLowerCase().trim();
    return {
      topico: cleanTopic,
      conteudo: stripEmojis(RH_POLICIES[cleanTopic] || RH_POLICIES.folgas)
    };
  },

  getTeamPendingRequests(actor, context = {}) {
    if (actor.role === "employee") {
      throw Object.assign(new Error("Acesso restrito a Gerentes e Administradores."), {
        code: "PERMISSION_DENIED"
      });
    }

    const timeOff = Array.isArray(context.timeOff) ? context.timeOff : [];
    const swaps = Array.isArray(context.swaps) ? context.swaps : [];

    let pendingLeaves = timeOff.filter((f) => String(f.Status || "").toLowerCase() === "pendente");
    let pendingSwaps = swaps.filter((s) => {
      const st = String(s.Status || "").toLowerCase();
      return st.includes("aguardando") || st === "pendente";
    });

    if (actor.role === "manager" && actor.storeId) {
      pendingLeaves = pendingLeaves.filter((f) => String(f.LojaID || "") === String(actor.storeId));
      pendingSwaps = pendingSwaps.filter((s) => String(s.LojaID || "") === String(actor.storeId));
    }

    return {
      totalPendencias: pendingLeaves.length + pendingSwaps.length,
      folgasPendentes: pendingLeaves.map((f) => ({
        id: f.ID || f.id,
        colaborador: f.NomeFuncionario || f.FuncionarioID,
        data: f.DataInicio || f.Data,
        motivo: f.Motivo || "Folga solicitada"
      })),
      trocasPendentes: pendingSwaps.map((s) => ({
        id: s.TrocaID || s.TrocaPrincipalID,
        origem: `${s.NomeFuncionarioOrigem} (${s.DataFolgaOrigem})`,
        destino: `${s.NomeFuncionarioDestino} (${s.DataFolgaDestino})`,
        lojaId: s.LojaID
      }))
    };
  },

  getTeamCoverage(actor, { date }, context = {}) {
    if (actor.role === "employee") {
      throw Object.assign(new Error("Acesso restrito a Gerentes e Administradores."), {
        code: "PERMISSION_DENIED"
      });
    }

    const employees = Array.isArray(context.employees) ? context.employees : [];
    let team = employees;
    if (actor.role === "manager" && actor.storeId) {
      team = team.filter((e) => String(e.LojaID || e.lojaId || "") === String(actor.storeId));
    }

    const working = team.map((e) => `${e.Nome || e.nome} (Turno: ${e.Turno || "Manhã"})`);
    return {
      data: date,
      lojaId: actor.storeId || "Rede Geral",
      totalEquipe: team.length,
      colaboradoresEscalados: working
    };
  }
};
