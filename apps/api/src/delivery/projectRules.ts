import { githubDefaultBranch, listGithubPaths, readGithubTextFile } from "./github.js";

export type ProjectRules = {
  allowedLanguages: string[];
  allowedPackageSources: string[];
  allowedLicenses: string[];
};

const LANGUAGE_ORDER = ["typescript", "javascript", "node", "python", "go", "java", "csharp", "ruby", "php", "rust"];

const SOURCE_FOR: Record<string, string> = {
  typescript: "https://registry.npmjs.org",
  javascript: "https://registry.npmjs.org",
  node: "https://registry.npmjs.org",
  python: "https://pypi.org",
  go: "https://proxy.golang.org",
  java: "https://repo.maven.apache.org/maven2",
  csharp: "https://api.nuget.org/v3/index.json",
  ruby: "https://rubygems.org",
  php: "https://repo.packagist.org",
  rust: "https://crates.io",
};

const LICENSE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "Apache-2.0", re: /apache\s+license,?\s+version\s+2|apache-2\.0/i },
  { id: "BSD-3-Clause", re: /bsd\s+3-clause|bsd-3-clause/i },
  { id: "BSD-2-Clause", re: /bsd\s+2-clause|bsd-2-clause/i },
  { id: "GPL-3.0", re: /gnu general public license.*version 3|gpl-3\.0/i },
  { id: "LGPL-3.0", re: /lesser general public license.*version 3|lgpl-3\.0/i },
  { id: "AGPL-3.0", re: /affero general public license|agpl-3\.0/i },
  { id: "MPL-2.0", re: /mozilla public license,?\s+version\s+2|mpl-2\.0/i },
  { id: "ISC", re: /\bisc\b/i },
  { id: "Unlicense", re: /unlicense/i },
  { id: "MIT", re: /\bmit\b/i },
];

function hasPath(paths: string[], name: string): boolean {
  const wanted = name.toLowerCase();
  return paths.some((item) => item.toLowerCase() === wanted || item.toLowerCase().endsWith(`/${wanted}`));
}

function underSource(path: string): boolean {
  return /^(app|components|lib|src|pages|packages)\//i.test(path);
}

function normalizeLicense(value: string): string | null {
  const trimmed = value.trim().replace(/^license:\s*/i, "");
  if (!trimmed || /^see license/i.test(trimmed)) return null;
  if (/^unlicensed$/i.test(trimmed)) return "UNLICENSED";
  const hit = LICENSE_PATTERNS.find((item) => item.re.test(trimmed) && trimmed.length < 80);
  if (hit && trimmed.length < 40) return hit.id;
  const fileHit = LICENSE_PATTERNS.find((item) => item.re.test(trimmed));
  return fileHit?.id ?? null;
}

export function detectProjectRules(paths: string[], files: Record<string, string>): ProjectRules | null {
  const names = paths.map((item) => item.replaceAll("\\", "/"));
  if (!names.length && !Object.keys(files).length) return null;
  const languages = new Set<string>();
  if (hasPath(names, "package.json") || files["package.json"]) languages.add("node");
  const packageText = files["package.json"] ?? "";
  let packageJson: { license?: unknown; private?: boolean; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  if (packageText.trim()) {
    try {
      packageJson = JSON.parse(packageText) as typeof packageJson;
    } catch {
      packageJson = {};
    }
  }
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (deps.typescript || hasPath(names, "tsconfig.json") || names.some((item) => underSource(item) && /\.tsx?$/.test(item))) {
    languages.add("typescript");
  }
  if (names.some((item) => underSource(item) && /\.(jsx|mjs|cjs|js)$/.test(item))) languages.add("javascript");
  if (["requirements.txt", "pyproject.toml", "Pipfile", "setup.py"].some((name) => hasPath(names, name))) languages.add("python");
  if (hasPath(names, "go.mod")) languages.add("go");
  if (["pom.xml", "build.gradle", "build.gradle.kts"].some((name) => hasPath(names, name))) languages.add("java");
  if (names.some((item) => item.endsWith(".csproj"))) languages.add("csharp");
  if (hasPath(names, "Gemfile")) languages.add("ruby");
  if (hasPath(names, "composer.json")) languages.add("php");
  if (hasPath(names, "Cargo.toml")) languages.add("rust");
  if (!languages.size) return null;

  const licenses = new Set<string>();
  const declared = packageJson.license;
  const declaredText = typeof declared === "string" ? declared : declared && typeof declared === "object" && "type" in declared ? String((declared as { type?: string }).type ?? "") : "";
  const declaredId = normalizeLicense(declaredText);
  if (declaredId) licenses.add(declaredId);
  for (const [path, text] of Object.entries(files)) {
    if (path === "package.json") continue;
    if (!/(^|\/)(license|licence|copying)(\.|$)/i.test(path)) continue;
    const id = normalizeLicense(text.slice(0, 500));
    if (id) licenses.add(id);
  }
  if (!licenses.size && packageJson.private === true) licenses.add("UNLICENSED");

  const allowedLanguages = LANGUAGE_ORDER.filter((item) => languages.has(item));
  const allowedPackageSources = [...new Set(allowedLanguages.map((item) => SOURCE_FOR[item]).filter(Boolean))];
  return {
    allowedLanguages,
    allowedPackageSources,
    allowedLicenses: [...licenses],
  };
}

export async function readProjectRules(opts: { repoUrl: string; token: string; ref?: string }): Promise<ProjectRules | null> {
  const branch = (await githubDefaultBranch({ repoUrl: opts.repoUrl, token: opts.token })) || opts.ref || "main";
  const paths = await listGithubPaths({ repoUrl: opts.repoUrl, token: opts.token, ref: branch });
  if (!paths) return null;
  const files: Record<string, string> = {};
  const wanted = ["package.json", ...paths.filter((item) => /(^|\/)(license|licence|copying)(\.|$)/i.test(item))].slice(0, 4);
  for (const path of wanted) {
    const text = await readGithubTextFile({ repoUrl: opts.repoUrl, token: opts.token, path, ref: branch });
    if (text) files[path] = text;
  }
  return detectProjectRules(paths, files);
}
