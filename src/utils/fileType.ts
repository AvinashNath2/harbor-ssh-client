const EXT_MAP: Record<string, string> = {
  yml: "YML File",
  yaml: "YAML File",
  json: "JSON File",
  md: "Markdown",
  txt: "Text File",
  sh: "Shell Script",
  bash: "Shell Script",
  zsh: "Shell Script",
  py: "Python Script",
  js: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  jsx: "JavaScript",
  rs: "Rust Source",
  go: "Go Source",
  java: "Java Source",
  class: "Java Class",
  jar: "JAR File",
  png: "PNG Image",
  jpg: "JPEG Image",
  jpeg: "JPEG Image",
  gif: "GIF Image",
  svg: "SVG Image",
  webp: "WebP Image",
  ico: "Icon",
  pdf: "PDF File",
  zip: "ZIP Archive",
  tar: "TAR Archive",
  gz: "GZ Archive",
  tgz: "TAR.GZ Archive",
  bz2: "BZip2 Archive",
  "7z": "7-Zip Archive",
  rar: "RAR Archive",
  log: "Log File",
  env: "ENV File",
  toml: "TOML File",
  xml: "XML File",
  html: "HTML File",
  htm: "HTML File",
  css: "CSS File",
  scss: "SCSS File",
  sass: "SASS File",
  sql: "SQL File",
  csv: "CSV File",
  tsv: "TSV File",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  conf: "Config File",
  config: "Config File",
  ini: "INI File",
  key: "Key File",
  pem: "PEM Certificate",
  crt: "Certificate",
  lock: "Lockfile",
};

export function fileTypeLabel(name: string, kind: string): string {
  if (kind === "directory") return "Folder";
  if (kind === "symlink") return "Symlink";
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "Dockerfile";
  if (lower === "makefile") return "Makefile";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? (ext ? `${ext.toUpperCase()} File` : "File");
}

// ── Category + colour mapping ──────────────────────────────────────────────────

type Category =
  | "folder"
  | "symlink"
  | "image"
  | "code"
  | "doc"
  | "data"
  | "archive"
  | "shell"
  | "config"
  | "secret"
  | "log"
  | "binary"
  | "file";

const CATEGORY_OF_EXT: Record<string, Category> = {
  // images
  png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image",
  webp: "image", bmp: "image", ico: "image",
  // code
  js: "code", ts: "code", tsx: "code", jsx: "code", py: "code",
  rs: "code", go: "code", java: "code", rb: "code", php: "code",
  c: "code", cpp: "code", h: "code", hpp: "code", cs: "code",
  swift: "code", kt: "code", scala: "code", clj: "code",
  // docs
  md: "doc", txt: "doc", pdf: "doc", rtf: "doc", doc: "doc", docx: "doc",
  // data
  json: "data", yaml: "data", yml: "data", toml: "data", xml: "data",
  csv: "data", tsv: "data", sql: "data",
  // archives
  zip: "archive", tar: "archive", gz: "archive", tgz: "archive",
  bz2: "archive", "7z": "archive", rar: "archive", jar: "archive",
  // shell
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  // config
  conf: "config", config: "config", ini: "config", env: "config",
  properties: "config",
  // secrets
  key: "secret", pem: "secret", crt: "secret", cer: "secret", pub: "secret",
  // log
  log: "log",
  // stylesheets → code
  css: "code", scss: "code", sass: "code", html: "code", htm: "code",
};

const CATEGORY_COLOR: Record<Category, { bg: string; fg: string; glyph: string }> = {
  folder:  { bg: "#e0a53c", fg: "#5c3d0e", glyph: "▤" },   // amber
  symlink: { bg: "#8a8578", fg: "#ffffff", glyph: "↪" },   // gray
  image:   { bg: "#e5534b", fg: "#ffffff", glyph: "▧" },   // red-orange
  code:    { bg: "#1f9d63", fg: "#ffffff", glyph: "<>" },  // green
  doc:     { bg: "#3f7be0", fg: "#ffffff", glyph: "¶" },   // blue
  data:    { bg: "#e0a53c", fg: "#5c3d0e", glyph: "{}" },  // yellow
  archive: { bg: "#9b59b6", fg: "#ffffff", glyph: "⬒" },   // purple
  shell:   { bg: "#111214", fg: "#40c882", glyph: "$_" },  // black/green
  config:  { bg: "#52524e", fg: "#e0ddd8", glyph: "⚙" },   // dark gray
  secret:  { bg: "#e0a53c", fg: "#5c3d0e", glyph: "⚿" },   // amber key
  log:     { bg: "#8a8578", fg: "#ffffff", glyph: "≡" },   // gray
  binary:  { bg: "#52524e", fg: "#e0ddd8", glyph: "⬢" },
  file:    { bg: "#c8c4bc", fg: "#5c5548", glyph: "▬" },   // beige default
};

export interface FileIconStyle {
  bg: string;
  fg: string;
  glyph: string;
}

export function fileIcon(name: string, kind: string): FileIconStyle {
  if (kind === "directory") return CATEGORY_COLOR.folder;
  if (kind === "symlink") return CATEGORY_COLOR.symlink;

  const lower = name.toLowerCase();
  if (lower === "dockerfile") return CATEGORY_COLOR.config;
  if (lower === "makefile") return CATEGORY_COLOR.config;
  if (lower.endsWith(".lock") || lower.endsWith("-lock.json")) return CATEGORY_COLOR.data;

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const category = CATEGORY_OF_EXT[ext] ?? "file";
  return CATEGORY_COLOR[category];
}
