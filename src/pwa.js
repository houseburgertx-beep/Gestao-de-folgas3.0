const SERVICE_WORKER_VERSION = "6.15.4";

let registrationPromise;
const registerServiceWorker = () => registrationPromise ||= registerOnce();
const registerOnce = async () => {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "FORCE_UPDATE" && !refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
    const registration = await navigator.serviceWorker.register(
      `./sw.js?v=${SERVICE_WORKER_VERSION}`,
      {
        scope: "./",
        updateViaCache: "none",
      },
    );

    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      }
    });

    registration.update().catch(() => null);

    // Auto-check for updates when app returns to foreground
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => null);
        }
      });
      window.addEventListener("online", () => {
        registration.update().catch(() => null);
      });
    }

    return registration;
  } catch (error) {
    console.warn("Aplicativo instalável:", error?.message || error);
    return null;
  }
};

if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    registerServiceWorker();
  });
}

export { registerServiceWorker };
