import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EditorPanel } from "./widgets/EditorPanel.widget";
import { ASTExplorerPanel } from "./widgets/ASTExplorerPanel.widget";

function App() {
  const [leftWidth, setLeftWidth] = useState(50);
  const [inputData, setInputData] = useState("");
  const [error, setError] = useState<JSONErrorInfo | null>(null);
  const [ast, setAst] = useState<ASTNodeData | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Analyze JSON on change (Debounced logic stays in orchestrator)
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!inputData.trim()) {
        setAst(null);
        setError(null);
        return;
      }
      try {
        const result = await invoke<ASTNodeData>("assemble_ast", {
          jsonStr: inputData,
        });
        setAst(result);
        setError(null);
      } catch (e) {
        setAst(null);
        setError(e as JSONErrorInfo);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [inputData]);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = (e.clientX / window.innerWidth) * 100;
        if (newWidth > 15 && newWidth < 85) setLeftWidth(newWidth);
      }
    },
    [isResizing],
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    const stop = () => setIsResizing(false);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stop);
    };
  }, [resize]);

  return (
    <main className="container">
      <div className="split-view">
        <EditorPanel
          value={inputData}
          onChange={setInputData}
          width={leftWidth}
        />

        <div className="divider" onMouseDown={() => setIsResizing(true)} />

        <ASTExplorerPanel
          ast={ast}
          error={error}
          width={100 - leftWidth}
          rawJson={inputData}
        />
      </div>
    </main>
  );
}

export default App;
