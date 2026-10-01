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
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      wait_one_minute: "Aguarde um minuto antes de enviar outro teste.",
      subscription_expired: "A ativação deste aparelho expirou. Toque em Ativar neste celular para renovar.",
      not_found: "Este aparelho ainda não está vinculado. Ative os lembretes primeiro.",
      device_limit: "Esta conta já tem cinco aparelhos cadastrados. Desative um aparelho antigo.",
      device_belongs_to_other_account: "Este navegador está vinculado a outra conta. Saia dela e desative os lembretes antes de trocar.",
      push_provider_rejected: "O serviço do celular recusou o envio. Desative e ative os lembretes neste aparelho e tente novamente.",
      not_configured: "O serviço de envio está indisponível. Tente novamente em alguns minutos.",
      request_failed: "Não foi possível validar a conta ou acessar o serviço. Entre novamente e tente outra vez."
    };
    if (result.error === "subscription_expired") {
      const sub = await subscription(); await sub?.unsubscribe();
      $("pushEnable").textContent = "Ativar neste celular";
      $("pushTest").disabled = true;
    }
    throw new Error(messages[result.error] || "O envio não foi concluído. Verifique a conexão e tente novamente.");
  }
  return result;
}
async function subscription() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = (await navigator.serviceWorker.getRegistration("./")) || (await navigator.serviceWorker.ready.catch(() => null));
  return registration?.pushManager?.getSubscription?.();
}
const supportsNative = () =>
  "Notification" in window &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

async function refresh() {
  if (!$("pushEnable")) return;
  if (!configured()) {
    status(
      "Os lembretes estão preparados. Falta ativar o serviço de envio com o administrador.",
    );
    $("pushEnable").disabled = true;
    return;
  }
  const nativeSupport = supportsNative();
  const ios = isIos();
  const isStand = standalone();

  // Caso específico do iPhone dentro do Safari (sem suporte direto a push nativo na aba)
  if (ios && !isStand && !nativeSupport) {
    status(
      "No iPhone, as notificações do sistema funcionam pelo app na Tela de Início. Se já baixou, abra pelo ícone; ou toque abaixo para ver o passo a passo.",
    );
    $("pushEnable").disabled = false;
    $("pushEnable").textContent = "Como ativar no iPhone";
    $("pushTest").disabled = true;
    $("pushDisable").disabled = true;
    return;
  }

  if (!nativeSupport) {
    status(
      "Este navegador não oferece suporte a notificações push do sistema.",
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
    try {
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
          ? saved.clockReady === false ? "Aparelho ativado. Sua conta não tem jornada vigente: avisos e testes podem chegar, mas os lembretes de ponto precisam de uma jornada cadastrada." : "Lembretes ativos neste celular. Envie um teste para confirmar a entrega."
          : "Salve as preferências para vincular os lembretes à sua conta.",
      );
    } catch {
      status("Lembretes ativos neste celular. Envie um teste para confirmar a entrega.");
    }
  } else if (Notification.permission === "granted" && !sub && runtime.auth?.currentUser) {
    enable().catch(() => {});
  } else
    status(
      "Receba lembretes com o aplicativo fechado. Você escolhe quais avisos receber.",
    );
}
async function enable() {
  // Ask only on this user gesture, never during login or page load.
  if (!configured()) return;
  const nativeSupport = supportsNative();
  if (isIos() && !standalone() && !nativeSupport) {
    if (typeof window.showDownloadHelp === "function") {
      window.showDownloadHelp();
    } else {
      alert("No iPhone, para ativar as notificações:\n\n1. Se já baixou o app, abra pelo ícone na tela inicial.\n2. Para adicionar: toque em Compartilhar (⎋) no Safari e escolha 'Adicionar à Tela de Início'.");
    }
    return;
  }
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
        try {
          await request("/test", { endpoint: sub.endpoint });
          status("O teste foi enviado! Confira sua central de notificações.");
        } catch (error) {
          status(error.message);
        }
        try {
          const reg = (await navigator.serviceWorker.getRegistration("./")) || (await navigator.serviceWorker.ready);
          if (reg && typeof reg.showNotification === "function") {
            await reg.showNotification("House 190 · Teste de Notificação", {
              body: "Suas notificações estão funcionando perfeitamente!",
              icon: "./icons/app-icon-192.png",
              badge: "./icons/app-icon-192.png",
              tag: "house-teste-local",
              vibrate: [200, 100, 200],
            });
          }
        } catch {}
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
        if (id !== "pushTest") $(id).disabled = false;
        else $(id).disabled = !(await subscription().catch(() => null));
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
