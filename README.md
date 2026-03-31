# Multi AI System

This repository now serves two purposes:

- a local Roo Code + Ollama multi-model workflow starter
- a one-prompt local multi-model orchestration runner
- a small Prompt Library demo app in `04_code`

## Set up local Roo + Ollama

Run the home-PC bootstrap:

```powershell
npm run setup:roo-local
```

Verification:

```powershell
npm run verify:roo-local
```

## Run the one-prompt multi-AI workflow

After the local setup is done, run:

```powershell
npm run multi-ai -- "Design a desktop note-taking app with local sync and tagging"
```

What it does:

1. Sends your prompt to `Local Manager`, `Local Research`, `Local Code`, and `Local Research` again for review.
2. Writes a full run into `output/multi-ai-runs/<timestamp>-<slug>/`.
3. Syncs the latest `plan.md`, `architecture.md`, `tasks.json`, `review.md`, and `memory-bank/activeContext.md` back into the Roo workspace.

You can also run the same flow from VS Code with the task `Run Multi-AI Orchestration`.

If you want a dry orchestration run without overwriting the workspace files:

```powershell
npm run multi-ai -- --no-workspace-sync "Design a desktop note-taking app with local sync and tagging"
```

## Run the demo app

1. Install dependencies with `npm install`
2. Start the server with `npm start`
3. Open `http://localhost:3000`

The app stores prompt data locally in `04_code/data/prompts.json`.
