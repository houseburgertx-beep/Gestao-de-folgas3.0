// Photos are retained on this device only until the remote punch is confirmed.
// Never persist Firebase tokens, passwords or another user's recovery payload.
const DATABASE_NAME = "house-clock-recovery";
const STORE_NAME = "attempts";
const localLocks = new Map();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

export function createClockAttemptStore(indexedDB = globalThis.indexedDB) {
  let database;
  const memory = new Map();
  const keyFor = (uid, requestId) => `${uid}:${requestId}`;
  const open = () => {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Feche as outras abas do ponto e tente novamente."));
    }).catch((error) => { database = null; throw error; });
    return database;
  };
  const transact = async (mode, operation) => {
    if (!indexedDB) {
      // The memory backend is for Node/unit tests. Browsers must not silently
      // claim durable recovery when their storage is blocked or unavailable.
      if (typeof window !== "undefined") {
        throw new Error("O armazenamento seguro do ponto está indisponível neste navegador. Libere o armazenamento e tente novamente.");
      }
      return operation(null, memory);
    }
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = operation(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(clone(request?.result));
      tx.onerror = () => reject(tx.error || request?.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível preservar a foto do ponto neste aparelho."));
    });
  };
  return {
    async get(uid, requestId) {
      const key = keyFor(uid, requestId);
      const row = await transact("readonly", (store, data) => store ? store.get(key) : clone(data.get(key)));
      return row ? clone(row.attempt) : null;
    },
    async put(uid, attempt) {
      if (!uid || !attempt?.requestId) throw new Error("Tentativa de ponto sem identificação.");
      const key = keyFor(uid, attempt.requestId);
      const row = { key, uid, attempt: clone(attempt) };
      await transact("readwrite", (store, data) => store ? store.put(row) : data.set(key, row));
      return clone(attempt);
    },
    async remove(uid, requestId) {
      const key = keyFor(uid, requestId);
      await transact("readwrite", (store, data) => store ? store.delete(key) : data.delete(key));
    },
    async list(uid) {
      const rows = await transact("readonly", (store, data) => store ? store.getAll() : [...data.values()]);
      return (rows || []).filter((row) => row.uid === uid).map((row) => clone(row.attempt))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    },
  };
}

export const clockAttemptStore = createClockAttemptStore();

export async function saveClockDraft(uid, draft) {
  if (!draft?.requestId || !draft?.payload) throw new Error("Tentativa de ponto incompleta.");
  validateClockSelfie(draft.payload.selfieDataUrl);
  const capturedAt = String(draft.capturedAt || draft.payload.capturedAt || new Date().toISOString());
  return clockAttemptStore.put(uid, {
    ...clone(draft),
    requestId: `draft:${draft.requestId}`,
    originalRequestId: draft.requestId,
    kind: "draft",
    createdAt: capturedAt,
    capturedAt,
    payload: { ...clone(draft.payload), requestId: draft.requestId, capturedAt },
  });
}

export async function listClockDrafts(uid) {
  return (await clockAttemptStore.list(uid)).filter((row) => row.kind === "draft")
    .map((row) => ({ ...row, requestId: row.originalRequestId }));
}

export const removeClockDraft = (uid, requestId) => clockAttemptStore.remove(uid, `draft:${requestId}`);

// Serialize within a tab and, where available, across tabs. Different IDs from
// an accidental double tap must not independently advance the same workday.
export function withClockPunchLock(uid, operation) {
  const previous = localLocks.get(uid) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => {
    if (globalThis.navigator?.locks?.request) {
      return navigator.locks.request(`house-clock-punch:${uid}`, operation);
    }
    return operation();
  });
  localLocks.set(uid, current);
  return current.finally(() => {
    if (localLocks.get(uid) === current) localLocks.delete(uid);
  });
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
