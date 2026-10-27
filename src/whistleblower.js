/**
 * Módulo de Canal de Denúncias e Integridade (Whistleblowing)
 * Padrão Apple iOS / Design System Grupo House 190
 * Zero emojis - Apenas ícones vetoriais SVG e tipografia profissional
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (x) =>
  String(x ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

const formatDate = (iso) => {
  if (!iso) return "---";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dia = String(d.getDate()).padStart(2, "0");
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const ano = d.getFullYear();
    const hora = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dia}/${mes}/${ano} • ${hora}:${min}`;
  } catch {
    return iso;
  }
};

const CATEGORIAS = [
  "Assédio moral",
  "Assédio sexual",
  "Discriminação",
  "Desvio ou Fraude",
  "Conduta inadequada",
  "Segurança no trabalho",
  "Outro",
];

const state = {
  activeTab: "gestao", // "gestao" | "novo" | "consultar"
  userHasChosenTab: false,
  activeConsulta: null,
  protocoloRecente: null,
  pinRecente: null,
  adminCasos: [],
  filtroStatusAdmin: "todos",
  casoSelecionadoAdmin: null,
  userProfile: null,
  lojas: [],
};

const STATUS_BADGE_CLASSES = {
  Recebida: "badge-amber",
  "Em Análise": "badge-blue",
  "Em Investigação": "badge-purple",
  Concluída: "badge-emerald",
  Arquivada: "badge-slate",
};

const STATUS_PILL_CLASSES = {
  Recebida: "wb-st-recebida",
  "Em Análise": "wb-st-analise",
  "Em Investigação": "wb-st-investigacao",
  Concluída: "wb-st-concluida",
  Arquivada: "wb-st-arquivada",
};

export function formatLojaNome(lojaId) {
  if (!lojaId || lojaId === "GERAL") return "Toda a Rede";
  const stores = (Array.isArray(state.lojas) && state.lojas.length)
    ? state.lojas
    : (Array.isArray(window.state?.stores) && window.state.stores.length)
      ? window.state.stores
      : [];
  const found = stores.find(
    (s) => String(s.LojaID || s.lojaId || s.id || "").toLowerCase() === String(lojaId).toLowerCase()
  );
  if (found) return found.NomeLoja || found.nomeLoja || found.Nome || found.nome || lojaId;
  if (lojaId === "FOOD_PARK") return "Food Park";
  if (lojaId === "CENTRO") return "House Burger - Centro";
  if (lojaId === "DELIVERY") return "Delivery House";
  return lojaId;
}

export function checkIsAdminOrManager(user) {
  if (typeof window !== "undefined") {
    if (typeof window.isAdmin === "function" && window.isAdmin()) return true;
    if (typeof window.isStoreAdmin === "function" && window.isStoreAdmin()) return true;
    if (typeof window.isManager === "function" && window.isManager()) return true;
  }
  const u = user || state.userProfile;
  const p = String(u?.Perfil || u?.perfil || u?.role || "").trim().toLowerCase();
  return (
    p.includes("admin") ||
    p.includes("gerente") ||
    p.includes("respons")
  );
}

/**
 * Renderiza o aplicativo no contêiner raiz
 */
export function renderWhistleblowerView() {
  const root = $("#whistleblowerAppRoot");
  if (!root) return;

  const isAdminOrManager = checkIsAdminOrManager(state.userProfile);

  let tabsHtml = "";
  if (isAdminOrManager) {
    tabsHtml = `
      <div class="wb-nav-wrapper">
        <div class="wb-nav-tabs" role="tablist">
          <button type="button" class="wb-tab-btn ${state.activeTab === "gestao" ? "active" : ""}" data-wb-tab="gestao">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Gestão e Triagem
            <span class="wb-tab-counter">${state.adminCasos.length}</span>
          </button>
          <button type="button" class="wb-tab-btn ${state.activeTab === "novo" ? "active" : ""}" data-wb-tab="novo">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Registrar Novo Relato
          </button>
          <button type="button" class="wb-tab-btn ${state.activeTab === "consultar" ? "active" : ""}" data-wb-tab="consultar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            Acompanhar por Protocolo
          </button>
        </div>
      </div>
    `;
  } else {
    tabsHtml = `
      <div class="wb-nav-wrapper">
        <div class="wb-nav-tabs" role="tablist">
          <button type="button" class="wb-tab-btn ${state.activeTab === "novo" ? "active" : ""}" data-wb-tab="novo">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Registrar Relato
          </button>
          <button type="button" class="wb-tab-btn ${state.activeTab === "consultar" ? "active" : ""}" data-wb-tab="consultar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            Acompanhar por Protocolo
          </button>
        </div>
      </div>
    `;
  }

  let contentHtml = "";
  if (state.activeTab === "gestao" && isAdminOrManager) {
    contentHtml = renderPainelGestao();
  } else if (state.activeTab === "novo") {
    contentHtml = renderFormularioNovo();
  } else if (state.activeTab === "consultar") {
    contentHtml = renderConsulta();
  } else {
    contentHtml = isAdminOrManager ? renderPainelGestao() : renderFormularioNovo();
  }

  const isGestao = isAdminOrManager && state.activeTab === "gestao";
  const headerHtml = isGestao
    ? `
      <div class="wb-header-banner">
        <div class="wb-header-top">
          <span class="wb-badge-security">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            GOVERNANÇA &amp; COMPLIANCE
          </span>
          <span class="wb-secure-pill">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Canal Sigiloso • Lei 14.457/22
          </span>
        </div>
        <h2 class="wb-title">Triagem de Denúncias e Integridade</h2>
        <p class="wb-subtitle">
          Área restrita de governança e comitê de ética para análise confidencial de relatos, emissão de pareceres oficiais e acompanhamento de medidas cabíveis.
        </p>
      </div>
    `
    : `
      <div class="wb-header-banner">
        <div class="wb-header-top">
          <span class="wb-badge-security">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            CANAL CONFIDENCIAL &amp; ANÔNIMO
          </span>
          <span class="wb-secure-pill">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            100% Criptografado
          </span>
        </div>
        <h2 class="wb-title">Canal de Integridade e Denúncias</h2>
        <p class="wb-subtitle">
          Espaço seguro e independente para relatar irregularidades, assédio ou infrações às normas da House 190, com proteção integral e opção de anonimato total conforme a Lei 14.457/2022.
        </p>
      </div>
    `;

  root.innerHTML = `
    <div class="wb-container ${isGestao ? "wb-admin-layout" : "wb-public-layout"}">
      ${headerHtml}
      ${tabsHtml}
      ${isGestao ? contentHtml : `<div class="wb-content-panel">${contentHtml}</div>`}
    </div>
  `;

  bindEvents();
}

/**
 * Renderiza o formulário de novo relato
 */
function renderFormularioNovo() {
  if (state.protocoloRecente) {
    return `
      <div class="wb-success-card">
        <div class="wb-success-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h3>Relato Registrado com Sucesso</h3>
        <p>Seu caso foi recebido pelo Comitê de Ética. Guarde suas credenciais em local seguro para acompanhar a investigação e responder a perguntas do comitê sem se identificar.</p>
        
        <div class="wb-credentials-box">
          <div class="wb-credential-row">
            <span class="label">PROTOCOLO:</span>
            <strong class="value" id="copyProtocoloVal">${esc(state.protocoloRecente)}</strong>
          </div>
          <div class="wb-credential-row">
            <span class="label">PIN DE ACESSO:</span>
            <strong class="value" id="copyPinVal">${esc(state.pinRecente)}</strong>
          </div>
        </div>

        <div class="wb-success-actions">
          <button type="button" class="btn btn-secondary" id="wbCopyCredsBtn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            Copiar Credenciais
          </button>
          <button type="button" class="btn btn-primary" id="wbGoToConsultaBtn">
            Acompanhar este Relato
          </button>
          <button type="button" class="btn btn-ghost" id="wbNewAnotherBtn">
            Fazer Novo Relato
          </button>
        </div>
      </div>
    `;
  }

  const availableStores = (Array.isArray(state.lojas) && state.lojas.length)
    ? state.lojas
    : (Array.isArray(window.state?.stores) && window.state.stores.length)
      ? window.state.stores
      : [
          { LojaID: "FOOD_PARK", NomeLoja: "Food Park" },
          { LojaID: "CENTRO", NomeLoja: "House Burger - Centro" },
          { LojaID: "DELIVERY", NomeLoja: "Delivery House" },
        ];

  const lojasOptions = availableStores
    .map((l) => {
      const id = String(l.LojaID || l.lojaId || l.id || "");
      const name = String(l.NomeLoja || l.nomeLoja || l.Nome || l.nome || id);
      return `<option value="${esc(id)}">${esc(name)}</option>`;
    })
    .join("");

  return `
    <form id="wbNovoRelatoForm" class="wb-form">
      <div class="wb-mode-selector">
        <label class="wb-mode-card active" id="wbModeAnonimo">
          <input type="radio" name="wbAnonimo" value="true" checked />
          <div class="wb-mode-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div class="wb-mode-text">
            <strong>Relato 100% Anônimo</strong>
            <span>Nenhum dado pessoal ou identificação será registrado.</span>
          </div>
        </label>
        <label class="wb-mode-card" id="wbModeIdentificado">
          <input type="radio" name="wbAnonimo" value="false" />
          <div class="wb-mode-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div class="wb-mode-text">
            <strong>Relato Identificado / Confidencial</strong>
            <span>Seus dados ficam restritos estritamente ao Comitê de Ética.</span>
          </div>
        </label>
      </div>

      <div id="wbContatoFields" class="wb-hidden" style="margin-top: 14px;">
        <div class="form-grid">
          <label>
            Seu Nome (Opcional):
            <input type="text" id="wbNomeContato" placeholder="Nome completo" autocomplete="name" />
          </label>
          <label>
            Telefone / WhatsApp para contato (Opcional):
            <input type="tel" id="wbTelefoneContato" placeholder="(XX) 9XXXX-XXXX" autocomplete="tel" />
          </label>
        </div>
      </div>

      <div class="form-grid" style="margin-top: 16px;">
        <label>
          Categoria da Ocorrência *
          <select id="wbCategoria" required>
            <option value="">Selecione uma categoria</option>
            ${CATEGORIAS.map((c) => `<option value="${c}">${c}</option>`).join("")}
          </select>
        </label>

        <label>
          Unidade / Loja do Fato *
          <select id="wbLoja" required>
            <option value="">Selecione a unidade</option>
            <option value="GERAL">Toda a Rede / Geral (Todas as Unidades)</option>
            ${lojasOptions}
          </select>
        </label>
      </div>

      <label style="margin-top: 14px; display: block;">
        Pessoas ou Setores Envolvidos (Opcional)
        <input type="text" id="wbEnvolvidos" placeholder="Ex: Chefia da cozinha, colega do salão, fornecedor..." />
      </label>

      <label style="margin-top: 14px; display: block;">
        Descrição Detalhada dos Fatos *
        <textarea id="wbDescricao" rows="5" required minlength="10" placeholder="Descreva com detalhes o que aconteceu, datas aproximadas, locais e eventuais testemunhas..."></textarea>
      </label>

      <div class="wb-form-footer">
        <span class="wb-security-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Transmissão Criptografada SSL
        </span>
        <button type="submit" class="btn btn-primary" id="wbSubmitBtn">
          Enviar Relato Seguro
        </button>
      </div>
    </form>
  `;
}

/**
 * Renderiza a tela de consulta por protocolo + PIN
 */
function renderConsulta() {
  if (state.activeConsulta) {
    const c = state.activeConsulta;
    const badgeClass = STATUS_BADGE_CLASSES[c.status] || "badge-slate";

    const msgsHtml = (c.mensagens || [])
      .map(
        (m) => `
        <div class="wb-msg-item ${m.autorTipo === "Denunciante" ? "wb-msg-denunciante" : "wb-msg-comite"}">
          <div class="wb-msg-header">
            <strong>${esc(m.autorNome)}</strong>
            <span>${formatDate(m.dataHora)}</span>
          </div>
          <div class="wb-msg-body">${esc(m.texto)}</div>
        </div>
      `,
      )
      .join("");

    return `
      <div class="wb-consulta-card">
        <div class="wb-consulta-head">
          <div class="wb-consulta-meta">
            <span class="wb-label">PROTOCOLO: ${esc(c.protocolo)}</span>
            <h3 style="margin:4px 0 0; font-size:1.15rem; font-weight:700;">${esc(c.categoria)}</h3>
            <span style="font-size:12px; color:#64748b;">Registrado em ${formatDate(c.dataCriacao)}</span>
          </div>
          <span class="doc-badge ${badgeClass}" style="font-size:13px; font-weight:700; padding:6px 14px;">
            ${esc(c.status)}
          </span>
        </div>

        ${
          c.parecerComite
            ? `
            <div class="wb-parecer-box">
              <span class="label">PARECER DO COMITÊ DE ÉTICA:</span>
              <p>${esc(c.parecerComite)}</p>
            </div>
          `
            : ""
        }

        <div class="wb-chat-section">
          <h4 style="margin:0 0 12px; font-size:0.95rem; color:#1e293b; font-weight:700;">Comunicação Sigilosa com o Comitê:</h4>
          <div class="wb-chat-list">
            ${msgsHtml}
          </div>

          <form id="wbReplyForm" class="wb-reply-form">
            <textarea id="wbReplyText" rows="2" placeholder="Digite uma resposta ou esclarecimento adicional..." required minlength="2"></textarea>
            <button type="submit" class="btn btn-secondary" style="min-height: 44px;">
              Enviar Resposta
            </button>
          </form>
        </div>

        <div style="margin-top: 18px; text-align: right;">
          <button type="button" class="btn btn-ghost" id="wbBackToSearchBtn">Consultar Outro Protocolo</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="wb-search-card">
      <div class="wb-search-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
      <h3>Acompanhar Andamento do Caso</h3>
      <p>Insira abaixo o número de protocolo e o PIN de 4 dígitos gerados no momento do registro para acompanhar o status com sigilo total.</p>

      <form id="wbSearchForm" class="wb-search-form">
        <label>
          Número de Protocolo
          <input type="text" id="wbSearchProtocolo" placeholder="Ex: DEN-123456" required autocomplete="off" />
        </label>
        <label>
          PIN de 4 Dígitos
          <input type="password" id="wbSearchPin" maxlength="4" placeholder="••••" required autocomplete="off" />
        </label>
        <button type="submit" class="btn btn-primary" id="wbSearchSubmitBtn">
          Consultar Relato
        </button>
      </form>
    </div>
  `;
}

/**
 * Renderiza o painel de gestão para gerentes e administradores
 */
function renderPainelGestao() {
  const casos = state.adminCasos;
  const filtered = state.filtroStatusAdmin === "todos"
    ? casos
    : casos.filter((c) => c.Status === state.filtroStatusAdmin);

  const total = casos.length;
  const recebidas = casos.filter((c) => c.Status === "Recebida").length;
  const emAnalise = casos.filter((c) => c.Status === "Em Análise").length;
  const emInvestigacao = casos.filter((c) => c.Status === "Em Investigação").length;
  const concluidas = casos.filter((c) => c.Status === "Concluída").length;
  const arquivadas = casos.filter((c) => c.Status === "Arquivada").length;

  const rowsHtml = filtered.length === 0
    ? `
      <div class="wb-empty-state">
        <div class="wb-empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <h4>Nenhum relato encontrado</h4>
        <p>Não há denúncias sob o filtro selecionado no momento.</p>
      </div>
    `
    : `
      <!-- Tabela para Desktop (>= 768px) -->
      <div class="wb-desktop-table">
        <table class="wb-table">
          <thead>
            <tr>
              <th style="width: 140px;">PROTOCOLO</th>
              <th style="width: 165px;">DATA / HORA</th>
              <th>CATEGORIA</th>
              <th style="width: 160px;">UNIDADE</th>
              <th style="width: 130px;">TIPO</th>
              <th style="width: 140px;">STATUS</th>
              <th style="width: 160px; text-align: right;">AÇÃO</th>
            </tr>
          </thead>
          <tbody>
            ${filtered
              .map((c) => {
                const statusClass = STATUS_PILL_CLASSES[c.Status] || "wb-st-arquivada";
                const isAnon = c.Anonimo === true;
                const tipoBadge = isAnon
                  ? `<span class="wb-pill wb-pill-anon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Anônimo</span>`
                  : `<span class="wb-pill wb-pill-ident"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg> ${esc(c.NomeContato || "Identificado")}</span>`;
                const lojaNome = formatLojaNome(c.LojaID);

                return `
                  <tr class="wb-row">
                    <td><span class="wb-proto-badge">${esc(c.DenunciaID)}</span></td>
                    <td><span class="wb-date-text">${formatDate(c.DataCriacao)}</span></td>
                    <td><strong class="wb-cat-name">${esc(c.Categoria)}</strong></td>
                    <td><span class="wb-unit-tag">${esc(lojaNome)}</span></td>
                    <td>${tipoBadge}</td>
                    <td><span class="wb-status-badge ${statusClass}">${esc(c.Status)}</span></td>
                    <td style="text-align: right;">
                      <button type="button" class="wb-btn-action" data-wb-action="analisar" data-id="${esc(c.DenunciaID)}">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                        Analisar e Tratar
                      </button>
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>

      <!-- Cards para Mobile (< 768px) -->
      <div class="wb-mobile-cards">
        ${filtered
          .map((c) => {
            const statusClass = STATUS_PILL_CLASSES[c.Status] || "wb-st-arquivada";
            const isAnon = c.Anonimo === true;
            const tipoBadge = isAnon
              ? `<span class="wb-pill wb-pill-anon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Anônimo</span>`
              : `<span class="wb-pill wb-pill-ident"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg> ${esc(c.NomeContato || "Identificado")}</span>`;
            const lojaNome = formatLojaNome(c.LojaID);

            return `
              <div class="wb-card-item">
                <div class="wb-card-item-top">
                  <span class="wb-proto-badge">${esc(c.DenunciaID)}</span>
                  <span class="wb-status-badge ${statusClass}">${esc(c.Status)}</span>
                </div>
                <div class="wb-card-item-main">
                  <h4 class="wb-card-item-title">${esc(c.Categoria)}</h4>
                  <div class="wb-card-item-meta">
                    <span class="wb-unit-tag">${esc(lojaNome)}</span>
                    ${tipoBadge}
                  </div>
                </div>
                <div class="wb-card-item-footer">
                  <span class="wb-date-text">${formatDate(c.DataCriacao)}</span>
                  <button type="button" class="wb-btn-action" data-wb-action="analisar" data-id="${esc(c.DenunciaID)}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    Analisar e Tratar
                  </button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;

  return `
    <div class="wb-admin-panel">
      <!-- 4 KPIs de Governança -->
      <div class="wb-kpi-grid">
        <div class="wb-kpi-card ${state.filtroStatusAdmin === "todos" ? "wb-kpi-active" : ""}" data-wb-filter="todos">
          <div class="wb-kpi-top">
            <span class="wb-kpi-label">TOTAL DE CASOS</span>
            <div class="wb-kpi-icon wb-icon-blue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </div>
          </div>
          <strong class="wb-kpi-value">${total}</strong>
          <span class="wb-kpi-sub">Relatos protocolados</span>
        </div>

        <div class="wb-kpi-card ${recebidas > 0 ? "wb-kpi-warn" : ""} ${state.filtroStatusAdmin === "Recebida" ? "wb-kpi-active" : ""}" data-wb-filter="Recebida">
          <div class="wb-kpi-top">
            <span class="wb-kpi-label">AGUARDANDO TRIAGEM</span>
            <div class="wb-kpi-icon wb-icon-amber">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
          </div>
          <strong class="wb-kpi-value wb-val-amber">${recebidas}</strong>
          <span class="wb-kpi-sub">Casos novos recebidos</span>
        </div>

        <div class="wb-kpi-card ${state.filtroStatusAdmin === "Em Análise" || state.filtroStatusAdmin === "Em Investigação" ? "wb-kpi-active" : ""}" data-wb-filter="Em Análise">
          <div class="wb-kpi-top">
            <span class="wb-kpi-label">EM APURAÇÃO</span>
            <div class="wb-kpi-icon wb-icon-purple">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
          </div>
          <strong class="wb-kpi-value wb-val-purple">${emAnalise + emInvestigacao}</strong>
          <span class="wb-kpi-sub">Análise e investigação</span>
        </div>

        <div class="wb-kpi-card ${state.filtroStatusAdmin === "Concluída" ? "wb-kpi-active" : ""}" data-wb-filter="Concluída">
          <div class="wb-kpi-top">
            <span class="wb-kpi-label">FINALIZADOS</span>
            <div class="wb-kpi-icon wb-icon-emerald">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
          </div>
          <strong class="wb-kpi-value wb-val-emerald">${concluidas + arquivadas}</strong>
          <span class="wb-kpi-sub">Concluídos e arquivados</span>
        </div>
      </div>

      <!-- Card Principal de Tabela e Filtros -->
      <div class="wb-table-card">
        <div class="wb-card-header">
          <div class="wb-card-title-group">
            <div class="wb-title-row">
              <h3 class="wb-card-title">Relatos e Ocorrências</h3>
              <span class="wb-count-badge">${filtered.length} ${filtered.length === 1 ? "caso" : "casos"}</span>
            </div>
            <p class="wb-card-sub">Triagem e tratamento sigiloso das denúncias registradas na rede House 190</p>
          </div>

          <div class="wb-status-filters" role="group" aria-label="Filtrar por status">
            <button type="button" class="wb-filter-pill ${state.filtroStatusAdmin === "todos" ? "active" : ""}" data-wb-filter="todos">
              Todos <span class="wb-pill-count">${total}</span>
            </button>
            <button type="button" class="wb-filter-pill ${state.filtroStatusAdmin === "Recebida" ? "active" : ""}" data-wb-filter="Recebida">
              Recebidas <span class="wb-pill-count">${recebidas}</span>
            </button>
            <button type="button" class="wb-filter-pill ${state.filtroStatusAdmin === "Em Análise" ? "active" : ""}" data-wb-filter="Em Análise">
              Em Análise <span class="wb-pill-count">${emAnalise}</span>
            </button>
            <button type="button" class="wb-filter-pill ${state.filtroStatusAdmin === "Em Investigação" ? "active" : ""}" data-wb-filter="Em Investigação">
              Em Investigação <span class="wb-pill-count">${emInvestigacao}</span>
            </button>
            <button type="button" class="wb-filter-pill ${state.filtroStatusAdmin === "Concluída" ? "active" : ""}" data-wb-filter="Concluída">
              Concluídas <span class="wb-pill-count">${concluidas}</span>
            </button>
            <button type="button" class="wb-filter-pill ${state.filtroStatusAdmin === "Arquivada" ? "active" : ""}" data-wb-filter="Arquivada">
              Arquivadas <span class="wb-pill-count">${arquivadas}</span>
            </button>
          </div>
        </div>

        ${rowsHtml}
      </div>
    </div>
  `;
}

/**
 * Event Listeners e Lógica
 */
function bindEvents() {
  // Navegação entre abas
  $$("[data-wb-tab]").forEach((btn) => {
    btn.onclick = () => {
      state.userHasChosenTab = true;
      state.activeTab = btn.getAttribute("data-wb-tab");
      renderWhistleblowerView();
    };
  });

  // Toggle Anônimo vs Identificado
  const anonRadio = $("#wbModeAnonimo input");
  const identRadio = $("#wbModeIdentificado input");
  const contatoFields = $("#wbContatoFields");

  if (anonRadio && identRadio && contatoFields) {
    anonRadio.onchange = () => {
      $("#wbModeAnonimo")?.classList.add("active");
      $("#wbModeIdentificado")?.classList.remove("active");
      contatoFields.classList.add("wb-hidden");
    };
    identRadio.onchange = () => {
      $("#wbModeIdentificado")?.classList.add("active");
      $("#wbModeAnonimo")?.classList.remove("active");
      contatoFields.classList.remove("wb-hidden");
    };
  }

  // Submissão do novo relato
  const formNovo = $("#wbNovoRelatoForm");
  if (formNovo) {
    formNovo.onsubmit = async (e) => {
      e.preventDefault();
      const categoria = $("#wbCategoria")?.value;
      const descricao = $("#wbDescricao")?.value;
      const lojaId = $("#wbLoja")?.value;
      const envolvidos = $("#wbEnvolvidos")?.value;
      const isAnon = $('input[name="wbAnonimo"]:checked')?.value === "true";
      const nomeContato = $("#wbNomeContato")?.value;
      const telefoneContato = $("#wbTelefoneContato")?.value;

      try {
        const submitBtn = $("#wbSubmitBtn");
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Gravando relato criptografado...";
        }

        const res = await window.call("denunciaCriar", {
          categoria,
          descricao,
          lojaId,
          envolvidos,
          anonimo: isAnon,
          nomeContato,
          telefoneContato,
        });

        const data = res?.data || res;
        state.protocoloRecente = data.protocolo;
        state.pinRecente = data.pin;
        renderWhistleblowerView();
      } catch (err) {
        const submitBtn = $("#wbSubmitBtn");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Enviar Relato Seguro";
        }
        alert(err.message || "Erro ao registrar o relato.");
      }
    };
  }

  // Copiar credenciais
  const copyBtn = $("#wbCopyCredsBtn");
  if (copyBtn) {
    copyBtn.onclick = () => {
      const text = `Canal de Integridade House 190\nProtocolo: ${state.protocoloRecente}\nPIN: ${state.pinRecente}`;
      navigator.clipboard?.writeText(text);
      copyBtn.textContent = "Credenciais Copiadas!";
      setTimeout(() => {
        copyBtn.textContent = "Copiar Credenciais";
      }, 2500);
    };
  }

  // Ir para acompanhamento
  const goToConsultaBtn = $("#wbGoToConsultaBtn");
  if (goToConsultaBtn) {
    goToConsultaBtn.onclick = async () => {
      const proto = state.protocoloRecente;
      const pin = state.pinRecente;
      state.userHasChosenTab = true;
      state.activeTab = "consultar";
      try {
        const res = await window.call("denunciaConsultar", { protocolo: proto, pin });
        state.activeConsulta = res?.data || res;
      } catch (_) {}
      renderWhistleblowerView();
    };
  }

  // Fazer outro relato
  const newAnotherBtn = $("#wbNewAnotherBtn");
  if (newAnotherBtn) {
    newAnotherBtn.onclick = () => {
      state.protocoloRecente = null;
      state.pinRecente = null;
      renderWhistleblowerView();
    };
  }

  // Form de consulta por protocolo
  const searchForm = $("#wbSearchForm");
  if (searchForm) {
    searchForm.onsubmit = async (e) => {
      e.preventDefault();
      const proto = $("#wbSearchProtocolo")?.value;
      const pin = $("#wbSearchPin")?.value;
      try {
        const res = await window.call("denunciaConsultar", { protocolo: proto, pin });
        state.activeConsulta = res?.data || res;
        renderWhistleblowerView();
      } catch (err) {
        alert(err.message || "Protocolo ou PIN incorretos.");
      }
    };
  }

  // Enviar resposta no chat
  const replyForm = $("#wbReplyForm");
  if (replyForm && state.activeConsulta) {
    replyForm.onsubmit = async (e) => {
      e.preventDefault();
      const text = $("#wbReplyText")?.value;
      try {
        await window.call("denunciaEnviarMensagem", {
          protocolo: state.activeConsulta.protocolo,
          pin: $("#wbSearchPin")?.value || state.pinRecente,
          texto: text,
        });
        // Atualiza a consulta
        const res = await window.call("denunciaConsultar", {
          protocolo: state.activeConsulta.protocolo,
          pin: $("#wbSearchPin")?.value || state.pinRecente,
        });
        state.activeConsulta = res?.data || res;
        renderWhistleblowerView();
      } catch (err) {
        alert(err.message || "Erro ao enviar resposta.");
      }
    };
  }

  // Voltar da consulta
  const backSearchBtn = $("#wbBackToSearchBtn");
  if (backSearchBtn) {
    backSearchBtn.onclick = () => {
      state.activeConsulta = null;
      renderWhistleblowerView();
    };
  }

  // Filtros administrativos
  $$("[data-wb-filter]").forEach((chip) => {
    chip.onclick = () => {
      state.filtroStatusAdmin = chip.getAttribute("data-wb-filter");
      renderWhistleblowerView();
    };
  });

  // Ação de analisar caso (Admin)
  $$('[data-wb-action="analisar"]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      try {
        const res = await window.call("denunciaAdminObter", id);
        const data = res?.data || res;
        openAdminModal(data);
      } catch (err) {
        alert(err.message || "Erro ao carregar caso.");
      }
    };
  });
}

/**
 * Modal administrativo para análise e parecer do RH
 */
function openAdminModal(casoData) {
  const d = casoData.denuncia;
  const msgs = Array.isArray(casoData.mensagens) ? casoData.mensagens : [];

  let modal = $("#wbAdminModal");
  if (!modal) {
    modal = document.createElement("dialog");
    modal.id = "wbAdminModal";
    modal.className = "dialog wb-admin-dialog";
    document.body.appendChild(modal);
  }

  const msgsHtml = msgs.length === 0
    ? `<span style="font-size:12px; color:#94a3b8;">Nenhuma mensagem registrada além do relato inicial.</span>`
    : msgs
        .map((m) => {
          const isDenunciante = m.AutorTipo === "Denunciante";
          const borderCol = isDenunciante ? "#94a3b8" : "#2563eb";
          const bgCol = isDenunciante ? "#f8fafc" : "#eff6ff";
          return `
            <div style="font-size:12.5px; padding:10px 12px; border-radius:10px; background:${bgCol}; border-left:3px solid ${borderCol}; margin-bottom:8px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:11px; color:#64748b;">
                <strong style="color:#0f172a;">${esc(m.AutorNome || m.AutorTipo)}</strong>
                <span style="font-variant-numeric:tabular-nums;">${formatDate(m.DataHora)}</span>
              </div>
              <div style="color:#1e293b; white-space:pre-wrap; line-height:1.45;">${esc(m.Texto)}</div>
            </div>
          `;
        })
        .join("");

  const statusClass = STATUS_PILL_CLASSES[d.Status] || "wb-st-arquivada";
  const lojaNome = formatLojaNome(d.LojaID);

  modal.innerHTML = `
    <div class="wb-modal-header">
      <div>
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:2px;">
          <span style="font-family:ui-monospace, monospace; font-size:11.5px; font-weight:700; color:#1d4ed8; background:#eff6ff; padding:2px 8px; border-radius:4px;">${esc(d.DenunciaID)}</span>
          <span class="wb-status-badge ${statusClass}">${esc(d.Status)}</span>
        </div>
        <h3 class="wb-modal-title">Triagem de Ocorrência</h3>
      </div>
      <button type="button" class="icon-btn" id="wbAdminModalClose" aria-label="Fechar">&times;</button>
    </div>

    <div class="wb-modal-body">
      <div style="background:#f8fafc; padding:14px 16px; border-radius:14px; font-size:13px; margin-bottom:16px; border:1px solid #e2e8f0; line-height:1.55;">
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px; margin-bottom:10px;">
          <div><span style="color:#64748b; font-size:11px; font-weight:700; text-transform:uppercase; display:block;">Categoria</span> <strong style="color:#0f172a;">${esc(d.Categoria)}</strong></div>
          <div><span style="color:#64748b; font-size:11px; font-weight:700; text-transform:uppercase; display:block;">Unidade</span> <strong style="color:#0f172a;">${esc(lojaNome)}</strong></div>
          <div><span style="color:#64748b; font-size:11px; font-weight:700; text-transform:uppercase; display:block;">Data do Envio</span> <span style="font-variant-numeric:tabular-nums; color:#334155;">${formatDate(d.DataCriacao)}</span></div>
          <div><span style="color:#64748b; font-size:11px; font-weight:700; text-transform:uppercase; display:block;">Identificação</span> <span style="font-weight:600; color:#334155;">${d.Anonimo ? "Anônimo" : `Identificado (${esc(d.NomeContato || "")})`}</span></div>
        </div>

        ${
          !d.Anonimo && (d.TelefoneContato || d.NomeContato)
            ? `<div style="margin-bottom:10px; padding-top:8px; border-top:1px solid #e2e8f0; font-size:12.5px; color:#475569;">
                <strong>Contato do Denunciante:</strong> ${esc(d.NomeContato || "")} ${d.TelefoneContato ? `• Tel: ${esc(d.TelefoneContato)}` : ""}
              </div>`
            : ""
        }

        <div style="margin-bottom:10px; font-size:12.5px; color:#475569;">
          <strong>Pessoas ou Setores Citados:</strong> ${esc(d.Envolvidos || "Não especificado")}
        </div>

        <div style="margin-top:10px; padding-top:10px; border-top:1px solid #e2e8f0;">
          <span style="color:#64748b; font-size:11px; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Descrição Detalhada do Fato</span>
          <div style="color:#0f172a; white-space:pre-wrap; background:#ffffff; padding:12px 14px; border-radius:10px; border:1px solid #e2e8f0; font-size:13px; line-height:1.6;">${esc(d.Descricao)}</div>
        </div>
      </div>

      <div class="wb-modal-msgs" style="margin-bottom:18px;">
        <div style="font-size:11.5px; font-weight:750; color:#475569; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; display:flex; align-items:center; gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Histórico de Comunicação Sigilosa (${msgs.length})
        </div>
        <div style="max-height:160px; overflow-y:auto; padding:10px; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px;">
          ${msgsHtml}
        </div>
      </div>

      <form id="wbAdminFormModal">
        <label style="display:block; margin-bottom:14px;">
          <strong style="font-size:12.5px; color:#334155; display:block; margin-bottom:6px;">Alterar Fase / Status da Apuração:</strong>
          <select id="wbAdminStatusSelect" style="width:100%; height:42px; border-radius:10px; border:1px solid #cbd5e1; padding:0 12px; font-size:13.5px; font-weight:600; color:#0f172a; background:#ffffff;">
            <option value="Recebida" ${d.Status === "Recebida" ? "selected" : ""}>Recebida (Aguardando triagem preliminar)</option>
            <option value="Em Análise" ${d.Status === "Em Análise" ? "selected" : ""}>Em Análise (Avaliação inicial de procedência)</option>
            <option value="Em Investigação" ${d.Status === "Em Investigação" ? "selected" : ""}>Em Investigação (Apuração ativa de provas)</option>
            <option value="Concluída" ${d.Status === "Concluída" ? "selected" : ""}>Concluída (Procedente com medidas adotadas)</option>
            <option value="Arquivada" ${d.Status === "Arquivada" ? "selected" : ""}>Arquivada (Improcedente ou sem elementos)</option>
          </select>
        </label>

        <label style="display:block; margin-bottom:14px;">
          <strong style="font-size:12.5px; color:#334155; display:block; margin-bottom:6px;">Parecer Formal do Comitê de Ética / Diretoria:</strong>
          <textarea id="wbAdminParecerText" rows="3" style="width:100%; border-radius:10px; border:1.5px solid #cbd5e1; padding:10px 12px; font-size:13px; font-family:inherit; line-height:1.5; box-sizing:border-box;" placeholder="Registro formal do comitê com as decisões tomadas, encaminhamentos e medidas institucionais adotadas...">${esc(d.ParecerComite || "")}</textarea>
        </label>

        <label style="display:block; margin-bottom:14px;">
          <strong style="font-size:12.5px; color:#334155; display:block; margin-bottom:6px;">Enviar Mensagem Oficial ao Denunciante (Opcional):</strong>
          <textarea id="wbAdminRespostaText" rows="2" style="width:100%; border-radius:10px; border:1.5px solid #cbd5e1; padding:10px 12px; font-size:13px; font-family:inherit; line-height:1.5; box-sizing:border-box;" placeholder="Esta resposta ficará disponível para o denunciante consultar utilizando o protocolo e PIN..."></textarea>
        </label>

        <div class="wb-modal-footer">
          <button type="button" class="btn btn-secondary" id="wbAdminModalCancel" style="min-height:42px; padding:0 18px; border-radius:10px; font-weight:600;">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="wbAdminModalSave" style="min-height:42px; padding:0 22px; border-radius:10px; font-weight:700; background:#1B365D; border:none; box-shadow:0 2px 8px rgba(27,54,93,0.25);">Salvar Decisão</button>
        </div>
      </form>
    </div>
  `;

  if (typeof modal.showModal === "function") modal.showModal();

  $("#wbAdminModalClose").onclick = () => modal.close();
  $("#wbAdminModalCancel").onclick = () => modal.close();

  $("#wbAdminFormModal").onsubmit = async (e) => {
    e.preventDefault();
    const novoStatus = $("#wbAdminStatusSelect")?.value;
    const parecer = $("#wbAdminParecerText")?.value;
    const respostaTexto = $("#wbAdminRespostaText")?.value;

    try {
      const saveBtn = $("#wbAdminModalSave");
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Salvando...";
      }

      await window.call("denunciaAdminAtualizar", {
        protocolo: d.DenunciaID,
        status: novoStatus,
        parecer,
        respostaTexto,
      });
      modal.close();
      await loadWhistleblower();
    } catch (err) {
      const saveBtn = $("#wbAdminModalSave");
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Salvar Decisão";
      }
      alert(err.message || "Erro ao salvar atualização.");
    }
  };
}

/**
 * Carrega dados iniciais do módulo
 */
export async function loadWhistleblower() {
  try {
    if (typeof window.call !== "function") return;

    // Obtém perfil atual de forma robusta
    try {
      const candidate =
        window.state?.user ||
        window.__GESTAO_USER__ ||
        window.state?.profile ||
        window.__GESTAO_FIREBASE__?.runtime?.profile ||
        null;
      if (candidate) {
        state.userProfile = candidate;
      }
      if (!state.userProfile || !state.userProfile.Perfil) {
        const profRes = await window.call("perfilObter").catch(() => window.call("getProfile")).catch(() => null);
        if (profRes) state.userProfile = profRes?.data || profRes;
      }
    } catch (_) {}

    const isAdminOrManager = checkIsAdminOrManager(state.userProfile);

    // Lojas: carrega de window.state, getStores ou listarLojas
    try {
      if (Array.isArray(window.state?.stores) && window.state.stores.length) {
        state.lojas = window.state.stores;
      } else {
        const lojasRes = await window.call("getStores").catch(() => window.call("listarLojas"));
        state.lojas = lojasRes?.data || lojasRes || [];
      }
    } catch (_) {
      try {
        const lojasRes = await window.call("listarLojas");
        state.lojas = lojasRes?.data || lojasRes || [];
      } catch (_) {}
    }

    if (!Array.isArray(state.lojas) || !state.lojas.length) {
      if (Array.isArray(window.state?.stores) && window.state.stores.length) {
        state.lojas = window.state.stores;
      } else {
        state.lojas = [
          { LojaID: "FOOD_PARK", NomeLoja: "Food Park" },
          { LojaID: "CENTRO", NomeLoja: "House Burger - Centro" },
          { LojaID: "DELIVERY", NomeLoja: "Delivery House" },
        ];
      }
    }

    // Se for admin ou gerente, carrega lista de casos e define a aba inicial como "gestao"
    if (isAdminOrManager) {
      if (!state.userHasChosenTab) {
        state.activeTab = "gestao";
      }
      try {
        const res = await window.call("denunciasAdminListar", {});
        const data = res?.data || res;
        state.adminCasos = Array.isArray(data?.denuncias) ? data.denuncias : [];
      } catch (err) {
        console.warn("[whistleblower] Falha ao carregar denúncias administrativas:", err);
      }
    } else {
      if (!state.userHasChosenTab) {
        state.activeTab = "novo";
      }
    }

    renderWhistleblowerView();
  } catch (err) {
    console.warn("[whistleblower] Falha ao carregar módulo:", err);
  }
}

/**
 * Inicialização global
 */
export function initWhistleblower() {
  window.loadWhistleblower = loadWhistleblower;
  window.addEventListener("gestao-view-change", (e) => {
    if (e.detail?.view === "whistleblower") {
      loadWhistleblower();
    }
  });
}

if (typeof window !== "undefined") {
  initWhistleblower();
}
