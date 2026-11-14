import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import type { KnowledgeLibrary, KnowledgeProblem } from '../../shared/knowledge';
import type { CatalogEntry, ApprovedCase } from '../../shared/contracts';
import { api, errorMessage } from '../api';
import { MathText } from './MathText';

type Pane = 'records' | 'catalog' | 'reviewed';
type Props = { readonly catalogCount: number; readonly cases: readonly ApprovedCase[]; readonly onOpen: (id: string) => void };

export function KnowledgeView({ catalogCount, cases, onOpen }: Props) {
  const [pane, setPane] = useState<Pane>('records');
  const [library, setLibrary] = useState<KnowledgeLibrary | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [recordFilter, setRecordFilter] = useState('');
  const [catalogFilter, setCatalogFilter] = useState('');
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [entries, setEntries] = useState<readonly CatalogEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const detailHeading = useRef<HTMLHeadingElement>(null);

  function selectRecord(sampleId: string): void {
    setSelectedId(sampleId);
    if (!window.matchMedia('(max-width: 1099px)').matches) return;
    requestAnimationFrame(() => {
      detailHeading.current?.focus({ preventScroll: true });
      detailHeading.current?.scrollIntoView({ block: 'start' });
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    void api.knowledge(controller.signal).then(setLibrary).catch(async (failure: unknown) => {
      if (!controller.signal.aborted) setError(await errorMessage(failure));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (pane !== 'catalog') return;
    const controller = new AbortController();
    setLoading(true);
    void api.library(query, subject, controller.signal).then(next => {
      if (!controller.signal.aborted) { setEntries(next.entries); setError(''); }
    }).catch(async (failure: unknown) => {
      if (!controller.signal.aborted) setError(await errorMessage(failure));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pane, query, subject]);

  const matching = (library?.problems ?? []).filter(problem => `${problem.sampleId} ${problem.title} ${problem.centralArgument}`.toLocaleLowerCase('ko-KR').includes(recordFilter.toLocaleLowerCase('ko-KR')));
  const selected = matching.find(problem => problem.sampleId === selectedId) ?? matching[0];

  return <section className="page-content library-view">
    <div className="mode-tabs" aria-label="자료 종류">
      <button type="button" className={pane === 'records' ? 'active' : ''} aria-pressed={pane === 'records'} onClick={() => setPane('records')}>원본 풀이 분석 {library?.summary.problemCount ?? ''}</button>
      <button type="button" className={pane === 'catalog' ? 'active' : ''} aria-pressed={pane === 'catalog'} onClick={() => setPane('catalog')}>원본 파일 찾기 {catalogCount}</button>
      <button type="button" className={pane === 'reviewed' ? 'active' : ''} aria-pressed={pane === 'reviewed'} onClick={() => setPane('reviewed')}>검토 완료한 작업 {cases.length}</button>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {pane === 'records' && <>
      {library?.warning && <p className="notice warning" role="status">{library.warning}</p>}
      <label className="search-row"><Search size={18} /><span className="sr-only">풀이 기록 찾기</span><input type="search" value={recordFilter} onChange={event => setRecordFilter(event.currentTarget.value)} placeholder="문항 번호나 중심 발상으로 찾기" /></label>
      {!library ? <p className="muted" role="status">풀이 기록을 불러오고 있습니다.</p> : <div className="record-layout">
        <nav className="record-list" aria-label="분석 문항">{matching.map(problem => <button key={problem.sampleId} type="button" onClick={() => selectRecord(problem.sampleId)} className={selected?.sampleId === problem.sampleId ? 'active' : ''} aria-current={selected?.sampleId === problem.sampleId ? 'true' : undefined}>
          <span className="eyebrow">{problem.sampleId}</span><strong>{problem.title}</strong><small>{problem.steps.length}단계 · 보충 {problem.supplements.length}항목</small>
        </button>)}{matching.length === 0 && <p className="empty-note">풀이 기록이 없습니다.</p>}</nav>
        {selected && <KnowledgeDetail key={selected.sampleId} problem={selected} headingRef={detailHeading} />}
      </div>}
    </>}
    {pane === 'catalog' && <>
      <form className="search-row" onSubmit={event => { event.preventDefault(); setQuery(catalogFilter); }}><Search size={18} /><label className="sr-only" htmlFor="catalog-query">자료 찾기</label><input id="catalog-query" type="search" value={catalogFilter} onChange={event => setCatalogFilter(event.currentTarget.value)} placeholder="자료명이나 과목으로 찾기" /><label className="sr-only" htmlFor="catalog-subject">과목</label><select id="catalog-subject" value={subject} onChange={event => setSubject(event.currentTarget.value)}><option value="">전체 과목</option><option>미적1</option><option>대수</option><option>공통수학</option></select><button type="submit" className="button secondary">찾기</button></form>
      {loading ? <p role="status" className="muted">자료 목록을 찾고 있습니다.</p> : <div className="list-table">{entries.map(entry => <a className="list-row catalog-row" key={entry.id} href={entry.url} target="_blank" rel="noreferrer"><span className="row-main"><strong>{entry.title}</strong><small>{entry.subject} · {entry.mimeType === 'application/pdf' ? 'PDF' : '이미지'} · {entry.path}</small></span><span className="badge neutral">{entry.contentReviewed ? '본문 기록 있음' : '목록 확인'}</span><ArrowUpRight size={16} /></a>)}{entries.length === 0 && <p className="empty-note">찾은 자료가 없습니다.</p>}</div>}
    </>}
    {pane === 'reviewed' && <>
      <div className="list-table">{cases.map(item => <button type="button" className="list-row" key={item.id} onClick={() => onOpen(item.sourceJobId)}><span className="row-main"><strong>{item.title}</strong><small>{item.subject}</small></span><ArrowUpRight size={17} /></button>)}{cases.length === 0 && <p className="empty-note">검토를 완료한 작업이 아직 없습니다.</p>}</div>
    </>}
  </section>;
}

function KnowledgeDetail({ problem, headingRef }: { readonly problem: KnowledgeProblem; readonly headingRef: Ref<HTMLHeadingElement> }) {
  return <article className="record-detail"><header className="document-header"><span className="eyebrow">{problem.sampleId}</span><h2 ref={headingRef} tabIndex={-1}>{problem.title}</h2><p><MathText text={problem.centralArgument} /></p></header>
    <section className="original-core"><h3>원본 풀이</h3>
      {problem.steps.map(step => <section className="record-step" key={step.stepId}><h4>{step.stepId}</h4><p className="source-meta">{step.after.length ? `연결된 앞 단계: ${step.after.join(', ')}` : '독립된 출발 단계'}{step.branch ? ` · ${branchLabel(step.branch)}` : ''}</p><p><MathText text={step.mathematicalContent} /></p><details><summary>원본에서 확인한 표시</summary><p><MathText text={step.sourceEvidence} /></p></details></section>)}
    </section>
    <section className="supplement-needs"><h3>단계에 붙일 보충 설명</h3>{problem.supplements.map(item => <section className="record-step" key={item.gapId}><h4>{item.gapId} <small>{item.atStep}에 연결</small></h4><p><strong>막히는 지점</strong> <MathText text={item.studentObstacle} /></p><p><strong>최소 보충</strong> <MathText text={item.minimumSupplement} /></p>{item.verification && <p className="evidence-line"><strong>확인 근거</strong><MathText text={item.verification} /></p>}</section>)}</section>
    {problem.graphEquationLinks.length > 0 && <section><h3>그래프와 식의 연결</h3><ul className="graph-links">{problem.graphEquationLinks.map((link, index) => <li key={index}><MathText text={link.description} /><small>{[link.atStep, link.fromStep, link.toStep].filter(Boolean).join(' · ')}</small></li>)}</ul></section>}
    {problem.preserve.length > 0 && <section><h3>보존할 풀이 방식</h3><ul>{problem.preserve.map((item, index) => <li key={index}><MathText text={item} /></li>)}</ul></section>}
    {problem.needsUserInput.length > 0 && <div className="notice warning"><h3>선생님께 확인할 부분</h3><ul>{problem.needsUserInput.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
  </article>;
}

function branchLabel(branch: string): string {
  const labels: Readonly<Record<string, string>> = { main: '본 풀이', main_join: '조건 합류', parallel_condition_b: '병렬 조건', separate_alternative: '별도 관점', condition_a: '첫 번째 조건', condition_b: '두 번째 조건' };
  return labels[branch] ?? `별도 분기 (${branch})`;
}
