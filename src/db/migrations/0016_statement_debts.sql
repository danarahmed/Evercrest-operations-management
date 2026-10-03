CREATE TABLE "statement_debt_write_offs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"write_off_date" date NOT NULL,
	"reason" text NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "write_off_positive" CHECK ("statement_debt_write_offs"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "pay_statement_items" ALTER COLUMN "settlement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_statement_items" ALTER COLUMN "trip_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_statement_items" ADD COLUMN "kind" text DEFAULT 'trip' NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_statement_items" ADD COLUMN "from_statement_id" uuid;--> statement-breakpoint
ALTER TABLE "statement_debt_write_offs" ADD CONSTRAINT "statement_debt_write_offs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_debt_write_offs" ADD CONSTRAINT "statement_debt_write_offs_statement_id_pay_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."pay_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_debt_write_offs" ADD CONSTRAINT "statement_debt_write_offs_partner_id_business_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_debt_write_offs" ADD CONSTRAINT "statement_debt_write_offs_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_debt_write_offs" ADD CONSTRAINT "statement_debt_write_offs_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_debt_write_offs" ADD CONSTRAINT "statement_debt_write_offs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statement_debt_write_offs_statement_id_partner_id_index" ON "statement_debt_write_offs" USING btree ("statement_id","partner_id");--> statement-breakpoint
ALTER TABLE "pay_statement_items" ADD CONSTRAINT "pay_statement_items_from_statement_id_pay_statements_id_fk" FOREIGN KEY ("from_statement_id") REFERENCES "public"."pay_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_statement_items_from_statement_id_partner_id_index" ON "pay_statement_items" USING btree ("from_statement_id","partner_id");--> statement-breakpoint
ALTER TABLE "pay_statement_items" ADD CONSTRAINT "item_kind_shape" CHECK (("pay_statement_items"."kind" = 'trip' and "pay_statement_items"."settlement_id" is not null and "pay_statement_items"."trip_id" is not null and "pay_statement_items"."from_statement_id" is null)
        or ("pay_statement_items"."kind" = 'brought_forward' and "pay_statement_items"."settlement_id" is null and "pay_statement_items"."trip_id" is null and "pay_statement_items"."from_statement_id" is not null and "pay_statement_items"."amount" < 0));--> statement-breakpoint
-- A payee is paid at most once per statement; repayments of a debt (money in) may be several.
DROP INDEX payments_one_per_statement_payee;--> statement-breakpoint
CREATE UNIQUE INDEX payments_one_per_statement_payee ON payments (statement_id, partner_id) WHERE statement_id IS NOT NULL AND status = 'posted' AND direction = 'out';--> statement-breakpoint
-- A debt is carried to at most one live statement at a time.
CREATE UNIQUE INDEX pay_statement_items_one_carry ON pay_statement_items (from_statement_id, partner_id) WHERE active AND kind = 'brought_forward';
