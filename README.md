# Gestão de Folgas — Grupo House 190

Versão 6.17.5. Aplicação PWA em JavaScript/Vite, Firebase Authentication e Realtime Database, com Cloudflare Worker para notificações e WhatsApp e serviço Google Apps Script para fotos privadas no Drive.

Os fluxos ativos incluem funcionários/lojas, folgas e trocas, férias, ponto com selfie e localização, banco de horas, documentos/assinaturas, tarefas, comunicados, relatórios e Canal de Integridade. A interface e seus estilos foram preservados nesta revisão.

## Executar e validar

Requisitos: Node.js 20 ou superior no app; Node.js 24 para os testes do Worker (SQLite embutido). Use as versões dos lockfiles.

```bash
npm ci
npm run dev
npm run check
cd notifications-worker
npm ci
npm test
npm run check
```

`npm run check` do Worker faz somente dry-run. O build monta automaticamente `index.html` e `public/generated/` a partir dos fontes; não edite esses arquivos gerados. Scripts e estilos clássicos têm nomes com hash e são armazenados pelo service worker. O código clássico mantém seu escopo global para preservar handlers existentes.

## Segurança e publicação

A revisão exige publicação coordenada do Worker, regras do banco, serviço Apps Script e frontend. Veja [guia da revisão](docs/OTIMIZACAO-6.17.4.md) e [migração do Worker](notifications-worker/SECURITY-MIGRATION.md). Não publique apenas o frontend: os endpoints novos e as permissões das fotos precisam estar preparados.

Credenciais de serviço ficam em secrets de servidor. `src/firebase-config.js`, `src/push-config.js` e `src/selfie-drive-config.js` contêm apenas configuração pública. Contas existentes precisam de perfil ativo previamente provisionado; autocadastro não concede privilégios administrativos. Magic Links direcionam o usuário autenticado aos seus documentos, sem substituir o login.

Fotos novas são privadas no Drive e visualizadas pelo serviço autenticado. Fotos antigas com compartilhamento público precisam de revisão/migração própria. Arquivos documentais e contingências de fotos de tarefas ainda podem usar RTDB; acompanhe tamanho, retenção e consumo.

O ponto preserva a tentativa e a foto em IndexedDB, separadas por UID, antes de enviar. Reenvio usa o mesmo identificador, horário e recibo do upload. A confirmação depende de resposta do servidor; falhas não são exibidas como marcação concluída. Sem câmera, abre a captura nativa; não gera selfie ilustrativa. Selfie não equivale a reconhecimento biométrico facial nem certificação regulatória.

## Testar regras reais

Com Java 21 e Firebase Emulator Suite:

```bash
npx --yes firebase-tools@14.22.0 emulators:exec --only database --project demo-folgas-tests --config firebase.test.json "node --import ./scripts/test-network-guard.mjs --test tests/database-rules.test.mjs"
```

Ou, com o emulador já iniciado, defina `FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000` e execute o teste. A suíte de regras usa exclusivamente o emulador e não acessa produção. Sem essa variável, o teste é marcado como não executado. O workflow de CI contém um job dedicado ao emulador.

## Organização

- `src/legacy/`: templates e script clássico usados pela interface atual.
- `src/core/`: persistência, autorização de cliente, handlers de domínio e recuperação do ponto.
- `src/tasks.js`, `src/documents.js`, `src/copilot.js`: módulos da interface.
- `notifications-worker/`: notificações push, WhatsApp, webhooks assinados e Canal de Integridade.
- `google-apps-script/`: upload e leitura autorizada de fotos privadas.
- `tests/`: regressões funcionais, recuperação e permissões reais.
- `kit_ia_folgas/`: exemplos independentes de integração, fora do bundle do aplicativo.

Os arquivos desativados de Arena/House Link, sem referências no aplicativo, foram removidos; permanecem recuperáveis no histórico Git. Nenhuma tela ativa foi retirada.

O ajuste mobile 6.17.5 está documentado em [melhorias mobile](docs/MOBILE-6.17.5.md).
