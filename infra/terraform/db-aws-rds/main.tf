terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" { type = string }
variable "name_prefix" { type = string }
variable "key_name" {
  type    = string
  default = ""
}

variable "vpc_cidr" {
  type    = string
  default = "10.43.0.0/16"
}

variable "instance_class" {
  type = string
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "random_password" "db" {
  length  = 20
  special = false
}

# RDS requires a subnet group spanning 2 AZs. Do not depend on a default VPC.
resource "aws_vpc" "shipdeck" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.name_prefix}-db-vpc"
  }
}

resource "aws_internet_gateway" "shipdeck" {
  vpc_id = aws_vpc.shipdeck.id
}

resource "aws_subnet" "a" {
  vpc_id                  = aws_vpc.shipdeck.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 1)
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
}

resource "aws_subnet" "b" {
  vpc_id                  = aws_vpc.shipdeck.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 2)
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = true
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.shipdeck.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.shipdeck.id
  }
}

resource "aws_route_table_association" "a" {
  subnet_id      = aws_subnet.a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "b" {
  subnet_id      = aws_subnet.b.id
  route_table_id = aws_route_table.public.id
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-subnet"
  subnet_ids = [aws_subnet.a.id, aws_subnet.b.id]
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db-sg"
  description = "Shipdeck managed Postgres"
  vpc_id      = aws_vpc.shipdeck.id

  ingress {
    from_port   = 5432
    to_port     = 5432
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

resource "aws_db_instance" "pg" {
  identifier             = substr("${var.name_prefix}-pg", 0, 63)
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = var.instance_class
  allocated_storage      = 20
  db_name                = "app"
  username               = "shipdeck"
  password               = random_password.db.result
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  skip_final_snapshot    = true
  publicly_accessible    = true
}

output "connection_url" {
  sensitive = true
  value     = "postgres://shipdeck:${random_password.db.result}@${aws_db_instance.pg.address}:5432/app"
}
