"""Researcher agent implementation for the Phase 3 pipeline."""

from __future__ import annotations

from crewai import Task

from agents.base_agent import BasePhaseAgent
from schemas import PlanOutput, ResearchReport


class ResearcherAgent(BasePhaseAgent):
    """Expand a plan into implementation constraints and best practices."""

    role = "Technical Research Specialist"
    goal = "Gather requirements, constraints, and best practices"
    backstory = (
        "You analyze implementation requests the way a senior engineer would "
        "before coding starts, surfacing constraints, suitable technologies, "
        "references, and likely risks that can prevent downstream rework."
    )

    def create_task(self, user_prompt: str, plan: PlanOutput) -> Task:
        """Create the research task for a medium or complex implementation plan."""
        description = (
            "Review the planner output and produce a focused research report "
            "that will help a software architect and implementer succeed.\n"
            f"Original user request:\n{user_prompt}\n\n"
            "Planner output JSON:\n"
            f"{plan.model_dump_json(indent=2)}\n\n"
            "Keep the requirements aligned to the planner requirements and the "
            "original user request. Rephrase them for clarity if needed, but do "
            "not introduce new mandatory scope, new product features, or "
            "technology-specific obligations that the user did not ask for.\n"
            "Identify constraints, recommend technologies, list best "
            "practices, and call out likely challenges.\n"
            "Use concise references such as protocols, standards, framework "
            "guides, or implementation patterns when relevant. References may "
            "be high-level names rather than URLs.\n\n"
            f"{self.json_only_instructions(ResearchReport)}"
        )

        return Task(
            description=description,
            expected_output="A single JSON object that matches the ResearchReport schema.",
            agent=self.agent,
            output_pydantic=ResearchReport,
        )
