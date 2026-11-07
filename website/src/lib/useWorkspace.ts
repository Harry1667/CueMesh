import { useEffect, useState } from 'react';
import { demoProjects, demoRuns, getDemoDetail } from '../data/demo';
import { ApiError } from './api';
import { useAuth } from './auth';
import type { Project, Run, RunDetail, RuntimeConfig } from './contracts';

export function useWorkspace(config: RuntimeConfig, mode: 'demo' | 'live') {
  const { api, user } = useAuth();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState('');
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncError, setSyncError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setPhase('loading');
    setError('');
    setSyncError('');
    setProjects([]);
    setRuns([]);
    setDetail(null);
    setProjectId('');
    setRunId('');
    if (mode === 'demo') {
      setProjects(demoProjects);
      setProjectId(demoProjects[0].id);
      setPhase('ready');
      return () => controller.abort();
    }
    if (!user) {
      setPhase('signed-out');
      return () => controller.abort();
    }
    void api
      .projects(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setProjects(response.projects);
        setProjectId(response.projects[0]?.id ?? '');
        setPhase('ready');
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not load the workspace.');
          setPhase('error');
        }
      });
    return () => controller.abort();
  }, [api, user, mode, refreshKey]);
  useEffect(() => {
    const controller = new AbortController();
    setRuns([]);
    setRunId('');
    setDetail(null);
    setSyncError('');
    setRunsLoading(false);
    setDetailLoading(false);
    if (!projectId || phase !== 'ready') return () => controller.abort();
    setRunsLoading(true);
    if (mode === 'demo') {
      const next = demoRuns.filter((run) => run.projectId === projectId);
      setRuns(next);
      setRunId(next[0]?.id ?? '');
      setRunsLoading(false);
      return () => controller.abort();
    }
    void api
      .runs(projectId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.runs.some((run) => run.projectId !== projectId))
          throw new Error('The server returned runs for another project.');
        setRuns(response.runs);
        setRunId(response.runs[0]?.id ?? '');
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
            setProjects([]);
            setError('Access to this project ended.');
            setPhase('error');
          } else setSyncError(cause instanceof Error ? cause.message : 'Could not load runs.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRunsLoading(false);
      });
    return () => controller.abort();
  }, [api, mode, projectId, phase]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setDetail(null);
    setSyncError('');
    setDetailLoading(false);
    if (!runId) return () => controller.abort();
    setDetailLoading(true);
    if (mode === 'demo') {
      setDetail(getDemoDetail(runId));
      setDetailLoading(false);
      return () => controller.abort();
    }
    const load = async () => {
      try {
        const next = await api.detail(runId, controller.signal);
        if (controller.signal.aborted) return;
        if (next.run.projectId !== projectId)
          throw new Error('The server returned a run from another project.');
        setDetail(next);
        setSyncError('');
        setDetailLoading(false);
        setRuns((current) => current.map((run) => (run.id === next.run.id ? next.run : run)));
        if (['planning', 'running'].includes(next.run.status))
          timer = setTimeout(() => void load(), config.pollIntervalMs);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setDetailLoading(false);
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
          setDetail(null);
          setRuns([]);
          setProjects([]);
          setError('Access to this project ended.');
          setPhase('error');
        } else setSyncError(cause instanceof Error ? cause.message : 'Could not refresh this run.');
      }
    };
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [api, mode, runId, projectId, config.pollIntervalMs]);
  const session = {
    user:
      mode === 'demo'
        ? { id: 'demo-user', name: 'Your workspace', email: 'demo@example.com' }
        : user
          ? { id: user.id, name: user.displayName, email: user.email }
          : null,
  };
  return {
    api,
    phase,
    error,
    session,
    projects,
    projectId,
    setProjectId,
    runs,
    runId,
    setRunId,
    detail,
    runsLoading,
    detailLoading,
    syncError,
    retry: () => setRefreshKey((value) => value + 1),
  };
}
