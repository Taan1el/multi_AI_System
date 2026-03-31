# Project Context

## Description
This repository is a home-PC Roo Code + Ollama multi-model workspace. It keeps the RooFlow folders, prompts, and memory-bank in the repo, includes a Prompt Library app for reusable prompts, and now provides a one-prompt orchestration dashboard plus an optional hybrid cloud bridge.

## Tech Stack
- Roo Code in VS Code
- RooFlow project-local modes and prompts
- Ollama local inference
- Optional Anthropic, OpenAI, Gemini, and OpenRouter provider routing
- PowerShell bootstrap scripts
- Node.js
- Express
- Vanilla HTML, CSS, and JavaScript

## Notes
- This project uses RooFlow for multi-agent AI workflow.
- `Local Manager` = orchestration with `deepseek-r1:1.5b-qwen-distill-q8_0`
- `Local Code` = implementation with `qwen2.5-coder:7b`
- `Local Research` = planning and explanation with `gemma3:4b`
- `npm run multi-ai -- "your task"` runs a one-prompt orchestration pass.
- `npm run multi-ai -- --preset hybrid "your task"` enables optional cloud-provider routing when keys exist.
- `http://localhost:3000/orchestrator` is the built-in control dashboard for run history, artifacts, and role overrides.
- `npm run snippets:bridge` generates example Codex and Roo MCP snippets for Ollama web search and fetch.
- `Flow Orchestrator` is the default starting point for new Roo tasks.
