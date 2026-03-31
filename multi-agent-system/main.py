"""CLI entrypoint for the Phase 1 local multi-agent development system."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

from orchestrator import CrewManager
from orchestrator.crew_manager import PromptValidationError
from utils.logger import configure_logging

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "output.json"


def build_parser() -> argparse.ArgumentParser:
    """Create the CLI argument parser."""
    parser = argparse.ArgumentParser(
        description="Run the local planner -> executor -> reviewer AI pipeline."
    )
    parser.add_argument(
        "prompt",
        help='User request to send through the agent pipeline, for example "Create a hello world function".',
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Path to write the final JSON payload. Defaults to output.json in the project root.",
    )
    return parser


def resolve_output_path(raw_path: str) -> Path:
    """Resolve relative output paths from the project root."""
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    return PROJECT_ROOT / candidate


def main() -> int:
    """Run the Phase 1 multi-agent pipeline from the command line."""
    args = build_parser().parse_args()
    output_path = resolve_output_path(args.output)
    configure_logging(logging.WARNING)
    load_dotenv(PROJECT_ROOT / ".env")

    try:
        manager = CrewManager.from_config(PROJECT_ROOT / "config" / "models.yaml")
        result = manager.run(args.prompt)
    except PromptValidationError as exc:
        manager = CrewManager.from_config(PROJECT_ROOT / "config" / "models.yaml")
        result = CrewManager.build_error_result(
            prompt=args.prompt,
            model_settings=manager.model_settings,
            error_type="invalid_prompt",
            message=exc.message,
        )
    except Exception as exc:
        logging.getLogger(__name__).exception("Phase 1 pipeline execution failed.")
        try:
            manager = CrewManager.from_config(PROJECT_ROOT / "config" / "models.yaml")
            result = CrewManager.build_error_result(
                prompt=args.prompt,
                model_settings=manager.model_settings,
                error_type="pipeline_error",
                message=str(exc),
            )
        except Exception:
            print(f"Pipeline failed: {exc}", file=sys.stderr)
            return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    print(f"Saved result to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
