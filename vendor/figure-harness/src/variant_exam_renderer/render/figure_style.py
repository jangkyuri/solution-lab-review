"""Physical figure styling calibrated from official Korean exam artwork.

Values are print points, before the shrink-only PDF placement cap. Evidence and
the distinction between native A3 and A4 sources live in docs/figure-style-contract.md.
This profile applies to generated figures, not the document's body typography.
"""

from typing import Final

INK_COLOR: Final = "#000000"
FILL_COLOR: Final = "#DFDFDF"
LABEL_FONT_PT: Final = 8.0
MAIN_LINE_PT: Final = 0.5
CURVE_LINE_PT: Final = 0.56
AUX_LINE_PT: Final = 0.28
AXIS_LINE_PT: Final = 0.28
ARROW_HEAD_PT: Final = 3.3
ARROW_HALF_WIDTH_RATIO: Final = 1.0 / 3.3
ARROW_NOTCH_FRACTION: Final = 0.7
