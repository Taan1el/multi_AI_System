# Product Context

## Description
- See `context.md` for the shared project summary.
- The primary deliverable is a local Roo Code + Ollama workflow starter for the home PC.
- The Prompt Library app remains in the repo as a concrete test target for the workflow.

## Goals
- Enable multi-step Roo workflows without paid model providers.
- Keep orchestration, architecture, coding, and review separated through project-local Flow modes.
- Make setup reproducible with repo-owned scripts and importable Roo settings.

## Key Features
- Auto-imported Roo provider profiles for local Ollama models.
- PowerShell bootstrap and verification scripts for Windows.
- Memory-bank and RooFlow directory structure kept in-repo.
- A runnable demo app under `04_code` for real workflow validation.

## Overall Architecture
- VS Code + Roo Code as the front-end orchestration layer.
- Ollama as the local model runtime.
- Repo-owned settings import and setup scripts for reproducibility.
- `04_code` as the local target project for implementation tasks.
