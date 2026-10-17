-- Interruptor por organizacion del Jefe de Operaciones (lo maneja el superadmin).
ALTER TABLE "organizations" ADD COLUMN "jefeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Las organizaciones que ya usaban la API (tienen claves o webhook) siguen funcionando.
UPDATE "organizations" SET "jefeEnabled" = true
 WHERE "id" IN (SELECT "organizationId" FROM "integration_keys" UNION SELECT "organizationId" FROM "integration_webhooks");
