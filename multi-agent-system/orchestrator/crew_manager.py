"""Sequential CrewAI orchestration for the Phase 2 pipeline."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Dict

from crewai import Crew, Process

from agents import (
    ExecutorAgent,
    FixerAgent,
    ModelSettings,
    PlannerAgent,
    ReviewerAgent,
    ValidatorAgent,
)
from schemas import Implementation, PlanOutput, ReviewReport, ValidationReport
from utils import (
    detect_placeholder_code,
    find_missing_requirements,
    validate_code_syntax,
    validate_json_structure,
    validate_schema_compliance,
)

LOGGER = logging.getLogger(__name__)
MAX_FIX_ATTEMPTS = 2
CODE_PROMPT_HINTS = {
    "api",
    "app",
    "application",
    "bug",
    "class",
    "cli",
    "code",
    "crawler",
    "debug",
    "function",
    "implementation",
    "library",
    "program",
    "python",
    "refactor",
    "script",
    "scraper",
    "service",
    "tool",
    "web",
}
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
    """Manage the Phase 2 planner -> executor -> reviewer -> fixer -> validator pipeline."""

    def __init__(
        self,
        model_settings: ModelSettings,
        code_model_settings: ModelSettings | None = None,
    ) -> None:
        self.model_settings = model_settings
        self.code_model_settings = code_model_settings or model_settings
        self.default_agents = self._build_agent_set(self.model_settings)
        self.code_agents = self._build_agent_set(self.code_model_settings)

    @staticmethod
    def _build_agent_set(model_settings: ModelSettings) -> Dict[str, Any]:
        """Create a consistent set of agent wrappers for a model profile."""
        return {
            "planner": PlannerAgent(model_settings),
            "executor": ExecutorAgent(model_settings),
            "reviewer": ReviewerAgent(model_settings),
            "fixer": FixerAgent(model_settings),
            "validator": ValidatorAgent(model_settings),
        }

    @classmethod
    def from_config(cls, config_path: Path, profile: str = "default") -> "CrewManager":
        """Create a manager using YAML config with optional env overrides."""
        configured = ModelSettings.from_yaml(config_path, profile=profile)
        try:
            configured_code = ModelSettings.from_yaml(
                config_path, profile="code_specialist"
            )
        except ValueError:
            configured_code = configured

        settings = ModelSettings(
            provider=os.getenv("LLM_PROVIDER", configured.provider).strip(),
            model=os.getenv("OLLAMA_MODEL", configured.model).strip(),
            base_url=os.getenv("OLLAMA_BASE_URL", configured.base_url).strip(),
            temperature=float(
                os.getenv("LLM_TEMPERATURE", str(configured.temperature)).strip()
            ),
        )
        code_settings = ModelSettings(
            provider=os.getenv("LLM_CODE_PROVIDER", configured_code.provider).strip(),
            model=os.getenv("OLLAMA_CODE_MODEL", configured_code.model).strip(),
            base_url=os.getenv(
                "OLLAMA_CODE_BASE_URL", configured_code.base_url
            ).strip(),
            temperature=float(
                os.getenv(
                    "LLM_CODE_TEMPERATURE", str(configured_code.temperature)
                ).strip()
            ),
        )
        return cls(settings, code_model_settings=code_settings)

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
            "validation": None,
            "fix_attempts": 0,
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

    def _select_agents(self, user_prompt: str) -> tuple[Dict[str, Any], ModelSettings]:
        """Pick the best local model family for the current prompt."""
        prompt_tokens = set(re.findall(r"[a-zA-Z]{3,}", user_prompt.lower()))
        use_code_specialist = (
            self.code_model_settings.model != self.model_settings.model
            and bool(prompt_tokens.intersection(CODE_PROMPT_HINTS))
        )
        if use_code_specialist:
            return self.code_agents, self.code_model_settings
        return self.default_agents, self.model_settings

    def _run_stage(self, tasks: list[Any], agents: list[Any]) -> None:
        """Run a sequential CrewAI stage with the supplied tasks and agents."""
        crew = Crew(
            agents=agents,
            tasks=tasks,
            process=Process.sequential,
            verbose=False,
        )
        crew.kickoff()

    def _run_planner(self, user_prompt: str, planner_agent: PlannerAgent) -> PlanOutput:
        """Run the planner stage."""
        task = planner_agent.create_task(user_prompt)
        self._run_stage([task], [planner_agent.agent])
        return planner_agent.parse_output(task.output, PlanOutput)

    def _run_executor(
        self,
        user_prompt: str,
        plan: PlanOutput,
        executor_agent: ExecutorAgent,
    ) -> Implementation:
        """Run the executor stage."""
        task = executor_agent.create_task(user_prompt, plan)
        self._run_stage([task], [executor_agent.agent])
        return executor_agent.parse_output(task.output, Implementation)

    def _run_reviewer(
        self,
        user_prompt: str,
        implementation: Implementation,
        reviewer_agent: ReviewerAgent,
    ) -> ReviewReport:
        """Run the reviewer stage."""
        task = reviewer_agent.create_task(user_prompt, implementation)
        self._run_stage([task], [reviewer_agent.agent])
        return reviewer_agent.parse_output(task.output, ReviewReport)

    def _run_validator(
        self,
        user_prompt: str,
        plan: PlanOutput,
        implementation: Implementation,
        review: ReviewReport,
        utility_findings: Dict[str, Any],
        validator_agent: ValidatorAgent,
    ) -> ValidationReport:
        """Run the validator stage."""
        task = validator_agent.create_task(
            user_prompt=user_prompt,
            implementation=implementation,
            review=review,
            requirements=plan.requirements,
            utility_findings=utility_findings,
        )
        self._run_stage([task], [validator_agent.agent])
        return validator_agent.parse_output(task.output, ValidationReport)

    def _run_fixer(
        self,
        user_prompt: str,
        plan: PlanOutput,
        implementation: Implementation,
        review: ReviewReport,
        validation: ValidationReport,
        attempt_number: int,
        fixer_agent: FixerAgent,
    ) -> Implementation:
        """Run the fixer stage."""
        task = fixer_agent.create_task(
            user_prompt=user_prompt,
            implementation=implementation,
            review=review,
            validation=validation,
            requirements=plan.requirements,
            attempt_number=attempt_number,
        )
        self._run_stage([task], [fixer_agent.agent])
        return fixer_agent.parse_output(task.output, Implementation)

    @staticmethod
    def _implementation_text(implementation: Implementation) -> str:
        """Flatten the implementation into searchable text."""
        parts: list[str] = [
            implementation.description,
            *implementation.technologies_used,
            *implementation.completed_steps,
        ]
        for file_entry in implementation.files:
            parts.append(file_entry.path)
            parts.append(file_entry.content)
        return "\n".join(parts)

    def _build_local_validation(
        self,
        plan: PlanOutput,
        implementation: Implementation,
        review: ReviewReport,
    ) -> tuple[ValidationReport, Dict[str, Any]]:
        """Build a local validation report from deterministic checks."""
        json_errors = validate_json_structure(implementation.model_dump())
        json_errors.extend(validate_json_structure(review.model_dump()))

        schema_errors = validate_schema_compliance(implementation, Implementation)
        schema_errors.extend(validate_schema_compliance(review, ReviewReport))

        syntax_errors = validate_code_syntax(implementation.files)
        placeholder_findings = detect_placeholder_code(implementation.files)
        missing_requirements = find_missing_requirements(
            plan.requirements,
            self._implementation_text(implementation),
        )

        all_errors = [
            *json_errors,
            *schema_errors,
            *syntax_errors,
            *placeholder_findings,
        ]

        completeness_score = 100
        completeness_score -= min(45, len(all_errors) * 12)
        completeness_score -= min(35, len(missing_requirements) * 12)
        if review.status == "needs_revision":
            completeness_score -= 15
        completeness_score = max(0, completeness_score)

        valid = (
            not all_errors and not missing_requirements and review.status == "approved"
        )
        ready_for_delivery = valid and completeness_score >= 80
        recommendation = (
            "Ready for final delivery."
            if ready_for_delivery
            else "Further fixes are required before delivery."
        )

        local_report = ValidationReport(
            valid=valid,
            completeness_score=completeness_score,
            schema_errors=all_errors,
            missing_requirements=missing_requirements,
            ready_for_delivery=ready_for_delivery,
            final_recommendation=recommendation,
        )

        utility_findings: Dict[str, Any] = {
            "json_structure_errors": json_errors,
            "schema_compliance_errors": schema_errors,
            "code_syntax_errors": syntax_errors,
            "placeholder_findings": placeholder_findings,
            "missing_requirements": missing_requirements,
            "review_status": review.status,
            "local_validation_report": local_report.model_dump(),
        }
        return local_report, utility_findings

    @staticmethod
    def _merge_validation_reports(
        plan: PlanOutput,
        review: ReviewReport,
        local_validation: ValidationReport,
        agent_validation: ValidationReport,
    ) -> ValidationReport:
        """Combine deterministic validation checks with the validator agent result."""
        combined_schema_errors = list(local_validation.schema_errors)
        for error in agent_validation.schema_errors:
            if error not in combined_schema_errors:
                combined_schema_errors.append(error)

        combined_missing_requirements = list(local_validation.missing_requirements)
        allowed_requirements = set(plan.requirements)
        for requirement in agent_validation.missing_requirements:
            if (
                requirement in allowed_requirements
                and requirement not in combined_missing_requirements
            ):
                combined_missing_requirements.append(requirement)

        completeness_score = min(
            local_validation.completeness_score,
            agent_validation.completeness_score,
        )
        valid = (
            local_validation.valid
            and agent_validation.valid
            and review.status == "approved"
            and not combined_schema_errors
            and not combined_missing_requirements
        )
        ready_for_delivery = (
            local_validation.ready_for_delivery
            and agent_validation.ready_for_delivery
            and valid
        )
        final_recommendation = (
            "Ready for final delivery."
            if ready_for_delivery
            else (
                local_validation.final_recommendation
                if not local_validation.ready_for_delivery
                else agent_validation.final_recommendation
            )
        )

        return ValidationReport(
            valid=valid,
            completeness_score=completeness_score,
            schema_errors=combined_schema_errors,
            missing_requirements=combined_missing_requirements,
            ready_for_delivery=ready_for_delivery,
            final_recommendation=final_recommendation,
        )

    def run(self, user_prompt: str) -> Dict[str, Any]:
        """Execute the sequential CrewAI pipeline with fix and validation stages."""
        sanitized_prompt = self.validate_prompt(user_prompt)
        active_agents, active_model_settings = self._select_agents(sanitized_prompt)
        planner_agent = active_agents["planner"]
        executor_agent = active_agents["executor"]
        reviewer_agent = active_agents["reviewer"]
        fixer_agent = active_agents["fixer"]
        validator_agent = active_agents["validator"]

        LOGGER.info(
            "Starting sequential crew run with model %s",
            active_model_settings.crewai_model,
        )
        plan = self._run_planner(sanitized_prompt, planner_agent)
        implementation = self._run_executor(sanitized_prompt, plan, executor_agent)
        review = self._run_reviewer(sanitized_prompt, implementation, reviewer_agent)
        local_validation, utility_findings = self._build_local_validation(
            plan, implementation, review
        )

        fix_attempts = 0

        if review.status == "needs_revision" or not local_validation.ready_for_delivery:
            fix_attempts += 1
            LOGGER.warning(
                "Initial review or local validation requires repair. Starting fix attempt %s.",
                fix_attempts,
            )
            implementation = self._run_fixer(
                sanitized_prompt,
                plan,
                implementation,
                review,
                local_validation,
                attempt_number=fix_attempts,
                fixer_agent=fixer_agent,
            )
            review = self._run_reviewer(sanitized_prompt, implementation, reviewer_agent)
            local_validation, utility_findings = self._build_local_validation(
                plan, implementation, review
            )

        validation = self._merge_validation_reports(
            plan,
            review,
            local_validation,
            self._run_validator(
                sanitized_prompt,
                plan,
                implementation,
                review,
                utility_findings,
                validator_agent,
            ),
        )

        while (
            (review.status == "needs_revision" or not validation.ready_for_delivery)
            and fix_attempts < MAX_FIX_ATTEMPTS
        ):
            fix_attempts += 1
            LOGGER.warning(
                "Validation failed after review status '%s'. Starting fix attempt %s.",
                review.status,
                fix_attempts,
            )
            implementation = self._run_fixer(
                sanitized_prompt,
                plan,
                implementation,
                review,
                validation,
                attempt_number=fix_attempts,
                fixer_agent=fixer_agent,
            )
            review = self._run_reviewer(sanitized_prompt, implementation, reviewer_agent)
            local_validation, utility_findings = self._build_local_validation(
                plan, implementation, review
            )
            validation = self._merge_validation_reports(
                plan,
                review,
                local_validation,
                self._run_validator(
                    sanitized_prompt,
                    plan,
                    implementation,
                    review,
                    utility_findings,
                    validator_agent,
                ),
            )

        approved = review.status == "approved" and validation.ready_for_delivery
        status = "completed" if approved else "failed_validation"
        error: Dict[str, str] | None = None
        if not approved:
            error = {
                "type": "validation_failed_after_retries",
                "message": (
                    "The implementation still needs work after the maximum number "
                    "of fix attempts."
                ),
            }

        LOGGER.info(
            "Crew run completed with review status '%s', validator ready=%s, fix attempts=%s",
            review.status,
            validation.ready_for_delivery,
            fix_attempts,
        )

        return {
            "status": status,
            "prompt": sanitized_prompt,
            "model": self.model_metadata(active_model_settings),
            "plan": plan.model_dump(),
            "implementation": implementation.model_dump(),
            "review": review.model_dump(),
            "validation": validation.model_dump(),
            "fix_attempts": fix_attempts,
            "approved": approved,
            "error": error,
        }
