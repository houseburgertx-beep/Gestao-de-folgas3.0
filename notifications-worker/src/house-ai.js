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
  if (digits.startsWith("55") && digits.length === 13) {
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

  const last8 = String(phone).replace(/\D/g, "").slice(-8);

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
      // Fallback: se os últimos 8 dígitos coincidirem e DDD coincidir
      const rawDigits = String(raw).replace(/\D/g, "");
      if (last8.length === 8 && rawDigits.endsWith(last8)) {
        return emp;
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

/**
 * Extrai data (YYYY-MM-DD) a partir de termos naturais em português
 */
export function extractDateFromText(text, now = Date.now()) {
  const norm = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const nowBahia = new Date(now - 3 * 3600000);
  const curYear = nowBahia.getFullYear();
  const curMonth = nowBahia.getMonth();
  const curDate = nowBahia.getDate();

  // 1. DD/MM/YYYY
  const mFull = norm.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mFull) {
    const d = String(mFull[1]).padStart(2, "0");
    const m = String(mFull[2]).padStart(2, "0");
    const y = mFull[3];
    return `${y}-${m}-${d}`;
  }

  // 2. DD/MM
  const mShort = norm.match(/(\d{1,2})\/(\d{1,2})/);
  if (mShort) {
    const d = String(mShort[1]).padStart(2, "0");
    const m = Number(mShort[2]);
    let y = curYear;
    if (m < curMonth + 1) y++;
    return `${y}-${String(m).padStart(2, "0")}-${d}`;
  }

  // 3. 'amanha' / 'depois de amanha'
  if (norm.includes("amanha")) {
    const target = new Date(nowBahia);
    target.setDate(curDate + (norm.includes("depois de amanha") ? 2 : 1));
    return target.toISOString().slice(0, 10);
  }

  // 4. 'hoje'
  if (norm.includes("hoje")) {
    return nowBahia.toISOString().slice(0, 10);
  }

  // 5. 'dia XX'
  const mDia = norm.match(/dia\s+(\d{1,2})/);
  if (mDia) {
    const d = Number(mDia[1]);
    let m = curMonth + 1;
    let y = curYear;
    if (d < curDate) {
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // 6. Dias da semana
  const dias = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  for (let i = 0; i < dias.length; i++) {
    if (norm.includes(dias[i])) {
      const target = new Date(nowBahia);
      let diff = (i - nowBahia.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      target.setDate(curDate + diff);
      return target.toISOString().slice(0, 10);
    }
  }

  return null;
}

/**
 * Gera mensagem motivacional para marcações de ponto (Entrada, Saída, Intervalo)
 */
export function generateMotivationalTimeClockMessage({ type, employeeName, timeStr }) {
  const firstName = String(employeeName || "Colaborador").trim().split(/\s+/)[0];
  const time = timeStr || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (type === "ENTRADA") {
    const mensagens = [
      `Olá, ${firstName}! Bom início de turno na House 190!\n\n` +
      `Seu ponto de ENTRADA foi registrado às ${time} com sucesso.\n\n` +
      `Desejamos uma jornada produtiva, com foco, energia e excelente trabalho em equipe. O sucesso do nosso salão e da nossa cozinha depende da dedicação de cada um de nós. Tenha um excelente trabalho hoje!`,

      `Olá, ${firstName}! Ponto de ENTRADA confirmado às ${time}.\n\n` +
      `Comece este turno com entusiasmo e compromisso com a excelência. Nosso time é forte porque cada colaborador faz a diferença. Desejamos uma jornada brilhante e cheia de realizações na House 190!`,

      `Olá, ${firstName}! Entrada registrada às ${time} com sucesso.\n\n` +
      `Que seu turno na House 190 seja marcado pela agilidade, cooperação e pelo melhor atendimento aos nossos clientes. Bom trabalho e estamos juntos nesta missão!`,
    ];
    return stripHouseAIEmojis(mensagens[Math.floor(Math.random() * mensagens.length)]);
  }

  if (type === "SAIDA") {
    const mensagens = [
      `Excelente descanso, ${firstName}!\n\n` +
      `Sua jornada de hoje foi finalizada e registrada às ${time} com sucesso.\n\n` +
      `Agradecemos imensamente por todo o seu empenho, dedicação e energia dedicados ao Grupo House 190 hoje. Descanse bastante e recarregue as energias para o próximo turno!`,

      `Turno concluído com sucesso, ${firstName}!\n\n` +
      `Ponto de SAÍDA registrado às ${time}.\n\n` +
      `Parabéns pela entrega, dedicação e profissionalismo de hoje. O Grupo House 190 tem muito orgulho de ter você em nosso time. Tenha um ótimo descanso!`,

      `Jornada finalizada, ${firstName}!\n\n` +
      `Saída registrada às ${time}.\n\n` +
      `Seu trabalho de hoje fez a diferença para o nosso time e nossos clientes. Agora é hora de descansar e desfrutar do seu tempo livre. Um excelente descanso e até breve!`,
    ];
    return stripHouseAIEmojis(mensagens[Math.floor(Math.random() * mensagens.length)]);
  }

  if (type === "SAIDA_INTERVALO") {
    return stripHouseAIEmojis(
      `Bom intervalo, ${firstName}!\n\n` +
      `Sua saída para descanso foi registrada às ${time}.\n\n` +
      `Aproveite sua pausa para se alimentar com calma e recuperar o fôlego regulamentar.`
    );
  }

  if (type === "RETORNO_INTERVALO") {
    return stripHouseAIEmojis(
      `Bem-vindo(a) de volta do intervalo, ${firstName}!\n\n` +
      `Seu retorno foi registrado às ${time}.\n\n` +
      `Desejamos uma ótima continuidade de turno e um excelente fechamento de dia!`
    );
  }

  return "";
}

/**
 * Processa a mensagem de WhatsApp recebida e retorna o texto de resposta House AI
 */
export async function processInboundHouseAI({
  from,
  text = "",
  pushName = "",
  env,
  database,
  tok,
  now = Date.now(),
}) {
  const normPhone = normalizeWhatsAppPhone(from);
  const cleanPhone = normPhone ? normPhone.digits : String(from || "").replace(/\D/g, "");
  const cleanText = stripHouseAIEmojis(text).toLowerCase().trim();
  const appUrl = (env.APP_URL || "https://houseburgertx-beep.github.io/Gestao-de-folgas3.0/").replace(/\/+$/, "") + "/";

  // 1. Busca Colaboradores e Perfis do Firebase RTDB
  const [employeesData, accessData, connData] = await Promise.all([
    database(env, tok, "tables/Funcionarios").catch(() => ({})),
    database(env, tok, "access").catch(() => ({})),
    database(env, tok, "tables/Configuracoes/WhatsAppConnection").catch(() => ({})),
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

  // Se o número corresponder ao Administrador ou telefone configurado de gestão/administração da House 190
  const searchVariants = getPhoneVariants(cleanPhone);
  const knownAdminPhones = ["5573991740014", "557391740014", "73991740014", "7391740014"];
  if (!matchedEmp && (knownAdminPhones.some((ap) => searchVariants.includes(ap) || cleanPhone.endsWith(ap.slice(-8))))) {
    matchedEmp = {
      FuncionarioID: "func_gleuce_demo",
      Nome: "Gleuce Dias (Administrador)",
      Perfil: "Administrador",
      Turno: "Geral",
      Telefone: "73991740014",
    };
  }

  if (!matchedEmp && connData?.Phone) {
    const adminVariants = getPhoneVariants(connData.Phone);
    if (adminVariants.some((v) => searchVariants.includes(v))) {
      matchedEmp = {
        FuncionarioID: "admin-gestor",
        Nome: connData.AtualizadoPor || "Administrador",
        Perfil: "Administrador",
        Turno: "Administrativo",
        Telefone: connData.Phone,
      };
    }
  }

  if (!matchedEmp) {
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

  const firstName = String(matchedEmp.Nome || pushName || "Colaborador").trim().split(/\s+/)[0];
  const empId = String(matchedEmp.FuncionarioID || matchedEmp.id || "");

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
      poll: {
        question: "Como posso te ajudar hoje?",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Pedir Folga",
          "Políticas da Casa",
        ],
        selectableCount: 1,
      },
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
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Pedir Folga",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
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
    (cleanText.includes("folga") && (
      cleanText.includes("dia") ||
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
      /\d{1,2}\/\d{1,2}/.test(cleanText)
    ) && !cleanText.includes("quantas") && !cleanText.includes("saldo") && !cleanText.includes("minhas"));

  if (isTimeOffAction) {
    const targetDate = extractDateFromText(text, now);

    if (!targetDate) {
      return {
        handled: true,
        authorized: true,
        action: "solicitar_data_folga",
        replyText: stripHouseAIEmojis(
          `Olá, ${firstName}!\n\n` +
          `Para qual data você gostaria de solicitar a folga?\n\n` +
          `Por favor, me informe o dia desejado, por exemplo:\n` +
          `* "Quero folga dia 15/11"\n` +
          `* "Solicitar folga amanhã"\n` +
          `* "Folga na próxima terça"\n\n` +
          `Ou selecione uma data no calendário pelo aplicativo oficial:\n${appUrl}?tab=timeoff`
        ),
        poll: {
          question: "Ações rápidas:",
          options: [
            "Folga Amanhã",
            "Minhas Folgas",
            "Banco de Horas",
            "Minha Escala",
            "Menu Principal",
          ],
          selectableCount: 1,
        },
      };
    }

    const isGestorOrAdmin =
      ["Administrador", "Gerente", "Responsável de loja"].includes(matchedEmp.Perfil) ||
      matchedEmp.FuncionarioID === "admin-gestor" ||
      matchedEmp.FuncionarioID === "func_gleuce_demo";

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

    const folgasData = await database(env, tok, "tables/Folgas").catch(() => ({}));
    const allFolgas = Object.values(folgasData || {});
    const targetEmpId = String(targetEmp.FuncionarioID || targetEmp.funcionarioId || targetEmp.id || "");
    const targetEmpNome = String(targetEmp.Nome || targetEmp.nome || "Colaborador");
    const targetEmpEmail = String(targetEmp.Email || targetEmp.email || "");
    const targetEmpLojaId = String(targetEmp.LojaID || targetEmp.lojaId || "");
    const targetEmpNomeLoja = String(targetEmp.NomeLoja || targetEmp.nomeLoja || "House 190");

    // Verifica se já existe folga ativa para o colaborador nessa data
    const existingFolga = allFolgas.find((f) => {
      const fEmpId = String(f.FuncionarioID || f.funcionarioId || "");
      const fDate = String(f.Data || f.data || f.DataInicio || "");
      const fStatus = String(f.Status || "").toLowerCase();
      return fEmpId === targetEmpId && fDate === targetDate && fStatus !== "cancelada" && fStatus !== "rejeitada";
    });

    const [y, m, d] = targetDate.split("-");
    const dataBR = `${d}/${m}/${y}`;

    if (existingFolga) {
      const st = existingFolga.Status || "Registrada";
      return {
        handled: true,
        authorized: true,
        action: "folga_existente",
        replyText: stripHouseAIEmojis(
          `Atenção, ${firstName}!\n\n` +
          `${targetEmpNome === matchedEmp.Nome ? "Você" : targetEmpNome} já possui uma folga com status *${st}* para o dia *${dataBR}* no sistema.\n\n` +
          `Consulte a escala completa no aplicativo oficial:\n${appUrl}?tab=timeoff`
        ),
        poll: {
          question: "Como deseja prosseguir?",
          options: [
            "Minhas Folgas",
            "Banco de Horas",
            "Minha Escala",
            "Pedir Nova Folga",
            "Menu Principal",
          ],
          selectableCount: 1,
        },
      };
    }

    // Se foi concedida por Gestor/Admin para colaborador ou com termo de aprovação direta
    const isGrantedDirectly =
      isGestorOrAdmin &&
      (targetEmp !== matchedEmp || cleanText.includes("aprovar") || cleanText.includes("conceder") || cleanText.includes("dar folga"));
    const status = isGrantedDirectly ? "Aprovada" : (isGestorOrAdmin ? "Aprovada" : "Pendente");
    const folgaId = `folga-wa-${Date.now()}`;

    const folgaRecord = {
      FolgaID: folgaId,
      FuncionarioID: targetEmpId,
      NomeFuncionario: targetEmpNome,
      EmailFuncionario: targetEmpEmail,
      LojaID: targetEmpLojaId,
      NomeLoja: targetEmpNomeLoja,
      DataInicio: targetDate,
      DataFim: targetDate,
      Data: targetDate,
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

    // 1. Grava diretamente no Firebase Realtime Database
    const folgaUrl = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/Folgas/${folgaId}.json`;
    const folgaPutRes = await fetch(folgaUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(folgaRecord),
      signal: AbortSignal.timeout(10000),
    });
    if (!folgaPutRes.ok) {
      throw new Error(`firebase_put_error_${folgaPutRes.status}`);
    }

    // Se aprovada diretamente pelo Gestor/Admin, debita saldo e registra movimento
    if (status === "Aprovada" && targetEmpId) {
      const currentBalance = Number(targetEmp.SaldoFolgas ?? 0);
      const newBalance = Math.max(0, currentBalance - 1);
      const movementKey = `folga-${folgaId}`;
      const empPatchUrl = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/Funcionarios/${encodeURIComponent(targetEmpId)}.json`;
      await fetch(empPatchUrl, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          SaldoFolgas: newBalance,
          [`SaldoFolgasLancamentos/${movementKey}`]: {
            FolgaID: folgaId,
            Delta: -1,
            Quantidade: 1,
            Tipo: "Débito de folga aprovada",
            DataInicio: targetDate,
            DataFim: targetDate,
            DataAtualizacao: new Date().toISOString(),
          },
        }),
        signal: AbortSignal.timeout(10000),
      }).catch((e) => console.warn("Erro ao debitar SaldoFolgas:", e));

      const movId = `mov-${folgaId}`;
      const movUrl = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/MovimentosSaldoFolgas/${movId}.json`;
      await fetch(movUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          MovimentoID: movId,
          FolgaID: folgaId,
          FuncionarioID: targetEmpId,
          LojaID: targetEmpLojaId,
          Tipo: "Debito",
          Quantidade: 1,
          SaldoAnterior: currentBalance,
          SaldoNovo: newBalance,
          Motivo: `Folga aprovada via WhatsApp para ${dataBR}`,
          DataCriacao: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => {});
    }

    // 2. Grava notificação no Firebase RTDB tables/Notificacoes
    const notifId = `notif-wa-${Date.now()}`;
    const notifUrl = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables/Notificacoes/${notifId}.json`;
    await fetch(notifUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        NotificacaoID: notifId,
        LojaID: targetEmpLojaId,
        DestinatarioID: status === "Aprovada" ? targetEmpId : "",
        Tipo: "Folga",
        Assunto: status === "Aprovada" ? "Folga Aprovada via WhatsApp" : "Nova Solicitação de Folga via WhatsApp",
        Mensagem: status === "Aprovada"
          ? `Folga confirmada para ${targetEmpNome} na data ${dataBR}.`
          : `${targetEmpNome} solicitou folga para ${dataBR} via WhatsApp.`,
        Status: "NaoLida",
        DataCriacao: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(6000),
    }).catch(() => {});

    if (status === "Aprovada") {
      return {
        handled: true,
        authorized: true,
        action: "folga_aprovada_whatsapp",
        replyText: stripHouseAIEmojis(
          `Confirmado, ${firstName}!\n\n` +
          `A folga para *${targetEmpNome}* na data *${dataBR}* foi APROVADA e registrada diretamente no sistema oficial da House 190 com sucesso.\n\n` +
          `* Colaborador: ${targetEmpNome}\n` +
          `* Loja: ${targetEmpNomeLoja}\n` +
          `* Data: ${dataBR} (Dia inteiro)\n` +
          `* Status: Aprovada\n\n` +
          `Acesse a escala atualizada no aplicativo:\n${appUrl}?tab=timeoff`
        ),
        poll: {
          question: "Selecione o próximo serviço:",
          options: [
            "Minhas Folgas",
            "Banco de Horas",
            "Minha Escala",
            "Pedir Nova Folga",
            "Políticas da Casa",
          ],
          selectableCount: 1,
        },
      };
    }

    return {
      handled: true,
      authorized: true,
      action: "folga_solicitada_whatsapp",
      replyText: stripHouseAIEmojis(
        `Perfeito, ${firstName}!\n\n` +
        `Seu pedido de folga para o dia *${dataBR}* foi registrado no sistema oficial com sucesso!\n\n` +
        `* Status: Pendente de aprovação da gerência\n` +
        `* Protocolo: ${folgaId}\n\n` +
        `Assim que o gerente da sua loja avaliar a solicitação, você receberá a confirmação aqui pelo WhatsApp.\n\n` +
        `Acompanhe seu pedido no aplicativo:\n${appUrl}?tab=timeoff`
      ),
      poll: {
        question: "Outros serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Políticas da Casa",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
    };
  }

  // 5. CONSULTA DE FOLGAS E ESCALA DE FOLGAS (Opção 1 ou texto)
  if (
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

    // Data atual no fuso de Brasília/Bahia (UTC-3)
    const nowBahia = new Date(now - 3 * 3600000);
    const mesAtual = nowBahia.toISOString().slice(0, 7);
    const hojeStr = nowBahia.toISOString().slice(0, 10);

    const minhasFolgasMes = allFolgas.filter((f) => {
      const fEmpId = String(f.FuncionarioID || f.funcionarioId || "");
      const fDate = String(f.Data || f.data || "").slice(0, 7);
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
        const d = String(f.Data || f.data || "");
        const parts = d.split("-");
        return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
      })
      .filter(Boolean)
      .join(", ");

    // Próxima folga futura a partir de hoje
    const proximasFolgas = allFolgas
      .filter((f) => {
        const fEmpId = String(f.FuncionarioID || f.funcionarioId || "");
        const fDate = String(f.Data || f.data || "");
        const status = String(f.Status || "").toLowerCase();
        return fEmpId === empId && fDate >= hojeStr && status === "aprovada";
      })
      .sort((a, b) => String(a.Data || a.data).localeCompare(String(b.Data || b.data)));

    let proximaTexto = "";
    if (proximasFolgas.length > 0) {
      const prox = proximasFolgas[0];
      const pDate = String(prox.Data || prox.data || "");
      const parts = pDate.split("-");
      proximaTexto = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : pDate;
    }

    const saldoRestante = Math.max(0, 5 - aprovadas.length);

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
      poll: {
        question: "Ações de Folgas:",
        options: [
          "Pedir Folga Amanhã",
          "Banco de Horas",
          "Minha Escala",
          "Políticas da Casa",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
    };
  }

  // 5. CONSULTA DE BANCO DE HORAS (Opção 2 ou texto)
  if (
    cleanText === "2" ||
    cleanText.includes("banco de horas") ||
    cleanText.includes("saldo de horas") ||
    cleanText.includes("horas extras") ||
    cleanText.includes("horas negativas") ||
    cleanText.includes("meu saldo") ||
    cleanText.includes("saldo atual") ||
    cleanText.includes("saldo")
  ) {
    const punchesData = await database(env, tok, "tables/RegistroPonto").catch(() => ({}));
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
      list.push(mins);
      punchesByDay.set(dataStr, list);
    }

    let totalTrabalhadoMinutos = 0;
    let diasTrabalhados = 0;

    for (const [_, minsList] of punchesByDay.entries()) {
      minsList.sort((a, b) => a - b);
      let dayWorked = 0;
      for (let i = 0; i < minsList.length - 1; i += 2) {
        dayWorked += Math.max(0, minsList[i + 1] - minsList[i]);
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
        `Seu saldo atual no banco de horas é de *${saldoFormatado}* horas (${situacao}).\n\n` +
        `* Total de dias apurados: ${diasTrabalhados}\n` +
        `* Horas trabalhadas: ${Math.floor(totalTrabalhadoMinutos / 60)}h${totalTrabalhadoMinutos % 60}m\n\n` +
        `Compensações e saídas antecipadas devem ser alinhadas previamente com a gerência da sua loja.\n\n` +
        `Consulte o espelho detalhado no aplicativo:\n${appUrl}?tab=timeclock`
      ),
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Minha Escala",
          "Pedir Folga",
          "Espelho de Ponto",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
    };
  }

  // 6. CONSULTA DE ESCALA E HORÁRIO DE HOJE (Opção 3 ou texto)
  if (
    cleanText === "3" ||
    cleanText.includes("escala") ||
    cleanText.includes("meu horario") ||
    cleanText.includes("meu horário") ||
    cleanText.includes("horario de hoje") ||
    cleanText.includes("horário de hoje") ||
    cleanText.includes("que horas entro") ||
    cleanText.includes("meu turno") ||
    cleanText.includes("jornada")
  ) {
    const schedulesData = await database(env, tok, "tables/JornadasPonto").catch(() => ({}));
    const schedules = Object.values(schedulesData || {});

    const nowBahia = new Date(now - 3 * 3600000);
    const diaSemanaNum = nowBahia.getDay();
    const diaSemanaNome = DIAS_SEMANA[diaSemanaNum];

    const empSchedules = schedules.filter(
      (s) => String(s.FuncionarioID || s.funcionarioId || "") === empId
    );
    const jornadaHoje = empSchedules.find(
      (s) => Number(s.DiaSemana ?? s.diaSemana) === diaSemanaNum
    ) || empSchedules[0];

    const entrada = jornadaHoje?.Entrada || jornadaHoje?.entrada || "Definido por escala";
    const intervalo = jornadaHoje?.SaidaIntervalo && jornadaHoje?.RetornoIntervalo
      ? `${jornadaHoje.SaidaIntervalo} às ${jornadaHoje.RetornoIntervalo}`
      : "1h de intervalo regulamentar";
    const saida = jornadaHoje?.Saida || jornadaHoje?.saida || "Conforme escala";

    return {
      handled: true,
      authorized: true,
      action: "consulta_escala",
      replyText: stripHouseAIEmojis(
        `Olá, ${firstName}!\n\n` +
        `Sua escala para hoje (${diaSemanaNome}) está definida como:\n\n` +
        `* Entrada: ${entrada}\n` +
        `* Intervalo: ${intervalo}\n` +
        `* Saída: ${saida}\n` +
        `* Turno cadastrado: ${matchedEmp.Turno || "Geral"}\n\n` +
        `Consulte a escala completa no aplicativo:\n${appUrl}?tab=timeclock`
      ),
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Pedir Folga",
          "Quem Trabalha Hoje",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
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
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Pedir Folga",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
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
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Pedir Folga",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
    };
  }

  // 9. QUEM ESTÁ TRABALHANDO HOJE / EQUIPE DA LOJA (Opção 6 ou texto)
  if (
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
    const hojeStr = nowBahia.toISOString().slice(0, 10);

    const folgasHoje = new Set(
      allFolgas
        .filter((f) => (f.Data || f.data) === hojeStr && String(f.Status || "").toLowerCase() === "aprovada")
        .map((f) => String(f.FuncionarioID || f.funcionarioId || ""))
    );

    const lojaId = matchedEmp.LojaID || "";
    const colegasLoja = employees.filter((e) => {
      if (!lojaId) return true;
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
      `Olá, ${firstName}! Aqui está a visão da equipe para hoje:`,
      ``,
      `* Em atividade (${escalados.length}):`,
      ...escalados.slice(0, 8).map((n) => `  - ${n}`),
    ];

    if (deFolga.length > 0) {
      linhas.push(
        ``,
        `* De folga hoje (${deFolga.length}):`,
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
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Pedir Folga",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
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
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Pedir Folga",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
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
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Pedir Folga",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
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
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Pedir Folga",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
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
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Pedir Folga",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
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
      poll: {
        question: "Serviços House 190:",
        options: [
          "Minhas Folgas",
          "Banco de Horas",
          "Minha Escala",
          "Pedir Folga",
          "Menu Principal",
        ],
        selectableCount: 1,
      },
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
            poll: {
              question: "Serviços House 190:",
              options: [
                "Minhas Folgas",
                "Banco de Horas",
                "Minha Escala",
                "Pedir Folga",
                "Menu Principal",
              ],
              selectableCount: 1,
            },
          };
        }
      }
    } catch (_) {}
  }

  // 16. CANAL DE ATENDIMENTO / MENU GERAL INTERATIVO (0, olá, oi, etc.)
  return {
    handled: true,
    authorized: true,
    action: "menu_geral",
    replyText: stripHouseAIEmojis(
      `Olá, ${firstName}!\n` +
      `Sou a House AI, assistente inteligente e operacional do Grupo House 190.\n\n` +
      `Selecione o serviço desejado na caixa de seleção abaixo ou envie sua dúvida diretamente por mensagem:\n\n` +
      `Acesso direto ao portal oficial: ${appUrl}`
    ),
    poll: {
      question: "Selecione o serviço desejado:",
      options: [
        "Minhas Folgas",
        "Banco de Horas",
        "Minha Escala",
        "Pedir Folga",
        "Espelho de Ponto",
        "Políticas da Casa",
      ],
      selectableCount: 1,
    },
  };
}
