# Revisão 6.17.4 — confiabilidade e manutenção

## Alterações

- Ponto: IndexedDB por conta, preservação de foto/horário/ID, exclusão somente depois da confirmação, retomada na reconexão e retorno à tela; travas por conta/aba e escrita condicional ETag.
- Confirmação: leitura REST sem cache e prazo de resposta, sem confundir estado otimista do SDK com confirmação do banco. Upload reutiliza recibo real e nome estável; não inventa arquivo em falhas.
- Câmera e GPS: encerramento de streams tardios, limpeza de timers/monitores, posição recente com limites de precisão e fallback de rede. Negação de permissão não é contornada com localização antiga. O botão de contingência abre a câmera nativa real.
- Fotos: uploads autenticados/limitados, Drive privado, autorização de visualização por dono/admin/gestor da loja; tarefas carregam imagens sob demanda com cache limitado por UID.
- WhatsApp: frontend sem chave fixa, token Firebase atualizado, webhook HMAC e proteção contra replay, escopo por loja/DDD, status e QR reais, prazos de resposta e deduplicação. Mensagens/automação não bloqueiam a confirmação do ponto.
- Canal de Integridade: protocolo/PIN verificado no servidor, hash com segredo/salt, limitação de tentativas; consultas não recebem credenciais do relato.
- Banco: bloqueio de autopromoção, proteção de saldo/assinaturas, usuários inativos sem acesso, configurações sensíveis privadas, tokens WhatsApp vinculados ao titular.
- Desempenho: requisições iguais compartilham uma leitura; cache isolado por UID e protegido contra resposta obsoleta após edição; polling suspenso em segundo plano; HTML e ativos clássicos separados em cache.
- Limpeza: removidos módulos Arena/House Link sem referência no app, fallback de QR ilustrativo, selfie artificial e envio direto do navegador ao gateway.
- Notificações: identificador inclui tipo e destinatário, evitando sobrescrita entre colaboradores; contrato do aviso mensal corrigido e relay verifica evento relacionado.

## Publicação coordenada

1. Guardar backup das regras e dos serviços atuais e usar ambiente/contas de teste antes da produção.
2. Rotacionar a chave WhatsApp exposta e configurar secrets `WA_API_KEY`, `WA_WEBHOOK_SECRET`, `INTEGRITY_PIN_SECRET` e, se usar supervisor local, `WA_SERVICE_TOKEN`. Não reaproveitar o valor que estava no código.
3. Configurar o mesmo segredo HMAC no webhook do WA-AKG; o gateway existente já envia `X-Webhook-Signature` quando configurado. Aplicar a migração D1 0002 e conferir autorização da conta de serviço conforme SECURITY-MIGRATION.md.
4. Publicar o novo Worker e o serviço Apps Script mantendo o endpoint conhecido; confirmar upload e leitura de foto privada com conta de teste. O serviço Apps Script deve executar com a conta proprietária do Drive e validar o token Firebase recebido.
5. Publicar as regras Firebase e o frontend na mesma janela. Os fluxos novos exigem os endpoints novos; regras restritas com frontend antigo interrompem operações antigas inseguras.
6. Validar em um aparelho real autorizado: entrada, intervalo, retorno, saída, duplo toque, rede lenta/desconectada, reconexão, troca de conta, foto, visualização pelo gestor e pareamento WhatsApp. Não usar funcionários reais como dados de teste.
7. Verificar atualização da PWA; a versão 6.17.4 espera a captura do ponto terminar para recarregar automaticamente.

## Limites e decisões explícitas

- Nenhum sistema dependente de aparelho, permissões, rede e serviços externos pode garantir falha zero. Uma tentativa não confirmada fica identificada como pendente; não deve ser tratada como ponto aceito no servidor.
- O fluxo conserva o horário informado no aparelho para recuperação, sem alegar horário certificado pelo servidor. Coordenadas de navegador e selfie não comprovam, sozinhas, identidade biométrica ou impossibilidade de adulteração.
- Havendo marcação pendente no aparelho, a interface solicita sincronização antes de iniciar outra fase para preservar a sequência. O gestor continua dispondo dos fluxos de ajuste auditado.
- Fotos privadas novas não mudam retroativamente a permissão de fotos antigas; revogação pública e retenção precisam de migração controlada.
- Duas aprovações de folga simultâneas ainda podem consumir saldo acima do disponível. O PATCH do bot é atômico e o decremento não perde atualizações, mas falta uma reserva transacional coordenada entre bot e frontend. Não há promessa de solução financeira completa.
- Registros legados que não atendam ao novo schema podem exigir migração, especialmente tokens/cadastros sem vínculo e dados de ponto antigos. Não foram apagados dados de produção.
- A verificação local cobre código, testes, emulador, pacote e tela de acesso; permissões de câmera/GPS, credenciais privadas e serviços publicados precisam da validação em dispositivo/ambiente autorizado.

O mecanismo de escrita condicional segue a documentação oficial do [Firebase REST](https://firebase.google.com/docs/database/rest/save-data#section-conditional-requests).
