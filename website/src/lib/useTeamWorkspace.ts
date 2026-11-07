import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { ApiError } from './api';
import type { Device, Dispatch, DispatchDetail, Member, Project, RuntimeConfig } from './contracts';
import { demoDevices, demoDispatchDetail, demoMembers, demoSharedProject } from '../data/teamDemo';

export function useTeamWorkspace(config: RuntimeConfig, mode: 'demo' | 'live') {
  const { api, user } = useAuth();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [tick, setTick] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedDispatch, setSelectedDispatch] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [detail, setDetail] = useState<DispatchDetail | null>(null);
  const project = projects.find((item) => item.id === selectedProject) ?? projects[0];
  const projectDispatches = dispatches.filter((item) => item.projectId === project?.id);
  const dispatch =
    projectDispatches.find((item) => item.id === selectedDispatch) ?? projectDispatches[0];
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPhase('loading');
    setError('');
    setProjects([]);
    setDevices([]);
    setDispatches([]);
    setMembers([]);
    setDetail(null);
    if (mode === 'demo') {
      setProjects([demoSharedProject]);
      setDevices(demoDevices);
      setDispatches([demoDispatchDetail.dispatch]);
      setPhase('ready');
      return () => controller.abort();
    }
    if (!user) {
      setPhase('signed-out');
      return () => controller.abort();
    }
    let received = false;
    const load = async () => {
      try {
        const [nextProjects, nextDevices, incoming, outgoing] = await Promise.all([
          api.projects(controller.signal),
          api.devices(controller.signal),
          api.dispatches('incoming', controller.signal),
          api.dispatches('outgoing', controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setProjects(nextProjects.projects);
        setDevices(nextDevices.devices);
        setDispatches(
          [
            ...new Map(
              [...incoming.dispatches, ...outgoing.dispatches].map((item) => [item.id, item]),
            ).values(),
          ].sort((a, b) => b.updatedAt - a.updatedAt),
        );
        setTick((value) => value + 1);
        setError('');
        setPhase('ready');
        received = true;
        timer = setTimeout(() => void load(), Math.max(5000, config.pollIntervalMs));
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'The shared workspace is unavailable.');
        if (!received || (cause instanceof ApiError && [401, 403].includes(cause.status))) {
          setProjects([]);
          setDevices([]);
          setDispatches([]);
          setDetail(null);
          setMembers([]);
          setPhase('error');
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [api, user, mode, config.pollIntervalMs, refreshKey]);
  useEffect(() => {
    setMembers([]);
  }, [project?.id]);
  useEffect(() => {
    const controller = new AbortController();
    if (!project) return () => controller.abort();
    if (mode === 'demo') {
      setMembers(demoMembers);
      return () => controller.abort();
    }
    void api
      .members(project.id, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setMembers(response.members);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          if (cause instanceof ApiError && [401, 403].includes(cause.status)) setMembers([]);
          setError(cause instanceof Error ? cause.message : 'Could not load project members.');
        }
      });
    return () => controller.abort();
  }, [api, mode, project?.id, tick]);
  useEffect(() => {
    const controller = new AbortController();
    setDetail((current) => (current?.dispatch.id === dispatch?.id ? current : null));
    if (!dispatch) return () => controller.abort();
    if (mode === 'demo') {
      setDetail(structuredClone(demoDispatchDetail));
      return () => controller.abort();
    }
    void api
      .dispatch(dispatch.id, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.dispatch.projectId !== project?.id)
          throw new Error('The server returned another project’s handoff.');
        // A snapshot started before a message POST may arrive after its acknowledgement.
        // v1 messages are append-only: retain acknowledged messages for this dispatch.
        setDetail((current) =>
          current?.dispatch.id === response.dispatch.id
            ? {
                ...response,
                messages: [
                  ...new Map(
                    [...current.messages, ...response.messages].map((message) => [
                      message.id,
                      message,
                    ]),
                  ).values(),
                ].sort((a, b) => a.createdAt - b.createdAt),
              }
            : response,
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          if (cause instanceof ApiError && [401, 403].includes(cause.status)) setDetail(null);
          setError(cause instanceof Error ? cause.message : 'Could not load this handoff.');
        }
      });
    return () => controller.abort();
  }, [api, mode, dispatch?.id, project?.id, tick]);
  return {
    api,
    user,
    phase,
    error,
    projects,
    project,
    devices,
    members,
    dispatches: projectDispatches,
    dispatch,
    detail,
    setDetail,
    setSelectedProject,
    setSelectedDispatch,
    refresh: () => setRefreshKey((value) => value + 1),
  };
}
