-- Schema only: initial privileges are granted separately by the operator CLI.
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
