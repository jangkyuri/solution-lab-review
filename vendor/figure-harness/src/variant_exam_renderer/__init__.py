"""Public constants for the fresh variant exam renderer scaffold."""

from __future__ import annotations

from typing import Final

__version__: Final[str] = "0.2.0"
SCHEMA_ROOT: Final[str] = "chatgpt_variant_exam_export/"
SCHEMA_VERSION: Final[str] = "chatgpt_variant_exam_export_v1"
REVIEW_METADATA_POLICY: Final[str] = "warning-only"

__all__: Final[tuple[str, ...]] = (
    "REVIEW_METADATA_POLICY",
    "SCHEMA_ROOT",
    "SCHEMA_VERSION",
    "__version__",
)
