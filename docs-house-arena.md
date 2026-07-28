# House Arena Remix + House Link — especificação mobile-first

## 1. Diagnóstico do projeto recebido

O módulo já tinha uma base segura: onze geradores determinísticos iguais no
cliente e no servidor, pontuação recalculada no backend, limite diário, ranking
compacto e nenhuma gravação por toque. Essa arquitetura foi preservada.

Os problemas encontrados estavam principalmente na experiência:

- cinco jogos repetiam a mesma mecânica de escolher uma opção;
- Delivery, Cozinha em Pânico e Pega-Ladrão destacavam visualmente a resposta;
- Caixa Turbo oferecia respostas prontas em vez de permitir calcular o troco;
- não havia pausa controlada, retomada após recarregar a página ou fila de
  reenvio do resultado;
- som e vibração não tinham controles independentes;
- não havia opção manual para reduzir movimentos ou reforçar o contraste;
- o catálogo ocupava muita altura no celular;
- o modo de partida ainda dividia atenção com elementos do portal;
- havia muitas regras responsivas legadas e sobrepostas;
- sair da tela durante uma rodada deixava o jogo correndo em segundo plano.

### 1.1 Auditoria individual

| Jogo | Ideia preservada e problema anterior | Mobile, toque, visual e fluxo | Desempenho e dados |
| --- | --- | --- | --- |
| Corrida dos Pedidos | reconhecer rapidamente uma comanda; quatro respostas iguais a várias outras provas tornavam a rodada repetitiva | a hierarquia entre comanda e opções era fraca e o catálogo consumia espaço; virou Rush de Pedidos, com comanda dominante, opções grandes e leitura por nome + símbolo | quatro botões por rodada, animações por `transform`/`opacity` e nenhum envio por toque |
| Bandeja Perfeita | memorizar a ordem; a reconstrução tinha pouco senso de progressão | sequência e resposta competiam visualmente em telas baixas; virou Bandeja Neon, com fase clara de observação, slots de progresso e paleta acessível ao polegar | reutiliza uma paleta pequena, cancela a sequência ao pausar e envia apenas a resposta final da rodada |
| Caixa Turbo | calcular troco; alternativas prontas permitiam acertar por adivinhação | não havia sensação de operar um caixa; passou a ter gaveta, soma visível, desfazer, confirmação e alternativa por teclado | estado da gaveta fica em memória; o servidor aceita múltiplos de R$ 0,50 e recalcula acerto sem novas leituras |
| Molho no Ponto | acertar uma faixa rítmica; um toque isolado tinha pouco peso físico | o ponto ideal era fácil de perder em telas estreitas; virou Molho no Ponto 2, com faixa ampliada, pressionar/soltar, texto de precisão e alternativa por clique | um único `requestAnimationFrame`, cancelado na pausa ou ao ocultar a aba |
| Monte o Lanche | montar ingredientes em ordem; faltava representar o lanche crescendo | receita, escolha e resultado pareciam listas desconectadas; virou Burger Stack, com receita rolável, pilha visual e desfazer | DOM limitado ao tamanho da receita e um evento agrupado por lanche |
| Caça ao Erro | localizar o item diferente; a grade perdia legibilidade ao crescer | células e espaçamento não se ajustavam bem a telas pequenas; virou Intruso na Chapa, com grade fluida, alvos maiores e feedback que não depende só de cor | 12 ou 16 células fixas por rodada, sem imagens ou listeners persistentes |
| Delivery Relâmpago | escolher a pista segura; a apresentação anterior entregava visualmente a resposta e era só múltipla escolha | ganhou estrada, moto móvel, toque na pista, gesto horizontal e botão Acelerar; retrato e paisagem usam a mesma regra | apenas três pistas; posição local via variável CSS e um evento enviado ao concluir |
| Cozinha em Pânico | localizar e resolver uma emergência; a classe visual da estação correta revelava o alvo | agora o jogador compara o texto do alerta com símbolos neutros, sem destaque prévio da resposta | seis estações por rodada, sem consulta extra e sem animação contínua |
| Pega-Ladrão da Batata | encontrar o ladrão; ele continuava visível no momento da resposta | virou Operação Batata: mostra, fecha todas as caixas e só então habilita o toque, criando memória real | temporizador curto cancelável por token de renderização; nove ou doze células |
| Rota do Motoboy | decidir a rota mais rápida; os cartões tinham informação sem hierarquia e pouca tensão | virou Central de Rotas, comparando ETA, trânsito, distância e semáforos em cartões responsivos | três rotas determinísticas e uma única decisão persistível ao final |
| Garçom Equilibrista | compensar a queda; três botões faziam o desafio parecer outra pergunta de alternativas | virou Bandeja em Jogo, com cena inclinada, gesto contrário à queda e três botões equivalentes para acessibilidade | gesto compartilhado por Pointer Events, sem sensores, polling ou listener no Firebase |

Em todos os onze casos, a autenticação, a semente e a validação permaneceram no
Apps Script. Estado visual, animações, movimentos, combos e tentativas ficam
somente no navegador. Assim, a reformulação não acrescenta uma leitura ou
gravação por mecânica.

## 2. Nova proposta dos onze jogos

| Jogo | Ideia central preservada | Nova jogabilidade | Controle principal | Orientação |
| --- | --- | --- | --- | --- |
| Rush de Pedidos | reconhecer o pedido correto | comanda prioritária, cartões grandes e combo progressivo | toque direto | retrato; paisagem suportada |
| Bandeja Neon | memorizar uma sequência | flashes progressivos, reconstrução por posições e dificuldade crescente | toque sequencial | retrato |
| Caixa Turbo | calcular troco | gaveta com notas e moedas; o jogador soma, desfaz e confirma | toques repetidos | retrato; grade ampliada em paisagem |
| Molho no Ponto 2 | acertar a zona de precisão | marcador rítmico e comando de segurar/soltar, com toque simples como alternativa | pressionar e soltar | retrato |
| Burger Stack | montar receita em ordem | receita horizontal, pilha visual, seleção direta e desfazer | toque direto | retrato |
| Intruso na Chapa | encontrar o item diferente | varredura visual com tabuleiro progressivo e alvos maiores | toque direto | ambas |
| Delivery Relâmpago | escolher a pista segura | leitura da avenida, moto móvel e confirmação de aceleração | deslize horizontal ou toque na pista | retrato e paisagem |
| Cozinha em Pânico | resolver a emergência | triagem pelo texto do alerta; nenhum cartão recebe a classe da resposta | toque por prioridade | retrato |
| Operação Batata | capturar o ladrão | o ladrão aparece por instantes e todas as caixas fecham antes da escolha | memória + toque | retrato |
| Central de Rotas | escolher a rota mais rápida | comparação de ETA, distância, trânsito e semáforos | toque estratégico | ambas |
| Bandeja em Jogo | compensar a inclinação | gesto na direção oposta à queda; toque central para estabilizar | deslize ou três botões acessíveis | retrato e paisagem |

## 3. Novo fluxo

1. **Temporada:** apresentação curta, estado da conexão e benefícios.
2. **Central de missões:** filtros por Reflexo, Estratégia, Memória, Precisão e
   Percepção.
3. **Lobby do jogo:** descrição, habilidade, dificuldade, mecânica, recorde,
   posição, limite diário e instruções em três passos.
4. **Partida:** cabeçalho compacto, sair, pausar, placar, tempo, combo e barra
   de ritmo.
5. **Tutorial contextual:** uma dica curta aparece na primeira rodada de cada
   jogo e desaparece sem bloquear a ação.
6. **Pausa segura:** até 60 segundos acumulados; a rodada atual reinicia sem
   registrar um evento incompleto.
7. **Resultado:** nota S–D, pontos, acertos, combo, precisão, diagnóstico curto
   e atalhos para repetir, voltar ou avançar.
8. **Sincronização:** se o envio falhar, o resultado fica numa fila local curta
   e é reenviado quando a conexão voltar.

## 4. Layout e direção de arte

- Base visual de arena noturna com ciano, lima e dourado para leitura rápida.
- Cada jogo mantém uma cor própria usada no cartão, lobby e botão principal.
- Catálogo em carrossel com *scroll snap* no celular e grade no tablet/desktop.
- Áreas de toque principais com aproximadamente 44–52 px.
- Modo de partida sem hero, catálogo ou ranking, reduzindo distrações.
- HUD compacto acima da área de ação; não cobre controles.
- Uso de CSS, emojis e formas vetoriais; nenhum arquivo de imagem pesado.
- `env(safe-area-inset-*)`, `dvh`, `clamp()`, Grid, Flexbox e unidades
  relativas.
- Regras especiais para celular pequeno, tela baixa e paisagem.

## 5. Progressão, recompensa e acessibilidade

- Combo alimenta a barra de ritmo; combo 10 ativa a leitura visual de Turbo.
- Dificuldade continua derivada da rodada e da semente validada pelo servidor.
- Feedback de acerto, erro, precisão e perda de combo usa texto, forma, som
  opcional e vibração opcional — nunca apenas cor.
- Preferências locais: sons, vibração, movimentos reduzidos e alto contraste.
- `prefers-reduced-motion` é respeitado automaticamente.
- Todos os gestos possuem alternativa por botão ou toque.
- Foco visível e rótulos acessíveis foram mantidos nos controles essenciais.

## 6. Estado local, conexão e Firebase

O consumo persistente permanece igual ou menor:

- uma chamada ao iniciar a partida;
- uma chamada ao finalizar;
- ranking somente ao entrar, voltar ao lobby, trocar filtros ou atualizar;
- nenhuma leitura duplicada de ranking logo após finalizar ou reenviar;
- nenhuma gravação por movimento, toque, animação, combo ou contador;
- snapshot ativo em `sessionStorage`, limitado a 60 segundos;
- preferências e fila de reenvio em `localStorage`;
- fila limitada a três resultados e aproximadamente 4,5 minutos;
- fila vinculada ao utilizador para não misturar contas num aparelho
  compartilhado;
- altura útil atualizada ao abrir teclado virtual, mudar a orientação ou
  recolher/exibir a barra do navegador;
- efeitos secundários reduzidos automaticamente quando o aparelho informa
  pouca memória, poucos núcleos ou economia de dados;
- o backend só consome o token depois da gravação do resultado, permitindo
  nova tentativa quando o banco falha antes de salvar.

## 7. Arquitetura implementada

- `HouseArena.gs`: catálogo, geração determinística, validação e ranking.
- `ArenaClient.html`: lógica dos jogos, renderização e pontuação local.
- `ArenaMobileRuntime.html`: gestos compartilhados, preferências, pausa,
  retomada, conexão e fila de sincronização.
- `ArenaStyles.html`: estilos legados preservados para compatibilidade.
- `ArenaMobileStyles.html`: camada final mobile-first e componentes novos.
- `Index.html`: novo fluxo, HUD, overlays, preferências e resultados.

## 8. Verificação

Testes incluídos:

- `tests/arena_static_qa.cjs`: sintaxe, CSS, includes, IDs, requisitos mobile,
  ausência de acesso direto ao Firebase e catálogo completo;
- `tests/arena_challenge_parity.cjs`: compara 11 geradores cliente/servidor em
  24 combinações de semente e rodada por jogo (264 comparações);
- `tests/arena_scoring_qa.cjs`: exercita os onze validadores, o troco montado
  livremente e rejeições antitamper;
- `tests/arena_mobile_qa.cjs`: mede overflow e interações em 320×568, 360×800,
  390×844, 430×932, tablet retrato, tablet paisagem, desktop e celular
  paisagem; também cobre os onze renderizadores, alvos de 44 px, mudança de
  orientação durante a partida, viewport contraída, modo offline e aparelho
  de baixo desempenho.

Antes de publicar, execute também os testes e diagnósticos já descritos em
`README_IMPLANTACAO.md`, faça uma rodada real de cada jogo e confira o ranking
com uma conta de funcionário.

## 9. Evolução 5.5.0 — House Link

O catálogo passou a ter doze jogos. Os onze desafios descritos acima continuam
solo e determinísticos. O décimo segundo é o **House Link**, uma partida
cooperativa de 84 segundos para dois funcionários autenticados em aparelhos
diferentes.

### Fluxo da dupla

1. Um funcionário cria uma sala e recebe um código de seis caracteres.
2. O parceiro entra pelo código; ambos confirmam que estão prontos.
3. Na primeira fase, um jogador atua no Atendimento e vê a comanda completa,
   enquanto o outro atua na Cozinha e vê apenas o produto base.
4. O Atendimento envia etiquetas; a Cozinha monta e envia a bandeja pelo
   portal; o Atendimento confere, devolve ou entrega.
5. Panes exigem um pulso dos dois aparelhos. A barra de conexão ativa o Modo
   Sintonia por oito segundos, dobrando os pontos.
6. Na metade da rodada os papéis são invertidos.
7. O resultado, as medalhas e a opção de revanche aparecem nos dois celulares.

### Sincronização e proteção

- O navegador continua sem acesso direto ao Firebase.
- O Apps Script autentica cada chamada e confirma que o utilizador pertence à
  sala.
- A visão da Cozinha remove os detalhes privados da comanda no servidor, não
  apenas no HTML.
- Cada ação possui identificador idempotente e não pode pontuar duas vezes.
- Criação e entrada em salas possuem limite de tentativas por funcionário.
- Ações são validadas pelo papel, pela fase, pelo pedido e pelo horário do
  servidor.
- A sala guarda no máximo 24 eventos e expira automaticamente.
- O estado é consultado de forma adaptativa; animações, partículas, seleção
  local e contadores não são transmitidos.
- Cada integrante recebe o mesmo resultado validado, respeitando o limite
  competitivo diário individual.

### Novos módulos

- `HouseLink.gs`: salas, presença, papéis, comandas, validações, pontuação,
  expiração e gravação idempotente no ranking.
- `HouseLinkClient.html`: lobby, polling adaptativo, reconexão, missões,
  interações, portal, eventos e revanche.
- `HouseLinkStyles.html`: interface responsiva, aurora, vidro, portais,
  partículas, modo sintonia e alternativas para movimento reduzido.
- `tests/house_link_qa.cjs`: sigilo entre papéis, pontuação, pane, troca,
  fila compacta e idempotência.
- `tests/house_link_api_qa.cjs`: criação, convite, autorização, ciclo da
  partida e gravação idempotente do resultado da dupla.
- `tests/house_link_dom_qa.cjs`: entrada, sala, telas de Atendimento e Cozinha,
  incidente, resultado e sanitização de conteúdo remoto.
