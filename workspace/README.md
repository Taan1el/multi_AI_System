# Shared Workspace Contract

Each orchestration run creates an isolated workspace at:

- `output/multi-ai-runs/<run-id>/workspace/`

## Rules

- specialist agents read and write inside the run workspace first
- repo sync happens only after approved task outcomes
- task artifacts define the allowed workspace scope for each iteration
- command execution is bounded and recorded in run artifacts

## Expected Artifacts

- `tasks/` contains one JSON task artifact per task
- `handoffs/` contains one JSON handoff artifact per agent transition
- `reviews/` contains one JSON review artifact per review cycle
- `run-report.json` records terminal run state and artifact references

## Sync Policy

- `workspaceSync: false` keeps code changes inside the run workspace
- `workspaceSync: true` copies approved changed files back into the repo root
