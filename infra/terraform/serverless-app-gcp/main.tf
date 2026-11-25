terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
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

variable "api_image" {
  type = string
}

variable "web_image" {
  type = string
}

variable "api_container_port" {
  type    = number
  default = 8080
}

variable "web_container_port" {
  type    = number
  default = 80
}

variable "api_health_path" {
  type    = string
  default = "/"
}

variable "web_health_path" {
  type    = string
  default = "/"
}

variable "api_environment_json" {
  type    = string
  default = "{}"
}

variable "web_environment_json" {
  type    = string
  default = "{}"
}

variable "api_database_env" {
  type    = string
  default = ""
}

variable "api_redis_env" {
  type    = string
  default = ""
}

variable "web_database_env" {
  type    = string
  default = ""
}

variable "web_redis_env" {
  type    = string
  default = ""
}

variable "cpu" {
  type = string
}

variable "memory" {
  type = string
}

variable "db_tier" {
  type = string
}

variable "redis_tier" {
  type = string
}

variable "redis_memory_gb" {
  type = number
}

variable "db_username" {
  type    = string
  default = "sharehaul"
}

variable "db_name" {
  type    = string
  default = "sharehaul"
}

variable "jwt_secret" {
  type      = string
  sensitive = true
  default   = ""
}

resource "random_password" "db" {
  length  = 24
  special = false
}

resource "random_password" "jwt" {
  length  = 32
  special = false
}

locals {
  jwt  = var.jwt_secret != "" ? var.jwt_secret : random_password.jwt.result
  name = substr(replace(lower(var.name_prefix), "/[^a-z0-9-]/", ""), 0, 28)
}

resource "google_project_service" "services" {
  for_each = toset([
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "artifactregistry.googleapis.com",
    "vpcaccess.googleapis.com",
    "servicenetworking.googleapis.com",
    "compute.googleapis.com",
  ])
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "${local.name}-repo"
  format        = "DOCKER"
  depends_on    = [google_project_service.services]
}

data "google_project" "app" {
  project_id = var.project_id
}

resource "google_project_iam_member" "cloudbuild_ar" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${data.google_project.app.number}@cloudbuild.gserviceaccount.com"
}

resource "google_compute_network" "app" {
  name                    = "${local.name}-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.services]
}

resource "google_compute_global_address" "private_ip" {
  name          = "${local.name}-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.app.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.app.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

resource "google_compute_subnetwork" "app" {
  name          = "${local.name}-subnet"
  ip_cidr_range = "10.50.0.0/24"
  region        = var.region
  network       = google_compute_network.app.id
}

resource "google_vpc_access_connector" "app" {
  name          = "${replace(local.name, "-", "")}conn"
  region        = var.region
  network       = google_compute_network.app.name
  ip_cidr_range = "10.50.1.0/28"
  depends_on    = [google_project_service.services]
}

resource "google_sql_database_instance" "postgres" {
  name             = "${local.name}-pg"
  database_version = "POSTGRES_16"
  region           = var.region
  settings {
    tier = var.db_tier
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.app.id
    }
  }
  deletion_protection = false
  depends_on          = [google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "app" {
  name     = var.db_name
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "app" {
  name     = var.db_username
  instance = google_sql_database_instance.postgres.name
  password = random_password.db.result
}

resource "google_redis_instance" "app" {
  name               = "${local.name}-redis"
  tier               = var.redis_tier
  memory_size_gb     = var.redis_memory_gb
  region             = var.region
  authorized_network = google_compute_network.app.id
  redis_version      = "REDIS_7_0"
  depends_on         = [google_project_service.services]
}

locals {
  registry_host = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
  database_url  = "postgresql://${var.db_username}:${random_password.db.result}@/${var.db_name}?host=/cloudsql/${google_sql_database_instance.postgres.connection_name}"
  redis_url     = "redis://${google_redis_instance.app.host}:${google_redis_instance.app.port}"
  api_runtime_env = merge(
    jsondecode(var.api_environment_json),
    var.api_database_env == "" ? {} : { (var.api_database_env) = local.database_url },
    var.api_redis_env == "" ? {} : { (var.api_redis_env) = local.redis_url },
  )
  web_runtime_env = merge(
    jsondecode(var.web_environment_json),
    var.web_database_env == "" ? {} : { (var.web_database_env) = local.database_url },
    var.web_redis_env == "" ? {} : { (var.web_redis_env) = local.redis_url },
  )
}

resource "google_cloud_run_v2_service" "api" {
  name     = "${local.name}-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    vpc_access {
      connector = google_vpc_access_connector.app.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }
    containers {
      image = var.api_image
      ports {
        container_port = var.api_container_port
      }
      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }
      dynamic "env" {
        for_each = local.api_runtime_env
        content {
          name  = env.key
          value = env.value
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
  }

  depends_on = [
    google_sql_database.app,
    google_sql_user.app,
    google_redis_instance.app,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "web" {
  name     = "${local.name}-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image = var.web_image
      ports {
        container_port = var.web_container_port
      }
      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }
      dynamic "env" {
        for_each = merge(local.web_runtime_env, {
          API_ORIGIN = trimsuffix(google_cloud_run_v2_service.api.uri, "/")
        })
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  depends_on = [google_cloud_run_v2_service.api]
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  location = google_cloud_run_v2_service.web.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "service_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "ecr_api_url" {
  value = "${local.registry_host}/api"
}

output "ecr_web_url" {
  value = "${local.registry_host}/web"
}

output "function_name" {
  value = ""
}
