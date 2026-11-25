import fs from "node:fs";
import path from "node:path";

export type AppLanguage = "node" | "python" | "java" | "go" | "static" | "unknown";

export interface AppRuntimePlan {
  language: AppLanguage;
  signals: string[];
  /** Shell commands to run in app dir before starting (install deps / build) */
  prepareCommands: string[];
  /** systemd ExecStart= value */
  execStart: string;
  /** What to install on the host */
  bootstrap: {
    node: boolean;
    python: boolean;
    java: boolean;
    go: boolean;
  };
}

function exists(root: string, rel: string) {
  return fs.existsSync(path.join(root, rel));
}

function readJson(root: string, rel: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function firstExisting(root: string, candidates: string[]): string | null {
  for (const c of candidates) {
    if (exists(root, c)) return c;
  }
  return null;
}

function findJar(root: string): string | null {
  const dirs = ["target", "build/libs", "out", "."];
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    const jars = fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".jar") && !f.includes("sources") && !f.includes("javadoc"));
    if (jars.length) return path.join(dir, jars[0]).replace(/\\/g, "/");
  }
  return null;
}

/**
 * Inspect app files and decide how systemd should install + start the process.
 * No language hardcoding at call sites — callers use this plan.
 */
export function resolveAppRuntimePlan(sourcePath: string, port: number): AppRuntimePlan {
  const signals: string[] = [];
  const emptyBootstrap = { node: false, python: false, java: false, go: false };

  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return {
      language: "unknown",
      signals: [`Source path missing: ${sourcePath}`],
      prepareCommands: [],
      execStart: `/bin/false`,
      bootstrap: emptyBootstrap,
    };
  }

  // Node
  if (exists(sourcePath, "package.json")) {
    signals.push("Detected Node via package.json");
    const pkg = readJson(sourcePath, "package.json") ?? {};
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const main = typeof pkg.main === "string" ? pkg.main : null;
    const entry =
      firstExisting(sourcePath, ["server.js", "index.js", "app.js", "src/index.js", "dist/index.js"]) ||
      main;

    let execStart: string;
    if (scripts.start) {
      execStart = `/usr/bin/env npm start`;
      signals.push("Using package.json scripts.start");
    } else if (entry) {
      execStart = `/usr/bin/env node ${entry}`;
      signals.push(`Using Node entry: ${entry}`);
    } else {
      execStart = `/usr/bin/env node server.js`;
      signals.push("No start/main found — defaulting to node server.js");
    }

    return {
      language: "node",
      signals,
      prepareCommands: ["npm install --omit=dev"],
      execStart,
      bootstrap: { ...emptyBootstrap, node: true },
    };
  }

  // Python
  if (
    exists(sourcePath, "requirements.txt") ||
    exists(sourcePath, "pyproject.toml") ||
    exists(sourcePath, "Pipfile")
  ) {
    signals.push("Detected Python project");
    const entry =
      firstExisting(sourcePath, [
        "app.py",
        "main.py",
        "server.py",
        "wsgi.py",
        "application.py",
        "manage.py",
      ]) || "app.py";

    const prepareCommands: string[] = [
      "python3 -m pip install --upgrade pip || true",
    ];
    if (exists(sourcePath, "requirements.txt")) {
      prepareCommands.push("python3 -m pip install -r requirements.txt");
    } else if (exists(sourcePath, "pyproject.toml")) {
      prepareCommands.push("python3 -m pip install .");
    }

    let execStart = `/usr/bin/env python3 ${entry}`;
    if (entry === "manage.py") {
      execStart = `/usr/bin/env python3 manage.py runserver 0.0.0.0:${port}`;
      signals.push("Django-style manage.py detected");
    } else {
      signals.push(`Using Python entry: ${entry}`);
    }

    return {
      language: "python",
      signals,
      prepareCommands,
      execStart,
      bootstrap: { ...emptyBootstrap, python: true },
    };
  }

  // Java
  if (
    exists(sourcePath, "pom.xml") ||
    exists(sourcePath, "build.gradle") ||
    exists(sourcePath, "build.gradle.kts") ||
    findJar(sourcePath)
  ) {
    signals.push("Detected Java project");
    const jar = findJar(sourcePath);
    const prepareCommands: string[] = [];
    if (!jar && exists(sourcePath, "pom.xml")) {
      prepareCommands.push("mvn -q -DskipTests package || true");
    } else if (!jar && (exists(sourcePath, "build.gradle") || exists(sourcePath, "build.gradle.kts"))) {
      prepareCommands.push("./gradlew build -x test || gradle build -x test || true");
    }
    const jarAfter = jar || findJar(sourcePath) || "app.jar";
    const execStart = `/usr/bin/env java -jar ${jar || jarAfter}`;
    signals.push(jar ? `Using jar: ${jar}` : "Will look for jar after build");

    return {
      language: "java",
      signals,
      prepareCommands,
      execStart,
      bootstrap: { ...emptyBootstrap, java: true },
    };
  }

  // Go
  if (exists(sourcePath, "go.mod")) {
    signals.push("Detected Go via go.mod");
    return {
      language: "go",
      signals,
      prepareCommands: ["go build -o shipdeck-app ."],
      execStart: `./shipdeck-app`,
      bootstrap: { ...emptyBootstrap, go: true },
    };
  }

  // Static
  if (exists(sourcePath, "index.html")) {
    signals.push("Detected static site (index.html)");
    return {
      language: "static",
      signals,
      prepareCommands: [],
      execStart: `/usr/bin/env python3 -m http.server ${port}`,
      bootstrap: { ...emptyBootstrap, python: true },
    };
  }

  signals.push("Could not detect language from project files");
  return {
    language: "unknown",
    signals,
    prepareCommands: [],
    execStart: "/bin/false",
    bootstrap: emptyBootstrap,
  };
}
