const SELFIE_SERVICE_CONFIG_ = Object.freeze({
  folderId: "", // Se vazio ou inacessível, cria/usa automaticamente "Ponto - Selfies Grupo House 190" no Drive
  databaseUrl: "https://github-737ec-default-rtdb.firebaseio.com",
  appRoot: "gestao-folgas/v2",
  maxImageBytes: 1500000,
});

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
      assert_(event.postData.contents.length <= 2200000, "O arquivo ultrapassa o limite permitido.");
      try {
        payload = JSON.parse(event.postData.contents);
      } catch (parseErr) {
        payload = event.parameter || {};
      }
    } else if (event && event.parameter) {
      payload = event.parameter;
    }

    const action = String(payload.action || "").trim();

    assert_(["driveUpload", "uploadClockSelfie", "readPrivateImage"].indexOf(action) >= 0, "Ação inválida.");
    const token = String(payload.idToken || "");
    const uid = firebaseUid_(token);
    const profile = firebaseProfile_(uid, token);
    assert_(profile && (profile.Ativo === true || profile.Ativo === 1 || String(profile.Ativo).toLowerCase() === "true"), "Usuário inativo.");
    if (action === "readPrivateImage") {
      return jsonResponse_(readPrivateImage_(uid, profile, payload.fileId));
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

function readPrivateImage_(uid, profile, rawId) {
  const fileId = String(rawId || "");
  assert_(/^[A-Za-z0-9_-]{10,160}$/.test(fileId), "Identificador de foto inválido.");
  const file = DriveApp.getFileById(fileId);
  let metadata;
  try { metadata = JSON.parse(file.getDescription() || "null"); } catch (_) {}
  assert_(metadata && metadata.uid && metadata.employeeId, "Foto sem metadados de autorização.");
  const role = String(profile.Perfil || "");
  const manager = ["Gerente", "Responsável de loja", "Chefe de cozinha"].indexOf(role) >= 0;
  assert_(metadata.uid === uid || role === "Administrador" ||
    (manager && profile.LojaID && String(profile.LojaID) === metadata.storeId), "Sem permissão para visualizar esta foto.");
  const blob = file.getBlob();
  const mimeType = blob.getContentType();
  assert_(/^image\/(jpeg|png|webp)$/.test(mimeType), "Arquivo não é uma foto permitida.");
  const bytes = blob.getBytes();
  assert_(bytes.length <= SELFIE_SERVICE_CONFIG_.maxImageBytes, "Foto ultrapassa o limite permitido.");
  return { ok: true, dataUrl: "data:" + mimeType + ";base64," + Utilities.base64Encode(bytes), mimeType: mimeType, fileName: file.getName() };
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
