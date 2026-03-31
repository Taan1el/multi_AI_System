"""Fixer agent implementation for the Phase 2 pipeline."""

from __future__ import annotations

import json

from crewai import Task

from agents.base_agent import BasePhaseAgent
from schemas import (
    Implementation,
    ResearchReport,
    ReviewReport,
    TechnicalDesign,
    ValidationReport,
)


class FixerAgent(BasePhaseAgent):
    """Repair implementation issues found by review and validation."""

    role = "Issue Resolution Specialist"
    goal = "Fix problems identified by reviewer and validator"
    backstory = (
        "You revise incomplete or incorrect implementations by applying review "
        "feedback and validation findings while preserving the original intent "
        "of the requested deliverable."
    )

    def create_task(
        self,
        user_prompt: str,
        implementation: Implementation,
        review: ReviewReport,
        validation: ValidationReport,
        requirements: list[str] | None = None,
        attempt_number: int = 1,
        research: ResearchReport | None = None,
        design: TechnicalDesign | None = None,
    ) -> Task:
        """Create a repair task for a flawed implementation."""
        implementation_json = implementation.model_dump_json(indent=2)
        review_json = review.model_dump_json(indent=2)
        validation_json = validation.model_dump_json(indent=2)
        requirements_json = json.dumps(requirements or [], indent=2)
        review_issues_json = json.dumps(review.issues, indent=2)
        validation_errors_json = json.dumps(validation.schema_errors, indent=2)
        missing_requirements_json = json.dumps(
            validation.missing_requirements, indent=2
        )
        research_json = (
            research.model_dump_json(indent=2) if research is not None else "null"
        )
        design_json = design.model_dump_json(indent=2) if design is not None else "null"

        description = (
            "Revise the implementation so it better satisfies the user request, "
            "review feedback, and validation requirements.\n"
            f"Retry attempt number: {attempt_number}\n\n"
            f"Original user request:\n{user_prompt}\n\n"
            f"Required outcomes:\n{requirements_json}\n\n"
            f"Current implementation JSON:\n{implementation_json}\n\n"
            f"Review report JSON:\n{review_json}\n\n"
            f"Validation report JSON:\n{validation_json}\n\n"
            f"Research report JSON:\n{research_json}\n\n"
            f"Technical design JSON:\n{design_json}\n\n"
            f"Review issues to resolve:\n{review_issues_json}\n\n"
            f"Validation schema errors to resolve:\n{validation_errors_json}\n\n"
            f"Missing requirements to address:\n{missing_requirements_json}\n\n"
            "Resolve every issue listed above.\n"
            "Return a fully revised implementation. Keep file paths as safe "
            "relative paths, remove placeholder code, and make the deliverable "
            "more complete than the previous attempt.\n"
            "For Python outputs, return a runnable module that compiles, uses "
            "correct imports, and avoids top-level return statements.\n\n"
            f"{self.json_only_instructions(Implementation)}"
        )

        return Task(
            description=description,
            expected_output="A single JSON object that matches the Implementation schema.",
            agent=self.agent,
            output_pydantic=Implementation,
        )
