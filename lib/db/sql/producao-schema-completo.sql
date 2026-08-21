CREATE TYPE "public"."caregiver_role" AS ENUM('primary_caregiver', 'caregiver', 'hired_caregiver', 'observer');--> statement-breakpoint
CREATE TYPE "public"."medication_form" AS ENUM('tablet', 'capsule', 'liquid', 'injection', 'patch', 'drops', 'inhaler', 'other');--> statement-breakpoint
CREATE TYPE "public"."escalation_profile" AS ENUM('silent', 'standard', 'critical');--> statement-breakpoint
CREATE TYPE "public"."schedule_type" AS ENUM('times_per_day', 'every_n_hours', 'specific_weekdays', 'alternate_days', 'cycle_with_pause');--> statement-breakpoint
CREATE TYPE "public"."treatment_status" AS ENUM('active', 'paused', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."photo_extraction_status" AS ENUM('pending_confirmation', 'confirmed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."scheduled_dose_status" AS ENUM('pending', 'taken', 'skipped', 'late', 'postponed');--> statement-breakpoint
CREATE TYPE "public"."dose_outcome" AS ENUM('taken', 'skipped', 'postponed');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'completed', 'cancelled', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."appointment_type" AS ENUM('consultation', 'exam', 'procedure');--> statement-breakpoint
CREATE TYPE "public"."measurement_type" AS ENUM('blood_pressure', 'blood_glucose', 'weight', 'temperature', 'oxygen_saturation', 'heart_rate', 'other');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('dose_reminder', 'dose_late', 'appointment_reminder', 'low_stock', 'system', 'treatment_ending', 'continuous_review');--> statement-breakpoint
CREATE TYPE "public"."push_failure_reason" AS ENUM('not_configured', 'no_keys', 'expired', 'rate_limited', 'error');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('caregiver', 'system');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('created', 'updated', 'deleted', 'accessed');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'basic', 'premium', 'professional');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'trialing', 'past_due', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'pending_verification');--> statement-breakpoint
CREATE TYPE "public"."consent_given_by" AS ENUM('self', 'legal_representative');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('terms_of_service', 'privacy_policy', 'health_data_processing', 'marketing', 'data_sharing');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."push_platform" AS ENUM('ios', 'android', 'desktop', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('dose', 'appointment', 'stock', 'treatment');--> statement-breakpoint
CREATE TYPE "public"."operational_alert_type" AS ENUM('delivery_rate', 'queue_stuck', 'no_send_window');--> statement-breakpoint
CREATE TYPE "public"."deletion_status" AS ENUM('pending', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('physiotherapy', 'bath', 'feeding', 'walk', 'other');--> statement-breakpoint
CREATE TYPE "public"."patient_access_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TABLE "families" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"retroactive_window_hours" integer DEFAULT 24 NOT NULL,
	"show_medication_in_push" boolean DEFAULT false NOT NULL,
	"quiet_hours_enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" text DEFAULT '22:00' NOT NULL,
	"quiet_hours_end" text DEFAULT '07:00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "families_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"name" text NOT NULL,
	"birth_date" date,
	"timezone" text NOT NULL,
	"notes" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"elder_mode_enabled" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caregivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"user_id" integer,
	"role" "caregiver_role" DEFAULT 'caregiver' NOT NULL,
	"selected_patient_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"name" text NOT NULL,
	"active_ingredient" text,
	"form" "medication_form" DEFAULT 'tablet' NOT NULL,
	"strength" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatments" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"medication_id" integer NOT NULL,
	"dose" text,
	"schedule_type" "schedule_type" NOT NULL,
	"schedule_config" jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "treatment_status" DEFAULT 'active' NOT NULL,
	"instructions" text,
	"escalation_profile" "escalation_profile" DEFAULT 'standard' NOT NULL,
	"ending_notice_sent_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_extractions" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"uploaded_by_caregiver_id" integer NOT NULL,
	"photo_data" text,
	"mime_type" text,
	"size_bytes" integer,
	"retained" boolean DEFAULT false NOT NULL,
	"extracted_fields" jsonb NOT NULL,
	"confidence" jsonb NOT NULL,
	"confirmed_fields" jsonb,
	"status" "photo_extraction_status" DEFAULT 'pending_confirmation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"discarded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scheduled_doses" (
	"id" serial PRIMARY KEY NOT NULL,
	"treatment_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"scheduled_local_date" date NOT NULL,
	"scheduled_local_time" text NOT NULL,
	"status" "scheduled_dose_status" DEFAULT 'pending' NOT NULL,
	"dose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_treatment_scheduled_at" UNIQUE("treatment_id","scheduled_at")
);
--> statement-breakpoint
CREATE TABLE "dose_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheduled_dose_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"caregiver_id" integer NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"outcome" "dose_outcome" DEFAULT 'taken' NOT NULL,
	"postponed_to" timestamp with time zone,
	"justification" text,
	"notes" text,
	"registered_via_elder_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_dose_record_per_scheduled_dose" UNIQUE("scheduled_dose_id")
);
--> statement-breakpoint
CREATE TABLE "stock_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"medication_id" integer NOT NULL,
	"quantity_remaining" real NOT NULL,
	"unit" text NOT NULL,
	"prescription_expires_at" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_stock_patient_medication" UNIQUE("patient_id","medication_id")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"type" "appointment_type" DEFAULT 'consultation' NOT NULL,
	"specialty" text NOT NULL,
	"doctor_name" text,
	"location" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"notes" text,
	"preparation_notes" text,
	"questions_for_doctor" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_appointment_notes" text,
	"attachment_data" text,
	"attachment_mime_type" text,
	"attachment_file_name" text,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"type" "measurement_type" NOT NULL,
	"value" text,
	"unit" text,
	"measured_at" timestamp with time zone NOT NULL,
	"notes" text,
	"caregiver_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"patient_id" integer,
	"caregiver_id" integer,
	"treatment_id" integer,
	"scheduled_dose_id" integer,
	"appointment_id" integer,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivered_via_platform" "push_platform",
	"last_failure_reason" "push_failure_reason",
	"acked_at" timestamp with time zone,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_notif_dose_caregiver_level" UNIQUE("scheduled_dose_id","caregiver_id","escalation_level"),
	CONSTRAINT "uq_notif_appointment_caregiver_level" UNIQUE("appointment_id","caregiver_id","escalation_level")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"actor_id" text,
	"actor_type" "actor_type" DEFAULT 'system' NOT NULL,
	"diff" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"plan" "subscription_plan" DEFAULT 'free' NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"expires_at" timestamp with time zone,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_subscription_family" UNIQUE("family_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'pending_verification' NOT NULL,
	"active_family_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_token_hash" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"invalidated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"device_label" text,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"patient_id" integer,
	"given_by" "consent_given_by",
	"consent_type" "consent_type" NOT NULL,
	"consent_given" text NOT NULL,
	"version" text NOT NULL,
	"ip_address" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caregiver_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"invited_email" text,
	"role" "caregiver_role" DEFAULT 'caregiver' NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_user_id" integer,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caregiver_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_monthly" integer DEFAULT 0 NOT NULL,
	"price_yearly" integer,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"family_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text,
	"auth" text,
	"device_label" text,
	"platform" "push_platform" DEFAULT 'unknown' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_push_endpoint_user" UNIQUE("user_id","endpoint")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"caregiver_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"category" "notification_category" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_notif_pref_caregiver_patient_category" UNIQUE("caregiver_id","patient_id","category")
);
--> statement-breakpoint
CREATE TABLE "operational_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "operational_alert_type" NOT NULL,
	"message" text NOT NULL,
	"metric_value" real,
	"threshold_value" real,
	"triggered_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verifications_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp with time zone,
	"request_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "export_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"family_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"downloaded" boolean DEFAULT false NOT NULL,
	"downloaded_at" timestamp with time zone,
	"snapshot" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_login_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_in" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_login_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" integer,
	"requested_by_user_id" integer,
	"status" "deletion_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_deletion_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" integer,
	"completed_at" timestamp with time zone,
	"confirmed" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adherence_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"family_id" integer NOT NULL,
	"generated_by_caregiver_id" integer,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pdf_data" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adherence_reports_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"type" "activity_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"done" boolean DEFAULT true NOT NULL,
	"notes" text,
	"caregiver_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_access_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"family_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"status" "patient_access_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"device_label" text,
	"last_used_at" timestamp with time zone,
	"created_by_caregiver_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregivers" ADD CONSTRAINT "caregivers_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregivers" ADD CONSTRAINT "caregivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregivers" ADD CONSTRAINT "caregivers_selected_patient_id_patients_id_fk" FOREIGN KEY ("selected_patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_extractions" ADD CONSTRAINT "photo_extractions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_extractions" ADD CONSTRAINT "photo_extractions_uploaded_by_caregiver_id_caregivers_id_fk" FOREIGN KEY ("uploaded_by_caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_doses" ADD CONSTRAINT "scheduled_doses_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_doses" ADD CONSTRAINT "scheduled_doses_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_records" ADD CONSTRAINT "dose_records_scheduled_dose_id_scheduled_doses_id_fk" FOREIGN KEY ("scheduled_dose_id") REFERENCES "public"."scheduled_doses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_records" ADD CONSTRAINT "dose_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_records" ADD CONSTRAINT "dose_records_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_scheduled_dose_id_scheduled_doses_id_fk" FOREIGN KEY ("scheduled_dose_id") REFERENCES "public"."scheduled_doses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_family_id_families_id_fk" FOREIGN KEY ("active_family_id") REFERENCES "public"."families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_invites" ADD CONSTRAINT "caregiver_invites_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_tokens" ADD CONSTRAINT "export_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_tokens" ADD CONSTRAINT "export_tokens_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_login_codes" ADD CONSTRAINT "oauth_login_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adherence_reports" ADD CONSTRAINT "adherence_reports_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adherence_reports" ADD CONSTRAINT "adherence_reports_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adherence_reports" ADD CONSTRAINT "adherence_reports_generated_by_caregiver_id_caregivers_id_fk" FOREIGN KEY ("generated_by_caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_access_tokens" ADD CONSTRAINT "patient_access_tokens_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_access_tokens" ADD CONSTRAINT "patient_access_tokens_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_access_tokens" ADD CONSTRAINT "patient_access_tokens_created_by_caregiver_id_caregivers_id_fk" FOREIGN KEY ("created_by_caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notifications_delivery_stats" ON "notifications" USING btree ("family_id","type","sent_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_admin_metrics" ON "notifications" USING btree ("type","sent_at");