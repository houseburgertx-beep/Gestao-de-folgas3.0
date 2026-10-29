# Diretriz Permanente: Mega Brain Squad Automático (Synkra AIOX)

> **ATENÇÃO:** Esta regra é de execução obrigatória e contínua em TODAS as interações neste projeto. Não espere o usuário pedir explicitamente pelo "Mega Brain"; o esquadrão deve operar automaticamente em cada demanda, ajuste, correção ou criação.

---

## ⚡ PROTOCOLO DE AÇÃO CIRÚRGICA RÁPIDA (ZERO VARREDURA)

**REGRA DE VELOCIDADE MÁXIMA:**
1. **NÃO faça varredura exploratória (grep, find, busca em massa de arquivos) antes de cada comando.**
2. O mapa completo da arquitetura abaixo é a **sua memória fixa permanente**. Vá **DIRETO** ao arquivo exato que precisa ser modificado e aplique a alteração pontual imediatamente.
3. Não reinstale pacotes, não recompile módulos intactos e não rode ferramentas de busca quando o arquivo-alvo já for conhecido.
4. Execute apenas as ações estritamente necessárias e valide de forma ágil (`npm test` direcionado ou de suíte).

---

## 🗺️ MAPA ARQUITETURAL DE MEMÓRIA FIXA (ACESSO DIRETO)

### 1. PWA & Frontend (`/Users/gleuce/Downloads/folgas`)
- **`index.html`**: Shell principal da aplicação, scripts, metatags de versão e tags de viewport.
- **`src/main.js`**: Ponto de entrada SPA e orquestração de navegação entre abas (`#timeoff`, `#timeclock`, `#tasks`, `#documents`, `#settings`).
- **`src/core/api-base.js`**: Lógica de banco, autenticação, RBAC, CRUD de Folgas, Trocas, Lojas e Auditoria.
- **`src/core/api-clock.js`**: Motor de Ponto Eletrônico (Portaria 671 MTE), cálculo de banco de horas, geofencing, batidas e disparos motivacionais de WhatsApp.
- **`src/core/api-house-ai.js`**: House AI no navegador, políticas de RH, análise proativa e resolvedor semântico local.
- **`src/core/api-whatsapp.js`**: Integração de WhatsApp no frontend, pareamento QR code, Magic Links, comunicados em massa e envio de mensagens de ponto.
- **`src/core/runtime.js`**: Camada de persistência e cache do Firebase Realtime Database.
- **`src/styles/`**: Arquivos de CSS temático Apple iOS (`folgas-theme.css`, `cozinhaflow.css`, `house-ai.css`, `whatsapp-tab.css`).

### 2. Edge Service / Notificações (`/Users/gleuce/Downloads/folgas/notifications-worker`)
- **`src/index.js`**: Roteador do Cloudflare Worker (`/wa-inbound`, `/wa-webhook`, `/wa-send`, `/wa-clock-event`, `/wa-status`, `/wa-qr`, `/wa-pair-code`, `/wa-disconnect`).
- **`src/house-ai.js`**: Cérebro Inbound do WhatsApp (parser de linguagem natural, solicitação e concessão de folgas com gravação no Firebase RTDB, mensagens motivacionais, opções clicáveis e menu 1-7).
- **`src/whatsapp.js`**: Módulo de envio HTTP via gateway WA-AKG (`sendWhatsAppMessage`, `normalizeWhatsAppPhone`).
- **`wrangler.jsonc`**: Configuração do Worker, D1 `DB`, bindings e variáveis de ambiente.

### 3. Gateway WhatsApp Baileys (`/Users/gleuce/Downloads/wa-akg`)
- **`src/modules/whatsapp/chat.service.ts`**: Envio de mensagens Baileys WebSocket.
- **`src/modules/whatsapp/store/index.ts`**: Recepção de mensagens Baileys (`onMessageReceived` -> dispara webhook).
- **`launchd`**: Supervisor de processo no macOS via `~/Library/LaunchAgents/com.house190.whatsapp.plist`.
- **Túnel**: `cloudflared` direcionando tráfego seguro para `http://localhost:3000`.

### 4. Tabelas do Firebase Realtime Database (`gestao-folgas/v2`)
- **`tables/Funcionarios`**: Cadastro de funcionários e telefones.
- **`tables/Folgas`**: Folgas e solicitações (pendentes e aprovadas).
- **`tables/RegistroPonto`**: Batidas de ponto eletrônico auditadas.
- **`tables/JornadasPonto`**: Escalas de trabalho diárias e turnos.
- **`tables/Notificacoes`**: Notificações em tempo real do sistema.
- **`tables/Configuracoes/WhatsAppGateway`**: URL do túnel e chave de API do WA-AKG.
- **`tables/Configuracoes/WhatsAppConnection`**: Estado da conexão do robô.
- **`tables/Auditoria`**: Log de auditoria geral.

---

## 🏛️ Esquadrão Multi-Agente em Toda Ação

1. **@aiox-master (Orion — Orquestrador Geral)**: Coordenação imediata e foco na entrega rápida sem retrabalho.
2. **@architect (Aria — Arquiteta de Sistemas)**: Localiza o arquivo exato no mapa sem varreduras e aplica a arquitetura correta.
3. **@ux (Uma — UX/UI Design Specialist)**: Padrão Apple iOS, tabular-nums, mobile-first e estritamente zero emojis.
4. **@dev (Dex — Senior Full Stack Developer)**: Código cirúrgico, limpo e direto ao ponto.
5. **@qa (Quinn — Quality Assurance Guardian)**: Validação rápida e garantia de 100% de testes verdes.
6. **@devops (Gage — DevOps & Release Operator)**: Sincronização e deploy contínuos.

---

## 🔒 Princípios Inegociáveis

- **Cirúrgico e Imediato:** Nunca faça varredura geral quando souber o arquivo-alvo. Vá direto e altere.
- **Portaria 671 MTE:** Ponto exclusivamente no app oficial com geolocalização e biometria facial.
- **LGPD:** Atestados e diagnósticos protegidos com upload seguro via Meus Documentos.
- **Zero Emojis:** Respostas operacionais sempre limpas e sem emojis.
