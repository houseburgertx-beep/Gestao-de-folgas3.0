// Tests must stub external services explicitly. Local emulators remain available.
const fetchNetwork = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return Promise.reject(new Error("Teste bloqueou acesso a serviço externo; forneça um mock."));
  }
  return fetchNetwork(input, options);
};
