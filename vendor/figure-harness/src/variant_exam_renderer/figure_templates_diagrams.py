"""Bounded mapping and fixed-projection cuboid-cut templates.

The builders produce geometry only. Callers supply visible annotations through the
template envelope; even node values and volume names are never inferred here.
"""

from __future__ import annotations

import math
from typing import cast

from variant_exam_renderer.figure_recipe import RECIPE_VERSION, FigureRecipeError

type Coordinate = tuple[float, float]
type Vertex3D = tuple[float, float, float]
type Stroke = dict[str, object]


def _parameters(value: object, allowed: set[str]) -> dict[str, object]:
    if not isinstance(value, dict):
        msg = "template parameters must be an object"
        raise FigureRecipeError(msg)
    data = cast("dict[str, object]", value)
    if data.keys() - allowed:
        raise FigureRecipeError(f"unknown template parameters: {data.keys() - allowed}")
    return data


def _number(data: dict[str, object], name: str, low: float, high: float) -> float:
    value = data.get(name)
    if (
        isinstance(value, bool)
        or not isinstance(value, (float, int))
        or not low <= value <= high
        or not math.isfinite(value)
    ):
        raise FigureRecipeError(f"{name} must be a finite number in [{low}, {high}]")
    return float(value)


def _count(data: dict[str, object], name: str) -> int:
    value = data.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 6:
        raise FigureRecipeError(f"{name} must be an integer in [1, 6]")
    return value


def _stroke(
    name: str,
    start: str,
    end: str,
    *,
    hidden: bool = False,
    arrow: bool = False,
) -> Stroke:
    return {
        "id": name,
        "from": start,
        "to": end,
        "line_style": "dashed" if hidden else "solid",
        "arrow": "end" if arrow else "none",
    }


def _recipe(points: dict[str, Coordinate], strokes: list[Stroke]) -> dict[str, object]:
    xs, ys = [p[0] for p in points.values()], [p[1] for p in points.values()]
    return {
        "schema_version": RECIPE_VERSION,
        "view": [min(xs) - 0.8, max(xs) + 0.8, min(ys) - 0.8, max(ys) + 0.8],
        "axes": [],
        "equal_aspect": True,
        "points": {name: list(point) for name, point in points.items()},
        "point_markers": {},
        "strokes": strokes,
        "visible_annotations": [],
    }


def build_mapping_diagram(parameters: object) -> dict[str, object]:
    """Construct a total function on 1..6 nodes per set, without node labels.

    Required domain_count, codomain_count and mapping use one-based target indices;
    mapping has exactly domain_count entries. Many-to-one mappings are supported.
    Optional show_function_arrow defaults to true. Stable annotation anchors are
    domain_1..N, codomain_1..N, domain_title, codomain_title and function_title.
    """
    data = _parameters(
        parameters,
        {"domain_count", "codomain_count", "mapping", "show_function_arrow"},
    )
    domain_count = _count(data, "domain_count")
    codomain_count = _count(data, "codomain_count")
    raw_mapping = data.get("mapping")
    if not isinstance(raw_mapping, list):
        msg = "mapping must be an array"
        raise FigureRecipeError(msg)
    mapping = cast("list[object]", raw_mapping)
    if len(mapping) != domain_count:
        msg = "mapping must contain exactly one target per domain node"
        raise FigureRecipeError(msg)
    targets: list[int] = []
    for target in mapping:
        if (
            isinstance(target, bool)
            or not isinstance(target, int)
            or not 1 <= target <= codomain_count
        ):
            msg = "mapping targets must be one-based codomain indices"
            raise FigureRecipeError(msg)
        targets.append(target)
    show_arrow = data.get("show_function_arrow", True)
    if not isinstance(show_arrow, bool):
        msg = "show_function_arrow must be a boolean"
        raise FigureRecipeError(msg)

    half_height = max(1.1, (max(domain_count, codomain_count) - 1) * 0.48 + 0.7)
    points: dict[str, Coordinate] = {}
    for side, count, x in (
        ("domain", domain_count, -2.0),
        ("codomain", codomain_count, 2.0),
    ):
        for index in range(1, count + 1):
            y = ((count + 1) / 2 - index) * 0.96
            # Keep the W/E annotation gap inside the oval rather than placing
            # the number against its outer flank; arrows use separate anchors.
            label_offset = 0.45 if side == "domain" else -0.45
            points[f"{side}_{index}"] = (x + label_offset, y)
            offset = 0.55 if side == "domain" else -0.55
            points[f"{side}_arrow_{index}"] = (x + offset, y)
        points[f"{side}_title"] = (x, half_height + 0.05)
    points["function_start"] = (-1.45, half_height + 0.16)
    points["function_end"] = (1.45, half_height + 0.16)
    points["function_title"] = (0, half_height + 0.19)
    strokes = [
        _stroke(
            f"mapping_{index}",
            f"domain_arrow_{index}",
            f"codomain_arrow_{target}",
            arrow=True,
        )
        for index, target in enumerate(targets, 1)
    ]
    if show_arrow:
        strokes.append(
            _stroke("function_arrow", "function_start", "function_end", arrow=True)
        )
    recipe = _recipe(points, strokes)
    recipe["view"] = [-3.55, 3.55, -half_height - 0.4, half_height + 0.9]
    recipe["ellipses"] = [
        {
            "id": f"{side}_boundary",
            "center": [x, 0],
            "radii": [1.0, half_height],
            "fill": False,
            "line_style": "solid",
        }
        for side, x in (("domain", -2.0), ("codomain", 2.0))
    ]
    return recipe


def build_mapping_chain(parameters: object) -> dict[str, object]:
    """Construct two total mappings across three finite sets X -> Y -> Z.

    Required x_count, y_count, z_count are each 1..6. mapping_xy has exactly
    x_count one-based Y indices; mapping_yz has exactly y_count one-based Z
    indices. Repeated targets and unused nodes are valid. The optional pair of
    top function arrows is shown by default. Node dots, ovals, and arrows are
    geometry; their names, values, and function labels belong exclusively to
    caller-supplied visible_annotations.

    Stable label targets: x_1..x_N, y_1..y_N, z_1..z_N, x_title,
    y_title, z_title, f_title, g_title. The geometric mapping strokes are
    mapping_xy_1.. and mapping_yz_1.., with optional f_arrow/g_arrow strokes.
    """
    data = _parameters(
        parameters,
        {
            "x_count",
            "y_count",
            "z_count",
            "mapping_xy",
            "mapping_yz",
            "show_function_arrows",
        },
    )
    counts = {side: _count(data, f"{side}_count") for side in ("x", "y", "z")}
    mappings: dict[str, list[int]] = {}
    for key, source, target in (
        ("mapping_xy", "x", "y"),
        ("mapping_yz", "y", "z"),
    ):
        raw = data.get(key)
        if not isinstance(raw, list):
            raise FigureRecipeError(f"{key} must be an array")
        values = cast("list[object]", raw)
        if len(values) != counts[source]:
            raise FigureRecipeError(
                f"{key} must contain exactly one target per {source} node"
            )
        mapping: list[int] = []
        for value in values:
            if (
                isinstance(value, bool)
                or not isinstance(value, int)
                or not 1 <= value <= counts[target]
            ):
                raise FigureRecipeError(
                    f"{key} targets must be one-based {target} indices"
                )
            mapping.append(value)
        mappings[key] = mapping
    show_arrows = data.get("show_function_arrows", True)
    if not isinstance(show_arrows, bool):
        msg = "show_function_arrows must be a boolean"
        raise FigureRecipeError(msg)

    half_height = max(1.1, (max(counts.values()) - 1) * 0.48 + 0.7)
    centers = {"x": -3.1, "y": 0.0, "z": 3.1}
    points: dict[str, Coordinate] = {}
    markers: dict[str, str] = {}
    for side, count in counts.items():
        x = centers[side]
        for index in range(1, count + 1):
            y = ((count + 1) / 2 - index) * 0.96
            node = f"{side}_{index}"
            points[node] = (x - 0.31, y)
            markers[node] = "filled"
            # Arrowheads and shafts do not double as number-label anchors.
            if side != "z":
                points[f"{side}_arrow_out_{index}"] = (x + 0.55, y)
            if side != "x":
                points[f"{side}_arrow_in_{index}"] = (x - 0.55, y)
        points[f"{side}_title"] = (x, half_height + 0.15)

    strokes: list[Stroke] = [
        _stroke(
            f"mapping_xy_{index}",
            f"x_arrow_out_{index}",
            f"y_arrow_in_{target}",
            arrow=True,
        )
        for index, target in enumerate(mappings["mapping_xy"], 1)
    ]
    strokes.extend(
        _stroke(
            f"mapping_yz_{index}",
            f"y_arrow_out_{index}",
            f"z_arrow_in_{target}",
            arrow=True,
        )
        for index, target in enumerate(mappings["mapping_yz"], 1)
    )
    for name, start, end in (
        ("f", -2.25, -0.85),
        ("g", 0.85, 2.25),
    ):
        points[f"{name}_start"] = (start, half_height + 0.26)
        points[f"{name}_end"] = (end, half_height + 0.26)
        points[f"{name}_title"] = ((start + end) / 2, half_height + 0.39)
        if show_arrows:
            strokes.append(
                _stroke(f"{name}_arrow", f"{name}_start", f"{name}_end", arrow=True)
            )

    recipe = _recipe(points, strokes)
    recipe["view"] = [-4.15, 4.15, -half_height - 0.38, half_height + 0.88]
    recipe["point_markers"] = markers
    recipe["ellipses"] = [
        {
            "id": f"{side}_boundary",
            "center": [centers[side], 0],
            "radii": [0.79, half_height],
            "fill": False,
            "line_style": "solid",
        }
        for side in ("x", "y", "z")
    ]
    return recipe


def _project(vertex: Vertex3D) -> Coordinate:
    x, y, z = vertex
    return math.sqrt(3) * (x + y) / 2, z + (y - x) / 2


def _part(
    prefix: str,
    vertices: dict[str, Vertex3D],
    names: str,
    solid: tuple[str, ...],
    hidden: tuple[str, ...],
) -> tuple[dict[str, Coordinate], list[Stroke]]:
    points = {f"{prefix}_{name}": _project(vertices[name]) for name in names}
    strokes = [
        _stroke(
            f"{prefix}_edge_{edge}",
            f"{prefix}_{edge[0]}",
            f"{prefix}_{edge[1]}",
            hidden=concealed,
        )
        for edges, concealed in ((solid, False), (hidden, True))
        for edge in edges
    ]
    return points, strokes


def _place(
    points: dict[str, Coordinate], *, left: float, top: float
) -> dict[str, Coordinate]:
    x0 = min(p[0] for p in points.values())
    y1 = max(p[1] for p in points.values())
    return {name: (x - x0 + left, y - y1 + top) for name, (x, y) in points.items()}


def build_prism_section(parameters: object) -> dict[str, object]:
    """Cut a cuboid along P-Q-G-F in a fixed genuine isometric projection.

    Required width [1,12], depth/height [0.5,6], cut_fraction [0.1,0.9].
    ABCD are the upper vertices, EFGH their lower counterparts; P,Q lie on
    AB,DC at the same x=width*cut_fraction. Optional mode is cut (default),
    separated or both. This is not an arbitrary plane/polyhedron solver.
    """
    data = _parameters(parameters, {"width", "depth", "height", "cut_fraction", "mode"})
    width = _number(data, "width", 1, 12)
    depth = _number(data, "depth", 0.5, 6)
    height = _number(data, "height", 0.5, 6)
    fraction = _number(data, "cut_fraction", 0.1, 0.9)
    mode = data.get("mode", "cut")
    if not isinstance(mode, str) or mode not in {"cut", "separated", "both"}:
        msg = "mode must be cut, separated or both"
        raise FigureRecipeError(msg)
    vertices: dict[str, Vertex3D] = {
        "A": (0, 0, height),
        "B": (width, 0, height),
        "C": (width, depth, height),
        "D": (0, depth, height),
        "E": (0, 0, 0),
        "F": (width, 0, 0),
        "G": (width, depth, 0),
        "H": (0, depth, 0),
        "P": (fraction * width, 0, height),
        "Q": (fraction * width, depth, height),
    }
    points: dict[str, Coordinate] = {}
    strokes: list[Stroke] = []
    if mode in {"cut", "both"}:
        main_points, main_strokes = _part(
            "main",
            vertices,
            "ABCDEFGHPQ",
            ("AB", "BC", "CD", "DA", "AE", "BF", "CG", "EF", "FG", "PQ", "PF"),
            ("EH", "DH", "HG", "QG"),
        )
        points.update(main_points)
        strokes.extend(main_strokes)
    if mode in {"separated", "both"}:
        left_points, left_strokes = _part(
            "left",
            vertices,
            "ADEFGHPQ",
            ("AP", "PF", "FE", "EA", "AD", "DQ", "QP", "FG", "GQ"),
            ("EH", "DH", "HG"),
        )
        right_points, right_strokes = _part(
            "right",
            vertices,
            "BCFGPQ",
            ("PB", "BF", "FP", "QC", "CG", "PQ", "BC", "FG"),
            ("QG",),
        )
        left_width = max(p[0] for p in left_points.values()) - min(
            p[0] for p in left_points.values()
        )
        top = min(p[1] for p in points.values()) - 2 if points else 0
        left_points = _place(left_points, left=0, top=top)
        right_points = _place(right_points, left=left_width + 1.8, top=top)
        for side, part_points in (("left", left_points), ("right", right_points)):
            min_x, max_x = (
                min(p[0] for p in part_points.values()),
                max(p[0] for p in part_points.values()),
            )
            part_points[f"{side}_volume"] = (
                (min_x + max_x) / 2,
                min(p[1] for p in part_points.values()) - 0.45,
            )
        points.update(left_points)
        points.update(right_points)
        strokes.extend(left_strokes)
        strokes.extend(right_strokes)
        if mode == "both":
            # Center the original above the complete pair; the process arrow is
            # geometric, while all vertex and volume annotations remain caller-owned.
            total_width = max(p[0] for p in right_points.values())
            main_names = [name for name in points if name.startswith("main_")]
            main_width = max(points[name][0] for name in main_names)
            for name in main_names:
                x, y = points[name]
                points[name] = (x + (total_width - main_width) / 2, y)
            points["separation_start"] = (total_width / 2, top + 1.45)
            points["separation_end"] = (total_width / 2, top + 0.5)
            strokes.append(
                _stroke(
                    "separation_arrow", "separation_start", "separation_end", arrow=True
                )
            )
    return _recipe(points, strokes)
