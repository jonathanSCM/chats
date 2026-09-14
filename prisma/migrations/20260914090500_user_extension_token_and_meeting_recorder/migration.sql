-- Token personal por vendedor para la extensión de Meet (reemplaza el
-- token único por organización que había antes -- ese campo se deja en
-- Organization sin usar, no se borra, por si hace falta revisar el
-- histórico).
ALTER TABLE "users" ADD COLUMN "meetExtensionToken" TEXT;
CREATE UNIQUE INDEX "users_meetExtensionToken_key" ON "users"("meetExtensionToken");

-- Quién grabó cada reunión con la extensión.
ALTER TABLE "meetings" ADD COLUMN "recordedById" TEXT;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
