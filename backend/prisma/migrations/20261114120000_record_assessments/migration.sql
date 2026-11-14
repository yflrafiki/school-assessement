-- A lesson record says whether the class was given a class exercise, an assignment or a
-- class test, with an optional note (for example "Exercise 3.2, questions 1 to 10").
CREATE TYPE "AssessmentKind" AS ENUM ('CLASS_EXERCISE', 'ASSIGNMENT', 'CLASS_TEST');

ALTER TABLE "teaching_records"
  ADD COLUMN "assessments" "AssessmentKind"[] NOT NULL DEFAULT ARRAY[]::"AssessmentKind"[],
  ADD COLUMN "assessment_note" TEXT;
