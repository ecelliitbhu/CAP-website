ALTER TABLE "cap"."tasks" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "cap"."score_adjustments" DROP CONSTRAINT IF EXISTS "adj_reason_chk";
--> statement-breakpoint
ALTER TABLE "cap"."score_adjustments" ALTER COLUMN "reason" DROP NOT NULL;
