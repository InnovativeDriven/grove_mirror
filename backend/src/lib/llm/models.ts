import type { Provider } from "./types";

// ---------------------------------------------------------------------------
// Canonical model IDs
// ---------------------------------------------------------------------------
// Main-chat tier (top-end) — user picks one of these per message.
export const CLAUDE_MAIN_MODELS = [
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
] as const;
export const GEMINI_MAIN_MODELS = [
    "gemini-3.1-pro-preview",
    "gemini-3.7-flash",
    "gemini-3-flash-preview",
] as const;
export const OPENAI_MAIN_MODELS = ["gpt-5.5", "gpt-5.4-mini"] as const;

// Mid-tier (used for tabular review) — user picks one in account settings.
export const CLAUDE_MID_MODELS = [
    "claude-sonnet-5",
    "claude-sonnet-4-6",
] as const;
export const GEMINI_MID_MODELS = [
    "gemini-3.7-flash",
    "gemini-3-flash-preview",
    "gemini-3.5-flash-lite",
] as const;
export const OPENAI_MID_MODELS = ["gpt-5.4-mini"] as const;

// Low-tier (used for title generation, lightweight extractions).
export const CLAUDE_LOW_MODELS = ["claude-haiku-4-5"] as const;
export const GEMINI_LOW_MODELS = ["gemini-3.1-flash-lite-preview"] as const;
export const OPENAI_LOW_MODELS = ["gpt-5.4-nano"] as const;

export const DEFAULT_MAIN_MODEL = "gemini-3-flash-preview";
export const DEFAULT_TITLE_MODEL = "gemini-3.1-flash-lite-preview";
export const DEFAULT_TABULAR_MODEL = "gemini-3-flash-preview";

// The model name sent to the internal endpoint. Reads from env so the server
// operator can set it without touching code. Falls back to "default" so
// endpoints that ignore the model field still work.

export function getDefaultInternalModel(): string {
    return process.env.INTERNAL_LLM_DEFAULT_MODEL?.trim() || "default";
}

const ALL_MODELS = new Set<string>([
    ...CLAUDE_MAIN_MODELS,
    ...GEMINI_MAIN_MODELS,
    ...OPENAI_MAIN_MODELS,
    ...CLAUDE_MID_MODELS,
    ...GEMINI_MID_MODELS,
    ...OPENAI_MID_MODELS,
    ...CLAUDE_LOW_MODELS,
    ...GEMINI_LOW_MODELS,
    ...OPENAI_LOW_MODELS,
]);

// ---------------------------------------------------------------------------
// Provider inference
// ---------------------------------------------------------------------------

export function providerForModel(model: string): Provider {
    // Check internal first — "internal/" prefix or the configured default
    // model name both route to the internal endpoint.
    if (
        model.startsWith("internal/") ||
        (process.env.INTERNAL_LLM_BASE_URL?.trim() &&
            model === getDefaultInternalModel())
    ) {
        return "internal";
    }
    if (model.startsWith("claude")) return "claude";
    if (model.startsWith("gemini")) return "gemini";
    if (model.startsWith("gpt-")) return "openai";
    throw new Error(`Unknown model id: ${model}`);
}

export function resolveModel(
    id: string | null | undefined,
    fallback: string,
): string {
    if (!id?.trim()) return fallback;
    // Any "internal/" prefixed string is accepted as-is — the model list on
    // an internal endpoint is operator-defined, not known at build time.
    if (id.startsWith("internal/")) return id;
    if (ALL_MODELS.has(id)) return id;
    return fallback;
}
