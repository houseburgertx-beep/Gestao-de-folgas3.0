const DRIVE_ID = /^[A-Za-z0-9_-]{10,160}$/;

export function taskPhotoReference(task) {
  const url = String(task?.FOTO_URL || task?.FotoEvidencia || "");
  const explicitId = String(task?.FOTO_ID || "");
  const urlId = url.match(/^https:\/\/drive\.google\.com\/(?:file\/d\/|(?:uc|thumbnail)\?[^#]*\bid=)([A-Za-z0-9_-]{10,160})/)?.[1] || "";
  const fileId = DRIVE_ID.test(explicitId) ? explicitId : urlId;
  const isPrivate = task?.FOTO_PRIVADA === true;
  // Legacy images retain their existing public-link behavior. New private
  // images must always be resolved by the authenticated service.
  const publicUrl = !isPrivate && fileId
    ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1280`
    : /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(url) || /^https:\/\//.test(url) ? url : "";
  return { fileId, isPrivate, publicUrl: isPrivate ? "" : publicUrl };
}

export function createTaskPhotoCache({ load, currentUid, maxEntries = 24, ttlMs = 5 * 60 * 1000, now = Date.now }) {
  let owner = "";
  const entries = new Map();
  return {
    clear() { owner = ""; entries.clear(); },
    async get(fileId) {
      const uid = String(currentUid() || "");
      if (!uid) { owner = ""; entries.clear(); throw new Error("Sua sessão expirou. Entre novamente."); }
      if (uid !== owner) { owner = uid; entries.clear(); }
      const hit = entries.get(fileId);
      if (hit && hit.expiresAt > now()) {
        entries.delete(fileId); entries.set(fileId, hit);
        return hit.promise;
      }
      const entry = { expiresAt: now() + ttlMs };
      entry.promise = Promise.resolve().then(() => load(fileId)).then((dataUrl) => {
        if (String(currentUid() || "") !== uid) throw new Error("A conta conectada mudou.");
        return dataUrl;
      }).catch((error) => {
        // Cache failures briefly to avoid repeatedly calling Drive on re-render.
        entry.expiresAt = now() + 30000;
        throw error;
      });
      entries.set(fileId, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return entry.promise;
    },
  };
}
