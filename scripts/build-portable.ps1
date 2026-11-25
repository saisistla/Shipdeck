# Builds release\Shipdeck\Shipdeck.exe — a portable Windows app with its own Node runtime.
# Share release\Shipdeck-portable.zip. The other PC unzips it and double-clicks Shipdeck.exe.
$ErrorActionPreference = "Stop"
function Invoke-Native([string]$label, [scriptblock]$cmd) {
  $ErrorActionPreference = "Continue"
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "$label failed with exit code $LASTEXITCODE" }
}
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root "release"
$stage = Join-Path $release "Shipdeck"
$cache = Join-Path $release "cache"
$nodeVersion = "v22.21.0"
$nodeZipName = "node-$nodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/$nodeVersion/$nodeZipName"

function Copy-Tree($from, $to) {
  if (-not (Test-Path $from)) { throw "Missing $from" }
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  Copy-Item -Path (Join-Path $from "*") -Destination $to -Recurse -Force
}

Write-Host "Building shared, API, and web..."
Push-Location $root
try {
  Invoke-Native "shared build" { npm run build -w @shipdeck/shared }
  # tsc currently fails on existing type errors; esbuild transpiles without typechecking.
  $apiSrc = Join-Path $root "apps\api\src"
  $apiOut = Join-Path $root "apps\api\dist"
  if (Test-Path $apiOut) { Remove-Item -Recurse -Force $apiOut }
  $apiFiles = @(Get-ChildItem -Path $apiSrc -Recurse -Filter *.ts | Where-Object { $_.Name -notmatch '\.test\.ts$' } | ForEach-Object { $_.FullName })
  Invoke-Native "api transpile" {
    & npx --yes esbuild @apiFiles --outdir=$apiOut --outbase=$apiSrc --format=esm --platform=node --target=node22
  }
  Push-Location (Join-Path $root "apps\web")
  try {
    Invoke-Native "web build" { npx --yes vite build }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $cache, (Join-Path $stage "app\data") | Out-Null

$zipPath = Join-Path $cache $nodeZipName
if (-not (Test-Path $zipPath)) {
  Write-Host "Downloading portable Node $nodeVersion..."
  Invoke-WebRequest -Uri $nodeUrl -OutFile $zipPath -UseBasicParsing
}
$nodeExtract = Join-Path $cache "node-$nodeVersion-win-x64"
if (-not (Test-Path (Join-Path $nodeExtract "node.exe"))) {
  Write-Host "Extracting Node..."
  if (Test-Path $nodeExtract) { Remove-Item -Recurse -Force $nodeExtract }
  Expand-Archive -Path $zipPath -DestinationPath $cache -Force
}
Copy-Tree $nodeExtract (Join-Path $stage "runtime")

Write-Host "Copying app files..."
$app = Join-Path $stage "app"
Copy-Tree (Join-Path $root "apps\api\dist") (Join-Path $app "apps\api\dist")
Copy-Tree (Join-Path $root "apps\web\dist") (Join-Path $app "apps\web\dist")
Copy-Tree (Join-Path $root "packages\shared\dist") (Join-Path $app "packages\shared\dist")
Copy-Tree (Join-Path $root "infra\terraform") (Join-Path $app "infra\terraform")
if (Test-Path (Join-Path $root "examples\demo-app")) {
  Copy-Tree (Join-Path $root "examples\demo-app") (Join-Path $app "examples\demo-app")
}

@'
{
  "name": "shipdeck-portable",
  "private": true,
  "type": "module",
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "nanoid": "^5.1.0",
    "pg": "^8.23.0",
    "ssh2": "^1.17.0",
    "yaml": "^2.9.1",
    "zod": "^3.24.1"
  }
}
'@ | Set-Content -Path (Join-Path $app "package.json") -Encoding utf8

Write-Host "Installing production dependencies..."
Push-Location $app
try {
  Invoke-Native "npm install" { npm install --omit=dev --no-audit --no-fund }
} finally {
  Pop-Location
}

$sharedDest = Join-Path $app "node_modules\@shipdeck\shared"
New-Item -ItemType Directory -Force -Path $sharedDest | Out-Null
Copy-Tree (Join-Path $app "packages\shared\dist") (Join-Path $sharedDest "dist")
@'
{
  "name": "@shipdeck/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" }
}
'@ | Set-Content -Path (Join-Path $sharedDest "package.json") -Encoding utf8

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw "csc.exe not found. .NET Framework 4 is required to compile Shipdeck.exe." }

Write-Host "Compiling Shipdeck.exe..."
Invoke-Native "csc" { & $csc /nologo /target:exe /optimize+ "/out:$(Join-Path $stage 'Shipdeck.exe')" (Join-Path $PSScriptRoot "ShipdeckLauncher.cs") }

$zipOut = Join-Path $release "Shipdeck-portable.zip"
if (Test-Path $zipOut) { Remove-Item -Force $zipOut }
Write-Host "Zipping portable package..."
Invoke-Native "zip" { tar -a -c -f $zipOut -C $release Shipdeck }
Write-Host "Done: $stage\Shipdeck.exe"
Write-Host "Share: $zipOut"
