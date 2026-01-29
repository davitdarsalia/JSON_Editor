import { FC, useState, MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

interface JSONASTNodeProps {
  node: ASTNodeData;
  rawJson: string;
  path?: string[];
}

export const JSONASTNode: FC<JSONASTNodeProps> = ({
  node,
  rawJson,
  path = [],
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  // Track the JSON path for this node (e.g. root.dependencies.react)
  const currentPath = node.name === "root" ? ["root"] : [...path, node.name];

  const handleAction = async (e: MouseEvent) => {
    e.stopPropagation();

    // Copy to Clipboard Mode: Cmd (Mac) or Ctrl (Windows)
    if (e.metaKey || e.ctrlKey) {
      try {
        await invoke("copy_node_to_clipboard", {
          jsonStr: rawJson,
          path: currentPath,
        });
      } catch (err) {
        console.error("Copy Error:", err);
      }
    } else {
      // Normal Toggle
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className="ast-node">
      <div className="ast-label" onClick={handleAction}>
        {hasChildren && (
          <span className={`toggle-icon ${isOpen ? "open" : ""}`}>▶</span>
        )}
        <span className="node-name">{node.name}</span>
        <span className={`node-tag ${node.node_type}`}>{node.node_type}</span>
        {node.value && <span className="node-val">{node.value}</span>}
      </div>

      <div className={`ast-children ${!isOpen ? "closed" : ""}`}>
        {hasChildren &&
          node.children!.map((child) => (
            <JSONASTNode
              key={child.id}
              node={child}
              rawJson={rawJson}
              path={currentPath}
            />
          ))}
      </div>
    </div>
  );
};
