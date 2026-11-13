import test from "node:test";
import assert from "node:assert/strict";
import { runtime } from "../src/core/runtime.js";
import { createPortalHandlers } from "../src/core/api-portal.js";
import { ID_FIELDS } from "../src/core/constants.js";

function createInMemoryRuntimeMock() {
  const db = {};
  let activeProfile = {
    UsuarioID: "u-dir-1",
    FuncionarioID: "emp-dir-1",
    Nome: "Diretora Geral",
    Email: "diretoria@house190.com.br",
    Perfil: "Diretoria",
    LojaID: "",
    Ativo: true,
  };

  const getTable = (table) => {
    if (!db[table]) db[table] = new Map();
    return db[table];
  };

  const idFieldFor = (table) => ID_FIELDS[table] || "id";

  return {
    db,
    setProfile(profile) {
      activeProfile = { ...profile };
    },
    getProfile() {
      return activeProfile;
    },
    install() {
      const orig = {
        requireProfile: runtime.requireProfile,
        list: runtime.list,
        getById: runtime.getById,
        create: runtime.create,
        update: runtime.update,
        patch: runtime.patch,
        upsert: runtime.upsert,
      };

      runtime.requireProfile = async () => ({ ...activeProfile });
      runtime.list = async (table) =>
        Array.from(getTable(table).values()).map((r) => JSON.parse(JSON.stringify(r)));
      runtime.getById = async (table, id) => {
        const item = getTable(table).get(String(id));
        return item ? JSON.parse(JSON.stringify(item)) : null;
      };
      runtime.create = async (table, record) => {
        const keyField = idFieldFor(table);
        const key = String(record[keyField] || record.id || `${Date.now()}-${Math.random()}`);
        const copy = JSON.parse(JSON.stringify({ ...record, [keyField]: key }));
        getTable(table).set(key, copy);
        return copy;
      };
      runtime.update = async (table, id, record) => {
        const keyField = idFieldFor(table);
        const existing = getTable(table).get(String(id)) || {};
        const merged = JSON.parse(JSON.stringify({ ...existing, ...record, [keyField]: String(id) }));
        getTable(table).set(String(id), merged);
        return merged;
      };
      runtime.patch = runtime.update;
      runtime.upsert = async (table, record) => {
        const keyField = idFieldFor(table);
        const key = String(record[keyField] || record.id);
        return runtime.update(table, key, record);
      };

      return () => {
        Object.assign(runtime, orig);
      };
    },
  };
}

test("Portal do Colaborador e Gestão Interna - Fluxo Completo (Telas 1 a 8, RBAC 3 Níveis e Auditoria Imutável)", async (t) => {
  const mock = createInMemoryRuntimeMock();
  const restore = mock.install();
  t.after(() => restore());

  const portal = createPortalHandlers();

  // Seed lojas e colaboradores (Loja 1 e Loja 2)
  await runtime.create("Lojas", { LojaID: "loja-1", NomeLoja: "House 190 Matriz", Ativa: true });
  await runtime.create("Lojas", { LojaID: "loja-2", NomeLoja: "FoodPark Tx", Ativa: true });

  await runtime.create("Funcionarios", {
    FuncionarioID: "emp-dir-1",
    Nome: "Diretora Geral",
    Email: "diretoria@house190.com.br",
    CPF: "111.111.111-11",
    Perfil: "Diretoria",
    LojaID: "",
    Ativo: true,
  });

  await runtime.create("Funcionarios", {
    FuncionarioID: "emp-ger-1",
    Nome: "Gerente Matriz",
    Email: "gerente1@house190.com.br",
    CPF: "222.222.222-22",
    Perfil: "Responsável de loja",
    LojaID: "loja-1",
    NomeLoja: "House 190 Matriz",
    Ativo: true,
  });

  await runtime.create("Funcionarios", {
    FuncionarioID: "emp-colab-1",
    Nome: "João Silva",
    Email: "joao@house190.com.br",
    CPF: "123.456.789-01",
    Telefone: "73999112233",
    WhatsApp: "73999112233",
    Perfil: "Funcionário",
    Cargo: "Chapeiro",
    Setor: "Cozinha",
    LojaID: "loja-1",
    NomeLoja: "House 190 Matriz",
    DataAdmissao: "2026-10-04", // 41 dias antes de 2026-11-13 -> faltam 4 dias para 45 dias!
    PeriodoExperienciaDias: 90,
    SalarioBase: 1600,
    ChavePix: "12345678901",
    EtapaAdmissao: 1,
    CadastroValidado: false,
    Ativo: true,
  });

  // ==========================================================================
  // TELA 1: Recuperação de senha via WhatsApp por CPF
  // ==========================================================================
  await t.test("Tela 1: Solicita recuperação de senha via WhatsApp usando CPF", async () => {
    const res = await portal.solicitarRecuperacaoSenhaWhatsApp({
      identifier: "123.456.789-01",
    });
    assert.equal(res.success, true);
    assert.equal(res.data.email, "joao@house190.com.br");
    assert.match(res.data.whatsappUrl, /wa\.me\/5573999112233/);
  });

  // ==========================================================================
  // TELA 2: Onboarding (6 Etapas), Trava Pós-Validação, Dossiê, Kit PDF e Alertas 45/90d
  // ==========================================================================
  await t.test("Tela 2: Colaborador preenche pré-cadastro, envia documentos e fica bloqueado após validação do Gerente", async () => {
    mock.setProfile({
      UsuarioID: "u-colab-1",
      FuncionarioID: "emp-colab-1",
      Nome: "João Silva",
      Email: "joao@house190.com.br",
      Perfil: "Funcionário",
      LojaID: "loja-1",
    });

    const preRes = await portal.salvarPreCadastroColaborador({
      FuncionarioID: "emp-colab-1",
      NomeSocial: "João da Chapa",
      RG: "12.345.678-9",
      CEP: "45990-000",
      Endereco: "Av. Getúlio Vargas",
      NumeroEndereco: "190",
      Bairro: "Centro",
      Cidade: "Teixeira de Freitas",
      UF: "BA",
      ContatoEmergenciaNome: "Maria Silva",
      ContatoEmergenciaParentesco: "Mãe",
      ContatoEmergenciaTelefone: "73988776655",
      ChavePix: "joao.pix@house190.com.br",
    });
    assert.equal(preRes.success, true);
    assert.equal(preRes.data.Cidade, "Teixeira de Freitas");

    // Envia documento RG_CNH e ASO
    const docRes = await portal.enviarDocumentoAdmissional({
      FuncionarioID: "emp-colab-1",
      codigoDocumento: "ASO",
      arquivoUrl: "data:application/pdf;base64,JVBERi0xLjQK",
      nomeArquivo: "aso-joao.pdf",
    });
    assert.equal(docRes.success, true);
    assert.equal(docRes.data.colaborador.EtapaAdmissao, 3);
    assert.ok(docRes.data.colaborador.DossieDocumentos.ASO);

    // Gerente valida o cadastro e avança etapa
    mock.setProfile({
      UsuarioID: "u-ger-1",
      FuncionarioID: "emp-ger-1",
      Nome: "Gerente Matriz",
      Email: "gerente1@house190.com.br",
      Perfil: "Responsável de loja",
      LojaID: "loja-1",
    });

    const etapaRes = await portal.avancarEtapaOnboarding({
      FuncionarioID: "emp-colab-1",
      etapa: 3,
      validarCadastro: true,
      observacao: "Documentos e ASO conferidos pelo gerente",
    });
    assert.equal(etapaRes.data.CadastroValidado, true);

    // Colaborador tenta editar novamente após validação -> DEVE SER BLOQUEADO
    mock.setProfile({
      UsuarioID: "u-colab-1",
      FuncionarioID: "emp-colab-1",
      Nome: "João Silva",
      Email: "joao@house190.com.br",
      Perfil: "Funcionário",
      LojaID: "loja-1",
    });

    await assert.rejects(
      () =>
        portal.salvarPreCadastroColaborador({
          FuncionarioID: "emp-colab-1",
          Endereco: "Tentativa de alteração após validação",
        }),
      /validado pela gestão e não pode mais ser editado/i,
    );
  });

  await t.test("Tela 2: Gerente gera Kit Admissional PDF, Colaborador assina com SHA-256 e sistema alerta vencimento de 45/90 dias", async () => {
    mock.setProfile({
      UsuarioID: "u-ger-1",
      FuncionarioID: "emp-ger-1",
      Nome: "Gerente Matriz",
      Email: "gerente1@house190.com.br",
      Perfil: "Responsável de loja",
      LojaID: "loja-1",
    });

    const kitRes = await portal.gerarKitAdmissionalPdf({
      FuncionarioID: "emp-colab-1",
    });
    assert.equal(kitRes.success, true);
    assert.equal(kitRes.data.length, 3);

    const contratoDoc = kitRes.data.find((d) => d.Tipo === "Contrato de Trabalho");
    assert.ok(contratoDoc);

    // Colaborador assina eletronicamente o Contrato de Trabalho
    mock.setProfile({
      UsuarioID: "u-colab-1",
      FuncionarioID: "emp-colab-1",
      Nome: "João Silva",
      Email: "joao@house190.com.br",
      Perfil: "Funcionário",
      LojaID: "loja-1",
    });

    const signRes = await portal.assinarDocumentoEletronico({
      DocID: contratoDoc.DocID,
      metodo: "TELA",
      assinaturaBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      ip: "187.44.12.90",
      device: "iPhone iOS 18 PWA",
    });
    assert.equal(signRes.success, true);
    assert.equal(signRes.data.documento.StatusAssinatura, "Assinado");
    assert.equal(signRes.data.assinatura.HashSHA256.length, 64);

    // Verifica avanço automático para Etapa 5 (Período de Experiência)
    const empAfterSign = await runtime.getById("Funcionarios", "emp-colab-1");
    assert.equal(empAfterSign.EtapaAdmissao, 5);

    // Alerta automático 5 dias antes de 45 dias (Admissão 2026-10-04 -> 45º dia = 2026-11-17 -> em 2026-11-13 faltam 4 dias)
    const alertRes = await portal.listarAlertasExperiencia({
      referenceDate: "2026-11-13",
    });
    assert.equal(alertRes.data.length, 1);
    assert.equal(alertRes.data[0].CicloExperienciaDias, 45);
    assert.equal(alertRes.data[0].DiasRestantes, 4);
  });

  // ==========================================================================
  // TELA 3: Envio e Validação de Atestado Médico
  // ==========================================================================
  await t.test("Tela 3: Colaborador envia Atestado Médico (notifica Gerente e Diretoria) e Gerente valida", async () => {
    mock.setProfile({
      UsuarioID: "u-colab-1",
      FuncionarioID: "emp-colab-1",
      Nome: "João Silva",
      Email: "joao@house190.com.br",
      Perfil: "Funcionário",
      LojaID: "loja-1",
    });

    const atestadoRes = await portal.enviarAtestadoMedico({
      DataInicio: "2026-11-05",
      DiasAfastamento: 2,
      fotoAtestadoUrl: "https://storage.house190.com.br/atestados/atestado-joao.jpg",
    });
    assert.equal(atestadoRes.success, true);
    assert.equal(atestadoRes.data.notificados, 2); // Gerente da loja-1 + Diretora

    mock.setProfile({
      UsuarioID: "u-ger-1",
      FuncionarioID: "emp-ger-1",
      Nome: "Gerente Matriz",
      Email: "gerente1@house190.com.br",
      Perfil: "Responsável de loja",
      LojaID: "loja-1",
    });

    const valRes = await portal.validarAtestadoMedico({
      JustificativaPontoID: atestadoRes.data.atestado.JustificativaPontoID,
      aprovar: true,
    });
    assert.equal(valRes.data.Status, "Aprovada");
  });

  // ==========================================================================
  // TELA 4: Solicitação de Vale / Adiantamento (Fluxo de 3 Etapas + Trava de Limite)
  // ==========================================================================
  await t.test("Tela 4: Fluxo de Vale (Trava de limite -> Solicitado -> Validado pelo Gerente -> Pago pela Diretoria com Recibo)", async () => {
    // Diretoria configura limite máximo de R$ 400,00
    mock.setProfile({
      UsuarioID: "u-dir-1",
      FuncionarioID: "emp-dir-1",
      Nome: "Diretora Geral",
      Email: "diretoria@house190.com.br",
      Perfil: "Diretoria",
      LojaID: "",
    });
    await portal.configurarLimiteVale({ valorLimite: 400 });

    // Colaborador tenta pedir R$ 500,00 (acima do limite) -> bloqueado
    mock.setProfile({
      UsuarioID: "u-colab-1",
      FuncionarioID: "emp-colab-1",
      Nome: "João Silva",
      Email: "joao@house190.com.br",
      Perfil: "Funcionário",
      LojaID: "loja-1",
    });
    await assert.rejects(
      () => portal.solicitarVale({ valor: 500, motivo: "Adiantamento quinzenal", dataDesejada: "2026-11-10" }),
      /ultrapassa o limite máximo permitido pela Diretoria/i,
    );

    // Colaborador solicita R$ 250,00 (dentro do limite)
    const solRes = await portal.solicitarVale({
      valor: 250,
      motivo: "Despesa médica familiar",
      dataDesejada: "2026-11-10",
    });
    assert.equal(solRes.data.Status, "Solicitado");
    const valeId = solRes.data.ValeID;

    // Gerente valida (1ª aprovação)
    mock.setProfile({
      UsuarioID: "u-ger-1",
      FuncionarioID: "emp-ger-1",
      Nome: "Gerente Matriz",
      Email: "gerente1@house190.com.br",
      Perfil: "Responsável de loja",
      LojaID: "loja-1",
    });
    const gerVal = await portal.validarValeGerente({ ValeID: valeId, aprovar: true });
    assert.equal(gerVal.data.Status, "Validado pelo Gerente");

    // Gerente tenta aprovar/pagar etapa da Diretoria -> bloqueado!
    await assert.rejects(
      () => portal.aprovarPagarValeDiretoria({ ValeID: valeId, comprovanteUrl: "pix.pdf" }),
      /administrador/i,
    );

    // Diretoria aprova e paga anexando comprovante -> gera Recibo Digital na Tela 7
    mock.setProfile({
      UsuarioID: "u-dir-1",
      FuncionarioID: "emp-dir-1",
      Nome: "Diretora Geral",
      Email: "diretoria@house190.com.br",
      Perfil: "Diretoria",
      LojaID: "",
    });
    const dirPay = await portal.aprovarPagarValeDiretoria({
      ValeID: valeId,
      aprovar: true,
      comprovanteUrl: "https://storage.house190.com.br/comprovantes/pix-vale-250.pdf",
    });
    assert.equal(dirPay.data.Status, "Pago");
    assert.ok(dirPay.data.ReciboDocID);
  });

  // ==========================================================================
  // TELA 5: Valor de Ficha / Produtividade (House Tx vs FoodPark Tx)
  // ==========================================================================
  await t.test("Tela 5: Diretoria configura valores independentes House Tx e FoodPark Tx, Gerente lança fichas e Colaborador consulta extrato", async () => {
    mock.setProfile({
      UsuarioID: "u-dir-1",
      FuncionarioID: "emp-dir-1",
      Nome: "Diretora Geral",
      Email: "diretoria@house190.com.br",
      Perfil: "Diretoria",
      LojaID: "",
    });

    await portal.salvarConfiguracaoFicha({
      Operacao: "House Tx",
      Funcao: "Chapeiro",
      Turno: "Geral",
      ValorUnitario: 15,
    });
    // Atualiza House Tx de R$ 15,00 para R$ 18,00 (para verificar o log exato na Auditoria!)
    await portal.salvarConfiguracaoFicha({
      Operacao: "House Tx",
      Funcao: "Chapeiro",
      Turno: "Geral",
      ValorUnitario: 18,
    });
    // Configura FoodPark Tx em R$ 22,00
    await portal.salvarConfiguracaoFicha({
      Operacao: "FoodPark Tx",
      Funcao: "Chapeiro",
      Turno: "Geral",
      ValorUnitario: 22,
    });

    // Gerente lança 3 fichas House Tx (3 x 18 = R$ 54,00) e 2 fichas FoodPark Tx (2 x 22 = R$ 44,00)
    mock.setProfile({
      UsuarioID: "u-ger-1",
      FuncionarioID: "emp-ger-1",
      Nome: "Gerente Matriz",
      Email: "gerente1@house190.com.br",
      Perfil: "Responsável de loja",
      LojaID: "loja-1",
    });

    await portal.lancarFichaDiaria({
      FuncionarioID: "emp-colab-1",
      Operacao: "House Tx",
      Data: "2026-11-08",
      Quantidade: 3,
      Funcao: "Chapeiro",
    });
    await portal.lancarFichaDiaria({
      FuncionarioID: "emp-colab-1",
      Operacao: "FoodPark Tx",
      Data: "2026-11-09",
      Quantidade: 2,
      Funcao: "Chapeiro",
    });

    // Colaborador consulta seu próprio extrato transparente
    mock.setProfile({
      UsuarioID: "u-colab-1",
      FuncionarioID: "emp-colab-1",
      Nome: "João Silva",
      Email: "joao@house190.com.br",
      Perfil: "Funcionário",
      LojaID: "loja-1",
    });

    const extrato = await portal.consultarExtratoFichas({ competencia: "2026-11" });
    assert.equal(extrato.data.resumo.qtdHouseTx, 3);
    assert.equal(extrato.data.resumo.valorHouseTx, 54);
    assert.equal(extrato.data.resumo.qtdFoodParkTx, 2);
    assert.equal(extrato.data.resumo.valorFoodParkTx, 44);
    assert.equal(extrato.data.resumo.saldoTotalReceber, 98);
  });

  // ==========================================================================
  // TELA 6: POPs / Manuais de Treinamento com Confirmação de Leitura
  // ==========================================================================
  await t.test("Tela 6: Gerente publica POP por setor e Colaborador confirma leitura", async () => {
    mock.setProfile({
      UsuarioID: "u-ger-1",
      FuncionarioID: "emp-ger-1",
      Nome: "Gerente Matriz",
      Email: "gerente1@house190.com.br",
      Perfil: "Responsável de loja",
      LojaID: "loja-1",
    });

    const popRes = await portal.salvarPopTreinamento({
      Titulo: "POP 01 - Padrão de Cocção Smash Burger",
      Setor: "Cozinha",
      TipoMidia: "VIDEO",
      ArquivoURL: "https://storage.house190.com.br/pops/pop01.mp4",
    });
    assert.equal(popRes.success, true);

    mock.setProfile({
      UsuarioID: "u-colab-1",
      FuncionarioID: "emp-colab-1",
      Nome: "João Silva",
      Email: "joao@house190.com.br",
      Perfil: "Funcionário",
      LojaID: "loja-1",
    });

    const confirmRes = await portal.confirmarLeituraPop({ PopID: popRes.data.PopID });
    assert.equal(confirmRes.success, true);

    const listRes = await portal.listarPopsTreinamentos({ setor: "Cozinha" });
    assert.equal(listRes.data[0].ConcluidoPorMim, true);
    assert.equal(listRes.data[0].TotalConfirmacoes, 1);
  });

  // ==========================================================================
  // TELA 8 & TELA 7: Fechamento de Folha Salarial + Edição Justificada + Envio de Espelho
  // ==========================================================================
  await t.test("Tela 8 e Tela 7: Consolida folha, exige justificativa na edição manual da Diretoria, congela no fechamento e envia espelho detalhado para Tela 7", async () => {
    // Gerente visualiza prévia da sua loja em modo somente leitura
    mock.setProfile({
      UsuarioID: "u-ger-1",
      FuncionarioID: "emp-ger-1",
      Nome: "Gerente Matriz",
      Email: "gerente1@house190.com.br",
      Perfil: "Responsável de loja",
      LojaID: "loja-1",
    });

    const takeatSampleItems = [
      { id: "tk-house-1", storeKey: "teixeira", name: "João Silva", phone: "73999112233", debt: 100 },
      { id: "tk-food-1", storeKey: "foodpark", name: "João Silva", phone: "73999112233", debt: 50 },
    ];
    const takeatSampleMappings = {
      "teixeira:tk-house-1": "emp-colab-1",
      "foodpark:tk-food-1": "emp-colab-1",
    };

    const previaGerente = await portal.gerarPreviaFolhaSalarial({
      competencia: "2026-11",
      takeatItems: takeatSampleItems,
      takeatMappings: takeatSampleMappings,
    });
    assert.equal(previaGerente.data.somenteLeituraGerente, true);
    assert.equal(previaGerente.data.permissaoEdicao, false);

    const linhaJoao = previaGerente.data.linhas.find((l) => l.FuncionarioID === "emp-colab-1");
    assert.ok(linhaJoao);
    // Salário (1600) - House Tx -20% (80) - FoodPark -20% (40) - Vale Pago (250) = 1230
    assert.equal(linhaJoao.SalarioBase, 1600);
    assert.equal(linhaJoao.ValorFichasHouseTx, 80);
    assert.equal(linhaJoao.ValorFichasFoodParkTx, 40);
    assert.equal(linhaJoao.TotalValesAdiantamentos, 250);
    assert.equal(linhaJoao.ValorLiquido, 1230);

    // Gerente tenta editar manualmente -> bloqueado
    await assert.rejects(
      () =>
        portal.editarLinhaFolhaManual({
          competencia: "2026-11",
          FuncionarioID: "emp-colab-1",
          QuebraDeCaixaValor: 30,
          justificativa: "Tentativa gerente",
          takeatItems: takeatSampleItems,
          takeatMappings: takeatSampleMappings,
        }),
      /administrador/i,
    );

    // Diretoria tenta editar sem justificativa -> bloqueado
    mock.setProfile({
      UsuarioID: "u-dir-1",
      FuncionarioID: "emp-dir-1",
      Nome: "Diretora Geral",
      Email: "diretoria@house190.com.br",
      Perfil: "Diretoria",
      LojaID: "",
    });

    await assert.rejects(
      () =>
        portal.editarLinhaFolhaManual({
          competencia: "2026-11",
          FuncionarioID: "emp-colab-1",
          QuebraDeCaixaValor: 48,
          justificativa: "",
          takeatItems: takeatSampleItems,
          takeatMappings: takeatSampleMappings,
        }),
      /justificativa obrigatória/i,
    );

    // Diretoria lança 10% Taxa de Serviço (R$ 200) e Quebra de Caixa (R$ 48): 1600 + 200 - 80 - 40 - 250 - 48 = 1382
    const editRes = await portal.editarLinhaFolhaManual({
      competencia: "2026-11",
      FuncionarioID: "emp-colab-1",
      TaxaServicoValor: 200,
      QuebraDeCaixaValor: 48,
      justificativa: "Diferença apurada no fechamento de caixa do dia 10/11",
      takeatItems: takeatSampleItems,
      takeatMappings: takeatSampleMappings,
    });
    assert.equal(editRes.data.TaxaServicoValor, 200);
    assert.equal(editRes.data.ValorLiquido, 1382);
    assert.equal(editRes.data.ValoresOriginaisSistema.QuebraDeCaixaValor, 0);

    // Diretoria fecha a Folha do Mês -> congela valores e envia espelho detalhado para Tela 7
    const closeRes = await portal.fecharFolhaSalarialMes({
      competencia: "2026-11",
      storeId: "loja-1",
      takeatItems: takeatSampleItems,
      takeatMappings: takeatSampleMappings,
    });
    assert.equal(closeRes.success, true);
    assert.ok(closeRes.data.espelhosEnviados >= 1);

    // Tenta editar após fechamento -> bloqueado pela trava de fechamento!
    await assert.rejects(
      () =>
        portal.editarLinhaFolhaManual({
          competencia: "2026-11",
          LojaID: "loja-1",
          FuncionarioID: "emp-colab-1",
          TaxaServicoValor: 100,
          justificativa: "Tentativa pós fechamento",
        }),
      /já foi fechada e congelada/i,
    );

    // Verifica exportação Excel/CSV e PDF
    const expRes = await portal.exportarFolhaSalarial({
      competencia: "2026-11",
      storeId: "loja-1",
      formato: "xlsx",
      takeatItems: takeatSampleItems,
      takeatMappings: takeatSampleMappings,
    });
    assert.equal(expRes.success, true);
    assert.match(expRes.data.dataUrl, /^data:text\/csv;charset=utf-8,/);

    // Verifica na Tela 7 que o Espelho de Folha foi entregue ao colaborador e registra visualização/download
    const espelhoDoc = await runtime.getById("Documentos", "espelho-folha-2026-11-emp-colab-1");
    assert.ok(espelhoDoc);
    assert.match(espelhoDoc.ConteudoTexto, /\(\+\) 10% Taxa de Servico: R\$ 200,00/);
    assert.match(espelhoDoc.ConteudoTexto, /\(-\) Fichas Takeat House TX \(Bruto R\$ 100,00 com -20%\): R\$ 80,00/);
    assert.match(espelhoDoc.ConteudoTexto, /\(-\) Fichas Takeat FoodPark \(Bruto R\$ 50,00 com -20%\): R\$ 40,00/);
    assert.match(espelhoDoc.ConteudoTexto, /VALOR LIQUIDO A RECEBER: R\$ 1382,00/);

    mock.setProfile({
      UsuarioID: "u-colab-1",
      FuncionarioID: "emp-colab-1",
      Nome: "João Silva",
      Email: "joao@house190.com.br",
      Perfil: "Funcionário",
      LojaID: "loja-1",
    });

    const dlRes = await portal.registrarEventoDocumento({
      DocID: espelhoDoc.DocID,
      evento: "DOWNLOAD",
    });
    assert.ok(dlRes.data.VisualizadoEm);
    assert.ok(dlRes.data.BaixadoEm);
    assert.equal(dlRes.data.TotalDownloads, 1);
  });

  // ==========================================================================
  // TELA 8 (PAGAMENTO): Comprovante, WhatsApp, Holerite, Histórico & Reset Mensal
  // ==========================================================================
  await t.test("Tela 8 (Pagamento): Financeiro ajusta via campos, paga com comprovante, envia ao colaborador/WhatsApp, grava histórico e zera para próximo mês", async () => {
    mock.setProfile({
      UsuarioID: "u-fin-1",
      FuncionarioID: "emp-fin-1",
      Nome: "Analista Financeiro",
      Email: "financeiro@house190.com.br",
      Perfil: "Financeiro",
      LojaID: "",
    });

    // Vale pago em 2026-12 (R$ 150) + Takeat House TX R$ 100 bruto (-20% = 80)
    await runtime.create("SolicitacoesVale", {
      ValeID: "vale-dez-1",
      FuncionarioID: "emp-colab-1",
      FuncionarioNome: "João Silva",
      LojaID: "loja-1",
      Valor: 150,
      DataDesejada: "2026-12-05",
      Competencia: "2026-12",
      Status: "Pago",
    });

    const takeatDez = [
      { id: "tk-house-1", storeKey: "teixeira", name: "João Silva", phone: "73999112233", debt: 100 },
    ];
    const mappingsDez = { "teixeira:tk-house-1": "emp-colab-1" };

    // Financeiro preenche 10% Taxa de Serviço (300), Faltas (2 faltas = 100) e Quebra de Caixa (20)
    const editFin = await portal.editarLinhaFolhaManual({
      competencia: "2026-12",
      FuncionarioID: "emp-colab-1",
      TaxaServicoValor: 300,
      FaltasInjustificadas: 2,
      DescontoFaltasAtrasos: 100,
      QuebraDeCaixaValor: 20,
      justificativa: "Lançamento financeiro de dezembro",
      takeatItems: takeatDez,
      takeatMappings: mappingsDez,
    });
    // 1600 + 300 - 80 (Takeat -20%) - 150 (Vale) - 100 (Faltas) - 20 (Quebra) = 1550
    assert.equal(editFin.data.ValorLiquido, 1550);

    // Pagar sem comprovante deve exigir anexo
    await assert.rejects(
      () =>
        portal.pagarFolhaColaborador({
          competencia: "2026-12",
          FuncionarioID: "emp-colab-1",
          comprovanteUrl: "",
          takeatItems: takeatDez,
          takeatMappings: mappingsDez,
        }),
      /comprovante de pagamento/i,
    );

    // Pagar com comprovante anexado
    const payRes = await portal.pagarFolhaColaborador({
      competencia: "2026-12",
      FuncionarioID: "emp-colab-1",
      comprovanteUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      comprovanteNome: "pix-joao-dezembro.png",
      observacao: "Transferência PIX efetuada",
      takeatItems: takeatDez,
      takeatMappings: mappingsDez,
    });
    assert.equal(payRes.success, true);
    assert.equal(payRes.data.pagamento.ValorLiquido, 1550);
    assert.equal(payRes.data.pagamento.TaxaServicoValor, 300);
    assert.equal(payRes.data.pagamento.ValorFichasHouseTx, 80);
    assert.equal(payRes.data.pagamento.TotalValesAdiantamentos, 150);
    assert.equal(payRes.data.pagamento.DescontoFaltasAtrasos, 100);
    assert.equal(payRes.data.pagamento.QuebraDeCaixaValor, 20);
    assert.match(payRes.data.whatsapp.waUrl, /^https:\/\/wa\.me\/5573999112233\?text=/);

    // Verifica documento criado para o colaborador (Holerites & Docs)
    const docPag = await runtime.getById("Documentos", payRes.data.pagamento.DocumentoID);
    assert.ok(docPag);
    assert.equal(docPag.SubtipoCodigo, "COMPROVANTE_PAGAMENTO_FOLHA");
    assert.equal(docPag.ArquivoUrl, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB");
    assert.match(docPag.ConteudoTexto, /VALOR LIQUIDO A RECEBER: R\$ 1550,00/);

    // Verifica vale marcado como deduzido neste pagamento
    const valePos = await runtime.getById("SolicitacoesVale", "vale-dez-1");
    assert.equal(valePos.DeduzidoFolhaPagamentoID, payRes.data.pagamento.PagamentoID);

    // Verifica que a linha atual foi zerada (StatusLinha: "Pago") para não acumular e liberar próximo preenchimento
    const posPagPrevia = await portal.gerarPreviaFolhaSalarial({
      competencia: "2026-12",
      takeatItems: [],
      takeatMappings: {},
    });
    const linhaPosPag = posPagPrevia.data.linhas.find((l) => l.FuncionarioID === "emp-colab-1");
    assert.equal(linhaPosPag.StatusLinha, "Pago");
    assert.equal(linhaPosPag.TaxaServicoValor, 0);
    assert.equal(linhaPosPag.DescontoFaltasAtrasos, 0);
    assert.equal(linhaPosPag.QuebraDeCaixaValor, 0);
    assert.equal(linhaPosPag.TotalValesAdiantamentos, 0);
    assert.equal(linhaPosPag.ValorLiquido, 1600);

    // Histórico lista o pagamento gravado
    const histRes = await portal.listarPagamentosFolha({ competencia: "2026-12" });
    assert.equal(histRes.success, true);
    assert.equal(histRes.data.length, 1);
    assert.equal(histRes.data[0].PagamentoID, payRes.data.pagamento.PagamentoID);

    // Zerar / reabrir linha manualmente no mesmo ciclo + validar próximo mês (2027-01) limpo
    const resetRes = await portal.zerarLinhaFolha({
      competencia: "2026-12",
      FuncionarioID: "emp-colab-1",
    });
    assert.equal(resetRes.data.StatusLinha, "Em Aberto");

    const janPrevia = await portal.gerarPreviaFolhaSalarial({
      competencia: "2027-01",
      takeatItems: [],
      takeatMappings: {},
    });
    const linhaJan = janPrevia.data.linhas.find((l) => l.FuncionarioID === "emp-colab-1");
    assert.equal(linhaJan.StatusLinha, "Em Aberto");
    assert.equal(linhaJan.TaxaServicoValor, 0);
    assert.equal(linhaJan.QuebraDeCaixaValor, 0);
    assert.equal(linhaJan.ValorLiquido, 1600);
  });

  // ==========================================================================
  // ARQUITETURA DE AUDITORIA: Exclusiva Diretoria e Registro Completo de Diffs
  // ==========================================================================
  await t.test("Auditoria (audit_logs): Bloqueada para Colaborador e Gerente, disponível para Diretoria com Quem, Quando, Onde, O Quê e Origem", async () => {
    mock.setProfile({
      UsuarioID: "u-ger-1",
      FuncionarioID: "emp-ger-1",
      Nome: "Gerente Matriz",
      Email: "gerente1@house190.com.br",
      Perfil: "Responsável de loja",
      LojaID: "loja-1",
    });

    await assert.rejects(() => portal.listarHistoricoAlteracoes({}), /administrador/i);

    mock.setProfile({
      UsuarioID: "u-dir-1",
      FuncionarioID: "emp-dir-1",
      Nome: "Diretora Geral",
      Email: "diretoria@house190.com.br",
      Perfil: "Diretoria",
      LojaID: "",
    });

    const allLogs = await portal.listarHistoricoAlteracoes({});
    assert.equal(allLogs.success, true);
    assert.ok(allLogs.data.total >= 10);

    // Verifica log de alteração de Valor de Ficha de R$ 15,00 para R$ 18,00
    const logFicha = allLogs.data.logs.find(
      (l) => l.Acao === "VALOR_FICHA_CONFIGURADO" && l.ValorAnterior === "R$ 15,00" && l.ValorNovo === "R$ 18,00",
    );
    assert.ok(logFicha, "Deve registrar alteração do Valor da Ficha de R$ 15,00 para R$ 18,00");
    assert.match(logFicha.ResumoAlteracao, /Valor da Ficha \(House Tx - Chapeiro\) alterado de R\$ 15,00 para R\$ 18,00/);

    // Verifica histórico filtrado por colaborador (botão 'Histórico de Alterações' na ficha)
    const empLogs = await portal.getEmployeeAuditHistory("emp-colab-1");
    assert.ok(empLogs.data.logs.length >= 5);
    assert.ok(empLogs.data.logs.some((l) => l.Acao === "FOLHA_EDICAO_MANUAL" && l.Justificativa.includes("Diferença apurada")));
  });
});
