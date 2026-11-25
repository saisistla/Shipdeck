terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "region" { type = string }
variable "name_prefix" { type = string }
variable "ssh_public_key" {
  type    = string
  default = ""
}

variable "sku_name" {
  type = string
}

resource "random_password" "db" {
  length  = 20
  special = false
}

resource "azurerm_resource_group" "rg" {
  name     = "${var.name_prefix}-db-rg"
  location = var.region
}

resource "azurerm_postgresql_flexible_server" "db" {
  name                   = substr("${var.name_prefix}-pg", 0, 63)
  resource_group_name    = azurerm_resource_group.rg.name
  location               = azurerm_resource_group.rg.location
  version                = "16"
  administrator_login    = "shipdeck"
  administrator_password = random_password.db.result
  sku_name               = var.sku_name
  storage_mb             = 32768
  zone                   = "1"
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = "app"
  server_id = azurerm_postgresql_flexible_server.db.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "allow" {
  name             = "allow-all-demo"
  server_id        = azurerm_postgresql_flexible_server.db.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "255.255.255.255"
}

output "connection_url" {
  sensitive = true
  value     = "postgres://shipdeck:${random_password.db.result}@${azurerm_postgresql_flexible_server.db.fqdn}:5432/app?sslmode=require"
}
