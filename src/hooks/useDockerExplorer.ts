import { useCallback, useEffect, useRef, useState } from "react";
import {
  dockerAvailable,
  dockerContainerInspect,
  dockerContainerLogs,
  dockerContainerStats,
  listComposeProjects,
  listDockerContainers,
  listDockerImages,
  listDockerNetworks,
  listDockerVolumes,
  type ComposeProject,
  type ContainerStats,
  type DockerContainer,
  type DockerImage,
  type DockerNetwork,
  type DockerVolume,
} from "../api";

export interface DockerState {
  available: boolean;
  loading: boolean;
  error: string | null;
  containers: DockerContainer[];
  images: DockerImage[];
  networks: DockerNetwork[];
  volumes: DockerVolume[];
  projects: ComposeProject[];
}

export function useDockerExplorer() {
  const [state, setState] = useState<DockerState>({
    available: true,
    loading: true,
    error: null,
    containers: [],
    images: [],
    networks: [],
    volumes: [],
    projects: [],
  });

  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const avail = await dockerAvailable();
      if (!avail) {
        if (mountedRef.current)
          setState((s) => ({ ...s, available: false, loading: false }));
        return;
      }
      const [containers, images, networks, volumes, projects] = await Promise.all([
        listDockerContainers().catch(() => [] as DockerContainer[]),
        listDockerImages().catch(() => [] as DockerImage[]),
        listDockerNetworks().catch(() => [] as DockerNetwork[]),
        listDockerVolumes().catch(() => [] as DockerVolume[]),
        listComposeProjects().catch(() => [] as ComposeProject[]),
      ]);
      if (mountedRef.current) {
        setState({
          available: true,
          loading: false,
          error: null,
          containers,
          images,
          networks,
          volumes,
          projects,
        });
      }
    } catch (e) {
      if (mountedRef.current) {
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchAll();
    const interval = setInterval(() => {
      void fetchAll();
    }, 15000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchAll]);

  return {
    ...state,
    refresh: fetchAll,
    getLogs: dockerContainerLogs,
    getStats: dockerContainerStats,
    getInspect: dockerContainerInspect,
  };
}

export type { ContainerStats };
