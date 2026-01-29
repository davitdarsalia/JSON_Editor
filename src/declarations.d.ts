declare interface ASTNodeData {
  id: string;
  name: string;
  node_type: string;
  value?: string;
  children?: ASTNodeData[];
  depth: number;
}
