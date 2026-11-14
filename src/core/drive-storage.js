import { runtime } from "./runtime.js";
import { assert } from "./utils.js";
import { SELFIE_DRIVE_UPLOAD_ENDPOINT } from "../selfie-drive-config.js";

const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,160}$/;
const MAX_CACHE_ENTRIES = 36;
const fileReadCache = new Map();
const inFlightReads = new Map();
let warmupPromise = null;
let warmedAt = 0;

function getDriveEndpoint() {
  const endpoint = String(SELFIE_DRIVE_UPLOAD_ENDPOINT || "").trim();
  assert(
    /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint),
    "O serviço do Google Drive não está configurado.",
  );
  return endpoint;
}

export function warmDriveService() {
  if (typeof fetch !== "function") return Promise.resolve();
  if (warmupPromise && Date.now() - warmedAt < 45000) return warmupPromise;
  warmedAt = Date.now();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 7000) : null;
  warmupPromise = fetch(getDriveEndpoint(), {
    method: "GET",
    mode: "no-cors",
    cache: "no-store",
    credentials: "omit",
    ...(controller ? { signal: controller.signal } : {}),
  })
    .catch(() => {})
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
  return warmupPromise;
}

export function parseDriveFileId(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  if (DRIVE_ID_RE.test(raw) && !raw.includes("/") && !raw.includes(":") && !raw.includes(".")) {
    return raw;
  }
  if (!/^https?:\/\//i.test(raw)) return "";
  if (!/(drive\.google\.com|googleusercontent\.com)/i.test(raw)) return "";
  const match =
    raw.match(/\/file\/d\/([A-Za-z0-9_-]{10,160})/) ||
    raw.match(/[?&]id=([A-Za-z0-9_-]{10,160})/) ||
    raw.match(/\/d\/([A-Za-z0-9_-]{10,160})/);
  return match ? match[1] : "";
}

export function isGoogleDriveUrl(value) {
  return Boolean(parseDriveFileId(value));
}

export function inferMimeTypeFromDataUrl(dataUrl, fallback = "application/pdf") {
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:([^;]+);base64,/i);
  if (!match) return fallback;
  const mime = String(match[1] || "").trim().toLowerCase();
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

export function stripDataUrlPrefix(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^data:[^;]+;base64,([\s\S]+)$/i);
  return (match ? match[1] : raw).replace(/\s+/g, "");
}

export function clearDriveFileCache() {
  fileReadCache.clear();
  inFlightReads.clear();
}

function setCachedFile(cacheKey, value) {
  if (fileReadCache.has(cacheKey)) fileReadCache.delete(cacheKey);
  fileReadCache.set(cacheKey, value);
  while (fileReadCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = fileReadCache.keys().next().value;
    fileReadCache.delete(oldestKey);
  }
}

async function fetchDriveWithTimeout(payload, timeoutMs = 35000) {
  const endpoint = getDriveEndpoint();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      redirect: "follow",
      credentials: "omit",
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {}),
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (_) {
      const error = new Error("O Google Drive retornou uma resposta inválida. Tente novamente.");
      error.retryable = [408, 429].includes(response.status) || response.status >= 500 || response.ok;
      throw error;
    }
    if (!response.ok || !result?.ok) {
      const error = new Error(result?.error || "O Google Drive não confirmou a operação.");
      error.retryable =
        response.status === 401 ||
        [408, 429].includes(response.status) ||
        response.status >= 500 ||
        result?.retryable === true;
      error.needsTokenRefresh = response.status === 401 || /sessão expirada|não autorizado/i.test(error.message);
      throw error;
    }
    return result;
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutError = new Error("O Google Drive demorou para responder. Verifique sua conexão e tente novamente.");
      timeoutError.retryable = true;
      throw timeoutError;
    }
    if (typeof err?.retryable !== "boolean") {
      err.retryable = true;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callDriveWithRetry(buildPayload, { requireAuth = true, attempts = 3 } = {}) {
  let refreshToken = false;
  let lastError = null;
  const expectedUid = runtime.auth?.currentUser?.uid || "";
  if (requireAuth) {
    assert(expectedUid, "Sua sessão expirou. Entre novamente.");
  }

  for (let i = 0; i < attempts; i += 1) {
    try {
      const currentUser = runtime.auth?.currentUser || null;
      if (requireAuth) {
        assert(currentUser?.uid && currentUser.uid === expectedUid, "A conta conectada mudou. Entre novamente.");
      }
      const idToken = currentUser?.uid ? await currentUser.getIdToken(refreshToken) : "";
      if (requireAuth) {
        assert(idToken, "Não foi possível validar sua sessão. Entre novamente.");
      }
      const payload = buildPayload(idToken);
      const timeoutMs = i === 0 ? 35000 : 45000;
      return await fetchDriveWithTimeout(payload, timeoutMs);
    } catch (error) {
      lastError = error;
      if (error?.needsTokenRefresh) refreshToken = true;
      if (error?.retryable === false || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 450 * (i + 1)));
    }
  }
  throw lastError || new Error("Falha ao comunicar com o Google Drive.");
}

export async function uploadPrivateDocumentToDrive({
  dataUrl = "",
  base64 = "",
  mimeType = "",
  fileName = "",
  category = "documentos",
  employeeId = "",
  storeId = "",
  docId = "",
  monthKey = "",
  inviteToken = "",
} = {}) {
  const rawInput = String(dataUrl || base64 || "").trim();
  assert(rawInput, "Selecione um arquivo válido para enviar ao Google Drive.");
  const resolvedMime =
    String(mimeType || "").trim().toLowerCase() || inferMimeTypeFromDataUrl(rawInput, "application/pdf");
  const normalizedDataUrl = rawInput.startsWith("data:")
    ? rawInput
    : `data:${resolvedMime};base64,${stripDataUrlPrefix(rawInput)}`;

  const result = await callDriveWithRetry(
    (idToken) => ({
      action: "uploadPrivateDocument",
      idToken,
      dataUrl: normalizedDataUrl,
      mimeType: resolvedMime,
      fileName: String(fileName || "").trim(),
      category: String(category || "documentos").trim(),
      employeeId: String(employeeId || "").trim(),
      storeId: String(storeId || "").trim(),
      docId: String(docId || "").trim(),
      monthKey: String(monthKey || "").trim(),
      inviteToken: String(inviteToken || "").trim(),
    }),
    { requireAuth: true, attempts: 3 },
  );

  assert(result?.fileId && result?.url, "O Google Drive não retornou o identificador do arquivo.");
  return {
    fileId: String(result.fileId),
    url: String(result.url),
    fileUrl: String(result.fileUrl || result.url),
    fileName: String(result.fileName || fileName || ""),
    mimeType: String(result.mimeType || resolvedMime),
    bytes: Number(result.bytes || 0),
    sha256: String(result.sha256 || ""),
    storage: "Google Drive",
    private: true,
  };
}

export async function uploadOnboardingDocumentToDrive({
  inviteToken = "",
  dataUrl = "",
  base64 = "",
  mimeType = "",
  fileName = "",
  docCode = "doc",
  employeeId = "",
  storeId = "",
  monthKey = "",
} = {}) {
  const rawInput = String(dataUrl || base64 || "").trim();
  assert(rawInput, "Selecione um arquivo válido para enviar ao Google Drive.");
  const hasAuthUser = Boolean(runtime.auth?.currentUser?.uid);
  const cleanInvite = String(inviteToken || "").trim();
  assert(cleanInvite || hasAuthUser, "Link de pré-cadastro ou sessão inválida.");

  const resolvedMime =
    String(mimeType || "").trim().toLowerCase() || inferMimeTypeFromDataUrl(rawInput, "image/jpeg");
  const normalizedDataUrl = rawInput.startsWith("data:")
    ? rawInput
    : `data:${resolvedMime};base64,${stripDataUrlPrefix(rawInput)}`;

  const result = await callDriveWithRetry(
    (idToken) => ({
      action: "uploadOnboardingDocument",
      ...(idToken ? { idToken } : {}),
      inviteToken: cleanInvite,
      dataUrl: normalizedDataUrl,
      mimeType: resolvedMime,
      fileName: String(fileName || "").trim(),
      docCode: String(docCode || "doc").trim(),
      employeeId: String(employeeId || "").trim(),
      storeId: String(storeId || "").trim(),
      monthKey: String(monthKey || "").trim(),
    }),
    { requireAuth: false, attempts: 3 },
  );

  assert(result?.fileId && result?.url, "O Google Drive não confirmou o upload do documento.");
  return {
    fileId: String(result.fileId),
    url: String(result.url),
    fileUrl: String(result.fileUrl || result.url),
    fileName: String(result.fileName || fileName || ""),
    mimeType: String(result.mimeType || resolvedMime),
    bytes: Number(result.bytes || 0),
    sha256: String(result.sha256 || ""),
    storage: "Google Drive",
    private: true,
  };
}

export async function readPrivateDriveFile(fileIdOrUrl, { inviteToken = "", bypassCache = false } = {}) {
  const fileId = parseDriveFileId(fileIdOrUrl);
  assert(DRIVE_ID_RE.test(fileId), "Identificador do arquivo no Google Drive inválido.");

  const uid = runtime.auth?.currentUser?.uid || "";
  const cleanInvite = String(inviteToken || "").trim();
  assert(uid || cleanInvite, "Sua sessão expirou. Entre novamente para abrir o arquivo.");

  const scopeKey = uid || `invite:${cleanInvite}`;
  const cacheKey = `${scopeKey}:${fileId}`;
  if (!bypassCache && fileReadCache.has(cacheKey)) {
    return fileReadCache.get(cacheKey);
  }
  if (!bypassCache && inFlightReads.has(cacheKey)) {
    return inFlightReads.get(cacheKey);
  }

  const job = callDriveWithRetry(
    (idToken) => ({
      action: "readPrivateFile",
      fileId,
      ...(idToken ? { idToken } : {}),
      ...(cleanInvite ? { inviteToken: cleanInvite } : {}),
    }),
    { requireAuth: !cleanInvite, attempts: 2 },
  )
    .then((result) => {
      assert(result?.dataUrl && String(result.dataUrl).startsWith("data:"), "Conteúdo do arquivo no Drive inválido.");
      const normalized = {
        ok: true,
        fileId,
        dataUrl: String(result.dataUrl),
        mimeType: String(result.mimeType || inferMimeTypeFromDataUrl(result.dataUrl, "application/octet-stream")),
        fileName: String(result.fileName || ""),
        bytes: Number(result.bytes || 0),
        sha256: String(result.sha256 || ""),
      };
      setCachedFile(cacheKey, normalized);
      return normalized;
    })
    .finally(() => {
      inFlightReads.delete(cacheKey);
    });

  inFlightReads.set(cacheKey, job);
  return job;
}
