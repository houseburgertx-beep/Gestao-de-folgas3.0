// Photos are retained on this device only until the remote punch is confirmed.
// Never persist Firebase tokens, passwords or another user's recovery payload.
const DATABASE_NAME = "house-clock-recovery";
const STORE_NAME = "attempts";
const localLocks = new Map();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

export function createClockAttemptStore(indexedDB = globalThis.indexedDB, { timeoutMs = 8000 } = {}) {
  let database;
  const memory = new Map();
  const keyFor = (uid, requestId) => `${uid}:${requestId}`;
  const unavailable = () => new Error("O armazenamento do ponto demorou para responder. Feche outras abas ou reabra o aplicativo e tente novamente.");
  const open = () => {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      let settled = false;
      let request;
      const fail = (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error || unavailable()); } };
      const timer = setTimeout(() => fail(unavailable()), timeoutMs);
      try { request = indexedDB.open(DATABASE_NAME, 2); } catch (error) { fail(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? request.transaction.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: "key" });
        // Query only the connected user's rows instead of loading every photo
        // from every account that has used this device into JavaScript memory.
        if (!store.indexNames.contains("uid")) store.createIndex("uid", "uid", { unique: false });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        clearTimeout(timer);
        db.onversionchange = () => { db.close(); database = null; };
        resolve(db);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error("Feche as outras abas do ponto e tente novamente."));
    }).catch((error) => { database = null; throw error; });
    return database;
  };
  const transact = async (mode, operation) => {
    if (!indexedDB) {
      if (typeof window !== "undefined") {
        throw new Error("O armazenamento seguro do ponto está indisponível neste navegador. Libere o armazenamento e tente novamente.");
      }
      return operation(null, memory);
    }
    const db = await open();
    return new Promise((resolve, reject) => {
      let settled = false;
      let tx;
      let request;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(clone(request?.result));
      };
      const timer = setTimeout(() => {
        try { tx?.abort(); } catch (_) {}
        finish(unavailable());
      }, timeoutMs);
      try {
        tx = db.transaction(STORE_NAME, mode);
        tx.oncomplete = () => finish();
        tx.onerror = () => finish(tx.error || request?.error || unavailable());
        tx.onabort = () => finish(tx.error || unavailable());
        request = operation(tx.objectStore(STORE_NAME));
      } catch (error) {
        try { tx?.abort(); } catch (_) {}
        finish(error);
      }
    });
  };
  return {
    async get(uid, requestId) {
      if (!uid || !requestId) return null;
      const key = keyFor(uid, requestId);
      const row = await transact("readonly", (store, data) => store ? store.get(key) : clone(data.get(key)));
      return row ? clone(row.attempt) : null;
    },
    async put(uid, attempt) {
      if (!uid || !attempt?.requestId) throw new Error("Tentativa de ponto sem identificação.");
      const row = { key: keyFor(uid, attempt.requestId), uid, attempt: clone(attempt) };
      await transact("readwrite", (store, data) => store ? store.put(row) : data.set(row.key, row));
      return clone(attempt);
    },
    async reserve(uid, attempt) {
      if (!uid || !attempt?.requestId) throw new Error("Tentativa de ponto sem identificação.");
      const row = { key: keyFor(uid, attempt.requestId), uid, attempt: clone(attempt) };
      const result = await transact("readwrite", (store, data) => {
        if (!store) {
          if (!data.has(row.key)) data.set(row.key, row);
          return clone(data.get(row.key));
        }
        let chosen;
        const read = store.get(row.key);
        read.onsuccess = () => {
          chosen = read.result || row;
          if (!read.result) store.add(row);
        };
        return { get result() { return chosen; } };
      });
      return clone(result.attempt);
    },
    async remove(uid, requestId) {
      if (!uid || !requestId) return;
      const key = keyFor(uid, requestId);
      await transact("readwrite", (store, data) => store ? store.delete(key) : data.delete(key));
    },
    async list(uid) {
      if (!uid) return [];
      const rows = await transact("readonly", (store, data) => store ? store.index("uid").getAll(uid) : [...data.values()]);
      return (rows || []).filter((row) => row.uid === uid).map((row) => clone(row.attempt))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    },
  };
}

export const clockAttemptStore = createClockAttemptStore();

export async function saveClockDraft(uid, draft) {
  if (!uid || !draft?.requestId || !draft?.payload) throw new Error("Tentativa de ponto incompleta.");
  validateClockSelfie(draft.payload.selfieDataUrl);
  const capturedAt = new Date(draft.capturedAt || draft.payload.capturedAt || Date.now());
  if (!Number.isFinite(capturedAt.getTime())) throw new Error("Horário da tentativa de ponto inválido.");
  // Persist only evidence needed for recovery. Never copy session tokens or
  // unrelated caller metadata from a legacy offline-queue payload.
  const { latitude, longitude, accuracy, locationTimestamp, selfieDataUrl, expectedAction } = draft.payload;
  return clockAttemptStore.reserve(uid, {
    requestId: `draft:${draft.requestId}`,
    originalRequestId: draft.requestId,
    kind: "draft", createdAt: capturedAt.toISOString(), capturedAt: capturedAt.toISOString(),
    requiresLocationRefresh: !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy),
    payload: { latitude, longitude, accuracy, locationTimestamp, selfieDataUrl, expectedAction,
      requestId: draft.requestId, capturedAt: capturedAt.toISOString() },
  });
}

export async function listClockDrafts(uid) {
  return (await clockAttemptStore.list(uid)).filter((row) => row.kind === "draft")
    .map((row) => ({ ...row, requestId: row.originalRequestId }));
}

export const removeClockDraft = (uid, requestId) => clockAttemptStore.remove(uid, `draft:${requestId}`);

export async function markClockDraftLocationIssue(uid, requestId) {
  const draft = await clockAttemptStore.get(uid, `draft:${requestId}`);
  if (!draft || draft.kind !== "draft") return;
  await clockAttemptStore.put(uid, {...draft, requiresLocationRefresh:true});
}
export async function refreshClockDraftLocation(uid, requestId, position) {
  const draft = await clockAttemptStore.get(uid, `draft:${requestId}`);
  if (!draft || draft.kind !== "draft") throw new Error("Tentativa preservada não encontrada. Capture uma nova selfie.");
  const c = position?.coords;
  if (!c || !Number.isFinite(c.latitude) || Math.abs(c.latitude)>90 || !Number.isFinite(c.longitude) || Math.abs(c.longitude)>180 || !Number.isFinite(c.accuracy) || c.accuracy<0 || c.accuracy>5000 || !Number.isFinite(position.timestamp) || Date.now()-position.timestamp>30000 || position.timestamp>Date.now()+5000) throw new Error("A nova localização não é válida. Tente atualizar novamente.");
  const updated = {...draft,requiresLocationRefresh:false,payload:{...draft.payload,latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,locationTimestamp:position.timestamp}};
  await clockAttemptStore.put(uid,updated);
  return updated;
}


// Serialize within a tab and, where available, across tabs. Different IDs from
// an accidental double tap must not independently advance the same workday.
export function withClockPunchLock(uid, operation, {waitMs=12000}={}) {
  const previous = localLocks.get(uid) || Promise.resolve();
  const controller = new AbortController();
  let timer;
  const expired = () => new Error("Outra tentativa de ponto ainda está em andamento. Aguarde ou feche a outra aba; sua captura foi preservada.");
  const deadline = new Promise((_,reject) => { timer=setTimeout(()=>{controller.abort();reject(expired());},waitMs); });
  const execute = () => {
    if(controller.signal.aborted) throw expired();
    clearTimeout(timer);
    return operation();
  };
  const current = previous.catch(() => {}).then(() => {
    if(controller.signal.aborted) throw expired();
    if (globalThis.navigator?.locks?.request) {
      return navigator.locks.request(`house-clock-punch:${uid}`, {signal:controller.signal}, execute);
    }
    return execute();
  });
  localLocks.set(uid, current);
  const cleanup = () => { if (localLocks.get(uid) === current) localLocks.delete(uid); };
  current.then(cleanup,cleanup);
  return Promise.race([current,deadline]).finally(()=>clearTimeout(timer));
}

export function validateClockSelfie(value) {
  const selfie = String(value || "");
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=\s]+$/.test(selfie)) {
    throw new Error("Capture a selfie antes de confirmar o ponto.");
  }
  if (selfie.length > 950000) {
    throw new Error("A selfie ficou muito grande. Tire outra foto para continuar.");
  }
  return selfie;
}

// Persist before side effects. A successful upload receipt is reused after a
// failed database write, so retrying does not upload a second photo.
export async function completeClockAttempt({ uid, attempt, upload, save, store = clockAttemptStore }) {
  let current = await store.get(uid, attempt.requestId) || clone(attempt);
  if (current.employeeId !== attempt.employeeId) throw new Error("Tentativa de ponto de outro funcionário.");
  if (!current.selfie?.fileId) validateClockSelfie(current.selfieDataUrl);
  await store.put(uid, current);
  if (!current.selfie?.fileId) {
    current.selfie = await upload(current);
    if (!current.selfie?.fileId) throw new Error("O serviço de fotos não confirmou o salvamento.");
    // The remote photo is now confirmed; release the local image immediately.
    delete current.selfieDataUrl;
    await store.put(uid, current);
  }
  const saved = await save(current);
  // A cleanup failure must not turn a confirmed punch into an apparent failure.
  // Next recovery checks the same request ID against the database before writes.
  await store.remove(uid, current.requestId).catch(() => {});
  return saved;
}
