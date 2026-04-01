# Multi-Agent System Phase 3

This project is a local multi-agent AI development pipeline built with CrewAI, Pydantic, and Ollama.

Phase 3 includes:

- a Planner agent that turns a raw prompt into a structured execution plan
- a Researcher agent that gathers constraints, best practices, and technology guidance for medium and complex work
- an Architect agent that produces a technical design before implementation for medium and complex work
- an Executor agent that converts the plan into implementation artifacts
- a Reviewer agent that checks the implementation and scores quality
- a Fixer agent that retries failed implementations up to two times
- a Validator agent that combines local checks with an LLM validation pass
- strict JSON validation between every agent handoff
- complexity-based routing so simple prompts stay fast while larger tasks get more planning depth
- per-agent model assignments for local Ollama execution
- a simple CLI that writes the final result to `output.json`

## Project structure

```text
multi-agent-system/
|-- agents/
|   |-- __init__.py
|   |-- architect.py
|   |-- base_agent.py
|   |-- executor.py
|   |-- fixer.py
|   |-- planner.py
|   |-- researcher.py
|   |-- reviewer.py
|   `-- validator.py
|-- schemas/
|   |-- __init__.py
|   |-- design.py
|   |-- implementation.py
|   |-- plan.py
|   |-- research.py
|   |-- review.py
|   `-- validation.py
|-- orchestrator/
|   |-- __init__.py
|   `-- crew_manager.py
|-- config/
|   |-- __init__.py
|   `-- models.yaml
|-- utils/
|   |-- __init__.py
|   |-- logger.py
|   `-- validators.py
|-- examples/
|-- main.py
|-- requirements.txt
|-- .gitignore
`-- README.md
```

## Prerequisites

- Python 3.10 or newer
- Ollama installed locally and reachable at `http://localhost:11434`
- The Ollama models `llama3.2:3b` and `qwen2.5-coder:7b` pulled locally

Pull the default Phase 3 models:

```powershell
ollama pull llama3.2:3b
ollama pull qwen2.5-coder:7b
```

## Installation

From the `multi-agent-system` folder:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Usage

Run the pipeline with a single prompt:

```powershell
python main.py "Create a Python function to calculate fibonacci"
```

The command:

1. sends the prompt to the Planner agent
2. routes simple prompts directly to Executor, Reviewer, Fixer, and Validator
3. routes medium and complex prompts through Researcher and Architect before execution
4. retries failed outputs through the Fixer agent up to two times
5. saves the final result to `output.json`

The CLI validates prompts before the crew runs. Non-actionable prompts are rejected with a valid JSON error payload instead of generating fake work.

You can also choose a custom output path:

```powershell
python main.py "Create a hello world function" --output artifacts\phase3-output.json
```

## Example prompts

These prompts have been tested against the pipeline:

- `Create a Python function that reverses a string`
- `Build a Python class for a simple todo list with add, remove, and list methods`
- `Write a short Python script that reads a text file and counts the number of lines`
- `Create a function to check if a number is prime`
- `Build a REST API with authentication, database, and CRUD operations for a blog system`

Saved example outputs:

- `examples/basic_test_output.json`
- `examples/medium_test_output.json`
- `examples/edge_case_output.json`
- `examples/phase2_complex_task_output.json`
- `examples/phase3_simple_output.json`
- `examples/phase3_complex_architecture_output.json`

## Configuration

Per-agent model settings live in `config/models.yaml`:

| Agent | Model | Temperature |
| --- | --- | --- |
| Planner | `llama3.2:3b` | `0.3` |
| Researcher | `llama3.2:3b` | `0.5` |
| Architect | `qwen2.5-coder:7b` | `0.3` |
| Executor | `qwen2.5-coder:7b` | `0.2` |
| Reviewer | `llama3.2:3b` | `0.4` |
| Fixer | `qwen2.5-coder:7b` | `0.2` |
| Validator | `llama3.2:3b` | `0.1` |

All profiles use:

- provider: `ollama`
- base URL: `http://localhost:11434`

Optional environment overrides:

- `LLM_PROVIDER`
- `OLLAMA_BASE_URL`
- `PLANNER_MODEL`
- `RESEARCHER_MODEL`
- `ARCHITECT_MODEL`
- `EXECUTOR_MODEL`
- `REVIEWER_MODEL`
- `FIXER_MODEL`
- `VALIDATOR_MODEL`
- `{AGENT}_TEMPERATURE` for any of the agent names above

If you want to use environment overrides, create a local `.env` file in the project root.

## Output format

The CLI writes a JSON document with:

- a `status` field set to `completed`, `failed_validation`, or `rejected`
- the original prompt
- model metadata
- planner output
- optional researcher output for medium and complex tasks
- optional technical design output for medium and complex tasks
- executor output
- reviewer output
- validator output
- the number of fixer retry attempts
- an `approved` boolean for quick downstream checks
- an `error` object when the prompt is rejected or a handled pipeline error occurs

Typical successful output:

```json
{
  "status": "completed",
  "prompt": "Create a function to check if a number is prime",
  "model": {
    "provider": "ollama",
    "name": "llama3.2:3b",
    "base_url": "http://localhost:11434"
  },
  "plan": {},
  "research": null,
  "design": null,
  "implementation": {},
  "review": {},
  "validation": {},
  "fix_attempts": 0,
  "approved": true
}
```

Typical rejected output:

```json
{
  "status": "rejected",
  "prompt": "invalid gibberish prompt xyz123",
  "model": {
    "provider": "ollama",
    "name": "llama3.2:3b",
    "base_url": "http://localhost:11434"
  },
  "plan": null,
  "research": null,
  "design": null,
  "implementation": null,
  "review": null,
  "validation": null,
  "fix_attempts": 0,
  "approved": false,
  "error": {
    "type": "invalid_prompt",
    "message": "Prompt does not describe a clear task."
  }
}
```

## Troubleshooting

- If you see a connection error, make sure Ollama is installed and running on `http://localhost:11434`.
- If the models are missing, run `ollama pull llama3.2:3b` and `ollama pull qwen2.5-coder:7b`.
- If a prompt is rejected, rewrite it as a concrete request starting with words like `Create`, `Build`, `Write`, `Explain`, or `Analyze`.
- If a medium or complex task is missing `research` or `design`, make the prompt more explicit about the larger system or multi-component deliverable.
- If the reviewer returns `needs_revision`, that is expected behavior for imperfect implementations. The fixer and validator stages are designed to keep iterating when concrete issues remain.
- Generated file artifacts must use safe relative paths. Absolute paths and parent-directory traversal are rejected during schema validation.

## Development notes

- All agent outputs are validated with Pydantic models.
- The CrewAI process is sequential.
- The system expects JSON-only agent responses and performs defensive parsing before validation.
- The CLI rejects vague prompts before invoking the agents and returns a valid JSON rejection result.
- Implementation artifacts are validated to ensure file paths are safe relative paths.
- Local validation utilities also check JSON structure, schema compliance, placeholder code, syntax, and requirement coverage.
- The validator may trigger the fixer when review or validation finds concrete issues, with a maximum of two retry attempts.
- Imports use package-style `__init__.py` files so the project runs as standard Python modules.
