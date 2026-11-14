import { APP } from "./constants.js";
import { runtime } from "./runtime.js";
import {
  asBoolean,
  assert,
  csvDataUrl,
  normalizeEmail,
  nowIso,
  sha256Hex,
  todayIso,
  uuid,
} from "./utils.js";
import {
  audit,
  createNotification,
  dropClientToken,
  isAdmin,
  isManager,
  requireAdmin as assertAdminProfile,
  requireManager as assertManagerProfile,
  success,
} from "./api-base.js";
import { normalizeWhatsAppNumber } from "./api-whatsapp.js";
import {
  fetchAllTakeatCredit,
  loadMappings as loadTakeatMappings,
  resolveAccountMatch as resolveTakeatAccountMatch,
} from "./takeat-credit.js";
import { requestWorker } from "./worker-client.js";

const requireSession = () => runtime.requireProfile();
const requireAdmin = async () => {
  const profile = await runtime.requireProfile();
  assertAdminProfile(profile);
  return profile;
};
const requireManager = async () => {
  const profile = await runtime.requireProfile();
  assertManagerProfile(profile);
  return profile;
};

const unpackArg = (rawArgs) => {
  if (!Array.isArray(rawArgs)) return rawArgs ?? {};
  const values = dropClientToken(rawArgs);
  return values[0] ?? {};
};

export const ONBOARDING_STAGES = Object.freeze([
  { etapa: 1, codigo: "PRE_CADASTRO", titulo: "1. Pré-cadastro / Link enviado" },
  { etapa: 2, codigo: "DOCUMENTOS_ANALISE", titulo: "2. Documentos enviados e em análise" },
  { etapa: 3, codigo: "EXAME_ASO", titulo: "3. Exame Admissional (ASO) agendado/realizado" },
  { etapa: 4, codigo: "CONTRATO_ASSINADO", titulo: "4. Contrato Assinado" },
  { etapa: 5, codigo: "PERIODO_EXPERIENCIA", titulo: "5. Ativo - Período de Experiência" },
  { etapa: 6, codigo: "EFETIVADO_OU_DESLIGADO", titulo: "6. Efetivado / Desligado" },
]);

export const REQUIRED_ADMISSION_DOCUMENTS = Object.freeze([
  { codigo: "RG_CNH", titulo: "RG / CNH", obrigatorio: true },
  { codigo: "CPF", titulo: "CPF", obrigatorio: true },
  { codigo: "COMPROVANTE_RESIDENCIA", titulo: "Comprovante de Residência", obrigatorio: true },
  { codigo: "TITULO_ELEITOR", titulo: "Título de Eleitor", obrigatorio: false },
  { codigo: "RESERVISTA", titulo: "Certificado de Reservista", obrigatorio: false },
  { codigo: "CERTIDAO", titulo: "Certidão de Nascimento / Casamento", obrigatorio: true },
  { codigo: "CTPS_DIGITAL", titulo: "Carteira de Trabalho Digital", obrigatorio: true },
  { codigo: "ASO", titulo: "ASO (Exame Admissional)", obrigatorio: true },
]);

export const FICHA_OPERATIONS = Object.freeze(["House Tx", "FoodPark Tx"]);

const formatCurrencyBRL = (value) => {
  const num = Number(value || 0);
  return `R$ ${num.toFixed(2).replace(".", ",")}`;
};

const cleanCpfDigits = (value) => String(value || "").replace(/\D/g, "");

const formatCpf = (value) => {
  const d = cleanCpfDigits(value);
  if (d.length !== 11) return String(value || "").trim();
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
};

const daysBetweenDates = (startIsoDate, endIsoDate) => {
  const start = new Date(`${String(startIsoDate).slice(0, 10)}T12:00:00`);
  const end = new Date(`${String(endIsoDate).slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
};

const addDaysIso = (startIsoDate, daysToAdd) => {
  const d = new Date(`${String(startIsoDate).slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return "";
  d.setDate(d.getDate() + Number(daysToAdd || 0));
  return todayIso(d);
};

const resolvePeriodBounds = (competencia, quinzena = "mensal") => {
  const comp = String(competencia || todayIso().slice(0, 7)).slice(0, 7);
  const [yearStr, monthStr] = comp.split("-");
  const year = Number(yearStr) || new Date().getFullYear();
  const month = Number(monthStr) || new Date().getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const q = String(quinzena || "mensal").toLowerCase();
  if (q === "1" || q === "primeira" || q === "1a") {
    return {
      competencia: comp,
      quinzena: "1",
      startDate: `${comp}-01`,
      endDate: `${comp}-15`,
      chaveFechamento: `${comp}-Q1`,
    };
  }
  if (q === "2" || q === "segunda" || q === "2a") {
    return {
      competencia: comp,
      quinzena: "2",
      startDate: `${comp}-16`,
      endDate: `${comp}-${String(lastDay).padStart(2, "0")}`,
      chaveFechamento: `${comp}-Q2`,
    };
  }
  return {
    competencia: comp,
    quinzena: "mensal",
    startDate: `${comp}-01`,
    endDate: `${comp}-${String(lastDay).padStart(2, "0")}`,
    chaveFechamento: comp,
  };
};

// ============================================================================
// 1. ARQUITETURA DE PERMISSOES E AUDITORia (HISTORICO DE ALTERACOES)
// ============================================================================

async function listarHistoricoAlteracoes(filters = {}) {
  const profile = await requireAdmin();
  const rows = await runtime.list("Auditoria");
  const startDate = String(filters.startDate || filters.dataInicio || "").slice(0, 10);
  const endDate = String(filters.endDate || filters.dataFim || "").slice(0, 10);
  const storeId = String(filters.storeId || filters.lojaId || "").trim();
  const employeeId = String(filters.employeeId || filters.funcionarioId || "").trim();
  const userId = String(filters.userId || filters.usuario || "").trim().toLowerCase();
  const moduleFilter = String(filters.module || filters.modulo || "").trim().toLowerCase();
  const search = String(filters.search || filters.busca || "").trim().toLowerCase();

  const filtered = rows
    .filter((item) => {
      const datePart = String(item.Quando || item.DataHora || "").slice(0, 10);
      if (startDate && datePart < startDate) return false;
      if (endDate && datePart > endDate) return false;
      if (storeId && String(item.LojaID || "") !== storeId) return false;
      if (employeeId) {
        const matchesEmp =
          String(item.ColaboradorAfetadoID || "") === employeeId ||
          String(item.RegistoID || "") === employeeId ||
          String(item.FuncionarioID || "") === employeeId;
        if (!matchesEmp) return false;
      }
      if (userId) {
        const who = `${item.QuemID || ""} ${item.QuemNome || ""} ${item.EmailUtilizador || ""} ${item.NomeUtilizador || ""}`.toLowerCase();
        if (!who.includes(userId)) return false;
      }
      if (moduleFilter) {
        const mod = `${item.OndeModulo || item.Modulo || ""} ${item.OndeTela || ""}`.toLowerCase();
        if (!mod.includes(moduleFilter)) return false;
      }
      if (search) {
        const blob = `${item.QuemNome || item.NomeUtilizador || ""} ${item.ColaboradorAfetadoNome || ""} ${item.ResumoAlteracao || item.Mensagem || ""} ${item.CampoAlterado || ""} ${item.ValorAnterior || ""} ${item.ValorNovo || ""} ${item.Justificativa || ""}`.toLowerCase();
        if (!blob.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => String(b.Quando || b.DataHora || "").localeCompare(String(a.Quando || a.DataHora || "")));

  return success({
    perfilAcesso: profile.Perfil,
    total: filtered.length,
    logs: filtered.slice(0, Number(filters.limit || 500)),
  });
}

// ============================================================================
// 2. TELA 1: LOGIN POR CPF OU E-MAIL E RECUPERACAO VIA WHATSAPP
// ============================================================================

async function resolverLoginPorCpfOuEmail(payload = {}) {
  const identifier = String(payload.identifier || payload.cpfOuEmail || payload.email || "").trim();
  assert(identifier, "Informe o CPF ou e-mail para continuar.");
  const email = await runtime.resolveLoginEmail(identifier);
  return success({ email });
}

async function solicitarRecuperacaoSenhaWhatsApp(payload = {}) {
  const identifier = String(payload.identifier || payload.cpfOuEmail || "").trim();
  assert(identifier, "Informe seu CPF ou e-mail para recuperar a senha via WhatsApp.");
  const employees = await runtime.list("Funcionarios").catch(() => []);
  const cleanDigits = cleanCpfDigits(identifier);
  const normalizedMail = normalizeEmail(identifier);

  const employee = employees.find((emp) => {
    if (identifier.includes("@")) {
      return normalizeEmail(emp.Email) === normalizedMail;
    }
    return cleanDigits.length === 11 && cleanCpfDigits(emp.CPF) === cleanDigits;
  });

  assert(employee, "Colaborador não encontrado para o CPF ou e-mail informado.");
  const phoneRaw = String(employee.WhatsApp || employee.Telefone || "").replace(/\D/g, "");
  assert(phoneRaw.length >= 10, "Colaborador não possui WhatsApp/telefone válido cadastrado. Procure seu gerente.");

  const tokenCode = String(Math.floor(100000 + Math.random() * 900000));
  const tokenId = uuid();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await runtime.create("WhatsAppMagicTokens", {
    TokenID: tokenId,
    FuncionarioID: employee.FuncionarioID,
    Email: normalizeEmail(employee.Email),
    CPF: formatCpf(employee.CPF),
    Telefone: phoneRaw,
    Codigo: tokenCode,
    Tipo: "RECUPERACAO_SENHA",
    Status: "Pendente",
    ExpiraEm: expiresAt,
    CriadoEm: nowIso(),
  });

  const phoneIntl = phoneRaw.startsWith("55") ? phoneRaw : `55${phoneRaw}`;
  const maskedPhone = `(**) *****-${phoneRaw.slice(-4)}`;
  const msg = encodeURIComponent(
    `Portal do Colaborador: Seu codigo de recuperacao de acesso e ${tokenCode} (valido por 15 minutos).`,
  );

  return success(
    {
      tokenId,
      email: employee.Email,
      telefoneMascarado: maskedPhone,
      whatsappUrl: `https://wa.me/${phoneIntl}?text=${msg}`,
      expiraEm: expiresAt,
    },
    `Código de recuperação gerado para o WhatsApp ${maskedPhone}.`,
  );
}

// ============================================================================
// 3. TELA 2: ONBOARDING E CADASTRO DE COLABORADOR (FUNIL EM 6 ETAPAS)
// ============================================================================

async function salvarPreCadastroColaborador(payload = {}) {
  const profile = await requireSession();
  const targetId = String(payload.FuncionarioID || profile.FuncionarioID || "").trim();
  assert(targetId, "Identificador do colaborador é obrigatório.");

  const current = await runtime.getById("Funcionarios", targetId);
  assert(current, "Cadastro do colaborador não encontrado.");

  const isOwnRecord =
    String(profile.FuncionarioID || "") === targetId ||
    normalizeEmail(profile.Email) === normalizeEmail(current.Email);

  if (!isManager(profile)) {
    assert(isOwnRecord, "Você só pode preencher o seu próprio cadastro inicial.");
    assert(
      !current.CadastroValidado,
      "Seu cadastro já foi validado pela gestão e não pode mais ser editado diretamente. Solicite alterações ao seu Gerente.",
    );
  } else if (!isAdmin(profile)) {
    assert(
      String(current.LojaID || "") === String(profile.LojaID || ""),
      "Gerente só pode editar cadastros da própria unidade/loja.",
    );
  }

  const allowedSelfFields = {
    Nome: String(payload.Nome ?? current.Nome ?? "").trim(),
    NomeSocial: String(payload.NomeSocial ?? current.NomeSocial ?? "").trim(),
    CPF: formatCpf(payload.CPF ?? current.CPF ?? ""),
    RG: String(payload.RG ?? current.RG ?? "").trim(),
    DataNascimento: String(payload.DataNascimento ?? current.DataNascimento ?? "").trim(),
    EstadoCivil: String(payload.EstadoCivil ?? current.EstadoCivil ?? "").trim(),
    NomeMae: String(payload.NomeMae ?? current.NomeMae ?? "").trim(),
    NomePai: String(payload.NomePai ?? current.NomePai ?? "").trim(),
    Telefone: String(payload.Telefone ?? current.Telefone ?? "").trim(),
    WhatsApp: String(payload.WhatsApp ?? payload.Telefone ?? current.WhatsApp ?? "").trim(),
    Email: normalizeEmail(payload.Email ?? current.Email ?? ""),
    CEP: String(payload.CEP ?? current.CEP ?? "").trim(),
    Endereco: String(payload.Endereco ?? current.Endereco ?? "").trim(),
    NumeroEndereco: String(payload.NumeroEndereco ?? current.NumeroEndereco ?? "").trim(),
    Complemento: String(payload.Complemento ?? current.Complemento ?? "").trim(),
    Bairro: String(payload.Bairro ?? current.Bairro ?? "").trim(),
    Cidade: String(payload.Cidade ?? current.Cidade ?? "").trim(),
    UF: String(payload.UF ?? current.UF ?? "").trim(),
    ContatoEmergenciaNome: String(payload.ContatoEmergenciaNome ?? current.ContatoEmergenciaNome ?? "").trim(),
    ContatoEmergenciaParentesco: String(payload.ContatoEmergenciaParentesco ?? current.ContatoEmergenciaParentesco ?? "").trim(),
    ContatoEmergenciaTelefone: String(payload.ContatoEmergenciaTelefone ?? current.ContatoEmergenciaTelefone ?? "").trim(),
    ChavePix: String(payload.ChavePix ?? current.ChavePix ?? "").trim(),
    BancoNome: String(payload.BancoNome ?? current.BancoNome ?? "").trim(),
    BancoAgencia: String(payload.BancoAgencia ?? current.BancoAgencia ?? "").trim(),
    BancoConta: String(payload.BancoConta ?? current.BancoConta ?? "").trim(),
    BancoTipoConta: String(payload.BancoTipoConta ?? current.BancoTipoConta ?? "").trim(),
  };

  const managementFields = isManager(profile)
    ? {
        LojaID: String(payload.LojaID ?? current.LojaID ?? ""),
        Cargo: String(payload.Cargo ?? current.Cargo ?? "").trim(),
        Setor: String(payload.Setor ?? current.Setor ?? "").trim(),
        TipoContrato: String(payload.TipoContrato ?? current.TipoContrato ?? "").trim(),
        DataAdmissao: String(payload.DataAdmissao ?? current.DataAdmissao ?? "").trim(),
        PeriodoExperienciaDias: Number(payload.PeriodoExperienciaDias ?? current.PeriodoExperienciaDias ?? 90) || 90,
        TurnoTrabalho: String(payload.TurnoTrabalho ?? current.TurnoTrabalho ?? "").trim(),
         ...(isAdmin(profile)
          ? {
              SalarioBase: Number(payload.SalarioBase ?? current.SalarioBase ?? 0) || 0,
              Perfil: payload.Perfil || current.Perfil || APP.profiles.employee,
            }
          : {}),
      }
    : {};

  const updated = {
    ...current,
    ...allowedSelfFields,
    ...managementFields,
    DataAtualizacao: nowIso(),
  };

  await runtime.update("Funcionarios", targetId, updated);
  await audit("PRE_CADASTRO_ATUALIZADO", "Onboarding", targetId, {
    tela: "Tela 2 - Onboarding e Cadastro",
    employeeId: targetId,
    employeeName: updated.Nome,
    LojaID: updated.LojaID,
    before: current,
    after: updated,
    ip: payload.ip,
    device: payload.device,
  });

  return success(updated, "Dados cadastrais salvos com sucesso.");
}

async function avancarEtapaOnboarding(payload = {}) {
  const profile = await requireManager();
  const employeeId = String(payload.FuncionarioID || payload.employeeId || "").trim();
  assert(employeeId, "Selecione o colaborador.");
  const current = await runtime.getById("Funcionarios", employeeId);
  assert(current, "Colaborador não encontrado.");

  if (!isAdmin(profile)) {
    assert(
      String(current.LojaID || "") === String(profile.LojaID || ""),
      "Gerente só pode gerenciar etapas de contratação da sua própria unidade/loja.",
    );
  }

  const novaEtapa = Number(payload.etapa || payload.EtapaAdmissao || 0);
  assert(novaEtapa >= 1 && novaEtapa <= 6, "Etapa de admissão inválida (deve ser entre 1 e 6).");

  const stageMeta = ONBOARDING_STAGES.find((s) => s.etapa === novaEtapa);
  const now = nowIso();
  const historico = { ...(current.HistoricoEtapasAdmissao || {}) };
  const substatus = String(payload.substatus || payload.SubstatusEtapa6 || "Efetivado").trim();

  historico[String(novaEtapa)] = {
    etapa: novaEtapa,
    codigo: stageMeta.codigo,
    titulo: novaEtapa === 6 ? `6. ${substatus}` : stageMeta.titulo,
    data: payload.dataEtapa || now,
    responsavel: profile.Nome || profile.Email,
    responsavelId: profile.UsuarioID || profile.FuncionarioID || profile.Email,
    observacao: String(payload.observacao || payload.motivo || "").trim(),
  };

  const validarCadastro =
    payload.validarCadastro !== undefined
      ? asBoolean(payload.validarCadastro)
      : novaEtapa >= 2
        ? true
        : Boolean(current.CadastroValidado);

  const isDesligado = novaEtapa === 6 && substatus.toLowerCase() === "desligado";
  if (isDesligado) {
    assert(
      String(payload.motivo || payload.MotivoDesligamento || "").trim().length >= 3,
      "Informe o motivo do desligamento na etapa 6.",
    );
  }

  const updated = {
    ...current,
    EtapaAdmissao: novaEtapa,
    SubstatusEtapa6: novaEtapa === 6 ? substatus : current.SubstatusEtapa6 || "",
    HistoricoEtapasAdmissao: historico,
    CadastroValidado: validarCadastro,
    ValidadoPor: validarCadastro ? current.ValidadoPor || profile.Nome || profile.Email : "",
    ValidadoEm: validarCadastro ? current.ValidadoEm || now : "",
    DataEfetivacao: novaEtapa === 6 && !isDesligado ? payload.dataEtapa || todayIso() : current.DataEfetivacao || "",
    DataDesligamento: isDesligado ? payload.dataEtapa || todayIso() : current.DataDesligamento || "",
    MotivoDesligamento: isDesligado ? String(payload.motivo || payload.MotivoDesligamento || "").trim() : current.MotivoDesligamento || "",
    Ativo: isDesligado ? false : current.Ativo !== false,
    DataAtualizacao: now,
  };

  await runtime.update("Funcionarios", employeeId, updated);
  await audit("ETAPA_ONBOARDING_ALTERADA", "Onboarding", employeeId, {
    tela: "Tela 2 - Funil de Admissão",
    employeeId,
    employeeName: current.Nome,
    LojaID: current.LojaID,
    campo: "EtapaAdmissao",
    valorAnterior: `Etapa ${current.EtapaAdmissao || 1}`,
    valorNovo: `Etapa ${novaEtapa} (${historico[String(novaEtapa)].titulo})`,
    resumo: `Etapa de contratação de ${current.Nome} alterada de Etapa ${current.EtapaAdmissao || 1} para ${historico[String(novaEtapa)].titulo}`,
    justificativa: payload.observacao || payload.motivo || "",
    before: current,
    after: updated,
  });

  return success(updated, `Etapa atualizada para: ${historico[String(novaEtapa)].titulo}`);
}

async function enviarDocumentoAdmissional(payload = {}) {
  const profile = await requireSession();
  const employeeId = String(payload.FuncionarioID || profile.FuncionarioID || "").trim();
  assert(employeeId, "Colaborador é obrigatório.");

  const current = await runtime.getById("Funcionarios", employeeId);
  assert(current, "Colaborador não encontrado.");

  const isOwnRecord =
    String(profile.FuncionarioID || "") === employeeId ||
    normalizeEmail(profile.Email) === normalizeEmail(current.Email);

  if (!isManager(profile)) {
    assert(isOwnRecord, "Você só pode enviar documentos para o seu próprio dossiê.");
  } else if (!isAdmin(profile)) {
    assert(
      String(current.LojaID || "") === String(profile.LojaID || ""),
      "Gerente só pode gerenciar documentos da própria loja.",
    );
  }

  const tipoCodigo = String(payload.codigoDocumento || payload.TipoCodigo || "").trim().toUpperCase();
  const docMeta = REQUIRED_ADMISSION_DOCUMENTS.find((d) => d.codigo === tipoCodigo) || {
    codigo: tipoCodigo || "OUTRO",
    titulo: String(payload.titulo || payload.Tipo || "Documento Admissional").trim(),
  };
  const arquivoUrl = String(payload.arquivoUrl || payload.ArquivoURL || payload.conteudoBase64 || "").trim();
  assert(arquivoUrl, "Anexe o arquivo (PDF ou foto) do documento.");

  const docId = uuid();
  const now = nowIso();
  const docEntry = {
    DocID: docId,
    FuncionarioID: employeeId,
    FuncionarioNome: current.Nome,
    CPF: current.CPF || "",
    LojaID: current.LojaID || profile.LojaID || "",
    Tipo: "Documento Admissional",
    SubtipoCodigo: docMeta.codigo,
    Titulo: `${docMeta.titulo} - ${current.Nome}`,
    Competencia: todayIso().slice(0, 7),
    ArquivoURL: arquivoUrl,
    NomeArquivo: String(payload.nomeArquivo || `${docMeta.codigo}.pdf`).trim(),
    RequerAssinatura: false,
    StatusAssinatura: "Validado no Dossiê",
    StatusValidacao: isManager(profile) ? "Aprovado" : "Em Análise",
    EnviadoPor: profile.Nome || profile.Email,
    DataCriacao: now,
  };

  await runtime.create("Documentos", docEntry);

  const dossie = {
    ...(current.DossieDocumentos || {}),
    [docMeta.codigo]: {
      docId,
      codigo: docMeta.codigo,
      titulo: docMeta.titulo,
      arquivoUrl,
      nomeArquivo: docEntry.NomeArquivo,
      enviadoEm: now,
      enviadoPor: profile.Nome || profile.Email,
      status: docEntry.StatusValidacao,
    },
  };

  const nextStage = Math.max(Number(current.EtapaAdmissao || 1), 2);
  const historico = { ...(current.HistoricoEtapasAdmissao || {}) };
  if (!historico["2"]) {
    historico["2"] = {
      etapa: 2,
      codigo: "DOCUMENTOS_ANALISE",
      titulo: "2. Documentos enviados e em análise",
      data: now,
      responsavel: profile.Nome || profile.Email,
    };
  }
  if (docMeta.codigo === "ASO" && !historico["3"]) {
    historico["3"] = {
      etapa: 3,
      codigo: "EXAME_ASO",
      titulo: "3. Exame Admissional (ASO) agendado/realizado",
      data: now,
      responsavel: profile.Nome || profile.Email,
    };
  }

  const updatedEmp = {
    ...current,
    DossieDocumentos: dossie,
    EtapaAdmissao: docMeta.codigo === "ASO" ? Math.max(nextStage, 3) : nextStage,
    HistoricoEtapasAdmissao: historico,
    DataAtualizacao: now,
  };

  await runtime.update("Funcionarios", employeeId, updatedEmp);
  await audit("DOCUMENTO_ADMISSIONAL_ENVIADO", "Onboarding", employeeId, {
    tela: "Tela 2 - Dossiê de Documentos",
    employeeId,
    employeeName: current.Nome,
    LojaID: current.LojaID,
    campo: `DossieDocumentos.${docMeta.codigo}`,
    valorAnterior: current.DossieDocumentos?.[docMeta.codigo]?.nomeArquivo || "Não enviado",
    valorNovo: docEntry.NomeArquivo,
    resumo: `Documento ${docMeta.titulo} enviado para ${current.Nome}`,
  });

  return success({ documento: docEntry, colaborador: updatedEmp }, `${docMeta.titulo} enviado com sucesso.`);
}

const ONBOARDING_TOKEN_REGEX = /^onb_[A-Za-z0-9_-]{24,96}$/;
export const SELF_ONBOARDING_DOC_CODES = Object.freeze([
  "RG_CNH",
  "COMPROVANTE_RESIDENCIA",
  "CTPS_DIGITAL",
  "ASO",
]);
export const SELF_ONBOARDING_REQUIRED_DOC_CODES = Object.freeze([
  "RG_CNH",
  "COMPROVANTE_RESIDENCIA",
  "CTPS_DIGITAL",
]);

function generateOnboardingToken() {
  const randomPart = uuid().replace(/-/g, "");
  return `onb_${randomPart}${Date.now().toString(36)}`;
}

function buildOnboardingUrl(origin, token) {
  const rawOrigin = String(
    origin || (typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : ""),
  ).trim();
  const base = rawOrigin ? rawOrigin.split("?")[0].split("#")[0] : "";
  if (!base) return `?onboarding_token=${encodeURIComponent(token)}`;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}onboarding_token=${encodeURIComponent(token)}`;
}

function generateProvisionalPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "H190!";
  for (let i = 0; i < 8; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function sanitizeCandidatePersonalFields(raw = {}, fallback = {}) {
  const pick = (key, def = "") => String(raw[key] ?? fallback[key] ?? def).trim();
  const cpfRaw = raw.CPF ?? fallback.CPF ?? "";
  const tel = pick("Telefone");
  const wpp = String(raw.WhatsApp ?? fallback.WhatsApp ?? tel).trim();
  return {
    Nome: pick("Nome"),
    NomeSocial: pick("NomeSocial"),
    CPF: cpfRaw ? formatCpf(cpfRaw) : "",
    RG: pick("RG"),
    DataNascimento: pick("DataNascimento"),
    EstadoCivil: pick("EstadoCivil"),
    NomeMae: pick("NomeMae"),
    NomePai: pick("NomePai"),
    Telefone: tel,
    WhatsApp: wpp || tel,
    Email: normalizeEmail(raw.Email ?? fallback.Email ?? ""),
    CEP: pick("CEP"),
    Endereco: pick("Endereco"),
    NumeroEndereco: pick("NumeroEndereco"),
    Complemento: pick("Complemento"),
    Bairro: pick("Bairro"),
    Cidade: pick("Cidade"),
    UF: pick("UF").toUpperCase().slice(0, 2),
    ContatoEmergenciaNome: pick("ContatoEmergenciaNome"),
    ContatoEmergenciaParentesco: pick("ContatoEmergenciaParentesco"),
    ContatoEmergenciaTelefone: pick("ContatoEmergenciaTelefone"),
    ChavePix: pick("ChavePix"),
    BancoNome: pick("BancoNome"),
    BancoAgencia: pick("BancoAgencia"),
    BancoConta: pick("BancoConta"),
    BancoTipoConta: pick("BancoTipoConta"),
  };
}

function assertValidOnboardingToken(rawToken) {
  const token = String(rawToken || "").trim();
  assert(
    ONBOARDING_TOKEN_REGEX.test(token),
    "Link de pré-cadastro inválido ou malformado.",
  );
  return token;
}

function buildOnboardingWhatsAppUrl(phoneRaw, nome, url, cargo = "") {
  const phoneIntl = normalizeWhatsAppNumber(phoneRaw);
  if (!phoneIntl) return "";
  const firstName = String(nome || "colaborador(a)").trim().split(/\s+/)[0];
  const roleNote = cargo ? ` para o cargo de ${cargo}` : "";
  const text = encodeURIComponent(
    `Olá ${firstName}! Seja bem-vindo(a) ao Grupo House 190${roleNote}. Preencha seus dados cadastrais e anexe seus documentos pelo link abaixo para iniciarmos sua admissão e liberar seu acesso ao sistema:\n\n${url}`,
  );
  return `https://wa.me/${phoneIntl}?text=${text}`;
}

function normalizeSubmittedDocFiles(item, fallbackCode = "DOC", fallbackNow = nowIso()) {
  if (!item || typeof item !== "object") return { files: [], arquivoUrl: "", nomeArquivo: "" };
  const rawList = Array.isArray(item.arquivos) && item.arquivos.length
    ? item.arquivos
    : item.arquivoUrl
      ? [{ arquivoUrl: item.arquivoUrl, nomeArquivo: item.nomeArquivo, enviadoEm: item.enviadoEm }]
      : [];
  const files = rawList
    .filter((f) => f && String(f.arquivoUrl || "").trim())
    .slice(0, 5)
    .map((f, idx) => ({
      arquivoUrl: String(f.arquivoUrl).trim(),
      nomeArquivo: String(f.nomeArquivo || `${fallbackCode}_${idx + 1}.pdf`).trim(),
      enviadoEm: f.enviadoEm || item.enviadoEm || fallbackNow,
    }));
  if (!files.length) return { files: [], arquivoUrl: "", nomeArquivo: "" };
  const summaryName =
    files.length > 1
      ? `${files.length} arquivos (${files.map((f) => f.nomeArquivo).join(", ")})`
      : files[0].nomeArquivo;
  return {
    files,
    arquivoUrl: files[0].arquivoUrl,
    nomeArquivo: summaryName,
  };
}

async function applyOnboardingSubmissionToEmployee(emp, convite, now = nowIso()) {
  if (!emp || !convite?.Submissao?.Dados) return null;
  const subDados = sanitizeCandidatePersonalFields(convite.Submissao.Dados, emp);
  const subDocs = convite.Submissao.Documentos && typeof convite.Submissao.Documentos === "object"
    ? convite.Submissao.Documentos
    : {};

  const mergedDossie = { ...(emp.DossieDocumentos || {}) };
  for (const [rawCode, item] of Object.entries(subDocs)) {
    const code = String(item?.codigo || rawCode).trim().toUpperCase();
    const norm = normalizeSubmittedDocFiles(item, code, now);
    if (!code || !norm.files.length) continue;
    const meta = REQUIRED_ADMISSION_DOCUMENTS.find((d) => d.codigo === code) || {
      codigo: code,
      titulo: item.titulo || "Documento Admissional",
    };
    const docId = `ONB_${emp.FuncionarioID}_${code}`;
    const docEntry = {
      DocID: docId,
      DocumentoID: docId,
      FuncionarioID: emp.FuncionarioID,
      FuncionarioNome: subDados.Nome || emp.Nome || "Colaborador",
      CPF: subDados.CPF || emp.CPF || "",
      LojaID: emp.LojaID || convite.LojaID || "",
      Tipo: "Documento Admissional",
      SubtipoCodigo: code,
      Titulo: `${meta.titulo} - ${subDados.Nome || emp.Nome || "Colaborador"}`,
      Competencia: todayIso().slice(0, 7),
      ArquivoURL: norm.arquivoUrl,
      NomeArquivo: norm.nomeArquivo,
      Arquivos: norm.files,
      RequerAssinatura: false,
      Status: "Pendente",
      StatusAssinatura: "Pendente de Conferência",
      StatusValidacao: "Em Análise",
      OrigemTipo: "AUTOCADASTRO_ONBOARDING",
      EnviadoPor: subDados.Nome || subDados.Email || "Candidato",
      DataCriacao: norm.files[0].enviadoEm || now,
    };
    await runtime.upsert("Documentos", docEntry).catch(() => null);
    mergedDossie[code] = {
      docId,
      codigo: code,
      titulo: meta.titulo,
      arquivoUrl: norm.arquivoUrl,
      nomeArquivo: norm.nomeArquivo,
      arquivos: norm.files,
      enviadoEm: norm.files[0].enviadoEm || now,
      enviadoPor: subDados.Nome || "Candidato",
      status: "Em Análise",
    };
  }

  const historico = { ...(emp.HistoricoEtapasAdmissao || {}) };
  if (!historico["1"]) {
    historico["1"] = {
      etapa: 1,
      codigo: "PRE_CADASTRO",
      titulo: "1. Pré-cadastro / Link enviado",
      data: convite.CriadoEm || emp.DataCriacao || now,
      responsavel: convite.CriadoPor || emp.CriadoPor || "Gestão",
    };
  }
  const candidateSubmitted = convite.Status === "Aguardando Conferência";
  if (candidateSubmitted && !historico["2"]) {
    historico["2"] = {
      etapa: 2,
      codigo: "DOCUMENTOS_ANALISE",
      titulo: "2. Documentos enviados e em análise",
      data: convite.EnviadoEm || now,
      responsavel: subDados.Nome || "Colaborador (Link)",
    };
  }

  const nextStage = candidateSubmitted
    ? Math.max(Number(emp.EtapaAdmissao || 1), 2)
    : Number(emp.EtapaAdmissao || 1);

  const updatedEmp = {
    ...emp,
    ...subDados,
    DossieDocumentos: mergedDossie,
    EtapaAdmissao: nextStage,
    HistoricoEtapasAdmissao: historico,
    StatusOnboarding: convite.Status || emp.StatusOnboarding || "Em Preenchimento",
    StatusAcesso:
      emp.Ativo === true
        ? "Liberado"
        : candidateSubmitted
          ? "Aguardando Conferência"
          : emp.StatusAcesso || "Aguardando Preenchimento",
    OnboardingEnviadoEm: convite.EnviadoEm || emp.OnboardingEnviadoEm || "",
    OnboardingUltimoSyncEm: convite.Submissao.AtualizadoEm || convite.EnviadoEm || now,
    DataAtualizacao: now,
  };

  await runtime.update("Funcionarios", emp.FuncionarioID, updatedEmp);

  if (candidateSubmitted && convite.TokenSyncPendente) {
    await createNotification({
      LojaID: updatedEmp.LojaID || "",
      Tipo: "Onboarding",
      Assunto: "Pré-cadastro preenchido · Aguardando conferência",
      Mensagem: `${updatedEmp.Nome || "Novo colaborador"} preencheu a ficha e anexou os documentos pelo link de admissão. Confira para liberar o acesso.`,
      RegistoRelacionadoID: updatedEmp.FuncionarioID,
    }).catch(() => null);
  }
  await runtime
    .patchPath(`onboardingConvites/${convite.TokenID}`, {
      TokenSyncPendente: false,
    })
    .catch(() => null);

  return updatedEmp;
}

async function gerarLinkOnboarding(payload = {}) {
  const profile = await requireManager();
  const now = nowIso();
  const employeeIdRaw = String(payload.FuncionarioID || payload.funcionarioId || "").trim();

  let current = employeeIdRaw ? await runtime.getById("Funcionarios", employeeIdRaw) : null;
  if (employeeIdRaw) {
    assert(current, "Colaborador não encontrado para gerar link.");
  }

  const isExisting = Boolean(current);
  const resolvedLojaId = String(
    !isAdmin(profile)
      ? current?.LojaID || profile.LojaID || ""
      : payload.LojaID || current?.LojaID || "",
  ).trim();
  if (!isAdmin(profile)) {
    assert(
      resolvedLojaId && resolvedLojaId === String(profile.LojaID || "").trim(),
      "Gerente só pode gerar link de onboarding para a sua própria unidade/loja.",
    );
  }

  let nomeLoja = String(payload.NomeLoja || current?.NomeLoja || "").trim();
  if (!nomeLoja && resolvedLojaId) {
    const stores = await runtime.list("Lojas").catch(() => []);
    const storeObj = stores.find((s) => String(s.LojaID) === String(resolvedLojaId));
    nomeLoja = storeObj?.NomeLoja || "";
  }

  if (!current) {
    const newId = uuid();
    const draftPersonal = sanitizeCandidatePersonalFields(payload);
    current = {
      FuncionarioID: newId,
      Nome: draftPersonal.Nome || "Novo Colaborador",
      NomeSocial: draftPersonal.NomeSocial,
      CPF: draftPersonal.CPF,
      Telefone: draftPersonal.Telefone,
      WhatsApp: draftPersonal.WhatsApp,
      Email: draftPersonal.Email,
      LojaID: resolvedLojaId,
      NomeLoja: nomeLoja,
      Cargo: String(payload.Cargo || "Colaborador").trim(),
      Setor: String(payload.Setor || "Cozinha").trim(),
      Perfil: payload.Perfil || APP.profiles.employee,
      TipoContrato: String(payload.TipoContrato || "CLT").trim(),
      DataAdmissao: String(payload.DataAdmissao || "").trim(),
      PeriodoExperienciaDias: Number(payload.PeriodoExperienciaDias || 90) || 90,
      TurnoTrabalho: String(payload.TurnoTrabalho || "").trim(),
      SalarioBase: Number(payload.SalarioBase || 0) || 0,
      SaldoFolgas: 0,
      Ativo: false,
      StatusAcesso: "Aguardando Preenchimento",
      StatusOnboarding: "Link Enviado",
      EtapaAdmissao: 1,
      CadastroValidado: false,
      HistoricoEtapasAdmissao: {
        1: {
          etapa: 1,
          codigo: "PRE_CADASTRO",
          titulo: "1. Pré-cadastro / Link enviado",
          data: now,
          responsavel: profile.Nome || profile.Email,
        },
      },
      DataCriacao: now,
      CriadoPor: profile.Email || profile.Nome,
      DataAtualizacao: now,
    };
  }

  const existingToken = String(current.OnboardingToken || "").trim();
  const shouldReuse =
    existingToken &&
    ONBOARDING_TOKEN_REGEX.test(existingToken) &&
    payload.regenerar !== true;

  let token = shouldReuse ? existingToken : generateOnboardingToken();
  let previousInvite = null;
  if (shouldReuse) {
    previousInvite = await runtime.readPath(`onboardingConvites/${token}`).catch(() => null);
    if (!previousInvite) {
      token = generateOnboardingToken();
    }
  } else if (existingToken && ONBOARDING_TOKEN_REGEX.test(existingToken)) {
    await runtime.writePath(`onboardingConvites/${existingToken}`, null).catch(() => null);
  }

  const url = buildOnboardingUrl(payload.origin, token);
  const cargoDisplay = String(payload.Cargo || current.Cargo || "").trim();
  const nomeDisplay = String(payload.Nome || current.Nome || "Colaborador").trim();
  const invitePayload = {
    ...(previousInvite || {}),
    TokenID: token,
    Token: token,
    FuncionarioID: current.FuncionarioID,
    LojaID: resolvedLojaId || current.LojaID || "",
    NomeLoja: nomeLoja || current.NomeLoja || "",
    NomeHint: nomeDisplay,
    Cargo: cargoDisplay,
    Setor: String(payload.Setor || current.Setor || "").trim(),
    TipoContrato: String(payload.TipoContrato || current.TipoContrato || "").trim(),
    DataAdmissao: String(payload.DataAdmissao || current.DataAdmissao || "").trim(),
    TurnoTrabalho: String(payload.TurnoTrabalho || current.TurnoTrabalho || "").trim(),
    Status:
      previousInvite?.Status === "Aguardando Conferência"
        ? "Aguardando Conferência"
        : previousInvite?.Status === "Aprovado" && current.CadastroValidado
          ? "Aprovado"
          : previousInvite?.Status || "Pendente",
    EtapaAdmissao: Number(current.EtapaAdmissao || 1),
    CadastroValidado: Boolean(current.CadastroValidado),
    AcessoLiberado: Boolean(current.CadastroValidado && current.Ativo !== false),
    CriadoEm: previousInvite?.CriadoEm || now,
    AtualizadoEm: now,
    CriadoPor: previousInvite?.CriadoPor || profile.Nome || profile.Email,
  };

  try {
    await runtime.writePath(`onboardingConvites/${token}`, invitePayload);
  } catch (err) {
    const rawMsg = String(err?.message || err?.code || err || "");
    if (/permission[_ ]denied/i.test(rawMsg)) {
      throw new Error(
        "Permissão negada no Firebase (onboardingConvites). Publique o arquivo database.rules.json atualizado no Firebase Console → Realtime Database → Regras → Publicar.",
      );
    }
    throw err;
  }

  const historico = { ...(current.HistoricoEtapasAdmissao || {}) };
  if (!historico["1"]) {
    historico["1"] = {
      etapa: 1,
      codigo: "PRE_CADASTRO",
      titulo: "1. Pré-cadastro / Link enviado",
      data: now,
      responsavel: profile.Nome || profile.Email,
    };
  }

  const updatedEmp = {
    ...current,
    LojaID: resolvedLojaId || current.LojaID || "",
    NomeLoja: nomeLoja || current.NomeLoja || "",
    Cargo: cargoDisplay || current.Cargo || "",
    OnboardingToken: token,
    OnboardingLinkUrl: url,
    OnboardingLinkGeradoEm: now,
    StatusOnboarding:
      current.StatusOnboarding === "Aguardando Conferência" || current.CadastroValidado
        ? current.StatusOnboarding
        : "Link Enviado",
    StatusAcesso: current.Ativo === true ? "Liberado" : current.StatusAcesso || "Aguardando Preenchimento",
    HistoricoEtapasAdmissao: historico,
    DataAtualizacao: now,
  };

  if (isExisting) {
    await runtime.update("Funcionarios", current.FuncionarioID, updatedEmp);
  } else {
    await runtime.create("Funcionarios", updatedEmp);
  }
  await audit("ONBOARDING_LINK_GERADO", "Onboarding", current.FuncionarioID, {
    tela: "Tela 2 - Link de Pré-Cadastro",
    employeeId: current.FuncionarioID,
    employeeName: updatedEmp.Nome,
    LojaID: updatedEmp.LojaID,
    resumo: `Link de pré-cadastro gerado para ${updatedEmp.Nome}`,
  });

  const waPhone = payload.Telefone || payload.WhatsApp || updatedEmp.WhatsApp || updatedEmp.Telefone || "";
  const waUrl = buildOnboardingWhatsAppUrl(waPhone, updatedEmp.Nome, url, updatedEmp.Cargo);

  return success(
    {
      token,
      url,
      waUrl,
      convite: invitePayload,
      colaborador: updatedEmp,
    },
    "Link de pré-cadastro gerado com sucesso!",
  );
}

async function consultarConviteOnboarding(payload = {}) {
  const token = assertValidOnboardingToken(payload.token || payload.TokenID);
  const convite = await runtime.readPath(`onboardingConvites/${token}`);
  assert(convite, "Link de pré-cadastro não encontrado, expirado ou já encerrado.");

  return success({
    convite: {
      TokenID: convite.TokenID || token,
      FuncionarioID: convite.FuncionarioID || "",
      LojaID: convite.LojaID || "",
      NomeLoja: convite.NomeLoja || "",
      NomeHint: convite.NomeHint || "",
      Cargo: convite.Cargo || "",
      Setor: convite.Setor || "",
      TipoContrato: convite.TipoContrato || "",
      DataAdmissao: convite.DataAdmissao || "",
      TurnoTrabalho: convite.TurnoTrabalho || "",
      Status: convite.Status || "Pendente",
      EtapaAdmissao: Number(convite.EtapaAdmissao || 1),
      CadastroValidado: Boolean(convite.CadastroValidado),
      AcessoLiberado: Boolean(convite.AcessoLiberado),
      MotivoCorrecao: convite.MotivoCorrecao || "",
      EnviadoEm: convite.EnviadoEm || "",
      AprovadoEm: convite.AprovadoEm || "",
      Submissao: convite.Submissao || null,
    },
    etapas: ONBOARDING_STAGES,
    documentosExigidos: REQUIRED_ADMISSION_DOCUMENTS.filter((d) =>
      SELF_ONBOARDING_DOC_CODES.includes(d.codigo),
    ).map((d) => ({
      ...d,
      obrigatorioAutocadastro: SELF_ONBOARDING_REQUIRED_DOC_CODES.includes(d.codigo),
      multiplosArquivos: d.codigo === "RG_CNH",
    })),
  });
}

async function salvarAutocadastroOnboarding(payload = {}) {
  const token = assertValidOnboardingToken(payload.token || payload.TokenID);
  const convite = await runtime.readPath(`onboardingConvites/${token}`);
  assert(convite, "Link de pré-cadastro inválido ou expirado.");
  assert(
    convite.Status !== "Aprovado" && convite.CadastroValidado !== true,
    "Seu cadastro já foi conferido e validado pela Administração. Caso precise alterar algo, procure seu gestor.",
  );

  const rawDados = payload.dados && typeof payload.dados === "object" ? payload.dados : payload;
  const previousSub = convite.Submissao || {};
  const sanitizedDados = sanitizeCandidatePersonalFields(rawDados, previousSub.Dados || {});
  const rawDocs = payload.documentos && typeof payload.documentos === "object" ? payload.documentos : previousSub.Documentos || {};
  const now = nowIso();

  const sanitizedDocs = {};
  for (const [key, doc] of Object.entries(rawDocs)) {
    const code = String(doc?.codigo || key).trim().toUpperCase();
    const norm = normalizeSubmittedDocFiles(doc, code, now);
    if (!norm.files.length) continue;
    const meta = REQUIRED_ADMISSION_DOCUMENTS.find((d) => d.codigo === code);
    sanitizedDocs[code] = {
      codigo: code,
      titulo: meta?.titulo || String(doc.titulo || "Documento"),
      arquivoUrl: norm.arquivoUrl,
      nomeArquivo: norm.nomeArquivo,
      arquivos: norm.files,
      enviadoEm: norm.files[0].enviadoEm || now,
    };
  }

  const finalizar = payload.finalizar === true;
  if (finalizar) {
    assert(sanitizedDados.Nome.length >= 3, "Informe seu nome completo.");
    assert(cleanCpfDigits(sanitizedDados.CPF).length === 11, "Informe um CPF válido com 11 dígitos.");
    assert(sanitizedDados.RG.length >= 4, "Informe o número do seu RG.");
    assert(sanitizedDados.DataNascimento, "Informe sua data de nascimento.");
    assert(sanitizedDados.Telefone.replace(/\D/g, "").length >= 10, "Informe seu telefone / WhatsApp com DDD.");
    assert(sanitizedDados.Email && sanitizedDados.Email.includes("@"), "Informe um e-mail pessoal válido para o seu acesso.");
    assert(sanitizedDados.CEP.replace(/\D/g, "").length === 8, "Informe um CEP válido.");
    assert(sanitizedDados.Endereco, "Informe seu endereço.");
    assert(sanitizedDados.Bairro && sanitizedDados.Cidade && sanitizedDados.UF, "Preencha bairro, cidade e UF.");
    assert(sanitizedDados.ContatoEmergenciaNome && sanitizedDados.ContatoEmergenciaTelefone, "Informe um contato de emergência.");
    assert(sanitizedDados.ChavePix, "Informe sua Chave PIX para recebimento.");

    const missingDocs = SELF_ONBOARDING_REQUIRED_DOC_CODES.filter((code) => !sanitizedDocs[code]?.arquivoUrl);
    if (missingDocs.length) {
      const titles = missingDocs
        .map((c) => REQUIRED_ADMISSION_DOCUMENTS.find((d) => d.codigo === c)?.titulo || c)
        .join(", ");
      throw new Error(`Anexe os documentos obrigatórios antes de enviar: ${titles}.`);
    }
  }

  const nextStatus = finalizar ? "Aguardando Conferência" : "Em Preenchimento";
  const nextStage = finalizar ? 2 : 1;
  const submissao = {
    Dados: sanitizedDados,
    Documentos: sanitizedDocs,
    AtualizadoEm: now,
    ...(finalizar ? { EnviadoEm: now, DeclaracaoVeracidadeAceita: true } : {}),
  };

  const patch = {
    TokenID: convite.TokenID || token,
    Token: convite.Token || token,
    FuncionarioID: convite.FuncionarioID,
    LojaID: convite.LojaID || "",
    NomeHint: sanitizedDados.Nome || convite.NomeHint || "",
    Status: nextStatus,
    EtapaAdmissao: nextStage,
    CadastroValidado: false,
    AcessoLiberado: false,
    MotivoCorrecao: finalizar ? "" : convite.MotivoCorrecao || "",
    TokenSyncPendente: finalizar ? true : Boolean(convite.TokenSyncPendente),
    AtualizadoEm: now,
    ...(finalizar ? { EnviadoEm: now } : {}),
    Submissao: submissao,
  };

  await runtime.patchPath(`onboardingConvites/${token}`, patch);

  return success(
    {
      ...convite,
      ...patch,
    },
    finalizar
      ? "Cadastro e documentos enviados! Aguarde a conferência da Administração para liberação do seu acesso."
      : "Rascunho salvo com sucesso.",
  );
}

async function sincronizarConvitesOnboarding(payload = {}) {
  const profile = await requireManager();
  const targetId = String(payload.FuncionarioID || payload.funcionarioId || "").trim();
  const candidates = targetId
    ? [await runtime.getById("Funcionarios", targetId)].filter(Boolean)
    : (await runtime.list("Funcionarios").catch(() => [])).filter((e) => {
        if (!e?.OnboardingToken || e.CadastroValidado) return false;
        if (!isAdmin(profile) && String(e.LojaID || "") !== String(profile.LojaID || "")) return false;
        return e.StatusOnboarding !== "Aprovado";
      });

  const updatedEmployees = [];
  for (const emp of candidates) {
    if (!emp?.OnboardingToken || !ONBOARDING_TOKEN_REGEX.test(String(emp.OnboardingToken))) continue;
    const convite = await runtime.readPath(`onboardingConvites/${emp.OnboardingToken}`).catch(() => null);
    if (!convite?.Submissao?.Dados) continue;
    const subUpdated = String(convite.Submissao.AtualizadoEm || convite.EnviadoEm || "");
    const alreadySynced =
      !convite.TokenSyncPendente &&
      subUpdated &&
      subUpdated === String(emp.OnboardingUltimoSyncEm || "") &&
      convite.Status === emp.StatusOnboarding;
    if (alreadySynced) continue;

    const synced = await applyOnboardingSubmissionToEmployee(emp, convite, nowIso());
    if (synced) updatedEmployees.push(synced);
  }

  return success(
    { syncedCount: updatedEmployees.length, updatedEmployees },
    updatedEmployees.length
      ? `${updatedEmployees.length} pré-cadastro(s) sincronizado(s).`
      : "Cadastros atualizados.",
  );
}

async function conferirLiberarAcessoOnboarding(payload = {}) {
  const profile = await requireManager();
  const employeeId = String(payload.FuncionarioID || payload.funcionarioId || "").trim();
  assert(employeeId, "Identificador do colaborador é obrigatório.");

  await sincronizarConvitesOnboarding({ FuncionarioID: employeeId }).catch(() => null);
  const current = await runtime.getById("Funcionarios", employeeId);
  assert(current, "Colaborador não encontrado.");

  if (!isAdmin(profile)) {
    assert(
      String(current.LojaID || "") === String(profile.LojaID || ""),
      "Gerente só pode conferir cadastros da própria unidade/loja.",
    );
  }

  const now = nowIso();
  const aprovar = payload.aprovar !== false;
  const token = String(current.OnboardingToken || payload.token || "").trim();

  if (!aprovar) {
    const motivo = String(payload.motivo || "").trim();
    assert(motivo.length >= 3, "Informe o motivo da solicitação de correção ao colaborador.");

    const updated = {
      ...current,
      EtapaAdmissao: 1,
      CadastroValidado: false,
      StatusOnboarding: "Correção Solicitada",
      StatusAcesso: "Correção Solicitada",
      MotivoCorrecaoOnboarding: motivo,
      DataAtualizacao: now,
    };
    await runtime.update("Funcionarios", employeeId, updated);
    if (token && ONBOARDING_TOKEN_REGEX.test(token)) {
      await runtime
        .patchPath(`onboardingConvites/${token}`, {
          Status: "Em Preenchimento",
          EtapaAdmissao: 1,
          CadastroValidado: false,
          AcessoLiberado: false,
          MotivoCorrecao: motivo,
          TokenSyncPendente: false,
          AtualizadoEm: now,
        })
        .catch(() => null);
    }
    await audit("ONBOARDING_CORRECAO_SOLICITADA", "Onboarding", employeeId, {
      tela: "Tela 2 - Conferência de Pré-Cadastro",
      employeeId,
      employeeName: current.Nome,
      LojaID: current.LojaID,
      justificativa: motivo,
    });
    const waUrl = buildOnboardingWhatsAppUrl(
      updated.WhatsApp || updated.Telefone,
      updated.Nome,
      updated.OnboardingLinkUrl || "",
      updated.Cargo,
    );
    return success({ colaborador: updated, waUrl }, "Correção solicitada. O colaborador pode editar usando o mesmo link.");
  }

  const targetEmail = normalizeEmail(payload.email || payload.Email || current.Email);
  assert(targetEmail && targetEmail.includes("@"), "O colaborador precisa ter um e-mail válido preenchido antes de liberar o acesso.");

  const targetStage = Math.min(6, Math.max(2, Number(payload.etapa || 3)));
  const stageMeta = ONBOARDING_STAGES.find((s) => s.etapa === targetStage) || ONBOARDING_STAGES[2];
  const historico = { ...(current.HistoricoEtapasAdmissao || {}) };
  if (!historico["2"]) {
    historico["2"] = {
      etapa: 2,
      codigo: "DOCUMENTOS_ANALISE",
      titulo: "2. Documentos enviados e em análise",
      data: current.OnboardingEnviadoEm || now,
      responsavel: profile.Nome || profile.Email,
    };
  }
  historico[String(targetStage)] = {
    etapa: targetStage,
    codigo: stageMeta.codigo,
    titulo: stageMeta.titulo,
    data: now,
    responsavel: profile.Nome || profile.Email,
    observacao: "Cadastro conferido e acesso liberado pela Administração",
  };

  const resolvedLojaId =
    isAdmin(profile) && payload.LojaID ? String(payload.LojaID).trim() : String(current.LojaID || "").trim();
  let resolvedNomeLoja = String(payload.NomeLoja || current.NomeLoja || "").trim();
  if (resolvedLojaId && (!resolvedNomeLoja || resolvedLojaId !== String(current.LojaID || ""))) {
    const stores = await runtime.list("Lojas").catch(() => []);
    const storeObj = stores.find((s) => String(s.LojaID) === String(resolvedLojaId));
    if (storeObj?.NomeLoja) resolvedNomeLoja = storeObj.NomeLoja;
  }

  const formalizedNome = String(payload.Nome || current.Nome || "Colaborador").trim();
  const formalizedCargo = String(payload.Cargo || current.Cargo || "Colaborador").trim();
  const formalizedSetor = String(payload.Setor || current.Setor || "Cozinha").trim();
  const formalizedContract = String(payload.TipoContrato || current.TipoContrato || "CLT").trim();
  const formalizedPerfil = String(payload.Perfil || current.Perfil || APP.profiles.employee).trim();
  const formalizedAdmission = String(payload.DataAdmissao || current.DataAdmissao || todayIso()).trim();
  const formalizedTurno = String(payload.TurnoTrabalho ?? current.TurnoTrabalho ?? "").trim();
  const formalizedSalario =
    payload.SalarioBase !== undefined && payload.SalarioBase !== ""
      ? Number(payload.SalarioBase || 0)
      : Number(current.SalarioBase || 0);

  let authUid = current.AuthUID || "";
  let loginCriado = false;
  let senhaProvisoria = "";
  const avisos = [];

  if (payload.criarLogin !== false) {
    if (isAdmin(profile) && !authUid && typeof runtime.createAuthUser === "function") {
      const candidatePwd = String(payload.senhaProvisoria || "").trim() || generateProvisionalPassword();
      assert(candidatePwd.length >= 10, "A senha provisória deve ter pelo menos 10 caracteres.");
      try {
        authUid = await runtime.createAuthUser(targetEmail, candidatePwd, async (createdUid) => {
          const accessRecord = {
            UsuarioID: createdUid,
            FuncionarioID: employeeId,
            Nome: formalizedNome,
            Email: targetEmail,
            Perfil: formalizedPerfil,
            LojaID: resolvedLojaId,
            NomeLoja: resolvedNomeLoja,
            Cargo: formalizedCargo,
            PrimeiroAcesso: true,
            Ativo: true,
            DataCriacao: now,
            DataAtualizacao: now,
          };
          await runtime.saveAccess(createdUid, accessRecord);
        });
        loginCriado = true;
        senhaProvisoria = candidatePwd;
      } catch (authErr) {
        const msg = String(authErr?.message || authErr || "");
        if (msg.includes("auth/email-already-in-use") || msg.includes("já possui um acesso")) {
          avisos.push("E-mail já possuía conta no Firebase Auth. Caso necessário, use Esqueci a senha no login.");
        } else {
          avisos.push(`Não foi possível criar senha automática (${msg}); o acesso cadastral foi liberado.`);
        }
      }
    } else if (authUid && isAdmin(profile) && typeof runtime.getAccess === "function") {
      const existingAccess = await runtime.getAccess(authUid).catch(() => null);
      if (existingAccess && typeof runtime.saveAccess === "function") {
        await runtime.saveAccess(authUid, {
          ...existingAccess,
          Ativo: true,
          Nome: formalizedNome,
          Cargo: formalizedCargo,
          Perfil: formalizedPerfil || existingAccess.Perfil || APP.profiles.employee,
          LojaID: resolvedLojaId || existingAccess.LojaID || "",
          NomeLoja: resolvedNomeLoja || existingAccess.NomeLoja || "",
          DataAtualizacao: now,
        }).catch(() => null);
      }
    } else if (!isAdmin(profile) && !authUid) {
      avisos.push("Cadastro conferido pela gerência. A Diretoria/Administrador conclui a criação da senha de login.");
    }
  }

  const nextDossie = { ...(current.DossieDocumentos || {}) };
  for (const [docCode, docMeta] of Object.entries(nextDossie)) {
    if (!docMeta || typeof docMeta !== "object") continue;
    nextDossie[docCode] = { ...docMeta, status: "Validado" };
    if (docMeta.docId) {
      await runtime
        .update("Documentos", docMeta.docId, {
          FuncionarioNome: formalizedNome,
          LojaID: resolvedLojaId,
          Status: "Validado",
          StatusValidacao: "Validado",
          StatusAssinatura: "Validado",
        })
        .catch(() => null);
    }
  }

  const updated = {
    ...current,
    Nome: formalizedNome,
    LojaID: resolvedLojaId,
    NomeLoja: resolvedNomeLoja,
    Cargo: formalizedCargo,
    Setor: formalizedSetor,
    TipoContrato: formalizedContract,
    Perfil: formalizedPerfil,
    DataAdmissao: formalizedAdmission,
    TurnoTrabalho: formalizedTurno,
    SalarioBase: formalizedSalario,
    Email: targetEmail,
    ...(authUid ? { AuthUID: authUid } : {}),
    DossieDocumentos: nextDossie,
    EtapaAdmissao: Math.max(Number(current.EtapaAdmissao || 1), targetStage),
    HistoricoEtapasAdmissao: historico,
    CadastroValidado: true,
    ValidadoPor: profile.Nome || profile.Email,
    ValidadoEm: now,
    Ativo: true,
    StatusOnboarding: "Aprovado",
    StatusAcesso: authUid || loginCriado ? "Liberado" : isAdmin(profile) ? "Liberado" : "Aguardando Senha Admin",
    MotivoCorrecaoOnboarding: "",
    DataAtualizacao: now,
  };

  await runtime.update("Funcionarios", employeeId, updated);

  if (token && ONBOARDING_TOKEN_REGEX.test(token)) {
    await runtime
      .patchPath(`onboardingConvites/${token}`, {
        Status: "Aprovado",
        EtapaAdmissao: updated.EtapaAdmissao,
        CadastroValidado: true,
        AcessoLiberado: true,
        AprovadoEm: now,
        AprovadoPor: profile.Nome || profile.Email,
        MotivoCorrecao: "",
        TokenSyncPendente: false,
        Submissao: null,
      })
      .catch(() => null);
  }

  await audit("ONBOARDING_APROVADO_ACESSO_LIBERADO", "Onboarding", employeeId, {
    tela: "Tela 2 - Conferência e Liberação de Acesso",
    employeeId,
    employeeName: updated.Nome,
    LojaID: updated.LojaID,
    resumo: `Cadastro de ${updated.Nome} conferido, validado (Etapa ${updated.EtapaAdmissao}) e acesso liberado.`,
  });

  const phoneIntl = normalizeWhatsAppNumber(updated.WhatsApp || updated.Telefone || "");
  const loginBase = buildOnboardingUrl(payload.origin, token).split("?")[0];
  let waUrl = "";
  if (phoneIntl) {
    const firstName = String(updated.Nome || "Colaborador").trim().split(/\s+/)[0];
    const credText = senhaProvisoria
      ? `\n\nE-mail: ${targetEmail}\nSenha provisória: ${senhaProvisoria}`
      : `\n\nE-mail de acesso: ${targetEmail}`;
    const msg = encodeURIComponent(
      `Olá ${firstName}! Seu cadastro admissional foi conferido e seu acesso ao sistema Folgas 3.0 foi liberado!\nAcesse em: ${loginBase}${credText}`,
    );
    waUrl = `https://wa.me/${phoneIntl}?text=${msg}`;
  }

  return success(
    {
      colaborador: updated,
      loginCriado,
      senhaProvisoria,
      emailLogin: targetEmail,
      waUrl,
      avisos,
    },
    loginCriado
      ? `Cadastro conferido e acesso liberado para ${updated.Nome}!`
      : `Cadastro de ${updated.Nome} conferido e validado com sucesso!`,
  );
}

async function gerarKitAdmissionalPdf(payload = {}) {
  const profile = await requireManager();
  const employeeId = String(payload.FuncionarioID || payload.employeeId || "").trim();
  assert(employeeId, "Selecione o colaborador para gerar os contratos e termos.");
  const emp = await runtime.getById("Funcionarios", employeeId);
  assert(emp, "Colaborador não encontrado.");

  if (!isAdmin(profile)) {
    assert(
      String(emp.LojaID || "") === String(profile.LojaID || ""),
      "Gerente só pode gerar documentos admissionais para colaboradores da sua loja.",
    );
  }

  const tiposSolicitados = Array.isArray(payload.tipos) && payload.tipos.length
    ? payload.tipos
    : ["Contrato de Trabalho", "Termo de Responsabilidade", "Ficha de Entrega de Uniforme/EPI"];

  const now = nowIso();
  const criados = [];

  for (const tipo of tiposSolicitados) {
    const conteudoHtml = [
      `DOCUMENTO OFICIAL: ${tipo.toUpperCase()}`,
      `Unidade/Loja: ${emp.NomeLoja || emp.LojaID || "Matriz"}`,
      `Colaborador: ${emp.Nome} ${emp.NomeSocial ? `(${emp.NomeSocial})` : ""}`,
      `CPF: ${formatCpf(emp.CPF)} | RG: ${emp.RG || "N/I"}`,
      `Endereco: ${emp.Endereco || ""}, ${emp.NumeroEndereco || ""} - ${emp.Bairro || ""} - ${emp.Cidade || ""}/${emp.UF || ""} (CEP: ${emp.CEP || ""})`,
      `Cargo: ${emp.Cargo || "Operacional"} | Setor: ${emp.Setor || "Operacao"}`,
      `Modalidade Contratual: ${emp.TipoContrato || "CLT"} | Experiencia: ${emp.PeriodoExperienciaDias || 90} dias`,
      `Jornada / Turno: ${emp.TurnoTrabalho || "Escala operacional"} | Data de Admissao: ${emp.DataAdmissao || todayIso()}`,
      `Salario Base Contratual: ${formatCurrencyBRL(emp.SalarioBase || 0)}`,
      `Gerado automaticamente em: ${now}`,
    ].join("\n");

    const hashDoc = await sha256Hex(conteudoHtml);
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(conteudoHtml)}`;

    const docRecord = {
      DocID: uuid(),
      FuncionarioID: emp.FuncionarioID,
      FuncionarioNome: emp.Nome,
      CPF: emp.CPF || "",
      LojaID: emp.LojaID || profile.LojaID || "",
      Tipo: tipo,
      Titulo: `${tipo} - ${emp.Nome}`,
      Competencia: String(emp.DataAdmissao || todayIso()).slice(0, 7),
      ConteudoTexto: conteudoHtml,
      ArquivoURL: dataUrl,
      HashSHA256Original: hashDoc,
      RequerAssinatura: true,
      StatusAssinatura: "Pendente",
      CriadoPor: profile.Nome || profile.Email,
      DataCriacao: now,
    };

    await runtime.create("Documentos", docRecord);
    criados.push(docRecord);
  }

  await audit("KIT_ADMISSIONAL_GERADO", "Documentos", employeeId, {
    tela: "Tela 2 - Assinatura Eletrônica de Contrato e Termos",
    employeeId,
    employeeName: emp.Nome,
    LojaID: emp.LojaID,
    campo: "KitAdmissional",
    valorAnterior: "Não gerado",
    valorNovo: tiposSolicitados.join(", "),
    resumo: `Kit admissional (${tiposSolicitados.join(", ")}) gerado para ${emp.Nome}`,
  });

  return success(criados, `${criados.length} documento(s) gerados para assinatura eletrônica.`);
}

async function assinarDocumentoEletronico(payload = {}) {
  const profile = await requireSession();
  const docId = String(payload.DocID || payload.docId || "").trim();
  assert(docId, "Documento não informado.");
  const doc = await runtime.getById("Documentos", docId);
  assert(doc, "Documento não encontrado.");

  const isOwnDoc =
    String(doc.FuncionarioID || "") === String(profile.FuncionarioID || "") ||
    (doc.CPF && cleanCpfDigits(doc.CPF) === cleanCpfDigits(profile.CPF));
  assert(isOwnDoc || isAdmin(profile), "Apenas o próprio colaborador titular pode assinar este documento.");

  const metodo = String(payload.metodo || (payload.token ? "TOKEN" : "TELA")).toUpperCase();
  const assinaturaTouch = String(payload.assinaturaBase64 || payload.AssinaturaTouch || "").trim();
  const tokenInformado = String(payload.token || payload.codigoToken || "").trim();
  assert(
    assinaturaTouch || tokenInformado || payload.aceiteDigital === true,
    "Forneça a assinatura na tela (touch/mouse) ou o código de token recebido.",
  );

  const now = nowIso();
  const ip = String(payload.ip || "Sessão Autenticada");
  const device = String(
    payload.device ||
      (typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "Dispositivo Web"),
  );
  const hashPayload = `${doc.DocID}|${doc.FuncionarioID}|${now}|${ip}|${metodo}|${assinaturaTouch || tokenInformado || "ACEITE"}`;
  const hashAssinatura = await sha256Hex(hashPayload);

  const signatureEntry = {
    AssinaturaID: uuid(),
    DocID: doc.DocID,
    FuncionarioID: doc.FuncionarioID,
    FuncionarioNome: doc.FuncionarioNome || profile.Nome,
    LojaID: doc.LojaID || profile.LojaID || "",
    MetodoAssinatura: metodo,
    AssinaturaTouch: assinaturaTouch,
    TokenUtilizado: tokenInformado,
    DataAssinatura: now,
    IP: ip,
    Dispositivo: device,
    UserAgent: device,
    HashSHA256: hashAssinatura,
  };

  await runtime.create("DocumentosAssinaturas", signatureEntry);
  const updatedDoc = {
    ...doc,
    StatusAssinatura: "Assinado",
    DataAssinatura: now,
    MetodoAssinatura: metodo,
    HashSHA256Assinatura: hashAssinatura,
    IPAssinatura: ip,
    DispositivoAssinatura: device,
  };
  await runtime.update("Documentos", doc.DocID, updatedDoc);

  if (doc.FuncionarioID) {
    const emp = await runtime.getById("Funcionarios", doc.FuncionarioID);
    if (emp && String(doc.Tipo || "").toLowerCase().includes("contrato")) {
      const historico = { ...(emp.HistoricoEtapasAdmissao || {}) };
      historico["4"] = {
        etapa: 4,
        codigo: "CONTRATO_ASSINADO",
        titulo: "4. Contrato Assinado",
        data: now,
        responsavel: emp.Nome,
        observacao: `Assinado via ${metodo} (Hash: ${hashAssinatura.slice(0, 12)})`,
      };
      if (!historico["5"]) {
        historico["5"] = {
          etapa: 5,
          codigo: "PERIODO_EXPERIENCIA",
          titulo: "5. Ativo - Período de Experiência",
          data: now,
          responsavel: "Sistema Automático",
        };
      }
      await runtime.update("Funcionarios", emp.FuncionarioID, {
        ...emp,
        EtapaAdmissao: Math.max(Number(emp.EtapaAdmissao || 1), 5),
        HistoricoEtapasAdmissao: historico,
        DataAtualizacao: now,
      });
    }
  }

  await audit("DOCUMENTO_ASSINADO", "Documentos", doc.DocID, {
    tela: "Tela 2 / Tela 7 - Assinatura Digital",
    employeeId: doc.FuncionarioID,
    employeeName: doc.FuncionarioNome,
    LojaID: doc.LojaID,
    campo: "StatusAssinatura",
    valorAnterior: doc.StatusAssinatura || "Pendente",
    valorNovo: `Assinado (${metodo} | SHA-256 ${hashAssinatura.slice(0, 16)}...)`,
    ip,
    device,
  });

  return success({ documento: updatedDoc, assinatura: signatureEntry }, "Documento assinado digitalmente com sucesso.");
}

async function listarAlertasExperiencia(filters = {}) {
  const profile = await requireSession();
  const refDate = String(filters.referenceDate || todayIso()).slice(0, 10);
  const employees = await runtime.list("Funcionarios");
  const alertas = [];

  for (const emp of employees) {
    if (emp.Ativo === false) continue;
    if (!isAdmin(profile) && isManager(profile)) {
      if (String(emp.LojaID || "") !== String(profile.LojaID || "")) continue;
    } else if (!isManager(profile)) {
      if (String(emp.FuncionarioID || "") !== String(profile.FuncionarioID || "")) continue;
    }
    const dataAdmissao = String(emp.DataAdmissao || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataAdmissao)) continue;
    if (emp.DataEfetivacao || emp.DataDesligamento) continue;

    for (const cicloDias of [45, 90]) {
      const dataVencimento = addDaysIso(dataAdmissao, cicloDias - 1);
      const diasRestantes = daysBetweenDates(refDate, dataVencimento);
      if (diasRestantes !== null && diasRestantes >= -5 && diasRestantes <= 5) {
        alertas.push({
          FuncionarioID: emp.FuncionarioID,
          Nome: emp.Nome,
          LojaID: emp.LojaID,
          NomeLoja: emp.NomeLoja,
          Cargo: emp.Cargo,
          DataAdmissao: dataAdmissao,
          CicloExperienciaDias: cicloDias,
          DataVencimento: dataVencimento,
          DiasRestantes: diasRestantes,
          Critico: diasRestantes <= 2,
          Mensagem:
            diasRestantes < 0
              ? `Experiência de ${cicloDias} dias venceu há ${Math.abs(diasRestantes)} dia(s) (${dataVencimento})`
              : diasRestantes === 0
                ? `Experiência de ${cicloDias} dias vence HOJE (${dataVencimento})`
                : `Experiência de ${cicloDias} dias vence em ${diasRestantes} dia(s) (${dataVencimento})`,
        });
      }
    }
  }

  alertas.sort((a, b) => a.DiasRestantes - b.DiasRestantes);
  return success(alertas);
}

// ============================================================================
// 3B. TELA 3: ENVIO E VALIDACAO DE ATESTADOS MEDICOS (NOTIFICA GERENTE E DIRETORIA)
// ============================================================================

async function enviarAtestadoMedico(payload = {}) {
  const profile = await requireSession();
  const employeeId = String(payload.FuncionarioID || profile.FuncionarioID || "").trim();
  assert(employeeId, "Colaborador não identificado.");
  const emp = await runtime.getById("Funcionarios", employeeId).catch(() => null);
  const storeId = String(payload.LojaID || emp?.LojaID || profile.LojaID || "");
  const dataInicio = String(payload.DataInicio || payload.dataInicio || todayIso()).slice(0, 10);
  const diasAfastamento = Math.max(1, Number(payload.DiasAfastamento ?? payload.diasAfastamento ?? 1));
  const fotoAtestadoUrl = String(payload.ArquivoURL || payload.fotoAtestadoUrl || payload.anexoUrl || "").trim();
  assert(fotoAtestadoUrl, "Faça o upload da foto ou PDF do atestado médico.");

  const justificativaId = uuid();
  const now = nowIso();
  const entry = {
    JustificativaPontoID: justificativaId,
    FuncionarioID: employeeId,
    FuncionarioNome: emp?.Nome || profile.Nome || "",
    LojaID: storeId,
    NomeLoja: emp?.NomeLoja || profile.NomeLoja || "",
    Tipo: "Atestado Médico",
    DataInicio: dataInicio,
    DataOcorrencia: dataInicio,
    DiasAfastamento: diasAfastamento,
    DataFim: addDaysIso(dataInicio, diasAfastamento - 1),
    Motivo: String(payload.Motivo || payload.motivo || `Atestado médico (${diasAfastamento} dia(s))`).trim(),
    ArquivoURL: fotoAtestadoUrl,
    Status: "Pendente",
    NotificadoGerenteDiretoria: true,
    DataCriacao: now,
  };

  await runtime.create("JustificativasPonto", entry);

  // Notifica Gerente da loja e Diretoria
  const allEmployees = await runtime.list("Funcionarios").catch(() => []);
  const destinatarios = allEmployees.filter((item) => {
    if (item.Ativo === false) return false;
    const r = String(item.Perfil || "").toLowerCase();
    const isDir = r.includes("admin") || r.includes("diretor");
    const isGer = (r.includes("respons") || r.includes("gerente")) && String(item.LojaID || "") === storeId;
    return isDir || isGer;
  });

  for (const dest of destinatarios) {
    await runtime.create("Notificacoes", {
      NotificacaoID: uuid(),
      Destinatario: normalizeEmail(dest.Email),
      DestinatarioID: dest.FuncionarioID,
      LojaID: storeId,
      Assunto: `Novo Atestado Médico enviado por ${entry.FuncionarioNome}`,
      Mensagem: `${entry.FuncionarioNome} enviou atestado médico com início em ${dataInicio} por ${diasAfastamento} dia(s). Aguardando validação.`,
      Tipo: "Atestado Médico",
      Status: "Pendente",
      DataCriacao: now,
      DataEnvio: now,
      RegistoRelacionadoID: justificativaId,
    }).catch(() => {});
  }

  await audit("ATESTADO_MEDICO_ENVIADO", "PontoEletronico", justificativaId, {
    tela: "Tela 3 - Ponto Eletrônico e Atestados",
    employeeId,
    employeeName: entry.FuncionarioNome,
    LojaID: storeId,
    campo: "AtestadoMedico",
    valorAnterior: "",
    valorNovo: `${diasAfastamento} dia(s) a partir de ${dataInicio}`,
    resumo: `Atestado médico (${diasAfastamento} dia(s)) enviado por ${entry.FuncionarioNome} (Gerente e Diretoria notificados)`,
  });

  return success(
    {
      atestado: entry,
      notificados: destinatarios.length,
    },
    "Atestado enviado com sucesso! Gerente e Diretoria foram notificados para validação.",
  );
}

async function validarAtestadoMedico(payload = {}) {
  const profile = await requireManager();
  const id = String(payload.JustificativaPontoID || payload.atestadoId || "").trim();
  assert(id, "Atestado não informado.");
  const current = await runtime.getById("JustificativasPonto", id);
  assert(current, "Atestado não encontrado.");

  if (!isAdmin(profile)) {
    assert(
      String(current.LojaID || "") === String(profile.LojaID || ""),
      "Gerente só pode validar atestados médicos da sua própria unidade/loja.",
    );
  }

  const aprovar = payload.aprovar !== false && String(payload.status || "Aprovada").toLowerCase() !== "rejeitada";
  const novoStatus = aprovar ? "Aprovada" : "Rejeitada";
  const now = nowIso();
  const updated = {
    ...current,
    Status: novoStatus,
    ValidadoPor: profile.Nome || profile.Email,
    DataValidacao: now,
    ObservacaoValidacao: String(payload.observacao || "").trim(),
  };

  await runtime.update("JustificativasPonto", id, updated);
  await audit("ATESTADO_MEDICO_VALIDADO", "PontoEletronico", id, {
    tela: "Tela 3 - Ponto Eletrônico e Atestados",
    employeeId: current.FuncionarioID,
    employeeName: current.FuncionarioNome,
    LojaID: current.LojaID,
    campo: "Status",
    valorAnterior: current.Status || "Pendente",
    valorNovo: novoStatus,
    resumo: `Status do atestado médico de ${current.FuncionarioNome} alterado de ${current.Status || "Pendente"} para ${novoStatus}`,
  });

  return success(updated, `Atestado ${novoStatus.toLowerCase()} com sucesso.`);
}

// ============================================================================
// 4. TELA 4: SOLICITACOES DE VALE / ADIANTAMENTO (FLUXO 3 ETAPAS)
// ============================================================================

async function obterLimiteMaximoVale(storeId = "") {
  const specificKey = storeId ? `LimiteMaximoVale_${storeId}` : "";
  const [storeMatch, globalMatch] = await Promise.all([
    specificKey ? runtime.getById("Configuracoes", specificKey).catch(() => null) : Promise.resolve(null),
    runtime.getById("Configuracoes", "LimiteMaximoVale").catch(() => null),
  ]);
  if (storeMatch && Number(storeMatch.Valor) > 0) return Number(storeMatch.Valor);
  if (globalMatch && Number(globalMatch.Valor) > 0) return Number(globalMatch.Valor);
  return 1000;
}

async function configurarLimiteVale(payload = {}) {
  const profile = await requireAdmin();
  const valorLimite = Number(payload.valorLimite ?? payload.LimiteMaximoVale ?? 0);
  assert(valorLimite > 0, "Informe um limite máximo de vale maior que zero.");
  const storeId = String(payload.LojaID || payload.storeId || "").trim();
  const chave = storeId ? `LimiteMaximoVale_${storeId}` : "LimiteMaximoVale";

  const existing = await runtime.getById("Configuracoes", chave).catch(() => null);
  const valorAnterior = existing ? formatCurrencyBRL(existing.Valor) : "Não definido";
  const record = {
    Chave: chave,
    Valor: String(valorLimite),
    Descricao: storeId
      ? `Limite máximo de solicitação de vale da loja ${storeId}`
      : "Limite máximo global de solicitação de vale/adiantamento",
    DataAtualizacao: nowIso(),
    AtualizadoPor: profile.Email,
  };

  if (existing) {
    await runtime.update("Configuracoes", chave, record);
  } else {
    await runtime.create("Configuracoes", record);
  }

  await audit("LIMITE_VALE_ALTERADO", "SolicitacoesVale", chave, {
    tela: "Tela 4 - Solicitações de Vale",
    LojaID: storeId,
    campo: "LimiteMaximoVale",
    valorAnterior,
    valorNovo: formatCurrencyBRL(valorLimite),
    resumo: `Limite máximo de vale alterado de ${valorAnterior} para ${formatCurrencyBRL(valorLimite)}`,
  });

  return success(record, `Limite máximo de vale configurado em ${formatCurrencyBRL(valorLimite)}.`);
}

async function solicitarVale(payload = {}) {
  const profile = await requireSession();
  const employeeId = String(payload.FuncionarioID || profile.FuncionarioID || "").trim();
  assert(employeeId, "Colaborador não identificado.");
  const emp = await runtime.getById("Funcionarios", employeeId).catch(() => null);
  const storeId = String(payload.LojaID || emp?.LojaID || profile.LojaID || "");
  const valor = Number(payload.valor ?? payload.Valor ?? 0);
  assert(valor > 0, "Informe um valor válido para a solicitação de vale.");
  const motivo = String(payload.motivo || payload.Motivo || "").trim();
  assert(motivo.length >= 3, "Informe o motivo da solicitação de vale.");
  const dataDesejada = String(payload.dataDesejada || payload.DataDesejada || todayIso()).slice(0, 10);

  const limiteMaximo = await obterLimiteMaximoVale(storeId);
  assert(
    valor <= limiteMaximo,
    `O valor solicitado (${formatCurrencyBRL(valor)}) ultrapassa o limite máximo permitido pela Diretoria (${formatCurrencyBRL(limiteMaximo)}).`,
  );

  const valeId = uuid();
  const now = nowIso();
  const record = {
    ValeID: valeId,
    FuncionarioID: employeeId,
    FuncionarioNome: emp?.Nome || profile.Nome || "",
    CPF: emp?.CPF || "",
    LojaID: storeId,
    NomeLoja: emp?.NomeLoja || profile.NomeLoja || "",
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
    DataCriacao: now,
    DataAtualizacao: now,
  };

  await runtime.create("SolicitacoesVale", record);
  await audit("VALE_SOLICITADO", "SolicitacoesVale", valeId, {
    tela: "Tela 4 - Solicitações de Vale",
    employeeId,
    employeeName: record.FuncionarioNome,
    LojaID: storeId,
    campo: "Status",
    valorAnterior: "",
    valorNovo: `Solicitado (${formatCurrencyBRL(valor)})`,
    resumo: `Solicitação de vale de ${formatCurrencyBRL(valor)} criada por ${record.FuncionarioNome}`,
  });

  return success(record, "Solicitação de vale enviada para validação do Gerente.");
}

async function validarValeGerente(payload = {}) {
  const profile = await requireManager();
  const valeId = String(payload.ValeID || payload.valeId || "").trim();
  assert(valeId, "Solicitação de vale não informada.");
  const current = await runtime.getById("SolicitacoesVale", valeId);
  assert(current, "Solicitação de vale não encontrada.");

  if (!isAdmin(profile)) {
    assert(
      String(current.LojaID || "") === String(profile.LojaID || ""),
      "Gerente só pode validar solicitações de vale da sua própria unidade/loja.",
    );
  }

  const aprovar = payload.aprovar !== false && String(payload.decisao || "validar").toLowerCase() !== "recusar";
  const novoStatus = aprovar ? "Validado pelo Gerente" : "Recusado pelo Gerente";
  const now = nowIso();

  const updated = {
    ...current,
    Status: novoStatus,
    ValidadoGerentePor: profile.Nome || profile.Email,
    ValidadoGerenteEm: now,
    ObservacaoGerente: String(payload.observacao || "").trim(),
    DataAtualizacao: now,
  };

  await runtime.update("SolicitacoesVale", valeId, updated);
  await audit("VALE_VALIDACAO_GERENTE", "SolicitacoesVale", valeId, {
    tela: "Tela 4 - Solicitações de Vale",
    employeeId: current.FuncionarioID,
    employeeName: current.FuncionarioNome,
    LojaID: current.LojaID,
    campo: "Status",
    valorAnterior: current.Status,
    valorNovo: novoStatus,
    resumo: `Status do vale (${formatCurrencyBRL(current.Valor)}) de ${current.FuncionarioNome} alterado de ${current.Status} para ${novoStatus}`,
  });

  return success(updated, `Vale atualizado para: ${novoStatus}.`);
}

async function aprovarPagarValeDiretoria(payload = {}) {
  const profile = await requireAdmin();
  const valeId = String(payload.ValeID || payload.valeId || "").trim();
  assert(valeId, "Solicitação de vale não informada.");
  const current = await runtime.getById("SolicitacoesVale", valeId);
  assert(current, "Solicitação de vale não encontrada.");

  const aprovar = payload.aprovar !== false && String(payload.decisao || "pagar").toLowerCase() !== "recusar";
  const novoStatus = aprovar ? "Pago" : "Recusado pela Diretoria";
  const comprovanteUrl = String(payload.comprovanteUrl || payload.ComprovanteURL || "").trim();
  if (aprovar) {
    assert(comprovanteUrl, "Anexe o comprovante de pagamento para concluir a aprovação do vale.");
  }

  const now = nowIso();
  let reciboDocId = current.ReciboDocID || "";

  if (aprovar) {
    const reciboTexto = [
      "RECIBO DE ADIANTAMENTO SALARIAL / VALE",
      `Colaborador: ${current.FuncionarioNome} (CPF: ${formatCpf(current.CPF)})`,
      `Unidade/Loja: ${current.NomeLoja || current.LojaID}`,
      `Valor Pago: ${formatCurrencyBRL(current.Valor)}`,
      `Competencia de Desconto: ${current.Competencia}`,
      `Data de Aprovacao/Pagamento: ${now}`,
      `Aprovado pela Diretoria: ${profile.Nome || profile.Email}`,
      `Comprovante Anexo: ${comprovanteUrl}`,
    ].join("\n");
    const hashRecibo = await sha256Hex(reciboTexto);
    reciboDocId = uuid();
    await runtime.create("Documentos", {
      DocID: reciboDocId,
      FuncionarioID: current.FuncionarioID,
      FuncionarioNome: current.FuncionarioNome,
      CPF: current.CPF || "",
      LojaID: current.LojaID,
      Tipo: "Recibo de Vale",
      Titulo: `Recibo de Vale (${formatCurrencyBRL(current.Valor)}) - ${current.Competencia}`,
      Competencia: current.Competencia,
      ConteudoTexto: reciboTexto,
      ArquivoURL: comprovanteUrl,
      HashSHA256Original: hashRecibo,
      RequerAssinatura: true,
      StatusAssinatura: "Pendente",
      CriadoPor: profile.Nome || profile.Email,
      DataCriacao: now,
    });
  }

  const updated = {
    ...current,
    Status: novoStatus,
    AprovadoDiretoriaPor: profile.Nome || profile.Email,
    AprovadoDiretoriaEm: now,
    ComprovanteURL: comprovanteUrl,
    ReciboDocID: reciboDocId,
    ObservacaoDiretoria: String(payload.observacao || "").trim(),
    DataAtualizacao: now,
  };

  await runtime.update("SolicitacoesVale", valeId, updated);
  await audit("VALE_DECISAO_DIRETORIA", "SolicitacoesVale", valeId, {
    tela: "Tela 4 - Solicitações de Vale",
    employeeId: current.FuncionarioID,
    employeeName: current.FuncionarioNome,
    LojaID: current.LojaID,
    campo: "Status",
    valorAnterior: current.Status,
    valorNovo: novoStatus,
    resumo: `Status do vale (${formatCurrencyBRL(current.Valor)}) de ${current.FuncionarioNome} alterado de ${current.Status} para ${novoStatus}`,
  });

  return success(updated, aprovar ? "Vale pago e recibo enviado para assinatura do colaborador." : "Vale recusado pela Diretoria.");
}

async function listarVales(filters = {}) {
  const profile = await requireSession();
  const all = await runtime.list("SolicitacoesVale");
  const competencia = String(filters.competencia || "").slice(0, 7);
  const storeId = String(filters.storeId || filters.LojaID || "").trim();
  const status = String(filters.status || "").trim();

  const visible = all
    .filter((item) => {
      if (!isManager(profile)) {
        if (String(item.FuncionarioID || "") !== String(profile.FuncionarioID || "")) return false;
      } else if (!isAdmin(profile)) {
        if (String(item.LojaID || "") !== String(profile.LojaID || "")) return false;
      } else if (storeId && String(item.LojaID || "") !== storeId) {
        return false;
      }
      if (competencia && String(item.Competencia || "").slice(0, 7) !== competencia) return false;
      if (status && String(item.Status || "") !== status) return false;
      return true;
    })
    .sort((a, b) => String(b.DataCriacao || "").localeCompare(String(a.DataCriacao || "")));

  const limiteMaximo = await obterLimiteMaximoVale(storeId || profile.LojaID || "");
  return success({
    limiteMaximo,
    vales: visible,
  });
}

// ============================================================================
// 5. TELA 5: VALOR DE FICHA / PRODUTIVIDADE (HOUSE TX VS FOODPARK TX)
// ============================================================================

async function salvarConfiguracaoFicha(payload = {}) {
  const profile = await requireAdmin();
  const operacao = String(payload.Operacao || payload.operacao || "House Tx").trim();
  assert(
    FICHA_OPERATIONS.includes(operacao),
    `Operação inválida. Escolha entre: ${FICHA_OPERATIONS.join(" ou ")}.`,
  );
  const funcao = String(payload.Funcao || payload.funcao || payload.Cargo || "").trim();
  assert(funcao, "Informe a função/cargo para configurar o valor da ficha.");
  const turno = String(payload.Turno || payload.turno || "Geral").trim();
  const valorUnitario = Number(payload.ValorUnitario ?? payload.valorUnitario ?? 0);
  assert(valorUnitario > 0, "O valor unitário da ficha deve ser maior que zero.");
  const storeId = String(payload.LojaID || payload.storeId || "").trim();

  const allConfigs = await runtime.list("TabelaFichas");
  const existing =
    (payload.FichaConfigID && (await runtime.getById("TabelaFichas", payload.FichaConfigID))) ||
    allConfigs.find(
      (c) =>
        String(c.Operacao || "") === operacao &&
        String(c.Funcao || "").toLowerCase() === funcao.toLowerCase() &&
        String(c.Turno || "Geral").toLowerCase() === turno.toLowerCase() &&
        String(c.LojaID || "") === storeId,
    );

  const configId = existing?.FichaConfigID || uuid();
  const now = nowIso();
  const record = {
    FichaConfigID: configId,
    Operacao: operacao,
    Funcao: funcao,
    Turno: turno,
    ValorUnitario: valorUnitario,
    LojaID: storeId,
    Ativo: payload.Ativo !== false,
    AtualizadoPor: profile.Nome || profile.Email,
    DataAtualizacao: now,
    DataCriacao: existing?.DataCriacao || now,
  };

  if (existing) {
    await runtime.update("TabelaFichas", configId, record);
  } else {
    await runtime.create("TabelaFichas", record);
  }

  const valorAntStr = existing ? formatCurrencyBRL(existing.ValorUnitario) : "Não cadastrado";
  const valorNovoStr = formatCurrencyBRL(valorUnitario);

  await audit("VALOR_FICHA_CONFIGURADO", "TabelaFichas", configId, {
    tela: "Tela 5 - Valor de Ficha / Produtividade",
    LojaID: storeId,
    campo: `Valor da Ficha (${operacao} - ${funcao} - ${turno})`,
    valorAnterior: valorAntStr,
    valorNovo: valorNovoStr,
    resumo: `Valor da Ficha (${operacao} - ${funcao}) alterado de ${valorAntStr} para ${valorNovoStr}`,
  });

  return success(record, `Valor da ficha (${operacao} - ${funcao}) salvo em ${valorNovoStr}.`);
}

async function listarConfiguracoesFicha(filters = {}) {
  await requireSession();
  const rows = await runtime.list("TabelaFichas");
  const operacao = String(filters.operacao || filters.Operacao || "").trim();
  const filtered = rows
    .filter((r) => r.Ativo !== false && (!operacao || r.Operacao === operacao))
    .sort((a, b) => `${a.Operacao}|${a.Funcao}|${a.Turno}`.localeCompare(`${b.Operacao}|${b.Funcao}|${b.Turno}`));
  return success(filtered);
}

async function lancarFichaDiaria(payload = {}) {
  const profile = await requireManager();
  const employeeId = String(payload.FuncionarioID || payload.employeeId || "").trim();
  assert(employeeId, "Selecione o colaborador para lançar a ficha diária.");
  const emp = await runtime.getById("Funcionarios", employeeId);
  assert(emp, "Colaborador não encontrado.");

  if (!isAdmin(profile)) {
    assert(
      String(emp.LojaID || "") === String(profile.LojaID || ""),
      "Gerente só pode lançar fichas para colaboradores da sua própria unidade/loja.",
    );
  }

  const operacao = String(payload.Operacao || payload.operacao || "House Tx").trim();
  assert(
    FICHA_OPERATIONS.includes(operacao),
    `Especifique a operação da ficha: ${FICHA_OPERATIONS.join(" ou ")}.`,
  );

  const data = String(payload.Data || payload.data || todayIso()).slice(0, 10);
  const competencia = data.slice(0, 7);

  // Impede lancar fichas em folha ja fechada
  const fechamentos = await runtime.list("FechamentosMensais");
  const folhaFechada = fechamentos.find(
    (f) =>
      String(f.AnoMes || "").startsWith(competencia) &&
      (String(f.LojaID || "") === String(emp.LojaID || "") || !f.LojaID) &&
      String(f.Status || "") === "Fechado",
  );
  assert(!folhaFechada, `A folha salarial da competência ${competencia} já está fechada e congelada.`);

  const quantidade = Number(payload.Quantidade ?? payload.quantidade ?? 1);
  assert(quantidade > 0, "A quantidade de fichas deve ser maior que zero.");

  const funcao = String(payload.Funcao || payload.funcao || emp.Cargo || "Operacional").trim();
  const turno = String(payload.Turno || payload.turno || emp.TurnoTrabalho || "Geral").trim();

  const tabela = await runtime.list("TabelaFichas");
  const configMatch =
    tabela.find(
      (c) =>
        c.Ativo !== false &&
        c.Operacao === operacao &&
        String(c.Funcao || "").toLowerCase() === funcao.toLowerCase() &&
        String(c.Turno || "Geral").toLowerCase() === turno.toLowerCase(),
    ) ||
    tabela.find(
      (c) =>
        c.Ativo !== false &&
        c.Operacao === operacao &&
        String(c.Funcao || "").toLowerCase() === funcao.toLowerCase(),
    ) ||
    tabela.find((c) => c.Ativo !== false && c.Operacao === operacao);

  const valorUnitario =
    isAdmin(profile) && Number(payload.ValorUnitario) > 0
      ? Number(payload.ValorUnitario)
      : Number(configMatch?.ValorUnitario || payload.ValorUnitario || 0);

  assert(
    valorUnitario > 0,
    `Não há valor unitário configurado pela Diretoria para ${operacao} (${funcao}).`,
  );

  const valorTotal = Number((quantidade * valorUnitario).toFixed(2));
  const lancamentoId = uuid();
  const now = nowIso();

  const entry = {
    LancamentoFichaID: lancamentoId,
    FuncionarioID: employeeId,
    FuncionarioNome: emp.Nome,
    LojaID: emp.LojaID || profile.LojaID || "",
    NomeLoja: emp.NomeLoja || profile.NomeLoja || "",
    Data: data,
    Competencia: competencia,
    Operacao: operacao,
    Funcao: funcao,
    Turno: turno,
    Quantidade: quantidade,
    ValorUnitario: valorUnitario,
    ValorTotal: valorTotal,
    Observacao: String(payload.Observacao || payload.observacao || "").trim(),
    LancadoPor: profile.Nome || profile.Email,
    LancadoPorID: profile.UsuarioID || profile.FuncionarioID || profile.Email,
    DataCriacao: now,
  };

  await runtime.create("LancamentosFichas", entry);
  await audit("FICHA_DIARIA_LANCADA", "LancamentosFichas", lancamentoId, {
    tela: "Tela 5 - Lançamento de Fichas",
    employeeId,
    employeeName: emp.Nome,
    LojaID: entry.LojaID,
    campo: `Ficha (${operacao})`,
    valorAnterior: "0",
    valorNovo: `${quantidade}x ${formatCurrencyBRL(valorUnitario)} = ${formatCurrencyBRL(valorTotal)}`,
    resumo: `Lançamento de ${quantidade} ficha(s) ${operacao} (${formatCurrencyBRL(valorTotal)}) para ${emp.Nome} em ${data}`,
  });

  return success(entry, `Ficha (${operacao}) lançada com sucesso para ${emp.Nome}.`);
}

async function consultarExtratoFichas(filters = {}) {
  const profile = await requireSession();
  const rows = await runtime.list("LancamentosFichas");
  const competencia = String(filters.competencia || todayIso().slice(0, 7)).slice(0, 7);
  const startDate = String(filters.startDate || "").slice(0, 10);
  const endDate = String(filters.endDate || "").slice(0, 10);
  const employeeIdFilter = String(filters.employeeId || filters.FuncionarioID || "").trim();
  const storeIdFilter = String(filters.storeId || filters.LojaID || "").trim();

  const visible = rows
    .filter((item) => {
      if (!isManager(profile)) {
        if (String(item.FuncionarioID || "") !== String(profile.FuncionarioID || "")) return false;
      } else if (!isAdmin(profile)) {
        if (String(item.LojaID || "") !== String(profile.LojaID || "")) return false;
        if (employeeIdFilter && String(item.FuncionarioID || "") !== employeeIdFilter) return false;
      } else {
        if (storeIdFilter && String(item.LojaID || "") !== storeIdFilter) return false;
        if (employeeIdFilter && String(item.FuncionarioID || "") !== employeeIdFilter) return false;
      }
      if (startDate && String(item.Data || "") < startDate) return false;
      if (endDate && String(item.Data || "") > endDate) return false;
      if (!startDate && !endDate && competencia && String(item.Competencia || "") !== competencia) {
        return false;
      }
      return true;
    })
    .sort((a, b) => String(b.Data || "").localeCompare(String(a.Data || "")));

  let qtdHouseTx = 0;
  let valorHouseTx = 0;
  let qtdFoodParkTx = 0;
  let valorFoodParkTx = 0;

  for (const item of visible) {
    const q = Number(item.Quantidade || 0);
    const v = Number(item.ValorTotal || 0);
    if (item.Operacao === "FoodPark Tx") {
      qtdFoodParkTx += q;
      valorFoodParkTx += v;
    } else {
      qtdHouseTx += q;
      valorHouseTx += v;
    }
  }

  return success({
    competencia,
    resumo: {
      qtdHouseTx,
      valorHouseTx: Number(valorHouseTx.toFixed(2)),
      qtdFoodParkTx,
      valorFoodParkTx: Number(valorFoodParkTx.toFixed(2)),
      quantidadeTotal: qtdHouseTx + qtdFoodParkTx,
      saldoTotalReceber: Number((valorHouseTx + valorFoodParkTx).toFixed(2)),
    },
    lancamentos: visible,
  });
}

// ============================================================================
// 6. TELA 6: MURAL DE AVISOS SEGMENTADOS E TREINAMENTOS (POPS)
// ============================================================================

async function salvarPopTreinamento(payload = {}) {
  const profile = await requireManager();
  const titulo = String(payload.Titulo || payload.titulo || "").trim();
  assert(titulo, "Informe o título do POP / Treinamento.");
  const setor = String(payload.Setor || payload.setor || "Todos").trim();
  const tipoMidia = String(payload.TipoMidia || payload.tipoMidia || "PDF").toUpperCase();
  const arquivoUrl = String(payload.ArquivoURL || payload.arquivoUrl || "").trim();
  assert(arquivoUrl, "Informe o link/arquivo do vídeo ou PDF do POP.");
  const storeId = isAdmin(profile)
    ? String(payload.LojaID || payload.storeId || "")
    : String(profile.LojaID || "");

  const popId = payload.PopID || uuid();
  const now = nowIso();
  const record = {
    PopID: popId,
    Titulo: titulo,
    Descricao: String(payload.Descricao || payload.descricao || "").trim(),
    Setor: setor,
    LojaID: storeId,
    TipoMidia: tipoMidia,
    ArquivoURL: arquivoUrl,
    DuracaoMinutos: Number(payload.DuracaoMinutos || 5),
    ObrigatorioOnboarding: payload.ObrigatorioOnboarding !== false,
    CriadoPor: profile.Nome || profile.Email,
    DataCriacao: now,
  };

  await runtime.create("POPsTreinamentos", record);
  await audit("POP_TREINAMENTO_CRIADO", "POPsTreinamentos", popId, {
    tela: "Tela 6 - Mural de Avisos e POPs",
    LojaID: storeId,
    campo: "Titulo",
    valorAnterior: "",
    valorNovo: `${titulo} (${setor})`,
    resumo: `POP/Treinamento "${titulo}" publicado para o setor ${setor}`,
  });

  return success(record, "POP / Manual de treinamento publicado com sucesso.");
}

async function listarPopsTreinamentos(filters = {}) {
  const profile = await requireSession();
  const pops = await runtime.list("POPsTreinamentos");
  const leituras = await runtime.list("POPsLeituras");
  const setorFilter = String(filters.setor || "").trim();

  const myId = String(profile.FuncionarioID || profile.UsuarioID || "");
  const enriched = pops
    .filter((p) => {
      if (p.LojaID && !isAdmin(profile) && String(p.LojaID) !== String(profile.LojaID || "")) {
        return false;
      }
      if (setorFilter && p.Setor !== "Todos" && p.Setor !== setorFilter) {
        return false;
      }
      return true;
    })
    .map((p) => {
      const doPop = leituras.filter((l) => l.PopID === p.PopID);
      const minhaLeitura = doPop.find((l) => String(l.FuncionarioID) === myId);
      return {
        ...p,
        ConcluidoPorMim: Boolean(minhaLeitura),
        DataMinhaConclusao: minhaLeitura?.DataLeitura || "",
        TotalConfirmacoes: doPop.length,
        Confirmacoes: isManager(profile) ? doPop : [],
      };
    });

  return success(enriched);
}

async function confirmarLeituraPop(payload = {}) {
  const profile = await requireSession();
  const popId = String(payload.PopID || payload.popId || "").trim();
  assert(popId, "Selecione o POP / Manual.");
  const pop = await runtime.getById("POPsTreinamentos", popId);
  assert(pop, "POP / Manual não encontrado.");

  const empId = String(profile.FuncionarioID || profile.UsuarioID || "");
  const leituras = await runtime.list("POPsLeituras");
  const existing = leituras.find((l) => l.PopID === popId && String(l.FuncionarioID) === empId);
  if (existing) {
    return success(existing, "Leitura já confirmada anteriormente.");
  }

  const now = nowIso();
  const entry = {
    PopLeituraID: uuid(),
    PopID: popId,
    PopTitulo: pop.Titulo,
    FuncionarioID: empId,
    FuncionarioNome: profile.Nome || profile.Email,
    LojaID: profile.LojaID || pop.LojaID || "",
    DataLeitura: now,
  };

  await runtime.create("POPsLeituras", entry);
  await audit("POP_LEITURA_CONFIRMADA", "POPsTreinamentos", popId, {
    tela: "Tela 6 - Treinamentos (POPs)",
    employeeId: empId,
    employeeName: entry.FuncionarioNome,
    LojaID: entry.LojaID,
    campo: "ConfirmacaoLeitura",
    valorAnterior: "Pendente",
    valorNovo: `Confirmado em ${now}`,
  });

  return success(entry, "Leitura e conclusão do POP registradas com sucesso.");
}

// ============================================================================
// 7. TELA 7: HOLERITES E RECIBOS (RASTREAMENTO DE VISUALIZACAO E DOWNLOAD)
// ============================================================================

async function registrarEventoDocumento(payload = {}) {
  const profile = await requireSession();
  const docId = String(payload.DocID || payload.docId || "").trim();
  assert(docId, "Documento não informado.");
  const doc = await runtime.getById("Documentos", docId);
  assert(doc, "Documento não encontrado.");

  const tipoEvento = String(payload.evento || payload.tipoEvento || "VISUALIZACAO").toUpperCase();
  const now = nowIso();
  const updated = {
    ...doc,
    VisualizadoEm: doc.VisualizadoEm || now,
    UltimaVisualizacaoEm: now,
    ...(tipoEvento === "DOWNLOAD" ? { BaixadoEm: now, TotalDownloads: Number(doc.TotalDownloads || 0) + 1 } : {}),
  };

  await runtime.update("Documentos", docId, updated);
  await audit(
    tipoEvento === "DOWNLOAD" ? "HOLERITE_BAIXADO" : "HOLERITE_VISUALIZADO",
    "Documentos",
    docId,
    {
      tela: "Tela 7 - Holerites e Recibos",
      employeeId: doc.FuncionarioID,
      employeeName: doc.FuncionarioNome,
      LojaID: doc.LojaID,
      campo: tipoEvento === "DOWNLOAD" ? "BaixadoEm" : "VisualizadoEm",
      valorAnterior: (tipoEvento === "DOWNLOAD" ? doc.BaixadoEm : doc.VisualizadoEm) || "Nunca",
      valorNovo: now,
      resumo: `${doc.Tipo || "Documento"} "${doc.Titulo}" ${tipoEvento === "DOWNLOAD" ? "baixado" : "visualizado"} por ${profile.Nome || profile.Email}`,
    },
  );

  return success(updated);
}

// ============================================================================
// 8. TELA 8: FECHAMENTO DE FOLHA SALARIAL (CONSOLIDACAO AUTOMATICA)
// ============================================================================

function recalculatePayrollLineNumbers(line = {}) {
  const salarioBase = Number(line.SalarioBase || 0);
  const vHouse = Number(line.ValorFichasHouseTx || 0);
  const vFood = Number(line.ValorFichasFoodParkTx || 0);
  const taxaServicoValor = Number(
    line.TaxaServicoValor !== undefined
      ? line.TaxaServicoValor
      : Number(line.HorasExtrasValor || 0) + Number(line.BonusValor || 0),
  );
  const vVales = Number(line.TotalValesAdiantamentos || 0);
  const vFaltas = Number(line.DescontoFaltasAtrasos || 0);
  const vConsumo = Number(line.ConsumoInternoValor || 0);
  const vQuebra = Number(line.QuebraDeCaixaValor || 0);

  const totalProventos = Number((salarioBase + taxaServicoValor).toFixed(2));
  const totalDescontos = Number(
    (vHouse + vFood + vVales + vFaltas + vConsumo + vQuebra).toFixed(2),
  );
  const valorLiquido = Number(Math.max(0, totalProventos - totalDescontos).toFixed(2));

  return {
    SalarioBase: Number(salarioBase.toFixed(2)),
    ValorFichasHouseTx: Number(vHouse.toFixed(2)),
    ValorFichasFoodParkTx: Number(vFood.toFixed(2)),
    TotalFichasValor: Number((vHouse + vFood).toFixed(2)),
    TaxaServicoValor: Number(taxaServicoValor.toFixed(2)),
    HorasExtrasValor: 0,
    BonusValor: Number(taxaServicoValor.toFixed(2)),
    TotalValesAdiantamentos: Number(vVales.toFixed(2)),
    DescontoFaltasAtrasos: Number(vFaltas.toFixed(2)),
    ConsumoInternoValor: Number(vConsumo.toFixed(2)),
    QuebraDeCaixaValor: Number(vQuebra.toFixed(2)),
    TotalProventos: totalProventos,
    TotalDescontos: totalDescontos,
    ValorLiquido: valorLiquido,
  };
}

function buildPayrollStatementText(linha = {}, bounds = {}, extra = {}) {
  const periodo = bounds.chaveFechamento || linha.AnoMes || linha.Competencia || todayIso().slice(0, 7);
  const brutoHouse = Number(linha.ValorBrutoHouseTx || 0);
  const brutoFood = Number(linha.ValorBrutoFoodParkTx || 0);
  const houseDet = brutoHouse > 0 ? ` (Bruto ${formatCurrencyBRL(brutoHouse)} com -20%)` : " (-20% Takeat)";
  const foodDet = brutoFood > 0 ? ` (Bruto ${formatCurrencyBRL(brutoFood)} com -20%)` : " (-20% Takeat)";

  const lines = [
    `${extra.titulo || "DEMONSTRATIVO DE PAGAMENTO DE FOLHA"} - COMPETENCIA ${periodo}`,
    `Colaborador: ${linha.FuncionarioNome} | CPF: ${linha.CPF || "N/I"}`,
    `Unidade/Loja: ${linha.NomeLoja || linha.LojaID || "-"} | Cargo: ${linha.Cargo || "Operacional"}`,
    "----------------------------------------------------------------",
    "PROVENTOS (ACRESCIMOS):",
    `  (+) Salario Base: ${formatCurrencyBRL(linha.SalarioBase)}`,
    `  (+) 10% Taxa de Servico: ${formatCurrencyBRL(linha.TaxaServicoValor ?? linha.BonusValor ?? 0)}`,
    `  (=) Total Proventos: ${formatCurrencyBRL(linha.TotalProventos)}`,
    "----------------------------------------------------------------",
    "DESCONTOS:",
    `  (-) Fichas Takeat House TX${houseDet}: ${formatCurrencyBRL(linha.ValorFichasHouseTx)}`,
    `  (-) Fichas Takeat FoodPark${foodDet}: ${formatCurrencyBRL(linha.ValorFichasFoodParkTx)}`,
    `  (-) Vales / Adiantamentos: ${formatCurrencyBRL(linha.TotalValesAdiantamentos)}`,
    `  (-) Faltas (${Number(linha.FaltasInjustificadas || 0)} falta(s)): ${formatCurrencyBRL(linha.DescontoFaltasAtrasos)}`,
    `  (-) Quebra de Caixa: ${formatCurrencyBRL(linha.QuebraDeCaixaValor)}`,
    ...(Number(linha.ConsumoInternoValor || 0) > 0
      ? [`  (-) Outros Descontos: ${formatCurrencyBRL(linha.ConsumoInternoValor)}`]
      : []),
    `  (=) Total de Descontos: ${formatCurrencyBRL(linha.TotalDescontos)}`,
    "----------------------------------------------------------------",
    `VALOR LIQUIDO A RECEBER: ${formatCurrencyBRL(linha.ValorLiquido)}`,
    `Chave PIX Cadastrada: ${linha.ChavePix || "Nao informada"}`,
  ];

  if (extra.observacao) {
    lines.push(`Observacao Financeiro: ${extra.observacao}`);
  }
  if (extra.comprovanteNome || extra.comprovanteUrl) {
    lines.push(`Comprovante Anexo: ${extra.comprovanteNome || "Arquivo enviado junto ao recibo"}`);
  }
  if (extra.responsavel && extra.dataHora) {
    lines.push(`${extra.acaoLabel || "Processado"} por: ${extra.responsavel} em ${extra.dataHora}`);
  }

  return lines.join("\n");
}

async function aggregateTakeatCreditsByEmployee(employees = [], providedItems = null, providedMappings = null) {
  const byEmployee = new Map();
  let items = Array.isArray(providedItems) ? providedItems : null;
  let mappings = providedMappings && typeof providedMappings === "object" ? providedMappings : null;

  if (!items && typeof window !== "undefined") {
    try {
      const [res, mapData] = await Promise.all([
        fetchAllTakeatCredit("all").catch(() => ({ items: [] })),
        mappings ? Promise.resolve(mappings) : loadTakeatMappings().catch(() => ({})),
      ]);
      items = res?.items || [];
      mappings = mapData || {};
    } catch {
      items = [];
    }
  }

  if (!Array.isArray(items) || !items.length) return byEmployee;
  const resolvedMappings = mappings || (await loadTakeatMappings().catch(() => ({}))) || {};

  for (const item of items) {
    const debt = Number(item?.debt || 0);
    if (debt <= 0) continue;

    let empId = String(item.matchedEmployeeId || item.matchedEmployee?.FuncionarioID || "").trim();
    if (!empId) {
      const resolved = resolveTakeatAccountMatch(item, employees, resolvedMappings);
      if (resolved?.isIgnored || !resolved?.matchedEmployee?.FuncionarioID) continue;
      empId = String(resolved.matchedEmployee.FuncionarioID);
    }

    const curr = byEmployee.get(empId) || {
      brutoHouseTx: 0,
      liquidoHouseTx: 0,
      brutoFoodParkTx: 0,
      liquidoFoodParkTx: 0,
    };

    const storeKey = String(item.storeKey || "").toLowerCase();
    const storeName = String(item.storeName || "").toLowerCase();
    if (storeKey === "foodpark" || storeName.includes("foodpark") || storeName.includes("food park")) {
      curr.brutoFoodParkTx = Number((curr.brutoFoodParkTx + debt).toFixed(2));
      curr.liquidoFoodParkTx = Number((curr.brutoFoodParkTx * 0.8).toFixed(2));
    } else if (storeKey === "teixeira" || storeName.includes("teixeira") || !storeKey) {
      curr.brutoHouseTx = Number((curr.brutoHouseTx + debt).toFixed(2));
      curr.liquidoHouseTx = Number((curr.brutoHouseTx * 0.8).toFixed(2));
    }

    byEmployee.set(empId, curr);
  }

  return byEmployee;
}

async function calcularLinhasFolhaPeriodo({
  competencia,
  quinzena = "mensal",
  storeId = "",
  statusFilter = "",
  takeatItems = null,
  takeatMappings = null,
}) {
  const bounds = resolvePeriodBounds(competencia, quinzena);
  const [
    employees,
    vales,
    registrosPonto,
    justificativasPonto,
    linhasSalvas,
    fechamentos,
    pagamentos,
  ] = await Promise.all([
    runtime.list("Funcionarios"),
    runtime.list("SolicitacoesVale"),
    runtime.list("RegistrosPonto"),
    runtime.list("JustificativasPonto"),
    runtime.list("FolhaLinhas"),
    runtime.list("FechamentosMensais"),
    runtime.list("FolhaPagamentos").catch(() => []),
  ]);

  const takeatByEmp = await aggregateTakeatCreditsByEmployee(employees, takeatItems, takeatMappings);

  const fechamentoAtual = fechamentos.find(
    (f) =>
      String(f.ChavePeriodo || f.AnoMes || "") === bounds.chaveFechamento &&
      String(f.LojaID || "") === String(storeId || ""),
  ) || fechamentos.find(
    (f) => String(f.ChavePeriodo || f.AnoMes || "") === bounds.chaveFechamento && !f.LojaID,
  );

  const folhaCongelada = fechamentoAtual?.Status === "Fechado";

  const activeEmployees = employees.filter((emp) => {
    if (emp.Ativo === false) return false;
    if (storeId && String(emp.LojaID || "") !== String(storeId)) return false;
    return true;
  });

  const rows = [];

  for (const emp of activeEmployees) {
    const empId = emp.FuncionarioID;
    const linhaKey = `${bounds.chaveFechamento}_${empId}`;
    const savedLine = linhasSalvas.find(
      (l) =>
        String(l.LinhaID || "") === linhaKey ||
        (String(l.AnoMes || "") === bounds.chaveFechamento && String(l.FuncionarioID || "") === empId),
    );

    if (folhaCongelada && savedLine) {
      const normalizedFrozen = {
        ...savedLine,
        ...recalculatePayrollLineNumbers(savedLine),
      };
      if (!statusFilter || normalizedFrozen.StatusLinha === statusFilter || normalizedFrozen.Status === statusFilter) {
        rows.push(normalizedFrozen);
      }
      continue;
    }

    const empTakeat = takeatByEmp.get(String(empId)) || {
      brutoHouseTx: 0,
      liquidoHouseTx: 0,
      brutoFoodParkTx: 0,
      liquidoFoodParkTx: 0,
    };

    const empVales = vales.filter(
      (v) =>
        String(v.FuncionarioID || "") === empId &&
        v.Status === "Pago" &&
        !v.DeduzidoFolhaPagamentoID &&
        String(v.DataDesejada || v.Competencia || "").slice(0, 7) === bounds.competencia,
    );
    const sistemaVales = Number(
      empVales.reduce((acc, item) => acc + Number(item.Valor || 0), 0).toFixed(2),
    );

    const empPontos = registrosPonto.filter((p) => {
      const dt = String(p.DataReferencia || p.DataHoraServidor || "").slice(0, 10);
      return String(p.FuncionarioID || "") === empId && dt >= bounds.startDate && dt <= bounds.endDate;
    });
    const diasComPonto = new Set(
      empPontos.map((p) => String(p.DataReferencia || p.DataHoraServidor || "").slice(0, 10)),
    ).size;

    const empAtestados = justificativasPonto.filter((j) => {
      const dt = String(j.DataOcorrencia || j.DataInicio || "").slice(0, 10);
      return (
        String(j.FuncionarioID || "") === empId &&
        String(j.Status || "") === "Aprovada" &&
        dt >= bounds.startDate &&
        dt <= bounds.endDate
      );
    });
    const diasAtestado = empAtestados.reduce((acc, j) => acc + Number(j.DiasAfastamento || 1), 0);

    const salarioBaseSistema = Number(emp.SalarioBase || 0);
    const hasManualHouse = savedLine?.ValorFichasHouseTxManual !== undefined && savedLine?.ValorFichasHouseTxManual !== null;
    const hasManualFood = savedLine?.ValorFichasFoodParkTxManual !== undefined && savedLine?.ValorFichasFoodParkTxManual !== null;
    const hasManualVales = savedLine?.TotalValesAdiantamentosManual !== undefined && savedLine?.TotalValesAdiantamentosManual !== null;

    const valoresOriginaisSistema = savedLine?.ValoresOriginaisSistema || {
      SalarioBase: salarioBaseSistema,
      ValorBrutoHouseTx: empTakeat.brutoHouseTx,
      ValorFichasHouseTx: empTakeat.liquidoHouseTx,
      ValorBrutoFoodParkTx: empTakeat.brutoFoodParkTx,
      ValorFichasFoodParkTx: empTakeat.liquidoFoodParkTx,
      TaxaServicoValor: 0,
      BonusValor: 0,
      TotalValesAdiantamentos: sistemaVales,
      FaltasInjustificadas: Number(savedLine?.ValoresOriginaisSistema?.FaltasInjustificadas || 0),
      DescontoFaltasAtrasos: 0,
      ConsumoInternoValor: 0,
      QuebraDeCaixaValor: 0,
    };

    const salarioBase =
      savedLine?.SalarioBaseManual !== undefined && savedLine?.SalarioBaseManual !== null
        ? Number(savedLine.SalarioBaseManual)
        : salarioBaseSistema;
    const vHouse = hasManualHouse
      ? Number(savedLine.ValorFichasHouseTxManual)
      : empTakeat.liquidoHouseTx;
    const vFoodPark = hasManualFood
      ? Number(savedLine.ValorFichasFoodParkTxManual)
      : empTakeat.liquidoFoodParkTx;
    const taxaServicoValor = Number(
      savedLine?.TaxaServicoValor !== undefined
        ? savedLine.TaxaServicoValor
        : Number(savedLine?.HorasExtrasValor || 0) + Number(savedLine?.BonusValor || 0),
    );
    const totalVales = hasManualVales
      ? Number(savedLine.TotalValesAdiantamentosManual)
      : sistemaVales;
    const faltasInjustificadas = Number(savedLine?.FaltasInjustificadas ?? 0);
    const descontoFaltas = Number(savedLine?.DescontoFaltasAtrasos ?? 0);
    const consumoInterno = Number(savedLine?.ConsumoInternoValor ?? 0);
    const quebraDeCaixa = Number(savedLine?.QuebraDeCaixaValor ?? 0);

    const calc = recalculatePayrollLineNumbers({
      SalarioBase: salarioBase,
      ValorFichasHouseTx: vHouse,
      ValorFichasFoodParkTx: vFoodPark,
      TaxaServicoValor: taxaServicoValor,
      TotalValesAdiantamentos: totalVales,
      DescontoFaltasAtrasos: descontoFaltas,
      ConsumoInternoValor: consumoInterno,
      QuebraDeCaixaValor: quebraDeCaixa,
    });

    const latestPayment = pagamentos
      .filter((p) => String(p.FuncionarioID || "") === empId && String(p.Competencia || "") === bounds.competencia)
      .sort((a, b) => String(b.DataPagamento || "").localeCompare(String(a.DataPagamento || "")))[0] || null;

    const statusLinha = savedLine?.StatusLinha || savedLine?.Status || "Em Aberto";

    const row = {
      ...(savedLine || {}),
      LinhaID: linhaKey,
      AnoMes: bounds.chaveFechamento,
      Competencia: bounds.competencia,
      Quinzena: bounds.quinzena,
      FuncionarioID: empId,
      FuncionarioNome: emp.Nome,
      CPF: formatCpf(emp.CPF),
      WhatsApp: emp.WhatsApp || emp.Telefone || emp.Celular || "",
      Cargo: emp.Cargo || "",
      Setor: emp.Setor || "",
      TipoContrato: emp.TipoContrato || "CLT",
      LojaID: emp.LojaID || "",
      NomeLoja: emp.NomeLoja || "",
      ValorBrutoHouseTx: empTakeat.brutoHouseTx,
      ValorBrutoFoodParkTx: empTakeat.brutoFoodParkTx,
      QtdFichasHouseTx: empTakeat.brutoHouseTx > 0 ? 1 : 0,
      QtdFichasFoodParkTx: empTakeat.brutoFoodParkTx > 0 ? 1 : 0,
      DiasTrabalhados: diasComPonto,
      DiasAtestado: diasAtestado,
      FaltasInjustificadas: faltasInjustificadas,
      ...calc,
      ChavePix: emp.ChavePix || "",
      BancoNome: emp.BancoNome || "",
      BancoAgencia: emp.BancoAgencia || "",
      BancoConta: emp.BancoConta || "",
      StatusLinha: statusLinha,
      Status: statusLinha,
      UltimoPagamentoID: savedLine?.UltimoPagamentoID || latestPayment?.PagamentoID || "",
      UltimoPagamentoEm: savedLine?.UltimoPagamentoEm || latestPayment?.DataPagamento || "",
      UltimoValorPago: savedLine?.UltimoValorPago ?? latestPayment?.ValorLiquido ?? 0,
      UltimoComprovanteURL: savedLine?.UltimoComprovanteURL || latestPayment?.ComprovanteURL || "",
      EditadoManualmente: Boolean(savedLine?.EditadoManualmente),
      EdicoesManuais: savedLine?.EdicoesManuais || [],
      ValoresOriginaisSistema: valoresOriginaisSistema,
    };

    if (!statusFilter || row.StatusLinha === statusFilter) {
      rows.push(row);
    }
  }

  rows.sort((a, b) => String(a.FuncionarioNome || "").localeCompare(String(b.FuncionarioNome || "")));

  const totais = rows.reduce(
    (acc, r) => {
      acc.totalColaboradores += 1;
      acc.totalSalarios += Number(r.SalarioBase || 0);
      acc.totalHouseTx += Number(r.ValorFichasHouseTx || 0);
      acc.totalFoodParkTx += Number(r.ValorFichasFoodParkTx || 0);
      acc.totalTaxaServico += Number(r.TaxaServicoValor || 0);
      acc.totalVales += Number(r.TotalValesAdiantamentos || 0);
      acc.totalDescontos += Number(r.TotalDescontos || 0);
      acc.totalLiquido += Number(r.ValorLiquido || 0);
      return acc;
    },
    {
      totalColaboradores: 0,
      totalSalarios: 0,
      totalHouseTx: 0,
      totalFoodParkTx: 0,
      totalTaxaServico: 0,
      totalVales: 0,
      totalDescontos: 0,
      totalLiquido: 0,
    },
  );

  return {
    bounds,
    folhaCongelada,
    fechamentoAtual: fechamentoAtual || null,
    totais: {
      totalColaboradores: totais.totalColaboradores,
      totalSalarios: Number(totais.totalSalarios.toFixed(2)),
      totalHouseTx: Number(totais.totalHouseTx.toFixed(2)),
      totalFoodParkTx: Number(totais.totalFoodParkTx.toFixed(2)),
      totalTaxaServico: Number(totais.totalTaxaServico.toFixed(2)),
      totalVales: Number(totais.totalVales.toFixed(2)),
      totalDescontos: Number(totais.totalDescontos.toFixed(2)),
      totalLiquido: Number(totais.totalLiquido.toFixed(2)),
    },
    linhas: rows,
  };
}

async function gerarPreviaFolhaSalarial(filters = {}) {
  const profile = await requireManager();
  const competencia = String(filters.competencia || filters.anoMes || todayIso().slice(0, 7)).slice(0, 7);
  const quinzena = String(filters.quinzena || "mensal");
  const requestedStore = String(filters.storeId || filters.LojaID || "").trim();
  const storeId = isAdmin(profile) ? requestedStore : String(profile.LojaID || "");
  const statusFilter = String(filters.status || "").trim();

  const result = await calcularLinhasFolhaPeriodo({
    competencia,
    quinzena,
    storeId,
    statusFilter,
    takeatItems: filters.takeatItems || null,
    takeatMappings: filters.takeatMappings || null,
  });

  return success({
    permissaoEdicao: isAdmin(profile) && !result.folhaCongelada,
    somenteLeituraGerente: !isAdmin(profile),
    ...result,
  });
}

async function editarLinhaFolhaManual(payload = {}) {
  const profile = await requireAdmin();
  const competencia = String(payload.competencia || payload.AnoMes || todayIso().slice(0, 7)).slice(0, 7);
  const quinzena = String(payload.quinzena || "mensal");
  const employeeId = String(payload.FuncionarioID || payload.employeeId || "").trim();
  assert(employeeId, "Colaborador não informado para edição da folha.");

  const justificativa = String(payload.justificativa || payload.Justificativa || "").trim();
  assert(
    justificativa.length >= 5,
    "A edição manual na Folha Salarial exige uma justificativa obrigatória (mínimo de 5 caracteres) para registro na Auditoria.",
  );

  const previa = await calcularLinhasFolhaPeriodo({
    competencia,
    quinzena,
    storeId: payload.LojaID || "",
    takeatItems: payload.takeatItems || null,
    takeatMappings: payload.takeatMappings || null,
  });
  assert(
    !previa.folhaCongelada,
    "Esta Folha Salarial já foi fechada e congelada. Não é permitido alterar valores após o fechamento.",
  );

  const currentLine = previa.linhas.find((l) => String(l.FuncionarioID) === employeeId);
  assert(currentLine, "Colaborador não localizado na folha do período selecionado.");

  const normalizedPayload = { ...payload };
  if (normalizedPayload.TaxaServicoValor === undefined && normalizedPayload.BonusValor !== undefined) {
    normalizedPayload.TaxaServicoValor = normalizedPayload.BonusValor;
  }

  const now = nowIso();
  const edicoes = [...(currentLine.EdicoesManuais || [])];
  const diffsAuditoria = [];

  const editableMap = [
    { payloadKey: "SalarioBase", storeKey: "SalarioBaseManual", label: "Salário Base", currentKey: "SalarioBase" },
    { payloadKey: "ValorFichasHouseTx", storeKey: "ValorFichasHouseTxManual", label: "Fichas House TX (-20%)", currentKey: "ValorFichasHouseTx" },
    { payloadKey: "ValorFichasFoodParkTx", storeKey: "ValorFichasFoodParkTxManual", label: "Fichas FoodPark (-20%)", currentKey: "ValorFichasFoodParkTx" },
    { payloadKey: "TaxaServicoValor", storeKey: "TaxaServicoValor", label: "10% Taxa de Serviço (R$)", currentKey: "TaxaServicoValor" },
    { payloadKey: "TotalValesAdiantamentos", storeKey: "TotalValesAdiantamentosManual", label: "Desconto de Vales (R$)", currentKey: "TotalValesAdiantamentos" },
    { payloadKey: "FaltasInjustificadas", storeKey: "FaltasInjustificadas", label: "Faltas Injustificadas (Qtd)", currentKey: "FaltasInjustificadas" },
    { payloadKey: "DescontoFaltasAtrasos", storeKey: "DescontoFaltasAtrasos", label: "Desconto de Faltas (R$)", currentKey: "DescontoFaltasAtrasos" },
    { payloadKey: "ConsumoInternoValor", storeKey: "ConsumoInternoValor", label: "Outros Descontos (R$)", currentKey: "ConsumoInternoValor" },
    { payloadKey: "QuebraDeCaixaValor", storeKey: "QuebraDeCaixaValor", label: "Quebra de Caixa (R$)", currentKey: "QuebraDeCaixaValor" },
    { payloadKey: "StatusLinha", storeKey: "StatusLinha", label: "Status na Folha", currentKey: "StatusLinha" },
  ];

  const patchData = { ...currentLine };

  for (const item of editableMap) {
    if (normalizedPayload[item.payloadKey] !== undefined) {
      const valOriginalSistema =
        currentLine.ValoresOriginaisSistema?.[item.currentKey] ?? currentLine[item.currentKey];
      const valAnterior = currentLine[item.currentKey];
      const valNovo =
        item.payloadKey === "StatusLinha"
          ? String(normalizedPayload[item.payloadKey]).trim()
          : Number(normalizedPayload[item.payloadKey] || 0);

      if (String(valAnterior) !== String(valNovo)) {
        patchData[item.storeKey] = valNovo;
        patchData[item.currentKey] = valNovo;
        const isNumericText = item.payloadKey === "StatusLinha" || item.payloadKey === "FaltasInjustificadas";
        const fmtAnt = isNumericText ? String(valOriginalSistema) : formatCurrencyBRL(valOriginalSistema);
        const fmtNovo = isNumericText ? String(valNovo) : formatCurrencyBRL(valNovo);

        edicoes.push({
          campo: item.label,
          valorOriginalSistema: valOriginalSistema,
          valorAnterior: valAnterior,
          valorManual: valNovo,
          justificativa,
          autor: profile.Nome || profile.Email,
          dataHora: now,
        });
        diffsAuditoria.push({
          campo: item.label,
          valorAnterior: fmtAnt,
          valorNovo: fmtNovo,
          resumo: `${item.label} alterado manualmente de ${fmtAnt} para ${fmtNovo}. Motivo: ${justificativa}`,
        });
      }
    }
  }

  assert(diffsAuditoria.length > 0, "Nenhuma alteração de valor foi detectada na linha da folha.");

  const calc = recalculatePayrollLineNumbers(patchData);
  Object.assign(patchData, calc, {
    EditadoManualmente: true,
    EdicoesManuais: edicoes,
    UltimaJustificativa: justificativa,
    DataAtualizacao: now,
  });

  const existingSaved = await runtime.getById("FolhaLinhas", currentLine.LinhaID).catch(() => null);
  if (existingSaved) {
    await runtime.update("FolhaLinhas", currentLine.LinhaID, patchData);
  } else {
    await runtime.create("FolhaLinhas", patchData);
  }

  await audit("FOLHA_EDICAO_MANUAL", "FolhaSalarial", currentLine.LinhaID, {
    tela: "Tela 8 - Fechamento de Folha Salarial",
    employeeId: currentLine.FuncionarioID,
    employeeName: currentLine.FuncionarioNome,
    LojaID: currentLine.LojaID,
    campo: diffsAuditoria.map((d) => d.campo).join(", "),
    valorAnterior: diffsAuditoria.map((d) => d.valorAnterior).join(" | "),
    valorNovo: diffsAuditoria.map((d) => d.valorNovo).join(" | "),
    justificativa,
    diffs: diffsAuditoria,
    resumo: diffsAuditoria.map((d) => d.resumo).join(" | "),
    before: currentLine,
    after: patchData,
  });

  return success(patchData, "Ajuste manual registrado na Folha Salarial e gravado no Log de Auditoria.");
}

async function pagarFolhaColaborador(payload = {}) {
  const profile = await requireAdmin();
  const competencia = String(payload.competencia || payload.AnoMes || todayIso().slice(0, 7)).slice(0, 7);
  const quinzena = String(payload.quinzena || "mensal");
  const employeeId = String(payload.FuncionarioID || payload.employeeId || "").trim();
  assert(employeeId, "Colaborador não informado para pagamento.");

  const previa = await calcularLinhasFolhaPeriodo({
    competencia,
    quinzena,
    storeId: payload.LojaID || "",
    takeatItems: payload.takeatItems || null,
    takeatMappings: payload.takeatMappings || null,
  });
  const baseLine = previa.linhas.find((l) => String(l.FuncionarioID) === employeeId);
  assert(baseLine, "Colaborador não encontrado na folha do período selecionado.");

  const mergedLine = {
    ...baseLine,
    ...(payload.linhaSnapshot && typeof payload.linhaSnapshot === "object" ? payload.linhaSnapshot : {}),
  };
  const calc = recalculatePayrollLineNumbers(mergedLine);
  Object.assign(mergedLine, calc);

  const comprovanteUrl = String(payload.comprovanteUrl || payload.ComprovanteURL || "").trim();
  const comprovanteNome = String(payload.comprovanteNome || payload.ComprovanteNome || "").trim();
  const observacao = String(payload.observacao || payload.Observacao || "").trim();
  if (!payload.permitirSemComprovante) {
    assert(comprovanteUrl, "Anexe o comprovante de pagamento para concluir o pagamento.");
  }

  const now = nowIso();
  const pagamentoId = uuid();
  const payerName = profile.Nome || profile.Email || "Financeiro";
  const relatorioTexto = buildPayrollStatementText(mergedLine, previa.bounds, {
    titulo: "COMPROVANTE DE PAGAMENTO DE FOLHA",
    observacao,
    comprovanteNome,
    comprovanteUrl,
    responsavel: payerName,
    dataHora: now,
    acaoLabel: "Pago",
  });

  const hashRelatorio = await sha256Hex(relatorioTexto);
  const docId = `pag-folha-${pagamentoId}`;
  const isDataUrl = comprovanteUrl.startsWith("data:");
  const enviarColaborador = payload.enviarParaColaborador !== false;

  if (enviarColaborador) {
    const docRecord = {
      DocID: docId,
      FuncionarioID: mergedLine.FuncionarioID,
      FuncionarioNome: mergedLine.FuncionarioNome,
      NomeFuncionario: mergedLine.FuncionarioNome,
      CPF: mergedLine.CPF || "",
      CPFFuncionario: mergedLine.CPF || "",
      LojaID: mergedLine.LojaID,
      NomeLoja: mergedLine.NomeLoja || mergedLine.LojaID,
      Tipo: "Holerite",
      Categoria: "Holerite",
      SubtipoCodigo: "COMPROVANTE_PAGAMENTO_FOLHA",
      Titulo: `Comprovante de Pagamento - ${previa.bounds.chaveFechamento}`,
      Competencia: previa.bounds.competencia,
      MesReferencia: previa.bounds.competencia,
      ConteudoTexto: relatorioTexto,
      ArquivoOriginalBase64: isDataUrl ? comprovanteUrl : "",
      ArquivoUrl: comprovanteUrl || `data:text/plain;charset=utf-8,${encodeURIComponent(relatorioTexto)}`,
      ArquivoURL: comprovanteUrl || `data:text/plain;charset=utf-8,${encodeURIComponent(relatorioTexto)}`,
      ComprovanteURL: comprovanteUrl,
      ComprovanteNome: comprovanteNome,
      HashSHA256Original: hashRelatorio,
      ValorLiquido: mergedLine.ValorLiquido,
      RequerAssinatura: false,
      StatusAssinatura: "Pago",
      Status: "Disponível",
      CriadoPor: payerName,
      DataCriacao: now,
    };
    await runtime.create("Documentos", docRecord);

    await createNotification({
      LojaID: mergedLine.LojaID || "",
      DestinatarioID: mergedLine.FuncionarioID,
      Tipo: "Documentos",
      Assunto: `Pagamento realizado (${previa.bounds.competencia})`,
      Mensagem: `Seu pagamento de ${formatCurrencyBRL(mergedLine.ValorLiquido)} foi realizado. Confira o demonstrativo e comprovante em Holerites & Docs.`,
      RegistoRelacionadoID: docId,
    }).catch(() => {});
  }

  const emp = await runtime.getById("Funcionarios", employeeId).catch(() => null);
  const rawPhone = mergedLine.WhatsApp || emp?.WhatsApp || emp?.Telefone || emp?.Celular || "";
  const phone = normalizeWhatsAppNumber(rawPhone);
  const firstName = String(mergedLine.FuncionarioNome || "Colaborador").trim().split(/\s+/)[0];
  const waText = [
    `*GRUPO HOUSE 190 · PAGAMENTO CONFIRMADO*`,
    ``,
    `Olá, ${firstName}! Seu pagamento referente a *${previa.bounds.chaveFechamento}* foi efetuado.`,
    ``,
    `• Salário Base: ${formatCurrencyBRL(mergedLine.SalarioBase)}`,
    ...(Number(mergedLine.TaxaServicoValor || 0) > 0
      ? [`• (+) 10% Taxa de Serviço: ${formatCurrencyBRL(mergedLine.TaxaServicoValor)}`]
      : []),
    ...(Number(mergedLine.ValorFichasHouseTx || 0) > 0
      ? [`• (-) Fichas House TX (-20%): ${formatCurrencyBRL(mergedLine.ValorFichasHouseTx)}`]
      : []),
    ...(Number(mergedLine.ValorFichasFoodParkTx || 0) > 0
      ? [`• (-) Fichas FoodPark (-20%): ${formatCurrencyBRL(mergedLine.ValorFichasFoodParkTx)}`]
      : []),
    ...(Number(mergedLine.TotalValesAdiantamentos || 0) > 0
      ? [`• (-) Vales: ${formatCurrencyBRL(mergedLine.TotalValesAdiantamentos)}`]
      : []),
    ...(Number(mergedLine.DescontoFaltasAtrasos || 0) > 0
      ? [`• (-) Faltas (${Number(mergedLine.FaltasInjustificadas || 0)}x): ${formatCurrencyBRL(mergedLine.DescontoFaltasAtrasos)}`]
      : []),
    ...(Number(mergedLine.QuebraDeCaixaValor || 0) > 0
      ? [`• (-) Quebra de Caixa: ${formatCurrencyBRL(mergedLine.QuebraDeCaixaValor)}`]
      : []),
    ``,
    `*Valor Líquido Pago: ${formatCurrencyBRL(mergedLine.ValorLiquido)}*`,
    ``,
    `O relatório detalhado e o comprovante já estão salvos em *Holerites & Docs* no aplicativo.`,
  ].join("\n");

  const waUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waText)}` : "";
  let waMessageId = "";
  let waErro = "";
  if (enviarColaborador && phone && typeof window !== "undefined") {
    try {
      const sent = await requestWorker("/wa-send", { phone, text: waText });
      waMessageId = sent?.messageId || "";
    } catch (err) {
      waErro = err?.message || "Gateway WhatsApp indisponível no momento.";
    }
  }

  const paymentRecord = {
    PagamentoID: pagamentoId,
    LinhaID: mergedLine.LinhaID,
    AnoMes: previa.bounds.chaveFechamento,
    Competencia: previa.bounds.competencia,
    Quinzena: previa.bounds.quinzena,
    FuncionarioID: mergedLine.FuncionarioID,
    FuncionarioNome: mergedLine.FuncionarioNome,
    CPF: mergedLine.CPF || "",
    LojaID: mergedLine.LojaID || "",
    NomeLoja: mergedLine.NomeLoja || mergedLine.LojaID || "",
    Cargo: mergedLine.Cargo || "",
    SalarioBase: mergedLine.SalarioBase,
    ValorBrutoHouseTx: Number(mergedLine.ValorBrutoHouseTx || 0),
    ValorFichasHouseTx: mergedLine.ValorFichasHouseTx,
    ValorBrutoFoodParkTx: Number(mergedLine.ValorBrutoFoodParkTx || 0),
    ValorFichasFoodParkTx: mergedLine.ValorFichasFoodParkTx,
    TaxaServicoValor: mergedLine.TaxaServicoValor,
    TotalValesAdiantamentos: mergedLine.TotalValesAdiantamentos,
    FaltasInjustificadas: Number(mergedLine.FaltasInjustificadas || 0),
    DescontoFaltasAtrasos: mergedLine.DescontoFaltasAtrasos,
    ConsumoInternoValor: mergedLine.ConsumoInternoValor,
    QuebraDeCaixaValor: mergedLine.QuebraDeCaixaValor,
    TotalProventos: mergedLine.TotalProventos,
    TotalDescontos: mergedLine.TotalDescontos,
    ValorLiquido: mergedLine.ValorLiquido,
    ChavePix: mergedLine.ChavePix || "",
    ComprovanteURL: comprovanteUrl,
    ComprovanteNome: comprovanteNome,
    Observacao: observacao,
    RelatorioTexto: relatorioTexto,
    HashSHA256: hashRelatorio,
    DocumentoID: enviarColaborador ? docId : "",
    WhatsAppPhone: phone,
    WhatsAppEnviado: Boolean(waMessageId),
    WhatsAppMessageID: waMessageId,
    WhatsAppUrl: waUrl,
    WhatsAppErro: waErro,
    Status: "Pago",
    PagoPor: payerName,
    DataPagamento: now,
  };

  await runtime.create("FolhaPagamentos", paymentRecord);

  // Marca vales do periodo como deduzidos neste pagamento para não duplicar no mesmo mês
  const allVales = await runtime.list("SolicitacoesVale").catch(() => []);
  const valesDeduzidos = allVales.filter(
    (v) =>
      String(v.FuncionarioID || "") === employeeId &&
      v.Status === "Pago" &&
      !v.DeduzidoFolhaPagamentoID &&
      String(v.DataDesejada || v.Competencia || "").slice(0, 7) === previa.bounds.competencia,
  );
  for (const vale of valesDeduzidos) {
    await runtime.update("SolicitacoesVale", vale.ValeID, {
      ...vale,
      DeduzidoFolhaPagamentoID: pagamentoId,
      DeduzidoFolhaEm: now,
    }).catch(() => {});
  }

  // Zera os lançamentos variáveis do mês após salvar o histórico para o próximo mês iniciar limpo
  const linhaZeradaPosPagamento = {
    ...mergedLine,
    SalarioBaseManual: null,
    ValorFichasHouseTxManual: null,
    ValorFichasFoodParkTxManual: null,
    TotalValesAdiantamentosManual: null,
    ValorFichasHouseTx: 0,
    ValorFichasFoodParkTx: 0,
    TaxaServicoValor: 0,
    HorasExtrasValor: 0,
    BonusValor: 0,
    TotalValesAdiantamentos: 0,
    FaltasInjustificadas: 0,
    DescontoFaltasAtrasos: 0,
    ConsumoInternoValor: 0,
    QuebraDeCaixaValor: 0,
    TotalProventos: mergedLine.SalarioBase,
    TotalDescontos: 0,
    ValorLiquido: mergedLine.SalarioBase,
    StatusLinha: "Pago",
    Status: "Pago",
    UltimoPagamentoID: pagamentoId,
    UltimoPagamentoEm: now,
    UltimoValorPago: mergedLine.ValorLiquido,
    UltimoComprovanteURL: comprovanteUrl,
    EditadoManualmente: false,
    DataAtualizacao: now,
  };

  const existingSaved = await runtime.getById("FolhaLinhas", mergedLine.LinhaID).catch(() => null);
  if (existingSaved) {
    await runtime.update("FolhaLinhas", mergedLine.LinhaID, linhaZeradaPosPagamento);
  } else {
    await runtime.create("FolhaLinhas", linhaZeradaPosPagamento);
  }

  await audit("FOLHA_COLABORADOR_PAGO", "FolhaPagamentos", pagamentoId, {
    tela: "Tela 8 - Folha Salarial",
    employeeId: mergedLine.FuncionarioID,
    employeeName: mergedLine.FuncionarioNome,
    LojaID: mergedLine.LojaID,
    campo: "Pagamento",
    valorAnterior: mergedLine.StatusLinha || "Em Aberto",
    valorNovo: `Pago (${formatCurrencyBRL(mergedLine.ValorLiquido)})`,
    resumo: `Pagamento de ${formatCurrencyBRL(mergedLine.ValorLiquido)} realizado para ${mergedLine.FuncionarioNome} (${previa.bounds.chaveFechamento}) com comprovante salvo no histórico.`,
  });

  return success(
    {
      pagamento: paymentRecord,
      linhaAtualizada: linhaZeradaPosPagamento,
      whatsapp: {
        phone,
        deliveredViaGateway: Boolean(waMessageId),
        waUrl,
        error: waErro,
      },
    },
    waMessageId
      ? `Pagamento de ${formatCurrencyBRL(mergedLine.ValorLiquido)} salvo no histórico e notificado no WhatsApp!`
      : `Pagamento de ${formatCurrencyBRL(mergedLine.ValorLiquido)} registrado no histórico e enviado para o colaborador.`,
  );
}

async function zerarLinhaFolha(payload = {}) {
  const profile = await requireAdmin();
  const competencia = String(payload.competencia || payload.AnoMes || todayIso().slice(0, 7)).slice(0, 7);
  const quinzena = String(payload.quinzena || "mensal");
  const employeeId = String(payload.FuncionarioID || payload.employeeId || "").trim();
  assert(employeeId, "Colaborador não informado.");

  const bounds = resolvePeriodBounds(competencia, quinzena);
  const linhaKey = `${bounds.chaveFechamento}_${employeeId}`;
  const existing = await runtime.getById("FolhaLinhas", linhaKey).catch(() => null);
  if (!existing) {
    return success(null, "Linha já está zerada para preenchimento.");
  }

  const now = nowIso();
  const reset = {
    ...existing,
    SalarioBaseManual: null,
    ValorFichasHouseTxManual: null,
    ValorFichasFoodParkTxManual: null,
    TotalValesAdiantamentosManual: null,
    TaxaServicoValor: 0,
    HorasExtrasValor: 0,
    BonusValor: 0,
    FaltasInjustificadas: 0,
    DescontoFaltasAtrasos: 0,
    ConsumoInternoValor: 0,
    QuebraDeCaixaValor: 0,
    StatusLinha: "Em Aberto",
    Status: "Em Aberto",
    EditadoManualmente: false,
    DataAtualizacao: now,
  };
  await runtime.update("FolhaLinhas", linhaKey, reset);

  await audit("FOLHA_LINHA_ZERADA", "FolhaSalarial", linhaKey, {
    tela: "Tela 8 - Folha Salarial",
    employeeId,
    employeeName: existing.FuncionarioNome || "",
    LojaID: existing.LojaID || "",
    campo: "StatusLinha",
    valorAnterior: existing.StatusLinha || "Pago",
    valorNovo: "Em Aberto (zerada para novo preenchimento)",
    resumo: `Linha da folha (${bounds.chaveFechamento}) reaberta e zerada por ${profile.Nome || profile.Email}.`,
  });

  return success(reset, "Linha zerada e liberada para novo preenchimento.");
}

async function listarPagamentosFolha(filters = {}) {
  const profile = await requireManager();
  const competencia = String(filters.competencia || "").trim().slice(0, 7);
  const storeId = isAdmin(profile) ? String(filters.storeId || "").trim() : String(profile.LojaID || "").trim();
  const employeeId = String(filters.employeeId || "").trim();

  const rows = await runtime.list("FolhaPagamentos").catch(() => []);
  const filtered = rows
    .filter((item) => {
      if (competencia && String(item.Competencia || "") !== competencia) return false;
      if (storeId && String(item.LojaID || "") !== storeId) return false;
      if (employeeId && String(item.FuncionarioID || "") !== employeeId) return false;
      return true;
    })
    .sort((a, b) => String(b.DataPagamento || "").localeCompare(String(a.DataPagamento || "")));

  return success(filtered);
}

async function fecharFolhaSalarialMes(payload = {}) {
  const profile = await requireAdmin();
  const competencia = String(payload.competencia || payload.AnoMes || todayIso().slice(0, 7)).slice(0, 7);
  const quinzena = String(payload.quinzena || "mensal");
  const storeId = String(payload.LojaID || payload.storeId || "").trim();

  const previa = await calcularLinhasFolhaPeriodo({
    competencia,
    quinzena,
    storeId,
    takeatItems: payload.takeatItems || null,
    takeatMappings: payload.takeatMappings || null,
  });

  assert(!previa.folhaCongelada, "A Folha Salarial deste período já se encontra fechada.");
  assert(previa.linhas.length > 0, "Não há colaboradores ativos para fechar a folha neste período.");

  const now = nowIso();
  const espelhosGerados = [];

  for (const linha of previa.linhas) {
    const linhaCongelada = {
      ...linha,
      StatusLinha: payload.marcarComoPago ? "Pago" : "Fechado",
      Status: "Fechado",
      FechadoEm: now,
      FechadoPor: profile.Nome || profile.Email,
    };

    const existing = await runtime.getById("FolhaLinhas", linha.LinhaID).catch(() => null);
    if (existing) {
      await runtime.update("FolhaLinhas", linha.LinhaID, linhaCongelada);
    } else {
      await runtime.create("FolhaLinhas", linhaCongelada);
    }

    const espelhoTexto = buildPayrollStatementText(linha, previa.bounds, {
      titulo: "ESPELHO DETALHADO DE FECHAMENTO DE FOLHA",
      responsavel: profile.Nome || profile.Email,
      dataHora: now,
      acaoLabel: "Fechado",
    });

    const hashEspelho = await sha256Hex(espelhoTexto);
    const docId = `espelho-folha-${previa.bounds.chaveFechamento}-${linha.FuncionarioID}`;
    const docRecord = {
      DocID: docId,
      FuncionarioID: linha.FuncionarioID,
      FuncionarioNome: linha.FuncionarioNome,
      NomeFuncionario: linha.FuncionarioNome,
      CPF: linha.CPF || "",
      CPFFuncionario: linha.CPF || "",
      LojaID: linha.LojaID,
      NomeLoja: linha.NomeLoja || linha.LojaID,
      Tipo: "Holerite",
      Categoria: "Holerite",
      SubtipoCodigo: "ESPELHO_FOLHA_FECHADA",
      Titulo: `Espelho de Folha e Fichas - ${previa.bounds.chaveFechamento}`,
      Competencia: previa.bounds.competencia,
      MesReferencia: previa.bounds.competencia,
      ConteudoTexto: espelhoTexto,
      ArquivoURL: `data:text/plain;charset=utf-8,${encodeURIComponent(espelhoTexto)}`,
      HashSHA256Original: hashEspelho,
      ValorLiquido: linha.ValorLiquido,
      RequerAssinatura: true,
      StatusAssinatura: "Pendente",
      Status: "Pendente",
      CriadoPor: profile.Nome || profile.Email,
      DataCriacao: now,
    };

    const existingDoc = await runtime.getById("Documentos", docId).catch(() => null);
    if (existingDoc) {
      await runtime.update("Documentos", docId, docRecord);
    } else {
      await runtime.create("Documentos", docRecord);
    }
    espelhosGerados.push(docRecord);
  }

  const hashFechamento = await sha256Hex(JSON.stringify(previa.linhas));
  const fechamentoId = `${previa.bounds.chaveFechamento}_${storeId || "GLOBAL"}`;
  const fechamentoRecord = {
    FechamentoID: fechamentoId,
    ChavePeriodo: previa.bounds.chaveFechamento,
    AnoMes: previa.bounds.chaveFechamento,
    Competencia: previa.bounds.competencia,
    Quinzena: previa.bounds.quinzena,
    LojaID: storeId,
    Status: "Fechado",
    Totais: previa.totais,
    TotalColaboradores: previa.linhas.length,
    EspelhosEnviados: espelhosGerados.length,
    HashSHA256: hashFechamento,
    FechadoPor: profile.Nome || profile.Email,
    DataFechamento: now,
  };

  const existingFechamento = await runtime.getById("FechamentosMensais", fechamentoId).catch(() => null);
  if (existingFechamento) {
    await runtime.update("FechamentosMensais", fechamentoId, fechamentoRecord);
  } else {
    await runtime.create("FechamentosMensais", fechamentoRecord);
  }

  await audit("FOLHA_SALARIAL_FECHADA", "FolhaSalarial", fechamentoId, {
    tela: "Tela 8 - Fechamento de Folha Salarial",
    LojaID: storeId,
    campo: "Status",
    valorAnterior: "Em Aberto",
    valorNovo: `Fechado (${espelhosGerados.length} espelhos enviados para Tela 7 | Líquido Total: ${formatCurrencyBRL(previa.totais.totalLiquido)})`,
    resumo: `Folha Salarial ${previa.bounds.chaveFechamento} fechada e congelada. ${espelhosGerados.length} espelhos detalhados enviados automaticamente para a Tela 7 (Holerites e Recibos).`,
  });

  return success(
    {
      fechamento: fechamentoRecord,
      espelhosEnviados: espelhosGerados.length,
      totais: previa.totais,
    },
    `Folha do mês fechada! ${espelhosGerados.length} espelho(s) detalhado(s) foram enviados automaticamente para a Tela 7 (Holerites e Recibos).`,
  );
}

async function exportarFolhaSalarial(filters = {}) {
  const profile = await requireManager();
  const competencia = String(filters.competencia || filters.anoMes || todayIso().slice(0, 7)).slice(0, 7);
  const quinzena = String(filters.quinzena || "mensal");
  const storeId = isAdmin(profile) ? String(filters.storeId || filters.LojaID || "") : String(profile.LojaID || "");
  const formato = String(filters.formato || "xlsx").toLowerCase();

  const previa = await calcularLinhasFolhaPeriodo({
    competencia,
    quinzena,
    storeId,
    takeatItems: filters.takeatItems || null,
    takeatMappings: filters.takeatMappings || null,
  });

  const columns = [
    "Colaborador",
    "CPF",
    "Unidade",
    "Cargo",
    "SalarioBase",
    "FichasHouseTxDesconto20",
    "FichasFoodParkDesconto20",
    "TaxaServico10PorCento",
    "TotalProventos",
    "DescontoVales",
    "DescontoFaltas",
    "QuebraDeCaixa",
    "TotalDescontos",
    "ValorLiquido",
    "ChavePIX",
    "Status",
  ];

  const exportRows = previa.linhas.map((r) => ({
    Colaborador: r.FuncionarioNome,
    CPF: r.CPF,
    Unidade: r.NomeLoja || r.LojaID,
    Cargo: r.Cargo,
    SalarioBase: Number(r.SalarioBase || 0).toFixed(2),
    FichasHouseTxDesconto20: Number(r.ValorFichasHouseTx || 0).toFixed(2),
    FichasFoodParkDesconto20: Number(r.ValorFichasFoodParkTx || 0).toFixed(2),
    TaxaServico10PorCento: Number(r.TaxaServicoValor || 0).toFixed(2),
    TotalProventos: Number(r.TotalProventos || 0).toFixed(2),
    DescontoVales: Number(r.TotalValesAdiantamentos || 0).toFixed(2),
    DescontoFaltas: Number(r.DescontoFaltasAtrasos || 0).toFixed(2),
    QuebraDeCaixa: Number(r.QuebraDeCaixaValor || 0).toFixed(2),
    TotalDescontos: Number(r.TotalDescontos || 0).toFixed(2),
    ValorLiquido: Number(r.ValorLiquido || 0).toFixed(2),
    ChavePIX: r.ChavePix || "",
    Status: r.StatusLinha,
  }));

  const dataUrl = csvDataUrl(exportRows, columns);
  const fileName = `folha-salarial-${previa.bounds.chaveFechamento}.${formato === "pdf" ? "pdf" : "csv"}`;

  return success({
    formato,
    fileName,
    dataUrl,
    colunas: columns,
    linhas: exportRows,
    totais: previa.totais,
  });
}

export const createPortalHandlers = () => ({
  // Auditoria / RBAC
  listarHistoricoAlteracoes: (args) => listarHistoricoAlteracoes(unpackArg(args)),
  getEmployeeAuditHistory: (args) => {
    const val = unpackArg(args);
    return listarHistoricoAlteracoes(
      typeof val === "string" ? { employeeId: val } : val,
    );
  },

  // Tela 1: Login CPF e Recuperacao WhatsApp
  resolverLoginPorCpfOuEmail: (args) => resolverLoginPorCpfOuEmail(unpackArg(args)),
  solicitarRecuperacaoSenhaWhatsApp: (args) => solicitarRecuperacaoSenhaWhatsApp(unpackArg(args)),

  // Tela 2: Onboarding em 6 Etapas, Link Publico, Dossie e Kit Admissional PDF
  gerarLinkOnboarding: (args) => gerarLinkOnboarding(unpackArg(args)),
  consultarConviteOnboarding: (args) => consultarConviteOnboarding(unpackArg(args)),
  salvarAutocadastroOnboarding: (args) => salvarAutocadastroOnboarding(unpackArg(args)),
  sincronizarConvitesOnboarding: (args) => sincronizarConvitesOnboarding(unpackArg(args)),
  conferirLiberarAcessoOnboarding: (args) => conferirLiberarAcessoOnboarding(unpackArg(args)),
  salvarPreCadastroColaborador: (args) => salvarPreCadastroColaborador(unpackArg(args)),
  avancarEtapaOnboarding: (args) => avancarEtapaOnboarding(unpackArg(args)),
  enviarDocumentoAdmissional: (args) => enviarDocumentoAdmissional(unpackArg(args)),
  gerarKitAdmissionalPdf: (args) => gerarKitAdmissionalPdf(unpackArg(args)),
  assinarDocumentoEletronico: (args) => assinarDocumentoEletronico(unpackArg(args)),
  listarAlertasExperiencia: (args) => listarAlertasExperiencia(unpackArg(args)),

  // Tela 3: Atestados Medicos com Notificacao para Gerente e Diretoria
  enviarAtestadoMedico: (args) => enviarAtestadoMedico(unpackArg(args)),
  validarAtestadoMedico: (args) => validarAtestadoMedico(unpackArg(args)),

  // Tela 4: Solicitacoes de Vale / Adiantamento
  configurarLimiteVale: (args) => configurarLimiteVale(unpackArg(args)),
  solicitarVale: (args) => solicitarVale(unpackArg(args)),
  validarValeGerente: (args) => validarValeGerente(unpackArg(args)),
  aprovarPagarValeDiretoria: (args) => aprovarPagarValeDiretoria(unpackArg(args)),
  listarVales: (args) => listarVales(unpackArg(args)),

  // Tela 5: Valor de Ficha / Produtividade (House Tx vs FoodPark Tx)
  salvarConfiguracaoFicha: (args) => salvarConfiguracaoFicha(unpackArg(args)),
  listarConfiguracoesFicha: (args) => listarConfiguracoesFicha(unpackArg(args)),
  lancarFichaDiaria: (args) => lancarFichaDiaria(unpackArg(args)),
  consultarExtratoFichas: (args) => consultarExtratoFichas(unpackArg(args)),

  // Tela 6: POPs e Manuais de Treinamento
  salvarPopTreinamento: (args) => salvarPopTreinamento(unpackArg(args)),
  listarPopsTreinamentos: (args) => listarPopsTreinamentos(unpackArg(args)),
  confirmarLeituraPop: (args) => confirmarLeituraPop(unpackArg(args)),

  // Tela 7: Rastreamento de Visualizacao / Download de Holerites
  registrarEventoDocumento: (args) => registrarEventoDocumento(unpackArg(args)),

  // Tela 8: Fechamento de Folha Salarial e Pagamentos
  gerarPreviaFolhaSalarial: (args) => gerarPreviaFolhaSalarial(unpackArg(args)),
  editarLinhaFolhaManual: (args) => editarLinhaFolhaManual(unpackArg(args)),
  pagarFolhaColaborador: (args) => pagarFolhaColaborador(unpackArg(args)),
  zerarLinhaFolha: (args) => zerarLinhaFolha(unpackArg(args)),
  listarPagamentosFolha: (args) => listarPagamentosFolha(unpackArg(args)),
  fecharFolhaSalarialMes: (args) => fecharFolhaSalarialMes(unpackArg(args)),
  exportarFolhaSalarial: (args) => exportarFolhaSalarial(unpackArg(args)),
});
