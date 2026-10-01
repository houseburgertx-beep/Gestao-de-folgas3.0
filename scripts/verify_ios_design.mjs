import path from "node:path";
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";

const ARTIFACT_DIR = "/Users/gleuce/.gemini/antigravity/brain/0a73062c-efb8-4333-8c0b-796f4cb2764a";
const SCREENSHOT_DIR = path.join(ARTIFACT_DIR, "mobile_audit");
await mkdir(SCREENSHOT_DIR, { recursive: true });

const PORT = 8089;
const CDP_PORT = 9222;

// Clean up any stale instances
const chromeProc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=393,852",
  "--user-data-dir=/tmp/c9222-verify-" + Date.now(),
  `http://localhost:${PORT}/index.html`
], { stdio: "ignore" });

process.on("exit", () => {
  try { chromeProc.kill(); } catch (e) {}
});

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const tabs = await res.json();
      const page = tabs.find(t => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) {}
  }
  throw new Error("Could not connect to Chrome CDP page");
}

const wsUrl = await getWsUrl();
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.onopen = r);

let id = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(data.error);
    else resolve(data.result);
  }
};

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const curId = id++;
    pending.set(curId, { resolve, reject });
    ws.send(JSON.stringify({ id: curId, method, params }));
  });
}

// Emulate iPhone 15 Pro (393 x 852, 3x scale)
await send("Emulation.setDeviceMetricsOverride", {
  width: 393,
  height: 852,
  deviceScaleFactor: 3,
  mobile: true,
  screenOrientation: { angle: 0, type: "portraitPrimary" }
});
await send("Emulation.setUserAgentOverride", {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
});

await send("Page.enable");
await send("Runtime.enable");

await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    try {
      localStorage.setItem("house-pwa-install-notice-seen-v1", "1");
      localStorage.setItem("jornada-installed", "1");
    } catch (e) {}
  `
});

console.log("Navigating to http://localhost:8089...");
await send("Page.navigate", { url: `http://localhost:${PORT}/index.html?t=${Date.now()}` });
await sleep(1500);

async function evalCode(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return res.result?.value;
}

async function takeScreenshot(name) {
  const res = await send("Page.captureScreenshot", { format: "png" });
  const buffer = Buffer.from(res.data, "base64");
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await writeFile(filePath, buffer);
  console.log(`Saved screenshot: ${name}.png`);
}

// Clean overlays
await evalCode(`
  document.querySelectorAll(".app-download-overlay").forEach(el => el.remove());
  document.querySelectorAll("dialog").forEach(d => {
    try { d.close(); } catch(e) {}
    d.removeAttribute("open");
    d.style.display = "none";
  });
  document.querySelectorAll(".alert").forEach(el => el.remove());
  document.getElementById("loadingOverlay")?.classList.add("hidden");
`);

// 1. Tela de Login Clean
console.log("Capturing 01_login_clean...");
await evalCode(`
  document.getElementById("loginScreen")?.classList.remove("hidden");
  document.getElementById("app")?.classList.add("hidden");
  document.getElementById("loginForm")?.classList.remove("hidden");
  document.getElementById("resetPasswordForm")?.classList.add("hidden");
  window.scrollTo(0, 0);
`);
await sleep(300);
await takeScreenshot("01_login_clean");

// 2. Tela de Redefinição de Senha Clean
console.log("Capturing 02_reset_password_clean...");
await evalCode(`
  document.getElementById("loginForm")?.classList.add("hidden");
  document.getElementById("resetPasswordForm")?.classList.remove("hidden");
  window.scrollTo(0, 0);
`);
await sleep(300);
await takeScreenshot("02_reset_password_clean");

// 3. Montar App Shell com Mock de Dados Colorful Liquid iOS
console.log("Setting up App Shell...");
await evalCode(`
  document.getElementById("loginScreen")?.classList.add("hidden");
  document.getElementById("app")?.classList.remove("hidden");
  document.querySelectorAll(".alert").forEach(el => el.remove());
  document.querySelectorAll(".app-download-overlay").forEach(el => el.remove());

  const mockUser = {
    FuncionarioID: "FUNC-101",
    funcionarioId: "FUNC-101",
    Nome: "Matheus Oliveira",
    Email: "matheus@houseburgertx.com",
    LojaID: "LOJA-1",
    NomeLoja: "House Burger TX",
    Pontos: 320,
    SaldoFolgas: 3,
    Ativo: true,
    DiaFolgaPreferencial: "Segunda-feira"
  };

  const mockJourneyDetail = {
    user: mockUser,
    manager: false,
    employees: [mockUser],
    clock: {
      date: new Date().toISOString().slice(0, 10),
      nextAction: "SAIDA_INTERVALO",
      todayRecords: [
        { TipoMarcacao: "ENTRADA", DataHora: new Date().toISOString().slice(0, 10) + "T16:02:00Z" }
      ],
      summary: { incompleto: false }
    },
    balance: {
      employees: [{ FuncionarioID: "FUNC-101", saldoTexto: "+4h 15min", desde: "2026-09-01" }],
      totalTexto: "+4h 15min"
    },
    timeOff: [
      { FolgaID: "F-1", FuncionarioID: "FUNC-101", NomeFuncionario: "Matheus Oliveira", DataInicio: "2026-10-08", DataFim: "2026-10-08", Status: "aprovada", TipoFolga: "Folga Mensal" }
    ],
    schedules: [
      { FuncionarioID: "FUNC-101", DiaSemana: 1, HoraEntrada: "16:00", HoraSaida: "00:00" }
    ],
    coreReady: true
  };

  window.dispatchEvent(new CustomEvent("house-journey", { detail: mockJourneyDetail }));
`);
await sleep(500);

// Helper para alternar visualizações
async function switchToView(viewTarget) {
  return await evalCode(`
    document.querySelectorAll(".alert").forEach(el => el.remove());
    document.querySelectorAll(".app-download-overlay").forEach(el => el.remove());
    document.querySelectorAll("dialog").forEach(d => {
      try { d.close(); } catch(e) {}
      d.removeAttribute("open");
      d.style.display = "none";
    });

    document.querySelectorAll(".view").forEach(v => {
      const match = v.id === "view-" + "${viewTarget}";
      v.classList.toggle("active", match);
      v.style.display = match ? "block" : "none";
    });

    document.querySelectorAll(".mobile-dock button").forEach(b => {
      const match = b.dataset.viewTarget === "${viewTarget}";
      b.classList.toggle("active", match);
      if (match) {
        try { b.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" }); } catch(_) {}
      }
    });
    window.positionDockIndicator?.();

    window.scrollTo(0, 0);

    ({
      scrollWidth: document.scrollingElement.scrollWidth,
      innerWidth: window.innerWidth,
      hasOverflow: document.scrollingElement.scrollWidth > window.innerWidth
    })
  `);
}

// 3. View Dashboard (Colaborador)
console.log("Capturing 03_view_dashboard...");
let ov = await switchToView("dashboard");
console.log("Dashboard overflow:", ov);
await sleep(400);
await takeScreenshot("03_view_dashboard");

// 3b. Dashboard Scrolled (Verificar remoção de Minha Programação)
await evalCode(`window.scrollTo(0, 480);`);
await sleep(300);
await takeScreenshot("03b_view_dashboard_scrolled");

// 4. View Timeclock (Meu Ponto)
console.log("Capturing 04_view_timeclock...");
ov = await switchToView("timeclock");
console.log("Timeclock overflow:", ov);
await evalCode(`
  const liveTime = document.getElementById("clockLiveTime");
  if (liveTime) liveTime.textContent = "18:42:05";
  const punchBtn = document.getElementById("clockPunchBtn");
  if (punchBtn) {
    punchBtn.textContent = "Registrar Saída Intervalo";
    punchBtn.classList.add("btn-punch-exit");
    punchBtn.dataset.punchAction = "SAIDA_INTERVALO";
    punchBtn.classList.remove("action-busy");
    punchBtn.disabled = false;
  }
  const skipBtn = document.getElementById("clockSkipBreakBtn");
  if (skipBtn) {
    skipBtn.textContent = "Não tirar descanso (+60min extra)";
    skipBtn.classList.remove("hidden");
    skipBtn.disabled = false;
  }
  const hint = document.getElementById("clockLocationHint");
  if (hint) {
    hint.textContent = "Sua selfie e localização serão validadas no momento do registro. A foto ficará no Google Drive.";
  }
  const todayList = document.getElementById("clockTodayList");
  if (todayList) {
    todayList.innerHTML = \`
      <div class="clock-entry done" style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:#F4F5FB; border-radius:18px; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="background:#DBF3EE; color:#0D6854; width:28px; height:28px; border-radius:50%; display:grid; place-items:center; font-size:12px; font-weight:700;">1</span>
          <div>
            <strong style="display:block; font-size:14px; color:#242737;">Entrada realizada</strong>
            <small style="color:#858A9E; font-size:12px;">No horário previsto (tolerância ok)</small>
          </div>
        </div>
        <strong style="font-size:15px; color:#0D6854;">16:02</strong>
      </div>
      <div class="clock-entry next" style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:#E6E2FF; border-radius:18px; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="background:#807EFA; color:#FFFFFF; width:28px; height:28px; border-radius:50%; display:grid; place-items:center; font-size:12px; font-weight:700;">2</span>
          <div>
            <strong style="display:block; font-size:14px; color:#4F46E5;">Saída para Intervalo</strong>
            <small style="color:#858A9E; font-size:12px;">Ponto pendente para registrar agora</small>
          </div>
        </div>
        <strong style="font-size:15px; color:#807EFA;">AGORA</strong>
      </div>
    \`;
  }
`);
await sleep(400);
await takeScreenshot("04_view_timeclock");

// 5. View CozinhaFlow & Tarefas
console.log("Capturing 05_view_tasks...");
ov = await switchToView("tasks");
console.log("Tasks overflow:", ov);
await evalCode(`
  window.renderCozinhaFlowApp?.();
`);
await sleep(400);
await takeScreenshot("05_view_tasks");

// 6. View Central de Pendências
console.log("Capturing 08_view_pending_center...");
ov = await switchToView("pending-center");
console.log("Pending Center overflow:", ov);
await sleep(400);
await takeScreenshot("08_view_pending_center");

// 7. View Calendário
console.log("Capturing 09_view_calendar...");
ov = await switchToView("calendar");
console.log("Calendar overflow:", ov);
await sleep(400);
await takeScreenshot("09_view_calendar");

// 8. View Escala
console.log("Capturing 07_view_shift_plan...");
ov = await switchToView("shift-plan");
console.log("Shift Plan overflow:", ov);
await sleep(400);
await takeScreenshot("07_view_shift_plan");

// 9. View Minhas Folgas
console.log("Capturing 10_view_timeoff...");
ov = await switchToView("timeoff");
console.log("Timeoff overflow:", ov);
await sleep(400);
await takeScreenshot("10_view_timeoff");

console.log("All views captured successfully with Colorful Liquid iOS styling!");
ws.close();
chromeProc.kill();
process.exit(0);
