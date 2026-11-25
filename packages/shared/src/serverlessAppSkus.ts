/**
 * Cloud SKUs for serverless Full app — derived from recommended container memory.
 * Compute comes from provider catalogs (pick by scan/UI memory).
 * Terraform modules take these as variables; they must not bake sizes.
 */

import { recommendVmSize, vmSizeForProvider } from "./vmSizing.js";
import type { CloudProviderId } from "./vmCatalog.js";
import {
  listServerlessComputeForCloud,
  pickServerlessCompute,
} from "./serverlessComputeCatalog.js";

export type { CloudProviderId };

export interface ServerlessAppSkus {
  provider: CloudProviderId;
  memoryMb: number;
  /** ECS Express / Cloud Run cpu string, or Azure CPU cores as decimal string */
  cpu: string;
  memory: string;
  computeOptionId: string;
  dbInstanceClass: string;
  /** Empty = Terraform picks latest Aurora PostgreSQL in the region */
  dbEngineVersion: string;
  auroraMinAcu: number;
  auroraMaxAcu: number;
  redisMaxStorageGb: number;
  redisMaxEcpu: number;
  azurePostgresSku: string;
  azureRedisSku: string;
  azureRedisFamily: string;
  azureRedisCapacity: number;
  azureAcrSku: string;
  gcpDbTier: string;
  gcpRedisTier: string;
  gcpRedisMemoryGb: number;
}

/** Map UI/scan memory → catalog compute option + scaled data plane. */
export function recommendServerlessAppSkus(input: {
  provider: CloudProviderId;
  memoryMb: number;
}): ServerlessAppSkus {
  const provider = input.provider;
  const needMb = input.memoryMb > 0 ? input.memoryMb : 1024;
  const compute = pickServerlessCompute(listServerlessComputeForCloud(provider), needMb);
  const memoryMb = compute.memoryMb;
  const dataTier = memoryMb <= 1024 ? "small" : memoryMb <= 2048 ? "medium" : "large";

  return {
    provider,
    memoryMb,
    cpu: compute.cpu,
    memory: compute.memory,
    computeOptionId: compute.id,
    // Aurora Serverless v2 class name from AWS product (not EC2)
    dbInstanceClass: "db.serverless",
    dbEngineVersion: "",
    auroraMinAcu: 0.5,
    auroraMaxAcu: dataTier === "large" ? 4 : 2,
    redisMaxStorageGb: dataTier === "small" ? 1 : 2,
    redisMaxEcpu: dataTier === "large" ? 5000 : 1000,
    azurePostgresSku:
      dataTier === "small" ? "B_Standard_B1ms" : dataTier === "medium" ? "B_Standard_B2s" : "B_Standard_B2ms",
    azureRedisSku: "Basic",
    azureRedisFamily: "C",
    azureRedisCapacity: dataTier === "small" ? 0 : 1,
    azureAcrSku: "Basic",
    gcpDbTier: dataTier === "small" ? "db-f1-micro" : dataTier === "medium" ? "db-g1-small" : "db-custom-1-3840",
    gcpRedisTier: "BASIC",
    gcpRedisMemoryGb: dataTier === "small" ? 1 : 2,
  };
}

/** Classic Data-box RDS/Cloud SQL class from selected VM size (catalog), not a Terraform literal. */
export function recommendManagedDbSku(input: {
  provider: CloudProviderId;
  vmSize?: string;
  memoryMb?: number;
}): { instanceClass: string; azureSku: string; gcpTier: string } {
  const app = recommendServerlessAppSkus({
    provider: input.provider,
    memoryMb: input.memoryMb && input.memoryMb > 0 ? input.memoryMb : 1024,
  });
  const vm =
    input.vmSize?.trim() ||
    vmSizeForProvider(recommendVmSize({ cloudProvider: input.provider }), input.provider);
  if (input.provider === "aws") {
    return {
      instanceClass: vm.startsWith("db.") ? vm : `db.${vm}`,
      azureSku: app.azurePostgresSku,
      gcpTier: app.gcpDbTier,
    };
  }
  if (input.provider === "azure") {
    const azureSku = vm.startsWith("B_") ? vm : `B_${vm}`;
    return { instanceClass: app.dbInstanceClass, azureSku, gcpTier: app.gcpDbTier };
  }
  return {
    instanceClass: app.dbInstanceClass,
    azureSku: app.azurePostgresSku,
    gcpTier: vm.startsWith("db-") ? vm : app.gcpDbTier,
  };
}

export function serverlessAppTfvarLines(skus: ServerlessAppSkus): string[] {
  if (skus.provider === "aws") {
    return [
      `cpu = "${skus.cpu}"`,
      `memory = "${skus.memory}"`,
      `db_instance_class = "${skus.dbInstanceClass}"`,
      ...(skus.dbEngineVersion ? [`db_engine_version = "${skus.dbEngineVersion}"`] : []),
      `aurora_min_capacity = ${skus.auroraMinAcu}`,
      `aurora_max_capacity = ${skus.auroraMaxAcu}`,
      `redis_max_storage_gb = ${skus.redisMaxStorageGb}`,
      `redis_max_ecpu = ${skus.redisMaxEcpu}`,
    ];
  }
  if (skus.provider === "azure") {
    return [
      `cpu = ${skus.cpu}`,
      `memory = "${skus.memory}"`,
      `db_sku_name = "${skus.azurePostgresSku}"`,
      `redis_sku_name = "${skus.azureRedisSku}"`,
      `redis_family = "${skus.azureRedisFamily}"`,
      `redis_capacity = ${skus.azureRedisCapacity}`,
      `acr_sku = "${skus.azureAcrSku}"`,
    ];
  }
  return [
    `cpu = "${skus.cpu}"`,
    `memory = "${skus.memory}"`,
    `db_tier = "${skus.gcpDbTier}"`,
    `redis_tier = "${skus.gcpRedisTier}"`,
    `redis_memory_gb = ${skus.gcpRedisMemoryGb}`,
  ];
}
