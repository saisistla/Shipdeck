/** Curated VM catalogs per cloud (reliable without live cloud API). */

export interface VmSizeOption {
  id: string;
  label: string;
  vcpu: number;
  ramGb: number;
  /** Rough monthly hint only — not a quote */
  tip?: string;
}

export const AWS_VM_SIZES: VmSizeOption[] = [
  { id: "t3.micro", label: "t3.micro — 2 vCPU · 1 GB", vcpu: 2, ramGb: 1, tip: "Too small for Next.js Docker builds" },
  { id: "t3.small", label: "t3.small — 2 vCPU · 2 GB", vcpu: 2, ramGb: 2, tip: "Light apps only" },
  { id: "t3.medium", label: "t3.medium — 2 vCPU · 4 GB", vcpu: 2, ramGb: 4, tip: "Good default for Compose + API" },
  { id: "t3.large", label: "t3.large — 2 vCPU · 8 GB", vcpu: 2, ramGb: 8, tip: "Recommended for multi-service + Next.js builds" },
  { id: "t3.xlarge", label: "t3.xlarge — 4 vCPU · 16 GB", vcpu: 4, ramGb: 16, tip: "Heavy monorepos / parallel builds" },
  { id: "t3.2xlarge", label: "t3.2xlarge — 8 vCPU · 32 GB", vcpu: 8, ramGb: 32 },
  { id: "m5.large", label: "m5.large — 2 vCPU · 8 GB", vcpu: 2, ramGb: 8 },
  { id: "m5.xlarge", label: "m5.xlarge — 4 vCPU · 16 GB", vcpu: 4, ramGb: 16 },
];

export const AZURE_VM_SIZES: VmSizeOption[] = [
  { id: "Standard_B1s", label: "Standard_B1s — 1 vCPU · 1 GB", vcpu: 1, ramGb: 1, tip: "Too small for Next.js builds" },
  { id: "Standard_B1ms", label: "Standard_B1ms — 1 vCPU · 2 GB", vcpu: 1, ramGb: 2 },
  { id: "Standard_B2s", label: "Standard_B2s — 2 vCPU · 4 GB", vcpu: 2, ramGb: 4, tip: "Good default" },
  { id: "Standard_B2ms", label: "Standard_B2ms — 2 vCPU · 8 GB", vcpu: 2, ramGb: 8, tip: "Recommended for Compose + Next.js" },
  { id: "Standard_B4ms", label: "Standard_B4ms — 4 vCPU · 16 GB", vcpu: 4, ramGb: 16 },
  { id: "Standard_D2s_v3", label: "Standard_D2s_v3 — 2 vCPU · 8 GB", vcpu: 2, ramGb: 8 },
  { id: "Standard_D4s_v3", label: "Standard_D4s_v3 — 4 vCPU · 16 GB", vcpu: 4, ramGb: 16 },
];

export const GCP_VM_SIZES: VmSizeOption[] = [
  { id: "e2-micro", label: "e2-micro — shared · ~1 GB", vcpu: 2, ramGb: 1, tip: "Too small for Next.js builds" },
  { id: "e2-small", label: "e2-small — shared · 2 GB", vcpu: 2, ramGb: 2 },
  { id: "e2-medium", label: "e2-medium — 1–2 vCPU · 4 GB", vcpu: 2, ramGb: 4, tip: "Good default" },
  { id: "e2-standard-2", label: "e2-standard-2 — 2 vCPU · 8 GB", vcpu: 2, ramGb: 8, tip: "Recommended for Compose + Next.js" },
  { id: "e2-standard-4", label: "e2-standard-4 — 4 vCPU · 16 GB", vcpu: 4, ramGb: 16 },
  { id: "n2-standard-2", label: "n2-standard-2 — 2 vCPU · 8 GB", vcpu: 2, ramGb: 8 },
  { id: "n2-standard-4", label: "n2-standard-4 — 4 vCPU · 16 GB", vcpu: 4, ramGb: 16 },
];

export type CloudProviderId = "aws" | "azure" | "gcp";

export function listVmSizesForCloud(provider: CloudProviderId): VmSizeOption[] {
  if (provider === "azure") return AZURE_VM_SIZES;
  if (provider === "gcp") return GCP_VM_SIZES;
  return AWS_VM_SIZES;
}

export function findVmSizeOption(provider: CloudProviderId, id: string | undefined): VmSizeOption | undefined {
  if (!id) return undefined;
  return listVmSizesForCloud(provider).find((s) => s.id === id);
}
