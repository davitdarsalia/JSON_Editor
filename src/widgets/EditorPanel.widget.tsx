import { invoke } from "@tauri-apps/api/core";
import { FC, useEffect, useMemo, useRef, useState } from "react";

interface HighlightedToken {
  text: string;
  token_type: string;
}

interface EditorPanelProps {
  value: string;
  onChange: (val: string) => void;
  width: number;
}

export const EditorPanel: FC<EditorPanelProps> = ({
  value,
  onChange,
  width,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [tokens, setTokens] = useState<HighlightedToken[]>([]);

  const lineNumbers = useMemo(() => {
    const lines = value.split("\n").length;
    return Array.from({ length: lines > 0 ? lines : 1 }, (_, i) => i + 1);
  }, [value]);

  useEffect(() => {
    const fetchHighlight = async () => {
      try {
        const res = await invoke<HighlightedToken[]>("highlight_json", {
          jsonStr: value,
        });
        setTokens(res);
      } catch (e) {
        console.error(e);
      }
    };
    fetchHighlight();
  }, [value]);

  const renderedHtml = useMemo(() => {
    return tokens
      .map((t) => `<span class="${t.token_type}">${t.text}</span>`)
      .join("");
  }, [tokens]);

  const handleScroll = () => {
    if (textareaRef.current && preRef.current && gutterRef.current) {
      const { scrollTop, scrollLeft } = textareaRef.current;

      preRef.current.scrollTop = scrollTop;
      gutterRef.current.scrollTop = scrollTop;

      preRef.current.scrollLeft = scrollLeft;
    }
  };

  return (
    <div className="panel" style={{ width: `${width}%` }}>
      <div className="editor-layout">
        <div className="gutter" ref={gutterRef}>
          {lineNumbers.map((num) => (
            <div key={num} className="line-number">
              {num}
            </div>
          ))}
        </div>
        <div className="editor-container">
          <pre
            ref={preRef}
            className="highlight-layer"
            dangerouslySetInnerHTML={{ __html: renderedHtml + "\n" }}
          />
          <textarea
            ref={textareaRef}
            className="editor-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={handleScroll}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
};
