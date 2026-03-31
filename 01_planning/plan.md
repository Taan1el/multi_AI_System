# Project Plan

## Goal
Turn this repository into a home-PC Roo Code + Ollama multi-model workspace that can orchestrate planning, architecture, coding, debugging, and review without paid providers.

## Scope
- Keep RooFlow project files in the repo.
- Install and configure Ollama locally on Windows.
- Create importable Roo provider profiles for `Local Manager`, `Local Code`, and `Local Research`.
- Map the `Flow-*` modes to those local profiles.
- Preserve the existing Prompt Library demo app as a practical workflow target.

## Constraints
- Zero additional spend in v1.
- No plugin or bridge layer in v1.
- No dependence on Anthropic, OpenAI, Gemini, or Roo cloud keys.
- Optimize for an RTX 4060 8 GB + 32 GB RAM machine.
- Keep setup reproducible with scripts checked into the repo.

## Next Steps
- Maintain the local role mapping in `02_architecture/architecture.md`.
- Track setup and validation work in `03_tasks/tasks.json`.
- Use the bootstrap scripts to install Ollama, pull the models, and configure Roo.
- Validate the imported profiles and mode mapping in VS Code.
