CREATE TABLE "route_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"carrier_price" numeric(20, 6) NOT NULL,
	"reward_per_trip" numeric(20, 4),
	"carrier_allowance" numeric(20, 6),
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_prices_version" UNIQUE("route_id","effective_from"),
	CONSTRAINT "route_price_non_negative" CHECK ("route_prices"."carrier_price" >= 0 and coalesce("route_prices"."reward_per_trip", 0) >= 0 and coalesce("route_prices"."carrier_allowance", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "fee_types" ADD COLUMN "default_amount" numeric(20, 6);--> statement-breakpoint
ALTER TABLE "fee_types" ADD COLUMN "default_currency" char(3);--> statement-breakpoint
ALTER TABLE "fee_types" ADD COLUMN "paid_by" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD COLUMN "paid_by" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "route_prices" ADD CONSTRAINT "route_prices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_prices" ADD CONSTRAINT "route_prices_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_prices" ADD CONSTRAINT "route_prices_route_id_job_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."job_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_prices" ADD CONSTRAINT "route_prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_default_currency_currencies_code_fk" FOREIGN KEY ("default_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD CONSTRAINT "trip_fees_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_fees_payment_id_index" ON "trip_fees" USING btree ("payment_id");--> statement-breakpoint
ALTER TABLE "route_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Fees paid by the customer directly and taken back from the carrier are owed back to the customer:
-- a liability account per company, and two posting keys (trip fees default to "Permits and fees").
INSERT INTO "accounts" ("company_id", "code", "name", "type", "postable", "active")
SELECT c."id", '2400', 'Fees to return to customers', 'liability', true, true
FROM "companies" c
WHERE NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id" AND a."code" = '2400');--> statement-breakpoint
UPDATE "settings" s
SET "value" = s."value"
  || CASE WHEN s."value" ? 'trip_fees' OR NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = s."company_id" AND a."code" = '5300') THEN '{}'::jsonb ELSE '{"trip_fees": "5300"}'::jsonb END
  || CASE WHEN s."value" ? 'customer_fee_credits' THEN '{}'::jsonb ELSE '{"customer_fee_credits": "2400"}'::jsonb END
WHERE s."key" = 'accounting.posting_accounts';
