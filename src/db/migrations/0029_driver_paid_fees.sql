CREATE TABLE "job_billed_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"fee_type_ids" jsonb NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_billed_fees_job_id_effective_from_unique" UNIQUE("job_id","effective_from")
);
--> statement-breakpoint
ALTER TABLE "trip_fees" ADD COLUMN "receipt_received" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD COLUMN "receipt_waived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD COLUMN "receipt_waive_reason" text;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD COLUMN "receipt_waived_by" uuid;--> statement-breakpoint
ALTER TABLE "job_billed_fees" ADD CONSTRAINT "job_billed_fees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_billed_fees" ADD CONSTRAINT "job_billed_fees_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_billed_fees" ADD CONSTRAINT "job_billed_fees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD CONSTRAINT "trip_fees_receipt_waived_by_users_id_fk" FOREIGN KEY ("receipt_waived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_billed_fees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Fees on the customer's invoice are pass-through money (owner's choice, option A): held as owed by the customer
-- until the invoice, never a job cost or job revenue.
INSERT INTO "accounts" ("company_id", "code", "name", "type", "postable", "active")
SELECT c."id", '1150', 'Fees to bill customers', 'asset', true, true
FROM "companies" c
WHERE NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id" AND a."code" = '1150');--> statement-breakpoint
UPDATE "settings" s
SET "value" = s."value" || CASE WHEN s."value" ? 'fees_to_bill' THEN '{}'::jsonb ELSE '{"fees_to_bill": "1150"}'::jsonb END
WHERE s."key" = 'accounting.posting_accounts';
