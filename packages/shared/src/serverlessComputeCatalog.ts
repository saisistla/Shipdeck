/**
 * Provider-published compute configs for managed containers.
 * Pick from the catalog by scan/UI memory — do not invent CPU/memory pairs.
 *
 * Sources: Amazon ECS Express Mode / Fargate task sizes; Azure Container Apps;
 * GCP Cloud Run common CPU/memory pairs.
 */

export interface ServerlessComputeOption {
  id: string;
  /** Provider tfvar cpu string / number as string */
  cpu: string;
  /** Provider tfvar memory string */
  memory: string;
  memoryMb: number;
}

/**
 * AWS ECS Express Mode task sizes (cpu units / memory MiB).
 * Valid Fargate-style pairs used by Express Gateway services.
 */
export const AWS_ECS_EXPRESS_SIZES: ServerlessComputeOption[] = [
  { id: "ecs-express-256-512", cpu: "256", memory: "512", memoryMb: 512 },
  { id: "ecs-express-256-1024", cpu: "256", memory: "1024", memoryMb: 1024 },
  { id: "ecs-express-512-1024", cpu: "512", memory: "1024", memoryMb: 1024 },
  { id: "ecs-express-512-2048", cpu: "512", memory: "2048", memoryMb: 2048 },
  { id: "ecs-express-1024-2048", cpu: "1024", memory: "2048", memoryMb: 2048 },
  { id: "ecs-express-1024-4096", cpu: "1024", memory: "4096", memoryMb: 4096 },
  { id: "ecs-express-2048-4096", cpu: "2048", memory: "4096", memoryMb: 4096 },
  { id: "ecs-express-2048-8192", cpu: "2048", memory: "8192", memoryMb: 8192 },
];

/** @deprecated Use AWS_ECS_EXPRESS_SIZES — App Runner is closed to new customers. */
export const AWS_APP_RUNNER_SIZES = AWS_ECS_EXPRESS_SIZES;

/** Azure Container Apps common CPU / memory. */
export const AZURE_CONTAINER_APP_SIZES: ServerlessComputeOption[] = [
  { id: "aca-0.25-0.5Gi", cpu: "0.25", memory: "0.5Gi", memoryMb: 512 },
  { id: "aca-0.5-1Gi", cpu: "0.5", memory: "1Gi", memoryMb: 1024 },
  { id: "aca-1-2Gi", cpu: "1", memory: "2Gi", memoryMb: 2048 },
  { id: "aca-2-4Gi", cpu: "2", memory: "4Gi", memoryMb: 4096 },
];

/** GCP Cloud Run common CPU / memory. */
export const GCP_CLOUD_RUN_SIZES: ServerlessComputeOption[] = [
  { id: "run-1-512Mi", cpu: "1", memory: "512Mi", memoryMb: 512 },
  { id: "run-1-1Gi", cpu: "1", memory: "1Gi", memoryMb: 1024 },
  { id: "run-2-2Gi", cpu: "2", memory: "2Gi", memoryMb: 2048 },
  { id: "run-2-4Gi", cpu: "2", memory: "4Gi", memoryMb: 4096 },
];

/** Smallest catalog entry whose memoryMb >= need (prefer lower CPU when ties). */
export function pickServerlessCompute(
  catalog: ServerlessComputeOption[],
  memoryMb: number
): ServerlessComputeOption {
  const need = memoryMb > 0 ? memoryMb : 1024;
  const sorted = [...catalog].sort(
    (a, b) => a.memoryMb - b.memoryMb || Number(a.cpu) - Number(b.cpu)
  );
  return sorted.find((o) => o.memoryMb >= need) ?? sorted[sorted.length - 1]!;
}

export function listServerlessComputeForCloud(
  provider: "aws" | "azure" | "gcp"
): ServerlessComputeOption[] {
  if (provider === "aws") return AWS_ECS_EXPRESS_SIZES;
  if (provider === "azure") return AZURE_CONTAINER_APP_SIZES;
  return GCP_CLOUD_RUN_SIZES;
}
