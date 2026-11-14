from collections.abc import Sequence

from matplotlib.artist import Artist

class Polygon(Artist):
    def __init__(
        self, xy: Sequence[tuple[float, float]], *, facecolor: str, alpha: float, label: str
    ) -> None: ...
