# Revisão de Documentos e Ponto — 6.17.8

## Correções aplicadas

### Documentos

- Funcionários agora recebem os filtros de status e competência depois da restrição aos próprios documentos. Gestor sem unidade não recebe documentos de terceiros.
- Listagem concorrente é deduplicada; troca de conta, aba ou atualização não permite que uma resposta antiga sobrescreva a mais recente. Pós-mutações sempre forçam atualização.
- A leitura para assinar só é liberada quando o PDF terminou de carregar. Fechar o modal remove eventos, timers e URLs temporárias; respostas antigas não afetam outro documento.
- IP é carregado em paralelo, sem bloquear a abertura. Indisponibilidade não vira informação técnica fictícia.
- Assinatura consulta estado atual no servidor e grava assinatura + status + PDF final em um único PATCH atômico. A resposta é silenciosa (204), sem baixar novamente o mesmo PDF após a gravação. A notificação não bloqueia o recibo.
- Identificador estável e assinatura imutável no banco impedem sobrescrita concorrente; documento já assinado retorna o recibo original em retry. Nova versão contestada usa o vínculo da assinatura anterior.
- Emissão individual e em lote exige destinatário existente e unidade autorizada. Hash de PDF sem hash fornecido usa os bytes originais, não a representação base64.

### Atestados

- Removida a tentativa incompatível de enviar arquivo médico pelo uploader de tarefas. O envio continua autenticado no módulo médico.
- Documento e solicitação de abono são gravados juntos. Anexo acima de dois milhões de caracteres não é mais descartado silenciosamente.
- Limite explícito de 6 MiB de arquivo / 8 MiB de conteúdo base64: acima dele o sistema recusa antes de gravar, com orientação para arquivo menor.
- Request ID estável por formulário e hash do conteúdo permitem reconhecer reenvio sem duplicar nem reabrir uma solicitação aprovada. Leituras de recibo são do servidor.
- Datas civis inexistentes são rejeitadas. Auditoria registra referências e hash, sem copiar PDF, CPF, CRM ou observação clínica; indisponibilidade da auditoria não transforma um envio confirmado em erro.

### Ponto

- Corrigida a variável da trava de duplo clique, também usada pelo bloqueio de atualização automática do PWA durante a captura.
- Eliminado um GET serial redundante: o resultado ETag do preflight é reaproveitado pelo PUT condicional da mesma conta. Concorrência continua protegida por If-Match.
- Upload, renovação de token, leitura de resposta, IndexedDB e espera de lock têm prazos. Callback que chega depois do prazo não inicia outra gravação.
- Troca de conta interrompe upload, leitura de foto e gravação. Token só é renovado à força após HTTP 401; falha 503 não provoca refresh inútil.
- Recuperação de marcação de ontem não muda a próxima ação do dia de hoje. Horário, identificador e recibo da foto continuam sendo os da tentativa original.
- Primeira captura é reservada atomicamente no IndexedDB. Só campos necessários são persistidos; tokens ficam de fora. Índice por UID evita carregar fotos de outras contas na recuperação.
- Aquecimento do serviço de fotos é deduplicado por 45 segundos.

## Validação e limites

Testes automatizados cobrem desconexão, token parado, troca de conta, resposta atrasada, retry, madrugada, atomicidade, documentos de outro funcionário, filtro, anexo grande, imutabilidade e auditoria. O build de produção é verificado; regras reais são exercitadas no emulador isolado do CI antes de publicação das regras.

Melhoria de velocidade comprovada por contagem de operações: um GET a menos por ponto e nenhuma cópia do PDF retornada no ACK de assinatura. Não foi alegado percentual de ganho em rede real.

Pontos estruturais ainda existentes: anexos médicos/PDFs ficam no RTDB; retirar base64 do objeto entregue à UI não elimina o download inicial do registro pelo SDK. Uma separação entre metadados e arquivos exige migração própria. PDFs longos ainda renderizam todas as páginas antes da apresentação. Envios médicos via SDK têm prazo de confirmação; o timeout não cancela uma escrita já enviada, por isso o reenvio consulta o mesmo identificador no servidor antes de gravar. Nenhum desses itens foi apresentado como resolvido.

Queda de internet, permissão negada, dispositivo sem armazenamento e indisponibilidade de serviços continuam possíveis. O ponto preserva a tentativa local para recuperação e não deve declarar sucesso sem confirmação do servidor. Não foram criadas marcações, assinaturas ou folgas reais durante os testes.

Validação local da entrega: 355 testes aprovados; um teste de regras depende do emulador (executado no CI). Build de produção aprovado. Os novos casos incluem anexo médico de 2,2 milhões de caracteres preservado, retry de solicitação já aprovada, assinatura atômica, espera de lock expirada e bloqueio de operações atrasadas.
