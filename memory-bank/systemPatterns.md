# System Patterns

## Workflow Pattern
- `01_planning/plan.md` captures the idea and scope.
- `02_architecture/architecture.md` captures the structure and design.
- `03_tasks/tasks.json` stores structured implementation work.
- `05_reviews/review.md` captures review findings and follow-up work.
- `04_code` holds the actual build output so planning and execution stay clearly separated.

## Agent Pattern
- Claude owns planning, architecture, and review.
- Codex owns implementation.
- RooFlow modes are used to keep those roles explicit.
- Flow Debug is used for defect isolation and Flow Ask is used for explanation-only turns.
