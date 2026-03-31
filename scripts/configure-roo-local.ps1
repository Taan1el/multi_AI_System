param(
    [switch]$OpenVSCode
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$importPath = Join-Path $repoRoot "roo-local-ollama-settings.json"
$settingsDir = Join-Path $env:APPDATA "Code\User"
$settingsPath = Join-Path $settingsDir "settings.json"

if (-not (Test-Path $importPath)) {
    throw "Roo import file not found at $importPath"
}

New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

if (Test-Path $settingsPath) {
    $rawSettings = Get-Content -Raw $settingsPath
    if ([string]::IsNullOrWhiteSpace($rawSettings)) {
        $settings = [pscustomobject]@{}
    } else {
        $settings = $rawSettings | ConvertFrom-Json
    }
} else {
    $settings = [pscustomobject]@{}
}

$settings | Add-Member -NotePropertyName "roo-cline.autoImportSettingsPath" -NotePropertyValue $importPath -Force

$settings | ConvertTo-Json -Depth 100 | Set-Content -Path $settingsPath -Encoding UTF8

Write-Host "Configured Roo auto-import path:" $importPath
Write-Host "VS Code settings file:" $settingsPath

if ($OpenVSCode) {
    $codePath = Get-Command code -ErrorAction SilentlyContinue
    if ($null -eq $codePath) {
        Write-Warning "VS Code CLI 'code' is not available in PATH. Open the repo manually in VS Code."
    } else {
        Start-Process -FilePath $codePath.Source -ArgumentList @("--reuse-window", $repoRoot)
        Write-Host "Opened repository in VS Code."
    }
}
