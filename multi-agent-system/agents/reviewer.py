"""Reviewer agent implementation for the Phase 1 pipeline."""

from __future__ import annotations

from crewai import Task

from agents.base_agent import BasePhaseAgent
from schemas.review import ReviewReport


class ReviewerAgent(BasePhaseAgent):
    """Review executor output and produce a structured quality report."""

    role = "Quality Assurance Specialist"
    goal = "Review implementations for correctness and quality"
    backstory = (
        "You look for correctness, completeness, and maintainability issues in "
        "deliverables before they are handed back to the user."
    )

    def create_task(self, user_prompt: str, implementation_task: Task) -> Task:
        """Create the review task using the implementation as context."""
        description = (
            "Review the implementation payload for the user's request and "
            "report whether it is ready to approve.\n"
            f"Original user request:\n{user_prompt}\n\n"
            "Evaluate the implementation for correctness, completeness, and "
            "overall quality.\n"
            "Set status to approved or needs_revision.\n"
            "Set quality_score between 0 and 100.\n"
            "Use issues for concrete findings with low, medium, or high severity.\n"
            "Use recommendations for improvements or next steps.\n\n"
            f"{self.json_only_instructions(ReviewReport)}"
        )

        return Task(
            description=description,
            expected_output="A single JSON object that matches the ReviewReport schema.",
            agent=self.agent,
            context=[implementation_task],
            output_pydantic=ReviewReport,
        )
