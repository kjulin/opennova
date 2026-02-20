import { useEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface AutoResizeTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
}

export function AutoResizeTextarea({
  value,
  onChange,
  minRows = 8,
  className,
  ...props
}: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={minRows}
      className={cn(
        "w-full resize-none font-mono text-sm bg-background border border-border rounded-md p-3 focus:outline-none focus:ring-1 focus:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
