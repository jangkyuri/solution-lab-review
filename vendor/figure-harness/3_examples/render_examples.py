"""Render every recipes/*.json to PNG with a vendored renderer; exit 1 on any failure.
usage: python -I render_examples.py --pkg variant|solution --src <dir that contains the package> --out <dir>
Prints the module file actually loaded so a shadowing install is visible."""
import argparse, json, sys
from pathlib import Path
ap = argparse.ArgumentParser(); ap.add_argument("--pkg", choices=("variant", "solution"), default="variant")
ap.add_argument("--src", required=True); ap.add_argument("--out", required=True)
a = ap.parse_args(); sys.path.insert(0, a.src)
if a.pkg == "variant":
    from variant_exam_renderer.figure_recipe_parsing import parse_figure_recipe
    from variant_exam_renderer.render.recipe_drawing import draw_figure_recipe
    import variant_exam_renderer.render.recipe_drawing as loaded
else:
    from exam_solution.figure_recipe_parsing import parse_figure_recipe
    from exam_solution.recipe_drawing import draw_figure_recipe
    import exam_solution.recipe_drawing as loaded
print("loaded:", loaded.__file__)
out = Path(a.out); out.mkdir(parents=True, exist_ok=True); bad = 0
for p in sorted((Path(__file__).parent / "recipes").glob("*.json")):
    try:
        d = draw_figure_recipe(parse_figure_recipe(json.loads(p.read_text(encoding="utf-8"))))
        (out / (p.stem + ".png")).write_bytes(d.png)
        print("OK  ", p.stem, len(d.png), "labels:", list(d.labels))
    except Exception as e:  # keep going so every example is checked
        bad += 1; print("FAIL", p.stem, type(e).__name__, e)
sys.exit(1 if bad else 0)
