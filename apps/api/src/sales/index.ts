import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSalesService } from "./service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data");

export const sales = createSalesService(root);
