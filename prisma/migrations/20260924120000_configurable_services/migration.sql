-- "Servicio de interés" pasa de ser una lista fija (SERVICES en
-- lib/pipeline.ts) a una tabla editable por organización -- mismo patrón
-- que pipeline_stages, pero sin columnas de rol/lógica: es solo texto
-- libre para un <select>. Opportunity.serviceInterest ya era un String?
-- (nunca un enum), así que no hace falta tocar esa columna ni migrar
-- ningún dato existente de Opportunity.
CREATE TABLE "services" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "services_organizationId_order_key" ON "services"("organizationId", "order");

ALTER TABLE "services"
  ADD CONSTRAINT "services_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Siembra las 4 opciones actuales para cada organización existente, en el
-- mismo orden en que ya se mostraban.
INSERT INTO "services" ("id", "organizationId", "label", "order")
SELECT gen_random_uuid()::text, o."id", v.label, v.ord
FROM organizations o
CROSS JOIN (VALUES ('AGENTES IA', 0), ('SISTEMAS', 1), ('APP', 2), ('TAXI', 3)) AS v(label, ord);
