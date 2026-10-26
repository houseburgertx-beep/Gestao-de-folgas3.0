import { createNotification, isAdmin, isManager, success } from "./api-base.js";
import { runtime } from "./runtime.js";
import { assert, nowIso, uuid } from "./utils.js";

const CATEGORIAS_VALIDAS = [
  "Assédio moral",
  "Assédio sexual",
  "Discriminação",
  "Desvio ou Fraude",
  "Conduta inadequada",
  "Segurança no trabalho",
  "Outro",
];

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
      const [payload] = args || [];
      assert(payload && typeof payload === "object", "Dados da denúncia são obrigatórios.");

      const categoria = String(payload.categoria || payload.Categoria || "").trim();
      assert(categoria, "Selecione a categoria do relato.");
      assert(
        CATEGORIAS_VALIDAS.includes(categoria),
        `Categoria inválida. Opções: ${CATEGORIAS_VALIDAS.join(", ")}`,
      );

      const descricao = String(payload.descricao || payload.Descricao || "").trim();
      assert(descricao.length >= 10, "A descrição dos fatos deve conter no mínimo 10 caracteres.");

      const lojaId = String(payload.lojaId || payload.LojaID || "GERAL").trim();
      const envolvidos = String(payload.envolvidos || payload.Envolvidos || "Não informado").trim();
      const anonimo = payload.anonimo === true || payload.Anonimo === true;
      const nomeContato = anonimo ? "Anônimo" : String(payload.nomeContato || payload.NomeContato || "Não informado").trim();
      const telefoneContato = anonimo ? "" : String(payload.telefoneContato || payload.TelefoneContato || "").trim();

      // Geração de protocolo único DEN-XXXXXX e PIN de 4 dígitos
      const protocolo = `DEN-${String(Date.now()).slice(-6)}`;
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      const dataCriacao = nowIso();

      const registro = {
        DenunciaID: protocolo,
        PIN: pin,
        Categoria: categoria,
        LojaID: lojaId,
        Descricao: descricao,
        Envolvidos: envolvidos,
        Anonimo: anonimo,
        NomeContato: nomeContato,
        TelefoneContato: telefoneContato,
        Status: "Recebida",
        DataCriacao: dataCriacao,
        UltimaAtualizacao: dataCriacao,
        ParecerComite: "",
      };

      await runtime.create("Denuncias", registro);

      // Grava mensagem inicial na trilha da denúncia
      const mensagemInicialId = `MSG_${Date.now()}_${uuid().slice(0, 4)}`;
      await runtime.create("DenunciasMensagens", {
        MensagemID: mensagemInicialId,
        DenunciaID: protocolo,
        AutorTipo: "Denunciante",
        AutorNome: anonimo ? "Denunciante Anônimo" : nomeContato,
        Texto: descricao,
        DataHora: dataCriacao,
      });

      // Notifica liderança de conformidade
      try {
        await createNotification({
          storeId: lojaId !== "GERAL" ? lojaId : "",
          type: "Governança",
          subject: "Novo Relato no Canal de Integridade",
          message: `Relato sob protocolo ${protocolo} (${categoria}) recebido para triagem.`,
          relatedId: protocolo,
        });
      } catch (err) {
        console.warn("[whistleblower] Falha ao criar notificação de governança:", err);
      }

      return success({
        protocolo,
        pin,
        categoria,
        status: "Recebida",
        dataCriacao,
        mensagem: "Relato registrado com sucesso. Guarde o protocolo e o PIN com segurança.",
      });
    },

    /**
     * Consulta pública/segura por Protocolo + PIN
     */
    async denunciaConsultar(args) {
      const [payload] = args || [];
      assert(payload && typeof payload === "object", "Parâmetros de consulta obrigatórios.");

      const protocolo = String(payload.protocolo || payload.Protocolo || "").trim().toUpperCase();
      assert(protocolo, "Número de protocolo é obrigatório.");

      const pin = String(payload.pin || payload.PIN || "").trim();
      assert(pin, "PIN de segurança é obrigatório.");

      const denuncia = await runtime.getById("Denuncias", protocolo);
      assert(denuncia, "Nenhum relato encontrado com este protocolo.");
      assert(
        String(denuncia.PIN || "").trim() === pin,
        "PIN incorreto para este protocolo de denúncia.",
      );

      // Mensagens da denúncia
      const todasMensagens = await runtime.list("DenunciasMensagens");
      const mensagens = (todasMensagens || [])
        .filter((m) => String(m.DenunciaID || "").trim() === protocolo)
        .sort((a, b) => new Date(a.DataHora || 0) - new Date(b.DataHora || 0))
        .map((m) => ({
          mensagemId: m.MensagemID,
          autorTipo: m.AutorTipo,
          autorNome: m.AutorTipo === "Denunciante" ? "Você" : "Comitê de Ética / RH",
          texto: m.Texto,
          dataHora: m.DataHora,
        }));

      return success({
        protocolo: denuncia.DenunciaID,
        categoria: denuncia.Categoria,
        lojaId: denuncia.LojaID,
        status: denuncia.Status,
        dataCriacao: denuncia.DataCriacao,
        parecerComite: denuncia.ParecerComite || "",
        ultimaAtualizacao: denuncia.UltimaAtualizacao || denuncia.DataCriacao,
        mensagens,
      });
    },

    /**
     * Envio de mensagem ou esclarecimento pelo denunciante
     */
    async denunciaEnviarMensagem(args) {
      const [payload] = args || [];
      assert(payload && typeof payload === "object", "Dados da mensagem são obrigatórios.");

      const protocolo = String(payload.protocolo || payload.Protocolo || "").trim().toUpperCase();
      assert(protocolo, "Número de protocolo é obrigatório.");

      const pin = String(payload.pin || payload.PIN || "").trim();
      assert(pin, "PIN de segurança é obrigatório.");

      const texto = String(payload.texto || payload.Texto || "").trim();
      assert(texto.length >= 2, "Mensagem vazia.");

      const denuncia = await runtime.getById("Denuncias", protocolo);
      assert(denuncia, "Relato não encontrado.");
      assert(
        String(denuncia.PIN || "").trim() === pin,
        "PIN incorreto.",
      );

      const dataHora = nowIso();
      const mensagemId = `MSG_${Date.now()}_${uuid().slice(0, 4)}`;

      await runtime.create("DenunciasMensagens", {
        MensagemID: mensagemId,
        DenunciaID: protocolo,
        AutorTipo: "Denunciante",
        AutorNome: denuncia.Anonimo ? "Denunciante Anônimo" : (denuncia.NomeContato || "Denunciante"),
        Texto: texto,
        DataHora: dataHora,
      });

      await runtime.patch("Denuncias", protocolo, {
        UltimaAtualizacao: dataHora,
      });

      return success({
        enviada: true,
        mensagemId,
        dataHora,
      });
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

      const todasMensagens = await runtime.list("DenunciasMensagens");
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
