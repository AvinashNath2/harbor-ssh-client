import { useCallback, useState } from "react";
import {
  connect as apiConnect,
  disconnect as apiDisconnect,
  type AppError,
  type ConnectArgs,
  type ConnectResult,
} from "../api";

type ConnectionState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "connected"; result: ConnectResult }
  | { status: "error"; error: AppError };

export function useConnection() {
  const [state, setState] = useState<ConnectionState>({ status: "idle" });

  const connect = useCallback(async (args: ConnectArgs) => {
    setState({ status: "connecting" });
    try {
      const result = await apiConnect(args);
      setState({ status: "connected", result });
    } catch (err: unknown) {
      setState({
        status: "error",
        error: isAppError(err) ? err : { code: "INTERNAL", message: String(err) },
      });
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await apiDisconnect();
    } finally {
      setState({ status: "idle" });
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return { state, connect, disconnect, reset };
}

function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}
