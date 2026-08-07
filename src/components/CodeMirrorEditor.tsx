import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  syntaxHighlighting,
} from "@codemirror/language";
import { SearchQuery, findNext, findPrevious, setSearchQuery } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface CodeMirrorHandle {
  setSearch: (query: string) => void;
  findNext: () => void;
  findPrev: () => void;
  clearSearch: () => void;
}

interface Props {
  value: string;
  readOnly: boolean;
  language: string | null;
  lineWrap: boolean;
  onChange?: (next: string) => void;
  onSave?: () => void;
}

// Theme override to match Harbor's IBM Plex Mono elsewhere in the app.
const HARBOR_THEME = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent" },
  ".cm-content": { fontFamily: '"IBM Plex Mono", "Cascadia Code", monospace', padding: "12px 0" },
  ".cm-scroller": {
    fontFamily: '"IBM Plex Mono", "Cascadia Code", monospace',
    lineHeight: "1.55",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "#a09994",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#5c554f" },
  ".cm-activeLine": { backgroundColor: "rgba(63,123,224,0.05)" },
  ".cm-selectionMatch": { backgroundColor: "rgba(224,165,60,0.20)" },
  ".cm-searchMatch": { backgroundColor: "rgba(224,165,60,0.35)", borderRadius: "2px" },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "#e0a53c",
    color: "#1a1b1e",
  },
});

export const CodeMirrorEditor = forwardRef<CodeMirrorHandle, Props>(function CodeMirrorEditor(
  { value, readOnly, language, lineWrap, onChange, onSave },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  // Stable refs to callbacks so the mount effect doesn't rebuild the view.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useImperativeHandle(ref, () => ({
    setSearch: (query) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) });
      if (query) findNext(view);
    },
    findNext: () => {
      if (viewRef.current) findNext(viewRef.current);
    },
    findPrev: () => {
      if (viewRef.current) findPrevious(viewRef.current);
    },
    clearSearch: () => {
      const view = viewRef.current;
      if (view) view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
    },
  }));

  // Mount once on first render. All subsequent updates (value, language,
  // readOnly, lineWrap) flow through compartments or dispatch.
  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        bracketMatching(),
        history(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        HARBOR_THEME,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
        ]),
        langCompartment.current.of([]),
        readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
        wrapCompartment.current.of(lineWrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
        }),
      ],
    });
    viewRef.current = new EditorView({ state, parent: containerRef.current });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap language extension when it changes.
  useEffect(() => {
    if (!viewRef.current) return;
    void loadLanguage(language).then((ext) => {
      viewRef.current?.dispatch({ effects: langCompartment.current.reconfigure(ext) });
    });
  }, [language]);

  // Toggle readOnly.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  // Toggle line-wrap.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(lineWrap ? EditorView.lineWrapping : []),
    });
  }, [lineWrap]);

  // Sync external value changes (e.g. after Save or Format button).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={containerRef} className="h-full w-full overflow-auto" />;
});

async function loadLanguage(tag: string | null): Promise<Extension> {
  if (!tag) return [];
  switch (tag) {
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "xml":
      return (await import("@codemirror/lang-xml")).xml();
    case "yaml":
      return (await import("@codemirror/lang-yaml")).yaml();
    case "javascript":
      return (await import("@codemirror/lang-javascript")).javascript({
        typescript: true,
        jsx: true,
      });
    case "python":
      return (await import("@codemirror/lang-python")).python();
    case "html":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "shell": {
      const { StreamLanguage } = await import("@codemirror/language");
      const { shell } = await import("@codemirror/legacy-modes/mode/shell");
      return StreamLanguage.define(shell);
    }
    case "dockerfile": {
      const { StreamLanguage } = await import("@codemirror/language");
      const { dockerFile } = await import("@codemirror/legacy-modes/mode/dockerfile");
      return StreamLanguage.define(dockerFile);
    }
    case "makefile": {
      const { StreamLanguage } = await import("@codemirror/language");
      const { cmake } = await import("@codemirror/legacy-modes/mode/cmake");
      // The legacy pack doesn't ship a dedicated Makefile mode; cmake gives
      // reasonable variable/command highlighting for Make targets too.
      return StreamLanguage.define(cmake);
    }
    case "toml": {
      const { StreamLanguage } = await import("@codemirror/language");
      const { toml } = await import("@codemirror/legacy-modes/mode/toml");
      return StreamLanguage.define(toml);
    }
    case "properties": {
      const { StreamLanguage } = await import("@codemirror/language");
      const { properties } = await import("@codemirror/legacy-modes/mode/properties");
      return StreamLanguage.define(properties);
    }
    default:
      return [];
  }
}
