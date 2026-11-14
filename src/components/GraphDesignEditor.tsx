import { useState } from 'react';
import type { Graph, SolutionResult } from '../../shared/contracts';
import { GraphBoundsSchema } from '../../shared/graph-design';
import type { GraphBounds } from '../../shared/graph-design';

type Props = {
  readonly result: SolutionResult;
  readonly onChange: (result: SolutionResult) => void;
  readonly allowRecipeEdit?: boolean;
  readonly canRetry?: boolean;
  readonly onRetry?: (questionNumber: string, stepId: string) => Promise<boolean>;
};

const curveColors = [
  { value: 'blue', label: '파란색' },
  { value: 'brown', label: '갈색' },
  { value: 'gray', label: '회색' },
] as const;

const boundFields = [
  { key: 'xMin', label: '가로축 시작' }, { key: 'xMax', label: '가로축 끝' },
  { key: 'yMin', label: '세로축 시작' }, { key: 'yMax', label: '세로축 끝' },
] as const;

type RangeDraft = Record<keyof GraphBounds, string>;
type CurveStyle = Pick<Graph['curves'][number], 'color' | 'dashed'>;

function rangeFields(bounds: GraphBounds): RangeDraft {
  return { xMin: String(bounds.xMin), xMax: String(bounds.xMax), yMin: String(bounds.yMin), yMax: String(bounds.yMax) };
}

function GraphRangeEditor({ graph, onChange }: { readonly graph: Graph; readonly onChange: (graph: Graph) => void }) {
  const [draft, setDraft] = useState<RangeDraft | null>(null);
  const [invalid, setInvalid] = useState(false);
  const fields = draft ?? rangeFields(graph);

  function applyRange(): void {
    const numbers = Object.fromEntries(boundFields.map(({ key }) => [key, fields[key].trim() ? Number(fields[key]) : Number.NaN]));
    const parsed = GraphBoundsSchema.safeParse(numbers);
    setInvalid(!parsed.success);
    if (parsed.success) {
      onChange({ ...graph, ...parsed.data });
      setDraft(null);
    }
  }

  return <fieldset className="editor-step graph-design-fields"><legend>축 범위</legend>
    <div className="graph-design-grid">
      {boundFields.map(({ key, label }) => <label className="field" key={key}>{label}
        <input inputMode="decimal" value={fields[key]} aria-invalid={invalid || undefined}
          onChange={event => {
            setDraft({ ...fields, [key]: event.currentTarget.value });
            setInvalid(false);
          }} />
      </label>)}
    </div>
    {invalid && <p className="notice error" role="alert">가로축과 세로축에 숫자를 입력하고 시작을 끝보다 작게 지정해 주세요. 입력 범위는 가로축 ±100,000, 세로축 ±100,000,000입니다.</p>}
    <button type="button" className="button secondary graph-design-apply" disabled={!draft} onClick={applyRange}>축 범위 적용</button>
  </fieldset>;
}

export function GraphDesignEditor({ result, onChange, allowRecipeEdit = false, canRetry = false, onRetry }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const entries = result.questions.flatMap((question, questionIndex) => question.steps.flatMap((step, stepIndex) => step.graph && !step.figureRecipe ? [{
    id: `${questionIndex}-${stepIndex}`, questionIndex, stepIndex, graph: step.graph,
    label: `${question.number}번 · ${stepIndex + 1}단계${step.title ? ` · ${step.title}` : ''}`,
  }] : []));
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0];
  const pendingQuestion = allowRecipeEdit ? result.questions.at(-1) : undefined;
  if (pendingQuestion && onRetry) {
    return <section className="result-editor"><h2>그래프 디자인</h2>
      {pendingQuestion.steps.map((step, index) => <fieldset className="editor-step" key={step.id}>
        <legend>{step.title || `${index + 1}단계 그래프`}</legend>
        <button type="button" className="button secondary" disabled={!canRetry}
          onClick={() => void onRetry(pendingQuestion.number, step.id)}>{step.figureRecipe ? '그래프 다시 그리기 (유료)' : '그래프 그리기 (유료)'}</button>
        {step.figureRecipe && <button type="button" className="button secondary" onClick={() => onChange({
          ...result, questions: result.questions.map(question => question === pendingQuestion
            ? { ...question, steps: question.steps.map(item => item === step ? { ...item, figureRecipe: null } : item) }
            : question),
        })}>그래프 빼기</button>}
      </fieldset>)}
    </section>;
  }
  if (!selected) {
    const hasRecipe = result.questions.some(question => question.steps.some(step => step.figureRecipe));
    return <section className="result-editor"><h2>그래프 디자인</h2><p className="muted">{hasRecipe
      ? '생성된 그래프는 풀이 결과에서 볼 수 있습니다.'
      : '이 결과에는 수정할 그래프가 없습니다.'}</p></section>;
  }
  const { graph, questionIndex: selectedQuestion, stepIndex: selectedStep } = selected;

  function updateGraph(next: Graph): void {
    onChange({ ...result, questions: result.questions.map((question, questionIndex) => questionIndex === selectedQuestion
      ? { ...question, steps: question.steps.map((step, stepIndex) => stepIndex === selectedStep ? { ...step, graph: next } : step) }
      : question) });
  }

  function updateCurveStyle(curveIndex: number, style: Partial<CurveStyle>): void {
    updateGraph({ ...graph, curves: graph.curves.map((curve, index) => index === curveIndex ? { ...curve, ...style } : curve) });
  }

  return <section className="result-editor"><h2>그래프 디자인</h2>
    <label className="field">편집할 그래프
      <select value={selected.id} onChange={event => setSelectedId(event.currentTarget.value)}>
        {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
    </label>
    <label className="field">그래프 제목<input value={graph.title} maxLength={300}
      onChange={event => updateGraph({ ...graph, title: event.currentTarget.value })} /></label>
    <div className="graph-design-grid">
      <label className="field">가로축 이름<input value={graph.xLabel} maxLength={100}
        onChange={event => updateGraph({ ...graph, xLabel: event.currentTarget.value })} /></label>
      <label className="field">세로축 이름<input value={graph.yLabel} maxLength={100}
        onChange={event => updateGraph({ ...graph, yLabel: event.currentTarget.value })} /></label>
    </div>
    <GraphRangeEditor key={selected.id} graph={graph} onChange={updateGraph} />
    {graph.curves.map((curve, curveIndex) => <fieldset key={curveIndex} className="editor-step graph-design-fields">
      <legend>곡선 {curveIndex + 1}{curve.label ? ` · ${curve.label}` : ''}</legend>
      <div className="graph-design-grid">
        <label className="field">색상<select value={curve.color} onChange={event => {
          const color = curveColors.find(option => option.value === event.currentTarget.value)?.value;
          if (color) updateCurveStyle(curveIndex, { color });
        }}>
          {curveColors.map(color => <option key={color.value} value={color.value}>{color.label}</option>)}
        </select></label>
        <label className="field">선 모양<select value={curve.dashed ? 'dashed' : 'solid'} onChange={event => {
          updateCurveStyle(curveIndex, { dashed: event.currentTarget.value === 'dashed' });
        }}>
          <option value="solid">실선</option><option value="dashed">점선</option>
        </select></label>
      </div>
    </fieldset>)}
  </section>;
}
