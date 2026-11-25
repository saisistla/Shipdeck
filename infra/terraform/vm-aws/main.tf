terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type = string
}

variable "vm_size" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "key_name" {
  type    = string
  default = ""
}

variable "ssh_public_key" {
  type        = string
  description = "Path to OpenSSH public key (from Deploy PEM). When set with manage_key_pair, Terraform imports it."
  default     = ""
}

variable "manage_key_pair" {
  type        = bool
  description = "Create/import aws_key_pair in this region from ssh_public_key (recommended)."
  default     = false
}

variable "cloud_init_path" {
  type        = string
  description = "Path to cloud-init script that installs Docker"
}

variable "app_ports" {
  type        = list(number)
  default     = []
  description = "Public app ports derived from the pipeline (deploy/compose ports). Baseline SSH/HTTP/HTTPS are always open; app ports are never hardcoded."
}

# Import key material into the target region so Create VM does not require a
# pre-existing EC2 key pair name (fixes InvalidKeyPair.NotFound).
resource "aws_key_pair" "shipdeck" {
  count = var.manage_key_pair && var.ssh_public_key != "" ? 1 : 0

  key_name   = var.key_name != "" ? "${local.name_prefix}-${var.key_name}" : "${local.name_prefix}-key"
  public_key = file(var.ssh_public_key)
}

locals {
  instance_key_name = var.manage_key_pair && length(aws_key_pair.shipdeck) > 0 ? aws_key_pair.shipdeck[0].key_name : var.key_name
  # Standardized naming (all clouds): lowercase, hyphen-safe — even if a caller passes mixed case.
  name_prefix = trim(substr(replace(lower(var.name_prefix), "/[^a-z0-9-]/", "-"), 0, 63), "-")
  # App ports from the pipeline, minus baseline ports that already have rules.
  app_ports = [for p in distinct(var.app_ports) : p if !contains([22, 80, 443], p)]
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "10.42.1.0/24"
}

variable "disk_gb" {
  type        = number
  default     = 40
  description = "Root volume size. Default AMI is ~8GB — too small for compose/Next.js Docker builds."
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

# Accounts without a default VPC fail SG/instance create. Always provision
# a small dedicated public VPC so Create VM works in any region.
resource "aws_vpc" "shipdeck" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_internet_gateway" "shipdeck" {
  vpc_id = aws_vpc.shipdeck.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "shipdeck_public" {
  vpc_id                  = aws_vpc.shipdeck.id
  cidr_block              = var.subnet_cidr
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.name_prefix}-public"
  }
}

resource "aws_route_table" "shipdeck_public" {
  vpc_id = aws_vpc.shipdeck.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.shipdeck.id
  }

  tags = {
    Name = "${local.name_prefix}-rt"
  }
}

resource "aws_route_table_association" "shipdeck_public" {
  subnet_id      = aws_subnet.shipdeck_public.id
  route_table_id = aws_route_table.shipdeck_public.id
}

resource "aws_security_group" "sg" {
  name        = "${local.name_prefix}-sg"
  description = "Shipdeck VM"
  vpc_id      = aws_vpc.shipdeck.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # One rule per app port supplied by the pipeline (dynamic — not hardcoded).
  dynamic "ingress" {
    for_each = toset(local.app_ports)
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
      description = "Shipdeck app port ${ingress.value}"
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-sg"
  }
}

resource "aws_instance" "vm" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.vm_size
  subnet_id                   = aws_subnet.shipdeck_public.id
  vpc_security_group_ids      = [aws_security_group.sg.id]
  key_name                    = local.instance_key_name
  user_data                   = file(var.cloud_init_path)
  associate_public_ip_address = true

  root_block_device {
    volume_size           = var.disk_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name = "${local.name_prefix}-vm"
  }

  depends_on = [aws_route_table_association.shipdeck_public]
}

output "public_ip" {
  value = aws_instance.vm.public_ip
}

output "admin_username" {
  value = "ubuntu"
}

output "vpc_id" {
  value = aws_vpc.shipdeck.id
}
