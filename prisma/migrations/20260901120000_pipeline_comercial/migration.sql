-- Evolución del pipeline de Seguimiento a "Seguimiento comercial": nuevas
-- etapas alineadas a la metodología (calificar -> entrevista -> diagnóstico
-- -> presentar solución -> propuesta -> decisión -> ganado), con pausa/nutrir
-- y perdido como estados fuera del flujo principal.
--
-- Postgres no permite renombrar/borrar valores de un enum en el lugar: se
-- crea el tipo nuevo, se migran los datos existentes con el mapeo acordado,
-- y se reemplaza el tipo viejo.
CREATE TYPE "OpportunityStage_new" AS ENUM (
  'POR_CALIFICAR', 'ENTREVISTA', 'DIAGNOSTICO', 'PRESENTAR_SOLUCION',
  'PROPUESTA', 'DECISION', 'GANADO', 'EN_PAUSA_NUTRIR', 'PERDIDO'
);

ALTER TABLE "opportunities" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "opportunities"
  ALTER COLUMN "stage" TYPE "OpportunityStage_new"
  USING (
    CASE "stage"::text
      WHEN 'LLAMAR' THEN 'POR_CALIFICAR'
      WHEN 'ENVIAR_COTI' THEN 'ENTREVISTA'
      WHEN 'COTI_ENVIADA' THEN 'DIAGNOSTICO'
      WHEN 'REUNION' THEN 'PRESENTAR_SOLUCION'
      WHEN 'NEGOCIACION' THEN 'DECISION'
      WHEN 'CERRADO' THEN 'GANADO'
      WHEN 'PERDIDO' THEN 'PERDIDO'
    END
  )::"OpportunityStage_new";

DROP TYPE "OpportunityStage";
ALTER TYPE "OpportunityStage_new" RENAME TO "OpportunityStage";
ALTER TABLE "opportunities" ALTER COLUMN "stage" SET DEFAULT 'POR_CALIFICAR';
