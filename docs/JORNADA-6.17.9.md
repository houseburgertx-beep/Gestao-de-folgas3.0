# Jornada pessoal — 6.17.9

- Mensagem de início com 32 versões, uma por dia no calendário da Bahia. O conteúdo permanece estável durante o dia e muda à meia-noite mesmo com a tela aberta.
- Removido o título de nível ao lado de “Minha jornada”, preservando a progressão em outros lugares do sistema.
- Destaque pessoal no topo, sem repetir o cartão extenso abaixo do ponto. Considera somente o ID do funcionário conectado, a unidade, o estado ativo e a semana vigente.
- Estrela pequena em dourado suave, traço fino e movimento leve em perspectiva. Entrada discreta somente na primeira apresentação; animações desativadas quando o dispositivo prefere movimento reduzido.
- Novos reconhecimentos recebem início e fim da semana no servidor. Registros antigos usam a data de criação; o texto livre “Semana” não é interpretado como data.
- Backend restringe resultados por perfil; carregamento evita respostas antigas de outra conta, unidade ou permissão. Pós-alterações força dados novos.

Validação: testes de mudança de dia/semana, nomes iguais com IDs diferentes, inativos, unidade, escape de conteúdo e isolamento de conta. Prévia com dados fictícios conferida no navegador a 390px, sem corte horizontal; animação em repetição verificada por estilo computado. Nenhum reconhecimento real foi criado nos testes.
