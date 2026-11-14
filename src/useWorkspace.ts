import { useEffect, useState } from 'react';
import type { Bootstrap, Job, SolutionResult } from '../shared/contracts';
import type { PdfDesign } from '../shared/pdf-design';
import { api, errorMessage } from './api';

export type View = 'workspace' | 'history' | 'library' | 'criteria' | 'design-library';

function replaceSavedJob(snapshot: Bootstrap | null, next: Job): Bootstrap | null {
  if (!snapshot) return null;
  return { ...snapshot, jobs: snapshot.jobs.map(item => item.id === next.id ? next : item) };
}

export function useWorkspace() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [view, setView] = useState<View>('workspace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh(): Promise<void> {
    setBootstrap(await api.bootstrap());
  }

  async function perform(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError('');
    try { await action(); return true; }
    catch (failure) { setError(await errorMessage(failure)); return false; }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void api.bootstrap(controller.signal).then(setBootstrap).catch(async (failure: unknown) => {
      if (!controller.signal.aborted) setError(await errorMessage(failure));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const jobId = job.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(): Promise<void> {
      try {
        const next = await api.job(jobId, controller.signal);
        if (controller.signal.aborted) return;
        if (next.status !== 'running') {
          setBootstrap(current => replaceSavedJob(current, next));
        }
        setJob(next);
        if (next.status === 'running') timer = setTimeout(() => void poll(), 2000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        const message = await errorMessage(failure);
        if (controller.signal.aborted) return;
        setError(message);
        timer = setTimeout(() => void poll(), 4000);
      }
    }
    timer = setTimeout(() => void poll(), 2000);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [job?.id, job?.status]);

  return {
    bootstrap, job, view, busy, error, setView, setError,
    newJob: () => { setJob(null); setView('workspace'); setError(''); },
    reload: () => perform(refresh),
    openJob: (id: string) => perform(async () => {
      const opened = await api.job(id);
      setJob(opened);
      setBootstrap(current => replaceSavedJob(current, opened));
      setView('workspace');
    }),
    createJob: (body: FormData) => perform(async () => { setJob(await api.create(body)); await refresh(); }),
    runJob: (id: string) => perform(async () => {
      const started = await api.run(id);
      setJob(started);
      setBootstrap(current => replaceSavedJob(current, started));
    }),
    nextJob: (id: string, completedCount: number) => perform(async () => {
      const started = await api.next(id, completedCount);
      setJob(started);
      setBootstrap(current => replaceSavedJob(current, started));
    }),
    completeReview: (id: string, updatedAt: string) => perform(async () => {
      const reviewed = await api.completeReview(id, updatedAt);
      setJob(reviewed);
      setBootstrap(current => replaceSavedJob(current, reviewed));
    }),
    retryFigure: (id: string, updatedAt: string, questionNumber: string, stepId: string) => perform(async () => {
      try {
        const saved = await api.retryFigure(id, updatedAt, questionNumber, stepId);
        setJob(current => current?.id === id ? saved : current);
        setBootstrap(current => replaceSavedJob(current, saved));
      } catch (failure) {
        const saved = await api.job(id).catch(() => null);
        if (saved) {
          setJob(current => current?.id === id ? saved : current);
          setBootstrap(current => replaceSavedJob(current, saved));
        }
        throw failure;
      }
    }),
    saveJob: (id: string, result: SolutionResult | null, reviewNote: string, pdfDesign?: PdfDesign) => perform(async () => {
      const note = pdfDesign && !result && job?.id === id && job.reviewNote === reviewNote ? undefined : reviewNote;
      const saved = await api.save(id, result, note, pdfDesign);
      setJob(saved);
      setBootstrap(current => replaceSavedJob(current, saved));
    }),
  };
}
