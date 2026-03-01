import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from "react";
import Editor, { Monaco, OnMount } from "@monaco-editor/react";

// Lines above which we disable expensive Monaco features
const LARGE_FILE_THRESHOLD = 10_000;

export interface EditorPanelHandle {
  focus: () => void;
}

export const EditorPanel = forwardRef<EditorPanelHandle, EditorPanelProps>(
  ({ value, onChange, width }, ref) => {
    const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
    const [theme, setTheme] = useState(() =>
      window.matchMedia("(prefers-color-scheme: dark)").matches ? "jsonKitDark" : "jsonKit"
    );

    useEffect(() => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => setTheme(mq.matches ? "jsonKitDark" : "jsonKit");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }, []);

    useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
    }));

    const handleBeforeMount = (monaco: Monaco) => {
      monaco.editor.defineTheme("jsonKit", {
        base: "vs",
        inherit: false,
        rules: [
          { token: "", foreground: "2d3748" },
          { token: "string.key.json", foreground: "b83280" },
          { token: "string.value.json", foreground: "276f42" },
          { token: "number", foreground: "2b6cb0" },
          { token: "keyword.json", foreground: "805ad5" },
          { token: "keyword.null.json", foreground: "718096" },
        ],
        colors: {
          "editor.background": "#f0ede8",
          "editor.foreground": "#2d3748",
          "editorLineNumber.foreground": "#ffffff",
          "editorLineNumber.activeForeground": "#ffffff",
          "editor.lineHighlightBackground": "#ffffff",
          "editorCursor.foreground": "#2d3748",
          "editor.selectionBackground": "#e2e8f0",
          "editor.inactiveSelectionBackground": "#edf2f7",
          "editorIndentGuide.background": "#ffffff",
          "editorIndentGuide.activeBackground": "#ffffff",
          "editorHoverWidget.background": "#ffffff",
          "editorHoverWidget.border": "#e2e8f0",
          "editorWidget.background": "#ffffff",
          "editorWidget.border": "#e2e8f0",
          "editorScrollbar.background": "#f0ede8",
          "editorScrollbar.thumbBackground": "#cbd5e0",
          "editorScrollbar.thumbHoverBackground": "#a0aec0",
        },
      });
      monaco.editor.defineTheme("jsonKitDark", {
        base: "vs-dark",
        inherit: false,
        rules: [
          { token: "", foreground: "e2e8f0" },
          { token: "string.key.json", foreground: "f687b3" },
          { token: "string.value.json", foreground: "68d391" },
          { token: "number", foreground: "63b3ed" },
          { token: "keyword.json", foreground: "b794f4" },
          { token: "keyword.null.json", foreground: "a0aec0" },
        ],
        colors: {
          "editor.background": "#171923",
          "editor.foreground": "#e2e8f0",
          "editorLineNumber.foreground": "#171923",
          "editorLineNumber.activeForeground": "#171923",
          "editor.lineHighlightBackground": "#171923",
          "editorCursor.foreground": "#e2e8f0",
          "editor.selectionBackground": "#2d374840",
          "editor.inactiveSelectionBackground": "#2d374820",
          "editorIndentGuide.background": "#171923",
          "editorIndentGuide.activeBackground": "#171923",
          "editorHoverWidget.background": "#2d3748",
          "editorHoverWidget.border": "#4a5568",
          "editorWidget.background": "#2d3748",
          "editorWidget.border": "#4a5568",
          "editorScrollbar.background": "#171923",
          "editorScrollbar.thumbBackground": "#4a5568",
          "editorScrollbar.thumbHoverBackground": "#718096",
        },
      });

      // We do our own validation in Rust; disable Monaco's built-in JSON
      // diagnostics to avoid a second, expensive parse on every change.
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: false,
        allowComments: true,
      });
    };

    const handleMount: OnMount = (editor, monaco) => {
      editorRef.current = editor;

      // Redirect Cmd/Ctrl+F to the app's search bar instead of Monaco find widget
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
        window.dispatchEvent(new CustomEvent("focus-search-bar"));
      });
      // Suppress Ctrl+H (find & replace) — app has no replace
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {});

      // Dynamically switch options based on document size so large pastes stay
      // smooth. We check on every model content change.
      const model = editor.getModel();
      if (!model) return;

      const updateForSize = () => {
        const lines = model.getLineCount();
        const large = lines > LARGE_FILE_THRESHOLD;
        editor.updateOptions({
          folding: !large,
          showFoldingControls: "never",
        });
      };

      updateForSize();
      model.onDidChangeContent(updateForSize);
    };

    return (
      <div
        className="panel editor-panel"
        style={{ width: `${width}%`, overflow: "hidden", paddingLeft: 12, paddingRight: 12 }}
      >
        <Editor
          key="json-editor"
          height="100%"
          defaultLanguage="json"
          language="json"
          value={value}
          onChange={(val) => onChange(val || "")}
          theme={theme}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            fontFamily: '"SF Mono", Menlo, "Ubuntu Mono", monospace',
            wordWrap: "off",
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
            lineNumbers: "off",
            folding: true,
            showFoldingControls: "never",
            glyphMargin: false,
            lineDecorationsWidth: 0,
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            renderLineHighlight: "none",
            renderWhitespace: "none",
            matchBrackets: "never",
            cursorStyle: "line",
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
            // Disable "Go to Definition" and other language features
            contextmenu: false, // Disable right-click menu
            hover: { enabled: false }, // Disable hover tooltips
            parameterHints: { enabled: false }, // Disable parameter hints
            suggest: { showWords: false }, // Disable suggestion widget
            occurrencesHighlight: "off", // Disable occurrence highlighting
            selectionHighlight: false, // Disable selection highlighting
            codeLens: false, // Disable code lens
            // @ts-expect-error Monaco types expect ShowLightbulbIconMode for enabled
            lightbulb: { enabled: false },
          }}
        />
      </div>
    );
  });
