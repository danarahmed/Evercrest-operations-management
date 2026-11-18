CREATE TABLE "claim_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"calculation" jsonb NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"claim_no" text NOT NULL,
	"job_id" uuid NOT NULL,
	"claimant_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"claim_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"total" numeric(20, 4) DEFAULT '0' NOT NULL,
	"total_final" numeric(20, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"journal_entry_id" uuid,
	"reversal_entry_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	CONSTRAINT "claims_company_id_claim_no_unique" UNIQUE("company_id","claim_no")
);
--> statement-breakpoint
CREATE TABLE "fine_waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"waiver_date" date NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiver_positive" CHECK ("fine_waivers"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "remote_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"settlement_date" date NOT NULL,
	"money_account_id" uuid NOT NULL,
	"rows" jsonb NOT NULL,
	"columns" jsonb NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"result" jsonb,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "claim_id" uuid;--> statement-breakpoint
ALTER TABLE "claim_items" ADD CONSTRAINT "claim_items_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_items" ADD CONSTRAINT "claim_items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_id_business_partners_id_fk" FOREIGN KEY ("claimant_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_waivers" ADD CONSTRAINT "fine_waivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_waivers" ADD CONSTRAINT "fine_waivers_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_waivers" ADD CONSTRAINT "fine_waivers_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_waivers" ADD CONSTRAINT "fine_waivers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_waivers" ADD CONSTRAINT "fine_waivers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_settlements" ADD CONSTRAINT "remote_settlements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_settlements" ADD CONSTRAINT "remote_settlements_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_settlements" ADD CONSTRAINT "remote_settlements_money_account_id_money_accounts_id_fk" FOREIGN KEY ("money_account_id") REFERENCES "public"."money_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_settlements" ADD CONSTRAINT "remote_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_settlements" ADD CONSTRAINT "remote_settlements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_items_claim_id_index" ON "claim_items" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_items_one_live_claim_per_trip" ON "claim_items" USING btree ("trip_id") WHERE "claim_items"."active";--> statement-breakpoint
CREATE INDEX "claims_job_id_index" ON "claims" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "claims_company_id_claimant_id_index" ON "claims" USING btree ("company_id","claimant_id");--> statement-breakpoint
CREATE INDEX "claims_company_id_status_index" ON "claims" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "fine_waivers_trip_id_index" ON "fine_waivers" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "remote_settlements_job_id_created_at_index" ON "remote_settlements" USING btree ("job_id","created_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fine_waivers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "remote_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- New permissions for claims: every existing administrator role gets them; finance roles get claims.manage.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission
FROM "roles" r CROSS JOIN (VALUES ('claims.manage'), ('fines.waive'), ('remote_settlements.approve')) AS p(permission)
WHERE r."code" = 'admin'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", 'claims.manage' FROM "roles" r WHERE r."code" = 'finance'
ON CONFLICT DO NOTHING;
