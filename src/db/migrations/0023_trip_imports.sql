CREATE TABLE "trip_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"rows" jsonb NOT NULL,
	"columns" jsonb NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"result" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" uuid,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_imports" ADD CONSTRAINT "trip_imports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_imports" ADD CONSTRAINT "trip_imports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_imports" ADD CONSTRAINT "trip_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_imports" ADD CONSTRAINT "trip_imports_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_imports_job_id_created_at_index" ON "trip_imports" USING btree ("job_id","created_at");--> statement-breakpoint
ALTER TABLE "trip_imports" ENABLE ROW LEVEL SECURITY;
