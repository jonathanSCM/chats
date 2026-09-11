-- El negocio no compartió su historial (webhook de error 2593109 de Meta) --
-- antes se descartaba en silencio y el estado quedaba pegado en PENDING.
ALTER TYPE "HistorySyncStatus" ADD VALUE 'DECLINED';
