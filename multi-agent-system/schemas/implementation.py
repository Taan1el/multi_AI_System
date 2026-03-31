"""Pydantic schema for executor agent output."""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import List

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GeneratedFile(BaseModel):
    """Structured file artifact produced by the executor or fixer."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    path: str = Field(min_length=1, description="Safe relative file path.")
    content: str = Field(min_length=1, description="Full file content.")

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        normalized_path = value.replace("\\", "/")
        pure_path = PurePosixPath(normalized_path)
        if pure_path.is_absolute() or ".." in pure_path.parts:
            raise ValueError(
                "File paths must be safe relative paths without drive letters, "
                "leading slashes, or parent-directory traversal."
            )
        if pure_path.name in {"", ".", ".."}:
            raise ValueError("File paths must point to a concrete file name.")
        return value

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("File content must not be empty.")
        return value


class Implementation(BaseModel):
    """Structured implementation payload produced by the executor agent."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    files: List[GeneratedFile] = Field(
        min_length=1,
        description="Generated files represented as path/content dictionaries.",
    )
    description: str = Field(
        min_length=1,
        description="Summary of the produced deliverable.",
    )
    technologies_used: List[str] = Field(
        min_length=1,
        description="Key technologies or libraries used in the solution.",
    )
    completed_steps: List[str] = Field(
        min_length=1,
        description="Execution plan steps completed by the agent.",
    )

    @field_validator("files", mode="before")
    @classmethod
    def validate_files(cls, value: List[GeneratedFile | dict[str, str]]) -> List[GeneratedFile]:
        validated_files: List[GeneratedFile] = []
        for file_entry in value:
            if isinstance(file_entry, GeneratedFile):
                validated_files.append(file_entry)
                continue

            if {"path", "content"}.issubset(file_entry):
                validated_files.append(GeneratedFile.model_validate(file_entry))
                continue

            if len(file_entry) == 1:
                path, content = next(iter(file_entry.items()))
                validated_files.append(
                    GeneratedFile.model_validate({"path": path, "content": content})
                )
                continue

            raise ValueError(
                "Each file entry must include 'path' and 'content' keys or be a "
                "single path-to-content mapping."
            )
        return validated_files

    @field_validator("technologies_used", "completed_steps")
    @classmethod
    def validate_non_empty_items(cls, value: List[str]) -> List[str]:
        cleaned_items = [item.strip() for item in value if item and item.strip()]
        if not cleaned_items:
            raise ValueError("Lists must contain at least one non-empty item.")
        return cleaned_items
