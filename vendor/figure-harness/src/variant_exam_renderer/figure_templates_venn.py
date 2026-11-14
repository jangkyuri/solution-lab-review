"""Fixed two/three-set Venn diagrams with selected atomic regions.

S053-P08-F02 supports the light-gray region style only. The official atlas
contains no matching Venn construction, so this is a bounded mathematical
construction rather than a claim that the source diagram was reproduced.
Only the explicit annotation envelope may name the sets. The builder itself
draws unlabeled circle outlines and the requested gray regions.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final, cast

from variant_exam_renderer.figure_recipe import RECIPE_VERSION, FigureRecipeError, Point

_RADIUS: Final = 1.0
_SIDE: Final = 1.2
_TAU: Final = 2 * math.pi
_ANGLE_STEP: Final = math.pi / 120  # <=1.5 degrees; tiny print-size chord error.
_MATCH_TOLERANCE: Final = 1e-8


@dataclass(frozen=True, slots=True)
class _DirectedArc:
    points: tuple[Point, ...]

    @property
    def start(self) -> Point:
        return self.points[0]

    @property
    def end(self) -> Point:
        return self.points[-1]


def _parameters(parameters: object) -> tuple[int, tuple[str, ...]]:
    if not isinstance(parameters, dict):
        msg = "venn_regions parameters must be an object"
        raise FigureRecipeError(msg)
    data = cast("dict[object, object]", parameters)
    if set(data) != {"set_count", "shade_regions"}:
        msg = "venn_regions parameters require exactly set_count and shade_regions"
        raise FigureRecipeError(msg)
    count = data["set_count"]
    if isinstance(count, bool) or not isinstance(count, int) or count not in (2, 3):
        msg = "set_count must be the integer 2 or 3"
        raise FigureRecipeError(msg)
    raw = data["shade_regions"]
    if not isinstance(raw, list):
        msg = "shade_regions must be an array"
        raise FigureRecipeError(msg)
    values = cast("list[object]", raw)
    if not 1 <= len(values) <= 2**count - 1:
        msg = "shade_regions must select 1 to 2^set_count-1 regions"
        raise FigureRecipeError(msg)
    masks: list[str] = []
    for region in values:
        if (
            not isinstance(region, str)
            or len(region) != count
            or set(region) - {"0", "1"}
            or "1" not in region
        ):
            msg = "each shade region must be a nonzero A/B/C membership bit string"
            raise FigureRecipeError(msg)
        if region in masks:
            msg = "shade_regions must not repeat a mask"
            raise FigureRecipeError(msg)
        masks.append(region)
    return count, tuple(sorted(masks))


def _centers(count: int) -> tuple[Point, ...]:
    if count == 2:
        return ((-_SIDE / 2, 0.0), (_SIDE / 2, 0.0))
    # Each of the seven nonempty three-set masks has one positive-area face.
    # Arbitrary circle positions are deliberately excluded.
    height = _SIDE / math.sqrt(3)
    return ((-_SIDE / 2, height / 2), (_SIDE / 2, height / 2), (0.0, -height))


def _circle_point(center: Point, angle: float) -> Point:
    return (
        center[0] + _RADIUS * math.cos(angle),
        center[1] + _RADIUS * math.sin(angle),
    )


def _intersection_angles(center: Point, other: Point) -> tuple[float, float]:
    direction = math.atan2(other[1] - center[1], other[0] - center[0])
    distance = math.dist(center, other)
    half_angle = math.acos(distance / (2 * _RADIUS))
    return (
        (direction - half_angle) % _TAU,
        (direction + half_angle) % _TAU,
    )


def _boundary_masks(
    centers: tuple[Point, ...], circle_index: int, midpoint: Point
) -> tuple[str, str]:
    other_bits = [
        "1" if math.dist(midpoint, center) < _RADIUS else "0" for center in centers
    ]
    inside, outside = other_bits.copy(), other_bits.copy()
    inside[circle_index] = "1"
    outside[circle_index] = "0"
    return "".join(inside), "".join(outside)


def _sample_arc(center: Point, start: float, end: float) -> _DirectedArc:
    steps = max(1, math.ceil(abs(end - start) / _ANGLE_STEP))
    return _DirectedArc(
        tuple(
            _circle_point(center, start + (end - start) * index / steps)
            for index in range(steps + 1)
        )
    )


def _region_arcs(centers: tuple[Point, ...], mask: str) -> list[_DirectedArc]:
    result: list[_DirectedArc] = []
    for index, center in enumerate(centers):
        crossings = sorted(
            angle
            for other_index, other in enumerate(centers)
            if other_index != index
            for angle in _intersection_angles(center, other)
        )
        for position, start in enumerate(crossings):
            end = crossings[(position + 1) % len(crossings)]
            if end <= start:
                end += _TAU
            midpoint = _circle_point(center, (start + end) / 2)
            inside, outside = _boundary_masks(centers, index, midpoint)
            if inside == mask:
                result.append(_sample_arc(center, start, end))
            elif outside == mask:
                # Reverse orientation so the requested region stays left.
                result.append(_sample_arc(center, end, start))
    return result


def _same(first: Point, second: Point) -> bool:
    return math.dist(first, second) <= _MATCH_TOLERANCE


def _polygon(centers: tuple[Point, ...], mask: str) -> list[list[float]]:
    remaining = _region_arcs(centers, mask)
    if not remaining:
        raise FigureRecipeError(f"venn region has no boundary: {mask}")
    ordered = [remaining.pop(0)]
    while not _same(ordered[-1].end, ordered[0].start):
        matches = [
            index
            for index, arc in enumerate(remaining)
            if _same(ordered[-1].end, arc.start)
        ]
        if len(matches) != 1:
            raise FigureRecipeError(f"venn region is not a single closed face: {mask}")
        ordered.append(remaining.pop(matches[0]))
    if remaining:
        raise FigureRecipeError(f"venn region has multiple contours: {mask}")
    vertices = [*ordered[0].points]
    for arc in ordered[1:]:
        vertices.extend(arc.points[1:])
    if _same(vertices[-1], vertices[0]):
        _ = vertices.pop()
    if not 3 <= len(vertices) <= 2048:
        raise FigureRecipeError(
            f"venn region polygon exceeds raw vertex limits: {mask}"
        )
    area = (
        sum(
            x0 * y1 - x1 * y0
            for (x0, y0), (x1, y1) in zip(
                vertices, [*vertices[1:], vertices[0]], strict=True
            )
        )
        / 2
    )
    if area <= 0.01:
        raise FigureRecipeError(f"venn region has nonpositive or tiny area: {mask}")
    return [[x, y] for x, y in vertices]


def build_venn_regions(parameters: object) -> dict[str, object]:
    """Shade selected atomic masks within a fixed two/three-circle Venn.

    Required set_count is 2 or 3. Required shade_regions is a nonempty unique
    array of membership bit strings ordered A, B, C: "10" means A only,
    "110" means A and B but not C, and "111" means all three. The all-zero
    region outside every circle is unsupported because there is no universe
    frame. Stable text targets are set_A_label, set_B_label, and set_C_label
    for the three-set construction.
    """
    count, masks = _parameters(parameters)
    centers = _centers(count)
    names = "ABC"[:count]
    if count == 2:
        label_points: tuple[Point, ...] = ((-1.35, 0.92), (1.35, 0.92))
        view = [-1.85, 1.85, -1.30, 1.50]
    else:
        label_points = ((-1.30, 1.10), (1.30, 1.10), (0.0, -1.80))
        view = [-1.85, 1.85, -1.95, 1.62]
    return {
        "schema_version": RECIPE_VERSION,
        "view": view,
        "axes": [],
        "equal_aspect": True,
        "points": {
            f"set_{name}_label": list(point)
            for name, point in zip(names, label_points, strict=True)
        },
        "point_markers": {},
        "paths": [
            {
                "id": f"shade_{mask}",
                "vertices": _polygon(centers, mask),
                "closed": True,
                "fill": True,
                "stroke": False,
            }
            for mask in masks
        ],
        "ellipses": [
            {
                "id": f"set_{name}_circle",
                "center": list(center),
                "radii": [_RADIUS, _RADIUS],
                "fill": False,
            }
            for name, center in zip(names, centers, strict=True)
        ],
        "visible_annotations": [],
    }
