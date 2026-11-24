CREATE TABLE "contract_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text DEFAULT 'signed' NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"note" text,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_members" (
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_members_job_id_user_id_pk" PRIMARY KEY("job_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "document_waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_waivers_document_type_id_entity_type_entity_id_unique" UNIQUE("document_type_id","entity_type","entity_id")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "contract_files" ADD CONSTRAINT "contract_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_files" ADD CONSTRAINT "contract_files_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_files" ADD CONSTRAINT "contract_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_members" ADD CONSTRAINT "job_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_members" ADD CONSTRAINT "job_members_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_members" ADD CONSTRAINT "job_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_members" ADD CONSTRAINT "job_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_waivers" ADD CONSTRAINT "document_waivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_waivers" ADD CONSTRAINT "document_waivers_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_waivers" ADD CONSTRAINT "document_waivers_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_waivers" ADD CONSTRAINT "document_waivers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_waivers" ADD CONSTRAINT "document_waivers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_files_contract_id_index" ON "contract_files" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "job_members_user_id_index" ON "job_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_waivers_job_id_index" ON "document_waivers" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "contract_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_waivers" ENABLE ROW LEVEL SECURITY;
