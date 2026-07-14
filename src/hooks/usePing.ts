import { useCallback, useEffect, useState } from "react";
import { ping, type PingResponse } from "../api";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: PingResponse }
  | { status: "error"; message: string };

export function usePing() {
  const [state, setState] = useState<State>({ status: "idle" });

  const run = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await ping();
      setState({ status: "ok", data });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return { state, retry: run };
}
