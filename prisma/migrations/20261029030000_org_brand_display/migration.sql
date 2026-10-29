-- Cómo se muestra la marca: qué se ve en el menú y la forma del logo. Aditivo, con los valores de siempre por defecto.
ALTER TABLE "organizations" ADD COLUMN "brandDisplay" TEXT NOT NULL DEFAULT 'both';
ALTER TABLE "organizations" ADD COLUMN "brandLogoShape" TEXT NOT NULL DEFAULT 'square';
