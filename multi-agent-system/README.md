# Multi-Agent System Phase 1

This project is a local multi-agent AI development pipeline built with CrewAI, Pydantic, and Ollama.

Phase 1 includes:

- a Planner agent that turns a raw prompt into a structured execution plan
- an Executor agent that converts the plan into implementation artifacts
- a Reviewer agent that checks the implementation and scores quality
- strict JSON validation between every agent handoff
- a simple CLI that writes the final result to `output.json`

## Project structure

```text
multi-agent-system/
├── agents/
│   ├── __init__.py
│   ├── base_agent.py
│   ├── planner.py
│   ├── executor.py
│   └── reviewer.py
├── schemas/
│   ├── __init__.py
│   ├── plan.py
│   ├── implementation.py
│   └── review.py
├── orchestrator/
│   ├── __init__.py
│   └── crew_manager.py
├── config/
│   ├── __init__.py
│   └── models.yaml
├── utils/
│   ├── __init__.py
│   └── logger.py
├── main.py
├── requirements.txt
├── .gitignore
└── README.md
```

## Prerequisites

- Python 3.10 or newer
- Ollama installed locally
- The Ollama model `llama3.2:3b` pulled locally

Pull the default model:

```powershell
ollama pull llama3.2:3b
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
2. passes the validated plan to the Executor agent
3. passes the validated implementation to the Reviewer agent
4. saves the final result to `output.json`

You can also choose a custom output path:

```powershell
python main.py "Create a hello world function" --output artifacts\phase1-output.json
```

## Configuration

Default model settings live in `config/models.yaml`:

- provider: `ollama`
- model: `llama3.2:3b`
- base URL: `http://localhost:11434`

Optional environment overrides:

- `LLM_PROVIDER`
- `OLLAMA_MODEL`
- `OLLAMA_BASE_URL`
- `LLM_TEMPERATURE`

If you want to use environment overrides, create a local `.env` file in the project root.

## Output format

The CLI writes a JSON document with:

- the original prompt
- model metadata
- planner output
- executor output
- reviewer output
- an `approved` boolean for quick downstream checks

## Development notes

- All three agent outputs are validated with Pydantic models.
- The CrewAI process is sequential.
- The system expects JSON-only agent responses and performs defensive parsing before validation.
- Imports use package-style `__init__.py` files so the project runs as standard Python modules.
