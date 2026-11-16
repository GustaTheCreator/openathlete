ALTER TYPE "connector_provider" ADD VALUE 'WAHOO';
ALTER TABLE "provider_account" ADD COLUMN "oauth_code_verifier" TEXT;
