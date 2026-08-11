-- Restriccion real de acceso por cuenta de WhatsApp: que vendedores (MEMBER)
-- pueden ver/atender cada bot. Sin fila aca, un MEMBER no ve esos chats.
CREATE TABLE "bot_members" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_members_botId_userId_key" ON "bot_members"("botId", "userId");
CREATE INDEX "bot_members_userId_idx" ON "bot_members"("userId");

ALTER TABLE "bot_members" ADD CONSTRAINT "bot_members_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_members" ADD CONSTRAINT "bot_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: antes de esta migracion no existia restriccion por cuenta, todo
-- MEMBER veia todos los bots de su organizacion. Sin esto, al desplegar,
-- cualquier vendedor que ya estaba trabajando se queda sin ver nada de un
-- momento a otro. Se le da acceso a todas las cuentas que ya existen hoy en
-- su organizacion; las cuentas nuevas que se agreguen despues sí requieren
-- asignacion explicita del dueño.
INSERT INTO "bot_members" ("id", "botId", "userId")
SELECT gen_random_uuid()::text, b."id", u."id"
FROM "bots" b
JOIN "users" u ON u."organizationId" = b."organizationId"
WHERE u."role" = 'MEMBER'
ON CONFLICT DO NOTHING;
