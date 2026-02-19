import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useJsonAnalyzer(inputData: string) {
  const [ast, setAst] = useState<ASTNodeData | null>(null);
  const [error, setError] = useState<JSONErrorInfo | null>(null);
  const [repaired, setRepaired] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    let isMounted = true;
    
    const analyze = async () => {
      if (!inputData.trim()) {
        setAst(null);
        setError(null);
        setRepaired(false);
        return;
      }

      setIsProcessing(true);
      try {
        const result = await invoke<AssembleResult>("assemble_ast", {
          jsonStr: inputData,
        });
        if (isMounted) {
          setAst(result.ast);
          setRepaired(result.repaired);
          setError(null);
        }
      } catch (e) {
        if (isMounted) {
          setAst(null);
          setRepaired(false);
          setError(e as JSONErrorInfo);
        }
      } finally {
        if (isMounted) {
          setIsProcessing(false);
        }
      }
    };

    analyze();

    return () => {
      isMounted = false;
    };
  }, [inputData]);

  return { ast, error, repaired, isProcessing };
}
