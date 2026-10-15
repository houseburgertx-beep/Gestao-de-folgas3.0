/** EXEMPLO DE CONEXÃO. Insira no servidor existente; não é uma aplicação autônoma. */
import { createAiRouter } from './ai-router.mjs';
import { hrAdapter } from './hr-adapter.example.mjs';

// NUNCA use dados do cabeçalho fornecido pelo navegador para simular autenticação.
// Sua aplicação deve ter:
// - app: instância Express existente
// - requireAuthenticatedSession: middleware real de sessão/JWT verificado
// - requireCsrfProtection: verificação CSRF para rotas mutáveis com cookies
// - req.authUser: identidade consolidada pela autenticação real da aplicação
export function mountOnExistingApp(app, requireAuthenticatedSession, requireCsrfProtection) {
  app.use('/api/ia', requireAuthenticatedSession, requireCsrfProtection,
    createAiRouter({
      hr: hrAdapter,
      getActor: req => ({
        userId: req.authUser.userId,
        organizationId: req.authUser.organizationId,
        storeId: req.authUser.storeId,
        role: req.authUser.role
      })
    })
  );
}
