# Kit de integração de IA — Sistema de Folgas

Este kit entrega um **modelo inicial de backend seguro para IA de RH**, desenhado para um aplicativo de folgas desenvolvido sob medida.

> Não representa conexão concluída ao sistema existente: sem o código do app, o adapter possui funções intencionalmente não implementadas. O desenvolvedor precisa integrá-las e testar.

- `src/prompt.mjs`: instruções completas da IA.
- `src/ai-router.mjs`: rotas Express `POST /chat` e `POST /confirm`, ferramentas, validação e chamada à API da OpenAI.
- `src/hr-adapter.example.mjs`: contrato de serviços que deve ser ligado aos dados reais.
- `src/mount.example.mjs`: como montar as rotas após autenticação/CSRF do aplicativo.
- `docs/ESPECIFICACAO.md`: arquitetura, permissões, fluxos e testes de aceite.
- `.env.example`: variáveis de ambiente.

**Antes de produção:** ler integralmente `docs/ESPECIFICACAO.md`, concluir integração, testar controle de acesso, políticas, auditabilidade, idempotência e confirmação visual.

Referências oficiais: https://developers.openai.com/api/docs/guides/function-calling e https://developers.openai.com/api/docs/guides/conversation-state
