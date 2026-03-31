$ErrorActionPreference = "Stop"

$scriptRoot = $PSScriptRoot

Write-Host "Installing Ollama and required local models..."
& (Join-Path $scriptRoot "install-ollama-models.ps1")

Write-Host ""
Write-Host "Configuring Roo auto-import and opening VS Code..."
& (Join-Path $scriptRoot "configure-roo-local.ps1") -OpenVSCode

Write-Host ""
Write-Host "Running verification..."
& (Join-Path $scriptRoot "verify-roo-local.ps1")

Write-Host ""
Write-Host "Bootstrap complete."
