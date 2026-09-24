// Módulo de Tarefas e Checklists tipo Trello / Kanban
// Grupo House 190 / House Burger — Interface Moderna e Prática

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
  user: null,
  isManager: false,
  stores: [],
  employees: [],
  loading: false,
  checklistDraft: [],
};

const SECTOR_GROUPS = [
  { id: 'todos', label: 'Todas as Tarefas' },
  { id: 'abertura', label: '☀️ Abertura' },
  { id: 'cozinha_chapa', label: '🍔 Cozinha & Chapa' },
  { id: 'caixa_salao', label: '💳 Caixa & Salão' },
  { id: 'fechamento', label: '🌙 Fechamento' },
  { id: 'manutencao', label: '🛠️ Manutenções' },
];

const COLUMNS = [
  { id: 'pendente', title: 'Pendente', icon: '⏳', color: '#64748b' },
  { id: 'andamento', title: 'Em Andamento', icon: '⚡', color: '#2563eb' },
  { id: 'visto', title: 'Aguardando Visto', icon: '👀', color: '#7c3aed' },
  { id: 'concluido', title: 'Concluído', icon: '✅', color: '#059669' },
];

function getApi() {
  return window.__GESTAO_FIREBASE__?.api;
}

function openDialog(id) {
  const d = document.getElementById(id);
  if (d && !d.open) d.showModal();
}

function closeDialog(id) {
  const d = document.getElementById(id);
  if (d?.open) d.close();
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

async function moveTaskColumn(taskId, newColumn) {
  const api = getApi();
  if (!api) return;

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

async function toggleChecklistItem(taskId, itemId, checked) {
  const api = getApi();
  if (!api) return;

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

async function approveTask(taskId, notes = '') {
  const api = getApi();
  if (!api) return;

  try {
    await api.invoke('tasksApprove', [taskId, notes]);
    await loadTasks();
  } catch (err) {
    alert(err.message || 'Falha ao conceder visto.');
  }
}

async function generateRoutine(routineType) {
  const api = getApi();
  if (!api) return;

  closeDialog('taskRoutineDialog');
  state.loading = true;
  renderTasksApp();

  try {
    const res = await api.invoke('tasksGenerateRoutine', [state.selectedStore, routineType, state.selectedDate]);
    if (res?.success) {
      await loadTasks();
    }
  } catch (err) {
    alert(err.message || 'Falha ao disparar rotina.');
    state.loading = false;
    renderTasksApp();
  }
}

async function deleteTask(taskId) {
  if (!confirm('Deseja realmente remover esta tarefa?')) return;
  const api = getApi();
  if (!api) return;

  try {
    await api.invoke('tasksDelete', [taskId]);
    await loadTasks();
  } catch (err) {
    alert(err.message || 'Falha ao excluir tarefa.');
  }
}

function getFilteredTasks() {
  return state.tasks.filter(t => {
    if (state.selectedSector === 'abertura') return t.Tipo === 'rotina_abertura';
    if (state.selectedSector === 'fechamento') return t.Tipo === 'rotina_fechamento';
    if (state.selectedSector === 'manutencao') return t.Tipo === 'manutencao';
    if (state.selectedSector === 'cozinha_chapa') return t.Setor === 'Cozinha' || t.Setor === 'Chapa';
    if (state.selectedSector === 'caixa_salao') return t.Setor === 'Caixa' || t.Setor === 'Salão';
    return true;
  });
}

function getSectorTheme(sector, type) {
  if (type === 'manutencao') return { bg: '#fef2f2', text: '#b91c1c', border: '#fca5a5' };
  if (type === 'rotina_abertura') return { bg: '#fffbeb', text: '#b45309', border: '#fde68a' };
  if (type === 'rotina_fechamento') return { bg: '#faf5ff', text: '#7e22ce', border: '#e9d5ff' };
  switch (sector) {
    case 'Chapa': return { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' };
    case 'Cozinha': return { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' };
    case 'Caixa': return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' };
    case 'Salão': return { bg: '#fdf4ff', text: '#a21caf', border: '#f5d0fe' };
    case 'Delivery': return { bg: '#fefce8', text: '#a16207', border: '#fef08a' };
    default: return { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
  }
}

function renderTasksApp() {
  const container = $('#tasksApp');
  if (!container) return;

  const currentStore = state.stores.find(s => String(s.LojaID || s.lojaId) === String(state.selectedStore));
  const storeName = currentStore?.Nome || currentStore?.NomeLoja || 'Unidade Principal';

  const allDayTasks = state.tasks;
  const totalTasks = allDayTasks.length;
  const completedTasks = allDayTasks.filter(t => t.Coluna === 'concluido').length;
  const waitingApprovalTasks = allDayTasks.filter(t => t.Coluna === 'visto').length;
  const maintenanceTasks = allDayTasks.filter(t => t.Tipo === 'manutencao' && t.Coluna !== 'concluido').length;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const filtered = getFilteredTasks();

  container.innerHTML = `
    <div class="tasks-page">
      <!-- Barra Superior Operacional Compacta -->
      <header class="tasks-top-bar">
        <div class="tasks-top-left">
          <div class="tasks-title-line">
            <h2 class="tasks-main-title">Operação &amp; Rotinas</h2>
            <div class="tasks-store-cluster">
              ${state.stores.length > 1 ? `
                <select class="tasks-compact-select" id="tasksStoreSelect">
                  ${state.stores.map(s => {
                    const id = String(s.LojaID || s.lojaId || '');
                    const name = s.NomeLoja || s.Nome || id;
                    return `<option value="${esc(id)}" ${id === state.selectedStore ? 'selected' : ''}>${esc(name)}</option>`;
                  }).join('')}
                </select>
              ` : `
                <span class="tasks-store-chip">📍 ${esc(storeName)}</span>
              `}
              <input type="date" class="tasks-compact-date" id="tasksDateInput" value="${esc(state.selectedDate)}">
            </div>
          </div>

          <div class="tasks-kpi-chips">
            <span class="tasks-chip total" title="Total de tarefas programadas">
              <strong>${totalTasks}</strong> tarefas
            </span>
            <span class="tasks-chip done" title="Tarefas concluídas">
              ✓ <strong>${completedTasks}</strong> concluídas (${progressPercent}%)
            </span>
            ${waitingApprovalTasks > 0 ? `
              <span class="tasks-chip waiting" title="Aguardando visto do gerente">
                👀 <strong>${waitingApprovalTasks}</strong> para visto
              </span>
            ` : ''}
            ${maintenanceTasks > 0 ? `
              <span class="tasks-chip maintenance" title="Reparos ou manutenção em aberto">
                🛠️ <strong>${maintenanceTasks}</strong> reparos
              </span>
            ` : ''}
          </div>
        </div>

        <div class="tasks-top-actions">
          <button class="btn btn-primary" id="openNewTaskBtn">
            + Nova Tarefa
          </button>
          <button class="btn btn-secondary" id="openRoutineBtn" title="Disparar rotinas automáticas de abertura ou fechamento">
            ⚡ Rotina do Turno
          </button>
          <button class="btn btn-secondary ${maintenanceTasks > 0 ? 'is-alert-btn' : ''}" id="openMaintenanceBtn">
            🛠️ Reparos ${maintenanceTasks > 0 ? `<span class="badge-count-red">${maintenanceTasks}</span>` : ''}
          </button>
        </div>
      </header>

      <!-- Barra de Filtros de Setor e Visualização -->
      <div class="tasks-filter-bar">
        <div class="tasks-sector-tabs">
          ${SECTOR_GROUPS.map(grp => `
            <button class="tasks-sector-tab ${state.selectedSector === grp.id ? 'active' : ''}" data-sector-filter="${grp.id}">
              ${grp.label}
            </button>
          `).join('')}
        </div>

        <div class="tasks-filter-right">
          <div class="segmented" aria-label="Visualização">
            <button class="segmented-btn ${state.viewMode === 'kanban' ? 'active' : ''}" data-view-mode="kanban">
              ☷ Kanban
            </button>
            <button class="segmented-btn ${state.viewMode === 'operacao' ? 'active' : ''}" data-view-mode="operacao">
              ☰ Lista Rápida
            </button>
          </div>
        </div>
      </div>

      <!-- Conteúdo Principal -->
      ${state.loading ? `
        <div class="tasks-loading-state">
          <div class="spinner"></div>
          <p>Sincronizando tarefas da loja...</p>
        </div>
      ` : totalTasks === 0 ? `
        <!-- Empty State Inteligente e Útil -->
        <div class="tasks-empty-starter">
          <div class="starter-icon">📋</div>
          <h3>Nenhuma rotina gerada para hoje ainda.</h3>
          <p>Dispare os checklists essenciais do turno em 1 clique ou adicione uma tarefa manual:</p>

          <div class="starter-actions">
            <button class="starter-card-btn abertura" data-trigger-routine="abertura">
              <span class="starter-card-icon">☀️</span>
              <div>
                <strong>Carregar Abertura da Loja</strong>
                <small>Freezers, estoque crítico, chapa, fritadeira e gaveta de caixa.</small>
              </div>
            </button>

            <button class="starter-card-btn fechamento" data-trigger-routine="fechamento">
              <span class="starter-card-icon">🌙</span>
              <div>
                <strong>Carregar Fechamento da Loja</strong>
                <small>Limpeza de coifa/chapa, gás, descarte de óleo, caixa e lixo.</small>
              </div>
            </button>
          </div>
        </div>
      ` : state.viewMode === 'kanban' ? renderKanban(filtered) : renderOperationList(filtered)}
    </div>
  `;

  bindDomEvents();
}

function renderKanban(tasks) {
  return `
    <div class="trello-board">
      ${COLUMNS.map(col => {
        const colTasks = tasks.filter(t => (t.Coluna || 'pendente') === col.id);
        return `
          <div class="trello-column" data-col-id="${col.id}">
            <div class="trello-column-header">
              <div class="trello-col-title">
                <span>${col.icon}</span>
                <h4>${col.title}</h4>
              </div>
              <span class="trello-col-count">${colTasks.length}</span>
            </div>

            <div class="trello-cards-area" data-col-target="${col.id}">
              ${colTasks.map(t => renderCard(t)).join('')}
            </div>

            <button class="trello-add-card-btn" data-add-card-col="${col.id}">
              + Adicionar cartão
            </button>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderCard(task) {
  const checklist = Array.isArray(task.Checklist) ? task.Checklist : [];
  const chTotal = checklist.length;
  const chDone = checklist.filter(c => c.concluido).length;
  const chPercent = chTotal > 0 ? Math.round((chDone / chTotal) * 100) : 0;
  const theme = getSectorTheme(task.Setor, task.Tipo);

  return `
    <div class="trello-card" draggable="true" data-task-id="${esc(task.TarefaID)}">
      <!-- Pílula de Setor / Tipo -->
      <div class="trello-card-tags">
        <span class="trello-tag" style="background:${theme.bg}; color:${theme.text}; border:1px solid ${theme.border};">
          ${esc(task.Tipo === 'rotina_abertura' ? '☀️ Abertura' : task.Tipo === 'rotina_fechamento' ? '🌙 Fechamento' : task.Tipo === 'manutencao' ? '🛠️ Manutenção' : task.Setor || 'Geral')}
        </span>
        ${task.Prioridade === 'Urgente' ? `<span class="trello-tag-urgent">Urgente</span>` : ''}
        ${task.HoraLimite ? `<span class="trello-tag-time">⏰ ${esc(task.HoraLimite)}</span>` : ''}
      </div>

      <h5 class="trello-card-title">${esc(task.Titulo)}</h5>
      ${task.Descricao ? `<p class="trello-card-desc">${esc(task.Descricao)}</p>` : ''}

      <!-- Barra e Subtarefas do Checklist -->
      ${chTotal > 0 ? `
        <div class="trello-card-checklist">
          <div class="trello-checklist-meta">
            <span>Checklist</span>
            <strong>${chDone}/${chTotal} (${chPercent}%)</strong>
          </div>
          <div class="trello-checklist-track">
            <div class="trello-checklist-bar" style="width: ${chPercent}%;"></div>
          </div>

          <div class="trello-subtasks">
            ${checklist.map(item => `
              <div class="trello-subtask-item">
                <input type="checkbox" id="chk_${esc(task.TarefaID)}_${esc(item.id)}" class="trello-chk" ${item.concluido ? 'checked' : ''} data-toggle-subtask="${esc(item.id)}" data-task-id="${esc(task.TarefaID)}">
                <label for="chk_${esc(task.TarefaID)}_${esc(item.id)}" class="trello-chk-label ${item.concluido ? 'is-done' : ''}">${esc(item.texto)}</label>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Rodapé do Cartão -->
      <div class="trello-card-foot">
        <div class="trello-assignee">
          ${task.NomeFuncionario ? `
            <span class="trello-avatar">${esc(task.NomeFuncionario.split(' ').map(n=>n[0]).slice(0,2).join(''))}</span>
            <span class="trello-assignee-name">${esc(task.NomeFuncionario)}</span>
          ` : `
            <span class="trello-unassigned">Equipe da Praça</span>
          `}
        </div>

        <div class="trello-card-actions">
          ${task.Coluna === 'visto' && state.isManager ? `
            <button class="trello-btn-approve" data-approve-task="${esc(task.TarefaID)}">
              ✓ Aprovar
            </button>
          ` : ''}
          <button class="trello-btn-step" data-step-dir="prev" data-task-id="${esc(task.TarefaID)}" title="Voltar etapa">‹</button>
          <button class="trello-btn-step" data-step-dir="next" data-task-id="${esc(task.TarefaID)}" title="Avançar etapa">›</button>
          ${state.isManager ? `
            <button class="trello-btn-del" data-delete-task="${esc(task.TarefaID)}" title="Remover">✕</button>
          ` : ''}
        </div>
      </div>

      ${task.VistoPor ? `
        <div class="trello-visto-approved">
          ✓ Visto do Gerente: <strong>${esc(task.VistoPor)}</strong>
        </div>
      ` : ''}
    </div>
  `;
}

function renderOperationList(tasks) {
  const grouped = {};
  for (const t of tasks) {
    const key = t.Tipo === 'rotina_abertura' ? '☀️ Abertura de Turno' : t.Tipo === 'rotina_fechamento' ? '🌙 Fechamento de Turno' : t.Setor || 'Geral';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(t);
  }

  return `
    <div class="op-list-wrap">
      ${Object.entries(grouped).map(([groupTitle, groupTasks]) => `
        <div class="panel op-group-panel">
          <div class="panel-head">
            <h3>${esc(groupTitle)}</h3>
            <span class="trello-col-count">${groupTasks.length} rotinas</span>
          </div>

          <div class="op-group-content">
            ${groupTasks.map(t => {
              const checklist = Array.isArray(t.Checklist) ? t.Checklist : [];
              const isDone = t.Coluna === 'concluido';
              return `
                <div class="op-card ${isDone ? 'is-complete' : ''}">
                  <div class="op-card-top">
                    <div>
                      <strong>${esc(t.Titulo)}</strong>
                      ${t.HoraLimite ? `<span class="trello-tag-time" style="margin-left:6px;">⏰ ${esc(t.HoraLimite)}</span>` : ''}
                    </div>
                    <span class="op-badge ${t.Coluna}">
                      ${t.Coluna === 'concluido' ? 'Concluído' : t.Coluna === 'visto' ? 'Aguardando Visto' : t.Coluna === 'andamento' ? 'Em Andamento' : 'Pendente'}
                    </span>
                  </div>

                  ${checklist.length > 0 ? `
                    <div class="op-checklist-list">
                      ${checklist.map(item => `
                        <div class="op-check-row">
                          <input type="checkbox" id="op_chk_${esc(t.TarefaID)}_${esc(item.id)}" class="trello-chk" ${item.concluido ? 'checked' : ''} data-toggle-subtask="${esc(item.id)}" data-task-id="${esc(t.TarefaID)}">
                          <label for="op_chk_${esc(t.TarefaID)}_${esc(item.id)}" class="trello-chk-label ${item.concluido ? 'is-done' : ''}">${esc(item.texto)}</label>
                        </div>
                      `).join('')}
                    </div>
                  ` : `
                    <button class="btn btn-secondary" style="margin-top:8px;" data-toggle-card-complete="${esc(t.TarefaID)}">
                      ${isDone ? '✓ Concluído' : 'Marcar como Feito'}
                    </button>
                  `}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function bindDomEvents() {
  const container = $('#tasksApp');
  if (!container) return;

  // Botões do Topo
  $('#openNewTaskBtn', container)?.addEventListener('click', () => {
    populateEmployeeSelect();
    state.checklistDraft = [];
    renderDraftChecklist();
    openDialog('taskDialog');
  });

  $('#openRoutineBtn', container)?.addEventListener('click', () => {
    openDialog('taskRoutineDialog');
  });

  $('#openMaintenanceBtn', container)?.addEventListener('click', () => {
    openDialog('taskMaintenanceDialog');
  });

  // Mudança de Loja e Data
  $('#tasksStoreSelect', container)?.addEventListener('change', (e) => {
    state.selectedStore = e.target.value;
    loadTasks();
  });

  $('#tasksDateInput', container)?.addEventListener('change', (e) => {
    state.selectedDate = e.target.value;
    loadTasks();
  });

  // Drag and Drop
  const cards = $$('.trello-card[draggable="true"]', container);
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });

  const dropZones = $$('.trello-cards-area', container);
  dropZones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const colId = zone.dataset.colTarget;
      if (taskId && colId) moveTaskColumn(taskId, colId);
    });
  });
}

function populateEmployeeSelect() {
  const sel = $('#taskEmployeeInput');
  if (!sel) return;
  sel.innerHTML = `
    <option value="">Equipe da Praça (Geral)</option>
    ${state.employees.map(e => `<option value="${esc(e.FuncionarioID)}">${esc(e.Nome)}</option>`).join('')}
  `;
}

function renderDraftChecklist() {
  const box = $('#taskChecklistDraftContainer');
  if (!box) return;
  box.innerHTML = state.checklistDraft.map((item, idx) => `
    <div class="draft-row">
      <span>• ${esc(item.texto)}</span>
      <button type="button" class="btn-del-draft" data-del-draft="${idx}">✕</button>
    </div>
  `).join('');
}

// Global delegated clicks
document.addEventListener('click', (e) => {
  // Abas de setor
  const tab = e.target.closest('[data-sector-filter]');
  if (tab) {
    state.selectedSector = tab.dataset.sectorFilter;
    renderTasksApp();
    return;
  }

  // Segmented view mode
  const modeBtn = e.target.closest('[data-view-mode]');
  if (modeBtn) {
    state.viewMode = modeBtn.dataset.viewMode;
    renderTasksApp();
    return;
  }

  // Disparar rotina (Abertura / Fechamento)
  const routineTrigger = e.target.closest('[data-trigger-routine]');
  if (routineTrigger) {
    const routine = routineTrigger.dataset.triggerRoutine;
    if (routine) generateRoutine(routine);
    return;
  }

  // Avançar / Voltar etapa do cartão
  const stepBtn = e.target.closest('[data-step-dir]');
  if (stepBtn) {
    const taskId = stepBtn.dataset.taskId;
    const dir = stepBtn.dataset.stepDir;
    const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
    if (task) {
      const colIds = COLUMNS.map(c => c.id);
      const curr = colIds.indexOf(task.Coluna || 'pendente');
      const target = dir === 'next' ? curr + 1 : curr - 1;
      if (target >= 0 && target < colIds.length) {
        moveTaskColumn(taskId, colIds[target]);
      }
    }
    return;
  }

  // Adicionar cartão direto da coluna
  const addCol = e.target.closest('[data-add-card-col]');
  if (addCol) {
    populateEmployeeSelect();
    state.checklistDraft = [];
    renderDraftChecklist();
    openDialog('taskDialog');
    return;
  }

  // Conceder visto
  const approveBtn = e.target.closest('[data-approve-task]');
  if (approveBtn) {
    const taskId = approveBtn.dataset.approveTask;
    const notes = prompt('Anotação de validação (opcional):') || '';
    approveTask(taskId, notes);
    return;
  }

  // Remover tarefa
  const delBtn = e.target.closest('[data-delete-task]');
  if (delBtn) {
    deleteTask(delBtn.dataset.deleteTask);
    return;
  }

  // Adicionar item no checklist draft do dialog
  if (e.target.id === 'taskChecklistAddBtn') {
    const inp = $('#taskChecklistNewInput');
    const text = (inp?.value || '').trim();
    if (text) {
      state.checklistDraft.push({ id: Date.now(), texto: text, concluido: false });
      inp.value = '';
      renderDraftChecklist();
    }
    return;
  }

  // Deletar item do checklist draft
  const delDraft = e.target.closest('[data-del-draft]');
  if (delDraft) {
    const idx = Number(delDraft.dataset.delDraft);
    if (!isNaN(idx)) {
      state.checklistDraft.splice(idx, 1);
      renderDraftChecklist();
    }
    return;
  }

  // Toggle rápido de cartão na lista
  const toggleComplete = e.target.closest('[data-toggle-card-complete]');
  if (toggleComplete) {
    const taskId = toggleComplete.dataset.toggleCardComplete;
    const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
    if (task) {
      moveTaskColumn(taskId, task.Coluna === 'concluido' ? 'andamento' : 'concluido');
    }
    return;
  }
});

// Toggle subtask checkbox
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-toggle-subtask]')) {
    const itemId = e.target.dataset.toggleSubtask;
    const taskId = e.target.dataset.taskId;
    const checked = e.target.checked;
    if (taskId && itemId) {
      toggleChecklistItem(taskId, itemId, checked);
    }
  }
});

// Envio do Form de Nova Tarefa
document.addEventListener('DOMContentLoaded', () => {
  const taskForm = document.getElementById('taskForm');
  if (taskForm) {
    taskForm.onsubmit = async (e) => {
      e.preventDefault();
      const title = $('#taskTitleInput')?.value?.trim();
      if (!title) return;

      const funcId = $('#taskEmployeeInput')?.value || '';
      const employee = state.employees.find(emp => String(emp.FuncionarioID) === String(funcId));

      const payload = {
        Titulo: title,
        Setor: $('#taskSectorInput')?.value || 'Geral',
        Prioridade: $('#taskPriorityInput')?.value || 'Media',
        FuncionarioID: funcId,
        NomeFuncionario: employee?.Nome || '',
        HoraLimite: $('#taskDeadlineInput')?.value || '',
        Descricao: $('#taskDescInput')?.value || '',
        ExigeVistoGerente: $('#taskManagerSignInput')?.checked || false,
        LojaID: state.selectedStore,
        DataTurno: state.selectedDate,
        Checklist: [...state.checklistDraft],
      };

      const api = getApi();
      if (!api) return;

      try {
        await api.invoke('tasksSave', [payload]);
        closeDialog('taskDialog');
        taskForm.reset();
        state.checklistDraft = [];
        await loadTasks();
      } catch (err) {
        alert(err.message || 'Falha ao salvar tarefa.');
      }
    };
  }

  const maintenanceForm = document.getElementById('taskMaintenanceForm');
  if (maintenanceForm) {
    maintenanceForm.onsubmit = async (e) => {
      e.preventDefault();
      const equip = $('#taskMaintenanceEquipment')?.value || 'Equipamento';
      const desc = $('#taskMaintenanceDesc')?.value || '';

      const payload = {
        Titulo: `Manutenção: ${equip}`,
        Descricao: desc,
        Setor: $('#taskMaintenanceSector')?.value || 'Cozinha',
        Tipo: 'manutencao',
        Prioridade: $('#taskMaintenancePriority')?.value || 'Alta',
        LojaID: state.selectedStore,
        DataTurno: state.selectedDate,
        ExigeVistoGerente: true,
        Checklist: [
          { id: 1, texto: 'Avaliar dano e desligar por precaução', concluido: false },
          { id: 2, texto: 'Notificar técnico de manutenção ou assistência', concluido: false },
          { id: 3, texto: 'Conferir conserto e liberar para o turno', concluido: false },
        ],
      };

      const api = getApi();
      if (!api) return;

      try {
        await api.invoke('tasksSave', [payload]);
        closeDialog('taskMaintenanceDialog');
        maintenanceForm.reset();
        await loadTasks();
      } catch (err) {
        alert(err.message || 'Falha ao registrar chamado.');
      }
    };
  }
});

// Ouvintes de sistema
window.addEventListener('house-journey', (e) => {
  const detail = e.detail || {};
  state.user = detail.user || null;
  state.isManager = Boolean(detail.manager);
  state.stores = Array.isArray(detail.stores) ? detail.stores : [];
  state.employees = Array.isArray(detail.employees) ? detail.employees : [];

  if (!state.selectedStore) {
    state.selectedStore = state.user?.LojaID || state.user?.lojaId || state.stores[0]?.LojaID || '';
  }

  const tasksView = $('#view-tasks');
  if (tasksView && tasksView.classList.contains('active')) {
    loadTasks();
  }
});

window.addEventListener('gestao-tasks-open', () => {
  if (!state.selectedStore && state.stores.length > 0) {
    state.selectedStore = state.user?.LojaID || state.user?.lojaId || state.stores[0]?.LojaID || '';
  }
  loadTasks();
});

export { loadTasks, renderTasksApp };
