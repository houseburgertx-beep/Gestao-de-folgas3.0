const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
    });
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
