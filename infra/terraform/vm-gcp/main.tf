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
  # No zone here: local.zone is discovered from data.google_compute_zones,
  # and provider config cannot depend on a data source (Terraform cycle).
  # The instance sets zone = local.zone explicitly.
}

variable "region" {
  type = string
}

variable "zone" {
  type        = string
  default     = ""
  description = "Optional zone; if empty or unknown for the region, the first UP zone in the region is used"
}

variable "vm_size" {
  type    = string
  default = "e2-micro"
}

variable "disk_gb" {
  type        = number
  default     = 40
  description = "Boot disk size for Docker/compose image builds"
}

variable "name_prefix" {
  type = string
}

variable "project_id" {
  type = string
}

variable "ssh_public_key" {
  type        = string
  description = "Path to SSH public key file for OS login"
  default     = ""
}

variable "app_ports" {
  type        = list(number)
  default     = []
  description = "Public app ports derived from the pipeline (deploy/compose ports). Baseline SSH/HTTP/HTTPS are always open; app ports are never hardcoded."
}

variable "cloud_init_path" {
  type        = string
  description = "Path to startup script that installs Docker"
}

variable "subnet_cidr" {
  type    = string
  default = "10.42.1.0/24"
}

# GCP instances are zonal. Not every region has an "-a" zone
# (e.g. europe-west1 is b/c/d only), so discover real zones instead of guessing.
data "google_compute_zones" "available" {
  region = var.region
  status = "UP"
}

locals {
  zone = var.zone != "" && contains(data.google_compute_zones.available.names, var.zone) ? var.zone : data.google_compute_zones.available.names[0]
  # Firewall ports = baseline (SSH/HTTP/HTTPS) + pipeline-supplied app ports.
  firewall_ports = distinct(concat(["22", "80", "443"], [for p in var.app_ports : tostring(p)]))
  # Standardized naming (all clouds): lowercase, hyphen-safe — even if a caller passes mixed case.
  name_prefix = trim(substr(replace(lower(var.name_prefix), "/[^a-z0-9-]/", "-"), 0, 63), "-")
}

# Projects often have no usable default VPC. Always create a dedicated network.
resource "google_compute_network" "shipdeck" {
  name                    = "${local.name_prefix}-net"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "shipdeck" {
  name          = "${local.name_prefix}-subnet"
  ip_cidr_range = var.subnet_cidr
  region        = var.region
  network       = google_compute_network.shipdeck.id
}

resource "google_compute_firewall" "shipdeck" {
  name    = "${local.name_prefix}-allow"
  network = google_compute_network.shipdeck.name

  allow {
    protocol = "tcp"
    ports    = local.firewall_ports
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["shipdeck"]
}

resource "google_compute_instance" "vm" {
  name         = "${local.name_prefix}-vm"
  machine_type = var.vm_size
  zone         = local.zone

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = var.disk_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network    = google_compute_network.shipdeck.id
    subnetwork = google_compute_subnetwork.shipdeck.id
    access_config {}
  }

  tags = ["shipdeck", "http-server", "https-server"]

  metadata = merge(
    {
      enable-oslogin = "FALSE"
    },
    var.ssh_public_key != "" ? {
      ssh-keys = "shipdeck:${trimspace(file(var.ssh_public_key))}"
    } : {}
  )

  metadata_startup_script = file(var.cloud_init_path)
}

output "public_ip" {
  value = google_compute_instance.vm.network_interface[0].access_config[0].nat_ip
}

output "admin_username" {
  value = "shipdeck"
}

output "network" {
  value = google_compute_network.shipdeck.name
}
