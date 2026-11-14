"""Render validated finite scene data, never executable mathematical strings."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Final

from graph_scene import (
    INVALID_EXTENSION,
    MIN_CURVE_POINTS,
    RenderError,
    RenderRequest,
    RenderResult,
)

if TYPE_CHECKING:
    from matplotlib.axes import Axes

    from graph_scene import Graph

__all__ = ["RenderError", "RenderRequest", "render"]

COLORS: Final = {"blue": "#3C5D72", "brown": "#AD7645", "gray": "#79848B"}


def _draw_curves(axes: Axes, graph: Graph, compact: bool) -> None:
    """Draw each already separated segment without joining discontinuities."""
    from matplotlib.patches import Polygon

    for shade in graph.shades:
        patch = Polygon(
            [(point.x, point.y) for point in shade.polygon],
            facecolor=COLORS[shade.color],
            alpha=0.12,
            label=shade.label,
        )
        _ = axes.add_patch(patch)
    for curve in graph.curves:
        segments = curve.segments or (curve.samples,)
        for index, segment in enumerate(segments):
            if len(segment) >= MIN_CURVE_POINTS:
                _ = axes.plot(
                    [point.x for point in segment],
                    [point.y for point in segment],
                    color=COLORS[curve.color],
                    linestyle="--" if curve.dashed else "-",
                    linewidth=1.2 if compact else 1.8,
                    label=curve.label if index == 0 else None,
                )


def _draw_guides(axes: Axes, graph: Graph) -> None:
    """Draw full bounds in the standard graph format."""
    for guide in graph.verticals:
        _ = axes.axvline(guide.x, color=COLORS["gray"], linewidth=0.8, linestyle="--")
        _ = axes.annotate(
            guide.label,
            (guide.x, graph.y_min),
            xytext=(3, 5),
            textcoords="offset points",
            fontsize=8,
            color=COLORS["gray"],
        )
    for guide in graph.horizontals:
        _ = axes.axhline(guide.y, color=COLORS["gray"], linewidth=0.8, linestyle="--")
        _ = axes.annotate(
            guide.label,
            (graph.x_min, guide.y),
            xytext=(4, 4),
            textcoords="offset points",
            fontsize=8,
            color=COLORS["gray"],
        )


def _draw_standard_axes(axes: Axes, graph: Graph, title: str) -> None:
    """Draw the unchanged boxed axes of the standard graph."""
    _ = axes.set(xlabel=graph.x_label, ylabel=graph.y_label, title=title)
    axes.grid(visible=True, color="#E1E6EA", linewidth=0.55)
    _ = axes.axhline(0, color=COLORS["gray"], linewidth=0.7)
    _ = axes.axvline(0, color=COLORS["gray"], linewidth=0.7)


def _plain_label(label: str) -> tuple[str, bool]:
    return label, False


def _draw_annotations(axes: Axes, graph: Graph, compact: bool) -> None:
    """Draw supplied points and relation arrows."""
    format_label = _plain_label
    if compact:
        from baeksin_math import print_label

        format_label = print_label
    point_size = 8 if compact else 9
    for point in graph.points:
        _ = axes.scatter(
            [point.x],
            [point.y],
            s=20 if compact else 32,
            zorder=4,
            facecolors="white" if point.open else COLORS["blue"],
            edgecolors=COLORS["blue"],
            linewidths=1.1,
        )
        label, is_math = format_label(point.label)
        _ = axes.annotate(
            label,
            (point.x, point.y), parse_math=is_math, xytext=(3, 4) if compact else (5, 6),
            textcoords="offset points", fontsize=point_size,
        )
    for arrow in graph.arrows:
        label, is_math = format_label(arrow.label)
        if compact:
            _ = axes.annotate(
                "", xy=(arrow.to.x, arrow.to.y),
                xytext=(arrow.from_.x, arrow.from_.y),
                arrowprops={
                    "arrowstyle": "->", "color": COLORS["brown"], "lw": 1.0,
                    "shrinkA": 0, "shrinkB": 0,
                },
            )
            horizontal = abs(arrow.to.x - arrow.from_.x) / (graph.x_max - graph.x_min) >= (
                abs(arrow.to.y - arrow.from_.y) / (graph.y_max - graph.y_min)
            )
            _ = axes.annotate(
                label, parse_math=is_math,
                xy=((arrow.from_.x + arrow.to.x) / 2, (arrow.from_.y + arrow.to.y) / 2),
                xytext=(0, 4) if horizontal else (4, 0),
                textcoords="offset points", fontsize=point_size,
                ha="center" if horizontal else "left",
                va="bottom" if horizontal else "center",
                bbox={"facecolor": "white", "edgecolor": "none", "pad": 0.3},
            )
        else:
            _ = axes.annotate(
                label,
                parse_math=is_math,
                xy=(arrow.to.x, arrow.to.y),
                xytext=(arrow.from_.x, arrow.from_.y),
                fontsize=point_size,
                arrowprops={"arrowstyle": "->", "color": COLORS["brown"], "lw": 1.0},
            )


def render(request: RenderRequest) -> RenderResult:
    """Export a PDF or SVG with embedded Korean font glyphs."""
    cache = Path(__file__).resolve().parent / ".mpl-cache"
    cache.mkdir(exist_ok=True)
    _ = os.environ.setdefault("MPLCONFIGDIR", str(cache))
    from matplotlib import font_manager, rc_context
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    if request.output_path.suffix.lower() != f".{request.format}":
        raise RenderError(INVALID_EXTENSION)
    korean_font = Path("C:/Windows/Fonts/malgun.ttf")
    family = "DejaVu Sans"
    if korean_font.is_file():
        font_manager.fontManager.addfont(str(korean_font))
        family = font_manager.FontProperties(fname=str(korean_font)).get_name()
    settings = {
        "font.family": family,
        "pdf.fonttype": 42,
        "svg.fonttype": "path",
        "axes.unicode_minus": False,
        "text.parse_math": False,
    }
    compact = request.style == "baeksin"
    if compact:
        settings["axes.titlesize"] = "8"
        settings["mathtext.fontset"] = "stix"
        settings["text.usetex"] = False
    with rc_context(settings):
        width = request.options.width
        height = min(width * 0.72, 95 + width * 0.22, 184)
        figure_size = (width / 72, height / 72) if compact else (7.2, 4.6)
        figure = Figure(figsize=figure_size, layout="constrained")
        _ = FigureCanvasAgg(figure)
        axes = figure.subplots()
        graph = request.graph
        _ = axes.set(
            xlim=(graph.x_min, graph.x_max),
            ylim=(graph.y_min, graph.y_max),
        )
        title = graph.title + (" · 정성 개형" if graph.qualitative else "")
        if compact:
            from baeksin_graph import draw_baeksin
            from baeksin_math import print_label

            label, is_math = print_label(title)
            _ = axes.set_title(label, parse_math=is_math)
            draw_baeksin(axes, graph, COLORS, request.options.highlight)
        else:
            _draw_standard_axes(axes, graph, title)
        _draw_curves(axes, graph, compact)
        if not compact:
            _draw_guides(axes, graph)
        _draw_annotations(axes, graph, compact)
        if not compact:
            handles, labels = axes.get_legend_handles_labels()
            if labels:
                _ = axes.legend(handles, labels, frameon=False, fontsize=8, loc="best")
        request.output_path.parent.mkdir(parents=True, exist_ok=True)
        figure.savefig(
            request.output_path, format=request.format, bbox_inches=None if compact else "tight",
        )
        figure.clear()
    return RenderResult(path=str(request.output_path))
