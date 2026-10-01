// ==========================================================================
// COZINHA FLOW 3.0 — Sistema Completo Integrado no Folgas 3.0
// Tarefas com Foto no Google Drive, Gamificação com Títulos e Loja de Prêmios
// ==========================================================================

import { SELFIE_DRIVE_UPLOAD_ENDPOINT } from "./selfie-drive-config.js";
import { KITCHEN_LEVELS, DEFAULT_REWARDS, getKitchenLevel, taskPointValue } from "./core/api-tasks.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const dateKey = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

let state = {
  activeTab: 'tarefas', // 'tarefas' | 'jornada' | 'loja' | 'equipe'
  mobileStatus: 'A fazer', // 'A fazer' | 'Em andamento' | 'Aguardando aprovação' | 'Concluída'
  attentionFilter: '',
  tasks: [],
  assignees: [],
  catalog: [],
  redemptions: [],
  adjustments: [],
  missions: [],
  teamMetrics: [],
  user: null,
  isManager: false,
  loading: false,
  searchQuery: '',
  filterAssignee: '',
  filterPriority: '',
  initialized: false,
};

const STATUSES = [
  { value: 'A fazer', title: 'A fazer', icon: 'assignment', tone: 'todo' },
  { value: 'Em andamento', title: 'Fazendo', icon: 'pending_actions', tone: 'doing' },
  { value: 'Aguardando aprovação', title: 'Conferir', icon: 'fact_check', tone: 'review' },
  { value: 'Concluída', title: 'Feitas', icon: 'verified', tone: 'done' },
];

function isUserAdmin() {
  const role = String(state.user?.Perfil || state.user?.role || '').toLowerCase();
  return role.includes('admin') || role.includes('gerente') || role.includes('responsável') || state.isManager;
}

function currentUserId() {
  return String(state.user?.FuncionarioID || state.user?.UsuarioID || state.user?.id || '').trim();
}

function currentUserName() {
  return String(state.user?.Nome || state.user?.nome || 'Colaborador').trim();
}

function isTaskOverdue(task) {
  if (!task.PRAZO) return false;
  if (['Concluída', 'Cancelada'].includes(task.STATUS)) return false;
  return new Date(task.PRAZO).getTime() < Date.now();
}

function isTaskDueSoon(task) {
  if (!task.PRAZO) return false;
  if (!['A fazer', 'Em andamento'].includes(task.STATUS)) return false;
  const diff = new Date(task.PRAZO).getTime() - Date.now();
  return diff >= 0 && diff <= 2 * 60 * 60 * 1000;
}

function formatRelativeDeadline(deadline) {
  if (!deadline) return { text: 'Sem prazo', tone: '' };
  const diffMinutes = Math.round((new Date(deadline).getTime() - Date.now()) / 60000);
  if (diffMinutes < 0) {
    const elapsed = Math.abs(diffMinutes);
    if (elapsed < 60) return { text: `Atrasada há ${elapsed}m`, tone: 'danger' };
    if (elapsed < 1440) return { text: `Atrasada há ${Math.floor(elapsed / 60)}h`, tone: 'danger' };
    return { text: `Atrasada há ${Math.floor(elapsed / 1440)}d`, tone: 'danger' };
  }
  if (diffMinutes < 60) return { text: `Vence em ${Math.max(1, diffMinutes)}m`, tone: 'warning' };
  if (diffMinutes < 1440) return { text: `Vence em ${Math.floor(diffMinutes / 60)}h`, tone: 'warning' };
  if (diffMinutes < 2880) return { text: 'Prazo amanhã', tone: '' };
  try {
    const d = new Date(deadline);
    return { text: `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, tone: '' };
  } catch (_) {
    return { text: deadline, tone: '' };
  }
}

// ==========================================================================
// API HELPER
// ==========================================================================

async function callApi(name, args = []) {
  if (window.__GESTAO_FIREBASE__?.api?.invoke) {
    return await window.__GESTAO_FIREBASE__.api.invoke(name, args);
  }
  if (window.google?.script?.run) {
    return new Promise((resolve, reject) => {
      window.google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .apiRequest(name, args[0] || {});
    });
  }
  throw new Error("Sistema de conexão indisponível.");
}

// ==========================================================================
// DATA LOADING
// ==========================================================================

async function loadData() {
  const hasAuth = !!(state.user || window.__GESTAO_FIREBASE__?.runtime?.auth?.currentUser || window.google?.script?.run);
  if (!hasAuth) {
    renderApp();
    return;
  }
  try {
    state.loading = true;
    const [tasksRes, catalogRes, redemptionsRes, adjustsRes, missionsRes, teamRes] = await Promise.all([
      callApi('cozinhaTasksList'),
      callApi('cozinhaPointCatalog'),
      callApi('cozinhaPointRedemptions'),
      callApi('cozinhaPointAdjustments'),
      callApi('cozinhaPointWeeklyMissions'),
      callApi('cozinhaTeamMetrics'),
    ]);

    state.tasks = tasksRes?.data || [];
    state.catalog = catalogRes?.data || [];
    state.redemptions = redemptionsRes?.data || [];
    state.adjustments = adjustsRes?.data || [];
    state.missions = missionsRes?.data || [];
    state.teamMetrics = teamRes?.data || [];

    if (isUserAdmin()) {
      const assigneesRes = await callApi('cozinhaTasksAssignees');
      state.assignees = assigneesRes?.data || [];
    }
  } catch (err) {
    console.error("Erro ao carregar dados do CozinhaFlow:", err);
  } finally {
    state.loading = false;
    renderApp();
    try {
      const balance = computeUserBalance();
      window.dispatchEvent(new CustomEvent('cozinha-tasks-updated', { detail: balance }));
    } catch (_) {}
  }
}

// ==========================================================================
// CALCULAÇÃO DE SALDO DE PONTOS
// ==========================================================================

export function computeUserBalance() {
  const uid = currentUserId();
  const myTasks = state.tasks.filter(t => String(t.RESPONSAVEL_ID) === uid && t.STATUS === 'Concluída');
  const taskPts = myTasks.reduce((sum, t) => sum + taskPointValue(t.PRIORIDADE), 0);

  const myAdjusts = state.adjustments.filter(a => String(a.USUARIO_ID) === uid);
  const bonus = myAdjusts.filter(a => Number(a.PONTOS) > 0).reduce((s, a) => s + Number(a.PONTOS), 0);
  const penalties = myAdjusts.filter(a => Number(a.PONTOS) < 0).reduce((s, a) => s + Math.abs(Number(a.PONTOS)), 0);

  const totalEarned = Math.max(0, taskPts + bonus - penalties);
  const spent = state.redemptions.filter(r => String(r.USUARIO_ID) === uid && r.STATUS !== 'Cancelado').reduce((s, r) => s + Number(r.PONTOS || 0), 0);

  const available = Math.max(0, totalEarned - spent);
  const levelInfo = getKitchenLevel(totalEarned);

  return { totalEarned, spent, available, levelInfo };
}

window.cozinhaFlowGetBalance = computeUserBalance;

// ==========================================================================
// RENDERIZAÇÃO PRINCIPAL DO COZINHA FLOW
// ==========================================================================

function renderApp() {
  const host = $('#tasksApp');
  if (!host) return;

  const { available, levelInfo } = computeUserBalance();
  const admin = isUserAdmin();

  // Contadores
  const todoCount = state.tasks.filter(t => t.STATUS === 'A fazer').length;
  const doingCount = state.tasks.filter(t => t.STATUS === 'Em andamento').length;
  const reviewCount = state.tasks.filter(t => t.STATUS === 'Aguardando aprovação').length;
  const doneToday = state.tasks.filter(t => t.STATUS === 'Concluída' && String(t.CONCLUIDO_EM || '').slice(0, 10) === dateKey()).length;
  const overdueCount = state.tasks.filter(isTaskOverdue).length;

  host.innerHTML = `
    <!-- Barra Superior de Navegação CozinhaFlow -->
    <nav class="cf-nav-bar" aria-label="Abas CozinhaFlow">
      <button type="button" class="cf-nav-btn ${state.activeTab === 'tarefas' ? 'active' : ''}" data-cf-tab="tarefas">
        <span class="material-symbols-rounded">checklist</span>
        <span>Tarefas</span>
        ${reviewCount && admin ? `<b class="cf-nav-badge">${reviewCount}</b>` : ''}
      </button>
      <button type="button" class="cf-nav-btn ${state.activeTab === 'jornada' ? 'active' : ''}" data-cf-tab="jornada">
        <span class="material-symbols-rounded">workspace_premium</span>
        <span>Títulos &amp; Jornada</span>
        <b class="cf-nav-badge">${levelInfo.level.emoji} ${levelInfo.level.short}</b>
      </button>
      <button type="button" class="cf-nav-btn ${state.activeTab === 'loja' ? 'active' : ''}" data-cf-tab="loja">
        <span class="material-symbols-rounded">stars</span>
        <span>Loja de Prêmios</span>
        <b class="cf-nav-badge" style="background:#fef3c7;color:#b45309;">${available} pts</b>
      </button>
      <button type="button" class="cf-nav-btn ${state.activeTab === 'equipe' ? 'active' : ''}" data-cf-tab="equipe">
        <span class="material-symbols-rounded">groups</span>
        <span>Equipe</span>
      </button>
    </nav>

    <!-- ABA 1: TAREFAS -->
    <div id="cfTabTarefas" class="cf-view-tab ${state.activeTab === 'tarefas' ? 'active' : ''}">
      ${renderTarefasTab({ todoCount, doingCount, reviewCount, doneToday, overdueCount, admin })}
    </div>

    <!-- ABA 2: TÍTULOS & JORNADA -->
    <div id="cfTabJornada" class="cf-view-tab ${state.activeTab === 'jornada' ? 'active' : ''}">
      ${renderJornadaTab({ levelInfo, available, admin })}
    </div>

    <!-- ABA 3: LOJA DE PRÊMIOS -->
    <div id="cfTabLoja" class="cf-view-tab ${state.activeTab === 'loja' ? 'active' : ''}">
      ${renderLojaTab({ available, admin })}
    </div>

    <!-- ABA 4: EQUIPE & RANKING -->
    <div id="cfTabEquipe" class="cf-view-tab ${state.activeTab === 'equipe' ? 'active' : ''}">
      ${renderEquipeTab({ admin })}
    </div>
  `;

  bindEvents();
}

// ==========================================================================
// ABA 1: TAREFAS
// ==========================================================================

function renderTarefasTab({ todoCount, doingCount, reviewCount, doneToday, overdueCount, admin }) {
  const visible = getFilteredTasks();

  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">${admin ? 'Operação da Equipe' : 'Meu Trabalho'}</span>
        <h1>${admin ? 'Tarefas da Cozinha' : 'Minhas Tarefas'}</h1>
        <p>${admin ? 'Distribua o trabalho, acompanhe e aprove as fotos de comprovação.' : 'Veja o que precisa ser feito, inicie e envie foto ao concluir.'}</p>
      </div>
      <div class="page-actions">
        ${admin ? `
          <button type="button" class="cf-btn-primary" id="cfBtnNewTask">
            <span class="material-symbols-rounded">add_task</span>Nova Tarefa
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Cards de Resumo -->
    <div class="task-summary-grid">
      <div class="task-summary-card">
        <span class="task-summary-icon todo"><span class="material-symbols-rounded">assignment</span></span>
        <div><small>A fazer</small><strong>${todoCount}</strong></div>
      </div>
      <div class="task-summary-card">
        <span class="task-summary-icon doing"><span class="material-symbols-rounded">pending_actions</span></span>
        <div><small>Fazendo</small><strong>${doingCount}</strong></div>
      </div>
      <div class="task-summary-card">
        <span class="task-summary-icon done"><span class="material-symbols-rounded">verified</span></span>
        <div><small>Feitas hoje</small><strong>${doneToday}</strong></div>
      </div>
      <div class="task-summary-card">
        <span class="task-summary-icon overdue"><span class="material-symbols-rounded">notification_important</span></span>
        <div><small>Atrasadas</small><strong>${overdueCount}</strong></div>
      </div>
    </div>

    <!-- Próxima ação do colaborador -->
    ${!admin ? renderEmployeeFocus() : ''}

    <!-- Painel de Atenção do Admin -->
    ${admin ? renderAdminAttentionPanel({ reviewCount, overdueCount }) : ''}

    <!-- Abas Mobile de Status -->
    <div class="task-mobile-tabs">
      <button type="button" class="task-mobile-tab ${state.mobileStatus === 'A fazer' ? 'active' : ''}" data-mobile-status="A fazer">
        <span>A fazer</span><strong>${state.tasks.filter(t => t.STATUS === 'A fazer').length}</strong>
      </button>
      <button type="button" class="task-mobile-tab ${state.mobileStatus === 'Em andamento' ? 'active' : ''}" data-mobile-status="Em andamento">
        <span>Fazendo</span><strong>${state.tasks.filter(t => t.STATUS === 'Em andamento').length}</strong>
      </button>
      <button type="button" class="task-mobile-tab ${state.mobileStatus === 'Aguardando aprovação' ? 'active' : ''}" data-mobile-status="Aguardando aprovação">
        <span>Conferir</span><strong>${reviewCount}</strong>
      </button>
      <button type="button" class="task-mobile-tab ${state.mobileStatus === 'Concluída' ? 'active' : ''}" data-mobile-status="Concluída">
        <span>Feitas</span><strong>${state.tasks.filter(t => t.STATUS === 'Concluída').length}</strong>
      </button>
    </div>

    <!-- Barra de Ferramentas / Filtros -->
    <div class="task-toolbar">
      <div class="task-search">
        <span class="material-symbols-rounded">search</span>
        <input type="search" id="cfTaskSearch" placeholder="Buscar tarefas..." value="${esc(state.searchQuery)}">
      </div>
      ${admin ? `
        <select class="task-select" id="cfTaskAssigneeFilter">
          <option value="">Todos os colaboradores</option>
          ${state.assignees.map(a => `<option value="${esc(a.id)}" ${state.filterAssignee === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
      ` : ''}
      <select class="task-select" id="cfTaskPriorityFilter">
        <option value="">Todas as prioridades</option>
        <option value="Urgente" ${state.filterPriority === 'Urgente' ? 'selected' : ''}>Urgente</option>
        <option value="Alta" ${state.filterPriority === 'Alta' ? 'selected' : ''}>Alta</option>
        <option value="Normal" ${state.filterPriority === 'Normal' ? 'selected' : ''}>Normal</option>
        <option value="Baixa" ${state.filterPriority === 'Baixa' ? 'selected' : ''}>Baixa</option>
      </select>
      <button type="button" class="task-tool-btn" id="cfBtnRefreshTasks">
        <span class="material-symbols-rounded">refresh</span>Atualizar
      </button>
    </div>

    <!-- Quadro Kanban de Tarefas -->
    <div class="task-board">
      ${STATUSES.map(col => {
        const colTasks = visible.filter(t => t.STATUS === col.value);
        return `
          <div class="task-column ${col.tone} ${state.mobileStatus === col.value ? 'mobile-active' : ''}">
            <div class="task-column-head">
              <span class="task-column-title">
                <span class="material-symbols-rounded">${col.icon}</span>${col.title}
              </span>
              <span class="task-column-count">${colTasks.length}</span>
            </div>
            <div class="task-column-list">
              ${colTasks.length ? colTasks.map(t => renderTaskCard(t, admin)).join('') : `
                <div class="task-column-empty">
                  <span class="material-symbols-rounded">task_alt</span>
                  <strong>Nada por aqui</strong>
                  <span>Nenhuma tarefa nesta etapa.</span>
                </div>
              `}
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <!-- Canceladas / Arquivadas -->
    ${renderArchiveSection(visible, admin)}
  `;
}

function getFilteredTasks() {
  const query = state.searchQuery.trim().toLowerCase();
  return state.tasks.filter(t => {
    if (state.attentionFilter === 'review' && t.STATUS !== 'Aguardando aprovação') return false;
    if (state.attentionFilter === 'overdue' && !isTaskOverdue(t)) return false;
    if (state.attentionFilter === 'soon' && !isTaskDueSoon(t)) return false;
    if (state.attentionFilter === 'returned' && t.REVISAO_STATUS !== 'Devolvida') return false;

    if (state.filterAssignee && String(t.RESPONSAVEL_ID) !== state.filterAssignee) return false;
    if (state.filterPriority && t.PRIORIDADE !== state.filterPriority) return false;

    if (query) {
      const haystack = `${t.TITULO} ${t.DESCRICAO} ${t.RESPONSAVEL_NOME}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function renderEmployeeFocus() {
  const uid = currentUserId();
  const returned = state.tasks.find(t => String(t.RESPONSAVEL_ID) === uid && t.REVISAO_STATUS === 'Devolvida' && t.STATUS === 'Em andamento');
  const doing = state.tasks.find(t => String(t.RESPONSAVEL_ID) === uid && t.STATUS === 'Em andamento');
  const overdue = state.tasks.find(t => String(t.RESPONSAVEL_ID) === uid && isTaskOverdue(t));
  const todo = state.tasks.find(t => String(t.RESPONSAVEL_ID) === uid && t.STATUS === 'A fazer');

  const target = returned || doing || overdue || todo;
  if (!target) {
    return `
      <div class="employee-task-focus">
        <span class="material-symbols-rounded">celebration</span>
        <div>
          <small>Tudo em dia!</small>
          <strong>Nenhuma tarefa pendente agora</strong>
          <p>Você concluiu suas atividades. Aguarde nova atribuição da liderança.</p>
        </div>
      </div>
    `;
  }

  const isReturn = target.REVISAO_STATUS === 'Devolvida';
  const actionText = target.STATUS === 'A fazer' ? 'Iniciar' : 'Enviar Foto';
  const actionType = target.STATUS === 'A fazer' ? 'start' : 'complete';

  return `
    <div class="employee-task-focus">
      <span class="material-symbols-rounded">${isReturn ? 'add_a_photo' : (target.STATUS === 'A fazer' ? 'play_circle' : 'camera_alt')}</span>
      <div>
        <small>${isReturn ? 'Foto devolvida · envie nova foto' : 'Sua próxima atividade'}</small>
        <strong>${esc(target.TITULO)}</strong>
        <p>${formatRelativeDeadline(target.PRAZO).text} · Prioridade ${esc(target.PRIORIDADE)}</p>
      </div>
      <button type="button" data-cf-action="${actionType}" data-task-id="${esc(target.ID)}">
        ${actionText}
      </button>
    </div>
  `;
}

function renderAdminAttentionPanel({ reviewCount, overdueCount }) {
  const returnedCount = state.tasks.filter(t => t.REVISAO_STATUS === 'Devolvida').length;
  const soonCount = state.tasks.filter(isTaskDueSoon).length;
  const totalAlerts = reviewCount + overdueCount + returnedCount + soonCount;

  if (!totalAlerts) {
    return `
      <div class="task-attention-panel">
        <div class="task-attention-head">
          <div><span class="material-symbols-rounded" style="color:#059669;">verified</span><div><small>Operação em dia</small><strong>Nenhuma pendência crítica agora</strong></div></div>
        </div>
      </div>
    `;
  }

  return `
    <div class="task-attention-panel">
      <div class="task-attention-head">
        <div><span class="material-symbols-rounded">crisis_alert</span><div><small>Visão da Liderança</small><strong>Precisa de atenção (${totalAlerts})</strong></div></div>
        ${state.attentionFilter ? `<button type="button" class="task-tool-btn" id="cfClearAttention">Mostrar todas</button>` : ''}
      </div>
      <div class="task-attention-items">
        <button type="button" class="task-attention-item review ${state.attentionFilter === 'review' ? 'active' : ''}" data-attention="review">
          <span class="material-symbols-rounded">photo_library</span>
          <span><strong>${reviewCount}</strong><small>Fotos para conferir</small></span>
        </button>
        <button type="button" class="task-attention-item danger ${state.attentionFilter === 'overdue' ? 'active' : ''}" data-attention="overdue">
          <span class="material-symbols-rounded">timer_off</span>
          <span><strong>${overdueCount}</strong><small>Atrasadas</small></span>
        </button>
        <button type="button" class="task-attention-item warning ${state.attentionFilter === 'soon' ? 'active' : ''}" data-attention="soon">
          <span class="material-symbols-rounded">hourglass_top</span>
          <span><strong>${soonCount}</strong><small>Vencem em 2h</small></span>
        </button>
        <button type="button" class="task-attention-item returned ${state.attentionFilter === 'returned' ? 'active' : ''}" data-attention="returned">
          <span class="material-symbols-rounded">assignment_return</span>
          <span><strong>${returnedCount}</strong><small>Fotos devolvidas</small></span>
        </button>
      </div>
    </div>
  `;
}

function renderTaskCard(task, admin) {
  const uid = currentUserId();
  const isMine = String(task.RESPONSAVEL_ID) === uid;
  const deadlineInfo = formatRelativeDeadline(task.PRAZO);
  const initials = (task.RESPONSAVEL_NOME || '?').split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

  const priorityClass = { Urgente: 'urgent', Alta: 'high', Normal: 'normal', Baixa: 'low' }[task.PRIORIDADE] || 'normal';

  return `
    <article class="task-card" data-task-id="${esc(task.ID)}">
      <div class="task-card-meta">
        <span class="task-priority-badge ${priorityClass}">${esc(task.PRIORIDADE)}</span>
        ${task.PRAZO ? `<span class="task-deadline-badge ${deadlineInfo.tone}"><span class="material-symbols-rounded" style="font-size:12px;">schedule</span>${esc(deadlineInfo.text)}</span>` : ''}
        ${task.REVISAO_STATUS === 'Devolvida' ? `<span class="task-deadline-badge danger">Devolvida: ${esc(task.MOTIVO_REVISAO)}</span>` : ''}
      </div>

      <h4 class="task-card-title">${esc(task.TITULO)}</h4>
      ${task.DESCRICAO ? `<p class="task-card-description">${esc(task.DESCRICAO)}</p>` : ''}
      ${task.ORIENTACAO_FOTO ? `<p class="task-card-description" style="color:#7c3aed;font-weight:600;"><span class="material-symbols-rounded" style="font-size:12px;vertical-align:middle;">info</span> Foto: ${esc(task.ORIENTACAO_FOTO)}</p>` : ''}

      ${task.FOTO_URL ? `
        <div class="task-card-thumb" data-cf-action="view-evidence" data-task-id="${esc(task.ID)}">
          <img src="${esc(task.FOTO_URL)}" alt="Foto da tarefa" loading="lazy">
        </div>
      ` : ''}

      <div class="task-card-assignee">
        <div class="task-assignee-avatar">${esc(initials)}</div>
        <div>
          <small>Responsável</small>
          <strong>${esc(task.RESPONSAVEL_NOME)}</strong>
        </div>
      </div>

      <!-- Ações do Card -->
      <div class="task-card-actions">
        ${task.STATUS === 'A fazer' && (isMine || admin) ? `
          <button type="button" class="task-action-btn primary" data-cf-action="start" data-task-id="${esc(task.ID)}">
            <span class="material-symbols-rounded" style="font-size:16px;">play_arrow</span>Iniciar
          </button>
        ` : ''}

        ${task.STATUS === 'Em andamento' && (isMine || admin) ? `
          <button type="button" class="task-action-btn primary" data-cf-action="complete" data-task-id="${esc(task.ID)}">
            <span class="material-symbols-rounded" style="font-size:16px;">photo_camera</span>Concluir com Foto
          </button>
        ` : ''}

        ${admin && task.STATUS === 'Aguardando aprovação' ? `
          <button type="button" class="task-action-btn success" data-cf-action="approve" data-task-id="${esc(task.ID)}">
            <span class="material-symbols-rounded" style="font-size:16px;">check_circle</span>Aprovar
          </button>
          <button type="button" class="task-action-btn light" data-cf-action="reject" data-task-id="${esc(task.ID)}">
            <span class="material-symbols-rounded" style="font-size:16px;">add_a_photo</span>Pedir Nova Foto
          </button>
        ` : ''}

        ${task.FOTO_URL ? `
          <button type="button" class="task-action-btn light" data-cf-action="view-evidence" data-task-id="${esc(task.ID)}">
            <span class="material-symbols-rounded" style="font-size:16px;">image</span>Foto
          </button>
        ` : ''}

        ${admin && task.STATUS !== 'Cancelada' && task.STATUS !== 'Concluída' ? `
          <button type="button" class="task-action-btn light" data-cf-action="edit" data-task-id="${esc(task.ID)}" title="Editar">
            <span class="material-symbols-rounded" style="font-size:16px;">edit</span>
          </button>
          <button type="button" class="task-action-btn light" data-cf-action="cancel" data-task-id="${esc(task.ID)}" title="Cancelar">
            <span class="material-symbols-rounded" style="font-size:16px;">block</span>
          </button>
        ` : ''}

        ${admin && (task.STATUS === 'Cancelada' || task.STATUS === 'Concluída') ? `
          <button type="button" class="task-action-btn light" data-cf-action="reopen" data-task-id="${esc(task.ID)}">
            <span class="material-symbols-rounded" style="font-size:16px;">replay</span>Reabrir
          </button>
        ` : ''}
      </div>
    </article>
  `;
}

function renderArchiveSection(visible, admin) {
  const canceled = visible.filter(t => t.STATUS === 'Cancelada');
  return `
    <details class="task-archive">
      <summary>
        <span class="material-symbols-rounded">archive</span>
        <span>Tarefas Canceladas (${canceled.length})</span>
      </summary>
      <div class="task-archive-list">
        ${canceled.length ? canceled.map(t => renderTaskCard(t, admin)).join('') : '<p style="color:#8a8da0;font-size:12px;padding:8px 0;">Nenhuma tarefa cancelada.</p>'}
      </div>
    </details>
  `;
}

// ==========================================================================
// ABA 2: TÍTULOS & JORNADA DA COZINHA (Gamificação)
// ==========================================================================

function renderJornadaTab({ levelInfo, available, admin }) {
  const uid = currentUserId();
  const userName = currentUserName();
  const myAdjusts = state.adjustments.filter(a => String(a.USUARIO_ID) === uid);
  const myTasks = state.tasks.filter(t => String(t.RESPONSAVEL_ID) === uid && t.STATUS === 'Concluída');

  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">Progressão e Gamificação</span>
        <h1>Títulos &amp; Jornada da Cozinha</h1>
        <p>Conclua tarefas, ganhe pontos e suba na hierarquia da House Burger!</p>
      </div>
      ${admin ? `
        <div class="page-actions">
          <button type="button" class="cf-btn-primary" id="cfBtnPenalty">
            <span class="material-symbols-rounded">remove_circle</span>Retirar Pontos
          </button>
        </div>
      ` : ''}
    </div>

    <!-- Painel de Nível / Título -->
    <div class="profile-points-panel">
      <div class="profile-score-hero">
        <div class="profile-level-icon">${levelInfo.level.emoji}</div>
        <div class="profile-score-copy">
          <small>Seu Título Atual</small>
          <strong>${esc(levelInfo.level.name)}</strong>
          <span>${levelInfo.nextLevel ? `Faltam ${levelInfo.pointsNeeded} pontos para ${levelInfo.nextLevel.name}` : 'Nível Máximo Conquistado!'}</span>
        </div>
        <div class="profile-score-total">
          <strong>${available}</strong>
          <span>Pontos Disponíveis</span>
        </div>
      </div>
      <div class="profile-level-track">
        <span style="width: ${levelInfo.progress}%;"></span>
      </div>
    </div>

    <!-- Regras de Pontos -->
    <div class="profile-score-rules">
      <div>
        <strong>+1 ponto</strong>
        <small>Prioridade Normal ou Baixa</small>
      </div>
      <div>
        <strong>+2 pontos</strong>
        <small>Prioridade Alta</small>
      </div>
      <div>
        <strong>+3 pontos</strong>
        <small>Prioridade Urgente</small>
      </div>
    </div>

    <!-- Trilho de Selos dos 8 Títulos -->
    <div class="card-surface" style="padding:16px;margin-bottom:16px;border-radius:18px;background:#fff;border:1px solid var(--cf-line);">
      <div class="rewards-head">
        <div>
          <small>Hierarquia da Equipe</small>
          <strong>Os 8 Selos da Cozinha</strong>
        </div>
        <span style="font-size:12px;font-weight:750;color:#7c3aed;">
          ${KITCHEN_LEVELS.filter(l => levelInfo.totalEarned >= l.min).length}/${KITCHEN_LEVELS.length} Desbloqueados
        </span>
      </div>
      <div class="kitchen-badges-track">
        ${KITCHEN_LEVELS.map(lvl => {
          const unlocked = levelInfo.totalEarned >= lvl.min;
          const diff = lvl.min - levelInfo.totalEarned;
          return `
            <div class="kitchen-badge ${unlocked ? 'is-unlocked' : ''}">
              <div class="kitchen-badge-medal">${unlocked ? lvl.emoji : '🔒'}</div>
              <strong>${esc(lvl.name)}</strong>
              <small>${unlocked ? 'Conquistado' : `${diff} pts para liberar`}</small>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Missões da Semana -->
    <div class="card-surface profile-weekly-missions" style="padding:16px;margin-bottom:16px;border-radius:18px;background:#fff;border:1px solid var(--cf-line);">
      <div class="rewards-head">
        <div>
          <small>Desafios Semanais</small>
          <strong>Missões da Semana</strong>
        </div>
      </div>
      <div class="missions-list">
        ${state.missions.map(m => `
          <article class="${m.completed ? 'is-complete' : ''}">
            <span class="material-symbols-rounded">${m.completed ? 'verified' : m.icon}</span>
            <div>
              <strong>${esc(m.title)}</strong>
              <small>${esc(m.description)}</small>
              <i><b style="width:${Math.min(100, Math.round((m.current / m.target) * 100))}%;"></b></i>
              <em>${m.current}/${m.target} concluídas</em>
            </div>
            <b>+${m.bonus}</b>
          </article>
        `).join('')}
      </div>
    </div>

    <!-- Extrato de Pontos -->
    <div class="card-surface" style="padding:16px;border-radius:18px;background:#fff;border:1px solid var(--cf-line);">
      <div class="rewards-head">
        <div>
          <small>Transparência</small>
          <strong>Extrato de Pontos Recentes</strong>
        </div>
      </div>
      <div class="point-statement-list">
        ${renderStatementEntries(myTasks, myAdjusts)}
      </div>
    </div>
  `;
}

function renderStatementEntries(myTasks, myAdjusts) {
  const entries = [
    ...myTasks.map(t => ({
      date: t.CONCLUIDO_EM || t.ATUALIZADO_EM,
      title: t.TITULO,
      detail: `Tarefa aprovada (${t.PRIORIDADE})`,
      points: taskPointValue(t.PRIORIDADE),
      icon: 'task_alt',
      gain: true,
    })),
    ...myAdjusts.map(a => ({
      date: a.CRIADO_EM,
      title: a.MOTIVO,
      detail: a.ORIGEM === 'MISSAO_SEMANAL' ? 'Bônus de Missão' : a.ORIGEM === 'ATRASO' ? 'Punição por atraso' : 'Ajuste administrativo',
      points: Number(a.PONTOS || 0),
      icon: Number(a.PONTOS || 0) > 0 ? 'workspace_premium' : 'trending_down',
      gain: Number(a.PONTOS || 0) > 0,
    })),
  ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 15);

  if (!entries.length) {
    return `<p style="color:#8a8da0;font-size:12px;padding:8px 0;">Nenhuma movimentação registrada até o momento.</p>`;
  }

  return entries.map(e => `
    <article class="${e.gain ? 'is-gain' : 'is-loss'}">
      <span class="material-symbols-rounded">${e.icon}</span>
      <div>
        <strong>${esc(e.title)}</strong>
        <small>${esc(e.detail)}</small>
      </div>
      <b>${e.points > 0 ? '+' : ''}${e.points}</b>
    </article>
  `).join('');
}

// ==========================================================================
// ABA 3: LOJA DE PRÊMIOS
// ==========================================================================

function renderLojaTab({ available, admin }) {
  const uid = currentUserId();
  const myRedemptions = state.redemptions.filter(r => String(r.USUARIO_ID) === uid);
  const pendingDeliveries = state.redemptions.filter(r => r.STATUS === 'Solicitado');

  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">Benefícios &amp; Recompensas</span>
        <h1>Loja de Prêmios</h1>
        <p>Troque seus pontos acumulados por prêmios, lanches, descansos e folga extra!</p>
      </div>
    </div>

    <!-- Saldo Disponível -->
    <div class="shop-balance-panel">
      <div class="shop-balance-content">
        <small>Seu Saldo Disponível</small>
        <strong>${available} <span>pontos</span></strong>
      </div>
      <button type="button" data-cf-tab="jornada">Ver Minha Jornada</button>
    </div>

    <!-- Pedidos para Entregar (Visão do Admin) -->
    ${admin && pendingDeliveries.length ? `
      <div class="card-surface" style="padding:16px;margin-bottom:16px;border-radius:18px;background:#fff;border:1px solid var(--cf-line);">
        <div class="rewards-head">
          <div>
            <small>Ação da Liderança</small>
            <strong>Pedidos para Entregar (${pendingDeliveries.length})</strong>
          </div>
        </div>
        <div class="admin-reward-list">
          ${pendingDeliveries.map(r => `
            <article>
              <span>${esc(r.EMOJI || '🎁')}</span>
              <div>
                <strong>${esc(r.USUARIO_NOME)}</strong>
                <small>${esc(r.RECOMPENSA_NOME)} · ${r.PONTOS} pontos</small>
              </div>
              <button type="button" data-cf-action="deliver-reward" data-redemption-id="${esc(r.ID)}">
                <span class="material-symbols-rounded">redeem</span>Marcar Entregue
              </button>
            </article>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <!-- Catálogo de Prêmios -->
    <div class="card-surface" style="padding:16px;margin-bottom:16px;border-radius:18px;background:#fff;border:1px solid var(--cf-line);">
      <div class="rewards-head">
        <div>
          <small>Catálogo Oficial</small>
          <strong>Recompensas Disponíveis</strong>
        </div>
      </div>
      <div class="reward-store-note">
        <span class="material-symbols-rounded">info</span>
        Ao resgatar, seu pedido é enviado para a gerência combinar a entrega ou agendamento.
      </div>
      <div class="rewards-grid">
        ${state.catalog.filter(r => r.status !== 'Inativo').map(r => {
          const cost = Number(r.cost || r.PONTOS || 0);
          const canRedeem = available >= cost;
          return `
            <div class="reward-card ${r.featured ? 'is-featured' : ''}">
              ${r.featured ? `<span class="reward-featured-label">⭐ Recompensa Máxima</span>` : ''}
              <div class="reward-emoji">${esc(r.EMOJI || r.emoji || '🎁')}</div>
              <div class="reward-copy">
                <strong>${esc(r.NOME || r.name)}</strong>
                <small>${esc(r.DESCRICAO || r.description)}</small>
              </div>
              <div class="reward-price">
                <span class="material-symbols-rounded">stars</span>${cost}
              </div>
              <button type="button" data-cf-action="redeem" data-reward-id="${esc(r.ID)}" ${canRedeem ? '' : 'disabled'}>
                ${canRedeem ? 'Resgatar' : `Faltam ${cost - available}`}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Meus Resgates Recentes -->
    <div class="card-surface" style="padding:16px;border-radius:18px;background:#fff;border:1px solid var(--cf-line);">
      <div class="rewards-head">
        <div>
          <small>Acompanhamento</small>
          <strong>Meus Resgates</strong>
        </div>
      </div>
      <div class="reward-history-list">
        ${myRedemptions.length ? myRedemptions.map(r => `
          <div class="reward-history-item">
            <span>${esc(r.EMOJI || '🎁')}</span>
            <div>
              <strong>${esc(r.RECOMPENSA_NOME)}</strong>
              <small>${r.PONTOS} pontos · Solicitado em ${new Date(r.CRIADO_EM || Date.now()).toLocaleDateString('pt-BR')}</small>
            </div>
            <b class="status-${String(r.STATUS).toLowerCase()}">${esc(r.STATUS)}</b>
          </div>
        `).join('') : '<p style="color:#8a8da0;font-size:12px;padding:8px 0;">Você ainda não solicitou nenhum resgate.</p>'}
      </div>
    </div>
  `;
}

// ==========================================================================
// ABA 4: EQUIPE & RANKING
// ==========================================================================

function renderEquipeTab({ admin }) {
  const members = state.teamMetrics;

  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">Colaboradores &amp; Desempenho</span>
        <h1>Equipe &amp; Ranking</h1>
        <p>Acompanhe os títulos, pontos e tarefas concluídas de toda a equipe.</p>
      </div>
    </div>

    <div class="team-list">
      ${members.length ? members.map((m, index) => `
        <div class="team-member-card">
          <div class="team-member-avatar">${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : (index + 1)}</div>
          <div class="team-member-info">
            <strong>${esc(m.name)}</strong>
            <small>${esc(m.role)} · ${m.doneToday} feitas hoje · ${m.pending} pendentes</small>
            <div class="team-member-level">
              <span>${m.level.emoji}</span>
              <strong>${esc(m.level.name)}</strong>
            </div>
          </div>
          <div class="team-member-metrics">
            <strong>${m.totalPoints}</strong>
            <small>pts acumulados</small>
          </div>
        </div>
      `).join('') : '<p style="color:#8a8da0;font-size:12px;padding:12px 0;">Nenhum colaborador encontrado.</p>'}
    </div>
  `;
}

// ==========================================================================
// EVENTOS E INTERAÇÃO
// ==========================================================================

function bindEvents() {
  const host = $('#tasksApp');
  if (!host) return;

  // Troca de abas principais
  $$('[data-cf-tab]', host).forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.cfTab;
      renderApp();
    });
  });

  // Abas mobile de status
  $$('[data-mobile-status]', host).forEach(btn => {
    btn.addEventListener('click', () => {
      state.mobileStatus = btn.dataset.mobileStatus;
      renderApp();
    });
  });

  // Filtros de atenção
  $$('[data-attention]', host).forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.attention;
      state.attentionFilter = state.attentionFilter === type ? '' : type;
      renderApp();
    });
  });

  $('#cfClearAttention')?.addEventListener('click', () => {
    state.attentionFilter = '';
    renderApp();
  });

  // Busca e Filtros
  $('#cfTaskSearch')?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderApp();
  });

  $('#cfTaskAssigneeFilter')?.addEventListener('change', (e) => {
    state.filterAssignee = e.target.value;
    renderApp();
  });

  $('#cfTaskPriorityFilter')?.addEventListener('change', (e) => {
    state.filterPriority = e.target.value;
    renderApp();
  });

  $('#cfBtnRefreshTasks')?.addEventListener('click', () => {
    loadData();
  });

  $('#cfBtnNewTask')?.addEventListener('click', () => {
    openNewTaskModal();
  });

  $('#cfBtnPenalty')?.addEventListener('click', () => {
    openPenaltyModal();
  });

  // Ações nos Cards
  $$('[data-cf-action]', host).forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.cfAction;
      const taskId = btn.dataset.taskId;
      const rewardId = btn.dataset.rewardId;
      const redemptionId = btn.dataset.redemptionId;

      if (action === 'start') {
        await handleTaskStart(taskId);
      } else if (action === 'complete') {
        openCompleteModal(taskId);
      } else if (action === 'approve') {
        await handleTaskApprove(taskId);
      } else if (action === 'reject') {
        openRejectModal(taskId);
      } else if (action === 'cancel') {
        openCancelModal(taskId);
      } else if (action === 'reopen') {
        await handleTaskReopen(taskId);
      } else if (action === 'edit') {
        openEditTaskModal(taskId);
      } else if (action === 'view-evidence') {
        openEvidenceModal(taskId);
      } else if (action === 'redeem') {
        await handleRewardRedeem(rewardId);
      } else if (action === 'deliver-reward') {
        await handleDeliverReward(redemptionId);
      }
    });
  });
}

// ==========================================================================
// AÇÕES DE TAREFA (HANDLERS)
// ==========================================================================

async function handleTaskStart(taskId) {
  try {
    btnLoading(true);
    await callApi('cozinhaTasksStart', [taskId]);
    toast("Tarefa iniciada!");
    await loadData();
  } catch (err) {
    alert(err.message || "Erro ao iniciar tarefa.");
  } finally {
    btnLoading(false);
  }
}

async function handleTaskApprove(taskId) {
  try {
    btnLoading(true);
    const res = await callApi('cozinhaTasksApprove', [taskId]);
    toast(res?.message || "Tarefa aprovada e pontos concedidos!");
    await loadData();
  } catch (err) {
    alert(err.message || "Erro ao aprovar tarefa.");
  } finally {
    btnLoading(false);
  }
}

async function handleTaskReopen(taskId) {
  try {
    btnLoading(true);
    await callApi('cozinhaTasksReopen', [taskId]);
    toast("Tarefa reaberta!");
    await loadData();
  } catch (err) {
    alert(err.message || "Erro ao reabrir tarefa.");
  } finally {
    btnLoading(false);
  }
}

async function handleRewardRedeem(rewardId) {
  const reward = state.catalog.find(r => String(r.ID) === String(rewardId));
  if (!reward) return;

  if (!confirm(`Deseja resgatar "${reward.NOME || reward.name}" por ${reward.cost || reward.PONTOS} pontos?`)) {
    return;
  }

  try {
    btnLoading(true);
    const res = await callApi('cozinhaPointRedeem', [{ rewardId }]);
    toast(res?.message || "Resgate solicitado com sucesso!");
    await loadData();
  } catch (err) {
    alert(err.message || "Erro ao resgatar produto.");
  } finally {
    btnLoading(false);
  }
}

async function handleDeliverReward(redemptionId) {
  if (!confirm("Confirmar que a recompensa foi entregue ao colaborador?")) return;

  try {
    btnLoading(true);
    await callApi('cozinhaPointDeliver', [{ id: redemptionId }]);
    toast("Recompensa entregue!");
    await loadData();
  } catch (err) {
    alert(err.message || "Erro ao marcar entrega.");
  } finally {
    btnLoading(false);
  }
}

// ==========================================================================
// MODAIS
// ==========================================================================

function openNewTaskModal() {
  const modal = createModalElement('Nova Tarefa CozinhaFlow', 'Atribua a atividade com orientação clara para a equipe');
  modal.querySelector('.cf-modal-body').innerHTML = `
    <form id="cfNewTaskForm" style="display:grid;gap:14px;">
      <div>
        <label>Título da Tarefa *</label>
        <input type="text" name="TITULO" required placeholder="Ex.: Limpeza e higienização da chapa">
      </div>
      <div>
        <label>Colaborador Responsável *</label>
        <select name="RESPONSAVEL_ID" required>
          <option value="">Selecione o funcionário...</option>
          ${state.assignees.map(a => `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.role)})</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Prioridade da Atividade</label>
        <div class="task-priority-chips">
          <label class="task-priority-chip">
            <input type="radio" name="PRIORIDADE" value="Normal" checked>
            <span><strong>Normal</strong><small>+1 pt</small></span>
          </label>
          <label class="task-priority-chip">
            <input type="radio" name="PRIORIDADE" value="Alta">
            <span><strong>Alta</strong><small>+2 pts</small></span>
          </label>
          <label class="task-priority-chip">
            <input type="radio" name="PRIORIDADE" value="Urgente">
            <span><strong>Urgente</strong><small>+3 pts</small></span>
          </label>
          <label class="task-priority-chip">
            <input type="radio" name="PRIORIDADE" value="Baixa">
            <span><strong>Baixa</strong><small>+1 pt</small></span>
          </label>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label>Prazo Limite</label>
          <input type="datetime-local" name="PRAZO">
        </div>
        <div>
          <label>Recorrência</label>
          <select name="RECORRENCIA">
            <option value="Nenhuma">Única (Não repete)</option>
            <option value="Diária">Diária (Todos os dias)</option>
          </select>
        </div>
      </div>
      <div>
        <label>O que deve aparecer na foto de conclusão</label>
        <input type="text" name="ORIENTACAO_FOTO" placeholder="Ex.: Foto ampla mostrando a chapa limpa e desligada">
      </div>
      <div>
        <label>Instruções detalhadas (opcional)</label>
        <textarea name="DESCRICAO" rows="2" placeholder="Passo a passo, produtos adequados ou observações"></textarea>
      </div>
    </form>
  `;

  modal.querySelector('.cf-modal-foot').innerHTML = `
    <button type="button" class="task-action-btn light" data-close-modal>Cancelar</button>
    <button type="button" class="task-action-btn primary btn-glow" id="cfSaveNewTask">
      <span class="material-symbols-rounded">add_task</span>
      <span>Salvar e Atribuir Tarefa</span>
    </button>
  `;

  $('#cfSaveNewTask', modal).addEventListener('click', async () => {
    const form = $('#cfNewTaskForm', modal);
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.TITULO?.trim() || !data.RESPONSAVEL_ID) {
      alert("Preencha o título e selecione o colaborador.");
      return;
    }
    const assignee = state.assignees.find(a => a.id === data.RESPONSAVEL_ID);
    data.RESPONSAVEL_NOME = assignee?.name || '';
    data.RESPONSAVEL_EMAIL = assignee?.email || '';

    try {
      btnLoading(true);
      await callApi('cozinhaTasksSave', [data]);
      modal.remove();
      toast("Tarefa criada e atribuída com sucesso! 🚀");
      await loadData();
    } catch (err) {
      alert(err.message || "Erro ao salvar tarefa.");
    } finally {
      btnLoading(false);
    }
  });
}

function openEditTaskModal(taskId) {
  const task = state.tasks.find(t => t.ID === taskId);
  if (!task) return;

  const modal = createModalElement('Editar Tarefa', 'Ajuste os dados e prazos da atividade');
  modal.querySelector('.cf-modal-body').innerHTML = `
    <form id="cfEditTaskForm" style="display:grid;gap:14px;">
      <div>
        <label>Título da Tarefa *</label>
        <input type="text" name="TITULO" value="${esc(task.TITULO)}" required>
      </div>
      <div>
        <label>Colaborador Responsável *</label>
        <select name="RESPONSAVEL_ID" required>
          ${state.assignees.map(a => `<option value="${esc(a.id)}" ${String(task.RESPONSAVEL_ID) === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Prioridade</label>
        <div class="task-priority-chips">
          <label class="task-priority-chip">
            <input type="radio" name="PRIORIDADE" value="Normal" ${task.PRIORIDADE === 'Normal' ? 'checked' : ''}>
            <span><strong>Normal</strong><small>+1 pt</small></span>
          </label>
          <label class="task-priority-chip">
            <input type="radio" name="PRIORIDADE" value="Alta" ${task.PRIORIDADE === 'Alta' ? 'checked' : ''}>
            <span><strong>Alta</strong><small>+2 pts</small></span>
          </label>
          <label class="task-priority-chip">
            <input type="radio" name="PRIORIDADE" value="Urgente" ${task.PRIORIDADE === 'Urgente' ? 'checked' : ''}>
            <span><strong>Urgente</strong><small>+3 pts</small></span>
          </label>
          <label class="task-priority-chip">
            <input type="radio" name="PRIORIDADE" value="Baixa" ${task.PRIORIDADE === 'Baixa' ? 'checked' : ''}>
            <span><strong>Baixa</strong><small>+1 pt</small></span>
          </label>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label>Prazo Limite</label>
          <input type="datetime-local" name="PRAZO" value="${esc(task.PRAZO ? task.PRAZO.slice(0, 16) : '')}">
        </div>
        <div>
          <label>Recorrência</label>
          <select name="RECORRENCIA">
            <option value="Nenhuma" ${task.RECORRENCIA === 'Nenhuma' ? 'selected' : ''}>Única (Não repete)</option>
            <option value="Diária" ${task.RECORRENCIA === 'Diária' ? 'selected' : ''}>Diária (Todos os dias)</option>
          </select>
        </div>
      </div>
      <div>
        <label>O que deve aparecer na foto</label>
        <input type="text" name="ORIENTACAO_FOTO" value="${esc(task.ORIENTACAO_FOTO || '')}" placeholder="Ex.: forno limpo e desligado">
      </div>
      <div>
        <label>Descrição</label>
        <textarea name="DESCRICAO" rows="2">${esc(task.DESCRICAO)}</textarea>
      </div>
    </form>
  `;

  modal.querySelector('.cf-modal-foot').innerHTML = `
    <button type="button" class="task-action-btn light" data-close-modal>Cancelar</button>
    <button type="button" class="task-action-btn primary btn-glow" id="cfSaveEditTask">Salvar Alterações</button>
  `;

  $('#cfSaveEditTask', modal).addEventListener('click', async () => {
    const form = $('#cfEditTaskForm', modal);
    const data = Object.fromEntries(new FormData(form).entries());
    data.ID = taskId;
    const assignee = state.assignees.find(a => a.id === data.RESPONSAVEL_ID);
    if (assignee) {
      data.RESPONSAVEL_NOME = assignee.name;
      data.RESPONSAVEL_EMAIL = assignee.email;
    }

    try {
      btnLoading(true);
      await callApi('cozinhaTasksSave', [data]);
      modal.remove();
      toast("Tarefa atualizada com sucesso!");
      await loadData();
    } catch (err) {
      alert(err.message || "Erro ao salvar.");
    } finally {
      btnLoading(false);
    }
  });
}

function openCompleteModal(taskId) {
  const task = state.tasks.find(t => t.ID === taskId);
  if (!task) return;

  const pointsWon = taskPointValue(task.PRIORIDADE);
  const modal = createModalElement('Concluir Tarefa com Foto', 'Envie a comprovação visual para aprovação e pontuação');
  
  modal.querySelector('.cf-modal-body').innerHTML = `
    <div style="display:grid;gap:14px;">
      <div class="task-complete-summary">
        <span class="material-symbols-rounded">assignment_turned_in</span>
        <div>
          <small>Tarefa a concluir</small>
          <strong>${esc(task.TITULO)}</strong>
        </div>
      </div>

      <div class="task-camera-guide">
        <span class="material-symbols-rounded">center_focus_strong</span>
        <div>
          <small>Mostre na foto</small>
          <strong>${esc(task.ORIENTACAO_FOTO || `o resultado completo de “${task.TITULO}”`)}</strong>
          <span>A foto receberá automaticamente carimbo de data, hora e seu nome.</span>
        </div>
      </div>

      <div>
        <label>Foto da atividade concluída *</label>
        <input id="taskEvidenceFile" type="file" accept="image/*" capture="environment" class="task-photo-input">
        <label class="task-photo-picker" for="taskEvidenceFile">
          <span class="material-symbols-rounded">photo_camera</span>
          <span>
            <strong>Tirar ou escolher foto</strong>
            <small id="taskPhotoFileName">Nenhuma foto selecionada</small>
          </span>
        </label>
        <div id="taskPhotoPreview" class="task-photo-preview" style="display:none;">
          <img src="" alt="Prévia da foto">
          <div>
            <strong>Foto pronta e carimbada!</strong>
            <small style="display:block;color:#15803d;font-size:11px;">Toque na câmera se desejar trocar.</small>
          </div>
        </div>
      </div>

      <div>
        <label>Observação da conclusão (opcional)</label>
        <textarea id="cfCompleteObs" rows="2" placeholder="Algum detalhe relevante sobre a execução?"></textarea>
      </div>

      <div>
        <label class="task-confirm-check">
          <input type="checkbox" id="cfConfirmCheck" checked>
          <span>
            <strong>Confirmo que executei esta tarefa.</strong>
            <small>A conclusão ficará registrada com meu usuário, data, hora e foto.</small>
          </span>
        </label>
      </div>
    </div>
  `;

  modal.querySelector('.cf-modal-foot').innerHTML = `
    <button type="button" class="task-action-btn light" data-close-modal>Cancelar</button>
    <button type="button" class="task-action-btn primary btn-glow" id="cfSubmitComplete">
      <span class="material-symbols-rounded">send</span>
      <span>🚀 Enviar Comprovação (+${pointsWon} pts)</span>
    </button>
  `;

  let currentBase64 = '';
  const fileInput = $('#taskEvidenceFile', modal);
  const preview = $('#taskPhotoPreview', modal);
  const previewImg = $('img', preview);
  const fileNameLabel = $('#taskPhotoFileName', modal);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    fileNameLabel.textContent = file.name;
    try {
      const processed = await processPhoto(file, task.TITULO);
      currentBase64 = processed.base64;
      previewImg.src = currentBase64;
      preview.style.display = 'flex';
      preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      alert("Erro ao preparar foto: " + err.message);
    }
  });

  $('#cfSubmitComplete', modal).addEventListener('click', async () => {
    const confirmCheck = $('#cfConfirmCheck', modal);
    if (!confirmCheck?.checked) {
      alert("Por favor, marque a caixa confirmando a execução da tarefa.");
      return;
    }

    if (!currentBase64) {
      alert("A foto comprobatória é obrigatória. Toque em 'Tirar ou escolher foto'.");
      return;
    }

    const obs = $('#cfCompleteObs', modal).value;

    const submitBtn = $('#cfSubmitComplete', modal);
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Enviando foto...</span>`;

    try {
      btnLoading(true);
      // Upload para Google Drive (com fallback para base64)
      let photoUrl = currentBase64;
      try {
        const driveRes = await uploadPhotoToDrive(currentBase64, `task_${taskId}.jpg`);
        if (driveRes?.url) photoUrl = driveRes.url;
      } catch (uploadErr) {
        console.warn("Drive upload fallback:", uploadErr);
      }

      await callApi('cozinhaTasksComplete', [{
        taskId,
        fotoUrl: photoUrl,
        observacao: obs,
      }]);

      modal.remove();
      await loadData();
      const updatedBalance = computeUserBalance();
      showTaskCelebration({
        task,
        pointsWon,
        newLevelInfo: updatedBalance.levelInfo,
        totalEarned: updatedBalance.totalEarned,
        available: updatedBalance.available
      });
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
      alert(err.message || "Erro ao concluir tarefa.");
    } finally {
      btnLoading(false);
    }
  });
}

function showTaskCelebration({ task, pointsWon, newLevelInfo, totalEarned, available }) {
  // Feedback tátil
  try {
    if (navigator.vibrate) navigator.vibrate([60, 40, 80]);
  } catch (_) {}

  const overlay = document.createElement('div');
  overlay.className = 'cf-celebration-overlay';

  // Gerar pedaços de confetes coloridos
  const colors = ['#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#6366f1', '#f43f5e'];
  let confettiHtml = '<div class="cf-confetti-container">';
  for (let i = 0; i < 35; i++) {
    const left = Math.random() * 100;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const duration = 2.2 + Math.random() * 2.5;
    const delay = Math.random() * 0.8;
    const size = 7 + Math.random() * 7;
    const isCircle = Math.random() > 0.5;
    confettiHtml += `<div class="cf-confetti-piece" style="left:${left}vw;width:${size}px;height:${size * (isCircle ? 1 : 1.6)}px;background:${color};border-radius:${isCircle ? '50%' : '3px'};animation-duration:${duration}s;animation-delay:${delay}s;"></div>`;
  }
  confettiHtml += '</div>';

  const { level, nextLevel, progress, pointsNeeded } = newLevelInfo;

  overlay.innerHTML = `
    ${confettiHtml}
    <div class="cf-celebration-card">
      <div class="cf-celebrate-badge-wrap">
        <span>${level.emoji}</span>
      </div>
      <h2 class="cf-celebrate-title">Parabéns! Mandou muito bem! 🎉</h2>
      <p class="cf-celebrate-task-name">${esc(task.TITULO)}</p>
      
      <div class="cf-celebration-points-badge">
        <span>⭐</span>
        <strong>+${pointsWon} Pts Adicionados à sua Carteira</strong>
      </div>

      <div class="cf-celebrate-level-box">
        <div class="cf-celebrate-level-header">
          <span class="cf-celebrate-level-title">${level.emoji} ${esc(level.name)}</span>
          <span class="cf-celebrate-level-points">${available} pts na loja</span>
        </div>
        <div class="cf-celebrate-bar-wrap">
          <div class="cf-celebrate-bar-fill" style="width: ${progress}%;"></div>
        </div>
        <div class="cf-celebrate-level-footer">
          ${nextLevel ? `Faltam <strong>${pointsNeeded} pts</strong> para alcançar ${nextLevel.emoji} ${esc(nextLevel.name)}` : '🏆 Nível Máximo de Maestria da Cozinha!'}
        </div>
      </div>

      <button type="button" class="cf-celebrate-btn" id="cfCloseCelebration">
        Continuar Mandando Bem! 🚀
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    overlay.style.transition = 'opacity .25s ease';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 250);
  };

  overlay.querySelector('#cfCloseCelebration').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Notificar o ecossistema
  window.dispatchEvent(new CustomEvent('cozinha-tasks-updated', {
    detail: { available, totalEarned, levelInfo: newLevelInfo }
  }));
}

function openRejectModal(taskId) {
  const modal = createModalElement('Pedir Nova Foto');
  modal.querySelector('.cf-modal-body').innerHTML = `
    <div style="display:grid;gap:12px;">
      <p style="font-size:12.5px;color:#64748b;">Informe o motivo pelo qual a foto foi recusada para que o colaborador corrija:</p>
      <textarea id="cfRejectReason" rows="3" placeholder="Ex.: Foto embaçada / ângulo não mostra o fechamento do equipamento" required></textarea>
    </div>
  `;

  modal.querySelector('.cf-modal-foot').innerHTML = `
    <button type="button" class="task-action-btn light" data-close-modal>Cancelar</button>
    <button type="button" class="task-action-btn danger" id="cfConfirmReject">Devolver Tarefa</button>
  `;

  $('#cfConfirmReject', modal).addEventListener('click', async () => {
    const reason = $('#cfRejectReason', modal).value.trim();
    if (!reason) {
      alert("Informe o motivo da devolução.");
      return;
    }

    try {
      btnLoading(true);
      await callApi('cozinhaTasksReject', [{ taskId, reason }]);
      modal.remove();
      toast("Tarefa devolvida com sucesso.");
      await loadData();
    } catch (err) {
      alert(err.message || "Erro ao devolver tarefa.");
    } finally {
      btnLoading(false);
    }
  });
}

function openCancelModal(taskId) {
  const modal = createModalElement('Cancelar Tarefa');
  modal.querySelector('.cf-modal-body').innerHTML = `
    <div style="display:grid;gap:12px;">
      <p style="font-size:12.5px;color:#64748b;">Ao cancelar uma tarefa não executada, você pode aplicar uma penalidade de pontos:</p>
      <div>
        <label>Motivo do cancelamento *</label>
        <textarea id="cfCancelReason" rows="2" placeholder="Ex.: O colaborador não realizou no prazo do turno" required></textarea>
      </div>
      <div>
        <label>Penalidade de pontos (0 se não houver penalidade)</label>
        <input type="number" id="cfCancelPoints" value="0" min="0" max="10">
      </div>
    </div>
  `;

  modal.querySelector('.cf-modal-foot').innerHTML = `
    <button type="button" class="task-action-btn light" data-close-modal>Voltar</button>
    <button type="button" class="task-action-btn danger" id="cfConfirmCancel">Confirmar Cancelamento</button>
  `;

  $('#cfConfirmCancel', modal).addEventListener('click', async () => {
    const reason = $('#cfCancelReason', modal).value.trim();
    const points = Number($('#cfCancelPoints', modal).value || 0);

    try {
      btnLoading(true);
      await callApi('cozinhaTasksCancel', [{ taskId, reason, points }]);
      modal.remove();
      toast("Tarefa cancelada.");
      await loadData();
    } catch (err) {
      alert(err.message || "Erro ao cancelar tarefa.");
    } finally {
      btnLoading(false);
    }
  });
}

function openEvidenceModal(taskId) {
  const task = state.tasks.find(t => t.ID === taskId);
  if (!task || !task.FOTO_URL) return;

  const modal = createModalElement('Comprovante da Tarefa');
  modal.querySelector('.cf-modal-body').innerHTML = `
    <div style="display:grid;gap:10px;">
      <div style="border-radius:14px;overflow:hidden;background:#000;border:1px solid #e2e8f0;text-align:center;">
        <img src="${esc(task.FOTO_URL)}" style="max-width:100%;max-height:70vh;object-fit:contain;display:block;margin:auto;">
      </div>
      <div style="font-size:12px;color:#475569;">
        <strong>${esc(task.TITULO)}</strong>
        <p style="margin:2px 0 0;">Concluída por <b>${esc(task.RESPONSAVEL_NOME)}</b></p>
        ${task.OBSERVACAO_CONCLUSAO ? `<p style="margin:4px 0 0;font-style:italic;">"${esc(task.OBSERVACAO_CONCLUSAO)}"</p>` : ''}
      </div>
    </div>
  `;
  modal.querySelector('.cf-modal-foot').innerHTML = `
    <button type="button" class="task-action-btn primary" data-close-modal>Fechar</button>
  `;
}

function openPenaltyModal() {
  const modal = createModalElement('Retirar Pontos (Penalidade Administrativa)');
  modal.querySelector('.cf-modal-body').innerHTML = `
    <div style="display:grid;gap:12px;">
      <div style="padding:10px;border-radius:12px;background:#fef2f2;color:#b91c1c;font-size:12px;">
        ⚠️ Esta ação retira pontos do saldo do colaborador e fica registrada no extrato dele com a justificativa.
      </div>
      <div>
        <label>Colaborador *</label>
        <select id="cfPenUserId" required>
          <option value="">Selecione o funcionário...</option>
          ${state.assignees.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Quantidade de pontos a retirar *</label>
        <input type="number" id="cfPenPoints" min="1" max="100" value="2" required>
      </div>
      <div>
        <label>Motivo obrigatório *</label>
        <textarea id="cfPenReason" rows="3" placeholder="Ex.: Não cumpriu o procedimento de higienização conforme treinado" required></textarea>
      </div>
    </div>
  `;

  modal.querySelector('.cf-modal-foot').innerHTML = `
    <button type="button" class="task-action-btn light" data-close-modal>Cancelar</button>
    <button type="button" class="task-action-btn danger" id="cfConfirmPenalty">Aplicar Penalidade</button>
  `;

  $('#cfConfirmPenalty', modal).addEventListener('click', async () => {
    const userId = $('#cfPenUserId', modal).value;
    const points = Number($('#cfPenPoints', modal).value || 0);
    const reason = $('#cfPenReason', modal).value.trim();

    if (!userId || points <= 0 || !reason) {
      alert("Preencha todos os campos obrigatórios.");
      return;
    }

    try {
      btnLoading(true);
      await callApi('cozinhaPointPenalize', [{ userId, points, reason }]);
      modal.remove();
      toast("Penalidade aplicada com sucesso.");
      await loadData();
    } catch (err) {
      alert(err.message || "Erro ao aplicar penalidade.");
    } finally {
      btnLoading(false);
    }
  });
}

function createModalElement(title, subtitle = '') {
  const backdrop = document.createElement('div');
  backdrop.className = 'cf-modal-backdrop';
  backdrop.innerHTML = `
    <div class="cf-modal-card">
      <div class="cf-modal-head">
        <div>
          <h3>${esc(title)}</h3>
          ${subtitle ? `<p class="cf-modal-sub">${esc(subtitle)}</p>` : ''}
        </div>
        <button type="button" class="cf-modal-close" data-close-modal aria-label="Fechar">&times;</button>
      </div>
      <div class="cf-modal-body"></div>
      <div class="cf-modal-foot"></div>
    </div>
  `;

  document.body.appendChild(backdrop);
  backdrop.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => backdrop.remove());
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  return backdrop;
}

// ==========================================================================
// PROCESSAMENTO E UPLOAD DE FOTOS (GOOGLE DRIVE & CANVAS WATERMARK)
// ==========================================================================

async function processPhoto(file, taskTitle) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Erro ao ler o arquivo."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Formato de imagem inválido."));
      img.onload = () => {
        const maxSide = 1400;
        let w = img.width;
        let h = img.height;
        if (w > maxSide || h > maxSide) {
          if (w > h) {
            h = Math.round((h * maxSide) / w);
            w = maxSide;
          } else {
            w = Math.round((w * maxSide) / h);
            h = maxSide;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Faixa com carimbo no rodapé
        const bannerHeight = Math.max(50, Math.round(h * 0.08));
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(0, h - bannerHeight, w, bannerHeight);

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.max(14, Math.round(bannerHeight * 0.35))}px sans-serif`;
        ctx.fillText(`CozinhaFlow · ${taskTitle || 'Tarefa'}`, 16, h - bannerHeight + bannerHeight * 0.45);

        ctx.font = `${Math.max(11, Math.round(bannerHeight * 0.28))}px sans-serif`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        const dateStr = new Date().toLocaleString('pt-BR');
        ctx.fillText(`${currentUserName()} · ${dateStr}`, 16, h - bannerHeight + bannerHeight * 0.82);

        const base64 = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ base64 });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhotoToDrive(base64, filename) {
  const endpoint = SELFIE_DRIVE_UPLOAD_ENDPOINT;
  if (!endpoint) return { url: base64 };

  const payload = {
    action: 'driveUpload',
    name: filename,
    mimeType: 'image/jpeg',
    base64: base64,
  };

  const formData = new FormData();
  Object.entries(payload).forEach(([k, v]) => formData.append(k, v));

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) throw new Error("Erro no upload do Google Drive.");
  const data = await response.json().catch(() => ({}));
  return data;
}

// ==========================================================================
// TOAST E FEEDBACK
// ==========================================================================

function toast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1e1b4b;
    color: #fff;
    padding: 12px 20px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 750;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
    z-index: 99999;
    animation: cfFadeIn 0.25s ease;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function btnLoading(isLoading) {
  document.body.style.cursor = isLoading ? 'wait' : 'default';
}

// ==========================================================================
// INICIALIZAÇÃO DO MÓDULO
// ==========================================================================

export function initTasksModule(options = {}) {
  if (options.user) state.user = options.user;
  if (options.isManager !== undefined) state.isManager = options.isManager;
  if (!state.user && window.__GESTAO_FIREBASE__?.runtime?.profile) {
    state.user = window.__GESTAO_FIREBASE__.runtime.profile;
    state.isManager = isUserAdmin();
  }
  loadData();
}

window.initTasksModule = initTasksModule;

// Ouvintes de eventos da aplicação Folgas 3.0
window.addEventListener('gestao-tasks-open', (e) => {
  initTasksModule(e.detail || {});
});

window.addEventListener('house-journey', (e) => {
  const detail = e.detail || {};
  if (detail.user) state.user = detail.user;
  state.isManager = isUserAdmin();
  const container = $('#tasksApp');
  if (container && (!container.innerHTML.trim() || $('#view-tasks')?.classList.contains('active'))) {
    loadData();
  }
});

window.addEventListener('gestao-api-ready', () => {
  if (window.__GESTAO_FIREBASE__?.runtime?.profile) {
    state.user = window.__GESTAO_FIREBASE__.runtime.profile;
    state.isManager = isUserAdmin();
  }
  const container = $('#tasksApp');
  if (container && $('#view-tasks')?.classList.contains('active')) {
    initTasksModule();
  }
});
