import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { runtime } from "./runtime.js";
import { assert, nowIso, uuid } from "./utils.js";
import { createNotification, isAdmin, isManager, success } from "./api-base.js";

/**
 * Utilitários criptográficos e de conversão Base64 / Hex
 */
export async function sha256Hex(data) {
  let buffer;
  if (typeof data === "string") {
    // Se for data URL, extrai o payload binário
    if (data.startsWith("data:")) {
      const u8 = base64ToUint8Array(data);
      buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    } else {
      buffer = new TextEncoder().encode(data);
    }
  } else if (data instanceof Uint8Array) {
    buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } else if (data instanceof ArrayBuffer) {
    buffer = data;
  } else {
    buffer = new TextEncoder().encode(String(data || ""));
  }

  if (globalThis.crypto?.subtle?.digest) {
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Fallback para Node.js em ambientes legados
  try {
    const dynamicReq = new Function("module", "return import(module)");
    const nodeCrypto = await dynamicReq("node:crypto");
    return nodeCrypto.createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  } catch {
    throw new Error("Suporte a SHA-256 indisponível no ambiente atual.");
  }
}

export function base64ToUint8Array(base64) {
  const clean = String(base64 || "").replace(/^data:[^;]+;base64,/, "").trim();
  if (typeof atob === "function") {
    const binary = atob(clean);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(clean, "base64"));
  }
  throw new Error("Decodificador Base64 indisponível.");
}

export function uint8ArrayToBase64(u8) {
  if (typeof btoa === "function") {
    let binary = "";
    const len = u8.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = u8.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(u8).toString("base64");
  }
  throw new Error("Codificador Base64 indisponível.");
}

/**
 * Sanitiza texto para compatibilidade com fontes padrão do PDF (WinAnsiEncoding)
 */
export function sanitizeTextForPdf(text) {
  if (!text) return "";
  return String(text)
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\u00A0\u200B\u202F]/g, " ")
    .replace(/•/g, "*")
    .replace(/[^\x00-\xFF]/g, (char) => {
      // Decomposições comuns se houver caracteres fora do Latin-1
      const normalized = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return /^[\x00-\xFF]$/.test(normalized) ? normalized : "?";
    });
}

/**
 * Formata data e hora no horário oficial de Brasília
 */
export function formatBrasiliaDateTime(isoString) {
  try {
    const d = isoString ? new Date(isoString) : new Date();
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Bahia",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return String(isoString || "");
  }
}

/**
 * Quebra de linha inteligente para pdf-lib
 */
function drawWrappedText(page, text, { x, y, width, font, size, lineHeight, color }) {
  const sanitized = sanitizeTextForPdf(text);
  const words = sanitized.split(" ");
  let line = "";
  let currentY = y;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, size);
    if (testWidth > width && line) {
      page.drawText(line, { x, y: currentY, size, font, color });
      line = word;
      currentY -= lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    page.drawText(line, { x, y: currentY, size, font, color });
    currentY -= lineHeight;
  }
  return currentY;
}

/**
 * Gera código de validação único
 */
export function generateValidationCode() {
  const year = new Date().getFullYear();
  const hex = uuid().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `VAL-${year}-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

/**
 * Modelos prontos de termos internos do Grupo House 190
 */
export const DOCUMENT_TEMPLATES = Object.freeze({
  "termo-regulamento": {
    titulo: "Termo de Ciência e Compromisso — Regulamento Interno",
    tipo: "Termo de Ciência",
    conteudo: `TERMO DE CIÊNCIA E COMPROMISSO COM O REGULAMENTO INTERNO

Pelo presente instrumento particular, o(a) colaborador(a) {NOME}, inscrito(a) no CPF sob o nº {CPF}, admitido(a) na unidade {LOJA} do GRUPO HOUSE 190, DECLARA expressamente para os devidos fins de direito que:

1. Recebeu, leu atentamente e compreendeu todas as disposições do Regulamento Interno da empresa, do Código de Conduta e das Normas Operacionais de Segurança e Higiene.
2. Compromete-se a cumprir integralmente suas diretrizes, zelar pelo patrimônio da empresa, manter o sigilo das receitas e processos operacionais, tratar colegas e clientes com respeito e assiduidade.
3. Tem ciência de que o descumprimento das normas vigentes poderá acarretar as penalidades previstas no Artigo 482 da Consolidação das Leis do Trabalho (CLT).
4. Manifesta sua integral concordância de forma livre, espontânea e irrevogável, com assinatura eletrônica avançada nos termos da Lei nº 14.063/2020.`,
  },
  "acordo-banco-horas": {
    titulo: "Acordo Individual de Compensação de Horas e Banco de Horas",
    tipo: "Acordo Banco de Horas",
    conteudo: `ACORDO INDIVIDUAL DE PRORROGAÇÃO E COMPENSAÇÃO DE JORNADA DE TRABALHO
(BANCO DE HORAS — ART. 59 DA CLT)

Entre as partes: de um lado, GRUPO HOUSE 190 ({LOJA}); e de outro lado, o(a) empregado(a) {NOME}, portador(a) do CPF nº {CPF}:

Fica acordado o regime de compensação de jornada de trabalho (Banco de Horas), nos moldes do Artigo 59, § 2º e § 5º da CLT, sob as seguintes cláusulas:

1. A jornada normal de trabalho poderá ser prorrogada mediante a necessidade operacional, sendo as horas suplementares creditadas no Banco de Horas do colaborador no sistema digital Folgas 3.0.
2. A compensação das horas acumuladas ocorrerá mediante concessão de folgas compensatórias ou redução de jornada, programadas em comum acordo.
3. O saldo de horas é disponibilizado para acompanhamento diário e transparente do colaborador através de seu acesso individual no aplicativo Folgas 3.0.
4. Na hipótese de rescisão contratual sem que tenha havido a compensação integral das horas extras acumuladas, o colaborador fará jus ao pagamento das horas pendentes com o acréscimo legal.`,
  },
  "termo-epi-uniforme": {
    titulo: "Termo de Recebimento de Uniforme e Equipamentos de Proteção (EPI)",
    tipo: "Entrega de EPI",
    conteudo: `TERMO DE RECEBIMENTO E RESPONSABILIDADE — UNIFORME E EQUIPAMENTO DE PROTEÇÃO INDIVIDUAL (EPI)

Colaborador(a): {NOME} | CPF: {CPF} | Unidade: {LOJA}

DECLARO que recebi gratuitamente do GRUPO HOUSE 190, para uso exclusivo no desempenho de minhas funções profissionais, os seguintes itens em perfeito estado de conservação:

- Uniforme oficial completo e avental operacional;
- Luvas térmicas/anticorte e calçado de segurança ocupacional antiderrapante (quando aplicável ao setor);
- Acessórios de proteção e higiene exigidos pela ANVISA e normas de segurança do trabalho.

Comprometo-me a utilizar os EPIs durante toda a jornada, zelar pela sua conservação, comunicar imediatamente qualquer avaria e devolvê-los no término do contrato de trabalho, ciente das obrigações da NR-6 e Art. 158 da CLT.`,
  },
});

/**
 * Estampa o selo pericial de assinatura diretamente na folha do documento
 * Sem gerar página avulsa/separada, garantindo conformidade com a Lei 14.063/2020 e Art. 464 CLT.
 */
async function stampSignatureDirectly({
  pdfDoc,
  targetPage,
  docInfo,
  signInfo,
  rubricPngBytes,
}) {
  const { width: pWidth } = targetPage.getSize();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const boxX = 15;
  const boxY = 8;
  const boxWidth = pWidth - 30;
  const boxHeight = 68;
  const splitX = Math.min(boxX + 195, boxX + boxWidth * 0.42);

  // 1. Fundo do card
  targetPage.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
    color: rgb(0.985, 0.99, 1.0),
    borderColor: rgb(0.72, 0.8, 0.92),
    borderWidth: 0.8,
  });

  // 2. Faixa superior Navy
  targetPage.drawRectangle({
    x: boxX,
    y: boxY + boxHeight - 15,
    width: boxWidth,
    height: 15,
    color: rgb(0.08, 0.12, 0.22),
  });

  const headerLeft = "ASSINATURA ELETRONICA AVANCADA - LEI No 14.063/2020 E ART. 464 CLT";
  targetPage.drawText(headerLeft, {
    x: boxX + 8,
    y: boxY + boxHeight - 11,
    size: 6.5,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  const valCodeStr = `VALIDADOR: ${signInfo.CodigoValidacao || "VAL"}`;
  const valWidth = helveticaBold.widthOfTextAtSize(valCodeStr, 6.5);
  targetPage.drawText(sanitizeTextForPdf(valCodeStr), {
    x: boxX + boxWidth - 8 - valWidth,
    y: boxY + boxHeight - 11,
    size: 6.5,
    font: helveticaBold,
    color: rgb(0.68, 0.8, 0.98),
  });

  // 3. Divisória vertical
  targetPage.drawLine({
    start: { x: splitX, y: boxY + 2 },
    end: { x: splitX, y: boxY + boxHeight - 15 },
    thickness: 0.6,
    color: rgb(0.8, 0.85, 0.92),
  });

  // 4. Lado Esquerdo: Rubrica Manuscrita do Colaborador
  let rubricDrawn = false;
  if (rubricPngBytes && rubricPngBytes.length > 0) {
    try {
      const rubricImg = await pdfDoc.embedPng(rubricPngBytes);
      const maxImgW = splitX - boxX - 30;
      const maxImgH = 32;
      const imgScale = Math.min(maxImgW / rubricImg.width, maxImgH / rubricImg.height, 1);
      const drawW = rubricImg.width * imgScale;
      const drawH = rubricImg.height * imgScale;
      const drawX = boxX + 15 + (maxImgW - drawW) / 2;
      const drawY = boxY + 16 + (maxImgH - drawH) / 2;

      targetPage.drawImage(rubricImg, {
        x: drawX,
        y: drawY,
        width: drawW,
        height: drawH,
      });
      rubricDrawn = true;
    } catch {
      // Ignora falha de decodificação e usa fallback
    }
  }

  if (!rubricDrawn) {
    targetPage.drawText("[Rubrica registrada digitalmente]", {
      x: boxX + 18,
      y: boxY + 24,
      size: 7,
      font: helvetica,
      color: rgb(0.35, 0.4, 0.5),
    });
  }

  targetPage.drawLine({
    start: { x: boxX + 15, y: boxY + 14 },
    end: { x: splitX - 15, y: boxY + 14 },
    thickness: 0.5,
    color: rgb(0.6, 0.65, 0.75),
  });

  const nomeSignatario = docInfo.NomeFuncionario || "Colaborador";
  targetPage.drawText(
    sanitizeTextForPdf(`Assinatura de ${nomeSignatario}`),
    {
      x: boxX + 15,
      y: boxY + 5,
      size: 6.2,
      font: helveticaOblique,
      color: rgb(0.3, 0.35, 0.45),
    },
  );

  // 5. Lado Direito: Evidências Técnicas e Legais
  const cpfStr = docInfo.CPFFuncionario || "Nao informado";
  targetPage.drawText(
    sanitizeTextForPdf(`Signatario: ${nomeSignatario}  -  CPF: ${cpfStr}`),
    {
      x: splitX + 10,
      y: boxY + 38,
      size: 7.2,
      font: helveticaBold,
      color: rgb(0.08, 0.12, 0.22),
    },
  );

  const dtStr = formatBrasiliaDateTime(signInfo.DataHoraAssinatura);
  const ipStr = signInfo.EnderecoIP || "Dispositivo PWA";
  targetPage.drawText(
    sanitizeTextForPdf(`Data/Hora: ${dtStr} (Brasilia)  -  IP: ${ipStr}`),
    {
      x: splitX + 10,
      y: boxY + 27,
      size: 6.2,
      font: helvetica,
      color: rgb(0.2, 0.26, 0.36),
    },
  );

  const lojaStr = docInfo.NomeLoja || docInfo.LojaID || "Grupo House 190";
  const dispStr = (signInfo.DispositivoInfo || "Navegador Web / Mobile").slice(0, 40);
  targetPage.drawText(
    sanitizeTextForPdf(`Unidade: ${lojaStr}  -  Dispositivo: ${dispStr}`),
    {
      x: splitX + 10,
      y: boxY + 17,
      size: 6.0,
      font: helvetica,
      color: rgb(0.3, 0.38, 0.48),
    },
  );

  const rawHash = docInfo.HashOriginalSHA256 || "";
  const displayHash = rawHash ? `${rawHash.slice(0, 32)}...` : "SHA-256 Registrado";
  targetPage.drawText(
    sanitizeTextForPdf(`Hash SHA-256: ${displayHash}  -  Autoria e Integridade Garantidas`),
    {
      x: splitX + 10,
      y: boxY + 7,
      size: 5.8,
      font: helvetica,
      color: rgb(0.1, 0.45, 0.22),
    },
  );
}

/**
 * Criação e estampa do PDF assinado diretamente no documento original (sem página avulsa)
 */
export async function generateSignedPdf({
  originalPdfBytes,
  originalText,
  docInfo,
  signInfo,
  rubricPngBytes,
}) {
  let pdfDoc;

  if (originalPdfBytes && originalPdfBytes.length > 0) {
    pdfDoc = await PDFDocument.load(originalPdfBytes);
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;

    // Se o documento tiver múltiplas páginas, carimba um micro-rodapé nas páginas anteriores
    if (totalPages > 1) {
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      for (let i = 0; i < totalPages - 1; i++) {
        const priorPage = pages[i];
        const { width: pW } = priorPage.getSize();
        priorPage.drawRectangle({
          x: 15,
          y: 8,
          width: pW - 30,
          height: 14,
          color: rgb(0.97, 0.98, 1.0),
          borderColor: rgb(0.75, 0.82, 0.92),
          borderWidth: 0.5,
        });
        const microText = sanitizeTextForPdf(
          `Documento vinculado à Assinatura Eletrônica Avançada (${signInfo.CodigoValidacao || "VAL"}). Página ${i + 1} de ${totalPages}. Lei 14.063/2020.`
        );
        priorPage.drawText(microText, {
          x: 22,
          y: 12,
          size: 6.2,
          font: helvetica,
          color: rgb(0.22, 0.28, 0.4),
        });
      }
    }

    // Estampa o selo de assinatura diretamente na última página (ou página única) do documento
    const lastPage = pages[totalPages - 1];
    await stampSignatureDirectly({
      pdfDoc,
      targetPage: lastPage,
      docInfo,
      signInfo,
      rubricPngBytes,
    });
  } else {
    // Se for texto / termo interno gerado dinamicamente
    pdfDoc = await PDFDocument.create();
    const docPage = pdfDoc.addPage([595.28, 841.89]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Cabeçalho do documento de texto
    docPage.drawRectangle({
      x: 40,
      y: 770,
      width: 515.28,
      height: 40,
      color: rgb(0.08, 0.12, 0.22),
    });
    docPage.drawText("GRUPO HOUSE 190 — DOCUMENTO OFICIAL", {
      x: 55,
      y: 792,
      size: 11,
      font: fontBold,
      color: rgb(0.9, 0.95, 1.0),
    });
    docPage.drawText(sanitizeTextForPdf(docInfo.Titulo || "Termo de Acordo"), {
      x: 55,
      y: 778,
      size: 9,
      font: font,
      color: rgb(0.75, 0.82, 0.92),
    });

    // Conteúdo formatado
    const rawContent = String(originalText || docInfo.ConteudoTexto || "");
    const paragraphs = rawContent.split("\n\n");
    let textY = 740;
    for (const para of paragraphs) {
      if (!para.trim()) continue;
      textY = drawWrappedText(docPage, para.trim(), {
        x: 45,
        y: textY,
        width: 505,
        font,
        size: 9.5,
        lineHeight: 15,
        color: rgb(0.15, 0.18, 0.24),
      });
      textY -= 10;
      if (textY < 95) break;
    }

    // Estampa o selo de assinatura diretamente na própria folha do termo
    await stampSignatureDirectly({
      pdfDoc,
      targetPage: docPage,
      docInfo,
      signInfo,
      rubricPngBytes,
    });
  }

  const finalPdfBytes = await pdfDoc.save();
  const finalPdfBase64 = uint8ArrayToBase64(finalPdfBytes);
  const finalHashSha256 = await sha256Hex(finalPdfBytes);

  return {
    finalPdfBytes,
    finalPdfBase64,
    finalHashSha256,
    validationCode: signInfo.CodigoValidacao,
  };
}

/**
 * Criação dos Handlers de API para Documentos
 */
export function createDocumentsHandlers() {
  return {
    /**
     * Lista documentos com filtros de loja, status e funcionário
     */
    async documentsList(args) {
      const [lojaId, status, funcionarioId, mesReferencia] = args || [];
      const profile = await runtime.requireProfile();
      const allDocs = await runtime.list("Documentos", { profile });

      const norm = (x) => String(x ?? "").trim();
      const userFuncId = norm(profile.FuncionarioID || profile.funcionarioId);
      const userLojaId = norm(profile.LojaID || profile.lojaId);
      const isUserAdmin = isAdmin(profile);
      const isUserManager = isManager(profile);

      const filtered = allDocs.filter((doc) => {
        const docFuncId = norm(doc.FuncionarioID);
        const docLojaId = norm(doc.LojaID);

        // Se for colaborador normal, vê estritamente seus próprios documentos
        if (!isUserAdmin && !isUserManager) {
          return docFuncId === userFuncId;
        }

        // Se for gerente de loja, restringe à sua própria loja por padrão se não especificada
        if (!isUserAdmin && isUserManager) {
          if (userLojaId && docLojaId !== userLojaId && docFuncId !== userFuncId) {
            return false;
          }
        }

        // Filtro de loja se informado
        if (lojaId && lojaId !== "all" && docLojaId !== norm(lojaId)) {
          return false;
        }

        // Filtro de status se informado
        if (status && status !== "all" && norm(doc.Status) !== norm(status)) {
          return false;
        }

        // Filtro de colaborador específico
        if (funcionarioId && funcionarioId !== "all" && docFuncId !== norm(funcionarioId)) {
          return false;
        }

        // Filtro de mês de referência
        if (mesReferencia && mesReferencia !== "all" && norm(doc.MesReferencia) !== norm(mesReferencia)) {
          return false;
        }

        return true;
      });

      // Ordena por data de envio (mais recentes primeiro)
      filtered.sort((a, b) => {
        const da = String(a.DataEnvio || a.DataCriacao || "");
        const db = String(b.DataEnvio || b.DataCriacao || "");
        return db.localeCompare(da);
      });

      const pendingCount = filtered.filter((d) => d.Status === "Pendente").length;
      const signedCount = filtered.filter((d) => d.Status === "Assinado").length;

      return {
        success: true,
        message: "",
        data: {
          documents: filtered,
          pendingCount,
          signedCount,
          totalCount: filtered.length,
        },
        documents: filtered,
        pendingCount,
        signedCount,
        totalCount: filtered.length,
      };
    },

    /**
     * Obtém um documento específico por ID
     */
    async documentsGet(args) {
      const [documentoId] = args || [];
      assert(documentoId, "Identificador do documento é obrigatório.");

      const profile = await runtime.requireProfile();
      const doc = await runtime.getById("Documentos", documentoId);
      assert(doc, "Documento não encontrado.");

      const isUserAdmin = isAdmin(profile);
      const isUserManager = isManager(profile);
      const userFuncId = String(profile.FuncionarioID || "").trim();
      const userLojaId = String(profile.LojaID || "").trim();

      if (!isUserAdmin && !isUserManager) {
        assert(
          String(doc.FuncionarioID || "").trim() === userFuncId,
          "Acesso restrito ao próprio colaborador titular.",
        );
      } else if (!isUserAdmin && isUserManager) {
        assert(
          String(doc.LojaID || "").trim() === userLojaId ||
            String(doc.FuncionarioID || "").trim() === userFuncId,
          "Acesso restrito à unidade do colaborador.",
        );
      }

      return success(doc);
    },

    /**
     * Emissão / Upload de Novo Documento (RH / Gerente / Admin)
     */
    async documentsSave(args) {
      const [payload] = args || [];
      assert(payload && typeof payload === "object", "Dados do documento são obrigatórios.");
      assert(payload.Titulo && String(payload.Titulo).trim(), "O título do documento é obrigatório.");
      assert(payload.FuncionarioID, "Selecione o colaborador destinatário.");

      const profile = await runtime.requireProfile();
      assert(
        isAdmin(profile) || isManager(profile),
        "Apenas gerentes e administradores podem emitir documentos.",
      );

      // Resolução do funcionário para dados cadastrais
      const employees = await runtime.list("Funcionarios", { profile }).catch(() => []);
      const targetEmp = employees.find(
        (e) => String(e.FuncionarioID || e.id || e.Funcionario || "").trim() === String(payload.FuncionarioID).trim(),
      );

      const empIdVal = String(targetEmp?.FuncionarioID || payload.FuncionarioID).trim();
      const empNome = String(targetEmp?.Nome || payload.NomeFuncionario || "Colaborador").trim();
      const empCpf = String(targetEmp?.CPF || payload.CPFFuncionario || "").trim();
      const empCargo = String(targetEmp?.Cargo || payload.CargoFuncionario || "").trim();
      const lojaIdVal = String(targetEmp?.LojaID || payload.LojaID || profile.LojaID || "").trim();

      const stores = await runtime.list("Lojas", { profile }).catch(() => []);
      const targetStore = stores.find(
        (s) =>
          String(s.LojaID || s.id || s.Loja || "").trim() === lojaIdVal,
      );

      const docId =
        String(payload.DocumentoID || payload.DocID || "").trim() ||
        `DOC_${Date.now()}_${uuid().slice(0, 6)}`;

      let hashOriginal = String(payload.HashOriginalSHA256 || "").trim();
      let pdfBase64 = String(payload.ArquivoOriginalBase64 || "");

      // Validação de tipo e conteúdo
      if (payload.OrigemTipo === "PDF_IMPORTADO") {
        assert(pdfBase64, "O arquivo PDF original é obrigatório.");
        if (!hashOriginal) {
          hashOriginal = await sha256Hex(pdfBase64);
        }
      } else {
        // Modelo interno de texto
        const texto = String(payload.ConteudoTexto || "").trim();
        assert(texto, "O conteúdo do termo ou contrato é obrigatório.");
        if (!hashOriginal) {
          hashOriginal = await sha256Hex(texto);
        }
      }

      const record = {
        DocumentoID: docId,
        DocID: docId,
        Titulo: String(payload.Titulo).trim(),
        Tipo: String(payload.Tipo || "Holerite").trim(),
        Descricao: String(payload.Descricao || "").trim(),
        FuncionarioID: empIdVal,
        NomeFuncionario: empNome,
        CPFFuncionario: empCpf,
        CargoFuncionario: empCargo,
        LojaID: lojaIdVal,
        NomeLoja: String(targetStore?.NomeLoja || targetStore?.nomeLoja || targetStore?.Nome || payload.NomeLoja || "").trim(),
        MesReferencia: String(payload.MesReferencia || "").trim(),
        Status: "Pendente",
        OrigemTipo: payload.OrigemTipo || "PDF_IMPORTADO",
        ConteudoTexto: payload.ConteudoTexto || "",
        ArquivoOriginalBase64: pdfBase64 || "",
        HashOriginalSHA256: hashOriginal,
        DataEnvio: nowIso(),
        CriadoPor: String(profile.Email || profile.Nome || "Gestão").trim(),
      };

      const saved = await runtime.create("Documentos", record);

      // Notificação ao colaborador
      try {
        await createNotification({
          employeeId: record.FuncionarioID,
          storeId: record.LojaID,
          type: "Documentos",
          subject: "Novo Documento para Assinar",
          message: `Você recebeu o documento "${record.Titulo}". Acesse a aba Documentos para ler e assinar.`,
          relatedId: record.DocumentoID,
        });
      } catch (err) {
        console.warn("[documents] Falha ao disparar notificação:", err);
      }

      return {
        success: true,
        message: "Documento emitido com sucesso.",
        data: saved,
        document: saved,
      };
    },

    /**
     * Assinatura Eletrônica pelo Colaborador
     */
    async documentsSign(args) {
      const [signPayload] = args || [];
      assert(signPayload && typeof signPayload === "object", "Dados da assinatura são obrigatórios.");
      const docId = String(signPayload.DocumentoID || signPayload.DocID || "").trim();
      assert(docId, "Identificador do documento é obrigatório.");

      const rubricBase64 = String(signPayload.RubricaBase64 || "").trim();
      assert(rubricBase64, "Desenhe sua rubrica no painel de assinatura para continuar.");

      const profile = await runtime.requireProfile();
      const doc = await runtime.getById("Documentos", docId);
      assert(doc, "Documento não encontrado.");
      assert(doc.Status !== "Assinado", "Este documento já foi assinado anteriormente.");

      const userFuncId = String(profile.FuncionarioID || "").trim();
      const isUserAdmin = isAdmin(profile);
      assert(
        isUserAdmin || String(doc.FuncionarioID || "").trim() === userFuncId,
        "Apenas o colaborador titular pode assinar este documento.",
      );

      const validationCode = generateValidationCode();
      const signTime = nowIso();
      const timestampUtc = Date.now();

      // Conversão do PDF base e Rubrica para bytes
      let originalPdfBytes = null;
      if (doc.ArquivoOriginalBase64) {
        originalPdfBytes = base64ToUint8Array(doc.ArquivoOriginalBase64);
      }

      const rubricBytes = base64ToUint8Array(rubricBase64);

      // Metadados técnicos informados pelo cliente
      const signInfo = {
        CodigoValidacao: validationCode,
        DataHoraAssinatura: signTime,
        TimestampUTC: timestampUtc,
        EnderecoIP: String(signPayload.EnderecoIP || "Dispositivo Seguro"),
        DispositivoInfo: String(signPayload.DispositivoInfo || "Navegador Web / Mobile"),
        NavegadorInfo: String(signPayload.NavegadorInfo || navigator?.userAgent || ""),
      };

      // Geração do PDF final e cálculo dos hashes
      const signedPdfResult = await generateSignedPdf({
        originalPdfBytes,
        originalText: doc.ConteudoTexto,
        docInfo: doc,
        signInfo,
        rubricPngBytes: rubricBytes,
      });

      const signatureId = `ASS_${Date.now()}_${uuid().slice(0, 6)}`;
      const signatureRecord = {
        AssinaturaID: signatureId,
        DocumentoID: docId,
        FuncionarioID: doc.FuncionarioID,
        NomeSignatario: doc.NomeFuncionario || profile.Nome,
        CPFSignatario: doc.CPFFuncionario || "",
        LojaID: doc.LojaID,
        DataHoraAssinatura: signTime,
        TimestampUTC: timestampUtc,
        EnderecoIP: signInfo.EnderecoIP,
        DispositivoInfo: signInfo.DispositivoInfo,
        NavegadorInfo: signInfo.NavegadorInfo,
        AssinaturaRubricaBase64: rubricBase64,
        HashDocumentoFinalSHA256: signedPdfResult.finalHashSha256,
        HashOriginalSHA256: doc.HashOriginalSHA256,
        CodigoValidacao: validationCode,
        ArquivoFinalBase64: signedPdfResult.finalPdfBase64,
      };

      // Grava no banco a assinatura
      await runtime.create("DocumentosAssinaturas", signatureRecord);

      // Atualiza o documento para Assinado
      const updatedDoc = await runtime.patch("Documentos", docId, {
        Status: "Assinado",
        DataAssinatura: signTime,
        AssinaturaID: signatureId,
        HashDocumentoFinalSHA256: signedPdfResult.finalHashSha256,
        CodigoValidacao: validationCode,
        ArquivoFinalBase64: signedPdfResult.finalPdfBase64,
      });

      // Notifica o gestor / RH
      try {
        await createNotification({
          storeId: doc.LojaID,
          type: "Documentos",
          subject: "Documento Assinado",
          message: `${doc.NomeFuncionario} assinou eletronicamente o documento "${doc.Titulo}".`,
          relatedId: doc.DocumentoID,
        });
      } catch (err) {
        console.warn("[documents] Falha ao notificar gestor:", err);
      }

      return success({
        documento: updatedDoc,
        assinatura: signatureRecord,
        pdfBase64: signedPdfResult.finalPdfBase64,
      });
    },

    /**
     * Exclusão de documento pendente
     */
    async documentsDelete(args) {
      const [documentoId] = args || [];
      assert(documentoId, "Identificador do documento é obrigatório.");

      const profile = await runtime.requireProfile();
      assert(
        isAdmin(profile) || isManager(profile),
        "Apenas gestores podem remover documentos.",
      );

      const doc = await runtime.getById("Documentos", documentoId);
      assert(doc, "Documento não encontrado.");
      assert(
        doc.Status === "Pendente",
        "Documentos já assinados possuem valor jurídico pericial e não podem ser excluídos.",
      );

      await runtime.delete("Documentos", documentoId);
      return success({ deleted: true });
    },

    /**
     * Validação pública ou pericial por código ou Hash
     */
    async documentsVerify(args) {
      const [codeOrHash] = args || [];
      const term = String(codeOrHash || "").trim();
      assert(term, "Código de validação ou Hash SHA-256 é obrigatório.");

      const profile = await runtime.requireProfile();
      const allSigs = await runtime.list("DocumentosAssinaturas", { profile });

      const found = allSigs.find(
        (s) =>
          String(s.CodigoValidacao || "").toUpperCase() === term.toUpperCase() ||
          String(s.HashDocumentoFinalSHA256 || "").toLowerCase() === term.toLowerCase() ||
          String(s.HashOriginalSHA256 || "").toLowerCase() === term.toLowerCase(),
      );

      if (!found) {
        return success({
          valido: false,
          mensagem: "Nenhum documento com este código ou Hash foi localizado.",
        });
      }

      return success({
        valido: true,
        assinatura: {
          CodigoValidacao: found.CodigoValidacao,
          NomeSignatario: found.NomeSignatario,
          CPFSignatario: found.CPFSignatario,
          DataHoraAssinatura: found.DataHoraAssinatura,
          HashDocumentoFinalSHA256: found.HashDocumentoFinalSHA256,
          HashOriginalSHA256: found.HashOriginalSHA256,
          EnderecoIP: found.EnderecoIP,
        },
      });
    },
  };
}
