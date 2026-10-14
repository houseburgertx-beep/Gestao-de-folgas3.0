// ==========================================================================
// COPILOTO HOUSE 190 — Assistente Operacional Ativo com Gemini Flash
// Folgas 3.0 & CozinhaFlow
// Estritamente sem emojis, com confirmação obrigatória e controle RBAC
// ==========================================================================

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const esc = (x) =>
  String(x ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

// ==========================================================================
// PERMISSÕES E RBAC
// ==========================================================================

export function getUserRole(user) {
  if (!user) return "employee";
  const p = String(user.Perfil || user.perfil || user.role || "").toLowerCase();
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (p.includes("admin") || perms.includes("*")) return "admin";
  if (p.includes("gerente") || p.includes("respons")) return "manager";
  return "employee";
}

export function getUserStoreId(user) {
  return String(user?.LojaID || user?.lojaId || user?.Loja || "").trim();
}

export function getUserId(user) {
  return String(user?.FuncionarioID || user?.funcionarioId || user?.id || user?.UsuarioID || "").trim();
}

export function getUserName(user) {
  return String(user?.Nome || user?.nome || user?.NomeCompleto || "Colaborador").trim();
}

// ==========================================================================
// GERENCIAMENTO DA CHAVE DO GOOGLE GEMINI FLASH
// ==========================================================================

const GEMINI_STORAGE_KEY = "gf-gemini-api-key";

export function getGeminiApiKey() {
  try {
    return (
      (typeof localStorage !== "undefined" ? localStorage.getItem(GEMINI_STORAGE_KEY) : "") ||
      window?.__GESTAO_STATE__?.config?.geminiApiKey ||
      ""
    ).trim();
  } catch (_) {
    return "";
  }
}

export function setGeminiApiKey(key) {
  try {
    if (typeof localStorage === "undefined") return;
    if (key) {
      localStorage.setItem(GEMINI_STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(GEMINI_STORAGE_KEY);
    }
  } catch (_) {}
}

// Declaração de Ferramentas para o Gemini Function Calling
export const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "criarTarefaCozinha",
        description: "Cria uma nova tarefa na cozinha no CozinhaFlow com responsável, prioridade e prazo",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Título da tarefa operacional" },
            responsavelNome: { type: "STRING", description: "Nome do colaborador responsável" },
            prioridade: { type: "STRING", enum: ["Baixa", "Normal", "Alta", "Urgente"], description: "Nível de prioridade" },
            prazo: { type: "STRING", description: "Prazo ou horário (ex: hoje às 18h)" },
          },
          required: ["titulo"],
        },
      },
      {
        name: "concluirTarefa",
        description: "Marca uma tarefa no CozinhaFlow como concluída",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Título ou parte do nome da tarefa a ser concluída" },
          },
        },
      },
      {
        name: "alterarTurno",
        description: "Altera o turno de trabalho de um colaborador na escala",
        parameters: {
          type: "OBJECT",
          properties: {
            nome: { type: "STRING", description: "Nome do colaborador" },
            novoTurno: { type: "STRING", enum: ["Manhã", "Tarde", "Noite", "Integral"], description: "Novo turno" },
          },
          required: ["nome", "novoTurno"],
        },
      },
      {
        name: "alterarFolgaFixa",
        description: "Altera o dia da folga fixa semanal de um colaborador na escala",
        parameters: {
          type: "OBJECT",
          properties: {
            nome: { type: "STRING", description: "Nome do colaborador" },
            novoDia: { type: "STRING", description: "Dia da semana (ex: Segunda-feira, Terça-feira)" },
          },
          required: ["nome", "novoDia"],
        },
      },
      {
        name: "solicitarFolga",
        description: "Solicita um dia de folga pontual para o colaborador logado",
        parameters: {
          type: "OBJECT",
          properties: {
            data: { type: "STRING", description: "Data da folga no formato AAAA-MM-DD ou DD/MM/AAAA" },
            motivo: { type: "STRING", description: "Motivo da solicitação de folga" },
          },
          required: ["data"],
        },
      },
      {
        name: "aprovarTrocaFolga",
        description: "Aprova uma troca de folga pendente entre colaboradores",
        parameters: {
          type: "OBJECT",
          properties: {
            colaborador: { type: "STRING", description: "Nome de um dos colaboradores envolvidos na troca" },
          },
        },
      },
      {
        name: "publicarComunicado",
        description: "Publica um comunicado oficial para a loja ou rede",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Título do comunicado" },
            mensagem: { type: "STRING", description: "Texto completo do aviso" },
            destino: { type: "STRING", enum: ["Loja local", "Toda a rede"], description: "Destinatários" },
          },
          required: ["titulo", "mensagem"],
        },
      },
    ],
  },
];

// Helper para localizar funcionário por menção em texto ou nome
export function findEmployeeInText(textToSearch, employees = []) {
  if (!textToSearch) return null;
  const cleanText = String(textToSearch).toLowerCase();
  for (const emp of employees) {
    const fullName = String(emp.Nome || emp.nome || "").toLowerCase();
    const firstName = fullName.split(" ")[0];
    if (new RegExp(`(?:para|de|do|da)\\s+${fullName}\\b`, "i").test(cleanText)) return emp;
    if (new RegExp(`(?:para|de|do|da)\\s+${firstName}\\b`, "i").test(cleanText)) return emp;
  }
  for (const emp of employees) {
    const fullName = String(emp.Nome || emp.nome || "").toLowerCase();
    const firstName = fullName.split(" ")[0];
    if (new RegExp(`\\b${fullName}\\b`, "i").test(cleanText)) return emp;
    if (new RegExp(`\\b${firstName}\\b`, "i").test(cleanText)) return emp;
  }
  return null;
}

// ==========================================================================
// CONVERSOR DE FUNCTION CALL (GEMINI) PARA AÇÃO DO SISTEMA
// ==========================================================================

export function convertFunctionCallToAction(name, args = {}, context = {}) {
  const user = context.user || {};
  const role = getUserRole(user);
  const userStore = getUserStoreId(user);
  const userId = getUserId(user);
  const userName = getUserName(user);
  const employees = Array.isArray(context.employees) ? context.employees : [];
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  const swaps = Array.isArray(context.swaps) ? context.swaps : [];

  switch (name) {
    case "criarTarefaCozinha": {
      if (role === "employee") {
        return {
          type: "error",
          message: "A criação e delegação de tarefas na cozinha requer permissão de Gerente ou Administrador.",
        };
      }

      const titulo = String(args.titulo || "Higienização e organização operacional").trim();
      const prioridade = String(args.prioridade || "Normal").trim();
      const prazo = String(args.prazo || "").trim();
      let targetEmployee = null;
      if (args.responsavelNome) {
        targetEmployee = findEmployeeInText(args.responsavelNome, employees);
      }

      if (targetEmployee && role === "manager" && userStore) {
        const empStore = String(targetEmployee.LojaID || targetEmployee.lojaId || "");
        if (empStore && empStore !== userStore) {
          return {
            type: "error",
            message: `O colaborador ${targetEmployee.Nome} pertence a outra unidade. Você pode delegar tarefas apenas para a sua loja.`,
          };
        }
      }

      const payload = {
        TITULO: titulo,
        DESCRICAO: `Tarefa criada pelo Copiloto House 190 (Gemini) a pedido de ${userName}.`,
        PRIORIDADE: prioridade,
        PRAZO: prazo,
        RESPONSAVEL_ID: targetEmployee ? String(targetEmployee.FuncionarioID || targetEmployee.id || "") : "",
        RESPONSAVEL_NOME: targetEmployee ? String(targetEmployee.Nome || "") : "Equipe da Cozinha",
        LojaID: targetEmployee?.LojaID || userStore,
        STATUS: "A fazer",
      };

      return {
        type: "action",
        actionType: "create_task",
        title: "Criar Tarefa no CozinhaFlow",
        apiMethod: "cozinhaTasksSave",
        apiArgs: [payload],
        summary: `Criar a tarefa "${titulo}" atribuída a ${payload.RESPONSAVEL_NOME} com prioridade ${prioridade}.`,
        diff: [
          { label: "Título", value: titulo },
          { label: "Responsável", value: payload.RESPONSAVEL_NOME },
          { label: "Prioridade", value: prioridade },
          { label: "Prazo", value: prazo || "Sem prazo definido" },
        ],
        details: {
          titulo,
          responsavel: payload.RESPONSAVEL_NOME,
          prioridade,
        },
      };
    }

    case "alterarTurno": {
      if (role === "employee") {
        return {
          type: "error",
          message: "Alterações de turno na escala requerem perfil de Gerente ou Administrador.",
        };
      }

      const emp = findEmployeeInText(args.nome, employees);
      if (!emp) {
        return {
          type: "error",
          message: `Colaborador "${args.nome}" não foi localizado no cadastro.`,
        };
      }

      if (role === "manager" && userStore) {
        const empStore = String(emp.LojaID || emp.lojaId || "");
        if (empStore && empStore !== userStore) {
          return {
            type: "error",
            message: `O colaborador ${emp.Nome} pertence a outra unidade. Você pode alterar turnos apenas de colaboradores da sua loja.`,
          };
        }
      }

      const targetShift = args.novoTurno || "Manhã";
      const currentShift = emp.Turno || emp.turno || "Não definido";
      const empId = emp.FuncionarioID || emp.id;

      const payload = { ...emp, Turno: targetShift };

      return {
        type: "action",
        actionType: "update_shift",
        title: "Alterar Turno na Escala",
        apiMethod: "updateEmployee",
        apiArgs: [empId, payload],
        summary: `Alterar o turno de ${emp.Nome} de "${currentShift}" para "${targetShift}".`,
        diff: [
          { label: "Colaborador", value: emp.Nome },
          { label: "Turno Atual", value: currentShift },
          { label: "Novo Turno", value: targetShift },
        ],
        details: { empId, newShift: targetShift },
      };
    }

    case "alterarFolgaFixa": {
      if (role === "employee") {
        return {
          type: "error",
          message: "Definir ou alterar a folga semanal fixa requer permissão gerencial.",
        };
      }

      const emp = findEmployeeInText(args.nome, employees);
      if (!emp) {
        return {
          type: "error",
          message: `Colaborador "${args.nome}" não foi localizado no cadastro.`,
        };
      }

      if (role === "manager" && userStore) {
        const empStore = String(emp.LojaID || emp.lojaId || "");
        if (empStore && empStore !== userStore) {
          return {
            type: "error",
            message: `O colaborador ${emp.Nome} pertence a outra unidade.`,
          };
        }
      }

      const targetDay = args.novoDia || "Segunda-feira";
      const currentDay = emp.FolgaFixaSemanal || emp.folgaFixa || "Não definida";
      const empId = emp.FuncionarioID || emp.id;

      const payload = { ...emp, FolgaFixaSemanal: targetDay };

      return {
        type: "action",
        actionType: "update_fixed_timeoff",
        title: "Alterar Folga Fixa Semanal",
        apiMethod: "updateEmployee",
        apiArgs: [empId, payload],
        summary: `Definir a folga fixa semanal de ${emp.Nome} para "${targetDay}".`,
        diff: [
          { label: "Colaborador", value: emp.Nome },
          { label: "Folga Atual", value: currentDay },
          { label: "Nova Folga", value: targetDay },
        ],
        details: { empId, targetDay },
      };
    }

    case "solicitarFolga": {
      let isoDate = args.data || "";
      if (isoDate.includes("/")) {
        const parts = isoDate.split("/");
        const d = parts[0].padStart(2, "0");
        const m = parts[1].padStart(2, "0");
        const y = parts[2] ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : new Date().getFullYear().toString();
        isoDate = `${y}-${m}-${d}`;
      }

      const reason = args.motivo || "Solicitação via Copiloto";

      const payload = {
        FuncionarioID: userId,
        NomeFuncionario: userName,
        LojaID: userStore,
        DataInicio: isoDate,
        DataFim: isoDate,
        TipoFolga: "Folga solicitada",
        Motivo: reason,
        Status: "Pendente",
      };

      return {
        type: "action",
        actionType: "request_timeoff",
        title: "Solicitar Folga",
        apiMethod: "createEmployeeTimeOffRequest",
        apiArgs: [payload],
        summary: `Enviar pedido de folga para ${isoDate} com motivo: "${reason}".`,
        diff: [
          { label: "Data Solicitada", value: isoDate },
          { label: "Colaborador", value: userName },
          { label: "Motivo", value: reason },
        ],
        details: { isoDate, reason },
      };
    }

    case "concluirTarefa": {
      const q = String(args.titulo || "").toLowerCase();
      const targetTask = tasks.find((t) => {
        const tId = String(t.RESPONSAVEL_ID || t.FuncionarioID || "").trim();
        const status = String(t.STATUS || t.Status || "");
        if (role === "employee" && tId !== userId) return false;
        if (status === "Concluída") return false;
        if (!q) return true;
        return String(t.TITULO || t.Titulo || "").toLowerCase().includes(q);
      });

      if (!targetTask) {
        return {
          type: "error",
          message: "Nenhuma tarefa aberta correspondente foi encontrada para ser concluída.",
        };
      }

      const payload = {
        ...targetTask,
        STATUS: "Concluída",
        Status: "Concluída",
        OBSERVACAO_CONCLUSAO: `Concluída via Copiloto House 190 por ${userName}.`,
      };

      return {
        type: "action",
        actionType: "finish_task",
        title: "Concluir Tarefa",
        apiMethod: "cozinhaTasksSave",
        apiArgs: [payload],
        summary: `Marcar a tarefa "${targetTask.TITULO || targetTask.Titulo}" como Concluída.`,
        diff: [
          { label: "Tarefa", value: targetTask.TITULO || targetTask.Titulo },
          { label: "Status Anterior", value: targetTask.STATUS || targetTask.Status || "A fazer" },
          { label: "Novo Status", value: "Concluída" },
        ],
        details: { id: targetTask.ID || targetTask.TarefaID },
      };
    }

    case "aprovarTrocaFolga": {
      if (role === "employee") {
        return {
          type: "error",
          message: "A aprovação de trocas de folga é exclusiva de Gerentes e Administradores.",
        };
      }

      const q = String(args.colaborador || "").toLowerCase();
      const pendingSwap = swaps.find((s) => {
        const status = String(s.Status || s.status || "");
        if (status !== "Aguardando gestor" && status !== "Aguardando aprovação") return false;
        if (role === "manager" && userStore) {
          const sStore = String(s.LojaID || s.lojaId || "");
          if (sStore && sStore !== userStore) return false;
        }
        if (!q) return true;
        const oName = String(s.NomeFuncionarioOrigem || "").toLowerCase();
        const dName = String(s.NomeFuncionarioDestino || "").toLowerCase();
        return oName.includes(q) || dName.includes(q);
      });

      if (!pendingSwap) {
        return {
          type: "error",
          message: "Nenhuma troca de folga pendente correspondente foi encontrada.",
        };
      }

      const swapId = pendingSwap.TrocaID || pendingSwap.TrocaPrincipalID;

      return {
        type: "action",
        actionType: "approve_swap",
        title: "Aprovar Troca de Folga",
        apiMethod: "decideTimeOffSwap",
        apiArgs: [swapId, true, `Aprovado pelo Copiloto House 190 (${userName})`],
        summary: `Aprovar a troca de folga entre ${pendingSwap.NomeFuncionarioOrigem} e ${pendingSwap.NomeFuncionarioDestino}.`,
        diff: [
          { label: "Origem", value: `${pendingSwap.NomeFuncionarioOrigem} (${pendingSwap.DataFolgaOrigem || "Data"})` },
          { label: "Destino", value: `${pendingSwap.NomeFuncionarioDestino} (${pendingSwap.DataFolgaDestino || "Data"})` },
          { label: "Status", value: "Aprovada" },
        ],
        details: { swapId },
      };
    }

    case "publicarComunicado": {
      if (role === "employee") {
        return {
          type: "error",
          message: "A publicação de comunicados é restrita a Gerentes e Administradores.",
        };
      }

      const title = String(args.titulo || "Aviso Geral").trim();
      const body = String(args.mensagem || "").trim();
      const isLocal = args.destino === "Loja local" || role !== "admin";

      const payload = {
        Titulo: title,
        Corpo: body,
        LojaID: isLocal ? userStore : "",
        PublicoAlvo: "Todos",
        ExigeConfirmacao: false,
      };

      return {
        type: "action",
        actionType: "publish_announcement",
        title: "Publicar Comunicado",
        apiMethod: "publicarComunicado",
        apiArgs: [payload],
        summary: `Publicar o comunicado "${title}" para ${payload.LojaID ? "a loja atual" : "toda a rede"}.`,
        diff: [
          { label: "Título", value: title },
          { label: "Mensagem", value: body },
          { label: "Destino", value: payload.LojaID ? "Loja local" : "Rede completa" },
        ],
        details: { title, body },
      };
    }

    default:
      return parseCopilotIntent(JSON.stringify(args), context);
  }
}

// ==========================================================================
// CHAMADA À API DO GEMINI FLASH
// ==========================================================================

export async function callGeminiCopilot(prompt, context = {}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return parseCopilotIntent(prompt, context);
  }

  const user = context.user || {};
  const role = getUserRole(user);
  const userName = getUserName(user);
  const userStore = getUserStoreId(user);
  const employees = Array.isArray(context.employees) ? context.employees : [];

  const empSummary = employees
    .slice(0, 30)
    .map((e) => `${e.Nome || e.nome} (Loja: ${e.LojaID || ""}, Turno: ${e.Turno || ""})`)
    .join("; ");

  const systemPrompt = `Você é o Copiloto House 190, assistente oficial do Grupo House 190 para os sistemas Folgas 3.0 e CozinhaFlow.
Dados do usuário logado:
- Nome: ${userName}
- Perfil: ${role}
- LojaID: ${userStore || "Todas"}
- Colaboradores cadastrados: ${empSummary || "Nenhum carregado"}

REGRAS OBRIGATÓRIAS:
1. NUNCA use emojis. O sistema tem uma regra estrita de zero emojis. Responda sempre em português profissional, direto e limpo.
2. Não interfira no bater ponto dos colaboradores.
3. Se o usuário solicitar criar tarefa, alterar turno, alterar folga fixa semanal, solicitar folga, aprovar troca de folga ou publicar comunicado, você DEVE acionar a função correspondente.
4. Respeite as permissões: Colaboradores não podem criar tarefas para outros, nem alterar escalas, nem aprovar trocas.
5. Se for dúvida ou consulta (banco de horas, folgas, escala), responda com clareza em markdown simples.`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    tools: GEMINI_TOOLS,
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      console.warn("Gemini Flash retornou erro HTTP:", res.status, "Usando fallback local.");
      return parseCopilotIntent(prompt, context);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    if (!part) {
      return parseCopilotIntent(prompt, context);
    }

    // Chamada de ferramenta pelo Gemini
    if (part.functionCall) {
      const { name, args } = part.functionCall;
      return convertFunctionCallToAction(name, args || {}, context);
    }

    // Resposta textual gerada pelo Gemini
    if (part.text) {
      return {
        type: "query",
        reply: part.text,
      };
    }

    return parseCopilotIntent(prompt, context);
  } catch (err) {
    console.warn("Falha na chamada Gemini Flash:", err.message, "Ativando motor local.");
    return parseCopilotIntent(prompt, context);
  }
}

// ==========================================================================
// MOTOR DE PARSING LOCAL DETERMINÍSTICO (FALLBACK NATIVO 0MS)
// ==========================================================================

export function parseCopilotIntent(text, context = {}) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { type: "empty" };
  }

  const clean = raw.toLowerCase().replace(/\s+/g, " ");
  const user = context.user || {};
  const role = getUserRole(user);
  const userStore = getUserStoreId(user);
  const userId = getUserId(user);
  const userName = getUserName(user);

  const employees = Array.isArray(context.employees) ? context.employees : [];
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  const swaps = Array.isArray(context.swaps) ? context.swaps : [];
  const timeOff = Array.isArray(context.timeOff) ? context.timeOff : [];

  function findEmployee(query) {
    return findEmployeeInText(query, employees);
  }

  // ------------------------------------------------------------------------
  // 1. AJUDA / COMANDOS
  // ------------------------------------------------------------------------
  if (/^(ajuda|comandos|menu|o que voc[eê] faz|socorro)/i.test(clean)) {
    if (role === "admin") {
      return {
        type: "query",
        reply: `**Comandos do Copiloto House 190 (Administrador):**
- **Criar tarefa:** "Cria tarefa para [Nome] [Título] prazo hoje às 18h prioridade alta"
- **Alterar turno:** "Muda o turno de [Nome] para Noite"
- **Alterar folga fixa:** "Define folga fixa de [Nome] para Terça"
- **Aprovar troca:** "Aprova a troca do [Nome]"
- **Publicar comunicado:** "Publica comunicado: Reunião Geral - Amanhã às 15h"
- **Consultas operacionais:** "Quem está trabalhando agora?", "Quais tarefas estão pendentes?", "Saldos de horas da rede"`,
      };
    }
    if (role === "manager") {
      return {
        type: "query",
        reply: `**Comandos do Copiloto House 190 (Gerente):**
- **Criar tarefa na cozinha:** "Cria tarefa para [Nome] [Título] prazo hoje às 17h prioridade alta"
- **Alterar turno na loja:** "Muda o turno de [Nome] para Noite"
- **Definir folga semanal:** "Muda a folga fixa de [Nome] para Segunda"
- **Aprovar trocas de folga:** "Aprova a troca do [Nome]"
- **Consultas:** "Quem está trabalhando agora?", "Tarefas pendentes da loja", "Trocas de folga pendentes"`,
      };
    }
    return {
      type: "query",
      reply: `**Comandos do Copiloto House 190 (Colaborador):**
- **Minha próxima folga:** "Quando é minha próxima folga?"
- **Meu banco de horas:** "Qual é o meu saldo de horas?"
- **Solicitar folga:** "Solicitar folga dia 25/10/2026 motivo consulta médica"
- **Minhas tarefas:** "Quais são as minhas tarefas de hoje?"
- **Concluir tarefa:** "Concluir minha tarefa de higienização"`,
    };
  }

  // ------------------------------------------------------------------------
  // 2. CONSULTAS: PRÓXIMA FOLGA
  // ------------------------------------------------------------------------
  if (/(?:quando [eé] (?:a )?minha (?:pr[oó]xima )?folga|minha folga|pr[oó]xima folga)/i.test(clean)) {
    const myLeaves = timeOff.filter((f) => {
      const fId = String(f.FuncionarioID || f.funcionarioId || "").trim();
      const status = String(f.Status || f.status || "").toLowerCase();
      return fId === userId && status === "aprovada";
    });

    const now = new Date();
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(now);

    const upcoming = myLeaves
      .filter((f) => {
        const d = String(f.DataInicio || f.dataInicio || "").slice(0, 10);
        return d >= todayStr;
      })
      .sort((a, b) => String(a.DataInicio).localeCompare(String(b.DataInicio)))[0];

    if (upcoming) {
      const dateParts = String(upcoming.DataInicio).slice(0, 10).split("-");
      const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
      return {
        type: "query",
        reply: `Sua próxima folga aprovada está programada para **${formattedDate}** (${upcoming.TipoFolga || "Folga regular"}).`,
      };
    }

    const fixedDay = user.FolgaFixaSemanal || user.folgaFixa || "";
    if (fixedDay) {
      return {
        type: "query",
        reply: `Você não possui folgas pontuais aprovadas registradas para os próximos dias. Sua escala possui folga fixa semanal nas **${fixedDay}s**.`,
      };
    }

    return {
      type: "query",
      reply: "Não foram encontradas folgas futuras cadastradas para o seu usuário. Consulte a sua gerência se desejar agendar.",
    };
  }

  // ------------------------------------------------------------------------
  // 3. CONSULTAS: BANCO DE HORAS
  // ------------------------------------------------------------------------
  if (/(?:meu saldo de horas|meu banco de horas|saldo de horas|quantas horas tenho|meu saldo)/i.test(clean)) {
    const bal = context.hourBalance || context.timeClockBalance;
    if (bal && bal.totalMinutos !== undefined) {
      const mins = Number(bal.totalMinutos) || 0;
      const signal = mins >= 0 ? "+" : "-";
      const absMins = Math.abs(mins);
      const h = Math.floor(absMins / 60);
      const m = absMins % 60;
      const formatted = `${signal}${h}h ${String(m).padStart(2, "0")}m`;
      const statusDesc = mins >= 0 ? "saldo positivo (crédito)" : "saldo negativo (débito)";
      return {
        type: "query",
        reply: `Seu saldo acumulado no banco de horas é de **${formatted}** (${statusDesc}).`,
      };
    }
    return {
      type: "query",
      reply: "Seu saldo de horas está em dia e sincronizado com os registros de ponto do sistema.",
    };
  }

  // ------------------------------------------------------------------------
  // 4. CONSULTAS: EQUIPE AGORA
  // ------------------------------------------------------------------------
  if (/(?:quem est[aá] trabalhando|equipe agora|quem est[aá] de plant[aã]o|escala de hoje)/i.test(clean)) {
    if (role === "employee") {
      return {
        type: "query",
        reply: "Para visualizar o painel completo de presença da equipe, solicite a um responsável de loja ou consulte a escala afixada.",
      };
    }

    const liveData = Array.isArray(context.livePresenceData) ? context.livePresenceData : [];
    const targetStore = userStore;

    const present = liveData.filter((p) => {
      if (role !== "admin" && targetStore && String(p.LojaID || p.lojaId || "") !== targetStore) {
        return false;
      }
      return p.trabalhando || p.status === "Em serviço" || p.status === "Trabalhando";
    });

    if (present.length === 0) {
      return {
        type: "query",
        reply: "No momento não há registros de colaboradores com turno aberto na loja selecionada.",
      };
    }

    const list = present
      .map((p) => `- **${p.Nome || p.nome || "Colaborador"}** (${p.Turno || p.turno || "Turno padrão"})`)
      .join("\n");

    return {
      type: "query",
      reply: `**Colaboradores em atividade agora (${present.length}):**\n${list}`,
    };
  }

  // ------------------------------------------------------------------------
  // 5. CONSULTAS: TAREFAS PENDENTES
  // ------------------------------------------------------------------------
  if (/(?:quais tarefas|minhas tarefas|tarefas pendentes|tarefas de hoje|tarefas da cozinha)/i.test(clean)) {
    const myTasks = tasks.filter((t) => {
      const respId = String(t.RESPONSAVEL_ID || t.FuncionarioID || "").trim();
      const status = String(t.STATUS || t.Status || "");
      if (role === "employee") {
        return respId === userId && status !== "Concluída" && status !== "Cancelada";
      }
      if (role === "manager" && userStore) {
        const storeId = String(t.LojaID || t.lojaId || "");
        if (storeId && storeId !== userStore) return false;
      }
      return status !== "Concluída" && status !== "Cancelada";
    });

    if (myTasks.length === 0) {
      return {
        type: "query",
        reply: "Não há tarefas pendentes registradas no CozinhaFlow no momento.",
      };
    }

    const list = myTasks
      .slice(0, 6)
      .map((t) => `- **${t.TITULO || t.Titulo || "Tarefa"}** (${t.STATUS || "A fazer"} · Prioridade: ${t.PRIORIDADE || "Normal"})`)
      .join("\n");

    return {
      type: "query",
      reply: `**Tarefas ativas (${myTasks.length}):**\n${list}`,
    };
  }

  // ------------------------------------------------------------------------
  // 6. AÇÃO: CRIAR TAREFA COZINHAFLOW
  // ------------------------------------------------------------------------
  const createTaskMatch = clean.match(/(?:cria(?:r)?|nova|adiciona(?:r)?)\s+(?:uma\s+)?tarefa\s*(.*)/i);
  if (createTaskMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "A criação e delegação de tarefas na cozinha requer permissão de Gerente ou Administrador.",
      };
    }

    const rest = createTaskMatch[1] || "";
    let prioridade = "Normal";
    if (rest.includes("urgente")) prioridade = "Urgente";
    else if (rest.includes("alta")) prioridade = "Alta";
    else if (rest.includes("baixa")) prioridade = "Baixa";

    let prazo = "";
    const timeMatch = rest.match(/([0-9]{1,2}):?([0-9]{2})?\s*(?:h|hrs)?/);
    if (timeMatch) {
      const now = new Date();
      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(now);
      const h = String(timeMatch[1]).padStart(2, "0");
      const m = String(timeMatch[2] || "00").padStart(2, "0");
      prazo = `${todayStr}T${h}:${m}:00`;
    }

    let targetEmployee = findEmployeeInText(rest, employees);

    if (targetEmployee && role === "manager" && userStore) {
      const empStore = String(targetEmployee.LojaID || targetEmployee.lojaId || "");
      if (empStore && empStore !== userStore) {
        return {
          type: "error",
          message: `O colaborador ${targetEmployee.Nome} pertence a outra unidade. Você pode delegar tarefas apenas para a sua loja.`,
        };
      }
    }

    let titulo = rest;
    if (targetEmployee) {
      const fullName = String(targetEmployee.Nome || targetEmployee.nome || "").toLowerCase();
      const firstName = fullName.split(" ")[0];
      titulo = titulo
        .replace(new RegExp(`para\\s+(${fullName}|${firstName})\\b`, "gi"), "")
        .replace(new RegExp(`\\b(${fullName}|${firstName})\\b`, "gi"), "");
    }
    titulo = titulo
      .replace(/prioridade\s+(?:urgente|alta|normal|baixa)/gi, "")
      .replace(/(?:urgente|alta|normal|baixa)/gi, "")
      .replace(/prazo\s+.*$/gi, "")
      .replace(/hoje\s+[a-z0-9:]+/gi, "")
      .replace(/^[de\s:]+/, "")
      .trim();

    if (!titulo || titulo.length < 3) {
      titulo = "Higienização e organização operacional";
    }

    titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);

    const payload = {
      TITULO: titulo,
      DESCRICAO: `Tarefa criada pelo Copiloto House 190 a pedido de ${userName}.`,
      PRIORIDADE: prioridade,
      PRAZO: prazo,
      RESPONSAVEL_ID: targetEmployee ? String(targetEmployee.FuncionarioID || targetEmployee.id || "") : "",
      RESPONSAVEL_NOME: targetEmployee ? String(targetEmployee.Nome || "") : "Equipe da Cozinha",
      LojaID: targetEmployee?.LojaID || userStore,
      STATUS: "A fazer",
    };

    return {
      type: "action",
      actionType: "create_task",
      title: "Criar Tarefa no CozinhaFlow",
      apiMethod: "cozinhaTasksSave",
      apiArgs: [payload],
      summary: `Criar a tarefa "${titulo}" atribuída a ${payload.RESPONSAVEL_NOME} com prioridade ${prioridade}.`,
      diff: [
        { label: "Título", value: titulo },
        { label: "Responsável", value: payload.RESPONSAVEL_NOME },
        { label: "Prioridade", value: prioridade },
        { label: "Prazo", value: prazo ? prazo.replace("T", " ") : "Sem prazo definido" },
      ],
      details: {
        titulo,
        responsavel: payload.RESPONSAVEL_NOME,
        prioridade,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 7. AÇÃO: CONCLUIR TAREFA
  // ------------------------------------------------------------------------
  const finishTaskMatch = clean.match(/(?:conclui(?:r)?|finaliza(?:r)?|marca(?:r)?\s+(?:como\s+feita|conclu[ií]da))\s+tarefa\s*(.*)/i);
  if (finishTaskMatch) {
    const q = finishTaskMatch[1]?.trim().toLowerCase();
    let targetTask = tasks.find((t) => {
      const tId = String(t.RESPONSAVEL_ID || t.FuncionarioID || "").trim();
      const status = String(t.STATUS || t.Status || "");
      if (role === "employee" && tId !== userId) return false;
      if (status === "Concluída") return false;
      if (!q) return true;
      const tit = String(t.TITULO || t.Titulo || "").toLowerCase();
      return tit.includes(q);
    });

    if (!targetTask) {
      return {
        type: "error",
        message: "Nenhuma tarefa aberta correspondente foi encontrada para ser concluída.",
      };
    }

    const payload = {
      ...targetTask,
      STATUS: "Concluída",
      Status: "Concluída",
      OBSERVACAO_CONCLUSAO: `Concluída via Copiloto House 190 por ${userName}.`,
    };

    return {
      type: "action",
      actionType: "finish_task",
      title: "Concluir Tarefa",
      apiMethod: "cozinhaTasksSave",
      apiArgs: [payload],
      summary: `Marcar a tarefa "${targetTask.TITULO || targetTask.Titulo}" como Concluída.`,
      diff: [
        { label: "Tarefa", value: targetTask.TITULO || targetTask.Titulo },
        { label: "Status Anterior", value: targetTask.STATUS || targetTask.Status || "A fazer" },
        { label: "Novo Status", value: "Concluída" },
      ],
      details: {
        id: targetTask.ID || targetTask.TarefaID,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 8. AÇÃO: SOLICITAR FOLGA
  // ------------------------------------------------------------------------
  const requestTimeOffMatch = clean.match(/(?:solicita(?:r)?|pedir|quero)\s+folga\s+(?:para\s+(?:o\s+dia\s+)?|no\s+dia\s+|dia\s+|em\s+|o\s+dia\s+)?([0-9]{1,2}[\/\-][0-9]{1,2}(?:[\/\-][0-9]{2,4})?)(?:\s+(?:motivo|por)\s+(.+))?/i);
  if (requestTimeOffMatch) {
    const rawDate = requestTimeOffMatch[1].replace(/-/g, "/");
    const reason = requestTimeOffMatch[2] ? requestTimeOffMatch[2].trim() : "Solicitação operacional via Copiloto";

    const parts = rawDate.split("/");
    let d = parts[0].padStart(2, "0");
    let m = parts[1].padStart(2, "0");
    let y = parts[2] ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : new Date().getFullYear().toString();
    const isoDate = `${y}-${m}-${d}`;

    const payload = {
      FuncionarioID: userId,
      NomeFuncionario: userName,
      LojaID: userStore,
      DataInicio: isoDate,
      DataFim: isoDate,
      TipoFolga: "Folga solicitada",
      Motivo: reason,
      Status: "Pendente",
    };

    return {
      type: "action",
      actionType: "request_timeoff",
      title: "Solicitar Folga",
      apiMethod: "createEmployeeTimeOffRequest",
      apiArgs: [payload],
      summary: `Enviar pedido de folga para o dia ${d}/${m}/${y} com motivo: "${reason}".`,
      diff: [
        { label: "Data Solicitada", value: `${d}/${m}/${y}` },
        { label: "Colaborador", value: userName },
        { label: "Motivo", value: reason },
      ],
      details: {
        isoDate,
        reason,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 9. AÇÃO: APROVAR TROCA DE FOLGA
  // ------------------------------------------------------------------------
  const approveSwapMatch = clean.match(/(?:aprova(?:r)?|aceita(?:r)?)\s+(?:a\s+)?troca\s*(.*)/i);
  if (approveSwapMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "A aprovação de trocas de folga é exclusiva de Gerentes e Administradores.",
      };
    }

    const q = approveSwapMatch[1]?.trim().toLowerCase();
    const pendingSwap = swaps.find((s) => {
      const status = String(s.Status || s.status || "");
      if (status !== "Aguardando gestor" && status !== "Aguardando aprovação") return false;
      if (role === "manager" && userStore) {
        const sStore = String(s.LojaID || s.lojaId || "");
        if (sStore && sStore !== userStore) return false;
      }
      if (!q) return true;
      const oName = String(s.NomeFuncionarioOrigem || "").toLowerCase();
      const dName = String(s.NomeFuncionarioDestino || "").toLowerCase();
      return oName.includes(q) || dName.includes(q);
    });

    if (!pendingSwap) {
      return {
        type: "error",
        message: "Nenhuma troca de folga pendente de aprovação gerencial foi localizada.",
      };
    }

    const swapId = pendingSwap.TrocaID || pendingSwap.TrocaPrincipalID;

    return {
      type: "action",
      actionType: "approve_swap",
      title: "Aprovar Troca de Folga",
      apiMethod: "decideTimeOffSwap",
      apiArgs: [swapId, true, `Aprovado pelo Copiloto House 190 (${userName})`],
      summary: `Aprovar a troca de folga entre ${pendingSwap.NomeFuncionarioOrigem} e ${pendingSwap.NomeFuncionarioDestino}.`,
      diff: [
        { label: "Origem", value: `${pendingSwap.NomeFuncionarioOrigem} (${pendingSwap.DataFolgaOrigem || "Data"})` },
        { label: "Destino", value: `${pendingSwap.NomeFuncionarioDestino} (${pendingSwap.DataFolgaDestino || "Data"})` },
        { label: "Status", value: "Aprovada" },
      ],
      details: {
        swapId,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 10. AÇÃO: ALTERAR TURNO
  // ------------------------------------------------------------------------
  const shiftMatch = clean.match(/(?:muda(?:r)?|altera(?:r)?|troca(?:r)?)\s+(?:o\s+)?turno\s+(?:de|do|da)\s+([a-zA-ZÀ-ÿ\s]+?)\s+para\s+([a-zA-ZÀ-ÿ\s]+)/i);
  if (shiftMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "Alterações de turno na escala requerem perfil de Gerente ou Administrador.",
      };
    }

    const empQuery = shiftMatch[1].trim();
    let targetShift = shiftMatch[2].trim();
    if (/manh[aã]/i.test(targetShift)) targetShift = "Manhã";
    else if (/tarde/i.test(targetShift)) targetShift = "Tarde";
    else if (/noite/i.test(targetShift)) targetShift = "Noite";
    else if (/integral/i.test(targetShift)) targetShift = "Integral";

    const emp = findEmployee(empQuery);
    if (!emp) {
      return {
        type: "error",
        message: `Colaborador "${empQuery}" não foi localizado no cadastro.`,
      };
    }

    if (role === "manager" && userStore) {
      const empStore = String(emp.LojaID || emp.lojaId || "");
      if (empStore && empStore !== userStore) {
        return {
          type: "error",
          message: `O colaborador ${emp.Nome} pertence a outra unidade. Você pode alterar turnos apenas de colaboradores da sua loja.`,
        };
      }
    }

    const currentShift = emp.Turno || emp.turno || "Não definido";
    const empId = emp.FuncionarioID || emp.id;

    const payload = {
      ...emp,
      Turno: targetShift,
    };

    return {
      type: "action",
      actionType: "update_shift",
      title: "Alterar Turno na Escala",
      apiMethod: "updateEmployee",
      apiArgs: [empId, payload],
      summary: `Alterar o turno de ${emp.Nome} de "${currentShift}" para "${targetShift}".`,
      diff: [
        { label: "Colaborador", value: emp.Nome },
        { label: "Turno Atual", value: currentShift },
        { label: "Novo Turno", value: targetShift },
      ],
      details: {
        empId,
        newShift: targetShift,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 11. AÇÃO: ALTERAR FOLGA FIXA SEMANAL
  // ------------------------------------------------------------------------
  const fixedOffMatch = clean.match(/(?:muda(?:r)?|altera(?:r)?|define|definir)\s+(?:a\s+)?folga\s+fixa\s+(?:de|do|da)\s+([a-zA-ZÀ-ÿ\s]+?)\s+para\s+([a-zA-ZÀ-ÿ\s]+)/i);
  if (fixedOffMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "Definir ou alterar a folga semanal fixa requer permissão gerencial.",
      };
    }

    const empQuery = fixedOffMatch[1].trim();
    let targetDay = fixedOffMatch[2].trim();
    if (/segunda/i.test(targetDay)) targetDay = "Segunda-feira";
    else if (/ter[cç]a/i.test(targetDay)) targetDay = "Terça-feira";
    else if (/quarta/i.test(targetDay)) targetDay = "Quarta-feira";
    else if (/quinta/i.test(targetDay)) targetDay = "Quinta-feira";
    else if (/sexta/i.test(targetDay)) targetDay = "Sexta-feira";
    else if (/s[aá]bado/i.test(targetDay)) targetDay = "Sábado";
    else if (/domingo/i.test(targetDay)) targetDay = "Domingo";

    const emp = findEmployee(empQuery);
    if (!emp) {
      return {
        type: "error",
        message: `Colaborador "${empQuery}" não foi localizado no cadastro.`,
      };
    }

    if (role === "manager" && userStore) {
      const empStore = String(emp.LojaID || emp.lojaId || "");
      if (empStore && empStore !== userStore) {
        return {
          type: "error",
          message: `O colaborador ${emp.Nome} pertence a outra unidade.`,
        };
      }
    }

    const currentDay = emp.FolgaFixaSemanal || emp.folgaFixa || "Não definida";
    const empId = emp.FuncionarioID || emp.id;

    const payload = {
      ...emp,
      FolgaFixaSemanal: targetDay,
    };

    return {
      type: "action",
      actionType: "update_fixed_timeoff",
      title: "Alterar Folga Fixa Semanal",
      apiMethod: "updateEmployee",
      apiArgs: [empId, payload],
      summary: `Definir a folga fixa semanal de ${emp.Nome} para "${targetDay}".`,
      diff: [
        { label: "Colaborador", value: emp.Nome },
        { label: "Folga Atual", value: currentDay },
        { label: "Nova Folga", value: targetDay },
      ],
      details: {
        empId,
        targetDay,
      },
    };
  }

  // ------------------------------------------------------------------------
  // 12. AÇÃO: PUBLICAR COMUNICADO
  // ------------------------------------------------------------------------
  const announcementMatch = clean.match(/(?:publica(?:r)?|cria(?:r)?)\s+(?:um\s+)?comunicado\s*(?:para\s+(.+?))?:\s*(.+)/i);
  if (announcementMatch) {
    if (role === "employee") {
      return {
        type: "error",
        message: "A publicação de comunicados é restrita a Gerentes e Administradores.",
      };
    }

    const rawTarget = announcementMatch[1] ? announcementMatch[1].trim() : "Todos";
    const rawContent = announcementMatch[2].trim();

    let title = "Aviso Geral";
    let body = rawContent;
    if (rawContent.includes(" - ")) {
      const parts = rawContent.split(" - ");
      title = parts[0].trim();
      body = parts.slice(1).join(" - ").trim();
    }

    const payload = {
      Titulo: title,
      Corpo: body,
      LojaID: role === "admin" ? "" : userStore,
      PublicoAlvo: rawTarget,
      ExigeConfirmacao: false,
    };

    return {
      type: "action",
      actionType: "publish_announcement",
      title: "Publicar Comunicado",
      apiMethod: "publicarComunicado",
      apiArgs: [payload],
      summary: `Publicar o comunicado "${title}" para ${payload.LojaID ? "a loja atual" : "toda a rede"}.`,
      diff: [
        { label: "Título", value: title },
        { label: "Mensagem", value: body },
        { label: "Destino", value: payload.LojaID ? "Loja local" : "Rede completa" },
      ],
      details: {
        title,
        body,
      },
    };
  }

  // ------------------------------------------------------------------------
  // FALLBACK
  // ------------------------------------------------------------------------
  return {
    type: "query",
    reply: `Não compreendi este comando com precisão. Você pode digitar **ajuda** para ver os comandos operacionais disponíveis para o seu perfil ou tentar frases diretas como:
- "Quando é minha próxima folga?"
- "Qual é o meu saldo de horas?"
- "Cria tarefa para Gabriel limpar o freezer hoje às 17h"
- "Muda o turno de João para Noite"`,
  };
}

// ==========================================================================
// EXECUTOR DE AÇÕES COM CONFIRMAÇÃO ("VER E CONFIRMAR")
// ==========================================================================

export async function executeCopilotAction(action, api) {
  if (!action || !action.apiMethod) {
    throw new Error("Ação inválida.");
  }

  if (!api || typeof api.invoke !== "function") {
    throw new Error("A API do sistema não está disponível no momento.");
  }

  const result = await api.invoke(action.apiMethod, action.apiArgs || []);

  try {
    if (action.actionType.includes("task")) {
      window.dispatchEvent(new CustomEvent("gestao-tasks-refresh"));
    }
    if (typeof window.__GESTAO_REFRESH_APP__ === "function") {
      window.__GESTAO_REFRESH_APP__();
    }
  } catch (_) {}

  return result;
}

// ==========================================================================
// GESTÃO DA INTERFACE E CICLO DE VIDA DO COPILOTO
// ==========================================================================

let copilotInitialized = false;
let pendingAction = null;

export function initCopilot() {
  if (copilotInitialized) return;
  copilotInitialized = true;

  const drawer = $("#copilotDrawer");
  const openBtn = $("#copilotOpenBtn");
  const closeBtn = $("#copilotCloseBtn");
  const backdrop = $("#copilotBackdrop");
  const form = $("#copilotForm");
  const input = $("#copilotInput");
  const messages = $("#copilotMessages");
  const suggestions = $("#copilotQuickSuggestions");
  const fab = $("#copilotFab");

  // Painel de Configurações da Chave Gemini
  const settingsBtn = $("#copilotSettingsBtn");
  const settingsPanel = $("#copilotSettingsPanel");
  const apiKeyInput = $("#copilotApiKeyInput");
  const saveKeyBtn = $("#copilotSaveKeyBtn");
  const clearKeyBtn = $("#copilotClearKeyBtn");
  const engineStatus = $("#copilotEngineStatus");

  function updateEngineStatus() {
    const key = getGeminiApiKey();
    if (apiKeyInput) {
      apiKeyInput.value = key ? "••••••••••••••••" : "";
    }
    if (engineStatus) {
      if (key) {
        engineStatus.textContent = "Gemini Flash Ativo";
        engineStatus.className = "copilot-engine-status copilot-engine-status--gemini";
      } else {
        engineStatus.textContent = "Motor Local Ativo";
        engineStatus.className = "copilot-engine-status";
      }
    }
  }

  settingsBtn?.addEventListener("click", () => {
    settingsPanel?.classList.toggle("hidden");
    updateEngineStatus();
  });

  saveKeyBtn?.addEventListener("click", () => {
    const val = apiKeyInput?.value?.trim();
    if (val && !val.startsWith("•••")) {
      setGeminiApiKey(val);
      if (typeof window.__GESTAO_TOAST__ === "function") {
        window.__GESTAO_TOAST__("Chave da API do Gemini salva com sucesso.");
      }
    }
    updateEngineStatus();
    settingsPanel?.classList.add("hidden");
  });

  clearKeyBtn?.addEventListener("click", () => {
    setGeminiApiKey("");
    if (apiKeyInput) apiKeyInput.value = "";
    if (typeof window.__GESTAO_TOAST__ === "function") {
      window.__GESTAO_TOAST__("Chave removida. Usando motor local.");
    }
    updateEngineStatus();
  });

  updateEngineStatus();

  function openDrawer() {
    drawer?.classList.remove("hidden");
    drawer?.setAttribute("aria-hidden", "false");
    input?.focus();
    updateWelcomeAndChips();
  }

  function closeDrawer() {
    drawer?.classList.add("hidden");
    drawer?.setAttribute("aria-hidden", "true");
    settingsPanel?.classList.add("hidden");
  }

  openBtn?.addEventListener("click", openDrawer);
  fab?.addEventListener("click", openDrawer);
  closeBtn?.addEventListener("click", closeDrawer);
  backdrop?.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer?.classList.contains("hidden")) {
      closeDrawer();
    }
  });

  function updateWelcomeAndChips() {
    const user = window.__GESTAO_STATE__?.user || window.__GESTAO_USER__;
    const role = getUserRole(user);
    const badge = $("#copilotRoleBadge");
    if (badge) {
      badge.textContent = role === "admin" ? "Admin Ativo" : role === "manager" ? "Gerência Ativa" : "Operação Ativa";
    }

    if (suggestions && suggestions.children.length === 0) {
      const chips =
        role === "admin"
          ? [
              "Quem está trabalhando agora?",
              "Tarefas pendentes da rede",
              "Comandos de administração",
            ]
          : role === "manager"
          ? [
              "Quem está trabalhando agora?",
              "Tarefas da cozinha",
              "Trocas de folga pendentes",
              "Comandos de gerência",
            ]
          : [
              "Quando é minha próxima folga?",
              "Meu saldo de horas",
              "Minhas tarefas de hoje",
              "Como solicitar folga?",
            ];

      suggestions.innerHTML = chips
        .map((c) => `<button type="button" class="copilot-chip">${esc(c)}</button>`)
        .join("");

      $$(".copilot-chip", suggestions).forEach((btn) => {
        btn.addEventListener("click", () => {
          if (input) {
            input.value = btn.textContent.trim();
            handleUserInput();
          }
        });
      });
    }

    if (messages && messages.children.length === 0) {
      const hasKey = Boolean(getGeminiApiKey());
      const engineNote = hasKey ? "Motor Gemini Flash ativado." : "Motor local autônomo ativado.";
      const greeting = `Olá, **${getUserName(user)}**. Sou o Copiloto House 190. ${engineNote} Posso consultar saldos, escalas, criar tarefas no CozinhaFlow e gerenciar solicitações operacionais com total segurança e confirmação prévia.`;
      appendAssistantMessage(greeting);
    }
  }

  function appendUserMessage(text) {
    const div = document.createElement("div");
    div.className = "copilot-message copilot-message--user";
    div.innerHTML = `<div class="copilot-bubble"><p>${esc(text)}</p></div>`;
    messages?.appendChild(div);
    scrollToBottom();
  }

  function appendAssistantMessage(markdownText, cardHtml = "") {
    const div = document.createElement("div");
    div.className = "copilot-message copilot-message--assistant";

    let html = esc(markdownText)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n- (.*?)(?=\n|$)/g, "<li>$1</li>")
      .replace(/(<li>.*?<\/li>)/gs, "<ul>$1</ul>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>");

    div.innerHTML = `<div class="copilot-bubble"><p>${html}</p>${cardHtml}</div>`;
    messages?.appendChild(div);
    scrollToBottom();
    return div;
  }

  function scrollToBottom() {
    const body = $("#copilotBody");
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  }

  async function handleUserInput() {
    const text = input?.value?.trim();
    if (!text) return;
    input.value = "";

    appendUserMessage(text);

    const state = window.__GESTAO_STATE__ || {};
    const context = {
      user: state.user || window.__GESTAO_USER__,
      employees: state.employees || [],
      tasks: state.tasks || [],
      swaps: state.swaps || [],
      timeOff: state.timeOff || [],
      stores: state.stores || [],
      livePresenceData: state.livePresenceData || [],
      hourBalance: state.timeClockBalance || state.hourBalance,
    };

    let intent = null;
    const apiKey = getGeminiApiKey();

    if (apiKey) {
      const waitMsg = appendAssistantMessage("Pensando com Gemini Flash…");
      try {
        intent = await callGeminiCopilot(text, context);
      } catch (err) {
        console.warn("Falha no Gemini, usando fallback local:", err);
        intent = parseCopilotIntent(text, context);
      } finally {
        waitMsg.remove();
      }
    } else {
      intent = parseCopilotIntent(text, context);
    }

    if (!intent || intent.type === "empty") return;

    if (intent.type === "error") {
      appendAssistantMessage(intent.message);
      return;
    }

    if (intent.type === "query") {
      appendAssistantMessage(intent.reply);
      return;
    }

    if (intent.type === "action") {
      pendingAction = intent;

      const diffRows = (intent.diff || [])
        .map(
          (d) => `
        <div class="copilot-diff-row">
          <span class="copilot-diff-label">${esc(d.label)}</span>
          <span class="copilot-diff-value copilot-diff-value--new">${esc(d.value)}</span>
        </div>`,
        )
        .join("");

      const cardHtml = `
        <div class="copilot-card" id="activeCopilotCard">
          <div class="copilot-card-tag">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Confirmação Necessária
          </div>
          <h3 class="copilot-card-title">${esc(intent.title)}</h3>
          <p class="copilot-card-desc">${esc(intent.summary)}</p>
          <div class="copilot-diff-table">${diffRows}</div>
          <div class="copilot-card-actions">
            <button type="button" class="copilot-btn-confirm" id="copilotCardConfirmBtn">
              Confirmar e Aplicar
            </button>
            <button type="button" class="copilot-btn-cancel" id="copilotCardCancelBtn">
              Cancelar
            </button>
          </div>
        </div>`;

      const msgEl = appendAssistantMessage(
        "Preparei a seguinte alteração no sistema. Revise os detalhes abaixo para autorizar a aplicação:",
        cardHtml,
      );

      const confirmBtn = msgEl.querySelector("#copilotCardConfirmBtn");
      const cancelBtn = msgEl.querySelector("#copilotCardCancelBtn");
      const cardEl = msgEl.querySelector("#activeCopilotCard");

      confirmBtn?.addEventListener("click", async () => {
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="copilot-spinner"></span> Aplicando…';

        try {
          const api = window.__GESTAO_FIREBASE__?.api;
          await executeCopilotAction(intent, api);

          cardEl.innerHTML = `
            <div class="copilot-status-card copilot-status-card--success">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              <div><strong>Ação concluída com sucesso!</strong><br>${esc(intent.summary)}</div>
            </div>`;

          if (typeof window.__GESTAO_TOAST__ === "function") {
            window.__GESTAO_TOAST__("Ação aplicada pelo Copiloto.");
          }
        } catch (err) {
          cardEl.innerHTML = `
            <div class="copilot-status-card copilot-status-card--error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <div><strong>Falha na aplicação:</strong><br>${esc(err.message || "Erro desconhecido")}</div>
            </div>`;
        }
        pendingAction = null;
      });

      cancelBtn?.addEventListener("click", () => {
        cardEl.innerHTML = `
          <div class="copilot-status-card copilot-status-card--warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div>Operação cancelada pelo usuário. Nenhuma alteração foi gravada.</div>
          </div>`;
        pendingAction = null;
      });
    }
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    handleUserInput();
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleUserInput();
    }
  });

  window.addEventListener("gestao-api-ready", () => {
    updateWelcomeAndChips();
    updateEngineStatus();
  });
}

// Inicia automaticamente no carregamento
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCopilot, { once: true });
  } else {
    initCopilot();
  }
}
