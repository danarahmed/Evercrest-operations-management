CREATE TABLE "fee_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"default_basis" text DEFAULT 'per_trip' NOT NULL,
	"deduct_from_carrier" boolean DEFAULT false NOT NULL,
	"billed_to_customer" boolean DEFAULT false NOT NULL,
	"expense_account_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_types_company_id_code_unique" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "job_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"route_id" uuid,
	"fee_type_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" char(3) NOT NULL,
	"basis" text NOT NULL,
	"deduct_from_carrier" boolean NOT NULL,
	"billed_to_customer" boolean NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_fees_version" UNIQUE NULLS NOT DISTINCT("job_id","route_id","fee_type_id","effective_from"),
	CONSTRAINT "job_fee_non_negative" CHECK ("job_fees"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"loading_place" text,
	"discharge_place" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_routes_job_id_name_key_unique" UNIQUE("job_id","name_key")
);
--> statement-breakpoint
CREATE TABLE "job_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"route_id" uuid,
	"effective_from" date NOT NULL,
	"currency" char(3) NOT NULL,
	"unit" text NOT NULL,
	"customer_price" numeric(20, 6),
	"customer_price_basis" text DEFAULT 'per_unit' NOT NULL,
	"customer_qty_basis" text DEFAULT 'net' NOT NULL,
	"customer_allowance" numeric(20, 6),
	"customer_allowance_basis" text DEFAULT 'per_trip' NOT NULL,
	"customer_fine_price" numeric(20, 6),
	"carrier_price" numeric(20, 6),
	"carrier_price_basis" text DEFAULT 'per_unit' NOT NULL,
	"reward_per_trip" numeric(20, 4) DEFAULT '0' NOT NULL,
	"transporter_commission" numeric(20, 6) DEFAULT '0' NOT NULL,
	"carrier_allowance" numeric(20, 6) DEFAULT '0' NOT NULL,
	"carrier_fine_price" numeric(20, 6) DEFAULT '0' NOT NULL,
	"demurrage_method" text DEFAULT 'none' NOT NULL,
	"demurrage_free_days" integer DEFAULT 0 NOT NULL,
	"carrier_demurrage_rate" numeric(20, 4) DEFAULT '0' NOT NULL,
	"customer_demurrage_rate" numeric(20, 4) DEFAULT '0' NOT NULL,
	"advance_normal" numeric(20, 4),
	"advance_max" numeric(20, 4),
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_terms_version" UNIQUE NULLS NOT DISTINCT("job_id","route_id","effective_from"),
	CONSTRAINT "terms_non_negative" CHECK (coalesce("job_terms"."customer_price", 0) >= 0 and coalesce("job_terms"."carrier_price", 0) >= 0 and "job_terms"."reward_per_trip" >= 0 and "job_terms"."transporter_commission" >= 0
        and "job_terms"."carrier_allowance" >= 0 and "job_terms"."carrier_fine_price" >= 0 and coalesce("job_terms"."customer_allowance", 0) >= 0 and coalesce("job_terms"."customer_fine_price", 0) >= 0
        and "job_terms"."demurrage_free_days" >= 0 and "job_terms"."carrier_demurrage_rate" >= 0 and "job_terms"."customer_demurrage_rate" >= 0
        and coalesce("job_terms"."advance_normal", 0) >= 0 and coalesce("job_terms"."advance_max", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "trip_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"fee_type_id" uuid NOT NULL,
	"rate" numeric(20, 6) NOT NULL,
	"basis" text NOT NULL,
	"currency" char(3) NOT NULL,
	"deduct_from_carrier" boolean NOT NULL,
	"billed_to_customer" boolean NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_fees_trip_id_fee_type_id_unique" UNIQUE("trip_id","fee_type_id"),
	CONSTRAINT "trip_fee_non_negative" CHECK ("trip_fees"."rate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "manifest_no" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "manifest_key" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "route_id" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "plate_text" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "carrier_price_override" numeric(20, 6);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "reward_override" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "transporter_cut" numeric(20, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "carrier_deduction" numeric(20, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_fees" ADD CONSTRAINT "job_fees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_fees" ADD CONSTRAINT "job_fees_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_fees" ADD CONSTRAINT "job_fees_route_id_job_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."job_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_fees" ADD CONSTRAINT "job_fees_fee_type_id_fee_types_id_fk" FOREIGN KEY ("fee_type_id") REFERENCES "public"."fee_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_fees" ADD CONSTRAINT "job_fees_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_fees" ADD CONSTRAINT "job_fees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_routes" ADD CONSTRAINT "job_routes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_routes" ADD CONSTRAINT "job_routes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_terms" ADD CONSTRAINT "job_terms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_terms" ADD CONSTRAINT "job_terms_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_terms" ADD CONSTRAINT "job_terms_route_id_job_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."job_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_terms" ADD CONSTRAINT "job_terms_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_terms" ADD CONSTRAINT "job_terms_unit_units_code_fk" FOREIGN KEY ("unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_terms" ADD CONSTRAINT "job_terms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD CONSTRAINT "trip_fees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD CONSTRAINT "trip_fees_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD CONSTRAINT "trip_fees_fee_type_id_fee_types_id_fk" FOREIGN KEY ("fee_type_id") REFERENCES "public"."fee_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_fees" ADD CONSTRAINT "trip_fees_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_job_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."job_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trips_job_manifest" ON "trips" USING btree ("job_id","manifest_key") WHERE "trips"."manifest_key" is not null and "trips"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "fee_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_fees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_fees" ENABLE ROW LEVEL SECURITY;
