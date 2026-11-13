import { runtime } from "./core/runtime.js";
import { ONBOARDING_STAGES, REQUIRED_ADMISSION_DOCUMENTS } from "./core/api-portal.js";
import { todayIso } from "./core/utils.js";

const formatBRL = (val) => {
  const n = Number(val || 0);
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
};

const isDiretoriaProfile = (profile) => {
  const r = String(profile?.Perfil || profile?.perfil || "").toLowerCase();
  return r.includes("admin") || r.includes("diretor");
};

const isGerenteProfile = (profile) => {
  const r = String(profile?.Perfil || profile?.perfil || "").toLowerCase();
  return isDiretoriaProfile(profile) || r.includes("respons") || r.includes("gerente");
};

const showPortalToast = (message, type = "info") => {
  if (typeof window.showToast === "function") {
    window.showToast(message, type);
    return;
  }
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => item.remove(), 4200);
};

const invokePortal = async (method, payload = {}) => {
  if (!runtime?.invoke) {
    throw new Error("Runtime da aplicação ainda não inicializado.");
  }
  return runtime.invoke(method, [payload]);
};

// ============================================================================
// SISTEMA UNIFICADO DE ABAS HORIZONTAIS (PLIIFEX DESIGN)
// ============================================================================

function injectPortalTabsStyles() {
  if (document.getElementById("portalCleanTabsStyles")) return;
  const style = document.createElement("style");
  style.id = "portalCleanTabsStyles";
  style.textContent = `
    /* ---- Abas horizontais Pliifex (blindadas contra CSS legado) ---- */
    .portal-tabs-bar {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      padding: 4px;
      margin-bottom: 18px;
      background: var(--surface-2, #f1f5f9) !important;
      border: 1px solid var(--line, #e2e8f0) !important;
      border-radius: 10px !important;
      max-width: 100%;
    }
    #app .portal-tabs-bar .portal-tab-btn,
    dialog .portal-tabs-bar .portal-tab-btn {
      appearance: none !important;
      border: 1px solid transparent !important;
      background: transparent !important;
      color: var(--muted, #64748b) !important;
      font-family: inherit !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      line-height: 1.25 !important;
      padding: 8px 14px !important;
      border-radius: 7px !important;
      cursor: pointer !important;
      box-shadow: none !important;
      transition: color 0.16s ease, background 0.16s ease, border-color 0.16s ease !important;
      white-space: nowrap !important;
      min-height: auto !important;
      height: auto !important;
    }
    #app .portal-tabs-bar .portal-tab-btn:not(.active):hover,
    #app .portal-tabs-bar .portal-tab-btn:not(.active):focus,
    dialog .portal-tabs-bar .portal-tab-btn:not(.active):hover,
    dialog .portal-tabs-bar .portal-tab-btn:not(.active):focus {
      background: rgba(255, 255, 255, 0.55) !important;
      color: var(--ink, #0f172a) !important;
      border-color: transparent !important;
      box-shadow: none !important;
      outline: none !important;
    }
    #app .portal-tabs-bar .portal-tab-btn.active,
    dialog .portal-tabs-bar .portal-tab-btn.active {
      background: var(--surface, #ffffff) !important;
      color: var(--brand-solid, #4077ba) !important;
      font-weight: 600 !important;
      border-color: var(--line, #e2e8f0) !important;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08) !important;
    }
    .portal-tab-pane.hidden {
      display: none !important;
    }

    /* ---- Modal #employeeDialog reestruturado ---- */
    dialog#employeeDialog {
      width: min(920px, 95vw) !important;
      max-width: 920px !important;
      border-radius: 16px !important;
      border: 1px solid var(--line, #e2e8f0) !important;
      padding: 0 !important;
    }
    dialog#employeeDialog form#employeeForm {
      width: 100% !important;
      max-width: 100% !important;
    }
    dialog#employeeDialog .dialog-head {
      padding: 18px 24px !important;
      border-bottom: 1px solid var(--line, #e2e8f0) !important;
      background: var(--surface, #ffffff) !important;
    }
    dialog#employeeDialog .dialog-body {
      padding: 18px 24px !important;
      max-height: min(76vh, 720px) !important;
      overflow-y: auto !important;
      background: var(--surface-2, #f8fafc) !important;
    }
    dialog#employeeDialog .dialog-actions {
      padding: 14px 24px !important;
      border-top: 1px solid var(--line, #e2e8f0) !important;
      background: var(--surface, #ffffff) !important;
    }
    .portal-modal-tabs {
      width: 100%;
      margin: 0 0 16px !important;
      display: flex !important;
      flex-wrap: nowrap !important;
      overflow-x: auto;
      gap: 4px !important;
    }
    dialog#employeeDialog .portal-modal-tabs .portal-tab-btn {
      font-size: 12.5px !important;
      padding: 7px 12px !important;
      flex: 0 0 auto;
    }

    /* ---- Cards de secoes limpas (.portal-field-card) ---- */
    .portal-field-card {
      background: var(--surface, #ffffff);
      border: 1px solid #e5eaf2;
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 14px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
    }
    .portal-field-card:last-child {
      margin-bottom: 0;
    }
    .portal-field-card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .portal-field-card-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--brand-solid, #4077ba);
      margin: 0;
    }
    .portal-field-card-sub {
      font-size: 12px;
      color: var(--muted, #64748b);
    }
    dialog#employeeDialog .dialog-grid {
      gap: 14px !important;
    }
    dialog#employeeDialog label.field span {
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #334155 !important;
      margin-bottom: 5px !important;
    }
    dialog#employeeDialog input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]),
    dialog#employeeDialog select,
    dialog#employeeDialog textarea {
      min-height: 40px !important;
      box-sizing: border-box !important;
      font-size: 13.5px !important;
      border-radius: 8px !important;
    }
    dialog#employeeDialog h4.dialog-section-title {
      display: none !important;
    }

    /* ---- Avatar Picker compacto dentro da Tab 1 ---- */
    dialog#employeeDialog .avatar-picker-section {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 14px !important;
      margin: 0 0 14px !important;
    }
    dialog#employeeDialog .avatar-picker-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    dialog#employeeDialog .avatar-picker-head strong {
      font-size: 13px !important;
    }
    dialog#employeeDialog .avatar-grid {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 8px !important;
      grid-template-columns: none !important;
    }
    dialog#employeeDialog .avatar-option {
      width: 42px !important;
      height: 42px !important;
      min-width: 42px !important;
      min-height: 42px !important;
      border-radius: 10px !important;
      padding: 2px !important;
    }
    dialog#employeeDialog .avatar-option img {
      width: 100% !important;
      height: 100% !important;
      border-radius: 8px !important;
      object-fit: cover !important;
    }

    /* ---- Upload customizado sem input nativo feio ---- */
    .portal-file-upload-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .portal-file-input-hidden {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    .portal-file-upload-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 14px;
      border-radius: 8px;
      border: 1px dashed var(--brand-solid, #4077ba);
      background: #eff6ff;
      color: var(--brand-solid, #4077ba);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .portal-file-upload-btn:hover {
      background: #dbeafe;
    }
    .portal-file-name-label {
      font-size: 12.5px;
      color: var(--muted, #64748b);
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ---- Blindagem de visibilidade por permissao contra display grid/flex ---- */
    .hidden,
    .permission-manager.hidden,
    .permission-team-read.hidden,
    .permission-admin.hidden,
    .toolbar-actions.hidden,
    .section-toolbar.hidden,
    #globalTopStoreSelectorWrap.hidden {
      display: none !important;
    }

    /* ---- Topbar seletor de unidade alinhado ---- */
    #globalTopStoreSelectorWrap:not(.hidden) {
      display: inline-flex !important;
      align-items: center !important;
      gap: 8px !important;
      height: 36px !important;
      padding: 0 10px !important;
      background: var(--surface-2, #f8fafc) !important;
      border: 1px solid var(--line, #e2e8f0) !important;
      border-radius: 999px !important;
    }

    /* ---- Espelho do ponto (acoes Portaria 671 + navegacao de dia) ---- */
    .clock-day-picker > .clock-mirror-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .clock-mirror-actions .clock-print-mirror-btn,
    .clock-mirror-actions .clock-sign-mirror-btn {
      min-height: 40px !important;
      padding: 7px 12px !important;
      border-radius: 10px !important;
      font-size: 12.5px !important;
      font-weight: 600 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      line-height: 1.2 !important;
      background: transparent !important;
      color: var(--ink, #101828) !important;
      border: 1px solid var(--line-2, #d8dde6) !important;
      box-shadow: none !important;
    }
    .clock-mirror-actions #clockMirrorSignedBadge:not(.hidden) {
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      font-size: 11px !important;
      padding: 5px 10px !important;
      border-radius: 8px !important;
      font-weight: 600 !important;
    }
    #globalTopStoreSelectorWrap label {
      font-size: 12px !important;
      font-weight: 600 !important;
      color: var(--muted, #64748b) !important;
      margin: 0 !important;
    }
    #globalTopStoreSelector {
      height: 28px !important;
      min-height: 28px !important;
      border: none !important;
      background: transparent !important;
      font-size: 12.5px !important;
      font-weight: 600 !important;
      color: var(--ink, #0f172a) !important;
      padding: 0 4px !important;
      outline: none !important;
    }

    /* ---- KPI Strip Equipe + Badges de Status + Colunas Numericas ---- */
    .portal-kpi-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .portal-kpi-card {
      background: var(--surface, #ffffff);
      border: 1px solid #e5eaf2;
      border-radius: 12px;
      padding: 14px 16px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
    }
    .portal-kpi-label {
      display: block;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--muted, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }
    .portal-kpi-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--ink, #0f172a);
      font-variant-numeric: tabular-nums;
      line-height: 1.15;
    }
    .portal-pill {
      display: inline-flex;
      align-items: center;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
      line-height: 1.3;
      white-space: nowrap;
    }
    .portal-pill--blue { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .portal-pill--amber { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
    .portal-pill--green { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .portal-pill--red { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .portal-pill--neutral { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }

    .portal-num-col {
      text-align: right !important;
      font-variant-numeric: tabular-nums !important;
      white-space: nowrap !important;
    }
    .portal-timeline-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      margin-bottom: 14px;
    }
    .portal-timeline-step {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 9px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      font-size: 12.5px;
    }
    .portal-timeline-step.is-done {
      background: #ecfdf5;
      border-color: #a7f3d0;
    }
    .portal-timeline-step.is-current {
      background: #eff6ff;
      border-color: #93c5fd;
    }
    .portal-doc-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 8px;
    }
    .portal-doc-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      font-size: 12.5px;
    }

    /* ---- Mobile-First Employee UX (Solicitacoes, Vales, Trocas, Fichas, Topbar) ---- */
    .portal-mobile-form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 12px;
      align-items: end;
      width: 100%;
    }
    .portal-mobile-form-grid > *,
    .portal-mobile-form-grid label {
      min-width: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    .portal-mobile-form-grid label {
      display: block !important;
      font-size: 12.5px;
      font-weight: 600;
      color: #334155;
      margin: 0 !important;
      overflow: hidden;
    }
    .portal-mobile-form-grid input,
    .portal-mobile-form-grid select,
    .portal-mobile-form-grid textarea,
    .portal-folgas-toolbar input,
    .portal-folgas-toolbar select {
      -webkit-appearance: none !important;
      appearance: none !important;
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      min-inline-size: 0 !important;
      box-sizing: border-box !important;
      height: 42px !important;
      min-height: 42px !important;
      margin-top: 5px !important;
      padding: 0 12px !important;
      border-radius: 10px !important;
      font-size: 14px !important;
      text-align: left !important;
    }
    .portal-folgas-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
    }
    .portal-folgas-toolbar #timeOffSearch {
      flex: 1 1 200px;
    }
    .portal-folgas-toolbar #timeOffStatusFilter {
      flex: 0 1 180px;
    }
    .portal-folgas-toolbar #timeOffSwapBtn {
      display: none !important;
    }
    .portal-limit-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      margin: 12px 0 16px;
    }
    .portal-limit-banner-label {
      font-size: 12px;
      font-weight: 600;
      color: #1e40af;
      display: block;
    }
    .portal-limit-banner-value {
      font-size: 18px;
      font-weight: 700;
      color: #1d4ed8;
      font-variant-numeric: tabular-nums;
    }
    .portal-step-chips {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
      margin: 12px 0 16px;
    }
    .portal-step-chip {
      padding: 10px 12px;
      border-radius: 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      font-size: 12.5px;
      color: #334155;
      line-height: 1.35;
    }
    .portal-step-chip strong {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--brand-solid, #4077ba);
      margin-bottom: 2px;
    }
    .portal-action-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    @media (max-width: 768px) {
      .topbar {
        position: sticky !important;
        top: 0 !important;
        z-index: 45 !important;
        padding-left: 12px !important;
        padding-right: 12px !important;
        padding-top: max(10px, env(safe-area-inset-top)) !important;
        padding-bottom: 10px !important;
      }
      .topbar .topbar-title {
        min-width: 0 !important;
        flex: 1 1 auto !important;
      }
      .topbar .topbar-title h1 {
        font-size: 16px !important;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .topbar .icon-btn {
        width: 34px !important;
        height: 34px !important;
        min-width: 34px !important;
        min-height: 34px !important;
      }
      .topbar #refreshBtn {
        display: none !important;
      }
      .content {
        padding-top: 12px !important;
        padding-bottom: calc(108px + env(safe-area-inset-bottom)) !important;
      }
      .form-grid,
      .portal-mobile-form-grid {
        grid-template-columns: 1fr !important;
      }
      .form-grid > *,
      .form-grid label,
      .form-grid input,
      .form-grid select,
      .form-grid textarea {
        min-width: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      #globalTopStoreSelectorWrap:not(.hidden) {
        height: 32px !important;
        padding: 0 6px !important;
        max-width: 112px !important;
        margin-right: 2px !important;
      }
      #globalTopStoreSelectorWrap label {
        display: none !important;
      }
      #globalTopStoreSelector {
        max-width: 100px !important;
        font-size: 11.5px !important;
        height: 26px !important;
        min-height: 26px !important;
      }
      #clockMonth,
      #absencesMonth,
      #view-timeclock input[type="date"],
      #view-timeclock input[type="month"],
      .toolbar-actions select,
      .toolbar-actions input {
        min-inline-size: 0 !important;
        -webkit-appearance: none !important;
        appearance: none !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      #view-timeclock .table-panel {
        padding: 14px !important;
        border-radius: 16px !important;
      }
      #view-timeclock .table-wrap {
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        padding: 0 !important;
        box-shadow: none !important;
        margin: 0 !important;
      }
      #view-timeclock #clockHistoryBody tr {
        background: var(--surface-2, #f8fafc) !important;
        border: 1px solid var(--line, #e2e8f0) !important;
        box-shadow: none !important;
        border-radius: 14px !important;
        padding: 12px !important;
      }
      #view-timeclock #clockHistoryBody td:nth-child(3),
      #view-timeclock #clockHistoryBody td:nth-child(4),
      #view-timeclock #clockHistoryBody td:nth-child(5),
      #view-timeclock #clockHistoryBody td:nth-child(6) {
        background: var(--surface, #ffffff) !important;
      }
      #view-timeclock .clock-history-head {
        gap: 12px !important;
        margin-bottom: 12px !important;
      }
      #view-timeclock .clock-day-picker > .clock-mirror-actions {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 8px !important;
        width: 100% !important;
        margin-bottom: 12px !important;
      }
      #view-timeclock .clock-mirror-actions .clock-print-mirror-btn,
      #view-timeclock .clock-mirror-actions .clock-sign-mirror-btn {
        width: 100% !important;
        min-height: 44px !important;
        height: 44px !important;
        margin: 0 !important;
        padding: 4px 10px !important;
        font-size: 12px !important;
        line-height: 1.2 !important;
        white-space: normal !important;
        text-align: center !important;
        border-radius: 10px !important;
        background: transparent !important;
        color: var(--ink, #101828) !important;
        border: 1px solid var(--line-2, #d8dde6) !important;
        box-shadow: none !important;
      }
      #view-timeclock .clock-mirror-actions #clockMirrorSignedBadge:not(.hidden) {
        grid-column: 1 / -1 !important;
        justify-content: center !important;
      }
      #view-timeclock .clock-day-picker > label {
        margin-bottom: 6px !important;
      }
      #view-timeclock .clock-day-picker > .clock-day-nav {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        width: 100% !important;
      }
      #view-timeclock .clock-day-nav .clock-nav-day-btn {
        min-width: 38px !important;
        width: 38px !important;
        height: 40px !important;
        min-height: 40px !important;
        border-radius: 10px !important;
      }
      #view-timeclock .clock-day-nav input#clockDayFilter {
        flex: 1 1 auto !important;
        width: 100% !important;
        min-width: 0 !important;
        height: 40px !important;
        min-height: 40px !important;
        font-size: 13.5px !important;
        padding: 0 8px !important;
        border-radius: 10px !important;
      }
      #view-timeclock .clock-day-nav .clock-today-btn {
        min-width: 60px !important;
        height: 40px !important;
        min-height: 40px !important;
        padding: 0 12px !important;
        font-size: 12.5px !important;
        border-radius: 10px !important;
      }
      #view-timeclock .clock-timeline {
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
      }
      #view-timeclock .clock-mark {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        width: 100% !important;
        padding: 10px 12px !important;
        border-radius: 12px !important;
        background: var(--surface-2, #f8fafc) !important;
        border: 1px solid var(--line, #e2e8f0) !important;
        box-sizing: border-box !important;
      }
      #view-timeclock .clock-mark > div {
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-start !important;
        gap: 2px !important;
        flex: 1 !important;
        min-width: 0 !important;
      }
      #view-timeclock .clock-mark strong {
        font-size: 13px !important;
        font-weight: 600 !important;
        white-space: normal !important;
        overflow: visible !important;
        text-overflow: unset !important;
        line-height: 1.25 !important;
      }
      #view-timeclock .clock-mark span {
        font-size: 12px !important;
        margin-top: 0 !important;
      }
      #view-timeclock .clock-mark .btn-ghost {
        flex-shrink: 0 !important;
        padding: 6px 10px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        border-radius: 8px !important;
        background: var(--surface, #ffffff) !important;
        border: 1px solid var(--line, #e2e8f0) !important;
      }
      #view-timeoff .section-toolbar {
        margin-bottom: 10px !important;
      }
      .portal-tabs-bar {
        display: flex !important;
        flex-wrap: nowrap !important;
        width: 100% !important;
        overflow-x: auto !important;
        scrollbar-width: none;
        margin-bottom: 14px !important;
      }
      .portal-tabs-bar::-webkit-scrollbar {
        display: none;
      }
      #app .portal-tabs-bar .portal-tab-btn {
        flex: 1 0 auto !important;
        text-align: center !important;
        font-size: 12.5px !important;
        padding: 8px 10px !important;
      }
      .portal-folgas-toolbar {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 8px !important;
        width: 100% !important;
      }
      .portal-folgas-toolbar #timeOffRefreshBtn {
        grid-column: 1 / 2;
        height: 40px !important;
        min-height: 40px !important;
      }
      .portal-folgas-toolbar #newTimeOffBtn {
        grid-column: 2 / 3;
        height: 40px !important;
        min-height: 40px !important;
      }
      .portal-mobile-form-grid {
        grid-template-columns: 1fr !important;
      }
      .portal-mobile-form-grid button[type="submit"] {
        width: 100% !important;
        height: 44px !important;
      }
      .portal-panel-clean {
        padding: 14px !important;
        border-radius: 14px !important;
      }
      .portal-action-row > .btn {
        flex: 1 1 140px;
      }
      .portal-step-chips {
        grid-template-columns: 1fr !important;
      }

      /* Cartoes responsivos automaticos no celular para tabelas de Vale e Fichas */
      #portalValeSection .table-wrap,
      .table-wrap:has(table.portal-responsive-table) {
        overflow: visible !important;
        border: 0 !important;
        box-shadow: none !important;
        background: transparent !important;
        padding: 0 !important;
      }
      table.portal-responsive-table,
      table.portal-responsive-table tbody,
      table.portal-responsive-table tr,
      table.portal-responsive-table td {
        display: block !important;
        min-width: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      table.portal-responsive-table thead {
        display: none !important;
      }
      table.portal-responsive-table tr {
        background: var(--surface, #ffffff) !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 12px !important;
        padding: 10px 12px !important;
        margin-bottom: 10px !important;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04) !important;
      }
      table.portal-responsive-table td {
        display: flex !important;
        justify-content: space-between !important;
        align-items: flex-start !important;
        gap: 10px !important;
        padding: 7px 0 !important;
        border: 0 !important;
        border-bottom: 1px solid #f1f5f9 !important;
        text-align: right !important;
        font-size: 13px !important;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
      }
      table.portal-responsive-table td:last-child {
        border-bottom: 0 !important;
        padding-bottom: 2px !important;
      }
      table.portal-responsive-table td[colspan] {
        display: block !important;
        text-align: center !important;
        padding: 14px 8px !important;
        white-space: normal !important;
        word-break: break-word !important;
        line-height: 1.45 !important;
      }
      table.portal-responsive-table td[colspan]::before {
        display: none !important;
      }
      table.portal-responsive-table td::before {
        content: attr(data-label);
        font-size: 11.5px;
        font-weight: 600;
        color: var(--muted, #64748b);
        text-align: left;
        flex: 0 0 auto;
        white-space: nowrap;
      }

      /* Minhas Solicitacoes / Pendencias Mobile Layout */
      #view-pending-center .pending-hero-actions {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 8px !important;
        width: 100% !important;
      }
      #view-pending-center .pending-hero-actions .btn {
        width: 100% !important;
        min-height: 40px !important;
        padding: 8px 10px !important;
        font-size: 13px !important;
      }
      #view-pending-center .pending-summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 8px !important;
        margin: 12px 0 !important;
      }
      #view-pending-center .pending-summary-card {
        min-height: 64px !important;
        padding: 10px 12px !important;
        gap: 10px !important;
        border-radius: 14px !important;
      }
      #view-pending-center .pending-summary-card.is-total {
        grid-column: 1 / -1 !important;
        min-height: 48px !important;
        padding: 9px 14px !important;
      }
      #view-pending-center .pending-summary-card.is-total > div {
        display: flex !important;
        flex-direction: row !important;
        align-items: baseline !important;
        gap: 8px !important;
      }
      #view-pending-center .pending-summary-icon {
        width: 34px !important;
        height: 34px !important;
        border-radius: 10px !important;
        font-size: 14px !important;
      }
      #view-pending-center .pending-summary-card strong {
        font-size: 20px !important;
      }
      #view-pending-center .pending-filter-bar {
        display: flex !important;
        flex-wrap: nowrap !important;
        overflow-x: auto !important;
        gap: 6px !important;
        padding: 6px !important;
        margin: 0 0 14px !important;
        -webkit-overflow-scrolling: touch !important;
      }
      #view-pending-center .pending-filter-btn {
        flex: 0 0 auto !important;
        white-space: nowrap !important;
        min-height: 34px !important;
        height: 34px !important;
        padding: 0 12px !important;
        font-size: 12px !important;
        line-height: 1 !important;
      }
    }
    .pending-summary-card.is-vale {
      --pending-card-color: #10b981;
    }
    .pending-category-icon.is-vale {
      background: rgba(16, 185, 129, 0.14);
      color: #059669;
      font-size: 14px;
      font-weight: 800;
    }
    .pending-filter-btn em {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      font-style: normal;
      font-size: 11px;
      background: rgba(15, 23, 42, 0.08);
    }
    .pending-filter-btn.active em {
      background: rgba(255, 255, 255, 0.24);
      color: #ffffff;
    }
  `;
  document.head.appendChild(style);
}

function activatePortalTab(groupName, targetKey) {
  const bar = document.querySelector(`.portal-tabs-bar[data-tabs-group="${groupName}"]`);
  if (!bar) return;
  bar.querySelectorAll(".portal-tab-btn").forEach((btn) => {
    const isMatch = btn.getAttribute("data-tab-target") === targetKey;
    btn.classList.toggle("active", isMatch);
    btn.setAttribute("aria-selected", isMatch ? "true" : "false");
  });
  document.querySelectorAll(`.portal-tab-pane[data-tabs-group="${groupName}"]`).forEach((pane) => {
    const isMatch = pane.getAttribute("data-tab-pane") === targetKey;
    pane.classList.toggle("hidden", !isMatch);
  });
}

function bindTabsGroup(groupName) {
  const bar = document.querySelector(`.portal-tabs-bar[data-tabs-group="${groupName}"]`);
  if (!bar || bar.dataset.tabsBound === "true") return;
  bar.dataset.tabsBound = "true";

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".portal-tab-btn");
    if (!btn) return;
    const target = btn.getAttribute("data-tab-target");
    if (target) activatePortalTab(groupName, target);
  });
}

// ============================================================================
// TELA 1: SELETOR DE UNIDADE NO TOPO + RECUPERACAO DE SENHA VIA WHATSAPP
// ============================================================================

function mountTopbarStoreSelector() {
  const topbarActions = document.querySelector(".topbar-actions");
  if (!topbarActions || document.getElementById("globalTopStoreSelector")) return;

  const wrap = document.createElement("div");
  wrap.id = "globalTopStoreSelectorWrap";
  const navMgr = document.querySelector(".nav-item.permission-manager");
  const managerVisible =
    document.getElementById("app") &&
    !document.getElementById("app").classList.contains("hidden") &&
    navMgr &&
    !navMgr.classList.contains("hidden");
  wrap.className = managerVisible ? "permission-manager" : "permission-manager hidden";
  wrap.innerHTML = `
    <label for="globalTopStoreSelector">Unidade:</label>
    <select id="globalTopStoreSelector">
      <option value="">Todas as unidades</option>
    </select>
  `;
  topbarActions.insertBefore(wrap, topbarActions.firstChild);

  const select = wrap.querySelector("#globalTopStoreSelector");
  select?.addEventListener("change", () => {
    const storeId = select.value;
    window.__selectedPortalStoreId = storeId;
    const otherSelectors = [
      "presenceStoreFilter",
      "calendarStoreFilter",
      "fichasStoreFilter",
      "folhaStoreFilter",
      "auditStoreFilter",
    ];
    for (const id of otherSelectors) {
      const el = document.getElementById(id);
      if (el && el.value !== storeId) {
        el.value = storeId;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    refreshPortalViews();
  });
}

function mountWhatsAppPasswordRecovery() {
  const resetForm = document.getElementById("resetPasswordForm");
  if (!resetForm || document.getElementById("resetViaWhatsAppBtn")) return;

  const emailInput = document.getElementById("resetEmail");
  if (emailInput) {
    emailInput.type = "text";
    emailInput.placeholder = "CPF (000.000.000-00) ou seuemail@exemplo.com";
    const label = emailInput.closest("label");
    if (label && label.childNodes[0]?.nodeType === Node.TEXT_NODE) {
      label.childNodes[0].textContent = "CPF ou E-mail ";
    }
  }

  const actionsWrap = resetForm.querySelector(".dialog-actions") || resetForm;
  const waBtn = document.createElement("button");
  waBtn.type = "button";
  waBtn.id = "resetViaWhatsAppBtn";
  waBtn.className = "btn btn-secondary";
  waBtn.textContent = "Recuperar via WhatsApp";
  waBtn.addEventListener("click", async () => {
    const identifier = String(document.getElementById("resetEmail")?.value || "").trim();
    if (!identifier) {
      showPortalToast("Informe seu CPF ou e-mail primeiro.", "warning");
      return;
    }
    try {
      const res = await invokePortal("solicitarRecuperacaoSenhaWhatsApp", { identifier });
      showPortalToast(res.message || "Código enviado via WhatsApp!", "success");
      if (res.data?.whatsappUrl) {
        window.open(res.data.whatsappUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      showPortalToast(err.message || "Erro ao solicitar recuperação via WhatsApp.", "error");
    }
  });
  actionsWrap.appendChild(waBtn);
}

// ============================================================================
// TELA 2: ONBOARDING E CADASTRO ORGANIZADO EM 4 ABAS LIMPAS
// ============================================================================

function populateExtendedEmployeeFields(emp = {}) {
  const setVal = (id, val, fallback = "") => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? fallback;
  };
  setVal("employeeSetor", emp.Setor || "Cozinha", "Cozinha");
  setVal("employeePeriodoExperiencia", String(emp.PeriodoExperienciaDias || 90), "90");
  setVal("employeeTurnoTrabalho", emp.TurnoTrabalho || "");
  setVal("employeeSalarioBase", emp.SalarioBase ?? "");
  setVal("employeeChavePix", emp.ChavePix || "");
  setVal("employeeBancoNome", emp.BancoNome || "");
  setVal("employeeBancoAgencia", emp.BancoAgencia || "");
  setVal("employeeBancoConta", emp.BancoConta || "");
  setVal("employeeNomeSocial", emp.NomeSocial || "");
  setVal("employeeRG", emp.RG || "");
  setVal("employeeDataNascimento", emp.DataNascimento ? String(emp.DataNascimento).slice(0, 10) : "");
  setVal("employeeEstadoCivil", emp.EstadoCivil || "");
  setVal("employeeNomeMae", emp.NomeMae || "");
  setVal("employeeNomePai", emp.NomePai || "");
  setVal("employeeCEP", emp.CEP || "");
  setVal("employeeEndereco", emp.Endereco || "");
  setVal("employeeNumeroEndereco", emp.NumeroEndereco || "");
  setVal("employeeComplemento", emp.Complemento || "");
  setVal("employeeBairro", emp.Bairro || "");
  setVal("employeeCidade", emp.Cidade || "");
  setVal("employeeUF", emp.UF || "");
  setVal("employeeEmergenciaNome", emp.ContatoEmergenciaNome || "");
  setVal("employeeEmergenciaParentesco", emp.ContatoEmergenciaParentesco || "");
  setVal("employeeEmergenciaTelefone", emp.ContatoEmergenciaTelefone || "");
  setVal("employeeEtapaAdmissao", String(emp.EtapaAdmissao || 1), "1");
  setVal("employeeSubstatusEtapa6", emp.SubstatusEtapa6 || "Efetivado", "Efetivado");
  setVal("employeeCadastroValidado", emp.CadastroValidado ? "true" : "false", "false");
  setVal("employeeMotivoDesligamento", emp.MotivoDesligamento || "");
}

function enhanceEmployeeDialog() {
  const form = document.getElementById("employeeForm");
  if (!form || document.getElementById("portalOnboardingTabsWrap")) return;

  const dialog = document.getElementById("employeeDialog");
  const dialogBody = form.querySelector(".dialog-body") || form;
  const avatarSection = dialogBody.querySelector("section.avatar-picker-section");
  const allGrids = Array.from(dialogBody.querySelectorAll(":scope > .dialog-grid"));
  const baseGrid = allGrids[0] || null;
  const jornadaGrid = allGrids[1] || null;
  const lgpdGrid = allGrids[2] || null;
  const lgpdAckBlock = document.getElementById("employeePrivacyPolicyAckBlock");
  const sectionTitles = Array.from(dialogBody.querySelectorAll(":scope > h4.dialog-section-title"));

  const tabsWrap = document.createElement("div");
  tabsWrap.id = "portalOnboardingTabsWrap";
  tabsWrap.innerHTML = `
    <div class="portal-tabs-bar portal-modal-tabs" role="tablist" data-tabs-group="employee-modal">
      <button type="button" class="portal-tab-btn active" data-tab-target="emp-tab-basico" role="tab" aria-selected="true">1. Dados Básicos</button>
      <button type="button" class="portal-tab-btn" data-tab-target="emp-tab-pessoal" role="tab" aria-selected="false">2. Pessoais &amp; Endereço</button>
      <button type="button" class="portal-tab-btn" data-tab-target="emp-tab-jornada" role="tab" aria-selected="false">3. Jornada &amp; Ponto</button>
      <button type="button" class="portal-tab-btn" data-tab-target="emp-tab-funil" role="tab" aria-selected="false">4. Funil (6 Etapas)</button>
      <button type="button" class="portal-tab-btn" data-tab-target="emp-tab-dossie" role="tab" aria-selected="false">5. Dossiê &amp; Contratos</button>
    </div>

    <!-- ABA 1: Dados Básicos, Avatar Compacto, Vínculo e Bancário -->
    <div class="portal-tab-pane" data-tab-pane="emp-tab-basico" data-tabs-group="employee-modal" id="empTabBasicoPane">
      <div class="portal-field-card">
        <div class="portal-field-card-head">
          <h4 class="portal-field-card-title">Identificação &amp; Vínculo</h4>
          <span class="portal-field-card-sub">Dados principais do colaborador na unidade</span>
        </div>
        <div id="empAvatarHost"></div>
        <div id="empBaseGridHost"></div>
      </div>

      <div class="portal-field-card">
        <div class="portal-field-card-head">
          <h4 class="portal-field-card-title">Alocação, Experiência &amp; Pagamento</h4>
          <span class="portal-field-card-sub">Setor operacional, salário base e conta PIX</span>
        </div>
        <div class="dialog-grid">
          <label class="field">
            <span>Setor Operacional</span>
            <select id="employeeSetor" name="Setor">
              <option value="Cozinha">Cozinha</option>
              <option value="Salão">Salão</option>
              <option value="Caixa">Caixa</option>
              <option value="Estoque">Estoque</option>
              <option value="Administrativo">Administrativo</option>
            </select>
          </label>
          <label class="field">
            <span>Período de Experiência</span>
            <select id="employeePeriodoExperiencia" name="PeriodoExperienciaDias">
              <option value="45">45 dias</option>
              <option value="90" selected>90 dias (45 + 45)</option>
            </select>
          </label>
          <label class="field">
            <span>Horário / Turno de Trabalho</span>
            <input id="employeeTurnoTrabalho" name="TurnoTrabalho" placeholder="Ex: 16:00 às 00:20 (Noturno)" />
          </label>
          <label class="field permission-admin">
            <span>Salário Base Mensal (R$)</span>
            <input id="employeeSalarioBase" name="SalarioBase" type="number" min="0" step="0.01" placeholder="1518.00" />
          </label>
          <label class="field">
            <span>Chave PIX</span>
            <input id="employeeChavePix" name="ChavePix" placeholder="CPF, Telefone, E-mail ou Aleatória" />
          </label>
          <label class="field">
            <span>Banco</span>
            <input id="employeeBancoNome" name="BancoNome" placeholder="Ex: Nubank, Itaú, Bradesco" />
          </label>
          <label class="field">
            <span>Agência</span>
            <input id="employeeBancoAgencia" name="BancoAgencia" placeholder="0001" />
          </label>
          <label class="field">
            <span>Conta e Dígito</span>
            <input id="employeeBancoConta" name="BancoConta" placeholder="12345-6" />
          </label>
        </div>
      </div>
    </div>

    <!-- ABA 2: Dados Pessoais, CEP Automático & Contato de Emergência -->
    <div class="portal-tab-pane hidden" data-tab-pane="emp-tab-pessoal" data-tabs-group="employee-modal">
      <div class="portal-field-card">
        <div class="portal-field-card-head">
          <h4 class="portal-field-card-title">Documentos &amp; Filiação</h4>
          <span class="portal-field-card-sub">Dados civis para ficha de registro</span>
        </div>
        <div class="dialog-grid">
          <label class="field">
            <span>Nome Social</span>
            <input id="employeeNomeSocial" name="NomeSocial" placeholder="Opcional" />
          </label>
          <label class="field">
            <span>RG</span>
            <input id="employeeRG" name="RG" placeholder="00.000.000-0" />
          </label>
          <label class="field">
            <span>Data de Nascimento</span>
            <input id="employeeDataNascimento" name="DataNascimento" type="date" />
          </label>
          <label class="field">
            <span>Estado Civil</span>
            <select id="employeeEstadoCivil" name="EstadoCivil">
              <option value="">Selecione</option>
              <option value="Solteiro(a)">Solteiro(a)</option>
              <option value="Casado(a)">Casado(a)</option>
              <option value="União Estável">União Estável</option>
              <option value="Divorciado(a)">Divorciado(a)</option>
              <option value="Viúvo(a)">Viúvo(a)</option>
            </select>
          </label>
          <label class="field">
            <span>Nome da Mãe</span>
            <input id="employeeNomeMae" name="NomeMae" />
          </label>
          <label class="field">
            <span>Nome do Pai</span>
            <input id="employeeNomePai" name="NomePai" />
          </label>
        </div>
      </div>

      <div class="portal-field-card">
        <div class="portal-field-card-head">
          <h4 class="portal-field-card-title">Endereço Residencial</h4>
          <span class="portal-field-card-sub">Digite o CEP e saia do campo para preencher automaticamente</span>
        </div>
        <div class="dialog-grid">
          <label class="field">
            <span>CEP</span>
            <input id="employeeCEP" name="CEP" placeholder="00000-000" maxlength="9" />
          </label>
          <label class="field">
            <span>Logradouro / Rua</span>
            <input id="employeeEndereco" name="Endereco" />
          </label>
          <label class="field">
            <span>Número</span>
            <input id="employeeNumeroEndereco" name="NumeroEndereco" />
          </label>
          <label class="field">
            <span>Complemento</span>
            <input id="employeeComplemento" name="Complemento" />
          </label>
          <label class="field">
            <span>Bairro</span>
            <input id="employeeBairro" name="Bairro" />
          </label>
          <label class="field">
            <span>Cidade</span>
            <input id="employeeCidade" name="Cidade" />
          </label>
          <label class="field">
            <span>UF</span>
            <input id="employeeUF" name="UF" maxlength="2" placeholder="BA" />
          </label>
        </div>
      </div>

      <div class="portal-field-card">
        <div class="portal-field-card-head">
          <h4 class="portal-field-card-title">Contato de Emergência</h4>
          <span class="portal-field-card-sub">Pessoa de referência em caso de urgência</span>
        </div>
        <div class="dialog-grid">
          <label class="field">
            <span>Nome do Contato</span>
            <input id="employeeEmergenciaNome" name="ContatoEmergenciaNome" />
          </label>
          <label class="field">
            <span>Parentesco</span>
            <input id="employeeEmergenciaParentesco" name="ContatoEmergenciaParentesco" placeholder="Ex: Mãe, Cônjuge" />
          </label>
          <label class="field">
            <span>Telefone de Emergência</span>
            <input id="employeeEmergenciaTelefone" name="ContatoEmergenciaTelefone" placeholder="(73) 99999-9999" />
          </label>
        </div>
      </div>
    </div>

    <!-- ABA 3: Jornada e Ponto (realoca campos legados com 100% de compatibilidade) -->
    <div class="portal-tab-pane hidden" data-tab-pane="emp-tab-jornada" data-tabs-group="employee-modal">
      <div class="portal-field-card">
        <div class="portal-field-card-head">
          <h4 class="portal-field-card-title">Jornada de Trabalho &amp; Regras de Ponto</h4>
          <span class="portal-field-card-sub">Turnos, tolerância de atrasos, banco de horas e situação ativa</span>
        </div>
        <div id="empJornadaHost"></div>
      </div>
    </div>

    <!-- ABA 4: Funil de Admissão em 6 Etapas -->
    <div class="portal-tab-pane hidden" data-tab-pane="emp-tab-funil" data-tabs-group="employee-modal">
      <div class="portal-field-card">
        <div class="portal-field-card-head">
          <div>
            <h4 class="portal-field-card-title">Linha do Tempo de Contratação (6 Etapas)</h4>
            <span class="portal-field-card-sub">Registro automático da data em cada transição</span>
          </div>
          <button type="button" id="btnEmployeeAuditHistory" class="btn btn-secondary permission-admin" style="min-height:36px; font-size:12.5px;">
            Histórico de Alterações
          </button>
        </div>
        <div id="portalOnboardingStagesBar" class="portal-timeline-list"></div>
      </div>

      <div class="portal-field-card permission-manager">
        <div class="portal-field-card-head">
          <h4 class="portal-field-card-title">Atualizar Etapa &amp; Validação</h4>
          <span class="portal-field-card-sub">Bloqueie a edição individual após conferência dos dados</span>
        </div>
        <div class="dialog-grid" style="align-items:end;">
          <label class="field">
            <span>Etapa Atual do Funil</span>
            <select id="employeeEtapaAdmissao" name="EtapaAdmissao">
              <option value="1">1. Pré-cadastro / Link enviado</option>
              <option value="2">2. Documentos enviados e em análise</option>
              <option value="3">3. Exame Admissional (ASO) agendado/realizado</option>
              <option value="4">4. Contrato Assinado</option>
              <option value="5">5. Ativo - Período de Experiência</option>
              <option value="6">6. Efetivado / Desligado</option>
            </select>
          </label>
          <label class="field">
            <span>Decisão na Etapa 6</span>
            <select id="employeeSubstatusEtapa6" name="SubstatusEtapa6">
              <option value="Efetivado">Efetivado</option>
              <option value="Desligado">Desligado</option>
            </select>
          </label>
          <label class="field">
            <span>Validação do Cadastro</span>
            <select id="employeeCadastroValidado" name="CadastroValidado">
              <option value="false">Em preenchimento (Aberto)</option>
              <option value="true">Validado (Bloqueado p/ Colaborador)</option>
            </select>
          </label>
          <label class="field">
            <span>Motivo Desligamento (se Etapa 6 = Desligado)</span>
            <input id="employeeMotivoDesligamento" name="MotivoDesligamento" placeholder="Opcional / Obrigatório ao desligar" />
          </label>
          <div>
            <button type="button" id="btnAvancarEtapaOnboarding" class="btn btn-primary" style="width:100%; min-height:40px;">
              Registrar Etapa com Data
            </button>
          </div>
        </div>
        <div id="employeeValidationLockBanner" class="hidden" style="margin-top:12px; padding:10px 12px; border-radius:8px; background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8; font-size:12.5px; font-weight:600;">
          Cadastro validado pela gestão. Os dados cadastrais estão bloqueados para edição individual.
        </div>
      </div>
    </div>

    <!-- ABA 5: Dossiê de Documentos + Contrato/Termo/EPI PDF + Conformidade LGPD -->
    <div class="portal-tab-pane hidden" data-tab-pane="emp-tab-dossie" data-tabs-group="employee-modal">
      <div class="portal-field-card">
        <div class="portal-field-card-head">
          <div>
            <h4 class="portal-field-card-title">Dossiê Admissional &amp; Contrato Digital</h4>
            <span class="portal-field-card-sub">Anexe documentos (PDF/Imagem) e gere o kit admissional</span>
          </div>
          <button type="button" id="btnGerarKitAdmissionalPdf" class="btn btn-primary permission-manager" style="min-height:36px; font-size:12.5px;">
            Gerar Contrato / Termo / EPI (PDF)
          </button>
        </div>

        <div class="dialog-grid" style="align-items:end; margin-bottom:14px;">
          <label class="field">
            <span>Tipo de Documento</span>
            <select id="employeeDocUploadTipo">
              ${REQUIRED_ADMISSION_DOCUMENTS.map((d) => `<option value="${d.codigo}">${d.titulo}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>URL do Arquivo (ou carregado abaixo)</span>
            <input id="employeeDocUploadUrl" type="text" placeholder="Cole URL ou selecione arquivo abaixo" />
          </label>
          <div class="field" style="grid-column: 1 / -1;">
            <span>Arquivo do Aparelho (PDF ou Foto)</span>
            <div class="portal-file-upload-row">
              <label for="employeeDocUploadFile" class="portal-file-upload-btn">
                Selecionar Arquivo (PDF / Foto)
              </label>
              <input id="employeeDocUploadFile" class="portal-file-input-hidden" type="file" accept=".pdf,image/*" />
              <span id="employeeDocUploadFileName" class="portal-file-name-label">Nenhum arquivo selecionado</span>
              <button type="button" id="btnEnviarDocAdmissional" class="btn btn-secondary" style="min-height:38px; margin-left:auto;">
                Anexar ao Dossiê
              </button>
            </div>
          </div>
        </div>

        <div id="employeeDossieChecklist" class="portal-doc-grid"></div>
      </div>

      <div class="portal-field-card">
        <div class="portal-field-card-head">
          <h4 class="portal-field-card-title">Conformidade LGPD &amp; Política de Privacidade</h4>
          <span class="portal-field-card-sub">Termo digital assinado e consentimento físico</span>
        </div>
        <div id="empLgpdHost"></div>
      </div>
    </div>
  `;

  dialogBody.prepend(tabsWrap);
  if (avatarSection) {
    const avatarHost = tabsWrap.querySelector("#empAvatarHost");
    avatarHost?.appendChild(avatarSection);
  }
  if (baseGrid) {
    tabsWrap.querySelector("#empBaseGridHost")?.appendChild(baseGrid);
  }
  if (jornadaGrid) {
    tabsWrap.querySelector("#empJornadaHost")?.appendChild(jornadaGrid);
  }
  const lgpdHost = tabsWrap.querySelector("#empLgpdHost");
  if (lgpdHost) {
    if (lgpdAckBlock) lgpdHost.appendChild(lgpdAckBlock);
    if (lgpdGrid) lgpdHost.appendChild(lgpdGrid);
  }
  sectionTitles.forEach((h) => {
    h.style.display = "none";
  });

  bindTabsGroup("employee-modal");

  // Reset automatico para Aba 1 + preenchimento de campos extras ao abrir o modal
  if (dialog && dialog.dataset.portalOpenObserver !== "true") {
    dialog.dataset.portalOpenObserver = "true";
    const syncOnOpen = async () => {
      if (!dialog.hasAttribute("open")) return;
      activatePortalTab("employee-modal", "emp-tab-basico");
      const empId = document.getElementById("employeeId")?.value || "";
      if (!empId) {
        populateExtendedEmployeeFields({});
        renderEmployeeOnboardingState({});
        return;
      }
      try {
        const emps = await runtime.list("Funcionarios").catch(() => []);
        const match = emps.find((e) => String(e.FuncionarioID) === String(empId));
        if (match) {
          populateExtendedEmployeeFields(match);
          renderEmployeeOnboardingState(match);
        }
      } catch {
        // Silencioso
      }
    };
    const obs = new MutationObserver(() => syncOnOpen());
    obs.observe(dialog, { attributes: true, attributeFilter: ["open"] });
  }

  // Salva campos complementares automaticamente apos salvar formulario
  if (form.dataset.portalExtendedSaveBound !== "true") {
    form.dataset.portalExtendedSaveBound = "true";
    form.addEventListener("submit", () => {
      setTimeout(async () => {
        const empId = document.getElementById("employeeId")?.value || "";
        if (!empId) return;
        try {
          await invokePortal("salvarPreCadastroColaborador", {
            FuncionarioID: empId,
            Setor: document.getElementById("employeeSetor")?.value || "Cozinha",
            PeriodoExperienciaDias: Number(document.getElementById("employeePeriodoExperiencia")?.value || 90),
            TurnoTrabalho: document.getElementById("employeeTurnoTrabalho")?.value || "",
            SalarioBase: document.getElementById("employeeSalarioBase")?.value || 0,
            ChavePix: document.getElementById("employeeChavePix")?.value || "",
            BancoNome: document.getElementById("employeeBancoNome")?.value || "",
            BancoAgencia: document.getElementById("employeeBancoAgencia")?.value || "",
            BancoConta: document.getElementById("employeeBancoConta")?.value || "",
            NomeSocial: document.getElementById("employeeNomeSocial")?.value || "",
            RG: document.getElementById("employeeRG")?.value || "",
            DataNascimento: document.getElementById("employeeDataNascimento")?.value || "",
            EstadoCivil: document.getElementById("employeeEstadoCivil")?.value || "",
            NomeMae: document.getElementById("employeeNomeMae")?.value || "",
            NomePai: document.getElementById("employeeNomePai")?.value || "",
            CEP: document.getElementById("employeeCEP")?.value || "",
            Endereco: document.getElementById("employeeEndereco")?.value || "",
            NumeroEndereco: document.getElementById("employeeNumeroEndereco")?.value || "",
            Complemento: document.getElementById("employeeComplemento")?.value || "",
            Bairro: document.getElementById("employeeBairro")?.value || "",
            Cidade: document.getElementById("employeeCidade")?.value || "",
            UF: document.getElementById("employeeUF")?.value || "",
            ContatoEmergenciaNome: document.getElementById("employeeEmergenciaNome")?.value || "",
            ContatoEmergenciaParentesco: document.getElementById("employeeEmergenciaParentesco")?.value || "",
            ContatoEmergenciaTelefone: document.getElementById("employeeEmergenciaTelefone")?.value || "",
          });
        } catch {
          // Silencioso caso bloqueado para colaborador validado
        }
      }, 650);
    });
  }

  // ViaCEP Auto-fill
  const cepInput = document.getElementById("employeeCEP");
  cepInput?.addEventListener("blur", async () => {
    const digits = String(cepInput.value || "").replace(/\D/g, "");
    if (digits.length !== 8) return;
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && !data.erro) {
        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el && val) el.value = val;
        };
        setVal("employeeEndereco", data.logradouro);
        setVal("employeeBairro", data.bairro);
        setVal("employeeCidade", data.localidade);
        setVal("employeeUF", data.uf);
      }
    } catch {
      // Silencioso caso offline
    }
  });

  // Upload file reader helper com nome amigavel
  const fileInput = document.getElementById("employeeDocUploadFile");
  const fileNameLabel = document.getElementById("employeeDocUploadFileName");
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      if (fileNameLabel) fileNameLabel.textContent = "Nenhum arquivo selecionado";
      return;
    }
    if (fileNameLabel) fileNameLabel.textContent = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      const urlInput = document.getElementById("employeeDocUploadUrl");
      if (urlInput) urlInput.value = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("btnEnviarDocAdmissional")?.addEventListener("click", async () => {
    const empId = form.elements.FuncionarioID?.value || document.getElementById("employeeId")?.value;
    if (!empId) {
      showPortalToast("Salve o cadastro inicial do colaborador antes de anexar documentos.", "warning");
      return;
    }
    const codigoDocumento = document.getElementById("employeeDocUploadTipo")?.value;
    const arquivoUrl = document.getElementById("employeeDocUploadUrl")?.value;
    const fileObj = document.getElementById("employeeDocUploadFile")?.files?.[0];
    try {
      const res = await invokePortal("enviarDocumentoAdmissional", {
        FuncionarioID: empId,
        codigoDocumento,
        arquivoUrl,
        nomeArquivo: fileObj?.name || `${codigoDocumento}.pdf`,
      });
      showPortalToast(res.message || "Documento anexado!", "success");
      renderEmployeeOnboardingState(res.data?.colaborador);
    } catch (err) {
      showPortalToast(err.message || "Falha ao enviar documento.", "error");
    }
  });

  document.getElementById("btnAvancarEtapaOnboarding")?.addEventListener("click", async () => {
    const empId = form.elements.FuncionarioID?.value || document.getElementById("employeeId")?.value;
    if (!empId) {
      showPortalToast("Salve o colaborador antes de registrar a etapa.", "warning");
      return;
    }
    const etapa = Number(document.getElementById("employeeEtapaAdmissao")?.value || 1);
    const substatus = document.getElementById("employeeSubstatusEtapa6")?.value || "Efetivado";
    const validarCadastro = document.getElementById("employeeCadastroValidado")?.value === "true";
    const motivo = document.getElementById("employeeMotivoDesligamento")?.value || "";
    try {
      const res = await invokePortal("avancarEtapaOnboarding", {
        FuncionarioID: empId,
        etapa,
        substatus,
        validarCadastro,
        motivo,
      });
      showPortalToast(res.message || "Etapa registrada!", "success");
      renderEmployeeOnboardingState(res.data);
    } catch (err) {
      showPortalToast(err.message || "Erro ao avançar etapa.", "error");
    }
  });

  document.getElementById("btnGerarKitAdmissionalPdf")?.addEventListener("click", async () => {
    const empId = form.elements.FuncionarioID?.value || document.getElementById("employeeId")?.value;
    if (!empId) {
      showPortalToast("Salve o cadastro do colaborador primeiro.", "warning");
      return;
    }
    try {
      const res = await invokePortal("gerarKitAdmissionalPdf", { FuncionarioID: empId });
      showPortalToast(res.message || "Contrato, Termo e Ficha de EPI gerados!", "success");
    } catch (err) {
      showPortalToast(err.message || "Erro ao gerar Kit Admissional PDF.", "error");
    }
  });

  document.getElementById("btnEmployeeAuditHistory")?.addEventListener("click", async () => {
    const empId = form.elements.FuncionarioID?.value || document.getElementById("employeeId")?.value;
    if (!empId) {
      showPortalToast("Selecione um colaborador já salvo para ver o histórico.", "warning");
      return;
    }
    const dlg = document.getElementById("employeeDialog");
    dlg?.close();
    const auditNav = document.querySelector('[data-view="audit"]');
    auditNav?.click();
    const empFilter = document.getElementById("auditEmployeeFilter");
    if (empFilter) empFilter.value = empId;
    await loadAuditHistoryTable({ employeeId: empId });
  });
}

export function renderEmployeeOnboardingState(emp = {}) {
  const stagesBar = document.getElementById("portalOnboardingStagesBar");
  if (stagesBar) {
    const etapaAtual = Number(emp?.EtapaAdmissao || 1);
    const hist = emp?.HistoricoEtapasAdmissao || {};
    stagesBar.innerHTML = ONBOARDING_STAGES.map((st) => {
      const info = hist[String(st.etapa)];
      const done = st.etapa < etapaAtual;
      const current = st.etapa === etapaAtual;
      const dateStr = info?.data ? String(info.data).slice(0, 10) : "Pendente";
      const cls = done ? "is-done" : current ? "is-current" : "";
      const pillCls = done ? "portal-pill--green" : current ? "portal-pill--blue" : "portal-pill--neutral";
      const pillLabel = done ? "Concluída" : current ? "Atual" : "Pendente";
      return `
        <div class="portal-timeline-step ${cls}">
          <div>
            <strong style="display:block; color:var(--ink); font-size:12.5px;">${st.titulo}</strong>
            <small style="color:var(--muted);">Data: ${dateStr}</small>
          </div>
          <span class="portal-pill ${pillCls}">${pillLabel}</span>
        </div>
      `;
    }).join("");
  }

  const checklist = document.getElementById("employeeDossieChecklist");
  if (checklist) {
    const dossie = emp?.DossieDocumentos || {};
    checklist.innerHTML = REQUIRED_ADMISSION_DOCUMENTS.map((doc) => {
      const item = dossie[doc.codigo];
      return `
        <div class="portal-doc-item">
          <span>${doc.titulo}</span>
          <span class="portal-pill ${item ? "portal-pill--green" : "portal-pill--neutral"}">${item ? "Enviado" : "Pendente"}</span>
        </div>
      `;
    }).join("");
  }

  const lockBanner = document.getElementById("employeeValidationLockBanner");
  const profile = runtime?.profile;
  if (lockBanner) {
    const lockedForSelf = Boolean(emp?.CadastroValidado) && !isGerenteProfile(profile);
    lockBanner.classList.toggle("hidden", !lockedForSelf);
  }
}

async function loadExperienceAlertsBanner() {
  try {
    const res = await invokePortal("listarAlertasExperiencia", {});
    const alertas = res?.data || [];
    let banner = document.getElementById("portalExperienceAlertsBanner");
    const dashboard = document.getElementById("view-dashboard");
    if (!dashboard) return;

    if (!banner) {
      banner = document.createElement("div");
      banner.id = "portalExperienceAlertsBanner";
      banner.className = "panel hidden";
      banner.style.cssText = "margin-bottom:16px; border-left:4px solid #d97706; background:var(--surface); padding:14px 18px;";
      const heroRow = dashboard.querySelector(".hero-row");
      if (heroRow?.nextSibling) {
        dashboard.insertBefore(banner, heroRow.nextSibling);
      } else {
        dashboard.prepend(banner);
      }
    }

    if (!alertas.length) {
      banner.classList.add("hidden");
      return;
    }

    banner.classList.remove("hidden");
    banner.innerHTML = `
      <div>
        <span class="eyebrow" style="color:#d97706;">ALERTA AUTOMÁTICO DE EXPERIÊNCIA (45 / 90 DIAS)</span>
        <h4 style="margin:2px 0 4px;">${alertas.length} contrato(s) de experiência próximos do vencimento</h4>
        <div style="display:grid; gap:4px; font-size:13px;">
          ${alertas
            .map((a) => `<div><strong>${a.Nome}</strong> (${a.NomeLoja || "Unidade"}) — ${a.Mensagem}</div>`)
            .join("")}
        </div>
      </div>
    `;
  } catch {
    // Silencioso caso sessão ainda não pronta
  }
}

// ============================================================================
// TELA 2B: RESUMO KPI DE EQUIPE E FILTRO POR ETAPA DE ONBOARDING
// ============================================================================

function applyEmployeeStageRowFilter() {
  const stageFilter = document.getElementById("employeeStageFilter")?.value || "";
  const tbody = document.getElementById("employeeBody");
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll("tr"));
  const emailStageMap = window.__portalEmpStageByEmail || {};
  rows.forEach((tr) => {
    if (!stageFilter) {
      tr.style.display = "";
      return;
    }
    const text = String(tr.textContent || "").toLowerCase();
    const matched = Object.entries(emailStageMap).find(([email]) => email && text.includes(email));
    if (!matched) {
      tr.style.display = stageFilter === "1" ? "" : "none";
      return;
    }
    tr.style.display = String(matched[1]) === String(stageFilter) ? "" : "none";
  });
}

function mountEmployeesOverviewSummary() {
  const view = document.getElementById("view-employees");
  if (!view || document.getElementById("portalEmployeesKpiStrip")) return;

  const toolbar = view.querySelector(".section-toolbar");
  const titleEl = toolbar?.querySelector("h2");
  if (titleEl) titleEl.textContent = "Onboarding & Equipe";

  const actions = toolbar?.querySelector(".toolbar-actions");
  if (actions && !document.getElementById("employeeStageFilter")) {
    const sel = document.createElement("select");
    sel.id = "employeeStageFilter";
    sel.title = "Filtrar por etapa do funil de admissão";
    sel.innerHTML = `
      <option value="">Todas as etapas</option>
      ${ONBOARDING_STAGES.map((st) => `<option value="${st.etapa}">${st.titulo}</option>`).join("")}
    `;
    const newBtn = document.getElementById("newEmployeeBtn");
    if (newBtn) {
      actions.insertBefore(sel, newBtn);
    } else {
      actions.appendChild(sel);
    }
    sel.addEventListener("change", applyEmployeeStageRowFilter);
  }

  const kpiStrip = document.createElement("div");
  kpiStrip.id = "portalEmployeesKpiStrip";
  kpiStrip.className = "portal-kpi-strip";
  kpiStrip.innerHTML = `
    <article class="portal-kpi-card">
      <span class="portal-kpi-label">Equipe Ativa</span>
      <strong id="empKpiAtivos" class="portal-kpi-value">0</strong>
    </article>
    <article class="portal-kpi-card">
      <span class="portal-kpi-label">Em Onboarding (Etapas 1-4)</span>
      <strong id="empKpiOnboarding" class="portal-kpi-value" style="color:var(--brand-solid, #4077ba);">0</strong>
    </article>
    <article class="portal-kpi-card">
      <span class="portal-kpi-label">Experiência Vencendo (&lt;= 5d)</span>
      <strong id="empKpiExperiencia" class="portal-kpi-value" style="color:#d97706;">0</strong>
    </article>
    <article class="portal-kpi-card">
      <span class="portal-kpi-label">Cadastros Validados</span>
      <strong id="empKpiValidados" class="portal-kpi-value" style="color:#047857;">0</strong>
    </article>
  `;

  if (toolbar?.nextSibling) {
    view.insertBefore(kpiStrip, toolbar.nextSibling);
  } else {
    view.appendChild(kpiStrip);
  }

  const tbody = document.getElementById("employeeBody");
  if (tbody && tbody.dataset.stageFilterObserver !== "true") {
    tbody.dataset.stageFilterObserver = "true";
    const obs = new MutationObserver(() => applyEmployeeStageRowFilter());
    obs.observe(tbody, { childList: true });
  }
}

async function loadEmployeesOverviewSummary() {
  try {
    const storeId = window.__selectedPortalStoreId || "";
    const [employees, alertsRes] = await Promise.all([
      runtime.list("Funcionarios").catch(() => []),
      invokePortal("listarAlertasExperiencia", {}).catch(() => ({ data: [] })),
    ]);

    const filtered = storeId
      ? employees.filter((e) => String(e.LojaID || "") === String(storeId))
      : employees;

    const stageMap = {};
    let ativos = 0;
    let onboarding = 0;
    let validados = 0;
    filtered.forEach((e) => {
      const email = String(e.Email || "").trim().toLowerCase();
      const etapa = Number(e.EtapaAdmissao || 1);
      if (email) stageMap[email] = etapa;
      if (e.Ativo !== false) ativos += 1;
      if (etapa >= 1 && etapa <= 4 && e.Ativo !== false) onboarding += 1;
      if (e.CadastroValidado) validados += 1;
    });
    window.__portalEmpStageByEmail = stageMap;

    const alertas = (alertsRes?.data || []).filter((a) => !storeId || String(a.LojaID || "") === String(storeId));
    const setKpi = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    setKpi("empKpiAtivos", ativos);
    setKpi("empKpiOnboarding", onboarding);
    setKpi("empKpiExperiencia", alertas.length);
    setKpi("empKpiValidados", validados);
    applyEmployeeStageRowFilter();
  } catch {
    // Silencioso
  }
}

// ============================================================================
// TELA 4: SOLICITACOES EM ABAS LIMPAS [FOLGAS | TROCAS DE TURNO | VALES]
// ============================================================================

function mountSolicitacoesTabsAndVale() {
  const timeoffView = document.getElementById("view-timeoff");
  if (!timeoffView || document.getElementById("portalTimeoffTabsBar")) return;

  const toolbar = timeoffView.querySelector(".section-toolbar");
  const toolbarActions = toolbar?.querySelector(".toolbar-actions");
  const existingTablePanel = timeoffView.querySelector(".table-panel");

  const tabsBar = document.createElement("div");
  tabsBar.id = "portalTimeoffTabsBar";
  tabsBar.className = "portal-tabs-bar";
  tabsBar.setAttribute("role", "tablist");
  tabsBar.setAttribute("data-tabs-group", "solicitacoes");
  tabsBar.innerHTML = `
    <button type="button" class="portal-tab-btn active" data-tab-target="sol-folgas" role="tab" aria-selected="true">Folgas</button>
    <button type="button" class="portal-tab-btn" data-tab-target="sol-trocas" role="tab" aria-selected="false">Trocas de Turno</button>
    <button type="button" class="portal-tab-btn" data-tab-target="sol-vales" role="tab" aria-selected="false">Vales</button>
  `;

  if (toolbar?.nextSibling) {
    timeoffView.insertBefore(tabsBar, toolbar.nextSibling);
  } else {
    timeoffView.appendChild(tabsBar);
  }

  // Aba 1: Envolve toolbar de filtros/acoes + tabela de folgas dentro da aba Folgas
  const folgasPane = document.createElement("div");
  folgasPane.id = "portalFolgasPane";
  folgasPane.className = "portal-tab-pane";
  folgasPane.setAttribute("data-tab-pane", "sol-folgas");
  folgasPane.setAttribute("data-tabs-group", "solicitacoes");
  tabsBar.after(folgasPane);

  if (toolbarActions) {
    toolbarActions.classList.remove("toolbar-actions");
    toolbarActions.classList.add("portal-folgas-toolbar");
    folgasPane.appendChild(toolbarActions);
  }
  if (existingTablePanel) {
    folgasPane.appendChild(existingTablePanel);
  }

  // Aba 2: Trocas de Turno otimizada para o colaborador
  const swapsPane = document.createElement("div");
  swapsPane.id = "portalTrocasPane";
  swapsPane.className = "portal-tab-pane panel portal-panel-clean hidden";
  swapsPane.setAttribute("data-tab-pane", "sol-trocas");
  swapsPane.setAttribute("data-tabs-group", "solicitacoes");
  swapsPane.innerHTML = `
    <div style="margin-bottom: 12px;">
      <span class="eyebrow">ESCALA COMPARTILHADA</span>
      <h3 style="margin: 2px 0 4px;">Trocar Turno com Colega</h3>
      <p style="font-size: 13px; color: var(--muted); margin: 0;">Precisa ajustar seu dia de trabalho? Combine com um colega da sua loja em 3 passos simples:</p>
    </div>

    <div class="portal-step-chips">
      <div class="portal-step-chip"><strong>1. Você solicita</strong>Escolha a data e indique o colega disponível</div>
      <div class="portal-step-chip"><strong>2. Colega aceita</strong>O colega confirma a troca pelo app</div>
      <div class="portal-step-chip"><strong>3. Gerência aprova</strong>A escala atualiza automaticamente</div>
    </div>

    <div class="portal-action-row">
      <button type="button" id="portalAbrirTrocaTurnoBtn" class="btn btn-primary">+ Solicitar Troca</button>
      <button type="button" class="btn btn-secondary" data-view-target="pending-center">Ver Minhas Trocas</button>
    </div>
  `;
  timeoffView.appendChild(swapsPane);

  swapsPane.querySelector("#portalAbrirTrocaTurnoBtn")?.addEventListener("click", () => {
    const legacyBtn = document.getElementById("timeOffSwapBtn") || document.getElementById("newSwapBtn");
    legacyBtn?.click();
  });

  // Aba 3: Solicitações de Vale / Adiantamento (Mobile-First e sem vazamento de data)
  const valePane = document.createElement("div");
  valePane.id = "portalValeSection";
  valePane.className = "portal-tab-pane panel portal-panel-clean hidden";
  valePane.setAttribute("data-tab-pane", "sol-vales");
  valePane.setAttribute("data-tabs-group", "solicitacoes");
  valePane.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom: 14px;">
      <div>
        <span class="eyebrow">ADIANTAMENTO SALARIAL</span>
        <h3 style="margin: 2px 0 4px;">Pedir Vale</h3>
        <p style="font-size: 13px; color: var(--muted); margin: 0;">Seu pedido passa pela conferência do gerente e pagamento pela diretoria.</p>
      </div>
      <div class="permission-admin" style="display:inline-flex; gap:6px; align-items:center; flex-wrap:wrap;">
        <input id="valeNovoLimiteInput" type="number" min="50" step="10" placeholder="Teto limite (R$)" style="width:136px !important; min-height:36px !important; height:36px !important;" />
        <button type="button" id="btnSalvarLimiteVale" class="btn btn-secondary" style="min-height:36px; height:36px;">Definir Teto</button>
      </div>
    </div>

    <form id="portalSolicitarValeForm" class="portal-mobile-form-grid" style="margin: 0 0 18px;">
      <label>Valor Solicitado (R$)
        <input id="valeValorInput" type="number" min="10" step="0.01" placeholder="Ex: 250,00" required />
      </label>
      <label>Data Desejada
        <input id="valeDataDesejadaInput" type="date" required />
      </label>
      <label style="grid-column: 1 / -1;">Motivo do Pedido
        <input id="valeMotivoInput" type="text" placeholder="Ex: Despesa médica, transporte, emergência" required />
      </label>
      <div style="grid-column: 1 / -1;">
        <button type="submit" class="btn btn-primary" style="min-height:44px; width:100%;">Enviar Pedido de Vale</button>
      </div>
    </form>

    <div style="margin-bottom: 10px;">
      <h4 style="margin: 0; font-size: 14px; color: var(--ink);">Meus Pedidos de Vale</h4>
    </div>
    <div class="table-wrap">
      <table class="portal-responsive-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Colaborador</th>
            <th>Unidade</th>
            <th class="portal-num-col">Valor</th>
            <th>Motivo</th>
            <th>Status</th>
            <th>Comprovante</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody id="portalValesTableBody"></tbody>
      </table>
    </div>
  `;

  timeoffView.appendChild(valePane);
  bindTabsGroup("solicitacoes");

  const dateInput = document.getElementById("valeDataDesejadaInput");
  if (dateInput && !dateInput.value) dateInput.value = todayIso();

  document.getElementById("portalSolicitarValeForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const valor = Number(document.getElementById("valeValorInput")?.value || 0);
    const dataDesejada = document.getElementById("valeDataDesejadaInput")?.value || todayIso();
    const motivo = document.getElementById("valeMotivoInput")?.value || "";
    try {
      const res = await invokePortal("solicitarVale", { valor, dataDesejada, motivo });
      showPortalToast(res.message || "Vale solicitado!", "success");
      document.getElementById("valeValorInput").value = "";
      document.getElementById("valeMotivoInput").value = "";
      await loadValesList();
    } catch (err) {
      showPortalToast(err.message || "Não foi possível solicitar o vale.", "error");
    }
  });

  document.getElementById("btnSalvarLimiteVale")?.addEventListener("click", async () => {
    const valorLimite = Number(document.getElementById("valeNovoLimiteInput")?.value || 0);
    try {
      const res = await invokePortal("configurarLimiteVale", {
        valorLimite,
        storeId: window.__selectedPortalStoreId || "",
      });
      showPortalToast(res.message || "Limite atualizado!", "success");
      await loadValesList();
    } catch (err) {
      showPortalToast(err.message || "Erro ao configurar limite.", "error");
    }
  });
}

function getValeStatusMeta(status) {
  const statusLower = String(status || "").toLowerCase();
  const pillCls = statusLower.includes("pago")
    ? "portal-pill--green"
    : statusLower.includes("recus")
      ? "portal-pill--red"
      : statusLower.includes("validado")
        ? "portal-pill--blue"
        : "portal-pill--amber";
  return { pillCls };
}

function buildValeActionButtons(v, isManagerUser, isAdminUser) {
  const actions = [];
  if (isManagerUser && v.Status === "Solicitado") {
    actions.push(
      `<button type="button" class="btn btn-ghost btn-sm" data-vale-action="recusar-gerente" data-vale-id="${v.ValeID}">Recusar</button>`,
      `<button type="button" class="btn btn-secondary btn-sm" data-vale-action="validar-gerente" data-vale-id="${v.ValeID}">Validar (Gerente)</button>`,
    );
  }
  if (isAdminUser && (v.Status === "Validado pelo Gerente" || v.Status === "Solicitado")) {
    actions.push(
      `<button type="button" class="btn btn-primary btn-sm" data-vale-action="pagar-diretoria" data-vale-id="${v.ValeID}">Aprovar e Pagar</button>`,
    );
  }
  return actions;
}

function bindValeActionButtons(rootEl) {
  rootEl?.querySelectorAll("[data-vale-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.getAttribute("data-vale-action");
      const valeId = btn.getAttribute("data-vale-id");
      try {
        if (action === "validar-gerente" || action === "recusar-gerente") {
          await invokePortal("validarValeGerente", {
            ValeID: valeId,
            aprovar: action === "validar-gerente",
          });
          showPortalToast("Validação do gerente registrada!", "success");
        } else if (action === "pagar-diretoria") {
          const comprovanteUrl = window.prompt(
            "Informe a URL ou código do comprovante PIX/transferência para liberar o pagamento e gerar o recibo digital:",
            `comprovante-pix-${valeId.slice(0, 8)}.pdf`,
          );
          if (!comprovanteUrl) return;
          await invokePortal("aprovarPagarValeDiretoria", {
            ValeID: valeId,
            aprovar: true,
            comprovanteUrl,
          });
          showPortalToast("Vale pago e recibo enviado para assinatura digital!", "success");
        }
        await loadValesList();
      } catch (err) {
        showPortalToast(err.message || "Falha ao processar solicitação de vale.", "error");
      }
    });
  });
}

async function loadValesList() {
  const tbody = document.getElementById("portalValesTableBody");
  const pendingCardsEl = document.getElementById("valePendingCards");
  if (!tbody && !pendingCardsEl) return;
  try {
    const res = await invokePortal("listarVales", {
      storeId: window.__selectedPortalStoreId || "",
    });
    const { limiteMaximo, vales = [] } = res.data || {};
    const badge = document.getElementById("valeLimiteMaximoBadge");
    if (badge && limiteMaximo) {
      badge.textContent = formatBRL(limiteMaximo);
    }
    const profile = runtime?.profile;
    const isAdminUser = isDiretoriaProfile(profile);
    const isManagerUser = isGerenteProfile(profile);

    const pendingCount = vales.filter((v) => {
      if (isAdminUser) return v.Status === "Validado pelo Gerente" || v.Status === "Solicitado";
      if (isManagerUser) return v.Status === "Solicitado";
      return v.Status === "Solicitado" || v.Status === "Validado pelo Gerente";
    }).length;
    window.__portalValesPendingCount = pendingCount;
    window.syncPendingCenterSummary?.();

    if (tbody) {
      if (!vales.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--muted);">Nenhuma solicitação de vale registrada no período.</td></tr>`;
      } else {
        tbody.innerHTML = vales
          .map((v) => {
            const actions = buildValeActionButtons(v, isManagerUser, isAdminUser);
            const { pillCls } = getValeStatusMeta(v.Status);
            return `
              <tr>
                <td data-label="Data">${v.DataDesejada || "-"}</td>
                <td data-label="Colaborador"><strong>${v.FuncionarioNome || "-"}</strong></td>
                <td data-label="Unidade">${v.NomeLoja || v.LojaID || "-"}</td>
                <td data-label="Valor" class="portal-num-col" style="font-weight:700; color:var(--ink);">${formatBRL(v.Valor)}</td>
                <td data-label="Motivo">${v.Motivo || "-"}</td>
                <td data-label="Status"><span class="portal-pill ${pillCls}">${v.Status}</span></td>
                <td data-label="Comprovante">${v.ComprovanteURL ? `<a href="${v.ComprovanteURL}" target="_blank" rel="noopener">Abrir Recibo</a>` : "-"}</td>
                <td data-label="Ações"><div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">${actions.join("") || "-"}</div></td>
              </tr>
            `;
          })
          .join("");
        bindValeActionButtons(tbody);
      }
    }

    if (pendingCardsEl) {
      const visibleCards = vales.slice(0, 20);
      if (!visibleCards.length) {
        pendingCardsEl.innerHTML = `<div class="panel pending-empty-state"><span>R$</span><strong>Nenhum pedido de vale registrado</strong><p>Use o botão Pedir vale no topo para enviar uma solicitação.</p></div>`;
      } else {
        pendingCardsEl.innerHTML = visibleCards
          .map((v) => {
            const actions = buildValeActionButtons(v, isManagerUser, isAdminUser);
            const { pillCls } = getValeStatusMeta(v.Status);
            return `
              <article class="request-card pending-unified-card">
                <div class="request-card-head">
                  <div class="person-cell"><strong>${v.FuncionarioNome || "Colaborador"}</strong></div>
                  <span class="portal-pill ${pillCls}">${v.Status}</span>
                </div>
                <div class="pending-card-meta">
                  <span><strong>${formatBRL(v.Valor)}</strong></span>
                  <span>Para: <strong>${v.DataDesejada || "-"}</strong></span>
                  <span>${v.NomeLoja || v.LojaID || "-"}</span>
                </div>
                <p>${v.Motivo || "Sem motivo informado"}</p>
                ${v.ComprovanteURL ? `<div style="margin-bottom:8px;"><a href="${v.ComprovanteURL}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Ver Comprovante ↗</a></div>` : ""}
                ${actions.length ? `<div class="request-card-actions">${actions.join("")}</div>` : ""}
              </article>
            `;
          })
          .join("");
        bindValeActionButtons(pendingCardsEl);
      }
    }
  } catch {
    // Silencioso
  }
}

// ============================================================================
// TELA 5: VALOR DE FICHA EM ABAS LIMPAS [EXTRATO | LANCAR FICHAS | TABELA]
// ============================================================================

function bindFichasView() {
  bindTabsGroup("fichas");

  const compInput = document.getElementById("fichasCompetenciaInput");
  if (compInput && !compInput.value) compInput.value = todayIso().slice(0, 7);
  const dataInput = document.getElementById("fichaLancamentoData");
  if (dataInput && !dataInput.value) dataInput.value = todayIso();

  document.getElementById("fichasRefreshBtn")?.addEventListener("click", () => loadFichasView());
  compInput?.addEventListener("change", () => loadFichasView());
  document.getElementById("fichasStoreFilter")?.addEventListener("change", () => loadFichasView());

  document.getElementById("fichaTabelaConfigForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const Operacao = document.getElementById("fichaConfigOperacao")?.value || "House Tx";
      const Funcao = document.getElementById("fichaConfigFuncao")?.value || "";
      const Turno = document.getElementById("fichaConfigTurno")?.value || "Geral";
      const ValorUnitario = Number(document.getElementById("fichaConfigValor")?.value || 0);
      const res = await invokePortal("salvarConfiguracaoFicha", {
        Operacao,
        Funcao,
        Turno,
        ValorUnitario,
      });
      showPortalToast(res.message || "Valor de ficha salvo!", "success");
      await loadFichasView();
    } catch (err) {
      showPortalToast(err.message || "Erro ao salvar tabela de fichas.", "error");
    }
  });

  document.getElementById("fichaLancamentoForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const FuncionarioID = document.getElementById("fichaLancamentoEmployee")?.value || "";
      const Operacao = document.getElementById("fichaLancamentoOperacao")?.value || "House Tx";
      const Data = document.getElementById("fichaLancamentoData")?.value || todayIso();
      const Quantidade = Number(document.getElementById("fichaLancamentoQtd")?.value || 1);
      const Funcao = document.getElementById("fichaLancamentoFuncao")?.value || "";
      const Turno = document.getElementById("fichaLancamentoTurno")?.value || "Geral";
      const Observacao = document.getElementById("fichaLancamentoObs")?.value || "";
      const res = await invokePortal("lancarFichaDiaria", {
        FuncionarioID,
        Operacao,
        Data,
        Quantidade,
        Funcao,
        Turno,
        Observacao,
      });
      showPortalToast(res.message || "Ficha lançada!", "success");
      await loadFichasView();
    } catch (err) {
      showPortalToast(err.message || "Erro ao lançar ficha diária.", "error");
    }
  });
}

async function loadFichasView() {
  const tbody = document.getElementById("fichasExtratoBody");
  if (!tbody) return;

  try {
    const competencia = document.getElementById("fichasCompetenciaInput")?.value || todayIso().slice(0, 7);
    const storeId = document.getElementById("fichasStoreFilter")?.value || window.__selectedPortalStoreId || "";

    const [extratoRes, configRes, employees] = await Promise.all([
      invokePortal("consultarExtratoFichas", { competencia, storeId }),
      invokePortal("listarConfiguracoesFicha", {}),
      runtime.list("Funcionarios").catch(() => []),
    ]);

    const empSelect = document.getElementById("fichaLancamentoEmployee");
    if (empSelect && employees.length) {
      const currentVal = empSelect.value;
      const activeEmps = employees.filter((e) => e.Ativo !== false && (!storeId || e.LojaID === storeId));
      empSelect.innerHTML = activeEmps
        .map((e) => `<option value="${e.FuncionarioID}">${e.Nome} (${e.Cargo || "Operação"})</option>`)
        .join("");
      if (currentVal) empSelect.value = currentVal;
    }

    const resumo = extratoRes?.data?.resumo || {};
    const lancamentos = extratoRes?.data?.lancamentos || [];
    const configs = configRes?.data || [];

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTxt("fichasTotalHouseQtd", `${resumo.qtdHouseTx || 0} fichas`);
    setTxt("fichasTotalHouseValor", formatBRL(resumo.valorHouseTx || 0));
    setTxt("fichasTotalFoodParkQtd", `${resumo.qtdFoodParkTx || 0} fichas`);
    setTxt("fichasTotalFoodParkValor", formatBRL(resumo.valorFoodParkTx || 0));
    setTxt("fichasSaldoTotalReceber", formatBRL(resumo.saldoTotalReceber || 0));
    setTxt("fichasQuantidadeTotalText", `${resumo.quantidadeTotal || 0} fichas lançadas no período`);

    const configListEl = document.getElementById("fichaTabelaConfigList");
    if (configListEl) {
      configListEl.innerHTML = configs.length
        ? `<div style="display:flex; gap:8px; flex-wrap:wrap;">${configs
            .map((c) => {
              const isFood = String(c.Operacao || "").toLowerCase().includes("food");
              return `<span class="portal-pill ${isFood ? "portal-pill--amber" : "portal-pill--blue"}">${c.Operacao} · ${c.Funcao} (${c.Turno}): <strong style="margin-left:4px;">${formatBRL(c.ValorUnitario)}</strong></span>`;
            })
            .join("")}</div>`
        : `<small style="color:var(--muted);">Nenhum valor configurado ainda.</small>`;
    }

    if (!lancamentos.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--muted);">Nenhuma ficha lançada para esta competência.</td></tr>`;
      return;
    }

    tbody.innerHTML = lancamentos
      .map((l) => {
        const op = l.Operacao || "House Tx";
        const isFood = op.toLowerCase().includes("food");
        return `
        <tr>
          <td data-label="Data">${l.Data || "-"}</td>
          <td data-label="Colaborador"><strong>${l.FuncionarioNome || "-"}</strong></td>
          <td data-label="Unidade">${l.NomeLoja || l.LojaID || "-"}</td>
          <td data-label="Operação"><span class="portal-pill ${isFood ? "portal-pill--amber" : "portal-pill--blue"}">${op}</span></td>
          <td data-label="Função / Turno">${l.Funcao || "-"} / ${l.Turno || "Geral"}</td>
          <td data-label="Quantidade" class="portal-num-col">${l.Quantidade}</td>
          <td data-label="Valor Unit." class="portal-num-col">${formatBRL(l.ValorUnitario)}</td>
          <td data-label="Total" class="portal-num-col" style="font-weight:700; color:#047857;">${formatBRL(l.ValorTotal)}</td>
          <td data-label="Lançado por">${l.LancadoPor || "-"}</td>
        </tr>
      `;
      })
      .join("");
  } catch {
    // Silencioso
  }
}

// ============================================================================
// TELA 6: AVISOS E POPS EM ABAS LIMPAS [MURAL DE AVISOS | POPS E TREINAMENTOS]
// ============================================================================

function mountCommunicationTabsAndPops() {
  const commView = document.getElementById("view-communication");
  if (!commView || document.getElementById("portalCommTabsBar")) return;

  const toolbar = commView.querySelector(".section-toolbar");
  const titleEl = toolbar?.querySelector("h2");
  if (titleEl) titleEl.textContent = "Mural de Avisos e POPs";
  const descEl = toolbar?.querySelector("p");
  if (descEl) descEl.textContent = "Comunicados segmentados por setor e treinamentos internos com confirmação de leitura.";

  // Adiciona seletor de Setor no form de comunicados
  const noticeForm = document.getElementById("announcementForm");
  if (noticeForm && !document.getElementById("announcementSector")) {
    const storeSelectLabel = document.getElementById("announcementStore")?.closest("label");
    if (storeSelectLabel) {
      const sectorLabel = document.createElement("label");
      sectorLabel.innerHTML = `Setor (Segmentação)
        <select id="announcementSector" name="Setor">
          <option value="Todos">Todos os setores</option>
          <option value="Cozinha">Cozinha</option>
          <option value="Salão">Salão</option>
          <option value="Caixa">Caixa</option>
          <option value="Estoque">Estoque</option>
        </select>
      `;
      storeSelectLabel.after(sectorLabel);
    }
  }

  const tabsBar = document.createElement("div");
  tabsBar.id = "portalCommTabsBar";
  tabsBar.className = "portal-tabs-bar";
  tabsBar.setAttribute("role", "tablist");
  tabsBar.setAttribute("data-tabs-group", "communication");
  tabsBar.innerHTML = `
    <button type="button" class="portal-tab-btn active" data-tab-target="comm-avisos" role="tab" aria-selected="true">Mural de Avisos</button>
    <button type="button" class="portal-tab-btn" data-tab-target="comm-pops" role="tab" aria-selected="false">POPs e Treinamentos</button>
  `;

  if (toolbar?.nextSibling) {
    commView.insertBefore(tabsBar, toolbar.nextSibling);
  } else {
    commView.appendChild(tabsBar);
  }

  // Envolve os blocos existentes de Avisos na Aba 1
  const avisosPane = document.createElement("div");
  avisosPane.className = "portal-tab-pane";
  avisosPane.setAttribute("data-tab-pane", "comm-avisos");
  avisosPane.setAttribute("data-tabs-group", "communication");
  avisosPane.style.cssText = "display:grid; gap:18px;";

  const advancedGrid = commView.querySelector(".advanced-grid");
  const announcementFeedPanel = document.getElementById("announcementList")?.closest(".panel");
  tabsBar.after(avisosPane);
  if (advancedGrid) avisosPane.appendChild(advancedGrid);
  if (announcementFeedPanel) avisosPane.appendChild(announcementFeedPanel);

  // Aba 2: POPs e Treinamentos
  const popsWrap = document.createElement("div");
  popsWrap.id = "portalPopsSection";
  popsWrap.className = "portal-tab-pane panel hidden";
  popsWrap.setAttribute("data-tab-pane", "comm-pops");
  popsWrap.setAttribute("data-tabs-group", "communication");
  popsWrap.innerHTML = `
    <div class="panel-head">
      <div>
        <span class="eyebrow">TREINAMENTOS E PADRÕES</span>
        <h3>POPs e Manuais de Treinamento (Vídeos e PDFs)</h3>
        <p style="font-size:13px; color:var(--muted);">Procedimentos operacionais com confirmação de leitura pela equipe.</p>
      </div>
    </div>

    <form id="portalPopForm" class="portal-mobile-form-grid permission-manager" style="margin:14px 0; padding:14px; background:var(--surface-2); border-radius:12px; border:1px solid var(--line);">
      <label>Título do POP / Treinamento
        <input id="popTituloInput" type="text" placeholder="Ex: POP 01 - Higienização e Segurança na Chapa" required />
      </label>
      <label>Setor Destino
        <select id="popSetorSelect">
          <option value="Todos">Todos os Setores</option>
          <option value="Cozinha">Cozinha</option>
          <option value="Salão">Salão</option>
          <option value="Caixa">Caixa</option>
          <option value="Estoque">Estoque</option>
        </select>
      </label>
      <label>Formato
        <select id="popTipoMidiaSelect">
          <option value="PDF">Manual em PDF</option>
          <option value="VIDEO">Vídeo Curto</option>
        </select>
      </label>
      <label>URL do Vídeo ou PDF
        <input id="popArquivoUrlInput" type="text" placeholder="https://..." required />
      </label>
      <button type="submit" class="btn btn-primary" style="min-height:42px;">Publicar POP</button>
    </form>

    <div id="portalPopsList" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:14px; margin-top:14px;"></div>
  `;

  commView.appendChild(popsWrap);
  bindTabsGroup("communication");

  document.getElementById("portalPopForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const Titulo = document.getElementById("popTituloInput")?.value || "";
      const Setor = document.getElementById("popSetorSelect")?.value || "Todos";
      const TipoMidia = document.getElementById("popTipoMidiaSelect")?.value || "PDF";
      const ArquivoURL = document.getElementById("popArquivoUrlInput")?.value || "";
      const res = await invokePortal("salvarPopTreinamento", {
        Titulo,
        Setor,
        TipoMidia,
        ArquivoURL,
      });
      showPortalToast(res.message || "POP publicado!", "success");
      document.getElementById("popTituloInput").value = "";
      document.getElementById("popArquivoUrlInput").value = "";
      await loadPopsList();
    } catch (err) {
      showPortalToast(err.message || "Erro ao publicar POP.", "error");
    }
  });
}

async function loadPopsList() {
  const container = document.getElementById("portalPopsList");
  if (!container) return;
  try {
    const res = await invokePortal("listarPopsTreinamentos", {});
    const pops = res?.data || [];
    if (!pops.length) {
      container.innerHTML = `<p style="color:var(--muted); font-size:13px;">Nenhum POP ou manual cadastrado no momento.</p>`;
      return;
    }
    container.innerHTML = pops
      .map(
        (p) => `
        <article class="panel" style="padding:14px; border:1px solid var(--line); display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <span class="badge">${p.TipoMidia || "PDF"} · Setor: ${p.Setor || "Todos"}</span>
              <small style="color:var(--muted);">${p.TotalConfirmacoes || 0} leituras</small>
            </div>
            <h4 style="margin:8px 0 4px;">${p.Titulo}</h4>
            <a href="${p.ArquivoURL}" target="_blank" rel="noopener" style="font-size:12.5px; color:var(--brand-solid); font-weight:600;">Abrir Material (${p.TipoMidia || "PDF"})</a>
          </div>
          <div>
            ${
              p.ConcluidoPorMim
                ? `<span class="badge" style="background:rgba(22,163,74,0.12); color:#16a34a;">Leitura Confirmada (${String(p.DataMinhaConclusao || "").slice(0, 10)})</span>`
                : `<button type="button" class="btn btn-primary btn-sm" data-confirm-pop="${p.PopID}">Confirmar Leitura</button>`
            }
          </div>
        </article>
      `,
      )
      .join("");

    container.querySelectorAll("[data-confirm-pop]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const popId = btn.getAttribute("data-confirm-pop");
        try {
          const r = await invokePortal("confirmarLeituraPop", { PopID: popId });
          showPortalToast(r.message || "Leitura confirmada!", "success");
          await loadPopsList();
        } catch (err) {
          showPortalToast(err.message || "Falha ao confirmar leitura.", "error");
        }
      });
    });
  } catch {
    // Silencioso
  }
}

// ============================================================================
// TELA 8: FECHAMENTO DE FOLHA SALARIAL LIMPO (SEM HISTORICO ANTIGO DUPLICADO)
// ============================================================================

function mountPayrollClosingScreen() {
  const closingView = document.getElementById("view-monthly-closing");
  if (!closingView || document.getElementById("portalPayrollConsolidationPanel")) return;

  const panel = document.createElement("div");
  panel.id = "portalPayrollConsolidationPanel";
  panel.style.cssText = "display:grid; gap:18px;";
  panel.innerHTML = `
    <div class="section-toolbar">
      <div>
        <span class="eyebrow">FOLHA DE PAGAMENTO</span>
        <h2>Fechamento de Folha Salarial</h2>
        <p id="folhaAccessModeNotice" style="font-size:13px; color:var(--muted);">Consolidação automática de salários, fichas House Tx / FoodPark Tx, ponto e vales.</p>
      </div>
      <div class="toolbar-actions">
        <button type="button" id="btnExportarFolhaXlsx" class="btn btn-secondary">Exportar Excel</button>
        <button type="button" id="btnExportarFolhaPdf" class="btn btn-secondary">Exportar PDF</button>
        <button type="button" id="btnFecharFolhaMes" class="btn btn-primary permission-admin">Fechar Folha do Mês</button>
      </div>
    </div>

    <div class="panel form-grid" style="align-items:end;">
      <label>Competência (Mês/Ano)
        <input id="folhaCompetenciaInput" type="month" />
      </label>
      <label>Recorte / Quinzena
        <select id="folhaQuinzenaSelect">
          <option value="mensal">Mensal Completo</option>
          <option value="1">1ª Quinzena (Dias 01 a 15)</option>
          <option value="2">2ª Quinzena (Dias 16 ao fim)</option>
        </select>
      </label>
      <label>Unidade / Loja
        <select id="folhaStoreFilter">
          <option value="">Todas as unidades</option>
        </select>
      </label>
      <label>Status
        <select id="folhaStatusFilter">
          <option value="">Todos os status</option>
          <option value="Em Aberto">Em Aberto</option>
          <option value="Conferido">Conferido</option>
          <option value="Pago">Pago</option>
          <option value="Fechado">Fechado</option>
        </select>
      </label>
      <button type="button" id="btnAtualizarPreviaFolha" class="btn btn-secondary" style="min-height:42px;">
        Atualizar Prévia
      </button>
    </div>

    <div id="folhaKpiGrid" class="metric-grid">
      <article class="panel metric-card">
        <span class="eyebrow">SALÁRIOS BASE</span>
        <strong id="folhaKpiSalarios" style="font-size:20px; font-variant-numeric:tabular-nums;">R$ 0,00</strong>
      </article>
      <article class="panel metric-card">
        <span class="eyebrow">FICHAS HOUSE TX</span>
        <strong id="folhaKpiHouseTx" style="font-size:20px; font-variant-numeric:tabular-nums; color:var(--brand-solid);">R$ 0,00</strong>
      </article>
      <article class="panel metric-card">
        <span class="eyebrow">FICHAS FOODPARK TX</span>
        <strong id="folhaKpiFoodParkTx" style="font-size:20px; font-variant-numeric:tabular-nums; color:var(--brand-solid);">R$ 0,00</strong>
      </article>
      <article class="panel metric-card">
        <span class="eyebrow">DESCONTOS</span>
        <strong id="folhaKpiDescontos" style="font-size:20px; font-variant-numeric:tabular-nums; color:#dc2626;">R$ 0,00</strong>
      </article>
      <article class="panel metric-card">
        <span class="eyebrow">LÍQUIDO TOTAL</span>
        <strong id="folhaKpiLiquido" style="font-size:22px; font-variant-numeric:tabular-nums; color:#16a34a;">R$ 0,00</strong>
      </article>
    </div>

    <div class="panel table-panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Unidade / Cargo</th>
              <th class="portal-num-col">Salário Base</th>
              <th class="portal-num-col">Fichas House Tx</th>
              <th class="portal-num-col">Fichas FoodPark Tx</th>
              <th class="portal-num-col">Extras / Bônus</th>
              <th class="portal-num-col">Vales</th>
              <th class="portal-num-col">Faltas</th>
              <th class="portal-num-col">Quebra Caixa</th>
              <th class="portal-num-col">Valor Líquido</th>
              <th>Chave PIX</th>
              <th>Status</th>
              <th class="permission-admin">Ajuste</th>
            </tr>
          </thead>
          <tbody id="portalFolhaSalarialBody"></tbody>
        </table>
      </div>
    </div>
  `;

  closingView.prepend(panel);

  const compEl = document.getElementById("folhaCompetenciaInput");
  if (compEl && !compEl.value) compEl.value = todayIso().slice(0, 7);

  document.getElementById("btnAtualizarPreviaFolha")?.addEventListener("click", () => loadPayrollClosingTable());
  compEl?.addEventListener("change", () => loadPayrollClosingTable());
  document.getElementById("folhaQuinzenaSelect")?.addEventListener("change", () => loadPayrollClosingTable());
  document.getElementById("folhaStoreFilter")?.addEventListener("change", () => loadPayrollClosingTable());
  document.getElementById("folhaStatusFilter")?.addEventListener("change", () => loadPayrollClosingTable());

  document.getElementById("btnFecharFolhaMes")?.addEventListener("click", async () => {
    const competencia = document.getElementById("folhaCompetenciaInput")?.value || todayIso().slice(0, 7);
    const quinzena = document.getElementById("folhaQuinzenaSelect")?.value || "mensal";
    const storeId = document.getElementById("folhaStoreFilter")?.value || "";
    try {
      const res = await invokePortal("fecharFolhaSalarialMes", {
        competencia,
        quinzena,
        storeId,
      });
      showPortalToast(res.message || "Folha fechada e espelhos enviados para a Tela 7!", "success");
      await loadPayrollClosingTable();
    } catch (err) {
      showPortalToast(err.message || "Erro ao fechar folha salarial.", "error");
    }
  });

  const handleExport = async (formato) => {
    const competencia = document.getElementById("folhaCompetenciaInput")?.value || todayIso().slice(0, 7);
    const quinzena = document.getElementById("folhaQuinzenaSelect")?.value || "mensal";
    const storeId = document.getElementById("folhaStoreFilter")?.value || "";
    try {
      const res = await invokePortal("exportarFolhaSalarial", {
        competencia,
        quinzena,
        storeId,
        formato,
      });
      if (res.data?.dataUrl) {
        const a = document.createElement("a");
        a.href = res.data.dataUrl;
        a.download = res.data.fileName || `folha-${competencia}.csv`;
        a.click();
      }
      showPortalToast(`Exportação (${formato.toUpperCase()}) concluída.`, "success");
    } catch (err) {
      showPortalToast(err.message || "Erro ao exportar folha.", "error");
    }
  };

  document.getElementById("btnExportarFolhaXlsx")?.addEventListener("click", () => handleExport("xlsx"));
  document.getElementById("btnExportarFolhaPdf")?.addEventListener("click", () => handleExport("pdf"));
}

async function loadPayrollClosingTable() {
  const tbody = document.getElementById("portalFolhaSalarialBody");
  if (!tbody) return;
  try {
    const competencia = document.getElementById("folhaCompetenciaInput")?.value || todayIso().slice(0, 7);
    const quinzena = document.getElementById("folhaQuinzenaSelect")?.value || "mensal";
    const storeId = document.getElementById("folhaStoreFilter")?.value || window.__selectedPortalStoreId || "";
    const status = document.getElementById("folhaStatusFilter")?.value || "";

    const res = await invokePortal("gerarPreviaFolhaSalarial", {
      competencia,
      quinzena,
      storeId,
      status,
    });
    const data = res?.data || {};
    const totais = data.totais || {};
    const linhas = data.linhas || [];

    const setKpi = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = formatBRL(v || 0);
    };
    setKpi("folhaKpiSalarios", totais.totalSalarios);
    setKpi("folhaKpiHouseTx", totais.totalHouseTx);
    setKpi("folhaKpiFoodParkTx", totais.totalFoodParkTx);
    setKpi("folhaKpiDescontos", totais.totalDescontos);
    setKpi("folhaKpiLiquido", totais.totalLiquido);

    const notice = document.getElementById("folhaAccessModeNotice");
    if (notice) {
      if (data.folhaCongelada) {
        notice.textContent = "FOLHA FECHADA E CONGELADA: Valores imutáveis e espelhos enviados para a Tela 7 (Holerites e Docs).";
      } else if (data.somenteLeituraGerente) {
        notice.textContent = "Visualização de Gerente (Somente Leitura da sua unidade). Edição manual e fechamento restritos à Diretoria.";
      } else {
        notice.textContent = "Modo Diretoria: Qualquer edição manual exige justificativa obrigatória e grava registro imutável na Auditoria.";
      }
    }

    const fecharBtn = document.getElementById("btnFecharFolhaMes");
    if (fecharBtn) {
      fecharBtn.disabled = Boolean(data.folhaCongelada);
      fecharBtn.textContent = data.folhaCongelada ? "Folha Congelada" : "Fechar Folha do Mês";
    }

    if (!linhas.length) {
      tbody.innerHTML = `<tr><td colspan="13" style="text-align:center; color:var(--muted);">Nenhum colaborador ativo para os filtros selecionados.</td></tr>`;
      return;
    }

    tbody.innerHTML = linhas
      .map((l) => {
        const stLower = String(l.StatusLinha || "").toLowerCase();
        const stCls =
          stLower.includes("pago") || stLower.includes("fech")
            ? "portal-pill--green"
            : stLower.includes("confer")
              ? "portal-pill--blue"
              : "portal-pill--amber";
        return `
        <tr>
          <td>
            <strong>${l.FuncionarioNome}</strong>
            ${l.EditadoManualmente ? `<small style="display:block; color:#d97706;">Ajustado manualmente</small>` : ""}
          </td>
          <td>${l.NomeLoja || l.LojaID || "-"} · ${l.Cargo || "Operação"}</td>
          <td class="portal-num-col">${formatBRL(l.SalarioBase)}</td>
          <td class="portal-num-col">${l.QtdFichasHouseTx}x (${formatBRL(l.ValorFichasHouseTx)})</td>
          <td class="portal-num-col">${l.QtdFichasFoodParkTx}x (${formatBRL(l.ValorFichasFoodParkTx)})</td>
          <td class="portal-num-col">${formatBRL(Number(l.HorasExtrasValor || 0) + Number(l.BonusValor || 0))}</td>
          <td class="portal-num-col" style="color:#dc2626;">- ${formatBRL(l.TotalValesAdiantamentos)}</td>
          <td class="portal-num-col" style="color:#dc2626;">${l.FaltasInjustificadas}x (- ${formatBRL(l.DescontoFaltasAtrasos)})</td>
          <td class="portal-num-col" style="color:#dc2626;">- ${formatBRL(l.QuebraDeCaixaValor)}</td>
          <td class="portal-num-col" style="font-weight:700; color:#047857;">${formatBRL(l.ValorLiquido)}</td>
          <td><code>${l.ChavePix || "-"}</code></td>
          <td><span class="portal-pill ${stCls}">${l.StatusLinha}</span></td>
          <td class="permission-admin">
            ${
              data.permissaoEdicao
                ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-folha-emp="${l.FuncionarioID}">Editar</button>`
                : `<small style="color:var(--muted);">Bloqueado</small>`
            }
          </td>
        </tr>
      `;
      })
      .join("");

    tbody.querySelectorAll("[data-edit-folha-emp]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const empId = btn.getAttribute("data-edit-folha-emp");
        const linha = linhas.find((item) => String(item.FuncionarioID) === String(empId));
        if (!linha) return;
        const campo = window.prompt(
          `Editar valor de ${linha.FuncionarioNome}.\nInforme o campo (DescontoFaltasAtrasos, QuebraDeCaixaValor, BonusValor, SalarioBase, StatusLinha):`,
          "DescontoFaltasAtrasos",
        );
        if (!campo) return;
        const novoValor = window.prompt(`Informe o novo valor para ${campo}:`, String(linha[campo] ?? 0));
        if (novoValor === null) return;
        const justificativa = window.prompt(
          "Obrigatório: Informe o motivo/justificativa desta alteração manual para gravação no Log de Auditoria:",
          "",
        );
        if (!justificativa) {
          showPortalToast("A justificativa é obrigatória para editar a Folha Salarial.", "warning");
          return;
        }
        try {
          await invokePortal("editarLinhaFolhaManual", {
            competencia,
            quinzena,
            FuncionarioID: empId,
            [campo]: campo === "StatusLinha" ? novoValor : Number(novoValor),
            justificativa,
          });
          showPortalToast("Valor atualizado e auditado!", "success");
          await loadPayrollClosingTable();
        } catch (err) {
          showPortalToast(err.message || "Erro ao editar folha.", "error");
        }
      });
    });
  } catch {
    // Silencioso
  }
}

// ============================================================================
// TELA DE AUDITORIA (EXCLUSIVA DIRETORIA)
// ============================================================================

function enhanceAuditView() {
  const auditView = document.getElementById("view-audit");
  if (!auditView || document.getElementById("portalAuditFiltersBar")) return;

  const filterBar = document.createElement("div");
  filterBar.id = "portalAuditFiltersBar";
  filterBar.className = "panel form-grid";
  filterBar.style.cssText = "margin-bottom:16px; align-items:end;";
  filterBar.innerHTML = `
    <label>Data Início
      <input id="auditStartDateFilter" type="date" />
    </label>
    <label>Data Fim
      <input id="auditEndDateFilter" type="date" />
    </label>
    <label>Unidade / Loja
      <select id="auditStoreFilter">
        <option value="">Todas as unidades</option>
      </select>
    </label>
    <label>Colaborador Afetado
      <select id="auditEmployeeFilter">
        <option value="">Todos os colaboradores</option>
      </select>
    </label>
    <label>Usuário (Quem alterou)
      <input id="auditUserFilter" type="text" placeholder="Nome ou e-mail do autor" />
    </label>
    <button type="button" id="btnFilterAuditLogs" class="btn btn-primary" style="min-height:42px;">
      Filtrar Auditoria
    </button>
  `;

  const toolbar = auditView.querySelector(".section-toolbar");
  if (toolbar?.nextSibling) {
    auditView.insertBefore(filterBar, toolbar.nextSibling);
  } else {
    auditView.prepend(filterBar);
  }

  document.getElementById("btnFilterAuditLogs")?.addEventListener("click", () => loadAuditHistoryTable());
}

async function loadAuditHistoryTable(overrideFilters = {}) {
  const auditBody = document.getElementById("auditBody");
  if (!auditBody || !isDiretoriaProfile(runtime?.profile)) return;

  try {
    const startDate = overrideFilters.startDate ?? document.getElementById("auditStartDateFilter")?.value ?? "";
    const endDate = overrideFilters.endDate ?? document.getElementById("auditEndDateFilter")?.value ?? "";
    const storeId = overrideFilters.storeId ?? document.getElementById("auditStoreFilter")?.value ?? "";
    const employeeId = overrideFilters.employeeId ?? document.getElementById("auditEmployeeFilter")?.value ?? "";
    const userId = overrideFilters.userId ?? document.getElementById("auditUserFilter")?.value ?? "";

    const res = await invokePortal("listarHistoricoAlteracoes", {
      startDate,
      endDate,
      storeId,
      employeeId,
      userId,
    });
    const logs = res?.data?.logs || [];
    if (!logs.length) {
      auditBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--muted);">Nenhum registro de auditoria para os filtros informados.</td></tr>`;
      return;
    }

    auditBody.innerHTML = logs
      .map((l) => {
        const quando = String(l.Quando || l.DataHora || "").replace("T", " ").slice(0, 19);
        const quem = `${l.QuemNome || l.NomeUtilizador || "-"} (${l.EmailUtilizador || "-"})`;
        const onde = `${l.OndeTela || l.Modulo || "-"}${l.ColaboradorAfetadoNome ? ` · Colab: ${l.ColaboradorAfetadoNome}` : ""}`;
        const oQue =
          l.ValorAnterior || l.ValorNovo
            ? `<strong>${l.CampoAlterado || l.Acao}:</strong> de "${l.ValorAnterior || "vazio"}" para "${l.ValorNovo || "vazio"}" ${l.Justificativa ? `(Motivo: ${l.Justificativa})` : ""}`
            : l.ResumoAlteracao || l.Mensagem || l.Acao;
        const origem = `${l.OrigemIP || "Sessão"} | ${String(l.OrigemDispositivo || "").slice(0, 48)}`;
        const acaoLower = String(l.Acao || "").toLowerCase();
        const acaoCls =
          acaoLower.includes("exclu") || acaoLower.includes("delet") || acaoLower.includes("recus")
            ? "portal-pill--red"
            : acaoLower.includes("cria") || acaoLower.includes("aprov") || acaoLower.includes("fech")
              ? "portal-pill--green"
              : "portal-pill--blue";
        return `
          <tr>
            <td style="font-variant-numeric:tabular-nums; white-space:nowrap;">${quando}</td>
            <td>${quem}</td>
            <td><span class="portal-pill ${acaoCls}">${l.Acao}</span></td>
            <td>${onde}</td>
            <td>${oQue}</td>
            <td><small style="color:var(--muted);">${origem}</small></td>
          </tr>
        `;
      })
      .join("");
  } catch {
    // Silencioso para perfis não-diretoria
  }
}

async function syncStoreAndEmployeeDropdowns() {
  try {
    const [stores, employees] = await Promise.all([
      runtime.list("Lojas").catch(() => []),
      runtime.list("Funcionarios").catch(() => []),
    ]);

    const storeSelectIds = ["globalTopStoreSelector", "fichasStoreFilter", "folhaStoreFilter", "auditStoreFilter"];
    for (const id of storeSelectIds) {
      const sel = document.getElementById(id);
      if (!sel || !stores.length) continue;
      const val = sel.value;
      sel.innerHTML =
        `<option value="">Todas as unidades</option>` +
        stores.map((s) => `<option value="${s.LojaID}">${s.NomeLoja || s.LojaID}</option>`).join("");
      if (val) sel.value = val;
    }

    const empAuditSelect = document.getElementById("auditEmployeeFilter");
    if (empAuditSelect && employees.length) {
      const val = empAuditSelect.value;
      empAuditSelect.innerHTML =
        `<option value="">Todos os colaboradores</option>` +
        employees.map((e) => `<option value="${e.FuncionarioID}">${e.Nome}</option>`).join("");
      if (val) empAuditSelect.value = val;
    }
  } catch {
    // Silencioso
  }
}

export async function refreshPortalViews() {
  if (!runtime?.auth?.currentUser) return;
  await syncStoreAndEmployeeDropdowns();
  await Promise.allSettled([
    loadExperienceAlertsBanner(),
    loadEmployeesOverviewSummary(),
    loadValesList(),
    loadFichasView(),
    loadPopsList(),
    loadPayrollClosingTable(),
  ]);
}

export function mountQuickValeDialog() {
  if (typeof document === "undefined" || !document.body) return;
  let dlg = document.getElementById("valeQuickDialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "valeQuickDialog";
    dlg.className = "time-off-dialog";
    dlg.innerHTML = `
      <form id="valeQuickForm" novalidate>
        <div class="dialog-head">
          <div>
            <span class="eyebrow">ADIANTAMENTO SALARIAL</span>
            <h3>Pedir vale</h3>
          </div>
          <button type="button" class="icon-btn time-off-close-btn" data-close="valeQuickDialog" aria-label="Fechar modal">✕</button>
        </div>
        <div class="dialog-body">
          <div class="dialog-grid time-off-grid">
            <label>Valor Solicitado (R$)
              <input id="valeQuickValorInput" type="number" min="10" step="0.01" placeholder="Ex: 250,00" required />
            </label>
            <label>Data Desejada
              <input id="valeQuickDataInput" type="date" required style="min-inline-size:0; -webkit-appearance:none;" />
            </label>
            <label class="full">Motivo do Pedido
              <input id="valeQuickMotivoInput" type="text" placeholder="Ex: Despesa médica, transporte, emergência" required />
            </label>
          </div>
        </div>
        <div class="dialog-actions time-off-actions">
          <button type="button" class="btn btn-secondary time-off-cancel-btn" data-close="valeQuickDialog">Cancelar</button>
          <button type="submit" id="valeQuickSubmitBtn" class="btn btn-primary time-off-submit-btn">Enviar Pedido de Vale</button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);

    const closeModal = () => {
      if (typeof window.closeDialog === "function") {
        window.closeDialog("valeQuickDialog");
      } else {
        dlg.close?.();
      }
    };

    dlg.querySelectorAll('[data-close="valeQuickDialog"]').forEach((btn) => {
      btn.addEventListener("click", closeModal);
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) closeModal();
    });

    dlg.querySelector("#valeQuickForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const valor = Number(document.getElementById("valeQuickValorInput")?.value || 0);
      const dataDesejada = document.getElementById("valeQuickDataInput")?.value || todayIso();
      const motivo = String(document.getElementById("valeQuickMotivoInput")?.value || "").trim();
      if (!(valor > 0)) {
        toast("Informe um valor válido para o vale.", true);
        return;
      }
      if (motivo.length < 3) {
        toast("Informe brevemente o motivo do pedido.", true);
        return;
      }
      const submitBtn = document.getElementById("valeQuickSubmitBtn");
      if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await invokePortal("solicitarVale", { valor, dataDesejada, motivo });
        toast(res?.message || "Solicitação de vale enviada para validação do Gerente.");
        document.getElementById("valeQuickForm")?.reset();
        const dt = document.getElementById("valeQuickDataInput");
        if (dt) dt.value = todayIso();
        closeModal();
        loadValesList();
      } catch (err) {
        toast(err.message || "Não foi possível enviar a solicitação de vale.", true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  if (!document.body.dataset.valeQuickBound) {
    document.body.dataset.valeQuickBound = "1";
    document.addEventListener("click", (e) => {
      const trigger = e.target?.closest?.("[data-j-request-vale]");
      if (!trigger) return;
      const form = document.getElementById("valeQuickForm");
      form?.reset();
      const dt = document.getElementById("valeQuickDataInput");
      if (dt) dt.value = todayIso();
      if (typeof window.openDialog === "function") {
        window.openDialog("valeQuickDialog");
      } else {
        dlg.showModal?.();
      }
      setTimeout(() => document.getElementById("valeQuickValorInput")?.focus?.(), 60);
    });
  }
}

export function initPortalGestao() {
  if (typeof document === "undefined") return;
  injectPortalTabsStyles();
  mountTopbarStoreSelector();
  mountWhatsAppPasswordRecovery();
  mountEmployeesOverviewSummary();
  enhanceEmployeeDialog();
  mountSolicitacoesTabsAndVale();
  mountQuickValeDialog();
  bindFichasView();
  mountCommunicationTabsAndPops();
  mountPayrollClosingScreen();
  enhanceAuditView();

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-view");
      if (view === "employees") loadEmployeesOverviewSummary();
      if (view === "fichas") loadFichasView();
      if (view === "monthly-closing") loadPayrollClosingTable();
      if (view === "timeoff" || view === "pending-center") loadValesList();
      if (view === "communication") loadPopsList();
      if (view === "audit") loadAuditHistoryTable();
    });
  });

  document.addEventListener("click", (e) => {
    const targetView = e.target?.closest?.("[data-view-target]")?.getAttribute?.("data-view-target");
    if (targetView === "timeoff" || targetView === "pending-center") loadValesList();
  });

  setTimeout(() => {
    refreshPortalViews();
  }, 1200);
}

if (typeof window !== "undefined") {
  window.initPortalGestao = initPortalGestao;
  window.refreshPortalViews = refreshPortalViews;
  window.loadValesList = loadValesList;
  window.renderEmployeeOnboardingState = renderEmployeeOnboardingState;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initPortalGestao());
  } else {
    initPortalGestao();
  }
}
