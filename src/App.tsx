import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorPanelHandle } from "./widgets/EditorPanel.widget";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EditorPanel } from "./widgets/EditorPanel.widget";
import { ASTExplorerPanel } from "./widgets/ASTExplorerPanel.widget";
import { useJsonAnalyzer } from "./hooks/useJsonAnalyzer.hook";
import { Header } from "./components/Header";
import { SplitView } from "./components/SplitView";
import { Snackbar } from "./components/Snackbar.component";

function showSnackbar(message: string) {
  window.dispatchEvent(
    new CustomEvent("show-snackbar", { detail: { message } }),
  );
}

function App() {
  const [inputData, setInputData] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const { rootNodes, error, repaired, loadChildren } = useJsonAnalyzer(inputData);

  // Stable ref so menu-event listeners always see the latest editor content
  const inputDataRef = useRef(inputData);
  const editorRef = useRef<EditorPanelHandle>(null);

  useEffect(() => {
    inputDataRef.current = inputData;
  }, [inputData]);

  const handleBeautify = useCallback(async () => {
    try {
      const formatted = await invoke<string>("format_json", {
        jsonStr: inputDataRef.current,
      });
      setInputData(formatted);
    } catch (e: any) {
      showSnackbar(`Format error: ${e}`);
    }
  }, []);

  const handleValidate = useCallback(async () => {
    try {
      await invoke("validate_json", { jsonStr: inputDataRef.current });
      showSnackbar("✓ Valid JSON");
    } catch (e: any) {
      showSnackbar(`✗ ${e?.message ?? "Invalid JSON"}`);
    }
  }, []);

  // Wire native macOS menu events -> app actions
  useEffect(() => {
    const subs = [
      listen("menu:pretty-json", () => handleBeautify()),
      listen("menu:validate-json", () => handleValidate()),
      listen<string>("file-opened", (e) => setInputData(e.payload)),
    ];
    return () => {
      subs.forEach((p) => p.then((unsub) => unsub()));
    };
  }, [handleBeautify, handleValidate]);

  return (
    <main className="container">
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchFocus={() => setIsSearchFocused(true)}
        onSearchBlur={() => setIsSearchFocused(false)}
        onBeautify={handleBeautify}
      />

      <SplitView
        onResizeEnd={() => editorRef.current?.focus()}
        renderLeft={(w) => (
          <EditorPanel
            ref={editorRef}
            value={inputData}
            onChange={setInputData}
            width={w}
          />
        )}
        renderRight={(w) => (
          <ASTExplorerPanel
            rootNodes={rootNodes}
            error={error}
            repaired={repaired}
            width={w}
            searchQuery={searchQuery}
            isSearchFocused={isSearchFocused}
            loadChildren={loadChildren}
          />
        )}
      />

      <Snackbar />
    </main>
  );
}

export default App;
