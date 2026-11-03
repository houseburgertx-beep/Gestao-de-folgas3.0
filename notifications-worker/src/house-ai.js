import {runGroqConversation} from "./wa-chat.js";
import { createWhatsAppConversationStore, isConversationFollowUp, resolveConversationFollowUp } from "./wa-conversation.js";
import { active, bahiaDay, scheduleForDay, workday } from "../../src/core/reminder-policy.js";
/**
 * HOUSE AI 2.0 — Cérebro Operacional Central do Grupo House 190 para WhatsApp
 * Extensão conversacional oficial do sistema Gestão de Folgas & CozinhaFlow
 * 
 * Regras Inegociáveis:
 * 1. ZERO EMOJIS: Estritamente proibido o uso de emojis nas respostas operacionais.
 * 2. PORTARIA 671/MTE: Estritamente proibido registrar ponto via mensagem de WhatsApp.
 * 3. LGPD & PRIVACIDADE: Bloqueio de envio de atestados/CIDs em chat aberto, direcionando para Meus Documentos.
 * 4. DADOS REAIS: Todas as respostas são baseadas nos registros do Firebase RTDB.
 * 5. MENSAGENS MOTIVACIONAIS: Boas-vindas inspiradoras na Entrada e agradecimento caloroso na Saída.
 * 6. OPÇÕES CLICÁVEIS: Links diretos e respostas numéricas interativas (1, 2, 3, etc.).
 */

import { normalizeWhatsAppPhone, sendWhatsAppMessage } from "./whatsapp.js";

export const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FAFF}\u{FE00}-\u{FE0F}]/gu;

/**
 * Remove qualquer emoji de uma string de forma estrita.
 */
export function stripHouseAIEmojis(text) {
  return String(text ?? "").replace(EMOJI_REGEX, "").trim();
}

/**
 * Normaliza um número de telefone e gera variantes para comparação segura:
 * Ex: com 9º dígito (13 dígitos) e sem 9º dígito (12 dígitos).
 */
export function getPhoneVariants(phone) {
  if (!phone) return [];
  const norm = normalizeWhatsAppPhone(phone);
  if (!norm || !norm.digits) return [];

  const digits = norm.digits;
  const variants = new Set([digits]);

  // Se tem 13 dígitos no Brasil (55 + DDD 2 dígitos + 9 + 8 dígitos)
  if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
    variants.add(digits.slice(0, 4) + digits.slice(5)); // sem 9
  } else if (digits.startsWith("55") && digits.length === 12) {
    variants.add(digits.slice(0, 4) + "9" + digits.slice(4)); // com 9
  }

  // DDD + número local (sem 55)
  if (digits.startsWith("55")) {
    const local = digits.slice(2);
    variants.add(local);
    if (local.length === 11) {
      variants.add(local.slice(0, 2) + local.slice(3));
    }
  }

  return Array.from(variants);
}

/**
 * Localiza colaborador por qualquer dos seus números de telefone registrados
 */
export function findEmployeeByPhone(employees, phone) {
  if (!Array.isArray(employees) || !phone) return null;
  const searchVariants = getPhoneVariants(phone);
  if (searchVariants.length === 0) return null;


  for (const emp of employees) {
    if (!emp) continue;
    const empPhones = [
      emp.Telefone,
      emp.WhatsApp,
      emp.Celular,
      emp.phone,
      emp.whatsapp,
    ].filter(Boolean);

    for (const raw of empPhones) {
      const empVariants = getPhoneVariants(raw);
      for (const sv of searchVariants) {
        if (empVariants.includes(sv)) {
          return emp;
        }
      }

    }
  }

  return null;
}

/**
 * Converte minutos para string legível de saldo: "+08:30" ou "-01:15"
 */
export function formatMinutesBalance(totalMinutes) {
  const isNegative = totalMinutes < 0;
  const abs = Math.abs(totalMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const sign = isNegative ? "-" : "+";
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Mapeia dia da semana para nome em português
 */
const DIAS_SEMANA = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

const MONTH_NAMES = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

function formatIso(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function getDaysInRange(startDateStr, endDateStr) {
  const dates = [];
  const cur = new Date(startDateStr + "T12:00:00Z");
  const end = new Date(endDateStr + "T12:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Extrai múltiplas datas ou períodos (YYYY-MM-DD) a partir de termos naturais em português
 */
export function extractDatesFromText(text, now = Date.now()) {
  const norm = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const nowBahia = new Date(now - 3 * 3600000);
  const curYear = nowBahia.getFullYear();
  const curMonth = nowBahia.getMonth() + 1; // 1-based
  const curDate = nowBahia.getDate();

  // Detecta menção a mês explícito
  let explicitMonth = null;
  for (const [mName, mNum] of Object.entries(MONTH_NAMES)) {
    if (new RegExp(`\\b${mName}\\b`).test(norm)) {
      explicitMonth = mNum;
      break;
    }
  }

  // Detecta ano explícito de 4 dígitos
  const mYear = norm.match(/\b(202\d)\b/);
  const explicitYear = mYear ? Number(mYear[1]) : null;

  function resolveMonthYear(d) {
    if (explicitMonth) {
      const y = explicitYear || (explicitMonth < curMonth ? curYear + 1 : curYear);
      return { y, m: explicitMonth };
    }
    let m = curMonth;
    let y = curYear;
    if (d < curDate) {
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return { y, m };
  }

  const foundDates = new Set();

  // 1. Range com barras: "de 10/11 a 12/11", "10/11 a 12/11", "de 10/11/2026 a 12/11/2026"
  const mRangeSlash = norm.match(/(?:de\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*(?:a|ate|ao)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (mRangeSlash) {
    const d1 = Number(mRangeSlash[1]);
    const m1 = Number(mRangeSlash[2]);
    const y1 = mRangeSlash[3] ? Number(mRangeSlash[3]) : (m1 < curMonth ? curYear + 1 : curYear);

    const d2 = Number(mRangeSlash[4]);
    const m2 = Number(mRangeSlash[5]);
    const y2 = mRangeSlash[6] ? Number(mRangeSlash[6]) : (m2 < m1 ? y1 + 1 : y1);

    const start = formatIso(y1, m1, d1);
    const end = formatIso(y2, m2, d2);
    getDaysInRange(start, end).forEach((dt) => foundDates.add(dt));
    return Array.from(foundDates).sort();
  }

  // 2. Range por extenso: "de 10 a 12 de novembro", "do dia 10 ao dia 12"
  const mRangeNamed = norm.match(/(?:de\s+|do\s+dia\s+|dia\s+)?(\d{1,2})\s*(?:a|ate|ao\s*dia|ao)\s*(\d{1,2})\b/);
  if (mRangeNamed && !norm.includes("/") && Number(mRangeNamed[1]) <= 31 && Number(mRangeNamed[2]) <= 31) {
    const d1 = Number(mRangeNamed[1]);
    const d2 = Number(mRangeNamed[2]);

    if (d1 < d2) {
      const { y, m } = resolveMonthYear(d1);
      const start = formatIso(y, m, d1);
      const end = formatIso(y, m, d2);
      getDaysInRange(start, end).forEach((dt) => foundDates.add(dt));
      return Array.from(foundDates).sort();
    }
  }

  // 3. Múltiplas datas com barra: "10/11 e 11/11", "10/11, 11/11 e 12/11"
  const slashMatches = [...norm.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/g)];
  if (slashMatches.length > 0) {
    for (const match of slashMatches) {
      const d = Number(match[1]);
      const m = Number(match[2]);
      let y = match[3] ? Number(match[3]) : curYear;
      if (!match[3] && m < curMonth) y++;
      foundDates.add(formatIso(y, m, d));
    }
    return Array.from(foundDates).sort();
  }

  // 4. "amanha e depois de amanha", "depois de amanha", "amanha", "hoje"
  if (norm.includes("amanha") || norm.includes("hoje")) {
    if (norm.includes("hoje")) {
      foundDates.add(nowBahia.toISOString().slice(0, 10));
    }
    if (norm.includes("amanha")) {
      const target1 = new Date(nowBahia);
      target1.setDate(curDate + 1);
      foundDates.add(target1.toISOString().slice(0, 10));
    }
    if (norm.includes("depois de amanha")) {
      const target2 = new Date(nowBahia);
      target2.setDate(curDate + 2);
      foundDates.add(target2.toISOString().slice(0, 10));
    }
    if (foundDates.size > 0) {
      return Array.from(foundDates).sort();
    }
  }

  // 5. Múltiplos "dia X e dia Y"
  const allDiaMatches = [...norm.matchAll(/dia\s+(\d{1,2})\b/g)];
  if (allDiaMatches.length > 1) {
    for (const match of allDiaMatches) {
      const d = Number(match[1]);
      if (d >= 1 && d <= 31) {
        const { y, m } = resolveMonthYear(d);
        foundDates.add(formatIso(y, m, d));
      }
    }
    return Array.from(foundDates).sort();
  }

  // 6. Lista de dias: "dias 10, 11 e 12", "dias 10 e 11", "dia 15"
  const mDiasList = norm.match(/(?:dias|dia)\s+([\d\s,e]+)/);
  if (mDiasList) {
    const numbersPart = mDiasList[1];
    const nums = numbersPart
      .split(/[\s,e]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{1,2}$/.test(s))
      .map(Number)
      .filter((n) => n >= 1 && n <= 31);

    if (nums.length > 0) {
      for (const d of nums) {
        const { y, m } = resolveMonthYear(d);
        foundDates.add(formatIso(y, m, d));
      }
      return Array.from(foundDates).sort();
    }
  }

  // 7. Dias da semana (ex: "segunda e terca", "quarta e quinta", "terca")
  const diasSemana = [
    { name: "domingo", idx: 0 },
    { name: "segunda", idx: 1 },
    { name: "terca", idx: 2 },
    { name: "quarta", idx: 3 },
    { name: "quinta", idx: 4 },
    { name: "sexta", idx: 5 },
    { name: "sabado", idx: 6 },
  ];
  for (const { name, idx } of diasSemana) {
    if (norm.includes(name)) {
      const target = new Date(nowBahia);
      let diff = (idx - nowBahia.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      target.setDate(curDate + diff);
      foundDates.add(target.toISOString().slice(0, 10));
    }
  }
  if (foundDates.size > 0) {
    return Array.from(foundDates).sort();
  }

  return [];
}

/**
 * Extrai data única (YYYY-MM-DD) a partir de termos naturais em português (compatibilidade)
 */
export function extractDateFromText(text, now = Date.now()) {
  const dates = extractDatesFromText(text, now);
  return dates[0] || null;
}

/**
 * Gera mensagem motivacional para marcações de ponto (Entrada, Saída, Intervalo)
 */
export function generateMotivationalTimeClockMessage({
  type, employeeName, timeStr, rng = Math.random, recordId = "", previousMessage = "",
}) {
  const firstName = String(employeeName || "").trim().split(/\s+/)[0] || "Colaborador";
  const time = timeStr || new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia",
  });
  const messages = {
    ENTRADA: {
      label: "ENTRADA",
      endings: [
        "Bom início de turno na House 190. Conte com a equipe e tenha um bom trabalho!",
        "Desejamos um bom turno na House 190, com atenção às atividades e colaboração entre todos.",
        "Um novo turno começa na House 190. Que a organização e a parceria acompanhem seu trabalho.",
        "Bom trabalho na House 190! Mantenha o cuidado com cada atividade e procure a liderança quando precisar.",
        "Desejamos uma boa jornada na House 190. Trabalhar em equipe ajuda a cuidar de cada etapa do serviço.",
        "Bom início de jornada na House 190. Faça seu trabalho com atenção e respeite os cuidados de segurança.",
        "Que seu turno na House 190 transcorra bem. Boa comunicação e cooperação ajudam no dia a dia.",
        "A House 190 deseja um bom turno. Comece com calma, organize suas atividades e conte com o time.",
      ],
    },
    SAIDA: {
      label: "SAÍDA",
      endings: [
        "A House 190 deseja um bom descanso. Aproveite seu tempo fora do trabalho.",
        "Bom descanso! Reserve este tempo para cuidar de você e de seus planos pessoais.",
        "Tenha um bom descanso e uma boa volta para casa, se estiver a caminho.",
        "Desejamos um bom descanso. Até o próximo turno na House 190!",
        "Agora, aproveite seu período de descanso da forma que for melhor para você.",
        "A House 190 deseja um descanso tranquilo e bons momentos no seu tempo livre.",
        "Bom descanso! Que você aproveite bem o tempo com suas atividades fora do trabalho.",
        "Desejamos um bom descanso. Cuide de você e até a próxima jornada.",
      ],
    },
    SAIDA_INTERVALO: {
      label: "SAÍDA PARA INTERVALO",
      endings: [
        "Bom intervalo! Aproveite sua pausa com tranquilidade.",
        "Desejamos uma boa pausa. Use este tempo para descansar.",
        "Bom intervalo! Cuide de você durante esse período de descanso.",
        "Tenha uma pausa tranquila e aproveite esse momento para você.",
        "Bom descanso durante o intervalo. Retome suas atividades após a pausa combinada.",
        "A House 190 deseja um bom intervalo. Aproveite seu tempo de pausa.",
        "Boa pausa! Este é seu momento de descanso durante o turno.",
        "Desejamos um intervalo tranquilo. Aproveite para fazer sua pausa com calma.",
      ],
    },
    RETORNO_INTERVALO: {
      label: "RETORNO DO INTERVALO",
      endings: [
        "Bom retorno! Desejamos uma boa continuidade de turno na House 190.",
        "Bom trabalho nesta etapa do turno. Conte com a equipe quando precisar.",
        "Desejamos um bom retorno às atividades, com atenção e organização.",
        "Boa continuidade de jornada! Mantenha a comunicação com o time.",
        "Bom retorno ao trabalho. Cuide de cada atividade e respeite os procedimentos de segurança.",
        "A House 190 deseja uma boa continuidade de turno. Bom trabalho!",
        "Bom retorno! Siga com cuidado nas atividades e procure a liderança se precisar de apoio.",
        "Desejamos uma boa sequência de trabalho, com parceria entre todos da equipe.",
      ],
    },
  }[type];
  if (!messages?.endings) return "";

  let sample;
  if (recordId) {
    // A mesma marcação mantém o texto em tentativas de reenvio, sem estado global.
    let hash = 2166136261;
    for (const char of `${type}:${recordId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    sample = (hash >>> 0) / 4294967296;
  } else {
    sample = Number(rng());
  }
  const bounded = Number.isFinite(sample) ? Math.min(0.9999999999999999, Math.max(0, sample)) : 0;
  let index = Math.floor(bounded * messages.endings.length);
  const render = (selected) => stripHouseAIEmojis(
    `Olá, ${firstName}! Ponto de ${messages.label} registrado às ${time}.\n\n${messages.endings[selected]}`,
  );
  // O chamador pode fornecer o último texto persistido; não depende do isolate do Worker.
  if (previousMessage && render(index) === previousMessage) index = (index + 1) % messages.endings.length;
  return render(index);
}

/**
 * Processa a mensagem de WhatsApp recebida e retorna o texto de resposta House AI
 */
export function classifyHouseAIReadIntent(text = "") {
  const q = String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  // This classifier never infers a write from conversational context.
  if (/\b(criar|cria|cadastrar|cadastre|aprovar|aprove|conceder|conceda|cancelar|cancele|excluir|exclua|concluir|conclua|pedir|solicitar|registrar|bater)\b/.test(q)) return "";
  if (/saldo.*(?:consumo|vale)|limite.*consumo|quanto.*posso.*consumir/.test(q)) return "consumo";
  if (/saldo/.test(q) && !/hora|folga|consumo|vale|credito/.test(q)) return "clarificar_saldo";
  if (/^(?:quais|qual|ver|mostrar|consultar|minhas|me mostre|o que (?:eu )?preciso fazer)/.test(q) && /tarefa|o que (?:eu )?preciso fazer/.test(q)) return "tarefas";
  if (/quem.*(?:trabalha|escala)|equipe.*hoje/.test(q)) return "equipe";
  if (/quando.*(?:descanso|descansar)|meus? dias? de descanso|proximo descanso/.test(q)) return "folgas";
  if (/quanto.*(?:devo|tenho).*hora|(?:devendo|credito).*hora/.test(q)) return "horas";
  if (/que horas.*(?:entro|saio|comeco|termino)|qual.*turno/.test(q)) return "escala";
  return "";
}

export async function processInboundHouseAI({
  from,
  text = "",
  pushName = "",
  env,
  database,
  tok,
  now = Date.now(),
  conversationStore = null,
  llmBypass = false,
}) {
  const normPhone = normalizeWhatsAppPhone(from);
  const cleanPhone = normPhone ? normPhone.digits : String(from || "").replace(/\D/g, "");
  let cleanText = stripHouseAIEmojis(text).toLowerCase().trim();
  const appUrl = (env.APP_URL || "https://houseburgertx-beep.github.io/Gestao-de-folgas3.0/").replace(/\/+$/, "") + "/";

  // 1. Busca Colaboradores e Perfis do Firebase RTDB
  const [employeesData, accessData] = await Promise.all([
    database(env, tok, "tables/Funcionarios"),
    database(env, tok, "access"),
  ]);
  const employees = Object.values(employeesData || {});
  let matchedEmp = findEmployeeByPhone(employees, cleanPhone);

  if (!matchedEmp) {
    // Tenta localizar através dos perfis de acesso do sistema (access)
    const accessProfiles = Object.values(accessData || {});
    const matchedProfile = findEmployeeByPhone(accessProfiles, cleanPhone);
    if (matchedProfile) {
      if (matchedProfile.FuncionarioID) {
        matchedEmp = employees.find(
          (e) => String(e.FuncionarioID || e.id) === String(matchedProfile.FuncionarioID)
        ) || matchedProfile;
      } else {
        matchedEmp = matchedProfile;
      }
    }
  }

  const associatedProfiles = matchedEmp ? Object.values(accessData || {}).filter((p) =>
    (p.FuncionarioID && String(p.FuncionarioID) === String(matchedEmp.FuncionarioID || matchedEmp.id)) || findEmployeeByPhone([p], cleanPhone)
  ) : [];
  if (!matchedEmp || (matchedEmp.Ativo !== undefined && !active(matchedEmp.Ativo)) || (associatedProfiles.length && !associatedProfiles.some((p) => active(p.Ativo)))) {
    return {
      handled: true,
      authorized: false,
      replyText: stripHouseAIEmojis(
        `Olá! Este canal de atendimento do Grupo House 190 é de uso exclusivo para colaboradores cadastrados.\n\n` +
        `Não localizamos o número (${cleanPhone}) em nosso cadastro oficial de funcionários.\n\n` +
        `Caso seja colaborador da House 190, por favor procure o gerente da sua loja para atualizar o número no cadastro.`
      ),
    };
  }

  const accessProfile = associatedProfiles.find((p) => active(p.Ativo));
  if (accessProfile && (!accessProfile.FuncionarioID || String(accessProfile.FuncionarioID) === String(matchedEmp.FuncionarioID || matchedEmp.id))) {
    matchedEmp = { ...matchedEmp, Perfil: accessProfile.Perfil || matchedEmp.Perfil, LojaID: accessProfile.LojaID || matchedEmp.LojaID };
  }
  const firstName = String(matchedEmp.Nome || pushName || "Colaborador").trim().split(/\s+/)[0];
  const empId = String(matchedEmp.FuncionarioID || matchedEmp.id || "");

  if (env.GROQ_API_KEY && !llmBypass) {
    if (!empId) return {handled:true,authorized:false,action:"missing_employee_link",replyText:"Seu acesso precisa estar vinculado a um funcionário. Peça à gerência para conferir esse vínculo no cadastro."};
    // Sensitive medical content stays outside the model. Point registration
    // never has a model tool and follows the existing protected app flow.
    const sensitive = /\b(cid|diagnostico|diagnóstico|laudo|receita|doenca|doença)\b/.test(cleanText);
    const punch = /(?:bater|bata|bate|registrar|registra|registre|marcar|marca) (?:meu )?ponto|bater entrada|bater saida|bater saída|ponto agora/.test(cleanText);
    if (sensitive || punch) return processInboundHouseAI({from,text,pushName,env,database,tok,now,conversationStore,llmBypass:true});
    const chatMemory = conversationStore || await createWhatsAppConversationStore(env,tok,`${cleanPhone}:groq`).catch(()=>null);
    const result = await runGroqConversation({env,employee:matchedEmp,employees,profile:accessProfile||matchedEmp,database,tok,now,text,memory:chatMemory,
      executeLegacy:legacyText=>processInboundHouseAI({from,text:legacyText,pushName,env,database,tok,now,llmBypass:true})});
    if(result) return {...result,replyText:stripHouseAIEmojis(result.replyText)};
  }

  const storeId = String(matchedEmp.LojaID || "");
  const memory = conversationStore || await createWhatsAppConversationStore(env, tok, cleanPhone).catch(() => null);
  if (memory && /^(menu|ajuda|recomecar|recomeçar|limpar conversa)$/.test(cleanText)) {
    await memory.save({employeeId:empId,storeId,intent:"",at:now}).catch(()=>{});
  }
  if (memory && isConversationFollowUp(cleanText)) {
    const previous = await memory.load().catch(() => null);
    cleanText = resolveConversationFollowUp({text: cleanText, previous, employeeId: empId, storeId, now});
  }
  const readIntent = classifyHouseAIReadIntent(cleanText);
  const subject = readIntent || (cleanText === "1" || cleanText.includes("folga") ? "folgas" : cleanText === "2" || /banco de horas|saldo de horas/.test(cleanText) ? "horas" : cleanText === "3" || /meu hor[aá]rio|meu turno/.test(cleanText) ? "escala" : "");
  const queryDate = extractDateFromText(cleanText, now) || bahiaDay(now);
  if (memory && ["folgas","horas","escala","tarefas","equipe"].includes(subject) && !/\b(criar|cria|aprovar|aprove|conceder|conceda|cancelar|pedir|solicitar|quero)\b/.test(cleanText)) {
    await memory.save({employeeId: empId, storeId, intent: subject, date:queryDate, at: now}).catch(() => {});
  }
  if (isConversationFollowUp(cleanText) && !subject && !/saldo/.test(cleanText)) {
    return {handled:true,authorized:true,action:"clarificar_contexto",replyText:"Você quer consultar folgas, escala ou tarefas para esse dia? Diga o assunto para eu conferir o registro certo."};
  }
  if (/quem sou eu|meu cadastro|minhas informa[cç][oõ]es|meus dados/.test(cleanText)) {
    const stores = await database(env,tok,"tables/Lojas").catch(()=>({}));
    const store = Object.values(stores || {}).find(row=>String(row.LojaID || row.id || "")===storeId);
    return {handled:true,authorized:true,action:"consulta_cadastro_proprio",replyText:stripHouseAIEmojis(`Seu cadastro no sistema:\n\nNome: ${matchedEmp.Nome || firstName}\nUnidade: ${store?.NomeLoja || store?.Nome || matchedEmp.NomeLoja || "Não informada"}\nCargo: ${matchedEmp.Cargo || "Não informado"}\nTurno: ${matchedEmp.Turno || "Não informado"}\n\nPara corrigir seus dados, procure a gerência. Dados pessoais sensíveis ficam disponíveis apenas no aplicativo.`)};
  }
  if (readIntent === "consumo") {
    return {handled:true,authorized:true,action:"consulta_consumo",replyText:`Para conferir seu saldo e limite de consumo atualizados, abra a aba Consumo no aplicativo: ${appUrl}?view=takeat-credit\n\nO saldo de consumo é diferente do banco de horas; não vou misturar os dois.`};
  }
  if (readIntent === "clarificar_saldo") {
    return { handled: true, authorized: true, action: "clarificar_saldo",
      replyText: `Olá, ${firstName}! Você quer consultar seu saldo de horas ou suas folgas? Responda “banco de horas” ou “minhas folgas” para eu consultar o registro certo.` };
  }
  if (readIntent === "tarefas") {
    try {
      const rows = await database(env, tok, "tables/Tarefas");
      if (env.GROQ_API_KEY && !llmBypass) {
    if (!empId) return {handled:true,authorized:false,action:"missing_employee_link",replyText:"Seu acesso precisa estar vinculado a um funcionário. Peça à gerência para conferir esse vínculo no cadastro."};
    // Sensitive medical content stays outside the model. Point registration
    // never has a model tool and follows the existing protected app flow.
    const sensitive = /\b(cid|diagnostico|diagnóstico|laudo|receita|doenca|doença)\b/.test(cleanText);
    const punch = /(?:bater|bata|bate|registrar|registra|registre|marcar|marca) (?:meu )?ponto|bater entrada|bater saida|bater saída|ponto agora/.test(cleanText);
    if (sensitive || punch) return processInboundHouseAI({from,text,pushName,env,database,tok,now,conversationStore,llmBypass:true});
    const chatMemory = conversationStore || await createWhatsAppConversationStore(env,tok,`${cleanPhone}:groq`).catch(()=>null);
    const result = await runGroqConversation({env,employee:matchedEmp,employees,profile:accessProfile||matchedEmp,database,tok,now,text,memory:chatMemory,
      executeLegacy:legacyText=>processInboundHouseAI({from,text:legacyText,pushName,env,database,tok,now,llmBypass:true})});
    if(result) return {...result,replyText:stripHouseAIEmojis(result.replyText)};
  }

  const storeId = String(matchedEmp.LojaID || "");
      const tasks = Object.values(rows || {}).filter((task) => {
        const owner = String(task.FuncionarioID || task.RESPONSAVEL_ID || "");
        const store = String(task.LojaID || task.LOJA_ID || "");
        const status = String(task.Status || task.STATUS || task.Coluna || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const requested = extractDateFromText(cleanText, now);
        const date = String(task.DataTurno || task.DATA_TURNO || task.Prazo || task.PRAZO || "").slice(0,10);
        return owner === empId && (!store || (storeId && store === storeId)) && (!requested || date === requested) && !["concluida", "concluido", "cancelada", "cancelado"].includes(status);
      });
      const lines = tasks.slice(0, 10).map((task) => `- ${String(task.Titulo || task.TITULO || "Tarefa sem título").replace(/\s+/g, " ").slice(0, 120)}`);
      return { handled: true, authorized: true, action: "consulta_tarefas",
        replyText: stripHouseAIEmojis(`Olá, ${firstName}! Você tem ${tasks.length} tarefa(s) em aberto${extractDateFromText(cleanText, now) ? " para " + queryDate.split("-").reverse().join("/") : ""}.\n\n${lines.join("\n")}${tasks.length > 10 ? "\nVeja as demais no aplicativo." : ""}\n\nConfira os detalhes e atualize suas atividades no aplicativo:\n${appUrl}?view=tasks`) };
    } catch {
      return { handled: true, authorized: true, action: "consulta_tarefas_indisponivel", replyText: "Não consegui consultar suas tarefas agora. Tente novamente ou abra a aba Tarefas no aplicativo." };
    }
  }

  // 1.5 CONFIRMAÇÕES E AGRADECIMENTOS ("sim", "ok", "obrigado", "valeu", etc.)
  if (
    cleanText === "sim" ||
    cleanText === "ok" ||
    cleanText === "certo" ||
    cleanText === "beleza" ||
    cleanText === "entendido" ||
    cleanText === "perfeito" ||
    cleanText === "combinado"
  ) {
    return {
      handled: true,
      authorized: true,
      action: "confirmacao_geral",
      replyText: stripHouseAIEmojis(
        `Combinado, ${firstName}!\n\n` +
        `Estou à disposição sempre que precisar. Para consultar qualquer informação, basta digitar uma das opções:\n\n` +
        `• Folgas (consultar folgas do mês e saldo)\n` +
        `• Banco de horas (horas trabalhadas e saldo)\n` +
        `• Escala (horário e turno de hoje)\n` +
        `• Pedir folga (solicitar folga para uma data)\n` +
        `• Meus documentos (espelho de ponto e assinatura)\n` +
        `• Regras (normas e políticas da casa)\n\n` +
        `Aplicativo oficial: ${appUrl}`
      ),
    };
  }

  if (
    cleanText.includes("obrigad") ||
    cleanText.includes("valeu") ||
    cleanText.includes("agradeco") ||
    cleanText.includes("agradeço")
  ) {
    return {
      handled: true,
      authorized: true,
      action: "agradecimento",
      replyText: stripHouseAIEmojis(
        `Por nada, ${firstName}!\n\n` +
        `Sempre à disposição para apoiar você e a equipe da House 190.\n\n` +
        `Se precisar de mais alguma coisa, é só me chamar por aqui!`
      ),
    };
  }

  // 2. BLOQUEIO INEGOCIÁVEL: REGISTRO DE PONTO POR WHATSAPP (Portaria 671 MTE)
  if (
    cleanText.includes("bater ponto") ||
    cleanText.includes("bata ponto") ||
    cleanText.includes("bata meu ponto") ||
    cleanText.includes("bate meu ponto") ||
    cleanText.includes("registra ponto") ||
    cleanText.includes("registrar ponto") ||
    cleanText.includes("registre ponto") ||
    cleanText.includes("bater entrada") ||
    cleanText.includes("bata entrada") ||
    cleanText.includes("bater saida") ||
    cleanText.includes("bater saída") ||
    cleanText.includes("marca ponto") ||
    cleanText.includes("marcar ponto") ||
    cleanText.includes("ponto agora")
  ) {
    return {
      handled: true,
      authorized: true,
      action: "bloqueio_ponto_mte_671",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}!\n\n` +
        `Por exigência legal da Portaria 671/MTE e garantia de segurança jurídica, o registro de ponto não pode ser realizado por mensagens de WhatsApp.\n\n` +
        `Acesse o aplicativo oficial para registrar seu ponto com geolocalização e foto biométrica:\n` +
        `${appUrl}?tab=timeclock`
      ),
    };
  }

  // 3. BLOQUEIO LGPD: DADOS DE SAÚDE, CIDs E ATESTADOS MÉDICOS
  if (
    cleanText.includes("cid") ||
    cleanText.includes("diagnostico") ||
    cleanText.includes("diagnóstico") ||
    cleanText.includes("receita") ||
    (cleanText.includes("atestado") && !cleanText.includes("como funciona") && !cleanText.includes("regra")) ||
    cleanText.includes("doenca") ||
    cleanText.includes("doença") ||
    cleanText.includes("laudo") ||
    cleanText.includes("afastamento")
  ) {
    return {
      handled: true,
      authorized: true,
      action: "bloqueio_lgpd_saude",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}!\n\n` +
        `Para proteger sua privacidade e em estrito cumprimento da LGPD, atestados médicos, diagnósticos e receitas não devem ser compartilhados pelo chat aberto do WhatsApp.\n\n` +
        `Envie seu documento de forma segura e criptografada pela aba Meus Documentos no aplicativo oficial:\n` +
        `${appUrl}?tab=documents\n\n` +
        `* Prazo regulamentar: até 48h com CRM e carimbo legível.`
      ),
    };
  }

  // 4. PEDIDO OU CONCESSÃO DE FOLGA VIA WHATSAPP COM PERSISTÊNCIA NO FIREBASE RTDB
  const isTimeOffAction =
    cleanText.includes("pedir folga") ||
    cleanText.includes("solicitar folga") ||
    cleanText.includes("quero folga") ||
    cleanText.includes("marcar folga") ||
    cleanText.includes("dar folga") ||
    cleanText.includes("conceder folga") ||
    cleanText.includes("aprovar folga") ||
    cleanText.includes("agendar folga") ||
    cleanText.includes("preciso de folga") ||
    cleanText.includes("preciso folga") ||
    ((cleanText.includes("folga") || cleanText.includes("folgas")) && (
      cleanText.includes("dia") ||
      cleanText.includes("dias") ||
      cleanText.includes("hoje") ||
      cleanText.includes("amanha") ||
      cleanText.includes("amanhã") ||
      cleanText.includes("segunda") ||
      cleanText.includes("terca") ||
      cleanText.includes("terça") ||
      cleanText.includes("quarta") ||
      cleanText.includes("quinta") ||
      cleanText.includes("sexta") ||
      cleanText.includes("sabado") ||
      cleanText.includes("sábado") ||
      cleanText.includes("domingo") ||
      cleanText.includes("ate") ||
      cleanText.includes("até") ||
      /\d{1,2}\/\d{1,2}/.test(cleanText)
    ) && !cleanText.includes("quantas") && !cleanText.includes("saldo") && !cleanText.includes("minhas"));

  if (isTimeOffAction) {
    const targetDates = extractDatesFromText(text, now);

    if (!targetDates || targetDates.length === 0) {
      return {
        handled: true,
        authorized: true,
        action: "solicitar_data_folga",
        replyText: stripHouseAIEmojis(
          `Olá, ${firstName}!\n\n` +
          `Para qual data ou período você gostaria de solicitar a folga?\n\n` +
          `Por favor, me informe o dia ou intervalo desejado, por exemplo:\n` +
          `* "Quero folga dia 15/11"\n` +
          `* "Folga dias 10 e 11 de novembro"\n` +
          `* "Folga de 10/11 a 12/11"\n` +
          `* "Solicitar folga amanhã"\n\n` +
          `Ou selecione as datas no calendário pelo aplicativo oficial:\n${appUrl}?tab=timeoff`
        ),
      };
    }

    const isGestorOrAdmin =
      ["Administrador", "Gerente", "Responsável de loja"].includes(matchedEmp.Perfil);

    // Se o remetente for Gestor/Admin, verifica se mencionou o nome de outro colaborador
    let targetEmp = matchedEmp;
    if (isGestorOrAdmin) {
      const sortedEmployees = [...employees].sort(
        (a, b) => String(b.Nome || "").length - String(a.Nome || "").length
      );
      // 1. Tenta correspondência do nome completo (maior primeiro para nomes compostos)
      let foundOther = sortedEmployees.find((e) => {
        const pName = String(e.Nome || "").toLowerCase().trim();
        const normPName = pName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return normPName.length > 2 && cleanText.includes(normPName);
      });

      // 2. Se não encontrou pelo nome completo, busca pelo primeiro nome
      if (!foundOther) {
        foundOther = sortedEmployees.find((e) => {
          const pName = String(e.Nome || "").toLowerCase().trim();
          const normPName = pName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const parts = normPName.split(/\s+/).filter((p) => p.length > 2);
          return parts.length >= 1 && cleanText.includes(parts[0]);
        });
      }
      if (foundOther) {
        targetEmp = foundOther;
      }
    }

    if (isGestorOrAdmin && matchedEmp.Perfil !== "Administrador" &&
        (!matchedEmp.LojaID || String(targetEmp.LojaID || "") !== String(matchedEmp.LojaID))) {
      return { handled: true, authorized: false, action: "loja_nao_autorizada", replyText: "Você pode conceder folgas somente para colaboradores da sua loja. Use o aplicativo para conferir o cadastro." };
    }
    const folgasData = await database(env, tok, "tables/Folgas");
    const allFolgas = Object.values(folgasData || {});
    const targetEmpId = String(targetEmp.FuncionarioID || targetEmp.funcionarioId || targetEmp.id || "");
    const targetEmpNome = String(targetEmp.Nome || targetEmp.nome || "Colaborador");
    const targetEmpEmail = String(targetEmp.Email || targetEmp.email || "");
    const targetEmpLojaId = String(targetEmp.LojaID || targetEmp.lojaId || "");
    const targetEmpNomeLoja = String(targetEmp.NomeLoja || targetEmp.nomeLoja || "House 190");

    const nowBahia = new Date(now - 3 * 3600000);
    const mesAtual = nowBahia.toISOString().slice(0, 7);

    // Folgas já aprovadas no mês corrente
    const aprovadasMesCount = allFolgas.filter((f) => {
      const fEmpId = String(f.FuncionarioID || f.funcionarioId || "");
      const fDate = String(f.Data || f.DataInicio || f.data || "").slice(0, 7);
      const fStatus = String(f.Status || "").toLowerCase();
      return fEmpId === targetEmpId && fDate === mesAtual && fStatus === "aprovada";
    }).length;

    let saldoDisponivel;
    if (targetEmp.SaldoFolgas !== undefined && targetEmp.SaldoFolgas !== null && !isNaN(Number(targetEmp.SaldoFolgas))) {
      saldoDisponivel = Number(targetEmp.SaldoFolgas);
    } else {
      saldoDisponivel = Math.max(0, 5 - aprovadasMesCount);
    }

    // Separa datas que já possuem folga ativa daquelas novas a cadastrar
    const alreadyBookedDates = [];
    const validDatesToCreate = [];

    for (const dStr of targetDates) {
      const exists = allFolgas.find((f) => {
        const fEmpId = String(f.FuncionarioID || f.funcionarioId || "");
        const fDate = String(f.Data || f.data || f.DataInicio || "");
        const fStatus = String(f.Status || "").toLowerCase();
        return fEmpId === targetEmpId && fDate === dStr && fStatus !== "cancelada" && fStatus !== "rejeitada";
      });
      if (exists) {
        alreadyBookedDates.push(dStr);
      } else {
        validDatesToCreate.push(dStr);
      }
    }

    // Se todas as datas solicitadas já estavam cadastradas
    if (validDatesToCreate.length === 0) {
      const datasBookedBR = alreadyBookedDates
        .map((dt) => {
          const [y, m, d] = dt.split("-");
          return `${d}/${m}/${y}`;
        })
        .join(", ");
      return {
        handled: true,
        authorized: true,
        action: "folga_existente",
        replyText: stripHouseAIEmojis(
          `Atenção, ${firstName}!\n\n` +
          `${targetEmpNome === matchedEmp.Nome ? "Você" : targetEmpNome} já possui folga registrada no sistema para a(s) data(s): *${datasBookedBR}*.\n\n` +
          `Consulte a escala completa no aplicativo oficial:\n${appUrl}?tab=timeoff`
        ),
      };
    }

    // Validação estrita de saldo de folgas disponível
    if (validDatesToCreate.length > saldoDisponivel) {
      const pluralSol = validDatesToCreate.length > 1;
      return {
        handled: true,
        authorized: true,
        action: "limite_folgas_excedido",
        replyText: stripHouseAIEmojis(
          `Atenção, ${firstName}!\n\n` +
          `Você solicitou ${validDatesToCreate.length} dia${pluralSol ? "s" : ""} de folga, mas ${targetEmpNome === matchedEmp.Nome ? "seu saldo disponível é" : `o saldo de ${targetEmpNome} é`} de apenas ${saldoDisponivel} folga(s).\n\n` +
          `* Dias solicitados: ${validDatesToCreate.length}\n` +
          `* Saldo disponível: ${saldoDisponivel}\n\n` +
          `Por favor, ajuste o seu pedido para o limite disponível ou procure o gerente da sua loja para avaliar a situação no aplicativo oficial:\n${appUrl}?tab=timeoff`
        ),
      };
    }

    // Se foi concedida por Gestor/Admin para colaborador ou com termo de aprovação direta
    const isGrantedDirectly =
      isGestorOrAdmin &&
      (targetEmp !== matchedEmp || cleanText.includes("aprovar") || cleanText.includes("conceder") || cleanText.includes("dar folga"));
    const status = isGrantedDirectly ? "Aprovada" : (isGestorOrAdmin ? "Aprovada" : "Pendente");

    const atomicUpdate = {};
    const createdFolgaIds = [];
    const datasCriadasBR = [];

    for (let i = 0; i < validDatesToCreate.length; i++) {
      const dStr = validDatesToCreate[i];
      const folgaId = `folga-wa-${crypto.randomUUID()}-${i}`;
      createdFolgaIds.push(folgaId);

      const [y, m, d] = dStr.split("-");
      const dBR = `${d}/${m}/${y}`;
      datasCriadasBR.push(dBR);

      const folgaRecord = {
        FolgaID: folgaId,
        FuncionarioID: targetEmpId,
        NomeFuncionario: targetEmpNome,
        EmailFuncionario: targetEmpEmail,
        LojaID: targetEmpLojaId,
        NomeLoja: targetEmpNomeLoja,
        DataInicio: dStr,
        DataFim: dStr,
        Data: dStr,
        Tipo: "Regular",
        TipoFolga: "Folga",
        Periodo: "Dia inteiro",
        Motivo: isGrantedDirectly ? "Concedida via WhatsApp House AI" : "Solicitada via WhatsApp",
        Status: status,
        Origem: isGrantedDirectly ? "WhatsApp House AI (Gestor)" : "Pedido do funcionário",
        Solicitante: matchedEmp.Nome,
        SolicitadoPor: matchedEmp.Email || matchedEmp.Nome,
        AprovadoPor: status === "Aprovada" ? (matchedEmp.Email || matchedEmp.Nome) : "",
        DataAprovacao: status === "Aprovada" ? new Date().toISOString() : "",
        DataSolicitacao: new Date().toISOString(),
        SaldoFolgasStatus: status === "Aprovada" ? "Aplicado" : "Pendente",
        Observacoes: `Registrado via WhatsApp por ${matchedEmp.Nome} em ${new Date().toLocaleTimeString("pt-BR")}`,
        DataCriacao: new Date().toISOString(),
        DataAtualizacao: new Date().toISOString(),
        CriadoEm: new Date().toISOString(),
      };

      atomicUpdate[`Folgas/${folgaId}`] = folgaRecord;
    }

    // Se aprovada diretamente pelo Gestor/Admin, debita do saldo e registra os movimentos
    let novoSaldo = saldoDisponivel;
    if (status === "Aprovada" && targetEmpId) {
      const currentBalance = Number(targetEmp.SaldoFolgas ?? saldoDisponivel);
      novoSaldo = Math.max(0, currentBalance - validDatesToCreate.length);
      const patchPayload = {
        SaldoFolgas: novoSaldo,
      };

      for (let i = 0; i < validDatesToCreate.length; i++) {
        const dStr = validDatesToCreate[i];
        const folgaId = createdFolgaIds[i];
        const movementKey = `folga-${folgaId}`;
        patchPayload[`SaldoFolgasLancamentos/${movementKey}`] = {
          FolgaID: folgaId,
          Delta: -1,
          Quantidade: 1,
          Tipo: "Débito de folga aprovada",
          DataInicio: dStr,
          DataFim: dStr,
          DataAtualizacao: new Date().toISOString(),
        };

        const movId = `mov-${folgaId}`;
        atomicUpdate[`MovimentosSaldoFolgas/${movId}`] = {
            MovimentoID: movId,
            FolgaID: folgaId,
            FuncionarioID: targetEmpId,
            LojaID: targetEmpLojaId,
            Tipo: "Debito",
            Quantidade: 1,
            SaldoAnterior: currentBalance - i,
            SaldoNovo: currentBalance - i - 1,
            Motivo: `Folga aprovada via WhatsApp para ${datasCriadasBR[i]}`,
            DataCriacao: new Date().toISOString(),
          };
      }

      // A single atomic multipath PATCH prevents partially applied approvals.
      // Server increment preserves concurrent decrements; overdraft prevention still
      // requires a dedicated financial transaction service (see SECURITY-MIGRATION.md).
      atomicUpdate[`Funcionarios/${targetEmpId}/SaldoFolgas`] =
        targetEmp.SaldoFolgas === undefined || targetEmp.SaldoFolgas === null
          ? novoSaldo : { ".sv": { increment: -validDatesToCreate.length } };
      for (const [key, value] of Object.entries(patchPayload)) {
        if (key !== "SaldoFolgas") atomicUpdate[`Funcionarios/${targetEmpId}/${key}`] = value;
      }
    }

    const notifId = `notif-wa-${crypto.randomUUID()}`;
    const datasFormatadasTexto = datasCriadasBR.join(", ");
    atomicUpdate[`Notificacoes/${notifId}`] = {
        NotificacaoID: notifId,
        LojaID: targetEmpLojaId,
        DestinatarioID: status === "Aprovada" ? targetEmpId : "",
        Tipo: "Folga",
        Assunto: status === "Aprovada" ? "Folga Aprovada via WhatsApp" : "Nova Solicitação de Folga via WhatsApp",
        Mensagem: status === "Aprovada"
          ? `Folga confirmada para ${targetEmpNome} nas datas: ${datasFormatadasTexto}.`
          : `${targetEmpNome} solicitou folga para ${datasFormatadasTexto} via WhatsApp.`,
        Status: "NaoLida",
        DataCriacao: new Date().toISOString(),
      };
    const write = await fetch(`${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables.json`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(atomicUpdate), signal: AbortSignal.timeout(15000),
    });
    if (!write.ok) throw new Error(`firebase_atomic_write_${write.status}`);

    const plural = validDatesToCreate.length > 1;
    const datasTexto = datasCriadasBR.join(", ");

    if (status === "Aprovada") {
      const linhasAprovada = [
        `Confirmado, ${firstName}!`,
        ``,
        `A${plural ? "s" : ""} folga${plural ? "s" : ""} para *${targetEmpNome}* na${plural ? "s" : ""} data${plural ? "s" : ""} *${datasTexto}* (${validDatesToCreate.length} dia${plural ? "s" : ""}) ${plural ? "foram APROVADAS e registradas" : "foi APROVADA e registrada"} diretamente no sistema oficial da House 190 com sucesso.`,
        ``,
        `* Colaborador: ${targetEmpNome}`,
        `* Loja: ${targetEmpNomeLoja}`,
        `* Data${plural ? "s" : ""}: ${datasTexto}`,
        `* Total: ${validDatesToCreate.length} dia${plural ? "s" : ""}`,
        `* Saldo restante: ${novoSaldo} folga(s)`,
        `* Status: Aprovada`,
      ];
      if (alreadyBookedDates.length > 0) {
        linhasAprovada.push(
          ``,
          `Observação: a(s) data(s) ${alreadyBookedDates.map((d) => d.split("-").reverse().join("/")).join(", ")} já estava(m) registrada(s) anteriormente.`
        );
      }
      linhasAprovada.push(
        ``,
        `Acesse a escala atualizada no aplicativo:`,
        `${appUrl}?tab=timeoff`
      );

      return {
        handled: true,
        authorized: true,
        action: "folga_aprovada_whatsapp",
        replyText: stripHouseAIEmojis(linhasAprovada.join("\n")),
      };
    }

    const linhasPendente = [
      `Perfeito, ${firstName}!`,
      ``,
      `Seu pedido de folga para ${plural ? "as datas" : "o dia"} *${datasTexto}* (${validDatesToCreate.length} dia${plural ? "s" : ""}) foi registrado no sistema oficial com sucesso!`,
      ``,
      `* Protocolo: ${createdFolgaIds[0]}`,
      `* Total solicitado: ${validDatesToCreate.length} dia${plural ? "s" : ""}`,
      `* Saldo disponível atual: ${saldoDisponivel} folga(s)`,
      `* Status: Pendente de aprovação da gerência`,
    ];
    if (alreadyBookedDates.length > 0) {
      linhasPendente.push(
        ``,
        `Observação: a(s) data(s) ${alreadyBookedDates.map((d) => d.split("-").reverse().join("/")).join(", ")} já estava(m) registrada(s) anteriormente.`
      );
    }
    linhasPendente.push(
      ``,
      `Assim que o gerente da sua loja avaliar a solicitação, você receberá a confirmação aqui pelo WhatsApp.`,
      ``,
      `Acompanhe seu pedido no aplicativo:`,
      `${appUrl}?tab=timeoff`
    );

    return {
      handled: true,
      authorized: true,
      action: "folga_solicitada_whatsapp",
      replyText: stripHouseAIEmojis(linhasPendente.join("\n")),
    };
  }

  // 5. CONSULTA DE FOLGAS E ESCALA DE FOLGAS (Opção 1 ou texto)
  if (
    readIntent === "folgas" ||
    cleanText === "1" ||
    cleanText.includes("folga") ||
    cleanText.includes("folgas") ||
    cleanText.includes("minhas folgas") ||
    cleanText.includes("quando folgo") ||
    cleanText.includes("saldo de folga") ||
    cleanText.includes("proxima folga") ||
    cleanText.includes("próxima folga")
  ) {
    const folgasData = await database(env, tok, "tables/Folgas").catch(() => ({}));
    const allFolgas = Object.values(folgasData || {});
    const explicitDates = extractDatesFromText(cleanText, now);
    if (explicitDates.length === 1) {
      const date = explicitDates[0];
      const ownLeaves = allFolgas.filter(row => String(row.FuncionarioID || row.funcionarioId || "") === empId &&
        String(row.DataInicio || row.Data || row.data || "").slice(0,10) <= date &&
        String(row.DataFim || row.DataInicio || row.Data || row.data || "").slice(0,10) >= date);
      const approved = ownLeaves.some(row => ["aprovada","concluída"].includes(String(row.Status || "").toLowerCase()));
      const pending = ownLeaves.some(row => String(row.Status || "").toLowerCase() === "pendente");
      const display = date.split("-").reverse().join("/");
      return {handled:true,authorized:true,action:"consulta_folgas",replyText:`${firstName}, para ${display}: ${approved ? "há folga aprovada no sistema." : pending ? "há um pedido pendente de avaliação; ainda não é uma folga aprovada." : "não encontrei uma folga aprovada nos pedidos cadastrados. Confira também o descanso fixo da sua jornada na aba Ponto."}\n\n${appUrl}?view=timeoff`};
    }


    // Data atual no fuso de Brasília/Bahia (UTC-3)
    const nowBahia = new Date(now - 3 * 3600000);
    const mesAtual = nowBahia.toISOString().slice(0, 7);
    const hojeStr = nowBahia.toISOString().slice(0, 10);

    const minhasFolgasMes = allFolgas.filter((f) => {
      const fEmpId = String(f.FuncionarioID || f.funcionarioId || "");
      const fDate = String(f.DataInicio || f.Data || f.data || "").slice(0, 7);
      return fEmpId === empId && fDate === mesAtual;
    });

    const aprovadas = minhasFolgasMes.filter(
      (f) => String(f.Status || "").toLowerCase() === "aprovada"
    );
    const pendentes = minhasFolgasMes.filter(
      (f) => String(f.Status || "").toLowerCase() === "pendente"
    );

    // Formata datas das folgas aprovadas no mês
    const datasAprovadas = aprovadas
      .map((f) => {
        const d = String(f.DataInicio || f.Data || f.data || "");
        const parts = d.split("-");
        return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
      })
      .filter(Boolean)
      .join(", ");

    // Próxima folga futura a partir de hoje
    const proximasFolgas = allFolgas
      .filter((f) => {
        const fEmpId = String(f.FuncionarioID || f.funcionarioId || "");
        const fDate = String(f.DataInicio || f.Data || f.data || "");
        const status = String(f.Status || "").toLowerCase();
        return fEmpId === empId && fDate >= hojeStr && status === "aprovada";
      })
      .sort((a, b) => String(a.DataInicio || a.Data || a.data).localeCompare(String(b.DataInicio || b.Data || b.data)));

    let proximaTexto = "";
    if (proximasFolgas.length > 0) {
      const prox = proximasFolgas[0];
      const pDate = String(prox.DataInicio || prox.Data || prox.data || "");
      const parts = pDate.split("-");
      proximaTexto = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : pDate;
    }

    const explicitBalance = Number(matchedEmp.SaldoFolgas);
    const saldoRestante = matchedEmp.SaldoFolgas !== undefined && matchedEmp.SaldoFolgas !== null && Number.isFinite(explicitBalance) ? explicitBalance : Math.max(0, 5 - aprovadas.length);

    const linhas = [
      `Olá, ${firstName}! Aqui está o resumo das suas folgas para este mês:`,
      ``,
      `* Folgas aprovadas no mês: ${aprovadas.length} de 5 regulamentares${datasAprovadas ? ` (${datasAprovadas})` : ""}`,
      `* Solicitações pendentes: ${pendentes.length}`,
      `* Saldo de folgas a agendar: ${saldoRestante}`,
    ];

    if (proximaTexto) {
      linhas.push(`* Próxima folga programada: ${proximaTexto}`);
    }

    linhas.push(
      ``,
      `Consulte a escala completa no aplicativo oficial:`,
      `${appUrl}?tab=timeoff`
    );

    return {
      handled: true,
      authorized: true,
      action: "consulta_folgas",
      replyText: stripHouseAIEmojis(linhas.join("\n")),
    };
  }

  // 5. CONSULTA DE BANCO DE HORAS (Opção 2 ou texto)
  if (
    readIntent === "horas" ||
    cleanText === "2" ||
    cleanText.includes("banco de horas") ||
    cleanText.includes("saldo de horas") ||
    cleanText.includes("horas extras") ||
    cleanText.includes("horas negativas") ||
    cleanText.includes("meu saldo") ||
    cleanText.includes("saldo atual") ||
    cleanText.includes("saldo")
  ) {
    if (queryDate > bahiaDay(now)) return {handled:true,authorized:true,action:"consulta_banco_horas",replyText:"Ainda não há saldo futuro confirmado para essa data. Confira a apuração atual e a programação da jornada no aplicativo."};
    let punchesData = await database(env, tok, "tables/RegistrosPonto");
    if (!Object.keys(punchesData || {}).length) punchesData = await database(env, tok, "tables/RegistroPonto");
    const punches = Object.values(punchesData || {}).filter(
      (p) => String(p.FuncionarioID || p.funcionarioId || "") === empId
    );

    // Agrupa batidas válidas por data e calcula minutos trabalhados
    const punchesByDay = new Map();
    for (const p of punches) {
      if (p.Status === "Substituído") continue;
      const dataStr = String(p.Data || p.DataHora || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) continue;
      const horaStr = String(p.Hora || (p.DataHora ? p.DataHora.slice(11, 16) : "")).slice(0, 5);
      if (!horaStr) continue;

      const [h, m] = horaStr.split(":").map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) continue;
      const mins = h * 60 + m;

      const list = punchesByDay.get(dataStr) || [];
      list.push({mins, stamp: Date.parse(p.DataHora || ""), type:p.TipoMarcacao});
      punchesByDay.set(dataStr, list);
    }

    let totalTrabalhadoMinutos = 0;
    let diasTrabalhados = 0;

    for (const [_, minsList] of punchesByDay.entries()) {
      const rank = {ENTRADA:0,SAIDA_INTERVALO:1,RETORNO_INTERVALO:2,SAIDA_FINAL:3};
      minsList.sort((a, b) => Number.isFinite(a.stamp) && Number.isFinite(b.stamp) ? a.stamp-b.stamp : a.type in rank && b.type in rank ? rank[a.type]-rank[b.type] : a.mins-b.mins);
      let dayWorked = 0;
      for (let i = 0; i < minsList.length - 1; i += 2) {
        const start=minsList[i],end=minsList[i+1];
        const duration=Number.isFinite(start.stamp)&&Number.isFinite(end.stamp) ? (end.stamp-start.stamp)/60000 : (end.mins-start.mins+1440)%1440;
        if (duration >= 0 && duration <= 18*60) dayWorked += duration;
      }
      if (dayWorked > 0) {
        totalTrabalhadoMinutos += dayWorked;
        diasTrabalhados++;
      }
    }

    const minutosEsperados = diasTrabalhados * 440;
    const saldoMinutos = totalTrabalhadoMinutos - minutosEsperados;
    const saldoFormatado = formatMinutesBalance(saldoMinutos);
    const situacao = saldoMinutos >= 0 ? "positivo" : "a compensar";

    return {
      handled: true,
      authorized: true,
      action: "consulta_banco_horas",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}!\n\n` +
        `A estimativa simplificada das marcações consultadas é de *${saldoFormatado}* horas (${situacao}).\n\n` +
        `Esta estimativa usa base fixa de 7h20 por dia com batidas e não é o saldo consolidado. Jornada contratual, ajustes, ausências e movimentos de banco de horas devem ser conferidos na apuração do aplicativo.\n\n` +
        `* Total de dias apurados: ${diasTrabalhados}\n` +
        `* Horas trabalhadas: ${Math.floor(totalTrabalhadoMinutos / 60)}h${totalTrabalhadoMinutos % 60}m\n\n` +
        `Compensações e saídas antecipadas devem ser alinhadas previamente com a gerência da sua loja.\n\n` +
        `Consulte o espelho detalhado no aplicativo:\n${appUrl}?tab=timeclock`
      ),
    };
  }

  // 6. CONSULTA DE ESCALA E HORÁRIO DE HOJE (Opção 3 ou texto)
  if (
    readIntent === "escala" ||
    cleanText === "3" ||
    (cleanText.includes("escala") && readIntent !== "equipe") ||
    cleanText.includes("meu horario") ||
    cleanText.includes("meu horário") ||
    cleanText.includes("horario de hoje") ||
    cleanText.includes("horário de hoje") ||
    cleanText.includes("que horas entro") ||
    cleanText.includes("meu turno") ||
    cleanText.includes("jornada")
  ) {
    const schedulesData = await database(env, tok, "tables/JornadasPonto");
    const schedules = Object.values(schedulesData || {});

    const diaSemanaNum = new Date(`${queryDate}T12:00:00Z`).getUTCDay();
    const diaSemanaNome = DIAS_SEMANA[diaSemanaNum];
    const folgasData = await database(env,tok,"tables/Folgas");
    const jornadaHoje = scheduleForDay(schedules,empId,queryDate) || schedules.find(row =>
      String(row.FuncionarioID || "") === empId && row.Ativa === undefined &&
      Number(row.DiaSemana) === diaSemanaNum &&
      (!row.VigenteDe || row.VigenteDe <= queryDate) && (!row.VigenteAte || row.VigenteAte >= queryDate));
    const displayDate = queryDate.split("-").reverse().join("/");
    if (!jornadaHoje) return {handled:true,authorized:true,action:"consulta_escala",replyText:`Não encontrei uma jornada ativa para ${displayDate}. Confira a aba Ponto ou procure a gerência para confirmar seus horários.`};
    if (!workday(matchedEmp,jornadaHoje,queryDate,Object.values(folgasData || {}))) return {handled:true,authorized:true,action:"consulta_escala",replyText:`${firstName}, ${displayDate} está marcado como dia de descanso conforme a jornada e as folgas cadastradas. Confira os detalhes no aplicativo: ${appUrl}?view=timeclock`};
    const entrada = jornadaHoje.Entrada || "Não informada";
    const intervalo = jornadaHoje.SaidaIntervalo && jornadaHoje.RetornoIntervalo ? `${jornadaHoje.SaidaIntervalo} às ${jornadaHoje.RetornoIntervalo}` : "Não informado na jornada";
    const saida = jornadaHoje.Saida || "Não informada";

    return {
      handled: true,
      authorized: true,
      action: "consulta_escala",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}!\n\n` +
        `Sua escala para ${displayDate} (${diaSemanaNome}) está definida como:\n\n` +
        `* Entrada: ${entrada}\n` +
        `* Intervalo: ${intervalo}\n` +
        `* Saída: ${saida}\n` +
        `* Turno cadastrado: ${matchedEmp.Turno || "Geral"}\n\n` +
        `Consulte a escala completa no aplicativo:\n${appUrl}?tab=timeclock`
      ),
    };
  }

  // 7. ESPELHO DE PONTO / ASSINATURA DE DOCUMENTOS (Opção 4 ou texto)
  if (
    cleanText === "4" ||
    cleanText.includes("espelho") ||
    cleanText.includes("assinar") ||
    cleanText.includes("cartao de ponto") ||
    cleanText.includes("cartão de ponto") ||
    cleanText.includes("documento") ||
    cleanText.includes("recibo")
  ) {
    return {
      handled: true,
      authorized: true,
      action: "espelho_assinatura",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}!\n\n` +
        `Para conferir e assinar digitalmente seu espelho de ponto ou documentos com validade jurídica pela Portaria 671/MTE, utilize o link seguro:\n\n` +
        `* Assinar no aplicativo: ${appUrl}?tab=documents\n\n` +
        `A assinatura é realizada diretamente na tela do seu dispositivo com autenticação criptografada.`
      ),
    };
  }

  // 8. ORIENTAÇÃO DE ATESTADOS MÉDICOS (Opção 5 ou texto)
  if (
    cleanText === "5" ||
    cleanText.includes("atestado") ||
    cleanText.includes("como entregar atestado") ||
    cleanText.includes("regra de atestado")
  ) {
    return {
      handled: true,
      authorized: true,
      action: "orientacao_atestados",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}! Aqui estão as orientações oficiais para Atestados Médicos na House 190:\n\n` +
        `* Prazo: Envio em até 48 horas a partir da emissão médica.\n` +
        `* Requisitos: O documento deve conter carimbo, CRM legível, data e assinatura do médico.\n` +
        `* Envio seguro: Por exigência da LGPD, envie diretamente pelo aplicativo oficial:\n` +
        `${appUrl}?tab=documents`
      ),
    };
  }

  // 9. QUEM ESTÁ TRABALHANDO HOJE / EQUIPE DA LOJA (Opção 6 ou texto)
  if (
    readIntent === "equipe" ||
    cleanText === "6" ||
    cleanText.includes("quem ta trabalhando") ||
    cleanText.includes("quem está trabalhando") ||
    cleanText.includes("quem trabalha hoje") ||
    cleanText.includes("equipe hoje") ||
    cleanText.includes("quem esta na escala")
  ) {
    const folgasData = await database(env, tok, "tables/Folgas").catch(() => ({}));
    const allFolgas = Object.values(folgasData || {});

    const nowBahia = new Date(now - 3 * 3600000);
    const hojeStr = queryDate;

    const folgasHoje = new Set(
      allFolgas
        .filter((f) => String(f.DataInicio || f.Data || f.data || "").slice(0,10) <= hojeStr && String(f.DataFim || f.DataInicio || f.Data || f.data || "").slice(0,10) >= hojeStr && String(f.Status || "").toLowerCase() === "aprovada")
        .map((f) => String(f.FuncionarioID || f.funcionarioId || ""))
    );

    const lojaId = matchedEmp.LojaID || "";
    const colegasLoja = employees.filter((e) => {
      if (e.Ativo !== undefined && !active(e.Ativo)) return false;
      if (!lojaId) return matchedEmp.Perfil === "Administrador";
      return String(e.LojaID || "") === String(lojaId);
    });

    const escalados = [];
    const deFolga = [];

    for (const colab of colegasLoja) {
      const cId = String(colab.FuncionarioID || colab.id || "");
      if (folgasHoje.has(cId)) {
        deFolga.push(colab.Nome);
      } else {
        escalados.push(`${colab.Nome} (${colab.Turno || "Geral"})`);
      }
    }

    const linhas = [
      `Olá, ${firstName}! Aqui está a visão da equipe para ${queryDate.split("-").reverse().join("/")}:`,
      ``,
      `* Escala prevista (${escalados.length}):`,
      ...escalados.slice(0, 8).map((n) => `  - ${n}`),
    ];

    if (deFolga.length > 0) {
      linhas.push(
        ``,
        `* De folga na data (${deFolga.length}):`,
        ...deFolga.slice(0, 6).map((n) => `  - ${n}`)
      );
    }

    linhas.push(
      ``,
      `Consulte a escala completa no aplicativo:`,
      `${appUrl}?tab=timeclock`
    );

    return {
      handled: true,
      authorized: true,
      action: "equipe_hoje",
      replyText: stripHouseAIEmojis(linhas.join("\n")),
    };
  }

  // 10. POLÍTICAS DE RH E NORMAS DA CASA (Opção 7 ou texto)
  if (
    cleanText === "7" ||
    cleanText.includes("politica") ||
    cleanText.includes("política") ||
    cleanText.includes("regras da house") ||
    cleanText.includes("regra de folga")
  ) {
    return {
      handled: true,
      authorized: true,
      action: "politicas_rh",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}! Aqui está o resumo das políticas de RH do Grupo House 190:\n\n` +
        `* Escala: 6x1 com 44h semanais (7h20 diárias).\n` +
        `* Folgas: 5 folgas mensais (4 de segunda a quinta + 1 gerenciada).\n` +
        `* Trocas: Entre colegas da mesma loja e função via app até 24h antes.\n` +
        `* Ponto: Registro obrigatório pelo app com GPS e foto biométrica (Portaria 671/MTE).\n` +
        `* Atestados: Entrega em até 48h pelo app na aba Meus Documentos.\n\n` +
        `Acesse o sistema oficial: ${appUrl}`
      ),
    };
  }

  // 11. AJUSTES DE PONTO / ESQUECI DE BATER PONTO
  if (
    cleanText.includes("ajuste") ||
    cleanText.includes("esqueci") ||
    cleanText.includes("esqueci de bater") ||
    cleanText.includes("corrigir ponto")
  ) {
    return {
      handled: true,
      authorized: true,
      action: "ajuste_ponto",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}!\n\n` +
        `Caso tenha esquecido de registrar alguma batida de ponto, solicite a regularização no app:\n\n` +
        `1. Acesse a aba Ponto Eletrônico.\n` +
        `2. Clique em "Solicitar Ajuste de Ponto".\n` +
        `3. Informe o dia, o horário real e a justificativa para avaliação do gerente.\n\n` +
        `Acesse o aplicativo: ${appUrl}?tab=timeclock`
      ),
    };
  }

  // 12. CARDÁPIO E OPERAÇÃO HOUSE BURGER / FOODPARK
  if (
    cleanText.includes("cardapio") ||
    cleanText.includes("cardápio") ||
    cleanText.includes("lanche") ||
    cleanText.includes("hamburguer") ||
    cleanText.includes("house burger")
  ) {
    return {
      handled: true,
      authorized: true,
      action: "cardapio_operacao",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}!\n\n` +
        `A House Burger é especialista em hambúrgueres artesanais e smash burgers com padrão rigoroso de qualidade e sabor.\n\n` +
        `Nossas operações contam com praças integradas pelo CozinhaFlow (Chapa, Fritadeira, Montagem e Expedição).\n\n` +
        `Acesse fichas e tarefas no CozinhaFlow: ${appUrl}?tab=tasks`
      ),
    };
  }

  // 13. REGRAS DE COZINHA, HIGIENE E UNIFORME
  if (
    cleanText.includes("cozinha") ||
    cleanText.includes("higiene") ||
    cleanText.includes("uniforme") ||
    cleanText.includes("calcado") ||
    cleanText.includes("calçado")
  ) {
    return {
      handled: true,
      authorized: true,
      action: "regras_cozinha",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}! Normas de Boas Práticas e Higiene da House 190:\n\n` +
        `* Touca descartável obrigatória cobrindo todo o cabelo.\n` +
        `* Lavagem rigorosa das mãos a cada 30 minutos e ao mudar de praça.\n` +
        `* Uniforme limpo e calçado de segurança antiderrapante fechado.\n` +
        `* Unhas curtas, sem esmalte, e proibição de anéis/brincos em manipulação.\n\n` +
        `Acesse as tarefas no CozinhaFlow: ${appUrl}?tab=tasks`
      ),
    };
  }

  // 14. ADICIONAL NOTURNO
  if (
    cleanText.includes("adicional noturno") ||
    cleanText.includes("hora noturna")
  ) {
    return {
      handled: true,
      authorized: true,
      action: "adicional_noturno",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}! O adicional noturno na House 190 segue estritamente a CLT:\n\n` +
        `* Horário: Trabalho realizado entre 22:00 e 05:00.\n` +
        `* Adicional: 20% sobre o valor da hora normal de trabalho.\n` +
        `* Hora reduzida: Cada hora noturna é computada em 52 minutos e 30 segundos.\n\n` +
        `O cálculo é apurado automaticamente no seu espelho de ponto no final do ciclo mensal.`
      ),
    };
  }

  // 15. TENTATIVA COM GEMINI AI SE CONFIGURADO
  const geminiApiKey = env.GEMINI_API_KEY || (await database(env, tok, "tables/Configuracoes/GeminiConfig").catch(() => null))?.apiKey;
  if (geminiApiKey) {
    try {
      const prompt = `Você é a House AI, assistente inteligente e operacional do Grupo House 190 (hamburgueria, restaurante e delivery).
O colaborador que está conversando com você se chama ${firstName} (${matchedEmp.Cargo || "Colaborador"}, Loja: ${matchedEmp.NomeLoja || "House 190"}).
Regras Inegociáveis:
1. ZERO EMOJIS: Não use nenhum emoji.
2. PORTARIA 671/MTE: Jamais permita bater ponto por mensagem de WhatsApp.
3. LGPD: Não solicite nem receba dados médicos/CIDs no WhatsApp aberto.
4. Linguagem elegante, acolhedora, objetiva e profissional em português do Brasil.

Pergunta do colaborador: "${text}"

Responda de forma precisa e útil:`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
      const gRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (gRes.ok) {
        const gData = await gRes.json();
        const candidateText = gData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          const finalReply = stripHouseAIEmojis(candidateText) + `\n\nAcesse o aplicativo oficial: ${appUrl}`;
          return {
            handled: true,
            authorized: true,
            action: "gemini_response",
            replyText: finalReply,
          };
        }
      }
    } catch (_) {}
  }

  // 16. CANAL DE ATENDIMENTO / MENU GERAL (oi, olá, menu, ajuda, etc.)
  return {
    handled: true,
    authorized: true,
    action: "menu_geral",
    replyText: stripHouseAIEmojis(
      `Olá, ${firstName}!\n` +
      `Sou a House AI, assistente inteligente e operacional do Grupo House 190.\n\n` +
      `Como posso ajudar você hoje? Envie uma das opções abaixo ou digite sua dúvida:\n\n` +
      `• Folgas (consultar folgas do mês e saldo)\n` +
      `• Banco de horas (horas trabalhadas e saldo)\n` +
      `• Minha escala (horário e turno de hoje)\n` +
      `• Minhas tarefas (atividades em aberto)\n` +
      `• Pedir folga (solicitar folga para uma data)\n` +
      `• Meus documentos (espelho de ponto e assinatura)\n` +
      `• Políticas da casa (regras de RH e escala)\n\n` +
      `Acesso direto ao portal oficial:\n${appUrl}`
    ),
  };
}
