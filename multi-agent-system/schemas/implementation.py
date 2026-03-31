"""Pydantic schema for executor agent output."""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Dict, List

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Implementation(BaseModel):
    """Structured implementation payload produced by the executor agent."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    files: List[Dict[str, str]] = Field(
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

    @field_validator("files")
    @classmethod
    def validate_files(cls, value: List[Dict[str, str]]) -> List[Dict[str, str]]:
        validated_files: List[Dict[str, str]] = []
        for file_entry in value:
            path = file_entry.get("path", "").strip()
            content = file_entry.get("content", "")
            if not path or not content.strip():
                raise ValueError(
                    "Each file entry must include non-empty 'path' and 'content' values."
                )
            normalized_path = path.replace("\\", "/")
            pure_path = PurePosixPath(normalized_path)
            if pure_path.is_absolute() or ".." in pure_path.parts:
                raise ValueError(
                    "File paths must be safe relative paths without drive letters, "
                    "leading slashes, or parent-directory traversal."
                )
            if pure_path.name in {"", ".", ".."}:
                raise ValueError("File paths must point to a concrete file name.")
            validated_files.append({"path": path, "content": content})
        return validated_files

    @field_validator("technologies_used", "completed_steps")
    @classmethod
    def validate_non_empty_items(cls, value: List[str]) -> List[str]:
        cleaned_items = [item.strip() for item in value if item and item.strip()]
        if not cleaned_items:
            raise ValueError("Lists must contain at least one non-empty item.")
        return cleaned_items
