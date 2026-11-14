"""Validated finite coordinates for the vector graph worker."""

from __future__ import annotations

from pathlib import Path  # noqa: TC003 - Pydantic resolves this annotation at runtime.
from typing import ClassVar, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MIN_CURVE_POINTS: Final = 2
INVALID_BOUNDS: Final = "bounds"
INVALID_EXTENSION: Final = "extension"
ERROR_MESSAGES: Final = {
    "bounds": "그래프의 가로·세로 범위가 올바르지 않습니다.",
    "extension": "그래프 확장자와 출력 형식이 다릅니다.",
}


class SceneModel(BaseModel):
    """Keep all rendering requests immutable after boundary parsing."""

    model_config: ClassVar[ConfigDict] = ConfigDict(
        frozen=True, populate_by_name=True, allow_inf_nan=False
    )


class Point(SceneModel):
    """A finite scene coordinate."""

    x: float
    y: float


class Curve(SceneModel):
    """Polyline segments are already sampled at the symbolic boundary."""

    label: str = Field(max_length=200)
    color: Literal["blue", "brown", "gray"]
    dashed: bool = False
    samples: tuple[Point, ...] = Field(default=(), max_length=401)
    segments: tuple[tuple[Point, ...], ...] = Field(default=(), max_length=64)


class LabeledPoint(Point):
    """A specified point with open/closed notation."""

    label: str = Field(max_length=200)
    open: bool = False


class Vertical(SceneModel):
    """A vertical boundary or guide."""

    x: float
    label: str = Field(max_length=200)


class Horizontal(SceneModel):
    """A horizontal guide at a supplied height."""

    y: float
    label: str = Field(max_length=200)


class Arrow(SceneModel):
    """A meaningful relation from one supplied point to another."""

    from_: Point = Field(alias="from")
    to: Point
    label: str = Field(max_length=200)


class Shade(SceneModel):
    """A supplied finite polygon, kept distinct from inferred area."""

    label: str = Field(max_length=200)
    color: Literal["blue", "brown", "gray"]
    polygon: tuple[Point, ...] = Field(min_length=3, max_length=800)


class Graph(SceneModel):
    """The print equivalent of the browser's shared graph contract."""

    title: str = Field(max_length=300)
    x_min: float = Field(alias="xMin", ge=-100000, le=100000)
    x_max: float = Field(alias="xMax", ge=-100000, le=100000)
    y_min: float = Field(alias="yMin", ge=-100000000, le=100000000)
    y_max: float = Field(alias="yMax", ge=-100000000, le=100000000)
    x_label: str = Field(alias="xLabel", max_length=100)
    y_label: str = Field(alias="yLabel", max_length=100)
    qualitative: bool = False
    curves: tuple[Curve, ...] = Field(max_length=8)
    points: tuple[LabeledPoint, ...] = Field(default=(), max_length=100)
    verticals: tuple[Vertical, ...] = Field(default=(), max_length=50)
    horizontals: tuple[Horizontal, ...] = Field(default=(), max_length=50)
    arrows: tuple[Arrow, ...] = Field(default=(), max_length=50)
    shades: tuple[Shade, ...] = Field(default=(), max_length=16)

    @model_validator(mode="after")
    def ordered_bounds(self) -> Graph:
        """Reject reversed bounds before creating any file."""
        if self.x_min >= self.x_max or self.y_min >= self.y_max:
            raise RenderError(INVALID_BOUNDS)
        return self


class PrintBounds(SceneModel):
    """Graph-space bounds of the main panel's highlighted detail."""

    x_min: float = Field(alias="xMin")
    x_max: float = Field(alias="xMax")
    y_min: float = Field(alias="yMin")
    y_max: float = Field(alias="yMax")


class GraphPrintOptions(SceneModel):
    """Optional dimensions and highlight for a Baeksin print panel."""

    width: float = Field(default=190, ge=150, le=510)
    highlight: PrintBounds | None = None


class RenderRequest(SceneModel):
    """An internal export request with an app-selected output location."""

    action: Literal["render"] = "render"
    graph: Graph
    output_path: Path = Field(alias="outputPath")
    format: Literal["pdf", "svg"]
    style: Literal["standard", "baeksin"] = "standard"
    options: GraphPrintOptions = GraphPrintOptions()

    @model_validator(mode="after")
    def contained_highlight(self) -> RenderRequest:
        """Only draw ordered highlights contained in the main graph."""
        bounds = self.options.highlight
        if bounds is not None and not (
            self.graph.x_min <= bounds.x_min < bounds.x_max <= self.graph.x_max
            and self.graph.y_min <= bounds.y_min < bounds.y_max <= self.graph.y_max
        ):
            raise RenderError(INVALID_BOUNDS)
        return self


class RenderResult(SceneModel):
    """Return the exact completed output path."""

    path: str


class RenderError(Exception):
    """A scene cannot be rendered with the requested constraints."""

    def __init__(self, code: Literal["bounds", "extension"]) -> None:
        """Choose a stable user-facing explanation by error code."""
        super().__init__(ERROR_MESSAGES[code])
