import { PUSH_CONFIG } from "./push-config.js";
import { registerServiceWorker } from "./pwa.js";
import { runtime } from "./core/runtime.js";
const $ = (id) => document.getElementById(id);
const configured = () =>
  /^https:\/\//.test(PUSH_CONFIG.endpoint) &&
  Boolean(PUSH_CONFIG.vapidPublicKey);
const status = (text) => {
  if ($("pushStatus")) $("pushStatus").textContent = text;
};
const prefs = () => ({
  clock: $("pushClock").checked,
  interval: $("pushBreak").checked,
  notices: $("pushNotices").checked,
});
const keyBytes = (base64) =>
  Uint8Array.from(atob(base64.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () =>
  matchMedia("(display-mode: standalone)").matches || navigator.standalone;
async function request(path, body) {
  const user = runtime.auth?.currentUser;
  if (!user)
    throw new Error("Entre na sua conta para configurar os lembretes.");
  const response = await fetch(
    `${PUSH_CONFIG.endpoint.replace(/\/$/, "")}${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error("Não foi possível salvar os lembretes. Tente novamente.");
  return response.json();
}
async function subscription() {
  const registration = await navigator.serviceWorker.getRegistration("./");
  return registration?.pushManager.getSubscription();
}
async function refresh() {
  if (!$("pushEnable")) return;
  if (!configured()) {
    status(
      "Os lembretes estão preparados. Falta ativar o serviço de envio com o administrador.",
    );
    $("pushEnable").disabled = true;
    return;
  }
  if (isIos() && !standalone()) {
    status(
      "No iPhone, adicione o app à Tela de Início, abra pelo ícone e ative os lembretes aqui.",
    );
    $("pushEnable").disabled = true;
    return;
  }
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    status(
      "Este navegador não oferece notificações. Use um navegador compatível.",
    );
    $("pushEnable").disabled = true;
    return;
  }
  const sub = await subscription();
  $("pushEnable").disabled = Notification.permission === "denied";
  $("pushEnable").textContent = sub
    ? "Salvar preferências"
    : "Ativar neste celular";
  $("pushTest").disabled = !sub;
  $("pushDisable").disabled = !sub;
  if (Notification.permission === "denied")
    status(
      "Notificações bloqueadas. Libere a permissão nas configurações do celular.",
    );
  else if (sub && runtime.auth?.currentUser) {
    const saved = await request("/status", { endpoint: sub.endpoint });
    $("pushTest").disabled = !saved.enabled;
    if (saved.preferences)
      for (const [id, key] of [
        ["pushClock", "clock"],
        ["pushBreak", "interval"],
        ["pushNotices", "notices"],
      ])
        $(id).checked = saved.preferences[key];
    status(
      saved.enabled
        ? "Lembretes ativos neste celular. Você pode atualizar suas preferências abaixo."
        : "Salve as preferências para vincular os lembretes à sua conta.",
    );
  } else
    status(
      "Receba lembretes com o aplicativo fechado. Você escolhe quais avisos receber.",
    );
}
async function enable() {
  // Ask only on this user gesture, never during login or page load.
  if (!configured()) return;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    await refresh();
    return;
  }
  const registration = await registerServiceWorker();
  if (!registration)
    throw new Error("Não foi possível preparar as notificações.");
  await navigator.serviceWorker.ready;
  const sub =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(PUSH_CONFIG.vapidPublicKey),
    }));
  await request("/subscribe", {
    subscription: sub.toJSON(),
    preferences: prefs(),
  });
  await refresh();
  status(
    "Lembretes ativados e preferências salvas neste celular. Use Enviar teste para conferir a entrega.",
  );
}
async function disable() {
  const sub = await subscription();
  if (sub) {
    await request("/unsubscribe", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  await refresh();
  status("Lembretes desativados neste celular.");
}
// Logout must revoke the device first; failures don't block the user's logout.
window.__disableGestaoPush = async () => {
  if (!configured() || !("serviceWorker" in navigator)) return;
  try {
    await disable();
  } catch {
    const sub = await subscription();
    await sub?.unsubscribe();
  }
};
function bind() {
  for (const [id, action] of [
    ["pushEnable", enable],
    ["pushDisable", disable],
    [
      "pushTest",
      async () => {
        const sub = await subscription();
        if (!sub) return;
        await request("/test", { endpoint: sub.endpoint });
        status("Teste enviado. Confira a central de notificações do celular.");
      },
    ],
  ]) {
    $(id)?.addEventListener("click", async () => {
      $(id).disabled = true;
      try {
        await action();
      } catch (error) {
        status(error.message);
      } finally {
        $(id).disabled = false;
      }
    });
  }
  window.addEventListener("gestao-notifications-open", () =>
    refresh().catch(() =>
      status(
        "Não foi possível confirmar o serviço de lembretes. Tente novamente.",
      ),
    ),
  );
  refresh().catch(() =>
    status("Não foi possível consultar as notificações deste celular."),
  );
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", bind, { once: true });
else bind();
