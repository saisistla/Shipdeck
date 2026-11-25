export type ConnectionType =
  | "git"
  | "jira"
  | "model"
  | "ssh"
  | "azure"
  | "aws"
  | "gcp"
  | "docker"
  | "registry"
  | "kubernetes"
  | "notify";

export type ConnectionFolder = "build" | "deploy";

/** Tickets, Git, and model vendors — used while building a change. */
export const BUILD_CONNECTION_TYPES: ConnectionType[] = ["jira", "git", "model"];

/** Hosts and clouds — used when releasing that change. */
export const DEPLOY_CONNECTION_TYPES: ConnectionType[] = [
  "ssh",
  "aws",
  "azure",
  "gcp",
  "docker",
  "registry",
  "kubernetes",
  "notify",
];

export const TARGET_CONNECTION_TYPES: ConnectionType[] = ["ssh", "aws", "azure", "gcp"];

export function connectionFolder(type: ConnectionType): ConnectionFolder {
  return BUILD_CONNECTION_TYPES.includes(type) ? "build" : "deploy";
}

export function typesForFolder(folder: ConnectionFolder): ConnectionType[] {
  return folder === "build" ? BUILD_CONNECTION_TYPES : DEPLOY_CONNECTION_TYPES;
}

export function isTargetConnectionType(type: string): type is "ssh" | "aws" | "azure" | "gcp" {
  return TARGET_CONNECTION_TYPES.includes(type as ConnectionType);
}
