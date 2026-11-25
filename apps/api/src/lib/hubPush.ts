import fs from "node:fs";
import path from "node:path";
import { imageVersionForRegistry, type PipelineBoxes } from "@shipdeck/shared";
import { store } from "../store.js";
import { commandExists, runCommand } from "./exec.js";
import { getConnection, getSecrets } from "./connections.js";
import { shipdeckWorkRoot } from "./gitSource.js";
import { incrementDockerReleaseTag, registryImageName, resolveDockerReleaseTag } from "./imageTag.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function rememberNextVersion(runId: string, boxes: PipelineBoxes, pushedTag: string, log: (line: string) => void) {
  const next = incrementDockerReleaseTag(pushedTag);
  const id = boxes.build.registryConnectionId?.trim();
  boxes.build.imageVersion = next;
  if (id) boxes.build.imageVersions = { ...boxes.build.imageVersions, [id]: next };
  const run = store.runs.get(runId);
  const pipeline = run ? store.pipelines.get(run.pipelineId) : undefined;
  if (pipeline) {
    pipeline.boxes.build.imageVersion = next;
    if (id) pipeline.boxes.build.imageVersions = { ...pipeline.boxes.build.imageVersions, [id]: next };
    pipeline.updatedAt = new Date().toISOString();
    store.setPipeline(pipeline);
  }
  log(`Next ship pushes ${next}`);
}

/** Push images that were just built to the Docker Hub login selected on Package. */
export async function pushLocalImagesToHub(opts: {
  boxes: PipelineBoxes;
  runId: string;
  images: Array<{ ref: string; service: string }>;
  log: (line: string) => void;
}): Promise<{ ok: true; skipped?: boolean; tag?: string } | { ok: false; message: string }> {
  const id = opts.boxes.build.registryConnectionId;
  if (!id) return { ok: true, skipped: true };
  const version = resolveDockerReleaseTag(imageVersionForRegistry(opts.boxes.build));
  if (!version.ok) return version;
  const reg = getConnection(id);
  const secrets = getSecrets(id);
  const registry = reg?.config.registry || reg?.config.endpoint || reg?.config.host || "";
  const repository = reg?.config.repository || opts.boxes.build.imageName || "app";
  const user = secrets.username || reg?.config.username || "";
  const pass = secrets.password || secrets.token || "";
  if (!registry) return { ok: false, message: "Registry connection needs a registry host" };
  if (!user || !pass) return { ok: false, message: "Registry connection needs a username and an access token" };
  if (!(await commandExists("docker"))) {
    return {
      ok: false,
      message: "Docker Hub is selected on Package, but Docker is not on this computer, so the image cannot be pushed.",
    };
  }

  const passFile = path.join(shipdeckWorkRoot, opts.runId, "reg.pass");
  fs.mkdirSync(path.dirname(passFile), { recursive: true });
  fs.writeFileSync(passFile, pass, { mode: 0o600 });
  opts.log(`docker login ${registry}`);
  try {
    const login =
      process.platform === "win32"
        ? await runCommand("cmd", ["/c", `type "${passFile}" | docker login ${registry} -u ${user} --password-stdin`], {
            onLine: opts.log,
            timeoutMs: 60_000,
          })
        : await runCommand(
            "bash",
            ["-lc", `docker login ${shellQuote(registry)} -u ${shellQuote(user)} --password-stdin < ${shellQuote(passFile)}`],
            { onLine: opts.log, timeoutMs: 60_000 }
          );
    if (login.code !== 0) return { ok: false, message: "docker login failed" };
  } finally {
    try {
      fs.unlinkSync(passFile);
    } catch {
      /* ignore */
    }
  }

  const many = opts.images.length > 1;
  for (const image of opts.images) {
    const remote = registryImageName(registry, repository, version.tag, many ? image.service : undefined);
    opts.log(`docker tag ${image.ref} ${remote}`);
    const tagged = await runCommand("docker", ["tag", image.ref, remote], { onLine: opts.log });
    if (tagged.code !== 0) {
      const pulled = await runCommand("docker", ["pull", image.ref], { onLine: opts.log, timeoutMs: 600_000 });
      if (pulled.code !== 0) {
        return { ok: false, message: `Could not tag ${image.ref} for Docker Hub` };
      }
      const again = await runCommand("docker", ["tag", image.ref, remote], { onLine: opts.log });
      if (again.code !== 0) return { ok: false, message: `Could not tag ${image.ref} for Docker Hub` };
    }
    opts.log(`docker push ${remote}`);
    const pushed = await runCommand("docker", ["push", remote], { onLine: opts.log, timeoutMs: 600_000 });
    if (pushed.code !== 0) {
      return {
        ok: false,
        message: `The app may already be up, but ${version.tag} was not pushed to Docker Hub. The version was not increased.`,
      };
    }
  }
  rememberNextVersion(opts.runId, opts.boxes, version.tag, opts.log);
  return { ok: true, tag: version.tag };
}
