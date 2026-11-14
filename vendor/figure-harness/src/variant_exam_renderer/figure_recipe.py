"""Data-only, versioned recipes for deterministic local mathematical figures."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

RECIPE_VERSION: Final = "figure_recipe_v1"
type Point = tuple[float, float]
type Pair = tuple[str, str]
type LineStyle = Literal["solid", "dashed", "dotted"]
type PointMarkerStyle = Literal["none", "open", "filled"]
type ArrowStyle = Literal["none", "end", "both"]
type AngleSweep = Literal["minor", "ccw", "cw"]
type LabelPlacement = Literal["legacy", "anchored"]


@dataclass(frozen=True, slots=True)
class RecipeCurve:
    id: str
    coefficients: tuple[float, ...]
    expression: str | None
    plot_domain: Point
    fill_domain: Point | None
    line_style: LineStyle = "solid"


@dataclass(frozen=True, slots=True)
class RecipeAngle:
    id: str
    vertex: str
    ray1: str
    ray2: str
    sweep: AngleSweep = "minor"


@dataclass(frozen=True, slots=True)
class RecipeLabel:
    id: str
    text: str
    target: str
    preferred_direction: str


@dataclass(frozen=True, slots=True)
class RecipePath:
    id: str
    vertices: tuple[Point, ...]
    fill: bool
    closed: bool
    line_style: LineStyle = "solid"
    arrow: ArrowStyle = "none"
    stroke: bool = True


@dataclass(frozen=True, slots=True)
class RecipeEllipse:
    id: str
    center: Point
    radii: Point
    rotation_degrees: float
    fill: bool
    line_style: LineStyle = "solid"


@dataclass(frozen=True, slots=True)
class RecipeEllipseArc:
    id: str
    center: Point
    radii: Point
    rotation_degrees: float
    start_degrees: float
    end_degrees: float
    line_style: LineStyle


@dataclass(frozen=True, slots=True)
class RecipeStroke:
    id: str
    start: str
    end: str
    line_style: LineStyle = "solid"
    arrow: ArrowStyle = "none"


@dataclass(frozen=True, slots=True)
class RecipeTickMark:
    start: str
    end: str
    count: int


@dataclass(frozen=True, slots=True)
class FigureRecipe:
    view: tuple[float, float, float, float]
    axes: tuple[str, ...]
    points: tuple[tuple[str, Point], ...]
    curves: tuple[RecipeCurve, ...]
    segments: tuple[Pair, ...]
    equal_marks: tuple[Pair, ...]
    right_angles: tuple[RecipeAngle, ...]
    angle_marks: tuple[RecipeAngle, ...]
    visible_annotations: tuple[RecipeLabel, ...]
    paths: tuple[RecipePath, ...] = ()
    ellipses: tuple[RecipeEllipse, ...] = ()
    equal_aspect: bool = False
    strokes: tuple[RecipeStroke, ...] = ()
    point_markers: tuple[tuple[str, PointMarkerStyle], ...] | None = None
    tick_marks: tuple[RecipeTickMark, ...] = ()
    label_placement: LabelPlacement = "legacy"
    ellipse_arcs: tuple[RecipeEllipseArc, ...] = ()


class FigureRecipeError(ValueError):
    """A recipe cannot be parsed or drawn without guessing or hiding content."""
