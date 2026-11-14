import { FileText, ArrowUpRight } from 'lucide-react';
import type { Job } from '../../shared/contracts';
import { jobDate, statusLabels } from '../api';
import { ApiCostText } from './ApiCostText';

type Props = { readonly jobs: readonly Job[]; readonly onOpen: (id: string) => void; readonly onNew: () => void };

export function HistoryView({ jobs, onOpen, onNew }: Props) {
  return <section className="page-content">
    {jobs.length === 0 ? <div className="empty-state">
      <FileText size={30} strokeWidth={1.5} aria-hidden="true" />
      <h2>저장한 작업이 없습니다</h2>
      <button type="button" className="button primary" onClick={onNew}>새 작업</button>
    </div> : <>
      <div className="view-heading"><button type="button" className="button secondary" onClick={onNew}>새 작업</button></div>
      <div className="list-table">{jobs.map(job => <button type="button" className="list-row job-row" key={job.id} onClick={() => onOpen(job.id)}>
        <FileText size={20} /><span className="row-main"><strong>{job.title}</strong><small>{job.subject} · {job.mode === 'supplement' ? '손풀이 보강' : '새 풀이'} · {jobDate(job)}</small>
          {job.status !== 'draft' && <small><ApiCostText label="API 비용" cost={job.apiCost} running={job.status === 'running'} compact /></small>}
        </span>
        <span className={`badge ${job.status === 'approved' ? 'success' : 'neutral'}`}>{statusLabels[job.status]}</span><ArrowUpRight size={17} />
      </button>)}</div>
    </>}
  </section>;
}
