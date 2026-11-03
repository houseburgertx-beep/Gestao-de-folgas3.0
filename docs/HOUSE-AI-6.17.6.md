# House AI e dashboard mobile 6.17.6

- Retirada a reserva duplicada de 115 px mais safe-area na jornada. Espaço do dock preservado na área principal; intervalo de 16 px entre jornada e aviso no teste visual. Cartão responsivo, Conversar único e atalhos. Nome da sessão e folgas apenas do funcionário/mês, sem meta fixa inventada. Insights usam switchView em vez de navigateTo inexistente.
- Fallback genérico do proxy deixa de mascarar interpretador local; respostas/ferramentas e confirmações preservadas. Timeout de 20 segundos no provedor, com fallback. Instrução contraditória de foto corrigida.
- WhatsApp mantém assunto por funcionário/unidade/remetente por 20 minutos. Estado contém IDs, intenção, data e timestamp, sem transcrição. Chave HMAC em workerPrivate/WhatsAppConversation; dados não são públicos. Expiração/mudança de identidade impedem reaproveitamento; menu/ajuda reiniciam assunto.
- Continuação "qual meu horário hoje?" / "e amanhã?" consulta data correta, jornada ativa/vigente e descanso. Consulta própria de tarefas e cadastro, folgas com DataInicio/DataFim e campos legados. Saldo ambíguo pede esclarecimento; consumo não vira horas.
- Banco de horas consulta RegistrosPonto com fallback legado. A apuração simplificada preexistente está explicitamente identificada como estimativa, com base fixa de 7h20; saldo consolidado depende da jornada, ajustes, ausências e movimentos no aplicativo. Não inventa saldo futuro; pares DataHora respeitam virada de dia.
- 32 mensagens de ponto: oito para entrada, saída, intervalo e retorno. Confirmação/nome/hora preservados, sem inventar desempenho. Gerador aceita recordId e previousMessage opcionais; envio atual não promete antirrepetição persistente.
- Links view e tab legado abrem Ponto, Folgas, Tarefas, Documentos e Consumo.

## Validação e limites

307 testes do app aprovados; um teste depende do emulador executado separadamente no CI. 65 testes do Worker aprovados. Builds aprovados. Conferência mobile com dados fictícios e sem overflow horizontal; não houve mensagem real aos funcionários nem alteração de ponto neste trabalho.

Memória conversacional é de assunto, não um histórico completo nem aprendizado irrestrito. A IA não tem garantia de acerto de 100%. Dados consolidados devem ser conferidos nos módulos oficiais. Hospedagem do gateway continua a existente.
