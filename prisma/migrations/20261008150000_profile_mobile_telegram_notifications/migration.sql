-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'PROFILE_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PHONE_VERIFICATION_REQUESTED';
ALTER TYPE "AuthEventType" ADD VALUE 'PHONE_VERIFICATION_FAILED';
ALTER TYPE "AuthEventType" ADD VALUE 'PHONE_VERIFIED';
ALTER TYPE "AuthEventType" ADD VALUE 'PHONE_CHANGED';
ALTER TYPE "AuthEventType" ADD VALUE 'PHONE_REMOVED';
ALTER TYPE "AuthEventType" ADD VALUE 'TELEGRAM_LINK_STARTED';
ALTER TYPE "AuthEventType" ADD VALUE 'TELEGRAM_LINKED';
ALTER TYPE "AuthEventType" ADD VALUE 'TELEGRAM_LINK_CONFLICT';
ALTER TYPE "AuthEventType" ADD VALUE 'TELEGRAM_UNLINKED';
ALTER TYPE "AuthEventType" ADD VALUE 'NOTIFICATION_PREFERENCES_UPDATED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "display_name" VARCHAR(50),
ADD COLUMN     "time_zone" VARCHAR(64);

-- CreateTable
CREATE TABLE "user_phones" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone_number" VARCHAR(16) NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_verification_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone_number" VARCHAR(16) NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "telegram_user_id" VARCHAR(20) NOT NULL,
    "chat_id" VARCHAR(20) NOT NULL,
    "connected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email_account" BOOLEAN NOT NULL DEFAULT true,
    "email_trading" BOOLEAN NOT NULL DEFAULT true,
    "email_promotions" BOOLEAN NOT NULL DEFAULT false,
    "telegram_security" BOOLEAN NOT NULL DEFAULT true,
    "telegram_account" BOOLEAN NOT NULL DEFAULT true,
    "telegram_trading" BOOLEAN NOT NULL DEFAULT true,
    "telegram_promotions" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_phones_user_id_key" ON "user_phones"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_verification_challenges_user_id_key" ON "phone_verification_challenges"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connections_user_id_key" ON "telegram_connections"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connections_telegram_user_id_key" ON "telegram_connections"("telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_tokens_token_hash_key" ON "telegram_link_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "telegram_link_tokens_user_id_idx" ON "telegram_link_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- AddForeignKey
ALTER TABLE "user_phones" ADD CONSTRAINT "user_phones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_verification_challenges" ADD CONSTRAINT "phone_verification_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_connections" ADD CONSTRAINT "telegram_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

