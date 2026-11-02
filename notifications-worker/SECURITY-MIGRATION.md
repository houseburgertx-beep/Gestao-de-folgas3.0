# Migração de segurança do Worker

As alterações locais não mudam os serviços publicados. Antes de publicar, aplicar as regras Firebase revisadas, preparar segredos e configurar o gateway; depois validar com conta e dados de teste.

## Segredos e configuração

- Rotacionar a chave WA-AKG anteriormente versionada. Cadastrar a nova chave como secret `WA_API_KEY` no Worker e no serviço local, sem gravar valor no código, `wrangler.jsonc`, logs ou chat.
- `WA_API_KEY` serve apenas para acessar o gateway. Não autentica administradores no Worker. Todas as operações do aplicativo usam token Firebase e perfil ativo.
- Para o supervisor/túnel que atualiza a URL, usar um secret separado `WA_SERVICE_TOKEN`, enviado em `X-Service-Token` somente a `/wa-gateway-config`. Não compartilhar com o frontend. Sem supervisor externo, esse secret é opcional.
- Configuração de gateway alterada pelo aplicativo exige Administrador. A chave enviada pela tela é gravada em `gestao-folgas/v2/workerPrivate/WhatsAppGateway/ApiKey`, fora das tabelas acessíveis ao aplicativo. O nó `workerPrivate` deve permanecer sem regras de leitura/escrita para clientes. A resposta retorna apenas máscara.
- O secret `WA_API_KEY` do ambiente tem prioridade sobre a chave privada no banco e sobre configuração legada. A primeira gravação de configuração migra chave antiga de `tables/Configuracoes/WhatsAppGateway/ApiKey` para o nó privado e remove o campo público. Antes de liberar, confirmar que o campo público foi removido, inclusive se o secret de ambiente já estiver em uso.
- Cadastrar um novo secret `WA_WEBHOOK_SECRET` aleatório. No WA-AKG, configurar exatamente esse valor no campo `secret` do webhook que envia `message.received` para `/wa-inbound` ou `/wa-webhook`. O gateway existente calcula HMAC-SHA256 sobre o JSON bruto e envia `X-Webhook-Signature: sha256=<hex>`; não é necessária alteração de código no gateway.
- Eventos assinados precisam de `timestamp` com desvio máximo de cinco minutos e ID de mensagem. O gateway já fornece esses campos. Mensagens de grupos são ignoradas. Falha no armazenamento de deduplicação bloqueia o processamento; não funciona em modo inseguro.
- `APP_ORIGIN` precisa ser a origem exata da aplicação publicada; uma URL com caminho não é uma origem. Desenvolvimento aceita apenas origens HTTP locais exatas (`localhost` ou `127.0.0.1` com porta opcional).
- Criar secret `INTEGRITY_PIN_SECRET`, aleatório com pelo menos 32 caracteres, independente dos demais. Ele protege o hash dos PINs e os identificadores de rate limit. Guardar cópia protegida: trocar esse secret sem migração invalida PINs já convertidos. Nunca enviar ao navegador.
- Aplicar a migração D1 `0002_integrity_limits.sql` antes de liberar o Canal de Integridade. Criação, consulta e mensagem funcionam anonimamente pelo Worker; clientes não acessam diretamente as tabelas. É necessário índice Firebase `DenunciasMensagens/DenunciaID` para consulta por protocolo.
- A conta de serviço Firebase requer leitura dos registros usados e escrita dos caminhos operacionais (folgas, saldo, notificações, denúncias e configuração privada); a descrição antiga de serviço apenas de leitura deixou de se aplicar. Limitar sua utilização a este serviço.

## Contratos e preservação dos fluxos

- `/integrity/create`, `/integrity/consult`, `/integrity/message`: POST com payload direto e resposta `{success,message,data}`. O PIN de seis dígitos é entregue uma única vez na criação. Consultas/mensagens aceitam PINs legados de quatro dígitos e os convertem, após verificação, para hash HMAC com salt; o PIN em texto é removido. Respostas de consulta nunca incluem PIN, salt ou hash.
- Rate limit usa D1: cinco criações por IP a cada 15 minutos, até 30 consultas/mensagens por IP e cinco tentativas por protocolo na mesma janela. IPs são persistidos apenas como hash com segredo; não são gravados no relato. Limites também contam acessos bem-sucedidos.
- A criação registra denúncia, mensagem inicial e aviso genérico à liderança em um único PATCH atômico. O aviso interno preserva anonimato. Não há disparo WhatsApp automático dessa criação; evita-se transferir conteúdo do relato para canal externo.
- `/wa-clock-event` usa o telefone do cadastro do usuário autenticado. O corpo não seleciona o destinatário. Essa rota envia avisos, sem criar uma marcação de ponto.
- `/wa-send` exige admin/gestor; gestor só envia a telefone cadastrado na sua loja.
- `/wa-notify` recebe apenas `notificationId` e lê conteúdo e destinos do registro persistido. Exige admin, gestor da loja ou criador identificado por `CriadoPorUID`. Criador colaborador envia apenas a si mesmo, ou à liderança da loja quando existe vínculo com seu registro de Folgas/Trocas/Documentos/Tarefas. Nesse último caso o WhatsApp contém texto genérico; os detalhes ficam no app. A regra Firebase precisa exigir autoria real na criação da notificação. D1 deduplica por aviso e destinatário.
- O bot não promove mais telefones fixos nem telefone da conexão a Administrador. Privilégios dependem de cadastro. Associação telefônica exige DDD e mantém compatibilidade com o nono dígito brasileiro. Gestores concedem folgas apenas na própria loja.

## Limite financeiro ainda existente

A concessão pelo bot passou a gravar folgas, movimentos, notificação e débito num único PATCH multipath, validando o HTTP de resposta. Para saldos existentes, o decremento é server-side, evitando perder um débito quando duas escritas se sobrepõem. Não faz leitura/gravação do nó inteiro `tables`.

A validação de saldo disponível ainda ocorre antes da gravação. Duas aprovações simultâneas podem consumir o mesmo saldo e ultrapassar o limite; os valores informativos de saldo anterior/novo em movimentos podem ficar desatualizados nesse cenário. Deduplicação de webhook não substitui uma transação financeira de saldo. Resolver isso exige um serviço transacional que reserve/valide o saldo e coordene todos os canais de escrita. Não anunciar que concorrência financeira foi completamente resolvida.

## Verificação local

`npm test` cobre assinatura/tampering, origem, ausência de login, chave do gateway sem privilégio administrativo, DDD, escopo da loja, gravação atômica/falhas, sigilo/migração do PIN, rate limit e deduplicação do relay. `npm run check` empacota o Worker com `wrangler deploy --dry-run`; não publica.
