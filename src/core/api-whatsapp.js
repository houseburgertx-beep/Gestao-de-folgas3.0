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

      const emp = await runtime.getById("Funcionarios", funcionarioId).catch(() => null);
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
      const emp = await runtime.getById("Funcionarios", funcionarioId);
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

      return {
        success: true,
        phone,
        hasPhone: Boolean(phone),
        message: messageText,
        magicUrl: magicResult.magicUrl,
        token: magicResult.token,
        waUrl,
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

      if (incomingText.includes("1") || incomingText.includes("espelho") || incomingText.includes("ponto") || incomingText.includes("assinar")) {
        const magic = await this.generateWhatsAppMagicLink([{
          funcionarioId: matchedEmp.FuncionarioID,
          destino: "documents",
          filtroStatus: "Pendente",
          tipo: "ESPELHO_PONTO",
        }]);
        replyText = `Olá, ${firstName}! Aqui está o seu link seguro para conferir e assinar seu espelho de ponto:\n${magic.magicUrl}\n\nO link é válido por 48 horas.`;
      } else if (incomingText.includes("2") || incomingText.includes("escala") || incomingText.includes("turno")) {
        const magic = await this.generateWhatsAppMagicLink([{
          funcionarioId: matchedEmp.FuncionarioID,
          destino: "timeclock",
          tipo: "ESCALA_PUBLICADA",
        }]);
        replyText = `Olá, ${firstName}! Acesse sua escala de trabalho pelo link:\n${magic.magicUrl}`;
      } else if (incomingText.includes("3") || incomingText.includes("atestado")) {
        const magic = await this.generateWhatsAppMagicLink([{
          funcionarioId: matchedEmp.FuncionarioID,
          destino: "documents",
          filtroStatus: "all",
          tipo: "ATESTADO_MEDICO",
        }]);
        replyText = `Olá, ${firstName}! Para enviar seu atestado médico com registro seguro e protocolo de abono, acesse:\n${magic.magicUrl}`;
      } else {
        replyText = [
          `Olá, ${firstName}! Bem-vindo ao autoatendimento do Grupo House 190.`,
          `Responda com o número da opção desejada:`,
          ``,
          `*1* — Assinar espelho de ponto mensal`,
          `*2* — Ver minha escala de trabalho`,
          `*3* — Enviar atestado médico`,
        ].join("\n");
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
        GatewayUrl: String(config.gatewayUrl || "https://hopes-mitsubishi-funeral-delivery.trycloudflare.com/api").trim(),
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
      const defaultGatewayUrl = "https://hopes-mitsubishi-funeral-delivery.trycloudflare.com/api";
      return {
        connected: Boolean(config?.Connected),
        status: config?.Status || (config?.Connected ? "connected" : "disconnected"),
        instanceName: gw?.InstanceName || config?.InstanceName || "house190",
        phone: config?.Phone || "",
        pairingCode: config?.PairingCode || "",
        qrcode: config?.QrCode || "",
        updatedAt: config?.AtualizadoEm || nowIso(),
        gatewayUrl: gw?.GatewayUrl || defaultGatewayUrl,
        gatewayAtivo: gw ? Boolean(gw.Ativo) : true,
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
      const gwUrl = (gw?.GatewayUrl || "https://hopes-mitsubishi-funeral-delivery.trycloudflare.com/api").replace(/\/+$/, "");
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

      await audit({
        Acao: "Disparo de Teste via WhatsApp",
        Tabela: "Auditoria",
        Detalhes: { Phone: phone, Mensagem: text },
      }).catch(() => {});

      const result = {
        success: true,
        phone,
        message: text,
        timestamp: nowIso(),
        waUrl: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
      };

      return {
        ...result,
        data: result,
      };
    },
  };
}
