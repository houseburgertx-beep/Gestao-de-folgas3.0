import { renderRecognitionPanel } from "./recognition-panel.js";
window.renderRecognitionPanel_ = renderRecognitionPanel;
import "./brand.js";
import "./journey.js";
import "./tasks.js";
import "./documents.js";
import "./whistleblower.js";
import "./portal-gestao.js";
import { createApi } from "./core/api.js";
import { installGoogleAppsScriptBridge } from "./core/bridge.js";
import "./pwa.js";
import "./push.js";
import {
  firebaseConfigurationProblems,
  runtime,
} from "./core/runtime.js";
import * as takeatCredit from "./core/takeat-credit.js";

import { acquireClockCamera } from "./core/clock-camera.js";
import * as clockRecovery from "./core/clock-punch-recovery.js";
import { createClockLocationReader } from "./core/clock-location.js";
import { PUSH_CONFIG } from "./push-config.js";

// The assistant is sizeable and is not needed to authenticate or register a
// punch. Keep its parsing/initialization off the initial mobile startup path.
function installDeferredCopilot(load = () => import("./copilot.js")) {
  let pending = false;
  const onOpen = async (event) => {
    const button = event.target?.closest?.("#copilotFab, #copilotOpenBtn");
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Several taps while downloading must still open the drawer only once.
    if (pending) return;
    pending = true;
    button.setAttribute("aria-busy", "true");
    try {
      const module = await load();
      module.initCopilot();
      document.removeEventListener("click", onOpen, true);
      button.removeAttribute("aria-busy");
      button.click();
    } catch (error) {
      // Keep the listener installed so the next tap can retry a failed chunk.
      console.warn("Não foi possível abrir o assistente:", error);
      window.__GESTAO_TOAST__?.("Não foi possível abrir o assistente. Toque novamente para tentar.");
    } finally {
      pending = false;
      button.removeAttribute("aria-busy");
    }
  };
  document.addEventListener("click", onOpen, true);
}

installDeferredCopilot();

window.__GESTAO_CLOCK_CAMERA__ = acquireClockCamera;
window.__GESTAO_CLOCK_RECOVERY__ = clockRecovery;
window.__GESTAO_CLOCK_LOCATION__ = createClockLocationReader(navigator.geolocation, {
  permissions: navigator.permissions,
  secureContext: window.isSecureContext,
  allowedByPolicy: () => (document.permissionsPolicy || document.featurePolicy)?.allowsFeature?.("geolocation") !== false,
});
window.__GESTAO_WORKER_URL__ = PUSH_CONFIG.endpoint;
const api = createApi();
window.__GESTAO_FIREBASE__ = { runtime, api };
window.__GESTAO_TAKEAT_CREDIT__ = takeatCredit;

const signalApiReady = () => {
  window.__GESTAO_API_STATUS__ = "ready";
  window.__GESTAO_API_READY__ = Promise.resolve();
  window.__resolveGestaoApiReady__?.();
  window.dispatchEvent(new CustomEvent("gestao-api-ready"));
};

const signalApiFailure = (error) => {
  window.__GESTAO_API_STATUS__ = "failed";
  window.__rejectGestaoApiReady__?.(error);
};

const waitForDom = () =>
  document.readyState === "loading"
    ? new Promise((resolve) =>
        document.addEventListener("DOMContentLoaded", resolve, { once: true }),
      )
    : Promise.resolve();

const hideApplicationSurfaces = () => {
  document.querySelector("#loadingOverlay")?.classList.add("hidden");
  document.querySelector("#loginScreen")?.classList.add("hidden");
  document.querySelector("#app")?.classList.add("hidden");
  document.querySelector("#unauthorized")?.classList.add("hidden");
};

const setupShell = (content) => {
  document.querySelector("#firebaseSetupScreen")?.remove();
  const section = document.createElement("section");
  section.id = "firebaseSetupScreen";
  section.className = "login-screen";
  section.innerHTML = `
    <div class="login-shell">
      <div class="login-brand-panel">
        <div class="login-brand-content">
          <div class="brand-logo login-logo" aria-label="Grupo House 190"></div>
          <strong class="login-group-name">Grupo House 190</strong>
          <span class="eyebrow">INSTALAÇÃO FIREBASE</span>
          <h1>Seu sistema.<br>Agora independente.</h1>
          <p>Versão preparada para GitHub Pages, Firebase Authentication e Realtime Database.</p>
          <div class="login-feature"><i>✓</i><span>Sem Google Apps Script</span></div>
          <div class="login-feature"><i>✓</i><span>Publicação automática pelo GitHub</span></div>
          <div class="login-feature"><i>✓</i><span>Plano gratuito Spark</span></div>
        </div>
      </div>
      <div class="login-form-panel">${content}</div>
    </div>`;
  document.body.appendChild(section);
  return section;
};

const showConfigurationRequired = (problems) => {
  hideApplicationSurfaces();
  setupShell(`
    <div class="login-card">
      <span class="eyebrow">FALTA CONECTAR O FIREBASE</span>
      <h2>Complete a configuração</h2>
      <p>Abra <code>src/firebase-config.js</code> e substitua os campos de exemplo pelos dados do seu aplicativo Web.</p>
      <div class="setup-notice">
        <strong>Campos pendentes</strong>
        <p>${problems.join(", ")}</p>
      </div>
      <p class="reset-password-hint">Depois salve o arquivo e execute novamente <code>npm run dev</code>.</p>
    </div>`);
};

const showInitialSetup = () => {
  hideApplicationSurfaces();
  const section = setupShell(`
    <form id="firebaseInitialSetupForm" class="login-card">
      <span class="eyebrow">PRIMEIRO ACESSO</span>
      <h2>Crie o administrador</h2>
      <p>Esta etapa aparece uma única vez. O primeiro acesso será o administrador do sistema.</p>
      <label>Nome completo
        <input id="setupAdminName" autocomplete="name" required placeholder="Nome do administrador">
      </label>
      <label>E-mail
        <input id="setupAdminEmail" type="email" autocomplete="username" required placeholder="admin@suaempresa.com">
      </label>
      <label>Senha
        <input id="setupAdminPassword" type="password" autocomplete="new-password" minlength="10" required placeholder="Mínimo 10 caracteres">
      </label>
      <label>Nome da empresa
        <input id="setupCompanyName" required value="Grupo House 190">
      </label>
      <button class="btn btn-primary login-submit" type="submit">Criar sistema</button>
      <p id="setupInitialError" class="login-error hidden"></p>
    </form>`);
  const form = section.querySelector("#firebaseInitialSetupForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const error = form.querySelector("#setupInitialError");
    error.classList.add("hidden");
    button.disabled = true;
    button.textContent = "Criando estrutura…";
    try {
      await runtime.setupInitialAdmin({
        name: form.querySelector("#setupAdminName").value,
        email: form.querySelector("#setupAdminEmail").value,
        password: form.querySelector("#setupAdminPassword").value,
        company: form.querySelector("#setupCompanyName").value,
      });
      const token = await runtime.auth.currentUser.getIdToken();
      if (typeof window.storeSessionToken_ === "function") {
        window.storeSessionToken_(
          token,
          true,
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        );
      } else {
        localStorage.setItem("gf-session-token", token);
        sessionStorage.setItem("gf-session-token", token);
      }
      location.reload();
    } catch (failure) {
      const message =
        failure?.message || "Não foi possível concluir a configuração.";
      error.textContent = /PERMISSION_DENIED|permission[- ]denied/i.test(message)
        ? "O Firebase bloqueou o banco. Publique database.rules.json no Realtime Database e clique novamente em Criar sistema."
        : message;
      error.classList.remove("hidden");
      button.disabled = false;
      button.textContent = "Criar sistema";
    }
  });
};

const problems = firebaseConfigurationProblems();
if (problems.length) {
  signalApiFailure(new Error("A configuração do Firebase está incompleta."));
  waitForDom().then(() => showConfigurationRequired(problems));
} else {
  try {
    runtime.initialize();
    installGoogleAppsScriptBridge(api);
    signalApiReady();
    runtime
      .ready()
      .then(async () => {
        await waitForDom();
        if (!(await runtime.isInitialized())) showInitialSetup();
      })
      .catch(async (error) => {
        signalApiFailure(error);
        await waitForDom();
        hideApplicationSurfaces();
        setupShell(`
          <div class="login-card">
            <span class="eyebrow">CONEXÃO NÃO CONCLUÍDA</span>
            <h2>Verifique o Firebase</h2>
            <p class="login-error">${String(
              error?.message || "Não foi possível conectar.",
            )}</p>
            <button class="btn btn-primary login-submit" onclick="location.reload()">Tentar novamente</button>
          </div>`);
      });
  } catch (error) {
    signalApiFailure(error);
    waitForDom().then(() => {
      hideApplicationSurfaces();
      setupShell(`
        <div class="login-card">
          <span class="eyebrow">CONEXÃO NÃO CONCLUÍDA</span>
          <h2>Verifique o Firebase</h2>
          <p class="login-error">${String(
            error?.message || "Não foi possível conectar.",
          )}</p>
          <button class="btn btn-primary login-submit" onclick="location.reload()">Tentar novamente</button>
        </div>`);
    });
  }
}
