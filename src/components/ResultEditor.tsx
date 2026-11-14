import type { SolutionResult } from '../../shared/contracts';
import { editBookletStep, editQuestion, editStep } from '../result-edit';
import { SourceConflictNotice } from './ResultDocument';

type Props = {
  readonly result: SolutionResult;
  readonly onChange: (result: SolutionResult) => void;
  readonly supplement: boolean;
  readonly onOpenSource?: (() => void) | undefined;
};

const groupLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const figurePlacements = [
  { value: 'side', label: '설명 옆' },
  { value: 'wide', label: '넓게' },
  { value: 'small', label: '작게' },
] as const;

export function ResultEditor({ result, onChange, supplement, onOpenSource }: Props) {
  return <section className="result-editor" aria-label="풀이 내용 수정">
    {result.questions.map((question, questionIndex) => <section className="editor-question" key={questionIndex}>
      <h3>{question.number}번</h3>
      <label className="field">문제 본문<textarea value={question.problemText} onChange={event => onChange(editQuestion(result, questionIndex, 'problemText', event.currentTarget.value))} rows={3} /></label>
      <label className="field">첫 판단<textarea value={question.firstDecision} onChange={event => onChange(editQuestion(result, questionIndex, 'firstDecision', event.currentTarget.value))} rows={2} /></label>
      {question.steps.map((step, stepIndex) => <fieldset className="editor-step" key={step.id || stepIndex}><legend>{stepIndex + 1}단계 {step.id}</legend>
        <label className="field">단계 제목<input value={step.title} onChange={event => onChange(editStep(result, questionIndex, stepIndex, 'title', event.currentTarget.value))} /></label>
        {supplement && <>
          {step.sourceConflict && <SourceConflictNotice conflict={step.sourceConflict} onOpenSource={onOpenSource} />}
          <label className="field">원문 판독 수정
            <textarea name={`original-step-${questionIndex}-${stepIndex}`} value={step.originalStep} rows={3} spellCheck={false}
              onChange={event => onChange(editStep(result, questionIndex, stepIndex, 'originalStep', event.currentTarget.value))} />
          </label>
        </>}
        <label className="field">설명<textarea value={step.explanation} onChange={event => onChange(editStep(result, questionIndex, stepIndex, 'explanation', event.currentTarget.value))} rows={4} /></label>
        <label className="field">수식<textarea value={step.latex} onChange={event => onChange(editStep(result, questionIndex, stepIndex, 'latex', event.currentTarget.value))} rows={2} spellCheck={false} /></label>
        {supplement && <details>
          <summary>학생용 PDF 디자인</summary>
          <div className="field">
            <div className="form-row">
              <label className="field">설명 묶음
                <select value={step.booklet?.group ?? ''} onChange={event => onChange(editBookletStep(result, questionIndex, stepIndex, 'group', event.currentTarget.value || undefined))}>
                  <option value="">자동</option>
                  {[...groupLabels].map(group => <option key={group} value={group}>{group}</option>)}
                </select>
              </label>
              <label className="field">그림 배치
                <select value={step.booklet?.figure ?? ''} onChange={event => {
                  const choice = figurePlacements.find(placement => placement.value === event.currentTarget.value);
                  onChange(editBookletStep(result, questionIndex, stepIndex, 'figure', choice?.value));
                }}>
                  <option value="">자동</option>
                  {figurePlacements.map(placement => <option key={placement.value} value={placement.value}>{placement.label}</option>)}
                </select>
              </label>
            </div>
            <label className="field">참고 팁
              <textarea name={`booklet-reference-${questionIndex}-${stepIndex}`} rows={2} maxLength={500} value={step.booklet?.referenceTip ?? ''}
                onChange={event => onChange(editBookletStep(result, questionIndex, stepIndex, 'referenceTip', event.currentTarget.value || undefined))} />
            </label>
            <label className="field">수식 주석
              <textarea rows={2} maxLength={600} value={step.booklet?.equationNote ?? ''}
                onChange={event => onChange(editBookletStep(result, questionIndex, stepIndex, 'equationNote', event.currentTarget.value || undefined))} />
            </label>
            <label className="field">한 줄 정리
              <textarea rows={2} maxLength={600} value={step.booklet?.takeaway ?? ''}
                onChange={event => onChange(editBookletStep(result, questionIndex, stepIndex, 'takeaway', event.currentTarget.value || undefined))} />
            </label>
          </div>
        </details>}
      </fieldset>)}
      <label className="field">결론<textarea value={question.answer} onChange={event => onChange(editQuestion(result, questionIndex, 'answer', event.currentTarget.value))} rows={2} /></label>
    </section>)}
  </section>;
}
