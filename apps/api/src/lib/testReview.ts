import fs from "node:fs";
import path from "node:path";

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
]);

export interface DiscoveredTest {
  dir: string;
  kind: "npm" | "pytest" | "go";
  command: string;
  detail: string;
  placeholder: boolean;
  fileCount: number;
}

export interface TestDiscrepancy {
  id: string;
  message: string;
}

export interface GeneratedTestFile {
  path: string;
  dir: string;
  reason: string;
  body: string;
}

export interface TestReview {
  discovered: DiscoveredTest[];
  recommended: DiscoveredTest[];
  generated: GeneratedTestFile[];
  discrepancies: TestDiscrepancy[];
  matches: boolean;
  recommendation: "existing" | "generated" | "skip";
  hasExisting: boolean;
  current: { runTests: boolean; testChoice?: string };
}

export const SHIPDECK_SMOKE_SPEC = "shipdeck.smoke.spec.ts";

function isPlaceholder(script: string): boolean {
  const s = script.trim();
  return !s || /no test specified/i.test(s) || /^echo\s+/i.test(s);
}

function walkDirs(root: string, maxDepth = 4): string[] {
  const out: string[] = [root];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      out.push(full);
      visit(full, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

function countTestFiles(dir: string): number {
  let n = 0;
  const visit = (d: string, depth: number) => {
    if (depth > 5 || n > 50) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) visit(full, depth + 1);
      else if (
        /\.(test|spec)\.(t|j)sx?$/.test(e.name) ||
        /e2e-spec\.(t|j)s$/.test(e.name) ||
        /^test_.+\.py$/.test(e.name) ||
        /_test\.go$/.test(e.name)
      ) {
        n += 1;
      }
    }
  };
  visit(dir, 0);
  return n;
}

function listMatchingTests(dir: string, opts: { rootDir?: string; regex?: RegExp; includeGenerated?: boolean }): string[] {
  const start = opts.rootDir ? path.join(dir, opts.rootDir) : dir;
  const out: string[] = [];
  const visit = (d: string, depth: number) => {
    if (depth > 6 || out.length > 80) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) visit(full, depth + 1);
      else if (opts.regex ? opts.regex.test(e.name) : /\.(test|spec)\.(t|j)sx?$/.test(e.name) || /e2e-spec\.(t|j)s$/.test(e.name)) {
        if (!opts.includeGenerated && e.name === SHIPDECK_SMOKE_SPEC) continue;
        out.push(full);
      }
    }
  };
  if (fs.existsSync(start)) visit(start, 0);
  return out;
}

function readPkg(dir: string): { scripts?: Record<string, string>; jest?: Record<string, unknown> } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      jest?: Record<string, unknown>;
    };
  } catch {
    return null;
  }
}

function jestUnitRegex(pkg: { jest?: Record<string, unknown> } | null): { rootDir: string; regex: RegExp } {
  const rootDir = typeof pkg?.jest?.rootDir === "string" ? pkg.jest.rootDir : ".";
  const raw = typeof pkg?.jest?.testRegex === "string" ? pkg.jest.testRegex : ".*\\.(spec|test)\\.(t|j)sx?$";
  let regex = /.*\.(spec|test)\.(t|j)sx?$/;
  try {
    regex = new RegExp(raw);
  } catch {
    /* keep default */
  }
  return { rootDir, regex };
}

function findSimpleHealthController(srcDir: string): { className: string; importPath: string; method: string } | null {
  if (!fs.existsSync(srcDir)) return null;
  const visit = (d: string, depth: number): { className: string; importPath: string; method: string } | null => {
    if (depth > 5) return null;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        const hit = visit(full, depth + 1);
        if (hit) return hit;
      } else if (/health.*\.controller\.(t|j)s$/i.test(e.name)) {
        let src = "";
        try {
          src = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        if (/constructor\s*\([^)]+\)/.test(src)) continue;
        const cls = src.match(/export\s+class\s+(\w+)/);
        const method = src.match(/@Get\(\)\s+(\w+)\s*\(/);
        if (!cls || !method) continue;
        const rel = path.relative(srcDir, full).replace(/\\/g, "/").replace(/\.(t|j)s$/, "");
        return { className: cls[1], importPath: `./${rel}`, method: method[1] };
      }
    }
    return null;
  };
  return visit(srcDir, 0);
}

function smokeBody(pkgDir: string, jestRoot: string, pkgName: string): { body: string; reason: string } {
  const srcDir = path.join(pkgDir, jestRoot === "." ? "" : jestRoot) || pkgDir;
  const health = findSimpleHealthController(srcDir);
  if (health) {
    return {
      reason: `Unit smoke for ${health.className}.${health.method}() found in source`,
      body: `/** Generated by Shipdeck from source. Does not replace your own tests. */
import { ${health.className} } from '${health.importPath}';

describe('Shipdeck smoke (${pkgName})', () => {
  it('health check returns ok', () => {
    const ctl = new ${health.className}();
    const res = ctl.${health.method}() as { status?: string };
    expect(res.status).toBe('ok');
  });
});
`,
    };
  }
  return {
    reason: `No simple health controller found — add a smoke spec so ${pkgName} jest has at least one test`,
    body: `/** Generated by Shipdeck from source. Does not replace your own tests. */
describe('Shipdeck smoke (${pkgName})', () => {
  it('package has a runnable unit test', () => {
    expect(true).toBe(true);
  });
});
`,
  };
}

export function planGeneratedTests(root: string): GeneratedTestFile[] {
  const planned: GeneratedTestFile[] = [];
  for (const dir of walkDirs(root)) {
    const pkg = readPkg(dir);
    if (!pkg) continue;
    const script = String(pkg.scripts?.test ?? "");
    if (!script || isPlaceholder(script) || !/\bjest\b/.test(script)) continue;
    const { rootDir, regex } = jestUnitRegex(pkg);
    const existing = listMatchingTests(dir, { rootDir, regex, includeGenerated: false });
    if (existing.length > 0) continue;
    const relDir = path.relative(root, dir).replace(/\\/g, "/") || ".";
    const destDir = rootDir && rootDir !== "." ? path.join(dir, rootDir) : dir;
    const relPath = path.relative(root, path.join(destDir, SHIPDECK_SMOKE_SPEC)).replace(/\\/g, "/");
    const name = path.basename(dir);
    const { body, reason } = smokeBody(dir, rootDir, name);
    planned.push({ path: relPath, dir: relDir, reason, body });
  }
  return planned;
}

export function writeShipdeckTests(root: string): { written: string[] } {
  const written: string[] = [];
  for (const file of planGeneratedTests(root)) {
    const abs = path.join(root, file.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.body);
    written.push(file.path);
  }
  return { written };
}

export function discoverTests(root: string): DiscoveredTest[] {
  const found: DiscoveredTest[] = [];
  for (const dir of walkDirs(root)) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          scripts?: Record<string, string>;
        };
        const script = String(pkg.scripts?.test ?? "");
        const rel = path.relative(root, dir).replace(/\\/g, "/") || ".";
        const fileCount = countTestFiles(dir);
        if (script || fileCount > 0) {
          found.push({
            dir: rel,
            kind: "npm",
            command: "npm test --if-present",
            detail: script ? `scripts.test = ${script}` : `${fileCount} test file(s), no npm test script`,
            placeholder: isPlaceholder(script) && fileCount === 0,
            fileCount,
          });
        }
      } catch {
        /* ignore */
      }
    }
    const req = path.join(dir, "requirements.txt");
    const pyproject = path.join(dir, "pyproject.toml");
    if (fs.existsSync(req) || fs.existsSync(pyproject)) {
      const fileCount = countTestFiles(dir);
      if (fileCount > 0 || fs.existsSync(path.join(dir, "pytest.ini"))) {
        const rel = path.relative(root, dir).replace(/\\/g, "/") || ".";
        found.push({
          dir: rel,
          kind: "pytest",
          command: "python -m pytest",
          detail: `${fileCount} python test file(s)`,
          placeholder: fileCount === 0,
          fileCount,
        });
      }
    }
    if (fs.existsSync(path.join(dir, "go.mod"))) {
      const fileCount = countTestFiles(dir);
      if (fileCount > 0) {
        const rel = path.relative(root, dir).replace(/\\/g, "/") || ".";
        found.push({
          dir: rel,
          kind: "go",
          command: "go test ./...",
          detail: `${fileCount} Go test file(s)`,
          placeholder: false,
          fileCount,
        });
      }
    }
  }
  const seen = new Set<string>();
  return found.filter((d) => {
    const k = `${d.kind}:${d.dir}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function reviewTestsAgainstSource(
  root: string,
  current: { runTests: boolean; testChoice?: string }
): TestReview {
  const discovered = discoverTests(root);
  const generated = planGeneratedTests(root);
  const recommended = discovered.filter((d) => !d.placeholder);
  const discrepancies: TestDiscrepancy[] = [];
  const hasExisting = discovered.some((d) => d.fileCount > 0);

  const choice = current.testChoice === "recommended" ? "generated" : current.testChoice;

  for (const g of generated) {
    discrepancies.push({
      id: `missing-unit-${g.dir}`,
      message: `${g.dir} has npm test (jest) but no matching unit test files. ${g.reason}. Shipdeck can add ${g.path}.`,
    });
  }

  const rootNpm = discovered.find((d) => d.dir === "." && d.kind === "npm");
  if (current.runTests && rootNpm?.placeholder && recommended.length > 0) {
    discrepancies.push({
      id: "root-placeholder",
      message:
        "Build → Run tests would run the root npm test script, which is empty/placeholder. Real tests live in subfolders.",
    });
  }
  if (!current.runTests && (recommended.length > 0 || generated.length > 0)) {
    discrepancies.push({
      id: "tests-off",
      message: "Run tests is OFF. Review existing vs generated tests, then choose.",
    });
  }
  if (generated.length === 0 && recommended.length === 0 && current.runTests) {
    discrepancies.push({
      id: "no-real-tests",
      message: "Run tests is ON, but no real test command was found in the source. Recommend Skip.",
    });
  }
  for (const d of discovered) {
    if (d.dir !== "." && d.fileCount > 0 && !d.placeholder) {
      discrepancies.push({
        id: `found-${d.dir}`,
        message: `Found ${d.fileCount} existing test file(s) in ${d.dir}: ${d.detail}`,
      });
    }
  }

  const recommendation: TestReview["recommendation"] =
    generated.length > 0 ? "generated" : recommended.length > 0 ? "existing" : "skip";
  const matches = choice === recommendation || (recommendation === "skip" && !current.runTests);

  return {
    discovered,
    recommended,
    generated,
    discrepancies,
    matches,
    recommendation,
    hasExisting,
    current,
  };
}
