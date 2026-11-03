# House AI conversacional no WhatsApp — Groq

O WhatsApp passa a usar Groq como caminho principal quando `GROQ_API_KEY` está configurada no Worker. O modelo padrão é `openai/gpt-oss-120b` (alterável por `GROQ_MODEL`). A chave é um Secret do Cloudflare, nunca vai para frontend, repositório, logs ou respostas.

## Como funciona

1. O webhook valida assinatura, grupo/remetente, funcionário e perfil ativo antes de conversar.
2. Uma trava D1 por conversa organiza mensagens concorrentes entre instâncias do Worker. Falha de trava não executa ações em paralelo.
3. O modelo recebe até 12 mensagens recentes de usuário/assistente, data atual da Bahia e identidade mínima. O contexto é separado por funcionário/unidade e deixa de ser reaproveitado após 24 horas. Histórico antigo do motor de regras não é tratado como conversa do modelo.
4. O próprio modelo escolhe ferramentas para consultar registros reais: cadastro, folgas, jornada/descanso, tarefas, marcações, documentos e informações do sistema. Gestor pode resolver pessoas apenas no escopo autorizado. Campos médicos, fotos, coordenadas, senhas e CPF não fazem parte dos resultados.
5. Alterações de folga são propostas com nome, datas e motivo. Somente confirmação explícita em outra mensagem executa o caminho autenticado já existente. A proposta expira em cinco minutos; identidade, unidade, papel e destinatário são conferidos novamente. Confirmação consumida não executa duas vezes.
6. Não existe ferramenta de registrar ponto ou ajustar marcações no modelo. Conteúdo clínico explícito continua no fluxo protegido, fora da API do modelo.

Histórico fica em `workerPrivate/WhatsAppConversation`, numa chave HMAC própria do chat Groq. São salvas mensagens limitadas e proposta pendente, não arquivos ou fotos. A janela de contexto de 24h não é uma política de purga automática do banco. `limpar conversa` reinicia esse contexto e descarta propostas, sem alterar registros operacionais.

## Respostas e limites

A conversa deixa de passar primeiro por menus/palavras-chave. Falhas de API e limites 429 são informados como indisponibilidade, sem fingir resposta inteligente ou confirmação. Ferramentas usam allowlist e revalidam escopo no servidor. Respostas com orientações quantitativas de tolerância/prazos sem fonte ou promessa de ajuste indisponível são revisadas antes do envio. Isso reduz erros conhecidos; não constitui garantia de exatidão irrestrita do modelo.

O banco de horas consolidado continua no aplicativo: o chat não inventa saldo a partir de carga fixa ou pares de marcações. Tarefas distinguem abertas/concluídas; resultados limitados são identificados como parciais. Histórico é contexto, não comprovação de que um registro continua igual: ferramentas fazem consultas atuais.

## Configuração e diagnóstico

- Secret necessário: `GROQ_API_KEY` em Produção no Worker `house-folgas-notifications`.
- Opcional: `GROQ_MODEL`. Conferir disponibilidade e cotas na conta Groq. Não há upgrade de plano ou assinatura automática por esta integração.
- `POST /wa-ai-diagnostic`, com `X-Service-Token`, executa somente cenários fixos com dados fictícios, sem ler funcionários reais e sem enviar WhatsApp. Corpo `{}` testa ferramentas/continuação; `{"scenario":"conversation"}` testa conversa de atraso e redação de aviso. Sem o token, retorna 403. O token de serviço não ganha acesso a rotas administrativas nem a dados reais por esse diagnóstico.
- Dados fictícios do diagnóstico ficam em memória e não são gravados no cadastro. A rota retorna modelo, ação e respostas, nunca a chave.

## Verificação

77 testes do Worker aprovados, incluindo histórico, ferramentas, isolamento, confirmação única, erro de provedor, revisão de orientação sem fonte e trava concorrente usando o schema SQLite real do D1. Regressão do aplicativo: 307 aprovados e um teste de regras executado separadamente no emulador do CI.

Integração baseada na [API Groq](https://console.groq.com/docs/api-reference), [ferramentas](https://console.groq.com/docs/tool-use/overview) e [modelos/cotas](https://console.groq.com/docs/models). Não foi enviado WhatsApp real a funcionários durante a validação.

## Aplicativo e avisos automáticos — 6.17.7

O chat do aplicativo usa `/house-ai-chat`, autenticado pelo Firebase. A Groq consulta ferramentas autorizadas pelo perfil no servidor; o navegador não escolhe identidade, histórico nem modelo. O contexto é separado por conta, unidade, perfil e canal. Tarefas, folgas, comunicados e feriados geram cartões de revisão conforme as permissões existentes; a confirmação usa o botão do aplicativo.

Os envios centralizados de texto, botões e enquetes passam pelo compositor Groq, inclusive ponto, intervalos, lembretes e comunicados. Respostas já geradas pela Groq não passam duas vezes. O compositor escolhe apresentação e tom; os fatos ficam em slots opacos ordenados, sem transmitir o conteúdo pessoal do aviso ao modelo. Datas ISO são apresentadas em formato brasileiro e links permanecem intactos. A validação impede omitir fatos, inverter status ou adicionar regras.

Falha, limite ou demora da Groq preserva o aviso factual para não interromper a entrega. Permanecem a dependência do gateway conectado e os limites do provedor. Avisos automáticos não são incorporados ao histórico conversacional nesta versão.

O diagnóstico privado aceita `scenario: "native"` e `scenario: "outbound"`, usa dados sintéticos e não envia mensagens a funcionários.

Validação da versão 6.17.7: 90 testes do Worker aprovados; 321 testes do aplicativo aprovados e um teste de regras reservado ao emulador. Build e dry-run aprovados. Diagnósticos reais da Groq validaram os seis tipos de aviso; o cenário nativo consultou tarefas, preparou um cartão e recusou gravação pelo texto “sim”. Nenhuma mensagem real foi enviada.
