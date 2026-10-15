/**
 * SUBSTITUA ESTAS IMPLEMENTAÇÕES PELOS SERVIÇOS EXISTENTES NO SEU SISTEMA.
 * Nunca coloque uma conexão SQL genérica à disposição do modelo.
 */
const integrate = name => { throw Object.assign(new Error(`Integrar ${name} ao backend da aplicação`), { code: 'UNAVAILABLE' }); };

export const hrAdapter = {
  // Todas as funções recebem actor obtido da sessão validada.
  getProfile(actor) { return integrate('getProfile'); },
  getSchedule(actor, { from, to }) { return integrate('getSchedule'); },
  getTimeBank(actor) { return integrate('getTimeBank'); },
  getRequests(actor, { status }) { return integrate('getRequests'); },
  getPolicy(actor, { topic }) { return integrate('getPolicy'); },
  getRecentMessages(actor, { limit }) { return integrate('getRecentMessages'); },
  saveExchange(actor, { user, assistant }) { return integrate('saveExchange'); },
  getTeamPendingRequests(actor) { return integrate('getTeamPendingRequests'); },
  getTeamCoverage(actor, { date }) { return integrate('getTeamCoverage'); },
  previewEmployeeRequest(actor, { kind, date, replacement_date, note }) {
    // Validar regras e criar intenção expirável vinculada ao actor.
    // RETORNAR { intentId, summary, expiresAt, status:'awaiting_confirmation' }
    return integrate('previewEmployeeRequest');
  },
  previewManagerDecision(actor, { request_id, decision, note }) {
    // Revalidar papel, pertencimento da solicitação à equipe e se cabe aprovação.
    return integrate('previewManagerDecision');
  },
  confirmIntent(actor, { intentId }) {
    // Executar em transação, com bloqueio/idempotência, nova checagem de políticas,
    // evento de auditoria e, quando aplicável, status 'pending_manager_approval'.
    return integrate('confirmIntent');
  }
};
