import { useEffect } from "react";
import type { EditSuggestion } from "#core/index.js";

interface UseSuggestionExpirationOptions {
  suggestion: EditSuggestion | null;
  onExpire: () => void;
}

export function useSuggestionExpiration({
  suggestion,
  onExpire,
}: UseSuggestionExpirationOptions) {
  useEffect(() => {
    if (!suggestion) return;

    const timeUntilExpiry = suggestion.expiresAt - Date.now();
    if (timeUntilExpiry <= 0) {
      onExpire();
      return;
    }

    const timer = setTimeout(onExpire, timeUntilExpiry);
    return () => clearTimeout(timer);
  }, [suggestion, onExpire]);
}
