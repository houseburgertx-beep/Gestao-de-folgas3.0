import { runtime } from "./runtime.js";
import { assert, nowIso, todayIso, uuid } from "./utils.js";
import { isAdmin, isManager, success } from "./api-base.js";

export function createTasksHandlers() {
  return {
    async tasksList(args) {
      const [lojaId, dataTurno] = args || [];
      const profile = await runtime.requireProfile();
      const targetStore = String(lojaId || (!isAdmin(profile) ? (profile.LojaID || "") : "")).trim();
      const rows = await runtime.list("Tarefas", { profile });
      const filtered = rows.filter((task) => {
        if (targetStore && String(task.LojaID || "") !== targetStore) {
          return false;
        }
        if (dataTurno && task.DataTurno && task.DataTurno !== dataTurno) {
          return false;
        }
        return true;
      });

      const priorityOrder = { Urgente: 0, Alta: 1, Media: 2, Baixa: 3 };
      filtered.sort((a, b) => {
        const pa = priorityOrder[a.Prioridade] ?? 4;
        const pb = priorityOrder[b.Prioridade] ?? 4;
        return pa - pb;
      });
      return success(filtered);
    },

    async tasksSave(args) {
      const [taskData] = args || [];
      assert(taskData && typeof taskData === "object", "Dados da tarefa são obrigatórios.");
      assert(taskData.Titulo && String(taskData.Titulo).trim(), "O título da tarefa é obrigatório.");

      const profile = await runtime.requireProfile();
      const id = String(taskData.TarefaID || "").trim() || `TASK_${Date.now()}_${uuid().slice(0, 6)}`;
      const current = taskData.TarefaID ? await runtime.getById("Tarefas", id) : null;

      const lojaId = String(taskData.LojaID || current?.LojaID || profile.LojaID || "").trim();
      assert(lojaId, "A loja da tarefa é obrigatória.");

      const record = {
        TarefaID: id,
        LojaID: lojaId,
        Titulo: String(taskData.Titulo).trim(),
        Descricao: String(taskData.Descricao || "").trim(),
        Setor: String(taskData.Setor || "Geral").trim(),
        Tipo: String(taskData.Tipo || "operacional").trim(),
        Coluna: String(taskData.Coluna || current?.Coluna || "pendente").trim(),
        Prioridade: String(taskData.Prioridade || "Media").trim(),
        FuncionarioID: String(taskData.FuncionarioID || "").trim(),
        NomeFuncionario: String(taskData.NomeFuncionario || "").trim(),
        DataTurno: String(taskData.DataTurno || current?.DataTurno || todayIso()).trim(),
        HoraLimite: String(taskData.HoraLimite || "").trim(),
        ExigeVistoGerente: Boolean(taskData.ExigeVistoGerente),
        VistoPor: String(taskData.VistoPor || current?.VistoPor || "").trim(),
        DataConclusao: taskData.DataConclusao || current?.DataConclusao || null,
        Checklist: Array.isArray(taskData.Checklist) ? taskData.Checklist : (current?.Checklist || []),
        FotoEvidencia: String(taskData.FotoEvidencia || current?.FotoEvidencia || "").trim(),
        CriadoPor: current?.CriadoPor || profile.Nome || profile.UsuarioID || "",
        CriadoEm: current?.CriadoEm || nowIso(),
        AtualizadoEm: nowIso(),
      };

      const saved = await runtime.upsert("Tarefas", record);
      return success(saved, "Tarefa salva com sucesso.");
    },

    async tasksUpdateColumn(args) {
      const [taskId, newColumn] = args || [];
      assert(taskId, "Identificador da tarefa é obrigatório.");
      assert(newColumn, "Nova coluna é obrigatória.");

      const task = await runtime.getById("Tarefas", taskId);
      assert(task, "Tarefa não encontrada.");

      const profile = await runtime.requireProfile();
      const changes = {
        Coluna: newColumn,
        AtualizadoEm: nowIso(),
      };
      if (newColumn === "concluido" && !task.DataConclusao) {
        changes.DataConclusao = nowIso();
      }
      if (newColumn === "visto" && isManager(profile)) {
        changes.VistoPor = profile.Nome || "Gerente";
        changes.DataVisto = nowIso();
      }

      const updated = await runtime.patch("Tarefas", taskId, changes);
      return success(updated, "Coluna atualizada com sucesso.");
    },

    async tasksToggleChecklistItem(args) {
      const [taskId, itemId, checked] = args || [];
      assert(taskId, "Identificador da tarefa é obrigatório.");

      const task = await runtime.getById("Tarefas", taskId);
      assert(task, "Tarefa não encontrada.");

      const profile = await runtime.requireProfile();
      const checklist = Array.isArray(task.Checklist) ? [...task.Checklist] : [];
      const item = checklist.find((it) => String(it.id) === String(itemId));
      if (item) {
        item.concluido = Boolean(checked);
        item.concluidoPor = checked ? (profile.Nome || profile.UsuarioID) : null;
        item.dataConclusao = checked ? nowIso() : null;
      }

      const allDone = checklist.length > 0 && checklist.every((it) => it.concluido);
      const changes = {
        Checklist: checklist,
        AtualizadoEm: nowIso(),
      };
      if (allDone && task.Coluna === "pendente") {
        changes.Coluna = task.ExigeVistoGerente ? "visto" : "concluido";
        if (changes.Coluna === "concluido") changes.DataConclusao = nowIso();
      } else if (!allDone && task.Coluna === "concluido") {
        changes.Coluna = "andamento";
        changes.DataConclusao = null;
      }

      const updated = await runtime.patch("Tarefas", taskId, changes);
      return success(updated, "Item atualizado.");
    },

    async tasksApprove(args) {
      const [taskId, notas] = args || [];
      assert(taskId, "Identificador da tarefa é obrigatório.");
      const profile = await runtime.requireProfile();
      assert(isManager(profile), "Apenas gestores ou responsáveis podem conceder visto.");

      const task = await runtime.getById("Tarefas", taskId);
      assert(task, "Tarefa não encontrada.");

      const changes = {
        Coluna: "concluido",
        VistoPor: profile.Nome || "Gerente",
        DataVisto: nowIso(),
        DataConclusao: nowIso(),
        NotasGestor: String(notas || "").trim(),
        AtualizadoEm: nowIso(),
      };
      const updated = await runtime.patch("Tarefas", taskId, changes);
      return success(updated, "Tarefa aprovada com visto do gerente.");
    },

    async tasksGenerateRoutine(args) {
      const [lojaId, routineType, dataTurno] = args || [];
      const profile = await runtime.requireProfile();
      const targetStore = String(lojaId || profile.LojaID || "").trim();
      assert(targetStore, "Loja não especificada.");
      const turnoDate = String(dataTurno || todayIso()).trim();

      const templates = {
        abertura: [
          {
            Titulo: "Conferência de Estoque Crítico",
            Descricao: "Verificar insumos essenciais antes de iniciar a operação.",
            Setor: "Cozinha",
            Prioridade: "Alta",
            Tipo: "rotina_abertura",
            Coluna: "pendente",
            ExigeVistoGerente: true,
            Checklist: [
              { id: 1, texto: "Conferir pães de hambúrguer (data e integridade)", concluido: false },
              { id: 2, texto: "Conferir blends de carne descongelados na temperatura correta", concluido: false },
              { id: 3, texto: "Conferir queijos fatiados e bacon pré-preparado", concluido: false },
              { id: 4, texto: "Conferir embalagens, sacolas térmicas e guardanapos", concluido: false },
            ],
          },
          {
            Titulo: "Temperatura dos Freezers e Câmaras",
            Descricao: "Aferir termômetros de conservação de alimentos.",
            Setor: "Cozinha",
            Prioridade: "Alta",
            Tipo: "rotina_abertura",
            Coluna: "pendente",
            ExigeVistoGerente: true,
            Checklist: [
              { id: 1, texto: "Medir temperatura do Freezer 1 (mínimo -18°C)", concluido: false },
              { id: 2, texto: "Medir temperatura do Refrigerador de Hortifrúti (até 5°C)", concluido: false },
              { id: 3, texto: "Medir temperatura do Balcão Refrigerado de Pista", concluido: false },
              { id: 4, texto: "Anotar no controle de temperaturas", concluido: false },
            ],
          },
          {
            Titulo: "Pré-aquecimento de Chapas e Fritadeiras",
            Descricao: "Checar calibração térmica e segurança dos queimadores.",
            Setor: "Chapa",
            Prioridade: "Alta",
            Tipo: "rotina_abertura",
            Coluna: "pendente",
            ExigeVistoGerente: false,
            Checklist: [
              { id: 1, texto: "Ligar sistema de exaustão e coifa", concluido: false },
              { id: 2, texto: "Pré-aquecer chapa principal na temperatura padrão", concluido: false },
              { id: 3, texto: "Verificar nível e transparência do óleo das fritadeiras", concluido: false },
              { id: 4, texto: "Testar termostatos e luz piloto", concluido: false },
            ],
          },
          {
            Titulo: "Gaveta de Caixa e Frente de Loja",
            Descricao: "Preparar atendimento, sistema e troco inicial.",
            Setor: "Caixa",
            Prioridade: "Alta",
            Tipo: "rotina_abertura",
            Coluna: "pendente",
            ExigeVistoGerente: true,
            Checklist: [
              { id: 1, texto: "Conferir valor do fundo de troco da gaveta", concluido: false },
              { id: 2, texto: "Testar maquininhas de cartão e bobinas térmicas", concluido: false },
              { id: 3, texto: "Conectar tablets do iFood / Delivery / Sistema de comanda", concluido: false },
              { id: 4, texto: "Ligar som ambiente, iluminação e ar-condicionado do salão", concluido: false },
            ],
          },
        ],
        fechamento: [
          {
            Titulo: "Limpeza da Coifa, Chapas e Grelhas",
            Descricao: "Desengordurar superfícies de cocção e exaustão.",
            Setor: "Chapa",
            Prioridade: "Alta",
            Tipo: "rotina_fechamento",
            Coluna: "pendente",
            ExigeVistoGerente: true,
            Checklist: [
              { id: 1, texto: "Desligar chapa e aplicar desengordurante em temperatura morna", concluido: false },
              { id: 2, texto: "Raspar canaletas e higienizar gaveta coletora de gordura", concluido: false },
              { id: 3, texto: "Limpar filtros de aço da coifa", concluido: false },
              { id: 4, texto: "Passar álcool 70% na bancada de montagem", concluido: false },
            ],
          },
          {
            Titulo: "Desligamento de Gás e Equipamentos",
            Descricao: "Procedimento obrigatório de segurança patrimonial e física.",
            Setor: "Cozinha",
            Prioridade: "Urgente",
            Tipo: "rotina_fechamento",
            Coluna: "pendente",
            ExigeVistoGerente: true,
            Checklist: [
              { id: 1, texto: "Fechar registro principal de gás GLP", concluido: false },
              { id: 2, texto: "Desligar resistências das fritadeiras e estufas", concluido: false },
              { id: 3, texto: "Desligar exaustores e ar-condicionado", concluido: false },
              { id: 4, texto: "Conferir travamento e borracha das portas de freezers", concluido: false },
            ],
          },
          {
            Titulo: "Descarte e Filtragem de Óleo",
            Descricao: "Gestão sustentável do óleo de fritura.",
            Setor: "Cozinha",
            Prioridade: "Media",
            Tipo: "rotina_fechamento",
            Coluna: "pendente",
            ExigeVistoGerente: false,
            Checklist: [
              { id: 1, texto: "Aguardar resfriamento seguro do óleo", concluido: false },
              { id: 2, texto: "Filtrar resíduos sólidos com peneira própria", concluido: false },
              { id: 3, texto: "Se saturado, transferir para tambor de coleta ecológica", concluido: false },
              { id: 4, texto: "Higienizar cuba externa da fritadeira", concluido: false },
            ],
          },
          {
            Titulo: "Fechamento de Caixa e Sangria",
            Descricao: "Conferência financeira do dia.",
            Setor: "Caixa",
            Prioridade: "Alta",
            Tipo: "rotina_fechamento",
            Coluna: "pendente",
            ExigeVistoGerente: true,
            Checklist: [
              { id: 1, texto: "Emitir fechamento das maquininhas POS", concluido: false },
              { id: 2, texto: "Contar dinheiro em espécie da gaveta", concluido: false },
              { id: 3, texto: "Realizar sangria para o cofre com comprovante assinado", concluido: false },
              { id: 4, texto: "Deixar fundo fixo de troco para a próxima abertura", concluido: false },
            ],
          },
          {
            Titulo: "Recolhimento de Lixo e Salão",
            Descricao: "Sanitização e descarte final de resíduos.",
            Setor: "Salão",
            Prioridade: "Media",
            Tipo: "rotina_fechamento",
            Coluna: "pendente",
            ExigeVistoGerente: false,
            Checklist: [
              { id: 1, texto: "Recolher e amarrar sacos de lixo de todas as praças e banheiros", concluido: false },
              { id: 2, texto: "Higienizar mesas e cadeiras com sanitizante", concluido: false },
              { id: 3, texto: "Varrer e passar pano úmido com cloro/desinfetante", concluido: false },
              { id: 4, texto: "Depositar lixo nas lixeiras externas e trancar portas", concluido: false },
            ],
          },
        ],
        caixa: [
          {
            Titulo: "1. Organização e Abertura do Caixa",
            Descricao: "Preparar balcão, inicializar sistema, conferir conectividade e registrar fundo inicial.",
            Setor: "Caixa",
            Prioridade: "Alta",
            Tipo: "rotina_caixa",
            Coluna: "pendente",
            ExigeVistoGerente: true,
            Checklist: [
              { id: 1, texto: "Limpar e organizar o balcão do caixa", concluido: false },
              { id: 2, texto: "Ligar computador/PDV", concluido: false },
              { id: 3, texto: "Acessar sistema de vendas", concluido: false },
              { id: 4, texto: "Abrir o caixa no sistema", concluido: false },
              { id: 5, texto: "Conferir internet", concluido: false },
              { id: 6, texto: "Conferir impressora e bobina", concluido: false },
              { id: 7, texto: "Conferir máquinas de cartão", concluido: false },
              { id: 8, texto: "Conferir PIX", concluido: false },
              { id: 9, texto: "Contar e conferir fundo de caixa", concluido: false },
              { id: 10, texto: "Registrar corretamente o valor inicial", concluido: false },
              { id: 11, texto: "Conferir se há troco suficiente", concluido: false },
              { id: 12, texto: "Comunicar imediatamente qualquer diferença", concluido: false },
            ],
          },
          {
            Titulo: "2. Conferência dos Sistemas",
            Descricao: "Checar canais de venda, integrações, cardápio e promoções ativas.",
            Setor: "Caixa",
            Prioridade: "Alta",
            Tipo: "rotina_caixa",
            Coluna: "pendente",
            ExigeVistoGerente: false,
            Checklist: [
              { id: 1, texto: "Conferir Takeat", concluido: false },
              { id: 2, texto: "Conferir iFood", concluido: false },
              { id: 3, texto: "Conferir delivery próprio", concluido: false },
              { id: 4, texto: "Conferir WhatsApp da loja", concluido: false },
              { id: 5, texto: "Conferir produtos indisponíveis", concluido: false },
              { id: 6, texto: "Conferir promoções do dia", concluido: false },
              { id: 7, texto: "Conferir cupons ativos", concluido: false },
              { id: 8, texto: "Conferir possíveis alterações de preço", concluido: false },
            ],
          },
          {
            Titulo: "3. Lançamento de Notas e Documentos",
            Descricao: "Lançar compras, notas da Central, upload no Drive e auditoria de valores.",
            Setor: "Caixa",
            Prioridade: "Alta",
            Tipo: "rotina_caixa",
            Coluna: "pendente",
            ExigeVistoGerente: true,
            Checklist: [
              { id: 1, texto: "Conferir todas as notas de compras recebidas", concluido: false },
              { id: 2, texto: "Lançar notas de compras no sistema", concluido: false },
              { id: 3, texto: "Conferir notas enviadas pela Central", concluido: false },
              { id: 4, texto: "Acessar o Drive da Central", concluido: false },
              { id: 5, texto: "Lançar as notas da Central corretamente", concluido: false },
              { id: 6, texto: "Conferir fornecedor, valor e data de cada nota", concluido: false },
              { id: 7, texto: "Conferir se nenhuma nota ficou sem lançamento", concluido: false },
              { id: 8, texto: "Digitalizar/fotografar notas físicas quando necessário", concluido: false },
              { id: 9, texto: "Salvar todas as notas no Drive", concluido: false },
              { id: 10, texto: "Organizar as notas nas pastas corretas", concluido: false },
              { id: 11, texto: "Conferir se os arquivos estão legíveis", concluido: false },
              { id: 12, texto: "Evitar notas duplicadas no Drive", concluido: false },
              { id: 13, texto: "Informar à gerência qualquer divergência de valor ou documento", concluido: false },
            ],
          },
          {
            Titulo: "4. iFood e Atendimento Digital",
            Descricao: "Gestão de avaliações, suporte ao cliente e resolução de pendências.",
            Setor: "Caixa",
            Prioridade: "Media",
            Tipo: "rotina_caixa",
            Coluna: "pendente",
            ExigeVistoGerente: false,
            Checklist: [
              { id: 1, texto: "Conferir avaliações novas no iFood", concluido: false },
              { id: 2, texto: "Responder todas as avaliações pendentes", concluido: false },
              { id: 3, texto: "Responder elogios de forma cordial e personalizada", concluido: false },
              { id: 4, texto: "Responder reclamações com educação e atenção", concluido: false },
              { id: 5, texto: "Encaminhar reclamações graves para a gerência", concluido: false },
              { id: 6, texto: "Não discutir com clientes nas avaliações", concluido: false },
              { id: 7, texto: "Conferir mensagens ou pendências relacionadas aos pedidos", concluido: false },
            ],
          },
          {
            Titulo: "5. Grupo VIP",
            Descricao: "Comunicação e disparo de ofertas para a base de clientes exclusivos.",
            Setor: "Caixa",
            Prioridade: "Media",
            Tipo: "rotina_caixa",
            Coluna: "pendente",
            ExigeVistoGerente: false,
            Checklist: [
              { id: 1, texto: "Conferir promoção ou comunicação definida para o dia", concluido: false },
              { id: 2, texto: "Preparar a postagem do Grupo VIP", concluido: false },
              { id: 3, texto: "Postar no Grupo VIP no horário definido", concluido: false },
              { id: 4, texto: "Conferir se imagem, texto, preço e promoção estão corretos", concluido: false },
              { id: 5, texto: "Inserir link de pedido quando necessário", concluido: false },
              { id: 6, texto: "Inserir cupom quando houver", concluido: false },
              { id: 7, texto: "Conferir a postagem após o envio", concluido: false },
              { id: 8, texto: "Responder dúvidas dos clientes do grupo quando necessário", concluido: false },
            ],
          },
          {
            Titulo: "6. Status do WhatsApp",
            Descricao: "Divulgação visual, novidades e chamada para compras no canal oficial.",
            Setor: "Caixa",
            Prioridade: "Media",
            Tipo: "rotina_caixa",
            Coluna: "pendente",
            ExigeVistoGerente: false,
            Checklist: [
              { id: 1, texto: "Conferir conteúdo definido para o dia", concluido: false },
              { id: 2, texto: "Postar promoção no Status do WhatsApp", concluido: false },
              { id: 3, texto: "Postar produtos ou novidades da loja", concluido: false },
              { id: 4, texto: "Inserir chamada para pedido", concluido: false },
              { id: 5, texto: "Inserir link ou orientação para compra quando necessário", concluido: false },
              { id: 6, texto: "Conferir se informações e preços estão corretos", concluido: false },
              { id: 7, texto: "Evitar status desatualizados ou promoções encerradas", concluido: false },
            ],
          },
          {
            Titulo: "7. Conferência Final da Rotina",
            Descricao: "Auditoria completa antes do encerramento ou passagem de turno do caixa.",
            Setor: "Caixa",
            Prioridade: "Alta",
            Tipo: "rotina_caixa",
            Coluna: "pendente",
            ExigeVistoGerente: true,
            Checklist: [
              { id: 1, texto: "Caixa aberto e conferido", concluido: false },
              { id: 2, texto: "Máquinas de cartão funcionando", concluido: false },
              { id: 3, texto: "PIX funcionando", concluido: false },
              { id: 4, texto: "Sistemas online", concluido: false },
              { id: 5, texto: "Notas de compras lançadas", concluido: false },
              { id: 6, texto: "Notas da Central lançadas", concluido: false },
              { id: 7, texto: "Todas as notas salvas no Drive", concluido: false },
              { id: 8, texto: "Avaliações do iFood respondidas", concluido: false },
              { id: 9, texto: "Grupo VIP atualizado", concluido: false },
              { id: 10, texto: "Status do WhatsApp atualizado", concluido: false },
              { id: 11, texto: "Pendências comunicadas à gerência", concluido: false },
            ],
          },
          {
            Titulo: "8. Pendências do Caixa",
            Descricao: "Registro de ocorrências, comprovantes a conciliar ou notas em aberto.",
            Setor: "Caixa",
            Prioridade: "Media",
            Tipo: "rotina_caixa",
            Coluna: "pendente",
            ExigeVistoGerente: true,
            Checklist: [
              { id: 1, texto: "Identificar notas ou pedidos que ficaram pendentes", concluido: false },
              { id: 2, texto: "Registrar motivo e detalhes da pendência", concluido: false },
              { id: 3, texto: "Comunicar à gerência e repassar para o próximo operador", concluido: false },
            ],
          },
        ],
      };

      const selected = templates[routineType] || [];
      assert(selected.length > 0, "Tipo de rotina inválido. Escolha 'abertura', 'fechamento' ou 'caixa'.");

      const routineLabel = routineType === "caixa" ? "Caixa" : routineType === "abertura" ? "Abertura" : "Fechamento";

      const existingTasks = await runtime.list("Tarefas", { profile });
      const alreadyGenerated = existingTasks.filter(
        t => String(t.LojaID || '') === targetStore &&
             t.DataTurno === turnoDate &&
             t.Tipo === `rotina_${routineType}`
      );
      if (alreadyGenerated.length > 0) {
        return success(
          alreadyGenerated,
          `Rotina de ${routineLabel} já está no quadro (${alreadyGenerated.length} tarefas).`,
        );
      }

      const createdList = [];
      for (const item of selected) {
        const id = `TASK_${Date.now()}_${uuid().slice(0, 6)}`;
        const record = {
          ...item,
          TarefaID: id,
          LojaID: targetStore,
          DataTurno: turnoDate,
          CriadoPor: profile.Nome || "Sistema",
          CriadoEm: nowIso(),
          AtualizadoEm: nowIso(),
        };
        const saved = await runtime.upsert("Tarefas", record);
        createdList.push(saved);
      }

      return success(
        createdList,
        `Rotina de ${routineLabel} gerada com ${createdList.length} tarefas.`,
      );
    },

    async tasksDelete(args) {
      const [taskId] = args || [];
      assert(taskId, "Identificador da tarefa é obrigatório.");
      const profile = await runtime.requireProfile();
      assert(isManager(profile), "Apenas gestores podem remover tarefas.");

      await runtime.remove("Tarefas", taskId);
      return success(null, "Tarefa removida com sucesso.");
    },

    async tasksDeduplicate(args) {
      const [lojaId, dataTurno] = args || [];
      const profile = await runtime.requireProfile();
      assert(isManager(profile), "Apenas gestores podem organizar tarefas.");
      const targetStore = String(lojaId || profile.LojaID || "").trim();
      const turnoDate = String(dataTurno || todayIso()).trim();
      const rows = await runtime.list("Tarefas", { profile });
      const seen = new Set();
      let removed = 0;
      for (const t of rows) {
        if (targetStore && String(t.LojaID || "") !== targetStore) continue;
        if (turnoDate && t.DataTurno && t.DataTurno !== turnoDate) continue;
        const normTitle = (t.Titulo || '').replace(/^(\d+\.\s*)?(Abertura|Fechamento|Caixa)\s*(Turno|Rotina)?:\s*/i, '').trim().toLowerCase();
        const key = `${normTitle}|${t.Setor}|${t.Coluna}`;
        if (seen.has(key)) {
          await runtime.remove("Tarefas", t.TarefaID);
          removed++;
        } else {
          seen.add(key);
        }
      }
      return success({ removed }, removed > 0 ? `${removed} tarefas duplicadas foram removidas.` : "Nenhuma tarefa duplicada encontrada.");
    },
  };
}
