-- El precio del plan ya no es solo en soles: se elige la moneda. Los planes existentes quedan en soles (PEN).
ALTER TABLE "plans" RENAME COLUMN "priceSoles" TO "price";
ALTER TABLE "plans" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'PEN';
