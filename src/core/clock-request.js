// Abort the entire operation (including token renewal and body decoding), not
// only fetch(). Safari/network stalls must leave recovery possible, not keep a
// punch lock forever. Callers still use stable request IDs for ambiguous writes.
export async function withClockDeadline(operation, timeoutMs, message) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message || "O serviço demorou para responder. A tentativa foi preservada para reenvio.");
      error.code = "clock/request-timeout";
      error.retryable = true;
      reject(error);
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function assertClockRequestActive(signal) {
  if (signal.aborted) {
    const error = new Error("O serviço demorou para responder. A tentativa foi preservada para reenvio.");
    error.code = "clock/request-timeout";
    error.retryable = true;
    throw error;
  }
}
