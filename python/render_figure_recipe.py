"""Render a figure_recipe_v1 JSON file with the vendored variant renderer."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from importlib import import_module
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import TYPE_CHECKING, Final, Never, Protocol, cast

if TYPE_CHECKING:
    from collections.abc import Callable

PYTHON_ROOT: Final = Path(__file__).resolve().parent
VENDOR_SRC: Final = PYTHON_ROOT.parent / "vendor" / "figure-harness" / "src"
MAX_RECIPE_BYTES: Final = 8 * 1024 * 1024
ARGUMENT_COUNT: Final = 3


class RecipeDrawing(Protocol):
    """Read PNG bytes and visible labels from the vendor result."""

    @property
    def png(self) -> bytes:
        """Return rendered PNG bytes."""
        ...

    @property
    def labels(self) -> tuple[str, ...]:
        """Return the rendered labels in draw order."""
        ...


def _invalid_json_constant(value: str) -> Never:
    message = f"Invalid JSON constant: {value}"
    raise ValueError(message)


def _read_recipe(source: Path) -> bytes:
    with source.open("rb") as stream:
        raw = stream.read(MAX_RECIPE_BYTES + 1)
    if len(raw) > MAX_RECIPE_BYTES:
        message = "Figure recipe exceeds 8 MiB."
        raise ValueError(message)
    return raw


def _draw(recipe: object) -> RecipeDrawing:
    cache_root = PYTHON_ROOT / ".mpl-cache" / "figure-harness"
    os.environ["MPLCONFIGDIR"] = str(cache_root / "matplotlib")
    os.environ["LOCALAPPDATA"] = str(cache_root)
    if not (VENDOR_SRC / "variant_exam_renderer" / "figure_recipe_parsing.py").is_file():
        message = f"Vendored figure renderer is missing at {VENDOR_SRC}."
        raise FileNotFoundError(message)
    sys.path.insert(0, str(VENDOR_SRC))
    parser = import_module("variant_exam_renderer.figure_recipe_parsing")
    renderer = import_module("variant_exam_renderer.render.recipe_drawing")
    parse = cast("Callable[[object], object]", parser.parse_figure_recipe)
    draw = cast("Callable[[object], RecipeDrawing]", renderer.draw_figure_recipe)
    return draw(parse(recipe))


def _write_png(destination: Path, png: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
            temporary = Path(stream.name)
            _ = stream.write(png)
        _ = temporary.replace(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> int:
    """Read one JSON recipe and atomically publish the resulting PNG."""
    if len(sys.argv) != ARGUMENT_COUNT:
        _ = sys.stderr.write("Usage: render_figure_recipe.py INPUT.json OUTPUT.png\n")
        return 2
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2]).absolute()
    if source.suffix.lower() != ".json" or destination.suffix.lower() != ".png":
        _ = sys.stderr.write("Expected a .json input path and a .png output path.\n")
        return 2
    try:
        raw = _read_recipe(source)
        recipe = cast(
            "object",
            json.loads(raw.decode("utf-8"), parse_constant=_invalid_json_constant),
        )
        drawing = _draw(recipe)
        png = drawing.png
        _write_png(destination, png)
    except (ImportError, OSError, ValueError, ArithmeticError, RecursionError) as error:
        _ = sys.stderr.write(f"{error}\n")
        return 1
    result = {
        "path": str(destination),
        "bytes": len(png),
        "labels": drawing.labels,
        "sha256": hashlib.sha256(png).hexdigest(),
        "recipe_sha256": hashlib.sha256(raw).hexdigest(),
    }
    _ = sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
