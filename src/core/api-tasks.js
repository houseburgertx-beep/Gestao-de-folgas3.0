import { runtime } from "./runtime.js";
import { assert, nowIso, todayIso, uuid } from "./utils.js";
import { createNotification, createNotificationOnce, isAdmin, isManager, success } from "./api-base.js";

export function createTasksHandlers() {
  return {
    async tasksList(args) {
      const [lojaId, dataTurno] = args || [];
      const profile = await runtime.requireProfile();
      const targetStore = String(lojaId || (!isAdmin(profile) ? (profile.LojaID || "") : "")).trim();
      const rows = await runtime.list("Tarefas", { profile });
      const userIds = [
        profile.FuncionarioID,
        profile.funcionarioId,
        profile.UsuarioID,
        profile.usuarioId,
      ].filter(Boolean).map((x) => String(x).trim().toLowerCase());

      const userNames = [
        profile.Nome,
        profile.nome,
      ].filter(Boolean).map((x) => String(x).trim().toLowerCase());

      const filtered = rows.filter((task) => {
        const taskFuncId = String(task.FuncionarioID || "").trim().toLowerCase();
        const taskFuncName = String(task.NomeFuncionario || "").trim().toLowerCase();

        const isAssignedToUser = Boolean(
          (taskFuncId && userIds.includes(taskFuncId)) ||
          (taskFuncName && userNames.some((name) => taskFuncName.includes(name) || name.includes(taskFuncName))) ||
          (taskFuncId && userNames.includes(taskFuncId))
        );

        // Se a tarefa está atribuída diretamente a este usuário, ela SEMPRE aparece
        if (isAssignedToUser) {
          return true;
        }

        if (targetStore && String(task.LojaID || "") !== targetStore) {
          return false;
        }
        if (dataTurno && task.DataTurno && task.DataTurno !== dataTurno) {
          if (task.Tipo === "manutencao" && task.Coluna !== "concluido") {
            return true;
          }
          return false;
        }
        if (!isAdmin(profile) && /\b(teste|test|dummy)\b/i.test(task.Titulo || "")) {
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

      const isReassigned = current?.FuncionarioID && current.FuncionarioID !== record.FuncionarioID;
      const isNewAssignment = !current && record.FuncionarioID;
      if (record.FuncionarioID && (isNewAssignment || isReassigned)) {
        const sev = record.Prioridade === "Urgente" ? "danger" : (record.Prioridade === "Alta" ? "warning" : "info");
        const limiteText = record.HoraLimite ? ` · até às ${record.HoraLimite}` : "";
        createNotificationOnce({
          employeeId: record.FuncionarioID,
          storeId: record.LojaID,
          subject: isReassigned ? "Tarefa reatribuída" : "Nova tarefa para você",
          message: `${record.Titulo}${limiteText}`,
          type: "Tarefa",
          relatedId: id,
          severity: sev,
        }).catch((err) => console.warn("Notificação de tarefa não gravada:", err.message));
      }

      return success(saved, "Tarefa salva com sucesso.");
    },

    async tasksUpdateColumn(args) {
      const [taskId, newColumn] = args || [];
      assert(taskId, "Identificador da tarefa é obrigatório.");
      assert(newColumn, "Nova coluna é obrigatória.");

      const profile = await runtime.requireProfile();
      let task = await runtime.getById("Tarefas", taskId);
      if (!task) {
        const rows = await runtime.list("Tarefas", { profile });
        task = rows.find((t) => String(t.TarefaID) === String(taskId));
      }
      assert(task, "Tarefa não encontrada.");

      const changes = {
        LojaID: task.LojaID || profile.LojaID || "",
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

      const profile = await runtime.requireProfile();
      let task = await runtime.getById("Tarefas", taskId);
      if (!task) {
        const rows = await runtime.list("Tarefas", { profile });
        task = rows.find((t) => String(t.TarefaID) === String(taskId));
      }
      assert(task, "Tarefa não encontrada.");

      const checklist = Array.isArray(task.Checklist) ? [...task.Checklist] : [];
      const item = checklist.find((it) => String(it.id) === String(itemId));
      if (item) {
        item.concluido = Boolean(checked);
        item.concluidoPor = checked ? (profile.Nome || profile.UsuarioID) : null;
        item.dataConclusao = checked ? nowIso() : null;
      }

      const allDone = checklist.length > 0 && checklist.every((it) => it.concluido);
      const changes = {
        LojaID: task.LojaID || profile.LojaID || "",
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

    async tasksBulkToggleChecklist(args) {
      const [taskId, markDone] = args || [];
      assert(taskId, "Identificador da tarefa é obrigatório.");

      const profile = await runtime.requireProfile();
      let task = await runtime.getById("Tarefas", taskId);
      if (!task) {
        const rows = await runtime.list("Tarefas", { profile });
        task = rows.find((t) => String(t.TarefaID) === String(taskId));
      }
      assert(task, "Tarefa não encontrada.");

      const done = Boolean(markDone);
      const checklist = Array.isArray(task.Checklist)
        ? task.Checklist.map((it) => ({
            ...it,
            concluido: done,
            concluidoPor: done ? (profile.Nome || profile.UsuarioID) : null,
            dataConclusao: done ? nowIso() : null,
          }))
        : [];

      const changes = {
        LojaID: task.LojaID || profile.LojaID || "",
        Checklist: checklist,
        AtualizadoEm: nowIso(),
      };
      if (done) {
        changes.Coluna = task.ExigeVistoGerente ? "visto" : "concluido";
        if (changes.Coluna === "concluido") changes.DataConclusao = nowIso();
      } else {
        changes.Coluna = "pendente";
        changes.DataConclusao = null;
      }

      const updated = await runtime.patch("Tarefas", taskId, changes);
      return success(updated, done ? "Todos os itens marcados." : "Itens desmarcados.");
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

      if (task.FuncionarioID) {
        createNotification({
          employeeId: task.FuncionarioID,
          storeId: task.LojaID || profile.LojaID || "",
          subject: "Tarefa aprovada! 🎉",
          message: `Sua tarefa "${task.Titulo}" foi aprovada com visto de ${profile.Nome || "Gerente"}.`,
          type: "Tarefa",
          relatedId: taskId,
          severity: "success",
        }).catch((err) => console.warn("Notificação de visto não gravada:", err.message));
      }

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
        const isTestTask = /\b(teste|test|mock|dummy)\b/i.test(t.Titulo || '') || /\b(teste|test)\b/i.test(t.Descricao || '');
        if (isTestTask) {
          await runtime.remove("Tarefas", t.TarefaID);
          removed++;
          continue;
        }
        const normTitle = (t.Titulo || '').replace(/^(\d+\.\s*)?(Abertura|Fechamento|Caixa)\s*(Turno|Rotina)?:\s*/i, '').trim().toLowerCase();
        const key = `${normTitle}|${t.Setor}|${t.Coluna}`;
        if (seen.has(key)) {
          await runtime.remove("Tarefas", t.TarefaID);
          removed++;
        } else {
          seen.add(key);
        }
      }
      return success({ removed }, removed > 0 ? `${removed} tarefas duplicadas ou de teste foram removidas.` : "Nenhuma tarefa duplicada encontrada.");
    },

    async tasksCleanupTest(args) {
      const profile = await runtime.requireProfile();
      assert(isManager(profile), "Apenas gestores podem limpar tarefas de teste.");
      const rows = await runtime.list("Tarefas", { profile });
      let removed = 0;
      for (const t of rows) {
        if (/\b(teste|test|mock|dummy)\b/i.test(t.Titulo || '') || /\b(teste|test)\b/i.test(t.Descricao || '')) {
          await runtime.remove("Tarefas", t.TarefaID);
          removed++;
        }
      }
      return success({ removed }, removed > 0 ? `${removed} tarefas de teste removidas com sucesso.` : "Nenhuma tarefa de teste encontrada.");
    },

    // ==========================================
    // COZINHA FLOW HANDLERS
    // ==========================================

    async cozinhaTasksList(args) {
      const profile = await runtime.requireProfile();
      const rows = await runtime.list("Tarefas", { profile });
      const userIds = [
        profile.FuncionarioID,
        profile.funcionarioId,
        profile.UsuarioID,
        profile.usuarioId,
      ].filter(Boolean).map((x) => String(x).trim().toLowerCase());

      const userNames = [
        profile.Nome,
        profile.nome,
      ].filter(Boolean).map((x) => String(x).trim().toLowerCase());

      const admin = isAdmin(profile) || isManager(profile);

      const normalized = rows.map((t) => {
        const id = String(t.TarefaID || t.ID || "");
        const status = String(t.Status || (t.Coluna === 'concluido' ? 'Concluída' : t.Coluna === 'visto' ? 'Aguardando aprovação' : t.Coluna === 'andamento' ? 'Em andamento' : 'A fazer')).trim();
        const prazo = t.Prazo || t.PRAZO || (t.DataTurno ? `${t.DataTurno}T${t.HoraLimite || '23:59:00'}` : '');
        return {
          ID: id,
          TarefaID: id,
          TITULO: String(t.Titulo || t.TITULO || '').trim(),
          DESCRICAO: String(t.Descricao || t.DESCRICAO || '').trim(),
          RESPONSAVEL_ID: String(t.FuncionarioID || t.RESPONSAVEL_ID || '').trim(),
          RESPONSAVEL_NOME: String(t.NomeFuncionario || t.RESPONSAVEL_NOME || 'Não atribuído').trim(),
          RESPONSAVEL_EMAIL: String(t.EmailFuncionario || t.RESPONSAVEL_EMAIL || '').trim(),
          PRIORIDADE: String(t.Prioridade || t.PRIORIDADE || 'Normal').trim(),
          PRAZO: prazo,
          STATUS: status,
          TURNO: String(t.TURNO || t.Turno || '').trim(),
          RECORRENCIA: String(t.RECORRENCIA || t.Recorrencia || 'Nenhuma').trim(),
          RECORRENCIA_DIAS: String(t.RECORRENCIA_DIAS || '').trim(),
          ORIENTACAO_FOTO: String(t.ORIENTACAO_FOTO || t.OrientacaoFoto || '').trim(),
          TEM_FOTO: Boolean(t.FotoEvidencia || t.FOTO_URL || t.TEM_FOTO || t.FOTO_ID),
          FOTO_ID: String(t.FOTO_ID || t.FotoEvidencia || '').trim(),
          FOTO_URL: String(t.FOTO_URL || t.FotoEvidencia || '').trim(),
          FOTO_THUMBNAIL_URL: String(t.FOTO_THUMBNAIL_URL || t.FOTO_URL || t.FotoEvidencia || '').trim(),
          CONFIRMADO: Boolean(t.Confirmado || t.CONFIRMADO),
          OBSERVACAO_CONCLUSAO: String(t.OBSERVACAO_CONCLUSAO || t.ObservacaoConclusao || '').trim(),
          REVISAO_STATUS: String(t.REVISAO_STATUS || t.RevisaoStatus || (status === 'Aguardando aprovação' ? 'Pendente' : '')).trim(),
          MOTIVO_REVISAO: String(t.MOTIVO_REVISAO || t.MotivoRevisao || '').trim(),
          APROVADO_EM: String(t.APROVADO_EM || t.DataVisto || '').trim(),
          APROVADO_POR_NOME: String(t.APROVADO_POR_NOME || t.VistoPor || '').trim(),
          CRIADO_POR_ID: String(t.CRIADO_POR_ID || t.CriadoPorID || '').trim(),
          CRIADO_POR_NOME: String(t.CRIADO_POR_NOME || t.CriadoPor || '').trim(),
          CRIADO_EM: String(t.CRIADO_EM || t.CriadoEm || nowIso()).trim(),
          CONCLUIDO_EM: String(t.CONCLUIDO_EM || t.DataConclusao || '').trim(),
          CANCELADO_EM: String(t.CANCELADO_EM || '').trim(),
          MOTIVO_CANCELAMENTO: String(t.MOTIVO_CANCELAMENTO || '').trim(),
          LojaID: String(t.LojaID || profile.LojaID || '').trim(),
        };
      });

      let visible = normalized;
      if (!admin) {
        visible = normalized.filter((t) => {
          const respId = t.RESPONSAVEL_ID.toLowerCase();
          const respName = t.RESPONSAVEL_NOME.toLowerCase();
          return (respId && userIds.includes(respId)) ||
            (respName && userNames.some(name => respName.includes(name) || name.includes(respName)));
        });
      }

      visible.sort((a, b) => String(b.CRIADO_EM || '').localeCompare(String(a.CRIADO_EM || '')));
      return success(visible);
    },

    async cozinhaTasksAssignees(args) {
      const profile = await runtime.requireProfile();
      const employees = await runtime.list("Funcionarios", { profile });
      const active = employees.filter((e) => e.Ativo !== false && String(e.Status || "").toLowerCase() !== "inativo");
      const list = active.map((e) => ({
        id: String(e.FuncionarioID || e.id || ""),
        name: String(e.Nome || e.nome || ""),
        role: String(e.Cargo || e.Perfil || "Operador"),
        email: String(e.Email || ""),
        store: String(e.LojaID || ""),
      })).sort((a, b) => a.name.localeCompare(b.name));
      return success(list);
    },

    async cozinhaTasksSave(args) {
      const [payload] = args || [];
      assert(payload && typeof payload === "object", "Dados da tarefa são obrigatórios.");
      assert(payload.TITULO || payload.Titulo, "O título da tarefa é obrigatório.");

      const profile = await runtime.requireProfile();
      const id = String(payload.ID || payload.TarefaID || "").trim() || `cf_${Date.now()}_${uuid().slice(0, 6)}`;
      const current = (payload.ID || payload.TarefaID) ? await runtime.getById("Tarefas", id) : null;

      const titulo = String(payload.TITULO || payload.Titulo || '').trim();
      const responsavelId = String(payload.RESPONSAVEL_ID || payload.FuncionarioID || '').trim();
      const responsavelNome = String(payload.RESPONSAVEL_NOME || payload.NomeFuncionario || '').trim();
      const prioridade = String(payload.PRIORIDADE || payload.Prioridade || 'Normal').trim();
      const status = String(payload.STATUS || payload.Status || current?.Status || 'A fazer').trim();
      const prazo = payload.PRAZO || payload.Prazo || current?.Prazo || '';

      const record = {
        TarefaID: id,
        ID: id,
        Titulo: titulo,
        TITULO: titulo,
        Descricao: String(payload.DESCRICAO || payload.Descricao || '').trim(),
        DESCRICAO: String(payload.DESCRICAO || payload.Descricao || '').trim(),
        FuncionarioID: responsavelId,
        RESPONSAVEL_ID: responsavelId,
        NomeFuncionario: responsavelNome,
        RESPONSAVEL_NOME: responsavelNome,
        EmailFuncionario: String(payload.RESPONSAVEL_EMAIL || '').trim(),
        RESPONSAVEL_EMAIL: String(payload.RESPONSAVEL_EMAIL || '').trim(),
        Prioridade: prioridade,
        PRIORIDADE: prioridade,
        Prazo: prazo,
        PRAZO: prazo,
        Status: status,
        STATUS: status,
        Coluna: status === 'Concluída' ? 'concluido' : status === 'Aguardando aprovação' ? 'visto' : status === 'Em andamento' ? 'andamento' : 'pendente',
        Setor: 'Cozinha',
        TURNO: String(payload.TURNO || '').trim(),
        RECORRENCIA: String(payload.RECORRENCIA || 'Nenhuma').trim(),
        RECORRENCIA_DIAS: String(payload.RECORRENCIA_DIAS || '').trim(),
        ORIENTACAO_FOTO: String(payload.ORIENTACAO_FOTO || '').trim(),
        TEM_FOTO: Boolean(payload.TEM_FOTO || payload.FOTO_URL || current?.FotoEvidencia),
        FotoEvidencia: String(payload.FOTO_URL || payload.FotoEvidencia || current?.FotoEvidencia || '').trim(),
        FOTO_URL: String(payload.FOTO_URL || current?.FotoEvidencia || '').trim(),
        FOTO_ID: String(payload.FOTO_ID || current?.FOTO_ID || '').trim(),
        RevisaoStatus: String(payload.REVISAO_STATUS || current?.RevisaoStatus || '').trim(),
        REVISAO_STATUS: String(payload.REVISAO_STATUS || current?.RevisaoStatus || '').trim(),
        MotivoRevisao: String(payload.MOTIVO_REVISAO || current?.MotivoRevisao || '').trim(),
        MOTIVO_REVISAO: String(payload.MOTIVO_REVISAO || current?.MotivoRevisao || '').trim(),
        Confirmado: Boolean(payload.CONFIRMADO ?? current?.Confirmado),
        CONFIRMADO: Boolean(payload.CONFIRMADO ?? current?.Confirmado),
        ObservacaoConclusao: String(payload.OBSERVACAO_CONCLUSAO || current?.ObservacaoConclusao || '').trim(),
        OBSERVACAO_CONCLUSAO: String(payload.OBSERVACAO_CONCLUSAO || current?.ObservacaoConclusao || '').trim(),
        LojaID: String(payload.LojaID || current?.LojaID || profile.LojaID || '').trim(),
        CriadoPor: current?.CriadoPor || profile.Nome || profile.UsuarioID || '',
        CRIADO_POR_NOME: current?.CRIADO_POR_NOME || profile.Nome || profile.UsuarioID || '',
        CRIADO_POR_ID: current?.CRIADO_POR_ID || profile.FuncionarioID || profile.UsuarioID || '',
        CriadoEm: current?.CriadoEm || nowIso(),
        CRIADO_EM: current?.CRIADO_EM || current?.CriadoEm || nowIso(),
        AtualizadoEm: nowIso(),
        ATUALIZADO_EM: nowIso(),
      };

      const saved = await runtime.upsert("Tarefas", record);

      const prevResp = current?.RESPONSAVEL_ID || current?.FuncionarioID;
      const isReassigned = prevResp && String(prevResp).trim().toLowerCase() !== responsavelId.toLowerCase();
      const isNewAssignment = !current && responsavelId;
      if (responsavelId && (isNewAssignment || isReassigned)) {
        const sev = prioridade === "Urgente" ? "danger" : (prioridade === "Alta" ? "warning" : "info");
        const prazoText = prazo ? ` · prazo ${String(prazo).replace("T", " ")}` : "";
        createNotificationOnce({
          employeeId: responsavelId,
          email: record.EmailFuncionario || "",
          storeId: record.LojaID,
          subject: isReassigned ? "Tarefa reatribuída" : "Nova tarefa para você",
          message: `${titulo}${prazoText}`,
          type: "Tarefa",
          relatedId: id,
          severity: sev,
        }).catch((err) => console.warn("Notificação de tarefa CozinhaFlow não gravada:", err.message));
      }

      return success(saved, "Tarefa salva com sucesso.");
    },

    async cozinhaTasksStart(args) {
      const [taskId] = args || [];
      assert(taskId, "Identificador da tarefa é obrigatório.");
      const profile = await runtime.requireProfile();
      const patch = {
        Status: 'Em andamento',
        STATUS: 'Em andamento',
        Coluna: 'andamento',
        INICIADO_EM: nowIso(),
        RevisaoStatus: '',
        REVISAO_STATUS: '',
        MotivoRevisao: '',
        MOTIVO_REVISAO: '',
        AtualizadoEm: nowIso(),
        ATUALIZADO_EM: nowIso(),
      };
      const updated = await runtime.patch("Tarefas", taskId, patch);
      return success(updated, "Tarefa iniciada.");
    },

    async cozinhaTasksComplete(args) {
      const [payload] = args || [];
      const taskId = payload?.id || payload?.ID || payload?.taskId;
      assert(taskId, "Identificador da tarefa é obrigatório.");
      const profile = await runtime.requireProfile();

      const fotoUrl = String(payload?.fotoUrl || payload?.FOTO_URL || payload?.FotoEvidencia || "").trim();
      const fotoId = String(payload?.fotoId || payload?.FOTO_ID || "").trim();
      const obs = String(payload?.observacao || payload?.OBSERVACAO_CONCLUSAO || "").trim();

      const patch = {
        Status: 'Aguardando aprovação',
        STATUS: 'Aguardando aprovação',
        Coluna: 'visto',
        TEM_FOTO: true,
        FotoEvidencia: fotoUrl,
        FOTO_URL: fotoUrl,
        FOTO_ID: fotoId,
        FOTO_THUMBNAIL_URL: fotoUrl,
        Confirmado: true,
        CONFIRMADO: true,
        ObservacaoConclusao: obs,
        OBSERVACAO_CONCLUSAO: obs,
        RevisaoStatus: 'Pendente',
        REVISAO_STATUS: 'Pendente',
        MotivoRevisao: '',
        MOTIVO_REVISAO: '',
        ENVIADO_REVISAO_EM: nowIso(),
        AtualizadoEm: nowIso(),
        ATUALIZADO_EM: nowIso(),
      };

      const current = await runtime.getById("Tarefas", taskId);
      const updated = await runtime.patch("Tarefas", taskId, patch);

      const targetManagerId = String(current?.CRIADO_POR_ID || "").trim();
      const taskTitle = current?.Titulo || current?.TITULO || "Tarefa";
      const senderName = profile.Nome || profile.UsuarioID || "Colaborador";
      createNotificationOnce({
        employeeId: targetManagerId,
        storeId: current?.LojaID || profile.LojaID || "",
        subject: "Tarefa enviada para conferência",
        message: `${senderName} concluiu a tarefa "${taskTitle}" e enviou foto para conferência.`,
        type: "Tarefa",
        relatedId: taskId,
        severity: "info",
      }).catch((err) => console.warn("Notificação de envio de tarefa não gravada:", err.message));

      return success(updated, "Tarefa enviada para conferência com sucesso!");
    },

    async cozinhaTasksApprove(args) {
      const [taskId] = args || [];
      assert(taskId, "Identificador da tarefa é obrigatório.");
      const profile = await runtime.requireProfile();
      assert(isAdmin(profile) || isManager(profile), "Apenas administradores podem aprovar tarefas.");

      const task = await runtime.getById("Tarefas", taskId);
      assert(task, "Tarefa não encontrada.");

      const points = taskPointValue(task.Prioridade || task.PRIORIDADE || "Normal");
      const completedAt = nowIso();

      const patch = {
        Status: 'Concluída',
        STATUS: 'Concluída',
        Coluna: 'concluido',
        RevisaoStatus: 'Aprovada',
        REVISAO_STATUS: 'Aprovada',
        MotivoRevisao: '',
        MOTIVO_REVISAO: '',
        AprovadoEm: completedAt,
        APROVADO_EM: completedAt,
        AprovadoPorNome: profile.Nome || 'Administrador',
        APROVADO_POR_NOME: profile.Nome || 'Administrador',
        DataConclusao: completedAt,
        CONCLUIDO_EM: completedAt,
        AtualizadoEm: completedAt,
        ATUALIZADO_EM: completedAt,
      };

      const updated = await runtime.patch("Tarefas", taskId, patch);

      // Credita pontos ao funcionário responsável
      const targetUserId = String(task.FuncionarioID || task.RESPONSAVEL_ID || "").trim();
      const targetUserName = String(task.NomeFuncionario || task.RESPONSAVEL_NOME || "Colaborador").trim();
      if (targetUserId) {
        const adjustId = `PTS_APPRV_${taskId}`;
        await runtime.upsert("PontosAjustes", {
          ID: adjustId,
          USUARIO_ID: targetUserId,
          USUARIO_NOME: targetUserName,
          PONTOS: points,
          MOTIVO: `Tarefa aprovada: ${task.Titulo || task.TITULO}`,
          ORIGEM: 'TAREFA_APROVADA',
          TAREFA_ID: String(taskId),
          TAREFA_TITULO: String(task.Titulo || task.TITULO || ''),
          ADMIN_ID: profile.UsuarioID || profile.FuncionarioID || 'ADMIN',
          ADMIN_NOME: profile.Nome || 'Administração',
          CRIADO_EM: completedAt,
        });

        // Verifica se houve atraso para penalidade
        if (task.Prazo || task.PRAZO) {
          const deadline = new Date(task.Prazo || task.PRAZO).getTime();
          const delivered = new Date(task.ENVIADO_REVISAO_EM || completedAt).getTime();
          if (Number.isFinite(deadline) && Number.isFinite(delivered) && delivered > deadline) {
            const penaltyAdjustId = `PTS_LATE_${taskId}`;
            await runtime.upsert("PontosAjustes", {
              ID: penaltyAdjustId,
              USUARIO_ID: targetUserId,
              USUARIO_NOME: targetUserName,
              PONTOS: -points,
              MOTIVO: `Entrega atrasada: ${task.Titulo || task.TITULO}`,
              ORIGEM: 'ATRASO',
              TAREFA_ID: String(taskId),
              TAREFA_TITULO: String(task.Titulo || task.TITULO || ''),
              ADMIN_ID: 'SYSTEM',
              ADMIN_NOME: 'Sistema',
              CRIADO_EM: completedAt,
            });
          }
        }

        createNotification({
          employeeId: targetUserId,
          email: task.EmailFuncionario || task.RESPONSAVEL_EMAIL || "",
          storeId: task.LojaID || profile.LojaID || "",
          subject: "Tarefa aprovada! 🎉",
          message: `Sua tarefa "${task.Titulo || task.TITULO}" foi aprovada por ${profile.Nome || "Administrador"}. +${points} pontos creditados!`,
          type: "Tarefa",
          relatedId: String(taskId),
          severity: "success",
        }).catch((err) => console.warn("Notificação de aprovação de tarefa não gravada:", err.message));
      }

      return success(updated, `Tarefa aprovada! +${points} ponto(s) concedidos.`);
    },

    async cozinhaTasksReject(args) {
      const [payload] = args || [];
      const taskId = payload?.id || payload?.ID || payload?.taskId;
      assert(taskId, "Identificador da tarefa é obrigatório.");
      const reason = String(payload?.reason || payload?.motivo || "Necessário nova foto com melhor ângulo").trim();

      const profile = await runtime.requireProfile();
      assert(isAdmin(profile) || isManager(profile), "Apenas administradores podem devolver tarefas.");

      const patch = {
        Status: 'Em andamento',
        STATUS: 'Em andamento',
        Coluna: 'andamento',
        RevisaoStatus: 'Devolvida',
        REVISAO_STATUS: 'Devolvida',
        MotivoRevisao: reason,
        MOTIVO_REVISAO: reason,
        AtualizadoEm: nowIso(),
        ATUALIZADO_EM: nowIso(),
      };

      const task = await runtime.getById("Tarefas", taskId);
      const updated = await runtime.patch("Tarefas", taskId, patch);

      const targetUserId = String(task?.FuncionarioID || task?.RESPONSAVEL_ID || "").trim();
      if (targetUserId) {
        createNotification({
          employeeId: targetUserId,
          email: task?.EmailFuncionario || task?.RESPONSAVEL_EMAIL || "",
          storeId: task?.LojaID || profile.LojaID || "",
          subject: "Tarefa devolvida para revisão",
          message: `A tarefa "${task?.Titulo || task?.TITULO}" precisa de ajuste: ${reason}. Envie uma nova foto comprovando a execução.`,
          type: "Tarefa",
          relatedId: String(taskId),
          severity: "warning",
        }).catch((err) => console.warn("Notificação de devolução de tarefa não gravada:", err.message));
      }

      return success(updated, "Tarefa devolvida ao colaborador para nova foto.");
    },

    async cozinhaTasksCancel(args) {
      const [payload] = args || [];
      const taskId = payload?.id || payload?.ID || payload?.taskId;
      assert(taskId, "Identificador da tarefa é obrigatório.");
      const reason = String(payload?.reason || payload?.motivo || "Cancelada pela administração").trim();
      const pointsPenalty = Number(payload?.points || 0);

      const profile = await runtime.requireProfile();
      assert(isAdmin(profile) || isManager(profile), "Apenas administradores podem cancelar tarefas.");

      const task = await runtime.getById("Tarefas", taskId);
      const patch = {
        Status: 'Cancelada',
        STATUS: 'Cancelada',
        Coluna: 'cancelado',
        CanceladoEm: nowIso(),
        CANCELADO_EM: nowIso(),
        MotivoCancelamento: reason,
        MOTIVO_CANCELAMENTO: reason,
        AtualizadoEm: nowIso(),
        ATUALIZADO_EM: nowIso(),
      };

      const updated = await runtime.patch("Tarefas", taskId, patch);

      const targetUserId = String(task?.FuncionarioID || task?.RESPONSAVEL_ID || "").trim();
      if (targetUserId) {
        createNotification({
          employeeId: targetUserId,
          email: task?.EmailFuncionario || task?.RESPONSAVEL_EMAIL || "",
          storeId: task?.LojaID || profile.LojaID || "",
          subject: "Tarefa cancelada",
          message: `A tarefa "${task?.Titulo || task?.TITULO}" foi cancelada: ${reason}.`,
          type: "Tarefa",
          relatedId: String(taskId),
          severity: "danger",
        }).catch((err) => console.warn("Notificação de cancelamento de tarefa não gravada:", err.message));
      }

      if (pointsPenalty > 0 && task) {
        const targetUserName = String(task.NomeFuncionario || task.RESPONSAVEL_NOME || "Colaborador").trim();
        if (targetUserId) {
          const penaltyId = `PTS_CANC_${taskId}`;
          await runtime.upsert("PontosAjustes", {
            ID: penaltyId,
            USUARIO_ID: targetUserId,
            USUARIO_NOME: targetUserName,
            PONTOS: -pointsPenalty,
            MOTIVO: `Tarefa não realizada: ${task.Titulo || task.TITULO} (${reason})`,
            ORIGEM: 'NAO_REALIZADA',
            TAREFA_ID: String(taskId),
            TAREFA_TITULO: String(task.Titulo || task.TITULO || ''),
            ADMIN_ID: profile.UsuarioID || 'ADMIN',
            ADMIN_NOME: profile.Nome || 'Administração',
            CRIADO_EM: nowIso(),
          });
        }
      }

      return success(updated, "Tarefa cancelada.");
    },

    async cozinhaTasksReopen(args) {
      const [taskId] = args || [];
      assert(taskId, "Identificador da tarefa é obrigatório.");
      const patch = {
        Status: 'A fazer',
        STATUS: 'A fazer',
        Coluna: 'pendente',
        INICIADO_EM: '',
        ENVIADO_REVISAO_EM: '',
        CONCLUIDO_EM: '',
        DataConclusao: null,
        Confirmado: false,
        CONFIRMADO: false,
        FotoEvidencia: '',
        FOTO_URL: '',
        FOTO_ID: '',
        RevisaoStatus: '',
        REVISAO_STATUS: '',
        MotivoRevisao: '',
        MOTIVO_REVISAO: '',
        AtualizadoEm: nowIso(),
        ATUALIZADO_EM: nowIso(),
      };
      const updated = await runtime.patch("Tarefas", taskId, patch);
      return success(updated, "Tarefa reaberta.");
    },

    // ==========================================
    // COZINHA FLOW PONTOS E LOJA HANDLERS
    // ==========================================

    async cozinhaPointCatalog(args) {
      const profile = await runtime.requireProfile();
      let custom = [];
      try {
        custom = await runtime.list("PontosCatalogo", { profile });
      } catch (_) { }

      const customMap = new Map(custom.map(item => [String(item.ID), item]));
      const list = DEFAULT_REWARDS.map(def => {
        const override = customMap.get(def.ID);
        return {
          ...def,
          ...(override || {}),
          cost: Number(override?.PONTOS || def.PONTOS),
          featured: Boolean(override?.DESTAQUE ?? def.DESTAQUE),
          status: override?.STATUS || def.STATUS || 'Ativo',
        };
      });

      // Inclui itens criados exclusivamente no banco
      custom.forEach(c => {
        if (!DEFAULT_REWARDS.some(d => d.ID === c.ID)) {
          list.push({
            ...c,
            cost: Number(c.PONTOS || 0),
            featured: Boolean(c.DESTAQUE),
            status: c.STATUS || 'Ativo',
          });
        }
      });

      return success(list);
    },

    async cozinhaPointSaveReward(args) {
      const [reward] = args || [];
      assert(reward && typeof reward === "object", "Dados da recompensa são obrigatórios.");
      const profile = await runtime.requireProfile();
      assert(isAdmin(profile) || isManager(profile), "Apenas administradores podem gerenciar a loja.");

      const id = String(reward.ID || reward.id || `rew_${Date.now()}`);
      const record = {
        ID: id,
        NOME: String(reward.NOME || reward.name || '').trim(),
        DESCRICAO: String(reward.DESCRICAO || reward.description || '').trim(),
        PONTOS: Number(reward.PONTOS || reward.cost || 100),
        EMOJI: String(reward.EMOJI || reward.emoji || '🎁').trim(),
        TOM: String(reward.TOM || reward.tone || 'violet').trim(),
        DESTAQUE: Boolean(reward.DESTAQUE || reward.featured),
        STATUS: reward.STATUS || reward.status || 'Ativo',
        ATUALIZADO_EM: nowIso(),
      };

      const saved = await runtime.upsert("PontosCatalogo", record);
      return success(saved, "Recompensa salva no catálogo.");
    },

    async cozinhaPointRedemptions(args) {
      const profile = await runtime.requireProfile();
      const rows = await runtime.list("PontosResgates", { profile });
      const admin = isAdmin(profile) || isManager(profile);
      const uid = String(profile.FuncionarioID || profile.UsuarioID || "").toLowerCase();

      const visible = admin ? rows : rows.filter(r => String(r.USUARIO_ID || "").toLowerCase() === uid);
      visible.sort((a, b) => String(b.CRIADO_EM || '').localeCompare(String(a.CRIADO_EM || '')));
      return success(visible);
    },

    async cozinhaPointRedeem(args) {
      const [payload] = args || [];
      const rewardId = payload?.rewardId || payload?.RECOMPENSA_ID;
      assert(rewardId, "Identificador da recompensa é obrigatório.");

      const profile = await runtime.requireProfile();
      const uid = String(profile.FuncionarioID || profile.UsuarioID || "");
      const uName = String(profile.Nome || "Colaborador");

      // Obter recompensas
      const catalogResult = await this.cozinhaPointCatalog();
      const catalog = catalogResult.data || [];
      const reward = catalog.find(r => String(r.ID) === String(rewardId) && r.status !== 'Inativo');
      assert(reward, "Recompensa não disponível.");

      const cost = Number(reward.cost || reward.PONTOS || 0);

      // Calcular saldo do colaborador
      const [tasks, adjustments, redemptions] = await Promise.all([
        runtime.list("Tarefas", { profile }),
        runtime.list("PontosAjustes", { profile }),
        runtime.list("PontosResgates", { profile }),
      ]);

      const myTasks = tasks.filter(t => String(t.FuncionarioID || t.RESPONSAVEL_ID) === uid && (t.Status === 'Concluída' || t.Coluna === 'concluido'));
      const taskPoints = myTasks.reduce((sum, t) => sum + taskPointValue(t.Prioridade || t.PRIORIDADE), 0);

      const myAdjustments = adjustments.filter(a => String(a.USUARIO_ID) === uid);
      const bonusPoints = myAdjustments.filter(a => Number(a.PONTOS) > 0).reduce((s, a) => s + Number(a.PONTOS), 0);
      const penaltyPoints = myAdjustments.filter(a => Number(a.PONTOS) < 0).reduce((s, a) => s + Math.abs(Number(a.PONTOS)), 0);

      const netEarned = Math.max(0, taskPoints + bonusPoints - penaltyPoints);
      const spent = redemptions.filter(r => String(r.USUARIO_ID) === uid && r.STATUS !== 'Cancelado').reduce((s, r) => s + Number(r.PONTOS || 0), 0);
      const available = Math.max(0, netEarned - spent);

      assert(available >= cost, `Pontos insuficientes. Você possui ${available} ponto(s) e precisa de ${cost}.`);

      const redemptionId = `red_${Date.now()}_${uuid().slice(0, 6)}`;
      const record = {
        ID: redemptionId,
        RECOMPENSA_ID: String(reward.ID),
        RECOMPENSA_NOME: String(reward.NOME || reward.name),
        EMOJI: reward.EMOJI || reward.emoji || '🎁',
        PONTOS: cost,
        USUARIO_ID: uid,
        USUARIO_NOME: uName,
        STATUS: 'Solicitado',
        CRIADO_EM: nowIso(),
        ATUALIZADO_EM: nowIso(),
      };

      const saved = await runtime.upsert("PontosResgates", record);
      return success(saved, `Resgate de "${record.RECOMPENSA_NOME}" realizado com sucesso! Aguarde a liderança para entrega.`);
    },

    async cozinhaPointDeliver(args) {
      const [payload] = args || [];
      const redemptionId = payload?.id || payload?.ID || payload?.redemptionId;
      assert(redemptionId, "Identificador do resgate é obrigatório.");

      const profile = await runtime.requireProfile();
      assert(isAdmin(profile) || isManager(profile), "Apenas a administração pode marcar resgates como entregues.");

      const patch = {
        STATUS: 'Entregue',
        ENTREGUE_EM: nowIso(),
        ENTREGUE_POR_ID: profile.UsuarioID || profile.FuncionarioID || 'ADMIN',
        ENTREGUE_POR_NOME: profile.Nome || 'Administrador',
        ATUALIZADO_EM: nowIso(),
      };

      const updated = await runtime.patch("PontosResgates", redemptionId, patch);
      return success(updated, "Recompensa entregue ao colaborador!");
    },

    async cozinhaPointAdjustments(args) {
      const profile = await runtime.requireProfile();
      const rows = await runtime.list("PontosAjustes", { profile });
      const admin = isAdmin(profile) || isManager(profile);
      const uid = String(profile.FuncionarioID || profile.UsuarioID || "").toLowerCase();

      const visible = admin ? rows : rows.filter(r => String(r.USUARIO_ID || "").toLowerCase() === uid);
      visible.sort((a, b) => String(b.CRIADO_EM || '').localeCompare(String(a.CRIADO_EM || '')));
      return success(visible);
    },

    async cozinhaPointWeeklyMissions(args) {
      const profile = await runtime.requireProfile();
      const uid = String(profile.FuncionarioID || profile.UsuarioID || "");
      const uName = String(profile.Nome || "Colaborador");
      const week = currentWeekKey();

      const [tasks, adjustments] = await Promise.all([
        runtime.list("Tarefas", { profile }),
        runtime.list("PontosAjustes", { profile }),
      ]);

      const myTasks = tasks.filter(t => String(t.FuncionarioID || t.RESPONSAVEL_ID) === uid && (t.Status === 'Concluída' || t.Coluna === 'concluido') && String(t.DataConclusao || t.CONCLUIDO_EM || '').slice(0, 10) >= week);
      const onTime = myTasks.filter(t => {
        if (!t.Prazo && !t.PRAZO) return true;
        const deadline = new Date(t.Prazo || t.PRAZO).getTime();
        const finish = new Date(t.ENVIADO_REVISAO_EM || t.DataConclusao || t.CONCLUIDO_EM).getTime();
        return finish <= deadline;
      }).length;

      const missions = [
        { id: 'ritmo_5', title: 'Ritmo da cozinha', description: 'Conclua 5 tarefas nesta semana.', target: 5, current: myTasks.length, bonus: 2, icon: 'skillet' },
        { id: 'pontual_3', title: 'Entrega no ponto', description: 'Aprove 3 tarefas sem atraso.', target: 3, current: onTime, bonus: 3, icon: 'timer' },
        { id: 'craque_8', title: 'Craque da semana', description: 'Conclua 8 tarefas nesta semana.', target: 8, current: myTasks.length, bonus: 4, icon: 'workspace_premium' }
      ];

      for (const m of missions) {
        const id = `missao_${week}_${m.id}_${uid}`;
        const existing = adjustments.find(a => a.ID === id);
        m.completed = Boolean(existing);
        if (m.current >= m.target && !existing) {
          await runtime.upsert("PontosAjustes", {
            ID: id,
            USUARIO_ID: uid,
            USUARIO_NOME: uName,
            PONTOS: m.bonus,
            MOTIVO: `Missão concluída: ${m.title}`,
            ORIGEM: 'MISSAO_SEMANAL',
            SEMANA: week,
            ADMIN_ID: 'SYSTEM',
            ADMIN_NOME: 'CozinhaFlow',
            CRIADO_EM: nowIso(),
          });
          m.completed = true;
        }
      }

      return success(missions);
    },

    async cozinhaPointPenalize(args) {
      const [payload] = args || [];
      const userId = String(payload?.userId || payload?.USUARIO_ID || "").trim();
      const points = Math.abs(Number(payload?.points || payload?.PONTOS || 0));
      const reason = String(payload?.reason || payload?.MOTIVO || "").trim();

      assert(userId, "Selecione o colaborador.");
      assert(points > 0, "Informe a quantidade de pontos a retirar.");
      assert(reason, "O motivo da punição é obrigatório.");

      const profile = await runtime.requireProfile();
      assert(isAdmin(profile) || isManager(profile), "Apenas administradores podem retirar pontos.");

      const employees = await runtime.list("Funcionarios", { profile });
      const target = employees.find(e => String(e.FuncionarioID) === userId || String(e.id) === userId);
      const targetName = target?.Nome || target?.nome || "Colaborador";

      const id = `PTS_PEN_${Date.now()}_${uuid().slice(0, 5)}`;
      const record = {
        ID: id,
        USUARIO_ID: userId,
        USUARIO_NOME: targetName,
        PONTOS: -points,
        MOTIVO: reason,
        ORIGEM: 'MANUAL',
        ADMIN_ID: profile.UsuarioID || 'ADMIN',
        ADMIN_NOME: profile.Nome || 'Administração',
        CRIADO_EM: nowIso(),
      };

      const saved = await runtime.upsert("PontosAjustes", record);
      return success(saved, `${targetName} perdeu ${points} ponto(s).`);
    },

    async cozinhaTeamMetrics(args) {
      const profile = await runtime.requireProfile();
      const [employees, tasks, adjustments] = await Promise.all([
        runtime.list("Funcionarios", { profile }),
        runtime.list("Tarefas", { profile }),
        runtime.list("PontosAjustes", { profile }),
      ]);

      const today = todayIso();
      const week = currentWeekKey();

      const active = employees.filter(e => e.Ativo !== false && String(e.Status || "").toLowerCase() !== "inativo");
      const list = active.map(e => {
        const uid = String(e.FuncionarioID || e.id || "");
        const ownTasks = tasks.filter(t => String(t.FuncionarioID || t.RESPONSAVEL_ID) === uid);
        const doneToday = ownTasks.filter(t => (t.Status === 'Concluída' || t.Coluna === 'concluido') && String(t.DataConclusao || t.CONCLUIDO_EM || '').slice(0, 10) === today).length;
        const pending = ownTasks.filter(t => ['A fazer', 'Em andamento', 'Aguardando aprovação'].includes(t.Status || '') || ['pendente', 'andamento', 'visto'].includes(t.Coluna || '')).length;
        const late = ownTasks.filter(t => {
          const prazo = t.Prazo || t.PRAZO;
          const status = t.Status || t.STATUS;
          return prazo && !['Concluída', 'Cancelada'].includes(status) && new Date(prazo).getTime() < Date.now();
        }).length;

        // Pontuação total acumulada
        const allCompleted = ownTasks.filter(t => t.Status === 'Concluída' || t.Coluna === 'concluido');
        const pointsFromTasks = allCompleted.reduce((sum, t) => sum + taskPointValue(t.Prioridade || t.PRIORIDADE), 0);
        const myAdjusts = adjustments.filter(a => String(a.USUARIO_ID) === uid);
        const bonus = myAdjusts.filter(a => Number(a.PONTOS) > 0).reduce((s, a) => s + Number(a.PONTOS), 0);
        const penalty = myAdjusts.filter(a => Number(a.PONTOS) < 0).reduce((s, a) => s + Math.abs(Number(a.PONTOS)), 0);
        const totalPoints = Math.max(0, pointsFromTasks + bonus - penalty);

        // Pontuação da semana
        const weekTasks = allCompleted.filter(t => String(t.DataConclusao || t.CONCLUIDO_EM || '').slice(0, 10) >= week);
        const weekBonus = myAdjusts.filter(a => Number(a.PONTOS) > 0 && String(a.CRIADO_EM || '').slice(0, 10) >= week).reduce((s, a) => s + Number(a.PONTOS), 0);
        const weeklyPoints = weekTasks.reduce((sum, t) => sum + taskPointValue(t.Prioridade || t.PRIORIDADE), 0) + weekBonus;

        const levelInfo = getKitchenLevel(totalPoints);

        return {
          id: uid,
          name: e.Nome || e.nome || "Colaborador",
          role: e.Cargo || e.Perfil || "Operador",
          email: e.Email || "",
          store: e.LojaID || "",
          doneToday,
          pending,
          late,
          totalPoints,
          weeklyPoints,
          level: levelInfo.level,
          progress: levelInfo.progress,
        };
      });

      list.sort((a, b) => b.totalPoints - a.totalPoints);
      return success(list);
    },
  };
}

export const KITCHEN_LEVELS = [
  { min: 0, name: 'Ajudante da Cozinha', emoji: '🍳', short: 'Ajudante', tone: 'bronze' },
  { min: 60, name: 'Mestre do Molho', emoji: '🍅', short: 'Molho', tone: 'red' },
  { min: 150, name: 'Guardião da Fritadeira', emoji: '🍗', short: 'Fritadeira', tone: 'amber' },
  { min: 300, name: 'Rei da Chapa', emoji: '🍔', short: 'Chapa', tone: 'orange' },
  { min: 550, name: 'Pizzaiolo de Ouro', emoji: '🍕', short: 'Pizzaiolo', tone: 'gold' },
  { min: 900, name: 'Mestre do Crocante', emoji: '🔥', short: 'Crocante', tone: 'flame' },
  { min: 1500, name: 'Chef da House', emoji: '👨‍🍳', short: 'Chef', tone: 'purple' },
  { min: 2500, name: 'Lenda do Foodpark', emoji: '🏆', short: 'Lenda', tone: 'legend' }
];

export const DEFAULT_REWARDS = [
  { ID: 'refri_lata', NOME: 'Refrigerante ou suco', DESCRICAO: 'Uma bebida individual gelada.', PONTOS: 100, EMOJI: '🥤', TOM: 'ice', STATUS: 'Ativo' },
  { ID: 'sobremesa', NOME: 'Sobremesa da casa', DESCRICAO: 'Um doce individual do dia.', PONTOS: 120, EMOJI: '🍨', TOM: 'berry', STATUS: 'Ativo' },
  { ID: 'batata_individual', NOME: 'Batata individual', DESCRICAO: 'Uma porção para aproveitar no intervalo.', PONTOS: 150, EMOJI: '🍟', TOM: 'gold', STATUS: 'Ativo' },
  { ID: 'pizza_brotinho', NOME: 'Pizza brotinho', DESCRICAO: 'Um sabor disponível escolhido pelo funcionário.', PONTOS: 180, EMOJI: '🍕', TOM: 'pizza', STATUS: 'Ativo' },
  { ID: 'descanso_30', NOME: '+30 min de descanso', DESCRICAO: 'Pausa extra combinada com a liderança.', PONTOS: 200, EMOJI: '☕', TOM: 'mint', STATUS: 'Ativo' },
  { ID: 'lanche_escolha', NOME: 'Lanche à escolha', DESCRICAO: 'Um hambúrguer individual do cardápio interno.', PONTOS: 240, EMOJI: '🍔', TOM: 'burger', STATUS: 'Ativo' },
  { ID: 'descanso_60', NOME: '+1 hora de descanso', DESCRICAO: 'Uma hora extra de descanso agendada.', PONTOS: 320, EMOJI: '⏰', TOM: 'violet', STATUS: 'Ativo' },
  { ID: 'combo_individual', NOME: 'Combo individual', DESCRICAO: 'Lanche, acompanhamento e bebida.', PONTOS: 400, EMOJI: '🍔', TOM: 'fire', STATUS: 'Ativo' },
  { ID: 'escolher_turno', NOME: 'Escolher o turno', DESCRICAO: 'Prioridade na escolha de um turno disponível.', PONTOS: 500, EMOJI: '📅', TOM: 'blue', STATUS: 'Ativo' },
  { ID: 'kit_house', NOME: 'Kit House exclusivo', DESCRICAO: 'Camisa ou boné da equipe, conforme disponibilidade.', PONTOS: 600, EMOJI: '🧢', TOM: 'ink', STATUS: 'Ativo' },
  { ID: 'folga_extra', NOME: 'Folga extra', DESCRICAO: 'Uma folga agendada com antecedência e aprovação.', PONTOS: 800, EMOJI: '🏖️', TOM: 'legend', DESTAQUE: true, STATUS: 'Ativo' }
];

export const taskPointValue = (priority) => ({ Urgente: 3, Alta: 2, Normal: 1, Baixa: 1, Media: 1 }[priority] || 1);

export const getKitchenLevel = (points = 0) => {
  let level = KITCHEN_LEVELS[0];
  let nextLevel = KITCHEN_LEVELS[1] || null;
  for (let i = 0; i < KITCHEN_LEVELS.length; i++) {
    if (points >= KITCHEN_LEVELS[i].min) {
      level = KITCHEN_LEVELS[i];
      nextLevel = KITCHEN_LEVELS[i + 1] || null;
    }
  }
  const currentMin = level.min;
  const nextMin = nextLevel ? nextLevel.min : currentMin;
  const progress = nextLevel ? Math.min(100, Math.max(0, Math.round(((points - currentMin) / (nextMin - currentMin)) * 100))) : 100;
  return { level, nextLevel, progress, pointsNeeded: nextLevel ? Math.max(0, nextLevel.min - points) : 0 };
};

export const currentWeekKey = () => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
};

