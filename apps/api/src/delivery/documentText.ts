import path from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Store-only zip, used by tests and enough for Office Open XML we write. */
export function zipStore(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    const nameBuf = Buffer.from(name.replaceAll("\\", "/"), "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBlob.length, 12);
  end.writeUInt32LE(localBlob.length, 16);
  return Buffer.concat([localBlob, centralBlob, end]);
}

export function unzipEntries(bytes: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (i + 30 <= bytes.length) {
    if (bytes.readUInt32LE(i) !== 0x04034b50) break;
    const method = bytes.readUInt16LE(i + 8);
    const nameLen = bytes.readUInt16LE(i + 26);
    const extraLen = bytes.readUInt16LE(i + 28);
    const flags = bytes.readUInt16LE(i + 6);
    let compressed = bytes.readUInt32LE(i + 18);
    const uncompressed = bytes.readUInt32LE(i + 22);
    const name = bytes.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const start = i + 30 + nameLen + extraLen;
    if (flags & 0x8) {
      break;
    }
    if (start + compressed > bytes.length) break;
    const raw = bytes.subarray(start, start + compressed);
    let data = raw;
    if (method === 8) {
      try {
        data = inflateRawSync(raw);
      } catch {
        i = start + compressed;
        continue;
      }
    } else if (method !== 0) {
      i = start + compressed;
      continue;
    }
    if (uncompressed && data.length > uncompressed) data = data.subarray(0, uncompressed);
    out.set(name.replaceAll("\\", "/"), data);
    i = start + compressed;
  }
  return out;
}

function xmlText(xml: string): string {
  return xml
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<w:tab\/>/gi, "\t")
    .replace(/<\/a:p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function pdfStrings(source: string): string {
  const parts: string[] = [];
  for (const match of source.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
    const inner = match[0]
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\(.)/g, "$1");
    if (inner.trim()) parts.push(inner);
  }
  return parts.join(" ");
}

export function extractPdfText(bytes: Buffer): string {
  const latin = bytes.toString("latin1");
  const chunks: string[] = [pdfStrings(latin)];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(latin))) {
    const header = latin.slice(Math.max(0, match.index - 280), match.index);
    let data = Buffer.from(match[1].replace(/^\r?\n/, "").replace(/\r?\n$/, ""), "latin1");
    if (/\/FlateDecode/.test(header)) {
      try {
        data = inflateSync(data);
      } catch {
        try {
          data = inflateRawSync(data);
        } catch {
          continue;
        }
      }
    }
    chunks.push(pdfStrings(data.toString("latin1")));
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function extractRtf(bytes: Buffer): string {
  return bytes
    .toString("latin1")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBinaryStrings(bytes: Buffer): string {
  const found: string[] = [];
  let ascii = "";
  for (const byte of bytes) {
    if (byte >= 32 && byte < 127) ascii += String.fromCharCode(byte);
    else {
      if (ascii.length >= 8) found.push(ascii);
      ascii = "";
    }
  }
  if (ascii.length >= 8) found.push(ascii);
  for (let i = 0; i + 3 < bytes.length; i += 2) {
    const lo = bytes[i];
    const hi = bytes[i + 1];
    if (hi !== 0 || lo < 32 || lo >= 127) continue;
    let word = "";
    let j = i;
    while (j + 1 < bytes.length && bytes[j + 1] === 0 && bytes[j] >= 32 && bytes[j] < 127) {
      word += String.fromCharCode(bytes[j]);
      j += 2;
    }
    if (word.length >= 8) found.push(word);
    i = j;
  }
  return [...new Set(found)].join(" ").replace(/\s+/g, " ").trim();
}

function fromOfficeZip(bytes: Buffer, pick: (name: string) => boolean): string {
  const entries = unzipEntries(bytes);
  const texts: string[] = [];
  for (const [name, data] of entries) {
    if (!pick(name) || name.endsWith("/")) continue;
    texts.push(xmlText(data.toString("utf8")));
  }
  return texts.join("\n").replace(/\s+\n/g, "\n").trim();
}

export function extractDocumentText(filename: string, bytes: Buffer, mimeType = ""): string {
  const ext = path.extname(filename).toLowerCase();
  const mime = mimeType.toLowerCase();
  try {
    if (ext === ".pdf" || mime.includes("pdf")) return extractPdfText(bytes);
    if (ext === ".rtf" || mime.includes("rtf")) return extractRtf(bytes);
    if (ext === ".docx" || mime.includes("wordprocessingml")) {
      return fromOfficeZip(bytes, (name) => name === "word/document.xml");
    }
    if (ext === ".xlsx" || mime.includes("spreadsheetml")) {
      return fromOfficeZip(bytes, (name) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    }
    if (ext === ".pptx" || mime.includes("presentationml")) {
      return fromOfficeZip(bytes, (name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"));
    }
    if (ext === ".odt" || ext === ".ods" || ext === ".odp" || mime.includes("opendocument")) {
      return fromOfficeZip(bytes, (name) => name === "content.xml");
    }
    if (ext === ".doc" || ext === ".xls" || ext === ".ppt" || mime.includes("msword") || mime.includes("ms-excel") || mime.includes("ms-powerpoint")) {
      return extractBinaryStrings(bytes);
    }
  } catch {
    return extractBinaryStrings(bytes);
  }
  return "";
}

export function isOfficeDocument(filename: string, mimeType = ""): boolean {
  const ext = path.extname(filename).toLowerCase();
  const mime = mimeType.toLowerCase();
  return (
    [
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".odt",
      ".ods",
      ".odp",
      ".rtf",
    ].includes(ext) ||
    /pdf|word|officedocument|msword|ms-excel|ms-powerpoint|opendocument|rtf/.test(mime)
  );
}
