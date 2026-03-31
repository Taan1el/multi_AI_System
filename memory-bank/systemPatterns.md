# System Patterns

## Workflow Pattern
- `01_planning/plan.md` captures the idea, scope, and constraints.
- `02_architecture/architecture.md` captures the structure and design.
- `03_tasks/tasks.json` stores structured execution work.
- `05_reviews/review.md` captures review findings and follow-up work.
- `04_code` holds the actual build output so planning and execution stay clearly separated.

## Agent Pattern
- `Flow Orchestrator` starts new work and routes subtasks.
- `Flow Architect` and `Flow Ask` use the `Local Research` profile.
- `Flow Code` and `Flow Debug` use the `Local Code` profile by default.
- `Local Manager` is reserved for orchestration and summary work.
- The memory-bank keeps persistent context between Roo chats.
