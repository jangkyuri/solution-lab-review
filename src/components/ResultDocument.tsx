import { lazy, Suspense, useState } from 'react';
import type { ApiCost, Question, SolutionResult, StepBooklet } from '../../shared/contracts';
import { HAND_SOLUTION_PRODUCTION_VERSION, handSolutionNotices, handSolutionStepTitle, inlineHandSolutionAnswer, studentQuestionNumber } from '../../shared/hand-solution-output';
import { formatSolutionIntegralNotation } from '../../shared/integral-notation';
import { ApiCostText } from './ApiCostText';
import { Formula, MathText } from './MathText';

const GraphView = lazy(async () => ({ default: (await import('./GraphView')).GraphView }));
type FigureSource = {
  readonly jobId: string;
  readonly version: string;
  readonly revisionId?: string;
  readonly questionOffset?: number;
};
type Props = {
  readonly result: SolutionResult;
  readonly supplement: boolean;
  readonly figureSource?: FigureSource | undefined;
  readonly onOpenSource?: (() => void) | undefined;
  readonly questionApiCosts?: Readonly<Record<string, ApiCost>> | undefined;
};

export function SourceConflictNotice({ conflict, onOpenSource }: {
  readonly conflict: string;
  readonly onOpenSource?: (() => void) | undefined;
}) {
  return <div className="notice warning source-conflict">
    <h4>원문 판독 확인 필요</h4>
    <p><MathText text={conflict} /></p>
    {onOpenSource && <button type="button" className="text-button" onClick={onOpenSource}>올린 손풀이 보기</button>}
  </div>;
}

export function ResultDocument({ result: sourceResult, supplement, figureSource, onOpenSource, questionApiCosts }: Props) {
  const result = formatSolutionIntegralNotation(sourceResult);
  if (result.productionVersion === HAND_SOLUTION_PRODUCTION_VERSION) {
    return <HandSolutionDocument result={result} figureSource={figureSource} onOpenSource={onOpenSource} questionApiCosts={questionApiCosts} />;
  }
  return <article className="document">
    {result.questions.map((question, questionIndex) => <section className="question-document" key={`${question.number}-${questionIndex}`}>
      <QuestionHeading title={`${question.number}번`} cost={questionApiCosts?.[question.number]} />
      <div className="problem-block"><MathText text={question.problemText} /></div>
      <div className="first-decision"><span className="eyebrow">첫 판단</span><p><MathText text={question.firstDecision} /></p></div>
      {question.steps.map((step, index) => <section className="solution-step" key={step.id || index}>
        <header className="step-header"><span className="step-number">{index + 1}</span><h3>{step.title}</h3></header>
        {step.originalStep && <div className="step-origin"><span className="eyebrow">{supplement ? '원래 손풀이' : '선택한 단계'}</span><p><MathText text={step.originalStep} /></p></div>}
        {supplement && step.sourceConflict && <SourceConflictNotice conflict={step.sourceConflict} onOpenSource={onOpenSource} />}
        <div className="step-supplement"><span className="eyebrow">{supplement ? '보충 설명' : '풀이 설명'}</span><p><MathText text={step.explanation} /></p><Formula text={step.latex} /></div>
        <StepFigure step={step} source={figureSource} questionIndex={questionIndex} stepIndex={index} />
      </section>)}
      <QuestionAnswer text={question.answer} />
      {question.uncertainties.length > 0 && <div className="notice warning"><h3>확인할 부분</h3><ul>{question.uncertainties.map((item, index) => <li key={index}><MathText text={item} /></li>)}</ul></div>}
    </section>)}
  </article>;
}

function HandSolutionDocument({ result, figureSource, onOpenSource, questionApiCosts }: Pick<Props, 'result' | 'figureSource' | 'onOpenSource' | 'questionApiCosts'>) {
  return <article className="document">
    {result.questions.map((question, questionIndex) => {
      const number = studentQuestionNumber(question.number);
      const notices = handSolutionNotices(question);
      const steps = question.steps.map((step, stepIndex) => ({ step, stepIndex }))
        .filter(({ step }) => step.explanation.trim() || step.latex.trim() || step.figureRecipe || step.graph || step.booklet);
      return <section className="question-document" key={`${question.number}-${questionIndex}`}>
        <QuestionHeading title={number ? `문제 ${number}` : '문제'} cost={questionApiCosts?.[question.number]} />
        <div className="problem-block"><MathText text={question.problemText} /></div>
        {question.firstDecision.trim() && <div className="first-decision"><p><strong>핵심: </strong><MathText text={question.firstDecision} /></p></div>}
        {steps.map(({ step, stepIndex }, index) => <section className="solution-step" key={step.id || stepIndex}>
          <header className="step-header"><h3><span className="step-number">{index + 1}단계.</span>{' '}<MathText text={handSolutionStepTitle(step.title)} /></h3></header>
          <StepFigure step={step} source={figureSource} questionIndex={questionIndex} stepIndex={stepIndex} />
          {step.booklet?.table && <StepEvidenceTable rows={step.booklet.table} />}
          <div className="step-supplement"><p><MathText text={step.explanation} /></p><Formula text={step.latex} /></div>
        </section>)}
        <QuestionAnswer text={question.answer} />
        {notices.length > 0 && <div className="notice warning source-conflict">
          {notices.map(notice => <p key={notice}><MathText text={notice} /></p>)}
          {onOpenSource && <button type="button" className="text-button" onClick={onOpenSource}>첨부 원본 보기</button>}
        </div>}
      </section>;
    })}
  </article>;
}

function QuestionHeading({ title, cost }: { readonly title: string; readonly cost: ApiCost | undefined }) {
  if (!cost) return <h2>{title}</h2>;
  return <header className="question-heading">
    <h2>{title}</h2>
    <p className="source-meta"><ApiCostText label="문항 API 비용" cost={cost} /></p>
  </header>;
}

function StepFigure({ step, source, questionIndex, stepIndex }: {
  readonly step: Question['steps'][number];
  readonly source: FigureSource | undefined;
  readonly questionIndex: number;
  readonly stepIndex: number;
}) {
  if (step.figureRecipe) {
    if (!source) return <p className="notice error" role="alert">그래프를 불러올 수 없습니다.</p>;
    const query = new URLSearchParams({ v: source.version });
    if (source.revisionId) query.set('revision', source.revisionId);
    const savedQuestionIndex = questionIndex + (source.questionOffset ?? 0);
    const url = `/api/jobs/${encodeURIComponent(source.jobId)}/figures/${savedQuestionIndex}/${stepIndex}?${query}`;
    const label = step.graph?.title.trim() || handSolutionStepTitle(step.title).trim() || '풀이 그래프';
    return <RecipeFigure key={url} url={url} label={label} />;
  }
  return step.graph ? <Suspense fallback={<p className="muted">그래프를 준비하고 있습니다.</p>}><GraphView graph={step.graph} /></Suspense> : null;
}

function RecipeFigure({ url, label }: { readonly url: string; readonly label: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <p className="notice error" role="alert">그래프를 불러오지 못했습니다.</p>
    : <figure className="math-graph recipe-figure">
      <img src={url} alt={label} loading="lazy" onError={() => setFailed(true)} />
    </figure>;
}

function QuestionAnswer({ text }: { readonly text: string }) {
  const answer = inlineHandSolutionAnswer(text);
  if (!answer) return null;
  return <footer className="answer-block"><p><strong>정답</strong>{' '}<MathText text={answer} /></p></footer>;
}

function StepEvidenceTable({ rows }: { readonly rows: NonNullable<StepBooklet['table']> }) {
  const [headers, ...body] = rows;
  if (!headers || body.some(row => row.length !== headers.length)) return null;
  return <div className="step-evidence-table"><table>
    <thead><tr>{headers.map((cell, index) => <th key={index} scope="col"><MathText text={cell} /></th>)}</tr></thead>
    <tbody>{body.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}><MathText text={cell} /></td>)}</tr>)}</tbody>
  </table></div>;
}
