CREATE TABLE "deduction_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_amount" numeric(20, 6),
	"default_currency" char(3),
	"income_account_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deduction_types_company_id_name_unique" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "trip_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"deduction_type_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_deductions_trip_id_deduction_type_id_unique" UNIQUE("trip_id","deduction_type_id"),
	CONSTRAINT "trip_deduction_positive" CHECK ("trip_deductions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "cut_release_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"held" numeric(20, 4) NOT NULL,
	"given" numeric(20, 4) NOT NULL,
	"kept" numeric(20, 4) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cut_release_line_amounts" CHECK ("cut_release_lines"."given" >= 0 and "cut_release_lines"."kept" >= 0 and "cut_release_lines"."given" + "cut_release_lines"."kept" = "cut_release_lines"."held")
);
--> statement-breakpoint
CREATE TABLE "cut_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"release_no" text NOT NULL,
	"kind" text NOT NULL,
	"transporter_id" uuid,
	"method" text,
	"money_account_id" uuid,
	"payment_id" uuid,
	"currency" char(3) NOT NULL,
	"release_date" date NOT NULL,
	"given_total" numeric(20, 4) NOT NULL,
	"kept_total" numeric(20, 4) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"reversal_entry_id" uuid,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cut_releases_company_id_release_no_unique" UNIQUE("company_id","release_no"),
	CONSTRAINT "cut_release_totals" CHECK ("cut_releases"."given_total" >= 0 and "cut_releases"."kept_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "deduction_types" ADD CONSTRAINT "deduction_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduction_types" ADD CONSTRAINT "deduction_types_default_currency_currencies_code_fk" FOREIGN KEY ("default_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduction_types" ADD CONSTRAINT "deduction_types_income_account_id_accounts_id_fk" FOREIGN KEY ("income_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_deductions" ADD CONSTRAINT "trip_deductions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_deductions" ADD CONSTRAINT "trip_deductions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_deductions" ADD CONSTRAINT "trip_deductions_deduction_type_id_deduction_types_id_fk" FOREIGN KEY ("deduction_type_id") REFERENCES "public"."deduction_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_deductions" ADD CONSTRAINT "trip_deductions_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_release_lines" ADD CONSTRAINT "cut_release_lines_release_id_cut_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."cut_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_release_lines" ADD CONSTRAINT "cut_release_lines_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_release_lines" ADD CONSTRAINT "cut_release_lines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_releases" ADD CONSTRAINT "cut_releases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_releases" ADD CONSTRAINT "cut_releases_transporter_id_business_partners_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_releases" ADD CONSTRAINT "cut_releases_money_account_id_money_accounts_id_fk" FOREIGN KEY ("money_account_id") REFERENCES "public"."money_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_releases" ADD CONSTRAINT "cut_releases_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_releases" ADD CONSTRAINT "cut_releases_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_releases" ADD CONSTRAINT "cut_releases_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_releases" ADD CONSTRAINT "cut_releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_releases" ADD CONSTRAINT "cut_releases_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cut_release_lines_release_id_index" ON "cut_release_lines" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cut_release_lines_one_live_per_trip" ON "cut_release_lines" USING btree ("trip_id") WHERE "cut_release_lines"."active";--> statement-breakpoint
ALTER TABLE "cut_releases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cut_release_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deduction_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_deductions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Cuts held for transporters (owed, until given back or closed), and two income accounts: what the company keeps
-- of those cuts, and the deductions it keeps from carriers on trips.
INSERT INTO "accounts" ("company_id", "code", "name", "type", "postable", "active")
SELECT c."id", v.code, v.name, v.type, true, true
FROM "companies" c
CROSS JOIN (VALUES ('2500', 'Cuts held for transporters', 'liability'), ('4400', 'Kept from transporter cuts', 'income'), ('4500', 'Claim deductions', 'income')) AS v(code, name, type)
WHERE NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id" AND a."code" = v.code);--> statement-breakpoint
UPDATE "settings" s
SET "value" = s."value"
  || CASE WHEN s."value" ? 'transporter_cuts_held' THEN '{}'::jsonb ELSE '{"transporter_cuts_held": "2500"}'::jsonb END
  || CASE WHEN s."value" ? 'kept_transporter_cuts' THEN '{}'::jsonb ELSE '{"kept_transporter_cuts": "4400"}'::jsonb END
  || CASE WHEN s."value" ? 'claim_deductions' THEN '{}'::jsonb ELSE '{"claim_deductions": "4500"}'::jsonb END
WHERE s."key" = 'accounting.posting_accounts';
