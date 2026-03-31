# Multi AI System

This repository now serves two purposes:

- a local Roo Code + Ollama multi-model workflow starter
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

## Run the demo app

1. Install dependencies with `npm install`
2. Start the server with `npm start`
3. Open `http://localhost:3000`

The app stores prompt data locally in `04_code/data/prompts.json`.
