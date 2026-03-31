$ErrorActionPreference = "Stop"

$requiredModels = @(
    "deepseek-r1:1.5b-qwen-distill-q8_0",
    "qwen2.5-coder:7b",
    "gemma3:4b"
)

function Add-OllamaPath {
    $candidate = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
    if (-not (Test-Path $candidate)) {
        return
    }

    if (-not (($env:PATH -split ";") -contains $candidate)) {
        $env:PATH = "$candidate;$env:PATH"
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $userPathParts = @($userPath -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if (-not ($userPathParts -contains $candidate)) {
        $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $candidate } else { "$candidate;$userPath" }
        [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    }
}

function Test-OllamaCommand {
    return $null -ne (Get-Command ollama -ErrorAction SilentlyContinue)
}

function Wait-ForOllama {
    param(
        [int]$Attempts = 30,
        [int]$DelaySeconds = 2
    )

    for ($i = 0; $i -lt $Attempts; $i++) {
        try {
            & ollama list *> $null
            return $true
        } catch {
            Start-Sleep -Seconds $DelaySeconds
        }
    }

    return $false
}

if (-not (Test-OllamaCommand)) {
    Write-Host "Ollama not found. Installing with winget..."
    & winget install --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent
}

Add-OllamaPath

if (-not (Test-OllamaCommand)) {
    throw "Ollama CLI is still not available after installation."
}

if (-not (Wait-ForOllama -Attempts 3 -DelaySeconds 1)) {
    Write-Host "Starting local Ollama service..."
    Start-Process -FilePath (Get-Command ollama).Source -ArgumentList "serve" -WindowStyle Hidden
    if (-not (Wait-ForOllama)) {
        throw "Ollama service did not become ready."
    }
}

foreach ($model in $requiredModels) {
    Write-Host "Pulling model $model ..."
    & ollama pull $model
}

Write-Host ""
Write-Host "Installed models:"
& ollama list
