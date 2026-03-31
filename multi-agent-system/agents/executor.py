"""Executor agent implementation for the Phase 1 pipeline."""

from __future__ import annotations

from typing import cast

from crewai import Task

from agents.base_agent import BasePhaseAgent
from schemas import Implementation, PlanOutput, ResearchReport, TechnicalDesign


class ExecutorAgent(BasePhaseAgent):
    """Execute the planner's instructions and produce implementation artifacts."""

    role = "Implementation Specialist"
    goal = "Execute plans and create deliverables"
    backstory = (
        "You transform structured plans into concrete implementation outputs, "
        "including file artifacts, technology choices, and completed steps."
    )

    def create_task(
        self,
        user_prompt: str,
        plan_input: Task | PlanOutput,
        research: ResearchReport | None = None,
        design: TechnicalDesign | None = None,
    ) -> Task:
        """Create the execution task using a planner task or plan payload."""
        description = (
            "Use the planner output as the source of truth and create the "
            "implementation payload for the user's request.\n"
            f"Original user request:\n{user_prompt}\n\n"
            "Return one or more file artifacts that satisfy the plan.\n"
            "Use the files field for path/content pairs.\n"
            "Summarize the deliverable, list technologies used, and mark the "
            "completed execution steps.\n\n"
        )
        task_kwargs: dict[str, object] = {}

        if isinstance(plan_input, Task):
            task_kwargs["context"] = [plan_input]
        else:
            description += (
                "Planner output JSON:\n"
                f"{cast(PlanOutput, plan_input).model_dump_json(indent=2)}\n\n"
            )

        if research is not None:
            description += (
                "Research report JSON:\n"
                f"{research.model_dump_json(indent=2)}\n\n"
            )

        if design is not None:
            description += (
                "Technical design JSON:\n"
                f"{design.model_dump_json(indent=2)}\n\n"
                "Use the design as the preferred implementation blueprint.\n\n"
            )

        description += (
            "Avoid placeholder code. If the request implies multiple modules, "
            "return a realistic multi-file implementation. For Python outputs, "
            "return runnable code with correct imports and basic error handling "
            "where the request calls for it.\n\n"
        )

        description += self.json_only_instructions(Implementation)

        return Task(
            description=description,
            expected_output="A single JSON object that matches the Implementation schema.",
            agent=self.agent,
            output_pydantic=Implementation,
            **task_kwargs,
        )
