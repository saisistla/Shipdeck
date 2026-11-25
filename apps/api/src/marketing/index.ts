import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMarketingService } from "./service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data");

export const marketing = createMarketingService(root);

export function marketingFilmFile(id: string): string | null {
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) return null;
  const file = path.join(root, "marketing-films", `${id}.mp4`);
  return fs.existsSync(file) ? file : null;
}

export function marketingStillFile(id: string, scene: string): string | null {
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(id) || !/^[1-4]$/.test(scene)) return null;
  const file = path.join(root, "marketing-films", `${id}-scene-${scene}.jpg`);
  return fs.existsSync(file) ? file : null;
}
