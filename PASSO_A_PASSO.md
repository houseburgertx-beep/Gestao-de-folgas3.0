# Passo a passo completo

## 1. Instalar o necessário

Instale:

- [Node.js](https://nodejs.org/) 20 ou superior;
- [Git](https://git-scm.com/downloads);
- uma conta gratuita no [Firebase](https://console.firebase.google.com/);
- uma conta no [GitHub](https://github.com/).

Abra um terminal dentro da pasta do projeto e confirme:

```bash
node --version
npm --version
git --version
```

## 2. Criar o projeto Firebase gratuito

1. Entre no [console do Firebase](https://console.firebase.google.com/).
2. Clique em **Adicionar projeto**.
3. Informe um nome, por exemplo `gestao-folgas-house190`.
4. O Google Analytics é opcional.
5. Mantenha o plano **Spark**. Não é necessário cadastrar cartão.

## 3. Criar o aplicativo Web

1. Na visão geral do projeto, clique no ícone **Web `</>`**.
2. Dê o nome `Gestão de Folgas Web`.
3. Não é necessário marcar Firebase Hosting se você usar GitHub Pages.
4. Clique em **Registrar app**.
5. Copie o objeto `firebaseConfig`.
6. Abra `src/firebase-config.js`.
7. Substitua todos os valores de exemplo pelos valores copiados.

Exemplo:

```js
export const firebaseConfig = {
  apiKey: "valor-fornecido-pelo-firebase",
  authDomain: "seu-projeto.firebaseapp.com",
  databaseURL:
    "https://seu-projeto-default-rtdb.sua-regiao.firebasedatabase.app",
  projectId: "seu-projeto",
  storageBucket: "seu-projeto.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123",
};
```

Esse objeto identifica o aplicativo Web; ele não é uma senha. A segurança
efetiva está no login e em `database.rules.json`. Nunca coloque chave de conta
de serviço no projeto.

## 4. Ativar login por e-mail e senha

1. No Firebase, abra **Authentication**.
2. Clique em **Começar**.
3. Abra **Sign-in method / Método de login**.
4. Ative **E-mail/senha**.
5. Salve.

O sistema usa o próprio Firebase para login, permanência da sessão e envio de
e-mail de redefinição de senha.

## 5. Criar o Realtime Database

1. Abra **Realtime Database**.
2. Clique em **Criar banco de dados**.
3. Escolha a região mais próxima dos usuários.
4. Escolha **modo bloqueado**.
5. Conclua.
6. Confira a URL do banco e copie-a para a propriedade `databaseURL` em
   `src/firebase-config.js`.

O endereço normalmente termina em `firebaseio.com` ou
`firebasedatabase.app`.

## 6. Publicar as regras de segurança

### Opção A — pelo console

1. Abra **Realtime Database > Regras**.
2. Copie todo o conteúdo de `database.rules.json`.
3. Cole no editor de regras.
4. Clique em **Publicar**.

### Opção B — pelo terminal

1. Copie `.firebaserc.example` para `.firebaserc`.
2. Troque `SEU-PROJETO-FIREBASE` pelo ID do projeto.
3. Execute:

```bash
npx firebase-tools login
npx firebase-tools deploy --only database
```

As regras deixam o banco fechado por padrão e liberam somente as operações
compatíveis com o perfil autenticado:

- administrador: visão completa;
- responsável/chefe: dados da própria loja;
- funcionário: dados pessoais;
- rankings, feriados, comunicados e enquetes: leitura autenticada.

## 7. Rodar no computador

No terminal, dentro da pasta:

```bash
npm install
npm run dev
```

Abra o endereço mostrado, normalmente `http://localhost:5173`.

Se a configuração do Firebase ainda estiver incompleta, a própria página
mostrará quais campos faltam.

## 8. Criar o primeiro administrador

Na primeira abertura, será exibida a tela **Crie o administrador**.

1. Informe nome completo.
2. Informe o e-mail administrativo.
3. Crie uma senha com pelo menos 10 caracteres.
4. Informe o nome da empresa.
5. Clique em **Criar sistema**.

Essa tela funciona somente enquanto o banco ainda não estiver inicializado.
Depois do primeiro administrador, novos acessos devem ser criados em
**Controle de acesso**.

## 9. Cadastrar a primeira loja

1. Entre como administrador.
2. Abra **Lojas**.
3. Clique em **Nova loja**.
4. Preencha nome, código, horários e responsável.
5. Informe latitude, longitude e raio do ponto.
6. Salve.

Para capturar coordenadas pelo navegador, permita a localização. Em produção,
GitHub Pages usa HTTPS, requisito de câmera e geolocalização.

## 10. Cadastrar funcionários e jornadas

1. Abra **Funcionários**.
2. Cadastre os dados pessoais e a loja.
3. Preencha entrada, intervalo, retorno e saída.
4. Para meio período sem intervalo, defina a duração do intervalo como `0`.
5. Salve.
6. Abra **Controle de acesso**.
7. Vincule o funcionário e crie a senha inicial.

Cada usuário do portal também é criado no Firebase Authentication.

## 11. Validar antes de publicar

Execute:

```bash
npm run check
```

Esse comando:

1. verifica se todas as chamadas da interface possuem implementação;
2. valida a estrutura das regras;
3. confirma que não sobrou marcação do Apps Script;
4. compila a versão de produção.

A pasta gerada é `dist/`.

## 12. Criar o repositório no GitHub

No GitHub:

1. Clique em **New repository**.
2. Dê um nome, por exemplo `gestao-folgas-firebase`.
3. Para GitHub Free, use repositório público se quiser GitHub Pages sem plano
   pago.
4. Não adicione README, `.gitignore` ou licença, pois o projeto já possui os
   arquivos.

No terminal:

```bash
git init
git add .
git commit -m "Projeto Gestão de Folgas com Firebase"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/gestao-folgas-firebase.git
git push -u origin main
```

Não envie `node_modules/` nem arquivos de conta de serviço.

## 13. Publicar no GitHub Pages

1. Abra o repositório no GitHub.
2. Entre em **Settings > Pages**.
3. Em **Build and deployment > Source**, escolha **GitHub Actions**.
4. Abra a aba **Actions**.
5. Aguarde o fluxo **Publicar no GitHub Pages** ficar verde.
6. O endereço ficará parecido com:

```text
https://SEU-USUARIO.github.io/gestao-folgas-firebase/
```

O fluxo `.github/workflows/pages.yml` já está pronto. Cada `push` na branch
`main` testa, compila e publica o projeto.

## 14. Autorizar o domínio no Firebase

1. No Firebase, abra **Authentication > Settings**.
2. Localize **Authorized domains / Domínios autorizados**.
3. Adicione:

```text
SEU-USUARIO.github.io
```

Se usar domínio próprio, adicione-o também.

## 15. Migrar os dados do projeto original

### Se o projeto original já usa Firebase v1

1. Faça backup completo do Realtime Database antigo em JSON.
2. Coloque o arquivo, por exemplo `export-firebase.json`, na pasta do projeto.
3. Execute:

```bash
node scripts/convert-legacy-export.mjs export-firebase.json firebase-tables-v2.json
```

4. Primeiro conclua a criação do administrador na nova aplicação.
5. No Firebase, abra o nó:

```text
/gestao-folgas/v2/tables
```

6. Use **Importar JSON** nesse nó.
7. Selecione `firebase-tables-v2.json`.
8. Recrie os usuários em **Controle de acesso**.

O conversor mantém tabelas, IDs, datas, números, booleanos e objetos JSON.
Senhas antigas não são importadas, porque agora o acesso usa Firebase
Authentication.

### Se o projeto original ainda usa Google Sheets

1. No pacote antigo, conclua primeiro a função `migrarDadosParaFirebase`.
2. Exporte o ramo `gestao-folgas/v1` do Firebase.
3. Siga os passos do conversor acima.

### Documentos e selfies antigos

O banco antigo guarda apenas IDs do Google Drive. O conversor não possui acesso
aos arquivos privados; eles devem ser baixados pelo proprietário e enviados de
novo na biblioteca de documentos. Novas selfies ficam vinculadas ao registro
de ponto no Realtime Database.

## 16. Backup

Uma aplicação estática não pode guardar uma chave administrativa em segurança.
Faça backups pelo console:

1. Firebase > Realtime Database.
2. Menu de opções.
3. **Exportar JSON**.
4. Guarde o arquivo fora do repositório.

Faça isso pelo menos semanalmente ou antes de uma alteração importante.

## 17. Limites do gratuito

No plano Spark, acompanhe **Usage / Uso** no console. Atualmente, o Realtime
Database possui:

- 1 GB de dados;
- 10 GB de download por mês;
- 100 conexões simultâneas;
- uma instância por projeto.

Documentos de até 8 MB são aceitos, mas arquivos grandes consomem rapidamente
a franquia. Prefira PDF compactado e imagens reduzidas.

## 18. Solução de problemas

### “Preencha a configuração do Firebase”

Ainda existem valores como `COLE_AQUI`, `SEU-PROJETO` ou `REGIAO` em
`src/firebase-config.js`.

### “Firebase bloqueou esta operação”

Publique `database.rules.json` novamente e confirme se o usuário está ativo e
com o perfil correto.

### Login não funciona

Confirme se:

- E-mail/senha está ativo no Firebase Authentication;
- o acesso foi criado em **Controle de acesso**;
- o domínio do GitHub Pages está autorizado;
- e-mail e senha estão corretos.

### Câmera ou localização não abre

Use HTTPS, permita câmera e localização precisa e teste em navegador atualizado.
`localhost` também é aceito durante o desenvolvimento.

### GitHub Pages mostra página em branco

Abra a aba **Actions**, entre na última execução e veja a etapa com erro. Rode
localmente `npm run check` antes do próximo `push`.

### E-mail de redefinição não chega

Confira spam, o modelo de e-mail no Firebase Authentication e se o domínio
está autorizado.
