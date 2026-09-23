-- Pipeline comercial configurable por organización: reemplaza el enum fijo
-- "OpportunityStage" (9 valores iguales para todo el mundo) por una tabla
-- "pipeline_stages" propia de cada organización. Esta migración solo
-- reproduce, por organización, las 9 etapas que hoy son globales (mismo
-- orden, label, color y criterio que src/lib/pipeline.ts) — no cambia nada
-- para el usuario final. Editar/reordenar/agregar etapas queda para una
-- fase separada (backend/UI todavía no existen para eso).
--
-- Sigue el mismo patrón que 20260901120000_pipeline_comercial/migration.sql
-- para el swap de un enum con backfill de datos, adaptado porque ahora hay
-- que resolver el nuevo id por organización (no un mapeo 1:1 de valores).

-- 1) Tipo para las 3 etapas con lógica propia (ganado/perdido/nutrir).
CREATE TYPE "PipelineStageRole" AS ENUM ('WON', 'LOST', 'NURTURE');

-- 2) Tabla de etapas, una fila por etapa y organización.
CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "criteria" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL,
    "role" "PipelineStageRole",
    "isDefaultEntry" BOOLEAN NOT NULL DEFAULT false,
    "requiresProposalFields" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pipeline_stages_organizationId_order_key" ON "pipeline_stages"("organizationId", "order");

ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Siembra las 9 etapas de hoy para cada organización existente. El
-- "order" de esta tabla temporal es también la llave que usa el backfill de
-- abajo para mapear cada oportunidad a la fila que le corresponde en SU
-- organización (los ids son nuevos y distintos por organización).
INSERT INTO "pipeline_stages" ("id", "organizationId", "label", "color", "criteria", "order", "role", "isDefaultEntry", "requiresProposalFields")
SELECT
    gen_random_uuid()::text,
    o."id",
    seed."label",
    seed."color",
    seed."criteria",
    seed."order",
    seed."role"::"PipelineStageRole",
    seed."isDefaultEntry",
    seed."requiresProposalFields"
FROM "organizations" o
CROSS JOIN (
    VALUES
        (1, 'POR_CALIFICAR', 'POR CALIFICAR', '#64748b', 'Lead recién llegado; filtro inicial por WhatsApp o llamada.', NULL, true, false),
        (2, 'ENTREVISTA', 'ENTREVISTA', '#0891b2', 'Reunión de levantamiento para entender empresa, proceso, problema e impacto.', NULL, false, false),
        (3, 'DIAGNOSTICO', 'DIAGNÓSTICO', '#ca8a04', 'Trabajo interno de ProShop para analizar el caso y definir recomendación.', NULL, false, false),
        (4, 'PRESENTAR_SOLUCION', 'PRESENTAR SOLUCIÓN', '#ea580c', 'Reunión con cliente/decisor para mostrar diagnóstico y solución propuesta.', NULL, false, false),
        (5, 'PROPUESTA', 'PROPUESTA', '#2563eb', 'Preparar/presentar alcance, tiempos, inversión y condiciones.', NULL, false, true),
        (6, 'DECISION', 'DECISIÓN', '#db2777', 'Seguimiento, objeciones, cambios, negociación y decisión final.', NULL, false, false),
        (7, 'GANADO', 'GANADO', '#059669', 'Aceptación, firma, pago o inicio del trabajo.', 'WON', false, false),
        (8, 'EN_PAUSA_NUTRIR', 'EN PAUSA / NUTRIR', '#78716c', 'Sin actividad por ahora; se retoma más adelante.', 'NURTURE', false, false),
        (9, 'PERDIDO', 'PERDIDO', '#dc2626', 'No se concretó. Registrar el motivo para aprender de ello.', 'LOST', false, false)
) AS seed("order", "code", "label", "color", "criteria", "role", "isDefaultEntry", "requiresProposalFields");

-- 4) Nueva columna en opportunities, todavía nullable para poder backfillear.
ALTER TABLE "opportunities" ADD COLUMN "stageId" TEXT;

-- Backfill: cada oportunidad apunta a la fila de SU organización que
-- corresponde al mismo "order" que tenía su etapa vieja (mismo mapeo 1:1
-- que arriba, pero por posición en vez de por id porque los ids son
-- distintos por organización).
UPDATE "opportunities" o
SET "stageId" = ps."id"
FROM "pipeline_stages" ps
WHERE ps."organizationId" = o."organizationId"
  AND ps."order" = (
    CASE o."stage"::text
      WHEN 'POR_CALIFICAR' THEN 1
      WHEN 'ENTREVISTA' THEN 2
      WHEN 'DIAGNOSTICO' THEN 3
      WHEN 'PRESENTAR_SOLUCION' THEN 4
      WHEN 'PROPUESTA' THEN 5
      WHEN 'DECISION' THEN 6
      WHEN 'GANADO' THEN 7
      WHEN 'EN_PAUSA_NUTRIR' THEN 8
      WHEN 'PERDIDO' THEN 9
    END
  );

-- 5) Ya no debería quedar ninguna oportunidad sin stageId (toda organización
-- tiene sus 9 etapas recién sembradas), así que se puede exigir NOT NULL,
-- agregar la FK y el índice que reemplaza al viejo opportunities_organizationId_stage_idx.
ALTER TABLE "opportunities" ALTER COLUMN "stageId" SET NOT NULL;

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "opportunities_organizationId_stageId_idx" ON "opportunities"("organizationId", "stageId");

-- 6) Fuera el enum viejo: la columna "stage" y el índice que la usaba se
-- borran solos al dropear la columna; el tipo se dropea aparte.
ALTER TABLE "opportunities" DROP COLUMN "stage";

DROP TYPE "OpportunityStage";
