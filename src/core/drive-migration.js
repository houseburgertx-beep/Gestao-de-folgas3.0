import { runtime } from "./runtime.js";
import { assert } from "./utils.js";
import { isAdmin } from "./api-base.js";
import {
  inferMimeTypeFromDataUrl,
  parseDriveFileId,
  uploadPrivateDocumentToDrive,
} from "./drive-storage.js";

const ONBOARDING_TOKEN_RE = /^onb_[A-Za-z0-9_-]{24,96}$/;

export function isInlineBase64Asset(value) {
  const s = String(value || "").trim();
  if (!s) return false;
  if (/^data:(image\/|application\/pdf)/i.test(s)) return true;
  // Detecta Base64 bruto (PDF ou imagem PNG/JPEG) sem prefixo data:
  if (s.length > 200 && !s.startsWith("http") && /^(JVBERi|\/9j\/|iVBORw|R0lGOD|UklGR)/i.test(s)) {
    return true;
  }
  return false;
}

function guessMimeFromInline(value, fallback = "application/pdf") {
  const s = String(value || "").trim();
  if (s.startsWith("data:")) return inferMimeTypeFromDataUrl(s, fallback);
  if (s.startsWith("JVBERi")) return "application/pdf";
  if (s.startsWith("/9j/")) return "image/jpeg";
  if (s.startsWith("iVBORw")) return "image/png";
  if (s.startsWith("UklGR")) return "image/webp";
  if (s.startsWith("R0lGOD")) return "image/gif";
  return fallback;
}

function ensureDataUrl(value, fallbackMime = "application/pdf") {
  const s = String(value || "").trim();
  if (s.startsWith("data:")) return s;
  const mime = guessMimeFromInline(s, fallbackMime);
  return `data:${mime};base64,${s.replace(/\s+/g, "")}`;
}

export async function migrarAnexosParaGoogleDrive({ onProgress, dryRun = false } = {}) {
  const profile = await runtime.requireProfile();
  assert(
    isAdmin(profile),
    "Apenas Administradores podem executar a migração em massa para o Google Drive.",
  );

  const report = {
    scannedRecords: 0,
    migratedFiles: 0,
    migratedRecords: 0,
    bytesFreed: 0,
    mbFreed: "0.00",
    protectedSignatureRecords: 0,
    errors: [],
    byTable: {
      Documentos: 0,
      Funcionarios: 0,
      onboardingConvites: 0,
      FolhaPagamentos: 0,
      JustificativasPonto: 0,
      Tarefas: 0,
      DocumentosAssinaturas: 0,
    },
  };

  const emit = (stage, detail = "") => {
    if (typeof onProgress === "function") {
      onProgress({ stage, detail, ...report });
    }
  };

  // Cache local por conteúdo para não subir PDF/imagem duplicada
  const dedupCache = new Map();
  const uploadInline = async (inlineValue, meta) => {
    const dataUrl = ensureDataUrl(inlineValue, meta.fallbackMime || "application/pdf");
    const dedupKey = `${meta.category}|${meta.employeeId || ""}|${dataUrl.length}|${dataUrl.slice(0, 96)}|${dataUrl.slice(-64)}`;
    if (dedupCache.has(dedupKey)) return dedupCache.get(dedupKey);
    const mimeType = inferMimeTypeFromDataUrl(dataUrl, meta.fallbackMime || "application/pdf");
    const res = await uploadPrivateDocumentToDrive({
      dataUrl,
      mimeType,
      fileName: meta.fileName || "anexo",
      category: meta.category || "documentos",
      employeeId: meta.employeeId || "",
      storeId: meta.storeId || "",
      docId: meta.docId || "",
      inviteToken: meta.inviteToken || "",
    });
    dedupCache.set(dedupKey, res);
    return res;
  };

  // 1. Documentos (Holerites, Atestados, PDFs enviados, Documentos Admissionais)
  emit("Documentos", "Verificando Documentos no Firebase...");
  const docs = await runtime.list("Documentos", { profile }).catch(() => []);
  for (const doc of docs) {
    report.scannedRecords += 1;
    const docId = String(doc.DocumentoID || doc.DocID || doc.id || "").trim();
    if (!docId) continue;

    try {
      const patch = {};
      let docChanged = false;
      let docBytesFreed = 0;

      const lowerTipo = String(doc.Tipo || "").toLowerCase();
      const cat = lowerTipo.includes("atestado")
        ? "atestado"
        : lowerTipo.includes("holerite")
          ? "holerite"
          : lowerTipo.includes("admissional")
            ? "admissao"
            : "documento";

      const inlineOriginal = isInlineBase64Asset(doc.ArquivoOriginalBase64)
        ? doc.ArquivoOriginalBase64
        : !doc.ArquivoDriveFileID && isInlineBase64Asset(doc.ArquivoUrl || doc.ArquivoURL || doc.DocumentoUrl)
          ? (doc.ArquivoUrl || doc.ArquivoURL || doc.DocumentoUrl)
          : "";

      if (inlineOriginal) {
        docBytesFreed += String(doc.ArquivoOriginalBase64 || "").length;
        if (isInlineBase64Asset(doc.ArquivoUrl)) docBytesFreed += String(doc.ArquivoUrl).length;
        if (isInlineBase64Asset(doc.ArquivoURL)) docBytesFreed += String(doc.ArquivoURL).length;
        if (!dryRun) {
          const res = await uploadInline(inlineOriginal, {
            category: cat,
            employeeId: doc.FuncionarioID || "",
            storeId: doc.LojaID || "",
            docId,
            fileName: doc.NomeArquivo || doc.Titulo || `${docId}.pdf`,
            fallbackMime: "application/pdf",
          });
          patch.ArquivoOriginalBase64 = "";
          patch.ArquivoDriveFileID = res.fileId;
          patch.ArquivoUrl = res.url;
          if ("ArquivoURL" in doc) patch.ArquivoURL = res.url;
          if ("DocumentoUrl" in doc && isInlineBase64Asset(doc.DocumentoUrl)) patch.DocumentoUrl = res.url;
          patch.ArquivoStorage = "Google Drive";
          patch.ArquivoMimeType = res.mimeType || doc.ArquivoMimeType || "application/pdf";
          if (!doc.HashOriginalSHA256 && res.sha256) patch.HashOriginalSHA256 = res.sha256;
        }
        docChanged = true;
        report.migratedFiles += 1;
      }

      if (isInlineBase64Asset(doc.ArquivoFinalBase64)) {
        docBytesFreed += String(doc.ArquivoFinalBase64).length;
        if (!dryRun) {
          const res = await uploadInline(doc.ArquivoFinalBase64, {
            category: "assinado",
            employeeId: doc.FuncionarioID || "",
            storeId: doc.LojaID || "",
            docId,
            fileName: `${doc.Titulo || docId}_assinado.pdf`,
            fallbackMime: "application/pdf",
          });
          patch.ArquivoFinalBase64 = "";
          patch.ArquivoFinalDriveFileID = res.fileId;
          patch.ArquivoFinalUrl = res.url;
          patch.ArquivoFinalStorage = "Google Drive";
        }
        docChanged = true;
        report.migratedFiles += 1;
      }

      if (Array.isArray(doc.Arquivos) && doc.Arquivos.length > 0) {
        let arrayDirty = false;
        const nextArquivos = [];
        for (let idx = 0; idx < doc.Arquivos.length; idx += 1) {
          const f = doc.Arquivos[idx];
          if (!f) continue;
          const rawUrl = String(f.arquivoUrl || f.ArquivoURL || f.url || "").trim();
          if (isInlineBase64Asset(rawUrl)) {
            arrayDirty = true;
            docBytesFreed += rawUrl.length;
            if (!dryRun) {
              const res = await uploadInline(rawUrl, {
                category: cat,
                employeeId: doc.FuncionarioID || "",
                storeId: doc.LojaID || "",
                docId,
                fileName: f.nomeArquivo || `${docId}_${idx + 1}`,
                fallbackMime: "image/jpeg",
              });
              nextArquivos.push({
                ...f,
                arquivoUrl: res.url,
                driveFileId: res.fileId,
                storage: "Google Drive",
                mimeType: res.mimeType || f.mimeType || "",
              });
            } else {
              nextArquivos.push(f);
            }
            report.migratedFiles += 1;
          } else {
            nextArquivos.push(f);
          }
        }
        if (arrayDirty) {
          patch.Arquivos = nextArquivos;
          if (nextArquivos[0]?.arquivoUrl && isInlineBase64Asset(doc.ArquivoURL || doc.ArquivoUrl)) {
            patch.ArquivoURL = nextArquivos[0].arquivoUrl;
            patch.ArquivoUrl = nextArquivos[0].arquivoUrl;
            patch.ArquivoDriveFileID = nextArquivos[0].driveFileId || parseDriveFileId(nextArquivos[0].arquivoUrl);
            patch.ArquivoStorage = "Google Drive";
          }
          docChanged = true;
        }
      }

      if (docChanged) {
        if (!dryRun) {
          await runtime.update("Documentos", docId, patch);
        }
        report.migratedRecords += 1;
        report.byTable.Documentos += 1;
        report.bytesFreed += docBytesFreed;
        emit("Documentos", `${report.byTable.Documentos} documento(s) migrado(s)...`);
      }
    } catch (err) {
      report.errors.push(`Documentos/${docId}: ${err?.message || err}`);
    }
  }

  // 2. Funcionarios.DossieDocumentos & Onboarding Invites
  emit("Funcionarios", "Verificando Dossiês e links de pré-cadastro...");
  const employees = await runtime.list("Funcionarios", { profile }).catch(() => []);
  for (const emp of employees) {
    report.scannedRecords += 1;
    const empId = String(emp.FuncionarioID || emp.id || "").trim();
    if (!empId) continue;

    if (emp.DossieDocumentos && typeof emp.DossieDocumentos === "object") {
      try {
        let dirty = false;
        let empBytes = 0;
        const nextDossie = {};
        for (const [code, meta] of Object.entries(emp.DossieDocumentos)) {
          if (!meta || typeof meta !== "object") {
            nextDossie[code] = meta;
            continue;
          }
          const copy = { ...meta };
          if (Array.isArray(copy.arquivos) && copy.arquivos.length > 0) {
            const nextFiles = [];
            for (let i = 0; i < copy.arquivos.length; i += 1) {
              const f = copy.arquivos[i];
              const raw = String(f?.arquivoUrl || "").trim();
              if (isInlineBase64Asset(raw)) {
                dirty = true;
                empBytes += raw.length;
                if (!dryRun) {
                  const res = await uploadInline(raw, {
                    category: "admissao",
                    employeeId: empId,
                    storeId: emp.LojaID || "",
                    docId: code,
                    fileName: f.nomeArquivo || `${code}_${i + 1}`,
                    fallbackMime: "image/jpeg",
                  });
                  nextFiles.push({
                    ...f,
                    arquivoUrl: res.url,
                    driveFileId: res.fileId,
                    storage: "Google Drive",
                    mimeType: res.mimeType || f.mimeType || "",
                  });
                } else {
                  nextFiles.push(f);
                }
                report.migratedFiles += 1;
              } else {
                nextFiles.push(f);
              }
            }
            copy.arquivos = nextFiles;
            if (isInlineBase64Asset(copy.arquivoUrl) && nextFiles[0]?.arquivoUrl) {
              empBytes += String(copy.arquivoUrl).length;
              copy.arquivoUrl = nextFiles[0].arquivoUrl;
              copy.driveFileId = nextFiles[0].driveFileId || parseDriveFileId(nextFiles[0].arquivoUrl);
              copy.storage = "Google Drive";
            }
          } else if (isInlineBase64Asset(copy.arquivoUrl)) {
            dirty = true;
            empBytes += String(copy.arquivoUrl).length;
            if (!dryRun) {
              const res = await uploadInline(copy.arquivoUrl, {
                category: "admissao",
                employeeId: empId,
                storeId: emp.LojaID || "",
                docId: code,
                fileName: copy.nomeArquivo || `${code}`,
                fallbackMime: "image/jpeg",
              });
              copy.arquivoUrl = res.url;
              copy.driveFileId = res.fileId;
              copy.storage = "Google Drive";
              copy.mimeType = res.mimeType || copy.mimeType || "";
            }
            report.migratedFiles += 1;
          }
          nextDossie[code] = copy;
        }
        if (dirty) {
          if (!dryRun) {
            await runtime.update("Funcionarios", empId, { DossieDocumentos: nextDossie });
          }
          report.migratedRecords += 1;
          report.byTable.Funcionarios += 1;
          report.bytesFreed += empBytes;
        }
      } catch (err) {
        report.errors.push(`Funcionarios/${empId}: ${err?.message || err}`);
      }
    }

    const token = String(emp.OnboardingToken || "").trim();
    if (token && ONBOARDING_TOKEN_RE.test(token)) {
      try {
        const convite = await runtime.readPath(`onboardingConvites/${token}`).catch(() => null);
        const subDocs = convite?.Submissao?.Documentos;
        if (subDocs && typeof subDocs === "object") {
          let dirty = false;
          let invBytes = 0;
          const nextSubDocs = {};
          for (const [code, item] of Object.entries(subDocs)) {
            if (!item || typeof item !== "object") {
              nextSubDocs[code] = item;
              continue;
            }
            const copy = { ...item };
            if (Array.isArray(copy.arquivos) && copy.arquivos.length > 0) {
              const nextFiles = [];
              for (let i = 0; i < copy.arquivos.length; i += 1) {
                const f = copy.arquivos[i];
                const raw = String(f?.arquivoUrl || "").trim();
                if (isInlineBase64Asset(raw)) {
                  dirty = true;
                  invBytes += raw.length;
                  if (!dryRun) {
                    const res = await uploadInline(raw, {
                      category: "admissao",
                      employeeId: convite.FuncionarioID || empId,
                      storeId: convite.LojaID || emp.LojaID || "",
                      docId: code,
                      inviteToken: token,
                      fileName: f.nomeArquivo || `${code}_${i + 1}`,
                      fallbackMime: "image/jpeg",
                    });
                    nextFiles.push({
                      ...f,
                      arquivoUrl: res.url,
                      driveFileId: res.fileId,
                      storage: "Google Drive",
                      mimeType: res.mimeType || f.mimeType || "",
                    });
                  } else {
                    nextFiles.push(f);
                  }
                  report.migratedFiles += 1;
                } else {
                  nextFiles.push(f);
                }
              }
              copy.arquivos = nextFiles;
              if (isInlineBase64Asset(copy.arquivoUrl) && nextFiles[0]?.arquivoUrl) {
                copy.arquivoUrl = nextFiles[0].arquivoUrl;
                copy.driveFileId = nextFiles[0].driveFileId || "";
                copy.storage = "Google Drive";
              }
            } else if (isInlineBase64Asset(copy.arquivoUrl)) {
              dirty = true;
              invBytes += String(copy.arquivoUrl).length;
              if (!dryRun) {
                const res = await uploadInline(copy.arquivoUrl, {
                  category: "admissao",
                  employeeId: convite.FuncionarioID || empId,
                  storeId: convite.LojaID || emp.LojaID || "",
                  docId: code,
                  inviteToken: token,
                  fileName: copy.nomeArquivo || `${code}`,
                  fallbackMime: "image/jpeg",
                });
                copy.arquivoUrl = res.url;
                copy.driveFileId = res.fileId;
                copy.storage = "Google Drive";
                copy.mimeType = res.mimeType || "";
              }
              report.migratedFiles += 1;
            }
            nextSubDocs[code] = copy;
          }
          if (dirty) {
            if (!dryRun) {
              await runtime.patchPath(`onboardingConvites/${token}`, {
                Submissao: {
                  ...convite.Submissao,
                  Documentos: nextSubDocs,
                },
              });
            }
            report.migratedRecords += 1;
            report.byTable.onboardingConvites += 1;
            report.bytesFreed += invBytes;
          }
        }
      } catch (err) {
        report.errors.push(`onboardingConvites/${token}: ${err?.message || err}`);
      }
    }
  }

  // 3. FolhaPagamentos (Comprovantes de pagamento)
  emit("FolhaPagamentos", "Verificando comprovantes da folha...");
  const payments = await runtime.list("FolhaPagamentos", { profile }).catch(() => []);
  for (const pag of payments) {
    report.scannedRecords += 1;
    const pagId = String(pag.PagamentoID || pag.id || "").trim();
    const rawComp = String(pag.ComprovanteURL || pag.ComprovanteUrl || "").trim();
    if (!pagId || !isInlineBase64Asset(rawComp)) continue;
    try {
      if (!dryRun) {
        const res = await uploadInline(rawComp, {
          category: "comprovante_folha",
          employeeId: pag.FuncionarioID || "",
          storeId: pag.LojaID || "",
          docId: pagId,
          fileName: pag.ComprovanteNome || `comprovante_${pagId}`,
          fallbackMime: "image/jpeg",
        });
        await runtime.update("FolhaPagamentos", pagId, {
          ComprovanteURL: res.url,
          ComprovanteDriveFileID: res.fileId,
          ComprovanteStorage: "Google Drive",
          ComprovanteMimeType: res.mimeType || "",
        });
      }
      report.migratedFiles += 1;
      report.migratedRecords += 1;
      report.byTable.FolhaPagamentos += 1;
      report.bytesFreed += rawComp.length;
    } catch (err) {
      report.errors.push(`FolhaPagamentos/${pagId}: ${err?.message || err}`);
    }
  }

  // 4. JustificativasPonto (Atestados/comprovantes de ponto antigos)
  emit("JustificativasPonto", "Verificando anexos de justificativas de ponto...");
  const justs = await runtime.list("JustificativasPonto", { profile }).catch(() => []);
  for (const just of justs) {
    report.scannedRecords += 1;
    const justId = String(just.JustificativaPontoID || just.id || "").trim();
    if (!justId) continue;
    const rawInline = [just.ArquivoOriginalBase64, just.DocumentoBase64, just.ArquivoURL, just.ArquivoUrl, just.ComprovanteURL, just.DocumentoUrl]
      .find((v) => isInlineBase64Asset(v));
    if (!rawInline) continue;
    try {
      let bytes = 0;
      if (isInlineBase64Asset(just.ArquivoOriginalBase64)) bytes += String(just.ArquivoOriginalBase64).length;
      if (isInlineBase64Asset(just.DocumentoBase64)) bytes += String(just.DocumentoBase64).length;
      if (isInlineBase64Asset(just.ArquivoURL)) bytes += String(just.ArquivoURL).length;
      if (isInlineBase64Asset(just.ArquivoUrl)) bytes += String(just.ArquivoUrl).length;
      if (isInlineBase64Asset(just.ComprovanteURL)) bytes += String(just.ComprovanteURL).length;
      if (isInlineBase64Asset(just.DocumentoUrl)) bytes += String(just.DocumentoUrl).length;

      if (!dryRun) {
        const res = await uploadInline(rawInline, {
          category: "justificativa",
          employeeId: just.FuncionarioID || "",
          storeId: just.LojaID || "",
          docId: justId,
          fileName: `justificativa_${justId}`,
          fallbackMime: "image/jpeg",
        });
        const patch = {
          ArquivoDriveFileID: res.fileId,
          ArquivoStorage: "Google Drive",
          ArquivoMimeType: res.mimeType || "",
        };
        if ("ArquivoOriginalBase64" in just) patch.ArquivoOriginalBase64 = "";
        if ("DocumentoBase64" in just) patch.DocumentoBase64 = "";
        if ("ArquivoURL" in just || !("ArquivoUrl" in just)) patch.ArquivoURL = res.url;
        if ("ArquivoUrl" in just) patch.ArquivoUrl = res.url;
        if (isInlineBase64Asset(just.ComprovanteURL)) patch.ComprovanteURL = res.url;
        if (isInlineBase64Asset(just.DocumentoUrl)) patch.DocumentoUrl = res.url;
        await runtime.update("JustificativasPonto", justId, patch);
      }
      report.migratedFiles += 1;
      report.migratedRecords += 1;
      report.byTable.JustificativasPonto += 1;
      report.bytesFreed += bytes;
    } catch (err) {
      report.errors.push(`JustificativasPonto/${justId}: ${err?.message || err}`);
    }
  }

  // 5. Tarefas (Fotos de tarefas com fallback Base64 antigo)
  emit("Tarefas", "Verificando fotos pendentes em Tarefas...");
  const tasks = await runtime.list("Tarefas", { profile }).catch(() => []);
  for (const t of tasks) {
    report.scannedRecords += 1;
    const tId = String(t.TarefaID || t.id || "").trim();
    const rawPhoto = String(t.FOTO_URL || t.FotoUrl || t.fotoUrl || "").trim();
    if (!tId || !isInlineBase64Asset(rawPhoto)) continue;
    try {
      if (!dryRun) {
        const res = await uploadInline(rawPhoto, {
          category: "tarefa",
          employeeId: t.FuncionarioID || t.ResponsavelID || "",
          storeId: t.LojaID || "",
          docId: tId,
          fileName: `tarefa_${tId}.jpg`,
          fallbackMime: "image/jpeg",
        });
        await runtime.update("Tarefas", tId, {
          FOTO_URL: res.url,
          FOTO_ID: res.fileId,
          FOTO_PRIVADA: true,
          FOTO_PENDENTE_DRIVE: false,
        });
      }
      report.migratedFiles += 1;
      report.migratedRecords += 1;
      report.byTable.Tarefas += 1;
      report.bytesFreed += rawPhoto.length;
    } catch (err) {
      report.errors.push(`Tarefas/${tId}: ${err?.message || err}`);
    }
  }

  // 6. DocumentosAssinaturas (somente se as regras do Firebase permitirem atualização administrativa)
  emit("DocumentosAssinaturas", "Verificando PDFs antigos em DocumentosAssinaturas...");
  const sigs = await runtime.list("DocumentosAssinaturas", { profile }).catch(() => []);
  for (const sig of sigs) {
    report.scannedRecords += 1;
    const sigId = String(sig.AssinaturaID || sig.id || "").trim();
    if (!sigId || !isInlineBase64Asset(sig.ArquivoFinalBase64)) continue;
    try {
      if (!dryRun) {
        const res = await uploadInline(sig.ArquivoFinalBase64, {
          category: "assinado",
          employeeId: sig.FuncionarioID || "",
          storeId: sig.LojaID || "",
          docId: sig.DocumentoID || sigId,
          fileName: `assinado_${sig.DocumentoID || sigId}.pdf`,
          fallbackMime: "application/pdf",
        });
        await runtime.update("DocumentosAssinaturas", sigId, {
          ArquivoFinalBase64: "",
          ArquivoFinalUrl: res.url,
          ArquivoFinalDriveFileID: res.fileId,
          ArquivoFinalStorage: "Google Drive",
        });
      }
      report.migratedFiles += 1;
      report.migratedRecords += 1;
      report.byTable.DocumentosAssinaturas += 1;
      report.bytesFreed += String(sig.ArquivoFinalBase64).length;
    } catch (err) {
      const msg = String(err?.message || err?.code || err || "");
      if (/permission[_ ]denied/i.test(msg)) {
        report.protectedSignatureRecords += 1;
      } else {
        report.errors.push(`DocumentosAssinaturas/${sigId}: ${msg}`);
      }
    }
  }

  if (!dryRun) {
    runtime.invalidateTableCache?.("Documentos");
    runtime.invalidateTableCache?.("Funcionarios");
    runtime.invalidateTableCache?.("FolhaPagamentos");
    runtime.invalidateTableCache?.("JustificativasPonto");
    runtime.invalidateTableCache?.("Tarefas");
    runtime.invalidateTableCache?.("DocumentosAssinaturas");
  }

  report.mbFreed = (report.bytesFreed / (1024 * 1024)).toFixed(2);
  emit("Concluído", `Liberados ~${report.mbFreed} MB no Firebase.`);
  return report;
}
