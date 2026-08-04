-- Estados del embudo tal como los usa el equipo en su planilla, más las
-- columnas que hoy llena el asesor IA a mano.

CREATE TYPE "Priority" AS ENUM ('ALTA', 'MEDIA', 'BAJA');

-- Reemplazo del enum de etapas: se mapean las del manual a las reales.
CREATE TYPE "OpportunityStage_new" AS ENUM (
    'LLAMAR', 'ENVIAR_COTI', 'COTI_ENVIADA', 'REUNION', 'NEGOCIACION', 'CERRADO', 'PERDIDO'
);

ALTER TABLE "opportunities" ALTER COLUMN "stage" DROP DEFAULT;

ALTER TABLE "opportunities"
  ALTER COLUMN "stage" TYPE "OpportunityStage_new"
  USING (
    CASE "stage"::text
      WHEN 'NEW'               THEN 'LLAMAR'
      WHEN 'CONTACTED'         THEN 'LLAMAR'
      WHEN 'QUALIFYING'        THEN 'LLAMAR'
      WHEN 'MEETING_SCHEDULED' THEN 'REUNION'
      WHEN 'NEED_CONFIRMED'    THEN 'ENVIAR_COTI'
      WHEN 'PROPOSAL_DRAFT'    THEN 'ENVIAR_COTI'
      WHEN 'PROPOSAL_SENT'     THEN 'COTI_ENVIADA'
      WHEN 'NEGOTIATION'       THEN 'NEGOCIACION'
      WHEN 'WON'               THEN 'CERRADO'
      WHEN 'LOST'              THEN 'PERDIDO'
      WHEN 'ON_HOLD'           THEN 'LLAMAR'
      ELSE 'LLAMAR'
    END
  )::"OpportunityStage_new";

DROP TYPE "OpportunityStage";
ALTER TYPE "OpportunityStage_new" RENAME TO "OpportunityStage";
ALTER TABLE "opportunities" ALTER COLUMN "stage" SET DEFAULT 'LLAMAR';

ALTER TABLE "opportunities"
  ADD COLUMN "priority" "Priority",
  ADD COLUMN "lastUpdate" TEXT,
  ADD COLUMN "nextContactAt" TIMESTAMP(3),
  ADD COLUMN "aiRecommendation" TEXT,
  ADD COLUMN "aiSuggestedMessage" TEXT,
  ADD COLUMN "aiReviewedAt" TIMESTAMP(3);
