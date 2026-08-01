import {
  deleteApp,
  getApp,
  getApps,
  initializeApp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
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
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
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
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
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

const snapshotEntries = (snapshot) => {
  const entries = [];
  snapshot.forEach((child) => {
    const value = child.val();
    if (value && typeof value === "object") {
      entries.push({ key: child.key, record: clone(value) });
    }
  });
  return entries;
};

const normalizedIdentity = (value) =>
  String(value || "").trim().toLowerCase();

const employeeReferenceIds = (source = {}) =>
  new Set(
    [
      source.FuncionarioID,
      source.funcionarioId,
      source.employeeId,
      source.id,
      source.AuthUID,
      source.UsuarioID,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );

export const selectEmployeeEntry = (entries = [], reference = {}) => {
  const ids = employeeReferenceIds(reference);
  const email = normalizeEmail(
    reference.EmailFuncionario || reference.Email || reference.email,
  );
  const name = normalizedIdentity(
    reference.NomeFuncionario || reference.Nome || reference.name,
  );
  const storeId = String(
    reference.LojaID || reference.lojaId || reference.storeId || "",
  );

  const ranked = entries
    .map((entry) => {
      const record = entry?.record || {};
      const recordIds = employeeReferenceIds(record);
      const recordEmail = normalizeEmail(record.Email || record.email);
      const recordName = normalizedIdentity(record.Nome || record.nome);
      const recordStore = String(record.LojaID || record.lojaId || "");
      let score = 0;

      if ([...recordIds].some((id) => ids.has(id))) score = 100;
      else if (email && recordEmail === email) score = 80;
      else if (
        name &&
        recordName === name &&
        (!storeId || recordStore === storeId)
      ) {
        score = 60;
      } else if (ids.has(String(entry?.key || ""))) score = 40;

      if (score && storeId && recordStore === storeId) score += 10;
      if (score && asBoolean(record.Ativo)) score += 1;
      return { ...entry, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0] || null;
};

const snapshotList = (snapshot) =>
  snapshotEntries(snapshot).map((entry) => entry.record);

const validPeriod = (value) =>
  /^\d{4}-\d{2}$/.test(String(value || "")) ? String(value) : "";

export const isPermissionDenied = (error) =>
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
    this.recordKeys = new Map();
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
    let profile = snapshot.val();
    if (profile?.FuncionarioID) {
      try {
        const employeeSnapshot = await get(
          query(
            this.appRef("tables/Funcionarios"),
            orderByChild("FuncionarioID"),
            equalTo(profile.FuncionarioID),
          ),
        );
        const employee = snapshotList(employeeSnapshot)[0];
        if (employee) {
          profile = {
            ...profile,
            Nome: profile.Nome || employee.Nome || "",
            Email: profile.Email || employee.Email || "",
            LojaID: profile.LojaID || employee.LojaID || "",
            NomeLoja: profile.NomeLoja || employee.NomeLoja || "",
            Cargo: profile.Cargo || employee.Cargo || "",
            Ativo:
              asBoolean(profile.Ativo) && employee.Ativo !== false,
          };
        }
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
      }
    }
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

  async createAuthUser(email, password, provision = null) {
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
      try {
        if (typeof provision === "function") {
          await provision(credential.user.uid);
        }
        await signOut(secondaryAuth);
        return credential.user.uid;
      } catch (error) {
        await deleteUser(credential.user).catch(() => {});
        throw error;
      }
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

  async deleteAccess(uid) {
    await remove(this.appRef(`access/${pathKey(uid)}`));
    if (this.auth.currentUser?.uid === uid) this.profile = null;
  }

  recordCacheKey(table, id) {
    return `${table}:${String(id || "")}`;
  }

  rememberRecordStorageKey(table, lookupId, storageKey, record = null) {
    const idField = ID_FIELDS[table];
    const aliases = new Set([
      String(lookupId || ""),
      String(record?.[idField] || ""),
    ]);
    aliases.delete("");
    aliases.forEach((id) => {
      this.recordKeys.set(this.recordCacheKey(table, id), storageKey);
    });
    return storageKey;
  }

  recordsFromSnapshot(table, snapshot) {
    const idField = ID_FIELDS[table];
    return snapshotEntries(snapshot).map(({ key, record }) => {
      const id = idField ? record?.[idField] : "";
      if (id) this.rememberRecordStorageKey(table, id, key, record);
      return record;
    });
  }

  async scopedRows(table, profile) {
    const tableRef = this.appRef(`tables/${table}`);
    if (isAdminProfile(profile) || PUBLIC_AUTH_TABLES.has(table)) {
      return this.recordsFromSnapshot(table, await get(tableRef));
    }

    const storeId = String(profile.LojaID || "");
    const employeeId = String(profile.FuncionarioID || "");
    if (table === "Lojas" && storeId && !isEmployeeProfile(profile)) {
      try {
        return this.recordsFromSnapshot(
          table,
          await get(query(tableRef, orderByChild("LojaID"), equalTo(storeId))),
        );
      } catch (error) {
        // O bootstrap ainda consegue mostrar a loja sintética do perfil.
        if (isPermissionDenied(error)) return [];
        throw error;
      }
    }
    if (table === "Funcionarios" && isEmployeeProfile(profile) && employeeId) {
      return this.recordsFromSnapshot(
        table,
        await get(
          query(
            tableRef,
            orderByChild("FuncionarioID"),
            equalTo(employeeId),
          ),
        ),
      );
    }
    if (["Comunicados", "Enquetes"].includes(table) && storeId) {
      const snapshots = (
        await Promise.all(
          [storeId, ""].map(async (scopeId) => {
            try {
              return await get(
                query(tableRef, orderByChild("LojaID"), equalTo(scopeId)),
              );
            } catch (error) {
              // Acessos antigos podem não ter LojaID. O cadastro do funcionário
              // continua utilizável, mas as regras só liberam comunicados globais.
              if (isPermissionDenied(error)) return null;
              throw error;
            }
          }),
        )
      ).filter(Boolean);
      const idField = ID_FIELDS[table];
      const unique = new Map();
      snapshots
        .flatMap((snapshot) => this.recordsFromSnapshot(table, snapshot))
        .forEach((record) => {
          unique.set(String(record?.[idField] || uuid()), record);
        });
      return [...unique.values()];
    }

    if (
      table === "DiretorioTrocasFolga" &&
      isEmployeeProfile(profile) &&
      storeId
    ) {
      return this.recordsFromSnapshot(
        table,
        await get(query(tableRef, orderByChild("LojaID"), equalTo(storeId))),
      );
    }

    const storeField = STORE_SCOPED_FIELDS[table];
    if (isManagerProfile(profile) && storeId && storeField) {
      return this.recordsFromSnapshot(
        table,
        await get(query(tableRef, orderByChild(storeField), equalTo(storeId))),
      );
    }
    const employeeField = EMPLOYEE_SCOPED_FIELDS[table];
    if (employeeId && employeeField) {
      return this.recordsFromSnapshot(
        table,
        await get(
          query(tableRef, orderByChild(employeeField), equalTo(employeeId)),
        ),
      );
    }
    return [];
  }

  async list(table, options = {}) {
    const profile = options.profile || (await this.requireProfile());
    return this.scopedRows(table, profile);
  }

  async resolveEmployeeEntry(reference = {}, options = {}) {
    const profile = options.profile || (await this.requireProfile());
    const tableRef = this.appRef("tables/Funcionarios");
    const profileStoreId = String(profile.LojaID || "");
    const profileEmployeeId = String(profile.FuncionarioID || "");
    let snapshot = null;

    if (isAdminProfile(profile)) {
      snapshot = await get(tableRef);
    } else if (isManagerProfile(profile) && profileStoreId) {
      snapshot = await get(
        query(tableRef, orderByChild("LojaID"), equalTo(profileStoreId)),
      );
    } else if (profileEmployeeId) {
      snapshot = await get(
        query(
          tableRef,
          orderByChild("FuncionarioID"),
          equalTo(profileEmployeeId),
        ),
      );
    }
    if (!snapshot) return null;

    const entries = snapshotEntries(snapshot);
    entries.forEach(({ key, record }) => {
      const recordId = String(record?.FuncionarioID || "");
      if (recordId) {
        this.rememberRecordStorageKey("Funcionarios", recordId, key, record);
      }
    });
    const selected = selectEmployeeEntry(entries, reference);
    if (!selected) return null;

    employeeReferenceIds(reference).forEach((alias) => {
      this.rememberRecordStorageKey(
        "Funcionarios",
        alias,
        selected.key,
        selected.record,
      );
    });
    return { storageKey: selected.key, record: clone(selected.record) };
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
      return this.recordsFromSnapshot(
        table,
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
    if (!isAdminProfile(profile)) {
      const allowedPeriods = new Set(uniquePeriods);
      return (await this.list(table, { profile })).filter((record) =>
        allowedPeriods.has(
          validPeriod(String(record?.Data || record?.DataHora || "").slice(0, 7)),
        ),
      );
    }
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
    const normalizedId = String(id);
    const cachedKey = this.recordKeys.get(
      this.recordCacheKey(table, normalizedId),
    );
    if (cachedKey) {
      try {
        const cached = await get(
          this.appRef(`tables/${table}/${cachedKey}`),
        );
        if (cached.exists()) {
          const record = cached.val();
          this.rememberRecordStorageKey(
            table,
            normalizedId,
            cachedKey,
            record,
          );
          return clone(record);
        }
        this.recordKeys.delete(this.recordCacheKey(table, normalizedId));
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
      }
    }

    try {
      const snapshot = await get(
        this.appRef(`tables/${table}/${pathKey(normalizedId)}`),
      );
      if (snapshot.exists()) {
        const record = snapshot.val();
        this.rememberRecordStorageKey(
          table,
          normalizedId,
          pathKey(normalizedId),
          record,
        );
        return clone(record);
      }
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
    }

    const profile = await this.requireProfile();
    try {
      const idField = ID_FIELDS[table];
      const rows = await this.scopedRows(table, profile);
      return (
        rows.find(
          (record) => String(record?.[idField] || "") === normalizedId,
        ) || null
      );
    } catch (error) {
      if (isPermissionDenied(error)) return null;
      throw error;
    }
  }

  async findOne(table, field, value) {
    const snapshot = await get(
      query(
        this.appRef(`tables/${table}`),
        orderByChild(field),
        equalTo(value),
      ),
    );
    const rows = this.recordsFromSnapshot(table, snapshot);
    return rows[0] || null;
  }

  async resolveStorageKey(table, id) {
    const normalizedId = String(id || "");
    const cacheKey = this.recordCacheKey(table, normalizedId);
    if (this.recordKeys.has(cacheKey)) return this.recordKeys.get(cacheKey);
    await this.getById(table, normalizedId);
    return this.recordKeys.get(cacheKey) || pathKey(normalizedId);
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
    const storageKey = await this.resolveStorageKey(table, id);
    await set(this.appRef(`tables/${table}/${storageKey}`), normalized);
    this.recordKeys.set(this.recordCacheKey(table, id), storageKey);
    return clone(normalized);
  }

  async create(table, record) {
    const idField = ID_FIELDS[table];
    if (!idField) throw new Error(`Tabela sem identificador: ${table}.`);
    const id = String(record?.[idField] || uuid());
    const normalized = cleanObject({
      ...record,
      ...periodFieldsFor(table, record),
      [idField]: id,
    });
    const storageKey = pathKey(id);
    await set(this.appRef(`tables/${table}/${storageKey}`), normalized);
    this.recordKeys.set(this.recordCacheKey(table, id), storageKey);
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

  async patchMany(items = []) {
    const changes = {};
    const output = [];
    for (const item of items) {
      const {
        table,
        id,
        changes: recordChanges = {},
        createIfMissing = false,
        record = {},
      } = item;
      const current = await this.getById(table, id);
      if (!current && !createIfMissing) {
        throw new Error("Registro não encontrado.");
      }
      const idField = ID_FIELDS[table];
      const normalized = cleanObject({
        ...(current || record),
        ...recordChanges,
        ...periodFieldsFor(table, {
          ...(current || record),
          ...recordChanges,
        }),
        [idField]: id,
      });
      const storageKey = current
        ? await this.resolveStorageKey(table, id)
        : pathKey(id);
      changes[`tables/${table}/${storageKey}`] = normalized;
      this.recordKeys.set(this.recordCacheKey(table, id), storageKey);
      output.push(clone(normalized));
    }
    if (Object.keys(changes).length) await update(this.appRef(), changes);
    return output;
  }

  async applyEmployeeLeaveBalance({
    employeeId,
    storageKey: preferredStorageKey = "",
    movementKey,
    desiredDelta,
    metadata = {},
  }) {
    const id = String(employeeId || "");
    const rawKey = String(movementKey || "");
    if (!id || !rawKey) throw new Error("Movimento de saldo inválido.");
    const key = pathKey(rawKey);
    let outcome = null;
    const runBalanceTransaction = (storageKey) =>
      runTransaction(
        this.appRef(`tables/Funcionarios/${storageKey}`),
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

    let storageKey = String(preferredStorageKey || "");
    if (!storageKey) {
      storageKey = await this.resolveStorageKey("Funcionarios", id);
    } else {
      this.recordKeys.set(
        this.recordCacheKey("Funcionarios", id),
        storageKey,
      );
    }
    let transaction = await runBalanceTransaction(storageKey);
    if (!transaction.committed && !transaction.snapshot.exists()) {
      // Cadastros importados ou recriados podem continuar associados a uma
      // chave antiga durante a sessão. Limpa o cache, localiza a chave atual e
      // repete o lançamento idempotente uma única vez.
      this.recordKeys.delete(this.recordCacheKey("Funcionarios", id));
      const employee = await this.getById("Funcionarios", id);
      if (!employee) throw new Error("Funcionário não encontrado.");
      storageKey = await this.resolveStorageKey("Funcionarios", id);
      outcome = null;
      transaction = await runBalanceTransaction(storageKey);
    }
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
    const storageKey = await this.resolveStorageKey(table, id);
    await remove(this.appRef(`tables/${table}/${storageKey}`));
    this.recordKeys.delete(this.recordCacheKey(table, id));
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

  async transactPath(relativePath, updateValue) {
    const transaction = await runTransaction(
      this.appRef(relativePath),
      (current) => {
        const next = updateValue(
          current === null || current === undefined ? null : clone(current),
        );
        return next === undefined ? undefined : cleanObject(next);
      },
    );
    return transaction.committed ? clone(transaction.snapshot.val()) : null;
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
