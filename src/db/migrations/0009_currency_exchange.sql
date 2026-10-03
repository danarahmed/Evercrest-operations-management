CREATE TABLE "currency_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"exchange_no" text NOT NULL,
	"from_money_account_id" uuid NOT NULL,
	"to_money_account_id" uuid NOT NULL,
	"from_amount" numeric(20, 4) NOT NULL,
	"from_currency" char(3) NOT NULL,
	"to_amount" numeric(20, 4) NOT NULL,
	"to_currency" char(3) NOT NULL,
	"rate" numeric(24, 10) NOT NULL,
	"exchange_date" date NOT NULL,
	"counterparty_id" uuid,
	"reference" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"reversal_entry_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currency_exchanges_company_id_exchange_no_unique" UNIQUE("company_id","exchange_no"),
	CONSTRAINT "fx_amounts_positive" CHECK ("currency_exchanges"."from_amount" > 0 and "currency_exchanges"."to_amount" > 0),
	CONSTRAINT "fx_currencies_differ" CHECK ("currency_exchanges"."from_currency" <> "currency_exchanges"."to_currency")
);
--> statement-breakpoint
ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_from_money_account_id_money_accounts_id_fk" FOREIGN KEY ("from_money_account_id") REFERENCES "public"."money_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_to_money_account_id_money_accounts_id_fk" FOREIGN KEY ("to_money_account_id") REFERENCES "public"."money_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_from_currency_currencies_code_fk" FOREIGN KEY ("from_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_to_currency_currencies_code_fk" FOREIGN KEY ("to_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_counterparty_id_business_partners_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;