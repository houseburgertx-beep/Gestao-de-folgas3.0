import { deleteApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  updatePassword,
} from "firebase/auth";
import {
  equalTo,
  get,
  getDatabase,
  onValue,
  orderByChild,
  query,
  ref,
  remove,
  runTransaction,
  set,
  update,
} from "firebase/database";
import { APP_ROOT, firebaseConfig } from "../firebase-config.js";
import {
  APP,
  DEFAULT_CONFIG,
  EMPLOYEE_SCOPED_FIELDS,
  ID_FIELDS,
  PUBLIC_AUTH_TABLES,
  STORE_SCOPED_FIELDS,
} from "./constants.js";
import {
  asBoolean,
  cleanObject,
  clone,
  normalizeEmail,
  nowIso,
  uuid,
} from "./utils.js";

const roleName = (profile) =>
  String(profile?.Perfil || profile?.perfil || "").toLowerCase();

const isAdminProfile = (profile) => roleName(profile).includes("admin");
const isManagerProfile = (profile) =>
  roleName(profile).includes("respons") ||
  roleName(profile).includes("gerente") ||
  roleName(profile).includes("chefe de cozinha");
const isEmployeeProfile = (profile) =>
  roleName(profile).includes("funcion");

const PERIOD_INDEXED_TABLES = new Set(["RegistrosPonto", "AjustesPonto"]);
const PERIOD_INDEX_MIGRATION = "timeClockPeriodIndexesV1";

const pathKey = (value) =>
  encodeURIComponent(String(value || uuid())).replaceAll(".", "%2E");

const snapshotList = (snapshot) => {
  const value = snapshot.val() || {};
  return Object.values(value)
    .filter((item) => item && typeof item === "object")
    .map(clone);
};

const validPeriod = (value) =>
  /^\d{4}-\d{2}$/.test(String(value || "")) ? String(value) : "";

const isPermissionDenied = (error) =>
  /permission[-_\s]?denied/i.test(
    String(error?.code || error?.message || error || ""),
  );

export const periodFieldsFor = (table, record = {}) => {
  if (!PERIOD_INDEXED_TABLES.has(table)) return {};
  const period = validPeriod(
    String(record.Data || record.DataHora || "").slice(0, 7),
  );
  if (!period) return {};
  return { PeriodoChave: period };
};

export function firebaseConfigurationProblems(config = firebaseConfig) {
  const problems = [];
  const required = [
    "apiKey",
    "authDomain",
    "databaseURL",
    "projectId",
    "appId",
  ];
  required.forEach((key) => {
    const value = String(config[key] || "");
    if (
      !value ||
      value.includes("COLE_AQUI") ||
      value.includes("SEU-PROJETO") ||
      value.includes("REGIAO")
    ) {
      problems.push(key);
    }
  });
  return problems;
}

export class FirebaseRuntime {
  constructor(config = firebaseConfig, root = APP_ROOT) {
    this.config = config;
    this.root = String(root || "gestao-folgas/v2").replace(/^\/+|\/+$/g, "");
    this.app = null;
    this.auth = null;
    this.db = null;
    this.profile = null;
    this.authResolved = false;
    this.readyPromise = Promise.resolve(null);
    this.periodIndexMigrationPromise = null;
  }

  initialize() {
    const problems = firebaseConfigurationProblems(this.config);
    if (problems.length) {
      throw new Error(
        `Preencha a configuração do Firebase: ${problems.join(", ")}.`,
      );
    }
    this.app = getApps().length ? getApp() : initializeApp(this.config);
    this.auth = getAuth(this.app);
    this.db = getDatabase(this.app);
    this.readyPromise = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth, async (user) => {
        this.authResolved = true;
        this.profile = user ? await this.loadOwnProfile().catch(() => null) : null;
        unsubscribe();
        resolve(user);
      });
    });
    return this;
  }

  async ready() {
    await this.readyPromise;
    return this;
  }

  appRef(relativePath = "") {
    const suffix = String(relativePath || "").replace(/^\/+/, "");
    return ref(this.db, `${this.root}${suffix ? `/${suffix}` : ""}`);
  }

  async isInitialized() {
    const snapshot = await get(this.appRef("meta/initialized"));
    return snapshot.val() === true;
  }

  async loadOwnProfile(force = false) {
    const user = this.auth?.currentUser;
    if (!user) return null;
    if (this.profile && !force) return clone(this.profile);
    const snapshot = await get(this.appRef(`access/${pathKey(user.uid)}`));
    const profile = snapshot.val();
    this.profile = profile ? { ...profile, UsuarioID: user.uid } : null;
    return clone(this.profile);
  }

  async requireProfile() {
    await this.ready();
    const profile = await this.loadOwnProfile();
    if (!this.auth.currentUser || !profile || !asBoolean(profile.Ativo)) {
      throw new Error(
        "O acesso não está ativo ou não foi vinculado. Fale com o administrador.",
      );
    }
    return profile;
  }

  async login(email, password, remember) {
    await setPersistence(
      this.auth,
      remember ? browserLocalPersistence : browserSessionPersistence,
    );
    const credential = await signInWithEmailAndPassword(
      this.auth,
      normalizeEmail(email),
      String(password || ""),
    );
    this.profile = null;
    const profile = await this.loadOwnProfile(true);
    if (!profile || !asBoolean(profile.Ativo)) {
      await signOut(this.auth);
      throw new Error("Este acesso está inativo ou não foi configurado.");
    }
    try {
      await update(this.appRef(`access/${pathKey(credential.user.uid)}`), {
        UltimoAcesso: nowIso(),
        DataAtualizacao: nowIso(),
      });
    } catch (error) {
      // A atualização do último acesso é informativa e não pode impedir o login.
      if (!isPermissionDenied(error)) throw error;
    }
    if (profile) {
      profile.FotoPerfil = "";
      this.profile = clone(profile);
    }
    return credential.user;
  }

  async logout() {
    this.profile = null;
    await signOut(this.auth);
  }

  async sendPasswordReset(email) {
    await sendPasswordResetEmail(this.auth, normalizeEmail(email));
  }

  async setupInitialAdmin({ name, email, password, company }) {
    if (await this.isInitialized()) {
      throw new Error("A configuração inicial já foi concluída.");
    }
    await setPersistence(this.auth, browserLocalPersistence);
    const credential = await createUserWithEmailAndPassword(
      this.auth,
      normalizeEmail(email),
      password,
    );
    const employeeId = uuid();
    const createdAt = nowIso();
    const profile = {
      UsuarioID: credential.user.uid,
      FuncionarioID: employeeId,
      Nome: String(name || "Administrador").trim(),
      Email: normalizeEmail(email),
      Perfil: APP.profiles.admin,
      LojaID: "",
      NomeLoja: "",
      Cargo: "Administrador",
      PrimeiroAcesso: false,
      Ativo: true,
      DataCriacao: createdAt,
      DataAtualizacao: createdAt,
      UltimoAcesso: createdAt,
    };

    const accessPath = `access/${pathKey(credential.user.uid)}`;
    const claimed = await runTransaction(
      this.appRef(accessPath),
      (current) => current || profile,
      { applyLocally: false },
    );
    if (!claimed.committed) {
      throw new Error("Não foi possível criar o primeiro administrador.");
    }
    this.profile = profile;

    const employee = {
      FuncionarioID: employeeId,
      AuthUID: credential.user.uid,
      Nome: profile.Nome,
      Email: profile.Email,
      Telefone: "",
      LojaID: "",
      NomeLoja: "",
      Cargo: "Administrador",
      Perfil: APP.profiles.admin,
      DataAdmissao: "",
      TipoContrato: "",
      DiasTrabalhoSemana: "",
      DiaFolgaPreferencial: "",
      SegundoDiaFolgaPreferencial: "",
      SaldoFolgas: 0,
      Ativo: true,
      DataCriacao: createdAt,
      CriadoPor: profile.Email,
      DataAtualizacao: createdAt,
      CPF: "",
    };
    await this.upsert("Funcionarios", employee);

    for (const item of DEFAULT_CONFIG) {
      await this.upsert("Configuracoes", {
        ...item,
        Valor:
          item.Chave === "Nome da empresa" && String(company || "").trim()
            ? String(company).trim()
            : item.Valor,
        DataAtualizacao: createdAt,
        AtualizadoPor: profile.Email,
      });
    }
    await set(this.appRef("meta"), {
      initialized: true,
      version: APP.version,
      createdAt,
      createdBy: credential.user.uid,
    });
    return clone(profile);
  }

  async createAuthUser(email, password) {
    const name = `Provisioning-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const secondaryApp = initializeApp(this.config, name);
    const secondaryAuth = getAuth(secondaryApp);
    try {
      const credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        normalizeEmail(email),
        password,
      );
      await signOut(secondaryAuth);
      return credential.user.uid;
    } finally {
      await deleteApp(secondaryApp);
    }
  }

  async updateOwnAuth({ email, password, currentPassword }) {
    const user = this.auth.currentUser;
    if (!user) throw new Error("Sua sessão expirou. Entre novamente.");
    const normalizedEmail = normalizeEmail(email);
    const changesEmail =
      normalizedEmail && normalizedEmail !== normalizeEmail(user.email);
    if (changesEmail || password) {
      if (!currentPassword) {
        throw new Error("Informe a senha atual para confirmar a alteração.");
      }
      try {
        await reauthenticateWithCredential(
          user,
          EmailAuthProvider.credential(user.email, String(currentPassword)),
        );
      } catch (error) {
        const code = String(error?.code || "");
        if (
          code.includes("auth/invalid-credential") ||
          code.includes("auth/wrong-password")
        ) {
          throw new Error("A senha atual está incorreta.");
        }
        throw error;
      }
    }
    if (changesEmail) {
      await updateEmail(user, normalizeEmail(email));
    }
    if (password) await updatePassword(user, password);
    return user;
  }

  async listAccess() {
    const profile = await this.requireProfile();
    if (!isAdminProfile(profile)) return [profile];
    return snapshotList(await get(this.appRef("access")));
  }

  async getAccess(uid) {
    const snapshot = await get(this.appRef(`access/${pathKey(uid)}`));
    return snapshot.val() ? clone(snapshot.val()) : null;
  }

  async saveAccess(uid, profile) {
    await set(
      this.appRef(`access/${pathKey(uid)}`),
      cleanObject({ ...profile, UsuarioID: uid }),
    );
    if (this.auth.currentUser?.uid === uid) this.profile = clone(profile);
    return clone(profile);
  }

  async list(table, options = {}) {
    const profile = options.profile || (await this.requireProfile());
    const tableRef = this.appRef(`tables/${table}`);
    if (isAdminProfile(profile) || PUBLIC_AUTH_TABLES.has(table)) {
      return snapshotList(await get(tableRef));
    }

    const storeId = String(profile.LojaID || "");
    const employeeId = String(profile.FuncionarioID || "");
    if (table === "Lojas" && storeId) {
      // O funcionário já recebe LojaID/NomeLoja no próprio perfil. Evite ler
      // o cadastro administrativo completo da loja durante o login.
      if (isEmployeeProfile(profile)) return [];
      const record = await this.getById(table, storeId);
      return record ? [record] : [];
    }
    if (table === "Funcionarios" && isEmployeeProfile(profile) && employeeId) {
      const record = await this.getById(table, employeeId);
      return record ? [record] : [];
    }

    const storeField = STORE_SCOPED_FIELDS[table];
    if (isManagerProfile(profile) && storeId && storeField) {
      return snapshotList(
        await get(query(tableRef, orderByChild(storeField), equalTo(storeId))),
      );
    }
    const employeeField = EMPLOYEE_SCOPED_FIELDS[table];
    if (employeeId && employeeField) {
      return snapshotList(
        await get(
          query(tableRef, orderByChild(employeeField), equalTo(employeeId)),
        ),
      );
    }
    return [];
  }

  async periodIndexesReady() {
    const snapshot = await get(
      this.appRef(`meta/migrations/${PERIOD_INDEX_MIGRATION}`),
    );
    return snapshot.val() === true;
  }

  async ensurePeriodIndexes(options = {}) {
    const profile = options.profile || (await this.requireProfile());
    if (await this.periodIndexesReady()) return true;
    if (!isAdminProfile(profile)) return false;
    if (this.periodIndexMigrationPromise) {
      return this.periodIndexMigrationPromise;
    }

    this.periodIndexMigrationPromise = (async () => {
      for (const table of PERIOD_INDEXED_TABLES) {
        const tableRef = this.appRef(`tables/${table}`);
        const snapshot = await get(tableRef);
        const records = snapshot.val() || {};
        const changes = {};
        Object.entries(records).forEach(([key, record]) => {
          if (!record || typeof record !== "object") return;
          const fields = periodFieldsFor(table, record);
          Object.entries(fields).forEach(([field, value]) => {
            if (record[field] !== value) changes[`${key}/${field}`] = value;
          });
        });
        if (Object.keys(changes).length) await update(tableRef, changes);
      }
      await set(
        this.appRef(`meta/migrations/${PERIOD_INDEX_MIGRATION}`),
        true,
      );
      return true;
    })().finally(() => {
      this.periodIndexMigrationPromise = null;
    });

    return this.periodIndexMigrationPromise;
  }

  async listPeriod(table, period, options = {}) {
    const profile = options.profile || (await this.requireProfile());
    const normalizedPeriod = validPeriod(period);
    if (!normalizedPeriod || !PERIOD_INDEXED_TABLES.has(table)) {
      return this.list(table, { profile });
    }
    // Consultas compostas por funcionário/loja exigem regras adicionais e
    // alguns projetos existentes recusam essas leituras. Mantenha os perfis
    // não administrativos na consulta já autorizada para não bloquear o ponto.
    if (!isAdminProfile(profile)) {
      return this.list(table, { profile });
    }

    let ready = false;
    try {
      ready = await this.ensurePeriodIndexes({ profile });
    } catch (error) {
      const code = String(error?.code || error?.message || "");
      if (/permission[-_]denied/i.test(code)) {
        return this.list(table, { profile });
      }
      throw error;
    }
    if (!ready) return this.list(table, { profile });

    try {
      return snapshotList(
        await get(
          query(
            this.appRef(`tables/${table}`),
            orderByChild("PeriodoChave"),
            equalTo(normalizedPeriod),
          ),
        ),
      );
    } catch (error) {
      const code = String(error?.code || error?.message || "");
      if (/permission[-_]denied/i.test(code)) {
        return this.list(table, { profile });
      }
      throw error;
    }
  }

  async listPeriods(table, periods, options = {}) {
    const profile = options.profile || (await this.requireProfile());
    const uniquePeriods = [...new Set(periods)]
      .map(validPeriod)
      .filter(Boolean);
    if (!uniquePeriods.length) return [];
    const groups = await Promise.all(
      uniquePeriods.map((period) =>
        this.listPeriod(table, period, { profile }),
      ),
    );
    const idField = ID_FIELDS[table];
    const unique = new Map();
    groups.flat().forEach((record) => {
      unique.set(String(record?.[idField] || uuid()), record);
    });
    return [...unique.values()];
  }

  async getById(table, id) {
    if (!id) return null;
    const snapshot = await get(
      this.appRef(`tables/${table}/${pathKey(id)}`),
    );
    return snapshot.val() ? clone(snapshot.val()) : null;
  }

  async findOne(table, field, value) {
    const snapshot = await get(
      query(
        this.appRef(`tables/${table}`),
        orderByChild(field),
        equalTo(value),
      ),
    );
    const rows = snapshotList(snapshot);
    return rows[0] || null;
  }

  async upsert(table, record) {
    const idField = ID_FIELDS[table];
    if (!idField) throw new Error(`Tabela sem identificador: ${table}.`);
    const id = String(record?.[idField] || uuid());
    const normalized = cleanObject({
      ...record,
      ...periodFieldsFor(table, record),
      [idField]: id,
    });
    await set(
      this.appRef(`tables/${table}/${pathKey(id)}`),
      normalized,
    );
    return clone(normalized);
  }

  async patch(table, id, changes) {
    const current = await this.getById(table, id);
    if (!current) throw new Error("Registro não encontrado.");
    return this.upsert(table, {
      ...current,
      ...cleanObject(changes),
      [ID_FIELDS[table]]: id,
    });
  }

  async applyEmployeeLeaveBalance({
    employeeId,
    movementKey,
    desiredDelta,
    metadata = {},
  }) {
    const id = String(employeeId || "");
    const rawKey = String(movementKey || "");
    if (!id || !rawKey) throw new Error("Movimento de saldo inválido.");
    const key = pathKey(rawKey);
    let outcome = null;
    const transaction = await runTransaction(
      this.appRef(`tables/Funcionarios/${pathKey(id)}`),
      (current) => {
        if (!current || typeof current !== "object") return;
        const entries = {
          ...(current.SaldoFolgasLancamentos || {}),
        };
        const previousDelta = Number(entries[key]?.Delta || 0);
        const normalizedDesired =
          Math.round(Number(desiredDelta || 0) * 100) / 100;
        const adjustment =
          Math.round((normalizedDesired - previousDelta) * 100) / 100;
        if (!adjustment) return;
        const balanceBefore = Number(current.SaldoFolgas || 0);
        const balanceAfter =
          Math.round((balanceBefore + adjustment) * 100) / 100;
        const appliedAt = nowIso();
        entries[key] = cleanObject({
          ...metadata,
          Delta: normalizedDesired,
          DataAtualizacao: appliedAt,
        });
        outcome = {
          applied: true,
          adjustment,
          balanceBefore,
          balanceAfter,
          desiredDelta: normalizedDesired,
          appliedAt,
        };
        return {
          ...current,
          SaldoFolgas: balanceAfter,
          SaldoFolgasLancamentos: entries,
          DataAtualizacao: appliedAt,
        };
      },
      { applyLocally: false },
    );
    if (!transaction.committed) {
      const employee = transaction.snapshot.val();
      if (!employee) throw new Error("Funcionário não encontrado.");
      return {
        applied: false,
        adjustment: 0,
        balanceBefore: Number(employee.SaldoFolgas || 0),
        balanceAfter: Number(employee.SaldoFolgas || 0),
        desiredDelta: Number(
          employee.SaldoFolgasLancamentos?.[key]?.Delta || 0,
        ),
      };
    }
    return outcome;
  }

  async delete(table, id) {
    await remove(this.appRef(`tables/${table}/${pathKey(id)}`));
  }

  async saveBlob(category, id, value) {
    await set(
      this.appRef(`blobs/${pathKey(category)}/${pathKey(id)}`),
      cleanObject(value),
    );
  }

  async getBlob(category, id) {
    const snapshot = await get(
      this.appRef(`blobs/${pathKey(category)}/${pathKey(id)}`),
    );
    return snapshot.val() ? clone(snapshot.val()) : null;
  }

  async deleteBlob(category, id) {
    await remove(
      this.appRef(`blobs/${pathKey(category)}/${pathKey(id)}`),
    );
  }

  async getPath(relativePath) {
    const snapshot = await get(this.appRef(relativePath));
    return snapshot.exists() ? clone(snapshot.val()) : null;
  }

  async setPath(relativePath, value) {
    await set(this.appRef(relativePath), cleanObject(value));
    return clone(value);
  }

  async patchPath(relativePath, value) {
    await update(this.appRef(relativePath), cleanObject(value));
    return clone(value);
  }

  async removePath(relativePath) {
    await remove(this.appRef(relativePath));
  }

  subscribe(relativePath, callback, onError) {
    return onValue(
      this.appRef(relativePath),
      (snapshot) => callback(clone(snapshot.val())),
      onError,
    );
  }
}

export const runtime = new FirebaseRuntime();
