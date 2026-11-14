# 그래프 생성 하네스

2026-11-13 Drive 공유본의 변형 렌더러 `src/variant_exam_renderer/`를 사용합니다. [원본 파일 목록과 SHA-256](SHA256SUMS.txt)에 파서, 렌더러, 규칙, 예제를 기록했습니다.

## 인수 시험

`solution-lab`에서 실행합니다.

```powershell
.\python\.venv\Scripts\python.exe -I -X utf8 .\vendor\figure-harness\3_examples\render_examples.py --pkg variant --src .\vendor\figure-harness\src --out <임시폴더>
```

2026-11-13에 Python 3.14.6, Matplotlib 3.11.2, Pillow 13.0.0과 이 PC의 한컴 글꼴로 실행했습니다. 종료 코드는 0이었고, PNG 5개의 SHA-256이 각각 기준 파일과 같았습니다.

```text
loaded: vendor\figure-harness\src\variant_exam_renderer\render\recipe_drawing.py
OK   ex1_quadratic_fill 30362 labels: ['$O$', '$A$', '$y=x(4-x)$', '$x$', '$y$']
OK   ex2_line_intercepts 26242 labels: ['$O$', '$A$', '$B$', '$y=-2x+4$', '$x$', '$y$']
OK   ex3_isosceles_angle 18583 labels: ['$40^\\circ$', '$A$', '$B$', '$C$', '$D$']
OK   ex4_free_curve_label_T4 30860 labels: ['$O$', '$A$', '$v_P(t)=t^{2}-4t$', '$x$', '$y$']
OK   ex5_template_quadratic_line_enclosed_region 22497 labels: ['$O$', '$x$', '$y$', '$y=x^2-1$', '$y=x+1$']
```

ex1에서 포물선과 x축 사이에 회색 음영이 들어가고, 점과 식의 라벨이 선을 가리지 않는 것을 확인했습니다.

## 풀이 연구실에 적용한 작성 기준

- [04_figure_recipes.md](1_chatgpt_sources/04_figure_recipes.md)
- [06_figure_final.json](1_chatgpt_sources/06_figure_final.json)
- [07_visual_reasoning.md](1_chatgpt_sources/07_visual_reasoning.md)

원문 파일은 이 폴더에 보존합니다. 풀이 연구실의 [생성 지침](../../server/generation-prompts.ts)은 이 규칙을 앱의 단계별 해설에 적용합니다. [템플릿 계약](1_chatgpt_sources/variant-figure-template-contract.md)과 [템플릿 목록](1_chatgpt_sources/variant-figure-templates-catalog.json)은 템플릿 예제의 참고 자료입니다.

풀이 연구실 생성 지침

> 그림은 코드 실행 없이 `figure_recipe_v1` 데이터로만 작성한다. 레시피의 검증과 PNG 생성은 로컬 렌더러에서 수행한다.

[로컬 실행 방법](../../python/README.md#외부-프로젝트의-그래프-레시피)
