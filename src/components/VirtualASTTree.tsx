import {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fixed row height in px — every row is exactly this tall. */
const ROW_H = 34;
/** Extra rows rendered above and below the visible viewport. */
const OVERSCAN = 8;

// ── Flatten helpers ───────────────────────────────────────────────────────────

function flattenTree(
  nodes: FlatNode[],
  expanded: ReadonlySet<string>,
  childrenMap: ReadonlyMap<string, FlatNode[]>,
): FlatNode[] {
  const out: FlatNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (expanded.has(node.pathKey) && node.childCount > 0) {
      const children = childrenMap.get(node.pathKey);
      if (children) {
        out.push(...flattenTree(children, expanded, childrenMap));
      }
      // children not yet fetched → gap intentionally empty while loading
    }
  }
  return out;
}

// ── NodeRow ───────────────────────────────────────────────────────────────────

interface RowProps {
  node: FlatNode;
  isExpanded: boolean;
  isLoading: boolean;
  onToggle: (node: FlatNode) => void;
  onCopyNode: (node: FlatNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FlatNode) => void;
}

const NodeRow: FC<RowProps> = ({
  node,
  isExpanded,
  isLoading,
  onToggle,
  onCopyNode,
  onContextMenu,
}) => {
  const indent = node.depth * 20 + 8;

  return (
    <div
      className="ast-label"
      style={{ paddingLeft: indent, height: ROW_H, boxSizing: "border-box" }}
      onClick={() => onCopyNode(node)}
      onContextMenu={(e) => onContextMenu(e, node)}
    >
      {/* Expand toggle */}
      <span
        className={`toggle-icon ${isExpanded ? "open" : ""}`}
        style={{ visibility: node.childCount > 0 ? "visible" : "hidden" }}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(node);
        }}
      >
        {isLoading ? "⋯" : "▶"}
      </span>

      <span className="node-name">{node.name}</span>
      <span className={`node-tag ${node.node_type}`}>{node.node_type}</span>

      {node.value !== undefined && (
        <span className="node-val">{node.value}</span>
      )}

      {/* Child count hint when collapsed */}
      {node.childCount > 0 && !isExpanded && (
        <span
          style={{
            color: "#666",
            fontSize: 11,
            marginLeft: 6,
            fontFamily: "Inter, sans-serif",
          }}
        >
          {node.childCount} {node.node_type === "array" ? "items" : "fields"}
        </span>
      )}
    </div>
  );
};

// ── VirtualASTTree ────────────────────────────────────────────────────────────

interface Props {
  rootNodes: FlatNode[];
  loadChildren: (parentPath: string[]) => Promise<FlatNode[]>;
  searchQuery: string;
  isSearchFocused: boolean;
}

export const VirtualASTTree: FC<Props> = ({
  rootNodes,
  loadChildren,
  searchQuery,
  isSearchFocused,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  // Track which path keys are expanded and which have had their children loaded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Map<string, FlatNode[]>>(
    new Map(),
  );

  // Reset expansion when root nodes change (new JSON pasted)
  useEffect(() => {
    setExpanded(new Set());
    setChildrenMap(new Map());
  }, [rootNodes]);

  // Watch viewport size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setViewportH(entry.contentRect.height),
    );
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // ── Flat list (memoised) ────────────────────────────────────────────────────

  const flatNodes = useMemo(() => {
    let nodes = flattenTree(rootNodes, expanded, childrenMap);

    // Filter by search query (only loaded nodes are searchable)
    if (searchQuery.trim() && isSearchFocused) {
      const q = searchQuery.toLowerCase();
      nodes = nodes.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          (n.value?.toLowerCase().includes(q) ?? false),
      );
    }

    return nodes;
  }, [rootNodes, expanded, childrenMap, searchQuery, isSearchFocused]);

  // ── Virtual scroll maths ────────────────────────────────────────────────────

  const totalH = flatNodes.length * ROW_H;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endIdx = Math.min(
    flatNodes.length,
    Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN,
  );
  const visibleNodes = flatNodes.slice(startIdx, endIdx);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (node: FlatNode) => {
      if (node.childCount === 0) return;
      const { pathKey, path } = node;

      if (expanded.has(pathKey)) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(pathKey);
          return next;
        });
        return;
      }

      // Mark expanded immediately so the loading spinner appears
      setExpanded((prev) => new Set([...prev, pathKey]));

      if (!childrenMap.has(pathKey)) {
        try {
          const children = await loadChildren(path);
          setChildrenMap((prev) => new Map([...prev, [pathKey, children]]));
        } catch {
          // On error collapse again
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(pathKey);
            return next;
          });
        }
      }
    },
    [expanded, childrenMap, loadChildren],
  );

  const handleCopyNode = useCallback(async (node: FlatNode) => {
    let text: string;

    if (node.childCount === 0) {
      // Leaf — copy value as-is
      const isArrayItem = /^\[\d+\]$/.test(node.name);
      const raw = node.value ?? "null";
      text = isArrayItem
        ? raw
        : JSON.stringify({ [node.name]: node.node_type === "string" ? raw : JSON.parse(raw) }, null, 2);
    } else {
      // Container — ask Rust for the serialised subtree
      try {
        const json = await invoke<string>("get_subtree", { path: node.path });
        const isArrayItem = /^\[\d+\]$/.test(node.name);
        text = isArrayItem
          ? json
          : JSON.stringify({ [node.name]: JSON.parse(json) }, null, 2);
      } catch {
        text = "{}";
      }
    }

    navigator.clipboard.writeText(text).then(() =>
      window.dispatchEvent(
        new CustomEvent("show-snackbar", {
          detail: { message: `Copied ${node.name}` },
        }),
      ),
    );
  }, []);

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent, node: FlatNode) => {
      e.preventDefault();
      e.stopPropagation();

      const getSubtreeText = async () => {
        if (node.childCount === 0) return node.value ?? "null";
        return invoke<string>("get_subtree", { path: node.path });
      };

      try {
        const { Menu } = await import("@tauri-apps/api/menu");

        const copyNode = await (await import("@tauri-apps/api/menu")).MenuItem.new({
          id: "copy-node",
          text: "Copy Node",
          action: async () => {
            const val = await getSubtreeText();
            const isArrayItem = /^\[\d+\]$/.test(node.name);
            const text =
              isArrayItem || node.childCount > 0
                ? val
                : JSON.stringify({ [node.name]: node.node_type === "string" ? val : JSON.parse(val as string) }, null, 2);
            navigator.clipboard.writeText(text as string);
            window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: "Copied node" } }));
          },
        });

        const copyValue = await (await import("@tauri-apps/api/menu")).MenuItem.new({
          id: "copy-value",
          text: "Copy Value Only",
          action: async () => {
            const val = await getSubtreeText();
            navigator.clipboard.writeText(val as string);
            window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: "Copied value" } }));
          },
        });

        const copyKey = await (await import("@tauri-apps/api/menu")).MenuItem.new({
          id: "copy-key",
          text: "Copy Key",
          action: () => {
            navigator.clipboard.writeText(node.name);
            window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: "Copied key" } }));
          },
        });

        const copyPath = await (await import("@tauri-apps/api/menu")).MenuItem.new({
          id: "copy-path",
          text: "Copy JSON Path",
          action: () => {
            const path = node.path
              .map((seg) => (/^\[\d+\]$/.test(seg) ? seg : `.${seg}`))
              .join("")
              .replace(/^\./, "");
            navigator.clipboard.writeText(path);
            window.dispatchEvent(new CustomEvent("show-snackbar", { detail: { message: "Copied path" } }));
          },
        });

        const menu = await Menu.new({ items: [copyNode, copyValue, copyKey, copyPath] });
        await menu.popup();
      } catch {
        // Fallback: just copy node
        handleCopyNode(node);
      }
    },
    [handleCopyNode],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  if (rootNodes.length === 0) return null;

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        overflowY: "auto",
        overflowX: "auto",
        position: "relative",
      }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* Spacer that gives the scrollbar its full range */}
      <div style={{ height: totalH, position: "relative", minWidth: "max-content" }}>
        {visibleNodes.map((node, i) => {
          const absIdx = startIdx + i;
          const isExpanded_ = expanded.has(node.pathKey);
          const isLoading_ =
            isExpanded_ && node.childCount > 0 && !childrenMap.has(node.pathKey);

          return (
            <div
              key={node.pathKey}
              style={{
                position: "absolute",
                top: absIdx * ROW_H,
                height: ROW_H,
                width: "100%",
                display: "flex",
                alignItems: "center",
              }}
            >
              <NodeRow
                node={node}
                isExpanded={isExpanded_}
                isLoading={isLoading_}
                onToggle={handleToggle}
                onCopyNode={handleCopyNode}
                onContextMenu={handleContextMenu}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
