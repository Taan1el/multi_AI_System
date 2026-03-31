"""Reviewer agent implementation for the Phase 1 pipeline."""

from __future__ import annotations

from typing import cast

from crewai import Task

from agents.base_agent import BasePhaseAgent
from schemas import Implementation, ReviewReport


class ReviewerAgent(BasePhaseAgent):
    """Review executor output and produce a structured quality report."""

    role = "Quality Assurance Specialist"
    goal = "Review implementations for correctness and quality"
    backstory = (
        "You look for correctness, completeness, and maintainability issues in "
        "deliverables before they are handed back to the user."
    )

    def create_task(
        self, user_prompt: str, implementation_input: Task | Implementation
    ) -> Task:
        """Create the review task using an implementation task or payload."""
        description = (
            "Review the implementation payload for the user's request and "
            "report whether it is ready to approve.\n"
            f"Original user request:\n{user_prompt}\n\n"
            "Evaluate the implementation for correctness, completeness, and "
            "overall quality.\n"
            "Only report issues that are directly supported by the provided "
            "implementation content. Do not invent missing imports, missing "
            "functions, or missing files if they are present in the JSON.\n"
            "For example configuration files such as .env.example, placeholder "
            "sample values are acceptable and should not be treated as leaked "
            "or hardcoded production secrets.\n"
            "Check whether the generated code is likely runnable and logically "
            "consistent. For Python outputs, do not approve code that has "
            "obvious syntax problems, incorrect imports, undefined variables, "
            "or missing error-handling promised by the request.\n"
            "For REST APIs or web backends, do not approve implementations "
            "that leave authenticated routes unprotected, skip basic request "
            "validation, hardcode secrets, or initialize database state in an "
            "unsafe way.\n"
            "Treat try/catch around database or network operations as basic "
            "error handling when it returns an appropriate error response.\n"
            "For Node.js/CommonJS code, verify that require() usage matches the "
            "exported module shape. Count CRUD as satisfied when the main "
            "resource exposes create/read/update/delete handlers or the "
            "equivalent POST/GET/PUT/DELETE routes.\n"
            "Set status to approved or needs_revision.\n"
            "Set quality_score between 0 and 100.\n"
            "Use issues for concrete findings with low, medium, or high severity.\n"
            "Use recommendations for improvements or next steps.\n\n"
        )
        task_kwargs: dict[str, object] = {}

        if isinstance(implementation_input, Task):
            task_kwargs["context"] = [implementation_input]
        else:
            description += (
                "Implementation JSON:\n"
                f"{cast(Implementation, implementation_input).model_dump_json(indent=2)}\n\n"
            )

        description += self.json_only_instructions(ReviewReport)

        return Task(
            description=description,
            expected_output="A single JSON object that matches the ReviewReport schema.",
            agent=self.agent,
            output_pydantic=ReviewReport,
            **task_kwargs,
        )
