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
 * Criação e estampa do PDF assinado com folha pericial de auditoria
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
    // Estampa comprovante no rodapé da primeira página
    const firstPage = pdfDoc.getPages()[0];
    const { width: pWidth } = firstPage.getSize();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const bannerY = 10;
    const bannerHeight = 16;
    firstPage.drawRectangle({
      x: 15,
      y: bannerY,
      width: pWidth - 30,
      height: bannerHeight,
      color: rgb(0.96, 0.97, 0.99),
      borderColor: rgb(0.7, 0.76, 0.86),
      borderWidth: 0.5,
    });

    const stampLine = sanitizeTextForPdf(
      `Assinado eletronicamente por ${docInfo.NomeFuncionario} (CPF ${docInfo.CPFFuncionario || "---"}) em ${formatBrasiliaDateTime(signInfo.DataHoraAssinatura)}. Validador: ${signInfo.CodigoValidacao}. Lei 14.063/2020.`,
    );
    firstPage.drawText(stampLine, {
      x: 20,
      y: bannerY + 4,
      size: 6.8,
      font: helvetica,
      color: rgb(0.18, 0.24, 0.35),
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
      if (textY < 60) break;
    }
  }

  // -------------------------------------------------------------
  // PÁGINA PERICIAL DE AUDITORIA (AUDIT TRAIL / CERTIFICADO)
  // -------------------------------------------------------------
  const auditPage = pdfDoc.addPage([595.28, 841.89]);
  const pageWidth = 595.28;
  const pageHeight = 841.89;

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // 1. Banner Superior Navy Blue
  auditPage.drawRectangle({
    x: 0,
    y: pageHeight - 75,
    width: pageWidth,
    height: 75,
    color: rgb(0.07, 0.11, 0.2),
  });

  auditPage.drawText("GRUPO HOUSE 190 · SISTEMA DE GESTAO FOLGAS 3.0", {
    x: 40,
    y: pageHeight - 28,
    size: 9,
    font: helveticaBold,
    color: rgb(0.65, 0.75, 0.9),
  });

  auditPage.drawText("CERTIFICADO DE ASSINATURA ELETRONICA E AUDITORIA", {
    x: 40,
    y: pageHeight - 48,
    size: 13.5,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  auditPage.drawText("Comprovante pericial de autoria, integridade criptografica e manifestacao expressa", {
    x: 40,
    y: pageHeight - 64,
    size: 7.5,
    font: helvetica,
    color: rgb(0.75, 0.82, 0.92),
  });

  // 2. Enquadramento Jurídico
  auditPage.drawRectangle({
    x: 35,
    y: pageHeight - 128,
    width: pageWidth - 70,
    height: 45,
    color: rgb(0.95, 0.97, 1.0),
    borderColor: rgb(0.72, 0.8, 0.92),
    borderWidth: 0.8,
  });

  auditPage.drawText("ENQUADRAMENTO LEGAL E FORCA PROBATORIA", {
    x: 45,
    y: pageHeight - 96,
    size: 8,
    font: helveticaBold,
    color: rgb(0.12, 0.28, 0.55),
  });

  const legalText =
    "Documento assinado nos termos da Lei no 14.063/2020 (Assinatura Eletronica Avancada), Medida Provisoria no 2.200-2/2001, Artigo 464 da CLT (comprovacao de pagamento e recibo por meio eletronico) e Portaria MTP no 671/2021.";
  drawWrappedText(auditPage, legalText, {
    x: 45,
    y: pageHeight - 108,
    width: pageWidth - 90,
    font: helvetica,
    size: 7.2,
    lineHeight: 10,
    color: rgb(0.2, 0.28, 0.4),
  });

  // 3. Grid de Metadados: Documento + Signatário
  const boxTop = pageHeight - 140;
  const boxHeight = 115;
  const halfWidth = (pageWidth - 80) / 2;

  // Box Esquerda: Dados do Documento
  auditPage.drawRectangle({
    x: 35,
    y: boxTop - boxHeight,
    width: halfWidth,
    height: boxHeight,
    color: rgb(0.98, 0.99, 1.0),
    borderColor: rgb(0.85, 0.88, 0.93),
    borderWidth: 0.6,
  });

  auditPage.drawText("DADOS DO DOCUMENTO", {
    x: 45,
    y: boxTop - 16,
    size: 8,
    font: helveticaBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  const docLines = [
    `Titulo: ${docInfo.Titulo || "Documento"}`,
    `Tipo: ${docInfo.Tipo || "Geral"}`,
    `ID: ${docInfo.DocumentoID || docInfo.DocID || "---"}`,
    `Referencia: ${docInfo.MesReferencia || "N/A"}`,
    `Data Envio: ${formatBrasiliaDateTime(docInfo.DataEnvio)}`,
    `Emitido Por: ${docInfo.CriadoPor || "RH / Gestao"}`,
  ];
  let currY = boxTop - 30;
  for (const dl of docLines) {
    auditPage.drawText(sanitizeTextForPdf(dl), {
      x: 45,
      y: currY,
      size: 7.2,
      font: helvetica,
      color: rgb(0.25, 0.3, 0.38),
    });
    currY -= 14;
  }

  // Box Direita: Dados do Signatário
  auditPage.drawRectangle({
    x: 45 + halfWidth,
    y: boxTop - boxHeight,
    width: halfWidth,
    height: boxHeight,
    color: rgb(0.98, 0.99, 1.0),
    borderColor: rgb(0.85, 0.88, 0.93),
    borderWidth: 0.6,
  });

  auditPage.drawText("DADOS DO SIGNATARIO", {
    x: 55 + halfWidth,
    y: boxTop - 16,
    size: 8,
    font: helveticaBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  const sigLines = [
    `Nome: ${docInfo.NomeFuncionario || "Colaborador"}`,
    `CPF: ${docInfo.CPFFuncionario || "Nao informado"}`,
    `Matricula/ID: ${docInfo.FuncionarioID || "---"}`,
    `Unidade/Loja: ${docInfo.NomeLoja || docInfo.LojaID || "---"}`,
    `Status: ASSINADO E CONCORDADO`,
  ];
  currY = boxTop - 30;
  for (const sl of sigLines) {
    auditPage.drawText(sanitizeTextForPdf(sl), {
      x: 55 + halfWidth,
      y: currY,
      size: 7.2,
      font: helvetica,
      color: rgb(0.25, 0.3, 0.38),
    });
    currY -= 14;
  }

  // 4. Registro Forense / Técnico do Dispositivo e Assinatura
  const forensicTop = boxTop - boxHeight - 12;
  const forensicHeight = 85;

  auditPage.drawRectangle({
    x: 35,
    y: forensicTop - forensicHeight,
    width: pageWidth - 70,
    height: forensicHeight,
    color: rgb(0.97, 0.98, 0.99),
    borderColor: rgb(0.82, 0.86, 0.92),
    borderWidth: 0.6,
  });

  auditPage.drawText("EVIDENCIAS TECNICAS DA OPERACAO", {
    x: 45,
    y: forensicTop - 16,
    size: 8,
    font: helveticaBold,
    color: rgb(0.12, 0.18, 0.28),
  });

  const techLines = [
    `Data e Hora da Assinatura: ${formatBrasiliaDateTime(signInfo.DataHoraAssinatura)} (Brasilia)`,
    `Carimbo Temporal UTC: ${signInfo.TimestampUTC || Date.now()} ms`,
    `Endereco IP de Origem: ${signInfo.EnderecoIP || "Registrado pelo dispositivo cliente"}`,
    `Dispositivo / Sistema Operacional: ${signInfo.DispositivoInfo || "Dispositivo movel PWA"}`,
    `Navegador / User-Agent: ${signInfo.NavegadorInfo ? signInfo.NavegadorInfo.slice(0, 95) : "Web PWA Client"}`,
    `Manifestacao: Concordancia expressa e irrevogavel apos rolagem integral obrigatoria e senha do usuario.`,
  ];
  currY = forensicTop - 30;
  for (const tl of techLines) {
    auditPage.drawText(sanitizeTextForPdf(tl), {
      x: 45,
      y: currY,
      size: 7,
      font: helvetica,
      color: rgb(0.22, 0.28, 0.35),
    });
    currY -= 10;
  }

  // 5. Rubrica Manuscrita Capturada em Tela Touch
  const rubricTop = forensicTop - forensicHeight - 12;
  const rubricHeight = 85;

  auditPage.drawRectangle({
    x: 35,
    y: rubricTop - rubricHeight,
    width: pageWidth - 70,
    height: rubricHeight,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.8, 0.85, 0.92),
    borderWidth: 0.6,
  });

  auditPage.drawText("RUBRICA DIGITALIZADA DO COLABORADOR (TOUCH CANVAS)", {
    x: 45,
    y: rubricTop - 16,
    size: 8,
    font: helveticaBold,
    color: rgb(0.12, 0.2, 0.35),
  });

  // Linha de assinatura
  auditPage.drawLine({
    start: { x: 50, y: rubricTop - 65 },
    end: { x: 320, y: rubricTop - 65 },
    thickness: 0.8,
    color: rgb(0.75, 0.8, 0.88),
  });
  auditPage.drawText(
    sanitizeTextForPdf(`Assinatura de ${docInfo.NomeFuncionario}`),
    {
      x: 50,
      y: rubricTop - 76,
      size: 7,
      font: helveticaOblique,
      color: rgb(0.4, 0.45, 0.55),
    },
  );

  // Embed da imagem da rubrica se fornecida
  if (rubricPngBytes && rubricPngBytes.length > 0) {
    try {
      const rubricImage = await pdfDoc.embedPng(rubricPngBytes);
      auditPage.drawImage(rubricImage, {
        x: 60,
        y: rubricTop - 62,
        width: 180,
        height: 42,
      });
    } catch {
      auditPage.drawText("[Rubrica registrada digitalmente]", {
        x: 60,
        y: rubricTop - 50,
        size: 8,
        font: helvetica,
        color: rgb(0.3, 0.3, 0.3),
      });
    }
  }

  // Selo de Autenticidade à Direita
  auditPage.drawRectangle({
    x: 350,
    y: rubricTop - 74,
    width: 190,
    height: 58,
    color: rgb(0.94, 0.98, 0.95),
    borderColor: rgb(0.2, 0.65, 0.35),
    borderWidth: 1,
  });

  auditPage.drawText("AUTENTICADO COM SUCESSO", {
    x: 365,
    y: rubricTop - 32,
    size: 8.5,
    font: helveticaBold,
    color: rgb(0.1, 0.5, 0.25),
  });
  auditPage.drawText(`Codigo: ${signInfo.CodigoValidacao}`, {
    x: 365,
    y: rubricTop - 46,
    size: 7.5,
    font: helveticaBold,
    color: rgb(0.15, 0.2, 0.3),
  });
  auditPage.drawText("Assinatura Eletronica Avancada", {
    x: 365,
    y: rubricTop - 58,
    size: 6.8,
    font: helvetica,
    color: rgb(0.25, 0.45, 0.3),
  });
  auditPage.drawText("Validade probatoria plena", {
    x: 365,
    y: rubricTop - 68,
    size: 6.5,
    font: helveticaOblique,
    color: rgb(0.35, 0.55, 0.4),
  });

  // 6. Trilha Criptográfica de Hashes SHA-256
  const cryptoTop = rubricTop - rubricHeight - 12;
  const cryptoHeight = 110;

  auditPage.drawRectangle({
    x: 35,
    y: cryptoTop - cryptoHeight,
    width: pageWidth - 70,
    height: cryptoHeight,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.7, 0.76, 0.86),
    borderWidth: 0.8,
  });

  auditPage.drawText("INTEGRIDADE CRIPTOGRAFICA E AUDITORIA (SHA-256)", {
    x: 45,
    y: cryptoTop - 16,
    size: 8,
    font: helveticaBold,
    color: rgb(0.1, 0.15, 0.28),
  });

  // Hash Original
  auditPage.drawText("Hash SHA-256 do Documento Original:", {
    x: 45,
    y: cryptoTop - 32,
    size: 7,
    font: helveticaBold,
    color: rgb(0.2, 0.25, 0.35),
  });
  auditPage.drawText(docInfo.HashOriginalSHA256 || "Nao computado", {
    x: 45,
    y: cryptoTop - 42,
    size: 6.8,
    font: helvetica,
    color: rgb(0.15, 0.25, 0.5),
  });

  // Hash Final Placeholder / Explicação
  auditPage.drawText("Hash SHA-256 do Pacote Final e Auditado:", {
    x: 45,
    y: cryptoTop - 56,
    size: 7,
    font: helveticaBold,
    color: rgb(0.2, 0.25, 0.35),
  });
  auditPage.drawText(
    signInfo.HashDocumentoFinalSHA256 ||
      "[Calculado e registrado atomicamente na conclusao do processo]",
    {
      x: 45,
      y: cryptoTop - 66,
      size: 6.8,
      font: helvetica,
      color: rgb(0.1, 0.5, 0.25),
    },
  );

  // Link de Validação
  auditPage.drawText("Canal Oficial de Conferencia:", {
    x: 45,
    y: cryptoTop - 80,
    size: 7,
    font: helveticaBold,
    color: rgb(0.2, 0.25, 0.35),
  });
  const valUrl = `https://houseburgertx-beep.github.io/gestao/#validar=${signInfo.CodigoValidacao}`;
  auditPage.drawText(valUrl, {
    x: 45,
    y: cryptoTop - 90,
    size: 6.8,
    font: helvetica,
    color: rgb(0.15, 0.35, 0.75),
  });

  // 7. Rodapé Institucional
  auditPage.drawText(
    "Este certificado e parte integrante e indissociavel do documento assinado. Qualquer adulteracao invalida os hashes matematicos.",
    {
      x: 40,
      y: 25,
      size: 6.5,
      font: helveticaOblique,
      color: rgb(0.45, 0.5, 0.6),
    },
  );
  auditPage.drawText(
    `Grupo House 190 · Gestao de Folgas 3.0 · Emitido em ${formatBrasiliaDateTime(nowIso())}`,
    {
      x: 40,
      y: 15,
      size: 6,
      font: helvetica,
      color: rgb(0.55, 0.6, 0.7),
    },
  );

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
          if (docLojaId !== userLojaId && docFuncId !== userFuncId) {
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

      return success({
        documents: filtered,
        pendingCount,
        signedCount,
        totalCount: filtered.length,
      });
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
      const employees = await runtime.list("Funcionarios", { profile });
      const targetEmp = employees.find(
        (e) => String(e.FuncionarioID || "").trim() === String(payload.FuncionarioID).trim(),
      );
      assert(targetEmp, "Colaborador selecionado não encontrado no cadastro.");

      const stores = await runtime.list("Lojas", { profile });
      const targetStore = stores.find(
        (s) =>
          String(s.LojaID || s.id || s.Loja || "").trim() ===
          String(targetEmp.LojaID || payload.LojaID).trim(),
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
        FuncionarioID: String(targetEmp.FuncionarioID).trim(),
        NomeFuncionario: String(targetEmp.Nome || payload.NomeFuncionario || "").trim(),
        CPFFuncionario: String(targetEmp.CPF || payload.CPFFuncionario || "").trim(),
        CargoFuncionario: String(targetEmp.Cargo || "").trim(),
        LojaID: String(targetEmp.LojaID || payload.LojaID || "").trim(),
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
          destinatarioId: record.FuncionarioID,
          lojaId: record.LojaID,
          tipo: "documentos",
          assunto: "Novo Documento para Assinar",
          mensagem: `Você recebeu o documento "${record.Titulo}". Acesse a aba Documentos para ler e assinar.`,
        });
      } catch (err) {
        console.warn("[documents] Falha ao disparar notificação:", err);
      }

      return success(saved);
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
          lojaId: doc.LojaID,
          tipo: "documentos",
          assunto: "Documento Assinado",
          mensagem: `${doc.NomeFuncionario} assinou eletronicamente o documento "${doc.Titulo}".`,
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
