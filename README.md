# Gestão de Folgas — Firebase + GitHub

Conversão completa da interface **Gestão de Folgas 5.6.3** para uma aplicação
Web estática, publicável no GitHub Pages, com:

- Firebase Authentication por e-mail e senha;
- Firebase Realtime Database;
- regras de segurança por perfil, loja e funcionário;
- criação guiada do primeiro administrador;
- publicação automática com GitHub Actions;
- funcionamento sem Google Apps Script e sem Google Sheets;
- plano Firebase Spark, sem cartão, dentro das cotas gratuitas.

A interface original foi preservada: dashboard, calendário, folgas, ponto com
selfie e geolocalização, pendências, geração automática, funcionários, lojas,
feriados, acessos, regras operacionais, notificações, documentos, férias,
comunicados, enquetes, fechamento mensal, relatórios, House Arena e House Link.

## Começo rápido

1. Leia [PASSO_A_PASSO.md](PASSO_A_PASSO.md).
2. Crie o projeto Firebase e ative **Authentication > E-mail/senha**.
3. Crie o **Realtime Database**.
4. Copie os dados do aplicativo Web para `src/firebase-config.js`.
5. Publique `database.rules.json`.
6. Execute:

```bash
npm install
npm run dev
```

7. Abra o endereço mostrado no terminal e crie o primeiro administrador.

Para validar tudo antes de publicar:

```bash
npm run check
```

## Publicação

O arquivo `.github/workflows/pages.yml` compila e publica automaticamente no
GitHub Pages sempre que a branch `main` recebe um `push`.

No repositório, abra **Settings > Pages > Source** e escolha **GitHub Actions**.

## Estrutura

| Caminho | Finalidade |
| --- | --- |
| `src/legacy/` | Interface original preservada |
| `src/core/` | Firebase, regras de negócio e ponte de compatibilidade |
| `src/firebase-config.js` | Configuração pública do app Web Firebase |
| `database.rules.json` | Segurança do Realtime Database |
| `scripts/build-index.mjs` | Monta o HTML final a partir da interface original |
| `scripts/convert-legacy-export.mjs` | Converte exportação Firebase v1 para v2 |
| `.github/workflows/` | Testes e publicação no GitHub Pages |
| `tests/` | Verificações automatizadas |

## Plano gratuito

O plano Spark não exige forma de pagamento. Atualmente, o Realtime Database
oferece 1 GB armazenado, 10 GB de download por mês e 100 conexões simultâneas
no Spark. Consulte sempre a [página oficial de preços do
Firebase](https://firebase.google.com/pricing), pois as cotas podem mudar.

Documentos e selfies são guardados no Realtime Database para evitar uma
dependência do Cloud Storage. Use arquivos pequenos e acompanhe o consumo no
console do Firebase.

## Diferenças técnicas inevitáveis

A aparência e os fluxos foram mantidos, mas uma página pública do GitHub não
pode guardar com segurança chaves de serviço, senha de conta Google ou chave
privada de IA. Por isso:

- redefinição de senha usa o e-mail seguro do Firebase;
- exportações usam CSV e impressão/PDF do navegador;
- a simulação “com IA” usa revisão local por regras, sem expor chave de API;
- Google Drive e Google Calendar não são usados;
- o ranking da Arena funciona, mas a validação é feita no cliente, pois Cloud
  Functions exigiria backend e plano com faturamento.

Nenhuma credencial privada deve ser adicionada ao repositório.

## Migração dos dados antigos

Veja a seção **Migrar os dados do projeto original** em
[PASSO_A_PASSO.md](PASSO_A_PASSO.md). O conversor incluído entende o formato de
tabelas do Firebase usado no pacote original.
