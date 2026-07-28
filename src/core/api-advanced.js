import { APP } from "./constants.js";
import { runtime } from "./runtime.js";
import {
  asBoolean,
  assert,
  csvDataUrl,
  dateRange,
  nowIso,
  todayIso,
  uuid,
} from "./utils.js";
import {
  audit,
  createNotification,
  dropClientToken,
  isAdmin,
  isManager,
  requireAdmin,
  requireManager,
  scopeRecord,
  success,
} from "./api-base.js";
import { clockContext } from "./api-clock.js";

const filterAudience = (rows, profile) =>
  rows.filter((item) => {
    if (item.Ativo === false) return false;
    if (item.ExpiraEm && new Date(item.ExpiraEm).getTime() < Date.now()) {
      return false;
    }
    if (item.LojaID && item.LojaID !== profile.LojaID && !isAdmin(profile)) {
      return false;
    }
    const audience = String(item.PublicoAlvo || "Todos").toLowerCase();
    if (audience === "todos") return true;
    if (audience.includes("funcion")) {
      return String(profile.Perfil).toLowerCase().includes("funcion");
    }
    if (audience.includes("gest")) return isManager(profile);
    return true;
  });

const employeeById = async (id) => {
  const employee = await runtime.getById("Funcionarios", id);
  assert(employee, "Funcionário não encontrado.");
  return employee;
};

export function createAdvancedHandlers() {
  return {
    async getOperationalRules() {
      return success(await runtime.list("RegrasOperacionais"));
    },

    async saveOperationalRule(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const payload = args[0] || {};
      if (payload.LojaID) scopeRecord(profile, payload);
      const current = payload.RegraOperacionalID
        ? await runtime.getById(
            "RegrasOperacionais",
            payload.RegraOperacionalID,
          )
        : null;
      const store = payload.LojaID
        ? await runtime.getById("Lojas", payload.LojaID)
        : null;
      const saved = await runtime.upsert("RegrasOperacionais", {
        ...(current || {}),
        ...payload,
        RegraOperacionalID: current?.RegraOperacionalID || uuid(),
        NomeLoja: store?.NomeLoja || payload.NomeLoja || "",
        Ativa: payload.Ativa !== false,
        DataCriacao: current?.DataCriacao || nowIso(),
        CriadoPor: current?.CriadoPor || profile.Email,
        DataAtualizacao: nowIso(),
      });
      return success(saved, "Regra operacional guardada.");
    },

    async getTimeOffSwaps() {
      return success(await runtime.list("TrocasFolga"));
    },

    async getTimeOffSwapCandidates() {
      const profile = await runtime.requireProfile();
      const [employees, timeOff] = await Promise.all([
        runtime.list("Funcionarios", { profile }),
        runtime.list("Folgas", { profile }),
      ]);
      const active = employees.filter((item) => asBoolean(item.Ativo));
      return success(
        active.map((employee) => ({
          ...employee,
          folgas: timeOff.filter(
            (item) =>
              item.FuncionarioID === employee.FuncionarioID &&
              item.Status === APP.status.approved &&
              item.DataInicio >= todayIso(),
          ),
        })),
      );
    },

    async createTimeOffSwap(args) {
      const profile = await runtime.requireProfile();
      const payload = args[0] || {};
      const origin = await runtime.getById(
        "Folgas",
        payload.folgaOrigemId || payload.FolgaOrigemID,
      );
      assert(origin, "Folga de origem não encontrada.");
      scopeRecord(profile, origin);
      const destinationEmployee = await employeeById(
        payload.funcionarioDestinoId || payload.FuncionarioDestinoID,
      );
      assert(
        origin.LojaID === destinationEmployee.LojaID,
        "A troca deve ocorrer entre funcionários da mesma loja.",
      );
      const saved = await runtime.upsert("TrocasFolga", {
        TrocaID: uuid(),
        FolgaOrigemID: origin.FolgaID,
        FolgaDestinoOriginalID:
          payload.folgaDestinoId || payload.FolgaDestinoID || "",
        FuncionarioOrigemID: origin.FuncionarioID,
        NomeFuncionarioOrigem: origin.NomeFuncionario,
        FuncionarioDestinoID: destinationEmployee.FuncionarioID,
        NomeFuncionarioDestino: destinationEmployee.Nome,
        LojaID: origin.LojaID,
        DataFolgaOrigem: origin.DataInicio,
        DataFolgaDestino: payload.dataFolgaDestino || "",
        Motivo: String(payload.motivo || payload.Motivo || ""),
        Status: "Aguardando aceite",
        AceiteDestino: "",
        DataAceiteDestino: "",
        DecididoPor: "",
        DataDecisao: "",
        ObservacaoGestor: "",
        DataCriacao: nowIso(),
        CriadoPor: profile.Email,
        DataAtualizacao: nowIso(),
      });
      await createNotification({
        employeeId: destinationEmployee.FuncionarioID,
        email: destinationEmployee.Email,
        storeId: origin.LojaID,
        subject: "Proposta de troca de folga",
        message: `${origin.NomeFuncionario} enviou uma proposta de troca.`,
        type: "Troca",
        relatedId: saved.TrocaID,
      });
      return success(saved, "Proposta de troca enviada.");
    },

    async respondTimeOffSwap(args) {
      const profile = await runtime.requireProfile();
      const [id, accept] = args;
      const current = await runtime.getById("TrocasFolga", id);
      assert(current, "Proposta não encontrada.");
      assert(
        isManager(profile) ||
          current.FuncionarioDestinoID === profile.FuncionarioID,
        "Somente o destinatário pode responder.",
      );
      const accepted = asBoolean(accept);
      const saved = await runtime.patch("TrocasFolga", id, {
        AceiteDestino: accepted,
        DataAceiteDestino: nowIso(),
        Status: accepted ? "Aguardando gestor" : "Recusada",
        DataAtualizacao: nowIso(),
      });
      return success(saved, accepted ? "Troca aceita." : "Troca recusada.");
    },

    async decideTimeOffSwap(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const [id, approve, observation] = args;
      const current = await runtime.getById("TrocasFolga", id);
      assert(current, "Troca não encontrada.");
      scopeRecord(profile, current);
      const approved = asBoolean(approve);
      const saved = await runtime.patch("TrocasFolga", id, {
        Status: approved ? "Aprovada" : "Rejeitada",
        DecididoPor: profile.Email,
        DataDecisao: nowIso(),
        ObservacaoGestor: String(observation || ""),
        DataAtualizacao: nowIso(),
      });
      return success(saved, approved ? "Troca aprovada." : "Troca rejeitada.");
    },

    async acknowledgeTimeOff(args) {
      const profile = await runtime.requireProfile();
      const id = args[0];
      const timeOff = await runtime.getById("Folgas", id);
      assert(timeOff, "Folga não encontrada.");
      scopeRecord(profile, timeOff);
      const existing = (
        await runtime.list("CienciasFolga", { profile })
      ).find((item) => item.FolgaID === id);
      const saved = await runtime.upsert("CienciasFolga", {
        ...(existing || {}),
        CienciaID: existing?.CienciaID || uuid(),
        FolgaID: id,
        FuncionarioID: timeOff.FuncionarioID,
        LojaID: timeOff.LojaID,
        StatusCiencia: "Confirmada",
        ObservacaoFuncionario: String(args[1] || ""),
        VisualizadoEm: nowIso(),
        DataCiencia: nowIso(),
        DataCriacao: existing?.DataCriacao || nowIso(),
        DataAtualizacao: nowIso(),
      });
      return success(saved, "Ciência confirmada.");
    },

    async getMyNotifications(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const limit = Number(values[0]?.limit || 100);
      const rows = await runtime.list("Notificacoes", { profile });
      return success(
        rows
          .filter(
            (item) =>
              !item.DestinatarioID ||
              item.DestinatarioID === profile.FuncionarioID ||
              item.Destinatario === profile.Email,
          )
          .sort((a, b) =>
            String(b.DataCriacao || "").localeCompare(
              String(a.DataCriacao || ""),
            ),
          )
          .slice(0, limit),
      );
    },

    async markNotificationRead(args) {
      const profile = await runtime.requireProfile();
      const id = args[0];
      const current = await runtime.getById("Notificacoes", id);
      assert(current, "Notificação não encontrada.");
      scopeRecord(profile, {
        ...current,
        FuncionarioID: current.DestinatarioID,
      });
      const saved = await runtime.patch("Notificacoes", id, {
        Status: "Lida",
        DataLeitura: nowIso(),
        LidoPor: profile.Email,
      });
      return success(saved, "Notificação marcada como lida.");
    },

    async getProximaFolgaFuncionario(args) {
      dropClientToken(args);
      const profile = await runtime.requireProfile();
      const records = await runtime.list("Folgas", { profile });
      const next = records
        .filter(
          (item) =>
            item.FuncionarioID === profile.FuncionarioID &&
            [APP.status.approved, APP.status.pending].includes(item.Status) &&
            item.DataInicio >= todayIso(),
        )
        .sort((a, b) => a.DataInicio.localeCompare(b.DataInicio))[0];
      return success(next || null);
    },

    async anexarDocumento(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const [employeeId, payload] = values;
      const employee = await employeeById(employeeId);
      scopeRecord(profile, employee);
      const file = payload?.Arquivo || {};
      assert(file.base64, "O arquivo não foi recebido.");
      assert(
        Number(file.tamanho || 0) <= 8 * 1024 * 1024,
        "O documento deve ter no máximo 8 MB.",
      );
      const id = uuid();
      const saved = await runtime.upsert("Documentos", {
        DocID: id,
        FuncionarioID: employee.FuncionarioID,
        NomeFuncionario: employee.Nome,
        LojaID: employee.LojaID,
        Tipo: payload.Tipo || "Documento",
        Descricao: payload.Descricao || "",
        NomeArquivo: file.nome || "documento",
        MimeType: file.tipo || "application/octet-stream",
        TamanhoBytes: Number(file.tamanho || 0),
        DataEmissao: payload.DataEmissao || "",
        DataValidade: payload.DataValidade || "",
        AlertadoEm: "",
        CriadoPor: profile.Email,
        DataCriacao: nowIso(),
      });
      await runtime.saveBlob("documents", id, {
        FuncionarioID: employee.FuncionarioID,
        LojaID: employee.LojaID,
        nome: saved.NomeArquivo,
        tipo: saved.MimeType,
        base64: file.base64,
      });
      await audit("Anexar documento", "Documentos", id, {
        after: { ...saved, arquivo: "[conteúdo protegido]" },
      });
      return success(saved, "Documento anexado.");
    },

    async listarDocumentos(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const employeeId = values[0] || "";
      const rows = await runtime.list("Documentos", { profile });
      return success(
        rows
          .filter(
            (item) => !employeeId || item.FuncionarioID === employeeId,
          )
          .sort((a, b) =>
            String(b.DataCriacao).localeCompare(String(a.DataCriacao)),
          ),
      );
    },

    async obterDocumento(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const id = values[0];
      const metadata = await runtime.getById("Documentos", id);
      assert(metadata, "Documento não encontrado.");
      scopeRecord(profile, metadata);
      const blob = await runtime.getBlob("documents", id);
      assert(blob?.base64, "Conteúdo do documento não encontrado.");
      return success({
        nome: blob.nome || metadata.NomeArquivo,
        tipo: blob.tipo || metadata.MimeType,
        base64: blob.base64,
      });
    },

    async progressoOnboarding(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const employee = await employeeById(values[0]);
      scopeRecord(profile, employee);
      let items = (await runtime.list("Onboarding", { profile })).filter(
        (item) => item.FuncionarioID === employee.FuncionarioID,
      );
      if (!items.length) {
        const defaults = [
          ["Documentos cadastrais", "Documentação"],
          ["Integração com a equipe", "Integração"],
          ["Treinamento de segurança", "Treinamento"],
          ["Configuração do ponto", "Sistemas"],
          ["Ciência das regras internas", "Políticas"],
        ];
        for (const [name, category] of defaults) {
          items.push(
            await runtime.upsert("Onboarding", {
              OnbID: uuid(),
              FuncionarioID: employee.FuncionarioID,
              LojaID: employee.LojaID,
              Item: name,
              Categoria: category,
              Concluido: false,
              ConcluidoPor: "",
              ConcluidoEm: "",
              Observacao: "",
            }),
          );
        }
      }
      const completed = items.filter((item) =>
        asBoolean(item.Concluido),
      ).length;
      return success({
        concluidos: completed,
        total: items.length,
        pct: items.length ? Math.round((completed / items.length) * 100) : 0,
        itens: items,
      });
    },

    async marcarOnboardingItem(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const [id, done, observation] = values;
      const current = await runtime.getById("Onboarding", id);
      assert(current, "Item não encontrado.");
      scopeRecord(profile, current);
      const saved = await runtime.patch("Onboarding", id, {
        Concluido: asBoolean(done),
        ConcluidoPor: profile.Email,
        ConcluidoEm: asBoolean(done) ? nowIso() : "",
        Observacao: String(observation || ""),
      });
      return success(saved, "Item atualizado.");
    },

    async solicitarFerias(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const employee = await employeeById(
        payload.FuncionarioID || profile.FuncionarioID,
      );
      scopeRecord(profile, employee);
      const days = dateRange(payload.DataInicio, payload.DataFim).length;
      assert(days > 0 && days <= 30, "O período deve ter entre 1 e 30 dias.");
      const saved = await runtime.upsert("Ferias", {
        FeriasID: uuid(),
        FuncionarioID: employee.FuncionarioID,
        NomeFuncionario: employee.Nome,
        LojaID: employee.LojaID,
        PeriodoAquisitivoInicio: payload.PeriodoAquisitivoInicio || "",
        PeriodoAquisitivoFim: payload.PeriodoAquisitivoFim || "",
        DataInicio: payload.DataInicio,
        DataFim: payload.DataFim,
        Dias: days,
        Parcela: Number(payload.Parcela || 1),
        TotalParcelas: Number(payload.TotalParcelas || 1),
        AbonoPecuniario: Number(payload.AbonoPecuniario || 0),
        Status: "Pendente",
        SolicitadoPor: profile.Email,
        DataSolicitacao: nowIso(),
        Observacoes: String(payload.Observacoes || ""),
      });
      return success(saved, "Solicitação de férias enviada.");
    },

    async listarSolicitacoesFerias(args) {
      dropClientToken(args);
      const rows = await runtime.list("Ferias");
      return success(
        rows.sort((a, b) =>
          String(b.DataSolicitacao).localeCompare(String(a.DataSolicitacao)),
        ),
      );
    },

    async decidirFerias(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [id, decision, observation] = values;
      const current = await runtime.getById("Ferias", id);
      assert(current, "Solicitação não encontrada.");
      scopeRecord(profile, current);
      const approved = String(decision).toLowerCase() === "aprovar";
      const saved = await runtime.patch("Ferias", id, {
        Status: approved ? "Aprovada" : "Rejeitada",
        AprovadoPor: profile.Email,
        DataAprovacao: nowIso(),
        ObservacaoDecisao: String(observation || ""),
      });
      return success(saved, approved ? "Férias aprovadas." : "Férias rejeitadas.");
    },

    async cancelarFerias(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const [id, reason] = values;
      const current = await runtime.getById("Ferias", id);
      assert(current, "Solicitação não encontrada.");
      scopeRecord(profile, current);
      const saved = await runtime.patch("Ferias", id, {
        Status: "Cancelada",
        CanceladoPor: profile.Email,
        DataCancelamento: nowIso(),
        ObservacaoDecisao: String(reason || ""),
      });
      return success(saved, "Solicitação cancelada.");
    },

    async sugerirSubstitutos(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const timeOff = await runtime.getById("Folgas", values[0]);
      assert(timeOff, "Folga não encontrada.");
      scopeRecord(profile, timeOff);
      const employees = await runtime.list("Funcionarios", { profile });
      return success(
        employees
          .filter(
            (item) =>
              item.FuncionarioID !== timeOff.FuncionarioID &&
              item.LojaID === timeOff.LojaID &&
              asBoolean(item.Ativo),
          )
          .map((item) => ({
            FuncionarioID: item.FuncionarioID,
            Nome: item.Nome,
            Cargo: item.Cargo,
            horasSemana: 0,
            saldoFolgas: Number(item.SaldoFolgas || 0),
          }))
          .sort((a, b) => b.saldoFolgas - a.saldoFolgas),
      );
    },

    async escalarSubstituto(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [timeOffId, employeeId] = values;
      const timeOff = await runtime.getById("Folgas", timeOffId);
      const employee = await employeeById(employeeId);
      assert(timeOff && timeOff.LojaID === employee.LojaID, "Dados incompatíveis.");
      const saved = await runtime.upsert("Substituicoes", {
        SubID: uuid(),
        FolgaID: timeOffId,
        FuncionarioOrigem: timeOff.FuncionarioID,
        FuncionarioSubstituto: employee.FuncionarioID,
        LojaID: timeOff.LojaID,
        Data: timeOff.DataInicio,
        ConfirmadoPor: profile.Email,
        DataConfirmacao: nowIso(),
        Status: "Confirmada",
      });
      return success(saved, "Substituto escalado.");
    },

    async publicarComunicado(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      if (payload.LojaID) scopeRecord(profile, payload);
      const saved = await runtime.upsert("Comunicados", {
        ComID: uuid(),
        DataHora: nowIso(),
        Autor: profile.Email,
        Titulo: String(payload.Titulo || "").trim(),
        Corpo: String(payload.Corpo || "").trim(),
        LojaID: payload.LojaID || profile.LojaID || "",
        PublicoAlvo: payload.PublicoAlvo || "Todos",
        ExigeConfirmacao: asBoolean(payload.ExigeConfirmacao),
        Ativo: true,
        ExpiraEm: payload.ExpiraEm || "",
      });
      return success(saved, "Comunicado publicado.");
    },

    async listarComunicadosAtivos(args) {
      const profile = await runtime.requireProfile();
      dropClientToken(args);
      const [rows, reads] = await Promise.all([
        runtime.list("Comunicados", { profile }),
        runtime.list("ComunicadosLeituras", { profile }),
      ]);
      const readIds = new Set(
        reads
          .filter((item) => item.FuncionarioID === profile.FuncionarioID)
          .map((item) => item.ComID),
      );
      return success(
        filterAudience(rows, profile)
          .map((item) => ({ ...item, jaLido: readIds.has(item.ComID) }))
          .sort((a, b) => String(b.DataHora).localeCompare(String(a.DataHora))),
      );
    },

    async confirmarLeituraComunicado(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const announcement = await runtime.getById("Comunicados", values[0]);
      assert(announcement, "Comunicado não encontrado.");
      const existing = (
        await runtime.list("ComunicadosLeituras", { profile })
      ).find(
        (item) =>
          item.ComID === announcement.ComID &&
          item.FuncionarioID === profile.FuncionarioID,
      );
      if (existing) return success(existing, "Leitura já confirmada.");
      const saved = await runtime.upsert("ComunicadosLeituras", {
        LeituraID: uuid(),
        ComID: announcement.ComID,
        FuncionarioID: profile.FuncionarioID,
        LojaID: profile.LojaID,
        LidoEm: nowIso(),
        UserAgent: navigator.userAgent.slice(0, 300),
      });
      return success(saved, "Leitura confirmada.");
    },

    async criarEnquete(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const options = Array.isArray(payload.Opcoes)
        ? payload.Opcoes
        : String(payload.Opcoes || "")
            .split("|")
            .filter(Boolean);
      assert(options.length >= 2, "Informe pelo menos duas opções.");
      const saved = await runtime.upsert("Enquetes", {
        EnqID: uuid(),
        DataHora: nowIso(),
        Titulo: String(payload.Titulo || "").trim(),
        Opcoes: JSON.stringify(options),
        opcoesLista: options,
        FechaEm: payload.FechaEm || "",
        CriadoPor: profile.Email,
        LojaID: payload.LojaID || profile.LojaID || "",
        Ativa: true,
      });
      return success({ ...saved, id: saved.EnqID }, "Enquete criada.");
    },

    async listarEnquetesAtivas(args) {
      const profile = await runtime.requireProfile();
      dropClientToken(args);
      const [polls, votes] = await Promise.all([
        runtime.list("Enquetes", { profile }),
        runtime.list("EnquetesVotos", { profile }),
      ]);
      const voted = new Set(
        votes
          .filter((item) => item.FuncionarioID === profile.FuncionarioID)
          .map((item) => item.EnqID),
      );
      return success(
        polls
          .filter(
            (item) =>
              asBoolean(item.Ativa) &&
              (!item.LojaID ||
                item.LojaID === profile.LojaID ||
                isAdmin(profile)) &&
              (!item.FechaEm || new Date(item.FechaEm).getTime() > Date.now()),
          )
          .map((item) => ({
            ...item,
            opcoesLista: Array.isArray(item.opcoesLista)
              ? item.opcoesLista
              : JSON.parse(item.Opcoes || "[]"),
            jaVotou: voted.has(item.EnqID),
          })),
      );
    },

    async votarEnquete(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const [id, option] = values;
      const poll = await runtime.getById("Enquetes", id);
      assert(poll && asBoolean(poll.Ativa), "Enquete encerrada.");
      const options = Array.isArray(poll.opcoesLista)
        ? poll.opcoesLista
        : JSON.parse(poll.Opcoes || "[]");
      assert(options.includes(option), "Opção inválida.");
      const votes = await runtime.list("EnquetesVotos", { profile });
      assert(
        !votes.some(
          (item) =>
            item.EnqID === id &&
            item.FuncionarioID === profile.FuncionarioID,
        ),
        "Você já votou nesta enquete.",
      );
      const saved = await runtime.upsert("EnquetesVotos", {
        VotoID: uuid(),
        EnqID: id,
        FuncionarioID: profile.FuncionarioID,
        LojaID: profile.LojaID,
        Opcao: option,
        DataHora: nowIso(),
      });
      return success(saved, "Voto registrado.");
    },

    async resultadoEnquete(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const poll = await runtime.getById("Enquetes", values[0]);
      assert(poll, "Enquete não encontrada.");
      const votes = (await runtime.list("EnquetesVotos", { profile })).filter(
        (item) => item.EnqID === poll.EnqID,
      );
      const options = Array.isArray(poll.opcoesLista)
        ? poll.opcoesLista
        : JSON.parse(poll.Opcoes || "[]");
      const results = Object.fromEntries(options.map((item) => [item, 0]));
      votes.forEach((item) => {
        results[item.Opcao] = Number(results[item.Opcao] || 0) + 1;
      });
      return success({ resultados: results, total: votes.length });
    },

    async fecharMesLoja(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [storeId, month] = values;
      scopeRecord(profile, { LojaID: storeId });
      const context = await clockContext({ month });
      const employees = context.employees.filter(
        (item) => item.LojaID === storeId,
      );
      const days = context.days.filter((item) =>
        employees.some(
          (employee) => employee.FuncionarioID === item.funcionarioId,
        ),
      );
      const saved = await runtime.upsert("FechamentosMensais", {
        FechamentoID: uuid(),
        AnoMes: month,
        LojaID: storeId,
        GeradoEm: nowIso(),
        GeradoPor: profile.Email,
        HashSHA256: "",
        TotalFuncionarios: employees.length,
        TotalHorasTrabalhadas:
          Math.round(
            (days.reduce(
              (sum, item) => sum + Number(item.trabalhadoMinutos || 0),
              0,
            ) /
              60) *
              100,
          ) / 100,
        TotalHorasExtras:
          Math.round(
            (days.reduce(
              (sum, item) => sum + Math.max(0, Number(item.saldoMinutos || 0)),
              0,
            ) /
              60) *
              100,
          ) / 100,
        TotalFolgas: days.filter((item) => item.folga || item.folgaFixa).length,
        TotalFaltas: days.filter(
          (item) =>
            !item.folga &&
            !item.folgaFixa &&
            item.previstoMinutos > 0 &&
            item.trabalhadoMinutos === 0,
        ).length,
        Status: "Fechado",
        Observacoes: "",
      });
      return success(saved, "Mês fechado.");
    },

    async listarFechamentos(args) {
      const profile = await runtime.requireProfile();
      const values = dropClientToken(args);
      const storeId = values[0] || "";
      const rows = await runtime.list("FechamentosMensais", { profile });
      return success(
        rows
          .filter((item) => !storeId || item.LojaID === storeId)
          .sort((a, b) => String(b.AnoMes).localeCompare(String(a.AnoMes))),
      );
    },

    async reabrirFechamento(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const values = dropClientToken(args);
      const [id, reason] = values;
      assert(String(reason || "").trim().length >= 10, "Justifique a reabertura.");
      const saved = await runtime.patch("FechamentosMensais", id, {
        Status: "Reaberto",
        Observacoes: reason,
      });
      return success(saved, "Fechamento reaberto.");
    },

    async rankingAssiduidadeLoja(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [storeId, month] = values;
      scopeRecord(profile, { LojaID: storeId });
      const context = await clockContext({ month });
      return success(
        context.employees
          .filter((item) => item.LojaID === storeId)
          .map((employee) => {
            const days = context.days.filter(
              (item) => item.funcionarioId === employee.FuncionarioID,
            );
            const expectedDays = days.filter(
              (item) =>
                !item.folga &&
                !item.folgaFixa &&
                item.previstoMinutos > 0,
            );
            const present = expectedDays.filter(
              (item) => item.trabalhadoMinutos > 0,
            ).length;
            return {
              FuncionarioID: employee.FuncionarioID,
              Nome: employee.Nome,
              diasPrevistos: expectedDays.length,
              diasPresentes: present,
              assiduidade: expectedDays.length
                ? Math.round((present / expectedDays.length) * 100)
                : 100,
            };
          })
          .sort((a, b) => b.assiduidade - a.assiduidade),
      );
    },

    async exportarAFD(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [storeId, start, end] = values;
      scopeRecord(profile, { LojaID: storeId });
      const records = (await runtime.list("RegistrosPonto", { profile })).filter(
        (item) =>
          item.LojaID === storeId &&
          item.Data >= start &&
          item.Data <= end &&
          item.Status !== "Substituído",
      );
      const columns = [
        "RegistroPontoID",
        "FuncionarioID",
        "NomeFuncionario",
        "Data",
        "TipoMarcacao",
        "DataHora",
        "Origem",
        "Status",
      ];
      return success({
        fileId: `AFD-${storeId}-${start}-${end}.csv`,
        url: csvDataUrl(records, columns),
        registros: records.length,
      });
    },

    async compensarFolgaComBanco(args) {
      const profile = await runtime.requireProfile();
      requireManager(profile);
      const values = dropClientToken(args);
      const [employeeId, date, hours] = values;
      const employee = await employeeById(employeeId);
      scopeRecord(profile, employee);
      const saved = await runtime.upsert("BancoHorasMovimentos", {
        MovID: uuid(),
        FuncionarioID: employee.FuncionarioID,
        LojaID: employee.LojaID,
        Data: date,
        HorasTrabalhadas: 0,
        JornadaContratual: 0,
        SaldoDia: -Math.abs(Number(hours || 0)),
        SaldoAcumulado: 0,
        Origem: "Compensação de folga",
        Observacao: `Compensação registrada por ${profile.Email}`,
      });
      return success(saved, "Compensação registrada.");
    },

    async delegarPerfil(args) {
      const profile = await runtime.requireProfile();
      requireAdmin(profile);
      const values = dropClientToken(args);
      const payload = values[0] || {};
      const saved = await runtime.upsert("Delegacoes", {
        DelID: uuid(),
        DelegantePerfil: profile.Perfil,
        DelegantePor: profile.Email,
        DelegadoPara: payload.DelegadoPara,
        Perfil: payload.Perfil,
        LojaID: payload.LojaID || "",
        ValidoDe: payload.ValidoDe,
        ValidoAte: payload.ValidoAte,
        Motivo: payload.Motivo,
        Revogada: false,
      });
      return success(saved, "Delegação criada.");
    },
  };
}
