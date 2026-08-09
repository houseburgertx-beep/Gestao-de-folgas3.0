const SERVICE_WORKER_VERSION = "6.3.9";

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    const registration = await navigator.serviceWorker.register(
      `./sw.js?v=${SERVICE_WORKER_VERSION}`,
      {
        scope: "./",
        updateViaCache: "none",
      },
    );
    registration.update().catch(() => null);
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
