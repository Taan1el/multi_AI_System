# Product Context

## Description
- See `context.md` for the shared project summary.
- The current project deliverable is a local Prompt Library app that demonstrates the RooFlow planning-to-implementation loop.

## Goals
- Showcase the multi-agent workflow with a real but compact deliverable.
- Provide a prompt management tool with local persistence and a polished editing surface.

## Key Features
- Add, edit, and delete prompts.
- Tag prompts and filter/search them in the browser.
- Persist data locally to a JSON file without a database.

## Overall Architecture
- Express API plus static frontend assets.
- Client-side rendering and filtering in vanilla JavaScript.
- File-backed storage in `04_code/data/prompts.json`.
