CREATE TABLE "pay_statement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"party" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"statement_no" text NOT NULL,
	"party" text NOT NULL,
	"currency" char(3) NOT NULL,
	"statement_date" date NOT NULL,
	"total" numeric(20, 4) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_statements_company_id_statement_no_unique" UNIQUE("company_id","statement_no")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "statement_id" uuid;--> statement-breakpoint
ALTER TABLE "pay_statement_items" ADD CONSTRAINT "pay_statement_items_statement_id_pay_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."pay_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_statement_items" ADD CONSTRAINT "pay_statement_items_settlement_id_trip_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."trip_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_statement_items" ADD CONSTRAINT "pay_statement_items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_statement_items" ADD CONSTRAINT "pay_statement_items_partner_id_business_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_statements" ADD CONSTRAINT "pay_statements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_statements" ADD CONSTRAINT "pay_statements_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_statements" ADD CONSTRAINT "pay_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_statement_items_statement_id_index" ON "pay_statement_items" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "pay_statement_items_settlement_id_index" ON "pay_statement_items" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "pay_statements_company_id_status_index" ON "pay_statements" USING btree ("company_id","status");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_statement_id_pay_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."pay_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A settlement side (driver or transporter) can be on only one live statement.
CREATE UNIQUE INDEX pay_statement_items_one_active ON pay_statement_items (settlement_id, party) WHERE active;--> statement-breakpoint
-- Each payee on a statement is paid at most once (a reversed payment can be replaced).
CREATE UNIQUE INDEX payments_one_per_statement_payee ON payments (statement_id, partner_id) WHERE statement_id IS NOT NULL AND status = 'posted';
