"""Sequential CrewAI orchestration for the Phase 1 pipeline."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict

from crewai import Crew, Process

from agents import ExecutorAgent, ModelSettings, PlannerAgent, ReviewerAgent
from schemas import Implementation, PlanOutput, ReviewReport

LOGGER = logging.getLogger(__name__)


class CrewManager:
    """Manage the sequential planner -> executor -> reviewer pipeline."""

    def __init__(self, model_settings: ModelSettings) -> None:
        self.model_settings = model_settings
        self.planner = PlannerAgent(model_settings)
        self.executor = ExecutorAgent(model_settings)
        self.reviewer = ReviewerAgent(model_settings)

    @classmethod
    def from_config(cls, config_path: Path, profile: str = "default") -> "CrewManager":
        """Create a manager using YAML config with optional env overrides."""
        configured = ModelSettings.from_yaml(config_path, profile=profile)

        provider = os.getenv("LLM_PROVIDER", configured.provider).strip()
        model = os.getenv("OLLAMA_MODEL", configured.model).strip()
        base_url = os.getenv("OLLAMA_BASE_URL", configured.base_url).strip()
        temperature = float(
            os.getenv("LLM_TEMPERATURE", str(configured.temperature)).strip()
        )

        settings = ModelSettings(
            provider=provider,
            model=model,
            base_url=base_url,
            temperature=temperature,
        )
        return cls(settings)

    def run(self, user_prompt: str) -> Dict[str, Any]:
        """Execute the sequential CrewAI pipeline and return validated output."""
        sanitized_prompt = user_prompt.strip()
        if not sanitized_prompt:
            raise ValueError("The user prompt must not be empty.")

        plan_task = self.planner.create_task(sanitized_prompt)
        implementation_task = self.executor.create_task(sanitized_prompt, plan_task)
        review_task = self.reviewer.create_task(sanitized_prompt, implementation_task)

        crew = Crew(
            agents=[
                self.planner.agent,
                self.executor.agent,
                self.reviewer.agent,
            ],
            tasks=[plan_task, implementation_task, review_task],
            process=Process.sequential,
            verbose=False,
        )

        LOGGER.info(
            "Starting sequential crew run with model %s",
            self.model_settings.crewai_model,
        )
        crew.kickoff()

        plan = self.planner.parse_output(plan_task.output, PlanOutput)
        implementation = self.executor.parse_output(
            implementation_task.output, Implementation
        )
        review = self.reviewer.parse_output(review_task.output, ReviewReport)

        LOGGER.info("Crew run completed with review status '%s'", review.status)

        return {
            "prompt": sanitized_prompt,
            "model": {
                "provider": self.model_settings.provider,
                "name": self.model_settings.model,
                "base_url": self.model_settings.base_url,
            },
            "plan": plan.model_dump(),
            "implementation": implementation.model_dump(),
            "review": review.model_dump(),
            "approved": review.status == "approved",
        }
