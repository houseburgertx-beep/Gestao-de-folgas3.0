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
  getRedirectResult,
  GoogleAuthProvider,
  linkWithPopup,
  linkWithRedirect,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
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

const isAdminProfile = (profile) =>
  roleName(profile).includes("admin") || roleName(profile).includes("diretor");
// Perfis que podem consultar dados da própria loja. Isso inclui o chefe de
// cozinha, mas não concede as ações de gestão protegidas por requireManager.
const isStoreReaderProfile = (profile) =>
  roleName(profile).includes("respons") ||
  roleName(profile).includes("gerente") ||
  roleName(profile).includes("chefe de cozinha");
const isEmployeeProfile = (profile) =>
  roleName(profile).includes("funcion") ||
  roleName(profile).includes("colaborador");

const PERIOD_INDEXED_TABLES = new Set(["RegistrosPonto", "AjustesPonto"]);
const PERIOD_INDEX_MIGRATION = "timeClockPeriodIndexesV1";

const REALTIME_CACHE_TABLES = new Set(["RegistrosPonto", "AjustesPonto", "Notificacoes"]);
const VOLATILE_CACHE_TABLES = new Set([
  "TrocasFolga",
  "JustificativasPonto",
  "SolicitacoesVale",
  "Denuncias",
  "DenunciasMensagens",
  "Tarefas",
  "Onboarding",
  "Substituicoes",
  "Auditoria",
]);
const STATIC_REFERENCE_CACHE_TABLES = new Set([
  "Lojas",
  "Configuracoes",
  "Feriados",
  "RegrasFolga",
  "RegrasOperacionais",
  "POPsTreinamentos",
  "TarefasTemplates",
  "TabelaFichas",
  "PontosCatalogo",
  "LocaisPonto",
]);
const PERSISTENT_CACHE_PREFIX = "gf_rtdb_v1:";
const PERSISTENT_CACHE_MAX_CHARS = 1500000;

export const tableCacheTtl = (table) => {
  if (REALTIME_CACHE_TABLES.has(table)) return 15000;
  if (VOLATILE_CACHE_TABLES.has(table)) return 90000;
  if (STATIC_REFERENCE_CACHE_TABLES.has(table)) return 1800000;
  return 300000;
};

const persistentStorageForTable = (table) => {
  try {
    if (STATIC_REFERENCE_CACHE_TABLES.has(table)) {
      return globalThis?.localStorage || null;
    }
    if (!REALTIME_CACHE_TABLES.has(table) && !VOLATILE_CACHE_TABLES.has(table)) {
      return globalThis?.sessionStorage || null;
    }
  } catch {
    return null;
  }
  return null;
};

const clearPersistentCacheByPrefix = (prefix) => {
  for (const kind of ["localStorage", "sessionStorage"]) {
    try {
      const storage = globalThis?.[kind];
      if (!storage || typeof storage.key !== "function" || typeof storage.removeItem !== "function") continue;
      const toRemove = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && k.startsWith(prefix)) toRemove.push(k);
      }
      toRemove.forEach((k) => storage.removeItem(k));
    } catch {
      // Ignore storage access failures in restricted contexts.
    }
  }
};

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
    this.periodIndexReadyState = null;
    this.periodIndexReadyCheck = null;
    this.recordKeys = new Map();
    this.queryCache = new Map();
    this.pendingQueries = new Map();
    this.cacheGeneration = 0;
  }

  invalidateTableCache(table = "") {
    this.cacheGeneration += 1;
    for (const key of this.pendingQueries.keys()) {
      if (!table || key.startsWith(`${table}:`)) this.pendingQueries.delete(key);
    }
    clearPersistentCacheByPrefix(
      table
        ? `${PERSISTENT_CACHE_PREFIX}${this.root}:${table}:`
        : `${PERSISTENT_CACHE_PREFIX}${this.root}:`,
    );
    if (!table) {
      this.periodIndexReadyState = null;
      this.periodIndexReadyCheck = null;
      this.queryCache.clear();
      return;
    }
    const prefix = `${table}:`;
    for (const key of this.queryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.queryCache.delete(key);
      }
    }
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
    setPersistence(this.auth, browserLocalPersistence).catch(() => {});
    this.db = getDatabase(this.app);

    // Inicia a captura do redirect do Google imediatamente na inicialização
    this.redirectPromise = getRedirectResult(this.auth).catch((err) => {
      console.warn("Aviso ao iniciar getRedirectResult:", err);
      return null;
    });

    this.readyPromise = new Promise((resolve) => {
      let resolved = false;
      onAuthStateChanged(this.auth, async (user) => {
        this.authResolved = true;
        this.profile = null;
        this.recordKeys.clear();
        this.invalidateTableCache();
        if (user) {
          let profile = await this.loadOwnProfile().catch(() => null);
          const isGoogleUser = user.providerData?.some(
            (p) => p.providerId === "google.com",
          );
          if (!profile && isGoogleUser) {
            try {
              await this.completeGoogleAuth(user);
              profile = this.profile;
            } catch (err) {
              console.warn("Auto-completar auth do Google no onAuthStateChanged:", err);
            }
          }
          this.profile = profile;
        } else {
          this.profile = null;
        }
        if (!resolved) {
          resolved = true;
          resolve(user);
        }
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
    if ((!profile || !profile.FuncionarioID) && user.email) {
      try {
        let employeeSnapshot = await get(
          query(
            this.appRef("tables/Funcionarios"),
            orderByChild("AuthUID"),
            equalTo(user.uid),
          ),
        );
        let employee = snapshotList(employeeSnapshot)[0];
        if (!employee) {
          employeeSnapshot = await get(
            query(
              this.appRef("tables/Funcionarios"),
              orderByChild("Email"),
              equalTo(normalizeEmail(user.email)),
            ),
          );
          employee = snapshotList(employeeSnapshot)[0];
        }
        if (employee && employee.Ativo !== false) {
          profile = {
            ...(profile || {}),
            UsuarioID: user.uid,
            FuncionarioID: employee.FuncionarioID || "",
            Nome: profile?.Nome || employee.Nome || "",
            Email: normalizeEmail(user.email),
            Perfil: profile?.Perfil || employee.Perfil || APP.profiles.employee,
            LojaID: profile?.LojaID || employee.LojaID || "",
            NomeLoja: profile?.NomeLoja || employee.NomeLoja || "",
            Cargo: profile?.Cargo || employee.Cargo || "",
            PrimeiroAcesso: false,
            Ativo: true,
            DataCriacao: profile?.DataCriacao || nowIso(),
            DataAtualizacao: nowIso(),
          };
          await update(this.appRef(`access/${pathKey(user.uid)}`), profile).catch(() => {});
        }
      } catch (autoErr) {
        if (!isPermissionDenied(autoErr)) console.warn("Auto-recuperação de perfil:", autoErr);
      }
    }
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
          const syncLoja = !snapshot.val()?.LojaID && employee.LojaID;
          profile = {
            ...profile,
            Nome: profile.Nome || employee.Nome || "",
            Email: profile.Email || employee.Email || "",
            LojaID: profile.LojaID || employee.LojaID || "",
            NomeLoja: profile.NomeLoja || employee.NomeLoja || "",
            Cargo: profile.Cargo || employee.Cargo || "",
            PoliticaPrivacidadeCiente:
              asBoolean(profile.PoliticaPrivacidadeCiente) || asBoolean(employee.PoliticaPrivacidadeCiente),
            PoliticaPrivacidadeData: profile.PoliticaPrivacidadeData || employee.PoliticaPrivacidadeData || "",
            PoliticaPrivacidadeVersao: profile.PoliticaPrivacidadeVersao || employee.PoliticaPrivacidadeVersao || "",
            PoliticaPrivacidadeAssinatura: profile.PoliticaPrivacidadeAssinatura || employee.PoliticaPrivacidadeAssinatura || "",
            Ativo:
              asBoolean(profile.Ativo) && employee.Ativo !== false,
          };
          if (syncLoja) {
            update(this.appRef(`access/${pathKey(user.uid)}`), {
              LojaID: profile.LojaID,
              NomeLoja: profile.NomeLoja,
            }).catch(() => {});
          }
        }
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
      }
    }

    const ADMIN_EMAILS = new Set([
      "houseburgertx@gmail.com",
      "gleucedias1@gmail.com",
      "gleucehouse@gmail.com",
      "gleucehouse1@gmail.com",
    ]);
    const normalizedUserEmail = normalizeEmail(user.email);
    const isAdminEmail = ADMIN_EMAILS.has(normalizedUserEmail);

    if (isAdminEmail) {
      if (!profile) {
        profile = {
          UsuarioID: user.uid,
          FuncionarioID: "",
          Nome: user.displayName || user.email.split("@")[0],
          Email: normalizedUserEmail,
          Perfil: APP.profiles.admin,
          LojaID: "",
          NomeLoja: "",
          Cargo: "Administrador",
          PrimeiroAcesso: false,
          Ativo: true,
          GoogleLinked: true,
          DataCriacao: nowIso(),
          DataAtualizacao: nowIso(),
        };
        set(this.appRef(`access/${pathKey(user.uid)}`), profile).catch(() => {});
      } else {
        profile.Perfil = APP.profiles.admin;
        profile.Cargo = "Administrador";
        profile.Ativo = true;
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

  async login(email, password, remember = true) {
    email = await this.resolveLoginEmail(email);
    await setPersistence(
      this.auth,
      remember !== false ? browserLocalPersistence : browserSessionPersistence,
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

  async loginWithGoogle(remember = true) {
    if (remember === false) {
      setPersistence(this.auth, browserSessionPersistence).catch(() => {});
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    let user = null;
    try {
      const credential = await signInWithPopup(this.auth, provider);
      user = credential.user;
    } catch (popupErr) {
      const code = String(popupErr?.code || "");
      const msg = String(popupErr?.message || popupErr || "");
      if (
        code.includes("popup-closed-by-user") ||
        msg.includes("popup-closed-by-user")
      ) {
        return null;
      }
      if (
        code.includes("popup-blocked") ||
        code.includes("cancelled-popup-request") ||
        code.includes("operation-not-supported") ||
        code.includes("auth/internal-error") ||
        msg.includes("popup-blocked") ||
        msg.includes("cancelled-popup-request") ||
        msg.includes("operation-not-supported")
      ) {
        try {
          const nowStr = String(Date.now());
          if (typeof localStorage !== "undefined") {
            localStorage.setItem("gf_google_logging_in", nowStr);
          }
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem("gf_google_logging_in", nowStr);
          }
        } catch (_) {}
        await signInWithRedirect(this.auth, provider);
        return null;
      }
      throw popupErr;
    }

    return await this.completeGoogleAuth(user);
  }

  async checkRedirectResult() {
    if (!this.auth) return null;
    try {
      const result = await (this.redirectPromise || getRedirectResult(this.auth));
      const user = result?.user || this.auth.currentUser;
      if (user) {
        const hasGoogleFlag =
          (typeof localStorage !== "undefined" && !!localStorage.getItem("gf_google_logging_in")) ||
          (typeof sessionStorage !== "undefined" && !!sessionStorage.getItem("gf_google_logging_in"));
        const isGoogleUser =
          user.providerData?.some((p) => p.providerId === "google.com") ||
          hasGoogleFlag;
        if (isGoogleUser) {
          try {
            if (typeof localStorage !== "undefined") localStorage.removeItem("gf_google_logging_in");
            if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("gf_google_logging_in");
          } catch (_) {}
          return await this.completeGoogleAuth(user);
        }
      }
    } catch (err) {
      console.warn("Aviso ao processar redirect do Google:", err);
      if (this.auth.currentUser) {
        try {
          if (typeof localStorage !== "undefined") localStorage.removeItem("gf_google_logging_in");
          if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("gf_google_logging_in");
        } catch (_) {}
        return await this.completeGoogleAuth(this.auth.currentUser);
      }
      throw err;
    }
    return null;
  }

  async completeGoogleAuth(user) {
    if (!user) return null;
    const normalizedUserEmail = normalizeEmail(user.email);
    const ADMIN_EMAILS = new Set([
      "houseburgertx@gmail.com",
      "gleucedias1@gmail.com",
      "gleucehouse@gmail.com",
      "gleucehouse1@gmail.com",
    ]);
    const isAdminEmail = ADMIN_EMAILS.has(normalizedUserEmail);

    this.profile = null;
    const accessSnap = await get(this.appRef(`access/${pathKey(user.uid)}`)).catch(() => null);
    let profile = accessSnap?.val() || null;

    if (!profile) {
      let linkedEmployee = null;
      try {
        const empSnap = await get(
          query(
            this.appRef("tables/Funcionarios"),
            orderByChild("Email"),
            equalTo(normalizedUserEmail),
          ),
        );
        linkedEmployee = snapshotList(empSnap)[0];
        if (!linkedEmployee) {
          const empSnapAuth = await get(
            query(
              this.appRef("tables/Funcionarios"),
              orderByChild("AuthUID"),
              equalTo(user.uid),
            ),
          );
          linkedEmployee = snapshotList(empSnapAuth)[0];
        }
      } catch (err) {
        if (!isPermissionDenied(err)) console.warn("Busca de funcionário Google:", err);
      }

      const isFirstUser = !(await this.isInitialized());
      const role =
        (isAdminEmail ? APP.profiles.admin : null) ||
        linkedEmployee?.Perfil ||
        (isFirstUser ? APP.profiles.admin : APP.profiles.employee);

      const newProfile = {
        UsuarioID: user.uid,
        FuncionarioID: linkedEmployee?.FuncionarioID || "",
        Nome: linkedEmployee?.Nome || user.displayName || user.email.split("@")[0],
        Email: normalizedUserEmail,
        Perfil: role,
        LojaID: linkedEmployee?.LojaID || "",
        NomeLoja: linkedEmployee?.NomeLoja || "",
        Cargo:
          linkedEmployee?.Cargo ||
          (isAdminEmail || isFirstUser ? "Administrador" : "Colaborador"),
        PrimeiroAcesso: false,
        Ativo: linkedEmployee ? linkedEmployee.Ativo !== false : true,
        GoogleLinked: true,
        DataCriacao: nowIso(),
        DataAtualizacao: nowIso(),
        UltimoAcesso: nowIso(),
      };

      try {
        await set(this.appRef(`access/${pathKey(user.uid)}`), newProfile);
      } catch (saveErr) {
        console.warn("Criação de acesso Google:", saveErr);
      }

      this.profile = clone(newProfile);
      profile = newProfile;
    } else {
      const updateData = {
        GoogleLinked: true,
        UltimoAcesso: nowIso(),
        DataAtualizacao: nowIso(),
      };
      if (isAdminEmail) {
        updateData.Perfil = APP.profiles.admin;
        profile.Perfil = APP.profiles.admin;
        profile.Cargo = "Administrador";
        profile.Ativo = true;
      }
      try {
        await update(this.appRef(`access/${pathKey(user.uid)}`), updateData);
      } catch (updateErr) {
        delete updateData.Perfil;
        await update(this.appRef(`access/${pathKey(user.uid)}`), updateData).catch(() => {});
      }
      profile.GoogleLinked = true;
      if (isAdminEmail) {
        profile.Perfil = APP.profiles.admin;
        profile.Cargo = "Administrador";
        profile.Ativo = true;
      }
      this.profile = clone(profile);
    }

    if (profile?.FuncionarioID) {
      try {
        await update(this.appRef(`tables/Funcionarios/${profile.FuncionarioID}`), {
          AuthUID: user.uid,
          GoogleLinked: true,
          UltimoAcesso: nowIso(),
        }).catch(() => {});
      } catch {}
    }

    if (isAdminEmail && profile) {
      profile.Ativo = true;
      profile.Perfil = APP.profiles.admin;
    }

    if (!profile || !asBoolean(profile.Ativo)) {
      await signOut(this.auth);
      throw new Error(
        "Este acesso está inativo ou não foi vinculado. Fale com o administrador.",
      );
    }

    return user;
  }

  async linkGoogleAccount() {
    if (!this.auth?.currentUser) {
      throw new Error("Você precisa estar autenticado para vincular a conta.");
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    const isStandalone =
      typeof window !== "undefined" &&
      (window.navigator?.standalone === true ||
        window.matchMedia?.("(display-mode: standalone)")?.matches);

    let linkedUser = this.auth.currentUser;
    if (isStandalone) {
      await linkWithRedirect(this.auth.currentUser, provider);
      return { success: true, pendingRedirect: true };
    }

    try {
      const result = await linkWithPopup(this.auth.currentUser, provider);
      linkedUser = result.user || linkedUser;
    } catch (err) {
      const code = String(err?.code || "");
      const msg = String(err?.message || err || "");
      if (code.includes("provider-already-linked")) {
        // Já vinculado anteriormente
      } else if (
        code.includes("popup-blocked") ||
        code.includes("cancelled-popup-request") ||
        msg.includes("popup-blocked") ||
        msg.includes("cancelled-popup-request")
      ) {
        await linkWithRedirect(this.auth.currentUser, provider);
        return { success: true, pendingRedirect: true };
      } else if (
        code.includes("credential-already-in-use") ||
        code.includes("email-already-in-use")
      ) {
        throw new Error(
          "Esta conta Google já está vinculada a outro usuário. Faça logout e entre diretamente com o botão 'Entrar com Conta Google'.",
        );
      } else {
        throw err;
      }
    }

    const uid = linkedUser.uid;
    const now = nowIso();
    const updateData = {
      GoogleLinked: true,
      GoogleLinkedAt: now,
      EmailGoogle: linkedUser.email || "",
      DataAtualizacao: now,
    };

    try {
      await update(this.appRef(`access/${pathKey(uid)}`), updateData);
    } catch (err) {
      console.warn("Aviso ao salvar vinculação Google no access:", err);
    }

    if (this.profile) {
      this.profile = {
        ...this.profile,
        ...updateData,
      };
    }

    if (this.profile?.FuncionarioID) {
      try {
        await update(this.appRef(`tables/Funcionarios/${this.profile.FuncionarioID}`), {
          AuthUID: uid,
          GoogleLinked: true,
          DataAtualizacao: now,
        }).catch(() => {});
      } catch {}
    }

    return {
      success: true,
      email: linkedUser.email,
    };
  }

  async logout() {
    try { await globalThis.window?.__disableGestaoPush?.(); } catch { /* Logout remains available offline. */ }
    this.profile = null;
    await signOut(this.auth);
  }

  async resolveLoginEmail(identifier) {
    const raw = String(identifier || "").trim();
    if (!raw) throw new Error("Informe seu CPF ou e-mail.");
    if (raw.includes("@")) return normalizeEmail(raw);
    const digits = raw.replace(/\D/g, "");
    if (digits.length !== 11) {
      return normalizeEmail(raw);
    }
    const formattedCpf = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
    try {
      const cpfIndexSnap = await get(this.appRef(`cpfIndex/${digits}`));
      const indexedEmail = cpfIndexSnap.val();
      if (indexedEmail && String(indexedEmail).includes("@")) {
        return normalizeEmail(indexedEmail);
      }
    } catch {}
    try {
      let snap = await get(
        query(this.appRef("tables/Funcionarios"), orderByChild("CPF"), equalTo(digits)),
      );
      let list = snapshotList(snap);
      if (!list.length) {
        snap = await get(
          query(this.appRef("tables/Funcionarios"), orderByChild("CPF"), equalTo(formattedCpf)),
        );
        list = snapshotList(snap);
      }
      if (!list.length) {
        const allSnap = await get(this.appRef("tables/Funcionarios"));
        list = snapshotList(allSnap).filter(
          (emp) => String(emp.CPF || "").replace(/\D/g, "") === digits,
        );
      }
      const match = list.find((emp) => emp.Ativo !== false && emp.Email) || list[0];
      if (match?.Email) {
        return normalizeEmail(match.Email);
      }
    } catch {}
    throw new Error("CPF não localizado ou sem e-mail vinculado. Solicite o vínculo ao seu gestor.");
  }

  async sendPasswordReset(emailOrCpf) {
    const resolvedEmail = await this.resolveLoginEmail(emailOrCpf);
    await sendPasswordResetEmail(this.auth, normalizeEmail(resolvedEmail));
    return { email: resolvedEmail };
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
    const bootstrapOwner = await this.transactPath(
      "meta/bootstrapOwner",
      (current) => current || credential.user.uid,
    );
    if (bootstrapOwner !== credential.user.uid) {
      await deleteUser(credential.user).catch(() => {});
      throw new Error("A configuração inicial já está sendo realizada em outro dispositivo.");
    }
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
    await update(this.appRef("meta"), {
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

  async readPath(relativePath) {
    const snapshot = await get(this.appRef(relativePath));
    return snapshot.exists() ? clone(snapshot.val()) : null;
  }

  async writePath(relativePath, value) {
    await set(
      this.appRef(relativePath),
      value === null ? null : cleanObject(value),
    );
    return value === null ? null : clone(value);
  }

  async patchPath(relativePath, updates) {
    await update(this.appRef(relativePath), cleanObject(updates));
    return clone(updates);
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

  async scopedRows(table, profile, forceRefresh = false) {
    const role = roleName(profile);
    const storeId = String(profile?.LojaID || "");
    const employeeId = String(profile?.FuncionarioID || "");
    const cacheKey = `${table}:${this.auth?.currentUser?.uid || ""}:${role}:${storeId}:${employeeId}`;
    return this.cachedRows_(cacheKey, table, () => this.fetchScopedRows_(table, profile), forceRefresh);
  }

  readPersistentCache_(cacheKey, table, ttl) {
    const storage = persistentStorageForTable(table);
    if (!storage || typeof storage.getItem !== "function") return null;
    try {
      const raw = storage.getItem(`${PERSISTENT_CACHE_PREFIX}${this.root}:${cacheKey}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed.timestamp !== "number" ||
        Date.now() - parsed.timestamp >= ttl ||
        !Array.isArray(parsed.data)
      ) {
        storage.removeItem?.(`${PERSISTENT_CACHE_PREFIX}${this.root}:${cacheKey}`);
        return null;
      }
      if (Array.isArray(parsed.keys)) {
        const idField = ID_FIELDS[table];
        parsed.keys.forEach(([id, storageKey], idx) => {
          if (id && storageKey) {
            this.rememberRecordStorageKey(table, id, storageKey, parsed.data[idx] || (idField ? { [idField]: id } : null));
          }
        });
      }
      return { timestamp: parsed.timestamp, data: clone(parsed.data) };
    } catch {
      return null;
    }
  }

  writePersistentCache_(cacheKey, table, rows, timestamp = Date.now()) {
    const storage = persistentStorageForTable(table);
    if (!storage || typeof storage.setItem !== "function" || !Array.isArray(rows)) return;
    const storageKey = `${PERSISTENT_CACHE_PREFIX}${this.root}:${cacheKey}`;
    try {
      const idField = ID_FIELDS[table];
      const keys = idField
        ? rows.map((row) => {
            const id = String(row?.[idField] || "");
            const recKey = id ? this.recordKeys.get(this.recordCacheKey(table, id)) || "" : "";
            return [id, recKey];
          })
        : null;
      const payload = JSON.stringify({ timestamp, data: rows, keys });
      if (payload.length > PERSISTENT_CACHE_MAX_CHARS) return;
      storage.setItem(storageKey, payload);
    } catch {
      // Ignore quota exceeded or storage restrictions; memory cache still works.
    }
  }

  // Reuse short-lived read snapshots only; clock confirmations always use
  // requestServerRecord and are never routed through this cache.
  async cachedRows_(cacheKey, table, load, forceRefresh = false) {
    const cached = this.queryCache.get(cacheKey);
    const ttl = tableCacheTtl(table);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < ttl) {
      return clone(cached.data);
    }
    if (!forceRefresh) {
      const persisted = this.readPersistentCache_(cacheKey, table, ttl);
      if (persisted) {
        this.queryCache.set(cacheKey, persisted);
        return clone(persisted.data);
      }
    }
    if (this.pendingQueries.has(cacheKey)) return clone(await this.pendingQueries.get(cacheKey));
    const generation = this.cacheGeneration;
    const request = load();
    this.pendingQueries.set(cacheKey, request);
    try {
      const rows = await request;
      if (generation === this.cacheGeneration) {
        const now = Date.now();
        this.queryCache.set(cacheKey, { timestamp: now, data: clone(rows) });
        this.writePersistentCache_(cacheKey, table, rows, now);
      }
      return clone(rows);
    } finally {
      if (this.pendingQueries.get(cacheKey) === request) this.pendingQueries.delete(cacheKey);
    }
  }

  async fetchScopedRows_(table, profile) {
    const tableRef = this.appRef(`tables/${table}`);
    if (table === "Configuracoes" && !isAdminProfile(profile)) {
      const keys = [...DEFAULT_CONFIG.map((item) => item.Chave), "WhatsAppAutomations", "AutomacoesHouseAI", "takeat_credit_mappings"];
      const snapshots = await Promise.all(keys.map((key) => get(this.appRef(`tables/Configuracoes/${pathKey(key)}`))));
      return snapshots.filter((snapshot) => snapshot.exists()).map((snapshot) => clone(snapshot.val()));
    }
    if (table === "Denuncias" && !isAdminProfile(profile)) {
      if (!isStoreReaderProfile(profile) || !profile.LojaID) return [];
      const snapshots = await Promise.all([profile.LojaID, "GERAL"].map((scope) =>
        get(query(tableRef, orderByChild("LojaID"), equalTo(scope))),
      ));
      const unique = new Map();
      snapshots.flatMap((snapshot) => this.recordsFromSnapshot(table, snapshot))
        .forEach((row) => unique.set(row.DenunciaID, row));
      return [...unique.values()];
    }
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

    if (table === "Tarefas") {
      if (storeId || employeeId) {
        const scopedQueries = [];
        if (storeId) {
          scopedQueries.push(
            get(query(tableRef, orderByChild("LojaID"), equalTo(storeId))).catch((e) => {
              if (isPermissionDenied(e)) return null;
              throw e;
            }),
          );
        }
        if (employeeId) {
          scopedQueries.push(
            get(query(tableRef, orderByChild("FuncionarioID"), equalTo(employeeId))).catch((e) => {
              if (isPermissionDenied(e)) return null;
              throw e;
            }),
          );
        }
        const snapshots = (await Promise.all(scopedQueries)).filter(Boolean);
        const unique = new Map();
        snapshots
          .flatMap((snapshot) => this.recordsFromSnapshot(table, snapshot))
          .forEach((record) => {
            unique.set(String(record?.TarefaID || uuid()), record);
          });
        return [...unique.values()];
      }
      try {
        return this.recordsFromSnapshot(table, await get(tableRef));
      } catch (error) {
        if (isPermissionDenied(error)) return [];
        throw error;
      }
    }

    if (table === "TarefasTemplates") {
      try {
        return this.recordsFromSnapshot(table, await get(tableRef));
      } catch (error) {
        if (storeId) {
          try {
            return this.recordsFromSnapshot(
              table,
              await get(query(tableRef, orderByChild("LojaID"), equalTo(storeId))),
            );
          } catch (e) {
            if (isPermissionDenied(e)) return [];
            throw e;
          }
        }
        if (isPermissionDenied(error)) return [];
        throw error;
      }
    }

    if (table === "Documentos" || table === "DocumentosAssinaturas") {
      if (isStoreReaderProfile(profile)) {
        if (storeId || employeeId) {
          const idField = ID_FIELDS[table];
          const scopedQueries = [];
          if (storeId) {
            scopedQueries.push(
              get(query(tableRef, orderByChild("LojaID"), equalTo(storeId))).catch((e) => {
                if (isPermissionDenied(e)) return null;
                throw e;
              }),
            );
          }
          if (employeeId) {
            scopedQueries.push(
              get(query(tableRef, orderByChild("FuncionarioID"), equalTo(employeeId))).catch((e) => {
                if (isPermissionDenied(e)) return null;
                throw e;
              }),
            );
          }
          const snapshots = (await Promise.all(scopedQueries)).filter(Boolean);
          const unique = new Map();
          snapshots
            .flatMap((snapshot) => this.recordsFromSnapshot(table, snapshot))
            .forEach((record) => {
              unique.set(String(record?.[idField] || record?.DocID || uuid()), record);
            });
          return [...unique.values()];
        }
        try {
          return this.recordsFromSnapshot(table, await get(tableRef));
        } catch (error) {
          if (isPermissionDenied(error)) return [];
          throw error;
        }
      }
    }

    const storeField = STORE_SCOPED_FIELDS[table];
    if (isStoreReaderProfile(profile) && storeId && storeField) {
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
    return this.scopedRows(table, profile, Boolean(options.forceRefresh));
  }

  async resolveEmployeeEntry(reference = {}, options = {}) {
    const profile = options.profile || (await this.requireProfile());
    const tableRef = this.appRef("tables/Funcionarios");
    const profileStoreId = String(profile.LojaID || "");
    const profileEmployeeId = String(profile.FuncionarioID || "");
    let snapshot = null;

    if (isAdminProfile(profile)) {
      snapshot = await get(tableRef);
    } else if (isStoreReaderProfile(profile) && profileStoreId) {
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

  async fetchPeriodIndexesReady_() {
    const snapshot = await get(this.appRef(`meta/migrations/${PERIOD_INDEX_MIGRATION}`));
    return snapshot.val() === true;
  }

  async periodIndexesReady() {
    const uid = this.auth?.currentUser?.uid || "";
    if (this.periodIndexReadyState?.uid === uid) return true;
    if (this.periodIndexReadyCheck?.uid === uid) return this.periodIndexReadyCheck.promise;
    const entry = { uid, promise: null };
    this.periodIndexReadyCheck = entry;
    entry.promise = this.fetchPeriodIndexesReady_().then((ready) => {
      // A completed migration stays complete for this account/session. Never
      // retain a false result: a manager may retry after an admin migrates.
      if (ready && this.periodIndexReadyCheck === entry && (this.auth?.currentUser?.uid || "") === uid) {
        this.periodIndexReadyState = { uid };
      }
      return ready;
    }).finally(() => {
      if (this.periodIndexReadyCheck === entry) this.periodIndexReadyCheck = null;
    });
    return entry.promise;
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
      this.periodIndexReadyState = { uid: this.auth?.currentUser?.uid || "" };
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

    const cacheKey = `${table}:period:${this.auth?.currentUser?.uid || ""}:${roleName(profile)}:${String(profile?.LojaID || "")}:${String(profile?.FuncionarioID || "")}:${normalizedPeriod}`;
    return this.cachedRows_(cacheKey, table, () => this.fetchPeriodRows_(table, normalizedPeriod, profile), Boolean(options.forceRefresh));
  }

  async fetchPeriodRows_(table, normalizedPeriod, profile) {
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
        this.listPeriod(table, period, { profile, forceRefresh: options.forceRefresh }),
      ),
    );
    const idField = ID_FIELDS[table];
    const unique = new Map();
    groups.flat().forEach((record) => {
      unique.set(String(record?.[idField] || uuid()), record);
    });
    return [...unique.values()];
  }

  async get(table, id) {
    return this.getById(table, id);
  }

  async audit(entry = {}) {
    return this.create("Auditoria", {
      AuditoriaID: uuid(),
      DataHora: nowIso(),
      ...entry,
    }).catch(() => {});
  }

  async getById(table, id) {
    if (!id) return null;
    const normalizedId = String(id);
    const idField = ID_FIELDS[table];
    if (idField) {
      for (const [key, cache] of this.queryCache.entries()) {
        if (key.startsWith(`${table}:`) && Array.isArray(cache.data)) {
          const match = cache.data.find(
            (item) => String(item?.[idField] || "") === normalizedId,
          );
          if (match) return clone(match);
        }
      }
    }
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

  // Clock confirmation must come from the server, never from an optimistic SDK
  // snapshot. Conditional REST writes also keep admins from overwriting a punch
  // when two retries race. Firebase documents this as its REST transaction API:
  // https://firebase.google.com/docs/database/rest/save-data#section-conditional-requests
  async requestServerRecord(table, id, options = {}) {
    if (!ID_FIELDS[table] || !id) throw new Error("Registro sem identificação válida.");
    const user = this.auth?.currentUser;
    if (!user?.uid) throw new Error("Sua sessão expirou. Entre novamente.");
    const controller = new AbortController();
    let rejectDeadline;
    const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
    const timeout = setTimeout(() => {
      controller.abort();
      const failure = new Error("O servidor do ponto demorou para confirmar. A tentativa permanece neste aparelho para recuperação.");
      failure.code = "database/confirmation-timeout";
      rejectDeadline(failure);
    }, 15000);
    try {
      const operation = async () => {
        const token = await user.getIdToken();
        if (controller.signal.aborted) { const failure = new Error("O servidor do ponto demorou para confirmar. A tentativa permanece neste aparelho para recuperação."); failure.code = "database/confirmation-timeout"; throw failure; }
        if (this.auth?.currentUser?.uid !== user.uid) throw new Error("A conta conectada mudou. Entre novamente.");
        const storageKey = pathKey(id);
        const root = this.root.split("/").map(encodeURIComponent).join("/");
        const url = new URL(`${String(this.config.databaseURL || "").replace(/\/+$/, "")}/${root}/tables/${encodeURIComponent(table)}/${encodeURIComponent(storageKey)}.json`);
        url.searchParams.set("auth", token);
        const response = await fetch(url.href, {
          method: options.method || "GET", cache: "no-store", credentials: "omit",
          headers: { "X-Firebase-ETag": "true", ...options.headers },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          signal: controller.signal,
        });
        let data;
        try { data = await response.json(); } catch (_) {
          const failure = new Error("O servidor do ponto não retornou uma confirmação válida.");
          failure.code = "database/invalid-confirmation";
          throw failure;
        }
        if (!response.ok && response.status !== 412) {
          const failure = new Error([401, 403].includes(response.status)
            ? "O servidor recusou o acesso ao ponto. Entre novamente ou solicite a conferência do seu perfil."
            : "Não foi possível confirmar o ponto no servidor. A tentativa permanece neste aparelho.");
          failure.code = [401, 403].includes(response.status) ? "database/permission-denied" : "database/server-unavailable";
          throw failure;
        }
        if (this.auth?.currentUser?.uid !== user.uid) throw new Error("A conta conectada mudou. Entre novamente.");
        return { data, etag: response.headers.get("etag"), status: response.status };
      };
      return await Promise.race([operation(), deadline]);
    } catch (error) {
      if (error?.code || /conta conectada mudou/.test(error?.message || "")) throw error;
      const failure = new Error("Sem confirmação do servidor do ponto. Verifique a conexão; a tentativa permanece neste aparelho.");
      failure.code = "database/server-unavailable";
      throw failure;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getByIdFromServer(table, id) {
    const { data } = await this.requestServerRecord(table, id);
    return data === null ? null : clone(data);
  }

  async createClockRecord(record, options = {}) {
    const id = String(record?.RegistroPontoID || "");
    if (!id || record?.RequestID !== id) throw new Error("Identificação da tentativa de ponto inválida.");
    const normalized = cleanObject({ ...record, ...periodFieldsFor("RegistrosPonto", record) });
    const matches = (current) => current?.RequestID === id && current?.RegistroPontoID === id &&
      String(current.FuncionarioID) === String(record.FuncionarioID) && String(current.LojaID) === String(record.LojaID);
    if (options.ownerUid && options.ownerUid !== this.auth?.currentUser?.uid) throw new Error("A conta conectada mudou. Entre novamente.");
    const canReusePreflight = options.ownerUid === this.auth?.currentUser?.uid && typeof options.expectedAbsentEtag === "string" && options.expectedAbsentEtag.length > 0;
    const existing = canReusePreflight ? {data:null,etag:options.expectedAbsentEtag} : await this.requestServerRecord("RegistrosPonto", id);
    if (existing.data !== null) {
      if (!matches(existing.data)) throw new Error("Este identificador de ponto já foi utilizado por outro registro.");
      return clone(existing.data);
    }
    if (!existing.etag) throw new Error("O servidor não confirmou a versão do registro. Tente novamente.");
    const result = await this.requestServerRecord("RegistrosPonto", id, {
      method: "PUT", headers: { "Content-Type": "application/json", "If-Match": existing.etag }, body: normalized,
    });
    if (!matches(result.data)) throw new Error("O servidor não confirmou esta tentativa de ponto. Tente novamente.");
    this.recordKeys.set(this.recordCacheKey("RegistrosPonto", id), pathKey(id));
    this.invalidateTableCache("RegistrosPonto");
    return clone(result.data);
  }

  async listWhere(table, field, value) {
    const snapshot = await get(query(this.appRef(`tables/${table}`), orderByChild(field), equalTo(value)));
    return this.recordsFromSnapshot(table, snapshot);
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
    this.invalidateTableCache(table);
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
    this.invalidateTableCache(table);
    return clone(normalized);
  }

  async update(table, id, changes) {
    return this.patch(table, id, changes);
  }

  async patch(table, id, changes) {
    const current = await this.getById(table, id);
    if (!current) throw new Error("Registro não encontrado.");
    const delta = cleanObject({ ...changes, ...periodFieldsFor(table, { ...current, ...changes }) });
    delete delta[ID_FIELDS[table]];
    const storageKey = await this.resolveStorageKey(table, id);
    await update(this.appRef(`tables/${table}/${storageKey}`), delta);
    this.invalidateTableCache(table);
    return clone({ ...current, ...delta });
  }

  async patchMany(items = []) {
    const changes = {};
    const output = [];
    const modifiedTables = new Set();
    for (const item of items) {
      const {
        table,
        id,
        changes: recordChanges = {},
        createIfMissing = false,
        record = {},
      } = item;
      modifiedTables.add(table);
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
    modifiedTables.forEach((t) => this.invalidateTableCache(t));
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
    const runBalanceTransaction = (storageKey, fallbackRecord = null) =>
      runTransaction(
        this.appRef(`tables/Funcionarios/${storageKey}`),
        (current) => {
          const employee =
            current && typeof current === "object" ? current : fallbackRecord;
          if (!employee || typeof employee !== "object") return;
          const entries = {
            ...(employee.SaldoFolgasLancamentos || {}),
          };
          const previousDelta = Number(entries[key]?.Delta || 0);
          const normalizedDesired =
            Math.round(Number(desiredDelta || 0) * 100) / 100;
          const adjustment =
            Math.round((normalizedDesired - previousDelta) * 100) / 100;
          if (!adjustment) return;
          const balanceBefore = Number(employee.SaldoFolgas || 0);
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
            ...employee,
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
      const employeeEntry = await this.resolveEmployeeEntry({
        FuncionarioID: id,
      });
      if (!employeeEntry) throw new Error("Funcionário não encontrado.");
      storageKey = employeeEntry.storageKey;
      const recoveredSnapshot = await get(
        this.appRef(`tables/Funcionarios/${storageKey}`),
      );
      console.info(
        "[monthly-credit-storage] " +
          JSON.stringify({
            employeeId: id,
            storageKey,
            recovered: recoveredSnapshot.exists(),
            recoveredEmployeeId: String(
              recoveredSnapshot.val()?.FuncionarioID || "",
            ),
          }),
      );
      outcome = null;
      transaction = await runBalanceTransaction(
        storageKey,
        employeeEntry.record,
      );
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
    this.invalidateTableCache("Funcionarios");
    return outcome;
  }

  async delete(table, id) {
    const storageKey = await this.resolveStorageKey(table, id);
    await remove(this.appRef(`tables/${table}/${storageKey}`));
    this.recordKeys.delete(this.recordCacheKey(table, id));
    this.invalidateTableCache(table);
  }

  async remove(table, id) {
    return this.delete(table, id);
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
