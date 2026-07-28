export function installGoogleAppsScriptBridge(api) {
  const createRunner = () => {
    let successHandler = () => {};
    let failureHandler = () => {};

    const target = {
      withSuccessHandler(handler) {
        successHandler = typeof handler === "function" ? handler : () => {};
        return proxy;
      },
      withFailureHandler(handler) {
        failureHandler = typeof handler === "function" ? handler : () => {};
        return proxy;
      },
      apiCallWithSession(_token, functionName, args) {
        Promise.resolve(api.invoke(functionName, args))
          .then(successHandler)
          .catch(failureHandler);
        return proxy;
      },
    };

    const proxy = new Proxy(target, {
      get(object, property) {
        if (property in object) return object[property];
        return (...args) => {
          Promise.resolve(api.invoke(String(property), args))
            .then(successHandler)
            .catch(failureHandler);
          return proxy;
        };
      },
    });
    return proxy;
  };

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, "run", {
    configurable: true,
    get: () => createRunner(),
  });
}
