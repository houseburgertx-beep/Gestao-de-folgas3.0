# Ponto e reconhecimento — 6.17.10

## Diagnóstico e correções

- O reconhecimento estava associado ao funcionário correto, mas a tela de funcionário tentava consultar a tabela inteira. A consulta agora usa o próprio FuncionarioID, conforme as permissões existentes. Novos avisos atualizam o destaque na tela aberta.
- A indicação e o aviso validam o identificador canônico e a unidade do funcionário. O gestor pode avisar novamente sobre um reconhecimento existente sem criar outro prêmio. O aviso tem identificador estável e não usa e-mail como destinatário alternativo.
- A captura é preservada localmente antes da consulta de localização e da confirmação no servidor. Uma nova leitura do GPS mantém a mesma foto, horário e identificador da tentativa.
- Leituras rejeitadas por posição ou precisão invalidam o cache. Tentativas que precisam de GPS novo não ficam repetindo automaticamente uma coordenada inválida.
- A recusa do navegador é distinguida de bloqueio por contexto, configuração da unidade e permissão do banco. Quando a API informa permissão concedida ou pendente, uma recusa inicial recebe uma única nova leitura direta. Uma recusa persistente é exibida sem inventar coordenadas ou registrar sucesso.
- A precisão aproximada somente é admitida quando toda sua margem cabe na área oficial da unidade. O banco verifica a geometria usando a configuração oficial, sem confiar no raio ou distância enviados pelo cliente. Raios cadastrados não foram alterados.
- Cadastro e perfil com unidades divergentes falham antes de enviar foto ou ponto. O sistema não modifica vínculos por aproximação de nomes.

## Verificação

A suíte local passou com 393 testes, zero falhas e um teste de integração condicionado ao emulador. Inclui recusa de GPS com permissão ativa, renovação de localização preservando a foto, isolamento entre contas, reconhecimento por destinatário e proteção das coordenadas aproximadas. As regras precisam também passar no emulador Firebase antes da implantação.

Nenhum ponto real ou foto fictícia foi criado na validação. A gravação só é apresentada como confirmada após resposta do servidor; tentativas sem confirmação permanecem identificadas para recuperação. Falhas externas de GPS, aparelho e rede continuam possíveis.

Referência de plataforma: [Geolocation Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/geolocation) e [especificação de geolocalização](https://www.w3.org/TR/geolocation/).
