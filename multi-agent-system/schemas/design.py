"""Pydantic schema for architect agent output."""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Any, Dict, List

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FileStructureEntry(BaseModel):
    """Structured file or directory entry produced by the architect."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    path: str = Field(
        min_length=1,
        description="Safe relative path for a proposed file or directory.",
    )
    purpose: str = Field(
        min_length=1,
        description="Why this file or directory exists in the design.",
    )

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        normalized_path = value.replace("\\", "/")
        pure_path = PurePosixPath(normalized_path)
        if pure_path.is_absolute() or ".." in pure_path.parts:
            raise ValueError(
                "File structure paths must be safe relative paths without parent traversal."
            )
        if pure_path.as_posix() in {"", ".", ".."}:
            raise ValueError("File structure paths must point to a real location.")
        return value


class TechnicalDesign(BaseModel):
    """Structured technical design for medium and complex tasks."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    architecture_pattern: str = Field(
        min_length=1,
        description="Primary architecture pattern for the solution.",
    )
    file_structure: List[FileStructureEntry] = Field(
        min_length=1,
        description="Proposed file and directory structure.",
    )
    module_dependencies: Dict[str, List[str]] = Field(
        default_factory=dict,
        description="Module dependency mapping by module name.",
    )
    api_contracts: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="API endpoints, interfaces, or contracts relevant to the design.",
    )
    design_decisions: List[str] = Field(
        min_length=1,
        description="Key design tradeoffs or decisions.",
    )

    @field_validator("file_structure", mode="before")
    @classmethod
    def validate_file_structure(
        cls, value: List[FileStructureEntry | Dict[str, str]]
    ) -> List[FileStructureEntry]:
        validated_entries: List[FileStructureEntry] = []
        for entry in value:
            if isinstance(entry, FileStructureEntry):
                validated_entries.append(entry)
                continue
            validated_entries.append(FileStructureEntry.model_validate(entry))
        return validated_entries

    @field_validator("module_dependencies")
    @classmethod
    def validate_module_dependencies(
        cls, value: Dict[str, List[str]]
    ) -> Dict[str, List[str]]:
        validated: Dict[str, List[str]] = {}
        for module_name, dependencies in value.items():
            cleaned_name = module_name.strip()
            if not cleaned_name:
                raise ValueError("Module dependency keys must not be empty.")
            cleaned_dependencies = [
                dependency.strip()
                for dependency in dependencies
                if dependency and dependency.strip()
            ]
            validated[cleaned_name] = cleaned_dependencies
        return validated

    @field_validator("api_contracts")
    @classmethod
    def validate_api_contracts(
        cls, value: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        validated_contracts: List[Dict[str, Any]] = []
        for contract in value:
            if not isinstance(contract, dict) or not contract:
                raise ValueError("Each API contract must be a non-empty object.")
            validated_contracts.append(contract)
        return validated_contracts

    @field_validator("design_decisions")
    @classmethod
    def validate_design_decisions(cls, value: List[str]) -> List[str]:
        cleaned_items = [item.strip() for item in value if item and item.strip()]
        if not cleaned_items:
            raise ValueError("design_decisions must contain at least one item.")
        return cleaned_items
