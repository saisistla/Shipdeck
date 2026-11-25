terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "region" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "runtime" {
  type    = string
  default = "node"
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
  description = "hex md5 of zip computed by Shipdeck"
  default     = ""
}

locals {
  # Azure names: letters/numbers only, length limits
  safe     = lower(replace(var.name_prefix, "/[^a-zA-Z0-9]/", ""))
  sa_name  = substr("${local.safe}sa", 0, 24)
  app_name = substr("${local.safe}-fn", 0, 60)
}

resource "azurerm_resource_group" "rg" {
  name     = "${var.name_prefix}-sls-rg"
  location = var.region
}

resource "azurerm_storage_account" "sa" {
  name                     = local.sa_name
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
}

resource "azurerm_storage_container" "pkg" {
  name                  = "shipdeck-fn"
  storage_account_name  = azurerm_storage_account.sa.name
  container_access_type = "private"
}

resource "azurerm_storage_blob" "pkg" {
  name                   = "${var.name_prefix}.zip"
  storage_account_name   = azurerm_storage_account.sa.name
  storage_container_name = azurerm_storage_container.pkg.name
  type                   = "Block"
  source                 = var.source_zip
  content_md5            = var.content_md5 != "" ? var.content_md5 : filemd5(var.source_zip)
}

data "azurerm_storage_account_blob_container_sas" "pkg" {
  connection_string = azurerm_storage_account.sa.primary_connection_string
  container_name    = azurerm_storage_container.pkg.name
  https_only        = true

  start  = timestamp()
  expiry = timeadd(timestamp(), "8760h")

  permissions {
    read   = true
    add    = false
    create = false
    write  = false
    delete = false
    list   = false
  }
}

resource "azurerm_service_plan" "plan" {
  name                = "${var.name_prefix}-plan"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  os_type             = "Linux"
  sku_name            = "Y1"
}

resource "azurerm_linux_function_app" "app" {
  name                = local.app_name
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  service_plan_id     = azurerm_service_plan.plan.id

  storage_account_name       = azurerm_storage_account.sa.name
  storage_account_access_key = azurerm_storage_account.sa.primary_access_key

  site_config {
    application_stack {
      node_version = "20"
    }
  }

  app_settings = {
    FUNCTIONS_WORKER_RUNTIME    = "node"
    WEBSITE_RUN_FROM_PACKAGE    = "${azurerm_storage_blob.pkg.url}${data.azurerm_storage_account_blob_container_sas.pkg.sas}"
    AzureWebJobsDisableHomepage = "true"
    SHIPDECK_PLATFORM           = "serverless"
  }

  https_only = true
}

output "service_url" {
  value = "https://${azurerm_linux_function_app.app.default_hostname}/api/health"
}

output "function_name" {
  value = azurerm_linux_function_app.app.name
}

output "admin_username" {
  value = ""
}

output "public_ip" {
  value = ""
}
