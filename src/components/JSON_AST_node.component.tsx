import { FC, useState } from "react";

export const JSONASTNode: FC<ASTNodeProps> = ({ node }) => {
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
            <JSONASTNode key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
};
