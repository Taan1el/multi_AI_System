"""Sequential CrewAI orchestration for the Phase 1 pipeline."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Dict

from crewai import Crew, Process

from agents import ExecutorAgent, ModelSettings, PlannerAgent, ReviewerAgent
from schemas import Implementation, PlanOutput, ReviewReport

LOGGER = logging.getLogger(__name__)
ACTION_WORDS = {
    "add",
    "analyze",
    "build",
    "calculate",
    "create",
    "debug",
    "design",
    "draft",
    "explain",
    "fix",
    "generate",
    "implement",
    "list",
    "make",
    "optimize",
    "refactor",
    "remove",
    "review",
    "summarize",
    "write",
}
QUESTION_WORDS = {"how", "what", "why", "when", "where", "who", "which", "explain"}
DELIVERABLE_HINTS = {
    "algorithm",
    "analysis",
    "app",
    "application",
    "article",
    "class",
    "code",
    "essay",
    "function",
    "plan",
    "program",
    "report",
    "script",
    "summary",
    "todo",
    "tool",
}
INVALID_SIGNAL_WORDS = {"gibberish", "nonsense", "invalid", "random"}


class PromptValidationError(ValueError):
    """Raised when a user prompt is too vague or not actionable."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


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

    @staticmethod
    def model_metadata(model_settings: ModelSettings) -> Dict[str, str]:
        """Build a standard model metadata payload."""
        return {
            "provider": model_settings.provider,
            "name": model_settings.model,
            "base_url": model_settings.base_url,
        }

    @classmethod
    def build_error_result(
        cls,
        prompt: str,
        model_settings: ModelSettings,
        error_type: str,
        message: str,
    ) -> Dict[str, Any]:
        """Return a stable JSON payload for handled failures or rejections."""
        return {
            "status": "rejected",
            "prompt": prompt,
            "model": cls.model_metadata(model_settings),
            "plan": None,
            "implementation": None,
            "review": None,
            "approved": False,
            "error": {
                "type": error_type,
                "message": message,
            },
        }

    @staticmethod
    def validate_prompt(user_prompt: str) -> str:
        """Reject prompts that are empty, non-actionable, or obviously invalid."""
        sanitized_prompt = user_prompt.strip()
        if not sanitized_prompt:
            raise PromptValidationError("The user prompt must not be empty.")

        alpha_words = re.findall(r"[a-zA-Z]{2,}", sanitized_prompt.lower())
        has_action_word = any(word in ACTION_WORDS for word in alpha_words)
        is_question = sanitized_prompt.endswith("?") or (
            alpha_words and alpha_words[0] in QUESTION_WORDS
        )
        has_deliverable_hint = any(word in DELIVERABLE_HINTS for word in alpha_words)
        has_invalid_signal = any(word in INVALID_SIGNAL_WORDS for word in alpha_words)

        if len(alpha_words) < 3:
            raise PromptValidationError(
                "Prompt is too short. Describe a concrete task such as "
                "'Create a Python function that reverses a string'."
            )

        if has_invalid_signal and not has_action_word and not is_question:
            raise PromptValidationError(
                "Prompt does not describe a clear task. Please ask for a concrete "
                "action, for example 'Build a Python class for a todo list'."
            )

        if not has_action_word and not is_question and not has_deliverable_hint:
            raise PromptValidationError(
                "Prompt is not actionable enough. Start with a clear request such "
                "as 'Create', 'Build', 'Write', 'Explain', or 'Analyze'."
            )

        return sanitized_prompt

    def run(self, user_prompt: str) -> Dict[str, Any]:
        """Execute the sequential CrewAI pipeline and return validated output."""
        sanitized_prompt = self.validate_prompt(user_prompt)

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
            "status": "completed",
            "prompt": sanitized_prompt,
            "model": self.model_metadata(self.model_settings),
            "plan": plan.model_dump(),
            "implementation": implementation.model_dump(),
            "review": review.model_dump(),
            "approved": review.status == "approved",
        }
