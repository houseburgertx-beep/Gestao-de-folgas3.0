import { runtime } from "./runtime.js";
import { assert, nowIso, todayIso, uuid } from "./utils.js";
import { isAdmin, isManager, success } from "./api-base.js";

export function createTasksHandlers() {
  return {
    async tasksList(args) {
      const [lojaId, dataTurno] = args || [];
      const profile = await runtime.requireProfile();
      const targetStore = String(lojaId || profile.LojaID || "").trim();
      const rows = await runtime.list("Tarefas", { profile });
      const filtered = rows.filter((task) => {
        if (targetStore && String(task.LojaID || "") !== targetStore) {
          if (!isAdmin(profile)) return false;
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
            Titulo: "Abertura Turno: Conferência de Estoque Crítico",
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
            Titulo: "Abertura Turno: Temperatura dos Freezers e Câmaras",
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
            Titulo: "Abertura Turno: Pré-aquecimento de Chapas e Fritadeiras",
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
            Titulo: "Abertura Turno: Gaveta de Caixa e Frente de Loja",
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
            Titulo: "Fechamento Turno: Limpeza da Coifa, Chapas e Grelhas",
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
            Titulo: "Fechamento Turno: Desligamento de Gás e Equipamentos",
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
            Titulo: "Fechamento Turno: Descarte e Filtragem de Óleo",
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
            Titulo: "Fechamento Turno: Fechamento de Caixa e Sangria",
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
            Titulo: "Fechamento Turno: Recolhimento de Lixo e Salão",
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
      };

      const selected = templates[routineType] || [];
      assert(selected.length > 0, "Tipo de rotina inválido. Escolha 'abertura' ou 'fechamento'.");

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
        `Rotina de ${routineType === "abertura" ? "Abertura" : "Fechamento"} gerada com ${createdList.length} tarefas.`,
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
  };
}
