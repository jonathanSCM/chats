-- Archivar (ocultar sin borrar) y orden manual arrastrable en Seguimiento.
ALTER TABLE "opportunities" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "opportunities" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Da un orden inicial estable (por fecha de registro) a lo que ya existe,
-- para que no arranquen todos en 0 y el drag-and-drop tenga algo coherente
-- de dónde partir.
UPDATE "opportunities" o
SET "sortOrder" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt" ASC) AS rn
  FROM "opportunities"
) sub
WHERE o.id = sub.id;
