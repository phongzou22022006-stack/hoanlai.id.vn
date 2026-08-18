param(
  [string]$OutputDirectory = "backups"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputPath = Join-Path $projectRoot $OutputDirectory
$resolvedProjectRoot = [IO.Path]::GetFullPath($projectRoot)
$resolvedOutputPath = [IO.Path]::GetFullPath($outputPath)

if (-not $resolvedOutputPath.StartsWith($resolvedProjectRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Thư mục backup phải nằm trong dự án."
}

New-Item -ItemType Directory -Force $resolvedOutputPath | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $resolvedOutputPath "cashback-db-$timestamp.sql"
$configFile = Join-Path $resolvedProjectRoot "wrangler.toml"

& wrangler d1 export cashback-db --remote --config $configFile --output $backupFile
if ($LASTEXITCODE -ne 0) { throw "Backup D1 thất bại." }

$file = Get-Item -LiteralPath $backupFile
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $backupFile
Write-Output "Backup hoàn tất: $($file.FullName)"
Write-Output "Kích thước: $($file.Length) bytes"
Write-Output "SHA256: $($hash.Hash)"
