import { lazy, Suspense, useLayoutEffect, useRef } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { IconButton } from '@astryxdesign/core/IconButton';
import { MobileNavToggle } from '@astryxdesign/core/MobileNav';
import { useWorkspace } from './useWorkspace';
import { Sidebar, workspaceTitles } from './components/Sidebar';
import { NewJob } from './components/NewJob';
import { JobView } from './components/JobView';
import { HistoryView } from './components/HistoryView';
import { CriteriaView } from './components/CriteriaView';

const KnowledgeView = lazy(async () => ({ default: (await import('./components/KnowledgeView')).KnowledgeView }));
const DesignLibraryView = lazy(async () => ({ default: (await import('./components/DesignLibraryView')).DesignLibraryView }));

export function App() {
  const workspace = useWorkspace();
  const { bootstrap, job, view, busy, error } = workspace;
  const mainScroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { mainScroll.current?.scrollTo(0, 0); }, [view, job?.id]);
  const title = view === 'workspace' && job ? job.title : workspaceTitles[view];
  const sideNav = <Sidebar view={view} jobs={bootstrap?.jobs ?? []} activeId={job?.id} onView={workspace.setView} onNew={workspace.newJob} onOpen={id => void workspace.openJob(id)} />;
  return <AppShell className="astryx-lab" variant="elevated" contentPadding={0} sideNav={sideNav} mobileNav={{ hasToggle: false }}>
    <div className="app-main"><header className="topbar"><div className="topbar-title"><MobileNavToggle label="작업 메뉴 열기" /><h1 className="page-title">{title}</h1></div><div className="topbar-meta">
      {bootstrap && !bootstrap.apiConfigured && <span className="connection-status">풀이 작성 연결 필요</span>}
      <IconButton label="최신 기록 불러오기" icon={<RefreshCw size={17} />} variant="ghost" size="md" isDisabled={busy} onClick={() => void workspace.reload()} />
    </div></header><div className="main-scroll" ref={mainScroll}>
      {error && <div className="global-notice notice error" role="alert">{error}<button type="button" className="text-button" onClick={() => workspace.setError('')}>닫기</button></div>}
      {!bootstrap ? <div className="pending-state" role="status"><LoaderCircle className="spin" size={24} /><p>작업실을 준비하고 있습니다.</p>{error && <button type="button" className="button secondary" onClick={() => void workspace.reload()}>다시 불러오기</button>}</div> : <Suspense fallback={<p className="page-content muted" role="status">화면을 준비하고 있습니다.</p>}>
        {job && <JobView key={job.id} job={job} hidden={view !== 'workspace'} busy={busy} onRun={workspace.runJob} onNext={workspace.nextJob}
          onSave={workspace.saveJob} onCompleteReview={workspace.completeReview} onRetryFigure={workspace.retryFigure} />}
        {!job && <div hidden={view !== 'workspace'}><NewJob busy={busy} defaultDesignTitle={bootstrap.defaultDesignTitle ?? null} onCreate={async body => { await workspace.createJob(body); }} onDesignLibrary={() => workspace.setView('design-library')} /></div>}
        {view === 'history' && <HistoryView jobs={bootstrap.jobs} onOpen={id => void workspace.openJob(id)} onNew={workspace.newJob} />}
        {view === 'library' && <KnowledgeView catalogCount={bootstrap.catalogCount} cases={bootstrap.cases} onOpen={id => void workspace.openJob(id)} />}
        {view === 'criteria' && <CriteriaView text={bootstrap.criteria.text} />}
        {view === 'design-library' && <DesignLibraryView onDefaultChanged={() => void workspace.reload()} />}
      </Suspense>}
    </div></div>
  </AppShell>;
}
