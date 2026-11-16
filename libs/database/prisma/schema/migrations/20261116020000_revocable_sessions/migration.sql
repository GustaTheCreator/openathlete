ALTER TABLE "user" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "auth_session" (
    "id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auth_session_user_id_idx" ON "auth_session"("user_id");
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session"("expires_at");
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
