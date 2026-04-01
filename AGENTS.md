# Agent Operating Contract

This repository runs a shared-workspace multi-agent orchestration system.

## Runtime Roles

- `manager`: owns task creation, handoffs, refinement, and terminal run decisions.
- `architect`: produces system structure, file boundaries, interfaces, and build order.
- `coder`: edits the shared workspace, proposes safe shell commands, and returns implementation evidence.
- `designer`: produces implementation-ready UI and interaction specifications in text form.
- `reviewer`: approves work or blocks it with concrete revision requests.
- `researcher`: produces bounded research context, risk analysis, and evidence summaries.

## Shared Contracts

- Every task artifact must validate against `schemas/task.schema.json`.
- Every handoff artifact must validate against `schemas/handoff.schema.json`.
- Every review artifact must validate against `schemas/review.schema.json`.
- Every run report must validate against `schemas/run-report.schema.json`.

## External Execution Targets

- Ollama is a local model runtime and optional search or fetch bridge only.
- Claude Code can consume these contracts as an execution surface, but it is not a local runtime in this repo.
- Cursor can consume these contracts via repo instructions, but it is not a provider adapter in this repo.

## Artifact Flow

1. The manager creates or refines a task.
2. The manager writes a structured handoff to the target specialist.
3. The specialist returns work artifacts for the task.
4. The reviewer emits a structured review artifact.
5. The manager either approves the task outcome or refines the task for the next iteration.

## Revision Rule

Every rejected task must apply at least one concrete `revision_request` directive by changing one or more meaningful task fields before the next iteration begins.
