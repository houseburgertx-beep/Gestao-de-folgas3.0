export function createClockLocationReader(geolocation, options = {}) {
  const maxAge = options.maxAge ?? 30000;
  const timeout = options.timeout ?? 12000;
  const fallbackDelay = options.fallbackDelay ?? 1200;
  let cached = null;
  let pending = null;
  const valid = (position) => {
    const c = position?.coords;
    return c && Number.isFinite(c.latitude) && Math.abs(c.latitude) <= 90 &&
      Number.isFinite(c.longitude) && Math.abs(c.longitude) <= 180 &&
      Number.isFinite(c.accuracy) && c.accuracy >= 0 && c.accuracy <= 350 &&
      Number.isFinite(position.timestamp) && Date.now() - position.timestamp <= maxAge &&
      position.timestamp <= Date.now() + 5000;
  };
  return function read() {
    if (valid(cached)) return Promise.resolve(cached);
    if (pending) return pending;
    if (!geolocation) return Promise.reject(new Error("Este aparelho não disponibiliza localização."));
    pending = new Promise((resolve, reject) => {
      let done = false;
      let best = null;
      let watchId;
      let lastError;
      const finish = (error, position) => {
        if (done) return;
        done = true;
        clearTimeout(hardTimer);
        clearTimeout(fallbackTimer);
        if (watchId !== undefined) geolocation.clearWatch?.(watchId);
        if (error) reject(error);
        else { cached = position; resolve(position); }
      };
      const onPosition = (position) => {
        if (done || !valid(position)) return;
        if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
        if (best.coords.accuracy <= 100) finish(null, best);
      };
      const onError = (error) => {
        lastError = error;
        if (error?.code === 1) { cached = null; finish(error); }
      };
      const hardTimer = setTimeout(() => {
        if (valid(best)) finish(null, best);
        else finish(lastError || new Error("Não foi possível obter localização precisa. Ative o Wi-Fi e tente novamente."));
      }, timeout);
      const fallbackTimer = setTimeout(() => {
        if (!done) {
          try { geolocation.getCurrentPosition(onPosition, onError, { enableHighAccuracy: false, timeout: Math.max(1000, timeout - fallbackDelay), maximumAge: 0 }); }
          catch (error) { onError(error); }
        }
      }, fallbackDelay);
      try {
        const config = { enableHighAccuracy: true, timeout, maximumAge: 0 };
        if (geolocation.watchPosition) {
          watchId = geolocation.watchPosition(onPosition, onError, config);
          if (done) geolocation.clearWatch?.(watchId);
        } else geolocation.getCurrentPosition(onPosition, onError, config);
      } catch (error) { finish(error); }
    }).finally(() => { pending = null; });
    return pending;
  };
}
