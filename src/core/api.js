import { createAdvancedHandlers } from "./api-advanced.js";
import { createArenaHandlers } from "./api-arena.js";
import { createBaseHandlers } from "./api-base.js";
import { createClockHandlers } from "./api-clock.js";
import { runtime } from "./runtime.js";

export function createApi(getArenaBundle) {
  const handlers = {
    ...createBaseHandlers(getArenaBundle),
    ...createClockHandlers(),
    ...createAdvancedHandlers(),
    ...createArenaHandlers(),
  };

  return {
    handlers,

    async invoke(name, args = []) {
      await runtime.ready();
      const handler = handlers[name];
      if (!handler) {
        throw new Error(
          `A função “${name}” ainda não foi registrada nesta versão Firebase.`,
        );
      }
      try {
        return await handler(Array.isArray(args) ? args : []);
      } catch (error) {
        const code = String(error?.code || "");
        if (code.includes("permission-denied")) {
          throw new Error(
            "O Firebase bloqueou esta operação. Publique database.rules.json e confirme o perfil do usuário.",
          );
        }
        if (
          code.includes("auth/invalid-credential") ||
          code.includes("auth/wrong-password") ||
          code.includes("auth/user-not-found")
        ) {
          throw new Error("E-mail ou senha inválidos.");
        }
        if (code.includes("auth/email-already-in-use")) {
          throw new Error("Este e-mail já possui um acesso.");
        }
        if (code.includes("auth/weak-password")) {
          throw new Error(
            "A senha é fraca. Use pelo menos 10 caracteres com letras, números e símbolo.",
          );
        }
        if (code.includes("auth/too-many-requests")) {
          throw new Error(
            "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
          );
        }
        if (code.includes("auth/requires-recent-login")) {
          throw new Error(
            "Por segurança, saia e entre novamente antes de alterar e-mail ou senha.",
          );
        }
        throw error;
      }
    },
  };
}
