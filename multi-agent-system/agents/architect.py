"""Architect agent implementation for the Phase 3 pipeline."""

from __future__ import annotations

from crewai import Task

from agents.base_agent import BasePhaseAgent
from schemas import PlanOutput, ResearchReport, TechnicalDesign


class ArchitectAgent(BasePhaseAgent):
    """Convert planning and research inputs into a technical design."""

    role = "System Design Specialist"
    goal = "Design technical architecture and structure"
    backstory = (
        "You translate requirements and technical research into a concrete "
        "architecture, file layout, dependency map, and interface design that "
        "gives implementers a strong technical blueprint."
    )

    def create_task(
        self,
        user_prompt: str,
        plan: PlanOutput,
        research: ResearchReport,
    ) -> Task:
        """Create an architecture task for a researched implementation request."""
        description = (
            "Design a technical implementation blueprint using the planner and "
            "research outputs.\n"
            f"Original user request:\n{user_prompt}\n\n"
            "Planner output JSON:\n"
            f"{plan.model_dump_json(indent=2)}\n\n"
            "Research report JSON:\n"
            f"{research.model_dump_json(indent=2)}\n\n"
            "Choose an appropriate architecture pattern, propose a practical "
            "file structure, define module dependencies, include relevant API "
            "contracts when applicable, and explain key design decisions.\n"
            "In file_structure, each item must include a safe relative path and "
            "a purpose field. In api_contracts, use objects for endpoints or "
            "public interfaces that matter to implementation.\n\n"
            f"{self.json_only_instructions(TechnicalDesign)}"
        )

        return Task(
            description=description,
            expected_output="A single JSON object that matches the TechnicalDesign schema.",
            agent=self.agent,
            output_pydantic=TechnicalDesign,
        )
