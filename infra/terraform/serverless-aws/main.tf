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

variable "name_prefix" {
  type = string
}

variable "runtime" {
  type    = string
  default = "nodejs20.x"
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
  description = "Path to function deployment zip (built by Shipdeck; prefer relative to TF cwd)"
}

variable "source_code_hash" {
  type        = string
  description = "base64(sha256(zip)) computed by Shipdeck — avoids Windows filebase64sha256 inconsistency"
}

variable "handler" {
  type    = string
  default = "index.handler"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  name               = "${var.name_prefix}-sls-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.fn.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "app" {
  function_name    = "${var.name_prefix}-fn"
  role             = aws_iam_role.fn.arn
  handler          = var.handler
  runtime          = var.runtime
  filename         = var.source_zip
  source_code_hash = var.source_code_hash
  memory_size      = var.memory_mb
  timeout          = var.timeout_seconds

  environment {
    variables = {
      SHIPDECK_PLATFORM = "serverless"
    }
  }

  depends_on = [aws_iam_role_policy_attachment.basic]
}

# Function URLs with AuthType NONE are often 403 when the account
# blocks public Function URL access. HTTP API is the enterprise public HTTPS path.
resource "aws_apigatewayv2_api" "http" {
  name          = "${var.name_prefix}-http"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.app.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "service_url" {
  value = aws_apigatewayv2_stage.default.invoke_url
}

output "function_name" {
  value = aws_lambda_function.app.function_name
}

output "admin_username" {
  value = ""
}

output "public_ip" {
  value = ""
}
