import { splitPublishPorts, type PipelineBoxes } from "@shipdeck/shared";
import { detectComposeFromDir } from "./composeDetect.js";
import { getSecrets, resolveSshTarget } from "./connections.js";
import { openAzureNsgPorts } from "./azureNsg.js";
import { sshExec } from "./ssh.js";

export interface OpenPortsResult {
  ok: boolean;
  publicPorts: number[];
  privatePorts: number[];
  nsg?: { ok: boolean; message: string };
  hostFirewall?: { ok: boolean; message: string };
  message: string;
  logs: string[];
}

function sudoPrefix(password?: string): string {
  if (!password) return "sudo -n";
  const b64 = Buffer.from(password, "utf8").toString("base64");
  return `echo ${b64} | base64 -d | sudo -S -p ''`;
}

export function portsForPipeline(boxes: PipelineBoxes): {
  publicPorts: number[];
  privatePorts: number[];
} {
  const composePorts: number[] = [];
  const local = boxes.source.localPath?.trim();
  if (boxes.source.mode === "local" && local) {
    const compose = detectComposeFromDir(local);
    compose?.services.forEach((s) => composePorts.push(...s.ports));
  }
  return splitPublishPorts(composePorts, [boxes.deploy.port]);
}

export async function openPublicPorts(boxes: PipelineBoxes): Promise<OpenPortsResult> {
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const { publicPorts, privatePorts } = portsForPipeline(boxes);

  if (publicPorts.length === 0) {
    return {
      ok: false,
      publicPorts,
      privatePorts,
      message: "No public app ports found to open",
      logs,
    };
  }

  log(`Public ports (UI/API): ${publicPorts.join(", ")}`);
  if (privatePorts.length) {
    log(`Kept closed (database/cache/SSH): ${privatePorts.join(", ")}`);
  }

  const ssh = resolveSshTarget(boxes.infra.sshConnectionId);
  const host = ssh?.host;
  let nsg: OpenPortsResult["nsg"];
  let hostFirewall: OpenPortsResult["hostFirewall"];

  if (host && (boxes.infra.cloudProvider === "azure" || boxes.infra.cloudConnectionId)) {
    try {
      nsg = await openAzureNsgPorts({
        cloudConnectionId: boxes.infra.cloudConnectionId,
        publicIp: host,
        ports: publicPorts,
        log,
      });
    } catch (err) {
      nsg = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
      log(`Azure NSG error: ${nsg.message}`);
    }
  } else if (host) {
    try {
      nsg = await openAzureNsgPorts({
        cloudConnectionId: boxes.infra.cloudConnectionId,
        publicIp: host,
        ports: publicPorts,
        log,
      });
    } catch (err) {
      nsg = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (ssh) {
    const secrets = getSecrets(boxes.infra.sshConnectionId);
    const sudo = sudoPrefix(secrets.password);
    const ufwAllows = publicPorts.map((p) => `${sudo} ufw allow ${p}/tcp`).join(" ; ");
    const iptables = publicPorts
      .map(
        (p) =>
          `${sudo} iptables -C INPUT -p tcp --dport ${p} -j ACCEPT 2>/dev/null || ${sudo} iptables -I INPUT -p tcp --dport ${p} -j ACCEPT`
      )
      .join(" ; ");
    const remote = `set +e; if command -v ufw >/dev/null 2>&1; then ${ufwAllows}; ${sudo} ufw status | head -n 25; fi; ${iptables}; echo HOST_FIREWALL_DONE`;
    log(`Updating VM OS firewall for TCP ${publicPorts.join(", ")}`);
    try {
      const result = await sshExec(ssh, remote, (line) => {
        if (/\[sudo\]|password/i.test(line)) return;
        log(line);
      });
      hostFirewall = {
        ok: result.stdout.includes("HOST_FIREWALL_DONE"),
        message: result.stdout.includes("HOST_FIREWALL_DONE")
          ? `VM firewall updated for ${publicPorts.join(", ")}`
          : "Could not change VM firewall (the deploy user may need passwordless sudo)",
      };
    } catch (err) {
      hostFirewall = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    hostFirewall = { ok: false, message: "No SSH connection selected in Infra" };
  }

  const nsgOk = nsg?.ok === true;
  const fwOk = hostFirewall?.ok === true;
  const ok = nsgOk || fwOk;
  const bits = [
    nsgOk ? nsg?.message : nsg?.message ? `NSG: ${nsg.message}` : "",
    fwOk ? hostFirewall?.message : hostFirewall?.message ? `VM firewall: ${hostFirewall.message}` : "",
  ].filter(Boolean);
  const message = ok
    ? `Opened public ports ${publicPorts.join(", ")}. ${bits.join(" · ")}`
    : `Could not fully open ports ${publicPorts.join(", ")}. ${bits.join(" · ")}`;

  return { ok, publicPorts, privatePorts, nsg, hostFirewall, message, logs };
}
