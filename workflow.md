# Workflow

1. Run `npm run multi-ai -- "your task"` to fan one prompt out across the local models.
2. `Local Manager` creates the orchestration brief and `plan.md`.
3. `Local Research` generates `architecture.md`.
4. `Local Manager` produces `tasks.json`.
5. `Local Code` writes the implementation handoff.
6. `Local Research` writes `review.md`.
7. The runner syncs the Roo workspace files and stores the full run under `output/multi-ai-runs/`.
8. Continue in Roo with `Flow Orchestrator`, `Flow Code`, `Flow Ask`, or `Flow Architect` until the task is complete.
