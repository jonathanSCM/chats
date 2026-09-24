-- Un usuario puede pertenecer a varias organizaciones -- User.organizationId
-- pasa a ser solo "cuál está activa ahora" (un puntero), no la única
-- posible. organization_memberships es la fuente de verdad de a cuáles
-- pertenece realmente cada usuario, con su rol por organización.
CREATE TABLE "organization_memberships" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_memberships_userId_organizationId_key" ON "organization_memberships"("userId", "organizationId");

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Siembra una membresía por cada usuario que hoy ya tiene una organización
-- activa, con el rol que ya tenía. Las cuentas SYSTEM (ej. el bot de
-- subtítulos) quedan afuera a propósito -- no son personas, no deben
-- aparecer en ningún selector de organización.
INSERT INTO organization_memberships ("id", "userId", "organizationId", "role", "createdAt")
SELECT gen_random_uuid()::text, "id", "organizationId", "role", now()
FROM users
WHERE "organizationId" IS NOT NULL AND "role" IN ('OWNER', 'MEMBER', 'SUPERADMIN');

-- Borrar una organización ya no debe borrar de punta a punta a los usuarios
-- que también pertenecen a otra -- solo se les vacía el puntero de "activa"
-- si apuntaba justo a la que se borró (la membresía en sí se borra en
-- cascada arriba).
ALTER TABLE "users" DROP CONSTRAINT "users_organizationId_fkey";
ALTER TABLE "users"
  ADD CONSTRAINT "users_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
