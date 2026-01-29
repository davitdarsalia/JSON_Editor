import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface ASTNodeData {
  id: string;
  name: string;
  node_type: string;
  value?: string;
  children?: ASTNodeData[];
  depth: number;
}

const ASTNode = ({ node }: { node: ASTNodeData }) => {
  const [isOpen, setIsOpen] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="ast-node">
      <div className="ast-label" onClick={() => setIsOpen(!isOpen)}>
        {hasChildren && (
          <span className={`toggle-icon ${isOpen ? "open" : ""}`}>▶</span>
        )}
        <span className="node-name">{node.name}</span>
        <span className={`node-tag ${node.node_type}`}>{node.node_type}</span>
        {node.value && <span className="node-val">{node.value}</span>}
      </div>
      {isOpen && hasChildren && (
        <div className="ast-children">
          {node.children!.map((child) => (
            <ASTNode key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
};

function App() {
  const [leftWidth, setLeftWidth] = useState(50);
  const [inputData, setInputData] = useState("");
  const [ast, setAst] = useState<ASTNodeData | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const handleScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!inputData.trim()) {
        setAst(null);
        return;
      }
      try {
        const result = await invoke<ASTNodeData>("assemble_ast", {
          jsonStr: inputData,
        });
        setAst(result);
      } catch (e) {
        console.error("Parse Error:", e);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [inputData]);

  const highlightedJson = useMemo(() => {
    return inputData
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        (match) => {
          let cls = "number";
          if (/^"/.test(match)) {
            cls = /:$/.test(match) ? "key" : "string";
          } else if (/true|false/.test(match)) {
            cls = "boolean";
          } else if (/null/.test(match)) {
            cls = "null";
          }
          return `<span class="${cls}">${match}</span>`;
        },
      );
  }, [inputData]);

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
        <div className="panel" style={{ width: `${leftWidth}%` }}>
          <div className="editor-container">
            <pre
              ref={preRef}
              className="highlight-layer"
              dangerouslySetInnerHTML={{ __html: highlightedJson + "\n" }}
            />
            <textarea
              ref={textareaRef}
              className="editor-input"
              value={inputData}
              onChange={(e) => setInputData(e.target.value)}
              onScroll={handleScroll}
              spellCheck={false}
            />
          </div>
        </div>
        <div className="divider" onMouseDown={() => setIsResizing(true)} />
        <div className="panel" style={{ width: `${100 - leftWidth}%` }}>
          <div className="output-area">
            {ast ? (
              <ASTNode node={ast} />
            ) : (
              <div className="placeholder">Enter valid JSON to see AST</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
// 8.3
