import { useCallback, useEffect, useRef, useState } from "react";
import {
  dockerAllContainerStats,
  dockerAllMounts,
  dockerAvailable,
  dockerContainerEvents,
  dockerContainerInspect,
  dockerContainerLogs,
  dockerContainerStats,
  listComposeProjects,
  listDockerContainers,
  listDockerImages,
  listDockerNetworks,
  listDockerVolumes,
  type ComposeProject,
  type ContainerMountInfo,
  type ContainerStats,
  type DockerContainer,
  type DockerImage,
  type DockerNetwork,
  type DockerVolume,
  type MountEntry,
} from "../api";

export interface DockerLogEntry {
  id: number;
  ts: number;
  cycle: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  detail?: string;
}

export interface DockerState {
  available: boolean;
  loading: boolean;
  error: string | null;
  containers: DockerContainer[];
  images: DockerImage[];
  networks: DockerNetwork[];
  volumes: DockerVolume[];
  projects: ComposeProject[];
  /** Keyed by container name (without leading slash) */
  allStats: Map<string, ContainerStats>;
  /** Real mount data from `docker inspect` — enables container→volume edges */
  allMounts: ContainerMountInfo[];
  logs: DockerLogEntry[];
}

let _logId = 0;
let _fetchCycle = 0;
const MAX_LOGS = 300;

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
    allStats: new Map(),
    allMounts: [],
    logs: [],
  });

  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const cycle = ++_fetchCycle;
    const newLogs: DockerLogEntry[] = [];
    const t0 = Date.now();
    const addLog = (entry: Omit<DockerLogEntry, "id" | "ts" | "cycle">) => {
      newLogs.push({ id: ++_logId, ts: Date.now(), cycle, ...entry });
    };

    const safe = <T>(p: Promise<T>, fallback: T): Promise<{ data: T; err: string | null }> =>
      p
        .then((data) => ({ data, err: null as string | null }))
        .catch((e: unknown) => ({
          data: fallback,
          err: e instanceof Error ? e.message : String(e),
        }));

    addLog({ level: "info", source: "fetch", message: "Docker data fetch started" });
    addLog({ level: "info", source: "cmd", message: "docker ps -a --format '{{json .}}'" });
    addLog({ level: "info", source: "cmd", message: "docker images --format '{{json .}}'" });
    addLog({ level: "info", source: "cmd", message: "docker network ls --format '{{json .}}'" });
    addLog({ level: "info", source: "cmd", message: "docker volume ls --format '{{json .}}'" });
    addLog({ level: "info", source: "cmd", message: "docker compose ls --format json" });
    addLog({
      level: "info",
      source: "cmd",
      message: "docker stats --no-stream --format '{{json .}}'",
    });
    addLog({ level: "info", source: "cmd", message: "docker inspect <each container>" });

    try {
      const avail = await dockerAvailable();
      if (!avail) {
        addLog({ level: "warn", source: "fetch", message: "Docker is not available on this host" });
        if (mountedRef.current)
          setState((s) => ({
            ...s,
            available: false,
            loading: false,
            logs: [...s.logs.slice(-(MAX_LOGS - newLogs.length)), ...newLogs],
          }));
        return;
      }

      const [
        { data: containersRaw, err: cErr },
        { data: imagesRaw, err: iErr },
        { data: networksRaw, err: nErr },
        { data: volumesRaw, err: vErr },
        { data: projects, err: pErr },
        { data: statsArr, err: sErr },
        { data: mountsArr, err: mErr },
      ] = await Promise.all([
        safe(listDockerContainers(), [] as DockerContainer[]),
        safe(listDockerImages(), [] as DockerImage[]),
        safe(listDockerNetworks(), [] as DockerNetwork[]),
        safe(listDockerVolumes(), [] as DockerVolume[]),
        safe(listComposeProjects(), [] as ComposeProject[]),
        safe(dockerAllContainerStats(), [] as ContainerStats[]),
        safe(dockerAllMounts(), [] as ContainerMountInfo[]),
      ]);

      // Defensive: drop records with missing / non-string identifiers
      const containers = containersRaw.filter(
        (c) =>
          typeof c.id === "string" && typeof c.name === "string" && typeof c.image === "string",
      );
      const images = imagesRaw.filter((i) => typeof i.id === "string");
      const networks = networksRaw.filter(
        (n) => typeof n.id === "string" && typeof n.name === "string",
      );
      const volumes = volumesRaw.filter((v) => typeof v.name === "string" && v.name.length > 0);
      const allStats = new Map(
        statsArr.filter((s) => typeof s.name === "string").map((s) => [s.name, s]),
      );

      // Log each source result — show raw (from CLI) → filtered (passed validation)
      if (cErr) {
        addLog({ level: "error", source: "containers", message: cErr });
      } else {
        const dropped = containersRaw.length - containers.length;
        addLog({
          level: dropped > 0 ? "warn" : "info",
          source: "containers",
          message: `raw=${String(containersRaw.length)} → kept=${String(containers.length)}${dropped > 0 ? ` (${String(dropped)} dropped — missing id/name/image)` : ""}`,
          detail: JSON.stringify(containers.slice(0, 3), null, 2),
        });
      }

      if (iErr) {
        addLog({ level: "error", source: "images", message: iErr });
      } else {
        const dropped = imagesRaw.length - images.length;
        addLog({
          level: dropped > 0 ? "warn" : "info",
          source: "images",
          message: `raw=${String(imagesRaw.length)} → kept=${String(images.length)}${dropped > 0 ? ` (${String(dropped)} dropped — id field missing/wrong type)` : ""}`,
          detail: JSON.stringify(images.slice(0, 3), null, 2),
        });
      }

      if (nErr) {
        addLog({ level: "error", source: "networks", message: nErr });
      } else {
        const dropped = networksRaw.length - networks.length;
        addLog({
          level: dropped > 0 ? "warn" : "info",
          source: "networks",
          message: `raw=${String(networksRaw.length)} → kept=${String(networks.length)}${dropped > 0 ? ` (${String(dropped)} dropped — id/name field missing)` : ""}`,
          detail: JSON.stringify(networks.slice(0, 3), null, 2),
        });
      }

      if (vErr) {
        addLog({ level: "error", source: "volumes", message: vErr });
      } else {
        const dropped = volumesRaw.length - volumes.length;
        addLog({
          level: dropped > 0 ? "warn" : "info",
          source: "volumes",
          message: `raw=${String(volumesRaw.length)} → kept=${String(volumes.length)}${dropped > 0 ? ` (${String(dropped)} dropped — name field missing)` : ""}`,
          detail: JSON.stringify(volumes.slice(0, 3), null, 2),
        });
      }

      if (pErr) {
        addLog({ level: "error", source: "compose", message: pErr });
      } else {
        addLog({
          level: "info",
          source: "compose",
          message: `${String(projects.length)} compose project${projects.length !== 1 ? "s" : ""}`,
          detail: JSON.stringify(projects, null, 2),
        });
      }

      if (sErr) {
        addLog({ level: "error", source: "stats", message: sErr });
      } else {
        addLog({
          level: "info",
          source: "stats",
          message: `raw=${String(statsArr.length)} → keyed=${String(allStats.size)} entries in map`,
          detail: JSON.stringify(statsArr.slice(0, 3), null, 2),
        });
      }

      if (mErr) {
        addLog({ level: "error", source: "mounts", message: mErr });
      } else {
        const totalMounts = mountsArr.reduce((s, m) => s + m.mounts.length, 0);
        addLog({
          level: "info",
          source: "mounts",
          message: `${String(mountsArr.length)} containers inspected · ${String(totalMounts)} total mount entries`,
          detail: JSON.stringify(mountsArr.slice(0, 2), null, 2),
        });
      }

      addLog({
        level: "info",
        source: "fetch",
        message: `Fetch complete in ${String(Date.now() - t0)}ms`,
      });

      if (mountedRef.current) {
        setState((s) => ({
          available: true,
          loading: false,
          error: null,
          containers,
          images,
          networks,
          volumes,
          projects,
          allStats,
          allMounts: mountsArr,
          logs: [...s.logs.slice(-(MAX_LOGS - newLogs.length)), ...newLogs],
        }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog({ level: "error", source: "fetch", message: `Fatal: ${msg}` });
      if (mountedRef.current) {
        setState((s) => ({
          ...s,
          loading: false,
          error: msg,
          logs: [...s.logs.slice(-(MAX_LOGS - newLogs.length)), ...newLogs],
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
    getEvents: dockerContainerEvents,
  };
}

export type { ContainerStats, ContainerMountInfo, MountEntry };
