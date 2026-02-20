import { useState, useEffect, useRef, useCallback } from "react";
import { patchAgent } from "@/api";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 1000;

export function useAutoSave(
  agentId: string,
  field: string,
  value: string,
  enabled = true,
) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<number>();
  const initialRef = useRef(true);

  useEffect(() => {
    // Skip the initial render — don't save the value that was just loaded
    if (initialRef.current) {
      initialRef.current = false;
      return;
    }

    if (!enabled) return;

    clearTimeout(timeoutRef.current);
    setStatus("idle");
    timeoutRef.current = window.setTimeout(async () => {
      setStatus("saving");
      try {
        await patchAgent(agentId, { [field]: value });
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutRef.current);
  }, [agentId, field, value, enabled]);

  return status;
}

// For immediate saves (selects, checkboxes, lists)
export function useImmediateSave(agentId: string) {
  const [status, setStatus] = useState<SaveStatus>("idle");

  const save = useCallback(
    async (fields: Record<string, unknown>) => {
      setStatus("saving");
      try {
        await patchAgent(agentId, fields as Partial<import("@/types").Agent>);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    },
    [agentId],
  );

  return { status, save };
}
