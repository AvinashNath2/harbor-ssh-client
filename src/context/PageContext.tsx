import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type CurrentPage = "terminal" | "docker" | "files" | "home";

export interface TerminalContext {
  cwd: string;
  connectedHost: string;
  lastCommand: string;
  lastOutputLines: string[];
}

export interface DockerContext {
  selectedNodeId: string | null;
  selectedNodeType: "container" | "network" | "volume" | null;
  selectedNodeJson: string | null;
  containerCount: number;
  networkCount: number;
  volumeCount: number;
}

export interface FileContext {
  filePath: string;
  fileName: string;
}

export interface PageContextValue {
  currentPage: CurrentPage;
  terminal: TerminalContext | null;
  docker: DockerContext | null;
  file: FileContext | null;
  setCurrentPage: (page: CurrentPage) => void;
  setTerminalContext: (ctx: TerminalContext | null) => void;
  setDockerContext: (ctx: DockerContext | null) => void;
  setFileContext: (ctx: FileContext | null) => void;
}

const PageContextObj = createContext<PageContextValue | null>(null);

export function PageContextProvider({ children }: { children: ReactNode }) {
  const [currentPage, setCurrentPage] = useState<CurrentPage>("home");
  const [terminal, setTerminal] = useState<TerminalContext | null>(null);
  const [docker, setDocker] = useState<DockerContext | null>(null);
  const [file, setFile] = useState<FileContext | null>(null);

  const setTerminalContext = useCallback((ctx: TerminalContext | null) => {
    setTerminal(ctx);
  }, []);
  const setDockerContext = useCallback((ctx: DockerContext | null) => {
    setDocker(ctx);
  }, []);
  const setFileContext = useCallback((ctx: FileContext | null) => {
    setFile(ctx);
  }, []);

  const value = useMemo<PageContextValue>(
    () => ({
      currentPage,
      terminal,
      docker,
      file,
      setCurrentPage,
      setTerminalContext,
      setDockerContext,
      setFileContext,
    }),
    [currentPage, terminal, docker, file, setTerminalContext, setDockerContext, setFileContext],
  );

  return <PageContextObj.Provider value={value}>{children}</PageContextObj.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePageContext(): PageContextValue {
  const ctx = useContext(PageContextObj);
  if (!ctx) throw new Error("usePageContext must be used inside <PageContextProvider>");
  return ctx;
}
