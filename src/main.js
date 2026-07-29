import arenaClient from "./legacy/ArenaClient.html?raw";
import arenaMobileRuntime from "./legacy/ArenaMobileRuntime.html?raw";
import arenaMobileStyles from "./legacy/ArenaMobileStyles.html?raw";
import arenaStyles from "./legacy/ArenaStyles.html?raw";
import houseLinkClient from "./legacy/HouseLinkClient.html?raw";
import houseLinkStyles from "./legacy/HouseLinkStyles.html?raw";
import { createApi } from "./core/api.js";
import { installGoogleAppsScriptBridge } from "./core/bridge.js";
import {
  firebaseConfigurationProblems,
  runtime,
} from "./core/runtime.js";

const unwrap = (source, tag) =>
  String(source || "")
    .replace(new RegExp(`^\\s*<${tag}[^>]*>\\s*`, "i"), "")
    .replace(new RegExp(`\\s*</${tag}>\\s*$`, "i"), "");

const arenaBundle = () => ({
  version: "6.1.1-firebase-github",
  css: [
    unwrap(arenaStyles, "style"),
    unwrap(arenaMobileStyles, "style"),
    unwrap(houseLinkStyles, "style"),
  ],
  scripts: [
    unwrap(arenaClient, "script"),
    unwrap(houseLinkClient, "script"),
    unwrap(arenaMobileRuntime, "script"),
  ],
});

const api = createApi(arenaBundle);
installGoogleAppsScriptBridge(api);
window.__GESTAO_FIREBASE__ = { runtime, api };

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
  waitForDom().then(() => showConfigurationRequired(problems));
} else {
  try {
    runtime.initialize();
    runtime
      .ready()
      .then(async () => {
        await waitForDom();
        if (!(await runtime.isInitialized())) showInitialSetup();
      })
      .catch(async (error) => {
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
