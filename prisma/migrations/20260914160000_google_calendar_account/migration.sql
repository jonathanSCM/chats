-- Cuenta de Google Calendar personal por usuario (conectada desde "Mi
-- Perfil"), para reemplazar por-usuario al calendario compartido del bot
-- (GOOGLE_BOT_REFRESH_TOKEN) y habilitar sync en las dos direcciones.
CREATE TABLE "google_calendar_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "watchChannelId" TEXT,
    "watchResourceId" TEXT,
    "watchToken" TEXT,
    "watchExpiresAt" TIMESTAMP(3),
    "syncToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_calendar_accounts_userId_key" ON "google_calendar_accounts"("userId");

ALTER TABLE "google_calendar_accounts" ADD CONSTRAINT "google_calendar_accounts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A qué usuario le pertenece un evento creado en su calendario personal
-- (null = comportamiento de siempre, calendario compartido de la org).
ALTER TABLE "meetings" ADD COLUMN "googleCalendarOwnerId" TEXT;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_googleCalendarOwnerId_fkey"
  FOREIGN KEY ("googleCalendarOwnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
