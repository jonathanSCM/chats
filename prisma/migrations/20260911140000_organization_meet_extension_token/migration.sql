-- Token de la extensión de Chrome de subtítulos (ver api/extension/transcript).
ALTER TABLE "organizations" ADD COLUMN "meetExtensionToken" TEXT;
CREATE UNIQUE INDEX "organizations_meetExtensionToken_key" ON "organizations"("meetExtensionToken");
