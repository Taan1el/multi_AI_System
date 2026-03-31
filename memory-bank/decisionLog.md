# Decision Log

## Decision
- Use RooFlow with a Claude and Codex split.
- Implement the sample workflow as a small Express app with a static frontend and local JSON persistence.

## Rationale
- Claude is better positioned for planning, structure, and review workflows.
- Codex is better positioned for implementation and direct execution work.
- A file-backed Node.js app is fast to build, easy to inspect, and ideal for proving the multi-agent workflow without extra infrastructure.

## Implementation Details
- Flow Architect is mapped to Claude responsibilities.
- Flow Code is mapped to Codex responsibilities.
- Flow Debug handles defect repair and Flow Ask handles explanations.
- The app serves a static UI from `04_code/public` and stores prompts in `04_code/data/prompts.json`.
