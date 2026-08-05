import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  FileUp,
  Folder,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Star,
  User,
} from "lucide-react";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionProfile } from "../api";
import { relativeTime } from "../utils/relativeTime";

// ── Folder color mapping ───────────────────────────────────────────────────────

const FOLDER_COLORS: [RegExp, string][] = [
  [/prod/i, "#e5534b"],
  [/stag/i, "#e0a53c"],
  [/dev/i, "#3f7be0"],
  [/personal/i, "#9b59b6"],
  [/local/i, "#1abc9c"],
];

function folderColor(folder: string): string {
  for (const [pattern, color] of FOLDER_COLORS) {
    if (pattern.test(folder)) return color;
  }
  return "#f59e0b";
}

function folderKey(folder: string): string {
  return folder.toLowerCase();
}

// ── Portal dropdown (escapes overflow-y:auto clipping) ────────────────────────

function PortalMenu({
  anchorRef,
  open,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Stable ref so the mousedown listener never needs onClose in deps
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const anchor = anchorRef.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const top = rect.bottom + 2;
      const right = window.innerWidth - rect.right;
      // Only update state if position actually changed (avoids re-render loop)
      setPos((prev) =>
        prev !== null && prev.top === top && prev.right === right ? prev : { top, right },
      );
    }

    function onMouseDown(e: MouseEvent) {
      if (
        !anchorRef.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        onCloseRef.current();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => { document.removeEventListener("mousedown", onMouseDown); };
    // onClose intentionally omitted — accessed via ref to avoid re-run loop
     
  }, [open, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={dropdownRef}
      className="overflow-hidden rounded-[8px] border border-border-raised bg-surface-pane"
      style={{
        position: "fixed",
        top: pos.top,
        right: pos.right,
        zIndex: 9999,
        minWidth: 160,
        boxShadow: "0 8px 24px -4px rgba(20,18,15,0.22)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
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
  onExportJson: () => void;
  onImportJson: () => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onMoveToFolder: (profileId: string, newFolder: string) => void;
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
  onExportJson,
  onImportJson,
  onRenameFolder,
  onMoveToFolder,
  onHide,
}: SidebarProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"virtual" | "recent">("virtual");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const filtered = profiles.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.host.toLowerCase().includes(search.toLowerCase()),
  );

  const groupsMap = new Map<string, ConnectionProfile[]>();
  for (const p of filtered) {
    const folder = p.folder ?? "General";
    const existing = groupsMap.get(folder) ?? [];
    existing.push(p);
    groupsMap.set(folder, existing);
  }
  const groups = Array.from(groupsMap.entries()).sort((a, b) => {
    if (a[0] === "General") return 1;
    if (b[0] === "General") return -1;
    return a[0].localeCompare(b[0]);
  });

  const allFolders = useMemo(
    () =>
      Array.from(new Set(profiles.map((p) => p.folder ?? "General"))).sort((a, b) => {
        if (a === "General") return 1;
        if (b === "General") return -1;
        return a.localeCompare(b);
      }),
    [profiles],
  );

  const recent = useMemo(
    () =>
      [...profiles]
        .filter((p) => p.lastConnected)
        .sort((a, b) => (b.lastConnected ?? 0) - (a.lastConnected ?? 0)),
    [profiles],
  );

  const resolvedActiveId = useMemo(
    () => activeProfileId ?? profiles.find((p) => activeHost === p.host)?.id ?? null,
    [profiles, activeHost, activeProfileId],
  );

  function toggleFolder(folder: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      const k = folderKey(folder);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function submitNewFolder() {
    const name = newFolderName.trim();
    if (name) {
      onNewSessionInFolder(name);
    }
    setCreatingFolder(false);
    setNewFolderName("");
  }

  useEffect(() => {
    if (creatingFolder && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [creatingFolder]);

  return (
    <div
      className="flex flex-none flex-col border-r border-border bg-surface-sidebar"
      style={{ width: width ?? 260 }}
    >
      {/* ── App header ───────────────────────────────────────────────────── */}
      <div
        className="flex flex-none items-center gap-2.5 px-4 pb-3 pt-5"
        data-tauri-drag-region
      >
        <div
          className="flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-[8px] text-[14px] font-bold text-white"
          style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
        >
          H
        </div>
        <span className="flex-1 text-[14px] font-semibold tracking-[-0.3px] text-text-primary">
          HarborSCP
        </span>
        <button
          onClick={onNewSession}
          title="New session"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
        >
          <Plus size={15} strokeWidth={2} />
        </button>
      </div>

      {/* ── Sessions header ───────────────────────────────────────────────── */}
      <div className="flex flex-none items-center gap-2 px-4 pb-2">
        <span className="text-[13px] font-semibold text-text-primary">Sessions</span>
        <span className="rounded-full bg-surface-chip px-1.5 py-0.5 font-mono text-[10.5px] text-text-tertiary">
          {profiles.length}
        </span>
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

      {/* ── New Session button ─────────────────────────────────────────────── */}
      <div className="px-3 pb-2.5">
        <button
          onClick={onNewSession}
          className="flex h-[34px] w-full items-center justify-center gap-2 rounded-[8px] text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
          style={{
            background: "linear-gradient(150deg, #3f7be0, #2f6bdb)",
            boxShadow: "0 2px 8px -2px rgba(47,107,219,0.45)",
          }}
        >
          <Plus size={14} strokeWidth={2.5} />
          New Session
        </button>
      </div>

      {/* ── Search ────────────────────────────────────────────────────────── */}
      <div className="px-3 pb-2.5">
        <div className="flex h-[30px] items-center gap-2 rounded-[8px] border border-border-input bg-surface-pane px-3">
          <Search size={12} strokeWidth={2} className="flex-shrink-0 text-text-faint" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            placeholder="Search sessions..."
            className="flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-faint"
          />
        </div>
      </div>

      {/* ── Virtual / Recent tabs ──────────────────────────────────────────── */}
      <div className="flex flex-none border-b border-border px-3">
        {(["virtual", "recent"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); }}
            className={`relative pb-2 pr-5 text-[12.5px] font-medium capitalize transition-colors ${
              activeTab === tab ? "text-accent-dark" : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-4 h-[2px] rounded-full bg-accent-dark" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tree ──────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {activeTab === "virtual" && (
          <>
            {profiles.length === 0 && (
              <p className="px-4 pt-6 text-center text-[12px] text-text-faint">
                No saved sessions.
                <br />
                Click New Session to add one.
              </p>
            )}

            {profiles.length > 0 && filtered.length === 0 && (
              <p className="px-4 pt-6 text-center text-[12px] text-text-faint">
                No results for &ldquo;{search}&rdquo;
              </p>
            )}

            {groups.map(([folder, items]) => {
              const isCollapsed = collapsedFolders.has(folderKey(folder));
              return (
                <div key={folder}>
                  <FolderRow
                    folder={folder}
                    count={items.length}
                    expanded={!isCollapsed}
                    onToggle={() => { toggleFolder(folder); }}
                    onAddSession={() => { onNewSessionInFolder(folder); }}
                    onRename={(newName) => { onRenameFolder(folder, newName); }}
                  />
                  {!isCollapsed &&
                    items.map((profile) => (
                      <SessionRow
                        key={profile.id}
                        profile={profile}
                        depth={2}
                        isActive={resolvedActiveId === profile.id}
                        folders={allFolders}
                        onSelect={() => { onSelectProfile(profile); }}
                        onEdit={() => { onEditProfile(profile); }}
                        onDelete={() => { onDeleteProfile(profile.id); }}
                        onStar={() => { onStarProfile(profile); }}
                        onMove={(targetFolder) => { onMoveToFolder(profile.id, targetFolder); }}
                      />
                    ))}
                </div>
              );
            })}

            {/* New folder inline */}
            {!search && (
              creatingFolder ? (
                <div className="px-3 py-1.5">
                  <div className="flex h-[30px] items-center gap-2 rounded-[7px] border border-accent/40 bg-surface-pane px-2.5 focus-within:border-accent/70">
                    <Folder size={12} strokeWidth={0} fill="#f59e0b" className="flex-shrink-0" />
                    <input
                      ref={newFolderInputRef}
                      value={newFolderName}
                      onChange={(e) => { setNewFolderName(e.target.value); }}
                      placeholder="Folder name…"
                      className="flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-faint"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitNewFolder();
                        if (e.key === "Escape") {
                          setCreatingFolder(false);
                          setNewFolderName("");
                        }
                      }}
                      onBlur={submitNewFolder}
                    />
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setCreatingFolder(true); }}
                  className="mt-1 flex w-full items-center gap-2 px-4 py-1.5 text-[12px] font-medium text-accent-dark transition-colors hover:text-accent-dark/80"
                >
                  <Plus size={12} strokeWidth={2.5} />
                  New Folder
                </button>
              )
            )}
          </>
        )}

        {activeTab === "recent" && (
          <>
            {recent.length === 0 && (
              <p className="px-4 pt-6 text-center text-[12px] text-text-faint">
                No recent connections.
              </p>
            )}
            {recent.map((profile) => (
              <SessionRow
                key={profile.id}
                profile={profile}
                depth={1}
                isActive={resolvedActiveId === profile.id}
                showTimestamp
                folders={allFolders}
                onSelect={() => { onSelectProfile(profile); }}
                onEdit={() => { onEditProfile(profile); }}
                onDelete={() => { onDeleteProfile(profile.id); }}
                onStar={() => { onStarProfile(profile); }}
                onMove={(targetFolder) => { onMoveToFolder(profile.id, targetFolder); }}
              />
            ))}
          </>
        )}
      </div>

      {/* ── Local user row + settings dropdown ────────────────────────────── */}
      <SettingsRow
        onImportSshConfig={onImportSshConfig}
        onExportJson={onExportJson}
        onImportJson={onImportJson}
      />
    </div>
  );
}

// ── Folder row ─────────────────────────────────────────────────────────────────

function FolderRow({
  folder,
  count,
  expanded,
  onToggle,
  onAddSession,
  onRename,
}: {
  folder: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onAddSession: () => void;
  onRename: (newName: string) => void;
}) {
  const color = folderColor(folder);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  function submitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== folder) {
      onRename(trimmed);
    }
    setRenaming(false);
  }

  if (renaming) {
    return (
      <div className="px-3 py-1">
        <div className="flex h-[30px] items-center gap-2 rounded-[7px] border border-accent/40 bg-surface-pane px-2.5 focus-within:border-accent/70">
          <Folder size={12} strokeWidth={0} style={{ fill: color }} className="flex-shrink-0" />
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => { setRenameValue(e.target.value); }}
            className="flex-1 bg-transparent text-[12px] text-text-primary outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") {
                setRenaming(false);
                setRenameValue(folder);
              }
            }}
            onBlur={submitRename}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5 py-0.5 pl-3 pr-3">
      <button
        onClick={onToggle}
        className="flex flex-1 items-center gap-2 rounded-[6px] px-1.5 py-1.5 text-left transition-colors hover:bg-surface-sidebarHover"
      >
        <span className="flex w-3 flex-shrink-0 items-center justify-center text-text-faint">
          {expanded ? (
            <ChevronDown size={10} strokeWidth={2.5} />
          ) : (
            <ChevronRight size={10} strokeWidth={2.5} />
          )}
        </span>
        <Folder size={13} strokeWidth={0} className="flex-shrink-0" style={{ fill: color }} />
        <span className="flex-1 truncate text-[12px] font-medium text-text-secondary">
          {folder}
        </span>
        <span className="rounded-full bg-surface-chip px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
          {count}
        </span>
      </button>

      {/* ⋮ button */}
      <button
        ref={menuBtnRef}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-faint opacity-0 transition-colors group-hover:opacity-100 hover:bg-surface-chip hover:text-text-secondary"
        title={`Options for ${folder}`}
      >
        <MoreHorizontal size={12} strokeWidth={2} />
      </button>

      <PortalMenu anchorRef={menuBtnRef} open={menuOpen} onClose={() => { setMenuOpen(false); }}>
        <button
          onClick={() => {
            setMenuOpen(false);
            onAddSession();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <Plus size={12} strokeWidth={2} className="text-text-faint" />
          Add Connection
        </button>
        <div className="h-px bg-border" />
        <button
          onClick={() => {
            setMenuOpen(false);
            setRenaming(true);
            setRenameValue(folder);
          }}
          className="flex w-full items-center gap-2 px-3 py-2 pb-2.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          Rename Folder
        </button>
      </PortalMenu>
    </div>
  );
}

// ── Session row ─────────────────────────────────────────────────────────────────

interface SessionRowProps {
  profile: ConnectionProfile;
  depth: number;
  isActive: boolean;
  folders: string[];
  showTimestamp?: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStar: () => void;
  onMove: (folder: string) => void;
}

function SessionRow({
  profile,
  depth,
  isActive,
  folders,
  showTimestamp,
  onSelect,
  onEdit,
  onDelete,
  onStar,
  onMove,
}: SessionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // depth=1 → top-level (recent tab, 16px); depth=2 → inside folder (28px)
  const paddingLeft = depth === 1 ? 16 : 28;
  const currentFolder = profile.folder ?? "General";
  const otherFolders = folders.filter((f) => f !== currentFolder);

  function closeMenu() {
    setMenuOpen(false);
    setShowMoveSubmenu(false);
  }

  return (
    <div
      className={`group relative flex cursor-pointer items-center gap-2.5 py-1.5 pr-2 transition-colors ${
        isActive ? "bg-accent/[0.08]" : "hover:bg-surface-sidebarHover"
      }`}
      style={{
        paddingLeft,
        boxShadow: isActive ? "inset 2px 0 0 #2f6bdb" : undefined,
      }}
      onClick={onSelect}
    >
      {/* Monitor icon */}
      <Monitor
        size={14}
        strokeWidth={1.75}
        className={`flex-shrink-0 ${isActive ? "text-accent-dark" : "text-text-tertiary"}`}
      />

      {/* Name + host */}
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[12px] leading-snug ${
            isActive ? "font-semibold text-text-heading" : "font-medium text-text-primary"
          }`}
        >
          {profile.name}
        </div>
        <div
          className={`truncate font-mono text-[10.5px] leading-snug ${
            isActive ? "text-accent-dark" : "text-text-faint"
          }`}
        >
          {profile.host}
        </div>
      </div>

      {/* LIVE badge */}
      {isActive && (
        <span className="flex-shrink-0 rounded-full bg-success/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-success">
          LIVE
        </span>
      )}

      {/* Timestamp (recent tab) */}
      {!isActive && showTimestamp && profile.lastConnected && (
        <span className="flex-shrink-0 font-mono text-[10px] text-text-faint group-hover:hidden">
          {relativeTime(profile.lastConnected)}
        </span>
      )}

      {/* Star + ⋮ menu */}
      {!isActive && (
        <div
          className="flex flex-shrink-0 items-center gap-0.5"
          onClick={(e) => { e.stopPropagation(); }}
        >
          <button
            onClick={onStar}
            className={`flex h-[22px] w-[22px] items-center justify-center rounded transition-colors hover:text-warning ${
              profile.favorite ? "text-warning" : "text-text-faint opacity-0 group-hover:opacity-100"
            }`}
            title={profile.favorite ? "Unstar" : "Star"}
          >
            <Star
              size={12}
              strokeWidth={2}
              fill={profile.favorite ? "currentColor" : "none"}
            />
          </button>

          {/* ⋮ button */}
          <button
            ref={menuBtnRef}
            onClick={() => {
              setShowMoveSubmenu(false);
              setMenuOpen((v) => !v);
            }}
            className="flex h-[22px] w-[22px] items-center justify-center rounded text-text-faint opacity-0 transition-colors group-hover:opacity-100 hover:bg-surface-chip hover:text-text-secondary"
            title="More options"
          >
            <MoreHorizontal size={13} strokeWidth={2} />
          </button>

          <PortalMenu anchorRef={menuBtnRef} open={menuOpen} onClose={closeMenu}>
            <button
              onClick={() => {
                closeMenu();
                onEdit();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              Edit
            </button>
            <div className="h-px bg-border" />
            {/* Move to Folder */}
            <button
              onClick={() => { setShowMoveSubmenu((v) => !v); }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <span>Move to Folder</span>
              <ChevronRight size={11} strokeWidth={2} className="text-text-faint" />
            </button>
            {showMoveSubmenu && (
              <div className="max-h-40 overflow-y-auto border-t border-border bg-surface">
                {otherFolders.length === 0 ? (
                  <p className="px-4 py-2 text-[11px] text-text-faint">No other folders</p>
                ) : (
                  otherFolders.map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        closeMenu();
                        onMove(f);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-[11.5px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                    >
                      <Folder
                        size={11}
                        strokeWidth={0}
                        style={{ fill: folderColor(f) }}
                        className="flex-shrink-0"
                      />
                      {f}
                    </button>
                  ))
                )}
              </div>
            )}
            <div className="h-px bg-border" />
            <button
              onClick={() => {
                closeMenu();
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-danger transition-colors hover:bg-danger/5"
            >
              Delete
            </button>
          </PortalMenu>
        </div>
      )}
    </div>
  );
}

// ── Settings row with dropdown ─────────────────────────────────────────────────

function SettingsRow({
  onImportSshConfig,
  onExportJson,
  onImportJson,
}: {
  onImportSshConfig: () => void;
  onExportJson: () => void;
  onImportJson: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => { document.removeEventListener("mousedown", onOutside); };
  }, [open]);

  function pick(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <div className="flex flex-none items-center gap-2.5 border-t border-border px-4 py-2.5">
      <div className="flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-full bg-[#dfe7f5]">
        <User size={13} strokeWidth={2.2} className="text-accent-dark" />
      </div>
      <span className="flex-1 truncate text-[12.5px] font-medium text-text-primary">
        Local User
      </span>

      {/* Settings gear → dropdown */}
      <div ref={ref} className="relative">
        <button
          onClick={() => { setOpen((v) => !v); }}
          className={`flex h-[26px] w-[26px] items-center justify-center rounded-[6px] transition-colors ${
            open
              ? "bg-surface-chip text-text-secondary"
              : "text-text-faint hover:bg-surface-chip hover:text-text-secondary"
          }`}
          title="Settings"
        >
          <Settings size={13} strokeWidth={2} />
        </button>

        {open && (
          <div
            className="absolute bottom-[calc(100%+4px)] right-0 z-50 overflow-hidden rounded-[10px] border border-border-raised bg-surface-pane"
            style={{ boxShadow: "0 12px 32px -6px rgba(20,18,15,0.25)", minWidth: 210 }}
          >
            {/* Section header */}
            <div className="px-3 pb-1 pt-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.6px] text-text-faint">
                Connections
              </span>
            </div>

            <button
              onClick={() => { pick(onImportSshConfig); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <Download size={13} strokeWidth={2} className="flex-shrink-0 text-text-faint" />
              Import from ~/.ssh/config
            </button>

            <div className="mx-3 h-px bg-border" />

            <button
              onClick={() => { pick(onExportJson); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <FileDown size={13} strokeWidth={2} className="flex-shrink-0 text-text-faint" />
              Export Connections
            </button>

            <button
              onClick={() => { pick(onImportJson); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 pb-3 text-left text-[12.5px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <FileUp size={13} strokeWidth={2} className="flex-shrink-0 text-text-faint" />
              Import Connections
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
