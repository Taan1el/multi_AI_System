"""Sequential CrewAI orchestration for the Phase 2 pipeline."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Dict

from crewai import Crew, Process

from agents import (
    ArchitectAgent,
    ExecutorAgent,
    FixerAgent,
    ModelSettings,
    PlannerAgent,
    ResearcherAgent,
    ReviewerAgent,
    ValidatorAgent,
)
from schemas import (
    Implementation,
    PlanOutput,
    ResearchReport,
    ReviewReport,
    TechnicalDesign,
    ValidationReport,
)
from utils import (
    detect_placeholder_code,
    find_missing_requirements,
    validate_code_syntax,
    validate_json_structure,
    validate_schema_compliance,
)

LOGGER = logging.getLogger(__name__)
MAX_FIX_ATTEMPTS = 2
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
MEDIUM_COMPLEX_HINTS = {
    "api",
    "architecture",
    "auth",
    "authentication",
    "backend",
    "class",
    "crud",
    "database",
    "endpoint",
    "integration",
    "module",
    "rest",
    "service",
    "system",
}
COMPLEX_HINTS = {
    "authorization",
    "microservice",
    "oauth",
    "permissions",
    "queue",
    "scalable",
    "worker",
}


class PromptValidationError(ValueError):
    """Raised when a user prompt is too vague or not actionable."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class CrewManager:
    """Manage the Phase 3 AI pipeline with routing, repair, and validation."""

    def __init__(self, agent_settings: Dict[str, ModelSettings]) -> None:
        self.agent_settings = agent_settings
        self.model_settings = agent_settings["planner"]
        self.agents = self._build_agent_set(agent_settings)

    @staticmethod
    def _build_agent_set(agent_settings: Dict[str, ModelSettings]) -> Dict[str, Any]:
        """Create the configured agent wrappers for each pipeline stage."""
        return {
            "planner": PlannerAgent(agent_settings["planner"]),
            "researcher": ResearcherAgent(agent_settings["researcher"]),
            "architect": ArchitectAgent(agent_settings["architect"]),
            "executor": ExecutorAgent(agent_settings["executor"]),
            "reviewer": ReviewerAgent(agent_settings["reviewer"]),
            "fixer": FixerAgent(agent_settings["fixer"]),
            "validator": ValidatorAgent(agent_settings["validator"]),
        }

    @classmethod
    def _resolve_agent_settings(
        cls, config_path: Path, agent_name: str
    ) -> ModelSettings:
        """Load model settings for an agent, with Phase 2 fallback profiles."""
        fallback_profiles = {
            "planner": ("planner", "default"),
            "researcher": ("researcher", "default"),
            "architect": ("architect", "code_specialist", "default"),
            "executor": ("executor", "code_specialist", "default"),
            "reviewer": ("reviewer", "default"),
            "fixer": ("fixer", "code_specialist", "default"),
            "validator": ("validator", "default"),
        }
        configured: ModelSettings | None = None
        for profile in fallback_profiles[agent_name]:
            try:
                configured = ModelSettings.from_yaml(config_path, profile=profile)
                break
            except ValueError:
                continue

        if configured is None:
            raise ValueError(
                f"No model configuration found for agent '{agent_name}' in {config_path}."
            )

        env_prefix = agent_name.upper()
        return ModelSettings(
            provider=os.getenv(
                f"{env_prefix}_PROVIDER",
                os.getenv("LLM_PROVIDER", configured.provider),
            ).strip(),
            model=os.getenv(f"{env_prefix}_MODEL", configured.model).strip(),
            base_url=os.getenv(
                f"{env_prefix}_BASE_URL",
                os.getenv("OLLAMA_BASE_URL", configured.base_url),
            ).strip(),
            temperature=float(
                os.getenv(
                    f"{env_prefix}_TEMPERATURE",
                    str(configured.temperature),
                ).strip()
            ),
        )

    @classmethod
    def from_config(cls, config_path: Path) -> "CrewManager":
        """Create a manager using per-agent YAML config with env overrides."""
        agent_settings = {
            agent_name: cls._resolve_agent_settings(config_path, agent_name)
            for agent_name in (
                "planner",
                "researcher",
                "architect",
                "executor",
                "reviewer",
                "fixer",
                "validator",
            )
        }
        return cls(agent_settings)

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
            "research": None,
            "design": None,
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
        research: ResearchReport | None = None,
        design: TechnicalDesign | None = None,
    ) -> Implementation:
        """Run the executor stage."""
        task = executor_agent.create_task(
            user_prompt,
            plan,
            research=research,
            design=design,
        )
        self._run_stage([task], [executor_agent.agent])
        return executor_agent.parse_output(task.output, Implementation)

    def _run_researcher(
        self,
        user_prompt: str,
        plan: PlanOutput,
        researcher_agent: ResearcherAgent,
    ) -> ResearchReport:
        """Run the researcher stage."""
        task = researcher_agent.create_task(user_prompt, plan)
        self._run_stage([task], [researcher_agent.agent])
        return researcher_agent.parse_output(task.output, ResearchReport)

    def _run_architect(
        self,
        user_prompt: str,
        plan: PlanOutput,
        research: ResearchReport,
        architect_agent: ArchitectAgent,
    ) -> TechnicalDesign:
        """Run the architect stage."""
        task = architect_agent.create_task(user_prompt, plan, research)
        self._run_stage([task], [architect_agent.agent])
        return architect_agent.parse_output(task.output, TechnicalDesign)

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
        requirements: list[str],
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
            requirements=requirements,
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
        requirements: list[str] | None = None,
        research: ResearchReport | None = None,
        design: TechnicalDesign | None = None,
    ) -> Implementation:
        """Run the fixer stage."""
        task = fixer_agent.create_task(
            user_prompt=user_prompt,
            implementation=implementation,
            review=review,
            validation=validation,
            requirements=requirements or plan.requirements,
            attempt_number=attempt_number,
            research=research,
            design=design,
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
        requirements: list[str],
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
            requirements,
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
        requirements: list[str],
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
        allowed_requirements = set(requirements)
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

    @staticmethod
    def _infer_complexity(prompt: str, plan: PlanOutput) -> str:
        """Escalate planner complexity when the prompt describes a larger system."""
        text = " ".join(
            [
                prompt,
                plan.task_type,
                *plan.requirements,
                *plan.execution_steps,
            ]
        ).lower()
        tokens = set(re.findall(r"[a-zA-Z]{3,}", text))
        medium_hits = len(tokens.intersection(MEDIUM_COMPLEX_HINTS))
        complex_hits = len(tokens.intersection(COMPLEX_HINTS))

        if complex_hits >= 1 or medium_hits >= 4:
            return "complex"
        if medium_hits >= 2 or len(plan.requirements) >= 4 or len(plan.execution_steps) >= 4:
            return "medium"
        return plan.complexity

    def _normalize_plan(self, prompt: str, plan: PlanOutput) -> PlanOutput:
        """Normalize plan complexity so routing is stable across model outputs."""
        inferred_complexity = self._infer_complexity(prompt, plan)
        complexity_order = {"simple": 0, "medium": 1, "complex": 2}
        final_complexity = max(
            plan.complexity,
            inferred_complexity,
            key=lambda value: complexity_order[value],
        )
        if final_complexity == plan.complexity:
            return plan
        return plan.model_copy(update={"complexity": final_complexity})

    def run(self, user_prompt: str) -> Dict[str, Any]:
        """Execute the sequential CrewAI pipeline with Phase 3 routing."""
        sanitized_prompt = self.validate_prompt(user_prompt)
        planner_agent = self.agents["planner"]
        researcher_agent = self.agents["researcher"]
        architect_agent = self.agents["architect"]
        executor_agent = self.agents["executor"]
        reviewer_agent = self.agents["reviewer"]
        fixer_agent = self.agents["fixer"]
        validator_agent = self.agents["validator"]

        LOGGER.info(
            "Starting sequential crew run with planner=%s executor=%s reviewer=%s",
            self.agent_settings["planner"].crewai_model,
            self.agent_settings["executor"].crewai_model,
            self.agent_settings["reviewer"].crewai_model,
        )
        plan = self._normalize_plan(
            sanitized_prompt,
            self._run_planner(sanitized_prompt, planner_agent),
        )
        research: ResearchReport | None = None
        design: TechnicalDesign | None = None
        if plan.complexity in {"medium", "complex"}:
            research = self._run_researcher(
                sanitized_prompt,
                plan,
                researcher_agent,
            )
            design = self._run_architect(
                sanitized_prompt,
                plan,
                research,
                architect_agent,
            )
        effective_requirements = (
            research.requirements if research is not None and research.requirements else plan.requirements
        )
        implementation = self._run_executor(
            sanitized_prompt,
            plan,
            executor_agent,
            research=research,
            design=design,
        )
        review = self._run_reviewer(sanitized_prompt, implementation, reviewer_agent)
        local_validation, utility_findings = self._build_local_validation(
            effective_requirements,
            implementation,
            review,
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
                requirements=effective_requirements,
                research=research,
                design=design,
            )
            review = self._run_reviewer(sanitized_prompt, implementation, reviewer_agent)
            local_validation, utility_findings = self._build_local_validation(
                effective_requirements,
                implementation,
                review,
            )

        validation = self._merge_validation_reports(
            effective_requirements,
            review,
            local_validation,
            self._run_validator(
                sanitized_prompt,
                effective_requirements,
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
                requirements=effective_requirements,
                research=research,
                design=design,
            )
            review = self._run_reviewer(sanitized_prompt, implementation, reviewer_agent)
            local_validation, utility_findings = self._build_local_validation(
                effective_requirements,
                implementation,
                review,
            )
            validation = self._merge_validation_reports(
                effective_requirements,
                review,
                local_validation,
                self._run_validator(
                    sanitized_prompt,
                    effective_requirements,
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
            "model": self.model_metadata(self.model_settings),
            "plan": plan.model_dump(),
            "research": None if research is None else research.model_dump(),
            "design": None if design is None else design.model_dump(),
            "implementation": implementation.model_dump(),
            "review": review.model_dump(),
            "validation": validation.model_dump(),
            "fix_attempts": fix_attempts,
            "approved": approved,
            "error": error,
        }
