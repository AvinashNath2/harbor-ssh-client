import {
  ChevronLeft,
  ChevronRight,
  Download as DownloadIcon,
  Pencil,
  Plus,
  Search,
  Settings,
  Star,
  User,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ConnectionProfile } from "../api";
import { relativeTime } from "../utils/relativeTime";

// ── Folder color mapping ───────────────────────────────────────────────────────

const FOLDER_COLOR_MAP: [RegExp, string][] = [
  [/prod/i, "#e5534b"],
  [/stag/i, "#e0a53c"],
  [/dev/i, "#3f7be0"],
  [/personal/i, "#9b59b6"],
  [/local/i, "#1abc9c"],
];

function folderColor(folder: string): string {
  for (const [pattern, color] of FOLDER_COLOR_MAP) {
    if (pattern.test(folder)) return color;
  }
  return "#8a8578";
}

function folderKey(folder: string): string {
  return folder.toLowerCase();
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarProps {
  profiles: ConnectionProfile[];
  activeHost: string | null;
  activeProfileId?: string | null;
  width?: number;
  onSelectProfile: (profile: ConnectionProfile) => void;
  onEditProfile: (profile: ConnectionProfile) => void;
  onNewSession: () => void;
  onDeleteProfile: (id: string) => void;
  onStarProfile: (profile: ConnectionProfile) => void;
  onNewSessionInFolder: (folder: string) => void;
  onImportSshConfig: () => void;
  onHide?: () => void;
}

export function Sidebar({
  profiles,
  activeHost,
  activeProfileId,
  width,
  onSelectProfile,
  onEditProfile,
  onNewSession,
  onDeleteProfile,
  onStarProfile,
  onNewSessionInFolder,
  onImportSshConfig,
  onHide,
}: SidebarProps) {
  const [search, setSearch] = useState("");

  const filtered = profiles.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.host.toLowerCase().includes(search.toLowerCase()),
  );

  const favorites = filtered.filter((p) => p.favorite);

  // Group ALL filtered profiles by folder.
  const groupsMap = new Map<string, ConnectionProfile[]>();
  for (const p of filtered) {
    const folder = p.folder ?? "General";
    const existing = groupsMap.get(folder) ?? [];
    existing.push(p);
    groupsMap.set(folder, existing);
  }
  // Sort folders alphabetically, with "General" last.
  const groups = Array.from(groupsMap.entries()).sort((a, b) => {
    if (a[0] === "General") return 1;
    if (b[0] === "General") return -1;
    return a[0].localeCompare(b[0]);
  });

  // Default: all folders expanded.
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [rootExpanded, setRootExpanded] = useState(true);

  function toggleFolder(folder: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      const k = folderKey(folder);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  // Prefer an explicit profile ID (avoids false match when two profiles share the same host+port).
  // Fall back to host matching for connections opened without a saved profile.
  const resolvedActiveId = useMemo(
    () => activeProfileId ?? profiles.find((p) => activeHost === p.host)?.id ?? null,
    [profiles, activeHost, activeProfileId],
  );

  return (
    <div
      className="flex flex-none flex-col border-r border-border bg-surface-sidebar"
      style={{ width: width ?? 250 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-3.5">
        <span className="text-[13px] font-semibold text-text-primary">Sessions</span>
        <span className="font-mono text-[11px] text-text-faint">{profiles.length}</span>
        <div className="flex-1" />
        {onHide && (
          <button
            onClick={onHide}
            title="Hide sidebar"
            className="flex h-6 w-6 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
          >
            <ChevronLeft size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* New Session button */}
      <div className="px-3">
        <button
          onClick={onNewSession}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-input text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{
            background: "linear-gradient(150deg, #3f7be0, #2f6bdb)",
            boxShadow: "0 4px 12px -4px rgba(47,107,219,0.5)",
          }}
        >
          <Plus size={16} strokeWidth={2.4} />
          New Session
        </button>
      </div>

      {/* Search */}
      <div className="mt-2.5 px-3">
        <div className="flex h-[34px] items-center gap-2 rounded-input border border-border-input bg-surface-pane px-3">
          <Search size={13} strokeWidth={2} className="text-text-faint" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search hosts…"
            className="flex-1 bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-faint"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="mt-3 flex flex-1 flex-col gap-0 overflow-auto px-2 pb-2">
        {profiles.length === 0 && (
          <p className="px-2 pt-4 text-center text-[12px] text-text-faint">
            No saved sessions.
            <br />
            Click New Session to add one.
          </p>
        )}

        {profiles.length > 0 && filtered.length === 0 && (
          <p className="px-2 pt-4 text-center text-[12px] text-text-faint">
            No results for &ldquo;{search}&rdquo;
          </p>
        )}

        {/* Favorites */}
        {favorites.length > 0 && (
          <TreeSection
            label={
              <>
                <Star size={11} strokeWidth={2.4} fill="currentColor" />
                <span>Favorites</span>
              </>
            }
          >
            {favorites.map((profile) => (
              <SessionRow
                key={`fav-${profile.id}`}
                profile={profile}
                depth={1}
                isActive={resolvedActiveId === profile.id}
                folderDotColor={folderColor(profile.folder ?? "General")}
                onSelect={() => {
                  onSelectProfile(profile);
                }}
                onEdit={() => {
                  onEditProfile(profile);
                }}
                onDelete={() => {
                  onDeleteProfile(profile.id);
                }}
                onStar={() => {
                  onStarProfile(profile);
                }}
              />
            ))}
          </TreeSection>
        )}

        {/* Root tree */}
        {groups.length > 0 && (
          <div className="mt-1">
            <TreeCaret
              expanded={rootExpanded}
              onClick={() => {
                setRootExpanded((v) => !v);
              }}
              label="Root"
              depth={0}
              bold
            />
            {rootExpanded &&
              groups.map(([folder, items]) => {
                const isCollapsed = collapsedFolders.has(folderKey(folder));
                return (
                  <div key={folder}>
                    <TreeCaret
                      expanded={!isCollapsed}
                      onClick={() => {
                        toggleFolder(folder);
                      }}
                      label={folder}
                      count={items.length}
                      depth={1}
                      dotColor={folderColor(folder)}
                    />
                    {!isCollapsed && (
                      <>
                        {items.map((profile) => (
                          <SessionRow
                            key={profile.id}
                            profile={profile}
                            depth={2}
                            isActive={resolvedActiveId === profile.id}
                            folderDotColor={folderColor(folder)}
                            onSelect={() => {
                              onSelectProfile(profile);
                            }}
                            onEdit={() => {
                              onEditProfile(profile);
                            }}
                            onDelete={() => {
                              onDeleteProfile(profile.id);
                            }}
                            onStar={() => {
                              onStarProfile(profile);
                            }}
                          />
                        ))}
                        <AddInFolderRow
                          depth={2}
                          onClick={() => {
                            onNewSessionInFolder(folder);
                          }}
                        />
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Import from SSH config */}
      <button
        onClick={onImportSshConfig}
        className="mt-2 flex items-center gap-2 border-t border-border px-3 py-2 text-[11.5px] font-medium text-text-tertiary transition-colors hover:bg-surface-sidebarHover hover:text-accent-dark"
      >
        <DownloadIcon size={12} strokeWidth={2} />
        Import from ~/.ssh/config
      </button>

      {/* User row */}
      <div className="flex items-center gap-2.5 border-t border-border px-3 py-2.5">
        <div className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-[#dfe7f5] text-accent-dark">
          <User size={13} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary">
          Local User
        </div>
        <Settings size={13} strokeWidth={2} className="text-text-faint" />
      </div>
    </div>
  );
}

// ── Tree section (non-collapsible, e.g. Favorites, Recent) ────────────────────

function TreeSection({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 font-mono text-[10px] font-semibold uppercase tracking-[1.2px] text-text-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Caret row (collapsible folder header) ─────────────────────────────────────

function TreeCaret({
  expanded,
  onClick,
  label,
  count,
  depth,
  dotColor,
  bold,
}: {
  expanded: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  depth: number;
  dotColor?: string;
  bold?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded-input py-1 pr-2 transition-colors hover:bg-surface-sidebarHover"
      style={{ paddingLeft: `${(depth * 12 + 6).toString()}px` }}
    >
      <span
        className="flex w-3 flex-shrink-0 items-center justify-center text-text-faint transition-transform"
        style={{ transform: expanded ? "rotate(90deg)" : "rotate(0)" }}
      >
        <ChevronRight size={10} strokeWidth={2.4} />
      </span>
      {dotColor && (
        <span
          className="h-2 w-2 flex-shrink-0 rounded-[3px]"
          style={{ background: dotColor }}
          title="Folder colour is assigned automatically based on name (prod=red, stag=amber, dev=blue, personal=purple, local=teal)"
        />
      )}
      <span
        className={`flex-1 truncate ${bold ? "text-[12px] font-semibold text-text-primary" : "text-[12px] font-medium text-text-secondary"}`}
      >
        {label}
      </span>
      {count != null && <span className="font-mono text-[10px] text-text-faint">{count}</span>}
    </div>
  );
}

// ── Session row ───────────────────────────────────────────────────────────────

interface SessionRowProps {
  profile: ConnectionProfile;
  depth: number;
  isActive: boolean;
  folderDotColor: string;
  showTimestamp?: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStar: () => void;
}

function SessionRow({
  profile,
  depth,
  isActive,
  folderDotColor,
  showTimestamp,
  onSelect,
  onEdit,
  onDelete,
  onStar,
}: SessionRowProps) {
  const stamp = showTimestamp ? relativeTime(profile.lastConnected) : "";
  return (
    <div
      onClick={onSelect}
      className={`group flex cursor-pointer items-center gap-2 rounded-input py-1.5 pr-2 transition-colors ${
        isActive ? "bg-[rgba(47,107,219,0.10)] text-text-heading" : "hover:bg-surface-sidebarHover"
      }`}
      style={{
        paddingLeft: `${(depth * 12 + 6).toString()}px`,
        boxShadow: isActive ? "inset 2px 0 0 #2f6bdb" : undefined,
      }}
    >
      <span className="w-3 flex-shrink-0" />
      <span
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: isActive ? "#1f9d63" : folderDotColor, opacity: isActive ? 1 : 0.55 }}
      />
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[12px] leading-tight ${isActive ? "font-semibold text-text-heading" : "font-medium text-text-primary"}`}
        >
          {profile.name}
        </div>
        <div
          className={`truncate font-mono text-[10px] ${isActive ? "text-text-accent" : "text-text-tertiary"}`}
        >
          {profile.host}
        </div>
      </div>

      {isActive && (
        <span className="flex-shrink-0 font-mono text-[9.5px] font-semibold text-accent-dark">
          LIVE
        </span>
      )}

      {!isActive && stamp && (
        <span className="flex-shrink-0 font-mono text-[9.5px] text-text-faint group-hover:hidden">
          {stamp}
        </span>
      )}

      {!isActive && (
        <div className="flex flex-shrink-0 items-center gap-0.5">
          {/* Star — always shown when favorited; hidden-until-hover otherwise */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStar();
            }}
            className={`flex h-5 w-5 items-center justify-center rounded transition-colors hover:text-warning ${
              profile.favorite ? "" : "opacity-0 group-hover:opacity-100"
            }`}
            style={{ color: profile.favorite ? "#e0a53c" : undefined }}
            title={profile.favorite ? "Unstar" : "Star"}
          >
            <Star size={11} strokeWidth={2} fill={profile.favorite ? "currentColor" : "none"} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-text-faint opacity-0 transition-colors group-hover:opacity-100 hover:text-accent-dark"
            title="Edit"
          >
            <Pencil size={11} strokeWidth={2} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-text-faint opacity-0 transition-colors group-hover:opacity-100 hover:text-danger"
            title="Delete"
          >
            <X size={11} strokeWidth={2.2} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── "+ Add session" row inside a folder ───────────────────────────────────────

function AddInFolderRow({ depth, onClick }: { depth: number; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 rounded-input py-1.5 pr-2 text-text-faint transition-colors hover:bg-surface-sidebarHover hover:text-accent-dark"
      style={{ paddingLeft: `${(depth * 12 + 6).toString()}px` }}
    >
      <span className="w-3 flex-shrink-0" />
      <span className="flex h-2 w-2 flex-shrink-0 items-center justify-center rounded-[3px] border border-dashed border-current text-[8px]" />
      <span className="flex flex-1 items-center gap-1 truncate text-[11.5px] font-medium">
        <Plus size={11} strokeWidth={2.4} />
        Add session
      </span>
    </div>
  );
}
