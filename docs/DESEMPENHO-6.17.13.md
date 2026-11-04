# Carregamento e ponto — 6.17.13

## Causas encontradas

A opção de abertura rápida era recebida pela interface, mas ignorada no backend. O login aguardava as coleções e os avisos da carga completa. Além disso, o timeout de requestIdleCallback era usado como se fosse um atraso: sete tarefas secundárias podiam iniciar juntas na primeira folga de CPU.

Consultas mensais administrativas não compartilhavam leituras em andamento. O cálculo do ponto mensal voltava a percorrer todos os registros para cada funcionário/dia. Redesenhos do dashboard também repetiam análises operacionais e construíam telas de equipe e escala que estavam ocultas.

## Mudanças

- Abertura rápida valida o acesso e devolve o perfil; coleções seguem pela carga adiada existente.
- Status rápido do ponto inicia suas quatro leituras independentes em paralelo.
- Registros e justificativas são indexados em memória por funcionário/dia para calcular o mês.
- Leituras mensais têm compartilhamento de requisição e cache curto de 15 segundos, isolado por conta, perfil, unidade, funcionário e mês, invalidado em gravações.
- Tarefas secundárias respeitam os atrasos individuais e descartam execução agendada para outra conta.
- Análise automática da IA compartilha chamadas e reaproveita o resultado por até um minuto; o botão Atualizar permite nova análise.
- Insights leem a tabela canônica RegistrosPonto nos meses necessários para hoje/ontem na Bahia, respeitam o perfil autenticado e dispensam a consulta de trocas não utilizada.
- Telas ocultas de equipe e escala são montadas quando abertas.

## Evidência

A suíte local passou com 439 testes, zero falhas e uma integração condicionada ao emulador. Fixtures demonstram três pedidos do mesmo mês compartilhando uma consulta e 7.820 acessos de identidade para 2.400 registros, comparados a mais de 1,4 milhão de comparações no algoritmo anterior. São medições de trabalho em teste, não promessas de tempo de rede ou de desempenho de todos os aparelhos.

A gravação e a confirmação no servidor do ponto não usam o cache de leitura. GPS, selfie e validações de salvamento permanecem no fluxo existente. Nenhum ponto real foi criado para esta validação.
