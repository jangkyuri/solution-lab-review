import re
from pathlib import Path
from tempfile import TemporaryDirectory

from render import RenderRequest, render


def test_vector_exports_when_korean_labels_are_present() -> None:
    # Given one finite scene with a Korean title.
    graph = {
        "title": "함숫값과 높이",
        "xMin": -2,
        "xMax": 2,
        "yMin": -2,
        "yMax": 3,
        "xLabel": "x",
        "yLabel": "y",
        "curves": [
            {
                "label": "f(x)",
                "color": "blue",
                "dashed": False,
                "samples": [{"x": -1, "y": 1}, {"x": 0, "y": 0}, {"x": 1, "y": 1}],
            }
        ],
        "points": [{"x": 1, "y": 1, "label": "좌표", "open": True}],
        "verticals": [],
    }
    # When saved with each supported vector backend.
    test_root = Path(__file__).resolve().parents[1] / ".qa"
    test_root.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=test_root, prefix="render-") as folder:
        for format_name in ("pdf", "svg"):
            path = Path(folder) / f"graph.{format_name}"
            result = render(
                RenderRequest.model_validate(
                    {
                        "action": "render",
                        "graph": graph,
                        "outputPath": str(path),
                        "format": format_name,
                    }
                )
            )
            # Then the output is the requested real vector file.
            assert result.path == str(path)
            assert path.stat().st_size > 500
            content = path.read_bytes()
            assert (
                content.startswith(b"%PDF-")
                if format_name == "pdf"
                else b"<svg" in content
            )


def test_baeksin_graph_has_native_column_width_and_direct_labels(
    tmp_path: Path,
) -> None:
    # Given a small graph with a named curve and a marked point.
    path = tmp_path / "baeksin.svg"
    request = RenderRequest.model_validate(
        {
            "outputPath": path,
            "format": "svg",
            "style": "baeksin",
            "graph": {
                "title": "보조선",
                "xMin": -2,
                "xMax": 2,
                "yMin": -2,
                "yMax": 3,
                "xLabel": "x",
                "yLabel": "y",
                "curves": [
                    {
                        "label": "f(x)",
                        "color": "blue",
                        "samples": [{"x": -1, "y": 1}, {"x": 1, "y": 1}],
                    },
                ],
                "points": [{"x": 1, "y": 1, "label": "좌표", "open": True}],
            },
        },
    )

    # When rendered at its intended print width.
    _ = render(request)

    # Then it keeps the curve and point labels without a separate legend.
    svg = path.read_text(encoding="utf-8")
    assert 'width="190pt"' in svg
    assert "<!-- $f(x)$ -->" in svg
    assert "<!-- 좌표 -->" in svg
    assert 'id="legend_' not in svg
    assert "<!-- 1 -->" not in svg
    assert "<!-- 2 -->" not in svg


def test_baeksin_guides_stop_at_matching_point(tmp_path: Path) -> None:
    path = tmp_path / "point-guides.svg"
    request = RenderRequest.model_validate(
        {
            "outputPath": path,
            "format": "svg",
            "style": "baeksin",
            "graph": {
                "title": "Projection",
                "xMin": -2,
                "xMax": 2,
                "yMin": -2,
                "yMax": 3,
                "xLabel": "x",
                "yLabel": "y",
                "curves": [],
                "points": [{"x": 1, "y": 1, "label": "(1, 1)"}],
                "verticals": [{"x": 1, "label": "x = 1"}],
                "horizontals": [{"y": 1, "label": "y = 1"}],
            },
        },
    )

    _ = render(request)

    svg = path.read_text(encoding="utf-8")
    segment_pattern = (
        r'<path d="M ([\d.]+) ([\d.]+)\s+L ([\d.]+) ([\d.]+)\s*"\s*'
        r'clip-path="[^"]+"\s*style="[^"]*stroke-dasharray:'
    )
    segments = list(re.finditer(segment_pattern, svg))
    assert len(segments) == 2
    lengths = [
        max(
            abs(float(match[3]) - float(match[1])),
            abs(float(match[4]) - float(match[2])),
        )
        for match in segments
    ]
    assert all(10 < length < 60 for length in lengths)


def test_baeksin_print_width_and_highlight_with_no_origin(tmp_path: Path) -> None:
    path = tmp_path / "wide-zoom-source.svg"
    request = RenderRequest.model_validate(
        {
            "outputPath": path,
            "format": "svg",
            "style": "baeksin",
            "options": {
                "width": 500,
                "highlight": {"xMin": 1, "xMax": 2, "yMin": 3, "yMax": 4},
            },
            "graph": {
                "title": "k ≤ -49/3",
                "xMin": 0.5,
                "xMax": 2.5,
                "yMin": 2.5,
                "yMax": 4.5,
                "xLabel": "x",
                "yLabel": "y",
                "curves": [],
            },
        },
    )

    _ = render(request)

    svg = path.read_text(encoding="utf-8")
    assert 'width="500pt"' in svg
    assert "stroke: #3c5d72" in svg
    assert r"\frac{49}{3}" in svg
    assert "<!-- $x$ -->" not in svg
    assert "<!-- $y$ -->" not in svg


def test_baeksin_vertical_arrow_uses_supplied_endpoints(tmp_path: Path) -> None:
    # Given a vertical distance whose label has a nonzero text-box width.
    path = tmp_path / "vertical-distance.svg"
    request = RenderRequest.model_validate(
        {
            "outputPath": path,
            "format": "svg",
            "style": "baeksin",
            "graph": {
                "title": "세로 거리",
                "xMin": -1,
                "xMax": 1,
                "yMin": -6,
                "yMax": 1,
                "xLabel": "x",
                "yLabel": "y",
                "curves": [],
                "arrows": [
                    {"from": {"x": 0, "y": 0}, "to": {"x": 0, "y": -5}, "label": "5"},
                ],
            },
        },
    )

    # When the labeled distance is rendered.
    _ = render(request)

    # Then the brown arrow body stays vertical despite its detached label.
    svg = path.read_text(encoding="utf-8")
    path_match = re.search(
        r'<path d="([^"]+)"[^>]*style="[^"]*stroke: #ad7645',
        svg,
    )
    assert path_match is not None
    coordinates = [
        float(match[0]) for match in re.finditer(r"-?\d+(?:\.\d+)?", path_match[1])
    ]
    x_values = coordinates[0::2]
    assert len(x_values) >= 3
    assert max(x_values) - min(x_values) < 0.00001
    assert "<!-- $5$ -->" in svg
