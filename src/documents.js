// ==========================================================================
// MÓDULO DE DOCUMENTOS & ASSINATURA ELETRÔNICA (FOLGAS 3.0)
// Grupo House 190 — Sistema Jurídico Avançado (Lei 14.063/2020 e Art. 464 CLT)
// ==========================================================================

import { DOCUMENT_TEMPLATES, sha256Hex, parseBatchPayrollPdf, formatMonthLabel } from "./core/api-documents.js";
import { SELFIE_DRIVE_UPLOAD_ENDPOINT } from "./selfie-drive-config.js";

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
  typeFilter: "all", // "all" | "atestado" | "holerite" | "termo"
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

async function ensureDocumentFullPayload(doc) {
  if (!doc) return doc;
  if (!doc.ArquivoOriginalBase64 && !doc.ArquivoFinalBase64) {
    try {
      const res = await callApi("documentsGet", doc.DocumentoID);
      const full = res?.data || res?.document || res;
      if (full) {
        Object.assign(doc, full);
      }
    } catch (err) {
      console.warn("Falha ao obter payload completo do documento:", err);
    }
  }
  return doc;
}

/**
 * Analisa e extrai dados de URLs do Google Drive para visualização direta e segura
 */
export function parseDriveUrl(url) {
  if (!url || typeof url !== "string") return null;
  const driveMatch = url.match(/(?:\/d\/|id=|open\?id=)([a-zA-Z0-9_-]{25,})/i);
  if (!driveMatch) return null;
  const fileId = driveMatch[1];
  return {
    fileId,
    previewUrl: `https://drive.google.com/file/d/${fileId}/preview`,
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
    directViewUrl: `https://lh3.googleusercontent.com/d/${fileId}`,
    openUrl: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`,
  };
}

/**
 * Comprime imagem ou lê PDF para envio seguro ao Google Drive
 */
async function compressMedicalDocument(file, maxDimension = 1280, quality = 0.78) {
  if (!file) throw new Error("Arquivo não fornecido.");
  if (file.type === "application/pdf") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ base64: reader.result, mimeType: "application/pdf" });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl, mimeType: "image/jpeg" });
      };
      img.onerror = () => {
        resolve({ base64: e.target.result, mimeType: file.type || "image/jpeg" });
      };
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Envia o atestado para a conta grupo190house@gmail.com no Google Drive
 */
async function uploadMedicalCertificateToDrive(file, employeeName = "Colaborador") {
  const endpoint = SELFIE_DRIVE_UPLOAD_ENDPOINT;
  const compressed = await compressMedicalDocument(file);
  const ext = file.type === "application/pdf" ? "pdf" : "jpg";
  const dateStr = new Date().toISOString().slice(0, 10);
  const cleanName = String(employeeName || "colaborador")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");
  const fileName = `atestado_${cleanName}_${dateStr}_${Date.now()}.${ext}`;

  if (!endpoint) {
    return { url: compressed.base64, base64: compressed.base64, fileName };
  }

  const payload = {
    action: "driveUpload",
    name: fileName,
    mimeType: compressed.mimeType,
    base64: compressed.base64,
  };

  const formData = new FormData();
  Object.entries(payload).forEach(([k, v]) => formData.append(k, v));

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("Servidor Google Drive indisponível temporariamente.");
    const json = await res.json().catch(() => ({}));
    const fileUrl = json.url || json.fileUrl;
    if (fileUrl) {
      return {
        url: fileUrl,
        fileId: json.fileId || "",
        base64: compressed.base64,
        fileName,
      };
    }
    return { url: compressed.base64, base64: compressed.base64, fileName };
  } catch (err) {
    console.warn("[documents] Falha no upload para o Google Drive, usando contingência:", err);
    return { url: compressed.base64, base64: compressed.base64, fileName };
  }
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
  if (context.activeTab) state.activeTab = context.activeTab;
  if (context.statusFilter) state.statusFilter = context.statusFilter;

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
 * Extrai iniciais para avatar estilo Apple iOS
 */
function getInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "HD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Classifica a categoria do documento: atestado, holerite ou termo
 */
function getDocCategory(doc) {
  const tipo = String(doc.Tipo || "").toLowerCase();
  const titulo = String(doc.Titulo || "").toLowerCase();
  if (tipo.includes("atestado") || titulo.includes("atestado")) return "atestado";
  if (tipo.includes("holerite") || titulo.includes("holerite") || Boolean(doc.MesReferencia && doc.MesReferencia !== "---")) return "holerite";
  return "termo";
}

/**
 * Normaliza o nome da loja para agrupamento limpo
 */
function canonicalStoreName(rawStore) {
  const s = String(rawStore || "Central").trim();
  if (/central/i.test(s)) return "Central";
  if (/teixeira/i.test(s)) return "House 190 Teixeira";
  if (/food\s*park/i.test(s)) return "House Food Park";
  return s;
}

/**
 * Renderiza uma linha minimalista de documento no padrão Apple iOS House 190
 */
function renderCleanDocRow(doc) {
  const isMed = getDocCategory(doc) === "atestado";
  const isHol = getDocCategory(doc) === "holerite";
  const isSigned = doc.Status === "Assinado" || doc.Status === "Aprovado";
  const isRejected = doc.Status === "Rejeitado";
  const isPending = doc.Status === "Pendente";

  const initials = getInitials(doc.NomeFuncionario);
  const avatarClass = isMed ? "medical" : isHol ? "payroll" : "contract";
  const tagClass = avatarClass;
  const tagLabel = isMed ? "Atestado Médico" : isHol ? "Holerite" : (doc.Tipo || "Documento");

  let descText = "";
  if (isMed) {
    const dias = doc.DiasAbono ? `${doc.DiasAbono} dia(s) a abonar` : "Abono solicitado";
    const periodo = doc.PeriodoAbono || doc.DataInicio || "";
    descText = `${dias} ${periodo ? `(${periodo})` : ""} ${doc.CRM ? `• CRM: ${doc.CRM}` : ""}`;
  } else if (isHol) {
    descText = `Mês de Referência: ${doc.MesReferencia || "---"} ${doc.CPFFuncionario ? `• CPF: ${doc.CPFFuncionario}` : ""}`;
  } else {
    descText = `${doc.Titulo || "Documento oficial"} ${doc.CPFFuncionario ? `• CPF: ${doc.CPFFuncionario}` : ""}`;
  }

  const dateDisplay = isSigned
    ? `Assinado em ${formatDateShort(doc.DataAssinatura || doc.DataEnvio)}`
    : `Enviado em ${formatDateShort(doc.DataEnvio)}`;

  let statusLabel = "Pendente";
  let statusClass = "pending";
  if (isMed) {
    if (doc.Status === "Aprovado") {
      statusLabel = "Abonado";
      statusClass = "approved";
    } else if (doc.Status === "Rejeitado") {
      statusLabel = "Recusado";
      statusClass = "rejected";
    } else {
      statusLabel = "Avaliação Pendente";
      statusClass = "pending";
    }
  } else if (isSigned) {
    statusLabel = "Assinado";
    statusClass = "signed";
  }

  return `
    <div class="doc-clean-row">
      <div class="doc-clean-left">
        <div class="doc-avatar ${avatarClass}">
          ${
            isMed
              ? `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
          `
              : initials
          }
        </div>
        <div class="doc-clean-info">
          <div class="doc-clean-name-row">
            <span class="doc-clean-name">${esc(doc.NomeFuncionario || "Colaborador")}</span>
            <span class="doc-clean-tag ${tagClass}">${esc(tagLabel)}</span>
          </div>
          <div class="doc-clean-desc">${esc(descText)}</div>
          <div class="doc-clean-subtext">${esc(dateDisplay)}</div>
        </div>
      </div>

      <div class="doc-clean-right">
        <span class="doc-clean-status ${statusClass}">
          ${statusLabel}
        </span>
        <div class="doc-clean-actions-wrap">
          ${
            isMed && isPending
              ? `
            <button class="doc-btn-evaluate" data-action="preview" data-id="${esc(doc.DocumentoID)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <span>Avaliar e Abonar</span>
            </button>
          `
              : isSigned
              ? `
            <button class="btn btn-secondary btn-sm" data-action="download" data-id="${esc(doc.DocumentoID)}" style="border-radius:10px; font-weight:600; padding:6px 12px; font-size:12.5px;">
              Baixar PDF
            </button>
            <button class="med-clean-icon-btn" data-action="audit" data-id="${esc(doc.DocumentoID)}" title="Ver Certificado e Hash">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </button>
          `
              : `
            <button class="btn btn-secondary btn-sm" data-action="preview" data-id="${esc(doc.DocumentoID)}" style="border-radius:10px; font-weight:600; padding:6px 12px; font-size:12.5px;">
              Visualizar
            </button>
            <button class="med-clean-icon-btn" data-action="notify-whatsapp" data-id="${esc(doc.DocumentoID)}" title="Cobrar assinatura via WhatsApp" style="color:#16a34a;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              </svg>
            </button>
            <button class="med-clean-icon-btn" data-action="delete" data-id="${esc(doc.DocumentoID)}" title="Excluir documento" style="color:#ef4444;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          `
          }
        </div>
      </div>
    </div>
  `;
}

/**
 * Renderiza Visão de Gestão (RH / Gerente / Admin) — Padrão Apple iOS House 190
 */
function renderManagerView() {
  const allDocs = state.documents;
  const total = allDocs.length;
  const pendentes = allDocs.filter((d) => d.Status === "Pendente").length;
  const assinados = allDocs.filter((d) => d.Status === "Assinado" || d.Status === "Aprovado").length;
  const compliance = total > 0 ? Math.round((assinados / total) * 100) : 100;

  // Contadores por Tipo de Documento
  const atestados = allDocs.filter((d) => getDocCategory(d) === "atestado");
  const atestadosPendentes = atestados.filter((d) => d.Status === "Pendente").length;
  const holerites = allDocs.filter((d) => getDocCategory(d) === "holerite");
  const holeritesPendentes = holerites.filter((d) => d.Status === "Pendente").length;
  const termos = allDocs.filter((d) => getDocCategory(d) === "termo");

  // Contadores por Loja
  const storeCounts = new Map();
  allDocs.forEach((d) => {
    const sName = canonicalStoreName(d.NomeLoja || d.LojaID);
    storeCounts.set(sName, (storeCounts.get(sName) || 0) + 1);
  });
  const uniqueStoreNames = [...storeCounts.keys()].sort();

  // Filtragem dos Documentos para Exibição
  const filteredDocs = allDocs.filter((doc) => {
    // 1. Tipo
    if (state.typeFilter && state.typeFilter !== "all") {
      const cat = getDocCategory(doc);
      if (cat !== state.typeFilter) return false;
    }

    // 2. Loja
    if (state.storeFilter && state.storeFilter !== "all") {
      const docStore = canonicalStoreName(doc.NomeLoja || doc.LojaID).toLowerCase();
      const target = canonicalStoreName(state.storeFilter).toLowerCase();
      if (!docStore.includes(target) && docStore !== target && String(doc.LojaID || "").toLowerCase() !== target) {
        return false;
      }
    }

    // 3. Status
    if (state.statusFilter && state.statusFilter !== "all") {
      if (state.statusFilter === "Pendente" && doc.Status !== "Pendente") return false;
      if (state.statusFilter === "Assinado" && doc.Status !== "Assinado" && doc.Status !== "Aprovado") return false;
    }

    return true;
  });

  // Agrupamento por Loja
  const groupsByStore = new Map();
  filteredDocs.forEach((doc) => {
    const sName = canonicalStoreName(doc.NomeLoja || doc.LojaID);
    if (!groupsByStore.has(sName)) {
      groupsByStore.set(sName, []);
    }
    groupsByStore.get(sName).push(doc);
  });

  // Renderização das Seções por Loja
  let storeGroupsHtml = "";
  if (filteredDocs.length === 0) {
    storeGroupsHtml = `
      <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:20px; padding:3rem 1.5rem; text-align:center;">
        <div style="width:48px; height:48px; border-radius:14px; background:#f1f5f9; color:#94a3b8; display:inline-flex; align-items:center; justify-content:center; margin-bottom:12px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <p style="margin:0 0 4px; font-weight:700; color:#0f172a; font-size:15px;">Nenhum documento encontrado</p>
        <p style="margin:0; font-size:13px; color:#64748b;">Ajuste os filtros de tipo de documento ou de loja para visualizar os registros.</p>
      </div>
    `;
  } else {
    storeGroupsHtml = [...groupsByStore.entries()]
      .map(([storeName, storeDocs]) => {
        const storePending = storeDocs.filter((d) => d.Status === "Pendente").length;
        return `
          <div class="doc-store-group">
            <div class="doc-store-header">
              <div class="doc-store-title-wrap">
                <div class="doc-store-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 21h18M3 7v14M21 7v14M6 21V11M18 21V11M6 7l6-4 6 4M10 21v-4a2 2 0 0 1 4 0v4"/>
                  </svg>
                </div>
                <div>
                  <h4 class="doc-store-title">${esc(storeName)}</h4>
                </div>
              </div>
              <div class="doc-store-meta">
                <span class="doc-badge-pill">${storeDocs.length} ${storeDocs.length === 1 ? "documento" : "documentos"}</span>
                ${storePending > 0 ? `<span class="doc-badge-pill doc-badge-pill-amber" style="margin-left:6px;">${storePending} pendente${storePending > 1 ? "s" : ""}</span>` : ""}
              </div>
            </div>
            <div class="doc-store-list">
              ${storeDocs.map(renderCleanDocRow).join("")}
            </div>
          </div>
        `;
      })
      .join("");
  }

  // Opções para o select legado invisível
  const storesList = (state.stores && state.stores.length) ? state.stores : (window.state?.stores || []);
  const storeOptions = [
    `<option value="all">Todas as Lojas</option>`,
    ...storesList.map((s) => {
      const id = storeId(s);
      const name = storeName(s) || id || "Unidade";
      return `<option value="${esc(id)}" ${state.storeFilter === id ? "selected" : ""}>${esc(name)}</option>`;
    }),
  ].join("");

  return `
    <div class="doc-mgmt-container">
      <!-- 1. Métricas Rápidas Estilo Apple -->
      <div class="doc-metric-grid">
        <div class="doc-metric-card" style="--metric-color: #6340d8;">
          <span>Total de Documentos</span>
          <strong>${total}</strong>
        </div>
        <div class="doc-metric-card" style="--metric-color: #f59e0b;">
          <span>Atestados Pendentes</span>
          <strong style="color: #d97706;">${atestadosPendentes}</strong>
        </div>
        <div class="doc-metric-card" style="--metric-color: #3b82f6;">
          <span>Holerites Emitidos</span>
          <strong style="color: #2563eb;">${holerites.length}</strong>
        </div>
        <div class="doc-metric-card" style="--metric-color: #10b981;">
          <span>Taxa de Conformidade</span>
          <strong style="color: #059669;">${compliance}%</strong>
        </div>
      </div>

      <!-- 2. Barra de Controle Superior (Segmented Control de Tipo & Ações) -->
      <div class="doc-mgmt-header">
        <div class="doc-segmented-control" role="tablist" aria-label="Tipos de Documentos">
          <button type="button" class="doc-segment-btn ${state.typeFilter === "all" ? "active" : ""}" data-type-filter="all">
            Todos
            <span class="doc-badge-pill">${total}</span>
          </button>
          <button type="button" class="doc-segment-btn ${state.typeFilter === "atestado" ? "active" : ""}" data-type-filter="atestado">
            Atestados Médicos
            ${atestadosPendentes > 0 ? `<span class="doc-badge-pill doc-badge-pill-amber">${atestadosPendentes}</span>` : `<span class="doc-badge-pill">${atestados.length}</span>`}
          </button>
          <button type="button" class="doc-segment-btn ${state.typeFilter === "holerite" ? "active" : ""}" data-type-filter="holerite">
            Holerites
            <span class="doc-badge-pill">${holerites.length}</span>
          </button>
          <button type="button" class="doc-segment-btn ${state.typeFilter === "termo" ? "active" : ""}" data-type-filter="termo">
            Contratos & Termos
            <span class="doc-badge-pill">${termos.length}</span>
          </button>
        </div>

        <div class="doc-mgmt-actions">
          <input type="file" id="docBatchFileInput" accept="application/pdf" style="display: none;" />
          <button type="button" id="docBatchUploadBtn" class="btn btn-secondary btn-sm" style="border-radius:12px; font-weight:600; padding:8px 14px; min-height:38px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Importar Lote (Holerites)
          </button>
          <button type="button" id="docNewTemplateBtn" class="btn btn-secondary btn-sm" style="border-radius:12px; font-weight:600; padding:8px 14px; min-height:38px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Emitir por Modelo
          </button>
          <button type="button" id="docVerifyBtn" class="btn btn-secondary btn-sm" title="Validação de autenticidade jurídica" style="border-radius:12px; font-weight:600; padding:8px 12px; min-height:38px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
            Verificar Autenticidade
          </button>
          <button type="button" id="docNewDocumentBtn" class="btn btn-primary btn-sm" style="border-radius:12px; font-weight:600; padding:8px 16px; min-height:38px; box-shadow:0 2px 8px rgba(99,64,216,0.25);">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Novo Documento / Holerite
          </button>
          <button type="button" id="docRefreshBtn" class="med-clean-icon-btn" title="Atualizar dados" style="width:38px; height:38px; border-radius:12px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          </button>
        </div>
      </div>

      <!-- 3. Sub-barra de Filtro de Lojas e Status -->
      <div class="doc-filters-subbar">
        <div class="doc-pills-scroll" role="tablist" aria-label="Filtro por Loja">
          <button type="button" class="doc-store-pill ${state.storeFilter === "all" ? "active" : ""}" data-store-filter="all">
            Todas as Unidades
            <span class="doc-badge-pill">${total}</span>
          </button>
          ${uniqueStoreNames
            .map((sName) => {
              const count = storeCounts.get(sName) || 0;
              const isActive = state.storeFilter === sName;
              return `
                <button type="button" class="doc-store-pill ${isActive ? "active" : ""}" data-store-filter="${esc(sName)}">
                  ${esc(sName)}
                  <span class="doc-badge-pill">${count}</span>
                </button>
              `;
            })
            .join("")}
        </div>

        <div class="doc-status-pills" role="tablist" aria-label="Filtro por Status">
          <button type="button" class="doc-status-pill-btn ${state.statusFilter === "all" ? "active" : ""}" data-status-filter="all">
            Todos
          </button>
          <button type="button" class="doc-status-pill-btn ${state.statusFilter === "Pendente" ? "active" : ""}" data-status-filter="Pendente">
            Pendentes (${pendentes})
          </button>
          <button type="button" class="doc-status-pill-btn ${state.statusFilter === "Assinado" ? "active" : ""}" data-status-filter="Assinado">
            Assinados (${assinados})
          </button>
        </div>

        <!-- Elementos ocultos para sincronização retrocompatível -->
        <select id="docStoreFilter" style="display:none;">
          ${storeOptions}
        </select>
        <select id="docStatusFilter" style="display:none;">
          <option value="all" ${state.statusFilter === "all" ? "selected" : ""}>Todos os Status</option>
          <option value="Pendente" ${state.statusFilter === "Pendente" ? "selected" : ""}>Pendentes</option>
          <option value="Assinado" ${state.statusFilter === "Assinado" ? "selected" : ""}>Assinados</option>
        </select>
      </div>

      <!-- 4. Lista Agrupada por Loja e por Tipo (Sem Poluição) -->
      <div class="doc-groups-container">
        ${storeGroupsHtml}
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
  const signed = myDocs.filter((d) => d.Status === "Assinado" || d.Status === "Aprovado");

  let displayDocs = [...myDocs];
  if (state.statusFilter && state.statusFilter !== "all") {
    if (state.statusFilter === "Pendente") {
      displayDocs = myDocs.filter((d) => d.Status === "Pendente");
    } else if (state.statusFilter === "Assinado") {
      displayDocs = myDocs.filter((d) => d.Status === "Assinado" || d.Status === "Aprovado");
    }
  }

  displayDocs.sort((a, b) => {
    if (a.Status === "Pendente" && b.Status !== "Pendente") return -1;
    if (a.Status !== "Pendente" && b.Status === "Pendente") return 1;
    return new Date(b.DataEnvio || 0) - new Date(a.DataEnvio || 0);
  });

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
  if (displayDocs.length === 0) {
    cardsHtml = `
      <div class="panel doc-empty-panel">
        <div class="doc-empty-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <p class="doc-empty-title">${state.statusFilter === "Pendente" ? "Nenhum documento pendente" : "Nenhum documento encontrado"}</p>
        <p class="doc-empty-desc">${state.statusFilter === "Pendente" ? "Todos os seus holerites, espelhos de ponto e comprovantes estão em dia." : "Nenhum documento localizado nesta categoria."}</p>
      </div>
    `;
  } else {
    cardsHtml = displayDocs
      .map((doc) => {
        const isMedical = doc.Tipo === "Atestado Médico" || String(doc.Titulo || "").toLowerCase().includes("atestado");
        if (isMedical) {
          const isApproved = doc.Status === "Aprovado";
          const isRejected = doc.Status === "Rejeitado";
          const fileUrl = doc.ArquivoUrl || (doc.ArquivoOriginalBase64 ? doc.ArquivoOriginalBase64 : "");
          const periodDisplay = formatMedicalFriendlyPeriod(doc.PeriodoAbono, doc.DataInicio, doc.DataFim);
          const daysNum = Number(doc.DiasAbono) || 1;
          const daysText = `${daysNum} dia${daysNum > 1 ? "s" : ""} abonado${daysNum > 1 ? "s" : ""}`;
          const pendingDaysText = `${daysNum} dia${daysNum > 1 ? "s" : ""} a abonar`;

          return `
            <div class="med-clean-card ${isApproved ? 'is-approved' : isRejected ? 'is-rejected' : 'is-pending'}">
              <div class="med-clean-top">
                <div class="med-clean-ident">
                  <div class="med-clean-icon ${isApproved ? 'success' : isRejected ? 'danger' : 'amber'}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="12" y1="18" x2="12" y2="12"/>
                      <line x1="9" y1="15" x2="15" y2="15"/>
                    </svg>
                  </div>
                  <div class="med-clean-texts">
                    <h4 class="med-clean-title">Atestado • ${esc(periodDisplay)}</h4>
                    <span class="med-clean-subtitle">${isApproved ? daysText : pendingDaysText}</span>
                  </div>
                </div>
                <span class="med-clean-pill ${isApproved ? 'pill-success' : isRejected ? 'pill-danger' : 'pill-amber'}">
                  ${isApproved ? 'Abonado' : isRejected ? 'Recusado' : 'Em análise'}
                </span>
              </div>

              ${doc.CRM || doc.Observacao ? `
                <div class="med-clean-info">
                  ${doc.CRM ? `<div>CRM: <strong>${esc(doc.CRM)}</strong></div>` : ''}
                  ${doc.Observacao ? `<div class="med-clean-obs">${esc(doc.Observacao)}</div>` : ''}
                </div>
              ` : ''}

              <div class="med-clean-footer">
                <span class="med-clean-meta">
                  ${isApproved ? `Aprovado pelo gestor em ${formatDateShort(doc.DataAprovacao || doc.DataEnvio)}` : isRejected ? `Recusado pelo gestor` : `Enviado em ${formatDateShort(doc.DataEnvio)}`}
                </span>
                <div class="med-clean-actions">
                  <button type="button" class="med-clean-btn" data-action="preview" data-id="${esc(doc.DocumentoID)}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span>Ver Detalhes</span>
                  </button>
                  ${fileUrl ? `
                    <a href="${esc(fileUrl)}" target="_blank" rel="noopener noreferrer" class="med-clean-icon-btn" title="Abrir no Google Drive">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                  ` : ""}
                </div>
              </div>
            </div>
          `;
        }

        const isSigned = doc.Status === "Assinado";
        const isHolerite = doc.Tipo === "Holerite" || String(doc.Titulo || "").toLowerCase().includes("holerite");
        const isEspelho = doc.Tipo === "Espelho de Ponto" || doc.OrigemTipo === "ESPELHO_PONTO" || String(doc.DocumentoID || "").startsWith("ESPELHO_");
        const docStore = doc.NomeLoja || doc.LojaID || "";
        const docRef = doc.MesReferencia && doc.MesReferencia !== "Geral" ? `Ref. ${doc.MesReferencia}` : "";
        const docSubtitle = [docStore, docRef].filter(Boolean).join(" • ") || "Documento oficial";

        return `
          <div class="med-clean-card ${isSigned ? 'is-approved' : 'is-pending'}">
            <div class="med-clean-top">
              <div class="med-clean-ident">
                <div class="med-clean-icon ${isHolerite ? 'purple' : isEspelho ? 'emerald' : 'blue'}">
                  ${
                    isHolerite
                      ? `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="2" y="4" width="20" height="16" rx="3"/>
                      <line x1="2" y1="10" x2="22" y2="10"/>
                      <line x1="6" y1="15" x2="10" y2="15"/>
                    </svg>
                  `
                      : isEspelho
                      ? `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                  `
                      : `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  `
                  }
                </div>
                <div class="med-clean-texts">
                  <h4 class="med-clean-title">${esc(doc.Titulo || "Documento")}</h4>
                  <span class="med-clean-subtitle">${esc(docSubtitle)}</span>
                </div>
              </div>
              <span class="med-clean-pill ${isSigned ? 'pill-success' : 'pill-amber'}">
                ${isSigned ? 'Assinado' : 'Pendente'}
              </span>
            </div>

            <div class="med-clean-footer">
              <span class="med-clean-meta">
                ${isSigned ? `Assinado em ${formatDateShort(doc.DataAssinatura || doc.DataEnvio)}` : `Aguardando assinatura`}
              </span>
              <div class="med-clean-actions">
                ${
                  !isSigned
                    ? `
                  <button type="button" class="doc-clean-sign-btn" data-action="sign" data-id="${esc(doc.DocumentoID)}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    <span>Assinar</span>
                  </button>
                `
                    : isEspelho
                    ? `
                  <button type="button" class="med-clean-btn" data-action="view-mirror" data-id="${esc(doc.DocumentoID)}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span>Ver Espelho</span>
                  </button>
                `
                    : `
                  <button type="button" class="med-clean-btn" data-action="download" data-id="${esc(doc.DocumentoID)}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>Baixar PDF</span>
                  </button>
                  <button type="button" class="med-clean-icon-btn" data-action="audit" data-id="${esc(doc.DocumentoID)}" title="Certificado & Hash">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  </button>
                `
                }
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  return `
    <div class="doc-employee-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:1.25rem;">
      <div>
        <p style="margin:0; font-size:13.5px; color:var(--muted, #64748b); font-weight:500;">
          Recibos, holerites, espelhos de ponto e atestados médicos para abono de ausências.
        </p>
      </div>
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <div class="doc-status-pills" role="tablist" aria-label="Filtro por Status">
          <button type="button" class="doc-status-pill-btn ${state.statusFilter === "all" ? "active" : ""}" data-status-filter="all">
            Todos (${myDocs.length})
          </button>
          <button type="button" class="doc-status-pill-btn ${state.statusFilter === "Pendente" ? "active" : ""}" data-status-filter="Pendente">
            Pendentes (${pending.length})
          </button>
          <button type="button" class="doc-status-pill-btn ${state.statusFilter === "Assinado" ? "active" : ""}" data-status-filter="Assinado">
            Assinados (${signed.length})
          </button>
        </div>
        <button type="button" class="btn btn-primary" id="btnOpenMedicalCertificate" style="border-radius:14px; min-height:44px; padding:0 1.25rem; font-weight:600; display:inline-flex; align-items:center; gap:8px; box-shadow:0 2px 8px rgba(99,64,216,0.25);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          <span>Enviar Atestado Médico</span>
        </button>
      </div>
    </div>
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

    const medBtn = e.target.closest("#btnOpenMedicalCertificate, [data-open-medical-cert]");
    if (medBtn) {
      openMedicalCertificateDialog();
      return;
    }

    const typeBtn = e.target.closest("[data-type-filter]");
    if (typeBtn) {
      state.typeFilter = typeBtn.getAttribute("data-type-filter") || "all";
      renderDocumentsView();
      return;
    }

    const storeBtn = e.target.closest("[data-store-filter]");
    if (storeBtn) {
      state.storeFilter = storeBtn.getAttribute("data-store-filter") || "all";
      renderDocumentsView();
      return;
    }

    const statusBtn = e.target.closest("[data-status-filter]");
    if (statusBtn) {
      state.statusFilter = statusBtn.getAttribute("data-status-filter") || "all";
      renderDocumentsView();
      return;
    }

    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn && actionBtn.closest("#documentsAppRoot")) {
      const action = actionBtn.getAttribute("data-action");
      const id = actionBtn.getAttribute("data-id");
      if (action === "sign") {
        if (id && String(id).startsWith("ESPELHO_") && typeof window.openTimeClockMirrorSign === "function") {
          const parts = String(id).split("_");
          const month = parts[1];
          const empId = parts.slice(2).join("_");
          window.openTimeClockMirrorSign(month, empId);
        } else {
          openSignDialog(id);
        }
      } else if (action === "view-mirror") {
        if (id && String(id).startsWith("ESPELHO_") && typeof window.openTimeClockMirrorSign === "function") {
          const parts = String(id).split("_");
          const month = parts[1];
          const empId = parts.slice(2).join("_");
          window.openTimeClockMirrorSign(month, empId);
        }
      } else if (action === "download") {
        downloadPdf(id);
      } else if (action === "audit") {
        openAuditDialog(id);
      } else if (action === "delete") {
        deleteDocument(id);
      } else if (action === "notify-whatsapp") {
        if (typeof window.notifyDocumentViaWhatsApp === "function") {
          window.notifyDocumentViaWhatsApp(id);
        }
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

  const newTemplateBtn = $("#docNewTemplateBtn");
  if (newTemplateBtn) {
    newTemplateBtn.onclick = () => openTemplateDialog();
  }

  const verifyBtn = $("#docVerifyBtn");
  if (verifyBtn) {
    verifyBtn.onclick = () => openVerifyDialog();
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

let pdfJsPromise = null;

/**
 * Carrega a biblioteca PDF.js de forma assíncrona com fallback
 */
export async function loadPdfJs() {
  if (typeof window !== "undefined" && window.pdfjsLib) {
    try {
      const workerUrl = new URL("./vendor/pdfjs/pdf.worker.min.js", window.location.href).href;
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    } catch (_) {}
    return window.pdfjsLib;
  }
  if (typeof document === "undefined") {
    return null;
  }
  if (!pdfJsPromise) {
    pdfJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./vendor/pdfjs/pdf.min.js";
      script.onload = () => {
        if (typeof window !== "undefined" && window.pdfjsLib) {
          try {
            const workerUrl = new URL("./vendor/pdfjs/pdf.worker.min.js", window.location.href).href;
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
          } catch (_) {}
          resolve(window.pdfjsLib);
        } else {
          reject(new Error("PDF.js não pôde ser inicializado"));
        }
      };
      script.onerror = () => reject(new Error("Falha ao carregar script do PDF.js"));
      document.head.appendChild(script);
    });
  }
  return pdfJsPromise;
}

/**
 * Converte base64 para Uint8Array para carregamento direto no PDF.js
 */
function base64ToUint8Array(base64Data) {
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
  return bytes;
}

/**
 * Renderiza todas as páginas do PDF em elementos canvas nativos com escala de alta resolução para celulares e desktop
 */
export async function renderPdfToContainer(containerEl, base64Pdf, blobUrl = "") {
  if (!containerEl) return;

  containerEl.innerHTML = `
    <div class="doc-pdf-loading-state">
      <div class="spinner" style="width:28px; height:28px; border:3px solid #cbd5e1; border-top-color:#4f46e5; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      <span style="font-size:12px; font-weight:600; color:#475569;">Carregando visualização do documento...</span>
    </div>
  `;

  try {
    const pdfjs = await loadPdfJs();
    if (!pdfjs) throw new Error("PDF.js indisponível");

    let loadingTask;
    if (base64Pdf) {
      const data = base64ToUint8Array(base64Pdf);
      loadingTask = pdfjs.getDocument({ data });
    } else if (blobUrl) {
      loadingTask = pdfjs.getDocument(blobUrl);
    } else {
      throw new Error("Arquivo PDF não fornecido");
    }

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    const wrapper = document.createElement("div");
    wrapper.className = "doc-pdf-canvas-wrapper";

    // Mede a largura do contêiner para calcular a escala nítida
    const containerWidth = Math.max(containerEl.clientWidth - 24, 300);

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const unscaledViewport = page.getViewport({ scale: 1.0 });

      // Escala para caber perfeitamente na largura do dispositivo
      const fitScale = containerWidth / unscaledViewport.width;
      // Multiplica pelo pixel ratio da tela (Retina / AMOLED) para nitidez máxima
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const renderScale = fitScale * dpr;

      const viewport = page.getViewport({ scale: renderScale });

      const pageContainer = document.createElement("div");
      pageContainer.className = "doc-pdf-page-container";
      pageContainer.style.maxWidth = `${Math.round(unscaledViewport.width * fitScale)}px`;

      const canvas = document.createElement("canvas");
      canvas.className = "doc-pdf-page-canvas";
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext("2d", { alpha: false });
      pageContainer.appendChild(canvas);
      wrapper.appendChild(pageContainer);

      await page.render({
        canvasContext: ctx,
        viewport: viewport,
      }).promise;
    }

    containerEl.innerHTML = "";
    containerEl.appendChild(wrapper);
    containerEl.scrollTop = 0;
  } catch (err) {
    console.warn("[documents] Falha ao renderizar PDF via canvas:", err);
    if (blobUrl) {
      containerEl.innerHTML = `<iframe class="doc-pdf-iframe" src="${blobUrl}#toolbar=0&navpanes=0"></iframe>`;
    } else {
      containerEl.innerHTML = `
        <div style="padding: 24px 16px; text-align: center; color: #64748b; font-size: 13px;">
          Não foi possível renderizar a visualização neste dispositivo.
        </div>
      `;
    }
  }
}


/**
 * Abre o Modal de Leitura Obrigatória e Assinatura Eletrônica
 */
export async function openSignDialog(docId) {
  let doc = state.documents.find((d) => String(d.DocumentoID) === String(docId));
  if (!doc) {
    alert("Documento não localizado.");
    return;
  }
  await ensureDocumentFullPayload(doc);

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
        Role o documento abaixo para conferir o conteúdo e liberar o campo de assinatura.
      </div>

      <div id="docViewerBox" class="doc-viewer-container" style="overflow-y: auto;">
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
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <strong style="font-size:13px; color:#1e293b;">Desenhe sua Rubrica no quadro abaixo:</strong>
          <div style="display:flex; align-items:center; gap:6px;">
            <button id="docRotateCanvasBtn" class="btn btn-secondary btn-sm" type="button" title="Girar tela para assinar com mais espaço na horizontal" style="border-radius:10px; font-weight:600; font-size:12px; padding:6px 12px; min-height:36px; display:inline-flex; align-items:center; gap:6px; color:#4338ca; background:#eef2ff; border:1px solid #c7d2fe;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="m14 2 3 3-3 3"/><path d="M5 2h9"/></svg>
              <span>Virar para Assinar</span>
            </button>
            <button id="docClearCanvasBtn" class="btn btn-ghost btn-sm" type="button">Limpar</button>
          </div>
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
      <button id="docPrintPhysicalBtn" class="btn btn-secondary" type="button" title="Imprimir este documento para assinatura física manuscrita em papel">
        Imprimir Via Física
      </button>
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

  // Imprimir via física manuscrita em papel
  $("#docPrintPhysicalBtn")?.addEventListener("click", () => {
    if (doc.TipoConteudo === "pdf" && pdfBlobUrl) {
      window.open(pdfBlobUrl, "_blank");
      return;
    }
    printDocumentTextPhysical(doc);
  });

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
      if (scrollTotal <= 20) {
        unlockSignature();
        return;
      }
      const current = viewerBox.scrollTop;
      const pct = Math.min(100, Math.round((current / scrollTotal) * 100));
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (pct >= 80) {
        unlockSignature();
      }
    });

    // Se o documento for de página única ou altura reduzida, desbloqueia automaticamente
    setTimeout(() => {
      if (viewerBox.scrollHeight <= viewerBox.clientHeight + 40) {
        unlockSignature();
      }
    }, 1500);

    if (doc.ArquivoOriginalBase64) {
      renderPdfToContainer(viewerBox, doc.ArquivoOriginalBase64, pdfBlobUrl);
    }
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

    $("#docRotateCanvasBtn")?.addEventListener("click", () => {
      if (!state.hasScrolledToBottom) {
        alert("Por favor, confira o documento até o final para liberar a assinatura.");
        return;
      }
      openLandscapeSignatureModal({
        targetCanvas: canvas,
        onConfirm: () => {
          state.signatureHasDrawn = true;
          checkCanSubmit();
        },
      });
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
 * Abre o Modal de Assinatura em Modo Paisagem / Tela Cheia (Girar Tela)
 * Usa um <dialog> nativo com showModal() para entrar no top layer do navegador,
 * garantindo que apareça acima de qualquer outro dialog aberto (mesmo no iOS Safari).
 * Suporta rotação CSS de 90° para dispositivos com bloqueio de orientação ativo.
 */
export function openLandscapeSignatureModal({ targetCanvas, onConfirm } = {}) {
  document.querySelector("#docLandscapeSignDialog")?.remove();

  // <dialog> nativo: garante que fica acima de qualquer outro modal (top layer)
  const dlg = document.createElement("dialog");
  dlg.id = "docLandscapeSignDialog";
  dlg.style.cssText = [
    "padding:0",
    "border:none",
    "border-radius:0",
    "background:#fff",
    "width:100dvw",
    "max-width:100dvw",
    "height:100dvh",
    "max-height:100dvh",
    "margin:0",
    "display:flex",
    "flex-direction:column",
    "overflow:hidden",
    "box-sizing:border-box",
    "z-index:100000",
  ].join(";");

  // Se o dispositivo estiver em modo retrato em tela estreita, ativa rotação CSS de 90°
  const isMobilePortrait = window.innerHeight > window.innerWidth && window.innerWidth < 768;
  let isRotated90 = isMobilePortrait;

  const innerWrapId = "docLandscapeInnerWrap";

  dlg.innerHTML = `
    <style>
      #docLandscapeSignDialog::backdrop { background: rgba(0,0,0,0.7); }
      #${innerWrapId} {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        transition: transform 0.3s cubic-bezier(0.16,1,0.3,1);
        transform-origin: center center;
      }
      #${innerWrapId}.rotated-90 {
        width: 100dvh;
        height: 100dvw;
        transform: rotate(90deg) translateX(0);
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(90deg);
      }
    </style>

    <div id="${innerWrapId}"${isRotated90 ? ' class="rotated-90"' : ''}>
      <div class="doc-landscape-header">
        <div class="doc-landscape-title-group">
          <span class="doc-landscape-eyebrow">Modo Paisagem</span>
          <h3 class="doc-landscape-title">Assinatura na Horizontal</h3>
          <span class="doc-landscape-hint">${isRotated90 ? "Canvas girado 90° — assine normalmente" : "Gire o celular de lado ou toque em Girar 90°"}</span>
        </div>
        <div class="doc-landscape-actions-top">
          <button type="button" id="docLandscapeRotateToggleBtn" class="btn btn-secondary btn-sm" style="border-radius:10px; font-weight:600; font-size:12px; padding:6px 10px; min-height:36px; display:inline-flex; align-items:center; gap:5px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85.83 6.72 2.24L21 8"/><path d="M21 3v5h-5"/></svg>
            <span id="docLandscapeRotateLabel">${isRotated90 ? "Desfazer giro" : "Girar 90°"}</span>
          </button>
          <button type="button" id="docLandscapeClearBtn" class="btn btn-ghost btn-sm" style="font-weight:600; min-height:36px;">Limpar</button>
          <button type="button" id="docLandscapeCloseBtn" class="icon-btn" aria-label="Fechar" style="font-size:22px; width:36px; height:36px;">&times;</button>
        </div>
      </div>

      <div class="doc-landscape-body">
        <div class="doc-landscape-canvas-wrap">
          <canvas id="docLandscapeCanvas"></canvas>
          <div class="doc-landscape-baseline">
            <span>Rubrica Manuscreve</span>
            <span>Assinatura Digital</span>
          </div>
        </div>
      </div>

      <div class="doc-landscape-footer">
        <button type="button" id="docLandscapeCancelBtn" class="btn btn-secondary" style="min-width:110px;">Cancelar</button>
        <button type="button" id="docLandscapeConfirmBtn" class="btn btn-primary" style="flex:1; max-width:360px; box-shadow:0 4px 14px rgba(99,64,216,0.25);">
          Concluir Rubrica
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(dlg);

  // Usa showModal() para entrar no top layer — garante z-index acima de tudo
  dlg.showModal();

  const innerWrap = dlg.querySelector(`#${innerWrapId}`);
  const rotateLabel = dlg.querySelector("#docLandscapeRotateLabel");
  const rotateHint = dlg.querySelector(".doc-landscape-hint");
  const lCanvas = dlg.querySelector("#docLandscapeCanvas");
  const lCtx = lCanvas.getContext("2d");
  let hasDrawn = false;
  let isDrawing = false;

  const resizeLandscapeCanvas = () => {
    const wrap = lCanvas.parentElement;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Dimensões reais do canvas de desenho (independente da rotação visual)
    const currentW = Math.max(120, Math.round(rect.width || 300));
    const currentH = Math.max(80, Math.round(rect.height || 180));

    let prevData = null;
    if (hasDrawn && lCanvas.width > 0 && lCanvas.height > 0) {
      try { prevData = lCanvas.toDataURL("image/png"); } catch (_) {}
    }

    lCanvas.width = currentW * dpr;
    lCanvas.height = currentH * dpr;
    lCanvas.style.width = "100%";
    lCanvas.style.height = "100%";

    lCtx.scale(dpr, dpr);
    lCtx.lineWidth = 2.8;
    lCtx.lineCap = "round";
    lCtx.lineJoin = "round";
    lCtx.strokeStyle = "#1e1b4b";

    if (prevData) {
      const img = new Image();
      img.onload = () => lCtx.drawImage(img, 0, 0, currentW, currentH);
      img.src = prevData;
    }
  };

  resizeLandscapeCanvas();
  setTimeout(resizeLandscapeCanvas, 80);
  setTimeout(resizeLandscapeCanvas, 350);

  // Coordenadas do canvas com remapeamento para rotação CSS.
  // CSS transform: rotate(90deg) gira o VISUAL mas NÃO transforma os eventos de toque —
  // o toque ainda chega em coordenadas de tela (portrait). Quando rotacionado 90° CW:
  //   canvas_x = canvas.width  * (1 - ry/rect.height)
  //   canvas_y = canvas.height * (rx / rect.width)
  // onde rx = clientX - rect.left, ry = clientY - rect.top
  const getPos = (e) => {
    const r = lCanvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    const rx = touch.clientX - r.left;
    const ry = touch.clientY - r.top;
    const dpr = window.devicePixelRatio || 1;
    const cW = lCanvas.width / dpr;   // largura lógica do canvas
    const cH = lCanvas.height / dpr;  // altura  lógica do canvas

    if (isRotated90) {
      // Rotação 90° horária: mover dedo →  →  traço ↑  no canvas
      const x = cW * (1 - ry / r.height);
      const y = cH * (rx / r.width);
      return {
        x: Math.max(0, Math.min(cW, x)),
        y: Math.max(0, Math.min(cH, y)),
      };
    }
    // Sem rotação: mapeamento direto
    return {
      x: Math.max(0, Math.min(cW, rx * (cW / r.width))),
      y: Math.max(0, Math.min(cH, ry * (cH / r.height))),
    };
  };

  const startDraw = (e) => {
    isDrawing = true;
    hasDrawn = true;
    const pos = getPos(e);
    lCtx.beginPath();
    lCtx.moveTo(pos.x, pos.y);
  };

  const drawMove = (e) => {
    if (!isDrawing) return;
    const pos = getPos(e);
    lCtx.lineTo(pos.x, pos.y);
    lCtx.stroke();
  };

  const stopDraw = () => { isDrawing = false; };

  lCanvas.addEventListener("mousedown", startDraw);
  lCanvas.addEventListener("mousemove", drawMove);
  window.addEventListener("mouseup", stopDraw);

  lCanvas.addEventListener("touchstart", (e) => { e.preventDefault(); startDraw(e); }, { passive: false });
  lCanvas.addEventListener("touchmove",  (e) => { e.preventDefault(); drawMove(e); },  { passive: false });
  lCanvas.addEventListener("touchend", stopDraw);

  // Botão Girar / Desfazer giro
  dlg.querySelector("#docLandscapeRotateToggleBtn")?.addEventListener("click", () => {
    isRotated90 = !isRotated90;
    innerWrap.classList.toggle("rotated-90", isRotated90);
    if (rotateLabel) rotateLabel.textContent = isRotated90 ? "Desfazer giro" : "Girar 90°";
    if (rotateHint) rotateHint.textContent = isRotated90 ? "Canvas girado 90° — assine normalmente" : "Gire o celular de lado ou toque em Girar 90°";
    setTimeout(resizeLandscapeCanvas, 120);
    setTimeout(resizeLandscapeCanvas, 380);
  });

  // Monitora rotação física do aparelho
  const onOrientationChange = () => {
    const isPhysicalLandscape = window.innerWidth > window.innerHeight;
    if (isPhysicalLandscape && isRotated90) {
      isRotated90 = false;
      innerWrap.classList.remove("rotated-90");
      if (rotateLabel) rotateLabel.textContent = "Girar 90°";
      if (rotateHint) rotateHint.textContent = "Gire o celular de lado ou toque em Girar 90°";
    }
    setTimeout(resizeLandscapeCanvas, 150);
  };
  window.addEventListener("orientationchange", onOrientationChange);
  window.addEventListener("resize", onOrientationChange);

  // Limpar
  dlg.querySelector("#docLandscapeClearBtn")?.addEventListener("click", () => {
    lCtx.clearRect(0, 0, lCanvas.width, lCanvas.height);
    hasDrawn = false;
  });

  const closeDlg = () => {
    window.removeEventListener("mouseup", stopDraw);
    window.removeEventListener("orientationchange", onOrientationChange);
    window.removeEventListener("resize", onOrientationChange);
    dlg.close();
    dlg.remove();
  };

  dlg.querySelector("#docLandscapeCloseBtn")?.addEventListener("click", closeDlg);
  dlg.querySelector("#docLandscapeCancelBtn")?.addEventListener("click", closeDlg);

  // Fechar ao pressionar Escape
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDlg();
  });

  // Confirmar e transferir rubrica para o canvas de destino
  dlg.querySelector("#docLandscapeConfirmBtn")?.addEventListener("click", () => {
    if (!hasDrawn) {
      alert("Por favor, desenhe sua rubrica antes de confirmar.");
      return;
    }

    const landscapeDataUrl = lCanvas.toDataURL("image/png");

    if (targetCanvas) {
      const tCtx = targetCanvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const tRect = targetCanvas.getBoundingClientRect();
      const tw = tRect.width || 320;
      const th = tRect.height || 140;

      targetCanvas.width = tw * dpr;
      targetCanvas.height = th * dpr;
      tCtx.scale(dpr, dpr);
      tCtx.clearRect(0, 0, tw, th);

      const img = new Image();
      img.onload = () => {
        const aspect = img.width / img.height;
        let dw = tw * 0.88;
        let dh = dw / aspect;
        if (dh > th * 0.82) { dh = th * 0.82; dw = dh * aspect; }
        const dx = (tw - dw) / 2;
        const dy = (th - dh) / 2;
        tCtx.drawImage(img, dx, dy, dw, dh);
        closeDlg();
        if (typeof onConfirm === "function") onConfirm(landscapeDataUrl);
      };
      img.src = landscapeDataUrl;
    } else {
      closeDlg();
      if (typeof onConfirm === "function") onConfirm(landscapeDataUrl);
    }
  });
}

/**
 * Abre janela de impressão limpa e padronizada A4 para assinatura física em papel
 */
export function printDocumentTextPhysical(doc) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Por favor, permita popups para imprimir a folha de assinatura física.");
    return;
  }
  const dateFormatted = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Bahia",
  }).format(new Date());

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${esc(doc.Titulo || "Documento Oficial")}</title>
  <style>
    @page { size: A4 portrait; margin: 20mm 15mm 20mm 15mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.5;
      font-size: 11pt;
      margin: 0;
      padding: 24px;
    }
    .header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .header-top {
      font-size: 13.5pt;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: #0f172a;
    }
    .header-sub {
      font-size: 9.5pt;
      color: #475569;
      margin-top: 3px;
    }
    .title {
      font-size: 12pt;
      font-weight: 700;
      text-align: center;
      margin: 24px 0 20px 0;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 9.5pt;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    .content {
      white-space: pre-wrap;
      text-align: justify;
      font-size: 10pt;
      line-height: 1.6;
      margin-bottom: 35px;
    }
    .location-date {
      text-align: right;
      font-size: 10pt;
      margin-bottom: 45px;
    }
    .signatures {
      display: flex;
      justify-content: space-around;
      gap: 30px;
      page-break-inside: avoid;
    }
    .sig-block {
      flex: 1;
      text-align: center;
      font-size: 9.5pt;
    }
    .sig-line {
      border-top: 1px solid #0f172a;
      margin-bottom: 8px;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">GRUPO HOUSE 190</div>
    <div class="header-sub">Gestão de Recursos Humanos &bull; Unidade: ${esc(doc.NomeLoja || doc.LojaID || "Matriz")}</div>
  </div>

  <div class="meta-box">
    <div><strong>Colaborador(a):</strong> ${esc(doc.NomeFuncionario)}</div>
    <div><strong>CPF:</strong> ${esc(doc.CPFFuncionario || "---")}</div>
    <div><strong>Emissão:</strong> ${dateFormatted}</div>
  </div>

  <div class="title">${esc(doc.Titulo)}</div>

  <div class="content">${esc(doc.ConteudoTexto || "")}</div>

  <div class="location-date">
    Teixeira de Freitas - BA, ${dateFormatted}.
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-line"></div>
      <strong>${esc(doc.NomeFuncionario)}</strong><br />
      Colaborador(a) &bull; CPF: ${esc(doc.CPFFuncionario || "---")}
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <strong>GRUPO HOUSE 190</strong><br />
      Empregador &bull; Recursos Humanos
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 350);
    };
  <\/script>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

/**
 * Abre o modal para envio de atestado médico com abono de faltas — Padrão Apple iOS Sheet
 */
export function openMedicalCertificateDialog(options = {}) {
  let dialog = $("#medicalCertificateDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "medicalCertificateDialog";
    dialog.className = "document-modal";
    dialog.style.maxWidth = "440px";
    dialog.style.width = "92vw";
    document.body.appendChild(dialog);
  }

  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = options.defaultDate || today;

  let isPeriodMode = false;
  let showOptionals = false;
  let selectedFile = null;
  let fileBase64 = "";
  let crmValue = "";
  let reasonValue = "";

  const renderModalContent = () => {
    dialog.innerHTML = `
      <div class="med-sheet-handle" aria-hidden="true"></div>
      
      <div class="med-header">
        <div>
          <h3 class="med-header-title">Atestado Médico</h3>
          <p class="med-header-sub">Envie o comprovante para abonar suas faltas</p>
        </div>
        <button type="button" class="med-close-pill" id="medCloseBtn" aria-label="Fechar">&times;</button>
      </div>

      <div class="med-body">
        <!-- Segmented Control iOS -->
        <div class="med-segmented">
          <button type="button" id="medToggleSingle" class="med-seg-btn ${!isPeriodMode ? 'active' : ''}">
            1 Único Dia
          </button>
          <button type="button" id="medTogglePeriod" class="med-seg-btn ${isPeriodMode ? 'active' : ''}">
            Vários Dias (Período)
          </button>
        </div>

        <!-- Seletor de Datas Espaçado e Elegante -->
        <div class="med-dates-wrapper">
          ${
            !isPeriodMode
              ? `
            <div class="med-date-block single">
              <div class="med-date-block-header">
                <span class="med-date-badge-step">Data da Ausência</span>
                <span class="med-date-hint">Dia a ser abonado pelo atestado</span>
              </div>
              <input type="date" id="medSingleDate" class="med-date-field" value="${defaultDate}" />
              <div class="med-badge-abono" style="margin-top: 4px;">1 dia a ser abonado</div>
            </div>
          `
              : `
            <div class="med-period-container">
              <div class="med-date-block">
                <div class="med-date-block-header">
                  <span class="med-date-badge-step">Primeiro Dia</span>
                  <span class="med-date-hint">Início do afastamento</span>
                </div>
                <input type="date" id="medStartDate" class="med-date-field" value="${defaultDate}" />
              </div>

              <div class="med-date-flow-indicator">
                <span class="med-date-flow-line"></span>
                <span class="med-date-flow-label">até</span>
                <span class="med-date-flow-line"></span>
              </div>

              <div class="med-date-block">
                <div class="med-date-block-header">
                  <span class="med-date-badge-step">Último Dia</span>
                  <span class="med-date-hint">Término do afastamento</span>
                </div>
                <input type="date" id="medEndDate" class="med-date-field" value="${defaultDate}" />
              </div>

              <div id="medPeriodSummary" class="med-badge-abono">1 dia a ser abonado</div>
            </div>
          `
          }
        </div>

        <!-- Card de Anexo Inteligente -->
        <input type="file" id="medCameraInput" accept="image/*" capture="environment" style="display:none;" />
        <input type="file" id="medFileInput" accept="image/*,application/pdf" style="display:none;" />

        ${
          !selectedFile
            ? `
          <div class="med-attachment-card">
            <div style="color: #6340d8; margin-bottom: 4px;">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
            <strong style="font-size: 13.5px; color: #0f172a; display: block;">Anexar Atestado</strong>
            <span style="font-size: 11.5px; color: #64748b;">Tire uma foto ou escolha o PDF</span>

            <div class="med-upload-actions-grid">
              <button type="button" id="medBtnCamera" class="med-upload-btn primary">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Fotografar
              </button>
              <button type="button" id="medBtnFile" class="med-upload-btn">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                Arquivo / PDF
              </button>
            </div>
          </div>
        `
            : `
          <div class="med-file-preview-card">
            <div class="med-file-info">
              ${
                fileBase64 && fileBase64.startsWith("data:image/")
                  ? `<img src="${fileBase64}" class="med-file-thumb" alt="Prévia" />`
                  : `<div class="med-file-thumb" style="display:flex;align-items:center;justify-content:center;background:#dcfce7;color:#059669;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`
              }
              <div class="med-file-meta">
                <div class="med-file-name">${esc(selectedFile.name)}</div>
                <div class="med-file-size">${(selectedFile.size / 1024).toFixed(1)} KB · Anexado com sucesso</div>
              </div>
            </div>
            <button type="button" id="medBtnRemoveFile" class="btn btn-ghost btn-sm" style="color: #ef4444; font-size: 12px; padding: 4px 8px;">Trocar</button>
          </div>
        `
        }

        <!-- Accordion de Opcionais (Sem poluição) -->
        <div>
          <button type="button" id="medToggleOptionals" class="med-optional-trigger">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:${showOptionals ? 'rotate(90deg)' : 'rotate(0)'}; transition:transform 0.2s;"><polyline points="9 18 15 12 9 6"/></svg>
            <span>${showOptionals ? 'Ocultar detalhes adicionais' : '+ Adicionar CRM ou observações (opcional)'}</span>
          </button>
          
          ${
            showOptionals
              ? `
            <div class="med-optional-panel">
              <input type="text" id="medCrmInput" class="med-input-subtle" placeholder="CRM do médico ou local (ex: CRM-BA 12345)" value="${esc(crmValue)}" />
              <textarea id="medReasonInput" class="med-input-subtle" rows="2" placeholder="Observações do afastamento...">${esc(reasonValue)}</textarea>
            </div>
          `
              : ''
          }
        </div>

        <div id="medFeedbackMsg" style="display:none; font-size:12.5px; padding:10px 12px; border-radius:10px;"></div>
      </div>

      <div class="med-footer">
        <button type="button" id="medSubmitBtn" class="med-submit-btn">
          <span>Enviar Atestado</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </button>
        <button type="button" id="medCancelBtn" class="med-cancel-link">Cancelar</button>
      </div>
    `;

    bindModalEvents();
  };

  const bindModalEvents = () => {
    // Fechar
    $("#medCloseBtn", dialog).onclick = () => dialog.close();
    $("#medCancelBtn", dialog).onclick = () => dialog.close();

    // Alternar Período
    $("#medToggleSingle", dialog).onclick = () => {
      isPeriodMode = false;
      renderModalContent();
    };
    $("#medTogglePeriod", dialog).onclick = () => {
      isPeriodMode = true;
      renderModalContent();
    };

    // Toggle de Opcionais
    $("#medToggleOptionals", dialog)?.addEventListener("click", () => {
      // Salva os valores atuais antes de re-renderizar
      crmValue = $("#medCrmInput", dialog)?.value || crmValue;
      reasonValue = $("#medReasonInput", dialog)?.value || reasonValue;
      showOptionals = !showOptionals;
      renderModalContent();
    });

    // Atualização do resumo de dias no modo período
    const updatePeriodDays = () => {
      const s = $("#medStartDate", dialog)?.value;
      const e = $("#medEndDate", dialog)?.value;
      const summary = $("#medPeriodSummary", dialog);
      if (s && e && summary) {
        if (e < s) {
          summary.textContent = "Data de término anterior à de início";
          summary.style.color = "#dc2626";
          summary.style.background = "#fef2f2";
          summary.style.borderColor = "#fecaca";
        } else {
          const diffDays = Math.round((new Date(`${e}T12:00:00`) - new Date(`${s}T12:00:00`)) / 86400000) + 1;
          summary.textContent = `${diffDays} dia${diffDays > 1 ? "s" : ""} a ser${diffDays > 1 ? "em" : ""} abonado${diffDays > 1 ? "s" : ""}`;
          summary.style.color = "#059669";
          summary.style.background = "#ecfdf5";
          summary.style.borderColor = "#a7f3d0";
        }
      }
    };

    $("#medStartDate", dialog)?.addEventListener("change", updatePeriodDays);
    $("#medEndDate", dialog)?.addEventListener("change", updatePeriodDays);

    // Botões de upload
    const cameraInput = $("#medCameraInput", dialog);
    const fileInput = $("#medFileInput", dialog);

    $("#medBtnCamera", dialog)?.addEventListener("click", () => cameraInput?.click());
    $("#medBtnFile", dialog)?.addEventListener("click", () => fileInput?.click());

    const handleFileSelected = (file) => {
      if (!file) return;
      selectedFile = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        fileBase64 = e.target.result;
        renderModalContent();
      };
      reader.readAsDataURL(file);
    };

    cameraInput?.addEventListener("change", (e) => handleFileSelected(e.target.files?.[0]));
    fileInput?.addEventListener("change", (e) => handleFileSelected(e.target.files?.[0]));

    $("#medBtnRemoveFile", dialog)?.addEventListener("click", () => {
      selectedFile = null;
      fileBase64 = "";
      renderModalContent();
    });

    // Submissão do atestado
    $("#medSubmitBtn", dialog)?.addEventListener("click", async () => {
      const feedback = $("#medFeedbackMsg", dialog);
      const submitBtn = $("#medSubmitBtn", dialog);

      const showFeedback = (text, isError = false) => {
        if (!feedback) return;
        feedback.style.display = "block";
        feedback.style.color = isError ? "#b91c1c" : "#065f46";
        feedback.style.background = isError ? "#fef2f2" : "#ecfdf5";
        feedback.style.border = `1px solid ${isError ? "#fecaca" : "#a7f3d0"}`;
        feedback.textContent = text;
      };

      let start = "";
      let end = "";
      if (!isPeriodMode) {
        start = $("#medSingleDate", dialog)?.value;
        end = start;
      } else {
        start = $("#medStartDate", dialog)?.value;
        end = $("#medEndDate", dialog)?.value;
      }

      if (!start || !end) {
        showFeedback("Selecione a(s) data(s) do atestado.", true);
        return;
      }
      if (end < start) {
        showFeedback("A data de término não pode ser anterior à data de início.", true);
        return;
      }

      if (!selectedFile && !fileBase64) {
        showFeedback("Por favor, anexe a foto ou PDF do atestado.", true);
        return;
      }

      const crm = $("#medCrmInput", dialog)?.value || crmValue || "";
      const reason = $("#medReasonInput", dialog)?.value || reasonValue || "";
      const empName = state.user?.Nome || state.user?.nome || "Colaborador";

      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>Salvando no Google Drive...</span>`;
      showFeedback("Enviando atestado para o Drive seguro da House 190...", false);

      try {
        // 1. Upload para o Google Drive da conta grupo190house@gmail.com
        const uploadResult = await uploadMedicalCertificateToDrive(selectedFile, empName);
        const docUrl = uploadResult.url || "";
        const docBase64 = uploadResult.base64 || fileBase64;

        // 2. Invoca a API de atestado médico
        submitBtn.innerHTML = `<span>Finalizando pedido de abono...</span>`;
        await callApi("submitMedicalCertificate", {
          dataInicio: start,
          dataFim: end,
          documentoUrl: docUrl,
          documentoBase64: docBase64,
          crm: crm,
          motivo: reason,
        });

        showFeedback("Atestado enviado! As faltas serão abonadas assim que o gestor aprovar.", false);
        setTimeout(() => {
          dialog.close();
          loadDocuments();
          if (typeof window.renderRequests === "function") {
            window.renderRequests();
          }
          if (typeof window.refreshJourneyData_ === "function") {
            window.refreshJourneyData_();
          }
        }, 1200);
      } catch (err) {
        console.error("[documents] Erro ao enviar atestado:", err);
        showFeedback(`Erro ao enviar: ${err.message}`, true);
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Enviar Atestado</span>`;
      }
    });
  };

  renderModalContent();
  dialog.showModal?.() || dialog.setAttribute("open", "true");
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
          <option value="termo-lgpd-consentimento">Termo de Consentimento LGPD (Tratamento de Dados e Atestados)</option>
          <option value="politica-privacidade">Termo de Ciência da Política de Privacidade (LGPD)</option>
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
 * Abre o Modal de Emissão por Modelos Dinâmicos de RH (padrão Bizneo)
 */
export function openTemplateDialog() {
  let dialog = $("#documentTemplateDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "documentTemplateDialog";
    dialog.className = "dialog doc-upload-dialog";
    document.body.appendChild(dialog);
  }

  const storesList = (state.stores && state.stores.length) ? state.stores : (window.state?.stores || []);
  const employeesList = (state.employees && state.employees.length) ? state.employees : (window.state?.employees || []);

  const storeOptions = storesList
    .map((s) => {
      const id = storeId(s);
      const name = storeName(s) || id || "Unidade";
      return `<option value="${esc(id)}">${esc(name)}</option>`;
    })
    .join("");

  const getEmpOptions = (lojaId) => {
    const list = employeesList.filter((e) => !lojaId || empStoreId(e) === String(lojaId).trim());
    const effectiveList = list.length > 0 ? list : employeesList;
    return effectiveList
      .map((e) => `<option value="${esc(empId(e))}">${esc(empName(e))} (CPF: ${esc(empCpf(e) || "---")})</option>`)
      .join("");
  };

  dialog.innerHTML = `
    <div class="dialog-head">
      <div>
        <span class="eyebrow" style="color:#6340d8; font-weight:700; font-size:11px;">MODELOS INTELIGENTES DE RH</span>
        <h3 style="margin:0; font-size:1.15rem; font-weight:700;">Emitir Documento por Modelo</h3>
      </div>
      <button type="button" class="icon-btn" id="docTemplateCloseBtn" aria-label="Fechar">&times;</button>
    </div>

    <form id="docTemplateForm" class="dialog-body" style="padding:16px;">
      <div class="form-grid">
        <label>
          Modelo de Documento *
          <select id="docTemplateSelect" required>
            <option value="TERMO_LGPD">Termo de Confidencialidade e Proteção de Dados (LGPD)</option>
            <option value="ACORDO_BANCO_HORAS">Acordo de Compensação de Horas (Portaria 671 MTE)</option>
            <option value="FICHA_EPI_UNIFORME">Termo de Entrega de EPI e Uniforme</option>
            <option value="ADVERTENCIA_DISCIPLINAR">Notificação de Advertência Disciplinar</option>
          </select>
        </label>

        <label>
          Unidade / Loja
          <select id="docTemplateStoreSelect">
            <option value="">Todas as Unidades</option>
            ${storeOptions}
          </select>
        </label>
      </div>

      <div style="margin-top:12px;">
        <label>
          Colaborador Destinatário *
          <select id="docTemplateEmpSelect" required>
            ${getEmpOptions("")}
          </select>
        </label>
      </div>

      <div id="docTemplateMotivoGroup" style="margin-top:12px; display:none;">
        <label>
          Motivo da Advertência Disciplinar *
          <textarea id="docTemplateMotivoText" rows="3" placeholder="Descreva os fatos e conduta inadequada..."></textarea>
        </label>
      </div>

      <p style="font-size:12px; color:#64748b; margin:14px 0 0; line-height:1.4;">
        O sistema preencherá automaticamente as cláusulas com nome, CPF, cargo e unidade do colaborador e disponibilizará o termo para assinatura eletrônica imediata.
      </p>

      <div class="dialog-actions" style="margin-top:18px; display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="docTemplateCancelBtn">Cancelar</button>
        <button type="submit" class="btn btn-primary" id="docTemplateSubmitBtn" style="min-height:44px;">
          Gerar e Enviar para Assinatura
        </button>
      </div>
    </form>
  `;

  dialog.showModal?.() || dialog.setAttribute("open", "true");

  const closeDialog = () => {
    dialog.close?.() || dialog.removeAttribute("open");
  };

  $("#docTemplateCloseBtn").onclick = closeDialog;
  $("#docTemplateCancelBtn").onclick = closeDialog;

  const tSelect = $("#docTemplateSelect");
  const motivoGroup = $("#docTemplateMotivoGroup");
  if (tSelect && motivoGroup) {
    tSelect.onchange = () => {
      motivoGroup.style.display = tSelect.value === "ADVERTENCIA_DISCIPLINAR" ? "block" : "none";
    };
  }

  const sSelect = $("#docTemplateStoreSelect");
  const eSelect = $("#docTemplateEmpSelect");
  if (sSelect && eSelect) {
    sSelect.onchange = () => {
      eSelect.innerHTML = getEmpOptions(sSelect.value);
    };
  }

  $("#docTemplateForm").onsubmit = async (e) => {
    e.preventDefault();
    const templateId = $("#docTemplateSelect")?.value;
    const funcionarioId = $("#docTemplateEmpSelect")?.value;
    const motivo = $("#docTemplateMotivoText")?.value;

    const submitBtn = $("#docTemplateSubmitBtn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Gerando documento dinâmico...";
    }

    try {
      const res = await window.call("documentsGenerateFromTemplate", {
        templateId,
        funcionarioId,
        motivo,
      });
      closeDialog();
      if (typeof window.toast === "function") {
        window.toast(res?.message || "Documento gerado com sucesso!");
      }
      await loadDocuments();
    } catch (err) {
      alert(err.message || "Erro ao emitir documento.");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Gerar e Enviar para Assinatura";
      }
    }
  };
}

/**
 * Abre o Modal de Verificação de Autenticidade Pericial
 */
export function openVerifyDialog() {
  let dialog = $("#documentVerifyDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "documentVerifyDialog";
    dialog.className = "dialog doc-sign-dialog";
    document.body.appendChild(dialog);
  }

  dialog.innerHTML = `
    <div class="dialog-head">
      <div>
        <span class="eyebrow" style="color:#059669; font-weight:700; font-size:11px;">CONFORMIDADE &amp; AUDITORIA</span>
        <h3 style="margin:0; font-size:1.15rem; font-weight:700;">Verificar Autenticidade de Documento</h3>
      </div>
      <button type="button" class="icon-btn" id="docVerifyCloseBtn" aria-label="Fechar">&times;</button>
    </div>

    <div class="dialog-body" style="padding:16px;">
      <p style="margin:0 0 12px; font-size:13px; color:#64748b;">
        Insira o Código de Validação impresso no rodapé do documento (ex: VAL-2026-XXXX) ou a chave Hash SHA-256 para comprovar a validade jurídica pericial.
      </p>

      <form id="docVerifyForm">
        <label>
          Código Verificador ou Hash SHA-256
          <input type="text" id="docVerifyInput" placeholder="Ex: VAL-2026-ABCD ou c5b1..." required style="width:100%; margin-top:4px;" />
        </label>
        <div style="margin-top:12px; text-align:right;">
          <button type="submit" class="btn btn-primary" id="docVerifySubmitBtn" style="min-height:44px;">
            Consultar Autenticidade
          </button>
        </div>
      </form>

      <div id="docVerifyResult" style="margin-top:16px; display:none;"></div>
    </div>
  `;

  dialog.showModal?.() || dialog.setAttribute("open", "true");

  $("#docVerifyCloseBtn").onclick = () => {
    dialog.close?.() || dialog.removeAttribute("open");
  };

  $("#docVerifyForm").onsubmit = async (e) => {
    e.preventDefault();
    const term = $("#docVerifyInput")?.value;
    const resultBox = $("#docVerifyResult");
    if (!resultBox) return;

    resultBox.style.display = "block";
    resultBox.innerHTML = `<div style="text-align:center; padding:12px; color:#64748b;">Consultando banco de dados de integridade...</div>`;

    try {
      const res = await window.call("documentsVerify", term);
      const data = res?.data || res;

      if (!data.valido) {
        resultBox.innerHTML = `
          <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:12px; padding:14px; color:#991b1b; font-size:13px;">
            <strong>Documento Não Encontrado ou Não Autenticado</strong><br/>
            Nenhuma evidência pericial localizada para os dados informados.
          </div>
        `;
        return;
      }

      const sig = data.assinatura || {};
      resultBox.innerHTML = `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:16px; color:#166534; font-size:13px;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <strong style="font-size:14px;">Documento Oficial Válido e Autêntico</strong>
          </div>
          <div style="display:grid; grid-template-columns:1fr; gap:6px; margin-top:8px; color:#1e293b;">
            <div><strong>Signatário:</strong> ${esc(sig.NomeSignatario)} (CPF: ${esc(sig.CPFSignatario || "---")})</div>
            <div><strong>Data e Hora UTC:</strong> ${formatDate(sig.DataHoraAssinatura)}</div>
            <div><strong>Código Verificador:</strong> <span style="font-family:monospace; font-weight:700;">${esc(sig.CodigoValidacao)}</span></div>
            <div><strong>Hash SHA-256 Final:</strong> <span style="font-family:monospace; font-size:11px; word-break:break-all;">${esc(sig.HashDocumentoFinalSHA256)}</span></div>
            <div><strong>Endereço IP:</strong> ${esc(sig.EnderecoIP || "Dispositivo Seguro")}</div>
          </div>
        </div>
      `;
    } catch (err) {
      resultBox.innerHTML = `
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:12px; padding:14px; color:#991b1b; font-size:13px;">
          Erro ao verificar: ${esc(err.message)}
        </div>
      `;
    }
  };
}

/**
 * Faz download do PDF assinado ou prévio
 */
export async function downloadPdf(docId) {
  let doc = state.documents.find((d) => String(d.DocumentoID) === String(docId));
  if (!doc) return;
  await ensureDocumentFullPayload(doc);

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
 * Abre pré-visualização de documento em alta resolução com PDF.js nativo
 */
export async function openPreviewDialog(docId) {
  let doc = state.documents.find((d) => String(d.DocumentoID) === String(docId));
  if (!doc) return;
  await ensureDocumentFullPayload(doc);

  const dialog = $("#documentPreviewDialog");
  if (!dialog) return;

  const base64 = doc.ArquivoFinalBase64 || doc.ArquivoOriginalBase64 || "";
  const fileUrl = doc.ArquivoUrl || doc.DocumentoUrl || "";
  const driveInfo = parseDriveUrl(fileUrl);
  const isMedical = doc.Tipo === "Atestado Médico" || String(doc.Titulo || "").toLowerCase().includes("atestado");
  const hasBase64Image = Boolean(base64 && base64.startsWith("data:image/"));
  const hasBase64Pdf = Boolean(base64 && (base64.includes("application/pdf") || base64.startsWith("JVBERi")));
  const isPdf = Boolean(hasBase64Pdf || (fileUrl && /\.pdf($|\?)/i.test(fileUrl)));
  const isImage = Boolean(hasBase64Image || (fileUrl && /\.(jpe?g|png|webp|gif)($|\?)/i.test(fileUrl)) || (isMedical && !isPdf));

  let blobUrl = "";
  if (base64 && isPdf) {
    blobUrl = base64ToBlobUrl(base64, "application/pdf");
  }

  const isSigned = doc.StatusAssinatura === "ASSINADO" || doc.Status === "Assinado" || doc.Status === "Aprovado";
  const isPending = doc.Status === "Pendente";
  const canDecide = isMedical && isPending && (state.isManager || state.isAdmin);

  let statusBadgeLabel = "DOCUMENTO PENDENTE";
  let statusBadgeColor = "#4f46e5";
  if (isMedical) {
    if (doc.Status === "Aprovado") {
      statusBadgeLabel = "ATESTADO APROVADO E ABONADO";
      statusBadgeColor = "#059669";
    } else if (doc.Status === "Rejeitado") {
      statusBadgeLabel = "ATESTADO RECUSADO";
      statusBadgeColor = "#dc2626";
    } else {
      statusBadgeLabel = "ATESTADO PENDENTE DE AVALIAÇÃO";
      statusBadgeColor = "#d97706";
    }
  } else if (isSigned) {
    statusBadgeLabel = "DOCUMENTO ASSINADO";
    statusBadgeColor = "#16a34a";
  }

  dialog.innerHTML = `
    <div class="dialog-head" style="display:flex; justify-content:space-between; align-items:center; padding:1.15rem 1.4rem; border-bottom:1px solid var(--line, #e2e8f0);">
      <div>
        <span class="eyebrow" style="color:${statusBadgeColor}; font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:0.04em;">
          ${statusBadgeLabel}
        </span>
        <h3 style="margin:2px 0 0; font-size:1.15rem; font-weight:700; color:var(--text, #1e293b);">${esc(doc.Titulo || "Visualização de Documento")}</h3>
        <div style="font-size:12px; color:#64748b; margin-top:3px;">
          Colaborador: <strong>${esc(doc.NomeFuncionario || "Colaborador")}</strong> ${doc.CPFFuncionario ? `(CPF: ${esc(doc.CPFFuncionario)})` : ""} ${doc.NomeLoja ? `• Unidade: ${esc(doc.NomeLoja)}` : ""}
        </div>
      </div>
      <button type="button" class="icon-btn" data-close="documentPreviewDialog" aria-label="Fechar">&times;</button>
    </div>

    <div class="dialog-body" style="padding:1rem;">
      ${
        isMedical
          ? `
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:12px 14px; margin-bottom:12px; display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px;">
          <div>
            <span style="display:block; font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">Período do Atestado</span>
            <strong style="font-size:13.5px; color:#0f172a;">${esc(doc.PeriodoAbono || doc.DataInicio || "Data informada")}</strong>
          </div>
          <div>
            <span style="display:block; font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">Abono Solicitado</span>
            <span style="display:inline-block; font-size:12px; font-weight:700; color:#059669; background:#ecfdf5; border:1px solid #a7f3d0; padding:2px 8px; border-radius:999px;">
              ${doc.DiasAbono ? `${doc.DiasAbono} dia(s) a abonar` : "1 dia a abonar"}
            </span>
          </div>
          ${doc.CRM ? `
            <div>
              <span style="display:block; font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">CRM do Médico</span>
              <strong style="font-size:13.5px; color:#0f172a;">${esc(doc.CRM)}</strong>
            </div>
          ` : ""}
          ${doc.Observacao ? `
            <div style="grid-column: 1 / -1;">
              <span style="display:block; font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">Motivo / Observações</span>
              <p style="margin:2px 0 0; font-size:13px; color:#334155;">${esc(doc.Observacao)}</p>
            </div>
          ` : ""}
        </div>
      `
          : ""
      }

      ${
        isImage
          ? `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
          <span style="font-size:12px; color:#64748b; font-weight:600;">Comprovante / Foto do Atestado</span>
          <div style="display:inline-flex; gap:6px; align-items:center;">
            ${driveInfo ? `
              <button type="button" id="btnToggleDriveMode" class="btn btn-secondary btn-sm" style="display:inline-flex; align-items:center; gap:5px; font-size:11.5px; padding:5px 10px; border-radius:8px;">
                Alternar Visualizador
              </button>
              <a href="${esc(driveInfo.openUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display:inline-flex; align-items:center; gap:5px; text-decoration:none; font-size:11.5px; padding:5px 10px; border-radius:8px;">
                Ver no Google Drive ↗
              </a>
            ` : fileUrl ? `
              <a href="${esc(fileUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display:inline-flex; align-items:center; gap:5px; text-decoration:none; font-size:11.5px; padding:5px 10px; border-radius:8px;">
                Ver Original ↗
              </a>
            ` : ""}
          </div>
        </div>
        <div style="text-align:center; background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:12px; max-height:55vh; overflow:auto; position:relative;">
          ${
            hasBase64Image
              ? `
            <img src="${base64}" alt="Atestado Médico" style="max-width:100%; max-height:50vh; object-fit:contain; border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,0.08);" />
          `
              : driveInfo
              ? `
            <div id="driveMediaContainer" style="width:100%; display:flex; flex-direction:column; align-items:center;">
              <img id="driveDocImage"
                   src="${driveInfo.thumbnailUrl}"
                   alt="Comprovante do Atestado"
                   style="max-width:100%; max-height:50vh; object-fit:contain; border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,0.08); display:block;"
                   onerror="
                     if (!this.dataset.triedLh3) {
                       this.dataset.triedLh3 = '1';
                       this.src = '${driveInfo.directViewUrl}';
                     } else {
                       this.style.display = 'none';
                       const f = document.getElementById('driveDocIframeWrapper');
                       if (f) f.style.display = 'block';
                     }
                   "
              />
              <div id="driveDocIframeWrapper" style="display:none; width:100%; height:50vh; min-height:340px; border-radius:10px; overflow:hidden; border:1px solid #cbd5e1; background:#ffffff;">
                <iframe src="${driveInfo.previewUrl}" style="width:100%; height:100%; border:none;" allow="autoplay" title="Comprovante Google Drive"></iframe>
              </div>
            </div>
          `
              : fileUrl
              ? `
            <div style="padding:28px 16px; text-align:center;">
              <p style="margin:0 0 12px; font-weight:600; color:#1e293b;">Comprovante disponível para abertura externa.</p>
              <a href="${esc(fileUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="display:inline-flex; align-items:center; gap:8px; padding:10px 18px; border-radius:10px; text-decoration:none; font-weight:600;">
                Abrir Comprovante ↗
              </a>
            </div>
          `
              : `
            <p style="color:#64748b; font-size:13px; margin:1rem 0;">Nenhum anexo encontrado para este documento.</p>
          `
          }
        </div>
      `
          : isPdf && base64
          ? `
        <div class="doc-viewer-action-row" style="margin-bottom:8px;">
          <span style="font-size:12px; color:#64748b;">Visualização de Alta Resolução</span>
          <button type="button" id="docPreviewDownloadBtn" class="doc-btn-fullscreen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Baixar PDF
          </button>
        </div>
        <div id="docPreviewBox" class="doc-viewer-container" style="height:60vh; min-height:380px; border-radius:12px; overflow-y:auto; border:1px solid var(--line, #e2e8f0);">
        </div>
      `
          : isPdf && driveInfo
          ? `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:12px; color:#64748b; font-weight:600;">Documento PDF no Google Drive</span>
          <a href="${esc(driveInfo.openUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display:inline-flex; align-items:center; gap:6px; text-decoration:none; font-size:12px; padding:6px 12px; border-radius:8px;">
            Ver no Google Drive ↗
          </a>
        </div>
        <div style="width:100%; height:55vh; min-height:380px; border-radius:12px; overflow:hidden; border:1px solid #cbd5e1; background:#ffffff;">
          <iframe src="${driveInfo.previewUrl}" style="width:100%; height:100%; border:none;" allow="autoplay" title="PDF Google Drive"></iframe>
        </div>
      `
          : fileUrl
          ? `
        <div style="padding:28px 16px; text-align:center; background:#f8fafc; border:1.5px dashed #cbd5e1; border-radius:14px;">
          <div style="color:#6340d8; margin-bottom:8px;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <p style="margin:0 0 4px; font-weight:700; color:#0f172a; font-size:14.5px;">Comprovante Salvo no Google Drive</p>
          <p style="margin:0 0 16px; font-size:12.5px; color:#64748b;">O documento foi sincronizado e armazenado na conta oficial grupo190house@gmail.com.</p>
          <a href="${esc(fileUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="display:inline-flex; align-items:center; gap:8px; text-decoration:none; padding:10px 20px; border-radius:10px; font-weight:600;">
            Abrir Comprovante no Google Drive ↗
          </a>
        </div>
      `
          : `
        <div class="doc-viewer-container doc-text-viewer">
          <div style="white-space:pre-wrap; font-family:inherit;">${esc(doc.ConteudoTexto || "Sem conteúdo para visualização.")}</div>
        </div>
      `
      }
    </div>

    <div class="dialog-actions" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding:1rem 1.4rem; border-top:1px solid var(--line, #e2e8f0);">
      <div>
        ${
          canDecide
            ? `
          <button type="button" id="docPreviewRejectBtn" class="btn btn-ghost" style="color:#dc2626; border-color:#fecaca;">
            Recusar Atestado
          </button>
        `
            : ""
        }
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="btn btn-secondary" data-close="documentPreviewDialog">Fechar</button>
        ${
          canDecide
            ? `
          <button type="button" id="docPreviewApproveBtn" class="btn" style="background:#059669; color:#ffffff; font-weight:700; padding:10px 18px; border-radius:12px; border:none; box-shadow:0 2px 6px rgba(5,150,105,0.25);">
            Aprovar Atestado e Abonar Faltas
          </button>
        `
            : ""
        }
      </div>
    </div>
  `;

  const close = () => {
    if (blobUrl && blobUrl.startsWith("blob:")) {
      try { URL.revokeObjectURL(blobUrl); } catch (_) {}
    }
    dialog.close?.() || dialog.removeAttribute("open");
  };

  dialog.querySelectorAll('[data-close="documentPreviewDialog"]').forEach((btn) => {
    btn.onclick = close;
  });

  $("#docPreviewDownloadBtn")?.addEventListener("click", () => {
    downloadSignedDocument(docId);
  });

  const toggleBtn = $("#btnToggleDriveMode");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const img = $("#driveDocImage");
      const iframeWrap = $("#driveDocIframeWrapper");
      if (!img || !iframeWrap) return;
      const isShowingImg = img.style.display !== "none";
      if (isShowingImg) {
        img.style.display = "none";
        iframeWrap.style.display = "block";
        toggleBtn.textContent = "Ver como Imagem";
      } else {
        img.style.display = "block";
        iframeWrap.style.display = "none";
        toggleBtn.textContent = "Alternar Visualizador";
      }
    });
  }

  // Ações de Aprovação e Recusa pelo Gestor/Admin
  if (canDecide) {
    $("#docPreviewApproveBtn")?.addEventListener("click", async () => {
      const confirmApprove = confirm(`Deseja aprovar o atestado de ${doc.NomeFuncionario || "colaborador"} e abonar as faltas do período (${doc.PeriodoAbono || doc.DataInicio || "período selecionado"})?`);
      if (!confirmApprove) return;
      const btn = $("#docPreviewApproveBtn");
      btn.disabled = true;
      btn.textContent = "Abonando faltas...";
      try {
        if (doc.FolgaID) {
          await callApi("approveTimeOff", doc.FolgaID, "Atestado aprovado via painel de Documentos");
        } else {
          await callApi("documentsPatch", doc.DocumentoID, { Status: "Aprovado" });
        }
        alert("Atestado aprovado com sucesso! As faltas foram abonadas automaticamente no espelho de ponto.");
        dialog.close();
        await loadDocuments();
        if (typeof window.refreshJourneyData_ === "function") window.refreshJourneyData_();
        if (typeof window.renderRequests === "function") window.renderRequests();
      } catch (err) {
        alert("Erro ao aprovar atestado: " + err.message);
        btn.disabled = false;
        btn.textContent = "Aprovar Atestado e Abonar Faltas";
      }
    });

    $("#docPreviewRejectBtn")?.addEventListener("click", async () => {
      const motivoRecusa = prompt("Informe o motivo da recusa do atestado:", "Atestado ilegível ou inválido");
      if (motivoRecusa === null) return;
      const btn = $("#docPreviewRejectBtn");
      btn.disabled = true;
      btn.textContent = "Recusando...";
      try {
        if (doc.FolgaID) {
          await callApi("rejectTimeOff", doc.FolgaID, motivoRecusa);
        } else {
          await callApi("documentsPatch", doc.DocumentoID, { Status: "Rejeitado", MotivoRecusa: motivoRecusa });
        }
        alert("Atestado recusado.");
        dialog.close();
        await loadDocuments();
        if (typeof window.refreshJourneyData_ === "function") window.refreshJourneyData_();
        if (typeof window.renderRequests === "function") window.renderRequests();
      } catch (err) {
        alert("Erro ao recusar atestado: " + err.message);
        btn.disabled = false;
        btn.textContent = "Recusar Atestado";
      }
    });
  }

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "true");

  if (base64 && isPdf) {
    renderPdfToContainer($("#docPreviewBox"), base64, blobUrl);
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

function formatDateShort(iso) {
  if (!iso) return "---";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Bahia",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return String(iso).slice(0, 10);
  }
}

function formatMedicalFriendlyPeriod(periodoStr, inicio, fim) {
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const p = String(periodoStr || "").trim();
  let s = inicio || "";
  let e = fim || "";

  if (!s && p.includes(" a ")) {
    const parts = p.split(" a ");
    s = parts[0].trim();
    e = parts[1].trim();
  } else if (!s && /^\d{4}-\d{2}-\d{2}$/.test(p)) {
    s = p;
    e = p;
  }

  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [anoS, mesS, diaS] = s.split("-");
    const mIndexS = parseInt(mesS, 10) - 1;
    if (!e || s === e) {
      return `${parseInt(diaS, 10)} de ${meses[mIndexS] || mesS}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(e)) {
      const [anoE, mesE, diaE] = e.split("-");
      const mIndexE = parseInt(mesE, 10) - 1;
      if (mesS === mesE && anoS === anoE) {
        return `${parseInt(diaS, 10)} a ${parseInt(diaE, 10)} de ${meses[mIndexS] || mesS}`;
      }
      return `${parseInt(diaS, 10)}/${mesS} a ${parseInt(diaE, 10)}/${mesE}`;
    }
  }

  return p.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3/$2") || "Período informado";
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
      <div id="docBatchPreviewBox" class="doc-viewer-container" style="height: 65vh; min-height: 420px; border-radius: 12px; overflow-y: auto; border: 1px solid var(--line, #e2e8f0);">
      </div>
    </div>
    <div class="dialog-actions" style="display: flex; justify-content: flex-end; padding: 1rem 1.5rem; border-top: 1px solid var(--line, #e2e8f0);">
      <button type="button" class="btn btn-secondary" data-close="documentBatchPreviewDialog">Fechar</button>
    </div>
  `;

  dialog.querySelectorAll('[data-close="documentBatchPreviewDialog"]').forEach((btn) => {
    btn.onclick = () => {
      if (blobUrl && blobUrl.startsWith("blob:")) {
        try { URL.revokeObjectURL(blobUrl); } catch (_) {}
      }
      dialog.close();
    };
  });

  if (typeof dialog.showModal === "function") dialog.showModal();
  renderPdfToContainer($("#docBatchPreviewBox"), item.ArquivoOriginalBase64, blobUrl);
}

// Expõe no escopo global para compatibilidade com Scripts.html
if (typeof window !== "undefined") {
  window.initDocumentsModule = initDocumentsModule;
  window.openBatchConfirmDialog = openBatchConfirmDialog;
  window.openBatchPagePreview = openBatchPagePreview;
  window.openPreviewDialog = openPreviewDialog;
  window.openMedicalCertificateDialog = openMedicalCertificateDialog;
  window.renderPdfToContainer = renderPdfToContainer;
  window.openLandscapeSignatureModal = openLandscapeSignatureModal;
  window.addEventListener?.("gestao-documents-open", (e) => {
    initDocumentsModule(e.detail);
  });
}

