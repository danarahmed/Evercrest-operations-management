CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"required" boolean DEFAULT false NOT NULL,
	"required_before" text DEFAULT 'completed' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_fields_company_id_key_unique" UNIQUE("company_id","key"),
	CONSTRAINT "scope_target" CHECK (("custom_fields"."scope" = 'all') = ("custom_fields"."scope_id" is null))
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "custom_values" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "budget_amount" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "budget_currency" char(3);--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "job_budget" CHECK (("jobs"."budget_amount" is null) = ("jobs"."budget_currency" is null) and coalesce("jobs"."budget_amount", 0) >= 0);