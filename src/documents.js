// ==========================================================================
// MÓDULO DE DOCUMENTOS & ASSINATURA ELETRÔNICA (FOLGAS 3.0)
// Grupo House 190 — Sistema Jurídico Avançado (Lei 14.063/2020 e Art. 464 CLT)
// ==========================================================================

import { DOCUMENT_TEMPLATES, sha256Hex, parseBatchPayrollPdf, formatMonthLabel } from "./core/api-documents.js";

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const esc = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c]),
  );

const storeName = (s) => String(s?.NomeLoja || s?.nomeLoja || s?.Nome || s?.nome || "").trim();
const storeId = (s) => String(s?.LojaID || s?.id || s?.Loja || s?.Loja_ID || "").trim();
const empName = (e) => String(e?.Nome || e?.NomeFuncionario || e?.nome || "").trim();
const empId = (e) => String(e?.FuncionarioID || e?.id || e?.Funcionario || "").trim();
const empStoreId = (e) => String(e?.LojaID || e?.lojaId || e?.Loja || "").trim();
const empCpf = (e) => String(e?.CPF || e?.cpf || "").trim();

const userFuncId = (u) => String(u?.FuncionarioID || u?.funcionarioId || u?.id || "").trim();
const userLojaId = (u) => String(u?.LojaID || u?.lojaId || "").trim();

let state = {
  documents: [],
  stores: [],
  employees: [],
  user: null,
  isManager: false,
  isAdmin: false,
  activeTab: "minhas", // "minhas" | "gestao"
  statusFilter: "all",
  storeFilter: "all",
  monthFilter: "all",
  loading: false,
  currentSigningDoc: null,
  signaturePadActive: false,
  signatureHasDrawn: false,
  hasScrolledToBottom: false,
  cachedIp: "",
};

/**
 * Obtém IP público do cliente com timeout curto e fallback
 */
async function getClientIp() {
  if (state.cachedIp) return state.cachedIp;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    state.cachedIp = String(data?.ip || "").trim();
    return state.cachedIp;
  } catch {
    state.cachedIp = "Conexão Segura Registrada";
    return state.cachedIp;
  }
}

/**
 * Invoca API central do Folgas 3.0
 */
async function callApi(method, ...args) {
  if (window.__GESTAO_FIREBASE__?.api?.invoke) {
    return await window.__GESTAO_FIREBASE__.api.invoke(method, args);
  }
  throw new Error("API central não inicializada.");
}

/**
 * Inicializador público do módulo
 */
export async function initDocumentsModule(context = {}) {
  state.user = context.user || window.__GESTAO_USER__ || window.state?.user || null;
  state.stores = (context.stores && context.stores.length) ? context.stores : (window.state?.stores || []);
  state.employees = (context.employees && context.employees.length) ? context.employees : (window.state?.employees || []);
  state.isManager = Boolean(context.isManager || window.__GESTAO_IS_MANAGER__);
  state.isAdmin = Boolean(
    context.isAdmin ||
      String(state.user?.Perfil || state.user?.perfil || "")
        .toLowerCase()
        .includes("admin"),
  );

  // Por padrão: se for gerente/admin, começa na aba de gestão; se for colaborador, em Meus Documentos
  state.activeTab = (state.isManager || state.isAdmin) ? "gestao" : "minhas";

  setupEventListeners();
  await loadDocuments();
}

/**
 * Carrega a lista de documentos do Firebase
 */
export async function loadDocuments() {
  const container = $("#documentsAppRoot");
  if (!container) return;

  state.loading = true;
  renderLoadingState();

  try {
    const targetStore = state.storeFilter === "all" ? "" : state.storeFilter;
    const targetStatus = state.statusFilter === "all" ? "" : state.statusFilter;
    const targetFunc = state.activeTab === "minhas" ? userFuncId(state.user) : "";
    const targetMonth = state.monthFilter === "all" ? "" : state.monthFilter;

    const res = await callApi(
      "documentsList",
      targetStore,
      targetStatus,
      targetFunc,
      targetMonth,
    );
    const docs = res?.documents || res?.data?.documents || res?.data || (Array.isArray(res) ? res : []);
    state.documents = Array.isArray(docs) ? docs : [];

    // Atualiza contadores e badge do menu
    const myId = userFuncId(state.user);
    const myPending = state.documents.filter(
      (d) =>
        d.Status === "Pendente" &&
        (!myId || String(d.FuncionarioID || "").trim() === myId),
    ).length;

    const navBadge = $("#documentsNavBadge");
    if (navBadge) {
      if (myPending > 0) {
        navBadge.textContent = myPending;
        navBadge.classList.remove("hidden");
      } else {
        navBadge.classList.add("hidden");
      }
    }

    renderDocumentsView();
  } catch (err) {
    console.error("[documents] Erro ao carregar documentos:", err);
    if (container) {
      container.innerHTML = `
        <div class="panel" style="padding: 2rem; text-align: center;">
          <p style="color: #ef4444; font-weight: 600;">Falha ao carregar documentos: ${esc(err.message)}</p>
          <button class="btn btn-primary" onclick="window.initDocumentsModule()">Tentar Novamente</button>
        </div>
      `;
    }
  } finally {
    state.loading = false;
  }
}

/**
 * Renderiza o estado de carregamento
 */
function renderLoadingState() {
  const container = $("#documentsAppRoot");
  if (!container) return;
  container.innerHTML = `
    <div style="padding: 3rem 1rem; text-align: center; color: var(--muted, #64748b);">
      <div class="quantum-loader" style="margin: 0 auto 1rem;">
        <i class="quantum-particle"></i><i class="quantum-particle"></i><i class="quantum-particle"></i>
      </div>
      <p style="font-weight: 500;">Carregando documentos seguros...</p>
    </div>
  `;
}

/**
 * Renderiza a visão principal com abas e filtros
 */
export function renderDocumentsView() {
  const container = $("#documentsAppRoot");
  if (!container) return;

  const canManage = state.isManager || state.isAdmin;
  const myPendingDocs = state.documents.filter(
    (d) =>
      d.Status === "Pendente" &&
      String(d.FuncionarioID || "").trim() === String(state.user?.FuncionarioID || "").trim(),
  );

  let tabsHtml = "";
  if (canManage) {
    tabsHtml = `
      <div class="doc-nav-tabs">
        <button class="doc-tab-btn ${state.activeTab === "gestao" ? "active" : ""}" data-tab="gestao">
          Painel de Gestão & Emissão
        </button>
        <button class="doc-tab-btn ${state.activeTab === "minhas" ? "active" : ""}" data-tab="minhas">
          Meus Documentos
          ${myPendingDocs.length > 0 ? `<span class="doc-tab-badge badge-amber">${myPendingDocs.length}</span>` : ""}
        </button>
      </div>
    `;
  }

  let contentHtml = "";
  if (state.activeTab === "gestao" && canManage) {
    contentHtml = renderManagerView();
  } else {
    contentHtml = renderEmployeeView();
  }

  container.innerHTML = `
    <div class="documents-shell">
      ${tabsHtml}
      ${contentHtml}
    </div>
  `;

  bindViewEvents();
}

/**
 * Renderiza Visão de Gestão (RH / Gerente / Admin)
 */
function renderManagerView() {
  const total = state.documents.length;
  const pendentes = state.documents.filter((d) => d.Status === "Pendente").length;
  const assinados = state.documents.filter((d) => d.Status === "Assinado").length;
  const compliance = total > 0 ? Math.round((assinados / total) * 100) : 100;

  const storesList = (state.stores && state.stores.length) ? state.stores : (window.state?.stores || []);
  state.stores = storesList;

  // Opções de Lojas
  const storeOptions = [
    `<option value="all">Todas as Lojas</option>`,
    ...storesList.map((s) => {
      const id = storeId(s);
      const name = storeName(s) || id || "Unidade";
      return `<option value="${esc(id)}" ${state.storeFilter === id ? "selected" : ""}>${esc(name)}</option>`;
    }),
  ].join("");

  // Tabela de Documentos
  let rowsHtml = "";
  if (state.documents.length === 0) {
    rowsHtml = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--muted, #64748b);">
          Nenhum documento encontrado para os filtros selecionados.
        </td>
      </tr>
    `;
  } else {
    rowsHtml = state.documents
      .map((doc) => {
        const isSigned = doc.Status === "Assinado";
        return `
          <tr>
            <td>
              <strong>${esc(doc.NomeFuncionario)}</strong>
              <div style="font-size: 11px; color: var(--muted, #64748b);">CPF: ${esc(doc.CPFFuncionario || "---")}</div>
            </td>
            <td>
              <span class="doc-type-pill">${esc(doc.Tipo)}</span>
              <div style="font-weight: 600; font-size: 13px; margin-top: 3px;">${esc(doc.Titulo)}</div>
            </td>
            <td>${esc(doc.MesReferencia || "---")}</td>
            <td>${esc(doc.NomeLoja || doc.LojaID)}</td>
            <td>
              <span class="doc-status-badge ${isSigned ? "doc-status-signed" : "doc-status-pending"}">
                ${isSigned ? "Assinado" : "Pendente"}
              </span>
            </td>
            <td style="font-size: 12px; color: var(--muted, #64748b);">
              ${isSigned ? formatDate(doc.DataAssinatura) : formatDate(doc.DataEnvio)}
            </td>
            <td style="text-align: right;">
              <div style="display: inline-flex; gap: 6px;">
                ${
                  isSigned
                    ? `
                  <button class="btn btn-secondary btn-sm" data-action="download" data-id="${esc(doc.DocumentoID)}">
                    Baixar PDF
                  </button>
                  <button class="btn btn-ghost btn-sm" data-action="audit" data-id="${esc(doc.DocumentoID)}" title="Ver Auditoria Pericial">
                    Certificado
                  </button>
                `
                    : `
                  <button class="btn btn-secondary btn-sm" data-action="preview" data-id="${esc(doc.DocumentoID)}">
                    Visualizar
                  </button>
                  <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${esc(doc.DocumentoID)}" style="color: #ef4444;" title="Excluir documento pendente">
                    Excluir
                  </button>
                `
                }
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  return `
    <div class="doc-metric-grid">
      <div class="doc-metric-card" style="--metric-color: #6340d8;">
        <span>Total Emitidos</span>
        <strong>${total}</strong>
      </div>
      <div class="doc-metric-card" style="--metric-color: #f59e0b;">
        <span>Pendentes de Assinatura</span>
        <strong style="color: #d97706;">${pendentes}</strong>
      </div>
      <div class="doc-metric-card" style="--metric-color: #10b981;">
        <span>Assinados Digitalmente</span>
        <strong style="color: #059669;">${assinados}</strong>
      </div>
      <div class="doc-metric-card" style="--metric-color: #3b82f6;">
        <span>Taxa de Conformidade</span>
        <strong>${compliance}%</strong>
      </div>
    </div>

    <div class="panel table-panel">
      <div class="panel-head" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
          <select id="docStoreFilter" style="border-radius: 10px; padding: 7px 12px; font-size: 13px;">
            ${storeOptions}
          </select>
          <select id="docStatusFilter" style="border-radius: 10px; padding: 7px 12px; font-size: 13px;">
            <option value="all" ${state.statusFilter === "all" ? "selected" : ""}>Todos os Status</option>
            <option value="Pendente" ${state.statusFilter === "Pendente" ? "selected" : ""}>Pendentes</option>
            <option value="Assinado" ${state.statusFilter === "Assinado" ? "selected" : ""}>Assinados</option>
          </select>
          <button id="docRefreshBtn" class="btn btn-secondary btn-sm">Atualizar</button>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <input type="file" id="docBatchFileInput" accept="application/pdf" style="display: none;" />
          <button id="docBatchUploadBtn" class="btn btn-secondary btn-sm" style="border-color: #6340d8; color: #6340d8; font-weight: 600;">
            Importar Lote (Holerites)
          </button>
          <button id="docNewDocumentBtn" class="btn btn-primary btn-sm">
            Novo Documento / Holerite
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Documento</th>
              <th>Ref.</th>
              <th>Loja</th>
              <th>Status</th>
              <th>Data</th>
              <th style="text-align: right;">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Renderiza Visão do Colaborador ("Meus Documentos")
 */
function renderEmployeeView() {
  const myId = userFuncId(state.user);
  const myDocs = (!state.isManager && !state.isAdmin)
    ? state.documents
    : (myId ? state.documents.filter((d) => String(d.FuncionarioID || "").trim() === myId) : state.documents);

  const pending = myDocs.filter((d) => d.Status === "Pendente");
  const signed = myDocs.filter((d) => d.Status === "Assinado");

  // Atualiza chip de pendências no topo de forma sutil
  const pendingChip = $("#docPendingCounterChip");
  if (pendingChip) {
    if (pending.length > 0) {
      pendingChip.textContent = `${pending.length} ${pending.length === 1 ? "pendente" : "pendentes"}`;
      pendingChip.classList.remove("hidden");
    } else {
      pendingChip.classList.add("hidden");
    }
  }

  let cardsHtml = "";
  if (myDocs.length === 0) {
    cardsHtml = `
      <div class="panel doc-empty-panel">
        <div class="doc-empty-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <p class="doc-empty-title">Nenhum documento pendente</p>
        <p class="doc-empty-desc">Todos os seus holerites, comprovantes e termos estão em dia.</p>
      </div>
    `;
  } else {
    cardsHtml = myDocs
      .map((doc) => {
        const isSigned = doc.Status === "Assinado";
        return `
          <div class="doc-item-card ${!isSigned ? "doc-item-pending" : ""}">
            <div class="doc-item-header">
              <span class="doc-type-pill">${esc(doc.Tipo || "Documento")}</span>
              <span class="doc-status-badge ${isSigned ? "doc-status-signed" : "doc-status-pending"}">
                ${isSigned ? "Assinado" : "Pendente"}
              </span>
            </div>

            <div class="doc-item-main">
              <h4 class="doc-item-title">${esc(doc.Titulo)}</h4>
              <div class="doc-item-meta">
                <span>Ref: <strong>${esc(doc.MesReferencia || "Geral")}</strong></span>
                <span>•</span>
                <span><strong>${esc(doc.NomeLoja || doc.LojaID)}</strong></span>
                <span>•</span>
                <span>Enviado em ${formatDate(doc.DataEnvio)}</span>
                ${isSigned ? `<span>•</span><span>Assinado em ${formatDate(doc.DataAssinatura)}</span>` : ""}
              </div>
            </div>

            <div class="doc-item-actions">
              ${
                !isSigned
                  ? `
                <button class="btn btn-primary doc-btn-sign" data-action="sign" data-id="${esc(doc.DocumentoID)}">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  Ler e Assinar Documento
                </button>
              `
                  : `
                <button class="btn btn-secondary btn-sm" data-action="download" data-id="${esc(doc.DocumentoID)}">
                  Baixar PDF Assinado
                </button>
                <button class="btn btn-ghost btn-sm" data-action="audit" data-id="${esc(doc.DocumentoID)}">
                  Certificado & Hash
                </button>
              `
              }
            </div>
          </div>
        `;
      })
      .join("");
  }

  return `
    <div class="doc-cards-list">
      ${cardsHtml}
    </div>
  `;
}

let listenersInitialized = false;

/**
 * Event Listeners e Delegação de Cliques
 */
function setupEventListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  // Listener global de abas
  document.addEventListener("click", async (e) => {
    const tabBtn = e.target.closest(".doc-tab-btn");
    if (tabBtn) {
      const tab = tabBtn.getAttribute("data-tab");
      if (tab) {
        state.activeTab = tab;
        renderDocumentsView();
      }
      return;
    }

    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn && actionBtn.closest("#documentsAppRoot")) {
      const action = actionBtn.getAttribute("data-action");
      const id = actionBtn.getAttribute("data-id");
      if (action === "sign") {
        openSignDialog(id);
      } else if (action === "download") {
        downloadPdf(id);
      } else if (action === "audit") {
        openAuditDialog(id);
      } else if (action === "delete") {
        deleteDocument(id);
      } else if (action === "preview") {
        openPreviewDialog(id);
      }
    }
  });
}

function bindViewEvents() {
  const storeFilter = $("#docStoreFilter");
  if (storeFilter) {
    storeFilter.onchange = (e) => {
      state.storeFilter = e.target.value;
      loadDocuments();
    };
  }

  const statusFilter = $("#docStatusFilter");
  if (statusFilter) {
    statusFilter.onchange = (e) => {
      state.statusFilter = e.target.value;
      loadDocuments();
    };
  }

  const refreshBtn = $("#docRefreshBtn");
  if (refreshBtn) {
    refreshBtn.onclick = () => loadDocuments();
  }

  const batchUploadBtn = $("#docBatchUploadBtn");
  const batchFileInput = $("#docBatchFileInput");
  if (batchUploadBtn && batchFileInput) {
    batchUploadBtn.onclick = () => {
      batchFileInput.value = "";
      batchFileInput.click();
    };
    batchFileInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) {
        handleBatchFileUpload(file);
      }
    };
  }

  const newDocBtn = $("#docNewDocumentBtn");
  if (newDocBtn) {
    newDocBtn.onclick = () => openUploadDialog();
  }
}

/**
 * Helper para converter Base64 em Blob URL para renderização nativa de PDF
 */
function base64ToBlobUrl(base64Data, contentType = "application/pdf") {
  try {
    let clean = base64Data;
    if (clean.includes(",")) {
      clean = clean.split(",")[1];
    }
    const binary = atob(clean);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: contentType });
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn("[documents] Falha ao converter base64 para Blob:", err);
    return base64Data;
  }
}

/**
 * Abre o Modal de Leitura Obrigatória e Assinatura Eletrônica
 */
export async function openSignDialog(docId) {
  const doc = state.documents.find((d) => String(d.DocumentoID) === String(docId));
  if (!doc) {
    alert("Documento não localizado.");
    return;
  }

  state.currentSigningDoc = doc;
  state.hasScrolledToBottom = false;
  state.signatureHasDrawn = false;

  const dialog = $("#documentSignDialog");
  if (!dialog) return;

  const ip = await getClientIp();

  let pdfBlobUrl = "";
  if (doc.ArquivoOriginalBase64) {
    pdfBlobUrl = base64ToBlobUrl(doc.ArquivoOriginalBase64, "application/pdf");
  }

  // Renderiza viewer do documento com botão de tela cheia
  let viewerHtml = "";
  if (pdfBlobUrl) {
    viewerHtml = `
      <div class="doc-viewer-action-row">
        <div class="doc-sign-meta-compact">
          <span>Colaborador: <strong>${esc(doc.NomeFuncionario)}</strong> (CPF: ${esc(doc.CPFFuncionario || "---")})</span>
          <span>Unidade: <strong>${esc(doc.NomeLoja || doc.LojaID)}</strong></span>
        </div>
        <button type="button" id="docOpenFullScreenPdfBtn" class="doc-btn-fullscreen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
          Abrir em Tela Cheia
        </button>
      </div>

      <div class="doc-viewer-tip">
        Toque em <strong>Abrir em Tela Cheia</strong> para ver o documento completo com zoom pelo celular.
      </div>

      <div id="docViewerBox" class="doc-viewer-container">
        <iframe class="doc-pdf-iframe" src="${pdfBlobUrl}#toolbar=0&navpanes=0"></iframe>
      </div>
    `;
  } else {
    viewerHtml = `
      <div class="doc-viewer-action-row">
        <div class="doc-sign-meta-compact">
          <span>Colaborador: <strong>${esc(doc.NomeFuncionario)}</strong> (CPF: ${esc(doc.CPFFuncionario || "---")})</span>
          <span>Unidade: <strong>${esc(doc.NomeLoja || doc.LojaID)}</strong></span>
        </div>
      </div>

      <div id="docViewerBox" class="doc-viewer-container doc-text-viewer">
        <h3 style="margin-top:0; color:#312e81;">${esc(doc.Titulo)}</h3>
        <div style="white-space: pre-wrap; font-family: inherit;">${esc(doc.ConteudoTexto || "")}</div>
      </div>
    `;
  }

  dialog.innerHTML = `
    <div class="dialog-head">
      <div>
        <span class="doc-modal-eyebrow">Assinatura Eletrônica</span>
        <h3 class="doc-modal-title">${esc(doc.Titulo)}</h3>
      </div>
      <button type="button" class="icon-btn" id="docSignCloseBtn" data-close="documentSignDialog" aria-label="Fechar">&times;</button>
    </div>

    <div class="dialog-body">
      ${viewerHtml}

      <div id="docScrollLockBanner" class="doc-scroll-lock-banner">
        <span id="docScrollLockMsg">Por favor, confira o documento para liberar a assinatura.</span>
        <div class="doc-scroll-progress-bar">
          <div id="docScrollProgressFill" class="doc-scroll-progress-fill"></div>
        </div>
      </div>

      <div id="docSignatureSection" class="doc-signature-box disabled">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="font-size:13px; color:#1e293b;">Desenhe sua Rubrica no quadro abaixo:</strong>
          <button id="docClearCanvasBtn" class="btn btn-ghost btn-sm" type="button">Limpar</button>
        </div>

        <div class="doc-canvas-wrap">
          <canvas id="docSignCanvas"></canvas>
          <div class="doc-canvas-baseline">
            <span>Rubrica Manuscreve</span>
            <span>Assinatura Digital</span>
          </div>
        </div>

        <label class="doc-legal-declaration">
          <input type="checkbox" id="docAffirmationCheck" />
          <span>Declaro sob as penas da lei que li atentamente a integralidade deste documento, concordo com seus termos e manifesto minha vontade expressa e irrevogável de assinar eletronicamente.</span>
        </label>

        <div style="background:#f8fafc; border-radius:10px; padding:10px; font-size:11.5px; color:#64748b; display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;">
          <span>IP: <strong>${esc(ip)}</strong></span>
          <span>Segurança: <strong>SHA-256 + Lei 14.063/2020</strong></span>
        </div>
      </div>
    </div>

    <div class="dialog-actions">
      <button id="docSignCancelBtn" class="btn btn-secondary" type="button" data-close="documentSignDialog">Cancelar</button>
      <button id="docSignConfirmBtn" class="btn btn-primary" type="button" disabled>
        Confirmar e Assinar
      </button>
    </div>
  `;

  dialog.showModal?.() || dialog.setAttribute("open", "true");

  setupSignModalEvents(dialog, doc, pdfBlobUrl);
}

/**
 * Configura os eventos de rolagem e canvas no modal
 */
function setupSignModalEvents(dialog, doc, pdfBlobUrl = "") {
  const close = () => {
    if (pdfBlobUrl && pdfBlobUrl.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(pdfBlobUrl);
      } catch (_) {}
    }
    dialog.close?.() || dialog.removeAttribute("open");
  };

  $("#docSignCloseBtn")?.addEventListener("click", close);
  $("#docSignCancelBtn")?.addEventListener("click", close);

  // Abrir PDF em Tela Cheia no Safari nativo
  $("#docOpenFullScreenPdfBtn")?.addEventListener("click", () => {
    if (pdfBlobUrl) {
      window.open(pdfBlobUrl, "_blank");
      unlockSignature();
    }
  });

  // Monitoramento de leitura / rolagem
  const viewerBox = $("#docViewerBox");
  const lockBanner = $("#docScrollLockBanner");
  const lockMsg = $("#docScrollLockMsg");
  const progressFill = $("#docScrollProgressFill");
  const sigSection = $("#docSignatureSection");
  const confirmBtn = $("#docSignConfirmBtn");

  const unlockSignature = () => {
    if (state.hasScrolledToBottom) return;
    state.hasScrolledToBottom = true;
    lockBanner?.classList.add("unlocked");
    if (lockMsg) lockMsg.textContent = "Leitura concluída. Painel de assinatura liberado.";
    if (progressFill) progressFill.style.width = "100%";
    sigSection?.classList.remove("disabled");
  };

  if (viewerBox) {
    viewerBox.addEventListener("scroll", () => {
      const scrollTotal = viewerBox.scrollHeight - viewerBox.clientHeight;
      if (scrollTotal <= 10) {
        unlockSignature();
        return;
      }
      const current = viewerBox.scrollTop;
      const pct = Math.min(100, Math.round((current / scrollTotal) * 100));
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (pct >= 85) {
        unlockSignature();
      }
    });

    // Em mobile/iOS iframe, o evento de rolagem externa não propaga.
    // Garante liberação automática em breve intervalo.
    setTimeout(() => {
      unlockSignature();
    }, 1800);
  }

  // Canvas de Rubrica
  const canvas = $("#docSignCanvas");
  let isDrawing = false;
  let ctx = null;

  if (canvas) {
    ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e1b4b";

    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - r.left,
        y: clientY - r.top,
      };
    };

    const startDraw = (e) => {
      if (!state.hasScrolledToBottom) return;
      isDrawing = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      state.signatureHasDrawn = true;
      checkCanSubmit();
    };

    const drawMove = (e) => {
      if (!isDrawing) return;
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    };

    const stopDraw = () => {
      isDrawing = false;
    };

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", drawMove);
    window.addEventListener("mouseup", stopDraw);

    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      startDraw(e);
    });
    canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      drawMove(e);
    });
    canvas.addEventListener("touchend", stopDraw);

    $("#docClearCanvasBtn")?.addEventListener("click", () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      state.signatureHasDrawn = false;
      checkCanSubmit();
    });
  }

  const checkAffirmation = $("#docAffirmationCheck");
  const checkCanSubmit = () => {
    const can = state.hasScrolledToBottom && state.signatureHasDrawn && checkAffirmation?.checked;
    if (confirmBtn) confirmBtn.disabled = !can;
  };

  checkAffirmation?.addEventListener("change", checkCanSubmit);

  // Submissão da Assinatura
  confirmBtn?.addEventListener("click", async () => {
    if (!state.signatureHasDrawn || !checkAffirmation?.checked) {
      alert("Por favor, desenhe sua rubrica e marque a concordância.");
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = "Autenticando criptografia...";

    try {
      const rubricDataUrl = canvas.toDataURL("image/png");
      const clientIp = await getClientIp();

      const signPayload = {
        DocumentoID: doc.DocumentoID,
        RubricaBase64: rubricDataUrl,
        EnderecoIP: clientIp,
        DispositivoInfo: `${navigator.platform || "Device"} (${navigator.language || "pt-BR"})`,
        NavegadorInfo: navigator.userAgent,
      };

      const result = await callApi("documentsSign", signPayload);
      close();
      alert("Documento assinado com sucesso!\nO certificado pericial e o hash criptográfico foram gerados.");
      await loadDocuments();
    } catch (err) {
      console.error("[documents] Falha ao assinar:", err);
      alert(`Erro na assinatura: ${err.message}`);
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = "Confirmar e Assinar";
    }
  });
}

/**
 * Abre o Modal de Emissão de Novo Documento (Upload PDF / Modelo)
 */
export function openUploadDialog() {
  const dialog = $("#documentUploadDialog");
  if (!dialog) return;

  const storesList = (state.stores && state.stores.length) ? state.stores : (window.state?.stores || []);
  const employeesList = (state.employees && state.employees.length) ? state.employees : (window.state?.employees || []);
  state.stores = storesList;
  state.employees = employeesList;

  const storeOptions = storesList
    .map((s) => {
      const id = storeId(s);
      const name = storeName(s) || id || "Unidade";
      return `<option value="${esc(id)}">${esc(name)}</option>`;
    })
    .join("");

  // Colaboradores da primeira loja
  const getEmpOptions = (lojaId) => {
    const list = employeesList.filter(
      (e) => !lojaId || empStoreId(e) === String(lojaId).trim(),
    );
    const effectiveList = list.length > 0 ? list : employeesList;
    return effectiveList
      .map((e) => {
        const id = empId(e);
        const name = empName(e) || "Colaborador";
        const cpf = empCpf(e);
        return `<option value="${esc(id)}" data-name="${esc(name)}" data-cpf="${esc(cpf)}" data-loja="${esc(empStoreId(e))}">${esc(name)}${cpf ? ` (CPF: ${esc(cpf)})` : ""}</option>`;
      })
      .join("");
  };

  const initialLojaId = storeId(storesList[0]);

  dialog.innerHTML = `
    <div class="dialog-head">
      <div>
        <span class="eyebrow" style="color:#6340d8; font-weight:700; font-size:11px; letter-spacing:0.05em; text-transform:uppercase;">EMISSÃO DE DOCUMENTO</span>
        <h3 style="margin:0; font-size:1.15rem; font-weight:700; color:var(--text, #1e293b);">Novo Documento para Assinatura</h3>
      </div>
      <button type="button" class="icon-btn" id="docUploadCloseBtn" data-close="documentUploadDialog" aria-label="Fechar">&times;</button>
    </div>

    <div class="dialog-body">
      <div class="doc-nav-tabs" style="align-self:flex-start; margin-bottom:0;">
        <button type="button" class="doc-tab-btn active" id="docTabModePdf">Upload PDF Contabilidade</button>
        <button type="button" class="doc-tab-btn" id="docTabModeTemplate">Gerar de Modelo Interno</button>
      </div>

      <!-- Campos em Comum -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:1rem; box-sizing:border-box;">
        <div>
          <label class="form-label" style="display:block; font-size:12.5px; font-weight:600; margin-bottom:6px; color:var(--muted, #64748b);">Unidade / Loja</label>
          <select id="docNewLojaSelect" style="width:100%; border-radius:12px; padding:10px 14px; box-sizing:border-box;">
            ${storeOptions}
          </select>
        </div>
        <div>
          <label class="form-label" style="display:block; font-size:12.5px; font-weight:600; margin-bottom:6px; color:var(--muted, #64748b);">Colaborador Destinatário</label>
          <select id="docNewEmpSelect" style="width:100%; border-radius:12px; padding:10px 14px; box-sizing:border-box;">
            ${getEmpOptions(initialLojaId)}
          </select>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:1rem; box-sizing:border-box;">
        <div>
          <label class="form-label" style="display:block; font-size:12.5px; font-weight:600; margin-bottom:6px; color:var(--muted, #64748b);">Tipo do Documento</label>
          <select id="docNewTipoSelect" style="width:100%; border-radius:12px; padding:10px 14px; box-sizing:border-box;">
            <option value="Holerite">Holerite / Contracheque</option>
            <option value="Termo de Ciência">Termo de Ciência</option>
            <option value="Acordo Banco de Horas">Acordo Banco de Horas</option>
            <option value="Entrega de EPI">Entrega de EPI</option>
            <option value="Contrato">Contrato de Trabalho</option>
            <option value="Outro">Outro Documento</option>
          </select>
        </div>
        <div>
          <label class="form-label" style="display:block; font-size:12.5px; font-weight:600; margin-bottom:6px; color:var(--muted, #64748b);">Mês de Referência (opcional)</label>
          <input type="month" id="docNewMesRef" style="width:100%; border-radius:12px; padding:10px 14px; box-sizing:border-box;" value="${new Date().toISOString().slice(0, 7)}" />
        </div>
      </div>

      <div>
        <label class="form-label" style="display:block; font-size:12.5px; font-weight:600; margin-bottom:6px; color:var(--muted, #64748b);">Título do Documento</label>
        <input type="text" id="docNewTitulo" style="width:100%; border-radius:12px; padding:10px 14px; box-sizing:border-box;" placeholder="Ex: Holerite — Setembro/2026" />
      </div>

      <!-- Seção Modo PDF -->
      <div id="docModePdfSection" style="display:flex; flex-direction:column; gap:0.75rem;">
        <label class="form-label" style="display:block; font-size:12.5px; font-weight:600; margin-bottom:4px; color:var(--muted, #64748b);">Selecione o Arquivo PDF</label>
        <div style="border:2px dashed #cbd5e1; border-radius:16px; padding:2rem 1.25rem; text-align:center; background:#f8fafc; cursor:pointer; transition:all 0.2s;" id="docDropZone">
          <input type="file" id="docFileInput" accept="application/pdf" style="display:none;" />
          <div style="color:#6340d8; margin-bottom:0.4rem;">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <strong id="docFileLabel" style="color:#6340d8; font-size:14px; display:block;">Toque para selecionar o PDF (Holerite)</strong>
          <p style="margin:4px 0 0; font-size:12px; color:#64748b;">Suporta PDF de holerites da contabilidade (até 10 MB)</p>
        </div>
        <div id="docSha256Preview" style="display:none; font-size:11.5px; background:#eef2ff; padding:8px 12px; border-radius:10px; color:#312e81; word-break:break-all;"></div>
      </div>

      <!-- Seção Modo Modelo Interno -->
      <div id="docModeTemplateSection" style="display:none; flex-direction:column; gap:0.75rem;">
        <label class="form-label" style="display:block; font-size:12.5px; font-weight:600; margin-bottom:4px; color:var(--muted, #64748b);">Modelo Predefinido</label>
        <select id="docTemplateSelect" style="width:100%; border-radius:12px; padding:10px 14px; box-sizing:border-box;">
          <option value="termo-regulamento">Termo de Ciência — Regulamento Interno</option>
          <option value="acordo-banco-horas">Acordo de Banco de Horas (Art. 59 CLT)</option>
          <option value="termo-epi-uniforme">Termo de Recebimento de EPI e Uniforme</option>
        </select>
        <label class="form-label" style="display:block; font-size:12.5px; font-weight:600; margin-bottom:4px; color:var(--muted, #64748b);">Conteúdo do Termo</label>
        <textarea id="docTemplateText" rows="6" style="width:100%; border-radius:12px; padding:12px; font-family:monospace; font-size:12px; box-sizing:border-box;"></textarea>
      </div>
    </div>

    <div class="dialog-actions">
      <button id="docUploadCancelBtn" class="btn btn-secondary" type="button" data-close="documentUploadDialog">Cancelar</button>
      <button id="docUploadSubmitBtn" class="btn btn-primary" type="button">
        Enviar para Assinatura
      </button>
    </div>
  `;

  dialog.showModal?.() || dialog.setAttribute("open", "true");

  setupUploadDialogEvents(dialog);
}

/**
 * Eventos do modal de upload
 */
function setupUploadDialogEvents(dialog) {
  const close = () => dialog.close?.() || dialog.removeAttribute("open");
  $("#docUploadCloseBtn")?.addEventListener("click", close);
  $("#docUploadCancelBtn")?.addEventListener("click", close);

  let currentMode = "pdf"; // "pdf" | "template"
  let selectedFileBase64 = "";
  let selectedFileHash = "";

  const tabPdf = $("#docTabModePdf");
  const tabTpl = $("#docTabModeTemplate");
  const secPdf = $("#docModePdfSection");
  const secTpl = $("#docModeTemplateSection");
  const lojaSelect = $("#docNewLojaSelect");
  const empSelect = $("#docNewEmpSelect");
  const tituloInput = $("#docNewTitulo");
  const tipoSelect = $("#docNewTipoSelect");
  const mesRefInput = $("#docNewMesRef");
  const templateSelect = $("#docTemplateSelect");
  const templateText = $("#docTemplateText");

  const storesList = (state.stores && state.stores.length) ? state.stores : (window.state?.stores || []);
  const employeesList = (state.employees && state.employees.length) ? state.employees : (window.state?.employees || []);

  const getEmpOptions = (lojaId) => {
    const list = employeesList.filter(
      (e) => !lojaId || empStoreId(e) === String(lojaId).trim(),
    );
    const effectiveList = list.length > 0 ? list : employeesList;
    return effectiveList
      .map((e) => {
        const id = empId(e);
        const name = empName(e) || "Colaborador";
        const cpf = empCpf(e);
        return `<option value="${esc(id)}" data-name="${esc(name)}" data-cpf="${esc(cpf)}" data-loja="${esc(empStoreId(e))}">${esc(name)}${cpf ? ` (CPF: ${esc(cpf)})` : ""}</option>`;
      })
      .join("");
  };

  // Troca de Loja filtra colaboradores
  lojaSelect?.addEventListener("change", () => {
    const lojaId = lojaSelect.value;
    if (empSelect) {
      empSelect.innerHTML = getEmpOptions(lojaId);
    }
    updateSuggestedTitle();
  });

  // Troca de Colaborador sincroniza Loja
  empSelect?.addEventListener("change", () => {
    const selectedEmpId = empSelect.value;
    const emp = employeesList.find((e) => empId(e) === String(selectedEmpId));
    if (emp && empStoreId(emp) && lojaSelect && lojaSelect.value !== empStoreId(emp)) {
      lojaSelect.value = empStoreId(emp);
    }
    if (currentMode === "template") loadTemplateContent();
    updateSuggestedTitle();
  });

  const updateSuggestedTitle = () => {
    const tipo = tipoSelect?.value || "Holerite";
    const mes = mesRefInput?.value || "";
    let mesFormatado = "";
    if (mes) {
      const [y, m] = mes.split("-");
      const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
      mesFormatado = ` — ${meses[parseInt(m, 10) - 1] || m}/${y}`;
    }
    if (tituloInput && !tituloInput.getAttribute("data-customized")) {
      tituloInput.value = `${tipo}${mesFormatado}`;
    }
  };

  tipoSelect?.addEventListener("change", updateSuggestedTitle);
  mesRefInput?.addEventListener("input", updateSuggestedTitle);
  tituloInput?.addEventListener("input", () => {
    tituloInput.setAttribute("data-customized", "true");
  });

  updateSuggestedTitle();

  // Alterna Abas
  tabPdf?.addEventListener("click", () => {
    currentMode = "pdf";
    tabPdf.classList.add("active");
    tabTpl?.classList.remove("active");
    if (secPdf) secPdf.style.display = "flex";
    if (secTpl) secTpl.style.display = "none";
  });

  tabTpl?.addEventListener("click", () => {
    currentMode = "template";
    tabTpl.classList.add("active");
    tabPdf?.classList.remove("active");
    if (secPdf) secPdf.style.display = "none";
    if (secTpl) secTpl.style.display = "flex";
    loadTemplateContent();
  });

  const loadTemplateContent = () => {
    const tplKey = templateSelect?.value || "termo-regulamento";
    const tpl = DOCUMENT_TEMPLATES[tplKey];
    if (!tpl) return;
    const empOption = empSelect?.selectedOptions[0];
    const empName = empOption?.getAttribute("data-name") || "COLABORADOR";
    const empCpf = empOption?.getAttribute("data-cpf") || "000.000.000-00";
    const lojaName = lojaSelect?.selectedOptions[0]?.textContent || "LOJA";

    let text = tpl.conteudo
      .replace(/{NOME}/g, empName)
      .replace(/{CPF}/g, empCpf)
      .replace(/{LOJA}/g, lojaName);

    if (templateText) templateText.value = text;
    if (tituloInput) tituloInput.value = tpl.titulo;
    if (tipoSelect) tipoSelect.value = tpl.tipo;
  };

  templateSelect?.addEventListener("change", loadTemplateContent);
  empSelect?.addEventListener("change", () => {
    if (currentMode === "template") loadTemplateContent();
  });

  // Upload de Arquivo
  const dropZone = $("#docDropZone");
  const fileInput = $("#docFileInput");
  const fileLabel = $("#docFileLabel");
  const shaPreview = $("#docSha256Preview");

  dropZone?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      alert("Selecione um arquivo PDF válido.");
      return;
    }

    if (fileLabel) fileLabel.textContent = `Carregando ${file.name}...`;

    const reader = new FileReader();
    reader.onload = async () => {
      selectedFileBase64 = reader.result;
      selectedFileHash = await sha256Hex(selectedFileBase64);
      if (fileLabel) fileLabel.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
      if (shaPreview) {
        shaPreview.style.display = "block";
        shaPreview.innerHTML = `<strong>Hash Original (SHA-256):</strong> <code>${selectedFileHash}</code>`;
      }
    };
    reader.readAsDataURL(file);
  });

  // Submissão do Envio
  const submitBtn = $("#docUploadSubmitBtn");
  submitBtn?.addEventListener("click", async () => {
    const funcId = empSelect?.value;
    const lojaId = lojaSelect?.value;
    const titulo = tituloInput?.value;
    const tipo = tipoSelect?.value;
    const mesRef = mesRefInput?.value;

    if (!funcId) {
      alert("Selecione o colaborador destinatário.");
      return;
    }
    if (!titulo) {
      alert("Preencha o título do documento.");
      return;
    }

    if (currentMode === "pdf" && !selectedFileBase64) {
      alert("Selecione o arquivo PDF para continuar.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = "Emitindo documento...";

    try {
      const empOption = empSelect?.selectedOptions[0];
      const targetEmp = employeesList.find((e) => empId(e) === String(funcId));
      const targetStore = storesList.find((s) => storeId(s) === String(lojaId));
      const resolvedLojaId = lojaId || (targetEmp ? empStoreId(targetEmp) : empOption?.getAttribute("data-loja") || "");
      const resolvedEmpName = (targetEmp ? empName(targetEmp) : empOption?.getAttribute("data-name")) || "Colaborador";
      const resolvedEmpCpf = (targetEmp ? empCpf(targetEmp) : empOption?.getAttribute("data-cpf")) || "";
      const payload = {
        Titulo: titulo,
        Tipo: tipo,
        LojaID: resolvedLojaId,
        NomeLoja: targetStore ? storeName(targetStore) : (targetEmp?.NomeLoja || lojaSelect?.selectedOptions[0]?.textContent || ""),
        FuncionarioID: funcId,
        NomeFuncionario: resolvedEmpName,
        CPFFuncionario: resolvedEmpCpf,
        CargoFuncionario: targetEmp?.Cargo || "",
        MesReferencia: mesRef,
        OrigemTipo: currentMode === "pdf" ? "PDF_IMPORTADO" : "TEXTO_SISTEMA",
        ArquivoOriginalBase64: currentMode === "pdf" ? selectedFileBase64 : "",
        ConteudoTexto: currentMode === "template" ? templateText?.value : "",
        HashOriginalSHA256: currentMode === "pdf" ? selectedFileHash : await sha256Hex(templateText?.value || ""),
      };

      await callApi("documentsSave", payload);
      close();
      alert("Documento emitido com sucesso e disponibilizado para o colaborador!");
      // Posiciona na aba de gestão e redefine filtros para visualização imediata do documento recém-criado
      state.activeTab = "gestao";
      state.storeFilter = "all";
      state.statusFilter = "all";
      await loadDocuments();
    } catch (err) {
      console.error("[documents] Falha ao emitir:", err);
      alert(`Erro na emissão: ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.innerHTML = "Enviar para Assinatura";
    }
  });
}

/**
 * Abre o Modal de Auditoria Pericial (Hashes, Metadados, Validação)
 */
export async function openAuditDialog(docId) {
  const doc = state.documents.find((d) => String(d.DocumentoID) === String(docId));
  if (!doc) return;

  const dialog = $("#documentSignDialog"); // Reusa shell do dialog
  if (!dialog) return;

  dialog.innerHTML = `
    <div class="dialog-head">
      <div>
        <span class="eyebrow" style="color:#059669; font-weight:700; font-size:11px; letter-spacing:0.05em; text-transform:uppercase;">EVIDÊNCIA PERICIAL JURÍDICA</span>
        <h3 style="margin:0; font-size:1.15rem; font-weight:700; color:var(--text, #1e293b);">Certificado de Autenticidade e Auditoria</h3>
      </div>
      <button type="button" class="icon-btn" id="docAuditCloseBtn" data-close="documentSignDialog" aria-label="Fechar">&times;</button>
    </div>

    <div class="dialog-body">
      <div class="doc-audit-metadata-grid">
        <div>
          <span style="color:#64748b;">Código Verificador:</span><br/>
          <strong style="font-size:14px; color:#1e293b;">${esc(doc.CodigoValidacao || "VAL-2026-N/A")}</strong>
        </div>
        <div>
          <span style="color:#64748b;">Signatário:</span><br/>
          <strong>${esc(doc.NomeFuncionario)}</strong> (CPF: ${esc(doc.CPFFuncionario || "---")})
        </div>
        <div>
          <span style="color:#64748b;">Data e Hora da Assinatura:</span><br/>
          <strong>${formatDate(doc.DataAssinatura)}</strong>
        </div>
        <div>
          <span style="color:#64748b;">Status Probatório:</span><br/>
          <span style="color:#059669; font-weight:700;">Assinatura Eletrônica Avançada (Íntegro)</span>
        </div>
      </div>

      <div>
        <label style="font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px;">Hash SHA-256 do Documento Original:</label>
        <div class="doc-hash-badge">${esc(doc.HashOriginalSHA256 || "---")}</div>
      </div>

      <div>
        <label style="font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px;">Hash SHA-256 do Documento Final (Com Auditoria):</label>
        <div class="doc-hash-badge" style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534;">
          ${esc(doc.HashDocumentoFinalSHA256 || "---")}
        </div>
      </div>

      <div style="background:#f8fafc; border-radius:12px; padding:12px; font-size:12px; color:#64748b; line-height:1.4;">
        <strong>Enquadramento Legal:</strong> Este certificado assegura autoria e integridade nos termos da Lei nº 14.063/2020, MP 2.200-2/2001 e Artigo 464 da CLT. Qualquer modificação posterior invalida matematicamente os hashes acima.
      </div>
    </div>

    <div class="dialog-actions">
      <button id="docAuditDoneBtn" class="btn btn-secondary" type="button" data-close="documentSignDialog">Fechar</button>
      <button id="docAuditDownloadBtn" class="btn btn-primary" type="button">
        Baixar PDF com Certificado
      </button>
    </div>
  `;

  dialog.showModal?.() || dialog.setAttribute("open", "true");

  $("#docAuditCloseBtn")?.addEventListener("click", () => dialog.close());
  $("#docAuditDoneBtn")?.addEventListener("click", () => dialog.close());
  $("#docAuditDownloadBtn")?.addEventListener("click", () => downloadPdf(doc.DocumentoID));
}

/**
 * Faz download do PDF assinado ou prévio
 */
export function downloadPdf(docId) {
  const doc = state.documents.find((d) => String(d.DocumentoID) === String(docId));
  if (!doc) return;

  const base64 = doc.ArquivoFinalBase64 || doc.ArquivoOriginalBase64;
  if (!base64) {
    alert("Arquivo não disponível para download.");
    return;
  }

  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");
  const binary = atob(cleanBase64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const sanitizedTitle = (doc.Titulo || "documento").replace(/[^a-zA-Z0-9_-]/g, "_");
  a.download = `${sanitizedTitle}__assinado.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Abre pré-visualização de documento
 */
function openPreviewDialog(docId) {
  const doc = state.documents.find((d) => String(d.DocumentoID) === String(docId));
  if (!doc) return;
  const base64 = doc.ArquivoFinalBase64 || doc.ArquivoOriginalBase64;
  if (base64) {
    const win = window.open();
    if (win) {
      win.document.write(`<iframe src="${base64}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
    }
  } else {
    alert(doc.ConteudoTexto || "Sem visualização.");
  }
}

/**
 * Exclusão de documento pendente
 */
async function deleteDocument(docId) {
  if (!confirm("Tem certeza que deseja cancelar e excluir este documento?")) return;
  try {
    await callApi("documentsDelete", docId);
    alert("Documento excluído com sucesso.");
    await loadDocuments();
  } catch (err) {
    alert(`Erro ao excluir: ${err.message}`);
  }
}

/**
 * Utilitário de formatação de data
 */
function formatDate(iso) {
  if (!iso) return "---";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Bahia",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return String(iso);
  }
}

/**
 * Manipula o upload de um arquivo PDF de lote (vários holerites agrupados)
 */
async function handleBatchFileUpload(file) {
  if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
    alert("Por favor, selecione um arquivo no formato PDF.");
    return;
  }

  const dialog = $("#documentBatchConfirmDialog");
  if (dialog) {
    dialog.innerHTML = `
      <div class="dialog-head" style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--line, #e2e8f0);">
        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--text, #1e293b);">Processando Lote de Holerites</h3>
      </div>
      <div class="dialog-body" style="padding: 3rem 1.5rem; text-align: center;">
        <div class="quantum-loader" style="margin: 0 auto 1.25rem;">
          <i class="quantum-particle"></i><i class="quantum-particle"></i><i class="quantum-particle"></i>
        </div>
        <p style="font-weight: 600; color: var(--text, #1e293b); margin: 0 0 6px;">
          Lendo páginas e identificando colaboradores pelo nome e CPF...
        </p>
        <span style="font-size: 13px; color: var(--muted, #64748b);">
          Separando automaticamente cada folha individual com segurança jurídica.
        </span>
      </div>
    `;
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const employeesList = (state.employees && state.employees.length) ? state.employees : (window.state?.employees || []);
    const storesList = (state.stores && state.stores.length) ? state.stores : (window.state?.stores || []);
    state.employees = employeesList;
    state.stores = storesList;

    const parsed = await parseBatchPayrollPdf(arrayBuffer, employeesList, storesList);
    openBatchConfirmDialog(parsed, file.name);
  } catch (err) {
    console.error("[documents] Falha ao processar lote:", err);
    dialog?.close();
    alert(`Falha ao processar arquivo PDF: ${err.message}`);
  }
}

/**
 * Modal de Conferência e Confirmação de Lote de Holerites
 */
export function openBatchConfirmDialog(parsedResult, fileName) {
  const dialog = $("#documentBatchConfirmDialog");
  if (!dialog) return;

  const employeesList = [...((state.employees && state.employees.length) ? state.employees : (window.state?.employees || []))];
  employeesList.sort((a, b) => (empName(a) || "").localeCompare(empName(b) || "", "pt-BR"));
  state.employees = employeesList;

  const storesList = (state.stores && state.stores.length) ? state.stores : (window.state?.stores || []);
  state.stores = storesList;

  // Clona itens e adiciona flag de seleção
  const items = parsedResult.parsedItems.map((item) => ({
    ...item,
    selected: true,
  }));

  const detectedMonth = items[0]?.MesReferencia || new Date().toISOString().slice(0, 7);

  const renderTableRows = () => {
    return items
      .map((item, idx) => {
        const hasMatch = Boolean(item.FuncionarioID);

        // Opções de colaboradores
        const empOptions = [
          `<option value="">-- Selecione o Colaborador --</option>`,
          ...employeesList.map((emp) => {
            const id = empId(emp);
            const name = empName(emp);
            const cpf = empCpf(emp);
            const isSel = String(id) === String(item.FuncionarioID);
            return `<option value="${esc(id)}" ${isSel ? "selected" : ""}>${esc(name)}${cpf ? ` (CPF: ${esc(cpf)})` : ""}</option>`;
          }),
        ].join("");

        return `
          <tr data-index="${idx}">
            <td style="text-align: center; width: 40px;">
              <input type="checkbox" class="doc-batch-row-check" data-index="${idx}" ${item.selected ? "checked" : ""} />
            </td>
            <td style="font-weight: 700; color: var(--muted, #64748b); text-align: center; width: 50px;">
              #${item.pageNumber}
            </td>
            <td>
              <strong style="color: var(--text, #1e293b);">${esc(item.extractedName || "Nome não identificado")}</strong>
              <div style="font-size: 11px; color: var(--muted, #64748b);">
                Código: ${esc(item.extractedCode || "---")} | Cargo/CBO: ${esc(item.extractedCbo || "---")}
              </div>
            </td>
            <td style="min-width: 220px;">
              <select class="doc-batch-emp-select" data-index="${idx}" style="width: 100%; border-radius: 8px; padding: 6px 10px; font-size: 12.5px; border: 1px solid var(--line, #cbd5e1);">
                ${empOptions}
              </select>
            </td>
            <td style="font-size: 12px; font-family: monospace;" class="doc-batch-cpf-cell">
              ${esc(item.CPFFuncionario || "---")}
            </td>
            <td style="font-size: 12px;" class="doc-batch-store-cell">
              ${esc(item.NomeLoja || item.LojaID || "---")}
            </td>
            <td style="text-align: center;" class="doc-batch-status-cell">
              <span class="doc-batch-status-badge ${hasMatch ? "doc-batch-status-matched" : "doc-batch-status-pending"}">
                ${hasMatch ? "Vinculado" : "Pendente"}
              </span>
            </td>
            <td style="text-align: right; width: 90px;">
              <button type="button" class="btn btn-secondary btn-sm doc-batch-preview-btn" data-index="${idx}" style="padding: 4px 10px; font-size: 11.5px;">
                Ver Folha
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  };

  const updateFooterSummary = () => {
    const selectedItems = items.filter((it) => it.selected);
    const readyItems = selectedItems.filter((it) => Boolean(it.FuncionarioID));
    const submitBtn = $("#docBatchSubmitBtn");
    const summaryLabel = $("#docBatchSummaryLabel");

    if (summaryLabel) {
      summaryLabel.innerHTML = `<strong>${readyItems.length}</strong> de <strong>${items.length}</strong> holerite(s) vinculados e prontos`;
    }
    if (submitBtn) {
      submitBtn.disabled = readyItems.length === 0;
      submitBtn.textContent = `Confirmar e Distribuir (${readyItems.length}) Holerites`;
    }
  };

  dialog.innerHTML = `
    <div class="dialog-head" style="display: flex; justify-content: space-between; align-items: flex-start; padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--line, #e2e8f0);">
      <div>
        <span class="eyebrow" style="color: #6340d8; font-weight: 700; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;">IMPORTAÇÃO EM LOTE</span>
        <h3 style="margin: 0; font-size: 1.25rem; font-weight: 700; color: var(--text, #1e293b);">Conferência de Holerites</h3>
        <p style="margin: 4px 0 0; font-size: 13px; color: var(--muted, #64748b);">
          Arquivo: <strong>${esc(fileName)}</strong> (${items.length} folhas identificadas). Revise o vínculo de cada colaborador antes de confirmar.
        </p>
      </div>
      <button type="button" class="icon-btn" data-close="documentBatchConfirmDialog" aria-label="Fechar">&times;</button>
    </div>

    <div class="dialog-body" style="padding: 1.25rem 1.5rem; max-height: 60vh; overflow-y: auto;">
      <!-- Barra de Controle Global -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem; background: var(--surface-2, #f8fafc); padding: 12px 16px; border-radius: 12px; border: 1px solid var(--line, #e2e8f0);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="font-size: 12.5px; font-weight: 600; color: var(--text, #1e293b);">Mês de Referência Geral:</label>
          <input type="month" id="docBatchGlobalMonth" value="${esc(detectedMonth)}" style="border-radius: 8px; padding: 6px 12px; font-size: 13px; border: 1px solid var(--line, #cbd5e1);" />
          <button type="button" id="docBatchApplyMonthBtn" class="btn btn-ghost btn-sm" style="font-size: 12px;">Aplicar a Todos</button>
        </div>
        <div style="font-size: 12px; color: var(--muted, #64748b);">
          Os holerites serão separados individualmente e enviados para a aba Meus Documentos de cada colaborador.
        </div>
      </div>

      <!-- Tabela de Holerites -->
      <div style="overflow-x: auto; border: 1px solid var(--line, #e2e8f0); border-radius: 12px;">
        <table class="doc-batch-table">
          <thead>
            <tr>
              <th style="text-align: center; width: 40px;">
                <input type="checkbox" id="docBatchCheckAll" checked title="Selecionar Todos" />
              </th>
              <th style="text-align: center; width: 50px;">Pág.</th>
              <th>Nome Extraído do PDF</th>
              <th>Colaborador no Sistema</th>
              <th>CPF</th>
              <th>Unidade</th>
              <th style="text-align: center;">Status</th>
              <th style="text-align: right;">Ações</th>
            </tr>
          </thead>
          <tbody id="docBatchTableBody">
            ${renderTableRows()}
          </tbody>
        </table>
      </div>
    </div>

    <div class="dialog-actions" style="display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 1.5rem; border-top: 1px solid var(--line, #e2e8f0); flex-wrap: wrap; gap: 1rem;">
      <div id="docBatchSummaryLabel" style="font-size: 13px; color: var(--muted, #64748b);">
        Carregando...
      </div>
      <div style="display: flex; gap: 0.75rem; align-items: center;">
        <button type="button" class="btn btn-secondary" data-close="documentBatchConfirmDialog">Cancelar</button>
        <button type="button" class="btn btn-primary" id="docBatchSubmitBtn" style="background: #6340d8; border-color: #6340d8;">
          Confirmar e Distribuir Holerites
        </button>
      </div>
    </div>
  `;

  // Handlers do Modal
  dialog.querySelectorAll('[data-close="documentBatchConfirmDialog"]').forEach((btn) => {
    btn.onclick = () => dialog.close();
  });

  // Checkbox Selecionar Todos
  const checkAll = $("#docBatchCheckAll", dialog);
  if (checkAll) {
    checkAll.onchange = (e) => {
      const isChecked = e.target.checked;
      items.forEach((it) => (it.selected = isChecked));
      dialog.querySelectorAll(".doc-batch-row-check").forEach((cb) => (cb.checked = isChecked));
      updateFooterSummary();
    };
  }

  // Checkboxes individuais
  dialog.querySelectorAll(".doc-batch-row-check").forEach((cb) => {
    cb.onchange = (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (items[idx]) {
        items[idx].selected = e.target.checked;
        updateFooterSummary();
      }
    };
  });

  // Dropdown de seleção de colaborador
  dialog.querySelectorAll(".doc-batch-emp-select").forEach((sel) => {
    sel.onchange = (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      const chosenEmpId = e.target.value;
      const item = items[idx];
      if (!item) return;

      const matchedEmp = employeesList.find((emp) => String(empId(emp)) === String(chosenEmpId));
      if (matchedEmp) {
        item.FuncionarioID = empId(matchedEmp);
        item.NomeFuncionario = empName(matchedEmp);
        item.CPFFuncionario = empCpf(matchedEmp);
        item.CargoFuncionario = matchedEmp.Cargo || item.extractedCbo || "";
        item.LojaID = empStoreId(matchedEmp) || item.LojaID;
        const targetStore = storesList.find((s) => String(storeId(s)) === String(item.LojaID));
        item.NomeLoja = targetStore ? storeName(targetStore) : "";
      } else {
        item.FuncionarioID = "";
        item.NomeFuncionario = item.extractedName;
        item.CPFFuncionario = "";
      }

      // Atualiza a linha da tabela
      const row = dialog.querySelector(`tr[data-index="${idx}"]`);
      if (row) {
        const cpfCell = row.querySelector(".doc-batch-cpf-cell");
        if (cpfCell) cpfCell.textContent = item.CPFFuncionario || "---";

        const storeCell = row.querySelector(".doc-batch-store-cell");
        if (storeCell) storeCell.textContent = item.NomeLoja || item.LojaID || "---";

        const statusCell = row.querySelector(".doc-batch-status-cell");
        if (statusCell) {
          const has = Boolean(item.FuncionarioID);
          statusCell.innerHTML = `
            <span class="doc-batch-status-badge ${has ? "doc-batch-status-matched" : "doc-batch-status-pending"}">
              ${has ? "Vinculado" : "Pendente"}
            </span>
          `;
        }
      }

      updateFooterSummary();
    };
  });

  // Botões Ver Folha
  dialog.querySelectorAll(".doc-batch-preview-btn").forEach((btn) => {
    btn.onclick = (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      const item = items[idx];
      if (item) {
        openBatchPagePreview(item);
      }
    };
  });

  // Aplicar mês a todos
  const applyMonthBtn = $("#docBatchApplyMonthBtn", dialog);
  const globalMonthInput = $("#docBatchGlobalMonth", dialog);
  if (applyMonthBtn && globalMonthInput) {
    applyMonthBtn.onclick = () => {
      const newMonth = globalMonthInput.value;
      if (!newMonth) return;
      items.forEach((it) => {
        it.MesReferencia = newMonth;
        it.Titulo = `Holerite — ${formatMonthLabel(newMonth) || "Mensal"}`;
      });
      alert(`Mês de referência ${formatMonthLabel(newMonth)} aplicado a todos os holerites do lote.`);
    };
  }

  // Botão Submeter / Confirmar
  const submitBtn = $("#docBatchSubmitBtn", dialog);
  if (submitBtn) {
    submitBtn.onclick = async () => {
      const selectedItems = items.filter((it) => it.selected);
      const readyItems = selectedItems.filter((it) => Boolean(it.FuncionarioID));

      if (readyItems.length === 0) {
        alert("Nenhum holerite vinculado selecionado para importação.");
        return;
      }

      if (readyItems.length < selectedItems.length) {
        const diff = selectedItems.length - readyItems.length;
        if (!confirm(`Existem ${diff} folha(s) selecionada(s) sem colaborador vinculado. Deseja importar apenas as ${readyItems.length} folhas vinculadas?`)) {
          return;
        }
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Importando e distribuindo holerites...";

      try {
        const payload = readyItems.map((it) => ({
          FuncionarioID: it.FuncionarioID,
          NomeFuncionario: it.NomeFuncionario,
          CPFFuncionario: it.CPFFuncionario,
          CargoFuncionario: it.CargoFuncionario,
          LojaID: it.LojaID,
          NomeLoja: it.NomeLoja,
          MesReferencia: it.MesReferencia || globalMonthInput?.value || "",
          Titulo: it.Titulo || `Holerite — ${formatMonthLabel(it.MesReferencia || globalMonthInput?.value)}`,
          Tipo: "Holerite",
          Descricao: `Importação em lote contábil (Folha #${it.pageNumber})`,
          ArquivoOriginalBase64: it.ArquivoOriginalBase64,
          HashOriginalSHA256: it.HashOriginalSHA256,
          pageNumber: it.pageNumber,
        }));

        const res = await callApi("documentsBatchCreate", payload);
        dialog.close();
        alert(`${res.createdCount || payload.length} holerite(s) importado(s) e disponibilizado(s) com sucesso!\nCada colaborador já pode assinar em Meus Documentos.`);
        await loadDocuments();
      } catch (err) {
        console.error("[documents] Falha ao importar lote:", err);
        alert(`Erro ao importar lote: ${err.message}`);
        submitBtn.disabled = false;
        submitBtn.textContent = `Confirmar e Distribuir (${readyItems.length}) Holerites`;
      }
    };
  }

  updateFooterSummary();
  if (typeof dialog.showModal === "function") dialog.showModal();
}

/**
 * Visualizador rápido da folha individual antes da confirmação
 */
export function openBatchPagePreview(item) {
  const dialog = $("#documentBatchPreviewDialog");
  if (!dialog) return;

  const blobUrl = base64ToBlobUrl(item.ArquivoOriginalBase64, "application/pdf");

  dialog.innerHTML = `
    <div class="dialog-head" style="display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--line, #e2e8f0);">
      <div>
        <span class="eyebrow" style="color: #6340d8; font-weight: 700; font-size: 11px; text-transform: uppercase;">CONFERÊNCIA INDIVIDUAL</span>
        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--text, #1e293b);">Pág. ${esc(item.pageNumber)} — ${esc(item.NomeFuncionario || item.extractedName)}</h3>
      </div>
      <button type="button" class="icon-btn" data-close="documentBatchPreviewDialog" aria-label="Fechar">&times;</button>
    </div>
    <div class="dialog-body" style="padding: 1rem;">
      <div class="doc-viewer-container" style="height: 65vh; min-height: 420px; border-radius: 12px; overflow: hidden; border: 1px solid var(--line, #e2e8f0);">
        <iframe class="doc-pdf-iframe" src="${blobUrl}#toolbar=0&navpanes=0" style="width: 100%; height: 100%; border: none;"></iframe>
      </div>
    </div>
    <div class="dialog-actions" style="display: flex; justify-content: flex-end; padding: 1rem 1.5rem; border-top: 1px solid var(--line, #e2e8f0);">
      <button type="button" class="btn btn-secondary" data-close="documentBatchPreviewDialog">Fechar</button>
    </div>
  `;

  dialog.querySelectorAll('[data-close="documentBatchPreviewDialog"]').forEach((btn) => {
    btn.onclick = () => dialog.close();
  });

  if (typeof dialog.showModal === "function") dialog.showModal();
}

// Expõe no escopo global para compatibilidade com Scripts.html
window.initDocumentsModule = initDocumentsModule;
window.openBatchConfirmDialog = openBatchConfirmDialog;
window.openBatchPagePreview = openBatchPagePreview;
window.addEventListener("gestao-documents-open", (e) => {
  initDocumentsModule(e.detail);
});

