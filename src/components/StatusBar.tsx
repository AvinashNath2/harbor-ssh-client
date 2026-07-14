interface StatusBarProps {
  host: string;
  ipAddr: string;
  osInfo: string;
  activeTransfers: number;
}

export function StatusBar({ host, ipAddr, osInfo, activeTransfers }: StatusBarProps) {
  return (
    <div className="flex h-[22px] flex-none items-center justify-between border-t border-border-raised bg-surface-toolbar px-4">
      <div className="flex items-center gap-2 font-mono text-[10.5px] text-text-tertiary">
        <span className="h-[5px] w-[5px] flex-shrink-0 rounded-full bg-success" />
        <span>
          {host}
          {ipAddr && ipAddr !== host ? ` (${ipAddr})` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2 font-mono text-[10.5px] text-text-faint">
        <span>SSH</span>
        <Dot />
        <span>{osInfo || "SFTP"}</span>
        {osInfo && (
          <>
            <Dot />
            <span>SFTP</span>
          </>
        )}
        {activeTransfers > 0 && (
          <>
            <Dot />
            <span style={{ color: "#3f7be0" }}>{activeTransfers} active</span>
          </>
        )}
      </div>
    </div>
  );
}

function Dot() {
  return <span className="text-border-raised">·</span>;
}
