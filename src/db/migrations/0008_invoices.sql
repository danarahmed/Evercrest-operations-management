CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"catalog_item_id" uuid,
	"quantity" numeric(20, 4) NOT NULL,
	"unit" text,
	"unit_price" numeric(20, 6) NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"account_id" uuid NOT NULL,
	"job_id" uuid,
	"trip_id" uuid,
	CONSTRAINT "invoice_lines_invoice_id_line_no_unique" UNIQUE("invoice_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_no" text NOT NULL,
	"kind" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"balance_account_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"external_ref" text,
	"total" numeric(20, 4) NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"reversal_entry_id" uuid,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_company_id_invoice_no_unique" UNIQUE("company_id","invoice_no"),
	CONSTRAINT "total_positive" CHECK ("invoices"."total" > 0),
	CONSTRAINT "due_after_invoice" CHECK ("invoices"."due_date" is null or "invoices"."due_date" >= "invoices"."invoice_date")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "counter_account_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_unit_units_code_fk" FOREIGN KEY ("unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_partner_id_business_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_balance_account_id_accounts_id_fk" FOREIGN KEY ("balance_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_job_id_index" ON "invoice_lines" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_trip_id_index" ON "invoice_lines" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "invoices_company_id_partner_id_index" ON "invoices" USING btree ("company_id","partner_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_counter_account_id_accounts_id_fk" FOREIGN KEY ("counter_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_invoice_id_index" ON "payments" USING btree ("invoice_id");