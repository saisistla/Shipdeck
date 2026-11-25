import fs from "node:fs";
import path from "node:path";
import type { MarketingLead, MarketingPiece } from "@shipdeck/shared";

interface MarketingFile {
  version: 1;
  leads: MarketingLead[];
  pieces: MarketingPiece[];
}

export class MarketingStore {
  constructor(private readonly file: string) {}

  private read(): MarketingFile {
    if (!fs.existsSync(this.file)) return { version: 1, leads: [], pieces: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as MarketingFile;
      return {
        version: 1,
        leads: Array.isArray(parsed.leads) ? parsed.leads : [],
        pieces: Array.isArray(parsed.pieces)
          ? parsed.pieces.map((piece) => ({ ...piece, note: piece.note || "", videoUrl: piece.videoUrl || "" }))
          : [],
      };
    } catch {
      return { version: 1, leads: [], pieces: [] };
    }
  }

  private write(data: MarketingFile) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const next = `${this.file}.tmp`;
    fs.writeFileSync(next, JSON.stringify(data, null, 2));
    fs.renameSync(next, this.file);
  }

  leads(briefId: string): MarketingLead[] {
    return this.read().leads.filter((item) => item.briefId === briefId);
  }

  pieces(briefId: string): MarketingPiece[] {
    return this.read()
      .pieces.filter((item) => item.briefId === briefId)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  addLead(lead: MarketingLead) {
    const data = this.read();
    data.leads.push(lead);
    this.write(data);
  }

  addPiece(piece: MarketingPiece) {
    const data = this.read();
    data.pieces.push(piece);
    this.write(data);
  }
}
