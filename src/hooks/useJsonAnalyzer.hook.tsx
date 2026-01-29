import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useJsonAnalyzer(inputData: string) {
  const [ast, setAst] = useState<ASTNodeData | null>(null);
  const [error, setError] = useState<JSONErrorInfo | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!inputData.trim()) {
        setAst(null);
        setError(null);
        return;
      }

      setIsProcessing(true);
      try {
        const result = await invoke<ASTNodeData>("assemble_ast", {
          jsonStr: inputData,
        });
        setAst(result);
        setError(null);
      } catch (e) {
        setAst(null);
        setError(e as JSONErrorInfo);
      } finally {
        setIsProcessing(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [inputData]);

  return { ast, error, isProcessing };
}
