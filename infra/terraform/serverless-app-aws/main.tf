terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      # ECS Express Mode (aws_ecs_express_gateway_service) needs provider 6.34+
      version = ">= 6.34.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "api_image" {
  type        = string
  description = "Full ECR image URI for API (tag included)"
}

variable "web_image" {
  type        = string
  description = "Full ECR image URI for web UI (tag included)"
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

variable "db_instance_class" {
  type = string
}

variable "db_engine_version" {
  type        = string
  default     = ""
  description = "Optional Aurora PostgreSQL version. Empty = latest available in this region."
}

variable "aurora_min_capacity" {
  type = number
}

variable "aurora_max_capacity" {
  type = number
}

variable "redis_max_storage_gb" {
  type = number
}

variable "redis_max_ecpu" {
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

data "aws_availability_zones" "available" {
  state = "available"
}

# Region-specific — do not hardcode a patch like 16.6 (missing in some regions).
data "aws_rds_engine_version" "aurora_pg" {
  engine = "aurora-postgresql"
  latest = true
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
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
  name = lower(replace(var.name_prefix, "/[^a-z0-9-]/", "-"))
}

resource "aws_vpc" "app" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = "${local.name}-vpc" }
}

resource "aws_internet_gateway" "app" {
  vpc_id = aws_vpc.app.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.app.id
  cidr_block              = cidrsubnet(aws_vpc.app.cidr_block, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.app.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app.id
  }
  tags = { Name = "${local.name}-rt" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "data" {
  name_prefix = "${local.name}-data-"
  vpc_id      = aws_vpc.app.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.connector.id]
  }
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.connector.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "connector" {
  name_prefix = "${local.name}-conn-"
  vpc_id      = aws_vpc.app.id
  # The load balancer must reach the ports the folder's compose file publishes.
  ingress {
    from_port   = var.api_container_port
    to_port     = var.api_container_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = var.web_container_port
    to_port     = var.web_container_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "app" {
  name       = "${local.name}-db-subnets"
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_rds_cluster" "postgres" {
  cluster_identifier     = "${local.name}-pg"
  engine                 = "aurora-postgresql"
  engine_mode            = "provisioned"
  engine_version         = var.db_engine_version != "" ? var.db_engine_version : data.aws_rds_engine_version.aurora_pg.version
  database_name          = var.db_name
  master_username        = var.db_username
  master_password        = random_password.db.result
  db_subnet_group_name   = aws_db_subnet_group.app.name
  vpc_security_group_ids = [aws_security_group.data.id]
  skip_final_snapshot    = true
  deletion_protection    = false
  backup_retention_period = 1
  apply_immediately      = true
  serverlessv2_scaling_configuration {
    min_capacity = var.aurora_min_capacity
    max_capacity = var.aurora_max_capacity
  }
}

resource "aws_rds_cluster_instance" "postgres" {
  identifier          = "${local.name}-pg-1"
  cluster_identifier  = aws_rds_cluster.postgres.id
  instance_class      = var.db_instance_class
  engine              = aws_rds_cluster.postgres.engine
  engine_version      = aws_rds_cluster.postgres.engine_version
  publicly_accessible = false
}

resource "aws_elasticache_serverless_cache" "redis" {
  engine             = "redis"
  name               = "${local.name}-redis"
  security_group_ids = [aws_security_group.data.id]
  subnet_ids         = aws_subnet.public[*].id
  cache_usage_limits {
    data_storage {
      maximum = var.redis_max_storage_gb
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = var.redis_max_ecpu
    }
  }
}

resource "aws_ecr_repository" "api" {
  name                 = "${local.name}-api"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_repository" "web" {
  name                 = "${local.name}-web"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

variable "source_zip" {
  type        = string
  default     = ""
  description = "Local path to source zip for CodeBuild (empty until Shipdeck packs it)"
}

variable "api_context" {
  type    = string
  default = "."
}

variable "api_dockerfile" {
  type    = string
  default = "Dockerfile"
}

variable "api_target" {
  type    = string
  default = ""
}

variable "web_context" {
  type    = string
  default = "."
}

variable "web_dockerfile" {
  type    = string
  default = "Dockerfile"
}

variable "web_target" {
  type    = string
  default = ""
}

resource "aws_s3_bucket" "src" {
  bucket        = "${local.name}-src"
  force_destroy = true
}

resource "aws_s3_object" "source" {
  count  = var.source_zip != "" ? 1 : 0
  bucket = aws_s3_bucket.src.id
  key    = "source.zip"
  source = var.source_zip
  etag   = filemd5(var.source_zip)
}

resource "aws_iam_role" "codebuild" {
  name = "${local.name}-codebuild"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "codebuild.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "codebuild" {
  name = "${local.name}-codebuild"
  role = aws_iam_role.codebuild.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.src.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
        ]
        Resource = [
          aws_ecr_repository.api.arn,
          aws_ecr_repository.web.arn,
        ]
      },
    ]
  })
}

resource "aws_codebuild_project" "app" {
  name         = "${local.name}-build"
  service_role = aws_iam_role.codebuild.arn
  artifacts {
    type = "NO_ARTIFACTS"
  }
  environment {
    compute_type                = "BUILD_GENERAL1_MEDIUM"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    privileged_mode             = true
    image_pull_credentials_type = "CODEBUILD"
    environment_variable {
      name  = "API_CONTEXT"
      value = var.api_context
    }
    environment_variable {
      name  = "API_DOCKERFILE"
      value = var.api_dockerfile
    }
    dynamic "environment_variable" {
      for_each = var.api_target != "" ? [var.api_target] : []
      content {
        name  = "API_TARGET"
        value = environment_variable.value
      }
    }
    environment_variable {
      name  = "API_BUILD_ARGS"
      value = "{}"
    }
    environment_variable {
      name  = "WEB_CONTEXT"
      value = var.web_context
    }
    environment_variable {
      name  = "WEB_DOCKERFILE"
      value = var.web_dockerfile
    }
    dynamic "environment_variable" {
      for_each = var.web_target != "" ? [var.web_target] : []
      content {
        name  = "WEB_TARGET"
        value = environment_variable.value
      }
    }
    environment_variable {
      name  = "WEB_BUILD_ARGS"
      value = "{}"
    }
    environment_variable {
      name  = "API_REPO"
      value = aws_ecr_repository.api.repository_url
    }
    environment_variable {
      name  = "WEB_REPO"
      value = aws_ecr_repository.web.repository_url
    }
    environment_variable {
      name  = "IMAGE_TAG"
      value = "latest"
    }
    environment_variable {
      name  = "NEXT_PUBLIC_API_URL"
      value = "http://localhost:3000/v1"
    }
    environment_variable {
      name  = "SOURCE_BUCKET"
      value = aws_s3_bucket.src.bucket
    }
    environment_variable {
      name  = "GIT_BRANCH"
      value = "main"
    }
  }
  source {
    type      = "NO_SOURCE"
    buildspec = <<-EOT
      version: 0.2
      phases:
        install:
          commands:
            - echo Preparing workspace
        pre_build:
          commands:
            - echo Logging in to Amazon ECR
            - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $(echo $API_REPO | cut -d/ -f1)
            - |
              if [ -n "$GIT_CLONE_URL" ]; then
                echo "Cloning repo (branch $${GIT_BRANCH:-main})"
                rm -rf /tmp/src
                git clone --depth 1 --branch "$${GIT_BRANCH:-main}" "$GIT_CLONE_URL" /tmp/src
              elif [ -n "$SOURCE_BUCKET" ]; then
                echo "Fetching source zip from S3"
                aws s3 cp "s3://$SOURCE_BUCKET/source.zip" /tmp/source.zip
                mkdir -p /tmp/src && unzip -q /tmp/source.zip -d /tmp/src
              else
                echo "No GIT_CLONE_URL or SOURCE_BUCKET" && exit 1
              fi
        build:
          commands:
            - cd /tmp/src
            - |
              python3 -c "import json,os,subprocess
              def build(prefix):
                  image=os.environ[prefix+'_REPO']+':'+os.environ['IMAGE_TAG']
                  context=os.environ[prefix+'_CONTEXT']
                  dockerfile=os.environ[prefix+'_DOCKERFILE']
                  target=os.environ.get(prefix+'_TARGET') or ''
                  raw=os.environ.get(prefix+'_BUILD_ARGS') or '{}'
                  cmd=['docker','build','-t',image,'-f',context+'/'+dockerfile]
                  if target:
                      cmd += ['--target', target]
                  for k,v in json.loads(raw).items():
                      cmd += ['--build-arg', k+'='+str(v)]
                  cmd.append(context)
                  print('docker build '+image+' from '+context+'/'+dockerfile+((' stage '+target) if target else ''), flush=True)
                  subprocess.check_call(cmd)
              build('API')
              build('WEB')
              "
            - docker push $API_REPO:$IMAGE_TAG
            - docker push $WEB_REPO:$IMAGE_TAG
    EOT
  }
}

output "codebuild_project" {
  value = aws_codebuild_project.app.name
}

output "source_bucket" {
  value = aws_s3_bucket.src.bucket
}

# --- ECS Express Mode (replaces App Runner; AWS recommendation for new customers) ---

resource "aws_ecs_cluster" "app" {
  name = "${local.name}"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/shipdeck/${local.name}/api"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/shipdeck/${local.name}/web"
  retention_in_days = 7
}

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name}-ecs-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_infrastructure" {
  name = "${local.name}-ecs-infra"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowAccessInfrastructureForECSExpressServices"
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_infrastructure" {
  role       = aws_iam_role.ecs_infrastructure.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"
}

locals {
  database_url = "postgresql://${var.db_username}:${random_password.db.result}@${aws_rds_cluster.postgres.endpoint}:5432/${var.db_name}?sslmode=require"
  redis_url    = "redis://${aws_elasticache_serverless_cache.redis.endpoint[0].address}:${aws_elasticache_serverless_cache.redis.endpoint[0].port}"
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

resource "aws_ecs_express_gateway_service" "api" {
  service_name            = "${local.name}-api"
  cluster                 = aws_ecs_cluster.app.name
  execution_role_arn      = aws_iam_role.ecs_execution.arn
  infrastructure_role_arn = aws_iam_role.ecs_infrastructure.arn
  cpu                     = var.cpu
  memory                  = var.memory
  wait_for_steady_state   = true
  health_check_path       = var.api_health_path

  primary_container {
    image          = var.api_image
    container_port = var.api_container_port

    aws_logs_configuration {
      log_group         = aws_cloudwatch_log_group.api.name
      log_stream_prefix = "api"
    }

    dynamic "environment" {
      for_each = local.api_runtime_env
      content {
        name  = environment.key
        value = environment.value
      }
    }
  }

  network_configuration {
    subnets         = aws_subnet.public[*].id
    security_groups = [aws_security_group.connector.id]
  }

  scaling_target {
    auto_scaling_metric       = "AVERAGE_CPU"
    auto_scaling_target_value = "70"
    min_task_count            = 1
    max_task_count            = 2
  }

  depends_on = [
    aws_iam_role_policy_attachment.ecs_execution,
    aws_iam_role_policy_attachment.ecs_infrastructure,
    aws_rds_cluster_instance.postgres,
    aws_elasticache_serverless_cache.redis,
  ]
}

resource "aws_ecs_express_gateway_service" "web" {
  service_name            = "${local.name}-web"
  cluster                 = aws_ecs_cluster.app.name
  execution_role_arn      = aws_iam_role.ecs_execution.arn
  infrastructure_role_arn = aws_iam_role.ecs_infrastructure.arn
  cpu                     = var.cpu
  memory                  = var.memory
  wait_for_steady_state   = true
  health_check_path       = var.web_health_path

  primary_container {
    image          = var.web_image
    container_port = var.web_container_port

    aws_logs_configuration {
      log_group         = aws_cloudwatch_log_group.web.name
      log_stream_prefix = "web"
    }

    dynamic "environment" {
      for_each = merge(
        local.web_runtime_env,
        local.api_url == "" ? {} : { API_ORIGIN = trimsuffix(local.api_url, "/") }
      )
      content {
        name  = environment.key
        value = environment.value
      }
    }
  }

  network_configuration {
    subnets         = aws_subnet.public[*].id
    security_groups = [aws_security_group.connector.id]
  }

  scaling_target {
    auto_scaling_metric       = "AVERAGE_CPU"
    auto_scaling_target_value = "70"
    min_task_count            = 1
    max_task_count            = 2
  }

  depends_on = [
    aws_iam_role_policy_attachment.ecs_execution,
    aws_iam_role_policy_attachment.ecs_infrastructure,
    aws_ecs_express_gateway_service.api,
  ]
}

locals {
  api_endpoint = try(aws_ecs_express_gateway_service.api.ingress_paths[0].endpoint, "")
  api_url      = local.api_endpoint == "" ? "" : (startswith(local.api_endpoint, "http") ? local.api_endpoint : "https://${local.api_endpoint}")
}

locals {
  web_endpoint = try(aws_ecs_express_gateway_service.web.ingress_paths[0].endpoint, "")
  web_url      = local.web_endpoint == "" ? "" : (startswith(local.web_endpoint, "http") ? local.web_endpoint : "https://${local.web_endpoint}")
}

output "service_url" {
  value       = local.web_url
  description = "Public web URL from ECS Express Mode"
}

output "api_url" {
  value = local.api_url
}

output "ecr_api_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecr_web_url" {
  value = aws_ecr_repository.web.repository_url
}

output "function_name" {
  value = ""
}
