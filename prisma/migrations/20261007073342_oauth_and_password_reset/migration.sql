-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'PASSWORD_RESET_REQUESTED';
ALTER TYPE "AuthEventType" ADD VALUE 'PASSWORD_RESET_COMPLETED';
ALTER TYPE "AuthEventType" ADD VALUE 'PASSWORD_RESET_FAILED';
ALTER TYPE "AuthEventType" ADD VALUE 'GOOGLE_LOGIN_STARTED';
ALTER TYPE "AuthEventType" ADD VALUE 'GOOGLE_LOGIN_SUCCESS';
ALTER TYPE "AuthEventType" ADD VALUE 'GOOGLE_LOGIN_FAILED';
ALTER TYPE "AuthEventType" ADD VALUE 'GOOGLE_LINK_STARTED';
ALTER TYPE "AuthEventType" ADD VALUE 'GOOGLE_LINK_SUCCESS';
ALTER TYPE "AuthEventType" ADD VALUE 'GOOGLE_LINK_FAILED';
ALTER TYPE "AuthEventType" ADD VALUE 'GOOGLE_LINK_CONFLICT';

-- CreateTable
CREATE TABLE "o_auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "email_at_link_time" VARCHAR(254),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "o_auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "o_auth_identities_provider_provider_subject_key" ON "o_auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "o_auth_identities_user_id_provider_key" ON "o_auth_identities"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "o_auth_identities" ADD CONSTRAINT "o_auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
