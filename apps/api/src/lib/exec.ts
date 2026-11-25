import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/** Resolve a CLI binary; on Windows also searches WinGet Terraform packages. */
export function resolveBinary(bin: string): string {
  if (bin.includes("/") || bin.includes("\\")) return bin;
  if (process.platform !== "win32") return bin;
  if (bin !== "terraform" && bin !== "terraform.exe") return bin;

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const wingetRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
    try {
      if (fs.existsSync(wingetRoot)) {
        for (const name of fs.readdirSync(wingetRoot)) {
          if (!name.toLowerCase().includes("hashicorp.terraform")) continue;
          const candidate = path.join(wingetRoot, name, "terraform.exe");
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return bin;
}

export function runCommand(
  command: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onLine?: (line: string) => void;
    timeoutMs?: number;
    /** Default: cmd.exe on Windows. Git clone must set false so tokens/paths are not rewritten. */
    shell?: boolean;
    /** Written to child stdin then closed (e.g. docker login --password-stdin). */
    stdin?: string;
  } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const resolved = resolveBinary(command);
  return new Promise((resolve, reject) => {
    const child = spawn(resolved, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: opts.shell ?? process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const killTree = () => {
      try {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    };
    const timer =
      opts.timeoutMs &&
      setTimeout(() => {
        killTree();
        finish(() =>
          reject(new Error(`Command timed out: ${command} ${args.join(" ")}`))
        );
      }, opts.timeoutMs);

    const handle = (buf: Buffer, which: "out" | "err") => {
      const text = buf.toString();
      if (which === "out") stdout += text;
      else stderr += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line) => opts.onLine?.(line));
    };

    child.stdout.on("data", (d) => handle(d, "out"));
    child.stderr.on("data", (d) => handle(d, "err"));
    child.on("error", (err) => {
      finish(() => reject(err));
    });
    child.on("close", (code) => {
      finish(() => resolve({ code: code ?? 1, stdout, stderr }));
    });
    if (child.stdin) {
      if (opts.stdin != null) child.stdin.write(opts.stdin);
      child.stdin.end();
    }
  });
}

export async function commandExists(bin: string): Promise<boolean> {
  const resolved = resolveBinary(bin);
  if (resolved !== bin && fs.existsSync(resolved)) return true;
  const check = process.platform === "win32" ? "where" : "which";
  try {
    // Bypass resolveBinary for where/which themselves
    const r = await new Promise<{ code: number }>((resolve, reject) => {
      const child = spawn(check, [bin], {
        env: process.env,
        shell: process.platform === "win32",
        windowsHide: true,
      });
      child.stdin?.end();
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1 }));
    });
    return r.code === 0;
  } catch {
    return false;
  }
}
