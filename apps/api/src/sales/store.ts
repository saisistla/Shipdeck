import fs from "node:fs";
import path from "node:path";
import type { SalesAccount, SalesSearch } from "@shipdeck/shared";

export interface SavedSalesList {
  briefId: string;
  projectId?: string;
  summary: string;
  modelName: string;
  accounts: SalesAccount[];
  search?: SalesSearch;
  updatedAt: string;
}

interface SalesFile {
  version: 1;
  lists: SavedSalesList[];
}

export class SalesStore {
  constructor(private readonly file: string) {}

  private read(): SalesFile {
    if (!fs.existsSync(this.file)) return { version: 1, lists: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as SalesFile;
      return { version: 1, lists: Array.isArray(parsed.lists) ? parsed.lists : [] };
    } catch {
      return { version: 1, lists: [] };
    }
  }

  private write(data: SalesFile) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const next = `${this.file}.tmp`;
    fs.writeFileSync(next, JSON.stringify(data, null, 2));
    fs.renameSync(next, this.file);
  }

  get(briefId: string): SavedSalesList | undefined {
    return this.read().lists.find((item) => item.briefId === briefId);
  }

  save(list: SavedSalesList): SavedSalesList {
    const data = this.read();
    const next = { ...list, updatedAt: new Date().toISOString() };
    const index = data.lists.findIndex((item) => item.briefId === list.briefId);
    if (index >= 0) data.lists[index] = next;
    else data.lists.push(next);
    this.write(data);
    return next;
  }
}
