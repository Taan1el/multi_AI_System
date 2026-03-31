"""Planner agent implementation for the Phase 1 pipeline."""

from __future__ import annotations

from crewai import Task

from agents.base_agent import BasePhaseAgent
from schemas.plan import PlanOutput


class PlannerAgent(BasePhaseAgent):
    """Analyze user prompts and produce structured execution plans."""

    role = "Task Planning Specialist"
    goal = "Analyze user prompts and create structured execution plans"
    backstory = (
        "You break down ambiguous requests into concrete, ordered plans that "
        "help downstream implementation agents succeed without rework."
    )

    def create_task(self, user_prompt: str) -> Task:
        """Create the planning task for the given user prompt."""
        description = (
            "Analyze the user request and create a concise execution plan.\n"
            f"User request:\n{user_prompt}\n\n"
            "Set task_type to one of: code_generation, analysis, content.\n"
            "Set complexity to one of: simple, medium, complex.\n"
            "Use these rules when assigning complexity:\n"
            "- simple: a single function, short script, or narrowly scoped output\n"
            "- medium: multiple classes/modules, several requirements, or moderate integration work\n"
            "- complex: systems involving APIs, authentication, databases, CRUD, services, or multi-component architecture\n"
            "List the concrete requirements that must be satisfied.\n"
            "List the execution steps in order.\n"
            "Provide a realistic human-readable estimated_duration.\n\n"
            f"{self.json_only_instructions(PlanOutput)}"
        )

        return Task(
            description=description,
            expected_output="A single JSON object that matches the PlanOutput schema.",
            agent=self.agent,
            output_pydantic=PlanOutput,
        )
