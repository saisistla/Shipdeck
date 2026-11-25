import { generateKeyPairSync } from "node:crypto";

/**
 * Deploy PEM = SSH private key Shipdeck uses to log into a newly created VM.
 *
 * GCP gives no downloadable .pem (unlike an AWS EC2 key pair), so for GCP
 * connections Shipdeck generates this key pair itself when the operator
 * leaves Deploy PEM blank. The private key is only ever stored encrypted
 * (connection secrets); the public half is derived at Terraform time via
 * `ssh-keygen -y` (see cloud.ts writePublicKeyFromPem).
 */

export function generateDeployPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  return privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`;
}

export function hasDeployPem(secrets: Record<string, string> | undefined): boolean {
  if (!secrets) return false;
  if (secrets.sshPrivateKey?.trim() || secrets.privateKey?.trim()) return true;
  return Boolean(secrets.deployKey && /BEGIN[-\s].*PRIVATE KEY/i.test(secrets.deployKey));
}

/**
 * For GCP connections, ensure a Deploy PEM exists.
 * Returns the secrets to persist plus whether a key was auto-generated.
 * Never overwrites an operator-provided key.
 */
export function withAutoDeployKey(
  type: string,
  secrets: Record<string, string> | undefined
): { secrets: Record<string, string>; generated: boolean } {
  const next = { ...(secrets ?? {}) };
  if (type !== "gcp" || hasDeployPem(next)) {
    return { secrets: next, generated: false };
  }
  next.sshPrivateKey = generateDeployPrivateKey();
  return { secrets: next, generated: true };
}
