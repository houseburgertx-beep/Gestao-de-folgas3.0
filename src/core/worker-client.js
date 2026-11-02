import { PUSH_CONFIG } from "../push-config.js";
import { runtime } from "./runtime.js";

// Mutations are never retried automatically: a timeout may follow a successful send.
export async function requestWorker(path, payload = {}, options = {}) {
  const headers = { "Content-Type": "application/json" };
  const user = options.public ? null : runtime.auth?.currentUser;
  if (!options.public && !user) throw new Error("Sua sessão expirou. Entre novamente.");
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("Serviço demorou a responder."), { name: "AbortError" }));
    }, options.timeout || 20000);
  });
  try {
    const operation = async () => {
      if (user) {
        headers.Authorization = `Bearer ${await user.getIdToken()}`;
        if (controller.signal.aborted || runtime.auth?.currentUser?.uid !== user.uid) throw new Error("Sua sessão mudou. Entre novamente.");
      }
      const response = await fetch(`${PUSH_CONFIG.endpoint.replace(/\/+$/, "")}${path}`, {
        method: "POST", headers, body: JSON.stringify(payload), signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.success === false || data.ok === false) {
        const error = new Error(data?.message || data?.error || `Serviço indisponível (HTTP ${response.status}).`);
        error.status = response.status;
        throw error;
      }
      if (user && runtime.auth?.currentUser?.uid !== user.uid) throw new Error("Sua sessão mudou. Entre novamente.");
      return data;
    };
    return await Promise.race([operation(), deadline]);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("O serviço demorou a responder. Confira o resultado antes de tentar novamente.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
