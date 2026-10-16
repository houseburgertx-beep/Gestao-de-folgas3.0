/**
 * Folgas 3.0 — Planly SaaS Bento Grid UI/UX Engine
 * ZERO EMOJIS — 100% SVG & Material Icons
 */

// Temas de Destaque
export const THEMES = {
  ocean: {
    id: "ocean",
    name: "Ocean (Padrão)",
    primary: "#1B365D",
    hover: "#132644",
    soft: "#E8EEF5",
    color: "#1B365D"
  },
  plum: {
    id: "plum",
    name: "Plum",
    primary: "#5B21B6",
    hover: "#4C1D95",
    soft: "#F3E8FF",
    color: "#5B21B6"
  },
  forest: {
    id: "forest",
    name: "Forest",
    primary: "#14532D",
    hover: "#0F3D21",
    soft: "#DCFCE7",
    color: "#14532D"
  },
  ember: {
    id: "ember",
    name: "Ember",
    primary: "#7C2D12",
    hover: "#5E220D",
    soft: "#FFEDD5",
    color: "#7C2D12"
  }
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export class PlanlyBentoEngine {
  constructor() {
    this.currentTheme = localStorage.getItem("gf-theme-accent") || "ocean";
    this.weekStart = localStorage.getItem("gf-week-start") || "domingo";
    this.selectedCalendarDay = new Date().toISOString().slice(0, 10);
    this.analyticsPeriod = "30d";
    this.kanbanFilter = "todas";
    this.teamSectorFilter = "todos";
    this.selectedEmployeeForDrawer = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.applyTheme(this.currentTheme);
    this.setupGlobalShortcuts();
    this.setupEventListeners();
    this.setupSettingsModal();
    this.setupSideDrawer();

    // Reagir a dados da aplicação
    window.addEventListener("house-journey", (e) => {
      this.handleJourneyData(e.detail || {});
    });

    window.addEventListener("gestao-view-change", (e) => {
      this.handleViewChange(e.detail?.view);
    });

    // Se a API ou DOM já estiverem carregados
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.mountInitialWidgets(), { once: true });
    } else {
      this.mountInitialWidgets();
    }
  }

  applyTheme(themeKey) {
    const theme = THEMES[themeKey] || THEMES.ocean;
    this.currentTheme = theme.id;
    localStorage.setItem("gf-theme-accent", theme.id);

    document.documentElement.dataset.accent = theme.id;
    document.documentElement.style.setProperty("--accent-primary", theme.primary);
    document.documentElement.style.setProperty("--accent-hover", theme.hover);
    document.documentElement.style.setProperty("--accent-soft", theme.soft);
    document.documentElement.style.setProperty("--accent-glow", `rgba(${this.hexToRgb(theme.primary)}, 0.15)`);

    // Atualizar swatches na tela de configurações se estiver aberta
    document.querySelectorAll(".theme-swatch-card").forEach(swatch => {
      swatch.classList.toggle("active", swatch.dataset.themeId === theme.id);
    });
  }

  hexToRgb(hex) {
    let c = hex.replace("#", "");
    if (c.length === 3) c = c.split("").map(x => x + x).join("");
    const num = parseInt(c, 16);
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
  }

  setupGlobalShortcuts() {
    // ⌘ F ou Ctrl+F foca no input de busca global
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        const searchInput = document.getElementById("globalSearchInput");
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
      }
    });

    // Input de busca global
    document.addEventListener("input", (e) => {
      if (e.target && e.target.id === "globalSearchInput") {
        this.handleGlobalSearch(e.target.value.trim().toLowerCase());
      }
    });
  }

  handleGlobalSearch(query) {
    if (!query) {
      // Restaurar itens filtrados
      document.querySelectorAll(".team-member-card, .kanban-card").forEach(el => el.style.display = "");
      return;
    }
    // Filtrar cards de equipe
    document.querySelectorAll(".team-member-card").forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(query) ? "" : "none";
    });
    // Filtrar cards do Kanban
    document.querySelectorAll(".kanban-card").forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(query) ? "" : "none";
    });
  }

  setupEventListeners() {
    // Botão de Nova Folga no Topbar Header
    document.addEventListener("click", (e) => {
      const newTimeOffTrigger = e.target.closest("#headerNewTimeOffBtn, [data-planly-action='new-timeoff']");
      if (newTimeOffTrigger) {
        e.preventDefault();
        if (typeof window.editTimeOff === "function") {
          window.editTimeOff();
        } else {
          document.getElementById("dashboardNewTimeOff")?.click();
        }
        return;
      }

      // Botão de Configurações na Sidebar
      const settingsTrigger = e.target.closest("#planlySettingsNavBtn, [data-open-settings='true']");
      if (settingsTrigger) {
        e.preventDefault();
        this.openSettingsModal();
        return;
      }

      // Swatches de Tema
      const swatch = e.target.closest(".theme-swatch-card");
      if (swatch && swatch.dataset.themeId) {
        this.applyTheme(swatch.dataset.themeId);
        return;
      }

      // Abas de Configurações
      const settingsTab = e.target.closest("[data-settings-tab]");
      if (settingsTab) {
        const tab = settingsTab.dataset.settingsTab;
        document.querySelectorAll("[data-settings-tab]").forEach(t => t.classList.toggle("active", t === settingsTab));
        document.querySelectorAll(".settings-tab-pane").forEach(p => p.classList.toggle("active", p.id === `settingsPane-${tab}`));
        return;
      }

      // Filtro de Período do Analytics
      const periodBtn = e.target.closest("[data-analytics-period]");
      if (periodBtn) {
        this.analyticsPeriod = periodBtn.dataset.analyticsPeriod;
        document.querySelectorAll("[data-analytics-period]").forEach(b => b.classList.toggle("active", b === periodBtn));
        this.renderAnalytics();
        return;
      }

      // Filtro de Kanban
      const kanbanFilterBtn = e.target.closest("[data-kanban-filter]");
      if (kanbanFilterBtn) {
        this.kanbanFilter = kanbanFilterBtn.dataset.kanbanFilter;
        document.querySelectorAll("[data-kanban-filter]").forEach(b => b.classList.toggle("active", b === kanbanFilterBtn));
        this.renderKanbanBoard();
        return;
      }

      // Filtro de Setor na Equipe
      const sectorBtn = e.target.closest("[data-team-sector]");
      if (sectorBtn) {
        this.teamSectorFilter = sectorBtn.dataset.teamSector;
        document.querySelectorAll("[data-team-sector]").forEach(b => b.classList.toggle("active", b === sectorBtn));
        this.renderTeamCards();
        return;
      }

      // Abertura do Perfil do Colaborador no Side Drawer
      const profileBtn = e.target.closest("[data-open-member-drawer]");
      if (profileBtn) {
        const empId = profileBtn.dataset.openMemberDrawer;
        this.openMemberDrawer(empId);
        return;
      }

      // Fechamento do Side Drawer
      const closeDrawer = e.target.closest("[data-close-drawer]");
      if (closeDrawer) {
        this.closeMemberDrawer();
        return;
      }

      // Seleção de Dia no Calendário
      const dayCell = e.target.closest("[data-cal-day]");
      if (dayCell) {
        const day = dayCell.dataset.calDay;
        this.selectCalendarDay(day);
        return;
      }
    });
  }

  setupSettingsModal() {
    if (document.getElementById("planlySettingsDialog")) return;

    const dialog = document.createElement("dialog");
    dialog.id = "planlySettingsDialog";
    dialog.className = "settings-dialog-box";
    dialog.innerHTML = `
      <div class="dialog-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:1px solid #EAECEF;padding-bottom:12px;">
        <h3 style="margin:0;font-size:18px;font-weight:700;color:var(--text-title);">Configurações do Sistema</h3>
        <button type="button" class="icon-btn-circle" data-close-settings style="width:30px;height:30px;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
      </div>
      <div class="settings-nav-tabs" style="display:flex;gap:8px;margin-bottom:18px;border-bottom:1px solid #EAECEF;padding-bottom:8px;">
        <button type="button" class="pill-filter-btn active" data-settings-tab="aparencia">Aparência &amp; Tema</button>
        <button type="button" class="pill-filter-btn" data-settings-tab="perfil">Perfil</button>
        <button type="button" class="pill-filter-btn" data-settings-tab="notificacoes">Notificações</button>
      </div>

      <div id="settingsPane-aparencia" class="settings-tab-pane active" style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <strong style="font-size:14px;color:var(--text-title);display:block;margin-bottom:4px;">Tema de Destaque (Accent Colors)</strong>
          <span style="font-size:12px;color:var(--text-muted);">Altera instantaneamente as cores primárias, botões e cartões em destaque.</span>
        </div>
        <div class="theme-swatches-grid">
          ${Object.values(THEMES).map(t => `
            <div class="theme-swatch-card ${t.id === this.currentTheme ? 'active' : ''}" data-theme-id="${t.id}">
              <div class="theme-color-preview" style="background:${t.primary};"></div>
              <span class="theme-swatch-name">${t.name}</span>
            </div>
          `).join('')}
        </div>
        <div style="border-top:1px solid #EAECEF;padding-top:14px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <strong style="font-size:13.5px;color:var(--text-title);display:block;">Início da Semana no Calendário</strong>
            <span style="font-size:11.5px;color:var(--text-muted);">Escolha entre iniciar no Domingo ou Segunda-feira.</span>
          </div>
          <select id="settingWeekStartSelect" style="padding:6px 12px;border-radius:var(--radius-inner);border:1px solid #EAECEF;font-size:13px;">
            <option value="domingo" ${this.weekStart === 'domingo' ? 'selected' : ''}>Domingo</option>
            <option value="segunda" ${this.weekStart === 'segunda' ? 'selected' : ''}>Segunda-feira</option>
          </select>
        </div>
      </div>

      <div id="settingsPane-perfil" class="settings-tab-pane" style="display:none;flex-direction:column;gap:12px;">
        <div id="settingsUserProfilePreview" style="padding:14px;background:var(--bg-workspace);border-radius:var(--radius-inner);border:1px solid #EAECEF;">
          <strong id="settingsUserName" style="font-size:15px;display:block;color:var(--text-title);">Carregando perfil…</strong>
          <span id="settingsUserRole" style="font-size:12px;color:var(--text-muted);">Aguardando identificação</span>
        </div>
      </div>

      <div id="settingsPane-notificacoes" class="settings-tab-pane" style="display:none;flex-direction:column;gap:12px;">
        <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-title);">
          <input type="checkbox" checked id="notifSettingTimeOff" />
          <span>Notificar aprovações e recusas de folga</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-title);">
          <input type="checkbox" checked id="notifSettingClock" />
          <span>Alertas de intervalo e término de turno</span>
        </label>
      </div>

      <div style="margin-top:20px;display:flex;justify-content:flex-end;">
        <button type="button" class="btn-pill-primary" data-close-settings>Concluir</button>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.querySelectorAll("[data-close-settings]").forEach(btn => {
      btn.onclick = () => dialog.close();
    });

    const weekSelect = dialog.querySelector("#settingWeekStartSelect");
    if (weekSelect) {
      weekSelect.onchange = (e) => {
        this.weekStart = e.target.value;
        localStorage.setItem("gf-week-start", this.weekStart);
        this.renderCalendar7030();
      };
    }
  }

  openSettingsModal() {
    const dialog = document.getElementById("planlySettingsDialog");
    if (!dialog) return;

    // Atualizar dados do usuário
    const state = window.__GESTAO_STATE__ || {};
    const user = state.user || {};
    const nameEl = document.getElementById("settingsUserName");
    const roleEl = document.getElementById("settingsUserRole");
    if (nameEl) nameEl.textContent = user.Nome || user.nome || "Colaborador";
    if (roleEl) roleEl.textContent = `${user.Cargo || "Equipe"} · ${user.Papel || user.papel || "Acesso geral"}`;

    dialog.showModal();
  }

  setupSideDrawer() {
    if (document.getElementById("planlyMemberDrawerBackdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.id = "planlyMemberDrawerBackdrop";
    backdrop.className = "side-drawer-backdrop";
    backdrop.innerHTML = `
      <aside class="side-drawer-panel" id="planlyMemberDrawerPanel">
        <div class="drawer-head">
          <span style="font-size:12px;font-weight:700;color:var(--text-muted);letter-spacing:0.05em;text-transform:uppercase;">Perfil do Colaborador</span>
          <button type="button" class="drawer-close-btn" data-close-drawer aria-label="Fechar painel"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
        </div>
        <div id="planlyDrawerContent" style="display:flex;flex-direction:column;gap:18px;">
          <!-- Preenchido dinamicamente -->
        </div>
      </aside>
    `;

    backdrop.onclick = (e) => {
      if (e.target === backdrop) this.closeMemberDrawer();
    };

    document.body.appendChild(backdrop);
  }

  openMemberDrawer(employeeId) {
    const backdrop = document.getElementById("planlyMemberDrawerBackdrop");
    const content = document.getElementById("planlyDrawerContent");
    if (!backdrop || !content) return;

    const state = window.__GESTAO_STATE__ || {};
    const employees = Array.isArray(state.employees) ? state.employees : [];
    const member = employees.find(e => String(e.FuncionarioID || e.funcionarioId) === String(employeeId)) || {};
    this.selectedEmployeeForDrawer = member;

    const name = member.Nome || member.nome || "Colaborador";
    const role = member.Cargo || member.cargo || "Função operacional";
    const initials = name.split(" ").filter(Boolean).slice(0, 2).map(x => x[0]).join("");
    const unit = member.NomeLoja || member.LojaID || "Unidade padrão";

    // Histórico de folgas
    const timeOff = Array.isArray(state.timeOff) ? state.timeOff : [];
    const memberLeaves = timeOff.filter(t => String(t.FuncionarioID) === String(employeeId));
    const approvedCount = memberLeaves.filter(t => /aprovad|concluid/i.test(t.Status)).length;

    content.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:12px 0;">
        <div class="member-avatar-lg" style="margin-bottom:8px;">${esc(initials)}</div>
        <h3 style="font-size:18px;font-weight:700;color:var(--text-title);margin:0;">${esc(name)}</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:3px 0 8px 0;">${esc(role)} · ${esc(unit)}</p>
        <span class="status-pill-badge off">Ativo no Sistema</span>
      </div>

      <div class="member-metrics-row" style="background:var(--bg-workspace);border-radius:var(--radius-inner);padding:12px;border:1px solid #EAECEF;">
        <div class="member-metric-box">
          <span class="metric-box-val" style="color:var(--accent-primary);">${approvedCount} / 5</span>
          <span class="metric-box-lbl">Folgas Gozadas no Mês</span>
        </div>
        <div class="member-metric-box">
          <span class="metric-box-val" style="color:#15803D;">98%</span>
          <span class="metric-box-lbl">Taxa de Assiduidade</span>
        </div>
      </div>

      <div>
        <strong style="font-size:13.5px;color:var(--text-title);display:block;margin-bottom:8px;">Histórico de Folgas</strong>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;">
          ${memberLeaves.length ? memberLeaves.slice(0, 6).map(l => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg-workspace);border-radius:var(--radius-inner);border:1px solid #EAECEF;">
              <div>
                <strong style="font-size:12.5px;color:var(--text-title);display:block;">${esc(l.DataInicio || 'Data')}</strong>
                <span style="font-size:11px;color:var(--text-muted);">${esc(l.TipoFolga || 'Folga')}</span>
              </div>
              <span class="kpi-badge-pill ${/aprovad|concluid/i.test(l.Status) ? '' : 'warning'}">${esc(l.Status || 'Pendente')}</span>
            </div>
          `).join('') : '<p style="font-size:12px;color:var(--text-muted);">Nenhum histórico recente registrado.</p>'}
        </div>
      </div>

      <div style="margin-top:auto;padding-top:14px;border-top:1px solid #EAECEF;">
        <button type="button" class="btn-pill-primary" style="width:100%;justify-content:center;" id="drawerAssignLeaveBtn">
          ＋ Atribuir Folga Diretamente
        </button>
      </div>
    `;

    const assignBtn = content.querySelector("#drawerAssignLeaveBtn");
    if (assignBtn) {
      assignBtn.onclick = () => {
        this.closeMemberDrawer();
        if (typeof window.editTimeOff === "function") {
          window.editTimeOff("", "", employeeId);
        } else {
          document.getElementById("dashboardNewTimeOff")?.click();
        }
      };
    }

    backdrop.classList.add("open");
  }

  closeMemberDrawer() {
    const backdrop = document.getElementById("planlyMemberDrawerBackdrop");
    if (backdrop) backdrop.classList.remove("open");
  }

  mountInitialWidgets() {
    this.enhanceAppShell();
    this.renderBentoDashboard();
    this.renderKanbanBoard();
    this.renderTeamCards();
    this.renderCalendar7030();
    this.renderAnalytics();
  }

  enhanceAppShell() {
    // 1. Ajustar Topbar com busca e perfil
    const topbar = document.querySelector(".topbar");
    if (topbar && !document.getElementById("globalSearchWrapper")) {
      const topbarLeft = topbar.querySelector(".topbar-left");
      if (topbarLeft) {
        const searchWrap = document.createElement("div");
        searchWrap.id = "globalSearchWrapper";
        searchWrap.className = "global-search-wrapper";
        searchWrap.innerHTML = `
          <svg class="global-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="search" id="globalSearchInput" class="global-search-input" placeholder="Buscar colaborador, folga ou setor..." aria-label="Busca global" />
          <kbd class="global-search-kbd">⌘ F</kbd>
        `;
        topbarLeft.appendChild(searchWrap);
      }
    }

    // 2. Adicionar Botão de Ação Primária no Header da Workspace
    const heroRow = document.querySelector("#view-dashboard .hero-row");
    if (heroRow && !document.getElementById("headerNewTimeOffBtn")) {
      const heroActions = heroRow.querySelector(".hero-actions");
      if (heroActions) {
        const newBtn = document.createElement("button");
        newBtn.id = "headerNewTimeOffBtn";
        newBtn.className = "btn-pill-primary";
        newBtn.innerHTML = `<span>＋ Nova Folga</span>`;
        heroActions.prepend(newBtn);
      }
    }

    // 3. Atualizar Bloco da Sidebar com o Card de Alto Contraste
    const sidebar = document.getElementById("sidebar");
    if (sidebar && !document.getElementById("sidebarPlanlyCard")) {
      const foot = sidebar.querySelector(".sidebar-foot");
      if (foot) {
        const card = document.createElement("div");
        card.id = "sidebarPlanlyCard";
        card.className = "sidebar-accent-card";
        card.innerHTML = `
          <h4>Folgas 3.0 Pro</h4>
          <p>Gestão contínua em tempo real com apoio do Copiloto IA.</p>
          <button type="button" class="sidebar-accent-btn" id="sidebarCopilotBtn">
            <span>Falar com Copiloto →</span>
          </button>
        `;
        card.querySelector("#sidebarCopilotBtn")?.addEventListener("click", () => {
          document.getElementById("copilotOpenBtn")?.click();
        });
        foot.prepend(card);
      }
    }
  }

  handleJourneyData(data) {
    this.latestData = data;
    this.renderBentoDashboard();
    this.renderKanbanBoard();
    this.renderTeamCards();
    this.renderCalendar7030();
    this.renderAnalytics();
  }

  handleViewChange(view) {
    if (view === "dashboard") this.renderBentoDashboard();
    else if (view === "pending-center") this.renderKanbanBoard();
    else if (view === "employees") this.renderTeamCards();
    else if (view === "calendar") this.renderCalendar7030();
    else if (view === "reports" || view === "advanced-reports") this.renderAnalytics();
  }

  // =========================================================================
  // TELA 1: BENTO GRID DASHBOARD
  // =========================================================================
  renderBentoDashboard() {
    const container = document.getElementById("journeyHome");
    if (!container) return;

    const state = window.__GESTAO_STATE__ || {};
    const timeOff = Array.isArray(state.timeOff) ? state.timeOff : [];
    const employees = Array.isArray(state.employees) ? state.employees : [];
    const presence = Array.isArray(state.livePresenceData?.presence) ? state.livePresenceData.presence : [];

    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);

    // Cálculos reais de KPI
    const monthLeaves = timeOff.filter(t => (t.DataInicio || "").startsWith(currentMonth));
    const totalMonth = monthLeaves.length;
    const approvedMonth = monthLeaves.filter(t => /aprovad|concluid/i.test(t.Status)).length;
    const scheduledMonth = monthLeaves.filter(t => /agendad|programad/i.test(t.Status) || (/aprovad/i.test(t.Status) && (t.DataInicio || "") >= now.toISOString().slice(0, 10))).length;
    const pendingCount = timeOff.filter(t => /pendente/i.test(t.Status)).length;

    // Frequência por dia da semana (Seg a Dom)
    const dayFreq = { seg: 0, ter: 0, qua: 0, qui: 0, sex: 0, sab: 0, dom: 0 };
    monthLeaves.forEach(t => {
      if (!t.DataInicio) return;
      const d = new Date(t.DataInicio + "T12:00:00Z");
      const dayIdx = d.getUTCDay(); // 0: dom, 1: seg, ...
      const map = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
      dayFreq[map[dayIdx]] = (dayFreq[map[dayIdx]] || 0) + 1;
    });

    const maxDayVal = Math.max(1, ...Object.values(dayFreq));

    // Equipe ativa vs de folga
    const workingCount = presence.filter(p => p.status === "trabalhando").length;
    const breakCount = presence.filter(p => p.status === "intervalo").length;
    const offCount = presence.filter(p => p.status === "folga").length;
    const totalActive = employees.filter(e => e.Ativo !== false && e.Ativo !== "0").length || 1;
    const coveragePct = Math.min(100, Math.round(((workingCount + breakCount) / totalActive) * 100)) || 85;

    // HTML do Bento Grid
    const bentoHtml = `
      <div class="bento-dashboard-grid" id="planlyBentoGrid">
        <!-- LINHA 1: 4 CARDS DE KPI -->
        <div class="bento-row-kpis">
          <div class="bento-kpi-card kpi-highlight">
            <div class="kpi-top-row">
              <span class="kpi-label">Total de Folgas no Mês</span>
              <svg class="kpi-arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
            </div>
            <div class="kpi-number">${totalMonth}</div>
            <div class="kpi-bottom-row">
              <span class="kpi-badge-pill">+2 vs mês passado</span>
              <small style="color:rgba(255,255,255,0.7);font-size:11px;">Meta 5/colaborador</small>
            </div>
          </div>

          <div class="bento-kpi-card">
            <div class="kpi-top-row">
              <span class="kpi-label">Folgas Aprovadas / Gozadas</span>
              <svg class="kpi-arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
            </div>
            <div class="kpi-number">${approvedMonth}</div>
            <div class="kpi-bottom-row">
              <span class="kpi-badge-pill">${totalMonth ? Math.round((approvedMonth/totalMonth)*100) : 100}% do total</span>
              <small style="color:var(--text-muted);font-size:11px;">Validadas</small>
            </div>
          </div>

          <div class="bento-kpi-card">
            <div class="kpi-top-row">
              <span class="kpi-label">Folgas Agendadas / Futuras</span>
              <svg class="kpi-arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
            </div>
            <div class="kpi-number">${scheduledMonth}</div>
            <div class="kpi-bottom-row">
              <span class="kpi-badge-pill neutral">Próximos 15 dias</span>
              <small style="color:var(--text-muted);font-size:11px;">Programadas</small>
            </div>
          </div>

          <div class="bento-kpi-card">
            <div class="kpi-top-row">
              <span class="kpi-label">Solicitações Pendentes</span>
              <svg class="kpi-arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
            </div>
            <div class="kpi-number" style="color:${pendingCount > 0 ? '#B45309' : 'var(--text-title)'};">${pendingCount}</div>
            <div class="kpi-bottom-row">
              <span class="kpi-badge-pill ${pendingCount > 0 ? 'warning' : 'neutral'}">${pendingCount > 0 ? 'Requer atenção' : 'Em dia'}</span>
              <small style="color:var(--text-muted);font-size:11px;">No quadro</small>
            </div>
          </div>
        </div>

        <!-- LINHA 2: GRÁFICOS, LEMBRETES E LISTA RÁPIDA -->
        <div class="bento-row-middle">
          <!-- Coluna 1: Gráfico de Pílulas Verticais -->
          <div class="bento-card">
            <div class="bento-card-head">
              <div>
                <h3 class="bento-card-title">Frequência por Dia da Semana</h3>
                <span class="bento-card-subtitle">Seg a Dom · Habitual vs Projetado</span>
              </div>
            </div>
            <div class="pill-chart-container">
              ${[
                { id: "seg", label: "Seg", peak: true },
                { id: "ter", label: "Ter", peak: true },
                { id: "qua", label: "Qua", peak: true },
                { id: "qui", label: "Qui", peak: true },
                { id: "sex", label: "Sex", peak: false },
                { id: "sab", label: "Sáb", peak: false },
                { id: "dom", label: "Dom", peak: false }
              ].map(d => {
                const val = dayFreq[d.id] || 0;
                const h = Math.max(15, Math.round((val / maxDayVal) * 100));
                return `
                  <div class="pill-chart-col">
                    <div class="pill-bar-track" title="${d.label}: ${val} folgas">
                      <div class="pill-bar-fill ${d.peak ? '' : 'striped'}" style="height:${h}%;"></div>
                    </div>
                    <span class="pill-bar-label">${d.label}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Coluna 2: Card Próximas Folgas / Alertas do Dia -->
          <div class="bento-card">
            <div class="bento-card-head">
              <div>
                <h3 class="bento-card-title">Folgas de Hoje &amp; Alertas</h3>
                <span class="bento-card-subtitle">Escala ativa da operação</span>
              </div>
              <span class="kpi-badge-pill" style="font-size:10px;">HOJE</span>
            </div>
            <div class="alert-card-content">
              ${presence.filter(p => p.status === "folga").slice(0, 2).map(p => `
                <div class="alert-employee-row">
                  <div class="alert-avatar">${esc((p.Nome||'?')[0])}</div>
                  <div class="alert-info">
                    <div class="alert-name">${esc(p.Nome || 'Colaborador')}</div>
                    <div class="alert-role">${esc(p.Cargo || 'Função')} · De Folga</div>
                  </div>
                  <span class="status-pill-badge off">Folga</span>
                </div>
              `).join('') || `
                <div class="alert-employee-row" style="background:#FFFFFF;border-style:dashed;">
                  <div class="alert-info">
                    <div class="alert-name">Nenhuma folga hoje</div>
                    <div class="alert-role">Toda a equipe escalada para o turno</div>
                  </div>
                </div>
              `}
            </div>
            <button type="button" class="btn-card-wide" data-view-target="calendar">
              Consultar Escala do Mês →
            </button>
          </div>

          <!-- Coluna 3: Lista Compacta Últimas Solicitações -->
          <div class="bento-card">
            <div class="bento-card-head">
              <div>
                <h3 class="bento-card-title">Últimas Solicitações</h3>
                <span class="bento-card-subtitle">Pedidos recentes de folga</span>
              </div>
              <button type="button" class="btn-pill-primary" style="padding:4px 10px;font-size:11px;" id="dashQuickNewTimeOff">
                ＋ Nova
              </button>
            </div>
            <div class="compact-request-list">
              ${timeOff.slice(0, 3).map(t => `
                <div class="compact-request-item">
                  <div class="compact-req-left">
                    <div class="alert-avatar" style="width:28px;height:28px;font-size:11px;">${esc((t.NomeFuncionario||'?')[0])}</div>
                    <div>
                      <div class="compact-req-name">${esc(t.NomeFuncionario || 'Colaborador')}</div>
                      <div class="compact-req-date">${esc(t.DataInicio || 'Data')} · ${esc(t.TipoFolga || 'Folga')}</div>
                    </div>
                  </div>
                  <span class="kpi-badge-pill ${/aprovad|concluid/i.test(t.Status) ? '' : 'warning'}">${esc(t.Status || 'Pendente')}</span>
                </div>
              `).join('') || '<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px 0;">Sem pedidos recentes.</p>'}
            </div>
          </div>
        </div>

        <!-- LINHA 3: EQUIPE, COBERTURA E WIDGET DE TURNO -->
        <div class="bento-row-bottom">
          <!-- Coluna 1: Status da Equipe -->
          <div class="bento-card">
            <div class="bento-card-head">
              <div>
                <h3 class="bento-card-title">Status da Equipe</h3>
                <span class="bento-card-subtitle">Tempo real da unidade</span>
              </div>
              <button type="button" class="btn-pill-secondary" style="padding:3px 9px;font-size:11px;" data-view-target="live-team">Ver todos</button>
            </div>
            <div class="team-status-list">
              ${presence.slice(0, 4).map(p => `
                <div class="team-status-item">
                  <div class="team-status-left">
                    <div class="team-avatar-mini">${esc((p.Nome||'?')[0])}</div>
                    <div class="team-meta">
                      <strong>${esc(p.Nome || 'Colaborador')}</strong>
                      <span>${esc(p.Cargo || 'Setor')}</span>
                    </div>
                  </div>
                  <span class="status-pill-badge ${p.status === 'trabalhando' ? 'working' : p.status === 'intervalo' ? 'break' : 'off'}">
                    ${p.status === 'trabalhando' ? 'Trabalhando' : p.status === 'intervalo' ? 'Intervalo' : 'De Folga'}
                  </span>
                </div>
              `).join('') || '<p style="font-size:12px;color:var(--text-muted);">Sincronizando registros da equipe…</p>'}
            </div>
          </div>

          <!-- Coluna 2: Gráfico Semicircular (Taxa de Cobertura da Escala) -->
          <div class="bento-card">
            <div class="bento-card-head">
              <div>
                <h3 class="bento-card-title">Taxa de Cobertura</h3>
                <span class="bento-card-subtitle">Efetivo ativo vs folgas</span>
              </div>
            </div>
            <div class="gauge-chart-wrap">
              <div class="gauge-svg-container">
                <svg viewBox="0 0 100 55" width="160" height="90">
                  <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#EAECEF" stroke-width="10" stroke-linecap="round" />
                  <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="var(--accent-primary)" stroke-width="10" stroke-linecap="round"
                    stroke-dasharray="125.6" stroke-dashoffset="${125.6 * (1 - coveragePct / 100)}" style="transition:stroke-dashoffset 0.8s ease;" />
                </svg>
                <div class="gauge-center-text">
                  <strong>${coveragePct}%</strong>
                  <span>Cobertura</span>
                </div>
              </div>
              <div class="gauge-legend-row">
                <div class="gauge-legend-item">
                  <span class="gauge-legend-dot" style="background:var(--accent-primary);"></span>
                  <span>${workingCount} Ativos</span>
                </div>
                <div class="gauge-legend-item">
                  <span class="gauge-legend-dot" style="background:#DCFCE7;"></span>
                  <span>${offCount} Folga</span>
                </div>
                <div class="gauge-legend-item">
                  <span class="gauge-legend-dot" style="background:#FEF3C7;"></span>
                  <span>${breakCount} Pausa</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Coluna 3: Widget de Alto Contraste (Relógio / Turno) -->
          <div class="bento-card bento-card-accent-dark">
            <div>
              <h3 class="bento-card-title">Turno Atual</h3>
              <span class="bento-card-subtitle">Horário da Bahia (UTC-3)</span>
            </div>
            <div class="clock-digital-display" id="planlyLiveClock">--:--:--</div>
            <div class="clock-date-display" id="planlyLiveDate">Sincronizando data…</div>
            <div class="clock-action-buttons">
              <button type="button" class="clock-action-btn" data-view-target="timeclock">
                <span>Registrar Ponto</span>
              </button>
              <button type="button" class="clock-action-btn" id="planlyRefreshBtn">
                <span>Atualizar ↻</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Preservar widgets nativos ou injetar o novo Bento Grid
    const existingBento = document.getElementById("planlyBentoGrid");
    if (existingBento) {
      existingBento.outerHTML = bentoHtml;
    } else {
      container.innerHTML = bentoHtml;
    }

    // Inicializar relógio
    this.updateClockTick();
    document.getElementById("dashQuickNewTimeOff")?.addEventListener("click", () => {
      if (typeof window.editTimeOff === "function") window.editTimeOff();
      else document.getElementById("dashboardNewTimeOff")?.click();
    });

    document.getElementById("planlyRefreshBtn")?.addEventListener("click", () => {
      document.getElementById("refreshBtn")?.click();
    });
  }

  updateClockTick() {
    const clockEl = document.getElementById("planlyLiveClock");
    const dateEl = document.getElementById("planlyLiveDate");
    if (!clockEl || !dateEl) return;

    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("pt-BR", { timeZone: "America/Bahia", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    dateEl.textContent = now.toLocaleDateString("pt-BR", { timeZone: "America/Bahia", weekday: "long", day: "2-digit", month: "long" });
  }

  // =========================================================================
  // TELA 2: SOLICITAÇÕES (QUADRO KANBAN INTERATIVO)
  // =========================================================================
  renderKanbanBoard() {
    const container = document.getElementById("view-pending-center");
    if (!container) return;

    const state = window.__GESTAO_STATE__ || {};
    const timeOff = Array.isArray(state.timeOff) ? state.timeOff : [];

    // Colunas do Kanban
    const columns = {
      solicitadas: { title: "Solicitadas (To Do)", cards: [] },
      em_analise: { title: "Em Análise (In Progress)", cards: [] },
      troca: { title: "Aguardando Troca (In Review)", cards: [] },
      aprovadas: { title: "Aprovadas (Done)", cards: [] }
    };

    // Distribuir itens
    timeOff.forEach(item => {
      const status = (item.Status || "").toLowerCase();
      const type = (item.TipoFolga || "").toLowerCase();

      if (/troca/.test(type) || /troca/.test(status)) {
        columns.troca.cards.push(item);
      } else if (/aprovad|concluid/.test(status)) {
        columns.aprovadas.cards.push(item);
      } else if (/analise|revisao/.test(status)) {
        columns.em_analise.cards.push(item);
      } else {
        columns.solicitadas.cards.push(item);
      }
    });

    let kanbanWrapper = document.getElementById("planlyKanbanWrapper");
    if (!kanbanWrapper) {
      kanbanWrapper = document.createElement("div");
      kanbanWrapper.id = "planlyKanbanWrapper";
      kanbanWrapper.className = "kanban-view-container";
      container.appendChild(kanbanWrapper);
    }

    kanbanWrapper.innerHTML = `
      <div class="kanban-filters-row">
        <button type="button" class="pill-filter-btn ${this.kanbanFilter === 'todas' ? 'active' : ''}" data-kanban-filter="todas">Todas</button>
        <button type="button" class="pill-filter-btn ${this.kanbanFilter === 'urgentes' ? 'active' : ''}" data-kanban-filter="urgentes">Urgentes</button>
        <button type="button" class="pill-filter-btn ${this.kanbanFilter === 'fimdesemana' ? 'active' : ''}" data-kanban-filter="fimdesemana">Finais de Semana</button>
      </div>

      <div class="kanban-board-grid">
        ${Object.entries(columns).map(([colKey, col]) => `
          <div class="kanban-column" data-kanban-col="${colKey}">
            <div class="kanban-column-header">
              <span class="kanban-column-title">${esc(col.title)}</span>
              <span class="kanban-count-badge">${col.cards.length}</span>
            </div>
            <div class="kanban-cards-wrapper" data-drop-zone="${colKey}">
              ${col.cards.map(card => `
                <div class="kanban-card" draggable="true" data-card-id="${card.FolgaID || ''}">
                  <div class="kanban-card-top">
                    <span class="kanban-type-tag">${esc(card.TipoFolga || 'Folga')}</span>
                    <span class="kpi-badge-pill ${/aprovad/i.test(card.Status) ? '' : 'warning'}" style="font-size:10px;">${esc(card.Status || 'Pendente')}</span>
                  </div>
                  <h4 class="kanban-card-title">${esc(card.NomeFuncionario || 'Colaborador')}</h4>
                  <p class="kanban-card-desc">${esc(card.Motivo || 'Solicitação de folga programada')}</p>
                  <div class="kanban-card-date">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <span>${esc(card.DataInicio || 'Data')}</span>
                  </div>
                  <div class="kanban-card-foot">
                    <div class="kanban-avatar">${esc((card.NomeFuncionario||'?')[0])}</div>
                    <div class="kanban-card-actions">
                      <button type="button" class="kanban-mini-btn" data-action-approve="${card.FolgaID || ''}">Aprovar</button>
                      <button type="button" class="kanban-mini-btn" data-action-reject="${card.FolgaID || ''}">Recusar</button>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Interações de Drag and Drop
    this.setupKanbanDragDrop(kanbanWrapper);
  }

  setupKanbanDragDrop(wrapper) {
    let draggedCard = null;

    wrapper.querySelectorAll(".kanban-card").forEach(card => {
      card.addEventListener("dragstart", (e) => {
        draggedCard = card;
        e.dataTransfer.setData("text/plain", card.dataset.cardId || "");
        card.style.opacity = "0.5";
      });

      card.addEventListener("dragend", () => {
        if (draggedCard) draggedCard.style.opacity = "1";
        draggedCard = null;
        wrapper.querySelectorAll(".kanban-column").forEach(c => c.classList.remove("drag-over"));
      });
    });

    wrapper.querySelectorAll(".kanban-column").forEach(col => {
      col.addEventListener("dragover", (e) => {
        e.preventDefault();
        col.classList.add("drag-over");
      });

      col.addEventListener("dragleave", () => {
        col.classList.remove("drag-over");
      });

      col.addEventListener("drop", (e) => {
        e.preventDefault();
        col.classList.remove("drag-over");
        const dropZone = col.querySelector(".kanban-cards-wrapper");
        if (dropZone && draggedCard) {
          dropZone.appendChild(draggedCard);
          // Atualizar contadores
          this.updateKanbanCounters(wrapper);
        }
      });
    });

    // Ações rápidas de botão
    wrapper.addEventListener("click", (e) => {
      const approveBtn = e.target.closest("[data-action-approve]");
      if (approveBtn) {
        const id = approveBtn.dataset.actionApprove;
        if (typeof window.approveTimeOff === "function") {
          window.approveTimeOff(id);
        }
        return;
      }
      const rejectBtn = e.target.closest("[data-action-reject]");
      if (rejectBtn) {
        const id = rejectBtn.dataset.actionReject;
        if (typeof window.rejectTimeOff === "function") {
          window.rejectTimeOff(id);
        }
        return;
      }
    });
  }

  updateKanbanCounters(wrapper) {
    wrapper.querySelectorAll(".kanban-column").forEach(col => {
      const count = col.querySelectorAll(".kanban-card").length;
      const badge = col.querySelector(".kanban-count-badge");
      if (badge) badge.textContent = count;
    });
  }

  // =========================================================================
  // TELA 3: EQUIPE (GRID DE CARDS + SIDE DRAWER)
  // =========================================================================
  renderTeamCards() {
    const container = document.getElementById("view-employees");
    if (!container) return;

    const state = window.__GESTAO_STATE__ || {};
    const employees = Array.isArray(state.employees) ? state.employees : [];

    let teamWrapper = document.getElementById("planlyTeamGridWrapper");
    if (!teamWrapper) {
      teamWrapper = document.createElement("div");
      teamWrapper.id = "planlyTeamGridWrapper";
      teamWrapper.className = "team-grid-container";
      const tablePanel = container.querySelector(".table-panel");
      if (tablePanel) {
        tablePanel.before(teamWrapper);
        tablePanel.style.display = "none"; // Substituir a tabela antiga pelo Bento Grid de Cards
      } else {
        container.appendChild(teamWrapper);
      }
    }

    // Filtrar por setor
    const filteredEmployees = employees.filter(emp => {
      if (this.teamSectorFilter === "todos") return true;
      const role = (emp.Cargo || "").toLowerCase();
      if (this.teamSectorFilter === "cozinha") return /cozinh|chapa|frit|pizz|chef/i.test(role);
      if (this.teamSectorFilter === "salao") return /sal|atend|garcom|garç/i.test(role);
      if (this.teamSectorFilter === "caixa") return /caixa|geren|admin/i.test(role);
      return true;
    });

    teamWrapper.innerHTML = `
      <div class="team-filter-tabs">
        <button type="button" class="pill-filter-btn ${this.teamSectorFilter === 'todos' ? 'active' : ''}" data-team-sector="todos">Todos</button>
        <button type="button" class="pill-filter-btn ${this.teamSectorFilter === 'cozinha' ? 'active' : ''}" data-team-sector="cozinha">Cozinha</button>
        <button type="button" class="pill-filter-btn ${this.teamSectorFilter === 'salao' ? 'active' : ''}" data-team-sector="salao">Salão / Atendimento</button>
        <button type="button" class="pill-filter-btn ${this.teamSectorFilter === 'caixa' ? 'active' : ''}" data-team-sector="caixa">Caixa / Gerência</button>
      </div>

      <div class="team-cards-grid">
        ${filteredEmployees.map(emp => {
          const name = emp.Nome || emp.nome || "Colaborador";
          const initials = name.split(" ").filter(Boolean).slice(0, 2).map(x => x[0]).join("");
          const id = emp.FuncionarioID || emp.funcionarioId || "";
          return `
            <div class="team-member-card">
              <div class="member-avatar-lg">${esc(initials)}</div>
              <h4 class="member-name">${esc(name)}</h4>
              <span class="member-role">${esc(emp.Cargo || 'Função')}</span>
              <span class="member-unit-badge">${esc(emp.NomeLoja || 'Unidade')}</span>

              <div class="member-metrics-row">
                <div class="member-metric-box">
                  <span class="metric-box-val">${Number(emp.SaldoFolgas || 0)}</span>
                  <span class="metric-box-lbl">Folgas Disp.</span>
                </div>
                <div class="member-metric-box">
                  <span class="metric-box-val" style="color:#15803D;">98%</span>
                  <span class="metric-box-lbl">Assiduidade</span>
                </div>
              </div>

              <div class="member-card-buttons">
                <button type="button" class="btn-member-outline" onclick="if(typeof editEmployee==='function')editEmployee('${id}')">Gerenciar</button>
                <button type="button" class="btn-member-primary" data-open-member-drawer="${id}">Perfil</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // =========================================================================
  // TELA 4: CALENDÁRIO DE ESCALAS (70% GRID + 30% PAINEL FIXO)
  // =========================================================================
  renderCalendar7030() {
    const calendarView = document.getElementById("view-calendar");
    if (!calendarView) return;

    let calLayout = document.getElementById("planlyCalendarLayout");
    if (!calLayout) {
      calLayout = document.createElement("div");
      calLayout.id = "planlyCalendarLayout";
      calLayout.className = "calendar-70-30-layout";
      const oldLayout = calendarView.querySelector(".calendar-layout");
      if (oldLayout) {
        oldLayout.style.display = "none";
        oldLayout.before(calLayout);
      } else {
        calendarView.appendChild(calLayout);
      }
    }

    const state = window.__GESTAO_STATE__ || {};
    const timeOff = Array.isArray(state.timeOff) ? state.timeOff : [];

    const date = new Date(this.selectedCalendarDay + "T12:00:00Z");
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const monthName = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Bahia" });

    // Dias do mês
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0: Dom

    // Pessoas de folga no dia selecionado
    const selectedDayLeaves = timeOff.filter(t => t.DataInicio === this.selectedCalendarDay);

    calLayout.innerHTML = `
      <!-- Esquerda: 70% da largura -->
      <div class="calendar-main-box">
        <div class="calendar-nav-toolbar">
          <h3 class="calendar-month-title" style="text-transform:capitalize;">${esc(monthName)}</h3>
          <div class="calendar-nav-btns">
            <button type="button" class="cal-nav-btn" id="planlyCalPrev">‹ Anterior</button>
            <button type="button" class="cal-nav-btn today" id="planlyCalToday">Hoje</button>
            <button type="button" class="cal-nav-btn" id="planlyCalNext">Próximo ›</button>
          </div>
        </div>

        <div class="cal-month-grid">
          ${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(w => `<div class="cal-weekday-label">${w}</div>`).join('')}
          ${Array.from({ length: firstDayIndex }).map(() => `<div style="opacity:0;"></div>`).join('')}
          ${Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const fullDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
            const isSelected = fullDate === this.selectedCalendarDay;
            const leaves = timeOff.filter(t => t.DataInicio === fullDate);
            return `
              <div class="cal-day-cell ${isSelected ? 'selected' : ''}" data-cal-day="${fullDate}">
                <div class="cal-day-number-wrap">
                  <span class="cal-day-number">${dayNum}</span>
                </div>
                ${leaves.slice(0, 2).map(l => `
                  <span class="cal-leave-pill" title="${esc(l.NomeFuncionario)}">${esc(l.NomeFuncionario || 'Folga')}</span>
                `).join('')}
                ${leaves.length > 2 ? `<small style="font-size:9.5px;color:var(--text-muted);font-weight:600;">+${leaves.length - 2} mais</small>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Direita: 30% da largura (Painel Fixo do Dia) -->
      <div class="calendar-day-panel">
        <div>
          <h4 class="day-panel-title">${new Date(this.selectedCalendarDay + "T12:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Bahia" })}</h4>
          <span class="day-panel-subtitle">Detalhamento do dia selecionado</span>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;">
          ${selectedDayLeaves.map(l => `
            <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg-workspace);border-radius:var(--radius-inner);border:1px solid #EAECEF;">
              <div class="alert-avatar" style="width:32px;height:32px;font-size:12px;">${esc((l.NomeFuncionario||'?')[0])}</div>
              <div>
                <strong style="font-size:13px;color:var(--text-title);display:block;">${esc(l.NomeFuncionario || 'Colaborador')}</strong>
                <span style="font-size:11px;color:var(--text-muted);">${esc(l.TipoFolga || 'Folga Semanal')} · ${esc(l.NomeLoja || 'Loja')}</span>
              </div>
            </div>
          `).join('') || '<p style="font-size:12px;color:var(--text-muted);">Nenhum colaborador de folga neste dia.</p>'}
        </div>

        <div style="border-top:1px solid #EAECEF;padding-top:12px;">
          <strong style="font-size:13px;color:var(--text-title);display:block;margin-bottom:8px;">Próximas Folgas da Semana</strong>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${timeOff.filter(t => t.DataInicio > this.selectedCalendarDay).slice(0, 4).map(l => `
              <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-body);">
                <span>${esc(l.NomeFuncionario)}</span>
                <b style="color:var(--accent-primary);">${esc(l.DataInicio)}</b>
              </div>
            `).join('') || '<span style="font-size:11.5px;color:var(--text-muted);">Sem folgas registradas a seguir.</span>'}
          </div>
        </div>

        <button type="button" class="btn-pill-primary" style="justify-content:center;margin-top:auto;" id="calDayAddLeaveBtn">
          ＋ Adicionar Folga Neste Dia
        </button>
      </div>
    `;

    // Eventos de navegação de mês
    calLayout.querySelector("#planlyCalPrev")?.addEventListener("click", () => {
      const d = new Date(this.selectedCalendarDay + "T12:00:00Z");
      d.setUTCMonth(d.getUTCMonth() - 1);
      this.selectedCalendarDay = d.toISOString().slice(0, 10);
      this.renderCalendar7030();
    });

    calLayout.querySelector("#planlyCalNext")?.addEventListener("click", () => {
      const d = new Date(this.selectedCalendarDay + "T12:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + 1);
      this.selectedCalendarDay = d.toISOString().slice(0, 10);
      this.renderCalendar7030();
    });

    calLayout.querySelector("#planlyCalToday")?.addEventListener("click", () => {
      this.selectedCalendarDay = new Date().toISOString().slice(0, 10);
      this.renderCalendar7030();
    });

    calLayout.querySelector("#calDayAddLeaveBtn")?.addEventListener("click", () => {
      if (typeof window.editTimeOff === "function") {
        window.editTimeOff("", this.selectedCalendarDay);
      } else {
        document.getElementById("dashboardNewTimeOff")?.click();
      }
    });
  }

  selectCalendarDay(day) {
    this.selectedCalendarDay = day;
    this.renderCalendar7030();
  }

  // =========================================================================
  // TELA 5: ANALYTICS & CONFIGURAÇÕES DE APARÊNCIA
  // =========================================================================
  renderAnalytics() {
    const reportsView = document.getElementById("view-reports") || document.getElementById("view-advanced-reports");
    if (!reportsView) return;

    let analyticsWrapper = document.getElementById("planlyAnalyticsWrapper");
    if (!analyticsWrapper) {
      analyticsWrapper = document.createElement("div");
      analyticsWrapper.id = "planlyAnalyticsWrapper";
      analyticsWrapper.className = "analytics-container";
      reportsView.prepend(analyticsWrapper);
    }

    const state = window.__GESTAO_STATE__ || {};
    const timeOff = Array.isArray(state.timeOff) ? state.timeOff : [];
    const employees = Array.isArray(state.employees) ? state.employees : [];

    const totalLeaves = timeOff.length || 24;
    const avgPerEmp = employees.length ? (totalLeaves / employees.length).toFixed(1) : "4.8";

    analyticsWrapper.innerHTML = `
      <div class="analytics-period-bar">
        <div>
          <h3 style="font-size:20px;font-weight:700;color:var(--text-title);margin:0;">Métricas e Desempenho</h3>
          <span style="font-size:13px;color:var(--text-muted);">Relatório consolidado de escalas e ausências</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="pill-filter-btn ${this.analyticsPeriod === '7d' ? 'active' : ''}" data-analytics-period="7d">7d</button>
          <button type="button" class="pill-filter-btn ${this.analyticsPeriod === '30d' ? 'active' : ''}" data-analytics-period="30d">30d</button>
          <button type="button" class="pill-filter-btn ${this.analyticsPeriod === '90d' ? 'active' : ''}" data-analytics-period="90d">90d</button>
        </div>
      </div>

      <!-- 4 KPIs no Topo -->
      <div class="bento-row-kpis">
        <div class="bento-kpi-card">
          <span class="kpi-label">Folgas Concedidas</span>
          <div class="kpi-number">${totalLeaves}</div>
          <span class="kpi-badge-pill">+8% vs anterior</span>
        </div>
        <div class="bento-kpi-card">
          <span class="kpi-label">Média por Colaborador</span>
          <div class="kpi-number">${avgPerEmp}</div>
          <span class="kpi-badge-pill neutral">Alinhado à regra 5/mês</span>
        </div>
        <div class="bento-kpi-card">
          <span class="kpi-label">Taxa de Cobertura Média</span>
          <div class="kpi-number" style="color:#15803D;">94%</div>
          <span class="kpi-badge-pill">Sem desfalques</span>
        </div>
        <div class="bento-kpi-card">
          <span class="kpi-label">Índice de Trocas</span>
          <div class="kpi-number">2</div>
          <span class="kpi-badge-pill neutral">Baixo atrito</span>
        </div>
      </div>

      <!-- Gráfico de Área (Dual Line) + Donut -->
      <div class="analytics-charts-grid">
        <div class="bento-card">
          <div class="bento-card-head">
            <div>
              <h4 class="bento-card-title">Histórico de Folgas por Período</h4>
              <span class="bento-card-subtitle">Este período (sólido) vs Período anterior (tracejado)</span>
            </div>
          </div>
          <div class="area-chart-wrap">
            <svg viewBox="0 0 500 180" width="100%" height="100%" preserveAspectRatio="none">
              <defs>
                <linearGradient id="planlyAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--accent-primary)" stop-opacity="0.25" />
                  <stop offset="100%" stop-color="var(--accent-primary)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <!-- Linha tracejada período anterior -->
              <path d="M 0 140 Q 120 120, 250 130 T 500 110" fill="none" stroke="#D1D5DB" stroke-width="2" stroke-dasharray="5 5" />
              <!-- Área com degradê este período -->
              <path d="M 0 120 Q 120 70, 250 85 T 500 40 L 500 180 L 0 180 Z" fill="url(#planlyAreaGradient)" />
              <!-- Linha sólida este período -->
              <path d="M 0 120 Q 120 70, 250 85 T 500 40" fill="none" stroke="var(--accent-primary)" stroke-width="3" />
              <!-- Pontos de dados -->
              <circle cx="120" cy="70" r="4" fill="var(--accent-primary)" stroke="#FFFFFF" stroke-width="2" />
              <circle cx="250" cy="85" r="4" fill="var(--accent-primary)" stroke="#FFFFFF" stroke-width="2" />
              <circle cx="380" cy="55" r="4" fill="var(--accent-primary)" stroke="#FFFFFF" stroke-width="2" />
            </svg>
          </div>
        </div>

        <!-- Gráfico de Rosca (Donut) -->
        <div class="bento-card">
          <div class="bento-card-head">
            <div>
              <h4 class="bento-card-title">Folgas por Setor</h4>
              <span class="bento-card-subtitle">Distribuição proporcional</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:180px;">
            <svg viewBox="0 0 100 100" width="120" height="120">
              <circle cx="50" cy="50" r="35" fill="none" stroke="#EAECEF" stroke-width="14" />
              <circle cx="50" cy="50" r="35" fill="none" stroke="var(--accent-primary)" stroke-width="14" stroke-dasharray="110 220" stroke-dashoffset="0" />
              <circle cx="50" cy="50" r="35" fill="none" stroke="#60A5FA" stroke-width="14" stroke-dasharray="60 220" stroke-dashoffset="-110" />
              <circle cx="50" cy="50" r="35" fill="none" stroke="#34D399" stroke-width="14" stroke-dasharray="50 220" stroke-dashoffset="-170" />
              <text x="50" y="54" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text-title)">100%</text>
            </svg>
            <div style="display:flex;gap:12px;margin-top:12px;font-size:11px;color:var(--text-muted);">
              <span><b style="color:var(--accent-primary);">●</b> Cozinha</span>
              <span><b style="color:#60A5FA;">●</b> Salão</span>
              <span><b style="color:#34D399;">●</b> Caixa</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

export const planlyEngine = new PlanlyBentoEngine();
