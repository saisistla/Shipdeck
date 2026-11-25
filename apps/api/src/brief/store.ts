import fs from "node:fs";
import path from "node:path";
import type { IdeaBrief } from "@shipdeck/shared";

interface BriefFile {
  version: 1;
  briefs: IdeaBrief[];
}

export class BriefStore {
  constructor(private readonly file: string) {}

  private read(): BriefFile {
    if (!fs.existsSync(this.file)) return { version: 1, briefs: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as BriefFile;
      return { version: 1, briefs: Array.isArray(parsed.briefs) ? parsed.briefs : [] };
    } catch {
      return { version: 1, briefs: [] };
    }
  }

  private write(data: BriefFile) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }

  list(projectId?: string): IdeaBrief[] {
    const briefs = this.read().briefs;
    const filtered = projectId
      ? briefs.filter((item) => !item.projectId || item.projectId === projectId)
      : briefs;
    return filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  get(id: string): IdeaBrief | undefined {
    return this.read().briefs.find((item) => item.id === id);
  }

  byDelivery(runId: string): IdeaBrief | undefined {
    return this.read().briefs.find((item) => item.deliveryRunId === runId);
  }

  save(brief: IdeaBrief): IdeaBrief {
    const data = this.read();
    const index = data.briefs.findIndex((item) => item.id === brief.id);
    const next = { ...brief, updatedAt: new Date().toISOString() };
    if (index >= 0) data.briefs[index] = next;
    else data.briefs.push(next);
    this.write(data);
    return next;
  }
}
