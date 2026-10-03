CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"trip_no" text NOT NULL,
	"job_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"transporter_id" uuid,
	"product_id" uuid,
	"loading_location" text,
	"destination" text,
	"loading_date" date,
	"loaded_qty" numeric(20, 4),
	"loaded_unit" text,
	"discharge_date" date,
	"discharged_qty" numeric(20, 4),
	"discharged_unit" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_company_id_trip_no_unique" UNIQUE("company_id","trip_no"),
	CONSTRAINT "qty_with_unit" CHECK (("trips"."loaded_qty" is null) = ("trips"."loaded_unit" is null) and ("trips"."discharged_qty" is null) = ("trips"."discharged_unit" is null)),
	CONSTRAINT "qty_positive" CHECK (coalesce("trips"."loaded_qty", 1) > 0 and coalesce("trips"."discharged_qty", 0) >= 0),
	CONSTRAINT "discharge_after_loading" CHECK ("trips"."discharge_date" is null or "trips"."loading_date" is null or "trips"."discharge_date" >= "trips"."loading_date")
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plate" text NOT NULL,
	"plate_key" text NOT NULL,
	"owner_partner_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trucks_company_id_plate_key_unique" UNIQUE("company_id","plate_key")
);
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_business_partners_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_transporter_id_business_partners_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_product_id_catalog_items_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_loaded_unit_units_code_fk" FOREIGN KEY ("loaded_unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_discharged_unit_units_code_fk" FOREIGN KEY ("discharged_unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_owner_partner_id_business_partners_id_fk" FOREIGN KEY ("owner_partner_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trips_job_id_index" ON "trips" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "trips_company_id_driver_id_index" ON "trips" USING btree ("company_id","driver_id");--> statement-breakpoint
CREATE INDEX "trips_company_id_truck_id_index" ON "trips" USING btree ("company_id","truck_id");