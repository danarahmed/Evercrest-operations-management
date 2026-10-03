CREATE TABLE "rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rate_type" text NOT NULL,
	"basis" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" char(3),
	"unit" text,
	"product_id" uuid,
	"customer_id" uuid,
	"transporter_id" uuid,
	"contract_id" uuid,
	"free_days" integer,
	"start_event" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_amount_non_negative" CHECK ("rates"."amount" >= 0),
	CONSTRAINT "rate_period" CHECK ("rates"."effective_to" is null or "rates"."effective_to" >= "rates"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "trip_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"settlement_no" text NOT NULL,
	"trip_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"calculation" jsonb NOT NULL,
	"driver_net" numeric(20, 4) NOT NULL,
	"transporter_net" numeric(20, 4),
	"status" text DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"reversal_entry_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_settlements_company_id_settlement_no_unique" UNIQUE("company_id","settlement_no")
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "arrival_date" date;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_unit_units_code_fk" FOREIGN KEY ("unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_product_id_catalog_items_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_customer_id_business_partners_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_transporter_id_business_partners_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rates_company_id_rate_type_effective_from_index" ON "rates" USING btree ("company_id","rate_type","effective_from");--> statement-breakpoint
CREATE INDEX "trip_settlements_trip_id_index" ON "trip_settlements" USING btree ("trip_id");