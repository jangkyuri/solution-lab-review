# 계산·그래프 실행 환경

이 폴더의 `uv.lock`으로 고정한 SymPy·Pydantic·Matplotlib 환경을 사용합니다.

```powershell
uv sync --frozen
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\basedpyright.exe
```

앱의 기본 실행 파일은 이 폴더의 `.venv/Scripts/python.exe`입니다. 다른 운영체제는 `.venv/bin/python`을 사용합니다. 필요할 때 `SOLUTION_LAB_PYTHON`으로 실행 파일을 지정할 수 있습니다.

`main.py`는 표준 입력 JSON 한 개를 읽고 JSON 한 개를 반환합니다. `check`, `sample`, `render` 작업만 허용합니다. 사용자 식을 Python 코드로 실행하거나 문자열 `sympify`에 넘기지 않습니다. 명시적인 `2*x`, `x^2`, `sqrt(x)`, `sin(x)` 형태를 지원합니다.

검산은 실수 정의역을 기준으로 합니다. 계산 완료와 동치 확인을 구분하며, 정의역 차이·판정 불가능한 식은 미확정으로 남깁니다. 그래프는 불연속점마다 분리한 구간으로 전달합니다. 정성 개형은 정밀 함수로 복원하지 않습니다.

Matplotlib 글꼴 캐시는 이 폴더의 `.mpl-cache`에 보관합니다. 첫 출력은 글꼴 준비 때문에 더 오래 걸릴 수 있습니다. 한국어는 Windows의 맑은 고딕을 사용하고 PDF에는 글꼴을 포함하며 SVG 글자는 경로로 저장합니다. 그래프 출력은 이미 검증한 유한 좌표만 사용합니다.

`typings/`에는 사용하는 외부 API에 한정한 타입 선언을 둡니다. 라이브러리 전체를 재정의하거나 런타임 동작을 바꾸지 않습니다.

## 외부 프로젝트의 그래프 레시피

ChatGPT에서 받은 `figure_recipe_v1` JSON을 로컬 PNG로 변환합니다. 한컴 수식 글꼴 `HYHWPEQ.TTF`를 사용합니다. 설치 위치가 다르면 `VARIANT_EXAM_HWP_FONT`에 해당 파일 경로를 지정할 수 있습니다.

```powershell
.\.venv\Scripts\python.exe -I render_figure_recipe.py .\recipe.json .\figure.png
```

입력은 레시피 객체 하나입니다. 해설 전체 JSON을 받은 경우에는 해당 그림의 `assets[].construction` 객체를 별도 JSON으로 저장합니다. 실행 결과에는 PNG 경로, 바이트 수, 라벨 목록과 입력·출력의 SHA-256이 포함됩니다.

[이식본 및 인수 시험](../vendor/figure-harness/README.md)
