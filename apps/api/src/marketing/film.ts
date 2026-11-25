import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MarketingScene } from "@shipdeck/shared";

const require = createRequire(import.meta.url);

function encoder(): string {
  const found = require("ffmpeg-static") as string | null;
  if (!found || !fs.existsSync(found)) throw new Error("The film encoder is not installed.");
  return found;
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The film took too long to build."));
    }, 150_000);
    child.stderr.on("data", (chunk) => {
      err = (err + chunk.toString()).slice(-600);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `The film encoder stopped (${code}).`));
    });
  });
}

export function filmCaption(scene: MarketingScene): string {
  const voice = scene.voice.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  const words = (voice || scene.visual).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 58 && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3).join("\n");
}

function sceneKind(visual: string): "gate" | "paper" | "tablet" | "calm" {
  const text = visual.toLowerCase();
  if (/tablet/.test(text)) return "tablet";
  if (/frustrated|messy|close-up|close up/.test(text)) return "paper";
  if (/happily|smoothly|peace|laptop/.test(text)) return "calm";
  return "gate";
}

function picturePrompt(kind: "gate" | "paper" | "tablet" | "calm"): string {
  if (kind === "tablet") return "Cinematic wide photograph of a tablet on a wooden desk, a clean checklist on the screen, warm daylight, no people, no text, no logos";
  if (kind === "paper") return "Cinematic wide photograph of a middle-aged teacher at a desk covered with loose papers, professional clothes, warm indoor light, no text, no logos";
  if (kind === "calm") return "Cinematic wide photograph of a sunny school gate, two middle-aged teachers in professional clothes, a laptop on a side table, no text, no logos";
  return "Cinematic wide photograph of a school gate in warm afternoon light, two middle-aged teachers in professional clothes looking at a paper register, no text, no logos";
}

function posterPrompt(scene: MarketingScene): string {
  const visual = scene.visual
    .replace(/logo|linkedin|caption|letters|words|text|branding|contact info/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return [
    "Premium square advertising poster, no text, no letters, no numbers, no logos, no watermark.",
    visual,
    "Cinematic campaign art, a smartphone or product as the hero, real people in the scene, rich light, polished commercial graphic design.",
  ].join(" ");
}

async function illustrate(visual: string, dest: string): Promise<boolean> {
  const prompt = visual;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&model=flux`;
      const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "shipdeck" } });
      if (res.status === 402) {
        const detail = await res.text();
        const wait = Number(/Retry after (\d+)/i.exec(detail)?.[1] || 45);
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 60) * 1000 + 800));
        continue;
      }
      if (!res.ok) continue;
      const type = res.headers.get("content-type") || "";
      if (!type.startsWith("image/")) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 8_000) continue;
      fs.writeFileSync(dest, bytes);
      return true;
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

async function paintScene(kind: "gate" | "paper" | "tablet" | "calm", png: string): Promise<void> {
  const script = path.join(path.dirname(png), "paint.ps1");
  fs.writeFileSync(
    script,
    `
param($Kind, $PngFile)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 1280, 720
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
function Solid($r, $g, $b) { New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $r, $g, $b)) }
$sky = New-Object System.Drawing.Drawing2D.LinearGradientBrush ((New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 0, 720), ([System.Drawing.Color]::FromArgb(255, 246, 226, 196)), ([System.Drawing.Color]::FromArgb(255, 123, 163, 201)))
$g.FillRectangle($sky, 0, 0, 1280, 720)
$g.FillEllipse((Solid 255 236 196), 980, 36, 150, 150)
$g.FillEllipse((Solid 74 122 78), 30, 250, 240, 180)
$g.FillEllipse((Solid 90 140 86), 160, 210, 210, 170)
$g.FillEllipse((Solid 196 165 116), -80, 520, 1480, 300)
if ($Kind -eq "paper" -or $Kind -eq "tablet") {
  $g.FillRectangle((Solid 244 236 224), 0, 0, 1280, 720)
  $g.FillRectangle((Solid 214 196 170), 0, 560, 1280, 160)
}
if ($Kind -eq "gate" -or $Kind -eq "calm") {
  $g.FillRectangle((Solid 231 211 184), 70, 220, 430, 310)
  $g.FillPolygon((Solid 140 74 50), @((New-Object System.Drawing.Point 40, 220), (New-Object System.Drawing.Point 285, 100), (New-Object System.Drawing.Point 530, 220)))
  foreach ($x in 110, 210, 320) { $g.FillRectangle((Solid 247 241 230), $x, 270, 64, 84) }
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 92, 70, 54), 16)
  $g.DrawArc($pen, 640, 250, 400, 260, 180, 180)
  $g.FillRectangle((Solid 92 70 54), 640, 380, 20, 210)
  $g.FillRectangle((Solid 92 70 54), 1020, 380, 20, 210)
  $g.FillEllipse((Solid 224 186 154), 720, 340, 64, 64)
  $g.FillRectangle((Solid 30 58 92), 700, 396, 104, 150)
  $g.FillEllipse((Solid 224 186 154), 880, 350, 64, 64)
  $g.FillRectangle((Solid 196 122 74), 860, 406, 104, 150)
  $g.FillRectangle((Solid 247 241 230), 790, 430, 80, 100)
}
if ($Kind -eq "calm") {
  $g.FillRectangle((Solid 226 230 234), 1080, 430, 150, 100)
  $g.FillRectangle((Solid 170 176 184), 1060, 528, 190, 12)
}
if ($Kind -eq "paper") {
  $g.FillEllipse((Solid 224 186 154), 430, 180, 90, 90)
  $g.FillRectangle((Solid 30 58 92), 400, 260, 150, 220)
  $g.FillRectangle((Solid 247 241 230), 700, 220, 400, 280)
  $ink = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 176, 154, 124), 4)
  for ($i = 0; $i -lt 8; $i++) { $g.DrawLine($ink, 740, (260 + $i * 28), 1050, (270 + $i * 22)) }
}
if ($Kind -eq "tablet") {
  $g.FillRectangle((Solid 36 44 58), 360, 130, 560, 390)
  $g.FillRectangle((Solid 247 241 230), 392, 162, 496, 326)
  $ink = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 30, 58, 92), 5)
  for ($i = 0; $i -lt 6; $i++) {
    $g.FillEllipse((Solid 46 125 90), 430, (200 + $i * 44), 18, 18)
    $g.DrawLine($ink, 470, (208 + $i * 44), 840, (208 + $i * 44))
  }
}
$bmp.Save($PngFile, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$g.Dispose()
$bmp.Dispose()
`,
    "utf8"
  );
  await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Kind", kind, "-PngFile", png], path.dirname(png));
  if (!fs.existsSync(png)) throw new Error("The scene picture was not drawn.");
}

async function speak(text: string, wav: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const script = path.join(path.dirname(wav), "speak.ps1");
  const textFile = path.join(path.dirname(wav), "say.txt");
  fs.writeFileSync(textFile, text, "utf8");
  fs.writeFileSync(
    script,
    `
param($TextFile, $WavFile)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$line = [IO.File]::ReadAllText($TextFile)
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.SetOutputToWaveFile($WavFile)
$voice.Speak($line)
$voice.Dispose()
`,
    "utf8"
  );
  try {
    await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-TextFile", textFile, "-WavFile", wav], path.dirname(wav));
    return fs.existsSync(wav) && fs.statSync(wav).size > 44;
  } catch {
    return false;
  }
}

function wavSeconds(file: string): number {
  const buf = fs.readFileSync(file);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return 6;
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  let size = buf.length - 44;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const chunk = buf.readUInt32LE(offset + 4);
    if (id === "data") {
      size = chunk;
      break;
    }
    offset += 8 + chunk + (chunk % 2);
  }
  const bytesPerSecond = rate * channels * (bits / 8);
  if (!bytesPerSecond) return 6;
  return Math.min(30, Math.max(4, size / bytesPerSecond + 0.6));
}

async function savePicture(url: string, dest: string): Promise<boolean> {
  if (!url) return false;
  try {
    if (url.startsWith("data:image/")) {
      const encoded = url.slice(url.indexOf(",") + 1);
      fs.writeFileSync(dest, Buffer.from(encoded, "base64"));
      return fs.statSync(dest).size > 32;
    }
    if (!/^https:\/\//i.test(url)) return false;
    const res = await fetch(url);
    if (!res.ok) return false;
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return fs.statSync(dest).size > 32;
  } catch {
    return false;
  }
}

function isSchool(scene: MarketingScene): boolean {
  return /school|pupil|teacher|child collection|\bgate\b|register/.test(`${scene.visual} ${scene.voice}`.toLowerCase());
}

function adCopy(scene: MarketingScene): { kicker: string; title: string; sub: string } {
  const offered = scene.voice.match(/Introducing\s+([^–\-\n\.]+)/i)?.[1]?.trim();
  const packs = isSchool(scene)
    ? [
        { kicker: "THE PROBLEM", title: "Paper at the gate.", sub: "The register cannot keep up." },
        { kicker: "THE GAP", title: "Too many hands.", sub: "One sheet. No clear record." },
        { kicker: "THE OFFER", title: offered || "A clearer list.", sub: "Collected. Waiting. Done." },
        { kicker: "THE CLOSE", title: "Accounted for.", sub: "Schools, colleges, and training teams." },
      ]
    : [
        { kicker: "THE OPEN", title: offered || "One membership.", sub: "Rewards that follow the shopper." },
        { kicker: "THE NETWORK", title: "Every shop.", sub: "One card. Many merchants." },
        { kicker: "THE APP", title: "Points, live.", sub: "The team sees the balance." },
        { kicker: "THE CLOSE", title: "Join Plava.", sub: "Loyalty for shop and stock teams." },
      ];
  return packs[(Math.max(1, scene.scene) - 1) % 4];
}

async function paintAd(scene: MarketingScene, dest: string): Promise<void> {
  const copy = adCopy(scene);
  const dir = path.dirname(dest);
  const kickerFile = path.join(dir, `kicker-${scene.scene}.txt`);
  const titleFile = path.join(dir, `title-${scene.scene}.txt`);
  const subFile = path.join(dir, `sub-${scene.scene}.txt`);
  fs.writeFileSync(kickerFile, copy.kicker, "utf8");
  fs.writeFileSync(titleFile, copy.title, "utf8");
  fs.writeFileSync(subFile, scene.voice.replace(/\s+/g, " ").trim() || copy.sub, "utf8");
  const script = path.join(dir, "ad.ps1");
  fs.writeFileSync(
    script,
    `
param($Kind, $Theme, $KickerFile, $TitleFile, $SubFile, $PngFile)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$kicker = [IO.File]::ReadAllText($KickerFile).Trim()
$title = [IO.File]::ReadAllText($TitleFile).Trim()
$sub = [IO.File]::ReadAllText($SubFile).Trim()
$bmp = New-Object System.Drawing.Bitmap 1920, 1080
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
function Solid($c) { New-Object System.Drawing.SolidBrush $c }
function Person($x, $y, $shirt) {
  $script:g.FillEllipse((Solid ([System.Drawing.Color]::FromArgb(255, 224, 186, 154))), $x, $y, 86, 86)
  $script:g.FillRectangle((Solid $shirt), ($x - 20), ($y + 72), 126, 210)
}
$navy = [System.Drawing.Color]::FromArgb(255, 18, 32, 51)
$paper = [System.Drawing.Color]::FromArgb(255, 244, 239, 230)
$brass = [System.Drawing.Color]::FromArgb(255, 198, 161, 91)
$card = [System.Drawing.Color]::FromArgb(255, 247, 241, 228)
$sky = New-Object System.Drawing.Drawing2D.LinearGradientBrush ((New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 0, 780), ([System.Drawing.Color]::FromArgb(255, 246, 214, 170)), ([System.Drawing.Color]::FromArgb(255, 110, 164, 196)))
$g.FillRectangle($sky, 0, 0, 1920, 1080)
$g.FillEllipse((Solid ([System.Drawing.Color]::FromArgb(255, 255, 228, 170))), 1500, 70, 180, 180)
$g.FillEllipse((Solid ([System.Drawing.Color]::FromArgb(255, 74, 122, 78))), 40, 360, 280, 200)
$g.FillEllipse((Solid ([System.Drawing.Color]::FromArgb(255, 196, 165, 116))), -80, 700, 2100, 280)
if ($Theme -eq "loyalty" -and $Kind -eq "2") {
  $g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(255, 244, 239, 230))), 0, 0, 640, 860)
  $g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(255, 18, 32, 51))), 640, 0, 640, 860)
  $g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(255, 47, 111, 78))), 1280, 0, 640, 860)
  foreach ($x in 70, 710, 1350) {
    $g.FillRectangle((Solid $card), $x, 180, 460, 280)
    $g.FillRectangle((Solid $brass), $x, 180, 460, 28)
  }
  $g.FillRectangle((Solid $brass), 760, 520, 400, 240)
  $g.FillEllipse((Solid $navy), 900, 575, 120, 120)
  Person 180 500 ([System.Drawing.Color]::FromArgb(255, 30, 58, 92))
  Person 820 500 ([System.Drawing.Color]::White)
  Person 1460 500 ([System.Drawing.Color]::FromArgb(255, 196, 122, 74))
}
elseif ($Theme -eq "loyalty" -and $Kind -eq "3") {
  $g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(255, 18, 32, 51))), 0, 0, 1920, 860)
  $g.FillRectangle((Solid $navy), 680, 70, 560, 760)
  $g.FillRectangle((Solid $card), 720, 120, 480, 640)
  $fontR = New-Object System.Drawing.Font "Segoe UI", 54, ([System.Drawing.FontStyle]::Bold)
  $g.DrawString("1,240", $fontR, (Solid $brass), 800, 180)
  $row = New-Object System.Drawing.Font "Segoe UI", 28, ([System.Drawing.FontStyle]::Bold)
  $labels = @("Earned", "Redeemed", "Waiting")
  for ($i = 0; $i -lt 3; $i++) {
    $g.FillEllipse((Solid $brass), 780, (360 + $i * 110), 28, 28)
    $g.DrawString($labels[$i], $row, (Solid $navy), 830, (348 + $i * 110))
  }
  Person 220 360 ([System.Drawing.Color]::FromArgb(255, 30, 58, 92))
}
elseif ($Theme -eq "loyalty") {
  foreach ($shop in @(
    @{ x = 120; c = [System.Drawing.Color]::FromArgb(255, 30, 58, 92) },
    @{ x = 460; c = [System.Drawing.Color]::FromArgb(255, 140, 74, 50) },
    @{ x = 800; c = [System.Drawing.Color]::FromArgb(255, 47, 111, 78) }
  )) {
    $g.FillRectangle((Solid $shop.c), $shop.x, 280, 280, 360)
    $g.FillPolygon((Solid $brass), @((New-Object System.Drawing.Point ($shop.x - 16), 280), (New-Object System.Drawing.Point ($shop.x + 140), 180), (New-Object System.Drawing.Point ($shop.x + 296), 280)))
    $g.FillRectangle((Solid $card), ($shop.x + 70), 360, 140, 110)
  }
  $g.FillRectangle((Solid $brass), 1180, 300, 520, 320)
  $g.FillEllipse((Solid $navy), 1360, 360, 160, 160)
  if ($Kind -eq "4") {
    $pen = New-Object System.Drawing.Pen $brass, 16
    $g.DrawEllipse($pen, 1560, 80, 220, 220)
    $g.DrawLines($pen, @((New-Object System.Drawing.Point 1610, 190), (New-Object System.Drawing.Point 1660, 250), (New-Object System.Drawing.Point 1740, 140)))
    Person 1240 430 ([System.Drawing.Color]::FromArgb(255, 30, 58, 92))
    Person 1480 440 ([System.Drawing.Color]::White)
  }
}
elseif ($Kind -eq "2") {
  $g.FillRectangle((Solid $paper), 0, 0, 1920, 1080)
  $g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(255, 186, 214, 228))), 140, 80, 420, 260)
  $g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(255, 196, 168, 120))), 0, 620, 1920, 260)
  Person 260 340 ([System.Drawing.Color]::FromArgb(255, 30, 58, 92))
  $g.FillRectangle((Solid $card), 760, 250, 420, 300)
  $g.FillRectangle((Solid $card), 980, 180, 380, 280)
  $g.FillRectangle((Solid $card), 860, 360, 460, 240)
  $ink = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 176, 150, 120), 4)
  for ($i = 0; $i -lt 6; $i++) { $g.DrawLine($ink, 820, (290 + $i * 36), 1120, (300 + $i * 30)) }
}
elseif ($Kind -eq "3") {
  $g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(255, 196, 168, 120))), 0, 0, 1920, 1080)
  $g.FillRectangle((Solid $navy), 560, 70, 800, 760)
  $g.FillRectangle((Solid $card), 610, 130, 700, 620)
  $tick = [System.Drawing.Color]::FromArgb(255, 47, 111, 78)
  $labels = @("Collected", "Collected", "Waiting", "Done")
  $fontR = New-Object System.Drawing.Font "Segoe UI", 36, ([System.Drawing.FontStyle]::Bold)
  for ($i = 0; $i -lt 4; $i++) {
    $g.FillEllipse((Solid $tick), 680, (210 + $i * 120), 36, 36)
    $g.DrawString($labels[$i], $fontR, (Solid $navy), 750, (200 + $i * 120))
  }
}
else {
  $g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(255, 231, 211, 184))), 80, 250, 520, 460)
  $g.FillPolygon((Solid ([System.Drawing.Color]::FromArgb(255, 140, 74, 50))), @((New-Object System.Drawing.Point 40, 260), (New-Object System.Drawing.Point 340, 80), (New-Object System.Drawing.Point 640, 260)))
  foreach ($x in 130, 270, 410) { $g.FillRectangle((Solid $card), $x, 320, 90, 110) }
  $arch = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 92, 70, 54), 22)
  $g.DrawArc($arch, 860, 250, 760, 460, 180, 180)
  $g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(255, 92, 70, 54))), 860, 470, 26, 280)
  $g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(255, 92, 70, 54))), 1594, 470, 26, 280)
  Person 980 400 ([System.Drawing.Color]::FromArgb(255, 30, 58, 92))
  Person 1220 410 ([System.Drawing.Color]::FromArgb(255, 196, 122, 74))
  $g.FillRectangle((Solid $card), 1120, 500, 120, 150)
  if ($Kind -eq "4") {
    $pen = New-Object System.Drawing.Pen $brass, 16
    $g.DrawEllipse($pen, 1560, 80, 220, 220)
    $g.DrawLines($pen, @((New-Object System.Drawing.Point 1610, 190), (New-Object System.Drawing.Point 1660, 250), (New-Object System.Drawing.Point 1740, 140)))
  }
}
$g.FillRectangle((Solid ([System.Drawing.Color]::FromArgb(214, 18, 32, 51))), 0, 860, 1920, 220)
$fontK = New-Object System.Drawing.Font "Segoe UI", 22, ([System.Drawing.FontStyle]::Bold)
$fontV = New-Object System.Drawing.Font "Segoe UI", 30
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString($title, $fontK, (Solid $brass), (New-Object System.Drawing.RectangleF 80, 875, 1760, 40), $fmt)
$g.DrawString($sub, $fontV, (Solid ([System.Drawing.Color]::White)), (New-Object System.Drawing.RectangleF 120, 920, 1680, 130), $fmt)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$quality = New-Object System.Drawing.Imaging.EncoderParameters 1
$quality.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]92)
$bmp.Save($PngFile, $codec, $quality)
$g.Dispose(); $bmp.Dispose()
`,
    "utf8"
  );
  await run(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Kind", String(scene.scene), "-Theme", isSchool(scene) ? "school" : "loyalty", "-KickerFile", kickerFile, "-TitleFile", titleFile, "-SubFile", subFile, "-PngFile", dest],
    dir
  );
  if (!fs.existsSync(dest)) throw new Error("The advert frame was not drawn.");
}

async function clip(ffmpeg: string, work: string, image: string, wav: string | null, seconds: number, outName: string) {
  const frames = Math.max(25, Math.round(seconds * 25));
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", image];
  if (wav) args.push("-i", wav);
  else args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
  args.push(
    "-t",
    seconds.toFixed(2),
    "-r",
    "25",
    "-vf",
    `zoompan=z='min(1+0.0005*on\\,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=25,setsar=1`,
    "-af",
    `afade=t=in:st=0:d=0.12,afade=t=out:st=${Math.max(0, seconds - 0.2).toFixed(2)}:d=0.2`,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    outName
  );
  await run(ffmpeg, args, work);
}

export async function buildFilm(scenes: MarketingScene[], outFile: string): Promise<number[]> {
  if (!scenes.length) throw new Error("There are no scenes to film.");
  const ffmpeg = encoder();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-film-"));
  const names: string[] = [];
  const lengths: number[] = [];
  const filmId = path.basename(outFile, ".mp4");
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const font = ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"].find((file) => fs.existsSync(file));
    if (font) fs.copyFileSync(font, path.join(work, "font.ttf"));
    for (const scene of scenes) {
      const voice = scene.voice.replace(/\s+/g, " ").trim() || scene.visual;
      const frame = path.join(work, `ad-${scene.scene}.jpg`);
      const poster = path.join(work, `poster-${scene.scene}.jpg`);
      const drawn = scene.imageUrl ? await savePicture(scene.imageUrl, poster) : false;
      if (drawn) fs.copyFileSync(poster, frame);
      else await paintAd(scene, frame);
      fs.copyFileSync(frame, path.join(path.dirname(outFile), `${filmId}-scene-${scene.scene}.jpg`));
      const wav = path.join(work, `say-${scene.scene}.wav`);
      const spoken = await speak(voice, wav);
      const seconds = spoken ? wavSeconds(wav) : 6;
      lengths.push(seconds);
      const name = `scene-${scene.scene}.mp4`;
      await clip(ffmpeg, work, frame, spoken ? wav : null, seconds, name);
      names.push(name);
    }
    const list = names.map((name) => `file '${name}'`).join("\n");
    fs.writeFileSync(path.join(work, "list.txt"), list, "utf8");
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", path.resolve(outFile)], work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1000) throw new Error("The film file was not written.");
  return lengths;
}
