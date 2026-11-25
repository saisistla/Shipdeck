import fs from "node:fs";
import path from "node:path";
import { awsJsonCall } from "./awsJson.js";
import { resolveCloudContext } from "./cloud.js";

const MAX_LINES = 40;

export function readAwsServiceNames(tfvars: string): { region: string; name: string } | null {
  const region = /^region\s*=\s*"([^"]+)"/m.exec(tfvars)?.[1]?.trim();
  const name = /^name_prefix\s*=\s*"([^"]+)"/m.exec(tfvars)?.[1]?.trim();
  if (!region || !name) return null;
  return { region, name };
}

export function stateHasEcsExpress(stateJson: string): boolean {
  try {
    const parsed = JSON.parse(stateJson) as { resources?: Array<{ type?: string }> };
    return (parsed.resources ?? []).some((r) => r.type === "aws_ecs_express_gateway_service");
  } catch {
    return false;
  }
}

function clip(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 280 ? `${oneLine.slice(0, 277)}...` : oneLine;
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

export function formatServiceEvents(serviceName: string, events: Array<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  for (const event of events.slice(0, 8)) {
    const message = clip(String(event.message ?? ""));
    if (message) lines.push(`[rollback] ${serviceName}: ${message}`);
  }
  return lines;
}

export function formatStoppedTasks(tasks: Array<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  for (const task of tasks.slice(0, 3)) {
    const stopped = clip(String(task.stoppedReason ?? task.StoppedReason ?? ""));
    const code = clip(String(task.stopCode ?? task.StopCode ?? ""));
    if (stopped || code) {
      lines.push(`[rollback] Task stopped${code ? ` (${code})` : ""}: ${stopped || "no reason recorded"}`);
    }
    const containers = asRecords(task.containers ?? task.Containers);
    for (const container of containers) {
      const name = String(container.name ?? container.Name ?? "container");
      const reason = clip(String(container.reason ?? container.Reason ?? ""));
      const exitCode = container.exitCode ?? container.ExitCode;
      if (!reason && exitCode == null) continue;
      lines.push(
        `[rollback] Container ${name}${exitCode == null ? "" : ` exited ${String(exitCode)}`}${reason ? `: ${reason}` : ""}`
      );
    }
  }
  return lines;
}

export function formatLogMessages(group: string, events: Array<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  const recent = events.slice(-12);
  for (const event of recent) {
    const message = clip(String(event.message ?? ""));
    if (message) lines.push(`[rollback] ${group}: ${message}`);
  }
  return lines;
}

/**
 * Read ECS stop reasons and CloudWatch container logs before Terraform destroy
 * deletes them. A failed first Express deploy otherwise leaves only the rollback sentence.
 */
export async function captureContainerFailureLogs(opts: {
  workDir: string;
  cloudConnectionId?: string;
  log: (line: string) => void;
}): Promise<void> {
  const statePath = path.join(opts.workDir, "terraform.tfstate");
  const tfvarsPath = path.join(opts.workDir, "terraform.tfvars");
  if (!fs.existsSync(statePath) || !fs.existsSync(tfvarsPath)) return;
  if (!stateHasEcsExpress(fs.readFileSync(statePath, "utf8"))) return;
  const names = readAwsServiceNames(fs.readFileSync(tfvarsPath, "utf8"));
  if (!names) return;

  const cloud = resolveCloudContext(opts.cloudConnectionId, opts.workDir);
  if (!cloud.env.AWS_ACCESS_KEY_ID || !cloud.env.AWS_SECRET_ACCESS_KEY) {
    opts.log("[rollback] AWS credentials missing, so the container stop reason was not read");
    return;
  }

  opts.log("[rollback] Reading why the API container failed before the stack is destroyed…");
  const lines: string[] = [];
  try {
    const described = await awsJsonCall({
      env: cloud.env,
      region: names.region,
      service: "ecs",
      target: "AmazonEC2ContainerServiceV20141113.DescribeServices",
      body: {
        cluster: names.name,
        services: [`${names.name}-api`, `${names.name}-web`],
      },
    });
    if (!described.ok) {
      lines.push(`[rollback] Could not read the ECS service: ${clip(described.text)}`);
    } else {
      for (const service of asRecords(described.json.services ?? described.json.Services)) {
        const serviceName = String(service.serviceName ?? service.ServiceName ?? "service");
        lines.push(...formatServiceEvents(serviceName, asRecords(service.events ?? service.Events)));
      }
      for (const failure of asRecords(described.json.failures ?? described.json.Failures)) {
        const reason = clip(String(failure.reason ?? failure.Reason ?? ""));
        if (reason) lines.push(`[rollback] ECS service lookup: ${reason}`);
      }
    }

    for (const serviceName of [`${names.name}-api`, `${names.name}-web`]) {
      const listed = await awsJsonCall({
        env: cloud.env,
        region: names.region,
        service: "ecs",
        target: "AmazonEC2ContainerServiceV20141113.ListTasks",
        body: { cluster: names.name, serviceName, desiredStatus: "STOPPED", maxResults: 3 },
      });
      const arns = (listed.json.taskArns ?? listed.json.TaskArns ?? []) as unknown[];
      const taskArns = arns.map((arn) => String(arn)).filter(Boolean);
      if (!listed.ok || taskArns.length === 0) continue;
      const tasks = await awsJsonCall({
        env: cloud.env,
        region: names.region,
        service: "ecs",
        target: "AmazonEC2ContainerServiceV20141113.DescribeTasks",
        body: { cluster: names.name, tasks: taskArns },
      });
      if (tasks.ok) lines.push(...formatStoppedTasks(asRecords(tasks.json.tasks ?? tasks.json.Tasks)));
    }

    for (const group of [`/shipdeck/${names.name}/api`, `/shipdeck/${names.name}/web`]) {
      const logs = await awsJsonCall({
        env: cloud.env,
        region: names.region,
        service: "logs",
        target: "Logs_20140328.FilterLogEvents",
        body: { logGroupName: group, limit: 20 },
      });
      if (!logs.ok) {
        if (!/ResourceNotFoundException/i.test(logs.text)) {
          lines.push(`[rollback] Could not read ${group}: ${clip(logs.text)}`);
        }
        continue;
      }
      lines.push(...formatLogMessages(group, asRecords(logs.json.events ?? logs.json.Events)));
    }
  } catch (err) {
    lines.push(`[rollback] Could not read the container failure: ${err instanceof Error ? err.message : String(err)}`);
  }

  const unique = [...new Set(lines)].slice(0, MAX_LINES);
  if (unique.length === 0) {
    opts.log("[rollback] No container stop reason or API log was recorded before destroy");
    return;
  }
  for (const line of unique) opts.log(line);
}
