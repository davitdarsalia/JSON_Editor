import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Convert a LazyNode from Rust into a FlatNode for the virtual tree. */
function toFlatNode(n: LazyNode, depth: number, path: string[]): FlatNode {
  return {
    pathKey: path.join("\x00"),
    name: n.name,
    node_type: n.node_type,
    value: n.value,
    depth,
    path,
    childCount: n.child_count,
  };
}

export function useJsonAnalyzer(inputData: string) {
  const [rootNodes, setRootNodes] = useState<FlatNode[]>([]);
  const [error, setError] = useState<JSONErrorInfo | null>(null);
  const [repaired, setRepaired] = useState(false);

  useEffect(() => {
    // Clear immediately when input is emptied
    if (!inputData.trim()) {
      setRootNodes([]);
      setError(null);
      setRepaired(false);
      return;
    }

    // 300 ms debounce — avoids hammering Rust on every keystroke / paste char
    const timer = setTimeout(async () => {
      try {
        const result = await invoke<ParseResult>("parse_json", {
          jsonStr: inputData,
        });
        const nodes = result.nodes.map((n) => toFlatNode(n, 0, [n.name]));
        setRootNodes(nodes);
        setRepaired(result.repaired);
        setError(null);
      } catch (e) {
        setRootNodes([]);
        setRepaired(false);
        setError(e as JSONErrorInfo);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inputData]);

  /**
   * Lazy-load the children of a node.
   * Called by VirtualASTTree when the user expands a container node.
   * Children's depth = parentPath.length (root children are at depth 0).
   */
  const loadChildren = useCallback(
    async (parentPath: string[]): Promise<FlatNode[]> => {
      const childDepth = parentPath.length;
      const children = await invoke<LazyNode[]>("get_children", {
        path: parentPath,
      });
      return children.map((n) => {
        const childPath = [...parentPath, n.name];
        return toFlatNode(n, childDepth, childPath);
      });
    },
    [],
  );

  return { rootNodes, error, repaired, loadChildren };
}
