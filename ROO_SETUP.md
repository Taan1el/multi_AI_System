# Roo Local Ollama Setup

## Purpose

This repository is configured for a local-first Roo Code workflow on the home PC.

- Roo Code is the orchestration surface.
- Ollama provides the local models.
- No paid Roo cloud workflow is required for v1.
- The Codex desktop app is not the primary orchestrator in this setup.

## Local profiles

The repo ships with an auto-import settings file at `roo-local-ollama-settings.json`.
It creates these Roo provider profiles:

1. `Local Manager`
   - Provider: Ollama
   - Model: `deepseek-r1:1.5b-qwen-distill-q8_0`
   - Use for orchestration, decomposition, and summaries

2. `Local Code`
   - Provider: Ollama
   - Model: `qwen2.5-coder:7b`
   - Use for coding, diffs, and implementation work

3. `Local Research`
   - Provider: Ollama
   - Model: `gemma3:4b`
   - Use for architecture, analysis, and explanation

## Flow mapping

- `Flow Orchestrator` -> `Local Manager`
- `Flow Code` -> `Local Code`
- `Flow Debug` -> `Local Code`
- `Flow Ask` -> `Local Research`
- `Flow Architect` -> `Local Research`

## One-command bootstrap

Run this on the home PC:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-home-pc.ps1
```

The bootstrap does the following:

1. Installs Ollama if it is missing.
2. Starts the local Ollama service if needed.
3. Pulls the required local models.
4. Writes the Roo auto-import path into VS Code user settings.
5. Verifies Roo, Ollama, the imported config file, and the required models.
6. Opens this repository in VS Code.

## Individual commands

You can also run the pieces separately:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-ollama-models.ps1
powershell -ExecutionPolicy Bypass -File scripts/configure-roo-local.ps1 -OpenVSCode
powershell -ExecutionPolicy Bypass -File scripts/verify-roo-local.ps1
```

## Starting a RooFlow task

1. Open this repository in VS Code.
2. Open the Roo Code sidebar.
3. Reload the VS Code window once if Roo was already open before setup.
4. Start a new Roo chat in this repo.
5. Switch to `Flow Orchestrator` for new work.
6. Let the orchestrator route work to `Flow Architect`, `Flow Code`, `Flow Debug`, or `Flow Ask`.

## Workflow contract in this repo

- `01_planning` stores intent and scope.
- `02_architecture` stores design decisions.
- `03_tasks` stores structured execution work.
- `04_code` stores implementation output.
- `05_reviews` stores findings and follow-up items.
- `memory-bank` stores persistent project context between chats.

## Limits for v1

- No paid Claude, Gemini, OpenAI, or Roo cloud providers are required.
- No plugin or bridge service is included yet.
- No automatic handoff from the Codex desktop app to Roo is included.
- If the local workflow feels too manual later, build a local bridge in phase 2.
