# Project Context

## Description
This repository is a home-PC Roo Code + Ollama multi-model workspace. It keeps the RooFlow folders, prompts, and memory-bank in the repo, and it also includes a small Prompt Library app as a real local project to use during orchestration tests.

## Tech Stack
- Roo Code in VS Code
- RooFlow project-local modes and prompts
- Ollama local inference
- PowerShell bootstrap scripts
- Node.js
- Express
- Vanilla HTML, CSS, and JavaScript

## Notes
- This project uses RooFlow for multi-agent AI workflow.
- `Local Manager` = orchestration with `deepseek-r1:1.5b-qwen-distill-q8_0`
- `Local Code` = implementation with `qwen2.5-coder:7b`
- `Local Research` = planning and explanation with `gemma3:4b`
- `Flow Orchestrator` is the default starting point for new Roo tasks.
- Paid Claude, Gemini, OpenAI, and Roo cloud providers are out of scope for v1.
