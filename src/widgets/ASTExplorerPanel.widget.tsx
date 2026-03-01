import { FC, useEffect, useState } from "react";
import { VirtualASTTree } from "../components/VirtualASTTree";

export const ASTExplorerPanel: FC<ASTExplorerPanelProps> = ({
  rootNodes,
  error,
  repaired,
  width,
  searchQuery,
  isSearchFocused,
  loadChildren,
}) => {
  const [dismissedWarning, setDismissedWarning] = useState(false);

  // Re-show the warning banner whenever the tree changes
  useEffect(() => {
    setDismissedWarning(false);
  }, [rootNodes]);

  return (
    <div
      className="panel output-panel"
      style={{ width: `${width}%`, display: "flex", flexDirection: "column" }}
    >
      <div
        className="output-area"
        style={{
          flex: 1,
          overflowY: "hidden", // VirtualASTTree handles its own scroll
          overflowX: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Auto-repair warning */}
        {repaired && !error && !dismissedWarning && (
          <div
            style={{
              background: "rgba(255, 165, 0, 0.1)",
              borderLeft: "4px solid orange",
              padding: "12px",
              flexShrink: 0,
              fontFamily: "var(--mono-font)",
              fontSize: 14,
              position: "relative",
            }}
          >
            <button
              onClick={() => setDismissedWarning(true)}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "rgba(255, 165, 0, 0.2)",
                border: "none",
                color: "orange",
                width: 24,
                height: 24,
                borderRadius: 12,
                cursor: "pointer",
                fontSize: 14,
              }}
              title="Dismiss"
            >
              ✕
            </button>
            <strong
              style={{
                color: "orange",
                display: "block",
                marginBottom: 4,
                fontSize: 14,
              }}
            >
              ⚠️ Auto-Repaired JSON
            </strong>
            <span style={{ color: "var(--syntax-null)", fontSize: 14 }}>
              Your JSON had errors (trailing commas / comments) that were
              automatically fixed.
            </span>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="error-banner" style={{ flexShrink: 0 }}>
            <span className="error-title">Invalid JSON</span>
            <p className="error-msg">{error.message}</p>
            {error.location && (
              <span className="error-loc">
                Go to line {error.location.line}, column {error.location.column} to fix it
              </span>
            )}
          </div>
        )}

        {rootNodes.length > 0 ? (
          <div style={{ flex: 1, overflow: "hidden" }}>
            <VirtualASTTree
              rootNodes={rootNodes}
              loadChildren={loadChildren}
              searchQuery={searchQuery}
            />
          </div>
        ) : (
          !error && (
            <div className="placeholder">
              {searchQuery && isSearchFocused
                ? "No results found"
                : "Enter valid JSON to see structure"}
            </div>
          )
        )}
      </div>
    </div>
  );
};
