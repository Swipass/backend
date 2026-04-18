-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'EXECUTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'BRIDGING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "fromChainId" INTEGER NOT NULL,
    "toChainId" INTEGER NOT NULL,
    "fromChain" TEXT NOT NULL,
    "toChain" TEXT NOT NULL,
    "fromToken" TEXT NOT NULL,
    "toToken" TEXT NOT NULL,
    "fromTokenAddr" TEXT NOT NULL,
    "toTokenAddr" TEXT NOT NULL,
    "fromAmount" TEXT NOT NULL,
    "toAmount" TEXT NOT NULL,
    "toAmountMin" TEXT NOT NULL,
    "feePct" DOUBLE PRECISION NOT NULL,
    "feeAmount" TEXT NOT NULL,
    "estimatedTime" INTEGER NOT NULL,
    "aggregator" TEXT NOT NULL DEFAULT 'lifi',
    "routeData" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steps" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "transactionRequest" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_configs" (
    "id" TEXT NOT NULL,
    "feePct" DOUBLE PRECISION NOT NULL DEFAULT 0.003,
    "minFeePct" DOUBLE PRECISION NOT NULL DEFAULT 0.001,
    "maxFeePct" DOUBLE PRECISION NOT NULL DEFAULT 0.005,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bridge_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "quotes_createdAt_idx" ON "quotes"("createdAt");

-- CreateIndex
CREATE INDEX "quotes_fromChain_toChain_idx" ON "quotes"("fromChain", "toChain");

-- CreateIndex
CREATE INDEX "executions_userAddress_idx" ON "executions"("userAddress");

-- CreateIndex
CREATE INDEX "executions_status_idx" ON "executions"("status");

-- CreateIndex
CREATE INDEX "executions_createdAt_idx" ON "executions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "steps_executionId_stepIndex_key" ON "steps"("executionId", "stepIndex");

-- CreateIndex
CREATE UNIQUE INDEX "bridge_configs_name_key" ON "bridge_configs"("name");

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
