import { runtime } from "./core/runtime.js";
import {
  ONBOARDING_STAGES,
  REQUIRED_ADMISSION_DOCUMENTS,
  SELF_ONBOARDING_DOC_CODES,
  SELF_ONBOARDING_REQUIRED_DOC_CODES,
} from "./core/api-portal.js";
import { todayIso } from "./core/utils.js";
import {
  fetchAllTakeatCredit,
  loadMappings as loadTakeatMappings,
  resolveAccountMatch as resolveTakeatAccountMatch,
} from "./core/takeat-credit.js";
import {
  inferMimeTypeFromDataUrl,
  parseDriveFileId,
  readPrivateDriveFile,
  uploadOnboardingDocumentToDrive,
  uploadPrivateDocumentToDrive,
} from "./core/drive-storage.js";

function driveDataUrlToObjectUrl(dataUrl, fallbackMime = "application/pdf") {
  try {
    const clean = String(dataUrl || "");
    const match = clean.match(/^data:([^;]+);base64,([\s\S]+)$/i);
    const mime = match ? match[1] : fallbackMime;
    const b64 = (match ? match[2] : clean).replace(/\s+/g, "");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return dataUrl;
  }
}

const formatBRL = (val) => {
  const n = Number(val || 0);
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const payrollTakeatCache = {
  items: null,
  mappings: null,
  loadedAt: 0,
  promise: null,
};

const isDiretoriaProfile = (profile) => {
  const r = String(profile?.Perfil || profile?.perfil || "").toLowerCase();
  return r.includes("admin") || r.includes("diretor") || r.includes("financeir");
};

const isGerenteProfile = (profile) => {
  const r = String(profile?.Perfil || profile?.perfil || "").toLowerCase();
  return isDiretoriaProfile(profile) || r.includes("respons") || r.includes("gerente");
};

const isOnboardingOnlyPending = (emp) => {
  if (!emp) return false;
  if (emp.CadastroValidado === true || emp.CadastroValidado === "true") return false;
  if (emp.Ativo === true) return false;
  return Boolean(emp.OnboardingToken || emp.StatusOnboarding);
};

const isOnboardingReadyForReview = (emp) => {
  if (!isOnboardingOnlyPending(emp)) return false;
  return (
    emp.StatusOnboarding === "Aguardando Conferência" ||
    Boolean(emp.OnboardingEnviadoEm) ||
    Boolean(emp.Email && emp.CPF)
  );
};

const showPortalToast = (message, type = "info") => {
  if (typeof document === "undefined") return;
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  const normalizedType = ["error", "warning", "success", "info"].includes(type) ? type : "info";
  const item = document.createElement("div");
  item.className = `toast ${normalizedType}`;
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent = normalizedType === "error" || normalizedType === "warning" ? "!" : "✓";
  const copy = document.createElement("div");
  copy.className = "toast-copy";
  const title = document.createElement("strong");
  title.textContent =
    normalizedType === "error"
      ? "Atenção"
      : normalizedType === "warning"
        ? "Confira"
        : normalizedType === "success"
          ? "Concluído"
          : "Aviso";
  const text = document.createElement("span");
  text.textContent = String(message || "");
  copy.append(title, text);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Fechar aviso");
  close.textContent = "×";
  close.onclick = () => item.remove();
  item.append(icon, copy, close);
  container.appendChild(item);
  setTimeout(() => {
    item.classList.add("toast-out");
    setTimeout(() => item.remove(), 220);
  }, 4200);
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

    /* ---- Modal #employeeDialog reestruturado (Pliifex) ---- */
    dialog#employeeDialog {
      width: min(920px, 95vw) !important;
      max-width: 920px !important;
      max-height: 92vh !important;
      border-radius: var(--radius-lg, 16px) !important;
      border: 1px solid var(--line, #e4e7ec) !important;
      padding: 0 !important;
      overflow: hidden !important;
      box-shadow: var(--sh-lg, 0 24px 56px -16px rgba(16, 24, 40, 0.22)) !important;
    }
    dialog#employeeDialog form#employeeForm {
      width: 100% !important;
      max-width: 100% !important;
      max-height: 92vh !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      margin: 0 !important;
    }
    dialog#employeeDialog .dialog-head {
      flex: 0 0 auto !important;
      padding: 16px 24px !important;
      border-bottom: 1px solid var(--line, #e4e7ec) !important;
      background: var(--surface, #ffffff) !important;
    }
    dialog#employeeDialog .dialog-body {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      max-height: none !important;
      padding: 18px 24px 28px !important;
      overflow-y: auto !important;
      background: var(--surface-2, #f1f4f8) !important;
    }
    dialog#employeeDialog .dialog-actions {
      flex: 0 0 auto !important;
      padding: 14px 24px !important;
      border-top: 1px solid var(--line, #e4e7ec) !important;
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

    /* ---- KPI Strip Equipe + Badges de Status + Colunas Numericas (Pliifex) ---- */
    #view-employees .section-toolbar {
      align-items: flex-end;
      flex-wrap: wrap;
      gap: 14px 18px;
      margin-bottom: 18px;
    }
    #view-employees .toolbar-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      flex: 1 1 520px;
      justify-content: flex-end;
    }
    #view-employees .toolbar-actions .search-input {
      flex: 1 1 210px;
      min-width: 190px;
      max-width: 280px;
      height: 38px;
    }
    #view-employees .toolbar-actions select {
      flex: 0 1 185px;
      min-width: 155px;
      height: 38px;
    }
    #view-employees .toolbar-actions .btn {
      flex: 0 0 auto;
      height: 38px;
      white-space: nowrap;
    }
    .portal-kpi-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(185px, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .portal-kpi-card {
      background: var(--surface, #ffffff);
      border: 1px solid var(--line, #e4e7ec);
      border-radius: var(--radius-lg, 14px);
      padding: 15px 18px;
      box-shadow: var(--sh-sm, 0 1px 2px rgba(16, 24, 40, 0.05));
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .portal-kpi-card:hover {
      border-color: var(--line-2, #d0d5dd);
      box-shadow: var(--sh-hover, 0 4px 12px rgba(16, 24, 40, 0.06));
    }
    .portal-kpi-label {
      display: block;
      font-size: 11px;
      font-weight: 700;
      color: var(--muted, #667085);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
    }
    .portal-kpi-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--ink, #101828);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
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

    /* ---- Folha Salarial: Edição Minimalista, Coluna Fixa & Modais ---- */
    #portalPayrollConsolidationPanel .folha-table-wrap {
      overflow-x: auto;
      position: relative;
      border-radius: 12px;
    }
    #portalPayrollConsolidationPanel .folha-table th,
    #portalPayrollConsolidationPanel .folha-table td {
      padding: 10px 10px;
      font-size: 12.5px;
      vertical-align: middle;
      white-space: nowrap;
    }
    #portalPayrollConsolidationPanel .folha-table th:first-child,
    #portalPayrollConsolidationPanel .folha-table td:first-child {
      position: sticky;
      left: 0;
      z-index: 2;
      background: var(--surface, #ffffff);
      box-shadow: 2px 0 8px -2px rgba(15, 23, 42, 0.08);
      min-width: 175px;
      max-width: 225px;
      white-space: normal;
    }
    #portalPayrollConsolidationPanel .folha-table thead th:first-child {
      z-index: 3;
      background: var(--surface-2, #f8fafc);
    }
    .folha-collab-name {
      display: block;
      font-weight: 700;
      font-size: 13px;
      color: var(--ink, #0f172a);
      line-height: 1.25;
    }
    .folha-collab-meta {
      display: block;
      font-size: 11px;
      color: var(--muted, #64748b);
      margin-top: 2px;
      line-height: 1.25;
    }
    .folha-collab-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 5px;
    }
    .folha-pix-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10.5px;
      font-weight: 600;
      color: #475569;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 1px 6px;
      max-width: 190px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .folha-cell-edit {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      width: 100%;
    }
    .folha-cell-val {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      line-height: 1.25;
      font-variant-numeric: tabular-nums;
    }
    .folha-cell-sub {
      font-size: 10.5px;
      color: var(--muted, #64748b);
      font-weight: 500;
      margin-top: 1px;
    }
    .folha-edit-pencil {
      appearance: none;
      border: 1px solid transparent;
      background: transparent;
      color: #94a3b8;
      width: 22px;
      height: 22px;
      min-width: 22px;
      padding: 0;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .folha-edit-pencil:hover,
    .folha-edit-pencil:focus-visible {
      background: #eff6ff;
      color: #2563eb;
      border-color: #bfdbfe;
      outline: none;
    }
    .folha-row-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .folha-pay-btn {
      min-height: 30px !important;
      padding: 4px 12px !important;
      font-size: 12px !important;
      font-weight: 700 !important;
      border-radius: 8px !important;
    }
    .folha-mini-btn {
      min-height: 30px !important;
      padding: 4px 8px !important;
      font-size: 11.5px !important;
      border-radius: 8px !important;
    }
    dialog.folha-dialog {
      width: min(560px, calc(100vw - 24px));
      border: 1px solid var(--line, #e2e8f0);
      border-radius: 16px;
      padding: 0;
      background: var(--surface, #ffffff);
      color: var(--ink, #0f172a);
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
    }
    dialog.folha-dialog::backdrop {
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(3px);
    }
    .folha-dialog-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--line, #e2e8f0);
    }
    .folha-dialog-body {
      padding: 16px 20px;
      display: grid;
      gap: 14px;
      max-height: 76vh;
      overflow-y: auto;
    }
    .folha-dialog-foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 20px;
      border-top: 1px solid var(--line, #e2e8f0);
      background: var(--surface-2, #f8fafc);
    }
    .folha-report-box {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      background: #f8fafc;
      padding: 12px 14px;
      display: grid;
      gap: 7px;
      font-size: 13px;
    }
    .folha-report-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      font-variant-numeric: tabular-nums;
    }
    .folha-report-row.is-deduct strong {
      color: #dc2626;
    }
    .folha-report-row.is-add strong {
      color: #0284c7;
    }
    .folha-report-row.is-total {
      padding-top: 8px;
      margin-top: 4px;
      border-top: 1px dashed #cbd5e1;
      font-size: 15px;
      font-weight: 800;
      color: #047857;
    }
    .folha-pix-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      font-size: 12.5px;
    }
    .folha-upload-box {
      border: 1.5px dashed #94a3b8;
      border-radius: 12px;
      padding: 14px;
      background: #f8fafc;
      display: grid;
      gap: 10px;
    }
    .folha-upload-preview img {
      max-width: 100%;
      max-height: 180px;
      border-radius: 8px;
      object-fit: contain;
      border: 1px solid #cbd5e1;
    }

    /* ---- Hubs Unificados de RH (Sub-navegação limpa sem poluir menu lateral) ---- */
    .hr-hub-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 6px;
      margin: 0 0 18px;
      background: var(--surface-2, #f1f5f9);
      border: 1px solid var(--line, #e2e8f0);
      border-radius: 12px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .hr-hub-tab {
      appearance: none;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted, #64748b);
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 600;
      padding: 7px 12px;
      border-radius: 9px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
    }
    .hr-hub-tab:hover {
      background: rgba(255, 255, 255, 0.72);
      color: var(--ink, #0f172a);
    }
    .hr-hub-tab.is-active {
      background: var(--surface, #ffffff);
      color: var(--brand-solid, #2563eb);
      border-color: var(--line, #e2e8f0);
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
      font-weight: 700;
    }
    .hr-hub-tab svg {
      flex-shrink: 0;
      opacity: 0.85;
    }

    /* ---- Central Unificada (Atestados + Experiência) ---- */
    .pending-summary-card.is-atestados {
      --pending-card-color: #e11d48;
    }
    .pending-category-icon.is-atestados {
      background: rgba(225, 29, 72, 0.12);
      color: #be123c;
      font-weight: 800;
    }

    /* ---- Dossiê 360° do Colaborador ---- */
    .btn-quick-dossier {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 6px;
      border: 1px solid #bfdbfe;
      background: #eff6ff;
      color: #1d4ed8;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-quick-dossier:hover {
      background: #dbeafe;
    }
    dialog.emp360-dialog {
      width: min(820px, calc(100vw - 24px));
    }
    .emp360-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding: 14px 16px;
      border-radius: 12px;
      background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%);
      border: 1px solid #dbeafe;
    }
    .emp360-avatar {
      width: 46px;
      height: 46px;
      border-radius: 12px;
      background: #2563eb;
      color: #ffffff;
      font-weight: 800;
      font-size: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .emp360-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
      gap: 10px;
    }
    .emp360-kv {
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--line, #e2e8f0);
      background: var(--surface, #ffffff);
    }
    .emp360-kv span {
      display: block;
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted, #64748b);
    }
    .emp360-kv strong {
      display: block;
      margin-top: 3px;
      font-size: 13.5px;
      color: var(--ink, #0f172a);
      word-break: break-word;
    }
    .emp360-list {
      display: grid;
      gap: 8px;
    }
    .emp360-row-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--line, #e2e8f0);
      background: var(--surface-2, #f8fafc);
      font-size: 12.5px;
    }
    [data-theme="dark"] .hr-hub-bar {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.1);
    }
    [data-theme="dark"] .hr-hub-tab.is-active {
      background: rgba(255, 255, 255, 0.1);
      color: #93c5fd;
      border-color: rgba(255, 255, 255, 0.14);
    }
    [data-theme="dark"] .emp360-hero {
      background: rgba(37, 99, 235, 0.14);
      border-color: rgba(59, 130, 246, 0.25);
    }

    /* ---- Portal Publico de Auto-Onboarding (Pliifex Mobile-First & Desktop) ---- */
    #onboardingSelfScreen,
    #onboardingSelfScreen * {
      box-sizing: border-box;
    }
    #onboardingSelfScreen {
      min-height: 100vh;
      width: 100%;
      max-width: 100vw;
      padding: 20px 14px calc(48px + env(safe-area-inset-bottom));
      background: linear-gradient(180deg, #f3f5fa 0%, #eaedf5 100%);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      overflow-x: hidden;
      overflow-x: clip;
      font-family: var(--font-sans, "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
    .onb-self-shell {
      width: 100%;
      max-width: 720px;
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      margin: 0 auto;
    }
    .onb-self-hero {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 16px 18px;
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      min-width: 0;
      gap: 10px;
    }
    .onb-self-hero-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .onb-self-hero-brand {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
      flex: 1;
    }
    .onb-self-monogram {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      background: linear-gradient(135deg, #2563eb 0%, #4077ba 100%);
      color: #ffffff;
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: -0.02em;
      display: grid;
      place-items: center;
      flex: 0 0 30px;
      box-shadow: 0 3px 8px rgba(37, 99, 235, 0.22);
    }
    .onb-self-eyebrow {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.055em;
      text-transform: uppercase;
      color: #4077ba;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .onb-self-hero-body {
      display: grid;
      gap: 6px;
      padding-top: 8px;
      border-top: 1px solid #f1f5f9;
    }
    .onb-self-hero h1 {
      margin: 0;
      font-size: 19px;
      font-weight: 750;
      color: #0f172a;
      line-height: 1.25;
      letter-spacing: -0.015em;
    }
    .onb-self-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }
    .onb-self-meta-chip {
      display: inline-flex;
      align-items: center;
      padding: 3px 9px;
      border-radius: 999px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      color: #475569;
      font-size: 11.5px;
      font-weight: 600;
    }
    .onb-self-stepper {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4px;
      padding: 4px;
      border-radius: 12px;
      background: #e2e8f0;
    }
    .onb-self-step {
      padding: 9px 8px;
      border-radius: 9px;
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 0;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .onb-self-step.is-active {
      background: #ffffff;
      color: #1d4ed8;
      font-weight: 700;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    }
    .onb-self-step.is-done {
      background: #ecfdf5;
      color: #047857;
      font-weight: 700;
    }
    .onb-self-step-num {
      width: 19px;
      height: 19px;
      border-radius: 999px;
      display: inline-grid;
      place-items: center;
      font-size: 11px;
      font-weight: 700;
      background: rgba(15, 23, 42, 0.08);
      flex: 0 0 19px;
    }
    .onb-self-step.is-active .onb-self-step-num {
      background: #dbeafe;
      color: #1d4ed8;
    }
    .onb-self-step.is-done .onb-self-step-num {
      background: #a7f3d0;
      color: #065f46;
    }
    .onb-self-step-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .onb-self-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.03);
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      min-width: 0;
      gap: 14px;
    }
    .onb-self-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      min-width: 0;
      padding-bottom: 10px;
      border-bottom: 1px solid #f1f5f9;
    }
    .onb-self-card-head > div {
      min-width: 0;
      flex: 1 1 220px;
    }
    .onb-self-card-title {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #4077ba;
    }
    .onb-self-card-sub {
      display: block;
      margin-top: 2px;
      font-size: 12.5px;
      color: #64748b;
    }
    .onb-self-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 14px;
    }
    .onb-self-span-2 {
      grid-column: span 2;
    }
    .onb-self-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
      min-width: 0;
      margin: 0;
    }
    .onb-self-field-label {
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #334155 !important;
      line-height: 1.3;
      text-transform: none !important;
    }
    #onboardingSelfScreen .onb-self-field input,
    #onboardingSelfScreen .onb-self-field select {
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
      height: 44px !important;
      min-height: 44px !important;
      padding: 0 13px !important;
      border-radius: 10px !important;
      border: 1px solid #cbd5e1 !important;
      background: #ffffff !important;
      color: #0f172a !important;
      font-size: 15px !important;
      font-weight: 500 !important;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03) !important;
      -webkit-appearance: none !important;
      appearance: none !important;
    }
    #onboardingSelfScreen .onb-self-field input:focus,
    #onboardingSelfScreen .onb-self-field select:focus {
      border-color: #2563eb !important;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14) !important;
    }
    .onb-self-progress-wrap {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      min-width: 0;
      gap: 6px;
    }
    .onb-self-progress-track {
      height: 7px;
      width: 100%;
      border-radius: 999px;
      background: #e2e8f0;
      overflow: hidden;
    }
    .onb-self-progress-fill {
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #2563eb 0%, #10b981 100%);
      transition: width 0.25s ease;
    }
    .onb-self-doc-list {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      min-width: 0;
      gap: 10px;
    }
    .onb-self-doc-card {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 13px 14px;
      background: #ffffff;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px 12px;
      min-width: 0;
      width: 100%;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .onb-self-doc-card.is-uploaded {
      border-color: #86efac;
      background: #f0fdf4;
    }
    .onb-self-doc-info {
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
    }
    .onb-self-doc-top {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .onb-self-doc-title {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .onb-self-doc-sub {
      font-size: 12.5px;
      color: #64748b;
      line-height: 1.4;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .onb-self-doc-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .onb-self-upload-btn {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      min-height: 40px !important;
      padding: 0 14px !important;
      border-radius: 10px !important;
      border: 1px solid #bfdbfe !important;
      background: #eff6ff !important;
      color: #1d4ed8 !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      margin: 0 !important;
      white-space: nowrap !important;
      transition: background 0.15s ease, border-color 0.15s ease !important;
    }
    .onb-self-upload-btn:hover {
      background: #dbeafe !important;
      border-color: #93c5fd !important;
    }
    .onb-self-doc-card.is-uploaded .onb-self-upload-btn {
      background: #ffffff !important;
      border-color: #86efac !important;
      color: #047857 !important;
    }
    .onb-self-consent {
      display: flex !important;
      align-items: flex-start !important;
      gap: 12px !important;
      padding: 14px 16px !important;
      border-radius: 12px !important;
      border: 1px solid #cbd5e1 !important;
      background: #f8fafc !important;
      cursor: pointer !important;
      width: 100% !important;
      margin: 0 !important;
      text-transform: none !important;
    }
    #onboardingSelfScreen input[type="checkbox"].onb-self-checkbox {
      width: 20px !important;
      min-width: 20px !important;
      max-width: 20px !important;
      height: 20px !important;
      min-height: 20px !important;
      flex: 0 0 20px !important;
      margin: 2px 0 0 !important;
      padding: 0 !important;
      border-radius: 6px !important;
      border: 1.5px solid #94a3b8 !important;
      accent-color: #2563eb !important;
      cursor: pointer !important;
      box-shadow: none !important;
    }
    .onb-self-consent-text {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      line-height: 1.5 !important;
      color: #334155 !important;
      white-space: normal !important;
      overflow-wrap: break-word !important;
      text-align: left !important;
    }
    .onb-self-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }
    .onb-self-actions .btn {
      min-height: 46px !important;
      border-radius: 11px !important;
      padding: 0 18px !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .onb-self-actions .btn-primary {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
      color: #ffffff !important;
      border: 0 !important;
      box-shadow: 0 3px 10px rgba(37, 99, 235, 0.24) !important;
    }
    @media (max-width: 600px) {
      #onboardingSelfScreen {
        padding: 12px 10px calc(44px + env(safe-area-inset-bottom));
      }
      .onb-self-hero {
        padding: 14px 16px;
      }
      .onb-self-hero h1 {
        font-size: 17px;
      }
      .onb-self-card {
        padding: 15px 14px;
        border-radius: 14px;
      }
      .onb-self-card-head {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }
      .onb-self-card-head > div {
        flex: none;
      }
      .onb-self-card-head .btn {
        align-self: flex-start;
      }
      .onb-self-grid {
        grid-template-columns: 1fr;
      }
      .onb-self-span-2 {
        grid-column: span 1;
      }
      .onb-self-step {
        font-size: 11px;
        padding: 8px 4px;
        gap: 4px;
      }
      .onb-self-step-num {
        width: 17px;
        height: 17px;
        flex: 0 0 17px;
        font-size: 10px;
      }
      .onb-self-doc-card {
        grid-template-columns: minmax(0, 1fr);
        align-items: stretch;
        gap: 10px;
      }
      .onb-self-doc-actions {
        width: 100%;
      }
      .onb-self-upload-btn {
        flex: 1 1 auto;
        min-width: 0;
      }
      .onb-self-actions {
        flex-direction: column-reverse;
        align-items: stretch;
      }
      .onb-self-actions .btn {
        width: 100%;
      }
    }
    /* ---- Notificações Toast compactas (Pliifex Mobile & Desktop) ---- */
    #toastContainer.toast-container {
      position: fixed;
      top: max(12px, env(safe-area-inset-top));
      right: 14px;
      z-index: 9999;
      display: grid;
      gap: 8px;
      pointer-events: none;
    }
    #toastContainer .toast {
      pointer-events: auto;
      display: grid !important;
      grid-template-columns: 28px minmax(0, 1fr) 24px !important;
      align-items: center !important;
      gap: 10px !important;
      width: min(370px, calc(100vw - 24px)) !important;
      padding: 10px 12px !important;
      border-radius: 13px !important;
      background: #0f172a !important;
      color: #f8fafc !important;
      border: 1px solid rgba(148, 163, 184, 0.25) !important;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.24) !important;
    }
    #toastContainer .toast.error {
      border-color: rgba(248, 113, 113, 0.45) !important;
    }
    #toastContainer .toast.warning {
      border-color: rgba(251, 191, 36, 0.45) !important;
    }
    #toastContainer .toast-icon {
      width: 28px !important;
      height: 28px !important;
      border-radius: 9px !important;
      display: grid !important;
      place-items: center !important;
      font-size: 13px !important;
      font-weight: 800 !important;
      background: rgba(16, 185, 129, 0.18) !important;
      color: #34d399 !important;
    }
    #toastContainer .toast.error .toast-icon {
      background: rgba(239, 68, 68, 0.18) !important;
      color: #f87171 !important;
    }
    #toastContainer .toast.warning .toast-icon {
      background: rgba(245, 158, 11, 0.18) !important;
      color: #fbbf24 !important;
    }
    #toastContainer .toast-copy {
      min-width: 0 !important;
      display: grid !important;
      gap: 1px !important;
    }
    #toastContainer .toast-copy strong {
      font-size: 12.5px !important;
      font-weight: 700 !important;
      line-height: 1.25 !important;
      color: #ffffff !important;
    }
    #toastContainer .toast-copy span {
      font-size: 12px !important;
      line-height: 1.35 !important;
      color: #cbd5e1 !important;
      word-break: break-word !important;
    }
    #toastContainer .toast-close {
      width: 24px !important;
      height: 24px !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      color: #94a3b8 !important;
      font-size: 16px !important;
      line-height: 1 !important;
      cursor: pointer !important;
    }
    @media (max-width: 640px) {
      #toastContainer.toast-container {
        left: 12px !important;
        right: 12px !important;
        justify-items: center;
      }
      #toastContainer .toast {
        width: 100% !important;
        max-width: 400px !important;
      }
    }
    /* ---- Lista de múltiplos arquivos (RG/CNH) ---- */
    .onb-self-doc-files {
      grid-column: 1 / -1;
      width: 100%;
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
      padding-top: 8px;
      border-top: 1px dashed #cbd5e1;
      margin-top: 2px;
    }
    .onb-self-file-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      width: 100%;
      padding: 6px 10px;
      border-radius: 9px;
      background: #ffffff;
      border: 1px solid #d1fae5;
      font-size: 12px;
    }
    .onb-self-file-name {
      min-width: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #0f172a;
      font-weight: 600;
    }
    .onb-self-file-btns {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    /* ---- Painel Solicitações de Admissão em Pessoas & Docs (Pliifex) ---- */
    .portal-onb-sol-panel {
      background: var(--surface, #ffffff);
      border: 1px solid var(--line, #e4e7ec);
      border-radius: var(--radius-lg, 14px);
      padding: 18px 20px;
      margin-bottom: 18px;
      box-shadow: var(--sh-sm, 0 1px 2px rgba(16, 24, 40, 0.05));
      display: grid;
      gap: 14px;
    }
    .portal-onb-sol-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line, #e4e7ec);
    }
    .portal-onb-sol-head .eyebrow {
      display: block;
      margin-bottom: 3px;
      color: var(--brand-ink, #3c70af);
    }
    .portal-onb-sol-title {
      margin: 0;
      font-size: 15.5px;
      font-weight: 700;
      color: var(--ink, #101828);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .portal-onb-sol-list {
      display: grid;
      gap: 12px;
    }
    .portal-onb-sol-card {
      background: var(--surface, #ffffff);
      border: 1px solid var(--line, #e4e7ec);
      box-shadow: inset 3px 0 0 var(--brand-solid, #4077ba), var(--sh-sm, 0 1px 2px rgba(16, 24, 40, 0.04));
      border-radius: var(--radius-md, 12px);
      padding: 16px 18px;
      display: grid;
      gap: 12px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .portal-onb-sol-card:hover {
      border-color: var(--brand-border, #c1d4eb);
      box-shadow: inset 3px 0 0 var(--brand-solid, #4077ba), var(--sh-hover, 0 4px 12px rgba(16, 24, 40, 0.06));
    }
    .portal-onb-sol-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .portal-onb-sol-identity {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .portal-onb-sol-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--brand-soft, #ebf2f9);
      color: var(--brand-ink, #3c70af);
      border: 1px solid var(--brand-border, #c1d4eb);
      font-size: 13.5px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      letter-spacing: 0.02em;
    }
    .portal-onb-sol-name {
      display: block;
      font-size: 15px;
      font-weight: 700;
      color: var(--ink, #101828);
      line-height: 1.25;
    }
    .portal-onb-sol-sub {
      display: block;
      font-size: 12px;
      color: var(--muted, #667085);
      margin-top: 2px;
    }
    .portal-onb-sol-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px 14px;
      padding: 11px 14px;
      background: var(--surface-2, #f1f4f8);
      border: 1px solid var(--line, #e4e7ec);
      border-radius: var(--radius-sm, 10px);
    }
    .portal-onb-sol-cell {
      min-width: 0;
    }
    .portal-onb-sol-cell span {
      display: block;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--muted, #667085);
      margin-bottom: 2px;
    }
    .portal-onb-sol-cell strong {
      display: block;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--ink, #101828);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .portal-onb-sol-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px 14px;
      flex-wrap: wrap;
      padding-top: 12px;
      border-top: 1px solid var(--line, #e4e7ec);
    }
    .portal-onb-sol-docs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .portal-onb-doc-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 29px;
      padding: 4px 10px;
      border-radius: var(--radius-xs, 8px);
      background: var(--brand-soft, #ebf2f9);
      color: var(--brand-ink, #3c70af);
      border: 1px solid var(--brand-border, #c1d4eb);
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.14s ease, border-color 0.14s ease;
    }
    .portal-onb-doc-chip:hover {
      background: var(--surface, #ffffff);
      border-color: var(--brand-solid, #4077ba);
    }
    .portal-onb-sol-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-left: auto;
    }
    .portal-onb-sol-empty {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      border-radius: var(--radius-sm, 10px);
      background: var(--surface-2, #f1f4f8);
      border: 1px solid var(--line, #e4e7ec);
      font-size: 13px;
      color: var(--muted, #667085);
    }
    .portal-onb-quickgen {
      background: var(--surface-2, #f1f4f8);
      border: 1px solid var(--line, #e4e7ec);
      border-radius: var(--radius-md, 12px);
      padding: 14px;
      display: grid;
      gap: 10px;
    }
    .portal-onb-drafts-details {
      border: 1px solid var(--line, #e4e7ec);
      border-radius: var(--radius-sm, 10px);
      padding: 10px 14px;
      background: var(--surface-2, #f1f4f8);
    }
    .portal-onb-drafts-details summary {
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--ink-2, #475467);
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .portal-onb-draft-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 9px 0;
      border-top: 1px solid var(--line, #e4e7ec);
      font-size: 12.5px;
    }
    .portal-onb-review-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
      gap: 8px 14px;
      padding: 11px 13px;
      border-radius: var(--radius-sm, 10px);
      background: var(--surface-2, #f1f4f8);
      border: 1px solid var(--brand-border, #c1d4eb);
      margin-bottom: 12px;
      font-size: 12px;
    }
    .portal-onb-review-summary div span {
      display: block;
      color: var(--muted, #667085);
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .portal-onb-review-summary div strong {
      color: var(--ink, #101828);
      word-break: break-word;
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
      <div class="portal-field-card" style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; background:#f8fafc;">
        <div>
          <strong style="font-size:13px; color:#0f172a;">Quer que o novato preencha tudo sozinho?</strong>
          <small style="display:block; color:var(--muted);">Gere o link de pré-cadastro na aba 4 e envie no WhatsApp do candidato.</small>
        </div>
        <button type="button" id="btnShortcutGoOnboardingLink" class="btn btn-secondary btn-sm permission-manager">
          Gerar Link p/ Novato →
        </button>
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
      <div class="portal-field-card permission-manager" id="portalOnboardingLinkCard">
        <div class="portal-field-card-head">
          <div>
            <h4 class="portal-field-card-title">Link de Pré-Cadastro do Funcionário Novato</h4>
            <span class="portal-field-card-sub">O novato preenche seus dados e envia documentos; depois você confere e libera o acesso.</span>
          </div>
          <span id="portalOnboardingStatusBadge" class="portal-pill portal-pill--neutral">Sem link gerado</span>
        </div>

        <div style="display:grid; gap:10px;">
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <input id="portalOnboardingLinkInput" type="text" readonly placeholder="Clique em Gerar Link para criar o convite do novato..." style="flex:1 1 320px; min-width:0; background:var(--surface-2, #f1f4f8); font-size:12.5px;" />
            <button type="button" id="btnCopiarLinkOnboarding" class="btn btn-secondary btn-sm hidden" style="min-height:38px;">
              Copiar Link
            </button>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
            <small id="portalOnboardingLinkHint" style="color:var(--muted, #667085); font-size:12px; flex:1 1 240px;">
              Mesmo antes de preencher e-mail ou documentos completos, você pode gerar o link agora e enviar para o candidato.
            </small>
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
              <button type="button" id="btnGerarLinkOnboarding" class="btn btn-primary btn-sm" style="min-height:36px;">
                Gerar Link
              </button>
              <a id="btnWhatsAppLinkOnboarding" href="#" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm hidden" style="min-height:36px; text-decoration:none;">
                Enviar no WhatsApp
              </a>
              <button type="button" id="btnRegenerarLinkOnboarding" class="btn btn-secondary btn-sm hidden" style="min-height:36px;">
                Novo Link
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="portal-field-card permission-manager hidden" id="portalOnboardingReviewCard" style="border:1px solid var(--brand-border, #c1d4eb); box-shadow:inset 3px 0 0 var(--brand-solid, #4077ba), var(--sh-sm, 0 1px 2px rgba(16, 24, 40, 0.04)); background:var(--surface, #ffffff);">
        <div class="portal-field-card-head" style="padding-bottom:12px; border-bottom:1px solid var(--line, #e4e7ec); margin-bottom:14px;">
          <div>
            <h4 class="portal-field-card-title">Conferência &amp; Formalização do Colaborador</h4>
            <span id="portalOnboardingReviewSub" class="portal-field-card-sub">Confira os dados e documentos enviados pelo novato e clique abaixo para aceitar, formalizar o cadastro e liberar o acesso.</span>
          </div>
          <span class="portal-pill portal-pill--amber">Aguardando Conferência</span>
        </div>
        <div id="portalOnboardingReviewSummary" class="portal-onb-review-summary hidden"></div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:12px 14px; align-items:end; margin-bottom:16px;">
          <label class="field" style="margin:0;">
            <span>E-mail de Acesso</span>
            <input id="portalOnboardingLoginEmail" type="email" placeholder="email@colaborador.com" />
          </label>
          <label class="field permission-admin" style="margin:0;">
            <span>Senha Provisória (opcional)</span>
            <input id="portalOnboardingProvisionalPass" type="text" minlength="10" placeholder="Mín. 10 chars ou automática" />
          </label>
          <label class="field" style="margin:0;">
            <span>Etapa após Aprovar</span>
            <select id="portalOnboardingApproveStage">
              <option value="3" selected>3. Exame Admissional (ASO)</option>
              <option value="4">4. Contrato Assinado</option>
              <option value="5">5. Ativo - Período de Experiência</option>
            </select>
          </label>
        </div>
        <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; padding-top:14px; border-top:1px solid var(--line, #e4e7ec);">
          <button type="button" id="btnSolicitarCorrecaoOnboarding" class="btn btn-secondary" style="min-height:40px;">
            Solicitar Correção ao Novato
          </button>
          <button type="button" id="btnLiberarAcessoOnboarding" class="btn btn-primary" style="min-height:40px;">
            Conferir, Aprovar &amp; Liberar Acesso
          </button>
        </div>
        <div id="portalOnboardingCredResult" class="hidden" style="margin-top:12px; padding:12px; border-radius:10px; background:var(--good-soft, #e4f6ee); border:1px solid #a7f3d0; font-size:13px;"></div>
      </div>

      <div class="portal-field-card">
        <div class="portal-field-card-head">
          <div>
            <h4 class="portal-field-card-title">Linha do Tempo de Contratação (6 Etapas)</h4>
            <span class="portal-field-card-sub">Registro automático da data em cada transição</span>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" id="btnAvancarProximaEtapaQuick" class="btn btn-primary btn-sm permission-manager" style="min-height:36px; font-size:12.5px;">
              Avançar Próxima Etapa →
            </button>
            <button type="button" id="btnEmployeeAuditHistory" class="btn btn-secondary permission-admin" style="min-height:36px; font-size:12.5px;">
              Histórico de Alterações
            </button>
          </div>
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

  // Helper compartilhado para preencher todos os campos do modal (legados + estendidos) com os dados sincronizados do colaborador
  const hydrateAllEmployeeFormInputs = (emp) => {
    if (!emp) return;
    const setLegacy = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null && val !== "") el.value = String(val);
    };
    setLegacy("employeeName", emp.Nome);
    setLegacy("employeeEmail", emp.Email);
    setLegacy("employeePhone", emp.WhatsApp || emp.Telefone);
    setLegacy("employeeCpf", emp.CPF);
    setLegacy("employeeStore", emp.LojaID);
    setLegacy("employeeRole", emp.Cargo);
    setLegacy("employeeProfile", emp.Perfil);
    if (emp.DataAdmissao) setLegacy("employeeAdmission", String(emp.DataAdmissao).slice(0, 10));
    setLegacy("employeeContract", emp.TipoContrato);
    const activeChk = document.getElementById("employeeActive");
    if (activeChk) activeChk.checked = emp.Ativo !== false;
    populateExtendedEmployeeFields(emp);
    renderEmployeeOnboardingState(emp);
  };

  // Reset automatico para Aba 1 (ou aba solicitada) + sincronizacao & preenchimento ao abrir o modal
  if (dialog && dialog.dataset.portalOpenObserver !== "true") {
    dialog.dataset.portalOpenObserver = "true";
    const syncOnOpen = async () => {
      if (!dialog.hasAttribute("open")) return;
      const requestedTab = window.__PORTAL_OPEN_EMP_TAB__ || "emp-tab-basico";
      window.__PORTAL_OPEN_EMP_TAB__ = "";
      activatePortalTab("employee-modal", requestedTab);
      const credBox = document.getElementById("portalOnboardingCredResult");
      if (credBox) {
        credBox.classList.add("hidden");
        credBox.innerHTML = "";
      }
      const empId = document.getElementById("employeeId")?.value || "";
      if (!empId) {
        populateExtendedEmployeeFields({});
        renderEmployeeOnboardingState({});
        return;
      }
      try {
        await invokePortal("sincronizarConvitesOnboarding", { FuncionarioID: empId }).catch(() => null);
        const emps = await runtime.list("Funcionarios", { forceRefresh: true }).catch(() => runtime.list("Funcionarios").catch(() => []));
        const match = emps.find((e) => String(e.FuncionarioID) === String(empId));
        if (match) {
          hydrateAllEmployeeFormInputs(match);
        }
      } catch {
        // Silencioso
      }
    };
    const obs = new MutationObserver(() => syncOnOpen());
    obs.observe(dialog, { attributes: true, attributeFilter: ["open"] });
  }

  document.getElementById("btnShortcutGoOnboardingLink")?.addEventListener("click", () => {
    activatePortalTab("employee-modal", "emp-tab-funil");
  });

  const handleGenerateOnboardingLink = async (regenerar = false) => {
    const empId = form.elements.FuncionarioID?.value || document.getElementById("employeeId")?.value || "";
    const btn = document.getElementById(regenerar ? "btnRegenerarLinkOnboarding" : "btnGerarLinkOnboarding");
    if (btn) btn.disabled = true;
    try {
      const res = await invokePortal("gerarLinkOnboarding", {
        FuncionarioID: empId,
        Nome: document.getElementById("employeeName")?.value || "",
        LojaID: document.getElementById("employeeStore")?.value || "",
        Cargo: document.getElementById("employeeRole")?.value || "",
        Setor: document.getElementById("employeeSetor")?.value || "Cozinha",
        Perfil: document.getElementById("employeeProfile")?.value || "Funcionário",
        TipoContrato: document.getElementById("employeeContract")?.value || "CLT",
        DataAdmissao: document.getElementById("employeeAdmission")?.value || "",
        TurnoTrabalho: document.getElementById("employeeTurnoTrabalho")?.value || "",
        SalarioBase: document.getElementById("employeeSalarioBase")?.value || 0,
        Telefone: document.getElementById("employeePhone")?.value || "",
        Email: document.getElementById("employeeEmail")?.value || "",
        origin: `${window.location.origin}${window.location.pathname}`,
        regenerar,
      });
      const emp = res.data?.colaborador;
      if (emp?.FuncionarioID) {
        const idInput = document.getElementById("employeeId");
        if (idInput) idInput.value = emp.FuncionarioID;
      }
      renderEmployeeOnboardingState(emp, res.data);
      showPortalToast(res.message || "Link de pré-cadastro gerado!", "success");
    } catch (err) {
      showPortalToast(err.message || "Não foi possível gerar o link.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  document.getElementById("btnGerarLinkOnboarding")?.addEventListener("click", () => handleGenerateOnboardingLink(false));
  document.getElementById("btnRegenerarLinkOnboarding")?.addEventListener("click", () => handleGenerateOnboardingLink(true));

  document.getElementById("btnCopiarLinkOnboarding")?.addEventListener("click", async () => {
    const linkVal = document.getElementById("portalOnboardingLinkInput")?.value || "";
    if (!linkVal) return;
    try {
      await navigator.clipboard.writeText(linkVal);
      showPortalToast("Link copiado para a área de transferência!", "success");
    } catch {
      const inp = document.getElementById("portalOnboardingLinkInput");
      inp?.select?.();
      document.execCommand?.("copy");
      showPortalToast("Link selecionado/copiado!", "success");
    }
  });

  document.getElementById("btnLiberarAcessoOnboarding")?.addEventListener("click", async () => {
    const empId = form.elements.FuncionarioID?.value || document.getElementById("employeeId")?.value || "";
    if (!empId) {
      showPortalToast("Salve ou gere o link do colaborador primeiro.", "warning");
      return;
    }
    const btn = document.getElementById("btnLiberarAcessoOnboarding");
    const email = document.getElementById("portalOnboardingLoginEmail")?.value || document.getElementById("employeeEmail")?.value || "";
    const senhaProvisoria = document.getElementById("portalOnboardingProvisionalPass")?.value || "";
    const etapa = Number(document.getElementById("portalOnboardingApproveStage")?.value || 3);
    if (btn) btn.disabled = true;
    try {
      const res = await invokePortal("conferirLiberarAcessoOnboarding", {
        FuncionarioID: empId,
        aprovar: true,
        email,
        senhaProvisoria,
        etapa,
        Nome: document.getElementById("employeeName")?.value || "",
        LojaID: document.getElementById("employeeStore")?.value || "",
        Cargo: document.getElementById("employeeRole")?.value || "",
        Setor: document.getElementById("employeeSetor")?.value || "",
        Perfil: document.getElementById("employeeProfile")?.value || "",
        TipoContrato: document.getElementById("employeeContract")?.value || "",
        DataAdmissao: document.getElementById("employeeAdmission")?.value || "",
        TurnoTrabalho: document.getElementById("employeeTurnoTrabalho")?.value || "",
        SalarioBase: document.getElementById("employeeSalarioBase")?.value || "",
        origin: `${window.location.origin}${window.location.pathname}`,
      });
      const updated = res.data?.colaborador;
      hydrateAllEmployeeFormInputs(updated);
      const credBox = document.getElementById("portalOnboardingCredResult");
      if (credBox) {
        const pwdLine = res.data?.senhaProvisoria
          ? `<div><strong>Senha provisória:</strong> <code style="user-select:all;">${escapeHtml(res.data.senhaProvisoria)}</code></div>`
          : "";
        const waAction = res.data?.waUrl
          ? `<a href="${escapeHtml(res.data.waUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" style="margin-top:8px; text-decoration:none; display:inline-flex;">Enviar Acesso no WhatsApp ↗</a>`
          : "";
        const notes = Array.isArray(res.data?.avisos) && res.data.avisos.length
          ? `<small style="display:block; color:#b45309; margin-top:6px;">${escapeHtml(res.data.avisos.join(" "))}</small>`
          : "";
        credBox.innerHTML = `
          <strong style="display:block; color:#047857; margin-bottom:4px;">Cadastro formalizado e acesso liberado!</strong>
          <div><strong>E-mail de acesso:</strong> ${escapeHtml(res.data?.emailLogin || email)}</div>
          ${pwdLine}
          ${notes}
          ${waAction}
        `;
        credBox.classList.remove("hidden");
      }
      showPortalToast(res.message || "Colaborador formalizado e acesso liberado!", "success");
      await loadEmployeesOverviewSummary();
      await loadUnifiedPendingHrItems();
      if (typeof window.__GESTAO_REFRESH_APP__ === "function") {
        window.__GESTAO_REFRESH_APP__({ silent: true }).catch(() => null);
      }
    } catch (err) {
      showPortalToast(err.message || "Não foi possível liberar o acesso.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("btnSolicitarCorrecaoOnboarding")?.addEventListener("click", async () => {
    const empId = form.elements.FuncionarioID?.value || document.getElementById("employeeId")?.value || "";
    if (!empId) return;
    const motivo = window.prompt("Informe ao novato o que precisa ser corrigido ou reenviado:");
    if (!motivo || motivo.trim().length < 3) return;
    try {
      const res = await invokePortal("conferirLiberarAcessoOnboarding", {
        FuncionarioID: empId,
        aprovar: false,
        motivo: motivo.trim(),
      });
      hydrateAllEmployeeFormInputs(res.data?.colaborador);
      showPortalToast(res.message || "Correção solicitada.", "success");
      if (res.data?.waUrl) {
        const credBox = document.getElementById("portalOnboardingCredResult");
        if (credBox) {
          credBox.innerHTML = `
            <strong style="display:block; color:#b45309; margin-bottom:6px;">Correção solicitada ao novato</strong>
            <a href="${escapeHtml(res.data.waUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="text-decoration:none;">Avisar no WhatsApp com o mesmo link ↗</a>
          `;
          credBox.classList.remove("hidden");
        }
      }
    } catch (err) {
      showPortalToast(err.message || "Falha ao solicitar correção.", "error");
    }
  });

  document.getElementById("btnAvancarProximaEtapaQuick")?.addEventListener("click", async () => {
    const empId = form.elements.FuncionarioID?.value || document.getElementById("employeeId")?.value;
    if (!empId) {
      showPortalToast("Salve ou gere o link do colaborador primeiro.", "warning");
      return;
    }
    const currentStage = Number(document.getElementById("employeeEtapaAdmissao")?.value || 1);
    const nextStage = Math.min(6, currentStage + 1);
    if (nextStage === currentStage) {
      showPortalToast("Colaborador já está na Etapa 6.", "info");
      return;
    }
    const substatus = document.getElementById("employeeSubstatusEtapa6")?.value || "Efetivado";
    const motivo = document.getElementById("employeeMotivoDesligamento")?.value || "";
    try {
      const res = await invokePortal("avancarEtapaOnboarding", {
        FuncionarioID: empId,
        etapa: nextStage,
        substatus,
        validarCadastro: nextStage >= 2,
        motivo,
      });
      hydrateAllEmployeeFormInputs(res.data);
      showPortalToast(res.message || `Avançou para Etapa ${nextStage}!`, "success");
      loadEmployeesOverviewSummary();
    } catch (err) {
      showPortalToast(err.message || "Erro ao avançar etapa.", "error");
    }
  });

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

  // Upload file reader helper com nome amigavel e envio seguro ao Google Drive
  const fileInput = document.getElementById("employeeDocUploadFile");
  const fileNameLabel = document.getElementById("employeeDocUploadFileName");
  let uploadedAdmissionDriveMeta = null;
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    uploadedAdmissionDriveMeta = null;
    if (!file) {
      if (fileNameLabel) fileNameLabel.textContent = "Nenhum arquivo selecionado";
      return;
    }
    const urlInput = document.getElementById("employeeDocUploadUrl");
    const empId = form.elements.FuncionarioID?.value || document.getElementById("employeeId")?.value || "";
    const codigoDocumento = document.getElementById("employeeDocUploadTipo")?.value || "admissao";
    try {
      if (fileNameLabel) fileNameLabel.textContent = `Enviando "${file.name}" ao Google Drive...`;
      const dataUrl = await readAttachmentFileAsDataUrl(file);
      const driveRes = await uploadPrivateDocumentToDrive({
        dataUrl,
        fileName: file.name,
        category: "admissao",
        employeeId: empId,
        storeId: form.elements.LojaID?.value || "",
        docId: codigoDocumento,
      });
      uploadedAdmissionDriveMeta = {
        url: driveRes.url,
        fileId: driveRes.fileId,
        mimeType: driveRes.mimeType,
        fileName: file.name,
      };
      if (urlInput) urlInput.value = driveRes.url;
      if (fileNameLabel) fileNameLabel.textContent = `${file.name} · Salvo no Drive`;
    } catch (err) {
      if (fileNameLabel) fileNameLabel.textContent = file.name;
      showPortalToast(err.message || "Falha ao enviar documento para o Google Drive.", "error");
    }
  });

  document.getElementById("btnEnviarDocAdmissional")?.addEventListener("click", async () => {
    const empId = form.elements.FuncionarioID?.value || document.getElementById("employeeId")?.value;
    if (!empId) {
      showPortalToast("Salve o cadastro inicial do colaborador antes de anexar documentos.", "warning");
      return;
    }
    const codigoDocumento = document.getElementById("employeeDocUploadTipo")?.value;
    let arquivoUrl = document.getElementById("employeeDocUploadUrl")?.value;
    const fileObj = document.getElementById("employeeDocUploadFile")?.files?.[0];
    try {
      let driveFileId = uploadedAdmissionDriveMeta?.fileId || parseDriveFileId(arquivoUrl) || "";
      let mimeType = uploadedAdmissionDriveMeta?.mimeType || fileObj?.type || "";
      if (arquivoUrl && arquivoUrl.startsWith("data:")) {
        const driveRes = await uploadPrivateDocumentToDrive({
          dataUrl: arquivoUrl,
          fileName: fileObj?.name || `${codigoDocumento}.pdf`,
          category: "admissao",
          employeeId: empId,
          storeId: form.elements.LojaID?.value || "",
          docId: codigoDocumento,
        });
        arquivoUrl = driveRes.url;
        driveFileId = driveRes.fileId;
        mimeType = driveRes.mimeType;
      }
      const res = await invokePortal("enviarDocumentoAdmissional", {
        FuncionarioID: empId,
        codigoDocumento,
        arquivoUrl,
        driveFileId,
        mimeType,
        nomeArquivo: fileObj?.name || `${codigoDocumento}.pdf`,
      });
      uploadedAdmissionDriveMeta = null;
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

function normalizeDocItemFiles(docItem) {
  if (!docItem) return [];
  if (Array.isArray(docItem.arquivos) && docItem.arquivos.length) {
    return docItem.arquivos.filter((f) => f && f.arquivoUrl);
  }
  if (docItem.arquivoUrl) {
    return [{ arquivoUrl: docItem.arquivoUrl, nomeArquivo: docItem.nomeArquivo || docItem.titulo || "Documento", enviadoEm: docItem.enviadoEm }];
  }
  return [];
}

async function openOnboardingFilePreview(title, fileUrlOrList, options = {}) {
  const files = Array.isArray(fileUrlOrList)
    ? fileUrlOrList.filter((f) => f && f.arquivoUrl)
    : fileUrlOrList
      ? [{ arquivoUrl: String(fileUrlOrList), nomeArquivo: title || "Documento" }]
      : [];
  if (!files.length) return;
  let dlg = document.getElementById("portalOnboardingPreviewDialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "portalOnboardingPreviewDialog";
    dlg.className = "folha-dialog";
    dlg.innerHTML = `
      <div class="folha-dialog-head">
        <div>
          <span class="eyebrow" style="margin-bottom:2px;">DOCUMENTO ANEXADO</span>
          <h3 id="onbPrevTitle" style="margin:0; font-size:17px;">Documento</h3>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="onbPrevClose">Fechar</button>
      </div>
      <div id="onbPrevBody" style="padding:14px; text-align:center; max-height:72vh; overflow:auto; display:grid; gap:14px;"></div>
    `;
    document.body.appendChild(dlg);
    const cleanup = () => {
      (dlg._activeBlobUrls || []).forEach((u) => {
        try { URL.revokeObjectURL(u); } catch (_) {}
      });
      dlg._activeBlobUrls = [];
    };
    dlg.addEventListener("close", cleanup);
    dlg.querySelector("#onbPrevClose")?.addEventListener("click", () => dlg.close());
  }
  (dlg._activeBlobUrls || []).forEach((u) => {
    try { URL.revokeObjectURL(u); } catch (_) {}
  });
  dlg._activeBlobUrls = [];

  const titleEl = dlg.querySelector("#onbPrevTitle");
  const bodyEl = dlg.querySelector("#onbPrevBody");
  if (titleEl) {
    titleEl.textContent = files.length > 1 ? `${title || "Documento"} (${files.length} arquivos)` : title || "Documento";
  }

  const hasDriveFiles = files.some((f) => Boolean(f.driveFileId || parseDriveFileId(f.arquivoUrl)));
  if (bodyEl && hasDriveFiles) {
    bodyEl.innerHTML = `<p style="margin:18px 0; font-size:13px; color:#64748b;">Carregando arquivo seguro do Google Drive...</p>`;
  }
  if (typeof dlg.showModal === "function") {
    if (!dlg.open) dlg.showModal();
  } else {
    dlg.setAttribute("open", "");
  }

  const resolvedFiles = await Promise.all(
    files.map(async (f, idx) => {
      const rawUrl = String(f.arquivoUrl || "").trim();
      const fid = String(f.driveFileId || parseDriveFileId(rawUrl) || "").trim();
      const label = f.nomeArquivo || `${title || "Documento"} ${idx + 1}`;
      let viewUrl = rawUrl;
      let mime = String(f.mimeType || "").toLowerCase();
      let errorMsg = "";

      if (fid && !rawUrl.startsWith("data:")) {
        try {
          const driveData = await readPrivateDriveFile(fid, {
            inviteToken: options.inviteToken || f.inviteToken || "",
          });
          viewUrl = driveData.dataUrl;
          mime = String(driveData.mimeType || mime).toLowerCase();
        } catch (err) {
          errorMsg = err?.message || "Não foi possível carregar este arquivo do Google Drive.";
        }
      }
      return { rawUrl, viewUrl, mime, label, errorMsg };
    }),
  );

  if (bodyEl) {
    bodyEl.innerHTML = resolvedFiles
      .map((item, idx) => {
        if (item.errorMsg) {
          return `
            <div style="border:1px solid #fecaca; border-radius:12px; padding:12px; background:#fef2f2; color:#991b1b; font-size:12.5px;">
              <strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.errorMsg)}
              ${item.rawUrl ? `<div style="margin-top:8px;"><a href="${escapeHtml(item.rawUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Abrir no Drive ↗</a></div>` : ""}
            </div>
          `;
        }
        const safeUrl = item.viewUrl;
        const isPdf =
          safeUrl.startsWith("data:application/pdf") ||
          item.mime === "application/pdf" ||
          /\.pdf($|\?)/i.test(safeUrl) ||
          /\.pdf$/i.test(item.label);
        let hrefUrl = safeUrl;
        if (isPdf && safeUrl.startsWith("data:")) {
          hrefUrl = driveDataUrlToObjectUrl(safeUrl, "application/pdf");
          if (hrefUrl.startsWith("blob:")) dlg._activeBlobUrls.push(hrefUrl);
        }
        const mediaHtml = isPdf
          ? `<iframe src="${escapeHtml(hrefUrl)}" style="width:100%; height:56vh; border:1px solid #e2e8f0; border-radius:8px; background:#fff;"></iframe><div style="margin-top:8px;"><a href="${escapeHtml(hrefUrl)}" download="${escapeHtml(item.label.endsWith(".pdf") ? item.label : `${item.label}.pdf`)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" style="text-decoration:none;">Abrir / Baixar PDF</a></div>`
          : `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(item.label)}" style="max-width:100%; max-height:58vh; border-radius:8px; object-fit:contain; box-shadow:0 2px 10px rgba(0,0,0,0.08);" />`;
        return `
          <div style="border:1px solid #e2e8f0; border-radius:12px; padding:10px; background:#f8fafc;">
            ${resolvedFiles.length > 1 ? `<div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:8px; text-align:left;">Arquivo ${idx + 1}: ${escapeHtml(item.label)}</div>` : ""}
            ${mediaHtml}
          </div>
        `;
      })
      .join("");
  }
}

export function renderEmployeeOnboardingState(emp = {}, linkData = null) {
  const linkInput = document.getElementById("portalOnboardingLinkInput");
  const copyBtn = document.getElementById("btnCopiarLinkOnboarding");
  const waBtn = document.getElementById("btnWhatsAppLinkOnboarding");
  const regenBtn = document.getElementById("btnRegenerarLinkOnboarding");
  const genBtn = document.getElementById("btnGerarLinkOnboarding");
  const statusBadge = document.getElementById("portalOnboardingStatusBadge");
  const reviewCard = document.getElementById("portalOnboardingReviewCard");
  const loginEmailInput = document.getElementById("portalOnboardingLoginEmail");

  const resolvedUrl =
    linkData?.url ||
    emp?.OnboardingLinkUrl ||
    (emp?.OnboardingToken && typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}?onboarding_token=${encodeURIComponent(emp.OnboardingToken)}`
      : "");

  if (linkInput) linkInput.value = resolvedUrl || "";
  copyBtn?.classList.toggle("hidden", !resolvedUrl);
  regenBtn?.classList.toggle("hidden", !resolvedUrl);
  if (genBtn) genBtn.textContent = resolvedUrl ? "Atualizar Link" : "Gerar Link";

  if (waBtn) {
    const waHref = linkData?.waUrl || (() => {
      const phoneDigits = String(emp?.WhatsApp || emp?.Telefone || "").replace(/\D/g, "");
      if (!resolvedUrl || phoneDigits.length < 10) return "";
      const phoneIntl = phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;
      const first = String(emp?.Nome || "colaborador(a)").trim().split(/\s+/)[0];
      const msg = encodeURIComponent(
        `Olá ${first}! Preencha seus dados cadastrais e anexe seus documentos pelo link abaixo para iniciarmos sua admissão:\n\n${resolvedUrl}`,
      );
      return `https://wa.me/${phoneIntl}?text=${msg}`;
    })();
    if (waHref) {
      waBtn.setAttribute("href", waHref);
      waBtn.classList.remove("hidden");
    } else {
      waBtn.classList.add("hidden");
    }
  }

  if (statusBadge) {
    const st = String(emp?.StatusOnboarding || "");
    if (emp?.CadastroValidado && emp?.Ativo !== false) {
      statusBadge.className = "portal-pill portal-pill--green";
      statusBadge.textContent = "Conferido · Acesso Liberado";
    } else if (st === "Aguardando Conferência") {
      statusBadge.className = "portal-pill portal-pill--amber";
      statusBadge.textContent = "Preenchido · Aguardando Conferência";
    } else if (st === "Correção Solicitada") {
      statusBadge.className = "portal-pill portal-pill--red";
      statusBadge.textContent = "Correção Solicitada";
    } else if (resolvedUrl) {
      statusBadge.className = "portal-pill portal-pill--blue";
      statusBadge.textContent = "Link Ativo · Aguardando Novato";
    } else {
      statusBadge.className = "portal-pill portal-pill--neutral";
      statusBadge.textContent = "Sem link gerado";
    }
  }

  if (reviewCard) {
    const showReview =
      Boolean(emp?.FuncionarioID) &&
      !emp?.CadastroValidado &&
      (emp?.StatusOnboarding === "Aguardando Conferência" || Boolean(emp?.OnboardingEnviadoEm) || Boolean(emp?.Email));
    reviewCard.classList.toggle("hidden", !showReview);
    const reviewSummary = document.getElementById("portalOnboardingReviewSummary");
    if (reviewSummary) {
      if (showReview) {
        const dossieDocs = emp?.DossieDocumentos || {};
        const attachedDocs = Object.values(dossieDocs).filter((d) => normalizeDocItemFiles(d).length > 0);
        const endFull = [emp?.Endereco, emp?.NumeroEndereco, emp?.Bairro, emp?.Cidade, emp?.UF].filter(Boolean).join(", ");
        const clipSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
        const docButtons = attachedDocs
          .map((d) => {
            const files = normalizeDocItemFiles(d);
            return `<button type="button" class="portal-onb-doc-chip" data-review-doc-preview="${escapeHtml(d.codigo)}">${clipSvg}<span>${escapeHtml(d.titulo || d.codigo)}${files.length > 1 ? ` (${files.length})` : ""}</span></button>`;
          })
          .join("");
        reviewSummary.innerHTML = `
          <div><span>Nome Completo</span><strong>${escapeHtml(emp?.Nome || "—")}</strong></div>
          <div><span>CPF / RG</span><strong>${escapeHtml([emp?.CPF, emp?.RG].filter(Boolean).join(" · ") || "—")}</strong></div>
          <div><span>WhatsApp</span><strong>${escapeHtml(emp?.WhatsApp || emp?.Telefone || "—")}</strong></div>
          <div><span>E-mail</span><strong>${escapeHtml(emp?.Email || "—")}</strong></div>
          <div><span>Endereço</span><strong>${escapeHtml(endFull || "—")}</strong></div>
          <div><span>Chave PIX</span><strong>${escapeHtml(emp?.ChavePix || "—")}</strong></div>
          ${
            docButtons
              ? `<div style="grid-column:1 / -1; padding-top:8px; margin-top:2px; border-top:1px solid var(--line, #e4e7ec);"><span>Documentos Enviados pelo Novato (${attachedDocs.length})</span><div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">${docButtons}</div></div>`
              : ""
          }
        `;
        reviewSummary.querySelectorAll("[data-review-doc-preview]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const code = btn.getAttribute("data-review-doc-preview");
            const docItem = dossieDocs[code];
            const files = normalizeDocItemFiles(docItem);
            if (files.length) openOnboardingFilePreview(docItem.titulo || code, files);
          });
        });
        reviewSummary.classList.remove("hidden");
      } else {
        reviewSummary.innerHTML = "";
        reviewSummary.classList.add("hidden");
      }
    }
    if (loginEmailInput && !loginEmailInput.value && emp?.Email) {
      loginEmailInput.value = emp.Email;
    } else if (loginEmailInput && emp?.Email) {
      loginEmailInput.value = emp.Email;
    }
  }

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
      const files = normalizeDocItemFiles(item);
      const countLabel = files.length > 1 ? ` (${files.length})` : "";
      const previewBtn = files.length
        ? `<button type="button" class="btn btn-secondary btn-sm" data-onb-preview-doc="${escapeHtml(doc.codigo)}" style="min-height:28px; padding:2px 8px; font-size:11.5px;">Ver${countLabel}</button>`
        : "";
      return `
        <div class="portal-doc-item">
          <span>${doc.titulo}</span>
          <div style="display:flex; align-items:center; gap:6px;">
            ${previewBtn}
            <span class="portal-pill ${files.length ? "portal-pill--green" : "portal-pill--neutral"}">${files.length ? `Enviado${countLabel}` : "Pendente"}</span>
          </div>
        </div>
      `;
    }).join("");
    checklist.querySelectorAll("[data-onb-preview-doc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-onb-preview-doc");
        const docItem = dossie[code];
        const files = normalizeDocItemFiles(docItem);
        if (files.length) {
          openOnboardingFilePreview(docItem.titulo || code, files);
        }
      });
    });
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

  const solPanel = document.createElement("div");
  solPanel.id = "portalOnboardingSolicitationsPanel";
  solPanel.className = "portal-onb-sol-panel permission-manager";
  kpiStrip.after(solPanel);

  const tbody = document.getElementById("employeeBody");
  if (tbody && tbody.dataset.stageFilterObserver !== "true") {
    tbody.dataset.stageFilterObserver = "true";
    const obs = new MutationObserver(() => applyEmployeeStageRowFilter());
    obs.observe(tbody, { childList: true });
  }
}

async function renderOnboardingSolicitationsPanel(employees = []) {
  const panel = document.getElementById("portalOnboardingSolicitationsPanel");
  if (!panel) return;
  const profile = runtime?.profile;
  if (!isGerenteProfile(profile)) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  const storeId = window.__selectedPortalStoreId || "";
  const storeFiltered = storeId
    ? employees.filter((e) => !e.LojaID || String(e.LojaID) === String(storeId))
    : employees;

  const pendingAll = storeFiltered.filter((e) => isOnboardingOnlyPending(e));
  const awaitingReview = pendingAll.filter((e) => isOnboardingReadyForReview(e));
  const pendingDrafts = pendingAll.filter((e) => !isOnboardingReadyForReview(e));

  window.__portalOnboardingPendingCount = awaitingReview.length;
  if (typeof window.syncPendingCenterSummary === "function") {
    window.syncPendingCenterSummary();
  }

  const stores = await runtime.list("Lojas").catch(() => []);
  const activeStores = stores.filter((s) => s.Ativo !== false);

  const formatSentDateBr = (iso) => {
    const raw = String(iso || "").trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]} às ${match[4]}`;
    return raw ? raw.slice(0, 16).replace("T", " às ") : "Recentemente";
  };
  const initialsForName = (name) => {
    const parts = String(name || "NC").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "NC";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
  };
  const clipSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

  const awaitingHtml = awaitingReview.length
    ? awaitingReview
        .map((e) => {
          const dossie = e.DossieDocumentos || {};
          const docList = Object.values(dossie).filter((d) => normalizeDocItemFiles(d).length > 0);
          const sentAt = formatSentDateBr(e.OnboardingEnviadoEm);
          const cityStr = [e.Cidade, e.UF].filter(Boolean).join("/");
          const displayName = e.Nome || "Novo Colaborador";
          const docButtons = docList
            .map((d) => {
              const files = normalizeDocItemFiles(d);
              return `<button type="button" class="portal-onb-doc-chip" data-sol-preview-emp="${escapeHtml(e.FuncionarioID)}" data-sol-preview-code="${escapeHtml(d.codigo)}">${clipSvg}<span>${escapeHtml(d.titulo || d.codigo)}${files.length > 1 ? ` (${files.length})` : ""}</span></button>`;
            })
            .join("");

          const metaCells = [
            { label: "E-mail", value: e.Email || "—" },
            { label: "WhatsApp", value: e.WhatsApp || e.Telefone || "—" },
            { label: "CPF", value: e.CPF || "—" },
            ...(cityStr ? [{ label: "Cidade / UF", value: cityStr }] : []),
            ...(e.ChavePix ? [{ label: "Chave PIX", value: e.ChavePix }] : []),
          ]
            .map(
              (cell) => `
              <div class="portal-onb-sol-cell">
                <span>${escapeHtml(cell.label)}</span>
                <strong title="${escapeHtml(cell.value)}">${escapeHtml(cell.value)}</strong>
              </div>`,
            )
            .join("");

          return `
            <article class="portal-onb-sol-card">
              <div class="portal-onb-sol-card-head">
                <div class="portal-onb-sol-identity">
                  <span class="portal-onb-sol-avatar" aria-hidden="true">${escapeHtml(initialsForName(displayName))}</span>
                  <div style="min-width:0;">
                    <strong class="portal-onb-sol-name">${escapeHtml(displayName)}</strong>
                    <small class="portal-onb-sol-sub">
                      ${escapeHtml(e.NomeLoja || e.LojaID || "Unidade a definir")} · ${escapeHtml(e.Cargo || "Colaborador")} (${escapeHtml(e.TipoContrato || "CLT")}) · Enviado em ${escapeHtml(sentAt)}
                    </small>
                  </div>
                </div>
                <span class="portal-pill portal-pill--amber">Aguardando Conferência</span>
              </div>
              <div class="portal-onb-sol-meta">
                ${metaCells}
              </div>
              <div class="portal-onb-sol-footer">
                <div class="portal-onb-sol-docs">
                  <span style="font-size:11.5px; font-weight:700; color:var(--muted, #667085); text-transform:uppercase; letter-spacing:0.04em; margin-right:2px;">Anexos (${docList.length})</span>
                  ${docButtons || '<span style="font-size:12px; color:var(--muted, #667085);">Nenhum anexo listado</span>'}
                </div>
                <div class="portal-onb-sol-actions">
                  <button type="button" class="btn btn-secondary btn-sm" data-sol-delete-emp="${escapeHtml(e.FuncionarioID)}" data-sol-delete-name="${escapeHtml(displayName)}" style="color:var(--crit-ink, #a82f40);">
                    Excluir
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" data-sol-ficha-emp="${escapeHtml(e.FuncionarioID)}">
                    Editar Ficha / Docs
                  </button>
                  <button type="button" class="btn btn-primary btn-sm" data-sol-conferir-emp="${escapeHtml(e.FuncionarioID)}">
                    Conferir Dados &amp; Formalizar
                  </button>
                </div>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="portal-onb-sol-empty"><span>Nenhuma solicitação preenchida aguardando conferência no momento.</span></div>`;

  const draftsHtml = pendingDrafts.length
    ? `
      <details class="portal-onb-drafts-details">
        <summary>
          <span>Links gerados aguardando preenchimento pelo novato (${pendingDrafts.length})</span>
          <span style="font-size:11px; color:var(--muted, #667085);">Mostrar / ocultar</span>
        </summary>
        <div style="display:grid; margin-top:8px;">
          ${pendingDrafts
            .map((e) => {
              const linkUrl =
                e.OnboardingLinkUrl ||
                (e.OnboardingToken
                  ? `${window.location.origin}${window.location.pathname}?onboarding_token=${encodeURIComponent(e.OnboardingToken)}`
                  : "");
              const isGeneric = !e.Nome || e.Nome === "Novo Colaborador";
              const label = isGeneric ? "Convite por Link (aguardando novato preencher nome e dados)" : e.Nome;
              const createdStr = e.OnboardingLinkGeradoEm || e.DataCriacao ? String(e.OnboardingLinkGeradoEm || e.DataCriacao).slice(0, 10) : "-";
              return `
                <div class="portal-onb-draft-row">
                  <div style="min-width:0; flex:1;">
                    <strong style="color:var(--ink, #101828);">${escapeHtml(label)}</strong>
                    <small style="display:block; color:var(--muted, #667085);">${escapeHtml(e.NomeLoja || e.LojaID || "Todas / A definir")} · Criado em ${escapeHtml(createdStr)}</small>
                  </div>
                  <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                    ${linkUrl ? `<button type="button" class="btn btn-secondary btn-sm" data-sol-copy-link="${escapeHtml(linkUrl)}">Copiar Link</button>` : ""}
                    <button type="button" class="btn btn-secondary btn-sm" data-sol-delete-emp="${escapeHtml(e.FuncionarioID)}" data-sol-delete-name="${escapeHtml(label)}" style="color:var(--crit-ink, #a82f40);">Excluir Link</button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </details>
    `
    : "";

  panel.innerHTML = `
    <div class="portal-onb-sol-head">
      <div>
        <span class="eyebrow">ADMISSÃO DIGITAL · LINK DE PRÉ-CADASTRO</span>
        <h3 class="portal-onb-sol-title">
          Solicitações de Novos Colaboradores
          ${awaitingReview.length ? `<span class="portal-pill portal-pill--amber">${awaitingReview.length} para conferir</span>` : ""}
        </h3>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <button type="button" id="btnToggleQuickOnboardingLink" class="btn btn-primary btn-sm">+ Gerar Link para Novato</button>
      </div>
    </div>

    <div id="portalQuickOnboardingGenerator" class="portal-onb-quickgen hidden">
      <div class="dialog-grid" style="align-items:end;">
        <label class="field">
          <span>Unidade</span>
          <select id="quickOnbStoreSelect">
            ${activeStores.map((s) => `<option value="${escapeHtml(s.LojaID)}" ${String(s.LojaID) === String(storeId || profile?.LojaID || "") ? "selected" : ""}>${escapeHtml(s.NomeLoja)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Cargo (opcional)</span>
          <input id="quickOnbRoleInput" type="text" placeholder="Ex.: Chapeiro, Atendente..." />
        </label>
        <div style="display:flex; gap:8px;">
          <button type="button" id="btnConfirmQuickOnboardingLink" class="btn btn-primary btn-sm" style="min-height:38px;">Gerar &amp; Copiar Link</button>
        </div>
      </div>
      <div id="quickOnbLinkResultBox" class="hidden" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <input id="quickOnbLinkResultInput" type="text" readonly style="flex:1; min-width:220px; background:var(--surface, #ffffff); font-size:12.5px;" />
        <a id="quickOnbLinkWaBtn" href="#" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm hidden" style="text-decoration:none;">WhatsApp ↗</a>
      </div>
    </div>

    <div class="portal-onb-sol-list">${awaitingHtml}</div>
    ${draftsHtml}
  `;

  panel.querySelector("#btnToggleQuickOnboardingLink")?.addEventListener("click", () => {
    panel.querySelector("#portalQuickOnboardingGenerator")?.classList.toggle("hidden");
  });

  panel.querySelector("#btnConfirmQuickOnboardingLink")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const selectedStore = panel.querySelector("#quickOnbStoreSelect")?.value || profile?.LojaID || "";
      const role = panel.querySelector("#quickOnbRoleInput")?.value || "Colaborador";
      const res = await invokePortal("gerarLinkOnboarding", {
        LojaID: selectedStore,
        Cargo: role,
        origin: `${window.location.origin}${window.location.pathname}`,
      });
      const url = res?.data?.url || "";
      const resultBox = panel.querySelector("#quickOnbLinkResultBox");
      const resultInput = panel.querySelector("#quickOnbLinkResultInput");
      if (resultInput) resultInput.value = url;
      resultBox?.classList.remove("hidden");
      if (url && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url).catch(() => null);
      }
      showPortalToast("Link gerado e copiado! Envie para o novato preencher.", "success");
      await loadEmployeesOverviewSummary();
    } catch (err) {
      showPortalToast(err.message || "Não foi possível gerar o link.", "error");
    } finally {
      btn.disabled = false;
    }
  });

  panel.querySelectorAll("[data-sol-preview-emp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const empId = btn.getAttribute("data-sol-preview-emp");
      const code = btn.getAttribute("data-sol-preview-code");
      const emp = employees.find((x) => String(x.FuncionarioID) === String(empId));
      const docItem = emp?.DossieDocumentos?.[code];
      const files = normalizeDocItemFiles(docItem);
      if (files.length) openOnboardingFilePreview(docItem.titulo || code, files);
    });
  });

  panel.querySelectorAll("[data-sol-conferir-emp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const empId = btn.getAttribute("data-sol-conferir-emp");
      if (!empId) return;
      window.__PORTAL_OPEN_EMP_TAB__ = "emp-tab-funil";
      if (typeof window.editEmployee === "function") {
        window.editEmployee(empId);
      } else {
        openEmployee360Dossier(empId);
      }
    });
  });

  panel.querySelectorAll("[data-sol-ficha-emp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const empId = btn.getAttribute("data-sol-ficha-emp");
      if (!empId) return;
      window.__PORTAL_OPEN_EMP_TAB__ = "emp-tab-basico";
      if (typeof window.editEmployee === "function") {
        window.editEmployee(empId);
      }
    });
  });

  panel.querySelectorAll("[data-sol-copy-link]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.getAttribute("data-sol-copy-link");
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        showPortalToast("Link copiado para a área de transferência!", "success");
      } catch {
        window.prompt("Copie o link abaixo:", url);
      }
    });
  });

  panel.querySelectorAll("[data-sol-delete-emp]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const empId = btn.getAttribute("data-sol-delete-emp");
      const empName = btn.getAttribute("data-sol-delete-name") || "este convite";
      if (!empId) return;
      if (!window.confirm(`Deseja remover permanentemente "${empName}"?`)) return;
      btn.disabled = true;
      try {
        await runtime.invoke("deleteEmployee", [empId]);
        showPortalToast("Convite/rascunho removido!", "success");
        await loadEmployeesOverviewSummary();
      } catch (err) {
        showPortalToast(err.message || "Não foi possível excluir.", "error");
        btn.disabled = false;
      }
    });
  });
}

async function loadEmployeesOverviewSummary() {
  try {
    const storeId = window.__selectedPortalStoreId || "";
    const syncRes = await invokePortal("sincronizarConvitesOnboarding", {}).catch((err) => {
      console.warn("[onboarding] sync warning:", err);
      return { __syncError: err };
    });
    if (syncRes?.__syncError) {
      showPortalToast(`Aviso ao sincronizar pré-cadastros: ${syncRes.__syncError?.message || "falha de sincronização."}`, "warn");
    } else if (Number(syncRes?.data?.syncedCount || 0) > 0) {
      showPortalToast(`${syncRes.data.syncedCount} solicitação(ões) de pré-cadastro sincronizada(s) para conferência.`, "info");
    }
    const [employees, alertsRes] = await Promise.all([
      runtime.list("Funcionarios", { forceRefresh: true }).catch(() => runtime.list("Funcionarios").catch(() => [])),
      invokePortal("listarAlertasExperiencia", {}).catch(() => ({ data: [] })),
    ]);

    if (window.__GESTAO_STATE__) {
      window.__GESTAO_STATE__.employees = employees;
      if (typeof window.__GESTAO_RENDER_EMPLOYEES__ === "function") {
        window.__GESTAO_RENDER_EMPLOYEES__();
      }
    }

    await renderOnboardingSolicitationsPanel(employees);

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
      if (!isOnboardingOnlyPending(e) && e.Ativo !== false) ativos += 1;
      if (isOnboardingReadyForReview(e) || (!isOnboardingOnlyPending(e) && etapa >= 1 && etapa <= 4 && e.Ativo !== false)) onboarding += 1;
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

const PAYROLL_PENCIL_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;

const PAYROLL_EDITABLE_FIELDS = {
  SalarioBase: {
    title: "Salário Base",
    subtitle: "Valor base mensal considerado na folha (+ soma no líquido).",
    placeholderReason: "Ex: Ajuste salarial mensal",
  },
  ValorFichasHouseTx: {
    title: "Fichas House TX (-20%)",
    subtitle: "Consumo Takeat House Burguer TX já com desconto de 20% (- desconta do salário).",
    placeholderReason: "Ex: Conferência manual Takeat House TX",
  },
  ValorFichasFoodParkTx: {
    title: "Fichas FoodPark (-20%)",
    subtitle: "Consumo Takeat FoodPark TX já com desconto de 20% (- desconta do salário).",
    placeholderReason: "Ex: Conferência manual Takeat FoodPark",
  },
  TaxaServicoValor: {
    title: "10% Taxa de Serviço",
    subtitle: "Valor da taxa de serviço (10%) repassada ao colaborador (+ soma no líquido).",
    placeholderReason: "Ex: Apuração 10% taxa de serviço do período",
  },
  TotalValesAdiantamentos: {
    title: "Vales / Adiantamentos",
    subtitle: "Adiantamentos solicitados pelo app no período (- desconta do salário).",
    placeholderReason: "Ex: Ajuste manual de vale",
  },
  Faltas: {
    title: "Faltas / Atrasos",
    subtitle: "Quantidade de faltas e valor descontado preenchido pelo Financeiro/Admin (- desconta do salário).",
    placeholderReason: "Ex: Lançamento de falta sem justificativa",
  },
  QuebraDeCaixaValor: {
    title: "Quebra de Caixa",
    subtitle: "Diferença de fechamento de caixa preenchida pelo Financeiro (- desconta do salário).",
    placeholderReason: "Ex: Conferência de quebra de caixa",
  },
};

async function getPayrollTakeatSnapshot(forceRefresh = false) {
  const freshMs = 3 * 60 * 1000;
  if (
    !forceRefresh &&
    Array.isArray(payrollTakeatCache.items) &&
    Date.now() - payrollTakeatCache.loadedAt < freshMs
  ) {
    return {
      items: payrollTakeatCache.items,
      mappings: payrollTakeatCache.mappings || {},
    };
  }
  if (!forceRefresh && payrollTakeatCache.promise) {
    return payrollTakeatCache.promise;
  }

  payrollTakeatCache.promise = (async () => {
    try {
      const [creditRes, mappings] = await Promise.all([
        fetchAllTakeatCredit("all").catch(() => ({ items: [] })),
        loadTakeatMappings().catch(() => ({})),
      ]);
      payrollTakeatCache.items = Array.isArray(creditRes?.items) ? creditRes.items : [];
      payrollTakeatCache.mappings = mappings && typeof mappings === "object" ? mappings : {};
      payrollTakeatCache.loadedAt = Date.now();
    } catch {
      payrollTakeatCache.items = payrollTakeatCache.items || [];
      payrollTakeatCache.mappings = payrollTakeatCache.mappings || {};
    } finally {
      payrollTakeatCache.promise = null;
    }
    return {
      items: payrollTakeatCache.items,
      mappings: payrollTakeatCache.mappings,
    };
  })();

  return payrollTakeatCache.promise;
}

async function compressAttachmentFileToDataUrl(file, { maxPdfBytes = 1.8 * 1024 * 1024, label = "arquivo" } = {}) {
  if (!file) return "";
  const isImage = String(file.type || "").startsWith("image/");
  if (!isImage) {
    if (file.size > maxPdfBytes) {
      const mbLimit = (maxPdfBytes / (1024 * 1024)).toFixed(1).replace(".", ",");
      throw new Error(`O arquivo PDF do ${label} deve ter no máximo ${mbLimit} MB.`);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(`Falha ao ler arquivo do ${label}.`));
      reader.readAsDataURL(file);
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Falha ao ler imagem do ${label}.`));
    reader.onload = () => {
      const src = String(reader.result || "");
      const img = new Image();
      img.onerror = () => resolve(src);
      img.onload = () => {
        try {
          const maxDim = 1280;
          const ratio = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round((img.width || 800) * ratio));
          canvas.height = Math.max(1, Math.round((img.height || 800) * ratio));
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch {
          resolve(src);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

async function compressReceiptFileToDataUrl(file) {
  return compressAttachmentFileToDataUrl(file, { maxPdfBytes: 5.5 * 1024 * 1024, label: "comprovante" });
}

async function readAttachmentFileAsDataUrl(file) {
  return compressAttachmentFileToDataUrl(file, { maxPdfBytes: 5.5 * 1024 * 1024, label: "documento" });
}

function buildPayrollReportRowsHtml(linha) {
  const brutoHouse = Number(linha.ValorBrutoHouseTx || 0);
  const brutoFood = Number(linha.ValorBrutoFoodParkTx || 0);
  const taxaServ = Number(linha.TaxaServicoValor ?? linha.BonusValor ?? 0);
  return `
    <div class="folha-report-box">
      <div class="folha-report-row">
        <span>(+) Salário Base</span>
        <strong>${formatBRL(linha.SalarioBase)}</strong>
      </div>
      <div class="folha-report-row is-add">
        <span>(+) 10% Taxa de Serviço</span>
        <strong>+ ${formatBRL(taxaServ)}</strong>
      </div>
      <div class="folha-report-row is-deduct">
        <span>(-) Fichas House TX (-20%)${brutoHouse > 0 ? ` · Bruto ${formatBRL(brutoHouse)}` : ""}</span>
        <strong>- ${formatBRL(linha.ValorFichasHouseTx)}</strong>
      </div>
      <div class="folha-report-row is-deduct">
        <span>(-) Fichas FoodPark (-20%)${brutoFood > 0 ? ` · Bruto ${formatBRL(brutoFood)}` : ""}</span>
        <strong>- ${formatBRL(linha.ValorFichasFoodParkTx)}</strong>
      </div>
      <div class="folha-report-row is-deduct">
        <span>(-) Vales / Adiantamentos</span>
        <strong>- ${formatBRL(linha.TotalValesAdiantamentos)}</strong>
      </div>
      <div class="folha-report-row is-deduct">
        <span>(-) Faltas (${Number(linha.FaltasInjustificadas || 0)}x)</span>
        <strong>- ${formatBRL(linha.DescontoFaltasAtrasos)}</strong>
      </div>
      <div class="folha-report-row is-deduct">
        <span>(-) Quebra de Caixa</span>
        <strong>- ${formatBRL(linha.QuebraDeCaixaValor)}</strong>
      </div>
      <div class="folha-report-row is-total">
        <span>(=) Valor Líquido a Receber</span>
        <strong>${formatBRL(linha.ValorLiquido)}</strong>
      </div>
    </div>
  `;
}

function ensurePayrollCampoDialog() {
  let dlg = document.getElementById("folhaCampoDialog");
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.id = "folhaCampoDialog";
  dlg.className = "folha-dialog";
  dlg.innerHTML = `
    <form method="dialog" id="folhaCampoForm">
      <div class="folha-dialog-head">
        <div>
          <span class="eyebrow" style="margin-bottom:2px;">EDIÇÃO RÁPIDA DE FOLHA</span>
          <h3 id="folhaCampoTitle" style="margin:0; font-size:16px;">Editar Campo</h3>
          <p id="folhaCampoSubtitle" style="margin:4px 0 0; font-size:12px; color:var(--muted);"></p>
        </div>
        <button type="button" id="folhaCampoCloseBtn" class="btn btn-secondary btn-sm">Fechar</button>
      </div>
      <div class="folha-dialog-body">
        <div id="folhaCampoHint" style="display:none; font-size:12px; padding:9px 11px; border-radius:9px; background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe;"></div>
        <div id="folhaCampoFaltasQtyWrap" style="display:none;">
          <label style="display:grid; gap:6px; font-size:12.5px; font-weight:600;">
            Quantidade de Faltas (dias/ocorrências)
            <input id="folhaCampoFaltasQty" type="number" min="0" step="1" class="input" />
          </label>
        </div>
        <label style="display:grid; gap:6px; font-size:12.5px; font-weight:600;">
          <span id="folhaCampoValueLabel">Valor (R$)</span>
          <input id="folhaCampoValueInput" type="number" min="0" step="0.01" required class="input" />
        </label>
        <label style="display:grid; gap:6px; font-size:12.5px; font-weight:600;">
          Motivo / Justificativa (Auditoria)
          <input id="folhaCampoReasonInput" type="text" required class="input" placeholder="Ex: Conferência financeira" />
        </label>
      </div>
      <div class="folha-dialog-foot">
        <button type="button" id="folhaCampoCancelBtn" class="btn btn-secondary">Cancelar</button>
        <button type="submit" id="folhaCampoSaveBtn" class="btn btn-primary">Salvar Ajuste</button>
      </div>
    </form>
  `;
  document.body.appendChild(dlg);
  dlg.querySelector("#folhaCampoCloseBtn")?.addEventListener("click", () => dlg.close());
  dlg.querySelector("#folhaCampoCancelBtn")?.addEventListener("click", () => dlg.close());
  return dlg;
}

function openPayrollFieldEditDialog({ linha, fieldKey, competencia, quinzena, takeatSnapshot }) {
  const cfg = PAYROLL_EDITABLE_FIELDS[fieldKey];
  if (!cfg || !linha) return;
  const dlg = ensurePayrollCampoDialog();
  const form = dlg.querySelector("#folhaCampoForm");

  dlg.querySelector("#folhaCampoTitle").textContent = `${cfg.title} · ${linha.FuncionarioNome}`;
  dlg.querySelector("#folhaCampoSubtitle").textContent = cfg.subtitle;

  const hintEl = dlg.querySelector("#folhaCampoHint");
  const qtyWrap = dlg.querySelector("#folhaCampoFaltasQtyWrap");
  const qtyInput = dlg.querySelector("#folhaCampoFaltasQty");
  const valLabel = dlg.querySelector("#folhaCampoValueLabel");
  const valInput = dlg.querySelector("#folhaCampoValueInput");
  const reasonInput = dlg.querySelector("#folhaCampoReasonInput");

  qtyWrap.style.display = fieldKey === "Faltas" ? "block" : "none";
  hintEl.style.display = "none";

  if (fieldKey === "ValorFichasHouseTx" && Number(linha.ValorBrutoHouseTx || 0) > 0) {
    hintEl.style.display = "block";
    hintEl.textContent = `Takeat House TX Bruto: ${formatBRL(linha.ValorBrutoHouseTx)} · Com desconto de 20%: ${formatBRL(linha.ValorBrutoHouseTx * 0.8)}`;
  } else if (fieldKey === "ValorFichasFoodParkTx" && Number(linha.ValorBrutoFoodParkTx || 0) > 0) {
    hintEl.style.display = "block";
    hintEl.textContent = `Takeat FoodPark Bruto: ${formatBRL(linha.ValorBrutoFoodParkTx)} · Com desconto de 20%: ${formatBRL(linha.ValorBrutoFoodParkTx * 0.8)}`;
  }

  if (fieldKey === "Faltas") {
    valLabel.textContent = "Desconto Total de Faltas (R$)";
    qtyInput.value = String(Number(linha.FaltasInjustificadas || 0));
    valInput.value = Number(linha.DescontoFaltasAtrasos || 0).toFixed(2);
  } else {
    valLabel.textContent = `${cfg.title} (R$)`;
    valInput.value = Number(linha[fieldKey] || 0).toFixed(2);
  }

  reasonInput.value = "";
  reasonInput.placeholder = cfg.placeholderReason;

  const submitHandler = async (ev) => {
    ev.preventDefault();
    const saveBtn = dlg.querySelector("#folhaCampoSaveBtn");
    const justificativa = reasonInput.value.trim();
    if (!justificativa) {
      showPortalToast("Informe um motivo para salvar o ajuste.", "warning");
      return;
    }
    const reqPayload = {
      competencia,
      quinzena,
      FuncionarioID: linha.FuncionarioID,
      LojaID: linha.LojaID || "",
      justificativa,
      takeatItems: takeatSnapshot?.items || null,
      takeatMappings: takeatSnapshot?.mappings || null,
    };
    if (fieldKey === "Faltas") {
      reqPayload.FaltasInjustificadas = Math.max(0, Math.round(Number(qtyInput.value || 0)));
      reqPayload.DescontoFaltasAtrasos = Math.max(0, Number(valInput.value || 0));
    } else {
      reqPayload[fieldKey] = Math.max(0, Number(valInput.value || 0));
    }

    try {
      if (saveBtn) saveBtn.disabled = true;
      await invokePortal("editarLinhaFolhaManual", reqPayload);
      dlg.close();
      showPortalToast(`${cfg.title} atualizado com sucesso.`, "success");
      await loadPayrollClosingTable();
    } catch (err) {
      showPortalToast(err.message || "Erro ao salvar ajuste da folha.", "error");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  };

  form.onsubmit = submitHandler;
  if (typeof dlg.showModal === "function") dlg.showModal();
  setTimeout(() => valInput?.focus(), 60);
}

function ensurePayrollPagamentoDialog() {
  let dlg = document.getElementById("folhaPagamentoDialog");
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.id = "folhaPagamentoDialog";
  dlg.className = "folha-dialog";
  dlg.innerHTML = `
    <form method="dialog" id="folhaPagamentoForm">
      <div class="folha-dialog-head">
        <div>
          <span class="eyebrow" style="margin-bottom:2px;">RELATÓRIO &amp; PAGAMENTO DE FOLHA</span>
          <h3 id="folhaPagTitle" style="margin:0; font-size:17px;">Confirmar Pagamento</h3>
          <p id="folhaPagSubtitle" style="margin:4px 0 0; font-size:12px; color:var(--muted);"></p>
        </div>
        <button type="button" id="folhaPagCloseBtn" class="btn btn-secondary btn-sm">Fechar</button>
      </div>
      <div class="folha-dialog-body">
        <div id="folhaPagPixBox" class="folha-pix-banner">
          <div>
            <span style="display:block; font-size:10.5px; text-transform:uppercase; font-weight:700; color:#1d4ed8;">Chave PIX do Colaborador</span>
            <strong id="folhaPagPixValue">-</strong>
          </div>
          <button type="button" id="folhaPagCopyPixBtn" class="btn btn-secondary btn-sm">Copiar PIX</button>
        </div>

        <div>
          <div style="font-size:12px; font-weight:700; color:var(--muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.04em;">
            Demonstrativo Detalhado do Colaborador
          </div>
          <div id="folhaPagBreakdownWrap"></div>
        </div>

        <div class="folha-upload-box">
          <div>
            <strong style="display:block; font-size:13px;">Comprovante de Pagamento (Imagem ou PDF)</strong>
            <span style="font-size:11.5px; color:var(--muted);">Anexe o comprovante PIX/transferência. Será salvo no histórico e enviado ao colaborador.</span>
          </div>
          <input id="folhaPagFileInput" type="file" accept="image/*,.pdf" class="input" />
          <div id="folhaPagPreview" class="folha-upload-preview" style="display:none;"></div>
          <label style="display:grid; gap:4px; font-size:12px; font-weight:600;">
            Ou cole o link do comprovante (opcional se enviou arquivo acima)
            <input id="folhaPagUrlInput" type="url" class="input" placeholder="https://..." />
          </label>
        </div>

        <label style="display:grid; gap:6px; font-size:12.5px; font-weight:600;">
          Observação no Recibo (opcional)
          <input id="folhaPagObsInput" type="text" class="input" placeholder="Ex: Pago via PIX Santander" />
        </label>

        <label style="display:flex; align-items:flex-start; gap:8px; font-size:12.5px; cursor:pointer;">
          <input id="folhaPagNotifyCheck" type="checkbox" checked style="margin-top:3px;" />
          <span>Enviar demonstrativo com comprovante para o colaborador (Holerites &amp; Docs) e disparar aviso no WhatsApp, zerando a linha após salvar no histórico.</span>
        </label>
      </div>
      <div class="folha-dialog-foot">
        <button type="button" id="folhaPagCancelBtn" class="btn btn-secondary">Cancelar</button>
        <button type="submit" id="folhaPagConfirmBtn" class="btn btn-primary">Confirmar Pagamento e Enviar</button>
      </div>
    </form>
  `;
  document.body.appendChild(dlg);
  dlg.querySelector("#folhaPagCloseBtn")?.addEventListener("click", () => dlg.close());
  dlg.querySelector("#folhaPagCancelBtn")?.addEventListener("click", () => dlg.close());
  return dlg;
}

function openPayrollPayDialog({ linha, competencia, quinzena, takeatSnapshot }) {
  if (!linha) return;
  const dlg = ensurePayrollPagamentoDialog();
  const form = dlg.querySelector("#folhaPagamentoForm");

  let uploadedDriveUrl = "";
  let uploadedDriveFileId = "";
  let uploadedMimeType = "";
  let uploadedFileName = "";
  let pendingDataUrl = "";

  dlg.querySelector("#folhaPagTitle").textContent = `Pagar ${linha.FuncionarioNome}`;
  dlg.querySelector("#folhaPagSubtitle").textContent = `${linha.NomeLoja || linha.LojaID || "-"} · ${linha.Cargo || "Operação"} · Competência ${competencia}`;
  dlg.querySelector("#folhaPagPixValue").textContent = linha.ChavePix || "Não cadastrada";
  dlg.querySelector("#folhaPagBreakdownWrap").innerHTML = buildPayrollReportRowsHtml(linha);

  const fileInput = dlg.querySelector("#folhaPagFileInput");
  const urlInput = dlg.querySelector("#folhaPagUrlInput");
  const obsInput = dlg.querySelector("#folhaPagObsInput");
  const notifyCheck = dlg.querySelector("#folhaPagNotifyCheck");
  const previewEl = dlg.querySelector("#folhaPagPreview");
  const copyPixBtn = dlg.querySelector("#folhaPagCopyPixBtn");

  fileInput.value = "";
  urlInput.value = "";
  obsInput.value = "";
  notifyCheck.checked = true;
  previewEl.style.display = "none";
  previewEl.innerHTML = "";

  copyPixBtn.disabled = !linha.ChavePix;
  copyPixBtn.onclick = async () => {
    if (!linha.ChavePix) return;
    try {
      await navigator.clipboard.writeText(String(linha.ChavePix));
      showPortalToast("Chave PIX copiada!", "success");
    } catch {
      showPortalToast(`Chave PIX: ${linha.ChavePix}`, "info");
    }
  };

  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    uploadedDriveUrl = "";
    uploadedDriveFileId = "";
    uploadedMimeType = "";
    pendingDataUrl = "";
    if (!file) {
      uploadedFileName = "";
      previewEl.style.display = "none";
      previewEl.innerHTML = "";
      return;
    }
    try {
      uploadedFileName = file.name;
      pendingDataUrl = await compressReceiptFileToDataUrl(file);
      uploadedMimeType = inferMimeTypeFromDataUrl(pendingDataUrl, file.type || "application/pdf");
      previewEl.style.display = "block";
      previewEl.innerHTML = String(uploadedMimeType).startsWith("image/")
        ? `<img src="${pendingDataUrl}" alt="Prévia do comprovante" /><small style="display:block; margin-top:4px; color:var(--muted);">${escapeHtml(file.name)} · Enviando ao Google Drive...</small>`
        : `<div style="font-size:12.5px; font-weight:600; color:#4f46e5;">PDF selecionado: ${escapeHtml(file.name)} · Enviando ao Google Drive...</div>`;

      const driveRes = await uploadPrivateDocumentToDrive({
        dataUrl: pendingDataUrl,
        mimeType: uploadedMimeType,
        fileName: file.name,
        category: "comprovante_folha",
        employeeId: linha.FuncionarioID || "",
        storeId: linha.LojaID || "",
        monthKey: /^\d{4}-\d{2}/.test(String(competencia || "")) ? String(competencia).slice(0, 7) : "",
      });
      uploadedDriveUrl = driveRes.url;
      uploadedDriveFileId = driveRes.fileId;
      uploadedMimeType = driveRes.mimeType || uploadedMimeType;
      previewEl.innerHTML = String(uploadedMimeType).startsWith("image/")
        ? `<img src="${pendingDataUrl}" alt="Prévia do comprovante" /><small style="display:block; margin-top:4px; color:#047857;">${escapeHtml(file.name)} · Salvo no Google Drive</small>`
        : `<div style="font-size:12.5px; font-weight:600; color:#047857;">PDF salvo no Google Drive: ${escapeHtml(file.name)}</div>`;
    } catch (err) {
      uploadedDriveUrl = "";
      uploadedDriveFileId = "";
      pendingDataUrl = "";
      uploadedFileName = "";
      fileInput.value = "";
      previewEl.style.display = "none";
      previewEl.innerHTML = "";
      showPortalToast(err.message || "Falha ao enviar comprovante para o Google Drive.", "error");
    }
  };

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const confirmBtn = dlg.querySelector("#folhaPagConfirmBtn");
    let comprovanteUrl = uploadedDriveUrl || urlInput.value.trim();
    if (!comprovanteUrl && !pendingDataUrl) {
      showPortalToast("Anexe a imagem/PDF do comprovante ou informe o link.", "warning");
      return;
    }

    try {
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Processando...";
      }
      if (!uploadedDriveFileId && (pendingDataUrl || comprovanteUrl.startsWith("data:"))) {
        confirmBtn.textContent = "Salvando comprovante no Drive...";
        const driveRes = await uploadPrivateDocumentToDrive({
          dataUrl: pendingDataUrl || comprovanteUrl,
          mimeType: uploadedMimeType || "",
          fileName: uploadedFileName || "comprovante_folha",
          category: "comprovante_folha",
          employeeId: linha.FuncionarioID || "",
          storeId: linha.LojaID || "",
          monthKey: /^\d{4}-\d{2}/.test(String(competencia || "")) ? String(competencia).slice(0, 7) : "",
        });
        comprovanteUrl = driveRes.url;
        uploadedDriveFileId = driveRes.fileId;
        uploadedMimeType = driveRes.mimeType;
      }
      if (confirmBtn) confirmBtn.textContent = "Registrando pagamento...";
      const res = await invokePortal("pagarFolhaColaborador", {
        competencia,
        quinzena,
        FuncionarioID: linha.FuncionarioID,
        LojaID: linha.LojaID || "",
        comprovanteUrl,
        comprovanteDriveFileId: uploadedDriveFileId || parseDriveFileId(comprovanteUrl) || "",
        comprovanteMimeType: uploadedMimeType,
        comprovanteNome: uploadedFileName || "Comprovante de Pagamento",
        observacao: obsInput.value.trim(),
        enviarParaColaborador: Boolean(notifyCheck.checked),
        takeatItems: takeatSnapshot?.items || null,
        takeatMappings: takeatSnapshot?.mappings || null,
      });

      dlg.close();
      showPortalToast(res?.message || "Pagamento registrado no histórico!", "success");
      await Promise.allSettled([loadPayrollClosingTable(), loadPayrollHistoryTable()]);

      const wa = res?.data?.whatsapp;
      if (notifyCheck.checked && wa && !wa.deliveredViaGateway && wa.waUrl) {
        openPayrollReceiptModal(res.data.pagamento, { showWaFallbackBanner: true });
      }
    } catch (err) {
      showPortalToast(err.message || "Erro ao registrar pagamento.", "error");
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirmar Pagamento e Enviar";
      }
    }
  };

  if (typeof dlg.showModal === "function") dlg.showModal();
}

function ensurePayrollReceiptViewDialog() {
  let dlg = document.getElementById("folhaReciboViewDialog");
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.id = "folhaReciboViewDialog";
  dlg.className = "folha-dialog";
  dlg.innerHTML = `
    <div class="folha-dialog-head">
      <div>
        <span class="eyebrow" style="margin-bottom:2px;">HISTÓRICO DE PAGAMENTO</span>
        <h3 id="folhaReciboTitle" style="margin:0; font-size:17px;">Comprovante de Pagamento</h3>
        <p id="folhaReciboMeta" style="margin:4px 0 0; font-size:12px; color:var(--muted);"></p>
      </div>
      <button type="button" id="folhaReciboCloseBtn" class="btn btn-secondary btn-sm">Fechar</button>
    </div>
    <div id="folhaReciboBody" class="folha-dialog-body"></div>
    <div id="folhaReciboFoot" class="folha-dialog-foot"></div>
  `;
  document.body.appendChild(dlg);
  dlg.querySelector("#folhaReciboCloseBtn")?.addEventListener("click", () => dlg.close());
  return dlg;
}

async function openPayrollReceiptModal(payment, options = {}) {
  if (!payment) return;
  const dlg = ensurePayrollReceiptViewDialog();
  const when = String(payment.DataPagamento || "").replace("T", " ").slice(0, 16);
  dlg.querySelector("#folhaReciboTitle").textContent = `${payment.FuncionarioNome || "Colaborador"} · ${formatBRL(payment.ValorLiquido)}`;
  dlg.querySelector("#folhaReciboMeta").textContent = `Pago em ${when} por ${payment.PagoPor || "-"} · Competência ${payment.AnoMes || payment.Competencia || "-"}`;

  let compUrl = String(payment.ComprovanteURL || "").trim();
  const driveId = String(payment.ComprovanteDriveFileID || parseDriveFileId(compUrl) || "").trim();
  let mimeHint = String(payment.ComprovanteMimeType || "").toLowerCase();

  const waBanner = options.showWaFallbackBanner && payment.WhatsAppUrl
    ? `<div style="padding:10px 12px; border-radius:10px; background:#ecfdf5; border:1px solid #a7f3d0; font-size:12.5px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
         <span>O pagamento e o relatório já foram salvos. Clique ao lado para abrir a mensagem pronta no WhatsApp:</span>
         <a href="${escapeHtml(payment.WhatsAppUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" style="text-decoration:none;">Enviar WhatsApp ↗</a>
       </div>`
    : "";

  const bodyEl = dlg.querySelector("#folhaReciboBody");
  const renderBody = (resolvedUrl, resolvedMime, errorMsg = "") => {
    const isImg = resolvedUrl.startsWith("data:image/") || /^image\//i.test(resolvedMime) || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(resolvedUrl);
    const isPdf = resolvedUrl.startsWith("data:application/pdf") || resolvedMime === "application/pdf" || /\.pdf(\?|$)/i.test(resolvedUrl) || /\.pdf$/i.test(String(payment.ComprovanteNome || ""));
    const hrefPdf = isPdf && resolvedUrl.startsWith("data:") ? driveDataUrlToObjectUrl(resolvedUrl, "application/pdf") : resolvedUrl;
    const mediaHtml = errorMsg
      ? `<div style="padding:10px; border-radius:8px; background:#fef2f2; color:#991b1b; font-size:12.5px;">${escapeHtml(errorMsg)} ${compUrl ? `<a href="${escapeHtml(compUrl)}" target="_blank" rel="noopener noreferrer">Abrir no Drive ↗</a>` : ""}</div>`
      : !resolvedUrl
      ? `<p style="font-size:12.5px; color:var(--muted); margin:0;">Sem anexo de imagem/PDF neste pagamento.</p>`
      : isImg
      ? `<img src="${escapeHtml(resolvedUrl)}" alt="Comprovante de Pagamento" style="max-width:100%; max-height:320px; object-fit:contain; border-radius:10px; border:1px solid #cbd5e1;" />`
      : isPdf
      ? `<iframe src="${escapeHtml(hrefPdf)}" style="width:100%; height:340px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; margin-bottom:8px;"></iframe><a href="${escapeHtml(hrefPdf)}" download="${escapeHtml(payment.ComprovanteNome || "comprovante.pdf")}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="text-decoration:none;">Baixar Comprovante PDF</a>`
      : `<a href="${escapeHtml(resolvedUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="text-decoration:none;">Abrir Comprovante ↗</a>`;

    bodyEl.innerHTML = `
      ${waBanner}
      <pre style="margin:0; padding:12px 14px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0; font-family:inherit; font-size:12.5px; white-space:pre-wrap; line-height:1.45;">${escapeHtml(payment.RelatorioTexto || "")}</pre>
      <div>
        <span style="display:block; font-size:11.5px; font-weight:700; text-transform:uppercase; color:var(--muted); margin-bottom:6px;">Comprovante Anexado</span>
        ${mediaHtml}
      </div>
    `;
  };

  if (driveId && !compUrl.startsWith("data:")) {
    bodyEl.innerHTML = `
      ${waBanner}
      <pre style="margin:0; padding:12px 14px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0; font-family:inherit; font-size:12.5px; white-space:pre-wrap; line-height:1.45;">${escapeHtml(payment.RelatorioTexto || "")}</pre>
      <p style="font-size:12.5px; color:var(--muted); margin:6px 0 0;">Carregando comprovante do Google Drive...</p>
    `;
  } else {
    renderBody(compUrl, mimeHint);
  }

  dlg.querySelector("#folhaReciboFoot").innerHTML = `
    ${payment.WhatsAppUrl ? `<a href="${escapeHtml(payment.WhatsAppUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="text-decoration:none;">Abrir WhatsApp</a>` : ""}
    <button type="button" id="folhaReciboOkBtn" class="btn btn-primary">Fechar</button>
  `;
  dlg.querySelector("#folhaReciboOkBtn")?.addEventListener("click", () => dlg.close());

  if (typeof dlg.showModal === "function") dlg.showModal();

  if (driveId && !compUrl.startsWith("data:")) {
    try {
      const driveData = await readPrivateDriveFile(driveId);
      renderBody(driveData.dataUrl, driveData.mimeType || mimeHint);
    } catch (err) {
      renderBody("", mimeHint, err?.message || "Não foi possível carregar o comprovante do Drive.");
    }
  }
}

async function loadPayrollHistoryTable() {
  const tbody = document.getElementById("portalFolhaHistoricoBody");
  const countBadge = document.getElementById("folhaHistoricoCountBadge");
  if (!tbody) return;
  try {
    const competencia = document.getElementById("folhaCompetenciaInput")?.value || "";
    const storeId = document.getElementById("folhaStoreFilter")?.value || window.__selectedPortalStoreId || "";
    const res = await invokePortal("listarPagamentosFolha", { competencia, storeId });
    const rows = Array.isArray(res?.data) ? res.data : [];
    if (countBadge) countBadge.textContent = String(rows.length);

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--muted); padding:24px;">Nenhum pagamento registrado no histórico para os filtros selecionados.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((p) => {
        const when = String(p.DataPagamento || "").replace("T", " ").slice(0, 16);
        const fichasTotal = Number(p.ValorFichasHouseTx || 0) + Number(p.ValorFichasFoodParkTx || 0);
        const waStatus = p.WhatsAppEnviado
          ? `<span class="portal-pill portal-pill--green">WhatsApp OK</span>`
          : p.WhatsAppUrl
            ? `<a href="${escapeHtml(p.WhatsAppUrl)}" target="_blank" rel="noopener noreferrer" class="portal-pill portal-pill--blue" style="text-decoration:none;">Enviar WhatsApp ↗</a>`
            : `<span class="portal-pill portal-pill--amber">Sem Telefone</span>`;
        return `
          <tr>
            <td style="white-space:nowrap; font-variant-numeric:tabular-nums;">${escapeHtml(when)}</td>
            <td>
              <strong>${escapeHtml(p.FuncionarioNome || "-")}</strong>
              <small style="display:block; color:var(--muted);">${escapeHtml(p.NomeLoja || p.LojaID || "-")} · ${escapeHtml(p.AnoMes || p.Competencia || "-")}</small>
            </td>
            <td class="portal-num-col">${formatBRL(p.SalarioBase)} + ${formatBRL(p.TaxaServicoValor)}</td>
            <td class="portal-num-col" style="color:#dc2626;">- ${formatBRL(fichasTotal + Number(p.TotalValesAdiantamentos || 0) + Number(p.DescontoFaltasAtrasos || 0) + Number(p.QuebraDeCaixaValor || 0))}</td>
            <td class="portal-num-col" style="font-weight:700; color:#047857;">${formatBRL(p.ValorLiquido)}</td>
            <td>${waStatus}</td>
            <td>
              <button type="button" class="btn btn-secondary btn-sm" data-view-pag-id="${escapeHtml(p.PagamentoID)}">Relatório / Comprovante</button>
            </td>
          </tr>
        `;
      })
      .join("");

    tbody.querySelectorAll("[data-view-pag-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-view-pag-id");
        const found = rows.find((item) => String(item.PagamentoID) === String(id));
        if (found) openPayrollReceiptModal(found);
      });
    });
  } catch {
    // Silencioso para perfis sem permissão de gestão
  }
}

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
        <h2>Fechamento e Pagamento de Folha Salarial</h2>
        <p id="folhaAccessModeNotice" style="font-size:13px; color:var(--muted);">Salário Base + 10% Taxa de Serviço - Fichas Takeat (-20%) - Vales - Faltas - Quebra de Caixa.</p>
      </div>
      <div class="toolbar-actions">
        <button type="button" id="btnSincronizarTakeatFolha" class="btn btn-secondary">Sincronizar Takeat</button>
        <button type="button" id="btnExportarFolhaXlsx" class="btn btn-secondary">Exportar Excel</button>
        <button type="button" id="btnExportarFolhaPdf" class="btn btn-secondary">Exportar PDF</button>
        <button type="button" id="btnFecharFolhaMes" class="btn btn-primary permission-admin">Fechar Folha do Mês</button>
      </div>
    </div>

    <div class="portal-tabs-bar" role="tablist" aria-label="Abas da Folha Salarial">
      <button type="button" class="portal-tab-btn is-active" data-folha-tab="atual" aria-selected="true">Folha Atual</button>
      <button type="button" class="portal-tab-btn" data-folha-tab="historico" aria-selected="false">
        Histórico de Pagamentos <em id="folhaHistoricoCountBadge" style="margin-left:6px; font-style:normal; font-size:11px; padding:1px 7px; border-radius:999px; background:rgba(15,23,42,0.08);">0</em>
      </button>
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

    <div id="folhaAtualSection" style="display:grid; gap:18px;">
      <div id="folhaKpiGrid" class="metric-grid">
        <article class="panel metric-card">
          <span class="eyebrow">SALÁRIOS BASE</span>
          <strong id="folhaKpiSalarios" style="font-size:20px; font-variant-numeric:tabular-nums;">R$ 0,00</strong>
        </article>
        <article class="panel metric-card">
          <span class="eyebrow">FICHAS HOUSE TX (-20%)</span>
          <strong id="folhaKpiHouseTx" style="font-size:20px; font-variant-numeric:tabular-nums; color:#dc2626;">R$ 0,00</strong>
        </article>
        <article class="panel metric-card">
          <span class="eyebrow">FICHAS FOODPARK (-20%)</span>
          <strong id="folhaKpiFoodParkTx" style="font-size:20px; font-variant-numeric:tabular-nums; color:#dc2626;">R$ 0,00</strong>
        </article>
        <article class="panel metric-card">
          <span class="eyebrow">10% TAXA DE SERVIÇO</span>
          <strong id="folhaKpiTaxaServico" style="font-size:20px; font-variant-numeric:tabular-nums; color:#0284c7;">R$ 0,00</strong>
          <small id="folhaKpiDescontos" style="font-size:11px; color:var(--muted);">Descontos: R$ 0,00</small>
        </article>
        <article class="panel metric-card">
          <span class="eyebrow">LÍQUIDO TOTAL</span>
          <strong id="folhaKpiLiquido" style="font-size:22px; font-variant-numeric:tabular-nums; color:#16a34a;">R$ 0,00</strong>
        </article>
      </div>

      <div class="panel table-panel">
        <div class="table-wrap folha-table-wrap">
          <table class="folha-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th class="portal-num-col">Salário Base</th>
                <th class="portal-num-col">House TX (-20%)</th>
                <th class="portal-num-col">FoodPark (-20%)</th>
                <th class="portal-num-col">10% Taxa Serv.</th>
                <th class="portal-num-col">Vales</th>
                <th class="portal-num-col">Faltas</th>
                <th class="portal-num-col">Quebra Caixa</th>
                <th class="portal-num-col">Valor Líquido</th>
                <th class="permission-admin">Pagamento</th>
              </tr>
            </thead>
            <tbody id="portalFolhaSalarialBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="folhaHistoricoSection" style="display:none;">
      <div class="panel table-panel">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data Pagamento</th>
                <th>Colaborador / Competência</th>
                <th class="portal-num-col">Proventos (Base + 10%)</th>
                <th class="portal-num-col">Descontos Totais</th>
                <th class="portal-num-col">Líquido Pago</th>
                <th>WhatsApp</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="portalFolhaHistoricoBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  closingView.prepend(panel);

  const compEl = document.getElementById("folhaCompetenciaInput");
  if (compEl && !compEl.value) compEl.value = todayIso().slice(0, 7);

  panel.querySelectorAll("[data-folha-tab]").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      const target = tabBtn.getAttribute("data-folha-tab");
      panel.querySelectorAll("[data-folha-tab]").forEach((btn) => {
        const active = btn.getAttribute("data-folha-tab") === target;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });
      const atualSec = document.getElementById("folhaAtualSection");
      const histSec = document.getElementById("folhaHistoricoSection");
      if (atualSec) atualSec.style.display = target === "atual" ? "grid" : "none";
      if (histSec) histSec.style.display = target === "historico" ? "block" : "none";
      if (target === "historico") loadPayrollHistoryTable();
    });
  });

  const refreshBoth = () => {
    loadPayrollClosingTable();
    loadPayrollHistoryTable();
  };

  document.getElementById("btnAtualizarPreviaFolha")?.addEventListener("click", refreshBoth);
  document.getElementById("btnSincronizarTakeatFolha")?.addEventListener("click", async () => {
    const syncBtn = document.getElementById("btnSincronizarTakeatFolha");
    try {
      if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.textContent = "Sincronizando...";
      }
      await getPayrollTakeatSnapshot(true);
      await loadPayrollClosingTable();
      showPortalToast("Fichas Takeat (House TX e FoodPark -20%) atualizadas!", "success");
    } finally {
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.textContent = "Sincronizar Takeat";
      }
    }
  });

  compEl?.addEventListener("change", refreshBoth);
  document.getElementById("folhaQuinzenaSelect")?.addEventListener("change", () => loadPayrollClosingTable());
  document.getElementById("folhaStoreFilter")?.addEventListener("change", refreshBoth);
  document.getElementById("folhaStatusFilter")?.addEventListener("change", () => loadPayrollClosingTable());

  document.getElementById("btnFecharFolhaMes")?.addEventListener("click", async () => {
    const competencia = document.getElementById("folhaCompetenciaInput")?.value || todayIso().slice(0, 7);
    const quinzena = document.getElementById("folhaQuinzenaSelect")?.value || "mensal";
    const storeId = document.getElementById("folhaStoreFilter")?.value || "";
    try {
      const takeatSnapshot = await getPayrollTakeatSnapshot(false);
      const res = await invokePortal("fecharFolhaSalarialMes", {
        competencia,
        quinzena,
        storeId,
        takeatItems: takeatSnapshot.items,
        takeatMappings: takeatSnapshot.mappings,
      });
      showPortalToast(res.message || "Folha fechada e espelhos enviados para Holerites & Docs!", "success");
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
      const takeatSnapshot = await getPayrollTakeatSnapshot(false);
      const res = await invokePortal("exportarFolhaSalarial", {
        competencia,
        quinzena,
        storeId,
        formato,
        takeatItems: takeatSnapshot.items,
        takeatMappings: takeatSnapshot.mappings,
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

    const takeatSnapshot = await getPayrollTakeatSnapshot(false);

    const res = await invokePortal("gerarPreviaFolhaSalarial", {
      competencia,
      quinzena,
      storeId,
      status,
      takeatItems: takeatSnapshot.items,
      takeatMappings: takeatSnapshot.mappings,
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
    setKpi("folhaKpiTaxaServico", totais.totalTaxaServico);
    setKpi("folhaKpiLiquido", totais.totalLiquido);
    const descEl = document.getElementById("folhaKpiDescontos");
    if (descEl) descEl.textContent = `Descontos: ${formatBRL(totais.totalDescontos || 0)}`;

    const notice = document.getElementById("folhaAccessModeNotice");
    if (notice) {
      if (data.folhaCongelada) {
        notice.textContent = "FOLHA FECHADA: Valores congelados e espelhos enviados para Holerites & Docs.";
      } else if (data.somenteLeituraGerente) {
        notice.textContent = "Visualização de Gerente (somente leitura da unidade). Edição pelo lápis e pagamento restritos ao Financeiro/Administração.";
      } else {
        notice.textContent = "Clique no lápis em qualquer campo para ajustar e em Pagar para gerar o relatório, anexar o comprovante, notificar no WhatsApp e zerar para o próximo ciclo.";
      }
    }

    const fecharBtn = document.getElementById("btnFecharFolhaMes");
    if (fecharBtn) {
      fecharBtn.disabled = Boolean(data.folhaCongelada);
      fecharBtn.textContent = data.folhaCongelada ? "Folha Congelada" : "Fechar Folha do Mês";
    }

    if (!linhas.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--muted); padding:24px;">Nenhum colaborador ativo para os filtros selecionados.</td></tr>`;
      return;
    }

    const canEdit = Boolean(data.permissaoEdicao);
    const renderEditableCell = ({ empId, fieldKey, label, mainHtml, subText = "", color = "" }) => {
      const pencil = canEdit
        ? `<button type="button" class="folha-edit-pencil" data-edit-field="${fieldKey}" data-emp-id="${escapeHtml(empId)}" title="Editar ${escapeHtml(label)}" aria-label="Editar ${escapeHtml(label)}">${PAYROLL_PENCIL_SVG}</button>`
        : "";
      return `
        <td class="portal-num-col">
          <div class="folha-cell-edit">
            <div class="folha-cell-val" ${color ? `style="color:${color};"` : ""}>
              <span>${mainHtml}</span>
              ${subText ? `<span class="folha-cell-sub">${escapeHtml(subText)}</span>` : ""}
            </div>
            ${pencil}
          </div>
        </td>
      `;
    };

    tbody.innerHTML = linhas
      .map((l) => {
        const stLower = String(l.StatusLinha || "").toLowerCase();
        const isPaid = stLower.includes("pago");
        const stCls =
          isPaid || stLower.includes("fech")
            ? "portal-pill--green"
            : stLower.includes("confer")
              ? "portal-pill--blue"
              : "portal-pill--amber";
        const taxaServ = Number(l.TaxaServicoValor ?? l.BonusValor ?? 0);
        const houseSub = Number(l.ValorBrutoHouseTx || 0) > 0 ? `Bruto: ${formatBRL(l.ValorBrutoHouseTx)}` : "";
        const foodSub = Number(l.ValorBrutoFoodParkTx || 0) > 0 ? `Bruto: ${formatBRL(l.ValorBrutoFoodParkTx)}` : "";
        const faltasSub = `${Number(l.FaltasInjustificadas || 0)}x`;

        return `
        <tr>
          <td>
            <span class="folha-collab-name">${escapeHtml(l.FuncionarioNome)}</span>
            <span class="folha-collab-meta">${escapeHtml(l.NomeLoja || l.LojaID || "-")} · ${escapeHtml(l.Cargo || "Operação")}</span>
            <div class="folha-collab-badges">
              <span class="portal-pill ${stCls}" style="font-size:10.5px; padding:2px 7px;">${escapeHtml(l.StatusLinha || "Em Aberto")}</span>
              ${l.ChavePix ? `<span class="folha-pix-tag" title="PIX: ${escapeHtml(l.ChavePix)}">PIX: ${escapeHtml(l.ChavePix)}</span>` : ""}
              ${l.EditadoManualmente ? `<span class="portal-pill portal-pill--amber" style="font-size:10px; padding:2px 6px;">Ajustado</span>` : ""}
            </div>
          </td>
          ${renderEditableCell({
            empId: l.FuncionarioID,
            fieldKey: "SalarioBase",
            label: "Salário Base",
            mainHtml: formatBRL(l.SalarioBase),
          })}
          ${renderEditableCell({
            empId: l.FuncionarioID,
            fieldKey: "ValorFichasHouseTx",
            label: "Fichas House TX (-20%)",
            mainHtml: `- ${formatBRL(l.ValorFichasHouseTx)}`,
            subText: houseSub,
            color: Number(l.ValorFichasHouseTx || 0) > 0 ? "#dc2626" : "var(--muted)",
          })}
          ${renderEditableCell({
            empId: l.FuncionarioID,
            fieldKey: "ValorFichasFoodParkTx",
            label: "Fichas FoodPark (-20%)",
            mainHtml: `- ${formatBRL(l.ValorFichasFoodParkTx)}`,
            subText: foodSub,
            color: Number(l.ValorFichasFoodParkTx || 0) > 0 ? "#dc2626" : "var(--muted)",
          })}
          ${renderEditableCell({
            empId: l.FuncionarioID,
            fieldKey: "TaxaServicoValor",
            label: "10% Taxa de Serviço",
            mainHtml: `+ ${formatBRL(taxaServ)}`,
            color: taxaServ > 0 ? "#0284c7" : "var(--muted)",
          })}
          ${renderEditableCell({
            empId: l.FuncionarioID,
            fieldKey: "TotalValesAdiantamentos",
            label: "Vales",
            mainHtml: `- ${formatBRL(l.TotalValesAdiantamentos)}`,
            color: Number(l.TotalValesAdiantamentos || 0) > 0 ? "#dc2626" : "var(--muted)",
          })}
          ${renderEditableCell({
            empId: l.FuncionarioID,
            fieldKey: "Faltas",
            label: "Faltas",
            mainHtml: `- ${formatBRL(l.DescontoFaltasAtrasos)}`,
            subText: faltasSub,
            color: Number(l.DescontoFaltasAtrasos || 0) > 0 ? "#dc2626" : "var(--muted)",
          })}
          ${renderEditableCell({
            empId: l.FuncionarioID,
            fieldKey: "QuebraDeCaixaValor",
            label: "Quebra de Caixa",
            mainHtml: `- ${formatBRL(l.QuebraDeCaixaValor)}`,
            color: Number(l.QuebraDeCaixaValor || 0) > 0 ? "#dc2626" : "var(--muted)",
          })}
          <td class="portal-num-col" style="font-weight:800; font-size:13.5px; color:#047857;">
            ${formatBRL(l.ValorLiquido)}
          </td>
          <td class="permission-admin">
            ${
              canEdit
                ? `<div class="folha-row-actions">
                     <button type="button" class="btn btn-primary folha-pay-btn" data-pay-folha-emp="${escapeHtml(l.FuncionarioID)}">Pagar</button>
                     ${
                       isPaid
                         ? `<button type="button" class="btn btn-secondary folha-mini-btn" data-reset-folha-emp="${escapeHtml(l.FuncionarioID)}" title="Zerar linha para novo lançamento neste mês">Novo</button>`
                         : ""
                     }
                   </div>`
                : `<small style="color:var(--muted);">Somente leitura</small>`
            }
          </td>
        </tr>
      `;
      })
      .join("");

    tbody.querySelectorAll("[data-edit-field]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const empId = btn.getAttribute("data-emp-id");
        const fieldKey = btn.getAttribute("data-edit-field");
        const linha = linhas.find((item) => String(item.FuncionarioID) === String(empId));
        if (linha) {
          openPayrollFieldEditDialog({ linha, fieldKey, competencia, quinzena, takeatSnapshot });
        }
      });
    });

    tbody.querySelectorAll("[data-pay-folha-emp]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const empId = btn.getAttribute("data-pay-folha-emp");
        const linha = linhas.find((item) => String(item.FuncionarioID) === String(empId));
        if (linha) {
          openPayrollPayDialog({ linha, competencia, quinzena, takeatSnapshot });
        }
      });
    });

    tbody.querySelectorAll("[data-reset-folha-emp]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const empId = btn.getAttribute("data-reset-folha-emp");
        try {
          await invokePortal("zerarLinhaFolha", {
            competencia,
            quinzena,
            FuncionarioID: empId,
          });
          showPortalToast("Linha zerada para novo lançamento!", "success");
          await loadPayrollClosingTable();
        } catch (err) {
          showPortalToast(err.message || "Erro ao zerar linha.", "error");
        }
      });
    });

    loadPayrollHistoryTable();
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
    loadUnifiedPendingHrItems(),
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

// ============================================================================
// REORGANIZACAO UNIFICADA DE RH: HUBS, CENTRAL DE DEMANDAS E DOSSIE 360
// ============================================================================

const HR_HUB_GROUPS = [
  {
    id: "pessoas",
    tabs: [
      { view: "employees", label: "Equipe & Dossiê 360°", perm: "permission-manager" },
      { view: "documents", label: "Holerites & Docs", perm: "" },
      { view: "hour-balances", label: "Banco de Horas", perm: "permission-admin" },
    ],
  },
  {
    id: "jornada",
    tabs: [
      { view: "timeclock", label: "Ponto & Espelhos", perm: "" },
      { view: "live-team", label: "Equipe Agora", perm: "permission-manager" },
      { view: "shift-plan", label: "Escala", perm: "" },
      { view: "calendar", label: "Calendário", perm: "permission-manager" },
      { view: "timeoff", label: "Folgas", perm: "" },
    ],
  },
  {
    id: "financeiro",
    tabs: [
      { view: "monthly-closing", label: "Folha Salarial", perm: "permission-manager" },
      { view: "takeat-credit", label: "Contas a Prazo (Takeat)", perm: "" },
      { view: "fichas", label: "Valor de Ficha", perm: "permission-manager" },
      { view: "reports", label: "Relatórios", perm: "permission-manager" },
    ],
  },
  {
    id: "config",
    tabs: [
      { view: "stores", label: "Lojas", perm: "permission-manager" },
      { view: "holidays", label: "Feriados", perm: "permission-manager" },
      { view: "operations", label: "Regras", perm: "permission-manager" },
      { view: "access", label: "Acessos & Permissões", perm: "permission-admin" },
      { view: "whatsapp", label: "WhatsApp", perm: "permission-admin" },
      { view: "audit", label: "Auditoria", perm: "permission-admin" },
    ],
  },
];

function syncWorkspaceHubBars(activeViewOverride = "") {
  const isGestao = isGerenteProfile(runtime?.profile);
  const isAdm = isDiretoriaProfile(runtime?.profile);
  const currentActive =
    activeViewOverride ||
    document.querySelector(".view.active")?.id?.replace(/^view-/, "") ||
    "";

  document.querySelectorAll(".hr-hub-bar").forEach((bar) => {
    bar.style.display = isGestao ? "flex" : "none";
    bar.querySelectorAll(".hr-hub-tab").forEach((btn) => {
      const target = btn.getAttribute("data-view-target") || "";
      const perm = btn.getAttribute("data-hub-perm") || "";
      const visible =
        perm === "permission-admin"
          ? isAdm
          : perm === "permission-manager"
            ? isGestao
            : true;
      btn.style.display = visible ? "inline-flex" : "none";
      const isActive = target === currentActive;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  });
}

function mountWorkspaceHubBars() {
  for (const hub of HR_HUB_GROUPS) {
    for (const currentTab of hub.tabs) {
      const section = document.getElementById(`view-${currentTab.view}`);
      if (!section || section.querySelector(`.hr-hub-bar[data-hub="${hub.id}"]`)) continue;

      const bar = document.createElement("nav");
      bar.className = "hr-hub-bar";
      bar.setAttribute("data-hub", hub.id);
      bar.setAttribute("aria-label", `Navegação ${hub.id}`);
      bar.innerHTML = hub.tabs
        .map(
          (tab) => `
          <button type="button"
                  class="hr-hub-tab ${tab.view === currentTab.view ? "is-active" : ""}"
                  data-view-target="${escapeHtml(tab.view)}"
                  data-hub-perm="${escapeHtml(tab.perm || "")}"
                  aria-selected="${tab.view === currentTab.view ? "true" : "false"}">
            ${escapeHtml(tab.label)}
          </button>
        `,
        )
        .join("");

      section.prepend(bar);
    }
  }
  syncWorkspaceHubBars();
}

function enhanceUnifiedPendingCenter() {
  const view = document.getElementById("view-pending-center");
  if (!view) return;

  const summaryGrid = view.querySelector(".pending-summary-grid");
  if (summaryGrid && !document.getElementById("pendingAtestadoSummaryCard")) {
    const card = document.createElement("article");
    card.id = "pendingAtestadoSummaryCard";
    card.className = "pending-summary-card is-atestados permission-manager";
    card.innerHTML = `
      <span class="pending-summary-icon">+</span>
      <div>
        <strong id="pendingAtestadoMetric">0</strong><small>Atestados</small>
      </div>
    `;
    summaryGrid.appendChild(card);
  }

  const filterBar = view.querySelector(".pending-filter-bar");
  if (filterBar && !document.getElementById("pendingAtestadoFilterBtn")) {
    const btn = document.createElement("button");
    btn.id = "pendingAtestadoFilterBtn";
    btn.type = "button";
    btn.className = "pending-filter-btn permission-manager";
    btn.setAttribute("data-pending-filter", "atestados");
    btn.innerHTML = `Atestados <em id="pendingAtestadoFilterCount">0</em>`;
    filterBar.appendChild(btn);
  }

  const content = view.querySelector(".pending-center-content");
  if (content && !document.getElementById("pendingAtestadosCategory")) {
    const sec = document.createElement("section");
    sec.id = "pendingAtestadosCategory";
    sec.className = "pending-category permission-manager";
    sec.setAttribute("data-pending-category", "atestados");
    sec.innerHTML = `
      <div class="pending-category-head">
        <div class="pending-category-heading">
          <span class="pending-category-icon is-atestados">+</span>
          <div>
            <span class="eyebrow">SAÚDE &amp; ABONOS</span>
            <h3>Atestados Médicos Pendentes</h3>
            <p>Analise comprovantes, aprove para abonar faltas ou recuse em 1 clique.</p>
          </div>
        </div>
      </div>
      <div id="atestadosPendingCards" class="request-grid"></div>
    `;
    const onboardingSec = content.querySelector('[data-pending-category="onboarding"]');
    if (onboardingSec) {
      content.insertBefore(sec, onboardingSec);
    } else {
      content.appendChild(sec);
    }
  }

  const onboardingSec = content?.querySelector('[data-pending-category="onboarding"]');
  if (onboardingSec && !document.getElementById("onboardingPendingCards")) {
    const grid = document.createElement("div");
    grid.id = "onboardingPendingCards";
    grid.className = "request-grid permission-manager";
    grid.style.marginBottom = "12px";
    const head = onboardingSec.querySelector(".pending-category-head");
    if (head?.nextSibling) {
      onboardingSec.insertBefore(grid, head.nextSibling);
    } else {
      onboardingSec.appendChild(grid);
    }
  }
}

async function loadUnifiedPendingHrItems() {
  if (!runtime?.auth?.currentUser) return;
  const profile = runtime?.profile || {};
  const isManagerUser = isGerenteProfile(profile);
  const myEmpId = String(profile.FuncionarioID || "");
  const storeId = window.__selectedPortalStoreId || (!isDiretoriaProfile(profile) ? String(profile.LojaID || "") : "");

  const atestadosContainer = document.getElementById("atestadosPendingCards");
  const onboardingContainer = document.getElementById("onboardingPendingCards");
  if (!atestadosContainer && !onboardingContainer) return;

  try {
    if (isManagerUser) {
      await invokePortal("sincronizarConvitesOnboarding", {}).catch(() => null);
    }
    const [justificativas, docs, employees, alertsRes] = await Promise.all([
      runtime.list("JustificativasPonto").catch(() => []),
      runtime.list("Documentos").catch(() => []),
      runtime.list("Funcionarios", { forceRefresh: true }).catch(() => runtime.list("Funcionarios").catch(() => [])),
      isManagerUser ? invokePortal("listarAlertasExperiencia", {}).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ]);

    const pendingJust = justificativas.filter((j) => {
      const isMed = String(j.Tipo || "").toLowerCase().includes("atestado");
      const st = String(j.Status || "").toLowerCase();
      if (!isMed || st !== "pendente") return false;
      if (!isManagerUser && String(j.FuncionarioID || "") !== myEmpId) return false;
      if (storeId && String(j.LojaID || "") !== String(storeId)) return false;
      return true;
    });

    const pendingDocs = docs.filter((d) => {
      const isMed =
        String(d.Tipo || "").toLowerCase().includes("atestado") ||
        String(d.Titulo || "").toLowerCase().includes("atestado");
      const st = String(d.Status || "").toLowerCase();
      const isPending = st.includes("pend") || st.includes("aguard");
      if (!isMed || !isPending) return false;
      if (!isManagerUser && String(d.FuncionarioID || "") !== myEmpId) return false;
      if (storeId && String(d.LojaID || "") !== String(storeId)) return false;
      return true;
    });

    const mergedAtestados = [
      ...pendingDocs.map((d) => ({
        source: "doc",
        id: d.DocumentoID || d.DocID,
        folgaId: d.FolgaID || "",
        empId: d.FuncionarioID,
        empName: d.NomeFuncionario || d.FuncionarioNome || "Colaborador",
        loja: d.NomeLoja || d.LojaID || "-",
        periodo: d.PeriodoAbono || d.DataInicio || "-",
        dias: d.DiasAbono || 1,
        motivo: d.Observacao || d.CRM || d.Titulo || "Atestado Médico",
        url: d.ArquivoUrl || d.ArquivoURL || d.ArquivoOriginalBase64 || "",
      })),
      ...pendingJust.map((j) => ({
        source: "just",
        id: j.JustificativaPontoID,
        folgaId: "",
        empId: j.FuncionarioID,
        empName: j.FuncionarioNome || "Colaborador",
        loja: j.NomeLoja || j.LojaID || "-",
        periodo: j.DataInicio && j.DataFim ? `${j.DataInicio} a ${j.DataFim}` : j.DataOcorrencia || "-",
        dias: j.DiasAfastamento || 1,
        motivo: j.Motivo || "Atestado Médico",
        url: j.ArquivoURL || j.ArquivoUrl || "",
      })),
    ];

    window.__portalAtestadosPendingCount = mergedAtestados.length;
    if (typeof window.syncPendingCenterSummary === "function") {
      window.syncPendingCenterSummary();
    }

    if (atestadosContainer) {
      if (!mergedAtestados.length) {
        atestadosContainer.innerHTML = `<div class="empty-state" style="padding:14px;">Nenhum atestado médico pendente de avaliação.</div>`;
      } else {
        atestadosContainer.innerHTML = mergedAtestados
          .map(
            (a) => `
            <article class="panel" style="padding:14px; display:grid; gap:10px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <div>
                  <strong style="font-size:14px;">${escapeHtml(a.empName)}</strong>
                  <small style="display:block; color:var(--muted);">${escapeHtml(a.loja)} · Período: ${escapeHtml(a.periodo)} (${escapeHtml(String(a.dias))} dia(s))</small>
                </div>
                <span class="portal-pill portal-pill--amber">Pendente</span>
              </div>
              <p style="margin:0; font-size:12.5px; color:var(--ink-2, #475569);">${escapeHtml(a.motivo)}</p>
              <div style="display:flex; flex-wrap:wrap; gap:8px;">
                ${
                  a.source === "doc" || a.url
                    ? `<button type="button" class="btn btn-secondary btn-sm" data-view-atestado-src="${a.source}" data-atestado-id="${escapeHtml(a.id)}" data-atestado-url="${escapeHtml(a.url)}">Ver Anexo</button>`
                    : ""
                }
                ${
                  isManagerUser
                    ? `<button type="button" class="btn btn-primary btn-sm" data-approve-atestado-src="${a.source}" data-atestado-id="${escapeHtml(a.id)}" data-folga-id="${escapeHtml(a.folgaId)}">Aprovar &amp; Abonar</button>
                       <button type="button" class="btn btn-secondary btn-sm" data-reject-atestado-src="${a.source}" data-atestado-id="${escapeHtml(a.id)}" data-folga-id="${escapeHtml(a.folgaId)}">Recusar</button>`
                    : ""
                }
              </div>
            </article>
          `,
          )
          .join("");

        atestadosContainer.querySelectorAll("[data-view-atestado-src]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const src = btn.getAttribute("data-view-atestado-src");
            const id = btn.getAttribute("data-atestado-id");
            const url = btn.getAttribute("data-atestado-url");
            if (src === "doc" && typeof window.openPreviewDialog === "function") {
              window.openPreviewDialog(id);
            } else if (url && (parseDriveFileId(url) || url.startsWith("data:"))) {
              openOnboardingFilePreview("Comprovante / Atestado", [
                {
                  arquivoUrl: url,
                  driveFileId: parseDriveFileId(url) || "",
                  nomeArquivo: "Comprovante Anexo",
                },
              ]);
            } else if (url) {
              window.open(url, "_blank", "noopener,noreferrer");
            }
          });
        });

        atestadosContainer.querySelectorAll("[data-approve-atestado-src]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const src = btn.getAttribute("data-approve-atestado-src");
            const id = btn.getAttribute("data-atestado-id");
            const folgaId = btn.getAttribute("data-folga-id");
            try {
              btn.disabled = true;
              if (src === "just") {
                await invokePortal("validarAtestadoMedico", { JustificativaPontoID: id, aprovar: true });
              } else if (folgaId) {
                await runtime.invoke("approveTimeOff", [folgaId, "Atestado aprovado na Central de Demandas"]);
              } else {
                await runtime.update("Documentos", id, { Status: "Aprovado" });
              }
              showPortalToast("Atestado aprovado e faltas abonadas!", "success");
              await loadUnifiedPendingHrItems();
            } catch (err) {
              showPortalToast(err.message || "Erro ao aprovar atestado.", "error");
              btn.disabled = false;
            }
          });
        });

        atestadosContainer.querySelectorAll("[data-reject-atestado-src]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const motivo = window.prompt("Informe o motivo da recusa do atestado:", "Atestado ilegível ou inválido");
            if (motivo === null) return;
            const src = btn.getAttribute("data-reject-atestado-src");
            const id = btn.getAttribute("data-atestado-id");
            const folgaId = btn.getAttribute("data-folga-id");
            try {
              btn.disabled = true;
              if (src === "just") {
                await invokePortal("validarAtestadoMedico", { JustificativaPontoID: id, aprovar: false, observacao: motivo });
              } else if (folgaId) {
                await runtime.invoke("rejectTimeOff", [folgaId, motivo]);
              } else {
                await runtime.update("Documentos", id, { Status: "Rejeitado", MotivoRecusa: motivo });
              }
              showPortalToast("Atestado recusado.", "info");
              await loadUnifiedPendingHrItems();
            } catch (err) {
              showPortalToast(err.message || "Erro ao recusar atestado.", "error");
              btn.disabled = false;
            }
          });
        });
      }
    }

    if (onboardingContainer && isManagerUser) {
      const awaitingReview = employees.filter((e) => {
        if (storeId && String(e.LojaID || "") !== String(storeId)) return false;
        return isOnboardingReadyForReview(e);
      });
      window.__portalOnboardingPendingCount = awaitingReview.length;
      if (typeof window.syncPendingCenterSummary === "function") {
        window.syncPendingCenterSummary();
      }
      const inOnboarding = employees.filter((e) => {
        if (storeId && String(e.LojaID || "") !== String(storeId)) return false;
        if (awaitingReview.some((r) => String(r.FuncionarioID) === String(e.FuncionarioID))) return false;
        if (isOnboardingOnlyPending(e) || e.Ativo === false) return false;
        return Number(e.EtapaAdmissao || 1) < 5;
      });
      const alerts = Array.isArray(alertsRes?.data)
        ? alertsRes.data.filter((a) => (!storeId || String(a.LojaID || "") === String(storeId)) && Number(a.DiasRestantes ?? 99) <= 15)
        : [];

      const onboardingCards = [
        ...awaitingReview.map((e) => ({
          empId: e.FuncionarioID,
          nome: e.Nome || "Novo Colaborador",
          loja: e.NomeLoja || e.LojaID || "-",
          tag: "Aguardando Conferência",
          pillCls: "portal-pill--amber",
          desc: "Preencheu ficha e documentos pelo link · Pronto para liberar acesso",
          reviewReady: true,
        })),
        ...alerts.map((a) => ({
          empId: a.FuncionarioID,
          nome: a.Nome || "Colaborador",
          loja: a.NomeLoja || a.LojaID || "-",
          tag: `Experiência ${a.Marco || ""}d`,
          pillCls: Number(a.DiasRestantes ?? 99) <= 5 ? "portal-pill--red" : "portal-pill--amber",
          desc: `Vence em ${a.DiasRestantes} dia(s) (${a.DataVencimento || "-"})`,
        })),
        ...inOnboarding.slice(0, 8).map((e) => {
          const etapa = Number(e.EtapaAdmissao || 1);
          const stageObj = ONBOARDING_STAGES.find((s) => s.etapa === etapa);
          return {
            empId: e.FuncionarioID,
            nome: e.Nome || "Colaborador",
            loja: e.NomeLoja || e.LojaID || "-",
            tag: `Etapa ${etapa}/6`,
            pillCls: "portal-pill--blue",
            desc: stageObj?.titulo || "Integração em andamento",
          };
        }),
      ];

      onboardingContainer.innerHTML = onboardingCards.length
        ? onboardingCards
            .map(
              (c) => `
              <article class="panel" style="padding:12px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                <div>
                  <strong style="font-size:13.5px;">${escapeHtml(c.nome)}</strong>
                  <small style="display:block; color:var(--muted);">${escapeHtml(c.loja)} · ${escapeHtml(c.desc)}</small>
                </div>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span class="portal-pill ${c.pillCls}">${escapeHtml(c.tag)}</span>
                  ${
                    c.reviewReady
                      ? `<button type="button" class="btn btn-primary btn-sm" data-conferir-onb-emp="${escapeHtml(c.empId)}">Conferir &amp; Liberar</button>`
                      : ""
                  }
                  <button type="button" class="btn btn-secondary btn-sm" data-open-dossier-emp="${escapeHtml(c.empId)}">Abrir Dossiê</button>
                </div>
              </article>
            `,
            )
            .join("")
        : `<div class="empty-state" style="padding:14px;">Toda a equipe está com onboarding concluído e sem vencimentos próximos.</div>`;

      onboardingContainer.querySelectorAll("[data-conferir-onb-emp]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const empId = btn.getAttribute("data-conferir-onb-emp");
          if (!empId) return;
          window.__PORTAL_OPEN_EMP_TAB__ = "emp-tab-funil";
          if (typeof window.editEmployee === "function") {
            window.editEmployee(empId);
          } else {
            openEmployee360Dossier(empId);
          }
        });
      });
    }
  } catch {
    // Silencioso
  }
}

function ensureEmployee360Dialog() {
  let dlg = document.getElementById("employee360Dialog");
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.id = "employee360Dialog";
  dlg.className = "folha-dialog emp360-dialog";
  dlg.innerHTML = `
    <div class="folha-dialog-head">
      <div>
        <span class="eyebrow" style="margin-bottom:2px;">DOSSIÊ 360° DO COLABORADOR</span>
        <h3 id="emp360Title" style="margin:0; font-size:18px;">Carregando...</h3>
        <p id="emp360Sub" style="margin:3px 0 0; font-size:12px; color:var(--muted);"></p>
      </div>
      <button type="button" id="emp360CloseBtn" class="btn btn-secondary btn-sm">Fechar</button>
    </div>
    <div class="folha-dialog-body" id="emp360Body"></div>
  `;
  document.body.appendChild(dlg);
  dlg.querySelector("#emp360CloseBtn")?.addEventListener("click", () => dlg.close());
  return dlg;
}

async function openEmployee360Dossier(employeeId) {
  if (!employeeId) return;
  const dlg = ensureEmployee360Dialog();
  const bodyEl = dlg.querySelector("#emp360Body");
  const titleEl = dlg.querySelector("#emp360Title");
  const subEl = dlg.querySelector("#emp360Sub");

  titleEl.textContent = "Dossiê 360°";
  subEl.textContent = "Consolidando cadastro, documentos, Takeat, vales e pagamentos...";
  bodyEl.innerHTML = `<div style="padding:24px; text-align:center; color:var(--muted);">Carregando ficha completa...</div>`;
  if (typeof dlg.showModal === "function") dlg.showModal();

  try {
    const isAdm = isDiretoriaProfile(runtime?.profile);
    const [emp, docs, justs, vales, pagsRes, takeatSnap, auditRes] = await Promise.all([
      runtime.getById("Funcionarios", employeeId).catch(() => null),
      runtime.list("Documentos").catch(() => []),
      runtime.list("JustificativasPonto").catch(() => []),
      runtime.list("SolicitacoesVale").catch(() => []),
      invokePortal("listarPagamentosFolha", { employeeId }).catch(() => ({ data: [] })),
      getPayrollTakeatSnapshot(false),
      isAdm ? invokePortal("getEmployeeAuditHistory", { employeeId }).catch(() => ({ data: { logs: [] } })) : Promise.resolve({ data: { logs: [] } }),
    ]);

    if (!emp) {
      bodyEl.innerHTML = `<div class="empty-state">Colaborador não encontrado.</div>`;
      return;
    }

    const empName = emp.Nome || "Colaborador";
    const initials = empName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() || "")
      .join("");
    titleEl.textContent = empName;
    subEl.textContent = `${emp.NomeLoja || emp.LojaID || "-"} · ${emp.Cargo || "Operação"} · ${emp.Perfil || "Funcionário"}`;

    const empDocs = docs
      .filter((d) => String(d.FuncionarioID || "") === String(employeeId))
      .sort((a, b) => String(b.DataCriacao || "").localeCompare(String(a.DataCriacao || "")));
    const empJusts = justs.filter((j) => String(j.FuncionarioID || "") === String(employeeId));
    const empVales = vales
      .filter((v) => String(v.FuncionarioID || "") === String(employeeId))
      .sort((a, b) => String(b.DataCriacao || b.DataDesejada || "").localeCompare(String(a.DataCriacao || a.DataDesejada || "")));
    const empPags = Array.isArray(pagsRes?.data) ? pagsRes.data : [];
    const empAudits = Array.isArray(auditRes?.data?.logs) ? auditRes.data.logs : [];

    let takeatHouseBruto = 0;
    let takeatFoodBruto = 0;
    for (const tk of takeatSnap?.items || []) {
      const matched = resolveTakeatAccountMatch(tk, [emp], takeatSnap?.mappings || {});
      if (matched && String(matched.FuncionarioID) === String(employeeId)) {
        const debt = Number(tk.debt || 0);
        if (tk.storeKey === "teixeira") takeatHouseBruto += debt;
        if (tk.storeKey === "foodpark") takeatFoodBruto += debt;
      }
    }

    const etapaAtual = Number(emp.EtapaAdmissao || 1);
    const stageInfo = ONBOARDING_STAGES.find((s) => s.etapa === etapaAtual) || { titulo: `Etapa ${etapaAtual}` };

    bodyEl.innerHTML = `
      <div class="emp360-hero">
        <div style="display:flex; align-items:center; gap:12px;">
          <span class="emp360-avatar">${escapeHtml(initials || "?")}</span>
          <div>
            <strong style="display:block; font-size:15.5px;">${escapeHtml(empName)}</strong>
            <span style="font-size:12px; color:var(--muted);">${escapeHtml(emp.Email || "-")} · WhatsApp: ${escapeHtml(emp.WhatsApp || emp.Telefone || "-")}</span>
          </div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          <button type="button" id="emp360EditBtn" class="btn btn-secondary btn-sm">Editar Cadastro</button>
          <button type="button" id="emp360KitBtn" class="btn btn-secondary btn-sm">Kit Admissional</button>
          ${isGestaoButtonOrFolha(emp, isAdm)}
        </div>
      </div>

      <div class="portal-tabs-bar" role="tablist" style="margin-bottom:0;">
        <button type="button" class="portal-tab-btn is-active" data-emp360-tab="geral">Visão Geral</button>
        <button type="button" class="portal-tab-btn" data-emp360-tab="docs">Docs &amp; Atestados (${empDocs.length + empJusts.length})</button>
        <button type="button" class="portal-tab-btn" data-emp360-tab="financeiro">Financeiro &amp; Folha (${empPags.length})</button>
        ${isAdm ? `<button type="button" class="portal-tab-btn" data-emp360-tab="auditoria">Auditoria (${empAudits.length})</button>` : ""}
      </div>

      <div data-emp360-panel="geral" class="emp360-grid">
        <div class="emp360-kv"><span>CPF</span><strong>${escapeHtml(emp.CPF || "-")}</strong></div>
        <div class="emp360-kv"><span>Admissão</span><strong>${escapeHtml(emp.DataAdmissao || "-")}</strong></div>
        <div class="emp360-kv"><span>Etapa Onboarding</span><strong>Etapa ${etapaAtual}/6 · ${escapeHtml(stageInfo.titulo)}</strong></div>
        <div class="emp360-kv"><span>Salário Base</span><strong>${formatBRL(emp.SalarioBase || 0)}</strong></div>
        <div class="emp360-kv"><span>Chave PIX</span><strong>${escapeHtml(emp.ChavePix || "Não cadastrada")}</strong></div>
        <div class="emp360-kv"><span>Saldo de Folgas</span><strong>${escapeHtml(String(emp.SaldoFolgas ?? 0))}</strong></div>
        <div class="emp360-kv"><span>Folga Fixa</span><strong>${escapeHtml(emp.DiaFolgaPreferencial || "-")}</strong></div>
        <div class="emp360-kv"><span>Situação</span><strong>${emp.Ativo === false ? "Inativo" : "Ativo"}</strong></div>
      </div>

      <div data-emp360-panel="docs" class="emp360-list" style="display:none;">
        ${
          empDocs.length + empJusts.length === 0
            ? `<div class="empty-state">Nenhum documento ou atestado registrado.</div>`
            : [
                ...empDocs.map(
                  (d) => `
                  <div class="emp360-row-card">
                    <div>
                      <strong>${escapeHtml(d.Titulo || d.Tipo || "Documento")}</strong>
                      <small style="display:block; color:var(--muted);">${escapeHtml(d.Categoria || d.Tipo || "-")} · Status: ${escapeHtml(d.Status || d.StatusAssinatura || "-")}</small>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" data-emp360-open-doc="${escapeHtml(d.DocumentoID || d.DocID)}">Visualizar</button>
                  </div>
                `,
                ),
                ...empJusts.map(
                  (j) => `
                  <div class="emp360-row-card">
                    <div>
                      <strong>${escapeHtml(j.Tipo || "Justificativa")} · ${escapeHtml(j.DataInicio || j.DataOcorrencia || "-")}</strong>
                      <small style="display:block; color:var(--muted);">${escapeHtml(j.Motivo || "-")} · Status: ${escapeHtml(j.Status || "-")}</small>
                    </div>
                    ${
                      j.ArquivoURL
                        ? `<a href="${escapeHtml(j.ArquivoURL)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="text-decoration:none;">Abrir Anexo ↗</a>`
                        : ""
                    }
                  </div>
                `,
                ),
              ].join("")
        }
      </div>

      <div data-emp360-panel="financeiro" class="emp360-list" style="display:none;">
        <div class="emp360-grid">
          <div class="emp360-kv">
            <span>Takeat House TX (-20%)</span>
            <strong style="color:#dc2626;">- ${formatBRL(takeatHouseBruto * 0.8)}</strong>
            <small style="color:var(--muted); font-size:11px;">Bruto: ${formatBRL(takeatHouseBruto)}</small>
          </div>
          <div class="emp360-kv">
            <span>Takeat FoodPark (-20%)</span>
            <strong style="color:#dc2626;">- ${formatBRL(takeatFoodBruto * 0.8)}</strong>
            <small style="color:var(--muted); font-size:11px;">Bruto: ${formatBRL(takeatFoodBruto)}</small>
          </div>
          <div class="emp360-kv">
            <span>Vales no Sistema</span>
            <strong>${empVales.length} pedido(s)</strong>
            <small style="color:var(--muted); font-size:11px;">Último: ${empVales[0] ? formatBRL(empVales[0].Valor || 0) : "-"}</small>
          </div>
        </div>
        <div style="font-size:11.5px; font-weight:700; text-transform:uppercase; color:var(--muted); margin-top:4px;">Histórico de Pagamentos na Folha</div>
        ${
          empPags.length === 0
            ? `<div class="empty-state">Nenhum pagamento de folha registrado ainda.</div>`
            : empPags
                .map(
                  (p) => `
                  <div class="emp360-row-card">
                    <div>
                      <strong>Competência ${escapeHtml(p.AnoMes || p.Competencia || "-")} · ${formatBRL(p.ValorLiquido)}</strong>
                      <small style="display:block; color:var(--muted);">Pago em ${escapeHtml(String(p.DataPagamento || "").replace("T", " ").slice(0, 16))} por ${escapeHtml(p.PagoPor || "-")}</small>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" data-emp360-open-pag="${escapeHtml(p.PagamentoID)}">Ver Relatório / Comprovante</button>
                  </div>
                `,
                )
                .join("")
        }
      </div>

      ${
        isAdm
          ? `<div data-emp360-panel="auditoria" class="emp360-list" style="display:none;">
              ${
                empAudits.length === 0
                  ? `<div class="empty-state">Sem alterações auditadas para este colaborador.</div>`
                  : empAudits
                      .slice(0, 20)
                      .map(
                        (l) => `
                        <div class="emp360-row-card">
                          <div>
                            <strong>${escapeHtml(l.Acao || "-")} · ${escapeHtml(String(l.Quando || "").replace("T", " ").slice(0, 16))}</strong>
                            <small style="display:block; color:var(--muted);">${escapeHtml(l.ResumoAlteracao || l.Mensagem || "-")} (por ${escapeHtml(l.QuemNome || "-")})</small>
                          </div>
                        </div>
                      `,
                      )
                      .join("")
              }
            </div>`
          : ""
      }
    `;

    function isGestaoButtonOrFolha() {
      return isAdm
        ? `<button type="button" id="emp360FolhaBtn" class="btn btn-primary btn-sm">Ir para Folha</button>`
        : "";
    }

    bodyEl.querySelectorAll("[data-emp360-tab]").forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        const target = tabBtn.getAttribute("data-emp360-tab");
        bodyEl.querySelectorAll("[data-emp360-tab]").forEach((b) => {
          b.classList.toggle("is-active", b.getAttribute("data-emp360-tab") === target);
        });
        bodyEl.querySelectorAll("[data-emp360-panel]").forEach((p) => {
          p.style.display = p.getAttribute("data-emp360-panel") === target ? (target === "geral" ? "grid" : "grid") : "none";
        });
      });
    });

    bodyEl.querySelector("#emp360EditBtn")?.addEventListener("click", () => {
      dlg.close();
      if (typeof window.editEmployee === "function") {
        window.editEmployee(employeeId);
      } else {
        const rowEdit = document.querySelector(`#employeeBody [data-action="edit-employee"][data-id="${employeeId}"]`);
        if (rowEdit) rowEdit.click();
      }
    });

    bodyEl.querySelector("#emp360KitBtn")?.addEventListener("click", async () => {
      try {
        const res = await invokePortal("gerarKitAdmissionalPdf", { FuncionarioID: employeeId });
        if (res?.data?.dataUrl) {
          const a = document.createElement("a");
          a.href = res.data.dataUrl;
          a.download = res.data.fileName || "kit-admissional.txt";
          a.click();
        }
        showPortalToast(res?.message || "Kit Admissional gerado!", "success");
      } catch (err) {
        showPortalToast(err.message || "Falha ao gerar kit.", "error");
      }
    });

    bodyEl.querySelector("#emp360FolhaBtn")?.addEventListener("click", () => {
      dlg.close();
      if (typeof window.switchView === "function") window.switchView("monthly-closing");
    });

    bodyEl.querySelectorAll("[data-emp360-open-doc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const docId = btn.getAttribute("data-emp360-open-doc");
        if (typeof window.openPreviewDialog === "function") {
          dlg.close();
          window.openPreviewDialog(docId);
        }
      });
    });

    bodyEl.querySelectorAll("[data-emp360-open-pag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = btn.getAttribute("data-emp360-open-pag");
        const found = empPags.find((item) => String(item.PagamentoID) === String(pid));
        if (found) openPayrollReceiptModal(found);
      });
    });
  } catch (err) {
    bodyEl.innerHTML = `<div class="empty-state">Erro ao carregar dossiê: ${escapeHtml(err.message || "Falha inesperada")}</div>`;
  }
}

function injectEmployeeDossierButtons() {
  const tbody = document.getElementById("employeeBody");
  if (!tbody) return;
  tbody.querySelectorAll("tr.employee-directory-row").forEach((tr) => {
    const rowActions = tr.querySelector(".row-actions");
    if (!rowActions || rowActions.querySelector("[data-open-dossier-emp]")) return;
    const editBtn = rowActions.querySelector('[data-action="edit-employee"]');
    const empId = editBtn?.getAttribute("data-id");
    if (!empId) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-quick-dossier";
    btn.setAttribute("data-open-dossier-emp", empId);
    btn.textContent = "Dossiê";
    btn.title = "Abrir Dossiê 360° (Docs, Férias, Vales, Takeat e Pagamentos)";
    rowActions.insertBefore(btn, editBtn);
  });
}

function mountEmployee360Dossier() {
  const tbody = document.getElementById("employeeBody");
  if (tbody && tbody.dataset.dossierObserver !== "true") {
    tbody.dataset.dossierObserver = "true";
    const obs = new MutationObserver(() => injectEmployeeDossierButtons());
    obs.observe(tbody, { childList: true });
    injectEmployeeDossierButtons();
  }
  if (!document.body.dataset.emp360Bound) {
    document.body.dataset.emp360Bound = "1";
    document.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-open-dossier-emp]");
      if (!btn) return;
      const empId = btn.getAttribute("data-open-dossier-emp");
      if (empId) openEmployee360Dossier(empId);
    });
  }
}

export function initPortalGestao() {
  if (typeof document === "undefined") return;
  injectPortalTabsStyles();
  mountTopbarStoreSelector();
  mountWhatsAppPasswordRecovery();
  mountWorkspaceHubBars();
  enhanceUnifiedPendingCenter();
  mountEmployeesOverviewSummary();
  mountEmployee360Dossier();
  enhanceEmployeeDialog();
  mountSolicitacoesTabsAndVale();
  mountQuickValeDialog();
  bindFichasView();
  mountCommunicationTabsAndPops();
  mountPayrollClosingScreen();
  enhanceAuditView();

  const onViewActivated = (view) => {
    syncWorkspaceHubBars(view);
    if (view === "employees") loadEmployeesOverviewSummary();
    if (view === "fichas") loadFichasView();
    if (view === "monthly-closing") loadPayrollClosingTable();
    if (view === "timeoff" || view === "pending-center") {
      loadValesList();
      if (view === "pending-center") loadUnifiedPendingHrItems();
    }
    if (view === "communication") loadPopsList();
    if (view === "audit") loadAuditHistoryTable();
  };

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => onViewActivated(btn.getAttribute("data-view")));
  });

  document.addEventListener("click", (e) => {
    const targetView = e.target?.closest?.("[data-view-target]")?.getAttribute?.("data-view-target");
    if (targetView) onViewActivated(targetView);
  });

  window.addEventListener("gestao-view-change", (e) => {
    if (e?.detail?.view) onViewActivated(e.detail.view);
  });

  window.addEventListener("gestao-user-hydrated", () => {
    syncWorkspaceHubBars();
    loadUnifiedPendingHrItems();
    if (isGerenteProfile(runtime?.profile)) {
      loadEmployeesOverviewSummary();
    }
  });

  setTimeout(() => {
    syncWorkspaceHubBars();
    refreshPortalViews();
  }, 1200);
}

// ============================================================================
// PORTAL PUBLICO DE AUTO-ONBOARDING DO FUNCIONARIO NOVATO (?onboarding_token=...)
// ============================================================================

const formatCpfMask = (val) => {
  const d = String(val || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

const formatPhoneMask = (val) => {
  const d = String(val || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export async function mountOnboardingSelfPortal(token) {
  if (typeof document === "undefined") return;
  injectPortalTabsStyles();
  document.getElementById("loadingOverlay")?.classList.add("hidden");
  document.getElementById("loginScreen")?.classList.add("hidden");
  document.getElementById("app")?.classList.add("hidden");
  document.getElementById("unauthorized")?.classList.add("hidden");
  document.getElementById("copilotFab")?.classList.add("hidden");

  let root = document.getElementById("onboardingSelfScreen");
  if (!root) {
    root = document.createElement("section");
    root.id = "onboardingSelfScreen";
    document.body.appendChild(root);
  }
  root.classList.remove("hidden");
  root.innerHTML = `
    <div class="onb-self-shell">
      <div class="onb-self-card" style="padding:28px; text-align:center;">
        <p style="margin:0; font-size:14px; color:#64748b;">Carregando ficha de admissão...</p>
      </div>
    </div>
  `;

  let inviteData = null;
  let etapasList = ONBOARDING_STAGES;
  let docsMetaList = REQUIRED_ADMISSION_DOCUMENTS.filter((d) =>
    SELF_ONBOARDING_DOC_CODES.includes(d.codigo),
  ).map((d) => ({
    ...d,
    obrigatorioAutocadastro: SELF_ONBOARDING_REQUIRED_DOC_CODES.includes(d.codigo),
  }));

  try {
    const res = await invokePortal("consultarConviteOnboarding", { token });
    inviteData = res.data?.convite || null;
    if (Array.isArray(res.data?.etapas)) etapasList = res.data.etapas;
    if (Array.isArray(res.data?.documentosExigidos)) {
      docsMetaList = res.data.documentosExigidos.filter((d) =>
        SELF_ONBOARDING_DOC_CODES.includes(d.codigo),
      );
    }
  } catch (err) {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    root.innerHTML = `
      <div class="onb-self-shell" style="max-width:520px; margin-top:24px;">
        <div class="onb-self-card" style="padding:28px; text-align:center;">
          <span class="eyebrow" style="color:#b91c1c;">LINK INDISPONÍVEL</span>
          <h2 style="margin:0; font-size:20px; color:#0f172a;">Não foi possível abrir o pré-cadastro</h2>
          <p style="margin:0; font-size:13.5px; color:#64748b; line-height:1.5;">${escapeHtml(err?.message || "Este link de admissão é inválido ou expirou. Solicite um novo link ao gerente.")}</p>
          <div class="onb-self-actions" style="justify-content:center; margin-top:6px;">
            <a href="${escapeHtml(baseUrl)}" class="btn btn-primary" style="text-decoration:none;">Ir para a tela inicial</a>
          </div>
        </div>
      </div>
    `;
    return;
  }

  let currentStep =
    inviteData.AcessoLiberado ||
    inviteData.CadastroValidado ||
    inviteData.Status === "Aprovado" ||
    inviteData.Status === "Aguardando Conferência"
      ? 3
      : 1;
  let editingSubmitted = false;

  const initialDados = inviteData.Submissao?.Dados || {};
  const draft = {
    Nome: initialDados.Nome || (inviteData.NomeHint && inviteData.NomeHint !== "Novo Colaborador" ? inviteData.NomeHint : ""),
    NomeSocial: initialDados.NomeSocial || "",
    CPF: initialDados.CPF || "",
    RG: initialDados.RG || "",
    DataNascimento: initialDados.DataNascimento || "",
    EstadoCivil: initialDados.EstadoCivil || "",
    NomeMae: initialDados.NomeMae || "",
    NomePai: initialDados.NomePai || "",
    Telefone: initialDados.Telefone || "",
    Email: initialDados.Email || "",
    CEP: initialDados.CEP || "",
    Endereco: initialDados.Endereco || "",
    NumeroEndereco: initialDados.NumeroEndereco || "",
    Complemento: initialDados.Complemento || "",
    Bairro: initialDados.Bairro || "",
    Cidade: initialDados.Cidade || "",
    UF: initialDados.UF || "",
    ContatoEmergenciaNome: initialDados.ContatoEmergenciaNome || "",
    ContatoEmergenciaParentesco: initialDados.ContatoEmergenciaParentesco || "",
    ContatoEmergenciaTelefone: initialDados.ContatoEmergenciaTelefone || "",
    ChavePix: initialDados.ChavePix || "",
    BancoNome: initialDados.BancoNome || "",
    BancoAgencia: initialDados.BancoAgencia || "",
    BancoConta: initialDados.BancoConta || "",
    BancoTipoConta: initialDados.BancoTipoConta || "Corrente",
  };
  const docsDraft = { ...(inviteData.Submissao?.Documentos || {}) };

  const captureFormToDraft = () => {
    const read = (id) => root.querySelector(`#${id}`)?.value ?? "";
    const keys = [
      ["onbSelfNome", "Nome"],
      ["onbSelfNomeSocial", "NomeSocial"],
      ["onbSelfCPF", "CPF"],
      ["onbSelfRG", "RG"],
      ["onbSelfNascimento", "DataNascimento"],
      ["onbSelfEstadoCivil", "EstadoCivil"],
      ["onbSelfMae", "NomeMae"],
      ["onbSelfPai", "NomePai"],
      ["onbSelfTelefone", "Telefone"],
      ["onbSelfEmail", "Email"],
      ["onbSelfCEP", "CEP"],
      ["onbSelfEndereco", "Endereco"],
      ["onbSelfNumero", "NumeroEndereco"],
      ["onbSelfComplemento", "Complemento"],
      ["onbSelfBairro", "Bairro"],
      ["onbSelfCidade", "Cidade"],
      ["onbSelfUF", "UF"],
      ["onbSelfEmergNome", "ContatoEmergenciaNome"],
      ["onbSelfEmergParent", "ContatoEmergenciaParentesco"],
      ["onbSelfEmergTel", "ContatoEmergenciaTelefone"],
      ["onbSelfPix", "ChavePix"],
      ["onbSelfBanco", "BancoNome"],
      ["onbSelfAgencia", "BancoAgencia"],
      ["onbSelfConta", "BancoConta"],
      ["onbSelfTipoConta", "BancoTipoConta"],
    ];
    keys.forEach(([elId, field]) => {
      const el = root.querySelector(`#${elId}`);
      if (el) draft[field] = String(read(elId)).trim();
    });
  };

  const renderSelfPortal = () => {
    const approved = Boolean(inviteData.AcessoLiberado || inviteData.CadastroValidado || inviteData.Status === "Aprovado");
    const awaiting = !approved && inviteData.Status === "Aguardando Conferência" && !editingSubmitted;
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const etapaAtual = Number(inviteData.EtapaAdmissao || (approved ? 3 : awaiting ? 2 : 1));
    const currentStageMeta = etapasList.find((e) => e.etapa === etapaAtual) || { titulo: `Etapa ${etapaAtual}` };

    const stepBadge = (num, label) => {
      const active = currentStep === num;
      const done = currentStep > num || approved;
      const cls = done ? "is-done" : active ? "is-active" : "";
      return `
        <div class="onb-self-step ${cls}">
          <span class="onb-self-step-num">${done ? "✓" : num}</span>
          <span class="onb-self-step-text">${escapeHtml(label)}</span>
        </div>
      `;
    };

    const correctionBanner = inviteData.MotivoCorrecao
      ? `<div style="padding:13px 15px; border-radius:12px; background:#fffbeb; border:1px solid #fcd34d; color:#92400e; font-size:13px; line-height:1.45;">
           <strong>Ajuste solicitado pela Administração:</strong> ${escapeHtml(inviteData.MotivoCorrecao)}
         </div>`
      : "";

    let bodyHtml = "";

    if (approved) {
      bodyHtml = `
        <div class="onb-self-card" style="padding:26px 22px; text-align:center; justify-items:center;">
          <div style="width:52px; height:52px; border-radius:999px; background:#ecfdf5; border:1px solid #a7f3d0; color:#059669; display:grid; place-items:center;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </div>
          <span class="portal-pill portal-pill--green">Acesso Liberado</span>
          <h2 style="margin:0; font-size:20px; color:#065f46;">Cadastro conferido com sucesso!</h2>
          <p style="margin:0; font-size:14px; color:#475569; max-width:460px; line-height:1.5;">
            Seus dados e documentos foram validados pela Administração e seu acesso ao sistema já está liberado.
          </p>
          <div style="width:100%; padding:12px 14px; border-radius:10px; background:#f8fafc; border:1px solid #e2e8f0; font-size:13px; color:#0f172a;">
            <strong>Etapa atual da contratação:</strong> ${escapeHtml(currentStageMeta.titulo)}
          </div>
          <div class="onb-self-actions" style="width:100%; justify-content:center; margin-top:4px;">
            <a href="${escapeHtml(baseUrl)}" class="btn btn-primary" style="text-decoration:none; width:100%; max-width:340px;">
              Ir para o Login do Sistema
            </a>
          </div>
        </div>
      `;
    } else if (awaiting) {
      const uploadedDocsCount = docsMetaList.filter((d) => normalizeDocItemFiles(docsDraft[d.codigo]).length > 0).length;
      const uploadedFilesCount = docsMetaList.reduce(
        (sum, d) => sum + normalizeDocItemFiles(docsDraft[d.codigo]).length,
        0,
      );
      bodyHtml = `
        <div class="onb-self-card">
          <div class="onb-self-card-head">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="portal-pill portal-pill--amber">Aguardando Conferência</span>
              <span class="portal-pill portal-pill--blue">Etapa ${etapaAtual}/6</span>
            </div>
          </div>
          <div style="display:grid; gap:6px;">
            <h2 style="margin:0; font-size:19px; color:#0f172a;">Ficha e documentos enviados!</h2>
            <p style="margin:0; font-size:13.5px; color:#475569; line-height:1.5;">
              Obrigado, <strong>${escapeHtml(draft.Nome || "colaborador(a)")}</strong>. A Administração já recebeu seus dados cadastrais e ${uploadedDocsCount} documento(s) (${uploadedFilesCount} arquivo(s)) para conferência. Assim que validarmos tudo, seu acesso ao aplicativo será liberado.
            </p>
          </div>
          <div style="display:grid; gap:8px; padding:14px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0; font-size:13px; color:#1e293b;">
            <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;"><span style="color:#64748b;">E-mail de acesso</span><strong>${escapeHtml(draft.Email || "-")}</strong></div>
            <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;"><span style="color:#64748b;">WhatsApp</span><strong>${escapeHtml(draft.Telefone || "-")}</strong></div>
            <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;"><span style="color:#64748b;">Documentos anexados</span><strong>${uploadedFilesCount} arquivo(s)</strong></div>
          </div>
          <div class="onb-self-actions" style="justify-content:flex-start;">
            <button type="button" id="btnOnbSelfEditAgain" class="btn btn-secondary">
              Editar Dados ou Documentos antes da Conferência
            </button>
          </div>
        </div>
      `;
    } else if (currentStep === 1) {
      bodyHtml = `
        <form id="onbSelfStep1Form" style="display:grid; gap:14px;">
          <div class="onb-self-card">
            <div class="onb-self-card-head">
              <div>
                <h4 class="onb-self-card-title">1. Dados Pessoais &amp; Contato</h4>
                <span class="onb-self-card-sub">Campos com * são obrigatórios</span>
              </div>
            </div>
            <div class="onb-self-grid">
              <label class="onb-self-field onb-self-span-2"><span class="onb-self-field-label">Nome Completo *</span><input id="onbSelfNome" required value="${escapeHtml(draft.Nome)}" placeholder="Seu nome completo" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Nome Social</span><input id="onbSelfNomeSocial" value="${escapeHtml(draft.NomeSocial)}" placeholder="Opcional" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">CPF *</span><input id="onbSelfCPF" required maxlength="14" inputmode="numeric" value="${escapeHtml(draft.CPF)}" placeholder="000.000.000-00" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">RG *</span><input id="onbSelfRG" required value="${escapeHtml(draft.RG)}" placeholder="00.000.000-0" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Data de Nascimento *</span><input id="onbSelfNascimento" type="date" required value="${escapeHtml(draft.DataNascimento)}" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Estado Civil</span>
                <select id="onbSelfEstadoCivil">
                  ${["", "Solteiro(a)", "Casado(a)", "União Estável", "Divorciado(a)", "Viúvo(a)"]
                    .map((opt) => `<option value="${escapeHtml(opt)}"${draft.EstadoCivil === opt ? " selected" : ""}>${opt || "Selecione"}</option>`)
                    .join("")}
                </select>
              </label>
              <label class="onb-self-field"><span class="onb-self-field-label">Nome da Mãe</span><input id="onbSelfMae" value="${escapeHtml(draft.NomeMae)}" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Nome do Pai</span><input id="onbSelfPai" value="${escapeHtml(draft.NomePai)}" placeholder="Opcional" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Telefone / WhatsApp *</span><input id="onbSelfTelefone" required maxlength="15" inputmode="tel" value="${escapeHtml(draft.Telefone)}" placeholder="(73) 99999-9999" /></label>
              <label class="onb-self-field onb-self-span-2"><span class="onb-self-field-label">E-mail pessoal (será seu login no app) *</span><input id="onbSelfEmail" type="email" required value="${escapeHtml(draft.Email)}" placeholder="seuemail@exemplo.com" /></label>
            </div>
          </div>

          <div class="onb-self-card">
            <div class="onb-self-card-head">
              <div>
                <h4 class="onb-self-card-title">2. Endereço Residencial</h4>
                <span class="onb-self-card-sub" id="onbSelfCepHint">Digite o CEP para preencher a rua automaticamente</span>
              </div>
            </div>
            <div class="onb-self-grid">
              <label class="onb-self-field"><span class="onb-self-field-label">CEP *</span><input id="onbSelfCEP" required maxlength="9" inputmode="numeric" value="${escapeHtml(draft.CEP)}" placeholder="00000-000" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Bairro *</span><input id="onbSelfBairro" required value="${escapeHtml(draft.Bairro)}" /></label>
              <label class="onb-self-field onb-self-span-2"><span class="onb-self-field-label">Rua / Avenida *</span><input id="onbSelfEndereco" required value="${escapeHtml(draft.Endereco)}" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Número</span><input id="onbSelfNumero" value="${escapeHtml(draft.NumeroEndereco)}" placeholder="Ex: 190" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Complemento</span><input id="onbSelfComplemento" value="${escapeHtml(draft.Complemento)}" placeholder="Casa, Apto, Fundos..." /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Cidade *</span><input id="onbSelfCidade" required value="${escapeHtml(draft.Cidade)}" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">UF *</span><input id="onbSelfUF" required maxlength="2" value="${escapeHtml(draft.UF)}" placeholder="BA" /></label>
            </div>
          </div>

          <div class="onb-self-card">
            <div class="onb-self-card-head">
              <div>
                <h4 class="onb-self-card-title">3. Emergência &amp; Dados para Pagamento</h4>
                <span class="onb-self-card-sub">Contato de urgência e Chave PIX</span>
              </div>
            </div>
            <div class="onb-self-grid">
              <label class="onb-self-field"><span class="onb-self-field-label">Nome Contato de Emergência *</span><input id="onbSelfEmergNome" required value="${escapeHtml(draft.ContatoEmergenciaNome)}" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Parentesco</span><input id="onbSelfEmergParent" value="${escapeHtml(draft.ContatoEmergenciaParentesco)}" placeholder="Mãe, Cônjuge..." /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Telefone de Emergência *</span><input id="onbSelfEmergTel" required maxlength="15" inputmode="tel" value="${escapeHtml(draft.ContatoEmergenciaTelefone)}" placeholder="(73) 99999-9999" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Chave PIX *</span><input id="onbSelfPix" required value="${escapeHtml(draft.ChavePix)}" placeholder="CPF, Celular, E-mail ou Aleatória" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Banco</span><input id="onbSelfBanco" value="${escapeHtml(draft.BancoNome)}" placeholder="Nubank, Itaú, Bradesco..." /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Tipo de Conta</span>
                <select id="onbSelfTipoConta">
                  ${["Corrente", "Poupança", "Salário", "Pagamento"]
                    .map((opt) => `<option value="${opt}"${draft.BancoTipoConta === opt ? " selected" : ""}>${opt}</option>`)
                    .join("")}
                </select>
              </label>
              <label class="onb-self-field"><span class="onb-self-field-label">Agência</span><input id="onbSelfAgencia" value="${escapeHtml(draft.BancoAgencia)}" placeholder="0001" /></label>
              <label class="onb-self-field"><span class="onb-self-field-label">Conta e Dígito</span><input id="onbSelfConta" value="${escapeHtml(draft.BancoConta)}" placeholder="12345-6" /></label>
            </div>
          </div>

          <div class="onb-self-card" style="padding:14px 16px;">
            <div class="onb-self-actions">
              <button type="button" id="btnOnbSelfSaveDraft" class="btn btn-secondary">
                Salvar Rascunho
              </button>
              <button type="submit" class="btn btn-primary">
                Continuar para Documentos →
              </button>
            </div>
          </div>
        </form>
      `;
    } else if (currentStep === 2) {
      const reqList = docsMetaList.filter((d) => d.obrigatorioAutocadastro);
      const reqDone = reqList.filter((d) => docsDraft[d.codigo]?.arquivoUrl).length;
      const reqMissing = Math.max(0, reqList.length - reqDone);
      const pct = reqList.length ? Math.round((reqDone / reqList.length) * 100) : 100;
      const uploadIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

      bodyHtml = `
        <div style="display:grid; gap:14px;">
          <div class="onb-self-card">
            <div class="onb-self-card-head">
              <div>
                <h4 class="onb-self-card-title">Envio de Documentos Admissionais</h4>
                <span class="onb-self-card-sub">
                  ${reqMissing === 0 ? "Todos os documentos obrigatórios foram anexados!" : `Anexe os ${reqMissing} documento(s) obrigatório(s) pendente(s) em foto nítida ou PDF.`}
                </span>
              </div>
              <button type="button" id="btnOnbSelfBackStep1" class="btn btn-secondary btn-sm">← Voltar aos Dados</button>
            </div>

            <div class="onb-self-progress-wrap">
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                <span style="color:#475569; font-weight:600;">Obrigatórios enviados</span>
                <strong style="color:${reqMissing === 0 ? "#047857" : "#1d4ed8"};">${reqDone} de ${reqList.length}</strong>
              </div>
              <div class="onb-self-progress-track">
                <div class="onb-self-progress-fill" style="width:${pct}%;"></div>
              </div>
            </div>

            <div class="onb-self-doc-list">
              ${docsMetaList
                .map((d) => {
                  const uploaded = docsDraft[d.codigo];
                  const files = normalizeDocItemFiles(uploaded);
                  const allowMulti = Boolean(d.multiplosArquivos || d.codigo === "RG_CNH");
                  const isUploaded = files.length > 0;
                  const badge = isUploaded
                    ? `<span class="portal-pill portal-pill--green">${files.length > 1 ? `${files.length} arquivos ✓` : "Anexado ✓"}</span>`
                    : d.obrigatorioAutocadastro
                      ? `<span class="portal-pill portal-pill--amber">Obrigatório</span>`
                      : `<span class="portal-pill portal-pill--neutral">Opcional</span>`;
                  const filesListHtml =
                    allowMulti && files.length
                      ? `
                        <div class="onb-self-doc-files">
                          ${files
                            .map(
                              (f, idx) => `
                              <div class="onb-self-file-row">
                                <span class="onb-self-file-name">${idx + 1}. ${escapeHtml(f.nomeArquivo || "Arquivo")}</span>
                                <div class="onb-self-file-btns">
                                  <button type="button" class="btn btn-secondary btn-sm" style="min-height:30px; padding:2px 8px; font-size:11.5px;" data-self-preview-doc="${escapeHtml(d.codigo)}" data-self-file-idx="${idx}">Ver</button>
                                  <button type="button" class="btn btn-secondary btn-sm" style="min-height:30px; padding:2px 8px; font-size:11.5px; color:#b91c1c;" data-self-remove-doc="${escapeHtml(d.codigo)}" data-self-file-idx="${idx}" aria-label="Remover arquivo">×</button>
                                </div>
                              </div>
                            `,
                            )
                            .join("")}
                        </div>
                      `
                      : "";
                  const btnLabel = allowMulti
                    ? isUploaded
                      ? "+ Adicionar Arquivo"
                      : "Enviar Frente / Verso"
                    : isUploaded
                      ? "Trocar"
                      : "Enviar Foto / PDF";
                  const subHint = isUploaded
                    ? allowMulti
                      ? `${files.length} arquivo(s) anexado(s) — você pode enviar frente, verso ou mais páginas`
                      : escapeHtml(uploaded.nomeArquivo || "Arquivo anexado")
                    : allowMulti
                      ? "Envie frente e verso separadamente (ou PDF) — pode enviar mais de 1 arquivo"
                      : "Foto legível (frente e verso) ou arquivo PDF";
                  return `
                    <div class="onb-self-doc-card ${isUploaded ? "is-uploaded" : ""}">
                      <div class="onb-self-doc-info">
                        <div class="onb-self-doc-top">
                          <span class="onb-self-doc-title">${escapeHtml(d.titulo)}</span>
                          ${badge}
                        </div>
                        <span class="onb-self-doc-sub">${subHint}</span>
                      </div>
                      <div class="onb-self-doc-actions">
                        ${
                          !allowMulti && isUploaded
                            ? `<button type="button" class="btn btn-secondary btn-sm" style="min-height:40px;" data-self-preview-doc="${escapeHtml(d.codigo)}">Ver</button>`
                            : ""
                        }
                        <label class="onb-self-upload-btn">
                          ${uploadIcon}
                          <span>${btnLabel}</span>
                          <input type="file" accept="image/*,.pdf" ${allowMulti ? "multiple" : ""} class="portal-file-input-hidden" data-self-doc-input="${escapeHtml(d.codigo)}" />
                        </label>
                      </div>
                      ${filesListHtml}
                    </div>
                  `;
                })
                .join("")}
            </div>
          </div>

          <div class="onb-self-card">
            <div class="onb-self-card-head">
              <div>
                <h4 class="onb-self-card-title">Confirmação &amp; Envio Final</h4>
                <span class="onb-self-card-sub">Revise seus anexos e finalize para análise da Administração</span>
              </div>
            </div>
            <label class="onb-self-consent" for="onbSelfTruthCheck">
              <input type="checkbox" id="onbSelfTruthCheck" class="onb-self-checkbox" />
              <span class="onb-self-consent-text">Declaro que todas as informações preenchidas e os documentos anexados são verdadeiros e pertencem a mim, autorizando a conferência pela Administração do Grupo House 190 para liberação do meu acesso.</span>
            </label>
            <div class="onb-self-actions">
              <button type="button" id="btnOnbSelfSaveDocsDraft" class="btn btn-secondary">
                Salvar Rascunho
              </button>
              <button type="button" id="btnOnbSelfSubmitFinal" class="btn btn-primary">
                Enviar Cadastro e Aguardar Liberação
              </button>
            </div>
          </div>
        </div>
      `;
    }

    root.innerHTML = `
      <div class="onb-self-shell">
        <header class="onb-self-hero">
          <div class="onb-self-hero-top">
            <div class="onb-self-hero-brand">
              <div class="onb-self-monogram">H190</div>
              <span class="onb-self-eyebrow">GRUPO HOUSE 190 · ADMISSÃO DIGITAL</span>
            </div>
            <span class="portal-pill portal-pill--blue" style="flex-shrink:0;">Etapa ${etapaAtual}/6</span>
          </div>
          <div class="onb-self-hero-body">
            <h1>Pré-Cadastro do Novo Colaborador</h1>
            <div class="onb-self-meta">
              <span class="onb-self-meta-chip">${escapeHtml(inviteData.NomeLoja || "Unidade House 190")}</span>
              ${inviteData.Cargo ? `<span class="onb-self-meta-chip">${escapeHtml(inviteData.Cargo)}</span>` : ""}
              ${inviteData.TipoContrato ? `<span class="onb-self-meta-chip">${escapeHtml(inviteData.TipoContrato)}</span>` : ""}
            </div>
          </div>
        </header>

        <nav class="onb-self-stepper" aria-label="Etapas do pré-cadastro">
          ${stepBadge(1, "Seus Dados")}
          ${stepBadge(2, "Documentos")}
          ${stepBadge(3, "Liberação")}
        </nav>

        ${correctionBanner}
        ${bodyHtml}
      </div>
    `;

    // Bind Step 1 Events
    const cpfEl = root.querySelector("#onbSelfCPF");
    cpfEl?.addEventListener("input", (ev) => {
      ev.target.value = formatCpfMask(ev.target.value);
    });
    [root.querySelector("#onbSelfTelefone"), root.querySelector("#onbSelfEmergTel")].forEach((telEl) => {
      telEl?.addEventListener("input", (ev) => {
        ev.target.value = formatPhoneMask(ev.target.value);
      });
    });

    const cepEl = root.querySelector("#onbSelfCEP");
    cepEl?.addEventListener("blur", async () => {
      const digits = String(cepEl.value || "").replace(/\D/g, "");
      if (digits.length !== 8) return;
      try {
        const resp = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
        const json = await resp.json().catch(() => null);
        if (json && !json.erro) {
          const fill = (id, v) => {
            const input = root.querySelector(`#${id}`);
            if (input && v) input.value = v;
          };
          fill("onbSelfEndereco", json.logradouro);
          fill("onbSelfBairro", json.bairro);
          fill("onbSelfCidade", json.localidade);
          fill("onbSelfUF", json.uf);
        }
      } catch {
        // Silencioso offline
      }
    });

    const persistDraft = async (finalizar = false) => {
      captureFormToDraft();
      const res = await invokePortal("salvarAutocadastroOnboarding", {
        token,
        dados: draft,
        documentos: docsDraft,
        finalizar,
      });
      if (res?.data) {
        inviteData = { ...inviteData, ...res.data };
      }
      return res;
    };

    root.querySelector("#btnOnbSelfSaveDraft")?.addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await persistDraft(false);
        showPortalToast("Rascunho salvo! Você pode continuar depois pelo mesmo link.", "success");
      } catch (err) {
        showPortalToast(err.message || "Falha ao salvar rascunho.", "error");
      } finally {
        btn.disabled = false;
      }
    });

    root.querySelector("#onbSelfStep1Form")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = ev.target.querySelector('[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        await persistDraft(false);
        currentStep = 2;
        renderSelfPortal();
        window.scrollTo?.({ top: 0, behavior: "smooth" });
      } catch (err) {
        showPortalToast(err.message || "Verifique os campos preenchidos.", "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // Bind Step 2 Events
    root.querySelector("#btnOnbSelfBackStep1")?.addEventListener("click", () => {
      currentStep = 1;
      renderSelfPortal();
    });

    root.querySelectorAll("[data-self-doc-input]").forEach((input) => {
      input.addEventListener("change", async () => {
        const selectedFiles = Array.from(input.files || []);
        if (!selectedFiles.length) return;
        const code = input.getAttribute("data-self-doc-input");
        const meta = docsMetaList.find((d) => d.codigo === code);
        const allowMulti = Boolean(meta?.multiplosArquivos || code === "RG_CNH");
        const cardEl = input.closest(".onb-self-doc-card");
        const subHintEl = cardEl?.querySelector(".onb-self-doc-sub");
        if (subHintEl) subHintEl.textContent = "Enviando arquivo(s) para o Google Drive...";
        input.disabled = true;
        try {
          const existingFiles = allowMulti ? normalizeDocItemFiles(docsDraft[code]) : [];
          const nextFiles = [...existingFiles];
          for (const file of selectedFiles) {
            if (allowMulti && nextFiles.length >= 5) {
              showPortalToast("Limite de 5 arquivos por documento atingido.", "warning");
              break;
            }
            const dataUrl = await readAttachmentFileAsDataUrl(file);
            if (dataUrl.length > 7800000) {
              showPortalToast(`Arquivo "${file.name}" muito grande. Máx. 5,5 MB.`, "error");
              continue;
            }
            const mimeType = inferMimeTypeFromDataUrl(dataUrl, file.type || "image/jpeg");
            const driveRes = await uploadOnboardingDocumentToDrive({
              inviteToken: token,
              dataUrl,
              mimeType,
              fileName: file.name,
              docCode: code,
              employeeId: inviteData?.FuncionarioID || "",
              storeId: inviteData?.LojaID || "",
            });
            nextFiles.push({
              arquivoUrl: driveRes.url,
              driveFileId: driveRes.fileId,
              storage: "Google Drive",
              mimeType: driveRes.mimeType || mimeType,
              nomeArquivo: file.name,
              enviadoEm: new Date().toISOString(),
            });
          }
          if (!nextFiles.length) return;
          const summaryName =
            nextFiles.length > 1
              ? `${nextFiles.length} arquivos (${nextFiles.map((f) => f.nomeArquivo).join(", ")})`
              : nextFiles[0].nomeArquivo;
          docsDraft[code] = {
            codigo: code,
            titulo: meta?.titulo || code,
            arquivoUrl: nextFiles[0].arquivoUrl,
            driveFileId: nextFiles[0].driveFileId || "",
            storage: nextFiles[0].storage || "Google Drive",
            mimeType: nextFiles[0].mimeType || "",
            nomeArquivo: summaryName,
            arquivos: nextFiles,
            enviadoEm: nextFiles[0].enviadoEm,
          };
          await persistDraft(false);
          showPortalToast(`${meta?.titulo || code} salvo no Google Drive!`, "success");
          renderSelfPortal();
        } catch (err) {
          showPortalToast(err.message || "Erro ao enviar arquivo ao Google Drive.", "error");
          renderSelfPortal();
        } finally {
          input.disabled = false;
        }
      });
    });

    root.querySelectorAll("[data-self-preview-doc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-self-preview-doc");
        const idxAttr = btn.getAttribute("data-self-file-idx");
        const docItem = docsDraft[code];
        const files = normalizeDocItemFiles(docItem);
        if (!files.length) return;
        if (idxAttr !== null && idxAttr !== undefined) {
          const fileObj = files[Number(idxAttr)];
          if (fileObj) {
            openOnboardingFilePreview(fileObj.nomeArquivo || docItem.titulo || code, [fileObj], {
              inviteToken: token,
            });
          }
          return;
        }
        openOnboardingFilePreview(docItem.titulo || code, files, { inviteToken: token });
      });
    });

    root.querySelectorAll("[data-self-remove-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const code = btn.getAttribute("data-self-remove-doc");
        const idx = Number(btn.getAttribute("data-self-file-idx"));
        const files = normalizeDocItemFiles(docsDraft[code]);
        const nextFiles = files.filter((_, i) => i !== idx);
        if (nextFiles.length) {
          docsDraft[code] = {
            ...docsDraft[code],
            arquivoUrl: nextFiles[0].arquivoUrl,
            nomeArquivo:
              nextFiles.length > 1
                ? `${nextFiles.length} arquivos (${nextFiles.map((f) => f.nomeArquivo).join(", ")})`
                : nextFiles[0].nomeArquivo,
            arquivos: nextFiles,
          };
        } else {
          delete docsDraft[code];
        }
        await persistDraft(false).catch(() => null);
        renderSelfPortal();
      });
    });

    root.querySelector("#btnOnbSelfSaveDocsDraft")?.addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await persistDraft(false);
        showPortalToast("Documentos salvos no rascunho!", "success");
      } catch (err) {
        showPortalToast(err.message || "Falha ao salvar.", "error");
      } finally {
        btn.disabled = false;
      }
    });

    root.querySelector("#btnOnbSelfSubmitFinal")?.addEventListener("click", async (ev) => {
      if (!root.querySelector("#onbSelfTruthCheck")?.checked) {
        showPortalToast("Marque a declaração de veracidade antes de enviar.", "warning");
        return;
      }
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await persistDraft(true);
        editingSubmitted = false;
        currentStep = 3;
        renderSelfPortal();
        window.scrollTo?.({ top: 0, behavior: "smooth" });
        showPortalToast("Cadastro enviado! Aguarde a liberação da Administração.", "success");
      } catch (err) {
        showPortalToast(err.message || "Confira os campos obrigatórios.", "error");
      } finally {
        btn.disabled = false;
      }
    });

    root.querySelector("#btnOnbSelfEditAgain")?.addEventListener("click", () => {
      editingSubmitted = true;
      currentStep = 1;
      renderSelfPortal();
    });
  };

  renderSelfPortal();
}

if (typeof window !== "undefined") {
  window.initPortalGestao = initPortalGestao;
  window.refreshPortalViews = refreshPortalViews;
  window.loadValesList = loadValesList;
  window.loadUnifiedPendingHrItems = loadUnifiedPendingHrItems;
  window.openEmployee360Dossier = openEmployee360Dossier;
  window.renderEmployeeOnboardingState = renderEmployeeOnboardingState;
  window.mountOnboardingSelfPortal = mountOnboardingSelfPortal;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initPortalGestao());
  } else {
    initPortalGestao();
  }
}
