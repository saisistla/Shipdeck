terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "region" { type = string }
variable "name_prefix" { type = string }
variable "project_id" { type = string }
variable "zone" {
  type    = string
  default = "us-central1-a"
}

variable "tier" {
  type = string
}

resource "random_password" "db" {
  length  = 20
  special = false
}

resource "google_sql_database_instance" "pg" {
  name             = substr("${var.name_prefix}-pg", 0, 63)
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier = var.tier
    ip_configuration {
      ipv4_enabled = true
      authorized_networks {
        value = "0.0.0.0/0"
        name  = "all-demo"
      }
    }
  }

  deletion_protection = false
}

resource "google_sql_user" "shipdeck" {
  name     = "shipdeck"
  instance = google_sql_database_instance.pg.name
  password = random_password.db.result
}

resource "google_sql_database" "app" {
  name     = "app"
  instance = google_sql_database_instance.pg.name
}

output "connection_url" {
  sensitive = true
  value     = "postgres://shipdeck:${random_password.db.result}@${google_sql_database_instance.pg.public_ip_address}:5432/app"
}
