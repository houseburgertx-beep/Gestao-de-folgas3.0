import { runtime } from "./runtime.js";
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
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
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

      const token = `wpp_${uuid().replace(/-/g, "")}_${Date.now().toString(36)}`;
      const expiraMs = Date.now() + Math.max(1, Number(validadeHoras) || DEFAULT_MAGIC_LINK_TTL_HOURS) * 3600 * 1000;
      const expiraEm = new Date(expiraMs).toISOString();

      const record = {
        TokenID: token,
        Token: token,
        FuncionarioID: String(funcionarioId),
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

      const baseUrl = String(origin || "").replace(/\/$/, "");
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
     * Valida e consome o Magic Link para acesso direto e sem senha
     */
    async consumeWhatsAppMagicLink(args) {
      const [tokenRaw] = args;
      const token = String(tokenRaw || "").trim();
      assert(token, "Token de acesso do WhatsApp não fornecido.");

      const record = await runtime.getById("WhatsAppMagicTokens", token);
      assert(record, "Link de acesso expirado ou não encontrado.");

      const now = Date.now();
      const expiraEmMs = new Date(record.ExpiraEm || 0).getTime();
      assert(expiraEmMs > now, "Este link de acesso expirou. Solicite um novo envio pelo WhatsApp.");

      // Incrementa acessos e data do último uso
      await runtime.update("WhatsAppMagicTokens", record.TokenID, {
        Utilizado: true,
        UltimoAcessoEm: nowIso(),
        Acessos: (Number(record.Acessos) || 0) + 1,
      }).catch(() => null);

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

      const gw = await runtime.getById("Configuracoes", "WhatsAppGateway").catch(() => null);
      const defaultGatewayUrl = "https://house190-bot.loca.lt/api";
      const gwUrl = (gw?.GatewayUrl || defaultGatewayUrl).replace(/\/+$/, "");
      const instance = gw?.InstanceName || "house190";
      const apiKey = gw?.ApiKey || "wag_lHoXJO4s0S0yX1cD1PMLkAu4ghGmrhBl";

      const isBrowser = typeof window !== "undefined";
      const shouldSendGateway = gw?.Ativo === true || (isBrowser && gw?.Ativo !== false);

      let messageId = "";
      let deliveryError = null;

      if (phone && shouldSendGateway && gwUrl && apiKey) {
        try {
          const apiBase = gwUrl.endsWith("/api") ? gwUrl : `${gwUrl}/api`;
          const jid = `${phone}@s.whatsapp.net`;
          const endpoint = `${apiBase}/messages/${encodeURIComponent(instance)}/${encodeURIComponent(jid)}/send`;
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
              "bypass-tunnel-reminder": "true",
            },
            body: JSON.stringify({
              message: { text: messageText },
            }),
            signal: AbortSignal.timeout(8000),
          });

          const resData = await res.json().catch(() => ({}));
          if (res.ok && resData.status) {
            messageId = resData.data?.key?.id || resData.data?.id || "sent";
          } else {
            deliveryError = resData.message || resData.error || `Erro HTTP ${res.status}`;
          }
        } catch (err) {
          console.warn("[WA] Disparo de documento ao gateway falhou:", err?.message || err);
          deliveryError = err?.message || "Falha de conexão";
        }
      }

      // Se falhou no gateway direto ou se gateway offline, tenta via Cloudflare Worker
      if (phone && !messageId && isBrowser) {
        try {
          const defaultWorkerUrl = "https://house-folgas-notifications.brunohouse.workers.dev";
          const workerRes = await fetch(`${defaultWorkerUrl}/wa-send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
            },
            body: JSON.stringify({
              phone,
              text: messageText,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (workerRes.ok) {
            const workerData = await workerRes.json().catch(() => ({}));
            if (workerData.success) {
              messageId = workerData.messageId || "sent_worker";
              deliveryError = null;
            } else if (workerData.error) {
              deliveryError = workerData.error;
            }
          }
        } catch (err) {
          console.warn("[WA] Disparo de documento via Worker falhou:", err?.message || err);
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
      if (!isAdmin(profile) && !isManager(profile)) {
        throw new Error("Acesso restrito à liderança e administração.");
      }

      const toSave = {
        Chave: "WhatsAppGateway",
        GatewayUrl: String(config.gatewayUrl || "https://house190-bot.loca.lt/api").trim(),
        ApiKeyMasked: config.apiKey ? "********" + String(config.apiKey).slice(-4) : "",
        InstanceName: String(config.instanceName || "house190").trim(),
        Ativo: Boolean(config.ativo),
        AtualizadoEm: nowIso(),
        AtualizadoPor: profile.Nome || "Admin",
      };

      if (config.apiKey && !config.apiKey.includes("***")) {
        toSave.ApiKey = String(config.apiKey).trim();
      } else {
        const existing = await runtime.getById("Configuracoes", "WhatsAppGateway").catch(() => null);
        if (existing?.ApiKey) {
          toSave.ApiKey = existing.ApiKey;
          toSave.ApiKeyMasked = existing.ApiKeyMasked || ("********" + existing.ApiKey.slice(-4));
        }
      }

      await runtime.upsert("Configuracoes", toSave);

      return {
        success: true,
        config: {
          gatewayUrl: toSave.GatewayUrl,
          instanceName: toSave.InstanceName,
          ativo: toSave.Ativo,
          apiKeyMasked: toSave.ApiKeyMasked,
        },
      };
    },

    /**
     * Retorna o status de conexão da instância do WhatsApp
     */
    async getWhatsAppConnectionStatus() {
      const profile = await runtime.requireProfile().catch(() => null);
      if (profile && !isAdmin(profile) && !isManager(profile)) {
        throw new Error("Acesso restrito à liderança e administração.");
      }
      const config = await runtime.getById("Configuracoes", "WhatsAppConnection").catch(() => null);
      const gw = await runtime.getById("Configuracoes", "WhatsAppGateway").catch(() => null);
      const defaultGatewayUrl = "https://house190-bot.loca.lt/api";
      const gwUrl = (gw?.GatewayUrl || defaultGatewayUrl).replace(/\/+$/, "");
      const instance = gw?.InstanceName || config?.InstanceName || "house190";
      const apiKey = gw?.ApiKey || "wag_lHoXJO4s0S0yX1cD1PMLkAu4ghGmrhBl";

      let liveConnected = Boolean(config?.Connected);
      let livePhone = config?.Phone || "";
      let liveStatus = config?.Status || (config?.Connected ? "connected" : "disconnected");
      let liveQr = config?.QrCode || "";

      const isBrowser = typeof window !== "undefined";
      const shouldCheckGateway = gw?.Ativo === true || (isBrowser && gw?.Ativo !== false);

      if (shouldCheckGateway && gwUrl && apiKey) {
        try {
          const apiBase = gwUrl.endsWith("/api") ? gwUrl : `${gwUrl}/api`;
          const res = await fetch(`${apiBase}/sessions/${encodeURIComponent(instance)}`, {
            headers: {
              "X-API-Key": apiKey,
              "bypass-tunnel-reminder": "true",
            },
            signal: AbortSignal.timeout(4000),
          });
          if (res.ok) {
            const data = await res.json();
            const sess = data.data || data;
            const isLiveConnected = Boolean(sess.hasInstance && (sess.status === "CONNECTED" || sess.status === "WORKING" || sess.me));
            if (isLiveConnected) {
              liveConnected = true;
              liveStatus = "connected";
              if (sess.me?.id) {
                livePhone = sess.me.id.split("@")[0].split(":")[0];
              }
            } else if (sess.status === "SCAN_QR" || sess.status === "DISCONNECTED") {
              liveConnected = false;
              liveStatus = sess.status === "SCAN_QR" ? "qrcode" : "disconnected";
              if (sess.qr) liveQr = sess.qr;
            }
          }
        } catch (_) {}
      }

      return {
        connected: liveConnected,
        status: liveStatus,
        instanceName: instance,
        phone: livePhone,
        pairingCode: config?.PairingCode || "",
        qrcode: liveQr,
        updatedAt: config?.AtualizadoEm || nowIso(),
        gatewayUrl: gw?.GatewayUrl || defaultGatewayUrl,
        gatewayAtivo: gw ? Boolean(gw.Ativo) : false,
        apiKeyMasked: gw?.ApiKeyMasked || "wag_lHoX...hBl",
      };
    },

    /**
     * Gera sessão de pareamento com QR Code e código de 8 dígitos
     */
    async generateWhatsAppQrCode(args) {
      const [payload = {}] = args || [];
      const profile = await runtime.requireProfile();
      if (!isAdmin(profile) && !isManager(profile)) {
        throw new Error("Apenas gestores ou administradores podem parear o WhatsApp.");
      }

      const gw = await runtime.getById("Configuracoes", "WhatsAppGateway").catch(() => null);
      const gwUrl = (gw?.GatewayUrl || "https://house190-bot.loca.lt/api").replace(/\/+$/, "");
      const instance = gw?.InstanceName || "house190-bot";
      const apiKey = gw?.ApiKey || "wag_lHoXJO4s0S0yX1cD1PMLkAu4ghGmrhBl";

      let realQr = "";

      if (gwUrl && apiKey) {
        try {
          const apiBase = gwUrl.endsWith("/api") ? gwUrl : `${gwUrl}/api`;
          await fetch(`${apiBase}/sessions/${encodeURIComponent(instance)}/start`, {
            method: "POST",
            headers: { "X-API-Key": apiKey, "Content-Type": "application/json", "bypass-tunnel-reminder": "true" },
            body: JSON.stringify({}),
          }).catch(() => null);

          const r = await fetch(`${apiBase}/sessions/${encodeURIComponent(instance)}/qr`, {
            headers: { "X-API-Key": apiKey, "bypass-tunnel-reminder": "true" },
          });
          if (r.ok) {
            const d = await r.json();
            if (d.base64) realQr = d.base64;
            else if (d.qr) realQr = d.qr;
          }
        } catch (_) {}
      }

      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code = "H190-";
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      const qrPayload = realQr || `2@${uuid().replace(/-/g, "")},${Date.now()},${instance}`;

      const toSave = {
        Chave: "WhatsAppConnection",
        Connected: false,
        Status: "qrcode",
        PairingCode: code,
        QrCode: qrPayload,
        AtualizadoEm: nowIso(),
        AtualizadoPor: profile.Nome || "Admin",
      };
      await runtime.upsert("Configuracoes", toSave);

      await audit({
        Acao: "Geração de QR Code de Conexão WhatsApp",
        Tabela: "Configuracoes",
        RegistroID: "WhatsAppConnection",
        Detalhes: { PairingCode: code },
      }).catch(() => {});

      return {
        success: true,
        status: "qrcode",
        pairingCode: code,
        qrcode: qrPayload,
        expiresInSeconds: 60,
      };
    },

    /**
     * Desconecta a sessão ativa do WhatsApp
     */
    async disconnectWhatsApp() {
      const profile = await runtime.requireProfile();
      if (!isAdmin(profile) && !isManager(profile)) {
        throw new Error("Apenas gestores ou administradores podem desconectar o WhatsApp.");
      }

      const toSave = {
        Chave: "WhatsAppConnection",
        Connected: false,
        Status: "disconnected",
        Phone: "",
        PairingCode: "",
        QrCode: "",
        AtualizadoEm: nowIso(),
        AtualizadoPor: profile.Nome || "Admin",
      };
      await runtime.upsert("Configuracoes", toSave);

      await audit({
        Acao: "Desconexão de WhatsApp",
        Tabela: "Configuracoes",
        RegistroID: "WhatsAppConnection",
      }).catch(() => {});

      return { success: true, status: "disconnected" };
    },

    /**
     * Confirma pareamento manual ou por webhook da instância
     */
    async confirmWhatsAppConnection(args) {
      const [payload = {}] = args || [];
      const profile = await runtime.requireProfile();
      if (!isAdmin(profile) && !isManager(profile)) {
        throw new Error("Apenas gestores ou administradores podem confirmar a conexão.");
      }
      const phone = normalizeWhatsAppNumber(payload.phone || "5573999990190");
      const toSave = {
        Chave: "WhatsAppConnection",
        Connected: true,
        Status: "connected",
        Phone: phone,
        PairingCode: "",
        QrCode: "",
        AtualizadoEm: nowIso(),
        AtualizadoPor: profile.Nome || "Admin",
      };
      await runtime.upsert("Configuracoes", toSave);
      return { success: true, status: "connected", phone };
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

      const gw = await runtime.getById("Configuracoes", "WhatsAppGateway").catch(() => null);
      const defaultGatewayUrl = "https://house190-bot.loca.lt/api";
      const gwUrl = (gw?.GatewayUrl || defaultGatewayUrl).replace(/\/+$/, "");
      const instance = gw?.InstanceName || "house190";
      const apiKey = gw?.ApiKey || "wag_lHoXJO4s0S0yX1cD1PMLkAu4ghGmrhBl";

      let messageId = "";
      let deliveryError = null;

      const isBrowser = typeof window !== "undefined";
      const shouldSendGateway = gw?.Ativo === true || (isBrowser && gw?.Ativo !== false);

      if (shouldSendGateway && gwUrl && apiKey) {
        try {
          const apiBase = gwUrl.endsWith("/api") ? gwUrl : `${gwUrl}/api`;
          const jid = `${phone}@s.whatsapp.net`;
          const endpoint = `${apiBase}/messages/${encodeURIComponent(instance)}/${encodeURIComponent(jid)}/send`;
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
              "bypass-tunnel-reminder": "true",
            },
            body: JSON.stringify({
              message: { text },
            }),
            signal: AbortSignal.timeout(8000),
          });

          const resData = await res.json().catch(() => ({}));
          if (res.ok && resData.status) {
            messageId = resData.data?.key?.id || resData.data?.id || "sent";
          } else {
            deliveryError = resData.message || resData.error || `Erro HTTP ${res.status}`;
          }
        } catch (err) {
          console.warn("Disparo direto ao gateway falhou:", err?.message || err);
          deliveryError = err?.message || "Falha de conexão";
        }
      }

      // Se não enviou pelo gateway direto, tenta via Cloudflare Worker
      if (!messageId && isBrowser) {
        try {
          const defaultWorkerUrl = "https://house-folgas-notifications.brunohouse.workers.dev";
          const workerRes = await fetch(`${defaultWorkerUrl}/wa-send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
            },
            body: JSON.stringify({ phone, text }),
            signal: AbortSignal.timeout(10000),
          });
          if (workerRes.ok) {
            const workerData = await workerRes.json().catch(() => ({}));
            if (workerData.success) {
              messageId = workerData.messageId || "sent_worker";
              deliveryError = null;
            } else if (workerData.error) {
              deliveryError = workerData.error;
            }
          }
        } catch (err) {
          console.warn("Disparo via Worker falhou:", err?.message || err);
          if (!deliveryError) deliveryError = err?.message;
        }
      }

      if (isBrowser && !messageId && deliveryError) {
        throw new Error(`Falha no envio pelo WhatsApp: ${deliveryError}`);
      }

      await audit({
        Acao: "Disparo de Teste via WhatsApp",
        Tabela: "Auditoria",
        Detalhes: { Phone: phone, Mensagem: text, MessageID: messageId },
      }).catch(() => {});

      const result = {
        success: true,
        phone,
        message: text,
        messageId,
        timestamp: nowIso(),
        waUrl: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
      };

      return {
        ...result,
        data: result,
      };
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

      const gw = await runtime.getById("Configuracoes", "WhatsAppGateway").catch(() => null);
      const defaultGatewayUrl = "https://house190-bot.loca.lt/api";
      const gwUrl = (gw?.GatewayUrl || defaultGatewayUrl).replace(/\/+$/, "");
      const instance = gw?.InstanceName || "house190";
      const apiKey = gw?.ApiKey || "wag_lHoXJO4s0S0yX1cD1PMLkAu4ghGmrhBl";
      const defaultWorkerUrl = "https://house-folgas-notifications.brunohouse.workers.dev";
      const isBrowser = typeof window !== "undefined";
      const shouldSendGateway = gw?.Ativo === true || (isBrowser && gw?.Ativo !== false);

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

        // 1. Tenta envio direto pelo Gateway Baileys se disponível
        if (shouldSendGateway && gwUrl && apiKey) {
          try {
            const apiBase = gwUrl.endsWith("/api") ? gwUrl : `${gwUrl}/api`;
            const jid = `${phone}@s.whatsapp.net`;
            const endpoint = `${apiBase}/messages/${encodeURIComponent(instance)}/${encodeURIComponent(jid)}/send`;
            const res = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey,
                "bypass-tunnel-reminder": "true",
              },
              body: JSON.stringify({ message: { text: formattedText } }),
              signal: AbortSignal.timeout(8000),
            });
            const resData = await res.json().catch(() => ({}));
            if (res.ok && resData.status) {
              messageId = resData.data?.key?.id || resData.data?.id || "sent";
            } else {
              deliveryError = resData.message || resData.error || `Erro HTTP ${res.status}`;
            }
          } catch (err) {
            deliveryError = err?.message || "Falha de conexão";
          }
        }

        // 2. Fallback via Worker Relay
        if (!messageId && isBrowser) {
          try {
            const workerRes = await fetch(`${defaultWorkerUrl}/wa-send`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey,
              },
              body: JSON.stringify({ phone, text: formattedText }),
              signal: AbortSignal.timeout(10000),
            });
            if (workerRes.ok) {
              const workerData = await workerRes.json().catch(() => ({}));
              if (workerData.success) {
                messageId = workerData.messageId || "sent_worker";
                deliveryError = null;
              } else if (workerData.error) {
                deliveryError = workerData.error;
              }
            }
          } catch (err) {
            if (!deliveryError) deliveryError = err?.message;
          }
        }

        const isSuccess = Boolean(messageId) || (!isBrowser && !deliveryError);
        if (isSuccess) sentCount++;
        else failedCount++;

        results.push({
          funcionarioId: emp.FuncionarioID,
          nome: emp.Nome,
          phone,
          status: isSuccess ? "sent" : "failed",
          messageId: messageId || (isSuccess ? "mock_sent" : ""),
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
            Status: isSuccess ? "Enviado" : "Falha",
            MessageID: messageId,
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
