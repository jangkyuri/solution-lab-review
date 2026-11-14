from collections.abc import Mapping
from contextlib import AbstractContextManager

def rc_context(rc: Mapping[str, str | int | bool]) -> AbstractContextManager[None]: ...
