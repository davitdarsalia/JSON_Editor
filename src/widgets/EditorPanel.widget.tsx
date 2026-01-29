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
  const [tokens, setTokens] = useState<HighlightedToken[]>([]);

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
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div className="panel" style={{ width: `${width}%` }}>
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
  );
};
