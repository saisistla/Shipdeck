# Shipdeck

ADF-style **visual DevOps delivery platform**. Configure Source → Infra → Build → Data → Deploy → Verify → Notify, connect Git/Docker/SSH/Cloud, and run delivery with one click.

## Monorepo

```
apps/web              Visual pipeline UI (React + Vite)
apps/api              API + orchestrator + live/simulate adapters
packages/shared       Shared TypeScript types
examples/demo-app     Sample Node app + Dockerfile for live local runs
infra/terraform       VM + serverless (function) + serverless-app (full UI) modules
data/                 Persisted projects, pipelines, runs + encrypted secrets
deploy/               Nginx config for composed web+api
```

## Quick start (dev)

```bash
cd visual-devops-platform
npm install
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:5173
```

## Docker (platform itself)

```bash
docker compose up --build
# UI http://localhost:8088  · API http://localhost:4000
```

Optional env: `SHIPDECK_API_TOKEN`, `SHIPDECK_SECRETS_KEY`, `SHIPDECK_SIMULATE`, `SHIPDECK_TF_APPLY`.

### Simulate vs LIVE

In the UI, use **Simulate mode**:

- **ON (default)** — full pipeline without touching servers
- **OFF (LIVE)** — real adapters:
  - Source: local path **or remote git clone** (Git connection `url` + optional token)
  - Infra existing: real SSH probe + Docker install attempt
  - Infra create: Terraform init/plan with **cloud connection credentials**; apply if `SHIPDECK_TF_APPLY=true`
  - Build: `docker build` + optional **registry push**
  - Data: Docker provision Postgres/MySQL/Redis/Mongo (local or remote SSH)
  - Deploy: Docker / Compose / systemd / Kubernetes
  - Verify: HTTP health + **auto-rollback** to previous container
  - Notify: webhook POST

## Architecture notes

- **Persistence**: JSON files in `data/` by default, or **PostgreSQL** when `DATABASE_URL` is set (compose includes Postgres)
- **Auth / RBAC**: optional `SHIPDECK_API_TOKEN` or users (`admin` / `operator` / `viewer`); UI token in Run history
- **Approvals**: Terraform plan pauses for Approve/Reject; optional approve-before-deploy gate
- **TF apply**: toggle in UI (`tfApply`) or `SHIPDECK_TF_APPLY=true`
- **Managed DBs**: Data box → provision mode **Managed cloud (Terraform)** (Azure Flexible Server / AWS RDS / GCP Cloud SQL)
- **Hardening**: rate limiting, audit log (`data/audit.jsonl` + optional PG), secret rotate via `PATCH /api/connections/:id/secrets`
- **CI**: `.github/workflows/ci.yml` runs build + tests

### Tests

```bash
npm test
```

### Live local demo (recommended first)

1. Install Docker Desktop
2. Open UI → uncheck **Simulate mode**
3. Source already points at `examples/demo-app`
4. Infra = **Skip**
5. Click **Run pipeline**
6. App should answer at http://127.0.0.1:8080/health

### Live remote server

1. Connections → add SSH (host, user, paste private key as secret)
2. Infra = **Use existing server**, select SSH connection
3. Simulate OFF → Run

### Terraform create

1. Install Terraform + add an Azure/AWS/GCP connection (credentials in secrets)
2. Infra = **Create new**, pick cloud + connection
3. Live run executes `terraform plan`
4. Set `SHIPDECK_TF_APPLY=true` to allow apply

### Serverless modes (Create → Compute target = Serverless)

Two kinds under Infra (Create VM path is unchanged):

| Kind | What you get | Needs on Shipdeck host |
|------|----------------|-------------------------|
| **Health function** (default) | Lambda / Azure Functions / Cloud Functions returning health JSON | Terraform + cloud credentials |
| **Full app UI** | App Runner / Container Apps / Cloud Run + managed Postgres/Redis; HTTPS URL with real UI (e.g. `/shipper`) | Terraform + cloud credentials. **Remote Git** — images built by AWS CodeBuild / Azure ACR Tasks / GCP Cloud Build (Docker on this PC optional). |

- Detect suggests **Full app UI** when compose has api + web-like services (ShareHaul-class).
- Full app builds images from compose Docker contexts, pushes to ECR/ACR/Artifact Registry, then applies `infra/terraform/serverless-app-*`.
- Tear down uses the same Terraform workspace (containers + managed data for that run).
- See [infra/terraform/README-serverless-app.md](infra/terraform/README-serverless-app.md).
