import { useState, useCallback, useEffect } from "react";
import { EditorPanel } from "./widgets/EditorPanel.widget";
import { ASTExplorerPanel } from "./widgets/ASTExplorerPanel.widget";
import { useJsonAnalyzer } from "./hooks/useJsonAnalyzer.hook";
import { Snackbar } from "./components/Snackbar.component";

function App() {
  const [leftWidth, setLeftWidth] = useState(50);
  const [inputData, setInputData] = useState("");
  const { ast, error } = useJsonAnalyzer(inputData);
  const [isResizing, setIsResizing] = useState(false);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = (e.clientX / window.innerWidth) * 100;
        if (newWidth > 10 && newWidth < 90) setLeftWidth(newWidth);
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
        />
      </div>
      <Snackbar />
    </main>
  );
}

export default App;
