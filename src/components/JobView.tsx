import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { ArrowRight, Download, LoaderCircle, Pencil, Play, RefreshCw, Save } from 'lucide-react';
import type { Job, SolutionResult } from '../../shared/contracts';
import { QUESTION_APPROVAL_BATCH_SIZE } from '../../shared/contracts';
import { applyCurveAccent } from '../../shared/graph-design';
import { HAND_SOLUTION_PRODUCTION_VERSION, studentQuestionNumber } from '../../shared/hand-solution-output';
import { DEFAULT_PDF_DESIGN, type PdfDesign } from '../../shared/pdf-design';
import { api, errorMessage, jobDate, statusLabels } from '../api';
import { samePdfDesign } from '../pdf-design-equality';
import { usePdfPreview } from '../usePdfPreview';
import { ApiCostText } from './ApiCostText';
import { DesignReferencePicker } from './DesignReferencePicker';
import { GraphDesignEditor } from './GraphDesignEditor';
import { PdfDesignPanel } from './PdfDesignPanel';
import { ResultDocument } from './ResultDocument';
import { ResultEditor } from './ResultEditor';

type Props = {
  readonly job: Job; readonly busy: boolean;
  readonly hidden?: boolean;
  readonly onRun: (id: string) => Promise<boolean>;
  readonly onNext: (id: string, completedCount: number) => Promise<boolean>;
  readonly onSave: (id: string, result: SolutionResult | null, note: string, pdfDesign?: PdfDesign) => Promise<boolean>;
  readonly onCompleteReview: (id: string, updatedAt: string) => Promise<boolean>;
  readonly onRetryFigure: (id: string, updatedAt: string, questionNumber: string, stepId: string) => Promise<boolean>;
};
type Revision = Awaited<ReturnType<typeof api.revisions>>['revisions'][number];
const viewTabs = [
  { value: 'result', label: '풀이 결과' },
  { value: 'pdf', label: 'PDF 미리보기' },
  { value: 'sources', label: '올린 파일과 요청' },
  { value: 'revisions', label: '수정 이력' },
] as const;
type ViewTab = (typeof viewTabs)[number]['value'];
const editorTabs = { content: '풀이 내용', graph: '그래프 디자인', pdf: 'PDF 양식' } as const;
type EditorTab = keyof typeof editorTabs;
const editorChoices = ['content', 'graph', 'pdf'] as const satisfies readonly EditorTab[];

export function JobView({ job, busy, hidden = false, onRun, onNext, onSave, onCompleteReview, onRetryFigure }: Props) {
  const [tab, setTab] = useState<ViewTab>('result');
  const [draft, setDraft] = useState<SolutionResult | null>(null);
  const [pdfDraft, setPdfDraft] = useState<PdfDesign | null>(null);
  const [editor, setEditor] = useState<EditorTab | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const previewPane = useRef<HTMLElement>(null);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const pdfPreview = usePdfPreview(job.id);
  const result = draft ?? job.result;
  const savedPdfDesign = job.pdfDesign ?? DEFAULT_PDF_DESIGN;
  const pdfDesign = pdfDraft ?? savedPdfDesign;
  const unsaved = draft !== null || pdfDraft !== null;
  const running = job.status === 'running';
  const needsReview = job.status === 'needs_review';
  const editing = editor !== null && result !== null && !running;
  const progress = job.progress;
  const incomplete = Boolean(progress && progress.completedCount < progress.questionNumbers.length);
  const batchCount = Math.ceil((result?.questions.length ?? 0) / QUESTION_APPROVAL_BATCH_SIZE);
  const selectedIndex = selectedBatch ?? Math.max(0, batchCount - 1);
  const firstIndex = selectedIndex * QUESTION_APPROVAL_BATCH_SIZE;
  const visibleResult = progress && result ? {
    ...result,
    questions: result.questions.slice(firstIndex, firstIndex + QUESTION_APPROVAL_BATCH_SIZE),
  } : result;
  const nextQuestion = progress && questionLabel(progress.questionNumbers[progress.completedCount], progress.completedCount);
  const permittedCount = progress ? (progress.authorizedCount ?? progress.completedCount) - progress.completedCount : 0;
  const nextCount = permittedCount || (progress ? Math.min(QUESTION_APPROVAL_BATCH_SIZE, progress.questionNumbers.length - progress.completedCount) : 0);
  const exportLabel = incomplete ? '작성한 문항 PDF' : 'PDF 내보내기';
  const previewIsCurrent = pdfPreview.isCurrent(result, pdfDesign);

  useEffect(() => {
    if (editing && !hidden) editorHeading.current?.focus();
  }, [editing, hidden]);

  function changePdfDesign(next: PdfDesign): void {
    setPdfDraft(samePdfDesign(next, savedPdfDesign) ? null : next);
  }

  function closeEditor(): void {
    setEditor(null);
    if (editing) editTrigger.current?.focus();
  }

  function scrollToPreview(): void {
    previewPane.current?.scrollTo({ top: 0 });
    previewPane.current?.closest('.main-scroll')?.scrollTo({ top: 0 });
  }

  function openPdfPreview(refresh = false): void {
    if (needsReview) return;
    if (tab !== 'pdf') scrollToPreview();
    setTab('pdf');
    if (result && !running && !pdfPreview.pending && (refresh || !previewIsCurrent)) {
      void pdfPreview.render(result, pdfDesign, draft);
    }
  }

  function selectView(value: string): void {
    if (value === 'pdf' && !running) openPdfPreview();
    else if (value === 'result' || value === 'sources' || value === 'revisions') setTab(value);
  }

  async function save(): Promise<boolean> {
    const saved = await onSave(job.id, draft, job.reviewNote, pdfDraft ?? undefined);
    if (!saved) return false;
    closeEditor();
    setDraft(null);
    setPdfDraft(null);
    return true;
  }

  async function allowNext(completedCount: number): Promise<void> {
    if (unsaved && !await save()) return;
    if (await onNext(job.id, completedCount)) {
      closeEditor();
      setSelectedBatch(null);
      setTab('result');
      scrollToPreview();
    }
  }

  return <div className={`review-layout${editing ? ' work-layout editing-layout' : ''}`} hidden={hidden}><section ref={previewPane} className="work-content review-preview" aria-label="풀이 미리보기" id="job-result-preview" tabIndex={editing ? 0 : undefined}>
    <div className="document-toolbar"><div><span className={`badge ${job.status === 'approved' ? 'success' : 'neutral'}`}>{statusLabels[job.status]}</span><p className="source-meta">{job.subject} · {job.mode === 'supplement' ? '손풀이 보강' : '새 풀이'} · {jobDate(job)}</p>
      {job.initialDesign && <p className="source-meta">초기 디자인 · {job.initialDesign.title}</p>}
      {job.status !== 'draft' && <p className="source-meta" aria-live="polite"><ApiCostText label="작업 API 비용" cost={job.apiCost} running={running} /></p>}
      {job.readingApiCost && progress && progress.questionNumbers.length > 1 &&
        <p className="source-meta"><ApiCostText label="공통 문제 판독" cost={job.readingApiCost} compact /></p>}
    </div>
      <div className="document-toolbar-actions">
        {result && !running && <Button ref={editTrigger} className="astryx-job-action" isDisabled={busy}
          aria-expanded={editing} aria-controls={editing ? 'job-editor' : undefined} icon={<Pencil size={16} aria-hidden="true" />}
          label={editing ? '편집 닫기' : '내용·디자인 편집'} onClick={() => { setEditor(editing ? null : 'content'); setTab('result'); }} />}
        <Button className="astryx-job-action" isDisabled={!job.result || unsaved || running || needsReview}
          href={`/api/jobs/${encodeURIComponent(job.id)}/pdf`} target="_blank" rel="noreferrer"
          icon={<Download size={16} aria-hidden="true" />} label={exportLabel} />
        {job.result && !progress && <button type="button" className="text-button" disabled={busy || running || unsaved} onClick={() => void onRun(job.id)}>새 결과로 다시 작성</button>}
      </div>
    </div>
    <TabList className="astryx-job-tabs astryx-result-tabs" role="tablist" aria-label="작업 보기"
      hasDivider size="lg" value={tab} onChange={selectView}>
      {viewTabs.map(({ value, label }) => <Tab key={value} id={`job-view-${value}`} value={value}
          label={label} panelId="job-view-panel" aria-disabled={value === 'pdf' && (running || needsReview) ? true : undefined} />)}
    </TabList>
    {job.error && <p className="notice error" role="alert">{job.error}</p>}
    {needsReview && <section className="notice warning" aria-label="풀이 초안 검토">
      <p><strong>풀이 초안을 저장했어요.</strong> 아래 내용을 확인하고 필요한 부분을 수정해주세요.</p>
      {job.reviewIssues?.length ? <ul>{job.reviewIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
      <Button className="astryx-job-action" isDisabled={busy || unsaved}
        onClick={() => void onCompleteReview(job.id, job.updatedAt)} label="검토 마치기" />
    </section>}
    <div id="job-view-panel" role="tabpanel" aria-labelledby={`job-view-${tab}`} tabIndex={0}>
    {tab === 'result' && <>
      {progress && <div className="question-progress">
        <p role="status"><strong>{progress.completedCount} / {progress.questionNumbers.length}문항 작성</strong></p>
        {batchCount > 1 &&
          <label className="question-picker">작성한 묶음
            <select value={selectedIndex} onChange={event => setSelectedBatch(Number(event.currentTarget.value))}>
              {Array.from({ length: batchCount }, (_, index) => <option key={index} value={index}>{index + 1}번째 묶음</option>)}
            </select>
          </label>}
      </div>}
      {running && <div className="pending-state" role="status"><LoaderCircle className="spin" size={24} /><h2>{nextQuestion ? `${nextQuestion} 작성 중` : '첫 묶음 준비 중'}</h2></div>}
      {!result && !running && <div className="empty-state">
        <h2>{job.status === 'failed' ? '풀이 작성에 실패했습니다' : '작업을 저장했습니다'}</h2>
        <Button className="astryx-job-action" variant="primary" isDisabled={busy} icon={<Play size={16} aria-hidden="true" />}
          label={job.status === 'failed' ? '다시 작성하기' : '풀이 작성하기'} onClick={() => void onRun(job.id)} />
      </div>}
      {visibleResult && <div className={progress && visibleResult.questions.length > 1 ? 'batch-preview' : undefined}>
        <ResultDocument result={visibleResult} supplement={job.mode === 'supplement'} onOpenSource={() => setTab('sources')}
          questionApiCosts={job.questionApiCosts}
          figureSource={{ jobId: job.id, version: job.updatedAt, questionOffset: progress ? firstIndex : 0 }} />
      </div>}
    </>}
    {tab === 'pdf' && <section className="job-pdf-preview" aria-label="PDF 출력 미리보기">
      {!result ? <p className="muted">미리 볼 풀이 없음</p> : <>
        <div className="pdf-preview-status">
          {result.productionVersion === HAND_SOLUTION_PRODUCTION_VERSION && result.questions.length > 1 &&
            <p className="source-meta">검토용 · 2문항/쪽</p>}
          <div className="document-toolbar-actions">
            <Button className="astryx-job-action" isDisabled={pdfPreview.pending || running} onClick={() => openPdfPreview(true)}
              icon={<RefreshCw size={16} aria-hidden="true" />} label={pdfPreview.error ? '다시 시도' : '미리보기 갱신'} />
            {pdfPreview.url && <Button className="astryx-job-action" href={pdfPreview.url} target="_blank" rel="noreferrer" label="PDF 새 탭에서 열기" />}
          </div>
          {pdfPreview.pending && <p className="muted" role="status">{pdfPreview.url ? '갱신 중 · 이전 미리보기' : 'PDF 생성 중'}</p>}
          {pdfPreview.error && <p className="notice error" role="alert">{pdfPreview.error}</p>}
          {!pdfPreview.pending && pdfPreview.url && !previewIsCurrent && <p className="muted" role="status">이전 미리보기</p>}
        </div>
        {pdfPreview.url && (pdfPreview.pages.length < pdfPreview.pageCount
          ? <iframe className="job-pdf-frame" src={pdfPreview.url} title="전체 PDF 미리보기" />
          : <div className="job-pdf-pages" aria-label="실제 출력 페이지">
            {pdfPreview.pages.map(page => <figure className="job-pdf-page" key={page.number}>
              <figcaption className="source-meta">{page.number} / {pdfPreview.pageCount}쪽</figcaption>
              <img src={`data:image/jpeg;base64,${page.jpegBase64}`} alt={`PDF 출력 미리보기 ${page.number}쪽`} loading={page.number === 1 ? 'eager' : 'lazy'} />
            </figure>)}
          </div>)}
      </>}
    </section>}
    {(tab === 'result' || tab === 'pdf') && <>
      {progress && nextQuestion && job.status === 'awaiting_next' &&
        <div className="question-next">
          <p>다음 시작 · {nextQuestion}</p>
          <Button className="astryx-job-action" variant="primary" isDisabled={busy} onClick={() => void allowNext(progress.completedCount)}
            label={permittedCount > 0 ? '이 묶음 이어서 작성' : `다음 ${nextCount}문항 허용`}
            endContent={<ArrowRight size={16} aria-hidden="true" />} />
        </div>}
      {incomplete && result && job.status === 'failed' &&
        <div className="question-next">
          <p>{nextQuestion} 작성에 실패했습니다.</p>
          <Button className="astryx-job-action" isDisabled={busy || unsaved} onClick={() => void onRun(job.id)}
            icon={<Play size={16} aria-hidden="true" />} label="이 묶음 이어서 작성" />
        </div>}
    </>}
    {tab === 'sources' && <SourceMaterials job={job} />}
    {tab === 'revisions' && <Revisions job={job} />}
    </div>
  </section>
  {editing && <aside className="context-rail review-rail" id="job-editor" aria-labelledby="job-editor-heading">
    <div className="editor-toolbar">
      <div className="editor-heading-row"><h2 id="job-editor-heading" ref={editorHeading} tabIndex={-1}>내용·디자인 편집</h2>
        <a className="text-button editor-preview-link" href="#job-result-preview">미리보기로 이동</a>
      </div>
      <TabList className="astryx-job-tabs" role="tablist" aria-label="편집 항목" hasDivider size="lg" value={editor}
        onChange={value => { if (value === 'content' || value === 'graph' || value === 'pdf') setEditor(value); }}>
        {editorChoices.map(choice => <Tab key={choice} id={`job-editor-${choice}`} value={choice}
          label={editorTabs[choice]} panelId="job-editor-panel" />)}
      </TabList>
      <div className="review-save-controls">
        <div className="review-actions"><Button className="astryx-job-action" variant="primary" width="100%" isDisabled={busy || !unsaved}
          onClick={() => void save()} icon={<Save size={16} aria-hidden="true" />} label="수정 저장" /></div>
        {unsaved && <div className="review-draft-status"><p className="source-meta" role="status">저장하지 않은 수정</p>
          <button type="button" className="text-button" disabled={busy} onClick={() => { setDraft(null); setPdfDraft(null); closeEditor(); }}>저장 전 수정 취소</button>
        </div>}
      </div>
    </div>
    <div id="job-editor-panel" role="tabpanel" aria-labelledby={`job-editor-${editor}`}>
    <fieldset className="editor-fields" disabled={busy} aria-label="현재 편집 항목">
      {editor === 'content' && <ResultEditor result={result} onChange={setDraft} supplement={job.mode === 'supplement'} onOpenSource={() => setTab('sources')} />}
      {!hidden && editor !== 'content' && <DesignReferencePicker disabled={busy} onApply={reference => {
        if (reference.pdfDesign) changePdfDesign(reference.pdfDesign);
        if (reference.curveColor) {
          const next = applyCurveAccent(result, reference.curveColor);
          if (next !== result) setDraft(next);
        }
      }} />}
      {editor === 'graph' && <GraphDesignEditor result={result} onChange={setDraft} allowRecipeEdit={needsReview}
        canRetry={!unsaved && !busy} onRetry={(questionNumber, stepId) => onRetryFigure(job.id, job.updatedAt, questionNumber, stepId)} />}
      {editor === 'pdf' && <PdfDesignPanel design={pdfDesign} onChange={changePdfDesign} busy={busy || needsReview || pdfPreview.pending} onPreview={() => openPdfPreview(true)} />}
    </fieldset>
    </div>
  </aside>}</div>;
}

function questionLabel(number: string | undefined, index: number): string {
  const label = number && studentQuestionNumber(number);
  return label ? `${label}번 문항` : `${index + 1}번째 문항`;
}

function SourceMaterials({ job }: { readonly job: Job }) {
  return <article className="document source-materials"><h2>올린 파일과 요청</h2>
    {job.inputText && <section><h3>입력한 문제</h3><p className="plain-prose">{job.inputText}</p></section>}
    {job.teacherText && <section className="step-origin"><h3>입력한 원래 풀이</h3><p className="plain-prose">{job.teacherText}</p></section>}
    {job.files.map(file => <section className="source-file" key={file.id}><h3>{file.role === 'handwriting' ? '선생님 손풀이' : '문제 파일'}</h3><a href={file.url} target="_blank" rel="noreferrer">{file.name}</a>{file.mimeType.startsWith('image/') && <img src={file.url} alt={file.role === 'handwriting' ? `원본 손풀이: ${file.name}` : `원본 문제: ${file.name}`} loading="lazy" width={1000} height={1200} />}</section>)}
    {job.instruction && <section><h3>추가 요청</h3><p className="plain-prose">{job.instruction}</p></section>}
  </article>;
}

function Revisions({ job }: { readonly job: Job }) {
  const [revisions, setRevisions] = useState<readonly Revision[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void api.revisions(job.id, controller.signal).then(next => { if (!controller.signal.aborted) setRevisions(next.revisions); }).catch(async (failure: unknown) => { if (!controller.signal.aborted) setError(await errorMessage(failure)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [job.id, job.updatedAt]);
  return <section className="revision-list"><h2>수정 이력</h2>{error && <p className="notice error" role="alert">{error}</p>}{loading ? <p role="status">기록을 불러오고 있습니다.</p> : revisions.length === 0 ? <p className="empty-note">이전 저장 기록이 없습니다.</p> : revisions.map(revision => <details key={revision.id}><summary>{new Date(revision.createdAt).toLocaleString('ko-KR')} · 이전 저장</summary>{revision.job.result ? <ResultDocument result={revision.job.result} supplement={revision.job.mode === 'supplement'}
    figureSource={{ jobId: job.id, version: revision.job.updatedAt, revisionId: revision.id }} /> : <p className="muted">풀이 작성 전의 기록입니다.</p>}</details>)}</section>;
}
