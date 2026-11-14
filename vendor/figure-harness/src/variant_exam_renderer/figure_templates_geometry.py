"""Bounded geometry constructions traced to the official-exam visual atlas.

Templates construct mathematical relationships, not visible claims. Callers must
provide every label through ``visible_annotations`` after expansion. Construction
points are hidden by default; the triangle's equality ticks require an explicit
``show_equal_marks`` request.
"""

from __future__ import annotations

import math
from typing import cast

from variant_exam_renderer.figure_recipe import RECIPE_VERSION, FigureRecipeError, Point


def _parameters(value: object, allowed: set[str]) -> dict[str, object]:
    if not isinstance(value, dict):
        msg = "template parameters must be an object"
        raise FigureRecipeError(msg)
    data = cast("dict[object, object]", value)
    if any(not isinstance(key, str) for key in data):
        msg = "template parameter names must be strings"
        raise FigureRecipeError(msg)
    result = cast("dict[str, object]", data)
    if result.keys() - allowed:
        raise FigureRecipeError(
            f"unknown geometry template parameters: {sorted(result.keys() - allowed)}"
        )
    return result


def _number(
    data: dict[str, object], key: str, default: float, lower: float, upper: float
) -> float:
    value = data.get(key, default)
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not lower <= value <= upper
        or not math.isfinite(value)
    ):
        raise FigureRecipeError(f"{key} must be a finite number in [{lower}, {upper}]")
    return float(value)


def _flag(data: dict[str, object], key: str, *, default: bool) -> bool:
    value = data.get(key, default)
    if not isinstance(value, bool):
        raise FigureRecipeError(f"{key} must be a boolean")
    return value


def _recipe(points: dict[str, Point], view: list[float]) -> dict[str, object]:
    return {
        "schema_version": RECIPE_VERSION,
        "view": view,
        "axes": [],
        "equal_aspect": True,
        "points": {name: list(point) for name, point in points.items()},
        "point_markers": {},
        "visible_annotations": [],
    }


def _stroke(identifier: str, start: str, end: str) -> dict[str, object]:
    return {"id": identifier, "from": start, "to": end, "line_style": "solid"}


def _circle(
    identifier: str, center: Point, radius: float, *, fill: bool = False
) -> dict[str, object]:
    return {
        "id": identifier,
        "center": list(center),
        "radii": [radius, radius],
        "fill": fill,
    }


def _polar(radius: float, angle_degrees: float) -> Point:
    radians = math.radians(angle_degrees)
    return radius * math.cos(radians), radius * math.sin(radians)


def _on_horizontal_line(first: Point, second: Point, y: float) -> Point:
    # Upper-arc A and lower-arc B/D ensure a nonhorizontal secant.
    factor = (y - first[1]) / (second[1] - first[1])
    return first[0] + factor * (second[0] - first[0]), y


def build_circle_tangent_chords(parameters: object) -> dict[str, object]:
    """Construct S054-P08-F02's inscribed quadrilateral and bottom tangent.

    ``radius``: [0.1, 100], default 1. ``apex_angle_degrees``: [60, 150],
    default 120. ``chord_half_angle_degrees``: [35, 80], default 60.
    A/B/C/D lie on ``circumcircle``; BC=CD, and EF is tangent at C.
    Stable point targets are A, B, C, D, E, F, O. Stroke targets are
    secant_AE, secant_AF, chord_BC, chord_CD, tangent_EF.
    """
    data = _parameters(
        parameters, {"radius", "apex_angle_degrees", "chord_half_angle_degrees"}
    )
    radius = _number(data, "radius", 1, 0.1, 100)
    apex = _number(data, "apex_angle_degrees", 120, 60, 150)
    half_angle = _number(data, "chord_half_angle_degrees", 60, 35, 80)
    point_a = _polar(radius, apex)
    point_b = _polar(radius, 270 - half_angle)
    point_d = _polar(radius, 270 + half_angle)
    point_e = _on_horizontal_line(point_a, point_b, -radius)
    point_f = _on_horizontal_line(point_a, point_d, -radius)
    points = {
        "O": (0.0, 0.0),
        "A": point_a,
        "B": point_b,
        "C": (0.0, -radius),
        "D": point_d,
        "E": point_e,
        "F": point_f,
    }
    margin = 0.22 * radius
    recipe = _recipe(
        points,
        [
            min(-radius, point_e[0]) - margin,
            max(radius, point_f[0]) + margin,
            -radius - margin,
            radius + margin,
        ],
    )
    recipe["ellipses"] = [_circle("circumcircle", points["O"], radius)]
    recipe["strokes"] = [
        _stroke("secant_AE", "A", "E"),
        _stroke("secant_AF", "A", "F"),
        _stroke("chord_BC", "B", "C"),
        _stroke("chord_CD", "C", "D"),
        _stroke("tangent_EF", "E", "F"),
    ]
    return recipe


def build_circular_seating(parameters: object) -> dict[str, object]:
    """Construct S055-P10-F01's table with equally spaced circular seats.

    ``seat_count``: integer [3, 16], default 8. ``table_radius``: [0.25, 20],
    default 1. ``seat_radius_ratio``: [0.05, 0.25], default 0.2. ``gap_ratio``:
    [0.03, 0.5], default 0.18. Both ratios use table radius as denominator.
    ``rotation_degrees``: [-180, 180], default 90. ``fill_seats``: boolean,
    default true. Touching/overlapping adjacent seats are rejected.
    Targets: O, table, seat_1..seat_n, chair_1..chair_n; seats run clockwise.
    """
    data = _parameters(
        parameters,
        {
            "seat_count",
            "table_radius",
            "seat_radius_ratio",
            "gap_ratio",
            "rotation_degrees",
            "fill_seats",
        },
    )
    count = data.get("seat_count", 8)
    if isinstance(count, bool) or not isinstance(count, int) or not 3 <= count <= 16:
        msg = "seat_count must be an integer in [3, 16]"
        raise FigureRecipeError(msg)
    radius = _number(data, "table_radius", 1, 0.25, 20)
    seat_ratio = _number(data, "seat_radius_ratio", 0.2, 0.05, 0.25)
    gap_ratio = _number(data, "gap_ratio", 0.18, 0.03, 0.5)
    rotation = _number(data, "rotation_degrees", 90, -180, 180)
    fill = _flag(data, "fill_seats", default=True)
    orbit_radius = radius * (1 + seat_ratio + gap_ratio)
    seat_radius = radius * seat_ratio
    center_distance = 2 * orbit_radius * math.sin(math.pi / count)
    if center_distance <= 2 * seat_radius + 1e-9 * radius:
        msg = (
            "adjacent seats must not touch or overlap; reduce seat size or increase gap"
        )
        raise FigureRecipeError(msg)
    points: dict[str, Point] = {"O": (0.0, 0.0)}
    ellipses: list[dict[str, object]] = [_circle("table", points["O"], radius)]
    for index in range(1, count + 1):
        center = _polar(orbit_radius, rotation - 360 * (index - 1) / count)
        points[f"seat_{index}"] = center
        ellipses.append(_circle(f"chair_{index}", center, seat_radius, fill=fill))
    extent = orbit_radius + seat_radius + 0.18 * radius
    recipe = _recipe(points, [-extent, extent, -extent, extent])
    recipe["ellipses"] = ellipses
    return recipe


def build_triangle_equal_segments(parameters: object) -> dict[str, object]:
    """Construct S031-P09-F01's equilateral triangle with PQ=PR.

    ``side_length``: [0.1, 100], default 1. ``ap_fraction``: [0.1, 0.4],
    default 0.27. ``show_equal_marks``: boolean, default false. For t=AP/AB,
    BQ/AB=1-2t and CR/AB=t, so AP+BQ+CR=AB and PQ=PR. No ticks appear
    unless explicitly requested. Targets: A/B/C/P/Q/R, edge_AB/edge_BC/
    edge_CA, inner_PQ/inner_PR. The equality pair uses two ticks on each.
    """
    data = _parameters(parameters, {"side_length", "ap_fraction", "show_equal_marks"})
    length = _number(data, "side_length", 1, 0.1, 100)
    fraction = _number(data, "ap_fraction", 0.27, 0.1, 0.4)
    show_marks = _flag(data, "show_equal_marks", default=False)
    height = math.sqrt(3) * length / 2
    bq_fraction = 1 - 2 * fraction
    points: dict[str, Point] = {
        "A": (0.0, 0.0),
        "B": (length, 0.0),
        "C": (length / 2, height),
        "P": (fraction * length, 0.0),
        "Q": (length * (1 - bq_fraction / 2), bq_fraction * height),
        "R": ((1 - fraction) * length / 2, (1 - fraction) * height),
    }
    margin = 0.13 * length
    recipe = _recipe(points, [-margin, length + margin, -margin, height + margin])
    recipe["strokes"] = [
        _stroke("edge_AB", "A", "B"),
        _stroke("edge_BC", "B", "C"),
        _stroke("edge_CA", "C", "A"),
        _stroke("inner_PQ", "P", "Q"),
        _stroke("inner_PR", "P", "R"),
    ]
    recipe["tick_marks"] = (
        [{"from": "P", "to": "Q", "count": 2}, {"from": "P", "to": "R", "count": 2}]
        if show_marks
        else []
    )
    return recipe
