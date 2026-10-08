-- CreateEnum
CREATE TYPE "TwoFactorMethod" AS ENUM ('TOTP');

-- CreateEnum
CREATE TYPE "AuthChallengePurpose" AS ENUM ('LOGIN_2FA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'TWO_FACTOR_SETUP_STARTED';
ALTER TYPE "AuthEventType" ADD VALUE 'TWO_FACTOR_ENABLED';
ALTER TYPE "AuthEventType" ADD VALUE 'TWO_FACTOR_FAILED';
ALTER TYPE "AuthEventType" ADD VALUE 'TWO_FACTOR_DISABLED';
ALTER TYPE "AuthEventType" ADD VALUE 'RECOVERY_CODES_GENERATED';
ALTER TYPE "AuthEventType" ADD VALUE 'RECOVERY_CODE_USED';
ALTER TYPE "AuthEventType" ADD VALUE 'RECOVERY_CODES_REGENERATED';
ALTER TYPE "AuthEventType" ADD VALUE 'SESSIONS_REVOKED';
ALTER TYPE "AuthEventType" ADD VALUE 'PASSWORD_CHANGED';
ALTER TYPE "AuthEventType" ADD VALUE 'REAUTHENTICATION_SUCCESS';
ALTER TYPE "AuthEventType" ADD VALUE 'REAUTHENTICATION_FAILED';
ALTER TYPE "AuthEventType" ADD VALUE 'NEW_LOGIN';
ALTER TYPE "AuthEventType" ADD VALUE 'NEW_LOGIN_2FA_REQUIRED';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "authenticated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "user_two_factor" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "TwoFactorMethod" NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "enabled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_step" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_two_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "generation" UUID NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "AuthChallengePurpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "method" VARCHAR(32) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_two_factor_user_id_method_key" ON "user_two_factor"("user_id", "method");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_codes_code_hash_key" ON "recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenges_token_hash_key" ON "auth_challenges"("token_hash");

-- CreateIndex
CREATE INDEX "auth_challenges_user_id_idx" ON "auth_challenges"("user_id");

-- AddForeignKey
ALTER TABLE "user_two_factor" ADD CONSTRAINT "user_two_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
