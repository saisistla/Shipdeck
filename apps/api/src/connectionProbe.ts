import type { ConnectionType } from "@shipdeck/shared";
import { sshExec, type SshTarget } from "./lib/ssh.js";

export interface ConnectionTestResult {
  ok: boolean;
  /** Short plain-English status for the user */
  summary: string;
  /** Same as summary for older UI clients */
  message: string;
  /** Technical detail (stderr, exception, codes) */
  technical?: string;
  /** What to try next, in plain English */
  hint?: string;
}

function fail(summary: string, technical?: string, hint?: string): ConnectionTestResult {
  return {
    ok: false,
    summary,
    message: summary,
    technical,
    hint,
  };
}

function ok(summary: string, technical?: string): ConnectionTestResult {
  return { ok: true, summary, message: summary, technical };
}

async function probeLiveUrl(raw: string): Promise<ConnectionTestResult> {
  const url = raw.trim();
  if (!url) {
    return fail(
      "Live service URL is missing.",
      "config.serviceUrl empty",
      "Paste the running URL, for example https://….ecs.eu-west-1.on.aws"
    );
  }
  let href = url;
  try {
    href = new URL(url.includes("://") ? url : `https://${url}`).toString();
  } catch {
    return fail("That is not a valid URL.", `serviceUrl=${url}`, "Paste a full https:// address.");
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(href, { method: "GET", redirect: "follow", signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      return ok(`Live service responded HTTP ${res.status} at ${href}`);
    }
    if (res.status === 401 || res.status === 403) {
      return ok(
        `Reached ${href} (HTTP ${res.status}). The service is there.`,
        `status=${res.status}`
      );
    }
    return fail(
      `Live service returned HTTP ${res.status}.`,
      `GET ${href} → ${res.status}`,
      "Confirm the URL is still the running service, then try again."
    );
  } catch (err) {
    const technical = err instanceof Error ? err.message : String(err);
    const lower = technical.toLowerCase();
    if (lower.includes("abort") || lower.includes("timeout")) {
      return fail(
        "The live service URL did not respond in time.",
        technical,
        "Check the URL and that the service is up in that region."
      );
    }
    return fail(
      "Could not reach the live service URL.",
      technical,
      "Check spelling, HTTPS, and that this PC can open that URL."
    );
  }
}

async function withLiveUrl(
  fields: ConnectionTestResult,
  serviceUrl?: string
): Promise<ConnectionTestResult> {
  if (!fields.ok || !serviceUrl?.trim()) return fields;
  const live = await probeLiveUrl(serviceUrl);
  if (!live.ok) return live;
  return ok(`${fields.summary} ${live.summary}`, [fields.technical, live.technical].filter(Boolean).join("\n"));
}

function humanizeSshError(err: unknown): { summary: string; technical: string; hint: string } {
  const technical = err instanceof Error ? err.message : String(err);
  const lower = technical.toLowerCase();

  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("etimedout")) {
    return {
      summary: "Could not reach the server in time.",
      technical,
      hint: "Check the host/IP, port 22, and that the machine is online and allows SSH from this PC.",
    };
  }
  if (lower.includes("econnrefused") || lower.includes("connection refused")) {
    return {
      summary: "The server refused the SSH connection.",
      technical,
      hint: "SSH may not be running, or the port is wrong (usually 22).",
    };
  }
  if (lower.includes("enotfound") || lower.includes("getaddrinfo") || lower.includes("dns")) {
    return {
      summary: "The host name could not be found.",
      technical,
      hint: "Fix the host spelling, or use an IP address instead of a DNS name.",
    };
  }
  if (
    lower.includes("authentication") ||
    lower.includes("all configured authentication methods failed") ||
    lower.includes("permission denied")
  ) {
    return {
      summary: "Login was rejected (username or key/password is wrong).",
      technical,
      hint: "Confirm the username and paste the correct private key (or password) for that server.",
    };
  }
  if (lower.includes("cannot parse private key") || lower.includes("encrypted key")) {
    return {
      summary: "The private key could not be read.",
      technical,
      hint: "Paste a full OpenSSH private key. If the key has a passphrase, use an unencrypted key or set password auth instead.",
    };
  }
  if (lower.includes("no route") || lower.includes("network unreachable")) {
    return {
      summary: "This computer cannot reach that network.",
      technical,
      hint: "Check VPN/firewall and that you can ping or reach the host from this machine.",
    };
  }

  return {
    summary: "SSH connection failed.",
    technical,
    hint: "Double-check host, port, username, and secret, then try Test again.",
  };
}

async function testSsh(target: SshTarget): Promise<ConnectionTestResult> {
  if (!target.host?.trim()) {
    return fail(
      "Host is missing.",
      "config.host is empty",
      "Enter the server IP or hostname before testing."
    );
  }
  if (!target.username?.trim()) {
    return fail(
      "Username is missing.",
      "config.user / username is empty",
      "Enter the SSH user (for example ubuntu or root)."
    );
  }
  if (!target.privateKey && !target.password && !target.privateKeyPath) {
    return fail(
      "No login secret was provided.",
      "Need privateKey, password, or privateKeyPath",
      "Paste your private key (or password) in the Secret box."
    );
  }

  try {
    const r = await sshExec(target, "echo shipdeck-ok && uname -a");
    if (r.code === 0 && r.stdout.includes("shipdeck-ok")) {
      return ok(
        `Connected successfully to ${target.username}@${target.host}.`,
        r.stdout.trim()
      );
    }
    return fail(
      "Connected, but the test command on the server did not succeed.",
      `exit=${r.code}\nstdout=${r.stdout}\nstderr=${r.stderr}`,
      "The SSH login may work, but the remote shell failed. Check user permissions on the server."
    );
  } catch (err) {
    const h = humanizeSshError(err);
    return fail(h.summary, h.technical, h.hint);
  }
}

export async function probeConnection(input: {
  type: ConnectionType;
  config: Record<string, string>;
  secrets?: Record<string, string>;
  name?: string;
}): Promise<ConnectionTestResult> {
  const { type, config, secrets = {}, name } = input;
  const label = name ? `"${name}"` : type;

  if (type === "ssh") {
    return testSsh({
      host: config.host,
      port: Number(config.port || 22),
      username: config.user || "ubuntu",
      privateKey: secrets.privateKey,
      password: secrets.password,
      privateKeyPath: secrets.privateKeyPath || config.privateKeyPath,
    });
  }

  if (type === "git") {
    if (config.mode === "local" && !config.url) {
      return ok(`Git connection ${label} is set to local mode (no remote URL needed).`);
    }
    if (!config.url?.trim()) {
      if (secrets.token || secrets.personalAccessToken) {
        return ok("Git token is saved. A repository URL can be supplied per ticket.");
      }
      return fail(
        "Git repo URL is missing.",
        "config.url is empty",
        "Paste an HTTPS or SSH git URL (for example https://github.com/org/repo.git)."
      );
    }
    const url = config.url.trim();
    if (!/^git@|^https?:\/\/|^ssh:\/\//i.test(url) && !url.includes(".git")) {
      return fail(
        "That does not look like a git repository URL.",
        `url=${url}`,
        "Use a full git URL, not just a folder name."
      );
    }
    if (url.startsWith("https://") && !secrets.token && !secrets.password && !secrets.personalAccessToken) {
      return ok(
        `Git URL looks valid: ${url}. No token provided (OK for public repos).`,
        "No auth secret; private repos will fail at clone time"
      );
    }
    return ok(`Git URL looks configured: ${url}`, secrets.token ? "token present" : undefined);
  }

  if (type === "registry") {
    const registry = config.registry || config.endpoint || config.host;
    if (!registry?.trim()) {
      return fail(
        "Registry host is missing.",
        "config.registry / endpoint / host empty",
        "Enter something like docker.io or ghcr.io."
      );
    }
    if (!secrets.password && !secrets.token && !config.username) {
      return ok(
        `Registry ${registry} is set. No login secret yet (OK if the registry is public).`,
        "username/password not provided"
      );
    }
    return ok(
      `Registry ${registry} looks configured.`,
      `repository=${config.repository || "app"} user=${config.username || secrets.username || "(none)"}`
    );
  }

  if (type === "notify") {
    const endpoint = config.endpoint || secrets.webhook;
    if (!endpoint?.trim()) {
      return fail(
        "Notification webhook URL is missing.",
        "config.endpoint and secrets.webhook are empty",
        "Paste a Slack/Teams/Discord webhook URL in Host/Endpoint or Secret."
      );
    }
    try {
      const u = new URL(endpoint);
      if (!/^https?:$/i.test(u.protocol)) {
        return fail(
          "Webhook URL must start with http:// or https://.",
          `protocol=${u.protocol}`,
          "Use a full webhook URL from your chat tool."
        );
      }
      return ok(`Notify endpoint looks valid: ${u.origin}${u.pathname}`);
    } catch {
      return fail(
        "Webhook URL is not valid.",
        `endpoint=${endpoint}`,
        "Copy the full URL again from Slack/Teams and paste it here."
      );
    }
  }

  if (type === "aws") {
    if (!secrets.accessKeyId && !config.accessKeyId) {
      return fail(
        "AWS access key is missing.",
        "secrets.accessKeyId empty",
        "Put the Access Key ID in the username field and Secret Access Key in Secret."
      );
    }
    if (!secrets.secretAccessKey) {
      return fail(
        "AWS secret access key is missing.",
        "secrets.secretAccessKey empty",
        "Paste the Secret Access Key in the Secret box."
      );
    }
    return withLiveUrl(
      ok(
        "AWS credentials fields look filled in.",
        `region=${config.region || "us-east-1"} key_name=${config.key_name || "(none)"}`
      ),
      config.serviceUrl
    );
  }

  if (type === "azure") {
    if (!config.subscriptionId) {
      return fail(
        "Azure subscription ID is missing.",
        "config.subscriptionId empty",
        "Paste your subscription ID in the first field."
      );
    }
    if (!secrets.clientId || !secrets.clientSecret) {
      return fail(
        "Azure app login is incomplete.",
        "Need clientId + clientSecret",
        "Fill Client ID (user field) and Client Secret (Secret box), plus Tenant ID."
      );
    }
    return withLiveUrl(
      ok(
        "Azure credential fields look filled in.",
        `subscription=${config.subscriptionId} tenant=${config.tenantId || "(none)"}`
      ),
      config.serviceUrl
    );
  }

  if (type === "gcp") {
    if (!config.project_id && !config.projectId) {
      return fail(
        "GCP project ID is missing.",
        "config.project_id empty",
        "Enter your Google Cloud project id."
      );
    }
    if (!secrets.credentialsJson && !secrets.GOOGLE_CREDENTIALS) {
      return fail(
        "GCP service account JSON is missing.",
        "secrets.credentialsJson empty",
        "Paste the full service-account JSON key into Secret."
      );
    }
    try {
      JSON.parse(secrets.credentialsJson || secrets.GOOGLE_CREDENTIALS || "");
    } catch {
      return fail(
        "GCP credentials are not valid JSON.",
        "JSON.parse failed on credentialsJson",
        "Paste the whole JSON file contents, starting with { and ending with }."
      );
    }
    return withLiveUrl(
      ok(
        "GCP project + credentials JSON look filled in.",
        `project_id=${config.project_id || config.projectId}`
      ),
      config.serviceUrl
    );
  }

  if (type === "kubernetes") {
    if (!config.kubeconfigPath && !secrets.kubeconfig) {
      return fail(
        "Kubernetes config is missing.",
        "Need kubeconfigPath or kubeconfig secret",
        "Paste kubeconfig contents in Secret, or a path to a kubeconfig file."
      );
    }
    return ok(`Kubernetes connection ${label} looks configured.`);
  }

  if (type === "docker") {
    return ok(
      "Docker connection saved as a label only (local Docker uses the machine PATH).",
      "No live probe for docker connection type"
    );
  }

  if (type === "jira") {
    const site = (config.siteUrl || config.endpoint || "").trim();
    if (!site) {
      return fail(
        "Jira site URL is missing.",
        "config.siteUrl empty",
        "Paste the Jira site, for example https://your-team.atlassian.net"
      );
    }
    try {
      const url = new URL(site.includes("://") ? site : `https://${site}`);
      if (!/^https?:$/i.test(url.protocol)) {
        return fail("Jira site URL must start with https://.", `siteUrl=${site}`, "Use the full https:// address.");
      }
    } catch {
      return fail("Jira site URL is not valid.", `siteUrl=${site}`, "Use the full https:// address.");
    }
    if (!secrets.token && !secrets.jiraToken) {
      return fail(
        "Jira API token is missing.",
        "secrets.token empty",
        "Paste the Jira API token. For Cloud, use an Atlassian API token with the account email."
      );
    }
    return ok(`Jira site looks configured: ${site}`, config.accountEmail ? `email=${config.accountEmail}` : undefined);
  }

  if (type === "model") {
    const endpoint = (config.endpoint || "").trim();
    if (!endpoint) {
      return fail(
        "Model endpoint is missing.",
        "config.endpoint empty",
        "Paste the chat or agent endpoint for this vendor."
      );
    }
    if (!secrets.apiKey && !secrets.token) {
      return fail(
        "Model API key is missing.",
        "secrets.apiKey empty",
        "Paste the vendor API key. It is stored encrypted on the server."
      );
    }
    return ok(
      `Model connection looks configured (${config.provider || "vendor"}).`,
      `endpoint=${endpoint} role=${config.role || "both"}`
    );
  }

  return ok(`Connection ${label} (${type}) basic validation passed.`);
}
