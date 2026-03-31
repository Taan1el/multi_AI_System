# Active Context

## Current Focus
- Use the hybrid local-plus-cloud orchestrator as the main entrypoint for one-prompt multi-AI runs on the home PC.

## Recent Changes
- Added a provider-agnostic orchestration core with local and hybrid presets.
- Added an Express-backed orchestration dashboard at `/orchestrator` with run history, stage status, artifacts, and logs.
- Added optional Ollama `web_search` and `web_fetch` augmentation support when `OLLAMA_API_KEY` is configured.
- Added generated Codex and Roo integration snippets for the Ollama search bridge.
- Preserved the Prompt Library app as the prompt source and launch surface for orchestration runs.

## Open Questions
- Whether phase 2 should add a custom plugin or bridge service for deeper automatic client handoff.
- Whether future iterations should add provider-native search grounding and URL context for Gemini-specific runs.
