// Módulo de Tarefas e Checklists tipo Trello / Kanban
// Grupo House 190 / House Burger — Interface Mobile-First Premium & Minimalista (Sem Emojis)

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// Ícones SVG Vetoriais Profissionais (Zero Emojis — Padrão Linear / Things 3)
const ICONS = {
  check: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  zap: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  tool: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  clean: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  list: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  user: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  kanban: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="11" rx="1"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`,
  chevronUp: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  arrowRight: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  terminal: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h12M6 12h4m4 0h4M6 16h12"/></svg>`,
  flame: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
};

let state = {
  tasks: [],
  viewMode: 'checklist', // 'checklist' | 'my' | 'kanban'
  selectedStore: '',
  selectedDate: dateKey(),
  selectedSector: 'todos',
  kanbanActiveCol: 'pendente',
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
  { id: 'manutencao', label: 'Reparos' },
];

const COLUMNS = [
  { id: 'pendente', title: 'Pendente', shortTitle: 'Pendente', dotColor: '#f59e0b' },
  { id: 'andamento', title: 'Em Andamento', shortTitle: 'Andamento', dotColor: '#3b82f6' },
  { id: 'visto', title: 'Aguardando Visto', shortTitle: 'Visto', dotColor: '#8b5cf6' },
  { id: 'concluido', title: 'Concluído', shortTitle: 'Concluído', dotColor: '#10b981' },
];

function getApi() {
  return window.__GESTAO_FIREBASE__?.api;
}

function getEmployeeId(e) {
  if (!e) return '';
  return String(e.FuncionarioID || e.funcionarioId || e.id || e.UsuarioID || e.usuarioId || '').trim();
}

function getEmployeeName(e) {
  if (!e) return '';
  return String(e.Nome || e.nome || e.NomeFuncionario || '').trim();
}

function isTaskAssignedToCurrentUser(task) {
  if (!task) return false;
  const user = state.user;
  if (!user) return false;

  const userIds = [
    user.FuncionarioID,
    user.funcionarioId,
    user.id,
    user.UsuarioID,
    user.usuarioId,
  ].filter(Boolean).map(x => String(x).trim().toLowerCase());

  const userNames = [
    user.Nome,
    user.nome,
  ].filter(Boolean).map(x => String(x).trim().toLowerCase());

  const taskFuncId = String(task.FuncionarioID || '').trim().toLowerCase();
  const taskFuncName = String(task.NomeFuncionario || '').trim().toLowerCase();

  // 1. Match por ID
  if (taskFuncId && userIds.includes(taskFuncId)) return true;

  // 2. Match por nome completo ou primeiro nome
  if (taskFuncName && userNames.some(name => {
    if (taskFuncName === name) return true;
    const taskFirst = taskFuncName.split(' ')[0];
    const userFirst = name.split(' ')[0];
    return taskFirst.length >= 3 && taskFirst === userFirst;
  })) {
    return true;
  }

  // 3. Se o campo FuncionarioID na tarefa for o próprio nome do funcionário
  if (taskFuncId && userNames.some(name => taskFuncId === name || (name.split(' ')[0].length >= 3 && taskFuncId === name.split(' ')[0]))) {
    return true;
  }

  return false;
}

function isUserAdminOrManager() {
  if (typeof state.isManager === 'boolean' && state.user) return state.isManager;
  if (typeof window.__GESTAO_IS_MANAGER__ === 'boolean') return window.__GESTAO_IS_MANAGER__;
  const profile = state.user || window.__GESTAO_USER__ || window.__GESTAO_FIREBASE__?.runtime?.profile;
  if (!profile) return false;
  const p = String(profile.Perfil || profile.perfil || profile.Cargo || profile.cargo || profile.profile || '').toLowerCase();
  return p.includes('admin') || p.includes('gerente') || p.includes('respons');
}

function openDialog(id) {
  const d = document.getElementById(id);
  if (d && !d.open) d.showModal();
}

function closeDialog(id) {
  const d = document.getElementById(id);
  if (d?.open) d.close();
}

function triggerHaptic(type = 'light') {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      if (type === 'success') navigator.vibrate([15, 30, 20]);
      else navigator.vibrate(10);
    }
  } catch (_) {}
}

function getTaskStatus(task) {
  const checklist = Array.isArray(task.Checklist) ? task.Checklist : [];
  const chTotal = checklist.length;
  const chDone = checklist.filter(c => c.concluido).length;

  if (task.Coluna === 'concluido' || (chTotal > 0 && chDone === chTotal)) {
    return { id: 'concluido', label: 'Concluído', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' };
  }

  if (task.HoraLimite) {
    const parts = task.HoraLimite.split(':');
    if (parts.length === 2) {
      const limitMinutes = Number(parts[0]) * 60 + Number(parts[1]);
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (nowMinutes > limitMinutes) {
        return { id: 'atrasado', label: 'Atrasado', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' };
      }
    }
  }

  if (chDone > 0 || task.Coluna === 'andamento') {
    return { id: 'andamento', label: 'Em andamento', color: '#d97706', bg: '#fffbeb', border: '#fde68a' };
  }

  return { id: 'pendente', label: 'Não iniciado', color: '#64748b', bg: '#f1f5f9', border: '#e2e8f0' };
}

function getSectorConfig(sector, type) {
  if (type === 'manutencao') {
    return { name: 'Reparos', icon: ICONS.tool, color: '#dc2626', bg: '#fef2f2', border: '#fecaca' };
  }
  if (type === 'rotina_abertura') {
    return { name: 'Abertura', icon: ICONS.sun, color: '#b45309', bg: '#fffbeb', border: '#fde68a' };
  }
  if (type === 'rotina_fechamento') {
    return { name: 'Fechamento', icon: ICONS.moon, color: '#7e22ce', bg: '#faf5ff', border: '#e9d5ff' };
  }
  if (type === 'rotina_caixa' || sector === 'Caixa') {
    return { name: 'Caixa', icon: ICONS.terminal, color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' };
  }
  if (sector === 'Cozinha' || sector === 'Chapa') {
    return { name: sector || 'Cozinha', icon: ICONS.flame, color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' };
  }
  return { name: sector || 'Geral', icon: ICONS.list, color: '#334155', bg: '#f8fafc', border: '#e2e8f0' };
}

function updateCardProgressDom(taskId) {
  const card = $(`[data-task-id="${taskId}"]`);
  if (!card) return;
  const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
  if (!task) return;

  const checklist = Array.isArray(task.Checklist) ? task.Checklist : [];
  const chTotal = checklist.length;
  const chDone = checklist.filter(c => c.concluido).length;
  const chPercent = chTotal > 0 ? Math.round((chDone / chTotal) * 100) : (task.Coluna === 'concluido' ? 100 : 0);
  const isAllDone = (chTotal > 0 && chDone === chTotal) || (chTotal === 0 && task.Coluna === 'concluido');
  const statusCfg = getTaskStatus(task);

  card.classList.toggle('is-complete', isAllDone);

  const statusPill = card.querySelector('.routine-status-pill');
  if (statusPill) {
    statusPill.className = `routine-status-pill ${statusCfg.id}`;
    statusPill.textContent = statusCfg.label;
  }

  const counter = card.querySelector('.routine-step-counter');
  if (counter) {
    counter.textContent = chTotal > 0 ? `${chDone} de ${chTotal} ${chTotal === 1 ? 'tarefa' : 'tarefas'}` : (isAllDone ? 'Tarefa concluída' : '1 tarefa direta');
  }

  const bar = card.querySelector('.routine-progress-fill');
  if (bar) {
    bar.classList.toggle('done', isAllDone);
    bar.style.width = `${chPercent}%`;
  }

  const markBtn = card.querySelector('[data-mark-section-all]');
  if (markBtn) {
    markBtn.dataset.action = isAllDone ? 'uncheck' : 'check';
    markBtn.textContent = isAllDone ? 'Desmarcar todos' : 'Concluir todos';
  }
}

function updateGlobalStatsDom() {
  const allTasks = state.tasks;
  const total = allTasks.length;
  const completed = allTasks.filter(t => t.Coluna === 'concluido' || (Array.isArray(t.Checklist) && t.Checklist.length > 0 && t.Checklist.every(c => c.concluido))).length;
  const pending = total - completed;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const countNum = $('.shift-count-number');
  if (countNum) {
    countNum.textContent = `${completed} de ${total}`;
  }
  const pctPill = $('.shift-hero-pct-pill');
  if (pctPill) {
    pctPill.textContent = `${pct}%`;
    pctPill.classList.toggle('done', pct === 100);
  }
  const fill = $('.shift-progress-bar');
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.classList.toggle('done', pct === 100);
  }
  const badge = $('.shift-hero-badge');
  if (badge) {
    badge.className = `shift-hero-badge ${pct === 100 ? 'done' : 'active'}`;
    badge.textContent = pct === 100 ? 'Turno Finalizado' : `${pending} ${pending === 1 ? 'rotina pendente' : 'rotinas pendentes'}`;
  }
}

let isInitialTasksLoaded = false;
let userManuallyToggledView = false;

async function loadTasks(silent = false) {
  const api = getApi();
  if (!api) return;
  if (!silent) {
    state.loading = true;
    renderTasksApp();
  }

  try {
    const res = await api.invoke('tasksList', [state.selectedStore, state.selectedDate]);
    if (res?.success) {
      state.tasks = Array.isArray(res.data) ? res.data : [];

      if (!state.isManager && !userManuallyToggledView && !isInitialTasksLoaded) {
        const hasMyTasks = state.tasks.some(isTaskAssignedToCurrentUser);
        if (hasMyTasks) {
          state.viewMode = 'my';
        }
      }
      isInitialTasksLoaded = true;
    }
  } catch (err) {
    console.error('Erro ao carregar tarefas:', err);
  } finally {
    if (!silent) {
      state.loading = false;
    }
    renderTasksApp();
  }
}

async function moveTaskColumn(taskId, newColumn) {
  const api = getApi();
  if (!api) return;

  triggerHaptic('light');
  const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
  if (task) task.Coluna = newColumn;
  renderTasksApp();

  try {
    await api.invoke('tasksUpdateColumn', [taskId, newColumn]);
    await loadTasks(true);
  } catch (err) {
    console.error('Falha ao mover coluna:', err);
    await loadTasks();
  }
}

async function toggleChecklistItem(taskId, itemId, checked) {
  const api = getApi();
  if (!api) return;

  triggerHaptic('light');

  const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
  if (task && Array.isArray(task.Checklist)) {
    const item = task.Checklist.find(i => String(i.id) === String(itemId));
    if (item) item.concluido = checked;

    const allDone = task.Checklist.length > 0 && task.Checklist.every(i => i.concluido);
    if (allDone && task.Coluna === 'pendente') {
      task.Coluna = task.ExigeVistoGerente ? 'visto' : 'concluido';
      triggerHaptic('success');
    } else if (!allDone && task.Coluna === 'concluido') {
      task.Coluna = 'andamento';
    }
  }

  // Instant DOM update
  const row = document.querySelector(`[data-toggle-subtask="${itemId}"][data-task-id="${taskId}"]`);
  if (row) {
    row.classList.toggle('checked', checked);
    row.setAttribute('aria-checked', checked ? 'true' : 'false');
    const box = row.querySelector('.routine-item-checkbox');
    if (box) box.classList.toggle('checked', checked);
  }

  updateCardProgressDom(taskId);
  updateGlobalStatsDom();

  try {
    const res = await api.invoke('tasksToggleChecklistItem', [taskId, itemId, checked]);
    if (!res?.success) throw new Error(res?.message || 'Falha ao atualizar');
  } catch (err) {
    console.error('Falha ao atualizar checklist no servidor:', err);
    if (task && Array.isArray(task.Checklist)) {
      const item = task.Checklist.find(i => String(i.id) === String(itemId));
      if (item) item.concluido = !checked;
    }
    renderTasksApp();
  }
}

async function approveTask(taskId, notes = '') {
  const api = getApi();
  if (!api) return;

  triggerHaptic('success');
  try {
    await api.invoke('tasksApprove', [taskId, notes]);
    await loadTasks(true);
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
    await loadTasks(true);
  } catch (err) {
    alert(err.message || 'Falha ao excluir tarefa.');
  }
}

function openNewTaskDialog(defaultSector = 'Caixa') {
  populateEmployeeSelect('');
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
  populateEmployeeSelect(task.FuncionarioID || task.NomeFuncionario || '');

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

function renderShiftOverview(tasks) {
  const total = tasks.length;
  const completed = tasks.filter(t => t.Coluna === 'concluido' || (Array.isArray(t.Checklist) && t.Checklist.length > 0 && t.Checklist.every(c => c.concluido))).length;
  const pending = total - completed;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (total === 0) {
    return `
      <section class="shift-hero shift-hero-empty" aria-label="Status do Turno">
        <div class="shift-hero-header">
          <span class="shift-hero-kicker">SEU TURNO HOJE</span>
          <span class="shift-hero-badge ok">Operação em Dia</span>
        </div>
        <div class="shift-hero-body">
          <h3 class="shift-hero-title">Tudo em ordem</h3>
          <p class="shift-hero-desc">Nenhuma rotina pendente neste momento. Novas atividades operacionais serão liberadas pela gerência conforme o andamento do turno.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="shift-hero" aria-label="Status do Turno">
      <div class="shift-hero-header">
        <span class="shift-hero-kicker">SEU TURNO HOJE</span>
        <span class="shift-hero-badge ${pct === 100 ? 'done' : 'active'}">
          ${pct === 100 ? 'Turno Finalizado' : `${pending} ${pending === 1 ? 'rotina pendente' : 'rotinas pendentes'}`}
        </span>
      </div>

      <div class="shift-hero-stats">
        <div class="shift-hero-count">
          <strong class="shift-count-number">${completed} de ${total}</strong>
          <span class="shift-count-label">rotinas concluídas</span>
        </div>
        <div class="shift-hero-pct-pill ${pct === 100 ? 'done' : ''}">
          ${pct}%
        </div>
      </div>

      <div class="shift-progress-track">
        <div class="shift-progress-bar ${pct === 100 ? 'done' : ''}" style="width: ${pct}%;"></div>
      </div>
    </section>
  `;
}

function renderSkeletonLoading() {
  return `
    <div class="tasks-skeleton-wrap" aria-busy="true" aria-label="Carregando rotinas...">
      <div class="skeleton-shift-hero shimmer"></div>
      <div class="skeleton-card shimmer"></div>
      <div class="skeleton-card shimmer"></div>
      <div class="skeleton-card shimmer"></div>
    </div>
  `;
}

function renderChecklistCard(task) {
  const checklist = Array.isArray(task.Checklist) ? task.Checklist : [];
  const chTotal = checklist.length;
  const chDone = checklist.filter(c => c.concluido).length;
  const chPercent = chTotal > 0 ? Math.round((chDone / chTotal) * 100) : (task.Coluna === 'concluido' ? 100 : 0);
  const isAllDone = (chTotal > 0 && chDone === chTotal) || (chTotal === 0 && task.Coluna === 'concluido');
  const sectorCfg = getSectorConfig(task.Setor, task.Tipo);
  const statusCfg = getTaskStatus(task);
  const isAssigned = isTaskAssignedToCurrentUser(task);
  const isExpanded = state.expandedCards.has(String(task.TarefaID));
  const isManager = isUserAdminOrManager();

  const stepMatch = (task.Titulo || '').match(/^(\d+)\.\s*(.*)$/);
  const stepTitle = stepMatch ? stepMatch[2] : task.Titulo;

  return `
    <article class="routine-card ${isAllDone ? 'is-complete' : ''} ${isAssigned ? 'is-assigned' : ''}" data-task-id="${esc(task.TarefaID)}">
      <!-- Topo do Card: Ícone Contextual, Meta, Status e Ação -->
      <div class="routine-card-main" data-toggle-expand-card="${esc(task.TarefaID)}">
        <div class="routine-icon-container" style="background:${sectorCfg.bg}; color:${sectorCfg.color}; border-color:${sectorCfg.border};">
          ${sectorCfg.icon}
        </div>

        <div class="routine-info-block">
          <div class="routine-meta-row">
            <span class="routine-sector-label" style="color:${sectorCfg.color};">${esc(sectorCfg.name)}</span>
            ${task.HoraLimite ? `
              <span class="routine-deadline ${statusCfg.id === 'atrasado' ? 'overdue' : ''}">
                ${ICONS.clock} Até ${esc(task.HoraLimite)}
              </span>
            ` : ''}
            ${isAssigned ? `<span class="routine-assigned-badge">${ICONS.user} Sua Tarefa</span>` : ''}
          </div>

          <h3 class="routine-title">${esc(stepTitle)}</h3>
          ${task.Descricao ? `<p class="routine-desc">${esc(task.Descricao)}</p>` : ''}

          <div class="routine-status-row">
            <span class="routine-status-pill ${statusCfg.id}">
              ${statusCfg.label}
            </span>
            <span class="routine-step-counter">
              ${chTotal > 0 ? `${chDone} de ${chTotal} ${chTotal === 1 ? 'tarefa' : 'tarefas'}` : (isAllDone ? 'Tarefa concluída' : '1 tarefa direta')}
            </span>
          </div>
        </div>

        <div class="routine-action-side">
          <button type="button" class="routine-expand-btn ${isExpanded ? 'expanded' : ''}" aria-label="Expandir rotina">
            <span class="routine-expand-label">${isAllDone ? 'Rever' : isExpanded ? 'Recolher' : chDone > 0 ? 'Continuar' : 'Iniciar'}</span>
            ${isExpanded ? ICONS.chevronUp : ICONS.arrowRight}
          </button>
        </div>
      </div>

      <!-- Barra de Progresso Fina no Card -->
      <div class="routine-progress-track">
        <div class="routine-progress-fill ${isAllDone ? 'done' : ''}" style="width: ${chPercent}%;"></div>
      </div>

      <!-- Bandeja Expansível com os Subitens -->
      ${isExpanded ? `
        <div class="routine-tray">
          ${chTotal > 0 ? `
            <div class="routine-items-list">
              ${checklist.map(item => `
                <button type="button" class="routine-item-row ${item.concluido ? 'checked' : ''}" data-toggle-subtask="${esc(item.id)}" data-task-id="${esc(task.TarefaID)}" role="checkbox" aria-checked="${item.concluido ? 'true' : 'false'}">
                  <span class="routine-item-checkbox ${item.concluido ? 'checked' : ''}">
                    ${ICONS.check}
                  </span>
                  <span class="routine-item-text">${esc(item.texto)}</span>
                </button>
              `).join('')}
            </div>
          ` : `
            <div class="routine-single-action">
              <button type="button" class="btn ${isAllDone ? 'btn-secondary' : 'btn-primary'}" data-toggle-card-complete="${esc(task.TarefaID)}" style="width: 100%; height: 44px; border-radius: 8px;">
                ${isAllDone ? 'Reabrir Rotina' : 'Marcar como Concluída'}
              </button>
            </div>
          `}

          <footer class="routine-tray-footer">
            <div class="routine-footer-meta">
              <span class="routine-resp">${ICONS.user} <strong>${esc(task.NomeFuncionario || 'Equipe da Praça')}</strong></span>
              ${task.VistoPor ? `
                <span class="visto-badge approved">${ICONS.check} Visto: ${esc(task.VistoPor)}</span>
              ` : task.ExigeVistoGerente ? `
                <span class="visto-badge pending">Exige visto</span>
              ` : ''}
            </div>

            <div class="routine-footer-actions">
              ${chTotal > 0 ? `
                <button type="button" class="btn-ghost-action" data-mark-section-all="${esc(task.TarefaID)}" data-action="${isAllDone ? 'uncheck' : 'check'}">
                  ${isAllDone ? 'Desmarcar todos' : 'Concluir todos'}
                </button>
              ` : ''}
              ${isManager ? `
                <button type="button" class="btn-icon-subtle" data-edit-task="${esc(task.TarefaID)}" title="Editar">
                  ${ICONS.edit}
                </button>
                <button type="button" class="btn-icon-danger" data-delete-task="${esc(task.TarefaID)}" title="Excluir rotina">
                  ${ICONS.trash}
                </button>
              ` : ''}
            </div>
          </footer>
        </div>
      ` : ''}
    </article>
  `;
}

function renderDailyChecklist(tasks) {
  if (tasks.length === 0) {
    return `
      <div class="tasks-empty-starter" style="margin-top: 14px;">
        <h3>Nenhuma rotina neste filtro</h3>
        <p>Selecione outro setor acima ou adicione uma nova rotina para o turno de hoje.</p>
      </div>
    `;
  }

  return `
    <div class="daily-checklist-container">
      ${tasks.map(t => renderChecklistCard(t)).join('')}
    </div>
  `;
}

function renderMyTasks() {
  const myTasks = state.tasks.filter(isTaskAssignedToCurrentUser);
  const userName = state.user?.Nome || state.user?.nome || 'Colaborador';
  const firstName = userName.split(' ')[0];

  if (myTasks.length === 0) {
    return `
      <div class="tasks-empty-starter employee-empty" style="margin-top: 14px;">
        <span class="starter-tag caixa">MINHAS ATRIBUIÇÕES</span>
        <h3 style="margin-top:14px;font-size:18px;font-weight:700;color:var(--text, #0f172a);">Olá, ${esc(firstName)}</h3>
        <p style="max-width:440px;margin:8px auto 18px;color:var(--muted, #64748b);font-size:13.5px;line-height:1.45;">
          Você não possui rotinas vinculadas exclusivamente ao seu nome no momento. Você pode atuar e cumprir as rotinas gerais da praça.
        </p>
        <button type="button" class="btn btn-primary" data-view-mode="checklist" style="font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;">
          Ver Rotinas Gerais
        </button>
      </div>
    `;
  }

  return `
    <div class="my-tasks-container">
      <div class="my-tasks-list">
        ${renderDailyChecklist(myTasks)}
      </div>
    </div>
  `;
}

function renderKanban(tasks) {
  return `
    <div class="kanban-wrapper">
      <!-- Navegação de Colunas no Mobile -->
      <div class="kanban-col-nav" role="tablist" aria-label="Colunas do Quadro">
        ${COLUMNS.map(col => {
          const count = tasks.filter(t => (t.Coluna || 'pendente') === col.id).length;
          return `
            <button class="kanban-col-tab ${state.kanbanActiveCol === col.id ? 'active' : ''}" data-kanban-tab="${col.id}">
              <span class="kanban-tab-dot" style="background:${col.dotColor};"></span>
              <span class="kanban-tab-title">${col.shortTitle}</span>
              ${count > 0 ? `<span class="kanban-tab-badge">${count}</span>` : ''}
            </button>
          `;
        }).join('')}
      </div>

      <!-- Quadro Kanban -->
      <div class="trello-board">
        ${COLUMNS.map(col => {
          const colTasks = tasks.filter(t => (t.Coluna || 'pendente') === col.id);
          const isMobileActive = state.kanbanActiveCol === col.id;

          return `
            <div class="trello-column ${isMobileActive ? 'mobile-active' : ''}" data-column-id="${col.id}">
              <div class="trello-column-head">
                <div class="trello-col-title-group">
                  <span class="trello-col-dot" style="background:${col.dotColor};"></span>
                  <h3 class="trello-col-title">${col.title}</h3>
                  ${colTasks.length > 0 ? `<span class="trello-count-pill">${colTasks.length}</span>` : ''}
                </div>
                ${isUserAdminOrManager() ? `
                  <button type="button" class="trello-add-card-btn" data-add-card-col="${col.id}" title="Adicionar">+</button>
                ` : ''}
              </div>

              <div class="trello-cards-area" data-col-target="${col.id}">
                ${colTasks.length === 0 ? `
                  <div class="trello-empty-column">
                    <p>Nenhuma tarefa nesta etapa</p>
                  </div>
                ` : colTasks.map(t => renderCard(t)).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderCard(task) {
  const checklist = Array.isArray(task.Checklist) ? task.Checklist : [];
  const chTotal = checklist.length;
  const chDone = checklist.filter(c => c.concluido).length;
  const chPercent = chTotal > 0 ? Math.round((chDone / chTotal) * 100) : 0;
  const sectorCfg = getSectorConfig(task.Setor, task.Tipo);
  const statusCfg = getTaskStatus(task);
  const isAssigned = isTaskAssignedToCurrentUser(task);

  const cleanTitle = (task.Titulo || '')
    .replace(/^(\d+\.\s*)?(Abertura|Fechamento|Caixa)\s*(Turno|Rotina)?:\s*/i, '$1')
    .trim();

  const isManager = isUserAdminOrManager();

  return `
    <div class="trello-card ${isAssigned ? 'assigned-to-me' : ''}" draggable="true" data-task-id="${esc(task.TarefaID)}" data-card-detail="${esc(task.TarefaID)}">
      <div class="trello-card-tags">
        <span class="trello-tag" style="background:${sectorCfg.bg}; color:${sectorCfg.color}; border-color:${sectorCfg.border};">
          ${esc(sectorCfg.name)}
        </span>
        ${isAssigned ? `<span class="trello-tag-mine">${ICONS.user} Sua Tarefa</span>` : ''}
        ${task.Prioridade === 'Urgente' ? `<span class="trello-tag-urgent">Urgente</span>` : task.Prioridade === 'Alta' ? `<span class="trello-tag-high">Alta</span>` : ''}
        ${task.HoraLimite ? `<span class="trello-tag-time">${ICONS.clock} ${esc(task.HoraLimite)}</span>` : ''}
      </div>

      <h4 class="trello-card-title">${esc(cleanTitle)}</h4>
      ${task.Descricao ? `<p class="trello-card-desc">${esc(task.Descricao)}</p>` : ''}

      ${chTotal > 0 ? `
        <div class="trello-card-ch-pill ${chDone === chTotal ? 'all-done' : ''}">
          <span class="trello-card-ch-text">${chDone}/${chTotal} itens</span>
          <div class="trello-card-ch-track">
            <div class="trello-card-ch-bar ${chDone === chTotal ? 'is-complete' : ''}" style="width: ${chPercent}%;"></div>
          </div>
        </div>
      ` : ''}

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
          ${isManager ? `
            <button type="button" class="trello-btn-edit" data-edit-task="${esc(task.TarefaID)}" title="Editar tarefa">Editar</button>
          ` : ''}
          ${task.Coluna === 'visto' && isManager ? `
            <button type="button" class="trello-btn-approve" data-approve-task="${esc(task.TarefaID)}">
              Visto
            </button>
          ` : ''}
          <button type="button" class="trello-btn-step" data-step-dir="prev" data-task-id="${esc(task.TarefaID)}" title="Voltar etapa">${ICONS.chevronLeft}</button>
          <button type="button" class="trello-btn-step" data-step-dir="next" data-task-id="${esc(task.TarefaID)}" title="Avançar etapa">${ICONS.chevronRight}</button>
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

function renderTasksApp() {
  const container = $('#tasksApp');
  if (!container) return;

  const currentStore = state.stores.find(s => String(s.LojaID || s.lojaId) === String(state.selectedStore));
  const storeName = currentStore?.Nome || currentStore?.NomeLoja || 'House 190 Teixeira';

  const allDayTasks = state.tasks;
  const isManager = isUserAdminOrManager();
  const myTasks = allDayTasks.filter(isTaskAssignedToCurrentUser);
  const myTasksCount = myTasks.length;
  const maintenanceTasks = allDayTasks.filter(t => t.Tipo === 'manutencao' && t.Coluna !== 'concluido').length;

  const filtered = getFilteredTasks();

  const todayLabel = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', weekday: 'long', day: '2-digit', month: 'long' });
  const formattedToday = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1);

  const userName = state.user?.Nome || state.user?.nome || 'Operação';
  const userInitials = userName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || 'H';

  container.innerHTML = `
    <div class="tasks-page">
      <!-- App Bar Compacta & Sofisticada (Padrão Nativo) -->
      <header class="app-nav-bar">
        <div class="app-nav-top">
          <div class="app-nav-brand">
            <h1 class="app-nav-title">Rotinas</h1>
            <span class="app-live-indicator"><span class="live-dot"></span> Ao Vivo</span>
          </div>

          <div class="app-nav-actions">
            ${isManager ? `
              <button class="btn-app-action primary" id="openNewTaskBtn" title="Nova Tarefa">
                ${ICONS.plus} <span>Nova</span>
              </button>
              <button class="btn-app-action" id="openRoutineBtn" title="Disparar Rotinas Padrão">
                ${ICONS.zap} <span>Rotinas</span>
              </button>
              <button class="btn-app-icon ${maintenanceTasks > 0 ? 'alert' : ''}" id="openMaintenanceBtn" title="Manutenção e Reparos">
                ${ICONS.tool}
                ${maintenanceTasks > 0 ? `<span class="badge-dot-alert"></span>` : ''}
              </button>
              <button class="btn-app-icon" id="tasksDeduplicateBtn" title="Organizar Quadro">
                ${ICONS.clean}
              </button>
            ` : `
              <button class="btn-app-action" id="tasksHeaderRefreshBtn" title="Sincronizar">
                ${ICONS.refresh} <span>Atualizar</span>
              </button>
              <button class="btn-app-icon ${maintenanceTasks > 0 ? 'alert' : ''}" id="openMaintenanceBtn" title="Relatar defeito">
                ${ICONS.tool}
                ${maintenanceTasks > 0 ? `<span class="badge-dot-alert"></span>` : ''}
              </button>
            `}
            <div class="app-user-avatar" title="${esc(userName)}">${esc(userInitials)}</div>
          </div>
        </div>

        <div class="app-nav-context">
          ${state.stores.length > 1 && isManager ? `
            <select id="tasksStoreSelect" class="app-context-select" aria-label="Selecionar Loja">
              ${state.stores.map(s => {
                const id = String(s.LojaID || s.lojaId || '');
                const name = s.NomeLoja || s.Nome || id;
                return `<option value="${esc(id)}" ${id === state.selectedStore ? 'selected' : ''}>${esc(name)}</option>`;
              }).join('')}
            </select>
          ` : `
            <span class="app-context-unit">${esc(storeName)}</span>
          `}
          <span class="app-context-dot"></span>
          ${isManager ? `
            <input type="date" id="tasksDateInput" class="app-context-date" value="${esc(state.selectedDate)}" aria-label="Data">
          ` : `
            <span class="app-context-day">${esc(formattedToday)}</span>
          `}
        </div>
      </header>

      <!-- Área Principal: Bloco "Seu Turno Hoje" -->
      ${renderShiftOverview(isManager ? allDayTasks : (myTasksCount > 0 ? myTasks : allDayTasks), isManager)}

      <!-- Seletor de Modo (Checklists / Minhas / Kanban) -->
      ${isManager ? `
        <div class="view-segmented-wrap">
          <div class="view-segmented-control" role="tablist">
            <button class="view-tab-btn ${state.viewMode === 'checklist' ? 'active' : ''}" data-view-mode="checklist">
              ${ICONS.list} Checklists
            </button>
            <button class="view-tab-btn ${state.viewMode === 'my' ? 'active' : ''}" data-view-mode="my">
              ${ICONS.user} Minhas ${myTasksCount > 0 ? `<span class="pill-badge">${myTasksCount}</span>` : ''}
            </button>
            <button class="view-tab-btn ${state.viewMode === 'kanban' ? 'active' : ''}" data-view-mode="kanban">
              ${ICONS.kanban} Kanban
            </button>
          </div>
        </div>
      ` : myTasksCount > 0 ? `
        <div class="view-segmented-wrap">
          <div class="view-segmented-control" role="tablist">
            <button class="view-tab-btn ${state.viewMode === 'my' ? 'active' : ''}" data-view-mode="my">
              ${ICONS.user} Suas Tarefas ${myTasksCount > 0 ? `<span class="pill-badge">${myTasksCount}</span>` : ''}
            </button>
            <button class="view-tab-btn ${state.viewMode === 'checklist' ? 'active' : ''}" data-view-mode="checklist">
              ${ICONS.list} Todas da Loja
            </button>
          </div>
        </div>
      ` : ''}

      <!-- Filtros de Setor Compactos em Scroll Horizontal (Sem zeros ruidosos) -->
      ${state.viewMode !== 'kanban' ? `
        <div class="sector-filters-rail" role="tablist" aria-label="Filtro de Setor">
          ${SECTOR_GROUPS.map(grp => {
            const count = allDayTasks.filter(t => {
              if (grp.id === 'todos') return true;
              if (grp.id === 'caixa') return t.Setor === 'Caixa' || t.Tipo === 'rotina_caixa';
              if (grp.id === 'abertura') return t.Tipo === 'rotina_abertura';
              if (grp.id === 'fechamento') return t.Tipo === 'rotina_fechamento';
              if (grp.id === 'manutencao') return t.Tipo === 'manutencao';
              if (grp.id === 'cozinha') return t.Setor === 'Cozinha';
              return true;
            }).length;

            return `
              <button class="sector-pill ${state.selectedSector === grp.id ? 'active' : ''}" data-sector-filter="${grp.id}" role="tab" aria-selected="${state.selectedSector === grp.id ? 'true' : 'false'}">
                <span>${grp.label}</span>
                ${count > 0 ? `<span class="pill-badge">${count}</span>` : ''}
              </button>
            `;
          }).join('')}
        </div>
      ` : ''}

      <!-- Conteúdo Principal -->
      ${state.loading ? renderSkeletonLoading() : allDayTasks.length === 0 ? `
        ${isManager ? `
          <div class="tasks-empty-starter">
            <span class="starter-badge">PRIMEIRO ACESSO</span>
            <h3>Nenhuma rotina gerada para hoje</h3>
            <p>Selecione um pacote padrão do turno abaixo ou adicione uma tarefa individual:</p>

            <div class="starter-actions starter-actions-3">
              <button class="starter-card-btn caixa" data-trigger-routine="caixa">
                <span class="starter-tag caixa">CAIXA</span>
                <div>
                  <strong>Rotina do Caixa</strong>
                  <small>Abertura do PDV, conferência de sistemas, notas, Drive, grupo VIP e WhatsApp.</small>
                </div>
              </button>

              <button class="starter-card-btn abertura" data-trigger-routine="abertura">
                <span class="starter-tag abertura">ABERTURA</span>
                <div>
                  <strong>Abertura de Turno</strong>
                  <small>Freezers, estoque crítico, chapa, fritadeira e gaveta de caixa.</small>
                </div>
              </button>

              <button class="starter-card-btn fechamento" data-trigger-routine="fechamento">
                <span class="starter-tag fechamento">FECHAMENTO</span>
                <div>
                  <strong>Fechamento de Turno</strong>
                  <small>Limpeza de coifa/chapa, gás, descarte de óleo, caixa e lixo.</small>
                </div>
              </button>
            </div>
          </div>
        ` : `
          <div class="tasks-empty-starter employee-empty">
            <span class="starter-tag caixa">TURNO DE HOJE</span>
            <h3 style="margin-top:14px;font-size:18px;font-weight:700;color:var(--text, #0f172a);">Tudo em ordem por aqui</h3>
            <p style="max-width:440px;margin:8px auto 18px;color:var(--muted, #64748b);font-size:13.5px;line-height:1.45;">
              Nenhum checklist pendente para o seu turno neste momento. As rotinas operacionais são liberadas pela gerência.
            </p>
            <button type="button" class="btn btn-secondary" id="tasksEmployeeRefreshBtn" style="font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;">
              ${ICONS.refresh} Atualizar agora
            </button>
          </div>
        `}
      ` : state.viewMode === 'checklist' ? renderDailyChecklist(filtered) : state.viewMode === 'my' ? renderMyTasks() : renderKanban(filtered)}
    </div>
  `;

  bindDomEvents();
}

async function markAllSectionItems(taskId, markDone) {
  const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
  if (!task || !Array.isArray(task.Checklist)) return;

  const api = getApi();
  if (!api) return;

  triggerHaptic(markDone ? 'success' : 'light');

  task.Checklist.forEach(i => { i.concluido = markDone; });
  if (markDone) {
    task.Coluna = task.ExigeVistoGerente ? 'visto' : 'concluido';
  } else {
    task.Coluna = 'pendente';
  }

  updateCardProgressDom(taskId);
  updateGlobalStatsDom();

  const card = document.querySelector(`[data-task-id="${taskId}"]`);
  if (card) {
    const rows = card.querySelectorAll('[data-toggle-subtask]');
    rows.forEach(r => {
      r.classList.toggle('checked', markDone);
      r.setAttribute('aria-checked', markDone ? 'true' : 'false');
      const box = r.querySelector('.routine-item-checkbox');
      if (box) box.classList.toggle('checked', markDone);
    });
  }

  try {
    for (const item of task.Checklist) {
      await api.invoke('tasksToggleChecklistItem', [taskId, item.id, markDone]);
    }
  } catch (err) {
    console.error('Falha ao alternar todos do checklist:', err);
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

  const sectorCfg = getSectorConfig(task.Setor, task.Tipo);
  const sectorBadge = $('#taskDetailSectorBadge');
  if (sectorBadge) {
    sectorBadge.textContent = task.Setor || 'Geral';
    sectorBadge.style.background = sectorCfg.bg;
    sectorBadge.style.color = sectorCfg.color;
    sectorBadge.style.borderColor = sectorCfg.border;
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
      container.innerHTML = '<div style="font-size:12.5px;color:var(--muted,#94a3b8);font-style:italic;padding:8px 0;">Nenhum subitem de checklist cadastrado.</div>';
    } else {
      container.innerHTML = chList.map(item => `
        <button type="button" class="routine-item-row ${item.concluido ? 'checked' : ''}" data-toggle-subtask="${esc(item.id)}" data-task-id="${esc(task.TarefaID)}" role="checkbox" aria-checked="${item.concluido ? 'true' : 'false'}" style="margin-bottom:6px;">
          <span class="routine-item-checkbox ${item.concluido ? 'checked' : ''}">
            ${ICONS.check}
          </span>
          <span class="routine-item-text">${esc(item.texto)}</span>
        </button>
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
  if (storeDate) storeDate.textContent = `${currentStore?.Nome || currentStore?.NomeLoja || 'Loja'} - ${task.DataTurno ? task.DataTurno.split('-').reverse().join('/') : ''}`;

  const isMgr = isUserAdminOrManager();
  const editBtn = $('#taskDetailEditBtn');
  if (editBtn) {
    editBtn.style.display = isMgr ? 'inline-block' : 'none';
    editBtn.onclick = () => {
      closeDialog('taskDetailDialog');
      openEditTaskDialog(task.TarefaID);
    };
  }

  const delBtn = $('#taskDetailDeleteBtn');
  if (delBtn) {
    delBtn.style.display = isMgr ? 'inline-block' : 'none';
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
        const notes = prompt('Anotação do visto gerencial (opcional):') || '';
        await approveTask(task.TarefaID, notes);
      };
    } else {
      approveBtn.style.display = 'none';
    }
  }

  openDialog('taskDetailDialog');
}

function bindDomEvents() {
  const storeSel = $('#tasksStoreSelect');
  if (storeSel) {
    storeSel.onchange = (e) => {
      state.selectedStore = e.target.value;
      loadTasks();
    };
  }

  const dateInp = $('#tasksDateInput');
  if (dateInp) {
    dateInp.onchange = (e) => {
      state.selectedDate = e.target.value;
      loadTasks();
    };
  }

  const newBtn = $('#openNewTaskBtn');
  if (newBtn) newBtn.onclick = () => openNewTaskDialog();

  const routineBtn = $('#openRoutineBtn');
  if (routineBtn) routineBtn.onclick = () => openDialog('taskRoutineDialog');

  const maintBtn = $('#openMaintenanceBtn');
  if (maintBtn) maintBtn.onclick = () => openDialog('taskMaintenanceDialog');

  const refreshBtn = $('#tasksHeaderRefreshBtn');
  if (refreshBtn) refreshBtn.onclick = () => loadTasks();

  const empRefreshBtn = $('#tasksEmployeeRefreshBtn');
  if (empRefreshBtn) empRefreshBtn.onclick = () => loadTasks();
}

function populateEmployeeSelect(selectedVal = '') {
  const sel = $('#taskEmployeeInput');
  if (!sel) return;
  const emps = Array.isArray(state.employees) ? state.employees : [];

  sel.innerHTML = `
    <option value="">Equipe da Praça (Geral)</option>
    ${emps.map(e => {
      const id = getEmployeeId(e);
      const name = getEmployeeName(e);
      return `<option value="${esc(id)}">${esc(name)}</option>`;
    }).join('')}
  `;
  if (selectedVal) {
    sel.value = selectedVal;
  }
}

function renderDraftChecklist() {
  const box = $('#taskChecklistDraftContainer');
  if (!box) return;
  if (!state.checklistDraft || state.checklistDraft.length === 0) {
    box.innerHTML = '<div style="font-size:12px;color:var(--muted,#94a3b8);font-style:italic;padding:6px 0;">Nenhum item adicionado ainda. Digite acima e clique em Adicionar ou tecle Enter.</div>';
    return;
  }
  box.innerHTML = state.checklistDraft.map((item, idx) => `
    <div class="draft-row">
      <input type="text" class="draft-item-input" data-draft-idx="${idx}" value="${esc(item.texto)}" placeholder="Descrição do item..." />
      <button type="button" class="btn-del-draft" data-del-draft="${idx}" title="Remover item">${ICONS.trash}</button>
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

  // Segmented view mode (Checklists / Minhas / Kanban)
  const modeBtn = e.target.closest('[data-view-mode]');
  if (modeBtn) {
    userManuallyToggledView = true;
    state.viewMode = modeBtn.dataset.viewMode;
    renderTasksApp();
    return;
  }

  // Seletor de Colunas do Kanban no Mobile
  const kanbanTab = e.target.closest('[data-kanban-tab]');
  if (kanbanTab) {
    state.kanbanActiveCol = kanbanTab.dataset.kanbanTab;
    renderTasksApp();
    return;
  }

  // Ações de rotina rápida
  const routineTrigger = e.target.closest('[data-trigger-routine]');
  if (routineTrigger) {
    generateRoutine(routineTrigger.dataset.triggerRoutine);
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

  // Toggle de item do checklist
  const subtaskRow = e.target.closest('[data-toggle-subtask]');
  if (subtaskRow) {
    const itemId = subtaskRow.dataset.toggleSubtask;
    const taskId = subtaskRow.dataset.taskId;
    const task = state.tasks.find(t => String(t.TarefaID) === String(taskId));
    if (task && Array.isArray(task.Checklist)) {
      const item = task.Checklist.find(i => String(i.id) === String(itemId));
      if (item) {
        toggleChecklistItem(taskId, itemId, !item.concluido);
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

// Bind de formulários das modais nativas
document.addEventListener('DOMContentLoaded', () => {
  const taskForm = document.getElementById('taskForm');
  if (taskForm) {
    taskForm.onsubmit = async (e) => {
      e.preventDefault();
      const id = $('#taskIdInput')?.value;
      const title = $('#taskTitleInput')?.value || '';
      const sector = $('#taskSectorInput')?.value || 'Caixa';
      const priority = $('#taskPriorityInput')?.value || 'Media';
      const empId = $('#taskEmployeeInput')?.value || '';
      const deadline = $('#taskDeadlineInput')?.value || '';
      const desc = $('#taskDescInput')?.value || '';
      const reqManagerSign = Boolean($('#taskManagerSignInput')?.checked);

      let empName = '';
      if (empId) {
        const emp = (state.employees || []).find(x => getEmployeeId(x) === empId);
        empName = getEmployeeName(emp);
      }

      const payload = {
        TarefaID: id || undefined,
        Titulo: title,
        Setor: sector,
        Prioridade: priority,
        FuncionarioID: empId,
        NomeFuncionario: empName,
        HoraLimite: deadline,
        Descricao: desc,
        ExigeVistoGerente: reqManagerSign,
        Checklist: state.checklistDraft,
        LojaID: state.selectedStore,
        DataTurno: state.selectedDate,
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
let realtimeSubscribed = false;
function setupRealtimeTasks() {
  if (realtimeSubscribed) return;
  const runtime = window.__GESTAO_FIREBASE__?.runtime;
  if (runtime?.subscribe) {
    realtimeSubscribed = true;
    try {
      runtime.subscribe('tables/Tarefas', () => {
        loadTasks(true);
      });
    } catch (err) {
      console.warn('Falha ao assinar realtime de Tarefas:', err);
    }
  }
}

function ensureTasksInitialized(customCtx = {}) {
  const runtime = window.__GESTAO_FIREBASE__?.runtime;
  const currentProfile = customCtx.user || window.__GESTAO_USER__ || runtime?.profile || state.user;
  const stores = (customCtx.stores && customCtx.stores.length > 0) ? customCtx.stores : (window.state?.stores || state.stores);
  const employees = (customCtx.employees && customCtx.employees.length > 0) ? customCtx.employees : (window.state?.employees || state.employees);

  if (typeof customCtx.isManager === 'boolean') {
    state.isManager = customCtx.isManager;
  }
  state.user = currentProfile || null;
  state.isManager = isUserAdminOrManager();
  state.stores = Array.isArray(stores) ? stores : [];
  state.employees = Array.isArray(employees) ? employees : [];

  if (!state.selectedStore && state.stores.length > 0) {
    const userStore = state.user?.LojaID || state.user?.lojaId;
    const match = state.stores.find(s => String(s.LojaID || s.lojaId) === String(userStore));
    state.selectedStore = match ? String(match.LojaID || match.lojaId) : String(state.stores[0].LojaID || state.stores[0].lojaId);
  }

  setupRealtimeTasks();
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
