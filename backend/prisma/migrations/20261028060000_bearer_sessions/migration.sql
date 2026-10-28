-- Sessions now travel in the Authorization header (one per browser tab), so the
-- per-session CSRF token is no longer needed.
ALTER TABLE "sessions" DROP COLUMN "csrf_token";
