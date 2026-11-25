terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
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
  type = number
}

variable "memory" {
  type = string
}

variable "db_sku_name" {
  type = string
}

variable "redis_sku_name" {
  type = string
}

variable "redis_family" {
  type = string
}

variable "redis_capacity" {
  type = number
}

variable "acr_sku" {
  type = string
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
  name = substr(replace(lower(var.name_prefix), "/[^a-z0-9]/", ""), 0, 20)
}

resource "azurerm_resource_group" "app" {
  name     = "${local.name}-rg"
  location = var.region
}

resource "azurerm_container_registry" "app" {
  name                = "${local.name}acr"
  resource_group_name = azurerm_resource_group.app.name
  location            = azurerm_resource_group.app.location
  sku                 = var.acr_sku
  admin_enabled       = true
}

resource "azurerm_postgresql_flexible_server" "app" {
  name                   = "${local.name}-pg"
  resource_group_name    = azurerm_resource_group.app.name
  location               = azurerm_resource_group.app.location
  version                = "16"
  administrator_login    = var.db_username
  administrator_password = random_password.db.result
  storage_mb             = 32768
  sku_name               = var.db_sku_name
  zone                   = "1"
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = var.db_name
  server_id = azurerm_postgresql_flexible_server.app.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure" {
  name             = "AllowAzureServices"
  server_id        = azurerm_postgresql_flexible_server.app.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_redis_cache" "app" {
  name                = "${local.name}-redis"
  location            = azurerm_resource_group.app.location
  resource_group_name = azurerm_resource_group.app.name
  capacity            = var.redis_capacity
  family              = var.redis_family
  sku_name            = var.redis_sku_name
  minimum_tls_version = "1.2"
}

resource "azurerm_log_analytics_workspace" "app" {
  name                = "${local.name}-logs"
  location            = azurerm_resource_group.app.location
  resource_group_name = azurerm_resource_group.app.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_container_app_environment" "app" {
  name                       = "${local.name}-env"
  location                   = azurerm_resource_group.app.location
  resource_group_name        = azurerm_resource_group.app.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.app.id
}

locals {
  database_url = "postgresql://${var.db_username}:${random_password.db.result}@${azurerm_postgresql_flexible_server.app.fqdn}:5432/${var.db_name}?schema=public&sslmode=require"
  redis_url    = "rediss://:${azurerm_redis_cache.app.primary_access_key}@${azurerm_redis_cache.app.hostname}:6380"
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

resource "azurerm_container_app" "api" {
  name                         = "${local.name}-api"
  container_app_environment_id = azurerm_container_app_environment.app.id
  resource_group_name          = azurerm_resource_group.app.name
  revision_mode                = "Single"

  registry {
    server               = azurerm_container_registry.app.login_server
    username             = azurerm_container_registry.app.admin_username
    password_secret_name = "acr-password"
  }

  secret {
    name  = "acr-password"
    value = azurerm_container_registry.app.admin_password
  }

  secret {
    name  = "database-url"
    value = local.database_url
  }

  secret {
    name  = "redis-url"
    value = local.redis_url
  }

  secret {
    name  = "jwt-secret"
    value = local.jwt
  }

  template {
    min_replicas = 1
    max_replicas = 2
    container {
      name   = "api"
      image  = var.api_image
      cpu    = var.cpu
      memory = var.memory
      dynamic "env" {
        for_each = local.api_runtime_env
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.api_container_port
    transport        = "http"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  depends_on = [
    azurerm_postgresql_flexible_server_database.app,
    azurerm_redis_cache.app,
  ]
}

resource "azurerm_container_app" "web" {
  name                         = "${local.name}-web"
  container_app_environment_id = azurerm_container_app_environment.app.id
  resource_group_name          = azurerm_resource_group.app.name
  revision_mode                = "Single"

  registry {
    server               = azurerm_container_registry.app.login_server
    username             = azurerm_container_registry.app.admin_username
    password_secret_name = "acr-password"
  }

  secret {
    name  = "acr-password"
    value = azurerm_container_registry.app.admin_password
  }

  template {
    min_replicas = 1
    max_replicas = 2
    container {
      name   = "web"
      image  = var.web_image
      cpu    = var.cpu
      memory = var.memory
      dynamic "env" {
        for_each = merge(local.web_runtime_env, {
          API_ORIGIN = "https://${azurerm_container_app.api.ingress[0].fqdn}"
        })
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.web_container_port
    transport        = "http"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  depends_on = [azurerm_container_app.api]
}

output "service_url" {
  value = "https://${azurerm_container_app.web.ingress[0].fqdn}"
}

output "api_url" {
  value = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

output "ecr_api_url" {
  value = "${azurerm_container_registry.app.login_server}/${local.name}-api"
}

output "ecr_web_url" {
  value = "${azurerm_container_registry.app.login_server}/${local.name}-web"
}

output "registry_login_server" {
  value = azurerm_container_registry.app.login_server
}

output "registry_username" {
  value = azurerm_container_registry.app.admin_username
}

output "registry_password" {
  value     = azurerm_container_registry.app.admin_password
  sensitive = true
}

output "function_name" {
  value = ""
}

output "resource_group_name" {
  value = azurerm_resource_group.app.name
}

output "registry_name" {
  value = azurerm_container_registry.app.name
}
