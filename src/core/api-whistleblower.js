import { isAdmin, isManager, success } from "./api-base.js";
import { runtime } from "./runtime.js";
import { requestWorker } from "./worker-client.js";
import { assert, nowIso, uuid } from "./utils.js";

const STATUS_VALIDOS = [
  "Recebida",
  "Em Análise",
  "Em Investigação",
  "Concluída",
  "Arquivada",
];

/**
 * Cria os manipuladores da API para o Canal de Denúncias e Integridade (Whistleblowing)
 */
export function createWhistleblowerHandlers() {
  return {
    /**
     * Registro de novo relato (Anônimo ou Confidencial)
     */
    async denunciaCriar(args) {
      return requestWorker("/integrity/create", args?.[0] || {}, { public: true });
    },

    async denunciaConsultar(args) {
      return requestWorker("/integrity/consult", args?.[0] || {}, { public: true });
    },

    async denunciaEnviarMensagem(args) {
      return requestWorker("/integrity/message", args?.[0] || {}, { public: true });
    },

    /**
     * Listagem administrativa de denúncias para Gestores / RH / Compliance
     */
    async denunciasAdminListar(args) {
      const [filtros] = args || [];
      const profile = await runtime.requireProfile();
      assert(
        isAdmin(profile) || isManager(profile),
        "Acesso restrito ao Comitê de Ética e Administradores.",
      );

      const todas = await runtime.list("Denuncias", { profile });
      let lista = Array.isArray(todas) ? todas : [];

      // Filtro de loja para gerente
      if (isManager(profile) && !isAdmin(profile)) {
        const lojaGestor = String(profile.LojaID || "").trim();
        lista = lista.filter((d) => d.LojaID === lojaGestor || d.LojaID === "GERAL");
      }

      if (filtros && typeof filtros === "object") {
        if (filtros.status && filtros.status !== "todos") {
          lista = lista.filter((d) => d.Status === filtros.status);
        }
        if (filtros.categoria && filtros.categoria !== "todas") {
          lista = lista.filter((d) => d.Categoria === filtros.categoria);
        }
      }

      // Ordena por data decrescente
      lista.sort((a, b) => new Date(b.DataCriacao || 0) - new Date(a.DataCriacao || 0));

      return success({
        denuncias: lista,
        total: lista.length,
      });
    },

    /**
     * Obter detalhes e mensagens completas de uma denúncia (Administrativo)
     */
    async denunciaAdminObter(args) {
      const [protocoloInput] = args || [];
      const protocolo = String(protocoloInput || "").trim().toUpperCase();
      assert(protocolo, "Número de protocolo é obrigatório.");

      const profile = await runtime.requireProfile();
      assert(
        isAdmin(profile) || isManager(profile),
        "Acesso restrito a administradores.",
      );

      const denuncia = await runtime.getById("Denuncias", protocolo);
      assert(denuncia, "Relato não encontrado.");
      assert(isAdmin(profile) || denuncia.LojaID === profile.LojaID || denuncia.LojaID === "GERAL", "Relato fora da sua unidade.");

      const todasMensagens = await runtime.listWhere("DenunciasMensagens", "DenunciaID", protocolo);
      const mensagens = (todasMensagens || [])
        .filter((m) => String(m.DenunciaID || "").trim() === protocolo)
        .sort((a, b) => new Date(a.DataHora || 0) - new Date(b.DataHora || 0));

      return success({
        denuncia,
        mensagens,
      });
    },

    /**
     * Atualização de status e emissão de parecer pelo RH/Compliance
     */
    async denunciaAdminAtualizar(args) {
      const [payload] = args || [];
      assert(payload && typeof payload === "object", "Dados de atualização são obrigatórios.");

      const protocolo = String(payload.protocolo || payload.Protocolo || "").trim().toUpperCase();
      assert(protocolo, "Número de protocolo é obrigatório.");

      const profile = await runtime.requireProfile();
      assert(
        isAdmin(profile) || isManager(profile),
        "Apenas administradores e comitê de ética podem atualizar o status da denúncia.",
      );

      const denuncia = await runtime.getById("Denuncias", protocolo);
      assert(denuncia, "Relato não encontrado.");
      assert(isAdmin(profile) || denuncia.LojaID === profile.LojaID || denuncia.LojaID === "GERAL", "Relato fora da sua unidade.");

      const novoStatus = String(payload.status || payload.Status || "").trim();
      assert(
        !novoStatus || STATUS_VALIDOS.includes(novoStatus),
        `Status inválido. Opções: ${STATUS_VALIDOS.join(", ")}`,
      );

      const parecer = payload.parecer !== undefined ? String(payload.parecer).trim() : undefined;
      const respostaTexto = String(payload.respostaTexto || payload.RespostaTexto || "").trim();

      const patchData = {
        UltimaAtualizacao: nowIso(),
      };
      if (novoStatus) patchData.Status = novoStatus;
      if (parecer !== undefined) patchData.ParecerComite = parecer;

      await runtime.patch("Denuncias", protocolo, patchData);

      // Se enviou resposta oficial para o denunciante
      if (respostaTexto) {
        const mensagemId = `MSG_${Date.now()}_${uuid().slice(0, 4)}`;
        await runtime.create("DenunciasMensagens", {
          MensagemID: mensagemId,
          DenunciaID: protocolo,
          AutorTipo: "Comitê de Ética",
          AutorNome: profile.Nome || "Comitê de Ética / RH",
          Texto: respostaTexto,
          DataHora: nowIso(),
        });
      }

      const atualizada = await runtime.getById("Denuncias", protocolo);
      return success({
        atualizada: true,
        denuncia: atualizada,
      });
    },
  };
}
