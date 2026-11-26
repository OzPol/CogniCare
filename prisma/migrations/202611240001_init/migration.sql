BEGIN;

CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "Role" AS ENUM ('PLAYER', 'CAREGIVER', 'HEALTH_WORKER');

CREATE TYPE "Game" AS ENUM ('MATCH', 'FOCUS', 'ROUTINE', 'PATTERN');

CREATE TYPE "ReminderKind" AS ENUM ('MEDICINE', 'WATER', 'ACTIVITY', 'APPOINTMENT');

CREATE TYPE "JobState" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PLAYER',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "assuredAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Authenticator" (
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "boundSession" TEXT,
    "enrolledAt" TIMESTAMPTZ(3),
    "pendingUntil" TIMESTAMPTZ(3) NOT NULL,
    "lastStep" BIGINT NOT NULL DEFAULT -1,

    CONSTRAINT "Authenticator_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "RecoveryCode" (
    "userId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("userId","digest")
);

CREATE TABLE "Exercise" (
    "game" "Game" NOT NULL,
    "order" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("game")
);

CREATE TABLE "PlayerProgress" (
    "playerId" TEXT NOT NULL,
    "game" "Game" NOT NULL,
    "skill" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "rounds" INTEGER NOT NULL DEFAULT 0,
    "lastRound" TIMESTAMPTZ(3),

    CONSTRAINT "PlayerProgress_pkey" PRIMARY KEY ("playerId","game")
);

CREATE TABLE "ActivityResult" (
    "id" UUID NOT NULL,
    "playerId" TEXT NOT NULL,
    "game" "Game" NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "playedAt" TIMESTAMPTZ(3) NOT NULL,
    "savedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyActivity" (
    "playerId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "game" "Game" NOT NULL,
    "rounds" INTEGER NOT NULL DEFAULT 0,
    "correct" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyActivity_pkey" PRIMARY KEY ("playerId","day","game")
);

CREATE TABLE "Reminder" (
    "id" UUID NOT NULL,
    "playerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "doneAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareInvitation" (
    "id" UUID NOT NULL,
    "patientId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CareInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareLink" (
    "patientId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CareLink_pkey" PRIMARY KEY ("patientId","caregiverId")
);

CREATE TABLE "IdempotencyReceipt" (
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" INTEGER,
    "response" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyReceipt_pkey" PRIMARY KEY ("actorId","operation","key")
);

CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" UUID NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PracticeJob" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease" UUID,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PracticeJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

CREATE INDEX "Session_userId_idx" ON "Session"("userId");

CREATE INDEX "Account_userId_idx" ON "Account"("userId");

CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

CREATE UNIQUE INDEX "Exercise_order_key" ON "Exercise"("order");

CREATE INDEX "ActivityResult_playerId_playedAt_id_idx" ON "ActivityResult"("playerId", "playedAt" DESC, "id" DESC);

CREATE INDEX "Reminder_playerId_dueAt_id_idx" ON "Reminder"("playerId", "dueAt", "id");

CREATE UNIQUE INDEX "CareInvitation_digest_key" ON "CareInvitation"("digest");

CREATE INDEX "CareInvitation_patientId_expiresAt_idx" ON "CareInvitation"("patientId", "expiresAt");

CREATE INDEX "CareLink_caregiverId_revokedAt_grantedAt_idx" ON "CareLink"("caregiverId", "revokedAt", "grantedAt");

CREATE INDEX "IdempotencyReceipt_createdAt_idx" ON "IdempotencyReceipt"("createdAt");

CREATE INDEX "AuditEvent_entityId_occurredAt_id_idx" ON "AuditEvent"("entityId", "occurredAt", "id");

CREATE INDEX "AuditEvent_actorId_occurredAt_id_idx" ON "AuditEvent"("actorId", "occurredAt", "id");

CREATE INDEX "PracticeJob_state_availableAt_id_idx" ON "PracticeJob"("state", "availableAt", "id");

CREATE INDEX "PracticeJob_ownerId_createdAt_idx" ON "PracticeJob"("ownerId", "createdAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Authenticator" ADD CONSTRAINT "Authenticator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Authenticator"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerProgress" ADD CONSTRAINT "PlayerProgress_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActivityResult" ADD CONSTRAINT "ActivityResult_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareInvitation" ADD CONSTRAINT "CareInvitation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareLink" ADD CONSTRAINT "CareLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareLink" ADD CONSTRAINT "CareLink_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PracticeJob" ADD CONSTRAINT "PracticeJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
