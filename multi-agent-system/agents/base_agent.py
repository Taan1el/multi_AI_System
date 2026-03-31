"""Common CrewAI agent utilities for the Phase 1 multi-agent pipeline."""

from __future__ import annotations

import json
from abc import ABC
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

import yaml
from crewai import Agent, LLM
from pydantic import BaseModel

ModelType = TypeVar("ModelType", bound=BaseModel)


@dataclass(frozen=True)
class ModelSettings:
    """Shared LLM settings loaded from the project configuration file."""

    provider: str
    model: str
    base_url: str
    temperature: float = 0.1

    @property
    def crewai_model(self) -> str:
        """Return the provider-qualified model name CrewAI expects."""
        return f"{self.provider}/{self.model}"

    @classmethod
    def from_yaml(cls, path: Path, profile: str = "default") -> "ModelSettings":
        """Load model settings from the YAML config file."""
        with path.open("r", encoding="utf-8") as handle:
            raw_config = yaml.safe_load(handle) or {}

        try:
            selected_profile = raw_config[profile]
        except KeyError as exc:
            raise ValueError(
                f"Model profile '{profile}' was not found in {path}."
            ) from exc

        return cls(
            provider=str(selected_profile["provider"]),
            model=str(selected_profile["model"]),
            base_url=str(selected_profile["base_url"]),
            temperature=float(selected_profile.get("temperature", 0.1)),
        )


class BasePhaseAgent(ABC):
    """Base class for agent wrappers that build CrewAI agents and parse output."""

    role: str = ""
    goal: str = ""
    backstory: str = ""

    def __init__(self, model_settings: ModelSettings) -> None:
        self.model_settings = model_settings
        self._agent = Agent(
            role=self.role,
            goal=self.goal,
            backstory=self.backstory,
            allow_delegation=False,
            verbose=False,
            llm=LLM(
                model=self.model_settings.crewai_model,
                base_url=self.model_settings.base_url,
                temperature=self.model_settings.temperature,
            ),
        )

    @property
    def agent(self) -> Agent:
        """Return the configured CrewAI agent instance."""
        return self._agent

    @staticmethod
    def json_only_instructions(schema_model: type[BaseModel]) -> str:
        """Return strict JSON-only instructions with the target schema."""
        schema_json = json.dumps(schema_model.model_json_schema(), indent=2)
        return (
            "Return valid JSON only. Do not include markdown fences, headings, "
            "explanations, or any text outside the JSON object.\n"
            "The JSON object must conform to this schema:\n"
            f"{schema_json}"
        )

    @staticmethod
    def parse_output(output: Any, schema_model: type[ModelType]) -> ModelType:
        """Normalize CrewAI task output into a validated Pydantic model."""
        if output is None:
            raise RuntimeError("CrewAI did not return an output object.")

        pydantic_output = getattr(output, "pydantic", None)
        if pydantic_output is not None:
            if isinstance(pydantic_output, schema_model):
                return pydantic_output
            return schema_model.model_validate(pydantic_output)

        json_dict = getattr(output, "json_dict", None)
        if json_dict is not None:
            return schema_model.model_validate(json_dict)

        raw_output = getattr(output, "raw", output)
        if isinstance(raw_output, str):
            candidate = raw_output.strip()
            try:
                return schema_model.model_validate_json(candidate)
            except ValueError:
                extracted = BasePhaseAgent._extract_json_object(candidate)
                return schema_model.model_validate_json(extracted)

        return schema_model.model_validate(raw_output)

    @staticmethod
    def _extract_json_object(raw_output: str) -> str:
        """Extract the outermost JSON object from a string response."""
        start_index = raw_output.find("{")
        end_index = raw_output.rfind("}")
        if start_index == -1 or end_index == -1 or end_index <= start_index:
            raise ValueError("No JSON object was found in the model output.")
        return raw_output[start_index : end_index + 1]
