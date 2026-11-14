# /// script
# requires-python = ">=3.13"
# dependencies = ["pydantic>=2.12,<3", "sympy>=1.14,<2", "matplotlib>=3.10,<4"]
# ///
# ─── How to run ───
# uv run --project . python main.py < request.json
"""Bounded JSON interface for the app-owned mathematical worker process."""

import sys
from typing import Annotated, ClassVar, assert_never

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from compute import CheckRequest, MathInputError, SampleRequest, check, sample
from render import RenderError, RenderRequest, render


class ErrorResult(BaseModel):
    """Report expected input errors without a Python traceback."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)
    error: str


def main() -> int:
    """Parse one request from stdin and write one UTF-8 JSON result."""
    try:
        raw = sys.stdin.buffer.read(512 * 1024 + 1)
        if len(raw) > 512 * 1024:
            message = ErrorResult(error="계산 입력이 허용 크기를 넘었습니다.")
            _ = sys.stdout.write(message.model_dump_json())
            return 1
        adapter = TypeAdapter(
            Annotated[CheckRequest | SampleRequest | RenderRequest, Field(discriminator="action")]
        )
        request = adapter.validate_json(raw)
        match request:
            case CheckRequest():
                response = check(request)
            case SampleRequest():
                response = sample(request)
            case RenderRequest():
                response = render(request)
            case _:
                assert_never(request)
        _ = sys.stdout.write(response.model_dump_json())
    except (
        MathInputError,
        RenderError,
        ValidationError,
        ValueError,
        ArithmeticError,
        OSError,
    ) as error:
        _ = sys.stdout.write(ErrorResult(error=str(error)[:2000]).model_dump_json())
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
