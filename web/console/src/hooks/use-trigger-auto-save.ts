import { useState, useEffect, useRef, useCallback } from "react";
import { patchTrigger } from "@/api";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 1000;

export function useTriggerAutoSave(
  triggerId: string,
  field: "cron" | "prompt",
  value: string,
  enabled = true,
) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<number>(undefined);
  const lastSavedRef = useRef(value);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      lastSavedRef.current = value;
      return;
    }

    if (value === lastSavedRef.current) return;

    if (!enabled) return;

    clearTimeout(timeoutRef.current);
    setStatus("idle");
    timeoutRef.current = window.setTimeout(async () => {
      setStatus("saving");
      try {
        await patchTrigger(triggerId, { [field]: value });
        lastSavedRef.current = value;
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutRef.current);
  }, [triggerId, field, value, enabled]);

  useEffect(() => {
    hasMountedRef.current = false;
    lastSavedRef.current = value;
  }, [triggerId]);

  return status;
}

export function useImmediateTriggerSave(triggerId: string) {
  const [status, setStatus] = useState<SaveStatus>("idle");

  const save = useCallback(
    async (fields: Record<string, unknown>) => {
      setStatus("saving");
      try {
        await patchTrigger(triggerId, fields as Partial<{ cron: string; tz: string; prompt: string; enabled: boolean }>);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    },
    [triggerId],
  );

  return { status, save };
}
