// Módulo de Tarefas e Checklists tipo Trello / Kanban
// Grupo House 190 / House Burger

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

let state = {
  tasks: [],
  viewMode: 'kanban', // 'kanban' | 'operacao'
  selectedStore: '',
  selectedDate: dateKey(),
  selectedSector: 'todos',
  selectedPriority: 'todos',
  user: null,
  isManager: false,
  stores: [],
  employees: [],
  loading: false,
  activeModal: null, // null | 'new_task' | 'routine_modal' | 'maintenance_modal' | 'task_details'
  modalTask: null,
  checklistDraft: [],
};

const SECTORS = ['Cozinha', 'Chapa', 'Caixa', 'Salão', 'Delivery', 'Geral'];
const PRIORITIES = ['Urgente', 'Alta', 'Media', 'Baixa'];
const PRIORITY_LABELS = { Urgente: 'Urgente', Alta: 'Alta', Media: 'Média', Baixa: 'Baixa' };
const PRIORITY_COLORS = {
  Urgente: { bg: '#fee2e2', text: '#991b1b', border: '#f87171' },
  Alta: { bg: '#ffedd5', text: '#9a3412', border: '#fb923c' },
  Media: { bg: '#e0e7ff', text: '#3730a3', border: '#818cf8' },
  Baixa: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
};

const COLUMNS = [
  { id: 'pendente', title: 'Pendente', icon: '⏳', color: '#f59e0b' },
  { id: 'andamento', title: 'Em Andamento', icon: '⚡', color: '#3b82f6' },
  { id: 'visto', title: 'Aguardando Visto', icon: '👀', color: '#8b5cf6' },
  { id: 'concluido', title: 'Concluído', icon: '✅', color: '#10b981' },
];

function getApi() {
  return window.__GESTAO_FIREBASE__?.api;
}

async function loadTasks() {
  const api = getApi();
  if (!api) return;
  state.loading = true;
  renderTasksApp();

  try {
    const res = await api.invoke('tasksList', [state.selectedStore, state.selectedDate]);
    if (res?.success) {
      state.tasks = Array.isArray(res.data) ? res.data : [];
    }
  } catch (err) {
    console.error('Erro ao carregar tarefas:', err);
  } finally {
    state.loading = false;
    renderTasksApp();
  }
}

// Submeter nova tarefa ou edição
async function saveTaskFromForm(formData) {
  const api = getApi();
  if (!api) return;

  try {
    const res = await api.invoke('tasksSave', [formData]);
    if (res?.success) {
      state.activeModal = null;
      state.modalTask = null;
      state.checklistDraft = [];
      await loadTasks();
    }
  } catch (err) {
    alert(err.message || 'Falha ao salvar tarefa.');
  }
}

// Alterar coluna da tarefa
async function moveTaskColumn(taskId, newColumn) {
  const api = getApi();
  if (!api) return;

  // Optimistic update
  const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
  if (task) task.Coluna = newColumn;
  renderTasksApp();

  try {
    await api.invoke('tasksUpdateColumn', [taskId, newColumn]);
    await loadTasks();
  } catch (err) {
    console.error('Falha ao mover coluna:', err);
    await loadTasks();
  }
}

// Alternar item do checklist
async function toggleChecklistItem(taskId, itemId, checked) {
  const api = getApi();
  if (!api) return;

  // Optimistic update
  const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
  if (task && Array.isArray(task.Checklist)) {
    const item = task.Checklist.find(i => String(i.id) === String(itemId));
    if (item) item.concluido = checked;
  }
  renderTasksApp();

  try {
    await api.invoke('tasksToggleChecklistItem', [taskId, itemId, checked]);
    await loadTasks();
  } catch (err) {
    console.error('Falha ao atualizar checklist:', err);
    await loadTasks();
  }
}

// Aprovação / Visto do gerente
async function approveTask(taskId, notes = '') {
  const api = getApi();
  if (!api) return;

  try {
    await api.invoke('tasksApprove', [taskId, notes]);
    state.activeModal = null;
    await loadTasks();
  } catch (err) {
    alert(err.message || 'Falha ao aprovar tarefa.');
  }
}

// Gerar rotina de abertura ou fechamento
async function generateRoutine(routineType) {
  const api = getApi();
  if (!api) return;

  try {
    const res = await api.invoke('tasksGenerateRoutine', [state.selectedStore, routineType, state.selectedDate]);
    if (res?.success) {
      state.activeModal = null;
      await loadTasks();
    }
  } catch (err) {
    alert(err.message || 'Falha ao gerar rotina.');
  }
}

// Excluir tarefa
async function deleteTask(taskId) {
  if (!confirm('Tem certeza que deseja excluir esta tarefa?')) return;
  const api = getApi();
  if (!api) return;

  try {
    await api.invoke('tasksDelete', [taskId]);
    await loadTasks();
  } catch (err) {
    alert(err.message || 'Falha ao excluir tarefa.');
  }
}

// Filtragem de tarefas
function getFilteredTasks() {
  return state.tasks.filter(t => {
    if (state.selectedSector !== 'todos') {
      if (state.selectedSector === 'Manutenção') {
        if (t.Tipo !== 'manutencao') return false;
      } else if (t.Setor !== state.selectedSector) {
        return false;
      }
    }
    if (state.selectedPriority !== 'todos' && t.Prioridade !== state.selectedPriority) {
      return false;
    }
    return true;
  });
}

// Renderização Principal
function renderTasksApp() {
  const container = $('#tasksApp');
  if (!container) return;

  const currentStoreObj = state.stores.find(s => String(s.LojaID || s.lojaId) === String(state.selectedStore));
  const storeName = currentStoreObj?.Nome || currentStoreObj?.NomeLoja || 'Minha Unidade';

  const filteredTasks = getFilteredTasks();
  const totalCount = filteredTasks.length;
  const completedCount = filteredTasks.filter(t => t.Coluna === 'concluido').length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  let contentHtml = '';
  if (state.loading) {
    contentHtml = `
      <div class="tasks-loading">
        <div class="spinner"></div>
        <p>Carregando tarefas e rotinas do turno…</p>
      </div>`;
  } else if (state.viewMode === 'kanban') {
    contentHtml = renderKanbanBoard(filteredTasks);
  } else {
    contentHtml = renderOperationMode(filteredTasks, totalCount, completedCount, progressPercent);
  }

  container.innerHTML = `
    <div class="tasks-shell">
      <!-- Cabeçalho Principal -->
      <header class="tasks-header">
        <div class="tasks-header-left">
          <span class="eyebrow">OPERAÇÃO DE LOJA · HOUSE BURGER</span>
          <h2>Tarefas &amp; Checklist do Turno</h2>
          <p class="tasks-subhead">Organização ágil para abertura, fechamento e rotinas da equipe.</p>
        </div>

        <div class="tasks-header-actions">
          <button class="btn btn-primary" data-action="open-routine-modal">
            ⚡ Gerar Rotina do Turno
          </button>
          <button class="btn btn-secondary" data-action="open-maintenance-modal">
            🛠️ Chamado de Reparo
          </button>
          <button class="btn btn-secondary" data-action="open-new-task-modal">
            + Nova Tarefa
          </button>
        </div>
      </header>

      <!-- Barra de Ferramentas / Filtros -->
      <div class="tasks-toolbar">
        <div class="tasks-toolbar-controls">
          <!-- Seletor de Loja (se gestor ou admin) -->
          ${state.stores.length > 1 ? `
            <label class="tasks-control-label">
              <span>Unidade</span>
              <select class="form-control" data-action="change-store">
                ${state.stores.map(s => {
                  const id = String(s.LojaID || s.lojaId || '');
                  const name = s.NomeLoja || s.Nome || id;
                  return `<option value="${esc(id)}" ${id === state.selectedStore ? 'selected' : ''}>${esc(name)}</option>`;
                }).join('')}
              </select>
            </label>
          ` : ''}

          <!-- Seletor de Data -->
          <label class="tasks-control-label">
            <span>Turno / Data</span>
            <input type="date" class="form-control" value="${esc(state.selectedDate)}" data-action="change-date">
          </label>

          <!-- Seletor de Modo de Visão -->
          <div class="segmented tasks-view-mode-switch" aria-label="Modo de visualização">
            <button class="btn-segmented ${state.viewMode === 'kanban' ? 'active' : ''}" data-action="set-view-mode" data-mode="kanban">
              ☷ Quadro Kanban
            </button>
            <button class="btn-segmented ${state.viewMode === 'operacao' ? 'active' : ''}" data-action="set-view-mode" data-mode="operacao">
              ✓ Modo Operação
            </button>
          </div>
        </div>

        <!-- Barra de Progresso Rápida do Turno -->
        <div class="tasks-progress-banner">
          <div class="tasks-progress-label">
            <strong>${completedCount} de ${totalCount}</strong> concluídas (${progressPercent}%)
          </div>
          <div class="tasks-progress-track">
            <div class="tasks-progress-fill" style="width: ${progressPercent}%;"></div>
          </div>
        </div>
      </div>

      <!-- Filtros por Setor e Prioridade -->
      <div class="tasks-chips-bar">
        <div class="tasks-chips-group">
          <span class="tasks-chips-label">Setor:</span>
          <button class="chip ${state.selectedSector === 'todos' ? 'active' : ''}" data-action="filter-sector" data-sector="todos">Todos</button>
          ${SECTORS.map(sec => `
            <button class="chip ${state.selectedSector === sec ? 'active' : ''}" data-action="filter-sector" data-sector="${sec}">${sec}</button>
          `).join('')}
          <button class="chip ${state.selectedSector === 'Manutenção' ? 'active' : ''}" data-action="filter-sector" data-sector="Manutenção">🛠️ Manutenção</button>
        </div>

        <div class="tasks-chips-group">
          <span class="tasks-chips-label">Prioridade:</span>
          <button class="chip ${state.selectedPriority === 'todos' ? 'active' : ''}" data-action="filter-priority" data-priority="todos">Todas</button>
          ${PRIORITIES.map(p => `
            <button class="chip ${state.selectedPriority === p ? 'active' : ''}" data-action="filter-priority" data-priority="${p}">
              ${PRIORITY_LABELS[p]}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Área de Conteúdo (Kanban ou Operação) -->
      ${contentHtml}

      <!-- Modais Renderizados -->
      ${renderActiveModal()}
    </div>
  `;

  attachEventListeners();
}

// Renderizar Quadro Kanban
function renderKanbanBoard(tasks) {
  return `
    <div class="kanban-board">
      ${COLUMNS.map(col => {
        const colTasks = tasks.filter(t => (t.Coluna || 'pendente') === col.id);
        return `
          <div class="kanban-column kanban-col-${col.id}" data-column-id="${col.id}">
            <div class="kanban-column-header">
              <div class="kanban-column-title">
                <span class="kanban-column-icon">${col.icon}</span>
                <h3>${col.title}</h3>
              </div>
              <span class="kanban-badge-count">${colTasks.length}</span>
            </div>

            <div class="kanban-cards-container" data-column-drop="${col.id}">
              ${colTasks.length === 0 ? `
                <div class="kanban-empty-placeholder">Nenhuma tarefa nesta etapa.</div>
              ` : colTasks.map(task => renderKanbanCard(task)).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Renderizar Cartão Kanban individual
function renderKanbanCard(task) {
  const pStyle = PRIORITY_COLORS[task.Prioridade] || PRIORITY_COLORS.Media;
  const checklist = Array.isArray(task.Checklist) ? task.Checklist : [];
  const chTotal = checklist.length;
  const chDone = checklist.filter(c => c.concluido).length;
  const chPercent = chTotal > 0 ? Math.round((chDone / chTotal) * 100) : 0;

  const isRoutine = task.Tipo === 'rotina_abertura' || task.Tipo === 'rotina_fechamento';
  const routineLabel = task.Tipo === 'rotina_abertura' ? '☀️ Abertura' : task.Tipo === 'rotina_fechamento' ? '🌙 Fechamento' : task.Tipo === 'manutencao' ? '🛠️ Reparo' : '';

  return `
    <article class="kanban-card ${task.Tipo === 'manutencao' ? 'card-maintenance' : ''}" 
             draggable="true" 
             data-task-id="${esc(task.TarefaID)}">
      
      <!-- Topo do Cartão: Tags e Prioridade -->
      <div class="kanban-card-meta">
        <div class="kanban-card-tags">
          <span class="pill-sector">${esc(task.Setor || 'Geral')}</span>
          ${routineLabel ? `<span class="pill-routine">${routineLabel}</span>` : ''}
        </div>
        <span class="pill-priority" style="background:${pStyle.bg}; color:${pStyle.text}; border:1px solid ${pStyle.border};">
          ${PRIORITY_LABELS[task.Prioridade] || 'Normal'}
        </span>
      </div>

      <!-- Título e Descrição -->
      <h4 class="kanban-card-title">${esc(task.Titulo)}</h4>
      ${task.Descricao ? `<p class="kanban-card-desc">${esc(task.Descricao)}</p>` : ''}

      <!-- Prazo ou Hora Limite -->
      ${task.HoraLimite ? `
        <div class="kanban-card-deadline">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          <span>Até ${esc(task.HoraLimite)}</span>
        </div>
      ` : ''}

      <!-- Checklist e Barra de Progresso -->
      ${chTotal > 0 ? `
        <div class="kanban-card-checklist-section">
          <div class="kanban-checklist-gauge">
            <span class="kanban-checklist-label">${chDone}/${chTotal} itens</span>
            <span class="kanban-checklist-percent">${chPercent}%</span>
          </div>
          <div class="kanban-checklist-bar">
            <div class="kanban-checklist-fill" style="width: ${chPercent}%;"></div>
          </div>

          <!-- Itens do Checklist dentro do cartão -->
          <div class="kanban-checklist-items">
            ${checklist.map(item => `
              <label class="kanban-checklist-item">
                <input type="checkbox" 
                       ${item.concluido ? 'checked' : ''} 
                       data-action="toggle-check" 
                       data-task-id="${esc(task.TarefaID)}" 
                       data-item-id="${esc(item.id)}">
                <span class="${item.concluido ? 'checked' : ''}">${esc(item.texto)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Rodapé do Cartão: Responsável e Ações Rápidas -->
      <div class="kanban-card-footer">
        <div class="kanban-card-assignee">
          ${task.NomeFuncionario ? `
            <span class="kanban-avatar" title="${esc(task.NomeFuncionario)}">
              ${esc(task.NomeFuncionario.split(' ').map(n=>n[0]).slice(0,2).join(''))}
            </span>
            <span class="kanban-assignee-name">${esc(task.NomeFuncionario)}</span>
          ` : `
            <span class="kanban-assignee-unassigned">Equipe da Praça</span>
          `}
        </div>

        <!-- Ações do Cartão -->
        <div class="kanban-card-actions">
          ${task.Coluna === 'visto' && state.isManager ? `
            <button class="btn-card-action approve" title="Conceder Visto do Gerente" data-action="approve-task" data-task-id="${esc(task.TarefaID)}">
              ✓ Aprovar
            </button>
          ` : ''}

          <!-- Botões Touch para avançar/retroceder coluna em mobile -->
          <div class="kanban-step-buttons">
            ${task.Coluna !== 'pendente' ? `
              <button class="btn-card-step" title="Voltar etapa" data-action="step-task" data-task-id="${esc(task.TarefaID)}" data-direction="prev">‹</button>
            ` : ''}
            ${task.Coluna !== 'concluido' ? `
              <button class="btn-card-step" title="Avançar etapa" data-action="step-task" data-task-id="${esc(task.TarefaID)}" data-direction="next">›</button>
            ` : ''}
          </div>

          ${state.isManager ? `
            <button class="btn-card-action delete" title="Excluir tarefa" data-action="delete-task" data-task-id="${esc(task.TarefaID)}">
              ×
            </button>
          ` : ''}
        </div>
      </div>

      ${task.VistoPor ? `
        <div class="kanban-visto-tag">
          <span>✓ Visto concedido por <strong>${esc(task.VistoPor)}</strong></span>
        </div>
      ` : ''}
    </article>
  `;
}

// Renderizar Modo Operação (Checklist Rápido Touch-Friendly)
function renderOperationMode(tasks, totalCount, completedCount, progressPercent) {
  if (tasks.length === 0) {
    return `
      <div class="op-mode-empty">
        <div class="op-empty-icon">✓</div>
        <h3>Tudo em ordem no momento!</h3>
        <p>Nenhuma tarefa pendente para os filtros selecionados.</p>
        <button class="btn btn-primary" data-action="open-routine-modal">Disparar Rotina de Abertura/Fechamento</button>
      </div>
    `;
  }

  // Agrupar por Setor
  const groupedBySector = {};
  for (const t of tasks) {
    const sec = t.Setor || 'Geral';
    if (!groupedBySector[sec]) groupedBySector[sec] = [];
    groupedBySector[sec].push(t);
  }

  return `
    <div class="op-mode-container">
      <div class="op-mode-banner">
        <h3>Modo Operação · Conferência Rápida</h3>
        <p>Toque nos itens conforme forem sendo executados na loja.</p>
      </div>

      ${Object.entries(groupedBySector).map(([sector, sectorTasks]) => {
        return `
          <div class="op-sector-card">
            <div class="op-sector-header">
              <div class="op-sector-title">
                <span class="op-sector-badge">${esc(sector)}</span>
                <span>${sectorTasks.length} rotinas / tarefas</span>
              </div>
            </div>

            <div class="op-sector-tasks">
              ${sectorTasks.map(task => {
                const checklist = Array.isArray(task.Checklist) ? task.Checklist : [];
                const isAllDone = task.Coluna === 'concluido';
                return `
                  <div class="op-task-block ${isAllDone ? 'is-done' : ''}">
                    <div class="op-task-header">
                      <div>
                        <strong class="op-task-title">${esc(task.Titulo)}</strong>
                        ${task.HoraLimite ? `<span class="op-task-time">⏰ Até ${esc(task.HoraLimite)}</span>` : ''}
                      </div>
                      <span class="op-status-badge ${task.Coluna}">${task.Coluna === 'concluido' ? 'Concluído' : task.Coluna === 'visto' ? 'Aguardando Visto' : task.Coluna === 'andamento' ? 'Em Andamento' : 'Pendente'}</span>
                    </div>

                    ${checklist.length > 0 ? `
                      <div class="op-task-items">
                        ${checklist.map(it => `
                          <label class="op-item-row">
                            <input type="checkbox" 
                                   ${it.concluido ? 'checked' : ''} 
                                   data-action="toggle-check" 
                                   data-task-id="${esc(task.TarefaID)}" 
                                   data-item-id="${esc(it.id)}">
                            <span class="op-item-text ${it.concluido ? 'checked' : ''}">${esc(it.texto)}</span>
                          </label>
                        `).join('')}
                      </div>
                    ` : `
                      <div class="op-simple-finish">
                        <button class="btn ${isAllDone ? 'btn-secondary' : 'btn-primary'}" 
                                data-action="quick-complete" 
                                data-task-id="${esc(task.TarefaID)}">
                          ${isAllDone ? '✓ Concluído' : 'Marcar como Concluído'}
                        </button>
                      </div>
                    `}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Renderizar Modais
function renderActiveModal() {
  if (!state.activeModal) return '';

  if (state.activeModal === 'new_task') {
    return renderNewTaskModal();
  }
  if (state.activeModal === 'routine_modal') {
    return renderRoutineModal();
  }
  if (state.activeModal === 'maintenance_modal') {
    return renderMaintenanceModal();
  }
  return '';
}

function renderNewTaskModal() {
  return `
    <div class="modal-overlay" data-action="close-modal-overlay">
      <div class="modal-card tasks-modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Nova Tarefa / Checklist</h3>
          <button class="modal-close" data-action="close-modal">×</button>
        </div>

        <form id="taskForm" class="modal-body">
          <div class="form-row">
            <label class="form-group flex-2">
              <span>Título da Tarefa *</span>
              <input type="text" name="Titulo" class="form-control" required placeholder="Ex.: Higienização da chapa morna">
            </label>
            <label class="form-group flex-1">
              <span>Setor</span>
              <select name="Setor" class="form-control">
                ${SECTORS.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </label>
          </div>

          <div class="form-group">
            <span>Descrição / Orientações</span>
            <textarea name="Descricao" class="form-control" rows="2" placeholder="Instruções adicionais para a equipe..."></textarea>
          </div>

          <div class="form-row">
            <label class="form-group flex-1">
              <span>Prioridade</span>
              <select name="Prioridade" class="form-control">
                <option value="Media" selected>Média</option>
                <option value="Alta">Alta</option>
                <option value="Urgente">Urgente</option>
                <option value="Baixa">Baixa</option>
              </select>
            </label>

            <label class="form-group flex-1">
              <span>Responsável</span>
              <select name="FuncionarioID" class="form-control">
                <option value="">Equipe da Praça (Geral)</option>
                ${state.employees.map(e => `
                  <option value="${esc(e.FuncionarioID)}">${esc(e.Nome)}</option>
                `).join('')}
              </select>
            </label>

            <label class="form-group flex-1">
              <span>Hora Limite (opcional)</span>
              <input type="time" name="HoraLimite" class="form-control">
            </label>
          </div>

          <div class="form-group">
            <label class="checkbox-inline">
              <input type="checkbox" name="ExigeVistoGerente" value="1">
              <span>Exige visto/aprovação do Gerente para finalizar</span>
            </label>
          </div>

          <!-- Lista de Itens do Checklist -->
          <div class="form-group tasks-checklist-builder">
            <label>Subitens de Checklist (passo a passo)</label>
            <div class="tasks-checklist-input-row">
              <input type="text" id="checklistNewItemInput" class="form-control" placeholder="Adicionar subitem ao checklist...">
              <button type="button" class="btn btn-secondary" data-action="add-draft-checklist-item">+ Adicionar</button>
            </div>

            <div id="draftChecklistContainer" class="draft-checklist-list">
              ${state.checklistDraft.map((item, idx) => `
                <div class="draft-checklist-row">
                  <span>• ${esc(item.texto)}</span>
                  <button type="button" class="btn-remove-item" data-action="remove-draft-item" data-index="${idx}">×</button>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
            <button type="submit" class="btn btn-primary">Salvar Tarefa</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderRoutineModal() {
  return `
    <div class="modal-overlay" data-action="close-modal-overlay">
      <div class="modal-card tasks-modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>⚡ Gerar Rotina Padrão do Turno</h3>
          <button class="modal-close" data-action="close-modal">×</button>
        </div>

        <div class="modal-body">
          <p>Selecione qual pacote de checklists operacionais deseja disparar para hoje:</p>

          <div class="routine-picker-cards">
            <div class="routine-card" data-action="confirm-routine" data-routine="abertura">
              <div class="routine-card-icon">☀️</div>
              <div class="routine-card-info">
                <h4>Abertura do Turno</h4>
                <p>Estoque crítico, temperatura de freezers, pré-aquecimento de chapas/fritadeiras e gaveta de caixa.</p>
                <span class="routine-badge-count">4 tarefas pré-configuradas</span>
              </div>
            </div>

            <div class="routine-card" data-action="confirm-routine" data-routine="fechamento">
              <div class="routine-card-icon">🌙</div>
              <div class="routine-card-info">
                <h4>Fechamento do Turno</h4>
                <p>Limpeza de coifa/chapa, desligamento de gás, descarte de óleo, fechamento de caixa e recolhimento de lixo.</p>
                <span class="routine-badge-count">5 tarefas pré-configuradas</span>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button>
        </div>
      </div>
    </div>
  `;
}

function renderMaintenanceModal() {
  return `
    <div class="modal-overlay" data-action="close-modal-overlay">
      <div class="modal-card tasks-modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>🛠️ Chamado de Manutenção e Reparo</h3>
          <button class="modal-close" data-action="close-modal">×</button>
        </div>

        <form id="maintenanceForm" class="modal-body">
          <div class="form-group">
            <span>Equipamento com Defeito *</span>
            <select name="Equipamento" class="form-control" required>
              <option value="Chapa Principal">Chapa Principal</option>
              <option value="Fritadeira Elétrica/Gás">Fritadeira Elétrica/Gás</option>
              <option value="Freezer ou Câmara Fria">Freezer ou Câmara Fria</option>
              <option value="Ar-condicionado do Salão">Ar-condicionado do Salão</option>
              <option value="Coifa / Exaustor">Coifa / Exaustor</option>
              <option value="Computador / Tablet / PDV">Computador / Tablet / PDV</option>
              <option value="Bag de Motoboy / Entrega">Bag de Motoboy / Entrega</option>
              <option value="Instalação Elétrica / Lâmpadas">Instalação Elétrica / Lâmpadas</option>
              <option value="Outro Equipamento">Outro Equipamento</option>
            </select>
          </div>

          <div class="form-group">
            <span>Descrição do Problema *</span>
            <textarea name="Descricao" class="form-control" rows="3" required placeholder="Ex.: Fritadeira 2 está oscilando e desarmando o termostato ao atingir 180°C..."></textarea>
          </div>

          <div class="form-row">
            <label class="form-group flex-1">
              <span>Prioridade</span>
              <select name="Prioridade" class="form-control">
                <option value="Urgente">Urgente (impede operação)</option>
                <option value="Alta" selected>Alta</option>
                <option value="Media">Média</option>
              </select>
            </label>

            <label class="form-group flex-1">
              <span>Setor Afetado</span>
              <select name="Setor" class="form-control">
                <option value="Cozinha">Cozinha</option>
                <option value="Chapa">Chapa</option>
                <option value="Caixa">Caixa</option>
                <option value="Salão">Salão</option>
                <option value="Delivery">Delivery</option>
              </select>
            </label>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
            <button type="submit" class="btn btn-primary">Registrar Chamado</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// Vinculação de Eventos
function attachEventListeners() {
  const container = $('#tasksApp');
  if (!container) return;

  // Drag and Drop nos cartões
  const cards = $$('.kanban-card[draggable="true"]', container);
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
    });
  });

  // Drop targets nas colunas
  const dropTargets = $$('.kanban-cards-container[data-column-drop]', container);
  dropTargets.forEach(target => {
    target.addEventListener('dragover', (e) => {
      e.preventDefault();
      target.classList.add('drag-over');
    });
    target.addEventListener('dragleave', () => {
      target.classList.remove('drag-over');
    });
    target.addEventListener('drop', (e) => {
      e.preventDefault();
      target.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const colId = target.dataset.columnDrop;
      if (taskId && colId) {
        moveTaskColumn(taskId, colId);
      }
    });
  });

  // Formulário Nova Tarefa
  const taskForm = $('#taskForm');
  if (taskForm) {
    taskForm.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(taskForm);
      const funcId = fd.get('FuncionarioID') || '';
      const employee = state.employees.find(emp => String(emp.FuncionarioID) === String(funcId));

      const payload = {
        Titulo: fd.get('Titulo'),
        Setor: fd.get('Setor'),
        Descricao: fd.get('Descricao'),
        Prioridade: fd.get('Prioridade'),
        FuncionarioID: funcId,
        NomeFuncionario: employee?.Nome || '',
        HoraLimite: fd.get('HoraLimite') || '',
        ExigeVistoGerente: fd.get('ExigeVistoGerente') === '1',
        LojaID: state.selectedStore,
        DataTurno: state.selectedDate,
        Checklist: [...state.checklistDraft],
      };
      saveTaskFromForm(payload);
    };
  }

  // Formulário Chamado Manutenção
  const maintenanceForm = $('#maintenanceForm');
  if (maintenanceForm) {
    maintenanceForm.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(maintenanceForm);
      const equip = fd.get('Equipamento');
      const desc = fd.get('Descricao');
      const payload = {
        Titulo: `Manutenção: ${equip}`,
        Descricao: desc,
        Setor: fd.get('Setor') || 'Cozinha',
        Tipo: 'manutencao',
        Prioridade: fd.get('Prioridade') || 'Alta',
        LojaID: state.selectedStore,
        DataTurno: state.selectedDate,
        ExigeVistoGerente: true,
        Checklist: [
          { id: 1, texto: 'Inspecionar equipamento e isolar risco', concluido: false },
          { id: 2, texto: 'Acionar técnico credenciado ou assistência', concluido: false },
          { id: 3, texto: 'Testar após conserto e liberar para operação', concluido: false },
        ],
      };
      saveTaskFromForm(payload);
    };
  }
}

// Delegação de cliques global no container de tarefas
document.addEventListener('click', (e) => {
  const container = $('#tasksApp');
  if (!container) return;

  const btnAction = e.target.closest('[data-action]');
  if (!btnAction) return;

  const action = btnAction.dataset.action;

  if (action === 'open-new-task-modal') {
    state.activeModal = 'new_task';
    state.checklistDraft = [];
    renderTasksApp();
  } else if (action === 'open-routine-modal') {
    state.activeModal = 'routine_modal';
    renderTasksApp();
  } else if (action === 'open-maintenance-modal') {
    state.activeModal = 'maintenance_modal';
    renderTasksApp();
  } else if (action === 'close-modal' || action === 'close-modal-overlay') {
    state.activeModal = null;
    renderTasksApp();
  } else if (action === 'confirm-routine') {
    const routine = btnAction.dataset.routine;
    if (routine) generateRoutine(routine);
  } else if (action === 'set-view-mode') {
    const mode = btnAction.dataset.mode;
    if (mode) {
      state.viewMode = mode;
      renderTasksApp();
    }
  } else if (action === 'filter-sector') {
    state.selectedSector = btnAction.dataset.sector || 'todos';
    renderTasksApp();
  } else if (action === 'filter-priority') {
    state.selectedPriority = btnAction.dataset.priority || 'todos';
    renderTasksApp();
  } else if (action === 'add-draft-checklist-item') {
    const input = $('#checklistNewItemInput');
    const text = (input?.value || '').trim();
    if (text) {
      state.checklistDraft.push({ id: Date.now(), texto: text, concluido: false });
      input.value = '';
      renderTasksApp();
    }
  } else if (action === 'remove-draft-item') {
    const idx = Number(btnAction.dataset.index);
    if (!isNaN(idx)) {
      state.checklistDraft.splice(idx, 1);
      renderTasksApp();
    }
  } else if (action === 'approve-task') {
    const taskId = btnAction.dataset.taskId;
    if (taskId) {
      const notes = prompt('Observação do visto do gestor (opcional):') || '';
      approveTask(taskId, notes);
    }
  } else if (action === 'delete-task') {
    const taskId = btnAction.dataset.taskId;
    if (taskId) deleteTask(taskId);
  } else if (action === 'step-task') {
    const taskId = btnAction.dataset.taskId;
    const dir = btnAction.dataset.direction;
    const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
    if (task) {
      const colIds = COLUMNS.map(c => c.id);
      const currIdx = colIds.indexOf(task.Coluna || 'pendente');
      const newIdx = dir === 'next' ? currIdx + 1 : currIdx - 1;
      if (newIdx >= 0 && newIdx < colIds.length) {
        moveTaskColumn(taskId, colIds[newIdx]);
      }
    }
  } else if (action === 'quick-complete') {
    const taskId = btnAction.dataset.taskId;
    if (taskId) moveTaskColumn(taskId, 'concluido');
  }
});

// Eventos de mudança (change) em filtros e inputs
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-action="change-store"]')) {
    state.selectedStore = e.target.value;
    loadTasks();
  } else if (e.target.matches('[data-action="change-date"]')) {
    state.selectedDate = e.target.value;
    loadTasks();
  } else if (e.target.matches('[data-action="toggle-check"]')) {
    const taskId = e.target.dataset.taskId;
    const itemId = e.target.dataset.itemId;
    const checked = e.target.checked;
    if (taskId && itemId) {
      toggleChecklistItem(taskId, itemId, checked);
    }
  }
});

// Integração com dados do usuário e lojas emitidos pelo sistema central
window.addEventListener('house-journey', (e) => {
  const detail = e.detail || {};
  state.user = detail.user || null;
  state.isManager = Boolean(detail.manager);
  state.stores = Array.isArray(detail.stores) ? detail.stores : [];
  state.employees = Array.isArray(detail.employees) ? detail.employees : [];

  if (!state.selectedStore) {
    const myStore = state.user?.LojaID || state.user?.lojaId || state.stores[0]?.LojaID || '';
    state.selectedStore = myStore;
  }

  // Se a view ativa for tasks, carrega
  const tasksView = $('#view-tasks');
  if (tasksView && tasksView.classList.contains('active')) {
    loadTasks();
  }
});

// Quando a view tasks é aberta
window.addEventListener('gestao-tasks-open', () => {
  if (!state.selectedStore && state.stores.length > 0) {
    state.selectedStore = state.user?.LojaID || state.user?.lojaId || state.stores[0]?.LojaID || '';
  }
  loadTasks();
});

export { loadTasks, renderTasksApp };
