# Architecture

## Overview
The repository is organized as a local-first Roo workflow workspace. VS Code hosts Roo Code, RooFlow keeps the project-local modes and prompts, Ollama serves the local models, and repo-owned PowerShell scripts bootstrap the machine state. The sample Prompt Library app in `04_code` remains available as a local target project for end-to-end workflow tests.

## Components
- `roo-local-ollama-settings.json`
  Stores importable Roo provider profiles and the mode-to-profile mapping.
- `scripts/configure-roo-local.ps1`
  Writes the Roo auto-import path into VS Code user settings and can open this repo in VS Code.
- `scripts/install-ollama-models.ps1`
  Installs Ollama if needed, starts the runtime, and pulls the required models.
- `scripts/bootstrap-home-pc.ps1`
  Runs the full home-PC setup sequence and finishes with verification.
- `scripts/verify-roo-local.ps1`
  Checks VS Code, Roo Code, import settings, Ollama, and the required models.
- `.roomodes` and `.roo/`
  Define the project-local Flow modes and their prompts.
- `memory-bank/`
  Stores persistent context for Roo chats.
- `04_code/`
  Holds the runnable Prompt Library demo app used for validation.

## Local model mapping
- `Local Manager`
  - Provider: Ollama
  - Model: `deepseek-r1:1.5b-qwen-distill-q8_0`
  - Role: orchestration, decomposition, summaries
- `Local Code`
  - Provider: Ollama
  - Model: `qwen2.5-coder:7b`
  - Role: implementation, diffs, file edits
- `Local Research`
  - Provider: Ollama
  - Model: `gemma3:4b`
  - Role: architecture, analysis, explanations

## Flow routing
1. Start a Roo task in `Flow Orchestrator`.
2. `Flow Orchestrator` uses `Local Manager` to split the request into planning, architecture, code, debug, and review work.
3. `Flow Architect` and `Flow Ask` use `Local Research`.
4. `Flow Code` and `Flow Debug` use `Local Code`.
5. Results are written back into `01_planning`, `02_architecture`, `03_tasks`, `04_code`, `05_reviews`, and `memory-bank`.

## Risks
- Roo auto-import applies on extension startup, so VS Code may need a reload if Roo is already open.
- Local model performance depends on context size and VRAM pressure, especially for coding sessions.
- The workflow still relies on manual mode selection inside Roo in v1; a bridge service is deferred to phase 2.
