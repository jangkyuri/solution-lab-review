# Figure Template Contract

정본 도감에서 관찰한 표현을 재사용 가능한 작도 데이터와 고정된 로컬 계산으로 옮긴다.
ChatGPT는 문제의 조건과 full solve를 바탕으로 유형·입력·표시 정보를 정하고, renderer는
그 입력을 계산해 PNG와 PDF를 만든다. 모델 가중치 재훈련이나 원본 bitmap 복사는 하지 않는다.

이 문서는 로컬 구현·개발 검증 계약이다. ChatGPT에 배포할 필드·유형·매개변수·공개 target의
정본은 [reference-03의 Local Recipe Contract와 Named Construction Templates](chatgpt-project-prompt/references/reference-03-semantic-data-and-layout.md#local-recipe-contract)다.
추적 가능한 출처·유형 색인은 [catalog.json](figure-templates/catalog.json), 실행 입력은
[examples/](figure-templates/examples/)에 둔다. 이 로컬 경로를 ChatGPT가 직접 읽을 수 있다고
가정하지 않고 필요한 계약과 예제를 기존 프로젝트 참조 문서 안에도 포함한다.
새 프로젝트 source 파일을 추가하지 않고 기존 reference-03 안에 표현 규칙과 실행 예제를 둔다.
로컬 파일 변경, 프로젝트 Sources 저장, 새 대화에서의 사용 확인은 서로 다른 완료 상태다.

## Input And Compatibility

export root/version과 `figure_recipe_v1`을 유지한다. construction은 다음 둘 중 하나다.

1. raw: 명시한 좌표·곡선·선·점 표시·라벨을 기존 strict parser로 읽는다.
2. template: `schema_version`, `template:{id,parameters}`, `visible_annotations`만 받는다.
   알려진 template을 raw로 확장하고 같은 strict parser·렌더러에 전달한다.

형식을 섞거나 미등록 template, 임의 매개변수, 실행 코드, 파일 경로, `exemplar_id` 등을
construction에 넣으면 실패한다. 정본 ID와 원문 페이지 같은 출처는 개발용 catalog의
외부 metadata로 유지하며 실행 의미를 갖지 않는다. template 입력의 bool을 숫자로
처리하거나 NaN/Infinity를 수치로 허용하지 않는다.

raw의 공통 표현 요소는 다음과 같다.

- `strokes`: 이름 있는 두 점 사이 선분과 방향 표시. 선종류는 solid/dashed/dotted,
  화살표는 none/end/both다. stroke id는 라벨 target으로 참조할 수 있다.
- `point_markers`: 내부 점별 none/open/filled. `{}`는 모든 미지정 점을 숨긴다.
  새 raw 생성은 이 객체를 명시한다. 과거 입력에서 필드 자체가 없으면 기존의
  축 유무에 따른 점 표시 동작을 유지한다.
- `tick_marks`: 두 점 사이 선분에 1·2·3줄 눈금. 명시한 같은 길이 관계에만 쓴다.
  기존 `equal_marks`의 한 줄 눈금 입력도 계속 지원한다.
- curves/paths/ellipses의 선택적인 `line_style`: 기존 데이터는 solid로 렌더링한다.
- `paths.arrow`: none/end/both. 열린 경로는 끝/양끝의 접선 방향에, 닫힌
  경로는 첫 꼭짓점으로 돌아오는 접선 방향에 end만 허용한다. 채운 경로의
  화살촉, 닫힌 both, 반복 닫힘 꼭짓점은 거부한다.
- `paths.stroke:false`: fill=true, closed=true인 면의 채움만 그린다.
  외곽선은 별도 선·원호로 지정한다. 생략한 입력은 기존처럼 stroke=true다.
- `ellipse_arcs`: 회전 원·타원 둘레의 일부를 solid/dashed/dotted로 그린다.
  `start_degrees < end_degrees`, 최대 한 바퀴, 양의 반지름을 검사하며 최대
  64개다. 앞·뒤 원둘레 구분에 쓴다.
- 선택적인 `label_placement`: legacy 또는 anchored. 생략한 과거 raw 입력은 legacy를
  유지한다. 새 raw에서 점·축 라벨에는 anchored를 권장하되 새 필수 import gate로 만들지 않는다.

template compiler는 전개 결과에 `label_placement:"anchored"`를 항상 지정한다.
template envelope는 여전히 세 필드뿐이며 생성자가 label_placement를 추가하지 않는다.
anchored는 점·축 라벨을 기준점 가까운 제한된 후보에 놓고, 읽을 수 있는 가까운 자리가
없으면 명시적으로 실패한다. 다른 점을 가리키는 것처럼 보일 정도로 멀리 옮겨 충돌을
해결하지 않는다. 각도 수치는 자기 호와 가까운 각 내부 후보에만 놓고, 자리가 없으면
명시적으로 실패한다. 곡선 라벨은 기존 배치를 유지한다. 지시선·흰 가림 상자로 우회하지
않는다. 후보 거리와 충돌 여유의 수치는 renderer 구현에 두고 생성 규칙에 복제하지 않는다.

같은 primitive를 segments와 strokes에 중복 작성하지 않는다. 이 확장은 선의 표현과
점·관계의 명시성을 늘리지만 수학적 관계를 추측하는 일반 solver를 추가하지 않는다.
기존 PNG ZIP, raw recipe ZIP, 현재 figure id/asset id/body 참조 규칙은 유지한다.
그림 선지의 `choice_group.options[].figure_id`는 별도의 body figure 참조로
인정한다. 각 option은 고유 figure spec을 참조하고 renderer가 2열 그림 선지로
배치한다. 같은 다섯 선지를 한 body figure에 합치지 않는다.

## Supported Mathematical Families

템플릿 이름이 비슷하다고 지원 범위 밖의 관계를 억지로 넣지 않는다. 입력의 정확한
범위·기본값은 reference-03을 따른다. 다음은 각 구현이 보장하는 수학적 구성이다.

| Template | 구성과 검증할 관계 | 정본 출처 |
| --- | --- | --- |
| circle_tangent_chords | O 중심 원 위 A/B/C/D, BC=CD, 아래쪽 C에서 수평 접선. AB와 AD를 연장해 접선 위 E/F를 계산한다. 원 위 점과 반지름·접선의 수직 관계를 보존한다. | S054-P08-F02 |
| circular_seating | 큰 원 둘레 밖에 같은 반지름의 작은 원을 균등한 각 간격으로 배치한다. 자리의 원끼리 접촉·겹치는 입력은 거부한다. | S055-P10-F01 |
| triangle_equal_segments | 정삼각형 ABC의 P/Q/R을 AP=tL, BQ=(1-2t)L, CR=tL로 정한다. AP+BQ+CR=L과 PQ=PR을 유지한다. 눈금은 별도 허용값이 참일 때만 그린다. | S031-P09-F01 |
| polynomial_region | a(x-h)^2 위 두 지정 x값의 점을 잇는 할선을 계산한다. shade 구간에서 포물선과 x축 사이를 채우고 두 곡선을 표시 구간까지 유지한다. 교점-발과 교점-꼭짓점을 잇는 선은 선택 사항이다. | S002-P11-F01 |
| quadratic_line_enclosed_region | `q(x)=mx+b+a(x-r₁)(x-r₂)`와 `ℓ(x)=mx+b`를 만든다. 두 교점의 x좌표는 정확히 r₁,r₂이며, 명시한 경우에만 둘 사이 영역을 회색으로 채운다. 두 곡선은 교점 밖까지 이어진다. | S010-P08-F01 (교차 형태), S082-P05-F01 (회색 면적 스타일) |
| piecewise_endpoints | 두 경계로 나눈 왼쪽 직선·중간 상수·오른쪽 이차 가지와 정해진 포함/제외 패턴을 만든다. 두번째 경계에서 별도 점의 값은 선택 사항이다. | S030-P02-F01 |
| trig_guides | a sin(bx+c)+d 곡선, 선택한 x의 투영선과 선택적인 극값 높이 보조선을 계산한다. 표시 범위 안의 유한 구간을 사용한다. | S029-P03-F01 |
| piecewise_density | 지정 꺾은선의 x 증가·높이 비음성·양끝 0·사다리꼴 넓이 합 1을 검사한다. 실패한 넓이를 자동 보정하지 않는다. | S072-P12-F02 |
| hyperbola_foci | 수평 실축 쌍곡선의 두 가지를 쌍곡함수로 따로 계산한다. 초점은 sqrt(a²+b²), 곡선 위 A와 두 초점의 연결·점근선은 선택 사항이다. | S055-P18-F01 |
| mapping_diagram | 각 1..6개 원소의 두 집합과 각 정의역 원소당 정확히 하나인 대응 화살표를 만든다. 다대일과 쓰이지 않는 공역 원소를 허용한다. | S028-P02-F01 |
| prism_section | 직육면체의 지정 두 윗모서리 위 P/Q와 아래쪽 F/G를 지나는 평면으로 나눈다. 절단 전, 분리 후, 두 장면을 고정 등각 투영으로 구성한다. | S020-P08-F01 |
| upright_cylinder_oblique_section | 수직 원기둥의 측면만 통과하는 `z=z0+x tanθ` 평면과 타원 단면을 계산한다. 평면 α는 평행사변형, 앞/뒤 원둘레는 실선/점선으로 만든다. 원본과 동일한 절단 도감은 없고 세 정본의 표현을 합성했다. | S005-P02-F01, S078-P19-F01, S058-P19-F01 |
| mapping_chain | 원소 1..6개씩인 세 집합 X→Y→Z 사이 두 전체 함수를 개별 계산한다. 각 출발 원소에 정확히 하나의 방향 화살표를 둔다. | S012-P03-F01 |
| cone_inscribed_cylinder | 원뿔의 반지름·높이와 원기둥 높이에서 `r=R(H-h)/H`를 계산하고 앞/뒤 타원호를 구분한다. 정본의 원뿔과 원기둥은 내접 관계가 아니다. | S009-P03-F01 |
| venn_regions | 고정된 2·3원 배치에서 집합 A/B/C의 비영 원자영역 마스크만 채운다. 정본에 같은 벤 그림은 없고 회색 면적 표현만 참고한다. | S053-P08-F02 (스타일만) |
| stacked_cubes | 정사각 또는 삼각 층의 1..5단계 정육면체를 고정 투영한다. 노출면·가림·중복 모서리를 계산하고 병렬 장면은 3단계로 제한한다. 정본은 단일 정육면체 표현이다. | S017-P05-F01 (단일 큐브) |

triangle_equal_segments는 임의 삼각형 작도기가 아니다. piecewise_endpoints는 임의 조각함수
문법이 아니므로 다른 끝점 포함 패턴은 raw로 작성한다. prism_section은 임의 입체의 임의
절단면 교차 계산기가 아니다. 이 제한을 설명 없이 다른 그림으로 대체하지 않는다.
piecewise_endpoints의 두번째 경계에서 양쪽 열린 끝점의 값이 같으면 두 앵커는
유지하고 공통 열린 점을 한 번만 그린다. 열린 점과 채운 점의 좌표 충돌은 계속 거부한다.
mapping_diagram의 원소 수 상한은 현재 고정 글자 크기와 캔버스에서 원소와 화살표의
대응이 읽히도록 정한 구현 범위다. 더 많은 원소를 넣으려고 글자를 자동 축소하거나
그림을 한쪽 방향으로 늘리지 않는다.
새 입체·대응·집합 템플릿도 정해진 자세와 범위만 지원한다. 기울어진 원기둥은
수직 원기둥 절단과 다르며, `venn_regions`는 원 밖 `00`/`000` 영역과 임의 원
배치를 지원하지 않는다. 정본의 선·회색 면적 스타일을 가져왔다는 사실이
교과서 문항의 수치·집합 관계를 도감에서 확인했다는 뜻은 아니다.

그래프 6종은 equal_aspect를 유지하고, 계산한 곡선·경로의 전체 범위와 12% 여백을
포함한 최종 자동 view의 가로/세로 비를 각각 1/12..12로 제한한다. 실제 곡선·경로는
최종 view의 가로와 세로를 각각 10% 이상 차지해야 한다. 범위는 유한하고 양의 폭·높이를
가져야 한다. 이는 고정 출력 크기에서 극단적인 a/b 비의 쌍곡선, 지나치게 낮고 넓은
밀도 그래프, 원점에서 멀리 옮긴 작은 곡선이 납작하거나 보이지 않게 되는 입력을 거부하는
구현 범위다. 수치를 변경하거나 단위비를 왜곡해서 통과시키지 않는다.
또한 이 6종의 명시적인 열린 점·채운 점 사이 유클리드 거리는 여백 포함 view의 긴 변의
4% 이상이어야 한다. 거의 일치하는 점 표시가 불연속을 가리지 않도록 입력을 거부한다.
이 수치는 현행 템플릿의 출력 가독성 제한이며 국가 시험 전체의 도형 규칙으로 주장하지 않는다.

## Visible Information

수치 매개변수·원 위 점·초점·투영점·교점은 작도에 필요한 내부 데이터다. 이 값이 존재해도
좌표·식·길이·각도·답을 자동 라벨링하지 않는다. 모든 문자열은 `visible_annotations`에서
받고 target은 실제 확장 결과의 id와 일치해야 한다. 선택 기능을 껐을 때 사라진 target을
참조하면 명시적으로 실패한다.

점·등길이 눈금·직각·점선·회색 영역도 표시 정보다. 템플릿 기본값이나 내부 계산은 문제에
주어지지 않은 관계를 공개할 권한이 아니다. ChatGPT가 raw 생성이나 template 선택 전에
해당 변형의 실제 조건에 맞는지 확인한다. full solve·문제 품질·계산량 gate는 그대로다.
도출 정보가 필요한 해설 그림은 별도 figure/asset/PNG path를 사용한다.

도감의 사례는 표현 선택의 근거이며 모든 원본을 흉내 내는 보편 규칙은 아니다. 예를 들어
각도 수치의 지시선 금지·흰 가림 상자 금지·함수식 표시 경계는 기존 계약을 유지한다.
본문 HCR Batang과 그림 수식은 별도의 조판 체계다. 생성 그림의 글꼴·선폭·
음영·화살촉·인쇄 크기는 [정본 표현 계약](figure-style-contract.md)을 따른다.
이 스타일은 모든 raw/template 그림의 공통 renderer에 적용되며 레시피에
글꼴·선폭 필드를 추가하지 않는다.
그림 폭·높이·비율·바깥 여백은 [layout contract](layout-contract.md)와 reference-03을 따른다.

## Development Verification

개발 검증은 잘못된 입력 거부와 올바른 출력의 수학적·시각적 안정성을 나누어 확인한다.

- 각 template의 대표 예와 다른 유효 매개변수 사례에서 확장 결과를 strict parse한다.
- 원·접선, 균등 배치, 같은 길이, 곡선 위 점, 밀도 넓이, 두 쌍곡선 가지, 대응 방향,
  절단면의 공간 좌표처럼 실제 수학적 불변량을 검사한다. 구현의 값을 그대로 복사한
  기대값만으로 성공을 판정하지 않는다.
- 알려지지 않은 필드·잘못된 범위·비유한 수치·bool 수치·존재하지 않는 target을 거부한다.
  불연속을 이어 그리거나 영역 넓이를 바꾸거나 입력을 자동으로 잘라 맞추지 않는다.
- raw의 열린 점/채운 점/무표시 점, 점선/점선 화살표, 복수 눈금, 기존 생략 필드의 호환을
  확인한다. template에 visible_annotations를 주지 않으면 숫자나 식이 자동 표시되지 않는다.
- 화살촉의 곡선 접선 방향, 면 채움과 외곽선 분리, 앞/뒤 원호, 선택지별 figure
  cross-reference 및 2열 인쇄를 확인한다.
- 실제 PNG와 문제지 크기의 PDF로 라벨·끝점·숨은선·채움과 테두리를 개발 시 확인한다.
  source→재현→다른 매개변수의 비교는 수행한 사례와 범위를 기록한다.

이 절차는 렌더러·템플릿 개발 작업에 속한다. 일반 controller는 최종 ZIP을 받고 기존 CLI를
실행한다. 매 ZIP마다 정본 비교, 수학 재검토, per-figure 코드 작성, 중간 증거 다운로드,
별도 사용자 승인이나 수선 반복을 새 의무로 추가하지 않는다.

## ChatGPT Deployment Boundary

reference-03에 표현 규칙·15유형 입력·공개 target·완전한 construction 예제를 넣고,
reference-04의 generation serialization helper가 두 형식과 새 raw 필드를 허용하도록
맞춘다. 기존 source 수와 역할 분리를 유지한다. 프로젝트 지침은 짧게 이 문서를
참조하며 매개변수 표를 복제하지 않는다.

원격 배포는 실제 Sources reload·read-back과 Instructions 저장값 확인이 끝난 시점에만
완료라고 보고한다. 원격 저장만으로 새 ChatGPT 대화가 올바른 template을 선택해 final ZIP을
만들었다고 주장하지 않는다. end-to-end 생성 시험은 실행했다면 그 입력·결과·한계를 별도로
기록한다. 기능 구현·로컬 검증·원격 배포·새 생성 시험의 상태를 서로 대신하지 않는다.

## 원기둥 단면의 source_elements 참조 정규화

`upright_cylinder_oblique_section`은 투영한 원둘레와 단면 둘레를
`path`로 생성한다. 제작 원고는 `path:<id>`를 사용해야 한다.
Importer는 이 템플릿의 `top_rim`, `bottom_front`, `bottom_back`,
`section_front`, `section_back`에 한해, 실제로 같은 ID의 stroked path가
있으면 `ellipse_arc:<id>`를 `path:<id>`로 정규화한다.
관찰 문구와 recipe의 좌표 및 스타일은 바꾸지 않는다.
정규화 이후에도 누락, 중복, 알 수 없는 참조 검사를 적용한다.
Raw recipe와 다른 템플릿에는 이 별칭을 적용하지 않는다.
