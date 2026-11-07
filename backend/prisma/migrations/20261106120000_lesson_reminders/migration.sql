-- Teachers are reminded shortly before each lesson. One reminder per lesson and teacher.
ALTER TYPE "NotificationType" ADD VALUE 'LESSON_REMINDER';

ALTER TABLE "notifications" ADD COLUMN "lesson_id" UUID;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lesson_id_fkey"
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "notifications_recipient_id_type_lesson_id_key"
  ON "notifications"("recipient_id", "type", "lesson_id");
