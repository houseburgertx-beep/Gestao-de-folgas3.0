# Melhorias mobile 6.17.5

- Assistente carregado no primeiro toque, com agrupamento de toques repetidos e nova tentativa se o download falhar. O bundle do assistente (138,55 kB minificado; 40,27 kB gzip) fica separado da execução inicial.
- Service Worker reutiliza bundles com hash sem revalidá-los na rede a cada visita. Scripts sem hash continuam atualizando. Falha por quota ao armazenar um bundle não bloqueia sua resposta online.
- Recompensas mensal e de feriados são consultadas em paralelo no bootstrap, preservando os fallbacks independentes.
- Indicadores da cozinha agrupam tarefas e ajustes uma única vez por funcionário. No teste de 40 funcionários, 1.000 tarefas e 200 ajustes, as leituras de identificadores passaram de 48.000 para 1.200, mantendo os resultados.
- Layout, campos, regras de cálculo, leitor PDF offline, autenticação e fluxo de ponto preservados. Versões do frontend, manifesto e PWA sincronizadas.

## Validação

`npm run check`: 303 testes aprovados, um teste dependente do emulador separado ignorado localmente, compilação aprovada. Novos testes comportamentais cobrem carregamento/retry do assistente, cache e equivalência dos indicadores.

Conferência visual em navegador com 390 x 844: tela de login sem overflow horizontal (largura da página e viewport: 390 px); controle de senha e abertura da política de privacidade conferidos.

O CI executa separadamente os testes das regras no emulador Firebase e do Worker. Não houve registro de ponto real, envio de WhatsApp a terceiros nem alterações em registros de funcionários nesta revisão. A conferência visual não substitui teste em aparelhos físicos nem representa validação manual de todos os fluxos autenticados.
