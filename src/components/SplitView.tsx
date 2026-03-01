import { FC, ReactNode, useCallback, useEffect, useState } from "react";

interface SplitViewProps {
  /** Render prop — receives the left panel's percentage width. */
  renderLeft: (widthPct: number) => ReactNode;
  /** Render prop — receives the right panel's percentage width. */
  renderRight: (widthPct: number) => ReactNode;
  defaultSplit?: number;
  /** Called when the user finishes resizing (mouseup). Use to restore editor focus. */
  onResizeEnd?: () => void;
}

export const SplitView: FC<SplitViewProps> = ({
  renderLeft,
  renderRight,
  defaultSplit = 50,
  onResizeEnd,
}) => {
  const [leftWidth, setLeftWidth] = useState(defaultSplit);
  const [isResizing, setIsResizing] = useState(false);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const pct = (e.clientX / window.innerWidth) * 100;
      if (pct > 10 && pct < 90) setLeftWidth(pct);
    },
    [isResizing],
  );

  useEffect(() => {
    const stop = () => {
      if (isResizing) onResizeEnd?.();
      setIsResizing(false);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stop);
    };
  }, [onMouseMove, isResizing, onResizeEnd]);

  // Prevent native text selection while dragging the divider
  useEffect(() => {
    if (isResizing) {
      document.body.classList.add("split-resizing");
    } else {
      document.body.classList.remove("split-resizing");
    }
    return () => document.body.classList.remove("split-resizing");
  }, [isResizing]);

  return (
    <div className="split-view">
      {renderLeft(leftWidth)}
      <div
        className="split-divider"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
      />
      {renderRight(100 - leftWidth)}
    </div>
  );
};
