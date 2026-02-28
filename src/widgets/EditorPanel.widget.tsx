import { FC, useRef } from "react";
import Editor, { Monaco, OnMount } from "@monaco-editor/react";

// Lines above which we disable expensive Monaco features
const LARGE_FILE_THRESHOLD = 10_000;

export const EditorPanel: FC<EditorPanelProps> = ({ value, onChange, width }) => {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleBeforeMount = (monaco: Monaco) => {
    monaco.editor.defineTheme("customDark", {
      base: "vs-dark",
      inherit: false,
      rules: [
        { token: "", foreground: "f6f6f6" },
        { token: "string.key.json", foreground: "e06c75" },
        { token: "string.value.json", foreground: "98c379" },
        { token: "number", foreground: "d19a66" },
        { token: "keyword.json", foreground: "c678dd" },
        { token: "keyword.null.json", foreground: "56b6c2" },
      ],
      colors: {
        "editor.background": "#00000000",
        "editor.foreground": "#f6f6f6",
        "editorLineNumber.foreground": "#444444",
        "editorLineNumber.activeForeground": "#888888",
        "editor.lineHighlightBackground": "#00000000",
        "editorCursor.foreground": "#24c8db",
        "editor.selectionBackground": "#24c8db40",
        "editor.inactiveSelectionBackground": "#24c8db1a",
        "editorIndentGuide.background": "#00000000",
        "editorIndentGuide.activeBackground": "#00000000",
        "editorHoverWidget.background": "#1e1e1e",
        "editorHoverWidget.border": "#333333",
        "editorWidget.background": "#1e1e1e",
        "editorWidget.border": "#333333",
      },
    });

    // We do our own validation in Rust; disable Monaco's built-in JSON
    // diagnostics to avoid a second, expensive parse on every change.
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: false,
      allowComments: true,
    });
  };

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;

    // Dynamically switch options based on document size so large pastes stay
    // smooth. We check on every model content change.
    const model = editor.getModel();
    if (!model) return;

    const updateForSize = () => {
      const lines = model.getLineCount();
      const large = lines > LARGE_FILE_THRESHOLD;
      editor.updateOptions({
        // Folding is O(n) — disable for large files
        folding: !large,
        showFoldingControls: large ? "never" : "always",
      });
    };

    updateForSize();
    model.onDidChangeContent(updateForSize);
  };

  return (
    <div
      className="panel output-area"
      style={{ width: `${width}%`, overflow: "hidden", padding: 0 }}
    >
      <Editor
        height="100%"
        defaultLanguage="json"
        language="json"
        value={value}
        onChange={(val) => onChange(val || "")}
        theme="customDark"
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: '"Fira Code", monospace',
          wordWrap: "off",
          scrollBeyondLastLine: false,
          padding: { top: 20, bottom: 20 },
          lineNumbers: "on",
          folding: true,
          showFoldingControls: "always",
          glyphMargin: false,
          lineDecorationsWidth: 10,
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          renderLineHighlight: "none",
          renderWhitespace: "none",
          matchBrackets: "never",
          // ── Large-file optimisations ────────────────────────────────────
          // formatOnPaste triggers a full-document reformat on every paste —
          // catastrophically slow for 100 k lines.  We expose "Pretty JSON"
          // via the menu/button for intentional formatting.
          formatOnPaste: false,
          // Word-based suggestions scan the entire buffer on every keypress.
          wordBasedSuggestions: "off",
          // Inline autocomplete scans the document.
          quickSuggestions: false,
          // Link detection walks every line.
          links: false,
          // ───────────────────────────────────────────────────────────────
          tabSize: 4,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            useShadows: false,
          },
          stickyScroll: { enabled: false },
        }}
      />
    </div>
  );
};
