# Decision Log

## Decision
- Move the repo from a cloud-provider role split to a local-first Roo Code + Ollama workflow.
- Keep the Prompt Library app as the sample implementation target inside the same repository.

## Rationale
- The v1 goal is zero additional spend and a home-PC workflow that does not depend on paid provider keys.
- Roo Code already supports local providers, while the repo already contains the RooFlow structure and memory-bank needed for multi-step work.
- Keeping the demo app gives the local workflow something concrete to plan, implement, debug, and review.

## Implementation Details
- `Local Manager` maps to `deepseek-r1:1.5b-qwen-distill-q8_0`.
- `Local Code` maps to `qwen2.5-coder:7b`.
- `Local Research` maps to `gemma3:4b`.
- Roo auto-import is configured through VS Code user settings and `roo-local-ollama-settings.json`.
- The bootstrap scripts install Ollama, pull the models, configure Roo, and verify the setup.
