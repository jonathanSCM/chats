-- Calidad del lead (0-100 con desglose de 7 criterios) es un indicador
-- distinto de `probability` (probabilidad de cierre). El asesor IA lee la
-- guía de calificación de la Base de Conocimiento (categoría QUALIFICATION)
-- para calcularlo.
ALTER TABLE "opportunities" ADD COLUMN "leadScoreBreakdown" JSONB;
ALTER TABLE "opportunities" ADD COLUMN "leadScoreCoverage" INTEGER;
ALTER TABLE "opportunities" ADD COLUMN "leadScoreUpdatedAt" TIMESTAMP(3);
ALTER TABLE "opportunities" ADD COLUMN "aiPainPoint" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "aiMissingInfo" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "aiNextQuestion" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "aiAlerts" TEXT;
