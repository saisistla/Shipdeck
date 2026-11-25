# Serverless Full app UI modules

Used when Infra → Serverless → **Full app UI** (`serverlessKind: "app"`).

## Modules

| Cloud | Directory | Runtime | Image build without local Docker |
|-------|-----------|---------|----------------------------------|
| AWS | `serverless-app-aws` | ECR + ECS Express Mode + Aurora Serverless v2 + ElastiCache Serverless | CodeBuild clones Git |
| Azure | `serverless-app-azure` | ACR + Container Apps + PostgreSQL Flexible + Redis | ACR Tasks clones Git |
| GCP | `serverless-app-gcp` | Artifact Registry + Cloud Run + Cloud SQL + Memorystore | Cloud Build clones Git |

## Operator requirements

1. Cloud connection with rights for registry, container service, managed DB/cache, and the cloud builder:
   - AWS: `codebuild:StartBuild`, `codebuild:BatchGetBuilds`
   - Azure: ACR Tasks / `Microsoft.ContainerRegistry/registries/scheduleRun`
   - GCP: Cloud Build API + Artifact Registry writer on the Cloud Build service account
2. Terraform on PATH; `SHIPDECK_TF_APPLY=true` (or UI approve) for apply.
3. **Source = Remote Git** (HTTPS) so the cloud can clone and build. Docker on this PC is optional.
4. Compose services that `build:` an **api** and a **web**/UI image.

## Flow

1. Terraform creates the registry (and AWS CodeBuild / GCP Cloud Build IAM).
2. Images: local Docker, **or** clone Git in CodeBuild / ACR Tasks / Cloud Build.
3. Terraform applies data plane + ECS Express / Container Apps / Cloud Run.
4. Images are rebuilt with `NEXT_PUBLIC_API_URL` when the API URL is known.
5. Verify probes `service_url/`, `service_url/shipper`, and `api_url/v1/health`.

## Health function path

Unchanged: `serverlessKind: "function"` (zip/Lambda — no containers).
