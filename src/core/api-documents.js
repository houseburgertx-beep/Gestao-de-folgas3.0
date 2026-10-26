import { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFArray, decodePDFRawStream } from "pdf-lib";
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
 * Formata somente a data (DD/MM/AAAA) no horário oficial de Brasília
 */
export function formatBrasiliaDateOnly(isoString) {
  try {
    const d = isoString ? new Date(isoString) : new Date();
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Bahia",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}

/**
 * Quebra de linha inteligente para pdf-lib
 */
function drawWrappedText(page, text, { x, y, width, font, size, lineHeight, color }) {
  const sanitized = sanitizeTextForPdf(text);
  const rawParagraphs = sanitized.split(/\r?\n/);
  let currentY = y;

  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      currentY -= lineHeight * 0.6;
      continue;
    }
    const words = trimmed.split(/\s+/).filter(Boolean);
    let line = "";
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
  "termo-lgpd-consentimento": {
    titulo: "Termo de Consentimento para Tratamento de Dados Pessoais e Sensíveis (LGPD)",
    tipo: "Consentimento LGPD",
    conteudo: `TERMO DE CONSENTIMENTO E CIÊNCIA PARA TRATAMENTO DE DADOS PESSOAIS E SENSÍVEIS
(LEI GERAL DE PROTEÇÃO DE DADOS PESSOAIS — LEI Nº 13.709/2018)

Pelo presente instrumento particular, eu, {NOME}, inscrito(a) no CPF sob o nº {CPF}, admitido(a) na unidade {LOJA} do GRUPO HOUSE 190, manifesto expressamente minha ciência e livre consentimento para o tratamento de meus dados pessoais e dados sensíveis de saúde, nos seguintes termos:

1. FINALIDADE E BASE LEGAL: Autorizo expressamente o GRUPO HOUSE 190 a coletar, tratar, armazenar e arquivar meus dados pessoais (nome, CPF, RG, dados bancários para pagamento, endereço, contatos e registros de jornada de trabalho) e dados sensíveis de saúde (atestados médicos, atestados odontológicos, declarações de comparecimento, licenças e laudos ocupacionais), estritamente para os fins de cumprimento do contrato de trabalho, apuração de escalas, folgas e ponto eletrônico, bem como cumprimento de obrigações legais, trabalhistas e previdenciárias (Art. 7º, incisos I e II, e Art. 11, inciso II, alínea 'a' da Lei nº 13.709/2018).

2. ARMAZENAMENTO E SEGURANÇA: Fico ciente de que todos os meus dados e documentos serão armazenados em base de dados segura e restrita, dotada de controle de acesso, perfis hierárquicos e mecanismos de proteção digital, em estrita observância às diretrizes de segurança da informação previstas no Artigo 46 da LGPD.

3. DADOS DE SAÚDE E SIGILO: A guarda de atestados médicos destina-se unicamente à justificação legal de faltas e abono de jornada de trabalho, comprometendo-se o empregador a manter o estrito sigilo ético e legal sobre diagnósticos e informações de saúde.

4. DIREITOS DO TITULAR: Tenho ciência de que posso, a qualquer momento, exercer os direitos assegurados pelo Artigo 18 da Lei nº 13.709/2018, incluindo a consulta e atualização dos meus dados junto ao departamento de recursos humanos da empresa.

E, por ser a expressão livre e consciente da minha vontade, firmo o presente termo para que produza todos os seus efeitos legais.`,
  },
  "politica-privacidade": {
    titulo: "Termo de Ciência da Política de Privacidade e Proteção de Dados (LGPD)",
    tipo: "Política de Privacidade",
    conteudo: `TERMO DE CIÊNCIA E RECEBIMENTO DA POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS PESSOAIS
(LEI GERAL DE PROTEÇÃO DE DADOS PESSOAIS — LEI Nº 13.709/2018)

Pelo presente instrumento particular, o(a) colaborador(a) {NOME}, inscrito(a) no CPF sob o nº {CPF}, atuante na unidade {LOJA} do GRUPO HOUSE 190, DECLARA para todos os fins de direito que:

1. Teve acesso integral, leu atentamente e recebeu cópia da Política de Privacidade e Proteção de Dados Pessoais do Grupo House 190 (Versão 1.0), que disciplina o tratamento de informações cadastrais, de autenticação, de jornada e ponto eletrônico, dados de escalas e banco de horas, imagens e selfies, geolocalização no ato da batida de ponto, atestados de saúde, tarefas operacionais e comunicações internas no âmbito do sistema Gestão de Folgas 3.0.

2. Está ciente das finalidades legítimas de cada tratamento de dados, bem como das hipóteses legais fundamentadas na LGPD (execução do contrato de trabalho, cumprimento de obrigações legais e regulatórias trabalhistas e previdenciárias, e exercício regular de direitos).

3. Foi expressamente informado(a) sobre seus direitos como titular de dados (Art. 18 da LGPD), incluindo o acesso às suas informações, confirmação do tratamento, retificação de dados incorretos e canais oficiais de comunicação para atendimento de solicitações de privacidade.

4. Reconhece que os registros eletrônicos de ponto, com captura de selfie e localização no momento da marcação, destinam-se exclusivamente à segurança jurídica da apuração da jornada, prevenção a fraudes e cumprimento das normas trabalhistas (Portaria MTE nº 671/2021).

Por ser a expressão da verdade, firma o presente termo de ciência e recebimento.`,
  },
});

/**
 * Estampa a assinatura eletrônica avançada diretamente no canhoto oficial de Holerites/Contracheques
 * (coluna lateral vertical à direita: "Declaro ter recebido a importância..." / "Assinatura do Funcionário" / "Data")
 * Sem poluir o contracheque, posicionando a rubrica e a data literalmente sobre os campos reservados.
 */
async function stampHoleriteVerticalStub({
  pdfDoc,
  targetPage,
  docInfo,
  signInfo,
  rubricPngBytes,
}) {
  const { width: pWidth, height: pHeight } = targetPage.getSize();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Coordenadas milimétricas baseadas no padrão oficial de holerites A4 brasileiros (ex: Domínio, Totvs, Alterdata, Fortes)
  // Largura A4 padrão = 595.28 pt, Altura = 841.89 pt
  const scaleX = pWidth / 595.28;
  const scaleY = pHeight / 841.89;
  const baseX = 521.16 * scaleX;

  // Se o documento tiver altura de folha completa (>= 600 pt), costuma conter 2 vias (via da empresa e via do empregado)
  const slips = [];
  // Recibo Inferior (Via Principal / Recibo do Empregador)
  slips.push({
    centerY: 316.8 * scaleY,
    dateY: 178.0 * scaleY,
  });
  // Recibo Superior (Via do Empregado / Duplicata)
  if (pHeight >= 600) {
    slips.push({
      centerY: 678.5 * scaleY,
      dateY: 545.0 * scaleY,
    });
  }

  const nomeSignatario = docInfo.NomeFuncionario || "Colaborador";
  const dateStr = formatBrasiliaDateOnly(signInfo.DataHoraAssinatura) || "Data Registrada";
  const dateW = helveticaBold.widthOfTextAtSize(dateStr, 7.2);
  const nameLabel = sanitizeTextForPdf(nomeSignatario);
  const nameW = helveticaBold.widthOfTextAtSize(nameLabel, 6.2);

  // Decodifica rubrica manuscrita se enviada
  let rubricImg = null;
  if (rubricPngBytes && rubricPngBytes.length > 0) {
    try {
      rubricImg = await pdfDoc.embedPng(rubricPngBytes);
    } catch {
      rubricImg = null;
    }
  }

  const signSlotX = 517 * scaleX;
  const textSlotX = 514 * scaleX;

  for (const slip of slips) {
    // 1. Rubrica Manuscrita rotacionada 90° assentada no espaço reservado para assinatura
    if (rubricImg) {
      const maxW = 85; // comprimento ao longo da linha
      const maxH = 12; // altura perpendicular à linha (dentro do vão do canhoto, sem encavalar no texto)
      const scale = Math.min(maxW / rubricImg.width, maxH / rubricImg.height, 1);
      const drawW = rubricImg.width * scale;
      const drawH = rubricImg.height * scale;
      const drawX = signSlotX; // repousa no vão limpo, sem tocar em "Assinatura do Funcionário"
      const drawY = slip.centerY - drawW / 2;

      targetPage.drawImage(rubricImg, {
        x: drawX,
        y: drawY,
        width: drawW,
        height: drawH,
        rotate: degrees(90),
      });
    } else {
      // Fallback: se não houver rubrica gráfica, escreve o nome em itálico de forma limpa
      targetPage.drawText(nameLabel, {
        x: textSlotX,
        y: slip.centerY - nameW / 2,
        size: 7.5,
        font: helveticaOblique,
        color: rgb(0.08, 0.12, 0.35),
        rotate: degrees(90),
      });
    }

    // 2. Data carimbada diretamente sobre o campo "___/___/___ Data"
    targetPage.drawText(dateStr, {
      x: textSlotX,
      y: slip.dateY - dateW / 2,
      size: 7.0,
      font: helveticaBold,
      color: rgb(0.08, 0.12, 0.22),
      rotate: degrees(90),
    });
  }

  // 4. Faixa de Auditoria Pericial Minimalista no Rodapé da Página
  // Ultracompacta (12 pt), ocupando apenas a margem vazia inferior sem cobrir nenhum dado contábil
  const auditY = 4;
  const auditHeight = 12;
  const rawHash = docInfo.HashOriginalSHA256 || "";
  const displayHash = rawHash ? `${rawHash.slice(0, 24)}...` : "SHA-256 Registrado";
  const dtStr = formatBrasiliaDateTime(signInfo.DataHoraAssinatura);
  const ipStr = signInfo.EnderecoIP || "Dispositivo PWA";
  const valCode = signInfo.CodigoValidacao || "VAL";

  targetPage.drawRectangle({
    x: 25,
    y: auditY,
    width: pWidth - 50,
    height: auditHeight,
    color: rgb(0.97, 0.98, 1.0),
    borderColor: rgb(0.8, 0.85, 0.92),
    borderWidth: 0.5,
  });

  const auditLine = sanitizeTextForPdf(
    `ASSINATURA ELETRONICA AVANCADA (LEI 14.063/2020 E ART. 464 CLT) - VAL: ${valCode} - HASH SHA-256: ${displayHash} - DATA: ${dtStr} - IP: ${ipStr}`
  );
  targetPage.drawText(auditLine, {
    x: 32,
    y: auditY + 3.2,
    size: 5.2,
    font: helvetica,
    color: rgb(0.2, 0.25, 0.35),
  });
}

/**
 * Estampa a assinatura no fechamento formal de Termos Internos e Contratos (gerados dinamicamente)
 * Posiciona a rubrica LITERALMENTE sobre a linha oficial de assinatura ao final do texto.
 */
async function stampTextTermSignature({
  pdfDoc,
  targetPage,
  docInfo,
  signInfo,
  rubricPngBytes,
  startY,
}) {
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const nomeSignatario = docInfo.NomeFuncionario || "Colaborador";
  const cpfStr = docInfo.CPFFuncionario || "Nao informado";
  const dtStr = formatBrasiliaDateTime(signInfo.DataHoraAssinatura);
  const lojaStr = docInfo.NomeLoja || docInfo.LojaID || "Grupo House 190";

  let y = Math.min(startY || 350, 420);
  if (y < 160) y = 160;

  // 1. Data e formalização
  targetPage.drawText(
    sanitizeTextForPdf(`Documento formalizado e assinado eletronicamente em ${dtStr} (Horario de Brasilia).`),
    {
      x: 55,
      y: y,
      size: 8.5,
      font: fontOblique,
      color: rgb(0.35, 0.4, 0.5),
    }
  );

  y -= 45; // Espaço para a rubrica manuscrita

  // 2. Linha oficial de assinatura
  const lineStartX = 75;
  const lineEndX = 395;
  const lineWidth = lineEndX - lineStartX;
  targetPage.drawLine({
    start: { x: lineStartX, y: y },
    end: { x: lineEndX, y: y },
    thickness: 0.8,
    color: rgb(0.25, 0.3, 0.4),
  });

  // 3. Rubrica manuscrita estampada LITERALMENTE em cima da linha
  let rubricDrawn = false;
  if (rubricPngBytes && rubricPngBytes.length > 0) {
    try {
      const rubricImg = await pdfDoc.embedPng(rubricPngBytes);
      const maxW = 160;
      const maxH = 40;
      const scale = Math.min(maxW / rubricImg.width, maxH / rubricImg.height, 1);
      const drawW = rubricImg.width * scale;
      const drawH = rubricImg.height * scale;
      const drawX = lineStartX + (lineWidth - drawW) / 2;
      const drawY = y + 2; // descansa diretamente em cima da linha

      targetPage.drawImage(rubricImg, {
        x: drawX,
        y: drawY,
        width: drawW,
        height: drawH,
      });
      rubricDrawn = true;
    } catch {}
  }

  if (!rubricDrawn) {
    targetPage.drawText(sanitizeTextForPdf(nomeSignatario), {
      x: lineStartX + 20,
      y: y + 5,
      size: 11,
      font: fontOblique,
      color: rgb(0.08, 0.12, 0.35),
    });
  }

  // 4. Identificação sob a linha
  targetPage.drawText(sanitizeTextForPdf(`${nomeSignatario}  —  CPF: ${cpfStr}`), {
    x: lineStartX + 10,
    y: y - 12,
    size: 8.5,
    font: fontBold,
    color: rgb(0.08, 0.12, 0.22),
  });

  targetPage.drawText(sanitizeTextForPdf(`Colaborador(a) / Titular  —  ${lojaStr}`), {
    x: lineStartX + 10,
    y: y - 22,
    size: 7.5,
    font: font,
    color: rgb(0.35, 0.42, 0.52),
  });

  // 5. Card de Validade Jurídica e Criptografia (Lei 14.063/2020)
  const cardY = y - 62;
  targetPage.drawRectangle({
    x: 55,
    y: cardY,
    width: 485,
    height: 32,
    color: rgb(0.985, 0.99, 1.0),
    borderColor: rgb(0.75, 0.82, 0.92),
    borderWidth: 0.6,
  });

  const rawHash = docInfo.HashOriginalSHA256 || "";
  const displayHash = rawHash ? `${rawHash.slice(0, 36)}...` : "SHA-256 Registrado";
  const valCode = signInfo.CodigoValidacao || "VAL";
  const ipStr = signInfo.EnderecoIP || "Dispositivo PWA";
  const dispStr = (signInfo.DispositivoInfo || "Navegador").slice(0, 35);

  targetPage.drawText(
    sanitizeTextForPdf(`ASSINATURA ELETRONICA AVANCADA (LEI 14.063/2020)  •  CODIGO: ${valCode}`),
    {
      x: 65,
      y: cardY + 19,
      size: 7.2,
      font: fontBold,
      color: rgb(0.08, 0.12, 0.3),
    }
  );

  targetPage.drawText(
    sanitizeTextForPdf(`Hash SHA-256: ${displayHash}  |  IP: ${ipStr}  |  Dispositivo: ${dispStr}`),
    {
      x: 65,
      y: cardY + 7,
      size: 6.2,
      font: font,
      color: rgb(0.25, 0.32, 0.44),
    }
  );
}

/**
 * Estampa a assinatura para PDFs avulsos/genéricos que não sejam holerites
 */
async function stampGeneralDocumentSignature({
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
  const boxHeight = 60;
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

  // 2. Faixa superior
  targetPage.drawRectangle({
    x: boxX,
    y: boxY + boxHeight - 14,
    width: boxWidth,
    height: 14,
    color: rgb(0.08, 0.12, 0.22),
  });

  const headerLeft = "ASSINATURA ELETRONICA AVANCADA - LEI No 14.063/2020 E ART. 464 CLT";
  targetPage.drawText(headerLeft, {
    x: boxX + 8,
    y: boxY + boxHeight - 10,
    size: 6.2,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  const valCodeStr = `VALIDADOR: ${signInfo.CodigoValidacao || "VAL"}`;
  const valWidth = helveticaBold.widthOfTextAtSize(valCodeStr, 6.2);
  targetPage.drawText(sanitizeTextForPdf(valCodeStr), {
    x: boxX + boxWidth - 8 - valWidth,
    y: boxY + boxHeight - 10,
    size: 6.2,
    font: helveticaBold,
    color: rgb(0.68, 0.8, 0.98),
  });

  // 3. Divisória vertical
  targetPage.drawLine({
    start: { x: splitX, y: boxY + 2 },
    end: { x: splitX, y: boxY + boxHeight - 14 },
    thickness: 0.6,
    color: rgb(0.8, 0.85, 0.92),
  });

  // 4. Lado Esquerdo: Rubrica Manuscrita
  let rubricDrawn = false;
  if (rubricPngBytes && rubricPngBytes.length > 0) {
    try {
      const rubricImg = await pdfDoc.embedPng(rubricPngBytes);
      const maxImgW = splitX - boxX - 30;
      const maxImgH = 28;
      const imgScale = Math.min(maxImgW / rubricImg.width, maxImgH / rubricImg.height, 1);
      const drawW = rubricImg.width * imgScale;
      const drawH = rubricImg.height * imgScale;
      const drawX = boxX + 15 + (maxImgW - drawW) / 2;
      const drawY = boxY + 14 + (maxImgH - drawH) / 2;

      targetPage.drawImage(rubricImg, {
        x: drawX,
        y: drawY,
        width: drawW,
        height: drawH,
      });
      rubricDrawn = true;
    } catch {}
  }

  if (!rubricDrawn) {
    targetPage.drawText("[Rubrica registrada digitalmente]", {
      x: boxX + 18,
      y: boxY + 22,
      size: 7,
      font: helvetica,
      color: rgb(0.35, 0.4, 0.5),
    });
  }

  targetPage.drawLine({
    start: { x: boxX + 15, y: boxY + 12 },
    end: { x: splitX - 15, y: boxY + 12 },
    thickness: 0.5,
    color: rgb(0.6, 0.65, 0.75),
  });

  const nomeSignatario = docInfo.NomeFuncionario || "Colaborador";
  targetPage.drawText(
    sanitizeTextForPdf(`Assinatura de ${nomeSignatario}`),
    {
      x: boxX + 15,
      y: boxY + 4,
      size: 5.8,
      font: helveticaOblique,
      color: rgb(0.3, 0.35, 0.45),
    },
  );

  // 5. Lado Direito: Evidências Técnicas
  const cpfStr = docInfo.CPFFuncionario || "Nao informado";
  targetPage.drawText(
    sanitizeTextForPdf(`Signatario: ${nomeSignatario}  -  CPF: ${cpfStr}`),
    {
      x: splitX + 10,
      y: boxY + 32,
      size: 6.8,
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
      y: boxY + 22,
      size: 5.8,
      font: helvetica,
      color: rgb(0.2, 0.26, 0.36),
    },
  );

  const rawHash = docInfo.HashOriginalSHA256 || "";
  const displayHash = rawHash ? `${rawHash.slice(0, 32)}...` : "SHA-256 Registrado";
  targetPage.drawText(
    sanitizeTextForPdf(`Hash SHA-256: ${displayHash}`),
    {
      x: splitX + 10,
      y: boxY + 12,
      size: 5.5,
      font: helvetica,
      color: rgb(0.1, 0.45, 0.22),
    },
  );
}

/**
 * Estampa o selo pericial de assinatura diretamente na folha do documento
 * Sem gerar página avulsa/separada, garantindo conformidade com a Lei 14.063/2020 e Art. 464 CLT.
 */
export async function stampSignatureDirectly({
  pdfDoc,
  targetPage,
  docInfo,
  signInfo,
  rubricPngBytes,
}) {
  const isHolerite =
    docInfo.Tipo === "Holerite" ||
    /holerite|contracheque|recibo\s*de\s*pagamento/i.test(docInfo.Titulo || "") ||
    /holerite|contracheque/i.test(docInfo.Descricao || "");

  if (isHolerite) {
    return await stampHoleriteVerticalStub({
      pdfDoc,
      targetPage,
      docInfo,
      signInfo,
      rubricPngBytes,
    });
  }

  return await stampGeneralDocumentSignature({
    pdfDoc,
    targetPage,
    docInfo,
    signInfo,
    rubricPngBytes,
  });
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
      if (textY < 200) break;
    }

    // Estampa a assinatura no fechamento formal do termo, diretamente sobre a linha oficial
    await stampTextTermSignature({
      pdfDoc,
      targetPage: docPage,
      docInfo,
      signInfo,
      rubricPngBytes,
      startY: textY - 20,
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
 * Converte Uint8Array para string de forma segura tanto no browser quanto no Node.js
 */
export function uint8ArrayToString(u8) {
  if (typeof TextDecoder !== "undefined") {
    try {
      return new TextDecoder("latin1").decode(u8);
    } catch {}
  }
  let str = "";
  for (let i = 0; i < u8.length; i++) {
    str += String.fromCharCode(u8[i]);
  }
  return str;
}

/**
 * Decodificador de ToUnicode CMap em arquivos PDF contábeis
 */
export function parsePdfCMap(cmapStr) {
  const map = new Map();
  if (!cmapStr) return map;

  // 1. beginbfchar ... endbfchar
  const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let match;
  while ((match = bfcharRegex.exec(cmapStr)) !== null) {
    const lines = match[1].trim().split(/\s+/);
    for (let i = 0; i < lines.length; i += 2) {
      if (lines[i] && lines[i + 1]) {
        const src = lines[i].replace(/[<>]/g, "");
        const dst = lines[i + 1].replace(/[<>]/g, "");
        map.set(src.toUpperCase(), String.fromCharCode(parseInt(dst, 16)));
      }
    }
  }

  // 2. beginbfrange ... endbfrange
  const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((match = bfrangeRegex.exec(cmapStr)) !== null) {
    const block = match[1].trim();
    const tokens = block.match(/<[^>]+>|\[[^\]]+\]/g) || [];
    let i = 0;
    while (i < tokens.length) {
      const startHex = tokens[i++]?.replace(/[<>]/g, "");
      const endHex = tokens[i++]?.replace(/[<>]/g, "");
      const destToken = tokens[i++];
      if (!startHex || !endHex || !destToken) break;
      const start = parseInt(startHex, 16);
      const end = parseInt(endHex, 16);
      if (destToken.startsWith("[")) {
        const arr = destToken.replace(/[\[\]]/g, "").trim().split(/\s+/);
        for (let code = start; code <= end; code++) {
          const idx = code - start;
          if (arr[idx]) {
            const h = code.toString(16).padStart(startHex.length, "0").toUpperCase();
            map.set(h, String.fromCharCode(parseInt(arr[idx].replace(/[<>]/g, ""), 16)));
          }
        }
      } else {
        const destStart = parseInt(destToken.replace(/[<>]/g, ""), 16);
        for (let code = start; code <= end; code++) {
          const h = code.toString(16).padStart(startHex.length, "0").toUpperCase();
          map.set(h, String.fromCharCode(destStart + (code - start)));
        }
      }
    }
  }
  return map;
}

/**
 * Decodifica sequência hexadecimal de glifos utilizando mapa ToUnicode ou padrão Latin-1
 */
export function decodeHexWithMap(hex, map) {
  let str = "";
  if (map && map.size > 0) {
    for (let i = 0; i < hex.length; i += 4) {
      const chHex = hex.slice(i, i + 4).toUpperCase();
      str += map.get(chHex) || (map.get(chHex.slice(2)) || "");
    }
  } else {
    for (let i = 0; i < hex.length; i += 2) {
      const code = parseInt(hex.slice(i, i + 2), 16);
      if (!isNaN(code)) str += String.fromCharCode(code);
    }
  }
  return str;
}

/**
 * Extrai texto bruto de uma página PDF com suporte nativo a fontes subset e CMaps
 */
export function extractTextFromPdfPage(page, pdfDoc) {
  const resources = page.node.Resources();
  if (!resources) return "";
  const fontDict = resources.lookup(PDFName.of("Font"));
  const fontMaps = {};

  if (fontDict && fontDict.entries) {
    for (const [fontKeyRef, fontObjRef] of fontDict.entries()) {
      const fontName = fontKeyRef.asString();
      const fontObj = pdfDoc.context.lookup(fontObjRef);
      if (!fontObj) continue;
      const toUnicodeRef = fontObj.get(PDFName.of("ToUnicode"));
      if (toUnicodeRef) {
        try {
          const stream = pdfDoc.context.lookup(toUnicodeRef);
          if (stream && (typeof stream.getContents === "function" || stream.contents)) {
            const decoded = decodePDFRawStream(stream).decode();
            const cmapStr = uint8ArrayToString(decoded);
            fontMaps[fontName] = parsePdfCMap(cmapStr);
          }
        } catch {}
      }
    }
  }

  const contentsRef = page.node.get(PDFName.of("Contents"));
  if (!contentsRef) return "";

  let contentStr = "";
  const contentsObj = pdfDoc.context.lookup(contentsRef);
  const rawStreams = [];

  if (contentsObj instanceof PDFArray || typeof contentsObj?.size === "function") {
    for (let i = 0; i < contentsObj.size(); i++) {
      try {
        const item = pdfDoc.context.lookup(contentsObj.get(i));
        if (item) rawStreams.push(item);
      } catch {}
    }
  } else if (Array.isArray(contentsObj)) {
    for (const item of contentsObj) {
      try {
        const s = pdfDoc.context.lookup(item);
        if (s) rawStreams.push(s);
      } catch {}
    }
  } else if (contentsObj) {
    rawStreams.push(contentsObj);
  }

  for (const s of rawStreams) {
    try {
      if (typeof s?.getContents === "function" || s?.contents) {
        const dec = decodePDFRawStream(s).decode();
        contentStr += uint8ArrayToString(dec) + "\n";
      }
    } catch (err) {
      console.warn("[documents] Falha ao decodificar stream:", err);
    }
  }

  let currentFont = "";
  const lines = [];
  let currentLine = "";

  const tokenRegex = /\/F\w+|\[[\s\S]*?\]\s*TJ|<[0-9a-fA-F]+>\s*Tj|\([^\)]*\)\s*Tj|ET|T\*/g;
  let m;
  while ((m = tokenRegex.exec(contentStr)) !== null) {
    const tok = m[0];
    if (tok.startsWith("/F")) {
      currentFont = tok;
    } else if (tok === "T*" || tok === "ET") {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = "";
    } else if (tok.endsWith("Tj")) {
      const map = fontMaps[currentFont];
      if (tok.startsWith("<")) {
        const hex = tok.slice(1, tok.indexOf(">"));
        currentLine += decodeHexWithMap(hex, map);
      } else if (tok.startsWith("(")) {
        currentLine += tok.slice(1, tok.lastIndexOf(")"));
      }
    } else if (tok.endsWith("TJ")) {
      const map = fontMaps[currentFont];
      const inner = tok.slice(1, tok.lastIndexOf("]"));
      const hexParts = inner.match(/<[0-9a-fA-F]+>|\([^\)]*\)/g) || [];
      for (const part of hexParts) {
        if (part.startsWith("<")) {
          const hex = part.slice(1, -1);
          currentLine += decodeHexWithMap(hex, map);
        } else if (part.startsWith("(")) {
          currentLine += part.slice(1, -1);
        }
      }
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines.join("\n");
}

/**
 * Limpa artefatos do texto extraído para isolar o nome do colaborador
 */
export function cleanExtractedName(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/^.*?código[\s:]*/i, "");
  s = s.replace(/\s*(nome do funcion[aá]rio|cbo|departamento|filial).*$/i, "");
  s = s.replace(/^\d+\s*/, "").replace(/\s*\d+$/, "");
  return s.trim();
}

/**
 * Analisa o texto do holerite extraindo Nome, Mês de Referência, Código Contábil e Cargo/CBO
 */
export function parsePayrollDataFromText(fullText) {
  let employeeName = "";
  const nameMatch =
    fullText.match(/([A-ZÀ-Ú\s]{3,})Nome do Funcionário/i) ||
    fullText.match(/Nome do Funcionário[\s:]*([A-ZÀ-Ú\s]{3,})/i) ||
    fullText.match(/Empregado:?\s*([A-ZÀ-Ú\s]{3,})/i) ||
    fullText.match(/Funcionário:?\s*([A-ZÀ-Ú\s]{3,})/i);

  if (nameMatch) {
    employeeName = cleanExtractedName(nameMatch[1]);
  }

  let referenceMonth = "";
  const monthMatch = fullText.match(
    /(Janeiro|Fevereiro|Março|Marco|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s+de\s+(\d{4})/i,
  );
  if (monthMatch) {
    const months = {
      janeiro: "01",
      fevereiro: "02",
      março: "03",
      marco: "03",
      abril: "04",
      maio: "05",
      junho: "06",
      julho: "07",
      agosto: "08",
      setembro: "09",
      outubro: "10",
      novembro: "11",
      dezembro: "12",
    };
    const mNum = months[monthMatch[1].toLowerCase()];
    referenceMonth = `${monthMatch[2]}-${mNum}`;
  } else {
    const dateMatch = fullText.match(/\b(0[1-9]|1[0-2])\/(\d{4})\b/);
    if (dateMatch) {
      referenceMonth = `${dateMatch[2]}-${dateMatch[1]}`;
    }
  }

  let employeeCode = "";
  const codeMatch = fullText.match(/(\d+)Código/i) || fullText.match(/Código[:\s]+(\d+)/i);
  if (codeMatch) employeeCode = codeMatch[1].trim();

  let cbo = "";
  const cboMatch = fullText.match(/CBO\s*(\d+)/i) || fullText.match(/(\d{4,6})\s*Departamento/i);
  if (cboMatch) cbo = cboMatch[1].trim();

  return { employeeName, referenceMonth, employeeCode, cbo };
}

/**
 * Normaliza string para comparação fonética/alfanumérica de nomes de funcionários
 */
export function normalizeNameForMatching(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Localiza o funcionário correspondente no cadastro do sistema
 */
export function findBestEmployeeMatch(cleanedName, employees = []) {
  if (!cleanedName || !Array.isArray(employees) || employees.length === 0) return null;
  const normClean = normalizeNameForMatching(cleanedName);
  if (!normClean) return null;

  // 1. Coincidência exata do nome normalizado
  const exact = employees.find((e) => normalizeNameForMatching(e.Nome || e.NomeFuncionario) === normClean);
  if (exact) return exact;

  // 2. Coincidência por substring (nome completo vs nome sem sobrenome do meio)
  const sub = employees.find((e) => {
    const eNorm = normalizeNameForMatching(e.Nome || e.NomeFuncionario);
    return eNorm.includes(normClean) || normClean.includes(eNorm);
  });
  if (sub) return sub;

  // 3. Coincidência pelo primeiro e último nome
  const cleanTokens = normClean.split(" ").filter((t) => t.length >= 2);
  if (cleanTokens.length >= 2) {
    const first = cleanTokens[0];
    const last = cleanTokens[cleanTokens.length - 1];
    const tokenMatch = employees.find((e) => {
      const eNorm = normalizeNameForMatching(e.Nome || e.NomeFuncionario);
      const eTokens = eNorm.split(" ").filter((t) => t.length >= 2);
      if (eTokens.length < 2) return false;
      return eTokens[0] === first && eTokens[eTokens.length - 1] === last;
    });
    if (tokenMatch) return tokenMatch;
  }

  return null;
}

/**
 * Formata mês de referência no padrão Legível (Ex: 2026-09 -> Setembro/2026)
 */
export function formatMonthLabel(monthStr) {
  if (!monthStr) return "";
  const match = String(monthStr).match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const months = [
      "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
    ];
    const mIdx = parseInt(match[2], 10) - 1;
    if (mIdx >= 0 && mIdx < 12) {
      return `${months[mIdx]}/${match[1]}`;
    }
  }
  return String(monthStr);
}

/**
 * Processa PDF agrupado em lote:
 * 1. Separa cada página em um PDF individual isolado de 1 folha
 * 2. Extrai Nome do Colaborador, Código, Mês de Referência e CBO
 * 3. Identifica e vincula o colaborador e seu CPF automaticamente no cadastro
 * 4. Gera hash SHA-256 e payload Base64 para cada holerite individual
 */
export async function parseBatchPayrollPdf(pdfBytesOrBase64, employees = [], stores = []) {
  let bytes;
  if (typeof pdfBytesOrBase64 === "string") {
    bytes = base64ToUint8Array(pdfBytesOrBase64);
  } else if (pdfBytesOrBase64 instanceof ArrayBuffer) {
    bytes = new Uint8Array(pdfBytesOrBase64);
  } else if (pdfBytesOrBase64 instanceof Uint8Array) {
    bytes = pdfBytesOrBase64;
  } else {
    throw new Error("Formato de arquivo PDF inválido para processamento em lote.");
  }

  const batchDoc = await PDFDocument.load(bytes);
  const totalPages = batchDoc.getPageCount();
  const parsedItems = [];

  for (let i = 0; i < totalPages; i++) {
    const page = batchDoc.getPage(i);
    const text = extractTextFromPdfPage(page, batchDoc);
    const data = parsePayrollDataFromText(text);

    const cleanedName = cleanExtractedName(data.employeeName);
    const matchedEmp = findBestEmployeeMatch(cleanedName, employees);

    // Cria documento de 1 única página isolada
    const singleDoc = await PDFDocument.create();
    const [copiedPage] = await singleDoc.copyPages(batchDoc, [i]);
    singleDoc.addPage(copiedPage);
    const singleBytes = await singleDoc.save();
    const singleBase64 = uint8ArrayToBase64(singleBytes);
    const singleHash = await sha256Hex(singleBytes);

    const empIdVal = matchedEmp ? String(matchedEmp.FuncionarioID || matchedEmp.id || "").trim() : "";
    const empNome = matchedEmp ? String(matchedEmp.Nome || cleanedName).trim() : cleanedName;
    const empCpf = matchedEmp ? String(matchedEmp.CPF || "").trim() : "";
    const empCargo = matchedEmp ? String(matchedEmp.Cargo || data.cbo || "").trim() : data.cbo;
    const lojaIdVal = matchedEmp ? String(matchedEmp.LojaID || "").trim() : (stores[0]?.LojaID || "");
    const targetStore = stores.find((s) => String(s.LojaID || s.id || "").trim() === String(lojaIdVal).trim());
    const nomeLoja = targetStore ? String(targetStore.NomeLoja || targetStore.nomeLoja || targetStore.Nome || "").trim() : "";

    const refMonth = data.referenceMonth || "";
    const title = `Holerite — ${formatMonthLabel(refMonth) || "Mensal"}`;

    parsedItems.push({
      pageNumber: i + 1,
      extractedName: cleanedName,
      rawExtractedName: data.employeeName,
      extractedCode: data.employeeCode,
      extractedCbo: data.cbo,
      extractedMonth: refMonth,
      matched: Boolean(matchedEmp),
      FuncionarioID: empIdVal,
      NomeFuncionario: empNome,
      CPFFuncionario: empCpf,
      CargoFuncionario: empCargo,
      LojaID: lojaIdVal,
      NomeLoja: nomeLoja,
      MesReferencia: refMonth,
      Titulo: title,
      Tipo: "Holerite",
      ArquivoOriginalBase64: singleBase64,
      HashOriginalSHA256: singleHash,
    });
  }

  return {
    totalPages,
    parsedItems,
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

      // Otimização de performance: remove os pesados arquivos Base64 da listagem geral,
      // economizando até 95% de tráfego de dados. O arquivo completo é obtido pontualmente via documentsGet.
      const lightDocuments = filtered.map((doc) => {
        const { ArquivoOriginalBase64, ArquivoFinalBase64, ...rest } = doc;
        return {
          ...rest,
          temArquivoOriginal: Boolean(ArquivoOriginalBase64),
          temArquivoFinal: Boolean(ArquivoFinalBase64),
        };
      });

      return {
        success: true,
        message: "",
        data: {
          documents: lightDocuments,
          pendingCount,
          signedCount,
          totalCount: lightDocuments.length,
        },
        documents: lightDocuments,
        pendingCount,
        signedCount,
        totalCount: lightDocuments.length,
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
     * Importação e Distribuição de Holerites em Lote (RH / Gerente / Admin)
     */
    async documentsBatchCreate(args) {
      const [items] = args || [];
      assert(Array.isArray(items) && items.length > 0, "Lista de documentos para importação em lote é obrigatória.");

      const profile = await runtime.requireProfile();
      assert(
        isAdmin(profile) || isManager(profile),
        "Apenas gerentes e administradores podem importar lotes de documentos.",
      );

      const employees = await runtime.list("Funcionarios", { profile }).catch(() => []);
      const stores = await runtime.list("Lojas", { profile }).catch(() => []);

      const createdDocs = [];
      const errors = [];

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        try {
          assert(item.FuncionarioID, `Colaborador não vinculado para a página ${item.pageNumber || idx + 1}.`);
          assert(item.ArquivoOriginalBase64, `PDF individual não gerado para a página ${item.pageNumber || idx + 1}.`);

          const targetEmp = employees.find(
            (e) => String(e.FuncionarioID || e.id || e.Funcionario || "").trim() === String(item.FuncionarioID).trim(),
          );

          const empIdVal = String(targetEmp?.FuncionarioID || item.FuncionarioID).trim();
          const empNome = String(targetEmp?.Nome || item.NomeFuncionario || "Colaborador").trim();
          const empCpf = String(targetEmp?.CPF || item.CPFFuncionario || "").trim();
          const empCargo = String(targetEmp?.Cargo || item.CargoFuncionario || "").trim();
          const lojaIdVal = String(targetEmp?.LojaID || item.LojaID || profile.LojaID || "").trim();

          const targetStore = stores.find(
            (s) => String(s.LojaID || s.id || s.Loja || "").trim() === lojaIdVal,
          );

          const docId = `DOC_${Date.now()}_${uuid().slice(0, 6)}_${idx + 1}`;
          let hashOriginal = String(item.HashOriginalSHA256 || "").trim();
          if (!hashOriginal) {
            hashOriginal = await sha256Hex(item.ArquivoOriginalBase64);
          }

          const record = {
            DocumentoID: docId,
            DocID: docId,
            Titulo: String(item.Titulo || `Holerite — ${item.MesReferencia || ""}`).trim(),
            Tipo: String(item.Tipo || "Holerite").trim(),
            Descricao: String(item.Descricao || `Importação de lote contábil (Pág. ${item.pageNumber || idx + 1})`).trim(),
            FuncionarioID: empIdVal,
            NomeFuncionario: empNome,
            CPFFuncionario: empCpf,
            CargoFuncionario: empCargo,
            LojaID: lojaIdVal,
            NomeLoja: String(targetStore?.NomeLoja || targetStore?.nomeLoja || targetStore?.Nome || item.NomeLoja || "").trim(),
            MesReferencia: String(item.MesReferencia || "").trim(),
            Status: "Pendente",
            OrigemTipo: "PDF_IMPORTADO",
            ConteudoTexto: "",
            ArquivoOriginalBase64: item.ArquivoOriginalBase64,
            HashOriginalSHA256: hashOriginal,
            DataEnvio: nowIso(),
            CriadoPor: String(profile.Email || profile.Nome || "Gestão").trim(),
          };

          const saved = await runtime.create("Documentos", record);
          createdDocs.push(saved);

          // Notificação individual para cada colaborador
          try {
            await createNotification({
              employeeId: record.FuncionarioID,
              storeId: record.LojaID,
              type: "Documentos",
              subject: "Novo Holerite Disponível para Assinatura",
              message: `Seu holerite de ${record.MesReferencia || "referência"} está disponível para assinatura eletrônica.`,
              relatedId: record.DocumentoID,
            });
          } catch (notifyErr) {
            console.warn("[documents] Falha ao notificar funcionário do lote:", notifyErr);
          }
        } catch (itemErr) {
          errors.push({ pageNumber: item.pageNumber || idx + 1, error: itemErr.message });
        }
      }

      assert(createdDocs.length > 0, `Nenhum documento pôde ser importado: ${errors.map((e) => e.error).join(", ")}`);

      return {
        success: true,
        message: `${createdDocs.length} holerite(s) importado(s) e disponibilizado(s) com sucesso.`,
        data: {
          createdCount: createdDocs.length,
          documents: createdDocs,
          errors,
        },
        createdCount: createdDocs.length,
        documents: createdDocs,
        errors,
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

    /**
     * Lista modelos de documentos de RH disponíveis
     */
    async documentsTemplatesList() {
      const templates = [
        {
          id: "TERMO_LGPD",
          titulo: "Termo de Confidencialidade e Proteção de Dados (LGPD)",
          categoria: "Termos",
          descricao: "Declaração de sigilo e respeito às normas de proteção de dados pessoais dos clientes e da empresa.",
        },
        {
          id: "ACORDO_BANCO_HORAS",
          titulo: "Acordo Individual de Compensação de Horas (Portaria 671 MTE)",
          categoria: "Contratos",
          descricao: "Instituição de regime de prorrogação e banco de horas compensatório com controle eletrônico.",
        },
        {
          id: "FICHA_EPI_UNIFORME",
          titulo: "Termo de Entrega e Responsabilidade de EPI e Uniforme",
          categoria: "Termos",
          descricao: "Registro formal de fornecimento e compromisso de uso e conservação de equipamentos de proteção individual.",
        },
        {
          id: "ADVERTENCIA_DISCIPLINAR",
          titulo: "Notificação de Advertência Disciplinar Operacional",
          categoria: "Advertências",
          descricao: "Comunicação formal disciplinar com relato de fatos e ciência das normas internas da House 190.",
        },
      ];
      return success({ templates });
    },

    /**
     * Gera documento a partir de template oficial para um funcionário
     */
    async documentsGenerateFromTemplate(args) {
      const [payload] = args || [];
      assert(payload && typeof payload === "object", "Dados para geração do documento são obrigatórios.");

      const templateId = String(payload.templateId || "").trim();
      assert(templateId, "Identificador do modelo é obrigatório.");

      const funcionarioId = String(payload.funcionarioId || "").trim();
      assert(funcionarioId, "Selecione o funcionário destinatário.");

      const profile = await runtime.requireProfile();
      assert(
        isAdmin(profile) || isManager(profile),
        "Apenas gestores e administradores podem emitir novos documentos de RH.",
      );

      const emp = await runtime.getById("Funcionarios", funcionarioId);
      assert(emp, "Funcionário não encontrado.");

      let titulo = "";
      let categoria = "Termos";
      let texto = "";
      const hoje = formatBrasiliaDateOnly(nowIso());
      const nomeEmp = emp.Nome || "Colaborador";
      const cpfEmp = emp.CPF || "Não informado";
      const cargoEmp = emp.Cargo || "Colaborador Operacional";
      const lojaNome = emp.NomeLoja || emp.LojaID || "Grupo House 190";

      if (templateId === "TERMO_LGPD") {
        titulo = `Termo LGPD e Sigilo - ${nomeEmp}`;
        categoria = "Termos";
        texto = `TERMO DE COMPROMISSO, CONFIDENCIALIDADE E PROTEÇÃO DE DADOS (LGPD)

Pelo presente instrumento particular, de um lado GRUPO HOUSE 190, e de outro lado o(a) colaborador(a) ${nomeEmp}, inscrito(a) no CPF sob o nº ${cpfEmp}, ocupante do cargo de ${cargoEmp}, vinculado(a) à unidade ${lojaNome}.

CLÁUSULA PRIMEIRA - O(A) COLABORADOR(A) se compromete a manter em absoluto sigilo e confidencialidade todas as informações, dados cadastrais de clientes, receitas, procedimentos operacionais, estratégias e dados sensíveis a que tiver acesso em razão de suas funções.

CLÁUSULA SEGUNDA - Em conformidade com a Lei Federal nº 13.709/2018 (Lei Geral de Proteção de Dados - LGPD), o(a) empregado(a) declara estar ciente de que é expressamente proibido compartilhar, copiar ou vazar dados internos ou de terceiros sob pena de justa causa e responsabilidade civil/criminal.

CLÁUSULA TERCEIRA - O presente compromisso vigorará durante todo o contrato de trabalho e permanecerá válido mesmo após a rescisão contratual.

Local e Data: ${lojaNome}, ${hoje}.`;
      } else if (templateId === "ACORDO_BANCO_HORAS") {
        titulo = `Acordo de Compensação de Horas - ${nomeEmp}`;
        categoria = "Contratos";
        texto = `ACORDO INDIVIDUAL DE PRORROGAÇÃO E COMPENSAÇÃO DE HORAS DE TRABALHO
(Conforme Art. 59 da CLT e Portaria MTE 671/2021)

EMPREGADOR: GRUPO HOUSE 190
EMPREGADO(A): ${nomeEmp} | CPF: ${cpfEmp} | CARGO: ${cargoEmp} | UNIDADE: ${lojaNome}

1. Fica convencionado entre as partes o regime de compensação horária na modalidade de Banco de Horas, facultando a prorrogação da jornada normal de trabalho até o limite legal, com compensação oportuna.

2. O registro e apuração das horas cumpridas ocorrerão integralmente através do sistema eletrônico de ponto CozinhaFlow, com selfie e geolocalização.

3. As horas extraordinárias prestadas serão inseridas no saldo positivo de banco de horas para futura concessão de folgas compensatórias ou acerto nos prazos previstos na legislação vigente.

E, por estarem plenamente de acordo, assinam digitalmente o presente instrumento.

Data: ${hoje}.`;
      } else if (templateId === "FICHA_EPI_UNIFORME") {
        titulo = `Termo de Entrega de EPI e Uniforme - ${nomeEmp}`;
        categoria = "Termos";
        texto = `TERMO DE RECEBIMENTO E RESPONSABILIDADE DE EQUIPAMENTOS E UNIFORME

Eu, ${nomeEmp}, CPF ${cpfEmp}, função ${cargoEmp}, lotado(a) na unidade ${lojaNome}, declaro ter recebido do GRUPO HOUSE 190, em perfeito estado de conservação e uso, os seguintes itens de uniforme e proteção individual necessários para o exercício de minhas atividades:

- 02 Camisetas oficiais de trabalho House 190;
- 01 Avental de cozinha / salão;
- Itens de EPI compatíveis com a função (touca protetora, luvas térmicas e calçado antiderrapante quando aplicável).

Comprometo-me a zelar pela conservação, higiene e uso obrigatório destes materiais durante toda a minha jornada, comunicando imediatamente à gerência qualquer avaria ou necessidade de substituição.

Data de recebimento: ${hoje}.`;
      } else if (templateId === "ADVERTENCIA_DISCIPLINAR") {
        titulo = `Advertência Disciplinar - ${nomeEmp}`;
        categoria = "Advertências";
        const motivo = payload.motivo || "Descumprimento das normas operacionais e regulamento interno da empresa.";
        texto = `COMUNICAÇÃO DE ADVERTÊNCIA DISCIPLINAR

A(O) Colaborador(a): ${nomeEmp} | CPF: ${cpfEmp}
Cargo: ${cargoEmp} | Lotação: ${lojaNome}

Vimos por meio desta aplicar-lhe ADVERTÊNCIA DISCIPLINAR formal pelo seguinte motivo:
${motivo}

Esclarecemos que a reiteração em condutas semelhantes ensejará a aplicação de penalidades mais severas previstas na Consolidação das Leis do Trabalho (CLT), inclusive suspensão disciplinar e rescisão por justa causa (Art. 482 da CLT).

Esperamos que a presente medida sirva para reorientar sua postura profissional e manter a excelência operacional de nossa equipe.

Data de emissão: ${hoje}.`;
      } else {
        throw new Error("Modelo não reconhecido.");
      }

      const docId = `DOC_${Date.now()}_${uuid().slice(0, 6)}`;
      const hashOriginal = await sha256Hex(texto);

      const novoDocumento = {
        DocID: docId,
        DocumentoID: docId,
        Titulo: titulo,
        Categoria: categoria,
        Descricao: `Documento gerado a partir do modelo ${templateId}`,
        LojaID: emp.LojaID || profile.LojaID || "GERAL",
        FuncionarioID: funcionarioId,
        NomeFuncionario: nomeEmp,
        CPFFuncionario: cpfEmp,
        Status: "Pendente",
        Tipo: "DOCUMENTO_RH",
        Origem: "TEMPLATE",
        TemplateID: templateId,
        ConteudoTexto: texto,
        HashOriginalSHA256: hashOriginal,
        DataCriacao: nowIso(),
        CriadoPorID: profile.FuncionarioID || profile.uid || "ADMIN",
        CriadoPorNome: profile.Nome || "RH House 190",
      };

      await runtime.create("Documentos", novoDocumento);

      try {
        await createNotification({
          storeId: emp.LojaID || "",
          type: "Documentos",
          subject: "Novo Documento para Assinatura",
          message: `${nomeEmp}, você possui um novo documento pendente de assinatura digital: "${titulo}".`,
          relatedId: docId,
        });
      } catch (_) {}

      return success({
        documento: novoDocumento,
        mensagem: "Documento gerado com sucesso a partir do modelo e disponibilizado para assinatura.",
      });
    },
  };
}
