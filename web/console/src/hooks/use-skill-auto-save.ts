import { useState, useEffect, useRef } from "react";
import { updateSkill } from "@/api";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 1000;

export function useSkillAutoSave(
  skillName: string,
  field: "description" | "content",
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
        await updateSkill(skillName, { [field]: value });
        lastSavedRef.current = value;
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutRef.current);
  }, [skillName, field, value, enabled]);

  // When skillName changes, reset
  useEffect(() => {
    hasMountedRef.current = false;
    lastSavedRef.current = value;
  }, [skillName]);

  return status;
}
