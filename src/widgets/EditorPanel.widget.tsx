import { FC, useMemo, useRef } from "react";

export const EditorPanel: FC<EditorPanelProps> = ({
  value,
  onChange,
  width,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const handleScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const highlightedJson = useMemo(() => {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        (match) => {
          let cls = "number";
          if (/^"/.test(match)) cls = /:$/.test(match) ? "key" : "string";
          else if (/true|false/.test(match)) cls = "boolean";
          else if (/null/.test(match)) cls = "null";
          return `<span class="${cls}">${match}</span>`;
        },
      );
  }, [value]);

  return (
    <div className="panel" style={{ width: `${width}%` }}>
      <div className="editor-container">
        <pre
          ref={preRef}
          className="highlight-layer"
          dangerouslySetInnerHTML={{ __html: highlightedJson + "\n" }}
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
