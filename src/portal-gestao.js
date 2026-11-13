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
    .portal-tabs-bar {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px;
      margin-bottom: 18px;
      background: var(--surface-2, #f1f5f9);
      border: 1px solid var(--line, #e2e8f0);
      border-radius: 10px;
      max-width: 100%;
    }
    .portal-tab-btn {
      appearance: none;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted, #64748b);
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
      padding: 8px 14px;
      border-radius: 7px;
      cursor: pointer;
      transition: all 0.16s ease;
      white-space: nowrap;
    }
    .portal-tab-btn:hover {
      color: var(--ink, #0f172a);
    }
    .portal-tab-btn.active {
      background: var(--surface, #ffffff);
      color: var(--brand-solid, #4077ba);
      border-color: var(--line, #e2e8f0);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    }
    .portal-tab-pane.hidden {
      display: none !important;
    }
    #employeeDialog form#employeeForm {
      max-width: 820px;
    }
    .portal-modal-tabs {
      width: 100%;
      margin: 0 0 14px;
      display: flex;
      overflow-x: auto;
    }
  `;
  document.head.appendChild(style);
}

function bindTabsGroup(groupName) {
  const bar = document.querySelector(`.portal-tabs-bar[data-tabs-group="${groupName}"]`);
  if (!bar || bar.dataset.tabsBound === "true") return;
  bar.dataset.tabsBound = "true";

  const activate = (targetKey) => {
    bar.querySelectorAll(".portal-tab-btn").forEach((btn) => {
      const isMatch = btn.getAttribute("data-tab-target") === targetKey;
      btn.classList.toggle("active", isMatch);
      btn.setAttribute("aria-selected", isMatch ? "true" : "false");
    });
    document.querySelectorAll(`.portal-tab-pane[data-tabs-group="${groupName}"]`).forEach((pane) => {
      const isMatch = pane.getAttribute("data-tab-pane") === targetKey;
      pane.classList.toggle("hidden", !isMatch);
    });
  };

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".portal-tab-btn");
    if (!btn) return;
    const target = btn.getAttribute("data-tab-target");
    if (target) activate(target);
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
  wrap.className = "permission-manager";
  wrap.style.cssText = "display:inline-flex; align-items:center; gap:6px; margin-right:4px;";
  wrap.innerHTML = `
    <label for="globalTopStoreSelector" style="margin:0; font-size:12px; color:var(--muted); font-weight:600; display:inline-flex; align-items:center; gap:6px;">
      <span>Unidade:</span>
      <select id="globalTopStoreSelector" style="min-height:36px; border-radius:8px; padding:0 10px; font-size:13px; border:1px solid var(--line); background:var(--surface); color:var(--ink);">
        <option value="">Todas as unidades</option>
      </select>
    </label>
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

function enhanceEmployeeDialog() {
  const form = document.getElementById("employeeForm");
  if (!form || document.getElementById("portalOnboardingTabsWrap")) return;

  const dialogBody = form.querySelector(".dialog-body") || form;
  const baseGrid = dialogBody.querySelector(".dialog-grid");

  const tabsWrap = document.createElement("div");
  tabsWrap.id = "portalOnboardingTabsWrap";
  tabsWrap.innerHTML = `
    <div class="portal-tabs-bar portal-modal-tabs" role="tablist" data-tabs-group="employee-modal">
      <button type="button" class="portal-tab-btn active" data-tab-target="emp-tab-basico" role="tab" aria-selected="true">1. Cadastro &amp; Contrato</button>
      <button type="button" class="portal-tab-btn" data-tab-target="emp-tab-pessoal" role="tab" aria-selected="false">2. Pessoais &amp; Endereço</button>
      <button type="button" class="portal-tab-btn" data-tab-target="emp-tab-funil" role="tab" aria-selected="false">3. Funil (6 Etapas)</button>
      <button type="button" class="portal-tab-btn" data-tab-target="emp-tab-dossie" role="tab" aria-selected="false">4. Dossiê &amp; Termos</button>
    </div>

    <!-- ABA 1: Cadastro Básico (preserva campos originais) + Jornada / Bancário -->
    <div class="portal-tab-pane" data-tab-pane="emp-tab-basico" data-tabs-group="employee-modal" id="empTabBasicoPane">
      <div id="empBaseGridHost"></div>
      <div class="form-grid" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--line);">
        <label>Setor Operacional
          <select id="employeeSetor" name="Setor">
            <option value="Cozinha">Cozinha</option>
            <option value="Salão">Salão</option>
            <option value="Caixa">Caixa</option>
            <option value="Estoque">Estoque</option>
            <option value="Administrativo">Administrativo</option>
          </select>
        </label>
        <label>Período de Experiência
          <select id="employeePeriodoExperiencia" name="PeriodoExperienciaDias">
            <option value="45">45 dias</option>
            <option value="90" selected>90 dias (45 + 45)</option>
          </select>
        </label>
        <label>Horário / Turno de Trabalho
          <input id="employeeTurnoTrabalho" name="TurnoTrabalho" placeholder="Ex: 16:00 às 00:20 (Noturno)" />
        </label>
        <label class="permission-admin">Salário Base Mensal (R$)
          <input id="employeeSalarioBase" name="SalarioBase" type="number" min="0" step="0.01" placeholder="1518.00" />
        </label>
        <label>Chave PIX
          <input id="employeeChavePix" name="ChavePix" placeholder="CPF, Telefone, E-mail ou Aleatória" />
        </label>
        <label>Banco
          <input id="employeeBancoNome" name="BancoNome" placeholder="Ex: Nubank, Itaú, Bradesco" />
        </label>
        <label>Agência
          <input id="employeeBancoAgencia" name="BancoAgencia" placeholder="0001" />
        </label>
        <label>Conta e Dígito
          <input id="employeeBancoConta" name="BancoConta" placeholder="12345-6" />
        </label>
      </div>
    </div>

    <!-- ABA 2: Dados Pessoais, CEP Automático & Emergência -->
    <div class="portal-tab-pane hidden" data-tab-pane="emp-tab-pessoal" data-tabs-group="employee-modal">
      <div class="form-grid">
        <label>Nome Social
          <input id="employeeNomeSocial" name="NomeSocial" placeholder="Opcional" />
        </label>
        <label>RG
          <input id="employeeRG" name="RG" placeholder="00.000.000-0" />
        </label>
        <label>Data de Nascimento
          <input id="employeeDataNascimento" name="DataNascimento" type="date" />
        </label>
        <label>Estado Civil
          <select id="employeeEstadoCivil" name="EstadoCivil">
            <option value="">Selecione</option>
            <option value="Solteiro(a)">Solteiro(a)</option>
            <option value="Casado(a)">Casado(a)</option>
            <option value="União Estável">União Estável</option>
            <option value="Divorciado(a)">Divorciado(a)</option>
            <option value="Viúvo(a)">Viúvo(a)</option>
          </select>
        </label>
        <label>Nome da Mãe
          <input id="employeeNomeMae" name="NomeMae" />
        </label>
        <label>Nome do Pai
          <input id="employeeNomePai" name="NomePai" />
        </label>
        <label>CEP (Busca Automática)
          <input id="employeeCEP" name="CEP" placeholder="00000-000" maxlength="9" />
        </label>
        <label>Endereço / Logradouro
          <input id="employeeEndereco" name="Endereco" />
        </label>
        <label>Número
          <input id="employeeNumeroEndereco" name="NumeroEndereco" />
        </label>
        <label>Complemento
          <input id="employeeComplemento" name="Complemento" />
        </label>
        <label>Bairro
          <input id="employeeBairro" name="Bairro" />
        </label>
        <label>Cidade
          <input id="employeeCidade" name="Cidade" />
        </label>
        <label>UF
          <input id="employeeUF" name="UF" maxlength="2" placeholder="BA" />
        </label>
        <label>Contato de Emergência (Nome)
          <input id="employeeEmergenciaNome" name="ContatoEmergenciaNome" />
        </label>
        <label>Parentesco
          <input id="employeeEmergenciaParentesco" name="ContatoEmergenciaParentesco" placeholder="Ex: Mãe, Cônjuge" />
        </label>
        <label>Telefone de Emergência
          <input id="employeeEmergenciaTelefone" name="ContatoEmergenciaTelefone" placeholder="(73) 99999-9999" />
        </label>
      </div>
    </div>

    <!-- ABA 3: Funil de Admissão em 6 Etapas -->
    <div class="portal-tab-pane hidden" data-tab-pane="emp-tab-funil" data-tabs-group="employee-modal">
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <div>
          <span class="eyebrow">FUNIL DE ADMISSÃO</span>
          <h4 style="margin:2px 0 0;">Linha do Tempo de Contratação (6 Etapas)</h4>
        </div>
        <button type="button" id="btnEmployeeAuditHistory" class="btn btn-secondary permission-admin" style="min-height:36px; font-size:12.5px;">
          Histórico de Alterações
        </button>
      </div>
      <div id="portalOnboardingStagesBar" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:8px; margin-bottom:14px;"></div>
      <div class="form-grid permission-manager" style="align-items:end; padding:12px; background:var(--surface-2); border-radius:10px; border:1px solid var(--line);">
        <label>Etapa Atual do Funil
          <select id="employeeEtapaAdmissao" name="EtapaAdmissao">
            <option value="1">1. Pré-cadastro / Link enviado</option>
            <option value="2">2. Documentos enviados e em análise</option>
            <option value="3">3. Exame Admissional (ASO) agendado/realizado</option>
            <option value="4">4. Contrato Assinado</option>
            <option value="5">5. Ativo - Período de Experiência</option>
            <option value="6">6. Efetivado / Desligado</option>
          </select>
        </label>
        <label>Decisão na Etapa 6
          <select id="employeeSubstatusEtapa6" name="SubstatusEtapa6">
            <option value="Efetivado">Efetivado</option>
            <option value="Desligado">Desligado</option>
          </select>
        </label>
        <label>Validação do Cadastro
          <select id="employeeCadastroValidado" name="CadastroValidado">
            <option value="false">Em preenchimento (Aberto)</option>
            <option value="true">Validado (Bloqueado para Colaborador)</option>
          </select>
        </label>
        <label>Motivo Desligamento (se Etapa 6 = Desligado)
          <input id="employeeMotivoDesligamento" name="MotivoDesligamento" placeholder="Opcional / Obrigatório ao desligar" />
        </label>
        <button type="button" id="btnAvancarEtapaOnboarding" class="btn btn-primary" style="min-height:40px;">
          Registrar Etapa com Data
        </button>
      </div>
      <div id="employeeValidationLockBanner" class="hidden" style="margin-top:10px; padding:10px 12px; border-radius:8px; background:rgba(64,119,186,0.1); color:var(--brand-solid); font-size:12.5px; font-weight:600;">
        Cadastro validado pela gestão. Os dados cadastrais estão bloqueados para edição individual.
      </div>
    </div>

    <!-- ABA 4: Dossiê de Documentos + Geração de Contrato/Termo/EPI PDF -->
    <div class="portal-tab-pane hidden" data-tab-pane="emp-tab-dossie" data-tabs-group="employee-modal">
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <div>
          <span class="eyebrow">DOCUMENTAÇÃO E ASSINATURA</span>
          <h4 style="margin:2px 0 0;">Dossiê de Documentos e Contrato Digital</h4>
        </div>
        <button type="button" id="btnGerarKitAdmissionalPdf" class="btn btn-primary permission-manager" style="min-height:38px; font-size:12.5px;">
          Gerar Contrato / Termo / EPI (PDF)
        </button>
      </div>
      <div class="form-grid" style="align-items:end; padding:12px; background:var(--surface-2); border-radius:10px; border:1px solid var(--line);">
        <label>Tipo de Documento
          <select id="employeeDocUploadTipo">
            ${REQUIRED_ADMISSION_DOCUMENTS.map((d) => `<option value="${d.codigo}">${d.titulo}</option>`).join("")}
          </select>
        </label>
        <label>Link ou Arquivo (PDF / Imagem)
          <input id="employeeDocUploadUrl" type="text" placeholder="Cole URL ou selecione arquivo abaixo" />
        </label>
        <label>Selecionar do aparelho
          <input id="employeeDocUploadFile" type="file" accept=".pdf,image/*" />
        </label>
        <button type="button" id="btnEnviarDocAdmissional" class="btn btn-secondary" style="min-height:40px;">
          Anexar ao Dossiê
        </button>
      </div>
      <div id="employeeDossieChecklist" style="margin-top:12px; display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:8px;"></div>
    </div>
  `;

  if (baseGrid) {
    baseGrid.parentNode.insertBefore(tabsWrap, baseGrid);
    const host = tabsWrap.querySelector("#empBaseGridHost");
    if (host) host.appendChild(baseGrid);
  } else {
    dialogBody.prepend(tabsWrap);
  }

  bindTabsGroup("employee-modal");

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

  // Upload file reader helper
  const fileInput = document.getElementById("employeeDocUploadFile");
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
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
    const dialog = document.getElementById("employeeDialog");
    dialog?.close();
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
      const done = st.etapa <= etapaAtual;
      const dateStr = info?.data ? String(info.data).slice(0, 10) : "Pendente";
      return `
        <div style="padding:8px 10px; border-radius:8px; border:1px solid ${done ? "var(--brand-solid)" : "var(--line)"}; background:${done ? "rgba(64,119,186,0.08)" : "var(--surface)"}; font-size:12px;">
          <strong style="display:block; color:${done ? "var(--brand-solid)" : "var(--ink)"};">${st.titulo}</strong>
          <small style="color:var(--muted);">Data: ${dateStr}</small>
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
        <div style="padding:8px 10px; border-radius:8px; border:1px solid ${item ? "#16a34a" : "var(--line)"}; background:var(--surface); font-size:12px; display:flex; justify-content:space-between; align-items:center;">
          <span>${doc.titulo}</span>
          <strong style="color:${item ? "#16a34a" : "var(--muted)"};">${item ? "Enviado" : "Pendente"}</strong>
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
// TELA 4: SOLICITACOES EM ABAS LIMPAS [FOLGAS | TROCAS DE TURNO | VALES]
// ============================================================================

function mountSolicitacoesTabsAndVale() {
  const timeoffView = document.getElementById("view-timeoff");
  if (!timeoffView || document.getElementById("portalTimeoffTabsBar")) return;

  const toolbar = timeoffView.querySelector(".section-toolbar");
  const titleEl = toolbar?.querySelector("h2");
  if (titleEl) titleEl.textContent = "Solicitações (Folgas, Trocas e Vales)";

  const existingTablePanel = timeoffView.querySelector(".table-panel");
  const tabsBar = document.createElement("div");
  tabsBar.id = "portalTimeoffTabsBar";
  tabsBar.className = "portal-tabs-bar";
  tabsBar.setAttribute("role", "tablist");
  tabsBar.setAttribute("data-tabs-group", "solicitacoes");
  tabsBar.innerHTML = `
    <button type="button" class="portal-tab-btn active" data-tab-target="sol-folgas" role="tab" aria-selected="true">Folgas</button>
    <button type="button" class="portal-tab-btn" data-tab-target="sol-trocas" role="tab" aria-selected="false">Trocas de Turno</button>
    <button type="button" class="portal-tab-btn" data-tab-target="sol-vales" role="tab" aria-selected="false">Vales / Adiantamentos</button>
  `;

  if (toolbar?.nextSibling) {
    timeoffView.insertBefore(tabsBar, toolbar.nextSibling);
  } else {
    timeoffView.appendChild(tabsBar);
  }

  // Envolve a tabela de folgas na aba 1
  if (existingTablePanel) {
    existingTablePanel.classList.add("portal-tab-pane");
    existingTablePanel.setAttribute("data-tab-pane", "sol-folgas");
    existingTablePanel.setAttribute("data-tabs-group", "solicitacoes");
  }

  // Aba 2: Trocas de Turno limpa e fluida
  const swapsPane = document.createElement("div");
  swapsPane.id = "portalTrocasPane";
  swapsPane.className = "portal-tab-pane panel hidden";
  swapsPane.setAttribute("data-tab-pane", "sol-trocas");
  swapsPane.setAttribute("data-tabs-group", "solicitacoes");
  swapsPane.innerHTML = `
    <div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
      <div>
        <span class="eyebrow">TELA 4 · TROCA DE TURNO COM COLEGA</span>
        <h3>Solicitar ou Acompanhar Trocas de Turno</h3>
        <p style="font-size:13px; color:var(--muted);">Fluxo: Solicitado pelo Colaborador -> Aceite do colega indicado -> Aprovação pelo Gerente.</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" id="portalAbrirTrocaTurnoBtn" class="btn btn-primary">+ Nova Troca de Turno</button>
        <button type="button" class="btn btn-secondary" data-view-target="pending-center">Ver Todas as Trocas</button>
      </div>
    </div>
    <p style="font-size:13px; color:var(--muted); margin:0;">
      Clique em <strong>+ Nova Troca de Turno</strong> para indicar a data e selecionar o colega disponível da sua loja.
    </p>
  `;
  timeoffView.appendChild(swapsPane);

  swapsPane.querySelector("#portalAbrirTrocaTurnoBtn")?.addEventListener("click", () => {
    const legacyBtn = document.getElementById("timeOffSwapBtn") || document.getElementById("newSwapBtn");
    legacyBtn?.click();
  });

  // Aba 3: Solicitações de Vale / Adiantamento
  const valePane = document.createElement("div");
  valePane.id = "portalValeSection";
  valePane.className = "portal-tab-pane panel hidden";
  valePane.setAttribute("data-tab-pane", "sol-vales");
  valePane.setAttribute("data-tabs-group", "solicitacoes");
  valePane.innerHTML = `
    <div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
      <div>
        <span class="eyebrow">TELA 4 · ADIANTAMENTOS E VALES</span>
        <h3>Solicitações de Vale / Adiantamento Salarial</h3>
        <p style="font-size:13px; color:var(--muted);">Fluxo: Solicitado -> Validado pelo Gerente -> Aprovado/Pago pela Diretoria (com recibo digital).</p>
      </div>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <span class="badge" id="valeLimiteMaximoBadge">Limite Máx: R$ 1.000,00</span>
        <div class="permission-admin" style="display:inline-flex; gap:6px; align-items:center;">
          <input id="valeNovoLimiteInput" type="number" min="50" step="10" placeholder="Novo limite (R$)" style="width:150px; min-height:36px;" />
          <button type="button" id="btnSalvarLimiteVale" class="btn btn-secondary" style="min-height:36px;">Definir Limite</button>
        </div>
      </div>
    </div>

    <form id="portalSolicitarValeForm" class="form-grid" style="margin:14px 0; align-items:end; padding:14px; background:var(--surface-2); border-radius:10px; border:1px solid var(--line);">
      <label>Valor Solicitado (R$)
        <input id="valeValorInput" type="number" min="10" step="0.01" placeholder="Ex: 250.00" required />
      </label>
      <label>Data Desejada
        <input id="valeDataDesejadaInput" type="date" required />
      </label>
      <label>Motivo da Solicitação
        <input id="valeMotivoInput" type="text" placeholder="Informe brevemente o motivo" required />
      </label>
      <button type="submit" class="btn btn-primary" style="min-height:42px;">Solicitar Vale</button>
    </form>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Data Desejada</th>
            <th>Colaborador</th>
            <th>Unidade</th>
            <th>Valor</th>
            <th>Motivo</th>
            <th>Status</th>
            <th>Comprovante / Recibo</th>
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

async function loadValesList() {
  const tbody = document.getElementById("portalValesTableBody");
  if (!tbody) return;
  try {
    const res = await invokePortal("listarVales", {
      storeId: window.__selectedPortalStoreId || "",
    });
    const { limiteMaximo, vales = [] } = res.data || {};
    const badge = document.getElementById("valeLimiteMaximoBadge");
    if (badge && limiteMaximo) {
      badge.textContent = `Limite Máx: ${formatBRL(limiteMaximo)}`;
    }
    const profile = runtime?.profile;
    const isAdminUser = isDiretoriaProfile(profile);
    const isManagerUser = isGerenteProfile(profile);

    if (!vales.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--muted);">Nenhuma solicitação de vale registrada no período.</td></tr>`;
      return;
    }

    tbody.innerHTML = vales
      .map((v) => {
        const actions = [];
        if (isManagerUser && v.Status === "Solicitado") {
          actions.push(
            `<button type="button" class="btn btn-secondary btn-sm" data-vale-action="validar-gerente" data-vale-id="${v.ValeID}">Validar (Gerente)</button>`,
          );
          actions.push(
            `<button type="button" class="btn btn-ghost btn-sm" data-vale-action="recusar-gerente" data-vale-id="${v.ValeID}">Recusar</button>`,
          );
        }
        if (isAdminUser && (v.Status === "Validado pelo Gerente" || v.Status === "Solicitado")) {
          actions.push(
            `<button type="button" class="btn btn-primary btn-sm" data-vale-action="pagar-diretoria" data-vale-id="${v.ValeID}">Aprovar e Pagar (Diretoria)</button>`,
          );
        }
        return `
          <tr>
            <td>${v.DataDesejada || "-"}</td>
            <td><strong>${v.FuncionarioNome || "-"}</strong></td>
            <td>${v.NomeLoja || v.LojaID || "-"}</td>
            <td style="font-variant-numeric:tabular-nums; font-weight:700;">${formatBRL(v.Valor)}</td>
            <td>${v.Motivo || "-"}</td>
            <td><span class="badge">${v.Status}</span></td>
            <td>${v.ComprovanteURL ? `<a href="${v.ComprovanteURL}" target="_blank" rel="noopener">Ver Comprovante</a>` : "-"}</td>
            <td><div style="display:flex; gap:6px; flex-wrap:wrap;">${actions.join("") || "-"}</div></td>
          </tr>
        `;
      })
      .join("");

    tbody.querySelectorAll("[data-vale-action]").forEach((btn) => {
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
            .map(
              (c) =>
                `<span class="badge" style="background:var(--surface-2); border:1px solid var(--line); color:var(--ink);">${c.Operacao} · ${c.Funcao} (${c.Turno}): <strong>${formatBRL(c.ValorUnitario)}</strong></span>`,
            )
            .join("")}</div>`
        : `<small style="color:var(--muted);">Nenhum valor configurado ainda.</small>`;
    }

    if (!lancamentos.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--muted);">Nenhuma ficha lançada para esta competência.</td></tr>`;
      return;
    }

    tbody.innerHTML = lancamentos
      .map(
        (l) => `
        <tr>
          <td>${l.Data || "-"}</td>
          <td><strong>${l.FuncionarioNome || "-"}</strong></td>
          <td>${l.NomeLoja || l.LojaID || "-"}</td>
          <td><span class="badge">${l.Operacao || "House Tx"}</span></td>
          <td>${l.Funcao || "-"} / ${l.Turno || "Geral"}</td>
          <td style="font-variant-numeric:tabular-nums;">${l.Quantidade}</td>
          <td style="font-variant-numeric:tabular-nums;">${formatBRL(l.ValorUnitario)}</td>
          <td style="font-variant-numeric:tabular-nums; font-weight:700;">${formatBRL(l.ValorTotal)}</td>
          <td>${l.LancadoPor || "-"}</td>
        </tr>
      `,
      )
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
        <span class="eyebrow">TELA 6 · INTEGRAÇÃO E PROCEDIMENTOS INTERNOS</span>
        <h3>POPs e Manuais de Treinamento (Vídeos e PDFs)</h3>
        <p style="font-size:13px; color:var(--muted);">Procedimentos Operacionais Padrão com confirmação obrigatória de leitura por colaborador.</p>
      </div>
    </div>

    <form id="portalPopForm" class="form-grid permission-manager" style="margin:14px 0; padding:14px; background:var(--surface-2); border-radius:10px; border:1px solid var(--line); align-items:end;">
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
        <span class="eyebrow">TELA 8 · CONSOLIDAÇÃO AUTOMÁTICA DE FOLHA</span>
        <h2>Fechamento de Folha Salarial</h2>
        <p id="folhaAccessModeNotice" style="font-size:13px; color:var(--muted);">Cruzamento automático de salário, fichas House Tx / FoodPark Tx, ponto e vales.</p>
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
              <th>Salário Base</th>
              <th>Fichas House Tx</th>
              <th>Fichas FoodPark Tx</th>
              <th>Extras / Bônus</th>
              <th>Vales</th>
              <th>Faltas</th>
              <th>Quebra Caixa</th>
              <th>Valor Líquido</th>
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
      .map(
        (l) => `
        <tr>
          <td>
            <strong>${l.FuncionarioNome}</strong>
            ${l.EditadoManualmente ? `<small style="display:block; color:#d97706;">Ajustado manualmente</small>` : ""}
          </td>
          <td>${l.NomeLoja || l.LojaID || "-"} · ${l.Cargo || "Operação"}</td>
          <td style="font-variant-numeric:tabular-nums;">${formatBRL(l.SalarioBase)}</td>
          <td style="font-variant-numeric:tabular-nums;">${l.QtdFichasHouseTx}x (${formatBRL(l.ValorFichasHouseTx)})</td>
          <td style="font-variant-numeric:tabular-nums;">${l.QtdFichasFoodParkTx}x (${formatBRL(l.ValorFichasFoodParkTx)})</td>
          <td style="font-variant-numeric:tabular-nums;">${formatBRL(Number(l.HorasExtrasValor || 0) + Number(l.BonusValor || 0))}</td>
          <td style="font-variant-numeric:tabular-nums; color:#dc2626;">- ${formatBRL(l.TotalValesAdiantamentos)}</td>
          <td style="font-variant-numeric:tabular-nums; color:#dc2626;">${l.FaltasInjustificadas}x (- ${formatBRL(l.DescontoFaltasAtrasos)})</td>
          <td style="font-variant-numeric:tabular-nums; color:#dc2626;">- ${formatBRL(l.QuebraDeCaixaValor)}</td>
          <td style="font-variant-numeric:tabular-nums; font-weight:700; color:#16a34a;">${formatBRL(l.ValorLiquido)}</td>
          <td><code>${l.ChavePix || "-"}</code></td>
          <td><span class="badge">${l.StatusLinha}</span></td>
          <td class="permission-admin">
            ${
              data.permissaoEdicao
                ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-folha-emp="${l.FuncionarioID}">Editar</button>`
                : `<small style="color:var(--muted);">Bloqueado</small>`
            }
          </td>
        </tr>
      `,
      )
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
        return `
          <tr>
            <td style="font-variant-numeric:tabular-nums;">${quando}</td>
            <td>${quem}</td>
            <td><span class="badge">${l.Acao}</span></td>
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
    loadValesList(),
    loadFichasView(),
    loadPopsList(),
    loadPayrollClosingTable(),
  ]);
}

export function initPortalGestao() {
  if (typeof document === "undefined") return;
  injectPortalTabsStyles();
  mountTopbarStoreSelector();
  mountWhatsAppPasswordRecovery();
  enhanceEmployeeDialog();
  mountSolicitacoesTabsAndVale();
  bindFichasView();
  mountCommunicationTabsAndPops();
  mountPayrollClosingScreen();
  enhanceAuditView();

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-view");
      if (view === "fichas") loadFichasView();
      if (view === "monthly-closing") loadPayrollClosingTable();
      if (view === "timeoff") loadValesList();
      if (view === "communication") loadPopsList();
      if (view === "audit") loadAuditHistoryTable();
    });
  });

  setTimeout(() => {
    refreshPortalViews();
  }, 1200);
}

if (typeof window !== "undefined") {
  window.initPortalGestao = initPortalGestao;
  window.refreshPortalViews = refreshPortalViews;
  window.renderEmployeeOnboardingState = renderEmployeeOnboardingState;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initPortalGestao());
  } else {
    initPortalGestao();
  }
}
