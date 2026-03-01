// ── Rust wire types ───────────────────────────────────────────────────────────

/** Compact node returned by Rust — no recursive children. */
declare interface LazyNode {
  name: string;
  path_segment: string;
  node_type: string;
  value?: string;
  child_count: number;
}

declare interface ParseResult {
  nodes: LazyNode[];
  repaired: boolean;
}

// ── Frontend-only flat node (used by the virtual tree) ────────────────────────

/** One row in the virtual scroll list. */
declare interface FlatNode {
  /** Stable unique key: path joined with \0 — used as React key and Map key. */
  pathKey: string;
  name: string;
  node_type: string;
  value?: string;
  /** Indentation level; 0 = root's direct children. */
  depth: number;
  /** Full path from root to this node — passed to get_children / get_subtree. */
  path: string[];
  childCount: number;
}

// ── Search ────────────────────────────────────────────────────────────────────

declare interface SearchResult {
  name: string;
  node_type: string;
  value?: string;
  /** Navigation path (same format used by get_children / get_subtree). */
  path: string[];
  /** Human-readable path of the parent node, e.g. "packages › node_modules". Empty for root-level nodes. */
  path_display: string;
  child_count: number;
  match_in: "key" | "value";
}

// ── Error types ───────────────────────────────────────────────────────────────

interface ErrorLocation {
  line: number;
  column: number;
}

interface JSONErrorInfo {
  message: string;
  location?: ErrorLocation;
}

// ── Legacy (kept for assemble_ast / highlight_json) ───────────────────────────

declare interface ASTNodeData {
  id: string;
  name: string;
  node_type: string;
  value?: string;
  children?: ASTNodeData[];
}

declare interface AssembleResult {
  ast: ASTNodeData;
  repaired: boolean;
}

declare interface HiglightedToken {
  text: string;
  token_type: string;
}

// ── Component props ───────────────────────────────────────────────────────────

declare interface ASTExplorerPanelProps {
  rootNodes: FlatNode[];
  error: JSONErrorInfo | null;
  repaired: boolean;
  width: number;
  searchQuery: string;
  isSearchFocused: boolean;
  loadChildren: (parentPath: string[]) => Promise<FlatNode[]>;
}

declare interface EditorPanelProps {
  value: string;
  onChange: (val: string) => void;
  width: number;
}

/** Still referenced by JSON_AST_node.component.tsx (legacy, unused by the app). */
declare interface ASTNodeProps {
  node: ASTNodeData;
  path?: string;
}
