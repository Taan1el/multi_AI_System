# Multi AI System

This repository now provides:

- a local Roo Code + Ollama workflow starter
- a one-prompt multi-AI orchestration runner
- an optional cloud-provider bridge for Anthropic, OpenAI, Gemini, and OpenRouter
- a Prompt Library demo app with a built-in orchestration dashboard

## Local setup

Bootstrap the home PC:

```powershell
npm run setup:roo-local
```

Verify the local setup:

```powershell
npm run verify:roo-local
```

## Optional cloud bridge

Copy `.env.example` to `.env` and add only the provider keys you want:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `OLLAMA_API_KEY`

If you leave cloud keys empty, the system still works in local-only mode.

## Run the one-prompt workflow

Local-only preset:

```powershell
npm run multi-ai -- "Design a desktop note-taking app with local sync and tagging"
```

Hybrid preset:

```powershell
npm run multi-ai -- --preset hybrid "Design a desktop note-taking app with local sync and tagging"
```

Dry run without writing back into the Roo workspace:

```powershell
npm run multi-ai -- --preset hybrid --no-workspace-sync "Design a desktop note-taking app with local sync and tagging"
```

What the runner does:

1. Resolves the manager, architect, code, and review profiles from the selected preset.
2. Falls back automatically if a preferred cloud profile is unavailable.
3. Writes a full run into `output/multi-ai-runs/<timestamp>-<slug>/`.
4. Optionally syncs `plan.md`, `architecture.md`, `tasks.json`, `review.md`, and `memory-bank/activeContext.md` back into the Roo workspace.

## Run the app

```powershell
npm install
npm start
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/orchestrator`

The app stores prompt data locally in `04_code/data/prompts.json`.

The orchestrator dashboard lets you:

- start a run from one prompt
- switch between `local` and `hybrid`
- override role-to-profile routing
- inspect run history, stage state, logs, and artifacts
- launch runs from saved prompt templates

## Generate Codex and Roo integration snippets

```powershell
npm run snippets:bridge
```

This writes example files into `output/integration-snippets/`.

These snippets mirror Ollama's documented Codex and MCP integration pattern for `web_search` and `web_fetch`. They are examples only and do not edit your local Codex or Roo config automatically.

## More detail

- Local Roo + Ollama setup: `ROO_SETUP.md`
- Hybrid provider bridge: `HYBRID_BRIDGE.md`
