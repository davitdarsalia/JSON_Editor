import { FC, useMemo, useState, useEffect } from "react";
import { JSONASTNode } from "../components/JSON_AST_node.component";

function filterAst(node: ASTNodeData, query: string): ASTNodeData | null {
  const lowerQuery = query.toLowerCase();
  
  const matchesName = node.name.toLowerCase().includes(lowerQuery);
  const matchesValue = node.value?.toLowerCase().includes(lowerQuery) || false;
  
  if (matchesName || matchesValue) {
    // If the node itself matches, we return the whole subtree unaltered
    return node;
  }
  
  if (node.children && node.children.length > 0) {
    const filteredChildren = node.children
      .map(child => filterAst(child, query))
      .filter((child): child is ASTNodeData => child !== null);
      
    if (filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
  }
  
  return null;
}

export const ASTExplorerPanel: FC<ASTExplorerPanelProps> = ({
  ast,
  error,
  repaired,
  width,
  searchQuery,
  isSearchFocused,
}) => {
  const [dismissedWarning, setDismissedWarning] = useState(false);

  useEffect(() => {
    setDismissedWarning(false);
  }, [ast]);

  const filteredAst = useMemo(() => {
    if (!ast) return null;
    if (!searchQuery.trim() || !isSearchFocused) return ast;
    return filterAst(ast, searchQuery);
  }, [ast, searchQuery, isSearchFocused]);

  return (
    <div className="panel" style={{ width: `${width}%`, display: 'flex', flexDirection: 'column' }}>
      <div 
        className="output-area" 
        style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', position: 'relative' }}
      >
        {repaired && !error && !dismissedWarning && (
          <div className="warning-banner" style={{
            background: 'rgba(255, 165, 0, 0.1)',
            borderLeft: '4px solid orange',
            padding: '12px',
            marginBottom: '16px',
            borderRadius: '0 4px 4px 0',
            fontFamily: 'Inter, sans-serif',
            position: 'relative',
            width: 'max-content',
            minWidth: '100%'
          }}>
            <button 
              onClick={() => setDismissedWarning(true)}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                background: 'rgba(255, 165, 0, 0.2)',
                border: 'none',
                color: 'orange',
                width: '24px',
                height: '24px',
                borderRadius: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                lineHeight: 1
              }}
              title="Dismiss"
            >
              ✕
            </button>
            <strong style={{ color: 'orange', display: 'block', marginBottom: '4px', fontSize: '14px' }}>
              ⚠️ Auto-Repaired JSON
            </strong>
            <span style={{ color: '#ccc', fontSize: '13px' }}>
              Your JSON contained errors (like trailing commas or comments) that were automatically fixed.
            </span>
          </div>
        )}

        {error && (
          <div className="error-banner">
            <span className="error-title">Syntax Error</span>
            <p className="error-msg">{error.message}</p>
            {error.location && (
              <span className="error-loc">
                Line: {error.location.line}, Col: {error.location.column}
              </span>
            )}
          </div>
        )}

        {filteredAst ? (
          filteredAst.name === "root" && filteredAst.children ? (
            <div className="ast-children root-children" style={{ borderLeft: 'none' }}>
              {filteredAst.children.map((child) => (
                <JSONASTNode key={child.id} node={child} path={child.name} />
              ))}
            </div>
          ) : (
            <JSONASTNode node={filteredAst} path={filteredAst.name} />
          )
        ) : (
          !error && (
            <div className="placeholder">
              {searchQuery && isSearchFocused ? "No results found" : "Enter valid JSON to see structure"}
            </div>
          )
        )}
      </div>
    </div>
  );
};
