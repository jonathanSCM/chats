CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "whatsappAppId" TEXT,
    "whatsappAppSecret" TEXT,
    "whatsappConfigId" TEXT,
    "whatsappVerifyToken" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
