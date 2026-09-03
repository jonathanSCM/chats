-- Detalle del anuncio real (headline, texto, imagen/video, source_id) que
-- Meta manda junto con "referral" -- antes se descartaba, solo quedaba el
-- booleano `adReferral`.
ALTER TABLE "conversations" ADD COLUMN "adReferralData" JSONB;
