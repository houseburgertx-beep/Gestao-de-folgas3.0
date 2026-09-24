// Módulo de Tarefas e Checklists tipo Trello / Kanban
// Grupo House 190 / House Burger — Interface Moderna e Prática

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

let state = {
  tasks: [],
  viewMode: 'checklist', // 'checklist' | 'kanban'
  selectedStore: '',
  selectedDate: dateKey(),
  selectedSector: 'todos',
  user: null,
  isManager: false,
  stores: [],
  employees: [],
  loading: false,
  checklistDraft: [],
  expandedCards: new Set(),
};

const SECTOR_GROUPS = [
  { id: 'todos', label: 'Todos' },
  { id: 'caixa', label: 'Caixa' },
  { id: 'abertura', label: 'Abertura' },
  { id: 'fechamento', label: 'Fechamento' },
  { id: 'cozinha', label: 'Cozinha' },
  { id: 'chapa', label: 'Chapa' },
  { id: 'salao', label: 'Salão' },
  { id: 'manutencao', label: 'Reparos' },
];

const COLUMNS = [
  { id: 'pendente', title: 'Pendente', dotColor: '#f59e0b' },
  { id: 'andamento', title: 'Em Andamento', dotColor: '#3b82f6' },
  { id: 'visto', title: 'Aguardando Visto', dotColor: '#8b5cf6' },
  { id: 'concluido', title: 'Concluído', dotColor: '#10b981' },
];

function getApi() {
  return window.__GESTAO_FIREBASE__?.api;
}

function isUserAdminOrManager() {
  if (state.isManager) return true;
  const profile = window.__GESTAO_FIREBASE__?.runtime?.getProfile?.() || state.user;
  if (!profile) return true;
  const role = String(profile.Perfil || profile.perfil || profile.Cargo || '').toLowerCase();
  return role.includes('admin') || role.includes('gerente') || role.includes('respons');
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
    if (res?.message) {
      alert(res.message);
    }
    await loadTasks();
  } catch (err) {
    alert(err.message || 'Falha ao gerar rotina.');
  } finally {
    state.loading = false;
    renderTasksApp();
  }
}

async function deduplicateTasks() {
  if (!confirm('Deseja organizar o quadro e remover tarefas idênticas duplicadas?')) return;
  const api = getApi();
  if (!api) return;

  state.loading = true;
  renderTasksApp();

  try {
    const res = await api.invoke('tasksDeduplicate', [state.selectedStore, state.selectedDate]);
    if (res?.message) alert(res.message);
    await loadTasks();
  } catch (err) {
    alert(err.message || 'Falha ao organizar tarefas.');
  } finally {
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

function openNewTaskDialog(defaultSector = 'Caixa') {
  populateEmployeeSelect();
  const idInput = $('#taskIdInput');
  if (idInput) idInput.value = '';
  const heading = $('#taskDialogHeading');
  if (heading) heading.textContent = 'Nova Tarefa / Checklist';

  if ($('#taskTitleInput')) $('#taskTitleInput').value = '';
  if ($('#taskSectorInput')) $('#taskSectorInput').value = defaultSector || (state.selectedSector === 'caixa' ? 'Caixa' : 'Geral');
  if ($('#taskPriorityInput')) $('#taskPriorityInput').value = 'Media';
  if ($('#taskEmployeeInput')) $('#taskEmployeeInput').value = '';
  if ($('#taskDeadlineInput')) $('#taskDeadlineInput').value = '';
  if ($('#taskDescInput')) $('#taskDescInput').value = '';
  if ($('#taskManagerSignInput')) $('#taskManagerSignInput').checked = false;

  state.checklistDraft = [];
  renderDraftChecklist();
  openDialog('taskDialog');
}

function openEditTaskDialog(taskId) {
  const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
  if (!task) return;
  populateEmployeeSelect();

  const idInput = $('#taskIdInput');
  if (idInput) idInput.value = task.TarefaID;
  const heading = $('#taskDialogHeading');
  if (heading) heading.textContent = 'Editar Tarefa / Checklist';

  if ($('#taskTitleInput')) $('#taskTitleInput').value = task.Titulo || '';
  if ($('#taskSectorInput')) $('#taskSectorInput').value = task.Setor || 'Caixa';
  if ($('#taskPriorityInput')) $('#taskPriorityInput').value = task.Prioridade || 'Media';
  if ($('#taskEmployeeInput')) $('#taskEmployeeInput').value = task.FuncionarioID || '';
  if ($('#taskDeadlineInput')) $('#taskDeadlineInput').value = task.HoraLimite || '';
  if ($('#taskDescInput')) $('#taskDescInput').value = task.Descricao || '';
  if ($('#taskManagerSignInput')) $('#taskManagerSignInput').checked = Boolean(task.ExigeVistoGerente);

  state.checklistDraft = Array.isArray(task.Checklist)
    ? task.Checklist.map(c => ({ id: c.id || (Date.now() + Math.random()), texto: c.texto || '', concluido: Boolean(c.concluido) }))
    : [];
  renderDraftChecklist();
  openDialog('taskDialog');
}

function getFilteredTasks() {
  return state.tasks.filter(t => {
    if (state.selectedSector === 'todos') return true;
    if (state.selectedSector === 'caixa') return t.Setor === 'Caixa' || t.Tipo === 'rotina_caixa';
    if (state.selectedSector === 'abertura') return t.Tipo === 'rotina_abertura';
    if (state.selectedSector === 'fechamento') return t.Tipo === 'rotina_fechamento';
    if (state.selectedSector === 'manutencao') return t.Tipo === 'manutencao';
    if (state.selectedSector === 'cozinha') return t.Setor === 'Cozinha';
    if (state.selectedSector === 'chapa') return t.Setor === 'Chapa';
    if (state.selectedSector === 'salao') return t.Setor === 'Salão';
    return true;
  });
}

function getSectorTheme(sector, type) {
  if (type === 'manutencao') return { bg: '#fef2f2', text: '#b91c1c', border: '#fca5a5' };
  if (type === 'rotina_abertura') return { bg: '#fffbeb', text: '#b45309', border: '#fde68a' };
  if (type === 'rotina_fechamento') return { bg: '#faf5ff', text: '#7e22ce', border: '#e9d5ff' };
  if (type === 'rotina_caixa' || sector === 'Caixa') return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' };
  if (sector === 'Chapa') return { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' };
  if (sector === 'Cozinha') return { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' };
  if (sector === 'Salão') return { bg: '#fdf4ff', text: '#a21caf', border: '#f5d0fe' };
  if (sector === 'Delivery') return { bg: '#fefce8', text: '#a16207', border: '#fef08a' };
  return { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
}

function renderTasksApp() {
  const container = $('#tasksApp');
  if (!container) return;

  const currentStore = state.stores.find(s => String(s.LojaID || s.lojaId) === String(state.selectedStore));
  const storeName = currentStore?.Nome || currentStore?.NomeLoja || 'Unidade Principal';

  const allDayTasks = state.tasks;
  const totalTasks = allDayTasks.length;
  const completedTasks = allDayTasks.filter(t => t.Coluna === 'concluido').length;
  const maintenanceTasks = allDayTasks.filter(t => t.Tipo === 'manutencao' && t.Coluna !== 'concluido').length;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const isManager = isUserAdminOrManager();

  const filtered = getFilteredTasks();

  container.innerHTML = `
    <div class="tasks-page">
      <!-- Hub Operacional Unificado -->
      <header class="tasks-hub">
        <div class="tasks-hub-top">
          <div class="tasks-hub-identity">
            <span class="tasks-brand-tag">OPERAÇÃO DE TURNO · HOUSE BURGER</span>
            <div class="tasks-title-wrap">
              <h2 class="tasks-hub-title">Quadro do Turno &amp; Rotinas</h2>

              <!-- Seletores de Loja e Data Integrados -->
              <div class="tasks-context-bar">
                ${state.stores.length > 1 ? `
                  <div class="tasks-select-box">
                    <select id="tasksStoreSelect">
                      ${state.stores.map(s => {
                        const id = String(s.LojaID || s.lojaId || '');
                        const name = s.NomeLoja || s.Nome || id;
                        return `<option value="${esc(id)}" ${id === state.selectedStore ? 'selected' : ''}>${esc(name)}</option>`;
                      }).join('')}
                    </select>
                  </div>
                ` : `
                  <div class="tasks-select-box">
                    <strong>${esc(storeName)}</strong>
                  </div>
                `}

                <div class="tasks-select-box">
                  <input type="date" id="tasksDateInput" value="${esc(state.selectedDate)}">
                </div>
              </div>
            </div>
          </div>

          <div class="tasks-hub-actions">
            <button class="btn btn-routine" id="openRoutineBtn" title="Disparar rotinas operacionais padrão (Caixa, Abertura ou Fechamento)">
              Rotinas do Turno
            </button>
            <button class="btn btn-new-task" id="openNewTaskBtn">
              + Nova Tarefa
            </button>
            <button class="btn btn-repair ${maintenanceTasks > 0 ? 'alert' : ''}" id="openMaintenanceBtn">
              Reparos ${maintenanceTasks > 0 ? `<span class="badge-red-mini">${maintenanceTasks}</span>` : ''}
            </button>
            ${isManager && totalTasks > 0 ? `
              <button class="btn btn-icon-tool" id="tasksDeduplicateBtn" title="Remover tarefas duplicadas">
                Organizar
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Linha Inferior do Hub: Filtros de Setor + Métricas + Modo -->
        <div class="tasks-hub-bottom">
          <div class="tasks-sectors-track">
            ${SECTOR_GROUPS.map(grp => {
              const count = allDayTasks.filter(t => {
                if (grp.id === 'todos') return true;
                if (grp.id === 'caixa') return t.Setor === 'Caixa' || t.Tipo === 'rotina_caixa';
                if (grp.id === 'abertura') return t.Tipo === 'rotina_abertura';
                if (grp.id === 'fechamento') return t.Tipo === 'rotina_fechamento';
                if (grp.id === 'manutencao') return t.Tipo === 'manutencao';
                if (grp.id === 'cozinha') return t.Setor === 'Cozinha';
                if (grp.id === 'chapa') return t.Setor === 'Chapa';
                if (grp.id === 'salao') return t.Setor === 'Salão';
                return true;
              }).length;

              return `
                <button class="sector-chip ${state.selectedSector === grp.id ? 'active' : ''}" data-sector-filter="${grp.id}">
                  <span>${grp.label}</span>
                  <span class="chip-count">${count}</span>
                </button>
              `;
            }).join('')}
          </div>

          <div class="tasks-hub-status-wrap">
            <div class="tasks-stats-chip">
              <span class="stats-dot ${progressPercent === 100 ? 'done' : ''}"></span>
              <span><strong>${completedTasks}/${totalTasks}</strong> concluídas (${progressPercent}%)</span>
            </div>

            <div class="segmented-deck" aria-label="Visualização">
              <button class="seg-btn ${state.viewMode === 'checklist' ? 'active' : ''}" data-view-mode="checklist">
                Checklist do Turno
              </button>
              <button class="seg-btn ${state.viewMode === 'kanban' ? 'active' : ''}" data-view-mode="kanban">
                Quadro Kanban
              </button>
            </div>
          </div>
        </div>
      </header>

      <!-- Conteúdo Principal -->
      ${state.loading ? `
        <div class="tasks-loading-state">
          <div class="spinner"></div>
          <p>Sincronizando tarefas da loja...</p>
        </div>
      ` : totalTasks === 0 ? `
        <!-- Empty State Inicial -->
        <div class="tasks-empty-starter">
          <h3>Nenhuma rotina gerada para hoje ainda.</h3>
          <p>Carregue os checklists padrão do turno em um clique ou adicione uma tarefa manual:</p>

          <div class="starter-actions starter-actions-3">
            <button class="starter-card-btn caixa" data-trigger-routine="caixa">
              <span class="starter-tag">CAIXA</span>
              <div>
                <strong>Rotina Operacional do Caixa</strong>
                <small>Abertura do PDV, conferência de sistemas, notas, Drive, grupo VIP e WhatsApp.</small>
              </div>
            </button>

            <button class="starter-card-btn abertura" data-trigger-routine="abertura">
              <span class="starter-tag">ABERTURA</span>
              <div>
                <strong>Abertura de Turno</strong>
                <small>Freezers, estoque crítico, chapa, fritadeira e gaveta de caixa.</small>
              </div>
            </button>

            <button class="starter-card-btn fechamento" data-trigger-routine="fechamento">
              <span class="starter-tag">FECHAMENTO</span>
              <div>
                <strong>Fechamento de Turno</strong>
                <small>Limpeza de coifa/chapa, gás, descarte de óleo, caixa e lixo.</small>
              </div>
            </button>
          </div>
        </div>
      ` : state.viewMode === 'checklist' ? renderDailyChecklist(filtered) : renderKanban(filtered)}
    </div>
  `;

  bindDomEvents();
}

function renderDailyChecklist(tasks) {
  if (tasks.length === 0) {
    return `
      <div class="tasks-empty-starter" style="margin-top: 14px;">
        <h3>Nenhum checklist encontrado para este filtro</h3>
        <p>Selecione outro setor acima ou adicione uma nova rotina para o turno de hoje.</p>
      </div>
    `;
  }

  const isManager = isUserAdminOrManager();

  return `
    <div class="daily-checklist-container">
      ${tasks.map((task, idx) => {
        const checklist = Array.isArray(task.Checklist) ? task.Checklist : [];
        const chTotal = checklist.length;
        const chDone = checklist.filter(c => c.concluido).length;
        const chPercent = chTotal > 0 ? Math.round((chDone / chTotal) * 100) : (task.Coluna === 'concluido' ? 100 : 0);
        const isAllDone = (chTotal > 0 && chDone === chTotal) || (chTotal === 0 && task.Coluna === 'concluido');
        const theme = getSectorTheme(task.Setor, task.Tipo);

        const stepMatch = (task.Titulo || '').match(/^(\d+)\.\s*(.*)$/);
        const stepNum = stepMatch ? stepMatch[1] : (idx + 1);
        const stepTitle = stepMatch ? stepMatch[2] : task.Titulo;

        return `
          <article class="daily-section-card ${isAllDone ? 'all-complete' : ''}" data-task-id="${esc(task.TarefaID)}">
            <header class="daily-section-header">
              <div class="daily-section-title-wrap">
                <span class="daily-step-num">${esc(stepNum)}</span>
                <div style="min-width: 0;">
                  <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 2px;">
                    <span class="trello-tag" style="background:${theme.bg}; color:${theme.text}; border-color:${theme.border};">
                      ${esc(task.Setor || 'Geral')}
                    </span>
                    ${task.Prioridade === 'Urgente' ? `<span class="trello-tag-urgent">Urgente</span>` : task.Prioridade === 'Alta' ? `<span class="trello-tag-high">Alta</span>` : ''}
                    ${task.HoraLimite ? `<span class="trello-tag-time">Limite: ${esc(task.HoraLimite)}</span>` : ''}
                  </div>
                  <h3 class="daily-section-title">${esc(stepTitle)}</h3>
                  ${task.Descricao ? `<p class="daily-section-desc">${esc(task.Descricao)}</p>` : ''}
                </div>
              </div>

              <div class="daily-section-meta-right">
                <span class="daily-progress-pill ${isAllDone ? 'done' : ''}">
                  ${chTotal > 0 ? `${chDone}/${chTotal} concluídos · ${chPercent}%` : (isAllDone ? 'Concluído' : 'Pendente')}
                </span>
                <button type="button" class="btn-ghost-sm" data-edit-task="${esc(task.TarefaID)}" title="Editar checklist">
                  Editar
                </button>
              </div>
            </header>

            <div class="daily-progress-track">
              <div class="daily-progress-bar ${isAllDone ? 'done' : ''}" style="width: ${chPercent}%;"></div>
            </div>

            ${chTotal > 0 ? `
              <div class="daily-checklist-items">
                ${checklist.map(item => `
                  <div class="daily-item-row ${item.concluido ? 'is-done' : ''}" data-toggle-subtask="${esc(item.id)}" data-task-id="${esc(task.TarefaID)}">
                    <input type="checkbox" class="daily-chk" ${item.concluido ? 'checked' : ''} tabindex="-1">
                    <span class="daily-item-label">${esc(item.texto)}</span>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div style="padding: 14px 18px;">
                <button type="button" class="btn ${isAllDone ? 'btn-secondary' : 'btn-primary'}" data-toggle-card-complete="${esc(task.TarefaID)}" style="font-size: 13px;">
                  ${isAllDone ? 'Reabrir Tarefa' : 'Marcar como Concluída'}
                </button>
              </div>
            `}

            <footer class="daily-section-footer">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span>Responsável: <strong>${esc(task.NomeFuncionario || 'Equipe da Praça')}</strong></span>
                ${task.VistoPor ? `
                  <span class="trello-visto-approved" style="margin-top:0;">Visto: ${esc(task.VistoPor)}</span>
                ` : task.ExigeVistoGerente ? `
                  <span style="font-size: 11px; color: #854d0e; background: #fef9c3; padding: 2px 7px; border-radius: 4px;">Exige visto</span>
                ` : ''}
              </div>

              <div class="daily-footer-actions">
                ${chTotal > 0 ? `
                  <button type="button" class="btn-ghost-sm" data-mark-section-all="${esc(task.TarefaID)}" data-action="${isAllDone ? 'uncheck' : 'check'}">
                    ${isAllDone ? 'Desmarcar todos' : 'Concluir todos da etapa'}
                  </button>
                ` : ''}
                ${isManager ? `
                  <button type="button" class="trello-btn-del" data-delete-task="${esc(task.TarefaID)}" title="Excluir rotina">✕</button>
                ` : ''}
              </div>
            </footer>
          </article>
        `;
      }).join('')}
    </div>
  `;
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
                <span class="col-status-dot" style="background: ${col.dotColor};"></span>
                <h4>${col.title}</h4>
              </div>
              <span class="trello-col-count">${colTasks.length}</span>
            </div>

            <div class="trello-cards-area" data-col-target="${col.id}">
              ${colTasks.length === 0 ? `
                <div class="trello-empty-column">
                  <p>Nenhuma tarefa nesta etapa</p>
                </div>
              ` : colTasks.map(t => renderCard(t)).join('')}
            </div>

            <button class="trello-add-card-btn" data-add-card-col="${col.id}">
              + Adicionar tarefa
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

  const cleanTitle = (task.Titulo || '')
    .replace(/^(\d+\.\s*)?(Abertura|Fechamento|Caixa)\s*(Turno|Rotina)?:\s*/i, '$1')
    .trim();

  const isManager = isUserAdminOrManager();

  const categoryLabel = task.Tipo === 'rotina_caixa' ? 'Caixa'
    : task.Tipo === 'rotina_abertura' ? 'Abertura'
    : task.Tipo === 'rotina_fechamento' ? 'Fechamento'
    : task.Tipo === 'manutencao' ? 'Manutenção'
    : (task.Setor || 'Geral');

  return `
    <div class="trello-card" draggable="true" data-task-id="${esc(task.TarefaID)}" data-card-detail="${esc(task.TarefaID)}">
      <!-- Topo: Tags de Categoria e Prioridade -->
      <div class="trello-card-tags">
        <span class="trello-tag" style="background:${theme.bg}; color:${theme.text}; border-color:${theme.border};">
          ${esc(categoryLabel)}
        </span>
        ${task.Prioridade === 'Urgente' ? `<span class="trello-tag-urgent">Urgente</span>` : task.Prioridade === 'Alta' ? `<span class="trello-tag-high">Alta</span>` : ''}
        ${task.HoraLimite ? `<span class="trello-tag-time">${esc(task.HoraLimite)}</span>` : ''}
      </div>

      <!-- Título e Descrição Concisa -->
      <h4 class="trello-card-title">${esc(cleanTitle)}</h4>
      ${task.Descricao ? `<p class="trello-card-desc">${esc(task.Descricao)}</p>` : ''}

      <!-- Indicador Compacto de Checklist -->
      ${chTotal > 0 ? `
        <div class="trello-card-ch-pill ${chDone === chTotal ? 'all-done' : ''}">
          <span class="trello-card-ch-text">${chDone}/${chTotal} itens</span>
          <div class="trello-card-ch-track">
            <div class="trello-card-ch-bar ${chDone === chTotal ? 'is-complete' : ''}" style="width: ${chPercent}%;"></div>
          </div>
        </div>
      ` : ''}

      <!-- Rodapé do Cartão -->
      <div class="trello-card-foot" onclick="event.stopPropagation();">
        <div class="trello-assignee" title="${task.NomeFuncionario || 'Equipe da Praça'}">
          ${task.NomeFuncionario ? `
            <span class="trello-avatar">${esc(task.NomeFuncionario.split(' ').map(n=>n[0]).slice(0,2).join(''))}</span>
            <span class="trello-assignee-name">${esc(task.NomeFuncionario)}</span>
          ` : `
            <span class="trello-avatar unassigned">EQ</span>
            <span class="trello-unassigned">Equipe</span>
          `}
        </div>

        <div class="trello-card-actions">
          <button type="button" class="trello-btn-edit" data-edit-task="${esc(task.TarefaID)}" title="Editar tarefa e checklist">Editar</button>
          ${task.Coluna === 'visto' && isManager ? `
            <button type="button" class="trello-btn-approve" data-approve-task="${esc(task.TarefaID)}">
              Visto
            </button>
          ` : ''}
          <button type="button" class="trello-btn-step" data-step-dir="prev" data-task-id="${esc(task.TarefaID)}" title="Voltar etapa">‹</button>
          <button type="button" class="trello-btn-step" data-step-dir="next" data-task-id="${esc(task.TarefaID)}" title="Avançar etapa">›</button>
        </div>
      </div>

      ${task.VistoPor ? `
        <div class="trello-visto-approved">
          Visto: <strong>${esc(task.VistoPor)}</strong>
        </div>
      ` : ''}
    </div>
  `;
}

async function markAllSectionItems(taskId, markDone) {
  const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
  if (!task || !Array.isArray(task.Checklist)) return;

  const api = getApi();
  if (!api) return;

  task.Checklist.forEach(i => { i.concluido = markDone; });
  if (markDone) {
    task.Coluna = task.ExigeVistoGerente ? 'visto' : 'concluido';
  } else {
    task.Coluna = 'pendente';
  }
  renderTasksApp();

  try {
    await api.invoke('tasksSave', [{
      TarefaID: task.TarefaID,
      LojaID: task.LojaID || state.selectedStore,
      DataTurno: task.DataTurno || state.selectedDate,
      Titulo: task.Titulo,
      Coluna: task.Coluna,
      Checklist: task.Checklist,
    }]);
    await loadTasks();
  } catch (err) {
    console.error('Falha ao atualizar itens da seção:', err);
    await loadTasks();
  }
}

function openTaskDetailDialog(taskId) {
  const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
  if (!task) return;

  const dlg = document.getElementById('taskDetailDialog');
  if (!dlg) return;

  const eyebrow = $('#taskDetailEyebrow');
  if (eyebrow) eyebrow.textContent = task.Tipo === 'manutencao' ? 'MANUTENÇÃO & REPARO' : 'DETALHES DA TAREFA';
  const title = $('#taskDetailTitle');
  if (title) title.textContent = task.Titulo || 'Tarefa';

  const theme = getSectorTheme(task.Setor, task.Tipo);
  const sectorBadge = $('#taskDetailSectorBadge');
  if (sectorBadge) {
    sectorBadge.textContent = task.Setor || 'Geral';
    sectorBadge.style.background = theme.bg;
    sectorBadge.style.color = theme.text;
    sectorBadge.style.borderColor = theme.border;
  }

  const priorityBadge = $('#taskDetailPriorityBadge');
  if (priorityBadge) {
    priorityBadge.textContent = task.Prioridade || 'Média';
    priorityBadge.className = `badge ${task.Prioridade === 'Urgente' ? 'trello-tag-urgent' : task.Prioridade === 'Alta' ? 'trello-tag-high' : ''}`;
  }

  const colBadge = $('#taskDetailColumnBadge');
  if (colBadge) {
    const colName = task.Coluna === 'concluido' ? 'Concluído' : task.Coluna === 'visto' ? 'Aguardando Visto' : task.Coluna === 'andamento' ? 'Em Andamento' : 'Pendente';
    colBadge.textContent = colName;
    colBadge.className = `op-badge ${task.Coluna || 'pendente'}`;
  }

  const timeBadge = $('#taskDetailDeadlineBadge');
  if (timeBadge) {
    timeBadge.textContent = task.HoraLimite ? `Limite: ${task.HoraLimite}` : '';
  }

  const descWrap = $('#taskDetailDescWrap');
  const descEl = $('#taskDetailDesc');
  if (task.Descricao && descWrap && descEl) {
    descWrap.style.display = 'block';
    descEl.textContent = task.Descricao;
  } else if (descWrap) {
    descWrap.style.display = 'none';
  }

  const chList = Array.isArray(task.Checklist) ? task.Checklist : [];
  const chDone = chList.filter(c => c.concluido).length;
  const chPercent = chList.length > 0 ? Math.round((chDone / chList.length) * 100) : 0;

  const progressText = $('#taskDetailChecklistProgress');
  if (progressText) progressText.textContent = `${chDone}/${chList.length} (${chPercent}%)`;
  const progressBar = $('#taskDetailProgressBar');
  if (progressBar) progressBar.style.width = `${chPercent}%`;

  const container = $('#taskDetailChecklistContainer');
  if (container) {
    if (chList.length === 0) {
      container.innerHTML = '<div style="font-size:12.5px;color:#94a3b8;font-style:italic;padding:8px 0;">Nenhum subitem de checklist cadastrado.</div>';
    } else {
      container.innerHTML = chList.map(item => `
        <div class="task-detail-item ${item.concluido ? 'done' : ''}" data-toggle-subtask="${esc(item.id)}" data-task-id="${esc(task.TarefaID)}">
          <input type="checkbox" class="daily-chk" ${item.concluido ? 'checked' : ''} tabindex="-1">
          <span>${esc(item.texto)}</span>
        </div>
      `).join('');
    }
  }

  const vistoSection = $('#taskDetailVistoSection');
  const vistoInfo = $('#taskDetailVistoInfo');
  if (task.VistoPor && vistoSection && vistoInfo) {
    vistoSection.style.display = 'block';
    vistoInfo.textContent = `Validado por ${task.VistoPor} em ${task.DataVisto ? new Date(task.DataVisto).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : 'Turno atual'}`;
  } else if (vistoSection) {
    vistoSection.style.display = 'none';
  }

  const assignee = $('#taskDetailAssignee');
  if (assignee) assignee.textContent = task.NomeFuncionario || 'Equipe da Praça (Geral)';
  const currentStore = state.stores.find(s => String(s.LojaID || s.lojaId) === String(task.LojaID));
  const storeDate = $('#taskDetailStoreDate');
  if (storeDate) storeDate.textContent = `${currentStore?.Nome || currentStore?.NomeLoja || 'Loja'} · ${task.DataTurno ? task.DataTurno.split('-').reverse().join('/') : ''}`;

  const editBtn = $('#taskDetailEditBtn');
  if (editBtn) {
    editBtn.onclick = () => {
      closeDialog('taskDetailDialog');
      openEditTaskDialog(task.TarefaID);
    };
  }

  const delBtn = $('#taskDetailDeleteBtn');
  if (delBtn) {
    delBtn.onclick = () => {
      closeDialog('taskDetailDialog');
      deleteTask(task.TarefaID);
    };
  }

  const moveBtn = $('#taskDetailMoveBtn');
  if (moveBtn) {
    const colSeq = ['pendente', 'andamento', 'visto', 'concluido'];
    const curIdx = colSeq.indexOf(task.Coluna || 'pendente');
    const nextCol = colSeq[(curIdx + 1) % colSeq.length];
    const nextLabel = nextCol === 'andamento' ? 'Mover p/ Em Andamento' : nextCol === 'visto' ? 'Mover p/ Visto' : nextCol === 'concluido' ? 'Mover p/ Concluído' : 'Mover p/ Pendente';
    moveBtn.textContent = nextLabel;
    moveBtn.onclick = async () => {
      await moveTaskColumn(task.TarefaID, nextCol);
      openTaskDetailDialog(task.TarefaID);
    };
  }

  const approveBtn = $('#taskDetailApproveBtn');
  if (approveBtn) {
    if (task.Coluna === 'visto' && isUserAdminOrManager()) {
      approveBtn.style.display = 'inline-block';
      approveBtn.onclick = async () => {
        closeDialog('taskDetailDialog');
        const notes = prompt('Anotação de validação (opcional):') || '';
        await approveTask(task.TarefaID, notes);
      };
    } else {
      approveBtn.style.display = 'none';
    }
  }

  openDialog('taskDetailDialog');
}

function bindDomEvents() {
  const container = $('#tasksApp');
  if (!container) return;

  // Botões do Topo
  $('#openNewTaskBtn', container)?.addEventListener('click', () => {
    openNewTaskDialog(state.selectedSector === 'caixa' ? 'Caixa' : 'Geral');
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
  if (!state.checklistDraft || state.checklistDraft.length === 0) {
    box.innerHTML = '<div style="font-size:12px;color:#94a3b8;font-style:italic;padding:6px 0;">Nenhum item adicionado ainda. Digite acima e clique em Adicionar ou tecle Enter.</div>';
    return;
  }
  box.innerHTML = state.checklistDraft.map((item, idx) => `
    <div class="draft-row">
      <input type="text" class="draft-item-input" data-draft-idx="${idx}" value="${esc(item.texto)}" placeholder="Descrição do item..." />
      <button type="button" class="btn-del-draft" data-del-draft="${idx}" title="Remover item">✕</button>
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

  // Disparar rotina (Caixa / Abertura / Fechamento)
  const routineTrigger = e.target.closest('[data-trigger-routine]');
  if (routineTrigger) {
    const routine = routineTrigger.dataset.triggerRoutine;
    if (routine) generateRoutine(routine);
    return;
  }

  // Editar tarefa e checklist
  const editBtn = e.target.closest('[data-edit-task]');
  if (editBtn) {
    openEditTaskDialog(editBtn.dataset.editTask);
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
    openNewTaskDialog(state.selectedSector === 'caixa' ? 'Caixa' : 'Geral');
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

  // Toggle de item do checklist (clique na linha inteira ou no texto)
  const subtaskRow = e.target.closest('[data-toggle-subtask]');
  if (subtaskRow) {
    const itemId = subtaskRow.dataset.toggleSubtask;
    const taskId = subtaskRow.dataset.taskId;
    const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
    if (task && Array.isArray(task.Checklist)) {
      const item = task.Checklist.find(i => String(i.id) === String(itemId));
      if (item) {
        const isInput = e.target.tagName === 'INPUT';
        const newChecked = isInput ? e.target.checked : !item.concluido;
        toggleChecklistItem(taskId, itemId, newChecked);
      }
    }
    return;
  }

  // Ação de marcar todos ou desmarcar todos de uma etapa
  const markSection = e.target.closest('[data-mark-section-all]');
  if (markSection) {
    const taskId = markSection.dataset.markSectionAll;
    const action = markSection.dataset.action;
    markAllSectionItems(taskId, action === 'check');
    return;
  }

  // Abrir modal de detalhes ao clicar no cartão Kanban
  const cardDetail = e.target.closest('[data-card-detail]');
  if (cardDetail && !e.target.closest('.trello-card-actions') && !e.target.closest('button')) {
    openTaskDetailDialog(cardDetail.dataset.cardDetail);
    return;
  }

  // Expandir / recolher subitens do checklist no cartão
  const expandBtn = e.target.closest('[data-toggle-expand-card]');
  if (expandBtn) {
    const taskId = expandBtn.dataset.toggleExpandCard;
    if (state.expandedCards.has(taskId)) {
      state.expandedCards.delete(taskId);
    } else {
      state.expandedCards.add(taskId);
    }
    renderTasksApp();
    return;
  }

  // Deduplicar e organizar quadro
  if (e.target.id === 'tasksDeduplicateBtn' || e.target.closest('#tasksDeduplicateBtn')) {
    deduplicateTasks();
    return;
  }
});

// Atualizar texto do checklist draft inline
document.addEventListener('input', (e) => {
  if (e.target.matches('.draft-item-input')) {
    const idx = Number(e.target.dataset.draftIdx);
    if (!isNaN(idx) && state.checklistDraft[idx]) {
      state.checklistDraft[idx].texto = e.target.value;
    }
  }
});

// Adicionar subitem de checklist ao teclar Enter no input
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'taskChecklistNewInput' && e.key === 'Enter') {
    e.preventDefault();
    const text = (e.target.value || '').trim();
    if (text) {
      state.checklistDraft.push({ id: Date.now(), texto: text, concluido: false });
      e.target.value = '';
      renderDraftChecklist();
    }
  }
});


// Envio do Form de Nova ou Edição de Tarefa
document.addEventListener('DOMContentLoaded', () => {
  const taskForm = document.getElementById('taskForm');
  if (taskForm) {
    taskForm.onsubmit = async (e) => {
      e.preventDefault();
      const title = $('#taskTitleInput')?.value?.trim();
      if (!title) return;

      const funcId = $('#taskEmployeeInput')?.value || '';
      const employee = state.employees.find(emp => String(emp.FuncionarioID) === String(funcId));
      const taskId = $('#taskIdInput')?.value?.trim();

      const payload = {
        TarefaID: taskId || undefined,
        Titulo: title,
        Setor: $('#taskSectorInput')?.value || 'Caixa',
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
        const idInput = $('#taskIdInput');
        if (idInput) idInput.value = '';
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
        alert(err.message || 'Falha ao abrir chamado de manutenção.');
      }
    };
  }
});

// Auto-sincronização com o estado global da aplicação
function ensureTasksInitialized(customCtx = {}) {
  const runtime = window.__GESTAO_FIREBASE__?.runtime;
  const currentProfile = runtime?.getProfile?.() || customCtx.user || state.user || window.state?.user;
  const stores = (customCtx.stores && customCtx.stores.length > 0) ? customCtx.stores : (window.state?.stores || state.stores);
  const employees = (customCtx.employees && customCtx.employees.length > 0) ? customCtx.employees : (window.state?.employees || state.employees);

  state.user = currentProfile || null;
  state.isManager = isUserAdminOrManager();
  state.stores = Array.isArray(stores) ? stores : [];
  state.employees = Array.isArray(employees) ? employees : [];

  if (!state.selectedStore && state.stores.length > 0) {
    const userStore = state.user?.LojaID || state.user?.lojaId;
    const match = state.stores.find(s => String(s.LojaID || s.lojaId) === String(userStore));
    state.selectedStore = match ? String(match.LojaID || match.lojaId) : String(state.stores[0].LojaID || state.stores[0].lojaId);
  }

  renderTasksApp();
  loadTasks();
}

// Inicializador da Aba
export function initTasksModule(ctx = {}) {
  ensureTasksInitialized(ctx);
}

// Export global para compatibilidade com SPA e roteador
if (typeof window !== 'undefined') {
  window.initTasksModule = initTasksModule;

  // Ouvir abertura da aba
  window.addEventListener('gestao-tasks-open', (e) => {
    ensureTasksInitialized(e.detail || {});
  });

  // Ouvir dados globais da jornada
  window.addEventListener('house-journey', (e) => {
    const detail = e.detail || {};
    if (detail.user) state.user = detail.user;
    if (Array.isArray(detail.stores) && detail.stores.length > 0) state.stores = detail.stores;
    if (Array.isArray(detail.employees) && detail.employees.length > 0) state.employees = detail.employees;
    state.isManager = isUserAdminOrManager();

    if (!state.selectedStore && state.stores.length > 0) {
      const userStore = state.user?.LojaID || state.user?.lojaId;
      const match = state.stores.find(s => String(s.LojaID || s.lojaId) === String(userStore));
      state.selectedStore = match ? String(match.LojaID || match.lojaId) : String(state.stores[0].LojaID || state.stores[0].lojaId);
    }

    const container = $('#tasksApp');
    if (container && (!container.innerHTML.trim() || $('#view-tasks')?.classList.contains('active'))) {
      renderTasksApp();
      loadTasks();
    }
  });

  // Ouvir prontidão da API e DOM
  window.addEventListener('gestao-api-ready', () => {
    const container = $('#tasksApp');
    if (container && !container.innerHTML.trim()) {
      ensureTasksInitialized();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const container = $('#tasksApp');
      if (container && !container.innerHTML.trim()) {
        ensureTasksInitialized();
      }
    });
  } else {
    setTimeout(() => {
      const container = $('#tasksApp');
      if (container && !container.innerHTML.trim()) {
        ensureTasksInitialized();
      }
    }, 100);
  }
}
