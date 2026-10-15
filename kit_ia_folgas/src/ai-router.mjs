/**
 * Router Express integrável em sistema existente.
 * IMPORTANTE: monte SOMENTE atrás da autenticação e proteção CSRF existentes.
 * O backend fornece `actor` exclusivamente a partir da sessão verificada.
 * As funções `hr.*` precisam ser implementadas com escopo organizacional,
 * políticas, transações, idempotência, autorização e trilha de auditoria.
 */
import express from 'express';
import OpenAI from 'openai';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import { z } from 'zod/v4';
import { zodResponsesFunction } from 'openai/helpers/zod';
import { systemPrompt } from './prompt.mjs';

const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const defs = [
  {
    name: 'get_my_profile', description: 'Consultar o cadastro e o gestor do usuário autenticado.',
    params: z.object({}), run: (hr, actor) => hr.getProfile(actor)
  },
  {
    name: 'get_my_schedule', description: 'Consultar a escala e folgas do usuário autenticado no intervalo indicado.',
    params: z.object({ from: d, to: d }),
    run: (hr, actor, arg) => hr.getSchedule(actor, arg)
  },
  {
    name: 'get_my_time_bank', description: 'Consultar o banco de horas do próprio usuário.',
    params: z.object({}), run: (hr, actor) => hr.getTimeBank(actor)
  },
  {
    name: 'get_my_requests', description: 'Consultar solicitações do usuário e os status reais.',
    params: z.object({ status: z.enum(['all', 'pending', 'approved', 'rejected']) }),
    run: (hr, actor, arg) => hr.getRequests(actor, arg)
  },
  {
    name: 'get_policy', description: 'Consultar política oficial e vigente sobre folga, escala, banco de horas, feriado, ponto ou atestado.',
    params: z.object({ topic: z.enum(['folga','escala','troca','banco_horas','feriado','ponto','atestado','outros']) }),
    run: (hr, actor, arg) => hr.getPolicy(actor, arg)
  },
  {
    name: 'preview_employee_request', description: 'Validar e preparar solicitação do funcionário. Não executa: retorna ação de confirmação a ser exibida no site.',
    params: z.object({
      kind: z.enum(['folga','troca_folga','ajuste_ponto','outros']),
      date: d,
      replacement_date: d.nullable(),
      note: z.string().max(400)
    }),
    run: (hr, actor, arg) => hr.previewEmployeeRequest(actor, arg), isPreview: true
  }
];
const managementDefs = [
  {
    name: 'get_team_pending_requests', description: 'Consultar solicitações pendentes da equipe autorizada pelo backend.',
    params: z.object({}), run: (hr, actor) => hr.getTeamPendingRequests(actor)
  },
  {
    name: 'get_team_coverage', description: 'Analisar a cobertura operacional da equipe autorizada em uma data.',
    params: z.object({ date: d }), run: (hr, actor, arg) => hr.getTeamCoverage(actor, arg)
  },
  {
    name: 'preview_manager_decision', description: 'Preparar aprovação ou recusa de solicitação da equipe; depende de confirmação no site e das regras do RH.',
    params: z.object({ request_id: z.string().min(1).max(100), decision: z.enum(['approve', 'reject']), note: z.string().max(400) }),
    run: (hr, actor, arg) => hr.previewManagerDecision(actor, arg), isPreview: true
  }
];

function allowedDefs(actor) {
  return actor.role === 'manager' || actor.role === 'hr' || actor.role === 'admin'
    ? [...defs, ...managementDefs]
    : defs;
}

function publicFailure(err) {
  // NUNCA repasse SQL, stack trace nem mensagens internas para o modelo.
  const code = typeof err?.code === 'string' ? err.code : 'INTERNAL_ERROR';
  const messages = {
    PERMISSION_DENIED: 'Operação não permitida para este perfil.',
    NOT_FOUND: 'Registro não encontrado no escopo autorizado.',
    POLICY_BLOCKED: 'Solicitação bloqueada por regra vigente do sistema.',
    VALIDATION_ERROR: 'Dados inválidos ou inconsistentes.',
    UNAVAILABLE: 'Serviço indisponível no momento.'
  };
  return { ok: false, code, message: messages[code] || 'Não foi possível concluir a consulta ou operação.' };
}

export function createAiRouter({ hr, getActor, client = new OpenAI(), model = process.env.OPENAI_MODEL || 'gpt-5.5' }) {
  if (!hr || typeof getActor !== 'function') throw new Error('Forneça hr e getActor autenticado.');
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  async function authenticatedActor(req, res) {
    const actor = await getActor(req);
    if (!actor?.userId || !actor?.organizationId || !actor?.role) {
      res.status(401).json({ error: 'Autenticação obrigatória.' });
      return null;
    }
    if (!['employee','manager','hr','admin'].includes(actor.role)) {
      res.status(403).json({ error: 'Perfil sem acesso à IA.' });
      return null;
    }
    return actor;
  }

  router.post('/chat', async (req, res) => {
    try {
      const actor = await authenticatedActor(req, res);
      if (!actor) return;
      const message = req.body?.message;
      if (typeof message !== 'string' || !message.trim() || message.length > 2000) {
        return res.status(400).json({ error: 'Mensagem inválida ou muito longa.' });
      }
      // A memória vem do servidor e é isolada por organização e funcionário.
      const history = await hr.getRecentMessages(actor, { limit: 12 });
      const input = (Array.isArray(history) ? history : [])
        .filter(x => ['user','assistant'].includes(x.role) && typeof x.content === 'string')
        .slice(-12).map(x => ({ role: x.role, content: x.content.slice(0, 2000) }));
      input.push({ role: 'user', content: message });
      const selected = allowedDefs(actor);
      const tools = selected.map(x => zodResponsesFunction({ name: x.name, description: x.description, parameters: x.params }));
      const pendingActions = [];

      for (let round = 0; round < 7; round++) {
        const response = await client.responses.create({
          model, instructions: systemPrompt(actor), input, tools,
          store: false, parallel_tool_calls: false, max_output_tokens: 800
        });
        if (response.status !== 'completed') throw Object.assign(new Error('Resposta incompleta'), { code: 'UNAVAILABLE' });
        input.push(...toResponseInputItems(response.output));
        const calls = response.output.filter(x => x.type === 'function_call');
        if (!calls.length) {
          const reply = response.output_text || 'Não consegui obter uma resposta completa. Tente novamente.';
          await hr.saveExchange(actor, { user: message, assistant: reply });
          return res.json({ reply, pendingActions });
        }
        for (const call of calls) {
          const definition = selected.find(x => x.name === call.name);
          let result;
          try {
            if (!definition) throw Object.assign(new Error('Ferramenta não autorizada'), { code: 'PERMISSION_DENIED' });
            const args = definition.params.parse(JSON.parse(call.arguments));
            // hr.* deve REVALIDAR escopo organizacional/permissões no próprio serviço.
            const data = await definition.run(hr, actor, args);
            result = { ok: true, data };
            if (definition.isPreview && data?.intentId) {
              pendingActions.push({ intentId: data.intentId, summary: data.summary, expiresAt: data.expiresAt });
            }
          } catch (err) {
            result = publicFailure(err);
          }
          input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
        }
      }
      return res.status(503).json({ error: 'Não foi possível completar as verificações. Nenhuma ação foi executada pelo chat.' });
    } catch (err) {
      // Logging de erro somente no backend, sem dados pessoais em logs desnecessários.
      console.error('Erro na IA de folgas:', err?.code || err?.name || 'unknown');
      return res.status(503).json({ error: 'Assistente temporariamente indisponível.' });
    }
  });

  router.post('/confirm', async (req, res) => {
    try {
      const actor = await authenticatedActor(req, res);
      if (!actor) return;
      const { intentId, confirm } = req.body || {};
      if (confirm !== true || typeof intentId !== 'string' || intentId.length > 160) {
        return res.status(400).json({ error: 'Confirmação inválida.' });
      }
      // CONFIRMAR NÃO É LIBERAR: hr.confirmIntent valida dono, política, prazo,
      // estado atual, aprovação exigida, transação, idempotência e grava auditoria.
      const result = await hr.confirmIntent(actor, { intentId });
      return res.json({ ok: true, result });
    } catch (err) {
      const safe = publicFailure(err);
      return res.status(safe.code === 'PERMISSION_DENIED' ? 403 : 409).json(safe);
    }
  });

  return router;
}
