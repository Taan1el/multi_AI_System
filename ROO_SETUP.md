# Roo Local Ollama Setup

## Purpose

This repository is configured for a local-first Roo Code workflow on the home PC, with an optional cloud bridge layered on top.

- Roo Code is the orchestration surface.
- Ollama provides the default local models.
- Cloud providers are optional and only activate when credentials exist.
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

## One prompt -> multiple AIs

Use the CLI for a single prompt orchestration run:

```powershell
npm run multi-ai -- "Build a local-first task manager with search and keyboard shortcuts"
```

That local pipeline does this:

1. `Local Manager` creates the orchestration brief and planning pass.
2. `Local Research` writes architecture.
3. `Local Code` writes the implementation handoff.
4. `Local Manager` synthesizes deterministic tasks.
5. `Local Research` reviews the pass.
6. The run is saved under `output/multi-ai-runs/` and the Roo workspace files can be updated.

If you want the run without overwriting the current workspace files:

```powershell
npm run multi-ai -- --no-workspace-sync "Build a local-first task manager with search and keyboard shortcuts"
```

## Hybrid cloud bridge

The repo also supports a hybrid preset. Add keys to `.env` only for the providers you want:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `OLLAMA_API_KEY`

Then run:

```powershell
npm run multi-ai -- --preset hybrid "Build a local-first task manager with search and keyboard shortcuts"
```

The hybrid preset prefers cloud profiles per role and falls back automatically when a key is missing.

## Dashboard

Start the app:

```powershell
npm start
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/orchestrator`

The dashboard gives you:

- prompt templates from the Prompt Library
- local or hybrid preset selection
- per-role profile overrides
- run history
- live stage updates
- artifacts and logs

## Starting a RooFlow task

1. Open this repository in VS Code.
2. Open the Roo Code sidebar.
3. Reload the VS Code window once if Roo was already open before setup.
4. Start a new Roo chat in this repo.
5. Switch to `Flow Orchestrator` for new work.
6. Let the orchestrator route work to `Flow Architect`, `Flow Code`, `Flow Debug`, or `Flow Ask`.
7. Or run `npm run multi-ai -- "your task"` first, then continue the generated workspace in Roo.

## Workflow contract in this repo

- `01_planning` stores intent and scope.
- `02_architecture` stores design decisions.
- `03_tasks` stores structured execution work.
- `04_code` stores implementation output.
- `05_reviews` stores findings and follow-up items.
- `memory-bank` stores persistent project context between chats.

## Optional Codex and Roo snippets

Generate example integration snippets with:

```powershell
npm run snippets:bridge
```

That writes example files into `output/integration-snippets/`.

## Limits for the current version

- The local workflow is the default and works with zero paid provider keys.
- Cloud support is optional, not required.
- No automatic handoff from the Codex desktop app to Roo is included.
- The Codex/Ollama bridge in this repo is config-driven and snippet-based, not a full custom plugin.
- If you want deeper client integration later, the next step is a dedicated bridge or plugin layer.
