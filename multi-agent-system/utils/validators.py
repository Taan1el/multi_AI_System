"""Reusable validation helpers for Phase 2 orchestration."""

from __future__ import annotations

import json
import re
from typing import Any, Mapping, Sequence

from pydantic import BaseModel, ValidationError

from schemas.implementation import GeneratedFile

PLACEHOLDER_PATTERNS = (
    re.compile(r"\bTODO\b", re.IGNORECASE),
    re.compile(r"\bFIXME\b", re.IGNORECASE),
    re.compile(r"\bplaceholder\b", re.IGNORECASE),
    re.compile(r"NotImplementedError"),
    re.compile(r"your code here", re.IGNORECASE),
    re.compile(r"coming soon", re.IGNORECASE),
    re.compile(r"lorem ipsum", re.IGNORECASE),
    re.compile(r"\.\.\."),
)
NON_SIGNAL_REQUIREMENT_TOKENS = {
    "build",
    "create",
    "develop",
    "implement",
    "operation",
    "operations",
    "service",
    "simple",
    "system",
    "write",
}


def validate_json_structure(payload: Any) -> list[str]:
    """Return structural JSON errors for a payload, if any."""
    try:
        if isinstance(payload, BaseModel):
            json.dumps(payload.model_dump())
        elif isinstance(payload, str):
            json.loads(payload)
        else:
            json.dumps(payload)
    except (TypeError, ValueError) as exc:
        return [f"JSON structure validation failed: {exc}"]
    return []


def validate_schema_compliance(
    payload: Any, schema_model: type[BaseModel]
) -> list[str]:
    """Return schema validation errors for a payload, if any."""
    try:
        if isinstance(payload, schema_model):
            schema_model.model_validate(payload.model_dump())
        elif isinstance(payload, BaseModel):
            schema_model.model_validate(payload.model_dump())
        else:
            schema_model.model_validate(payload)
    except ValidationError as exc:
        return [
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()
        ]
    return []


def _read_file_entry(file_entry: Mapping[str, str] | GeneratedFile) -> tuple[str, str]:
    """Normalize a file entry into path/content strings."""
    if isinstance(file_entry, GeneratedFile):
        return file_entry.path, file_entry.content

    if {"path", "content"}.issubset(file_entry):
        return str(file_entry.get("path", "")), str(file_entry.get("content", ""))

    if len(file_entry) == 1:
        path, content = next(iter(file_entry.items()))
        return str(path), str(content)

    return "", ""


def validate_code_syntax(
    files: Sequence[Mapping[str, str] | GeneratedFile],
) -> list[str]:
    """Return syntax validation errors for generated code files."""
    errors: list[str] = []
    for file_entry in files:
        path, content = _read_file_entry(file_entry)
        normalized_path = path.lower()

        if normalized_path.endswith(".py"):
            try:
                compile(content, path, "exec")
            except SyntaxError as exc:
                errors.append(
                    f"{path}: Python syntax error on line {exc.lineno}: {exc.msg}"
                )
        elif normalized_path.endswith(".json"):
            try:
                json.loads(content)
            except ValueError as exc:
                errors.append(f"{path}: JSON syntax error: {exc}")
    return errors


def detect_placeholder_code(
    files: Sequence[Mapping[str, str] | GeneratedFile],
) -> list[str]:
    """Return findings for placeholder or obviously incomplete code."""
    findings: list[str] = []
    for file_entry in files:
        path, content = _read_file_entry(file_entry)
        for pattern in PLACEHOLDER_PATTERNS:
            if pattern.search(content):
                findings.append(
                    f"{path}: contains placeholder content matching '{pattern.pattern}'"
                )
                break
    return findings


def find_missing_requirements(
    requirements: Sequence[str], implementation_text: str
) -> list[str]:
    """Estimate which requirements are insufficiently represented in the output."""
    normalized_text = implementation_text.lower()
    missing: list[str] = []

    for requirement in requirements:
        normalized_requirement = requirement.lower()

        if "crud" in normalized_requirement:
            has_named_crud = all(
                keyword in normalized_text
                for keyword in ("create", "update", "delete")
            ) and ("read" in normalized_text or "get" in normalized_text)
            has_http_crud = all(
                keyword in normalized_text for keyword in ("post", "put", "delete", "get")
            )
            if has_named_crud or has_http_crud:
                continue

        tokens = [
            token
            for token in re.findall(r"[a-zA-Z]{4,}", normalized_requirement)
            if token not in NON_SIGNAL_REQUIREMENT_TOKENS
        ]
        if not tokens:
            tokens = re.findall(r"[a-zA-Z]{4,}", normalized_requirement)
        if not tokens:
            continue

        matched_tokens = sum(1 for token in set(tokens) if token in normalized_text)
        minimum_match_threshold = max(1, len(set(tokens)) // 2)
        if matched_tokens < minimum_match_threshold:
            missing.append(requirement)

    return missing
