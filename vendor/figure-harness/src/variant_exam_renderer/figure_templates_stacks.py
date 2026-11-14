"""Bounded isometric unit-cube piles for square and triangular layer sequences.

The official atlas S017-P05-F01 establishes the plain cube wireframe style. It
does not contain this particular pile. The original textbook examples motivate
the two explicitly supported layer shapes; neither construction reveals counts
or other text unless the caller supplies visible annotations.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import cast

from variant_exam_renderer.figure_recipe import RECIPE_VERSION, FigureRecipeError

type Point2 = tuple[float, float]
type Point3 = tuple[float, float, float]
type Cube = tuple[float, float, float]

_COS30 = math.sqrt(3) / 2
_EPS = 1e-9


def _project(point: Point3) -> Point2:
    x, y, z = point
    return (_COS30 * (x + y), z + (y - x) / 2)


def _depth(point: Point3) -> float:
    x, y, z = point
    return x - y + z


def _cross(a: Point2, b: Point2) -> float:
    return a[0] * b[1] - a[1] * b[0]


def _sub(a: Point2, b: Point2) -> Point2:
    return a[0] - b[0], a[1] - b[1]


def _lerp(a: Point2, b: Point2, t: float) -> Point2:
    return a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])


def _canon(point: Point2) -> Point2:
    return round(point[0], 8), round(point[1], 8)


def _cube_positions(shape: str, levels: int) -> tuple[Cube, ...]:
    """Put successively smaller centered layers over the floor layer."""
    cubes: list[Cube] = []
    for z in range(levels):
        side = levels - z
        offset = z / 2
        for x in range(side):
            for y in range(side):
                if shape == "triangular" and x + y >= side:
                    continue
                cubes.append((x + offset, y + offset, float(z)))
    return tuple(cubes)


@dataclass(frozen=True, slots=True)
class _Face:
    polygon: tuple[Point2, Point2, Point2, Point2]
    depth_a: float
    depth_b: float
    depth_c: float

    def depth_at(self, point: Point2) -> float:
        return self.depth_a * point[0] + self.depth_b * point[1] + self.depth_c

    def overlap(self, start: Point2, end: Point2) -> tuple[float, float] | None:
        """Clip one projected segment to this convex projected face."""
        lo, hi = 0.0, 1.0
        delta = _sub(end, start)
        for index, vertex in enumerate(self.polygon):
            edge = _sub(self.polygon[(index + 1) % 4], vertex)
            initial = _cross(edge, _sub(start, vertex))
            slope = _cross(edge, delta)
            if abs(slope) < _EPS:
                if initial < -_EPS:
                    return None
                continue
            crossing = -initial / slope
            if slope > 0:
                lo = max(lo, crossing)
            else:
                hi = min(hi, crossing)
            if lo >= hi - _EPS:
                return None
        return lo, hi


def _face(vertices: tuple[Point3, Point3, Point3, Point3]) -> _Face:
    projected = [_project(point) for point in vertices]
    depths = [_depth(point) for point in vertices]
    if _cross(_sub(projected[1], projected[0]), _sub(projected[2], projected[0])) < 0:
        projected.reverse()
        depths.reverse()
    u0, v0 = projected[0]
    du1, dv1 = _sub(projected[1], projected[0])
    du2, dv2 = _sub(projected[2], projected[0])
    determinant = du1 * dv2 - dv1 * du2
    if abs(determinant) < _EPS:
        msg = "unit-cube face collapsed in fixed projection"
        raise FigureRecipeError(msg)
    dd1, dd2 = depths[1] - depths[0], depths[2] - depths[0]
    a = (dd1 * dv2 - dv1 * dd2) / determinant
    b = (du1 * dd2 - dd1 * du2) / determinant
    return _Face(
        cast("tuple[Point2, Point2, Point2, Point2]", tuple(projected)),
        a,
        b,
        depths[0] - a * u0 - b * v0,
    )


def _visible_faces(cubes: tuple[Cube, ...]) -> tuple[_Face, ...]:
    occupied = set(cubes)
    faces: list[_Face] = []
    for x, y, z in cubes:
        if (x + 1, y, z) not in occupied:
            faces.append(
                _face(
                    (
                        (x + 1, y, z),
                        (x + 1, y + 1, z),
                        (x + 1, y + 1, z + 1),
                        (x + 1, y, z + 1),
                    )
                )
            )
        if (x, y - 1, z) not in occupied:
            faces.append(
                _face(((x, y, z), (x + 1, y, z), (x + 1, y, z + 1), (x, y, z + 1)))
            )
        if (x, y, z + 1) not in occupied:
            faces.append(
                _face(
                    (
                        (x, y, z + 1),
                        (x + 1, y, z + 1),
                        (x + 1, y + 1, z + 1),
                        (x, y + 1, z + 1),
                    )
                )
            )
    return tuple(faces)


def _front_interval(
    face: _Face, start: Point2, end: Point2, depths: tuple[float, float]
) -> tuple[float, float] | None:
    overlap = face.overlap(start, end)
    if overlap is None:
        return None
    lo, hi = overlap
    d0, d1 = depths
    p_lo, p_hi = _lerp(start, end, lo), _lerp(start, end, hi)
    delta_lo = face.depth_at(p_lo) - (d0 + lo * (d1 - d0))
    delta_hi = face.depth_at(p_hi) - (d0 + hi * (d1 - d0))
    if delta_lo <= _EPS and delta_hi <= _EPS:
        return None
    if delta_lo > _EPS and delta_hi > _EPS:
        return lo, hi
    crossing = lo + (hi - lo) * (_EPS - delta_lo) / (delta_hi - delta_lo)
    return (crossing, hi) if delta_hi > delta_lo else (lo, crossing)


def _visible_segments(faces: tuple[_Face, ...]) -> tuple[tuple[Point2, Point2], ...]:
    edges: dict[
        tuple[Point2, Point2, float, float],
        tuple[Point2, Point2, float, float],
    ] = {}
    for face in faces:
        for index, first in enumerate(face.polygon):
            second = face.polygon[(index + 1) % 4]
            start, end = (second, first) if second < first else (first, second)
            d0, d1 = face.depth_at(start), face.depth_at(end)
            key = (_canon(start), _canon(end), round(d0, 8), round(d1, 8))
            edges[key] = start, end, d0, d1

    visible: set[tuple[Point2, Point2]] = set()
    for start, end, d0, d1 in edges.values():
        hidden = sorted(
            interval
            for face in faces
            if (interval := _front_interval(face, start, end, (d0, d1))) is not None
        )
        position = 0.0
        for lo, hi in hidden:
            if lo > position + _EPS:
                a, b = (
                    _canon(_lerp(start, end, position)),
                    _canon(_lerp(start, end, lo)),
                )
                if a != b:
                    visible.add((min(a, b), max(a, b)))
            position = max(position, hi)
            if position >= 1 - _EPS:
                break
        if position < 1 - _EPS:
            a, b = _canon(_lerp(start, end, position)), _canon(end)
            if a != b:
                visible.add((min(a, b), max(a, b)))
    return tuple(sorted(visible))


def _trace_paths(
    segments: tuple[tuple[Point2, Point2], ...],
) -> tuple[tuple[Point2, ...], ...]:
    """Walk visible-edge components without drawing a connector through empty space."""
    adjacency: dict[Point2, list[tuple[int, Point2]]] = defaultdict(list)
    for index, (start, end) in enumerate(segments):
        adjacency[start].append((index, end))
        adjacency[end].append((index, start))
    visited: set[int] = set()
    paths: list[tuple[Point2, ...]] = []
    for node in sorted(adjacency):
        if all(index in visited for index, _ in adjacency[node]):
            continue
        route: list[Point2] = [node]
        stack: list[tuple[Point2, int]] = [(node, 0)]
        while stack:
            current, cursor = stack[-1]
            neighbors = adjacency[current]
            if cursor >= len(neighbors):
                _ = stack.pop()
                if stack:
                    route.append(stack[-1][0])
                continue
            stack[-1] = (current, cursor + 1)
            edge_index, next_node = neighbors[cursor]
            if edge_index in visited:
                continue
            visited.add(edge_index)
            route.append(next_node)
            stack.append((next_node, 0))
        paths.append(tuple(route))
    return tuple(paths)


def _pile_paths(shape: str, levels: int) -> tuple[tuple[Point2, ...], ...]:
    cubes = _cube_positions(shape, levels)
    return _trace_paths(_visible_segments(_visible_faces(cubes)))


def _surface_polygons(shape: str, levels: int) -> tuple[tuple[Point2, ...], ...]:
    """Merge coplanar faces so solid occlusion stays within the 32-path cap.

    All panels have the same light fill. Their individual drawing order therefore
    cannot expose a hidden panel; the depth-clipped edge paths supply the seams.
    """
    polygons: list[tuple[Point2, ...]] = []
    for z in range(levels):
        side = levels - z
        offset = z / 2
        lower = float(z)
        upper = lower + 1
        left, right = offset, offset + side
        if shape == "square":
            top = (
                (left, left, upper),
                (right, left, upper),
                (right, right, upper),
                (left, right, upper),
            )
            polygons.append(tuple(_project(point) for point in top))
            right_face = (
                (right, left, lower),
                (right, right, lower),
                (right, right, upper),
                (right, left, upper),
            )
            polygons.append(tuple(_project(point) for point in right_face))
        else:
            top_points: list[Point3] = [(left, left, upper), (right, left, upper)]
            for step in range(side):
                top_points.extend(
                    (
                        (right - step, left + step + 1, upper),
                        (right - step - 1, left + step + 1, upper),
                    )
                )
            polygons.append(tuple(_project(point) for point in top_points))
            for row in range(side):
                x = right - row
                y = left + row
                face = (
                    (x, y, lower),
                    (x, y + 1, lower),
                    (x, y + 1, upper),
                    (x, y, upper),
                )
                polygons.append(tuple(_project(point) for point in face))
        front_face = (
            (left, left, lower),
            (right, left, lower),
            (right, left, upper),
            (left, left, upper),
        )
        polygons.append(tuple(_project(point) for point in front_face))
    return tuple(polygons)


def build_stacked_cubes(parameters: object) -> dict[str, object]:
    """Build a square- or triangular-layer pile, optionally showing stages 1..N.

    Required parameters: layer_shape (`square` or `triangular`), levels (1..5),
    display_stages (boolean). Multi-stage displays are bounded to levels <=3
    to keep the individual cubes readable at the fixed output size. The caller
    may label `stage_1` ... `stage_N`; no text is generated automatically.
    """
    if not isinstance(parameters, dict):
        msg = "stacked_cubes parameters must be an object"
        raise FigureRecipeError(msg)
    data = cast("dict[str, object]", parameters)
    expected = {"layer_shape", "levels", "display_stages"}
    if set(data) != expected:
        raise FigureRecipeError(f"stacked_cubes requires exactly {sorted(expected)}")
    shape, levels, stages = (
        data[key] for key in ("layer_shape", "levels", "display_stages")
    )
    if not isinstance(shape, str) or shape not in {"square", "triangular"}:
        msg = "layer_shape must be square or triangular"
        raise FigureRecipeError(msg)
    if isinstance(levels, bool) or not isinstance(levels, int) or not 1 <= levels <= 5:
        msg = "levels must be an integer in [1, 5]"
        raise FigureRecipeError(msg)
    if not isinstance(stages, bool):
        msg = "display_stages must be a boolean"
        raise FigureRecipeError(msg)
    if stages and levels > 3:
        msg = "display_stages supports at most 3 levels at fixed output size"
        raise FigureRecipeError(msg)

    paths: list[dict[str, object]] = []
    anchors: dict[str, list[float]] = {}
    x_offset = 0.0
    for stage in range(1, levels + 1) if stages else (levels,):
        scene = _pile_paths(shape, stage)
        surfaces = _surface_polygons(shape, stage)
        if not scene:
            msg = "stacked_cubes produced no visible edges"
            raise FigureRecipeError(msg)
        xs = [x for path in scene for x, _ in path]
        ys = [y for path in scene for _, y in path]
        dx = x_offset - min(xs)
        dy = -min(ys)
        for index, polygon in enumerate(surfaces, 1):
            paths.append(
                {
                    "id": f"stage_{stage}_surface_{index}",
                    "vertices": [[x + dx, y + dy] for x, y in polygon],
                    "closed": True,
                    "fill": True,
                    "stroke": False,
                }
            )
        for index, path in enumerate(scene, 1):
            if len(path) > 2048:
                raise FigureRecipeError(
                    f"stacked_cubes stage {stage} exceeds 2048 path vertices"
                )
            paths.append(
                {
                    "id": f"stage_{stage}_edge_component_{index}",
                    "vertices": [[x + dx, y + dy] for x, y in path],
                    "closed": False,
                    "fill": False,
                }
            )
        anchors[f"stage_{stage}"] = [x_offset + (max(xs) - min(xs)) / 2, -0.35]
        x_offset += max(xs) - min(xs) + 1.4
    if len(paths) > 32:
        raise FigureRecipeError(
            f"stacked_cubes requires {len(paths)} paths (maximum 32)"
        )
    all_x = [
        x for path in paths for x, _ in cast("list[list[float]]", path["vertices"])
    ]
    all_y = [
        y for path in paths for _, y in cast("list[list[float]]", path["vertices"])
    ]
    return {
        "schema_version": RECIPE_VERSION,
        "view": [
            min(all_x) - 0.6,
            max(all_x) + 0.6,
            min(all_y) - 0.75,
            max(all_y) + 0.6,
        ],
        "axes": [],
        "equal_aspect": True,
        "points": anchors,
        "point_markers": {},
        "paths": paths,
        "visible_annotations": [],
    }
