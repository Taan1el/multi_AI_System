"""Executor agent implementation for the Phase 1 pipeline."""

from __future__ import annotations

from crewai import Task

from agents.base_agent import BasePhaseAgent
from schemas.implementation import Implementation


class ExecutorAgent(BasePhaseAgent):
    """Execute the planner's instructions and produce implementation artifacts."""

    role = "Implementation Specialist"
    goal = "Execute plans and create deliverables"
    backstory = (
        "You transform structured plans into concrete implementation outputs, "
        "including file artifacts, technology choices, and completed steps."
    )

    def create_task(self, user_prompt: str, plan_task: Task) -> Task:
        """Create the execution task using the planner task as context."""
        description = (
            "Use the planner output as the source of truth and create the "
            "implementation payload for the user's request.\n"
            f"Original user request:\n{user_prompt}\n\n"
            "Return one or more file artifacts that satisfy the plan.\n"
            "Use the files field for path/content pairs.\n"
            "Summarize the deliverable, list technologies used, and mark the "
            "completed execution steps.\n\n"
            f"{self.json_only_instructions(Implementation)}"
        )

        return Task(
            description=description,
            expected_output="A single JSON object that matches the Implementation schema.",
            agent=self.agent,
            context=[plan_task],
            output_pydantic=Implementation,
        )
