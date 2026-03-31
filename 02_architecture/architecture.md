# Architecture

## Overview
The Prompt Library app uses a small Express server to serve a static frontend and expose CRUD endpoints for prompt records. The frontend renders a split workspace with a searchable prompt list on one side and an editor/detail panel on the other. Prompt data is persisted to `04_code/data/prompts.json`, allowing the app to remain self-contained and easy to run locally.

## Components
- `04_code/server.js`
  Runs the Express server, serves static assets, validates API payloads, and persists prompt data.
- `04_code/data/prompts.json`
  Stores prompt records as local JSON with metadata such as tags and timestamps.
- `04_code/public/index.html`
  Defines the app shell and semantic layout for the prompt library UI.
- `04_code/public/styles.css`
  Provides the visual system, responsive layout, and interaction styling.
- `04_code/public/app.js`
  Manages client-side state, rendering, filtering, editing, and API calls.

## Data Flow
1. The browser loads the app shell from the Express static server.
2. The frontend fetches the current prompt list from `GET /api/prompts`.
3. The user searches, filters, selects, or edits prompts in the client UI.
4. Create and update actions post JSON payloads to the API.
5. The server validates input, writes the updated prompt collection to disk, and returns normalized prompt data.
6. The client re-renders the prompt list, active detail view, and available tags from the latest server response.

## Risks
- Concurrent writes could overwrite data if multiple users edit at the same time; acceptable for a single-user local workflow.
- JSON corruption would affect startup, so the server should create or recover the data file when missing.
- Search could feel cluttered if the UI becomes too dense, so the interface should stay restrained and text-led.
