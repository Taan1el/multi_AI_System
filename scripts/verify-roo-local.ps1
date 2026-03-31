$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $env:APPDATA "Code\User\settings.json"
$importPath = Join-Path $repoRoot "roo-local-ollama-settings.json"
$requiredModels = @(
    "deepseek-r1:1.5b-qwen-distill-q8_0",
    "qwen2.5-coder:7b",
    "gemma3:4b"
)

function Add-OllamaPath {
    $candidate = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
    if ((Test-Path $candidate) -and -not (($env:PATH -split ";") -contains $candidate)) {
        $env:PATH = "$candidate;$env:PATH"
    }
}

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if ($Condition) {
        Write-Host "[OK] $Message"
    } else {
        throw "[FAIL] $Message"
    }
}

$codePath = Get-Command code -ErrorAction SilentlyContinue
Assert-Condition ($null -ne $codePath) "VS Code CLI is available"

$extensions = & code --list-extensions
Assert-Condition ($extensions -contains "RooVeterinaryInc.roo-cline") "Roo Code extension is installed"

Assert-Condition (Test-Path $importPath) "Roo import settings file exists"
Assert-Condition (Test-Path (Join-Path $repoRoot ".roomodes")) ".roomodes exists"
Assert-Condition (Test-Path (Join-Path $repoRoot ".roo")) ".roo directory exists"
Assert-Condition (Test-Path (Join-Path $repoRoot "memory-bank")) "memory-bank directory exists"

Assert-Condition (Test-Path $settingsPath) "VS Code user settings file exists"
$settings = Get-Content -Raw $settingsPath | ConvertFrom-Json
$configuredImport = $settings."roo-cline.autoImportSettingsPath"
Assert-Condition ($configuredImport -eq $importPath) "Roo auto-import path points to this repo"

$rooStateJson = @'
import sqlite3, json, os
path = os.path.expandvars(r"%APPDATA%\\Code\\User\\globalStorage\\state.vscdb")
conn = sqlite3.connect(path)
cur = conn.cursor()
row = cur.execute("SELECT value FROM ItemTable WHERE key='RooVeterinaryInc.roo-cline'").fetchone()
if not row:
    raise SystemExit("null")
value = json.loads(row[0])
result = {
    "currentApiConfigName": value.get("currentApiConfigName"),
    "mode": value.get("mode"),
    "apiProvider": value.get("apiProvider"),
    "ollamaModelId": value.get("ollamaModelId"),
    "listApiConfigMeta": value.get("listApiConfigMeta"),
}
print(json.dumps(result))
conn.close()
'@ | python -

Assert-Condition (-not [string]::IsNullOrWhiteSpace($rooStateJson)) "Roo extension state is available"
$rooState = $rooStateJson | ConvertFrom-Json
Assert-Condition ($rooState.currentApiConfigName -eq "Local Manager") "Roo current profile is Local Manager"
Assert-Condition ($rooState.mode -eq "flow-orchestrator") "Roo default mode is Flow Orchestrator"
Assert-Condition ($rooState.apiProvider -eq "ollama") "Roo current provider is Ollama"
Assert-Condition ($rooState.ollamaModelId -eq "deepseek-r1:1.5b-qwen-distill-q8_0") "Roo current model is Local Manager"

$profileNames = @($rooState.listApiConfigMeta | ForEach-Object { $_.name })
foreach ($profileName in @("Local Manager", "Local Code", "Local Research")) {
    Assert-Condition ($profileNames -contains $profileName) "Roo profile metadata includes $profileName"
}

Add-OllamaPath
Assert-Condition ($null -ne (Get-Command ollama -ErrorAction SilentlyContinue)) "Ollama CLI is available"

$ollamaList = & ollama list
foreach ($model in $requiredModels) {
    Assert-Condition (($ollamaList | Select-String -SimpleMatch $model) -ne $null) "Model is installed: $model"
}

Write-Host ""
Write-Host "Verification completed successfully."
