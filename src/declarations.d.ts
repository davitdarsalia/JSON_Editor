declare interface ASTNodeData {
  id: string;
  name: string;
  node_type: string;
  value?: string;
  children?: ASTNodeData[];
  depth: number;
}

interface ErrorLocation {
  line: number;
  column: number;
}

interface JSONErrorInfo {
  message: string;
  location?: ErrorLocation;
}

declare interface HiglightedToken {
  text: string;
  token_type: string;
}

/*
  Props
*/
declare interface ASTExplorerPanelProps {
  ast: ASTNodeData | null;
  error: JSONErrorInfo | null;
  width: number;
}

declare interface EditorPanelProps {
  value: string;
  onChange: (val: string) => void;
  width: number;
}

declare interface ASTNodeProps {
  node: ASTNodeData;
}
