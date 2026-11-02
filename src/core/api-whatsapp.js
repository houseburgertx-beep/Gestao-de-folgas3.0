import { runtime } from "./runtime.js";
import { requestWorker } from "./worker-client.js";
import {
  assert,
  nowIso,
  uuid,
} from "./utils.js";
import {
  audit,
  isAdmin,
  isManager,
  requireAdmin,
} from "./api-base.js";
import { createHouseAIHandlers } from "./api-house-ai.js";

const DEFAULT_MAGIC_LINK_TTL_HOURS = 48;

/**
 * Normaliza número de telefone para formato padrão internacional do WhatsApp (+55...)
 */
export function normalizeWhatsAppNumber(raw) {
  const input = String(raw || "").trim();
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.startsWith("55") && [12, 13].includes(digits.length)) {
    const local = digits.slice(2);
    return /^[1-9]\d(?:9\d{8}|[2-9]\d{7})$/.test(local) ? digits : "";
  }
  if ([10, 11].includes(digits.length) && /^[1-9]\d(?:9\d{8}|[2-9]\d{7})$/.test(digits)) return `55${digits}`;
  // International numbers require an explicit country-code marker.
  if (input.startsWith("+") && !digits.startsWith("55") && /^[1-9]\d{9,14}$/.test(digits)) return digits;
  return "";
}

/**
 * Formata nome do mês por extenso para mensagens humanizadas
 */
function formatMonthLong(monthIso) {
  if (!monthIso) return "";
  const [year, mNum] = String(monthIso).split("-");
  const monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const name = monthNames[Number(mNum) - 1] || mNum;
  return `${name} de ${year}`;
}

export function createWhatsAppHandlers() {
  return {
    /**
     * Gera um Magic Link com token temporário e descartável
     */
    async generateWhatsAppMagicLink(args) {
      const [payload = {}] = args;
      const {
        funcionarioId,
        destino = "documents",
        filtroStatus = "Pendente",
        mesReferencia = "",
        validadeHoras = DEFAULT_MAGIC_LINK_TTL_HOURS,
        origin = "",
        tipo = "ESPELHO_PONTO",
        docId = "",
      } = payload;

      const profile = await runtime.requireProfile();
      assert(funcionarioId, "Identificador do colaborador não informado.");

      let emp = await runtime.getById("Funcionarios", funcionarioId).catch(() => null);
      if (!emp) {
        const allEmps = await runtime.list("Funcionarios").catch(() => []);
        const targetId = String(funcionarioId).trim().toLowerCase();
        emp = allEmps.find((e) => {
          const fId = String(e.FuncionarioID || e.funcionarioId || e.id || "").trim().toLowerCase();
          const fName = String(e.Nome || e.nome || "").trim().toLowerCase();
          const fEmail = String(e.Email || e.email || "").trim().toLowerCase();
          return fId === targetId || fName === targetId || (fEmail && fEmail === targetId);
        });
      }
      assert(emp, "Colaborador não encontrado.");
      const canonicalEmployeeId = String(emp.FuncionarioID || emp.id || "");
      assert(canonicalEmployeeId, "Cadastro do colaborador sem identificador válido.");
      const ownEmployee = String(profile.FuncionarioID || "") === canonicalEmployeeId;
      const managerOfStore = isManager(profile) && profile.LojaID && String(profile.LojaID) === String(emp.LojaID || "");
      assert(ownEmployee || isAdmin(profile) || managerOfStore, "Você só pode gerar links para seu cadastro ou para colaboradores da sua loja.");

      const token = `wpp_${uuid().replace(/-/g, "")}_${Date.now().toString(36)}`;
      const requestedHours = Number(validadeHoras);
      const lifetime = Number.isFinite(requestedHours) ? Math.min(48, Math.max(1, requestedHours)) : DEFAULT_MAGIC_LINK_TTL_HOURS;
      const expiraMs = Date.now() + lifetime * 3600 * 1000;
      const expiraEm = new Date(expiraMs).toISOString();

      const record = {
        TokenID: token,
        Token: token,
        FuncionarioID: canonicalEmployeeId,
        FuncionarioStorageKey: await runtime.resolveStorageKey("Funcionarios", canonicalEmployeeId),
        NomeFuncionario: emp.Nome || "Colaborador",
        Telefone: normalizeWhatsAppNumber(emp.Telefone || emp.WhatsApp || emp.Celular || ""),
        LojaID: emp.LojaID || "",
        Destino: destino,
        FiltroStatus: filtroStatus,
        MesReferencia: mesReferencia || "",
        Tipo: tipo,
        DocID: docId || "",
        CriadoEm: nowIso(),
        ExpiraEm: expiraEm,
        Utilizado: false,
        Acessos: 0,
      };

      await runtime.upsert("WhatsAppMagicTokens", record);

      const baseUrl = String(origin || (typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "https://houseburgertx-beep.github.io/Gestao-de-folgas3.0")).replace(/\/$/, "");
      const magicUrl = `${baseUrl}/?magic_token=${encodeURIComponent(token)}`;

      return {
        success: true,
        token,
        magicUrl,
        expiraEm,
        funcionario: {
          id: emp.FuncionarioID || funcionarioId,
          nome: emp.Nome,
          telefone: record.Telefone,
        },
      };
    },

    /**
     * Valida o link de navegação após login do próprio colaborador.
     */
    async consumeWhatsAppMagicLink(args) {
      const profile = await runtime.requireProfile();
      const ownerUid = runtime.auth?.currentUser?.uid || "";
      const [tokenRaw] = args;
      const token = String(tokenRaw || "").trim();
      assert(token, "Token de acesso do WhatsApp não fornecido.");

      const record = await runtime.getById("WhatsAppMagicTokens", token);
      assert(record, "Link de acesso expirado ou não encontrado.");
      assert(profile.FuncionarioID && String(profile.FuncionarioID) === String(record.FuncionarioID), "Este link pertence a outro colaborador. Entre com a conta destinatária.");
      assert(!ownerUid || runtime.auth?.currentUser?.uid === ownerUid, "A conta conectada mudou. Abra o link novamente na conta destinatária.");

      const now = Date.now();
      const expiraEmMs = new Date(record.ExpiraEm || 0).getTime();
      assert(expiraEmMs > now, "Este link de acesso expirou. Solicite um novo envio pelo WhatsApp.");

      // This is an authenticated navigation hint, never an authentication token.
      // Reopening by the same logged-in recipient is allowed until expiration.
      // Access metadata must persist; an offline/denied update is not success.
      await runtime.patch("WhatsAppMagicTokens", record.TokenID, {
        Utilizado: true,
        UltimoAcessoEm: nowIso(),
        Acessos: (Number(record.Acessos) || 0) + 1,
      });
      assert(!ownerUid || runtime.auth?.currentUser?.uid === ownerUid, "A conta conectada mudou. Abra o link novamente na conta destinatária.");

      const emp = await runtime.getById("Funcionarios", record.FuncionarioID).catch(() => null);

      await audit({
        Acao: "Acesso por Magic Link do WhatsApp",
        Tabela: "WhatsAppMagicTokens",
        RegistroID: record.TokenID,
        Detalhes: {
          FuncionarioID: record.FuncionarioID,
          Destino: record.Destino,
          Tipo: record.Tipo,
          MesReferencia: record.MesReferencia,
        },
      }).catch(() => {});

      assert(!ownerUid || runtime.auth?.currentUser?.uid === ownerUid, "A conta conectada mudou. Abra o link novamente na conta destinatária.");
      return {
        success: true,
        token: record.Token,
        funcionarioId: record.FuncionarioID,
        nomeFuncionario: record.NomeFuncionario || emp?.Nome || "Colaborador",
        lojaId: record.LojaID || emp?.LojaID || "",
        destino: record.Destino || "documents",
        filtroStatus: record.FiltroStatus || "Pendente",
        mesReferencia: record.MesReferencia || "",
        docId: record.DocID || "",
        tipo: record.Tipo || "ESPELHO_PONTO",
        employee: emp ? {
          FuncionarioID: emp.FuncionarioID || record.FuncionarioID,
          Nome: emp.Nome,
          CPF: emp.CPF || "",
          Cargo: emp.Cargo || "",
          LojaID: emp.LojaID || "",
          Perfil: emp.Perfil || "Funcionário",
        } : null,
      };
    },

    /**
     * Gera mensagem estruturada de notificação compatível com o padrão oficial do WhatsApp
     */
    async generateWhatsAppNotificationMessage(args) {
      const [payload = {}] = args;
      let {
        funcionarioId,
        tipo = "ESPELHO_PONTO",
        docId = "",
        mesReferencia = "",
        origin = "",
      } = payload;

      if (docId) {
        const doc = await runtime.getById("Documentos", docId).catch(() => null);
        if (doc) {
          if (!funcionarioId) funcionarioId = doc.FuncionarioID;
          if (!mesReferencia) mesReferencia = doc.MesReferencia;
          if (doc.Tipo === "Espelho de Ponto" || String(doc.DocID || "").startsWith("ESPELHO_")) {
            tipo = "ESPELHO_PONTO";
          } else if (doc.Tipo === "Holerite") {
            tipo = "HOLERITE";
          }
        }
      }

      assert(funcionarioId, "Identificador do colaborador não fornecido.");
      let emp = await runtime.getById("Funcionarios", funcionarioId).catch(() => null);
      if (!emp) {
        const allEmps = await runtime.list("Funcionarios").catch(() => []);
        const targetId = String(funcionarioId).trim().toLowerCase();
        emp = allEmps.find((e) => {
          const fId = String(e.FuncionarioID || e.funcionarioId || e.id || "").trim().toLowerCase();
          const fName = String(e.Nome || e.nome || "").trim().toLowerCase();
          const fEmail = String(e.Email || e.email || "").trim().toLowerCase();
          return fId === targetId || fName === targetId || (fEmail && fEmail === targetId);
        });
      }
      assert(emp, "Colaborador não cadastrado no sistema.");

      const phone = normalizeWhatsAppNumber(emp.Telefone || emp.WhatsApp || emp.Celular || "");
      const firstName = String(emp.Nome || "Colaborador").trim().split(" ")[0];

      // Gera o magic link atrelado
      const magicResult = await this.generateWhatsAppMagicLink([{
        funcionarioId,
        destino: "documents",
        filtroStatus: "Pendente",
        mesReferencia,
        origin,
        tipo,
        docId,
      }]);

      let messageText = "";
      if (tipo === "ESPELHO_PONTO") {
        const monthLabel = formatMonthLong(mesReferencia) || "mensal";
        messageText = [
          `Olá, ${firstName}!`,
          `Seu espelho de ponto referente a *${monthLabel}* já está disponível para conferência e assinatura eletrônica (Portaria 671 MTE).`,
          ``,
          `Acesse pelo link seguro para conferir e assinar direto pelo celular:`,
          magicResult.magicUrl,
          ``,
          `_Grupo House 190 • Gestão Oficial de Ponto_`,
        ].join("\n");
      } else if (tipo === "ESCALA_PUBLICADA") {
        messageText = [
          `Olá, ${firstName}!`,
          `A escala de trabalho da próxima semana foi publicada pela gerência da House 190.`,
          ``,
          `Acesse o link seguro para visualizar seus turnos e confirmar ciência:`,
          magicResult.magicUrl,
          ``,
          `_Grupo House 190 • Escala Operacional_`,
        ].join("\n");
      } else if (tipo === "TROCA_FOLGA") {
        messageText = [
          `Olá, ${firstName}!`,
          `Você recebeu uma nova solicitação de troca de folga de um colega de equipe.`,
          ``,
          `Acesse para avaliar os detalhes e responder (aceitar ou recusar):`,
          magicResult.magicUrl,
          ``,
          `_Grupo House 190 • Trocas P2P_`,
        ].join("\n");
      } else if (tipo === "ADMISSAO_EXPRESS") {
        messageText = [
          `Olá, ${firstName}!`,
          `Seja bem-vindo(a) à equipe do Grupo House 190.`,
          ``,
          `Acesse o link seguro abaixo para enviar as fotos dos seus documentos de admissão:`,
          magicResult.magicUrl,
          ``,
          `_Grupo House 190 • Admissão Express_`,
        ].join("\n");
      } else {
        messageText = [
          `Olá, ${firstName}!`,
          `Você possui uma nova notificação operacional no sistema do Grupo House 190.`,
          ``,
          `Acesse pelo link seguro:`,
          magicResult.magicUrl,
        ].join("\n");
      }

      const waUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}` : "";

      let messageId = "";
      let deliveryError = null;
      if (phone && typeof window !== "undefined") {
        try {
          const sent = await requestWorker("/wa-send", { phone, text: messageText });
          messageId = sent.messageId || "";
          if (!messageId) deliveryError = "O gateway não confirmou o envio.";
        } catch (error) {
          deliveryError = error.message;
        }
      }

      await audit({
        Acao: "Notificação de Documento via WhatsApp",
        Tabela: "Documentos",
        RegistroID: docId || funcionarioId,
        Detalhes: { Phone: phone, Tipo: tipo, MessageID: messageId, DeliveryError: deliveryError },
      }).catch(() => {});

      return {
        success: true,
        phone,
        hasPhone: Boolean(phone),
        message: messageText,
        magicUrl: magicResult.magicUrl,
        token: magicResult.token,
        waUrl,
        messageId,
        deliveryError,
      };
    },

    /**
     * Processa webhook receptivo de mensagens (Meta Cloud API / Z-API / Evolution)
     */
    async processIncomingWhatsAppWebhook(args) {
      const [webhookPayload = {}] = args;

      // Extrai remetente e corpo de mensagem independente do provedor
      const fromNumber = normalizeWhatsAppNumber(
        webhookPayload.from ||
        webhookPayload.phone ||
        webhookPayload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from ||
        ""
      );
      const incomingText = String(
        webhookPayload.text ||
        webhookPayload.body ||
        webhookPayload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body ||
        ""
      ).trim().toLowerCase();

      if (!fromNumber) {
        return { handled: false, error: "Remetente não identificado no payload." };
      }

      // Localiza colaborador pelo telefone
      const employees = await runtime.list("Funcionarios");
      const matchedEmp = employees.find((e) => {
        const empPhone = normalizeWhatsAppNumber(e.Telefone || e.WhatsApp || e.Celular || "");
        return empPhone && empPhone === fromNumber;
      });

      let replyText = "";
      if (!matchedEmp) {
        replyText = "Olá! Este canal é exclusivo para colaboradores do Grupo House 190. Seu número não foi localizado no cadastro oficial de funcionários. Em caso de dúvidas, procure o seu gerente de loja.";
        return { handled: true, from: fromNumber, replyText, matched: false };
      }

      const firstName = String(matchedEmp.Nome || "").split(" ")[0];

      if (
        incomingText.includes("1") ||
        incomingText.includes("espelho") ||
        (incomingText.includes("assinar") && (incomingText.includes("ponto") || incomingText.includes("espelho")))
      ) {
        const magic = await this.generateWhatsAppMagicLink([{
          funcionarioId: matchedEmp.FuncionarioID,
          destino: "documents",
          filtroStatus: "Pendente",
          tipo: "ESPELHO_PONTO",
        }]);
        replyText = `Olá, ${firstName}! Aqui está o seu link seguro para conferir e assinar seu espelho de ponto:\n${magic.magicUrl}\n\nO link é válido por 48 horas.`;
      } else if (incomingText === "2" || incomingText.includes("escala") || incomingText.includes("turno")) {
        const magic = await this.generateWhatsAppMagicLink([{
          funcionarioId: matchedEmp.FuncionarioID,
          destino: "timeclock",
          tipo: "ESCALA_PUBLICADA",
        }]);
        replyText = `Olá, ${firstName}! Acesse sua escala de trabalho pelo link:\n${magic.magicUrl}`;
      } else if (incomingText === "3" || incomingText.includes("atestado")) {
        const magic = await this.generateWhatsAppMagicLink([{
          funcionarioId: matchedEmp.FuncionarioID,
          destino: "documents",
          filtroStatus: "all",
          tipo: "ATESTADO_MEDICO",
        }]);
        replyText = `Olá, ${firstName}! Para enviar seu atestado médico com registro seguro e protocolo de abono, acesse:\n${magic.magicUrl}`;
      } else {
        // Roteamento inteligente pela House AI
        const houseAI = createHouseAIHandlers();
        const aiResult = await houseAI.processWhatsAppWithHouseAI([
          { from: fromNumber, text: incomingText },
        ]);
        if (aiResult?.handled && aiResult?.replyText) {
          replyText = aiResult.replyText;
        } else {
          replyText = [
            `Olá, ${firstName}! Bem-vindo ao autoatendimento inteligente do Grupo House 190.`,
            `Você pode me fazer perguntas livres sobre suas folgas, banco de horas e escala, ou escolher uma das opções abaixo:`,
            ``,
            `*1* — Assinar espelho de ponto mensal`,
            `*2* — Ver minha escala de trabalho`,
            `*3* — Enviar atestado médico`,
          ].join("\n");
        }
      }

      await audit({
        Acao: "Mensagem Recebida via WhatsApp",
        Tabela: "Auditoria",
        Detalhes: {
          From: fromNumber,
          FuncionarioID: matchedEmp.FuncionarioID,
          TextoRecebido: incomingText,
          RespostaEnviada: replyText,
        },
      }).catch(() => {});

      return {
        handled: true,
        from: fromNumber,
        funcionarioId: matchedEmp.FuncionarioID,
        nome: matchedEmp.Nome,
        replyText,
      };
    },

    /**
     * Configura credenciais de gateway de WhatsApp (Liderança e Admin)
     */
    async configureWhatsAppGateway(args) {
      const [config = {}] = args;
      const profile = await runtime.requireProfile();
      assert(isAdmin(profile), "Apenas administradores podem alterar a configuração compartilhada do gateway.");
      return requestWorker("/wa-gateway-config", config);
    },

    async getWhatsAppConnectionStatus() {
      const profile = await runtime.requireProfile();
      assert(isAdmin(profile) || isManager(profile), "Acesso restrito à liderança e administração.");
      return requestWorker("/wa-status", {}, { timeout: 35000 });
    },

    async generateWhatsAppQrCode(args) {
      const profile = await runtime.requireProfile();
      assert(isAdmin(profile) || isManager(profile), "Apenas gestores ou administradores podem parear o WhatsApp.");
      return requestWorker("/wa-qr", args?.[0] || {}, { timeout: 55000 });
    },

    async disconnectWhatsApp() {
      const profile = await runtime.requireProfile();
      assert(isAdmin(profile) || isManager(profile), "Apenas gestores ou administradores podem desconectar o WhatsApp.");
      return requestWorker("/wa-disconnect");
    },

    // A conexão só é confirmada pelo estado real do gateway.
    async confirmWhatsAppConnection() {
      const status = await this.getWhatsAppConnectionStatus();
      assert(status.connected, "O WhatsApp ainda não confirmou a conexão. Conclua o pareamento no aparelho.");
      return { ...status, success: true };
    },

    /**
     * Dispara mensagem de teste para validação da rota de envio
     */
    async sendTestWhatsAppMessage(args) {
      const [payload = {}] = args || [];
      const profile = await runtime.requireProfile();
      const phone = normalizeWhatsAppNumber(payload.phone || "");
      assert(phone, "Informe um número de telefone com DDD para o teste.");

      const text = payload.message || `Teste de conexão oficial do Grupo House 190 via WhatsApp realizado por ${profile.Nome || "Gestão"} em ${new Date().toLocaleTimeString('pt-BR')}.`;

      assert(isAdmin(profile) || isManager(profile), "Acesso restrito à gestão.");
      let messageId = "";
      let deliveryError = null;
      try {
        const sent = await requestWorker("/wa-send", { phone, text });
        messageId = sent.messageId || "";
      } catch (error) {
        deliveryError = error.message;
      }

      // Resiliência Total: Se o gateway automatizado estiver offline ou em pareamento,
      // não interrompe o fluxo com erro fatal. O sistema gera a rota segura wa.me,
      // permitindo entrega imediata com 1 clique e registrando a auditoria.
      await audit({
        Acao: "Disparo de Teste via WhatsApp",
        Tabela: "Auditoria",
        Detalhes: {
          Phone: phone,
          Mensagem: text,
          MessageID: messageId || "wa_direct_link",
          DeliveredViaGateway: Boolean(messageId),
          DeliveryError: deliveryError,
        },
      }).catch(() => {});

      const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      const result = {
        success: true,
        deliveredViaGateway: Boolean(messageId),
        phone,
        message: text,
        messageId: messageId || "",
        timestamp: nowIso(),
        waUrl,
        offlineFallback: !messageId,
        warning: !messageId
          ? (deliveryError ? `Gateway offline: ${deliveryError}` : "Aparelho WhatsApp não conectado ao robô")
          : null,
      };

      return {
        ...result,
        data: result,
      };
    },

    /**
     * Envia mensagem motivacional automática de Ponto (Entrada, Saída, Intervalo) via WhatsApp
     */
    async sendTimeClockMotivationWhatsApp(args) {
      const [payload = {}] = args || [];
      const { employee, punch, type } = payload;
      if (!employee) return { handled: false, error: "Colaborador ausente." };

      const phone = normalizeWhatsAppNumber(
        employee.Telefone || employee.WhatsApp || employee.Celular || ""
      );
      if (!phone) return { handled: false, reason: "Sem telefone cadastrado." };

      const firstName = String(employee.Nome || "Colaborador").trim().split(/\s+/)[0];
      const punchTime = punch?.DataHora
        ? new Date(punch.DataHora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        : new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      let text = "";
      if (type === "ENTRADA") {
        text = `Olá, ${firstName}! Bom início de turno na House 190!\n\n` +
          `Seu ponto de ENTRADA foi registrado às ${punchTime} com sucesso.\n\n` +
          `Desejamos uma jornada produtiva, cheia de foco, energia e excelente trabalho em equipe. O sucesso do nosso salão e da nossa cozinha depende da dedicação de cada um de nós. Tenha um excelente trabalho hoje!`;
      } else if (type === "SAIDA") {
        text = `Excelente descanso, ${firstName}!\n\n` +
          `Sua jornada de hoje foi finalizada e registrada às ${punchTime} com sucesso.\n\n` +
          `Agradecemos imensamente por todo o seu empenho, dedicação e energia dedicados ao Grupo House 190 hoje. Descanse bastante e recarregue as energias para o próximo turno!`;
      } else if (type === "SAIDA_INTERVALO") {
        text = `Bom intervalo, ${firstName}!\n\n` +
          `Sua saída para descanso foi registrada às ${punchTime}.\n\n` +
          `Aproveite sua pausa para se alimentar com calma e recuperar o fôlego regulamentar.`;
      } else if (type === "RETORNO_INTERVALO") {
        text = `Bem-vindo(a) de volta do intervalo, ${firstName}!\n\n` +
          `Seu retorno foi registrado às ${punchTime}.\n\n` +
          `Desejamos uma ótima continuidade de turno e um excelente fechamento de dia!`;
      }

      if (!text) return { handled: false, reason: "Tipo sem mensagem definida." };

      const cleanText = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FAFF}\u{FE00}-\u{FE0F}]/gu, "").trim();

      try {
        const sent = await requestWorker("/wa-clock-event", {
          phone, employeeName: firstName, type, timeStr: punchTime,
          requestId: punch?.RequestID || punch?.RegistroPontoID || "",
        });
        return { handled: true, success: sent.success, messageId: sent.messageId };
      } catch (error) {
        console.warn("[ponto-whatsapp] Envio não confirmado:", error.message);
      }
      return { handled: false };
    },

    /**
     * Dispara um comunicado em massa para todos os colaboradores (ou filtrado por loja) via WhatsApp.
     */
    async broadcastWhatsAppAnnouncement(args) {
      const [payload = {}] = args || [];
      const profile = await runtime.requireProfile();
      if (!isAdmin(profile) && !isManager(profile)) {
        throw new Error("Apenas gestores ou administradores podem disparar comunicados em massa.");
      }

      const titulo = String(payload.titulo || payload.Titulo || "").trim();
      const mensagem = String(payload.mensagem || payload.Corpo || payload.corpo || "").trim();
      assert(titulo, "Informe o título do comunicado.");
      assert(mensagem, "Informe o texto do comunicado.");

      let targetStore = String(payload.lojaId || payload.LojaID || "").trim();
      if (!isAdmin(profile)) {
        targetStore = String(profile.LojaID || "").trim();
      }

      const employees = await runtime.list("Funcionarios", { profile: null }).catch(() => []);
      const eligibleEmployees = employees.filter((emp) => {
        if (emp.Ativo === false || emp.Status === "Inativo" || emp.status === "Inativo") return false;
        if (targetStore && targetStore !== "TODAS" && String(emp.LojaID || "") !== targetStore) return false;
        const rawPhone = emp.WhatsApp || emp.Telefone || emp.Celular || emp.whatsapp || emp.telefone || emp.celular || "";
        return Boolean(normalizeWhatsAppNumber(rawPhone));
      });

      assert(eligibleEmployees.length > 0, "Nenhum colaborador ativo com número de WhatsApp localizado para o filtro selecionado.");

      const isBrowser = typeof window !== "undefined";

      const results = [];
      let sentCount = 0;
      let failedCount = 0;

      for (const emp of eligibleEmployees) {
        const rawPhone = emp.WhatsApp || emp.Telefone || emp.Celular || emp.whatsapp || emp.telefone || emp.celular || "";
        const phone = normalizeWhatsAppNumber(rawPhone);
        if (!phone) continue;

        const firstName = String(emp.Nome || "Colaborador").trim().split(" ")[0];
        const formattedText = [
          `*GRUPO HOUSE 190 · COMUNICADO OFICIAL*`,
          ``,
          `Olá, ${firstName}!`,
          `*${titulo}*`,
          ``,
          mensagem,
          ``,
          `_Enviado pela gestão do Grupo House 190_`,
        ].join("\n");

        let messageId = "";
        let deliveryError = null;

        if (isBrowser) {
          try {
            const sent = await requestWorker("/wa-send", { phone, text: formattedText });
            messageId = sent.messageId || "";
            if (!messageId) deliveryError = "O gateway não confirmou o envio.";
          } catch (error) {
            deliveryError = error.message;
          }
        }

        const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(formattedText)}`;
        const isGatewaySent = Boolean(messageId);
        const isSuccess = isGatewaySent;
        if (isSuccess) {
          sentCount++;
        } else {
          failedCount++;
        }

        results.push({
          funcionarioId: emp.FuncionarioID,
          nome: emp.Nome,
          phone,
          status: isGatewaySent ? "sent" : (isSuccess ? "queued" : "ready_to_send"),
          deliveredViaGateway: isGatewaySent,
          messageId: messageId || (isSuccess ? "wa_batch" : ""),
          waUrl,
          error: deliveryError,
        });

        // Registro individual em Auditoria
        await audit(
          "Comunicado em Massa WhatsApp",
          "WhatsAppDisparos",
          phone,
          {
            FuncionarioID: emp.FuncionarioID,
            Nome: emp.Nome,
            Phone: phone,
            Titulo: titulo,
            Status: messageId ? "Enviado" : "Pronto para Envio",
            DeliveredViaGateway: Boolean(messageId),
            MessageID: messageId || "wa_direct_link",
            Erro: deliveryError,
          }
        ).catch(() => {});

        // Intervalo anti-bloqueio entre mensagens se houver mais colaboradores
        if (isBrowser && eligibleEmployees.length > 1) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      // Registro consolidado do broadcast
      await audit(
        "Disparo Consolidado de Comunicado WhatsApp",
        "Comunicados",
        titulo,
        {
          Titulo: titulo,
          TotalElegiveis: eligibleEmployees.length,
          Enviados: sentCount,
          Falhas: failedCount,
          LojaID: targetStore || "TODAS",
          Autor: profile.Nome || "Admin",
        }
      ).catch(() => {});

      return {
        success: sentCount > 0,
        total: eligibleEmployees.length,
        sentCount,
        failedCount,
        results,
      };
    },

    /**
     * Retorna os últimos disparos registrados no WhatsApp
     */
    async getWhatsAppHistory() {
      const profile = await runtime.requireProfile();
      if (!isAdmin(profile) && !isManager(profile)) {
        throw new Error("Acesso restrito à gestão.");
      }
      const logs = await runtime.list("Auditoria", { profile }).catch(() => []);
      const waLogs = logs
        .filter((l) => l.Modulo === "WhatsAppDisparos" || l.Tabela === "WhatsAppDisparos" || l.Acao?.includes?.("WhatsApp"))
        .sort((a, b) => String(b.DataHora || "").localeCompare(String(a.DataHora || "")))
        .map((l) => ({
          ...l,
          Detalhes: l.Detalhes || l.DadosNovos || {},
        }))
        .slice(0, 20);
      return { success: true, history: waLogs };
    },
  };
}
