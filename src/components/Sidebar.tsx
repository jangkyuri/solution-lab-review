import { BookOpen, FileText, FolderOpen, History, Palette, Plus, Sigma } from 'lucide-react';
import { useAppShellMobile } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import type { Job } from '../../shared/contracts';
import type { View } from '../useWorkspace';
import { statusLabels } from '../api';

type Props = {
  readonly view: View; readonly jobs: readonly Job[]; readonly activeId: string | undefined;
  readonly onView: (view: View) => void; readonly onNew: () => void;
  readonly onOpen: (id: string) => void;
};

export const workspaceTitles = {
  workspace: '새 작업', history: '전체 작업 기록', library: '풀이 자료실',
  criteria: '풀이 작성 기준', 'design-library': '출력 디자인',
} as const satisfies Record<View, string>;

const navigation = [
  { id: 'workspace', label: '현재 작업', icon: FileText },
  { id: 'history', label: workspaceTitles.history, icon: History },
  { id: 'library', label: workspaceTitles.library, icon: FolderOpen },
  { id: 'criteria', label: workspaceTitles.criteria, icon: BookOpen },
  { id: 'design-library', label: workspaceTitles['design-library'], icon: Palette },
] as const;

export function Sidebar({ view, jobs, activeId, onView, onNew, onOpen }: Props) {
  const { closeMobileNav } = useAppShellMobile();
  return <SideNav aria-label="주 탐색" className="lab-side-nav"
    resizable={{ defaultWidth: 260, minWidth: 230, maxWidth: 360, autoSaveId: 'solution-lab-nav' }}
    header={<SideNavHeading heading="Solution Lab" subheading="풀이 연구실" icon={<span className="lab-brand-icon"><Sigma size={18} aria-hidden="true" /></span>} />}
    topContent={<Button label="새 작업" icon={<Plus size={17} />} variant="primary" className="lab-new-job" onClick={() => { onNew(); closeMobileNav(); }} />}>
    <SideNavSection title="작업 메뉴">
      {navigation.filter(item => item.id !== 'workspace' || activeId).map(item => <SideNavItem key={item.id}
        label={item.label} icon={<item.icon size={18} strokeWidth={1.8} />} isSelected={view === item.id}
        onClick={() => onView(item.id)} />)}
    </SideNavSection>
    <SideNavSection title="최근 작업" className="lab-recent-work">
      {jobs.length === 0 && <p className="empty-note">아직 저장된 작업이 없습니다.</p>}
      {jobs.slice(0, 8).map(item => <SideNavItem key={item.id} label={item.title}
        aria-label={`${item.title} ${statusLabels[item.status]}`} isSelected={view === 'workspace' && activeId === item.id}
        endContent={<span className="lab-recent-status" aria-hidden="true">{statusLabels[item.status]}</span>}
        onClick={() => onOpen(item.id)} />)}
    </SideNavSection>
  </SideNav>;
}
