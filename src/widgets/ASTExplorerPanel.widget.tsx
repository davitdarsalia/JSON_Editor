import { FC } from "react";
import { JSONASTNode } from "../components/JSON_AST_node.component";

export const ASTExplorerPanel: FC<ASTExplorerPanelProps> = ({
  ast,
  error,
  width,
}) => {
  return (
    <div className="panel" style={{ width: `${width}%` }}>
      <div className="output-area">
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

        {ast ? (
          <JSONASTNode node={ast} />
        ) : (
          !error && (
            <div className="placeholder">Enter valid JSON to see structure</div>
          )
        )}
      </div>
    </div>
  );
};
