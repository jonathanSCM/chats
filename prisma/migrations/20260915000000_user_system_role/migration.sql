-- Cuenta técnica (bot de subtítulos autenticando por meetExtensionToken,
-- ver src/server/services/meeting-link.ts y api/extension/transcript) --
-- necesita existir como User por la auth, pero no debe contar como
-- vendedor real ni aparecer en dropdowns de asignación.
ALTER TYPE "UserRole" ADD VALUE 'SYSTEM';
