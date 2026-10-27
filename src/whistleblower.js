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
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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
  activeTab: "novo", // "novo" | "consultar" | "gestao"
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

/**
 * Renderiza o aplicativo no contêiner raiz
 */
export function renderWhistleblowerView() {
  const root = $("#whistleblowerAppRoot");
  if (!root) return;

  const isAdminOrManager = state.userProfile && (
    state.userProfile.Perfil === "Administrador" ||
    state.userProfile.Perfil === "Gerente" ||
    state.userProfile.Perfil === "Responsável de loja"
  );

  let tabsHtml = `
    <div class="wb-nav-tabs" role="tablist">
      <button type="button" class="wb-tab-btn ${state.activeTab === "novo" ? "active" : ""}" data-wb-tab="novo">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        Registrar Relato
      </button>
      <button type="button" class="wb-tab-btn ${state.activeTab === "consultar" ? "active" : ""}" data-wb-tab="consultar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        Acompanhar por Protocolo
      </button>
      ${
        isAdminOrManager
          ? `<button type="button" class="wb-tab-btn ${state.activeTab === "gestao" ? "active" : ""}" data-wb-tab="gestao">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Gestão de Integridade (${state.adminCasos.length})
            </button>`
          : ""
      }
    </div>
  `;

  let contentHtml = "";
  if (state.activeTab === "novo") {
    contentHtml = renderFormularioNovo();
  } else if (state.activeTab === "consultar") {
    contentHtml = renderConsulta();
  } else if (state.activeTab === "gestao" && isAdminOrManager) {
    contentHtml = renderPainelGestao();
  }

  root.innerHTML = `
    <div class="wb-container">
      <div class="wb-header-banner">
        <div class="wb-header-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          CANAL CONFIDENCIAL &amp; ANÔNIMO
        </div>
        <h2 class="wb-title">Canal de Integridade e Denúncias</h2>
        <p class="wb-subtitle">
          Espaço seguro e independente para relatar irregularidades, assédio ou infrações às normas da House 190, com proteção integral e opção de anonimato total conforme a Lei 14.457/2022.
        </p>
      </div>
      ${tabsHtml}
      <div class="wb-content-panel">
        ${contentHtml}
      </div>
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

  const lojasOptions = state.lojas
    .map((l) => `<option value="${esc(l.LojaID || l.id)}">${esc(l.NomeLoja || l.Nome || l.id)}</option>`)
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
          Unidade / Loja do Fato
          <select id="wbLoja">
            <option value="GERAL">Toda a Rede / Geral</option>
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

  const rowsHtml = filtered.length === 0
    ? `<tr><td colspan="6" style="text-align:center; padding:32px; color:#64748b;">Nenhum relato registrado neste filtro.</td></tr>`
    : filtered
        .map((c) => {
          const badgeClass = STATUS_BADGE_CLASSES[c.Status] || "badge-slate";
          return `
            <tr>
              <td><strong style="font-family:ui-monospace, monospace; font-size:12.5px;">${esc(c.DenunciaID)}</strong></td>
              <td style="font-variant-numeric:tabular-nums;">${formatDate(c.DataCriacao)}</td>
              <td>${esc(c.Categoria)}</td>
              <td>${esc(c.LojaID || "GERAL")}</td>
              <td><span class="doc-badge ${badgeClass}">${esc(c.Status)}</span></td>
              <td style="text-align:right;">
                <button type="button" class="btn btn-secondary btn-sm" data-wb-action="analisar" data-id="${esc(c.DenunciaID)}" style="min-height:36px; padding:0 12px; border-radius:8px;">
                  Analisar
                </button>
              </td>
            </tr>
          `;
        })
        .join("");

  return `
    <div class="wb-admin-panel">
      <div class="wb-admin-header">
        <div>
          <h3 style="margin:0; font-size:1.1rem; font-weight:700;">Painel de Governança e Compliance</h3>
          <span style="font-size:12px; color:#64748b;">Gestão confidencial de relatos da House 190</span>
        </div>
        <div class="wb-status-filters">
          <button type="button" class="btn-chip ${state.filtroStatusAdmin === "todos" ? "active" : ""}" data-wb-filter="todos">Todos (${casos.length})</button>
          <button type="button" class="btn-chip ${state.filtroStatusAdmin === "Recebida" ? "active" : ""}" data-wb-filter="Recebida">Recebidas</button>
          <button type="button" class="btn-chip ${state.filtroStatusAdmin === "Em Investigação" ? "active" : ""}" data-wb-filter="Em Investigação">Em Investigação</button>
          <button type="button" class="btn-chip ${state.filtroStatusAdmin === "Concluída" ? "active" : ""}" data-wb-filter="Concluída">Concluídas</button>
        </div>
      </div>

      <div class="table-responsive" style="margin-top: 14px; border-radius: 14px; border: 1px solid var(--line, #e2e8f0); overflow-x: auto;">
        <table class="data-table" style="width: 100%; min-width: 600px; border-collapse: collapse;">
          <thead>
            <tr style="background: var(--surface-2, #f8fafc); text-align: left; font-size: 12px; color: #64748b;">
              <th style="padding: 10px 12px;">PROTOCOLO</th>
              <th style="padding: 10px 12px;">DATA</th>
              <th style="padding: 10px 12px;">CATEGORIA</th>
              <th style="padding: 10px 12px;">UNIDADE</th>
              <th style="padding: 10px 12px;">STATUS</th>
              <th style="padding: 10px 12px; text-align: right;">AÇÃO</th>
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
 * Event Listeners e Lógica
 */
function bindEvents() {
  // Navegação entre abas
  $$("[data-wb-tab]").forEach((btn) => {
    btn.onclick = () => {
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
  const msgs = casoData.mensagens || [];

  let modal = $("#wbAdminModal");
  if (!modal) {
    modal = document.createElement("dialog");
    modal.id = "wbAdminModal";
    modal.className = "dialog doc-sign-dialog";
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="dialog-head">
      <div>
        <span class="eyebrow" style="color:#2563eb; font-weight:700; font-size:11px;">TRIAGEM DE CONFORMIDADE</span>
        <h3 style="margin:0; font-size:1.15rem; font-weight:700;">Protocolo ${esc(d.DenunciaID)}</h3>
      </div>
      <button type="button" class="icon-btn" id="wbAdminModalClose" aria-label="Fechar">&times;</button>
    </div>

    <div class="dialog-body" style="padding:16px;">
      <div style="background:var(--surface-2, #f8fafc); padding:12px; border-radius:10px; font-size:13px; margin-bottom:12px;">
        <div><strong>Categoria:</strong> ${esc(d.Categoria)}</div>
        <div><strong>Unidade:</strong> ${esc(d.LojaID)}</div>
        <div><strong>Tipo:</strong> ${d.Anonimo ? "Anônimo" : `Identificado (${esc(d.NomeContato || "")} - ${esc(d.TelefoneContato || "")})`}</div>
        <div><strong>Envolvidos:</strong> ${esc(d.Envolvidos || "Não informado")}</div>
        <div style="margin-top:6px;"><strong>Relato:</strong><br/>${esc(d.Descricao)}</div>
      </div>

      <form id="wbAdminFormModal">
        <label style="display:block; margin-bottom:10px;">
          <strong>Alterar Status da Ocorrência:</strong>
          <select id="wbAdminStatusSelect" style="width:100%; margin-top:4px;">
            <option value="Recebida" ${d.Status === "Recebida" ? "selected" : ""}>Recebida</option>
            <option value="Em Análise" ${d.Status === "Em Análise" ? "selected" : ""}>Em Análise</option>
            <option value="Em Investigação" ${d.Status === "Em Investigação" ? "selected" : ""}>Em Investigação</option>
            <option value="Concluída" ${d.Status === "Concluída" ? "selected" : ""}>Concluída</option>
            <option value="Arquivada" ${d.Status === "Arquivada" ? "selected" : ""}>Arquivada</option>
          </select>
        </label>

        <label style="display:block; margin-bottom:10px;">
          <strong>Parecer Formal da Conclusão / Apuração:</strong>
          <textarea id="wbAdminParecerText" rows="3" style="width:100%; margin-top:4px;" placeholder="Parecer formal do comitê de ética...">${esc(d.ParecerComite || "")}</textarea>
        </label>

        <label style="display:block; margin-bottom:10px;">
          <strong>Enviar Mensagem Oficial ao Denunciante (Opcional):</strong>
          <textarea id="wbAdminRespostaText" rows="2" style="width:100%; margin-top:4px;" placeholder="Esta resposta ficará visível para o denunciante ao consultar o protocolo..."></textarea>
        </label>

        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px;">
          <button type="button" class="btn btn-secondary" id="wbAdminModalCancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="wbAdminModalSave">Salvar Decisão</button>
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
      await window.call("denunciaAdminAtualizar", {
        protocolo: d.DenunciaID,
        status: novoStatus,
        parecer,
        respostaTexto,
      });
      modal.close();
      await loadWhistleblower();
    } catch (err) {
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

    // Obtém perfil atual
    try {
      const profRes = await window.call("perfilObter");
      state.userProfile = profRes?.data || profRes;
    } catch (_) {}

    // Lojas
    try {
      const lojasRes = await window.call("listarLojas");
      state.lojas = lojasRes?.data || lojasRes || [];
    } catch (_) {}

    // Se for admin ou gerente, carrega lista de casos
    if (
      state.userProfile &&
      (state.userProfile.Perfil === "Administrador" ||
        state.userProfile.Perfil === "Gerente" ||
        state.userProfile.Perfil === "Responsável de loja")
    ) {
      const res = await window.call("denunciasAdminListar", {});
      const data = res?.data || res;
      state.adminCasos = data?.denuncias || [];
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
