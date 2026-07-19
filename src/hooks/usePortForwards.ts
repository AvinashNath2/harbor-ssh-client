import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { listPortForwards, startPortForward, stopPortForward, type PortForward } from "../api";

export function usePortForwards() {
  const [tunnels, setTunnels] = useState<PortForward[]>([]);
  const [tunnelError, setTunnelError] = useState<string | null>(null);

  useEffect(() => {
    void listPortForwards()
      .then(setTunnels)
      .catch(() => undefined);

    const unlistenError = listen<{ id: string; message: string }>("pf-error", ({ payload }) => {
      setTunnelError(`Tunnel error: ${payload.message}`);
    });

    return () => {
      void unlistenError.then((fn) => {
        fn();
      });
    };
  }, []);

  async function addTunnel(localPort: number, remoteHost: string, remotePort: number) {
    const id = `pf-${String(Date.now())}`;
    const tunnel: PortForward = { id, localPort, remoteHost, remotePort };
    setTunnels((prev) => [...prev, tunnel]);
    setTunnelError(null);
    try {
      await startPortForward(id, localPort, remoteHost, remotePort);
    } catch (e) {
      setTunnels((prev) => prev.filter((t) => t.id !== id));
      setTunnelError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeTunnel(id: string) {
    await stopPortForward(id);
    setTunnels((prev) => prev.filter((t) => t.id !== id));
  }

  function clearTunnelError() {
    setTunnelError(null);
  }

  return { tunnels, tunnelError, addTunnel, removeTunnel, clearTunnelError };
}
