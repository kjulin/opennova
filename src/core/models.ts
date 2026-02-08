/**
 * Supported Claude models.
 * Add new models here to make them available throughout the codebase.
 */
export const MODELS = ["sonnet", "opus", "haiku"] as const;

export type Model = (typeof MODELS)[number];
