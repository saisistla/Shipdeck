import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBriefService } from "./service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data");

export const briefs = createBriefService(root);
