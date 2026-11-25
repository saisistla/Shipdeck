import { getConnection, getSecrets } from "./connections.js";
import { commandExists, runCommand } from "./exec.js";

interface ArmPublicIp {
  id?: string;
  properties?: {
    ipAddress?: string;
    ipConfiguration?: { id?: string };
  };
}

interface ArmNic {
  properties?: {
    networkSecurityGroup?: { id?: string };
    ipConfigurations?: Array<{
      properties?: {
        subnet?: { id?: string };
        publicIPAddress?: { id?: string };
      };
    }>;
  };
}

interface ArmSubnet {
  properties?: { networkSecurityGroup?: { id?: string } };
}

interface ArmNsgRule {
  name?: string;
  properties?: {
    protocol?: string;
    destinationPortRange?: string;
    destinationPortRanges?: string[];
    direction?: string;
    access?: string;
    priority?: number;
    sourceAddressPrefix?: string;
    destinationAddressPrefix?: string;
    sourcePortRange?: string;
  };
}

interface ArmNsg {
  id?: string;
  location?: string;
  properties?: { securityRules?: ArmNsgRule[] };
}

function armGet<T>(token: string, url: string): Promise<T> {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body as { error?: { message?: string } }).error?.message || `Azure GET ${res.status}`);
    }
    return body as T;
  });
}

function armPut<T>(token: string, url: string, body: unknown): Promise<T> {
  return fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).then(async (res) => {
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((json as { error?: { message?: string } }).error?.message || `Azure PUT ${res.status}`);
    }
    return json as T;
  });
}

async function azureToken(opts: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    scope: "https://management.azure.com/.default",
  });
  const res = await fetch(`https://login.microsoftonline.com/${opts.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || "Azure login failed");
  }
  return json.access_token;
}

function nicIdFromIpConfig(ipConfigId?: string): string | null {
  if (!ipConfigId) return null;
  const idx = ipConfigId.toLowerCase().indexOf("/ipconfigurations/");
  if (idx < 0) return null;
  return ipConfigId.slice(0, idx);
}

function ruleCoversPort(rule: ArmNsgRule, port: number): boolean {
  const p = rule.properties;
  if (!p || p.direction?.toLowerCase() !== "inbound") return false;
  if (p.access?.toLowerCase() !== "allow") return false;
  const proto = (p.protocol || "*").toLowerCase();
  if (proto !== "tcp" && proto !== "*") return false;
  if (p.destinationPortRange === "*" || p.destinationPortRange === String(port)) return true;
  if (p.destinationPortRanges?.some((r) => r === String(port) || r === "*")) return true;
  if (p.destinationPortRange?.includes("-")) {
    const [a, b] = p.destinationPortRange.split("-").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && port >= a && port <= b) return true;
  }
  return false;
}

function nextPriority(rules: ArmNsgRule[]): number {
  const used = new Set(rules.map((r) => r.properties?.priority).filter((n): n is number => typeof n === "number"));
  for (let p = 1100; p < 4096; p += 10) {
    if (!used.has(p)) return p;
  }
  return 3000;
}

async function addRulesToNsg(token: string, nsgId: string, ports: number[], log: (l: string) => void) {
  const nsg = await armGet<ArmNsg>(
    token,
    `https://management.azure.com${nsgId}?api-version=2023-09-01`
  );
  const rules = [...(nsg.properties?.securityRules ?? [])];
  const added: number[] = [];
  for (const port of ports) {
    if (rules.some((r) => ruleCoversPort(r, port))) {
      log(`Azure NSG already allows ${port}`);
      continue;
    }
    const priority = nextPriority(rules);
    rules.push({
      name: `shipdeck-public-${port}`,
      properties: {
        protocol: "Tcp",
        sourcePortRange: "*",
        destinationPortRange: String(port),
        sourceAddressPrefix: "*",
        destinationAddressPrefix: "*",
        access: "Allow",
        priority,
        direction: "Inbound",
      },
    });
    added.push(port);
    log(`Azure NSG add inbound TCP ${port} (priority ${priority})`);
  }
  if (added.length === 0) return { added };
  await armPut(token, `https://management.azure.com${nsgId}?api-version=2023-09-01`, {
    location: nsg.location,
    properties: { securityRules: rules },
  });
  return { added };
}

export async function openAzureNsgPorts(opts: {
  cloudConnectionId?: string;
  publicIp: string;
  ports: number[];
  log: (line: string) => void;
}): Promise<{ ok: boolean; message: string; opened: number[] }> {
  const opened: number[] = [];
  if (opts.ports.length === 0) {
    return { ok: true, message: "No public ports to open", opened };
  }

  const conn = getConnection(opts.cloudConnectionId);
  const secrets = getSecrets(opts.cloudConnectionId);
  const tenantId = secrets.tenantId || conn?.config.tenantId;
  const clientId = secrets.clientId;
  const clientSecret = secrets.clientSecret;
  const subscriptionId = secrets.subscriptionId || conn?.config.subscriptionId;

  if (conn?.type === "azure" && tenantId && clientId && clientSecret && subscriptionId) {
    opts.log("Opening Azure NSG via cloud connection");
    const token = await azureToken({ tenantId, clientId, clientSecret });
    const list = await armGet<{ value?: ArmPublicIp[] }>(
      token,
      `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Network/publicIPAddresses?api-version=2023-09-01`
    );
    const match = (list.value ?? []).find((p) => p.properties?.ipAddress === opts.publicIp);
    if (!match) {
      return {
        ok: false,
        message: `No Azure public IP resource found for ${opts.publicIp} in this subscription`,
        opened,
      };
    }
    const nicId = nicIdFromIpConfig(match.properties?.ipConfiguration?.id);
    if (!nicId) {
      return { ok: false, message: "Public IP is not attached to a network interface", opened };
    }
    const nic = await armGet<ArmNic>(token, `https://management.azure.com${nicId}?api-version=2023-09-01`);
    let nsgId = nic.properties?.networkSecurityGroup?.id;
    if (!nsgId) {
      const subnetId = nic.properties?.ipConfigurations?.[0]?.properties?.subnet?.id;
      if (subnetId) {
        const subnet = await armGet<ArmSubnet>(
          token,
          `https://management.azure.com${subnetId}?api-version=2023-09-01`
        );
        nsgId = subnet.properties?.networkSecurityGroup?.id;
      }
    }
    if (!nsgId) {
      return {
        ok: false,
        message: "This VM has no Network Security Group. Attach an NSG in Azure Portal, or open the ports there.",
        opened,
      };
    }
    const result = await addRulesToNsg(token, nsgId, opts.ports, opts.log);
    return {
      ok: true,
      message:
        result.added.length > 0
          ? `Azure NSG opened: ${result.added.join(", ")}`
          : "Azure NSG already allowed those ports",
      opened: result.added,
    };
  }

  if (await commandExists("az")) {
    opts.log("Trying Azure CLI (az) to open NSG");
    const listed = await runCommand(
      "az",
      ["network", "public-ip", "list", "--query", `[?ipAddress=='${opts.publicIp}']`, "-o", "json"],
      { timeoutMs: 60_000 }
    );
    if (listed.code === 0 && listed.stdout.trim().startsWith("[")) {
      const arr = JSON.parse(listed.stdout) as ArmPublicIp[];
      const match = arr[0];
      const ipConfig = match?.properties?.ipConfiguration?.id;
      const nicId = nicIdFromIpConfig(ipConfig);
      if (nicId) {
        const nicShow = await runCommand("az", ["network", "nic", "show", "--ids", nicId, "-o", "json"], {
          timeoutMs: 60_000,
        });
        if (nicShow.code === 0) {
          const nic = JSON.parse(nicShow.stdout) as ArmNic & {
            networkSecurityGroup?: { id?: string };
            ipConfigurations?: Array<{ subnet?: { id?: string } }>;
          };
          const nsgId =
            nic.properties?.networkSecurityGroup?.id ||
            nic.networkSecurityGroup?.id ||
            "";
          if (nsgId) {
            const parts = nsgId.split("/");
            const rg = parts[parts.indexOf("resourceGroups") + 1];
            const nsgName = parts[parts.length - 1];
            for (const port of opts.ports) {
              const add = await runCommand(
                "az",
                [
                  "network",
                  "nsg",
                  "rule",
                  "create",
                  "--resource-group",
                  rg,
                  "--nsg-name",
                  nsgName,
                  "--name",
                  `shipdeck-public-${port}`,
                  "--priority",
                  String(1100 + (port % 200)),
                  "--direction",
                  "Inbound",
                  "--access",
                  "Allow",
                  "--protocol",
                  "Tcp",
                  "--destination-port-ranges",
                  String(port),
                  "--source-address-prefixes",
                  "*",
                  "--destination-address-prefixes",
                  "*",
                ],
                { timeoutMs: 60_000 }
              );
              opts.log(add.stdout || add.stderr);
              if (add.code === 0) opened.push(port);
            }
            if (opened.length) {
              return { ok: true, message: `Azure CLI opened NSG ports: ${opened.join(", ")}`, opened };
            }
          }
        }
      }
    }
  }

  return {
    ok: false,
    message:
      "Could not change Azure NSG automatically. Add an Azure connection (subscription + app login), or open the public ports in Azure Portal → VM → Networking.",
    opened,
  };
}
