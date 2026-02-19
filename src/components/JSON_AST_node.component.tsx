import { FC, useState } from "react";

function reconstructAST(node: ASTNodeData): any {
  if (node.node_type === "object") {
    const obj: any = {};
    if (node.children) {
      for (const child of node.children) {
        obj[child.name] = reconstructAST(child);
      }
    }
    return obj;
  }
  if (node.node_type === "array") {
    const arr: any[] = [];
    if (node.children) {
      for (const child of node.children) {
        arr.push(reconstructAST(child));
      }
    }
    return arr;
  }
  if (node.node_type === "number") return Number(node.value);
  if (node.node_type === "boolean") return node.value === "true";
  if (node.node_type === "null") return null;
  return node.value;
}

export const JSONASTNode: FC<ASTNodeProps> = ({ node, path }) => {
  const [isOpen, setIsOpen] = useState(true);

  const hasChildren = node.children && node.children.length > 0;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Deep copy only what this node contains
    const reconstructed = reconstructAST(node);
    
    // Include key if it's an object property (not root and not an array index)
    let finalData = reconstructed;
    if (node.name !== "root" && !node.name.match(/^\[\d+\]$/)) {
      finalData = { [node.name]: reconstructed };
    }

    const jsonString = JSON.stringify(finalData, null, 2);
    
    navigator.clipboard.writeText(jsonString).then(() => {
      window.dispatchEvent(
        new CustomEvent("show-snackbar", {
          detail: { message: `Copied ${node.name} to clipboard` }
        })
      );
    }).catch(err => {
      console.error("Failed to copy", err);
    });
  };

  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const reconstructed = reconstructAST(node);
    const hasValue = node.value !== undefined || node.children !== undefined;

    try {
      const { Menu, Submenu } = await import("@tauri-apps/api/menu");
      const items = [];
      
      items.push({
        id: "copy-node",
        text: "📄 Copy Node",
        action: () => {
          let finalData = reconstructed;
          if (node.name !== "root" && !node.name.match(/^\[\d+\]$/)) {
            finalData = { [node.name]: reconstructed };
          }
          const copyText = JSON.stringify(finalData, null, 2);
          navigator.clipboard.writeText(copyText).then(() => {
            window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: `Copied node to clipboard` } }));
          });
        }
      });

      if (hasValue) {
        items.push({
          id: "copy-value",
          text: "📋 Copy Value Only",
          action: () => {
            const copyText = typeof reconstructed === "object" ? JSON.stringify(reconstructed, null, 2) : String(reconstructed);
            navigator.clipboard.writeText(copyText).then(() => {
              window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: `Copied value to clipboard` } }));
            });
          }
        });
      }

      if (!node.name.match(/^\[\d+\]$/)) {
        items.push({
          id: "copy-key",
          text: "🔑 Copy Key Only",
          action: () => {
            navigator.clipboard.writeText(node.name).then(() => {
              window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: `Copied key to clipboard` } }));
            });
          }
        });
      }

      items.push({
        id: "copy-path",
        text: "🔗 Copy JSON Path",
        action: () => {
          navigator.clipboard.writeText(path || "").then(() => {
            window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: `Copied path to clipboard` } }));
          });
        }
      });

      // Submenu for copying Types
      const copyTypeSubmenu = await Submenu.new({
        text: "📦 Copy Type",
        items: [
          {
            id: "type-ts",
            text: "TypeScript",
            action: () => {
              // Stub: would normally generate TS type
              window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: `Copied TypeScript interface` } }));
            }
          },
          {
            id: "type-rust",
            text: "Rust",
            action: () => {
              window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: `Copied Rust struct` } }));
            }
          },
          {
            id: "type-go",
            text: "Go",
            action: () => {
              window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: `Copied Go struct` } }));
            }
          },
          {
            id: "type-python",
            text: "Python",
            action: () => {
              window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: `Copied Python dict` } }));
            }
          },
          {
            id: "type-swift",
            text: "Swift",
            action: () => {
              window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: `Copied Swift struct` } }));
            }
          }
        ]
      });

      items.push(copyTypeSubmenu);

      const menu = await Menu.new({ items });
      await menu.popup();
    } catch (err) {
      console.error("Failed to show native context menu:", err);
    }
  };

  return (
    <div className="ast-node">
      <div 
        className="ast-label" 
        onClick={handleCopy} 
        onContextMenu={handleContextMenu}
        style={{ cursor: "pointer" }}
      >
        {hasChildren && (
          <span 
            className={`toggle-icon ${isOpen ? "open" : ""}`} 
            onClick={handleToggle}
            style={{ display: 'inline-block', width: '20px', textAlign: 'center' }}
          >
            ▶
          </span>
        )}
        <span className="node-name">{node.name}</span>
        <span className={`node-tag ${node.node_type}`}>{node.node_type}</span>
        {node.value && <span className="node-val">{node.value}</span>}
      </div>
      {hasChildren && (
        <div className={`ast-children-wrapper ${isOpen ? "open" : ""}`}>
          <div className="ast-children">
            {node.children!.map((child) => {
              const childName = child.name;
              const isArrayItem = childName.match(/^\[\d+\]$/);
              const childPath = path 
                ? (isArrayItem ? `${path}${childName}` : `${path}.${childName}`) 
                : childName;

              return (
                <JSONASTNode key={child.id} node={child} path={childPath} />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

