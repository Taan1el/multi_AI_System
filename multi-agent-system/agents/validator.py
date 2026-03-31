"""Validator agent implementation for the Phase 2 pipeline."""

from __future__ import annotations

import json
from typing import Any

from crewai import Task

from agents.base_agent import BasePhaseAgent
from schemas import Implementation, ReviewReport, ValidationReport


class ValidatorAgent(BasePhaseAgent):
    """Validate implementation quality and delivery readiness."""

    role = "Final Quality Validator"
    goal = "Ensure all outputs meet schema and quality standards"
    backstory = (
        "You are the final gate before delivery, combining review feedback, "
        "requirements coverage, and structural validation to decide if the "
        "result is complete enough to ship."
    )

    def create_task(
        self,
        user_prompt: str,
        implementation: Implementation,
        review: ReviewReport,
        requirements: list[str] | None = None,
        utility_findings: dict[str, Any] | None = None,
    ) -> Task:
        """Create the validation task using structured payloads."""
        requirements_json = json.dumps(requirements or [], indent=2)
        utility_json = json.dumps(utility_findings or {}, indent=2)
        implementation_json = implementation.model_dump_json(indent=2)
        review_json = review.model_dump_json(indent=2)

        description = (
            "Validate whether the implementation is complete and ready for "
            "delivery.\n"
            f"Original user request:\n{user_prompt}\n\n"
            f"Plan requirements:\n{requirements_json}\n\n"
            f"Implementation JSON:\n{implementation_json}\n\n"
            f"Review report JSON:\n{review_json}\n\n"
            f"Local validation findings:\n{utility_json}\n\n"
            "Use the review and local findings as evidence, but make an "
            "independent final validation judgment.\n"
            "The missing_requirements field must contain only items drawn from "
            "the provided plan requirements or be an empty list. Do not invent "
            "new requirements from recommendations or future improvements.\n"
            "If local validation findings include schema_errors or missing "
            "requirements that are still visible in the implementation, keep "
            "them in your final report.\n"
            "Set valid to true only when the implementation is structurally "
            "sound and materially addresses the request.\n"
            "Set ready_for_delivery to true only when the result is ready to "
            "hand back to the user without further repair.\n\n"
            f"{self.json_only_instructions(ValidationReport)}"
        )

        return Task(
            description=description,
            expected_output="A single JSON object that matches the ValidationReport schema.",
            agent=self.agent,
            output_pydantic=ValidationReport,
        )
