# Hybrid Local + Cloud Bridge

This repository now supports two orchestration presets:

- `local`: all roles use local Ollama models
- `hybrid`: each role prefers a cloud provider when credentials exist and falls back to local profiles when they do not

## Current role routing

### Local preset

- `manager` -> `local-manager`
- `architect` -> `local-research`
- `code` -> `local-code`
- `review` -> `local-research`

### Hybrid preset

- `manager` -> `local-manager`, then `openrouter-fallback`
- `architect` -> `anthropic-architect`, then `gemini-review`, then `local-research`
- `code` -> `openai-code`, then `openrouter-fallback`, then `local-code`
- `review` -> `gemini-review`, then `anthropic-architect`, then `local-research`

## Optional credentials

Copy `.env.example` to `.env` and add only the providers you want:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `OLLAMA_API_KEY`

If a cloud key is missing, the hybrid preset keeps running and falls back to the next available profile.

## Dashboard

Start the app and open:

- `http://localhost:3000`
- `http://localhost:3000/orchestrator`

The dashboard lets you:

- launch a run from one prompt
- choose `local` or `hybrid`
- override manager, architect, code, and review profiles
- pull prompt templates from the Prompt Library
- inspect stage status, logs, artifacts, and run history

## CLI

Local-only:

```powershell
npm run multi-ai -- "Design a local-first task board with keyboard shortcuts"
```

Hybrid:

```powershell
npm run multi-ai -- --preset hybrid "Design a local-first task board with keyboard shortcuts"
```

Dry run without writing back into the Roo workspace:

```powershell
npm run multi-ai -- --preset hybrid --no-workspace-sync "Design a local-first task board with keyboard shortcuts"
```

## Ollama search and fetch bridge

When `OLLAMA_API_KEY` is present and `webSearch.enabled` is true in `multi-ai.config.json`, the orchestrator can augment a run with:

- `web_search` via `https://ollama.com/api/web_search`
- `web_fetch` via `https://ollama.com/api/web_fetch`

This follows Ollama's documented search and fetch flow. If no key is present, the app cleanly falls back to direct URL fetch for reference URLs and disables the dashboard search toggle.

## Codex and Roo snippets

Generate example MCP snippets with:

```powershell
npm run snippets:bridge
```

That writes:

- `output/integration-snippets/codex-ollama-web-search.example.toml`
- `output/integration-snippets/roo-ollama-web-search.example.json`

Important clarification:

- Ollama's "Codex" docs page shows how Codex can use Ollama's search and fetch tools through MCP.
- It does not mean Codex itself runs inside Ollama.

In this repo:

- real OpenAI/Codex usage comes from the optional `openai-code` cloud profile
- Ollama provides local models plus optional search and fetch augmentation

## Upstream patterns used here

This implementation intentionally borrows patterns from the upstream projects instead of copying their full codebase:

- Roo Code provider/profile structure and provider-specific settings:
  [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code)
- Roo Code provider settings schema:
  [packages/types/src/provider-settings.ts](https://github.com/RooCodeInc/Roo-Code/blob/main/packages/types/src/provider-settings.ts)
- Ollama web search docs and Codex MCP snippet:
  [docs.ollama.com/capabilities/web-search](https://docs.ollama.com/capabilities/web-search)
- Ollama web search implementation:
  [app/tools/web_search.go](https://github.com/ollama/ollama/blob/main/app/tools/web_search.go)
