import { Client, type ConnectConfig } from "ssh2";
import fs from "node:fs";
import { runSuffix } from "./naming.js";

export interface SshTarget {
  host: string;
  port?: number;
  username: string;
  privateKey?: string;
  password?: string;
  privateKeyPath?: string;
}

/** Transient connect-phase failures worth retrying (VM busy / sshd warming up). */
export function isTransientSshError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timed out while waiting for handshake|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up/i.test(
    msg
  );
}

function buildConfig(target: SshTarget): ConnectConfig {
  const cfg: ConnectConfig = {
    host: target.host,
    port: target.port ?? 22,
    username: target.username,
    // A VM that just built/started containers can take >20s to answer sshd.
    readyTimeout: 60_000,
  };
  if (target.privateKeyPath && fs.existsSync(target.privateKeyPath)) {
    cfg.privateKey = fs.readFileSync(target.privateKeyPath);
  } else if (target.privateKey) {
    cfg.privateKey = target.privateKey;
  } else if (target.password) {
    cfg.password = target.password;
  }
  return cfg;
}

export function withSsh<T>(
  target: SshTarget,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const maxConnectAttempts = 4;
  const attempt = (attemptNo: number): Promise<T> =>
    new Promise((resolve, reject) => {
      const client = new Client();
      let ready = false;
      client
        .on("ready", () => {
          ready = true;
          fn(client)
            .then((v) => {
              client.end();
              resolve(v);
            })
            .catch((err) => {
              client.end();
              reject(err);
            });
        })
        .on("error", (err) => {
          // Retry only failures before "ready" — never re-run a command
          // that may already have executed on the VM.
          if (!ready && attemptNo < maxConnectAttempts && isTransientSshError(err)) {
            const delayMs = 5_000 * attemptNo;
            setTimeout(() => {
              attempt(attemptNo + 1).then(resolve, reject);
            }, delayMs);
            return;
          }
          reject(err);
        })
        .connect(buildConfig(target));
    });
  return attempt(1);
}

export function sshExec(
  target: SshTarget,
  command: string,
  onLine?: (line: string) => void,
  timeoutMs = 0
): Promise<{ code: number; stdout: string; stderr: string }> {
  return withSsh(target, (client) =>
    new Promise((resolve, reject) => {
      let settled = false;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              try {
                client.end();
              } catch {
                /* ignore */
              }
              reject(new Error(`SSH command timed out after ${Math.round(timeoutMs / 1000)}s`));
            }, timeoutMs)
          : null;
      client.exec(command, (err, stream) => {
        if (err) {
          if (timer) clearTimeout(timer);
          return reject(err);
        }
        let stdout = "";
        let stderr = "";
        stream
          .on("close", (code: number) => {
            if (timer) clearTimeout(timer);
            if (settled) return;
            settled = true;
            resolve({ code: code ?? 1, stdout, stderr });
          })
          .on("data", (d: Buffer) => {
            const t = d.toString();
            stdout += t;
            t.split(/\r?\n/).filter(Boolean).forEach((l) => onLine?.(l));
          });
        stream.stderr.on("data", (d: Buffer) => {
          const t = d.toString();
          stderr += t;
          t.split(/\r?\n/).filter(Boolean).forEach((l) => onLine?.(l));
        });
      });
    })
  );
}

export function remoteShipdeckDir(target: SshTarget, runId: string): string {
  const user = target.username?.trim() || "deploy";
  return `/home/${user}/shipdeck/${runSuffix(runId, 8)}`;
}

/** Pack source locally, SFTP the archive, then extract on the VM. */
export async function sshUploadDir(
  target: SshTarget,
  localDir: string,
  remoteDir: string,
  onLine?: (line: string) => void
): Promise<void> {
  const { spawn } = await import("node:child_process");
  const os = await import("node:os");
  const path = await import("node:path");
  const quoted = shellQuote(remoteDir);
  onLine?.(`Ensuring remote folder ${remoteDir}`);
  const mkdir = await sshExec(target, `mkdir -p ${quoted}`, onLine);
  if (mkdir.code !== 0) {
    throw new Error(
      `Cannot create ${remoteDir} on the VM. Use an SSH user that can write to its home folder.`
    );
  }

  let staging = localDir;
  const cleanup: string[] = [];
  if (process.platform === "win32") {
    staging = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-up-"));
    cleanup.push(staging);
    onLine?.("Copying source to temp (excluding node_modules/.git/.next)…");
    await robocopyStage(localDir, staging, spawn);
  }

  const archive = path.join(os.tmpdir(), `shipdeck-${Date.now()}.tar.gz`);
  cleanup.push(archive);
  try {
    onLine?.("Packing source archive…");
    await runTar(spawn, ["-czf", archive, "-C", staging, "."]);
    const mb = (fs.statSync(archive).size / (1024 * 1024)).toFixed(1);
    onLine?.(`Archive is ${mb} MB. Uploading via SFTP…`);
    const remoteArchive = `${remoteDir.replace(/\/$/, "")}/shipdeck-src.tar.gz`;
    await sftpPutFile(target, archive, remoteArchive, onLine);
    onLine?.("Extracting archive on the VM…");
    const extract = await sshExec(
      target,
      `tar -xzf ${shellQuote(remoteArchive)} -C ${quoted} && rm -f ${shellQuote(remoteArchive)}`,
      onLine
    );
    if (extract.code !== 0) {
      throw new Error("Failed to extract source on the VM");
    }
    onLine?.("Source upload complete");
  } finally {
    for (const p of cleanup) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function runTar(
  spawn: typeof import("node:child_process").spawn,
  args: string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("tar", args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d.toString();
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar failed (${code}): ${err.trim() || "no details"}`));
    });
  });
}

function sftpPutFile(
  target: SshTarget,
  localFile: string,
  remoteFile: string,
  onLine?: (line: string) => void
): Promise<void> {
  const total = fs.statSync(localFile).size;
  return withSsh(target, (client) =>
    new Promise<void>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        let lastPct = -1;
        sftp.fastPut(
          localFile,
          remoteFile,
          {
            step: (transferred: number) => {
              if (!total) return;
              const pct = Math.min(100, Math.floor((transferred / total) * 100));
              if (pct >= lastPct + 10 || transferred >= total) {
                lastPct = pct;
                onLine?.(
                  `Upload ${pct}% (${(transferred / (1024 * 1024)).toFixed(1)} / ${(total / (1024 * 1024)).toFixed(1)} MB)`
                );
              }
            },
          },
          (putErr: Error | null | undefined) => {
            if (putErr) reject(putErr);
            else resolve();
          }
        );
      });
    })
  );
}

function robocopyStage(
  src: string,
  dest: string,
  spawn: typeof import("node:child_process").spawn
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "robocopy",
      [
        src,
        dest,
        "/E",
        "/XD",
        "node_modules",
        ".git",
        ".next",
        "dist",
        "coverage",
        ".turbo",
        ".shipdeck-work",
        "/NFL",
        "/NDL",
        "/NJH",
        "/NJS",
        "/NC",
        "/NS",
        "/NP",
      ],
      { windowsHide: true }
    );
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== null && code < 8) resolve();
      else reject(new Error(`robocopy failed with code ${code}`));
    });
  });
}

function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
