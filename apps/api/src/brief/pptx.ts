import { zipStore } from "../delivery/documentText.js";

const W = 12192000;
const H = 6858000;

function emu(inches: number): number {
  return Math.round(inches * 914400);
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function paragraphs(text: string, size: number, color: string, bold = false): string {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const body = (lines.length ? lines : [""]).map(
    (line) =>
      `<a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-US" sz="${size}" b="${bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${xml(line)}</a:t></a:r></a:p>`
  );
  return body.join("");
}

let shapeSeq = 2;

function rect(opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  text?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  anchor?: "t" | "ctr";
  geom?: "rect" | "roundRect" | "rightArrow";
}): string {
  const id = shapeSeq++;
  const anchor = opts.anchor ?? "ctr";
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="S${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${opts.x}" y="${opts.y}"/><a:ext cx="${opts.w}" cy="${opts.h}"/></a:xfrm>
      <a:prstGeom prst="${opts.geom ?? "roundRect"}"><a:avLst/></a:prstGeom>
      <a:solidFill><a:srgbClr val="${opts.fill}"/></a:solidFill>
      <a:ln><a:noFill/></a:ln>
    </p:spPr>
    <p:txBody>
      <a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}"/>
      <a:lstStyle/>
      ${opts.text ? paragraphs(opts.text, opts.size ?? 1400, opts.color ?? "1C2430", opts.bold) : `<a:p/>`}
    </p:txBody>
  </p:sp>`;
}

function table(x: number, y: number, widths: number[], rows: string[][], header = true): string {
  const id = shapeSeq++;
  const rowH = emu(0.42);
  const grid = widths.map((w) => `<a:gridCol w="${w}"/>`).join("");
  const body = rows
    .map((row, index) => {
      const fill = header && index === 0 ? "1B4F8A" : index % 2 === 0 ? "F7F3EC" : "FFFDF9";
      const color = header && index === 0 ? "F8F4EC" : "1C2430";
      const cells = row
        .map(
          (cell) => `<a:tc>
            <a:txBody><a:bodyPr/><a:lstStyle/>
              <a:p><a:r><a:rPr lang="en-US" sz="1200" b="${header && index === 0 ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${xml(cell)}</a:t></a:r></a:p>
            </a:txBody>
            <a:tcPr><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr>
          </a:tc>`
        )
        .join("");
      return `<a:tr h="${rowH}">${cells}</a:tr>`;
    })
    .join("");
  const width = widths.reduce((sum, item) => sum + item, 0);
  return `<p:graphicFrame>
    <p:nvGraphicFramePr><p:cNvPr id="${id}" name="T${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${rowH * rows.length}"/></p:xfrm>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
      <a:tbl><a:tblPr/><a:tblGrid>${grid}</a:tblGrid>${body}</a:tbl>
    </a:graphicData></a:graphic>
  </p:graphicFrame>`;
}

function chrome(kicker: string, title: string): string {
  return [
    rect({ x: 0, y: 0, w: W, h: H, fill: "F4F0E8", geom: "rect", anchor: "t" }),
    rect({ x: 0, y: 0, w: W, h: emu(0.72), fill: "122033", geom: "rect" }),
    rect({
      x: emu(0.4),
      y: emu(0.14),
      w: emu(2.2),
      h: emu(0.44),
      fill: "122033",
      text: "Shipdeck",
      size: 1200,
      color: "D7C4A3",
      bold: true,
      geom: "rect",
    }),
    rect({
      x: emu(8.6),
      y: emu(0.16),
      w: emu(4.3),
      h: emu(0.4),
      fill: "122033",
      text: "Technical plan",
      size: 1100,
      color: "F8F4EC",
      geom: "rect",
    }),
    rect({
      x: emu(0.45),
      y: emu(0.9),
      w: emu(3),
      h: emu(0.32),
      fill: "F4F0E8",
      text: kicker,
      size: 1200,
      color: "1B4F8A",
      bold: true,
      anchor: "t",
      geom: "rect",
    }),
    rect({
      x: emu(0.45),
      y: emu(1.18),
      w: emu(12.2),
      h: emu(0.5),
      fill: "F4F0E8",
      text: title,
      size: 2600,
      color: "1C2430",
      bold: true,
      anchor: "t",
      geom: "rect",
    }),
  ].join("");
}

function slide(shapes: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    ${shapes}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function bullets(items: string[], max = 4): string {
  return items.slice(0, max).map((item) => item.replace(/\s+/g, " ").trim()).join("\n");
}

export interface TechnicalDeckInput {
  title: string;
  ticketKey: string;
  applicationName: string;
  industry: string;
  architectureMarkdown: string;
}

function section(markdown: string, heading: string): string {
  const match = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").exec(markdown);
  if (!match) return "";
  const rest = markdown.slice(match.index + match[0].length);
  const next = rest.search(/^##\s+/m);
  return (next < 0 ? rest : rest.slice(0, next)).replace(/```[\s\S]*?```/g, "").trim();
}

function plainLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/\*\*/g, "").replace(/`/g, "").trim())
    .filter((line) => line && !/^[-|:\s]+$/.test(line));
}

function apiRows(markdown: string): string[][] {
  const parsed = section(markdown, "APIs")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.replace(/`/g, "").trim()))
    .filter((cells) => cells.length >= 3 && !/^method$/i.test(cells[0]) && !/^---/.test(cells[0]));
  const body = parsed.slice(0, 6);
  if (!body.length) body.push(["GET", "/health", "Deploy verify"]);
  return [["Method", "Path", "Purpose"], ...body];
}

function buildSlides(input: TechnicalDeckInput): string[] {
  shapeSeq = 2;
  const markdown = input.architectureMarkdown;
  const intent = plainLines(section(markdown, "Intent")).slice(0, 4).join("\n") || input.title;
  const components = plainLines(section(markdown, "Components")).slice(0, 6);
  const inScope = plainLines(section(markdown, "In scope")).slice(0, 5);
  const outScope = plainLines(section(markdown, "Out of scope")).slice(0, 5);
  const technologies = plainLines(section(markdown, "Technologies")).slice(0, 5);
  const assumptions = plainLines(section(markdown, "Assumptions")).slice(0, 4);

  const title = slide(
    [
      chrome("Technical plan", input.title),
      rect({
        x: emu(0.45),
        y: emu(2),
        w: emu(7.6),
        h: emu(2.4),
        fill: "FFFDF9",
        text: intent,
        size: 1600,
        color: "1C2430",
        anchor: "t",
      }),
      rect({
        x: emu(8.3),
        y: emu(2),
        w: emu(4.5),
        h: emu(1.05),
        fill: "1B4F8A",
        text: input.ticketKey || "Ticket",
        size: 1600,
        color: "F8F4EC",
        bold: true,
      }),
      rect({
        x: emu(8.3),
        y: emu(3.2),
        w: emu(4.5),
        h: emu(1.2),
        fill: "122033",
        text: `${input.applicationName}\n${input.industry}`,
        size: 1400,
        color: "F8F4EC",
        bold: true,
      }),
    ].join("")
  );

  const parts = slide(
    [
      chrome("Components", "What the approved plan builds"),
      rect({
        x: emu(0.45),
        y: emu(1.9),
        w: emu(12.35),
        h: emu(4.4),
        fill: "FFFDF9",
        text: bullets(components.length ? components : ["Web page", "HTTP API", "Fixture JSON", "GET /health"]),
        size: 1600,
        color: "1C2430",
        anchor: "t",
      }),
    ].join("")
  );

  const apis = slide(
    [
      chrome("APIs", "From architecture.md"),
      table(emu(0.45), emu(1.95), [emu(2.2), emu(4.2), emu(5.7)], apiRows(markdown)),
    ].join("")
  );

  const scope = slide(
    [
      chrome("Scope", "In this build, and out of it"),
      rect({
        x: emu(0.45),
        y: emu(1.9),
        w: emu(6),
        h: emu(4.4),
        fill: "FFFDF9",
        text: `In\n${bullets(inScope.length ? inScope : [input.title])}`,
        size: 1500,
        color: "1C2430",
        anchor: "t",
      }),
      rect({
        x: emu(6.7),
        y: emu(1.9),
        w: emu(6.1),
        h: emu(4.4),
        fill: "122033",
        text: `Out\n${bullets(outScope.length ? outScope : ["Work outside this ticket"])}`,
        size: 1500,
        color: "F8F4EC",
        anchor: "t",
      }),
    ].join("")
  );

  const stack = slide(
    [
      chrome("Stack", "Technologies and assumptions"),
      rect({
        x: emu(0.45),
        y: emu(1.9),
        w: emu(6),
        h: emu(4.4),
        fill: "FFFDF9",
        text: `Technologies\n${bullets(technologies.length ? technologies : ["node", "HTTP"])}`,
        size: 1500,
        color: "1C2430",
        anchor: "t",
      }),
      rect({
        x: emu(6.7),
        y: emu(1.9),
        w: emu(6.1),
        h: emu(4.4),
        fill: "E7F0F8",
        text: `Assumptions\n${bullets(assumptions.length ? assumptions : ["Fixture data only", "GET /health for deploy verify"])}`,
        size: 1500,
        color: "1C2430",
        anchor: "t",
      }),
    ].join("")
  );

  const flow = slide(
    [
      chrome("Shape", "How a request moves"),
      rect({ x: emu(0.4), y: emu(2.6), w: emu(2.5), h: emu(1.3), fill: "122033", text: "Staff", size: 1600, color: "F8F4EC", bold: true }),
      rect({ x: emu(3.15), y: emu(2.85), w: emu(0.55), h: emu(0.4), fill: "1B4F8A", geom: "rightArrow" }),
      rect({ x: emu(3.9), y: emu(2.6), w: emu(2.5), h: emu(1.3), fill: "1B4F8A", text: "Page", size: 1600, color: "F8F4EC", bold: true }),
      rect({ x: emu(6.65), y: emu(2.85), w: emu(0.55), h: emu(0.4), fill: "1B4F8A", geom: "rightArrow" }),
      rect({ x: emu(7.4), y: emu(2.6), w: emu(2.5), h: emu(1.3), fill: "1B4F8A", text: "API", size: 1600, color: "F8F4EC", bold: true }),
      rect({ x: emu(10.15), y: emu(2.85), w: emu(0.55), h: emu(0.4), fill: "1B4F8A", geom: "rightArrow" }),
      rect({ x: emu(10.85), y: emu(2.4), w: emu(2.3), h: emu(1.7), fill: "143A66", text: "Fixture\nJSON", size: 1500, color: "F8F4EC", bold: true }),
      rect({
        x: emu(0.45),
        y: emu(4.4),
        w: emu(12.35),
        h: emu(1.8),
        fill: "FFFDF9",
        text: "GET /health is included so a later ship can check the app.\nThese slides follow the approved architecture.md. They do not start the build.",
        size: 1600,
        color: "1C2430",
        anchor: "t",
      }),
    ].join("")
  );

  return [title, parts, apis, scope, stack, flow];
}

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Shipdeck">
  <a:themeElements>
    <a:clrScheme name="Shipdeck">
      <a:dk1><a:srgbClr val="1C2430"/></a:dk1>
      <a:lt1><a:srgbClr val="F4F0E8"/></a:lt1>
      <a:dk2><a:srgbClr val="122033"/></a:dk2>
      <a:lt2><a:srgbClr val="FFFDF9"/></a:lt2>
      <a:accent1><a:srgbClr val="1B4F8A"/></a:accent1>
      <a:accent2><a:srgbClr val="B45309"/></a:accent2>
      <a:accent3><a:srgbClr val="15803D"/></a:accent3>
      <a:accent4><a:srgbClr val="0369A1"/></a:accent4>
      <a:accent5><a:srgbClr val="B91C1C"/></a:accent5>
      <a:accent6><a:srgbClr val="5C6A78"/></a:accent6>
      <a:hlink><a:srgbClr val="1B4F8A"/></a:hlink>
      <a:folHlink><a:srgbClr val="B45309"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Shipdeck">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Shipdeck">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

const MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`;

const LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

export function buildTechnicalDeck(input: TechnicalDeckInput): Buffer {
  if (!input.architectureMarkdown.trim()) throw new Error("architecture.md is empty");
  const slides = buildSlides(input);
  const files: Record<string, string> = {
    "[Content_Types].xml": contentTypes(slides.length),
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(input.title)}</dc:title><dc:creator>Shipdeck</dc:creator></cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Shipdeck</Application><Slides>${slides.length}</Slides></Properties>`,
    "ppt/presentation.xml": presentation(slides.length),
    "ppt/_rels/presentation.xml.rels": presentationRels(slides.length),
    "ppt/slideMasters/slideMaster1.xml": MASTER,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
    "ppt/slideLayouts/slideLayout1.xml": LAYOUT,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
    "ppt/theme/theme1.xml": THEME,
  };
  slides.forEach((body, index) => {
    const n = index + 1;
    files[`ppt/slides/slide${n}.xml`] = body;
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;
  });
  return zipStore(files);
}

function contentTypes(count: number): string {
  const overrides = [
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
    ...Array.from({ length: count }, (_, index) =>
      `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${overrides.join("\n")}
</Types>`;
}

function presentation(count: number): string {
  const ids = Array.from(
    { length: count },
    (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${ids}</p:sldIdLst>
  <p:sldSz cx="${W}" cy="${H}" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRels(count: number): string {
  const slides = Array.from(
    { length: count },
    (_, index) =>
      `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slides}
</Relationships>`;
}
