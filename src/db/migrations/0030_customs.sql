CREATE TABLE "customs_booking_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"rate" numeric(20, 6) NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customs_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"booking_no" text NOT NULL,
	"job_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"total" numeric(20, 4) NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"reversal_entry_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_bookings_company_id_booking_no_unique" UNIQUE("company_id","booking_no")
);
--> statement-breakpoint
CREATE TABLE "customs_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"route_id" uuid,
	"effective_from" date NOT NULL,
	"rate" numeric(20, 6) NOT NULL,
	"currency" char(3) NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_rate_non_negative" CHECK ("customs_rates"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customs_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"rows" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_customs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"agent_id" uuid,
	"billed_to_customer" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_customs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "customs_qty" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "customs_booking_lines" ADD CONSTRAINT "customs_booking_lines_booking_id_customs_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."customs_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_booking_lines" ADD CONSTRAINT "customs_booking_lines_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_bookings" ADD CONSTRAINT "customs_bookings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_bookings" ADD CONSTRAINT "customs_bookings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_bookings" ADD CONSTRAINT "customs_bookings_agent_id_business_partners_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_bookings" ADD CONSTRAINT "customs_bookings_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_bookings" ADD CONSTRAINT "customs_bookings_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_bookings" ADD CONSTRAINT "customs_bookings_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_bookings" ADD CONSTRAINT "customs_bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_rates" ADD CONSTRAINT "customs_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_rates" ADD CONSTRAINT "customs_rates_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_rates" ADD CONSTRAINT "customs_rates_route_id_job_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."job_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_rates" ADD CONSTRAINT "customs_rates_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_rates" ADD CONSTRAINT "customs_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_statements" ADD CONSTRAINT "customs_statements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_statements" ADD CONSTRAINT "customs_statements_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_statements" ADD CONSTRAINT "customs_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_customs" ADD CONSTRAINT "job_customs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_customs" ADD CONSTRAINT "job_customs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_customs" ADD CONSTRAINT "job_customs_agent_id_business_partners_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customs_booking_lines_booking_id_index" ON "customs_booking_lines" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_booking_lines_one_live_per_trip" ON "customs_booking_lines" USING btree ("trip_id") WHERE "customs_booking_lines"."active";--> statement-breakpoint
CREATE INDEX "customs_bookings_job_id_index" ON "customs_bookings" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "customs_rates_job_id_index" ON "customs_rates" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "customs_statements_job_id_index" ON "customs_statements" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "customs_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_customs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customs_bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customs_booking_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customs_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Customs is kept apart in the books: money given to the border person (an asset until the duty is booked against it),
-- the duty itself (a job cost), and customs the customer pays back (pass-through, owed by the customer).
INSERT INTO "accounts" ("company_id", "code", "name", "type", "postable", "active")
SELECT c."id", v.code, v.name, v.type, true, true
FROM "companies" c
CROSS JOIN (VALUES ('1350', 'Customs paid to agents', 'asset'), ('1160', 'Customs to bill customers', 'asset'), ('5600', 'Customs duties', 'expense')) AS v(code, name, type)
WHERE NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id" AND a."code" = v.code);--> statement-breakpoint
UPDATE "settings" s
SET "value" = s."value"
  || CASE WHEN s."value" ? 'customs_advances' THEN '{}'::jsonb ELSE '{"customs_advances": "1350"}'::jsonb END
  || CASE WHEN s."value" ? 'customs_duties' THEN '{}'::jsonb ELSE '{"customs_duties": "5600"}'::jsonb END
  || CASE WHEN s."value" ? 'customs_to_bill' THEN '{}'::jsonb ELSE '{"customs_to_bill": "1160"}'::jsonb END
WHERE s."key" = 'accounting.posting_accounts';
