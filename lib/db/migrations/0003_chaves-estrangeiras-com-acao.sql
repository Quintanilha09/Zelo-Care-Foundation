ALTER TABLE "treatments" DROP CONSTRAINT "treatments_medication_id_medications_id_fk";
--> statement-breakpoint
ALTER TABLE "dose_records" DROP CONSTRAINT "dose_records_caregiver_id_caregivers_id_fk";
--> statement-breakpoint
ALTER TABLE "health_measurements" DROP CONSTRAINT "health_measurements_caregiver_id_caregivers_id_fk";
--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_caregiver_id_caregivers_id_fk";
--> statement-breakpoint
ALTER TABLE "dose_records" ALTER COLUMN "caregiver_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_records" ADD CONSTRAINT "dose_records_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE set null ON UPDATE no action;