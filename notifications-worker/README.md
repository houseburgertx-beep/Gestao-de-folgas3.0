# Lembretes de ponto — House 190

Implementação preparada; o serviço só fica ativo após conexão da conta Cloudflare, configuração dos segredos, banco D1 e publicação. A interface informa essa situação e não simula uma ativação bem-sucedida.

## O que envia

- Entrada e saída no horário cadastrado na jornada vigente, se a marcação ainda não ocorreu.
- Cinco minutos antes do fim do intervalo, calculado pela última saída para intervalo + duração cadastrada; e outro aviso na hora do retorno.
- Avisos novos do sistema destinados explicitamente ao funcionário ou ao e-mail do usuário. A tela bloqueada mostra texto genérico; o conteúdo fica dentro da conta.
- Ao tocar no lembrete, abre Meu ponto; os outros avisos abrem Avisos e lembretes.

Não registra ponto automaticamente. Cancela lembretes após retorno ou saída, respeita desativação, preferências, folgas aprovadas, jornada vigente e fuso da Bahia (UTC−03). Folgas parciais suprimem conservadoramente o lembrete de jornada para evitar horários incorretos. Não inventa duração de intervalo quando não existe jornada configurada. Entradas em dias de troca de folga fixa precisam ser conferidas na jornada; não se inferem novas escalas.

A verificação roda a cada minuto. Entrega pode atrasar por rede, sistema operacional ou Foco; não é um alarme com garantia de segundo exato. Se a verificação ocorrer depois do minuto inicial, o texto ajusta os minutos restantes. Alertas vencidos expiram; a fila tem controle de duplicação e limite de 20 tentativas por execução. Nenhuma notificação antiga anterior à ativação é reenviada.

## Configuração em conta própria e plano gratuito

1. Conectar a conta Cloudflare com `npx wrangler login` nesta pasta. Permanecer no plano Workers Free; não habilitar recursos pagos.
2. Criar D1: `npx wrangler d1 create house-folgas-notifications`. Copiar o ID retornado para `wrangler.jsonc`, no lugar de `REPLACE_AFTER_D1_CREATE`.
3. Aplicar `npx wrangler d1 migrations apply house-folgas-notifications --remote`.
4. Gerar um par VAPID com `npx web-push generate-vapid-keys`. Manter a chave privada fora do repositório. Cadastrar as chaves com `npx wrangler secret put VAPID_PUBLIC_KEY` e `npx wrangler secret put VAPID_PRIVATE_KEY`.
5. Criar/usar uma conta de serviço do projeto Firebase com acesso de leitura ao Realtime Database. Cadastrar `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` com `wrangler secret put`. A chave deve ser inserida pelo terminal/console, nunca enviada por chat. O serviço só faz leituras no Firebase; os dispositivos e o controle de envio ficam no D1.
6. Cadastrar `FIREBASE_WEB_API_KEY`, usando a chave pública do mesmo projeto já configurado em `src/firebase-config.js`. Ela é usada para verificar o login; não concede acesso por si só.
7. Publicar `database.rules.json` pelo fluxo Firebase existente. A única alteração desta versão é acrescentar o índice `DataCriacao` (o índice `Data` já existe); as permissões são preservadas.
8. Rodar `npm test` (Node 24) e `npm run check`, depois `npm run deploy`.
9. Preencher `src/push-config.js` com o endereço HTTPS retornado pelo Worker e a chave **pública** VAPID. Não colocar segredos ali. Publicar o aplicativo pelo fluxo normal do GitHub Pages.
10. No iPhone (iOS 16.4+), adicionar o aplicativo à Tela de Início, abrir pelo ícone e tocar em Ativar neste celular. Android: usar navegador compatível e permitir notificações. Escolher as preferências e usar Enviar teste.

`APP_ORIGIN` deve ser a origem do aplicativo; `APP_URL` identifica seu endereço. CORS não usa curinga. Contas desativadas no cadastro de acesso não recebem envios. Até cinco dispositivos por conta; inscrições sem uso por 90 dias expiram. Sair da conta revoga a inscrição no navegador e tenta removê-la do serviço, sem impedir logout offline.

## Custo e dados

Web Push não cobra por mensagem. Workers, D1 e Firebase têm cotas próprias. Não é uma promessa de uso ilimitado: consultar o consumo antes e depois da ativação. O Worker lê cadastro/jornadas/folgas, acessos e registros dos últimos dois dias a cada minuto enquanto houver dispositivos. Selfies antigas embutidas ou um histórico muito grande podem elevar o tráfego; respostas maiores que 8 MiB são recusadas. Não ativar cobrança automática para contornar cota: se necessário, reduzir tráfego e refinar o modelo de dados. Tokens push e chaves de inscrição ficam apenas no D1, sem endpoint público de listagem.

## Verificação antes de liberar à equipe

Em uma conta de teste, confirmar: teste recebido com app fechado; aviso próximo do fim de um intervalo; cancelamento após retorno antecipado; lembrete de entrada apenas sem batida; saída após meia-noite; notificações desativadas; logout; acesso inativado. Conferir o consumo do primeiro dia. Esses testes de entrega em aparelhos reais dependem da ativação do serviço e não foram substituídos pelos testes automatizados.

## Reversão

A alteração de interface não migra saldos nem apaga registros. Para voltar ao visual anterior, reverter o commit desta versão e publicar pelo fluxo existente. Para interromper envios, remover o cron do Worker e publicar sua configuração; limpar a URL pública no aplicativo impede novas ativações, mas sozinho não interrompe assinaturas já existentes.
