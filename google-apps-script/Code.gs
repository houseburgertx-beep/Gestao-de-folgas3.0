const SELFIE_SERVICE_CONFIG_ = Object.freeze({
  folderId: "", // Se vazio ou inacessível, cria/usa automaticamente "Ponto - Selfies Grupo House 190" no Drive
  databaseUrl: "https://github-737ec-default-rtdb.firebaseio.com",
  appRoot: "gestao-folgas/v2",
  maxImageBytes: 1500000,
  maxFileBytes: 6291456, // 6 MB para PDFs, atestados, admissão e comprovantes
});

const ALLOWED_DOCUMENT_MIME_TYPES_ = Object.freeze([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const CLOCK_TYPES_ = Object.freeze([
  "ENTRADA",
  "SAIDA_INTERVALO",
  "RETORNO_INTERVALO",
  "SEM_DESCANSO",
  "SAIDA_FINAL",
]);

function doGet() {
  return jsonResponse_({
    ok: true,
    service: "selfies-ponto-drive",
    account: "grupo190house@gmail.com",
    storage: "google-drive",
    timestamp: new Date().toISOString()
  });
}

function doPost(event) {
  try {
    let payload = {};
    if (event && event.postData && event.postData.contents) {
      assert_(event.postData.contents.length <= 9500000, "O arquivo ultrapassa o limite permitido.");
      try {
        payload = JSON.parse(event.postData.contents);
      } catch (parseErr) {
        payload = event.parameter || {};
      }
    } else if (event && event.parameter) {
      payload = event.parameter;
    }

    const action = String(payload.action || "").trim();

    assert_(
      [
        "driveUpload",
        "uploadClockSelfie",
        "readPrivateImage",
        "uploadPrivateDocument",
        "uploadOnboardingDocument",
        "readPrivateFile",
      ].indexOf(action) >= 0,
      "Ação inválida.",
    );

    if (action === "uploadOnboardingDocument") {
      return jsonResponse_(handleOnboardingUpload_(payload));
    }

    if (action === "readPrivateFile" && !payload.idToken && payload.inviteToken) {
      return jsonResponse_(readOnboardingPrivateFile_(payload.inviteToken, payload.fileId));
    }

    const token = String(payload.idToken || "");
    const uid = firebaseUid_(token);
    const profile = firebaseProfile_(uid, token);
    assert_(profile && (profile.Ativo === true || profile.Ativo === 1 || String(profile.Ativo).toLowerCase() === "true"), "Usuário inativo.");

    if (action === "readPrivateImage") {
      return jsonResponse_(readPrivateImage_(uid, profile, payload.fileId));
    }
    if (action === "readPrivateFile") {
      return jsonResponse_(readPrivateFile_(uid, profile, payload.fileId));
    }
    if (action === "uploadPrivateDocument") {
      return jsonResponse_(handlePrivateDocumentUpload_(uid, profile, payload));
    }

    assert_(profile.FuncionarioID, "Usuário sem funcionário vinculado.");

    // Tasks and selfies use the same authenticated, bounded upload path.
    if (action === "driveUpload") {
      const mimeType = String(payload.mimeType || "image/jpeg").toLowerCase();
      assert_(["image/jpeg", "image/png", "image/webp"].indexOf(mimeType) >= 0, "Formato de foto inválido.");
      const base64Str = String(payload.base64 || payload.base64Data || "").replace(/^data:image\/[a-z]+;base64,/, "");
      assert_(base64Str.length > 50 && base64Str.length <= 2100000 && /^[A-Za-z0-9+/=\s]+$/.test(base64Str), "Foto da tarefa vazia ou inválida.");
      const bytes = Utilities.base64Decode(base64Str);
      validateImageBytes_(bytes, mimeType);
      // A content digest makes retries idempotent even for older task clients.
      const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
        .map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
      const extension = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
      const fileName = "task__" + safeName_(uid) + "__" + digest + extension;
      const taskFolder = childFolder_(getRootFolder_(), "Tarefas");
      const file = privateImageFile_(taskFolder, fileName, bytes, mimeType, {
        uid: uid, employeeId: String(profile.FuncionarioID), storeId: String(profile.LojaID || ""), kind: "task"
      });
      return jsonResponse_(imageReceipt_(file));
    }

    const requestId = String(payload.requestId || "").trim();
    const day = String(payload.day || "");
    const type = String(payload.clockType || "").toUpperCase();
    assert_(
      /^[A-Za-z0-9-]{16,100}$/.test(requestId),
      "Identificador da marcação inválido.",
    );
    assert_(/^\d{4}-\d{2}-\d{2}$/.test(day), "Data da marcação inválida.");
    assert_(CLOCK_TYPES_.indexOf(type) >= 0, "Tipo de marcação inválido.");

    const image = decodeSelfie_(payload.selfieDataUrl);
    const destination = destinationFolder_(profile, day);
    const fileName = [
      day,
      safeName_(uid),
      type,
      requestId,
    ].join("__") + ".jpg";

    const file = privateImageFile_(destination, fileName, image, "image/jpeg", {
      uid: uid, employeeId: String(profile.FuncionarioID), storeId: String(profile.LojaID || ""), kind: "clock", requestId: requestId
    });
    return jsonResponse_(imageReceipt_(file));
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: String(error && error.message || error || "Falha no upload."),
      retryable: Boolean(error && error.retryable),
    });
  }
}

function privateImageFile_(destination, fileName, bytes, mimeType, metadata) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    const busy = new Error("O serviço de fotos está ocupado. Tente novamente; sua foto continua preservada.");
    busy.retryable = true;
    throw busy;
  }
  try {
    // The name includes the Firebase UID and the stable request/content ID.
    // The Drive search survives cache expiry, restart and network retries.
    const existing = destination.getFilesByName(fileName);
    const file = existing.hasNext() ? existing.next()
      : destination.createFile(Utilities.newBlob(bytes, mimeType, fileName));
    file.setDescription(JSON.stringify(metadata));
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
    return file;
  } finally {
    lock.releaseLock();
  }
}

function imageReceipt_(file) {
  const fileId = file.getId();
  const viewUrl = "https://drive.google.com/file/d/" + fileId + "/view";
  return {
    ok: true, fileId: fileId, url: viewUrl, fileUrl: viewUrl,
    fileName: file.getName(), uploadedAt: file.getDateCreated().toISOString(), private: true,
  };
}

function fileReceipt_(file, mimeType, sizeBytes, sha256) {
  const receipt = imageReceipt_(file);
  receipt.mimeType = mimeType || "";
  receipt.bytes = Number(sizeBytes || 0);
  receipt.sha256 = sha256 || "";
  receipt.storage = "Google Drive";
  return receipt;
}

function normalizeMimeAndBase64_(rawMime, rawData) {
  const str = String(rawData || "").trim();
  const dataUrlMatch = str.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  const mimeType = String(dataUrlMatch ? dataUrlMatch[1] : rawMime || "").trim().toLowerCase();
  const normalizedMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  assert_(ALLOWED_DOCUMENT_MIME_TYPES_.indexOf(normalizedMime) >= 0, "Formato de arquivo não suportado. Envie PDF ou imagem.");
  const base64Str = (dataUrlMatch ? dataUrlMatch[2] : str).replace(/\s/g, "");
  assert_(base64Str.length >= 60 && base64Str.length <= 8600000 && /^[A-Za-z0-9+/=]+$/.test(base64Str), "Arquivo vazio ou inválido.");
  const bytes = Utilities.base64Decode(base64Str);
  validateDocumentBytes_(bytes, normalizedMime);
  return { mimeType: normalizedMime, bytes: bytes, digest: sha256Hex_(bytes) };
}

function extensionFromMime_(mimeType) {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".jpg";
}

function sha256Hex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); })
    .join("");
}

function validateDocumentBytes_(bytes, mimeType) {
  assert_(bytes.length >= 100 && bytes.length <= SELFIE_SERVICE_CONFIG_.maxFileBytes, "O arquivo ultrapassa o limite permitido (6 MB).");
  const b = function (i) { return bytes[i] & 255; };
  if (mimeType === "application/pdf") {
    let found = false;
    const limit = Math.min(bytes.length - 5, 32);
    for (let i = 0; i <= limit; i += 1) {
      if (b(i) === 37 && b(i + 1) === 80 && b(i + 2) === 68 && b(i + 3) === 70 && b(i + 4) === 45) {
        found = true;
        break;
      }
    }
    assert_(found, "O arquivo informado não possui assinatura PDF válida.");
    return;
  }
  const jpeg = b(0) === 255 && b(1) === 216 && b(2) === 255;
  const png = b(0) === 137 && b(1) === 80 && b(2) === 78 && b(3) === 71;
  const webp = bytes.length >= 12 && b(0) === 82 && b(1) === 73 && b(2) === 70 && b(3) === 70 && b(8) === 87 && b(9) === 69 && b(10) === 66 && b(11) === 80;
  const gif = bytes.length >= 6 && b(0) === 71 && b(1) === 73 && b(2) === 70 && b(3) === 56;
  assert_(
    (mimeType === "image/jpeg" && jpeg) ||
      (mimeType === "image/png" && png) ||
      (mimeType === "image/webp" && webp) ||
      (mimeType === "image/gif" && gif),
    "O conteúdo do arquivo não corresponde ao formato informado.",
  );
}

function documentFolder_(category, monthKey) {
  const cleanCategory = safeName_(category || "documentos").toLowerCase();
  const cleanMonth = /^\d{4}-\d{2}$/.test(String(monthKey || "")) ? String(monthKey) : Utilities.formatDate(new Date(), "America/Bahia", "yyyy-MM");
  const cache = CacheService.getScriptCache();
  const cacheKey = ["doc-folder", cleanCategory, cleanMonth].join(":");
  const cachedId = cache.get(cacheKey);
  if (cachedId) {
    try {
      return DriveApp.getFolderById(cachedId);
    } catch (ignored) {
      cache.remove(cacheKey);
    }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const lockedId = cache.get(cacheKey);
    if (lockedId) {
      try {
        return DriveApp.getFolderById(lockedId);
      } catch (ignored) {
        cache.remove(cacheKey);
      }
    }
    const root = getRootFolder_();
    const docsRoot = childFolder_(root, "Documentos-e-Anexos");
    const catFolder = childFolder_(docsRoot, cleanCategory);
    const monthFolder = childFolder_(catFolder, cleanMonth);
    cache.put(cacheKey, monthFolder.getId(), 21600);
    return monthFolder;
  } finally {
    lock.releaseLock();
  }
}

function handlePrivateDocumentUpload_(uid, profile, payload) {
  const role = String(profile.Perfil || "");
  const isAdmin = role === "Administrador";
  const isManager = ["Gerente", "Responsável de loja", "Chefe de cozinha"].indexOf(role) >= 0;
  assert_(profile.FuncionarioID || isAdmin, "Usuário sem funcionário vinculado.");

  const employeeId = String(payload.employeeId || profile.FuncionarioID || uid || "").trim();
  const storeId = String(payload.storeId || profile.LojaID || "").trim();
  const category = safeName_(payload.category || "documentos").toLowerCase();
  const canUpload = isAdmin ||
    (profile.FuncionarioID && String(profile.FuncionarioID) === employeeId) ||
    (isManager && (!storeId || !profile.LojaID || String(profile.LojaID) === storeId));
  assert_(canUpload, "Sem permissão para enviar documento neste perfil.");

  const parsed = normalizeMimeAndBase64_(payload.mimeType, payload.dataUrl || payload.base64 || payload.base64Data);
  const ext = extensionFromMime_(parsed.mimeType);
  const hint = payload.fileName ? safeName_(String(payload.fileName).replace(/\.[A-Za-z0-9]{2,5}$/, "")).slice(0, 48) : category;
  const fileName = [category, safeName_(employeeId || uid), parsed.digest.slice(0, 16), hint].join("__") + ext;
  const folder = documentFolder_(category, payload.monthKey);
  const file = privateImageFile_(folder, fileName, parsed.bytes, parsed.mimeType, {
    uid: uid,
    employeeId: employeeId,
    storeId: storeId,
    inviteToken: String(payload.inviteToken || ""),
    docId: String(payload.docId || ""),
    category: category,
    mimeType: parsed.mimeType,
    sha256: parsed.digest,
    kind: "document",
  });
  return fileReceipt_(file, parsed.mimeType, parsed.bytes.length, parsed.digest);
}

function onboardingInviteRecord_(inviteToken) {
  const token = String(inviteToken || "").trim();
  assert_(/^[A-Za-z0-9_-]{16,160}$/.test(token), "Token de pré-cadastro inválido.");
  const url = [
    SELFIE_SERVICE_CONFIG_.databaseUrl,
    SELFIE_SERVICE_CONFIG_.appRoot,
    "onboardingConvites",
    encodeURIComponent(token) + ".json",
  ].join("/");
  const response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    const failure = new Error("Não foi possível validar o link de pré-cadastro.");
    failure.retryable = response.getResponseCode() >= 500 || response.getResponseCode() === 429;
    throw failure;
  }
  const convite = JSON.parse(response.getContentText() || "null");
  const conviteToken = String((convite && (convite.TokenID || convite.Token || convite.ConviteID)) || "");
  assert_(convite && conviteToken === token, "Convite de pré-cadastro não encontrado.");
  assert_(
    convite.CadastroValidado !== true && ["Aprovado", "Cancelado", "Expirado"].indexOf(String(convite.Status || "")) < 0,
    "Este link de pré-cadastro já foi finalizado.",
  );
  return convite;
}

function handleOnboardingUpload_(payload) {
  let uid = "";
  let profile = null;
  let convite = null;
  if (payload.idToken) {
    uid = firebaseUid_(String(payload.idToken || ""));
    profile = firebaseProfile_(uid, String(payload.idToken || ""));
    assert_(profile && (profile.Ativo === true || profile.Ativo === 1 || String(profile.Ativo).toLowerCase() === "true"), "Usuário inativo.");
  }
  const inviteToken = String(payload.inviteToken || "").trim();
  if (inviteToken) {
    convite = onboardingInviteRecord_(inviteToken);
  }
  assert_(convite || (profile && ["Administrador", "Gerente", "Responsável de loja", "Chefe de cozinha"].indexOf(String(profile.Perfil || "")) >= 0), "Autorização ausente para envio de documento admissional.");

  const parsed = normalizeMimeAndBase64_(payload.mimeType, payload.dataUrl || payload.base64 || payload.base64Data);
  const ext = extensionFromMime_(parsed.mimeType);
  const category = "admissao";
  const docCode = safeName_(payload.docCode || "doc");
  const targetEmpId = String((convite && convite.FuncionarioID) || payload.employeeId || "");
  const targetStoreId = String((convite && convite.LojaID) || (profile && profile.LojaID) || payload.storeId || "");
  const fileName = ["admissao", safeName_(inviteToken || targetEmpId || "novo"), docCode, parsed.digest.slice(0, 16)].join("__") + ext;
  const folder = documentFolder_(category, payload.monthKey);
  const file = privateImageFile_(folder, fileName, parsed.bytes, parsed.mimeType, {
    uid: uid,
    employeeId: targetEmpId,
    storeId: targetStoreId,
    inviteToken: inviteToken,
    category: category,
    docCode: docCode,
    mimeType: parsed.mimeType,
    sha256: parsed.digest,
    kind: "onboarding",
  });
  return fileReceipt_(file, parsed.mimeType, parsed.bytes.length, parsed.digest);
}

function authorizePrivateMetadata_(uid, profile, metadata) {
  const role = String(profile.Perfil || "");
  const manager = ["Gerente", "Responsável de loja", "Chefe de cozinha"].indexOf(role) >= 0;
  const sameUid = Boolean(metadata.uid && metadata.uid === uid);
  const sameEmployee = Boolean(profile.FuncionarioID && metadata.employeeId && String(profile.FuncionarioID) === String(metadata.employeeId));
  const sameStoreManager = Boolean(manager && profile.LojaID && metadata.storeId && String(profile.LojaID) === String(metadata.storeId));
  const onboardingManager = Boolean(manager && metadata.kind === "onboarding");
  return role === "Administrador" || sameUid || sameEmployee || sameStoreManager || onboardingManager;
}

function readPrivateImage_(uid, profile, rawId) {
  const fileId = String(rawId || "");
  assert_(/^[A-Za-z0-9_-]{10,160}$/.test(fileId), "Identificador de foto inválido.");
  const file = DriveApp.getFileById(fileId);
  let metadata;
  try { metadata = JSON.parse(file.getDescription() || "null"); } catch (_) {}
  assert_(metadata && (metadata.uid || metadata.inviteToken || metadata.employeeId), "Foto sem metadados de autorização.");
  assert_(authorizePrivateMetadata_(uid, profile, metadata), "Sem permissão para visualizar esta foto.");
  const blob = file.getBlob();
  const mimeType = blob.getContentType();
  assert_(/^image\/(jpeg|png|webp)$/.test(mimeType), "Arquivo não é uma foto permitida.");
  const bytes = blob.getBytes();
  assert_(bytes.length <= SELFIE_SERVICE_CONFIG_.maxImageBytes, "Foto ultrapassa o limite permitido.");
  return { ok: true, dataUrl: "data:" + mimeType + ";base64," + Utilities.base64Encode(bytes), mimeType: mimeType, fileName: file.getName() };
}

function readPrivateFile_(uid, profile, rawId) {
  const fileId = String(rawId || "");
  assert_(/^[A-Za-z0-9_-]{10,160}$/.test(fileId), "Identificador de arquivo inválido.");
  const file = DriveApp.getFileById(fileId);
  let metadata;
  try { metadata = JSON.parse(file.getDescription() || "null"); } catch (_) {}
  assert_(metadata && (metadata.uid || metadata.inviteToken || metadata.employeeId), "Arquivo sem metadados de autorização.");
  assert_(authorizePrivateMetadata_(uid, profile, metadata), "Sem permissão para visualizar este arquivo.");
  const blob = file.getBlob();
  const mimeType = String(blob.getContentType() || metadata.mimeType || "application/octet-stream").toLowerCase();
  assert_(ALLOWED_DOCUMENT_MIME_TYPES_.indexOf(mimeType) >= 0, "Formato de arquivo não permitido.");
  const bytes = blob.getBytes();
  assert_(bytes.length <= SELFIE_SERVICE_CONFIG_.maxFileBytes, "Arquivo ultrapassa o limite permitido.");
  return {
    ok: true,
    dataUrl: "data:" + mimeType + ";base64," + Utilities.base64Encode(bytes),
    mimeType: mimeType,
    fileName: file.getName(),
    bytes: bytes.length,
    sha256: metadata.sha256 || "",
  };
}

function readOnboardingPrivateFile_(inviteToken, rawId) {
  const convite = onboardingInviteRecord_(inviteToken);
  const fileId = String(rawId || "");
  assert_(/^[A-Za-z0-9_-]{10,160}$/.test(fileId), "Identificador de arquivo inválido.");
  const file = DriveApp.getFileById(fileId);
  let metadata;
  try { metadata = JSON.parse(file.getDescription() || "null"); } catch (_) {}
  const conviteToken = String(convite.TokenID || convite.Token || convite.ConviteID || "");
  assert_(metadata && String(metadata.inviteToken || "") === conviteToken, "Sem permissão para visualizar este arquivo do pré-cadastro.");
  const blob = file.getBlob();
  const mimeType = String(blob.getContentType() || metadata.mimeType || "application/octet-stream").toLowerCase();
  assert_(ALLOWED_DOCUMENT_MIME_TYPES_.indexOf(mimeType) >= 0, "Formato de arquivo não permitido.");
  const bytes = blob.getBytes();
  assert_(bytes.length <= SELFIE_SERVICE_CONFIG_.maxFileBytes, "Arquivo ultrapassa o limite permitido.");
  return {
    ok: true,
    dataUrl: "data:" + mimeType + ";base64," + Utilities.base64Encode(bytes),
    mimeType: mimeType,
    fileName: file.getName(),
    bytes: bytes.length,
    sha256: metadata.sha256 || "",
  };
}

function validateImageBytes_(bytes, mimeType) {
  assert_(bytes.length > 1000 && bytes.length <= SELFIE_SERVICE_CONFIG_.maxImageBytes, "Foto vazia ou acima do limite permitido.");
  const b = function (i) { return bytes[i] & 255; };
  const jpeg = b(0) === 255 && b(1) === 216 && b(2) === 255;
  const png = b(0) === 137 && b(1) === 80 && b(2) === 78 && b(3) === 71;
  const webp = b(0) === 82 && b(1) === 73 && b(2) === 70 && b(3) === 70 && b(8) === 87 && b(9) === 69 && b(10) === 66 && b(11) === 80;
  assert_((mimeType === "image/jpeg" && jpeg) || (mimeType === "image/png" && png) || (mimeType === "image/webp" && webp), "O conteúdo da foto não corresponde ao formato informado.");
}

function getRootFolder_() {
  if (SELFIE_SERVICE_CONFIG_.folderId) {
    try {
      return DriveApp.getFolderById(SELFIE_SERVICE_CONFIG_.folderId);
    } catch (e) {}
  }
  const folderName = "Ponto - Selfies Grupo House 190";
  const existing = DriveApp.getFoldersByName(folderName);
  return existing.hasNext() ? existing.next() : DriveApp.createFolder(folderName);
}

function firebaseUid_(token) {
  assert_(token, "Sessão ausente.");
  const parts = token.split(".");
  assert_(parts.length === 3, "Sessão inválida.");
  try {
    const json = Utilities.newBlob(
      Utilities.base64DecodeWebSafe(parts[1]),
    ).getDataAsString("UTF-8");
    const claims = JSON.parse(json);
    const uid = String(claims.sub || claims.user_id || "");
    assert_(uid, "Sessão sem identificação.");
    return uid;
  } catch (error) {
    throw new Error("Não foi possível identificar a sessão.");
  }
}

function firebaseProfile_(uid, token) {
  const url = [
    SELFIE_SERVICE_CONFIG_.databaseUrl,
    SELFIE_SERVICE_CONFIG_.appRoot,
    "access",
    encodeURIComponent(uid) + ".json?auth=" + encodeURIComponent(token),
  ].join("/");
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    const failure = new Error(response.getResponseCode() >= 500 ? "O serviço de autenticação está temporariamente indisponível." : "Sessão expirada ou sem permissão.");
    failure.retryable = response.getResponseCode() >= 500 || response.getResponseCode() === 429;
    throw failure;
  }
  const profile = JSON.parse(response.getContentText() || "null");
  assert_(
    profile && String(profile.UsuarioID || "") === uid,
    "Perfil não autorizado.",
  );
  return profile;
}

function decodeSelfie_(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:image\/jpeg;base64,([A-Za-z0-9+/=\s]+)$/,
  );
  assert_(match, "Capture uma selfie JPG válida.");
  const bytes = Utilities.base64Decode(match[1].replace(/\s/g, ""));
  assert_(bytes.length > 1000, "A selfie está vazia.");
  assert_(
    bytes.length <= SELFIE_SERVICE_CONFIG_.maxImageBytes,
    "A selfie ultrapassa o limite permitido.",
  );
  validateImageBytes_(bytes, "image/jpeg");
  return bytes;
}

function destinationFolder_(profile, day) {
  const storeName = safeName_(
    profile.NomeLoja || profile.LojaID || "Sem loja",
  );
  const cache = CacheService.getScriptCache();
  const cacheKey = [
    "selfie-folder",
    day.slice(0, 7),
    storeName,
  ].join(":");
  const cachedId = cache.get(cacheKey);
  if (cachedId) {
    try {
      return DriveApp.getFolderById(cachedId);
    } catch (ignored) {
      cache.remove(cacheKey);
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const lockedCachedId = cache.get(cacheKey);
    if (lockedCachedId) {
      try {
        return DriveApp.getFolderById(lockedCachedId);
      } catch (ignored) {
        cache.remove(cacheKey);
      }
    }
    const root = getRootFolder_();
    const year = childFolder_(root, day.slice(0, 4));
    const month = childFolder_(year, day.slice(0, 7));
    const destination = childFolder_(month, storeName);
    cache.put(cacheKey, destination.getId(), 21600);
    return destination;
  } finally {
    lock.releaseLock();
  }
}

function childFolder_(parent, name) {
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function safeName_(value) {
  return String(value || "Sem nome")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "Sem-nome";
}

function assert_(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
