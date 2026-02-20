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
  const lastSavedRef = useRef(value);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    // Don't save until the hook has been active for at least one render cycle.
    // This prevents saving the initial value loaded from the API.
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      lastSavedRef.current = value;
      return;
    }

    // Don't save if value hasn't actually changed from what's on the server
    if (value === lastSavedRef.current) return;

    if (!enabled) return;

    clearTimeout(timeoutRef.current);
    setStatus("idle");
    timeoutRef.current = window.setTimeout(async () => {
      setStatus("saving");
      try {
        await patchAgent(agentId, { [field]: value });
        lastSavedRef.current = value;
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutRef.current);
  }, [agentId, field, value, enabled]);

  // When agentId changes (navigating to different agent), reset
  useEffect(() => {
    hasMountedRef.current = false;
    lastSavedRef.current = value;
  }, [agentId]);

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
