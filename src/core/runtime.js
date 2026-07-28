import { deleteApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
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

const pathKey = (value) =>
  encodeURIComponent(String(value || uuid())).replaceAll(".", "%2E");

const snapshotList = (snapshot) => {
  const value = snapshot.val() || {};
  return Object.values(value)
    .filter((item) => item && typeof item === "object")
    .map(clone);
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
    await update(this.appRef(`access/${pathKey(credential.user.uid)}`), {
      UltimoAcesso: nowIso(),
      DataAtualizacao: nowIso(),
    });
    return credential.user;
  }

  async logout() {
    this.profile = null;
    await signOut(this.auth);
  }

  async sendPasswordReset(email) {
    await sendPasswordResetEmail(this.auth, normalizeEmail(email));
  }

  async getInitialAdminCredential(email, password) {
    const normalizedEmail = normalizeEmail(email);
    const currentUser = this.auth.currentUser;

    if (
      currentUser &&
      normalizeEmail(currentUser.email) === normalizedEmail
    ) {
      return { user: currentUser };
    }

    if (currentUser) {
      await signOut(this.auth);
    }

    try {
      return await createUserWithEmailAndPassword(
        this.auth,
        normalizedEmail,
        password,
      );
    } catch (error) {
      if (error?.code !== "auth/email-already-in-use") throw error;
      return signInWithEmailAndPassword(
        this.auth,
        normalizedEmail,
        password,
      );
    }
  }

  async setupInitialAdmin({ name, email, password, company }) {
    if (await this.isInitialized()) {
      throw new Error("A configuração inicial já foi concluída.");
    }
    await setPersistence(this.auth, browserLocalPersistence);
    const credential = await this.getInitialAdminCredential(email, password);
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
      FotoPerfil: "",
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
    await Promise.all([
      set(this.appRef("meta/version"), APP.version),
      set(this.appRef("meta/createdAt"), createdAt),
      set(this.appRef("meta/createdBy"), credential.user.uid),
    ]);
    await set(this.appRef("meta/initialized"), true);
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

  async updateOwnAuth({ email, password }) {
    const user = this.auth.currentUser;
    if (!user) throw new Error("Sua sessão expirou. Entre novamente.");
    if (email && normalizeEmail(email) !== normalizeEmail(user.email)) {
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
    const normalized = cleanObject({ ...record, [idField]: id });
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
