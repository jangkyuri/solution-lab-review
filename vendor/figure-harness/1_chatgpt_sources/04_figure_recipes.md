# 해설 도형·그래프 레시피

새 해설 그림은 ChatGPT가 데이터로 작성하고 로컬 Python이 그린다.
`figure_recipe_v1`의 수치 작도·표시 정보만 넘기며 ChatGPT Images, imagegen,
PNG 생성·편집, 그림별 실행 코드, 픽셀 QA를 사용하지 않는다. 좌표를 계산하기 위한
코드 실행 도구·파일 저장 없이 결과를 아래 데이터로 작성한다(02 §2). 기존 PNG는 동결 입력에 실제로 있을 때만 path/sha256 참조로 유지한다.

## 해설 인계에 넣기

```json
{
  "asset_id": "fig_q001",
  "source_pages": [1],
  "description": "두 절편 사이 영역과 이차함수의 관계를 설명하는 해설 그림",
  "construction": {
    "schema_version": "figure_recipe_v1",
    "view": [-0.75, 5, -1.5, 5],
    "axes": ["x", "y"],
    "label_placement": "anchored",
    "points": {"O": [0, 0], "A": [4, 0]},
    "point_markers": {},
    "curves": [{
      "id": "curve_01", "coefficients": [0, 4, -1],
      "plot_domain": [-0.25, 4.25], "fill_domain": [0, 4]
    }],
    "visible_annotations": [
      {"id": "label_O", "text": "$O$", "target": "O", "preferred_direction": "SW"},
      {"id": "label_A", "text": "$A$", "target": "A", "preferred_direction": "NE"},
      {"id": "formula", "text": "$y=x(4-x)$", "target": "curve_01", "preferred_direction": "NE"},
      {"id": "axis_x_label", "text": "$x$", "target": "axis_x", "preferred_direction": "E"},
      {"id": "axis_y_label", "text": "$y$", "target": "axis_y", "preferred_direction": "N"}
    ]
  }
}
```

이 객체를 `exam_solution.json.assets[]`에 넣고 해당 문항의 steps에서
`{"type":"figure","asset_id":"fig_q001","caption":"이차함수 그래프"}`로 참조한다.
caption은 필수이며 비어 있지 않은 짧은 수학 설명을 쓴다. description은 내부 의미·출처이며
학생용 캡션으로 자동 복사하지 않는다. 새 asset에는 **path와 sha256이 없다**.
생성하지 않은 PNG의 경로·해시를 꾸미지 않으며 recipe-only 출력에는
`exam_solution.json` 하나만 있어도 된다. 실제 원본 PDF는 별도 입력이다.

## 레시피 필드 상세

raw 레시피의 필수 필드는 schema_version, view, visible_annotations이다. 나머지 미사용
필드는 생략할 수 있다. 새 raw 레시피에는 `point_markers`를 명시하고 점·축 라벨에는
`label_placement:"anchored"`를 우선한다. 과거 raw의 생략 필드는 기존 방식으로 읽는다.
임의 키·코드·파일 경로·URL·도구 지시는 허용하지 않는다.

| 필드 | 형식 |
|---|---|
| schema_version | 정확히 `figure_recipe_v1` |
| view | `[xmin,xmax,ymin,ymax]`, 두 범위 모두 증가 |
| axes | 필요한 축만 `[]`, `["x"]`, `["y"]`, `["x","y"]` |
| equal_aspect | 참/거짓. 축이 없으면 기본 true. 기하·원·각·대칭의 단위비 보존 |
| label_placement | `legacy` 또는 `anchored`. 생략한 기존 입력은 legacy. anchored는 점·축 라벨을 가까운 후보에, 각도 수치를 자기 각의 안쪽과 호 근처에 배치 |
| points | 내부 점 이름과 수치 좌표 객체, 예 `{"A":[0,2]}` |
| point_markers | 점별 `none`/`open`/`filled`. `{}`는 모든 점을 숨김. 좌표만으로 점을 자동 표시하지 않음 |
| curves | `{id, coefficients, plot_domain, fill_domain?}` 배열. 계수는 상수항부터 |
| curves의 식 대안 | coefficients 대신 `expression`. 둘을 함께 쓰지 않음 |
| segments | `[["A","B"],...]`의 실제 선분·보조선 |
| strokes | `{id,from,to,line_style?,arrow?}` 배열. 선종류 `solid`/`dashed`/`dotted`, 화살표 `none`/`end`/`both` |
| equal_marks | 같은 길이를 표시할 선분들의 점 이름 쌍 |
| tick_marks | `{from,to,count}` 배열. count는 1·2·3줄. 같은 길이 관계가 주어졌거나 풀이로 확정된 경우에만 표시 |
| right_angles | `{vertex:"D",ray1:"C",ray2:"A"}` 배열 |
| angle_marks | `{id:"angle_A",vertex:"A",ray1:"B",ray2:"C",sweep:"minor"}` 배열. sweep은 생략 시 minor, 필요하면 ccw/cw. 수치는 별도 label |
| paths | `{id,vertices:[[x,y],...],closed?,fill?,line_style?,arrow?,stroke?}` 배열. 채우려면 closed=true. arrow는 none/end/both, stroke 생략 시 true |
| ellipses | `{id,center:[x,y],radii:[rx,ry],rotation_degrees?,fill?}` 배열. 반지름은 양수 |
| ellipse_arcs | `{id,center:[x,y],radii:[rx,ry],rotation_degrees,start_degrees,end_degrees,line_style}` 배열. 앞·뒤 둘레를 나눌 때 사용하며 일곱 필드 모두 필수 |
| visible_annotations | `{id,text,target,preferred_direction?}` 배열. 방향은 N/NE/E/SE/S/SW/W/NW |

curve/path/ellipse에도 선택적인 `line_style`을 쓸 수 있다. 같은 선분을 `segments`와
`strokes`에 중복하지 않는다. 새로운 선종류·끝점·눈금은 표시 정보이므로 수학적 의미에
맞게 정한다. 템플릿이나 내부 좌표가 자동으로 라벨·정답을 공개하지 않는다.

경로의 화살촉은 열린 경로 끝/양끝의 접선 방향으로, 닫힌 경로는 첫 꼭짓점으로 돌아오는 접선 방향으로 그린다. 채운 경로에는 화살촉을 쓰지 않고 닫힌 경로의 both도 쓰지 않는다. `stroke:false`는 fill=true, closed=true인 면에만 허용하며 외곽선은 별도 선·원호로 지정한다. ellipse_arcs는 양의 반지름과 증가하는 각도, 최대 한 바퀴를 요구한다. 각도는 회전 전 타원의 오른쪽 끝을 0도로 삼아 반시계 방향으로 증가한다.

`target`은 실제 점·curve·path·ellipse·ellipse_arc·stroke·angle ID 또는 표시하는 축의
`axis_x`/`axis_y`다. 종류 간 같은 ID를 중복 사용하지 않는다. 각 라벨 ID도 유일하다.
점 최대 200, 곡선/path/ellipse 각 32, ellipse_arcs 64, 다항 계수 13, path 꼭짓점 2048,
라벨 80개다. 숫자는 유한 수치이며 절댓값 1000000 이하이고 text는 한 줄 300자 이하다.
세부 교차 참조·퇴화 기하·자원 제한은 로컬 parser가 검사한다.

`expression`에는 x, pi, e, + - * / ** 및 단항
sin/cos/tan/asin/acos/atan/sqrt/exp/log/log10/abs만 쓴다.
예: `sin(x)`, `sqrt(x)`, `1/x`. 지수 절댓값은 100 이하, 식 구문 트리는 100노드 이하다.
일반 Python 코드·속성·첨자·import·eval 호출은 쓰지 않는다.
원·타원은 ellipses, 일반 다각형·분리된 음함수·개형은 계산된 paths로 표현한다.
지원하지 않는 구성을 임의 그림으로 대체하지 않는다. 필수 그림을 지원 레시피로 표현할 수 없으면 그 문항을 02 §7로 보류한다.

일반 해설 rich_text 수식에는 바깥 `$`가 없지만, 그림 `text`는 Matplotlib
mathtext이므로 `$A$`, `$40^{\circ}$`, `$y=f(x)$`처럼 쓴다.
긴 설명은 그림에 넣지 않고 해설 paragraph에 쓴다. 전체 LaTeX 문서 명령을 넣지 않는다.

기하 그림은 원문에 방향·좌표축 위치 조건이 없을 때만 강체 이동·회전으로 배치할 수 있다.
모든 점·선·표시 관계를 함께 옮기고 길이·각도·접속·라벨 대상을 유지한다.
보조선과 각도 수치가 좁은 공간을 나누면 이런 배치를 검토하며 라벨이나 보조선을
지워 통과시키지 않는다. 함수 그래프의 좌표축·식·정의역을 임의 회전하여 바꾸지 않는다.

## 작도 정보와 표시 정보

내부 좌표·계수·교점은 작도에만 사용하며 라벨·눈금으로 자동 노출하지 않는다.
텍스트는 visible_annotations, 기하 표시는 equal_marks/right_angles/angle_marks에서
명시한 것만 그린다. 해설용 그림에는 원문의 정보와 실제 풀이에서 도출한
값·수식·관계를 표시할 수 있다. 아직 증명하지 않은 관계나 원문에 없는 조건을
사실처럼 더하지 않는다. 문제용 그림을 별도로 제공하는 명시 요청이 있으면
문제에는 주어진 정보만, 도출 정보를 더한 해설에는 별도 asset_id를 사용한다.

정본 재현·음영·점 표시·F01–F09는 01_student_quality.md의 「정본 재현과 해설 그림의 출처」를 따른다. 도출 해설은 원본 그림과 별도 asset_id·경로·참조를 사용한다.

그림 라벨의 문자 선택은 01_student_quality.md, 관계·필수 그림·설명 순서는 07_visual_reasoning.md가 정본이다. 라벨 `text`에 한글·ㄱㄴㄷ 같은 비수학 문자를 쓸 때는 평문으로 두거나(`"ㄱ"`, `"넓이 S"`) 수식 부분만 `$...$`로 감싼다(`"넓이 $S$"`). `$...$` 안에 한글을 넣어야 하면 `$\text{ㄱ}$`처럼 `\text{}`로 감싼다. JSON 문자열이므로 LaTeX 역슬래시는 한 번 escape한다(`"$\\angle\\mathrm{ABC}$"`).

`assets` 배열과 본문 참조의 최소 예시(figures 스키마): 각 asset은 `asset_id`·`source_pages`·`description`과 `construction`(새 그림) 또는 `path`+`sha256`(동결 입력의 기존 PNG) 중 하나만 가지며, steps에서 `{"type":"figure","asset_id":"fig_q001","caption":"..."}`로 정확히 참조된다.

```json
{
  "assets": [
    {"asset_id": "fig_q001", "source_pages": [1], "description": "1번 해설: 포물선과 x축 사이 영역",
     "construction": {"schema_version": "figure_recipe_v1", "view": [-1, 5, -1.5, 5], "axes": ["x", "y"],
       "label_placement": "anchored", "points": {"O": [0, 0], "A": [4, 0]}, "point_markers": {},
       "curves": [{"id": "curve_01", "coefficients": [0, 4, -1], "plot_domain": [-0.25, 4.25], "fill_domain": [0, 4]}],
       "visible_annotations": [
         {"id": "label_O", "text": "$O$", "target": "O", "preferred_direction": "SW"},
         {"id": "label_A", "text": "$A$", "target": "A", "preferred_direction": "NE"},
         {"id": "formula", "text": "$y=x(4-x)$", "target": "curve_01", "preferred_direction": "NE"}
       ]}}
  ],
  "solutions_steps_excerpt": [
    {"type": "paragraph", "content": [{"type": "text", "value": "그래프와 "}, {"type": "math", "value": "x"}, {"type": "text", "value": "축이 만나는 두 점 사이의 영역을 본다."}]},
    {"type": "figure", "asset_id": "fig_q001", "caption": "포물선과 x축 사이의 영역"}
  ]
}
```

`solutions_steps_excerpt`는 설명용 발췌 이름이며 실제 출력 키가 아니다. 실제 출력에서는 해당 블록들이 `solutions[].steps` 안에 들어간다.

직선·다항함수 라벨은 발문의 식·함수명을 유지한다.
원본 재현은 `y=x(4-x)`, `2x+y=4` 등 인쇄식을 그대로 표시한다. `2x+y=4`를 `y=-2x+4`로 바꾸는 도출 표시는 풀이에서 유도하고 원본 재현과 분리한 해설 전용 그림에서만 사용한다.
곡선 이름 `l`, `l'`, `C_1`은 식으로 바꾸지 않는다.
`f(x)`, `f'(x)`, `g(t)`, `g_1(t)`도 원문에 있는 함수/곡선 이름으로 유지한다.
이 표기는 함숫값 메모와 구별한다. curve target에는 좌표 방정식 또는 위처럼
제한된 곡선 이름을 붙인다. `$t=0^+$`, `$f'(c)$`, `$f(x)+g(x)$`, 값만 적은 `$4$`는
곡선 이름으로 쓰지 않는다. 매개변수 조건·극한 방향은 별도 해설 paragraph에 설명한다.
`$y=f'(x)=2x$`처럼 같은 곡선의 이름과 식을 함께 밝히는 표기는 허용되지만,
`$y=x=2$`처럼 서로 다른 조건을 연쇄 등호로 합치지 않는다. 수직선과 수평선은
별도 객체와 각자의 라벨로 구별한다. 라벨 오류를 피하려고 원문의 함수명을
삭제하거나 도함수를 원함수로 바꾸지 않는다.
수직선 `x=a`를 불가능한 y= 꼴로 바꾸지 않는다. 수직선은 segment/path,
원·타원 등 이차곡선의 음함수 라벨은 ellipse/path에 붙일 수 있다.
내부 계산식으로 표시식을 자동 만들지 않으며 제공되지 않은 식을 임의 노출하지 않는다.

plot_domain은 곡선을 그릴 구간, fill_domain은 곡선과 x축 사이 회색 영역의
구간이다. 영역 경계에서 그래프가 끝나는 것처럼 잘라 그리지 않고 원래 정의역
안에서 조금 더 연장한다. 실제 정의역 끝·유한 선분·불연속을 넘어 연결하지 않는다.
불연속 구간은 curves/paths를 나눈다. 두 곡선 사이 또는 일반 도형 영역은
경계를 계산한 닫힌 path에 fill=true를 사용하고 원래 곡선은 별도로 그린다.

## 이름 있는 작도 템플릿

지원 범위와 정확히 맞는 해설 그림은 같은 `figure_recipe_v1`의 template construction으로
쓸 수 있다. 객체의 키는 `schema_version`, `template:{id,parameters}`,
`visible_annotations` 세 개뿐이다. raw의 `view`·`points`·`label_placement`를 섞지 않는다.
고정 로컬 compiler가 내부 좌표와 `point_markers`, anchored 라벨 배치를 가진 raw 레시피로
전개한 뒤 같은 엄격 파서·PNG 렌더러를 사용한다. 입력 수치나 기본값은 실제 풀이와
원문 조건에 맞아야 한다. 맞지 않는 템플릿에 조건을 억지로 끼워 넣지 않는다.

| template.id | parameters 예시 | 지원 형태 |
|---|---|---|
| `circle_tangent_chords` | `{"radius":1,"apex_angle_degrees":120,"chord_half_angle_degrees":60}` | BC=CD인 내접사각형, C에서의 수평 접선과 두 할선 |
| `circular_seating` | `{"seat_count":8,"table_radius":1,"seat_radius_ratio":0.2,"gap_ratio":0.18,"rotation_degrees":90,"fill_seats":true}` | 원탁 둘레의 3~16개 균등 좌석, 서로 겹치면 거부 |
| `triangle_equal_segments` | `{"side_length":1,"ap_fraction":0.27,"show_equal_marks":false}` | 정삼각형의 P/Q/R, AP+BQ+CR=한 변, PQ=PR |
| `polynomial_region` | `{"quadratic_scale":1,"vertex_x":0,"intersection_x":[-1,2],"plot_domain":[-2.2,2.5],"shade_domain":[-1,2],"show_guides":true,"show_chords":true}` | 포물선과 두 점을 지나는 할선, x축까지의 지정 구간 음영 |
| `quadratic_line_enclosed_region` | `{"intersection_x":[-1,2],"quadratic_scale":1,"line_slope":1,"line_intercept":1,"plot_domain":[-1.75,2.75],"shade_region":true}` | 정확한 두 교점에서 만나는 이차함수와 직선 및 선택한 폐영역 음영 |
| `piecewise_endpoints` | `{"breaks":[-1,1],"left_slope":1,"left_value":1,"middle_value":-1,"right_value":2,"right_scale":1,"isolated_value":1,"plot_domain":[-2.75,2.3],"show_guides":true}` | 직선·상수·이차식의 세 구간과 열린/채운 끝점 |
| `trig_guides` | `{"amplitude":2,"frequency":2,"phase":0,"offset":1,"plot_domain":[-2.8,5.9],"guide_x":[0.7853981633974483],"show_extrema":true}` | 사인 곡선과 선택한 위치의 보조선 |
| `piecewise_density` | `{"knots":[0,1,2,3,4],"heights":[0,0.5,0,0.5,0],"guide_indices":[1,3],"show_height_guide":true}` | 비음성 꺾은선, 양끝 0과 사다리꼴 총넓이 1 검증 |
| `hyperbola_foci` | `{"center":[0,0],"a":3,"b":4,"parameter_max":1.25,"point_parameter":0.7,"focus_markers":"none","show_focal_segments":true,"show_asymptotes":false}` | 수평 실축 쌍곡선 두 가지와 초점 |
| `mapping_diagram` | `{"domain_count":5,"codomain_count":5,"mapping":[3,4,5,1,2],"show_function_arrow":true}` | 각 집합 1~6개 원소의 전체 함수 대응 |
| `prism_section` | `{"width":4,"depth":2,"height":2,"cut_fraction":0.5,"mode":"both"}` | 정해진 직육면체 P-Q-G-F 절단, 절단 전·분리 후·둘 다 |
| `upright_cylinder_oblique_section` | `{"radius":1,"height":5,"tilt_degrees":60,"section_center_height":2.5}` | 수직 원기둥의 측면을 비스듬히 자른 참 타원 단면. 절단 평면이 밑면·윗면을 건드리면 거부 |
| `mapping_chain` | `{"x_count":3,"y_count":3,"z_count":3,"mapping_xy":[3,2,1],"mapping_yz":[1,3,2],"show_function_arrows":true}` | 세 집합 사이 두 전체 함수와 합성 대응 |
| `cone_inscribed_cylinder` | `{"cone_radius":9,"cone_height":12,"cylinder_height":4}` | 원뿔 안의 동축 원기둥. 닮음으로 원기둥 반지름 계산 |
| `venn_regions` | `{"set_count":3,"shade_regions":["001","110"]}` | 두세 집합의 지정된 비영 원자영역만 회색 음영 |
| `stacked_cubes` | `{"layer_shape":"triangular","levels":3,"display_stages":true}` | 정사각·삼각 층의 정육면체 쌓기. 병렬 장면은 최대 3층 |

`mapping_diagram`과 `prism_section`의 수치·배열 매개변수는 필수다. 기존 8종과 새 `quadratic_line_enclosed_region`은 표의
기본값을 사용할 수 있지만 조건에서 확인하지 않은 관계를 기본값으로 확정하지 않는다.
새 다섯 템플릿은 표의 치수·배열·종류 매개변수를 모두 명시한다. `mapping_chain`의
`show_function_arrows`만 생략할 수 있다. 새 템플릿도 보장한 자세·범위 밖의 도형을
유사하게 대체하지 않는다.
`upright_cylinder_oblique_section`은 radius 0.1~100, height 0.1~500,
tilt_degrees 5~75, section_center_height 0~500이고
`0 < z0-r tan(tilt) < z0+r tan(tilt) < height`여야 한다.
`mapping_chain`은 세 집합의 원소 수가 각각 1~6이며 mapping_xy는 x_count개,
mapping_yz는 y_count개다. 대상 번호는 다음 집합의 1부터 시작한다.
`cone_inscribed_cylinder`의 세 길이는 0 초과 100 이하이고
cylinder_height < cone_height여야 한다. `venn_regions`는 set_count가 2 또는 3이며
shade_regions는 길이가 그 집합 수인 중복 없는 비트 문자열이다. 전체 0인 원 밖 영역은
지원하지 않는다. `stacked_cubes`의 layer_shape은 square/triangular, levels는
1~5이며 display_stages=true이면 levels≤3이다.
모든 수치는 유한 JSON 숫자이며 `pi/4` 문자열이나 bool 수치를 넣지 않는다.
그래프 6종(`polynomial_region`, `quadratic_line_enclosed_region`,
`piecewise_endpoints`, `trig_guides`, `piecewise_density`, `hyperbola_foci`)은
고정 출력에서 곡선이 충분히 보여야 한다.
로컬 파서는 극단적인 가로세로 비율, 지나치게 작은 점·곡선 범위,
서로 거의 일치하는 열린 점·채운 점을 거부한다. 수치를 임의로 바꿔 통과시키지 않는다.

템플릿의 공개 라벨 target은 다음과 같다. 꺼진 선택 기능의 target은 존재하지 않을 수
있고, `axis_x`/`axis_y`는 실제 축이 있을 때만 사용한다. 나머지 내부 좌표·계수는
자동으로 표시되지 않는다.

| template.id | 공개 label targets |
|---|---|
| `circle_tangent_chords` | A B C D E F O circumcircle chord_BC chord_CD secant_AE secant_AF tangent_EF |
| `circular_seating` | O seat_1..seat_n table chair_1..chair_n |
| `triangle_equal_segments` | A B C P Q R edge_AB edge_BC edge_CA inner_PQ inner_PR |
| `polynomial_region` | O V A B C D parabola secant guide_A guide_B chord_A chord_B |
| `quadratic_line_enclosed_region` | O I_left I_right V quadratic line 및 shade_region=true일 때 enclosed_region |
| `piecewise_endpoints` | O L_open L_closed R_open R_middle_open R_value L_foot R_foot L_level R_level left_branch middle_branch right_branch |
| `trig_guides` | O upper_level lower_level wave G0/G0_foot부터 입력 순서대로 extrema_upper extrema_lower |
| `piecewise_density` | O K0부터 각 꼭짓점, F0부터 각 발, peak_level density guide_i height_guide |
| `hyperbola_foci` | O F Fprime V_right V_left A right_branch left_branch focal_right focal_left |
| `mapping_diagram` | domain_1..domain_N codomain_1..codomain_N domain_title codomain_title function_title |
| `prism_section` | cut/both: main_A..main_H main_P main_Q; separated/both: left_A/D/E/F/G/H/P/Q right_B/C/F/G/P/Q left_volume right_volume |
| `upright_cylinder_oblique_section` | O R C T plane_label_anchor cutting_plane top_rim bottom_front bottom_back section_front section_back side_left side_right radius_OR |
| `mapping_chain` | x_1..x_N y_1..y_N z_1..z_N x_title y_title z_title f_title g_title; mapping_xy_i mapping_yz_i 및 선택한 f_arrow g_arrow |
| `cone_inscribed_cylinder` | cone_apex cone_base_center cone_base_left cone_base_right cylinder_top_center cylinder_top_left cylinder_top_right cylinder_base_left cylinder_base_right cone_height cone_base_radius cone_side_left cone_side_right cylinder_side_left cylinder_side_right cone_base_back cone_base_front cylinder_top_back cylinder_top_front cylinder_base_back cylinder_base_front |
| `venn_regions` | set_A_label set_B_label 및 3원일 때 set_C_label; set_A_circle set_B_circle 및 3원일 때 set_C_circle; 요청한 비트마다 shade_비트 |
| `stacked_cubes` | 각 장면의 stage_1..stage_N, 단일 장면이면 stage_levels |

```json
{"schema_version":"figure_recipe_v1","template":{"id":"circle_tangent_chords","parameters":{"radius":2,"apex_angle_degrees":115,"chord_half_angle_degrees":55}},"visible_annotations":[{"id":"a_label","text":"$A$","target":"A","preferred_direction":"N"}]}
```

이 예시는 construction 객체 하나다. 기존 asset_id·source_pages·description과 steps의
figure 참조가 별도로 필요하다. 해설 그림이므로 풀이에서 확인된 관계를 표시할 수 있지만,
아직 도출하지 않은 결론을 그림이 먼저 확정하는 표기는 쓰지 않는다.

## 고정 로컬 표현

필요한 축만 표시하고 사각 테두리·격자·자동 눈금/숫자·범례·제목은 생략한다.
영역은 불투명 `#DFDFDF` 단색 회색이며 선·점·문자는 그 위에 놓인다.
곡선은 검정 0.56pt, 도형 외곽·선분은 0.50pt, 축·보조선은 0.28pt다.
점선은 선과 빈칸을 각각 1.4pt, 화살촉은 길이 3.3pt·전체 폭 2.0pt로 그린다.
각도 호는 실제 인쇄 크기에 맞게 제한하며 각도 수치는 자기 각 안쪽과 해당 호 가까이에
배치한다. 점 이름은 똑바로, 곡선 이름은 기존 수학 기울임꼴로 표시한다.
숫자와 호를 잇는 작대기·연결선·
화살표, 흰 상자·halo, 선 지우기로 겹침을 가리는 방법은 쓰지 않는다.

고정 renderer는 400 dpi에서 실제 선·점과 글자 경계를 계산하고 제한된 후보
위치에서 라벨을 배치한다. 자리가 없으면 실제 오류로 실패하며 내용이나 레시피를
자동 수정하지 않는다. anchored 라벨은 기준점 근처에서만 후보를 찾으며, 라벨이
서로 가리키는 점을 혼동시킬 정도로 멀어지면 실패한다. 각도 수치도 자기 호 근처에
읽을 수 있는 자리가 없으면 실패한다. 필요한 경우 고정 렌더러가
흰 바깥 여백을 제한적으로 늘릴 수 있지만 그림 내용을 바꾸지 않는다.
새 레시피 PNG는 400 dpi의 자연 물리 크기로 PDF에 넣고 기존 해설 그림 폭
0.85\linewidth·높이 0.36\textheight를 넘을 때만 비율을 유지해 축소한다.
기존 PNG 자산의 크기 맞춤 방식은 유지한다. 본문 함초롬바탕·본문 수식 조판은
그대로 두고 그림 수식 라벨은 설치된 HyhwpEQ 윤곽을 8pt로 사용한다.
함수 변수는 이탤릭, 대문자 점 이름은 정체로 표기한다. 최상위 분수의
분자·분모는 기본 크기로 두며 미지원 글리프는 STIX로 대체한다.
글꼴이 설치되지 않으면 렌더러가 명시적으로 실패한다. 레시피에 선폭·폰트·
여백 같은 스타일 값을 넣지 않는다.

Codex는 응답 본문 JSON을 수집해 exam_solution.json으로 조립한 뒤 기존 `python -m exam_solution render`를 실행한다.
별도 모델 호출, 그림별 코딩·수학 재검산·중간 PNG 다운로드·수동 이미지 QA는 없다.
생성된 PNG와 자동 metrics는 렌더 작업 폴더에 남고 수신 JSON은 보존된다.
PNG/PDF 생성은 수학·시각 검수 또는 배포 승인 완료를 뜻하지 않는다.
