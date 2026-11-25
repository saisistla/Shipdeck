terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "runtime" {
  type    = string
  default = "nodejs20"
}

variable "memory_mb" {
  type    = number
  default = 512
}

variable "timeout_seconds" {
  type    = number
  default = 30
}

variable "source_zip" {
  type        = string
  description = "Path to function deployment zip (built by Shipdeck)"
}

variable "content_md5" {
  type        = string
  description = "hex md5 of zip — used in object name for immutability"
  default     = ""
}

locals {
  bucket = lower(replace("${var.name_prefix}-sls", "/[^a-z0-9-]/", "-"))
  fn     = lower(replace("${var.name_prefix}-fn", "/[^a-z0-9-]/", "-"))
  runtime = var.runtime == "python312" ? "python312" : "nodejs20"
}

resource "google_storage_bucket" "src" {
  name                        = substr(local.bucket, 0, 63)
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
}

resource "google_storage_bucket_object" "src" {
  name   = "${var.name_prefix}-${var.content_md5 != "" ? var.content_md5 : filemd5(var.source_zip)}.zip"
  bucket = google_storage_bucket.src.name
  source = var.source_zip
}

resource "google_cloudfunctions2_function" "app" {
  name     = substr(local.fn, 0, 63)
  location = var.region

  build_config {
    runtime     = local.runtime
    entry_point = var.runtime == "python312" ? "handler" : "handler"
    source {
      storage_source {
        bucket = google_storage_bucket.src.name
        object = google_storage_bucket_object.src.name
      }
    }
  }

  service_config {
    max_instance_count    = 5
    available_memory      = "${var.memory_mb}Mi"
    timeout_seconds       = var.timeout_seconds
    ingress_settings      = "ALLOW_ALL"
    environment_variables = {
      SHIPDECK_PLATFORM = "serverless"
    }
  }
}

resource "google_cloud_run_service_iam_member" "invoker" {
  project  = var.project_id
  location = google_cloudfunctions2_function.app.location
  service  = google_cloudfunctions2_function.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "service_url" {
  value = google_cloudfunctions2_function.app.service_config[0].uri
}

output "function_name" {
  value = google_cloudfunctions2_function.app.name
}

output "admin_username" {
  value = ""
}

output "public_ip" {
  value = ""
}
