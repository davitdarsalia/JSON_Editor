import { useState, useCallback, useEffect } from "react";
import { EditorPanel } from "./widgets/EditorPanel.widget";
import { ASTExplorerPanel } from "./widgets/ASTExplorerPanel.widget";
import { useJsonAnalyzer } from "./hooks/useJsonAnalyzer.hook";
import { Snackbar } from "./components/Snackbar.component";

function App() {
  const [leftWidth, setLeftWidth] = useState(50);
  const [inputData, setInputData] = useState("");
  const { ast, error, repaired } = useJsonAnalyzer(inputData);
  const [isResizing, setIsResizing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);

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
      {/* Native macOS Overlay Header */}
      <div className="app-header" style={{
        display: 'flex',
        justifyContent: 'flex-end',
        paddingRight: '15px',
        // @ts-ignore
        WebkitAppRegion: 'drag',
        background: 'var(--header-bg)',
      }}>
        <div className="search-bar" style={{
          display: 'flex',
          alignItems: 'center',
          width: '240px',
          height: '28px',
          // @ts-ignore
          WebkitAppRegion: 'no-drag'
        }}>
          <input
            type="search"
            placeholder="Search JSON..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => {
              if (!searchQuery.trim()) setIsSearchFocused(false);
            }}
            style={{
              width: '100%',
              fontSize: '13px',
              fontFamily: 'Inter, -apple-system, sans-serif',
              colorScheme: 'dark',
              WebkitAppearance: 'searchfield',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              padding: '2px 6px',
            }}
          />
        </div>
      </div>

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
          repaired={repaired}
          width={100 - leftWidth}
          searchQuery={searchQuery}
          isSearchFocused={isSearchFocused}
        />
      </div>
      <Snackbar />
    </main>
  );
}

export default App;
