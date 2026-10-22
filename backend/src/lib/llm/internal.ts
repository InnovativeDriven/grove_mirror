// Internal LLM provider adapter.
//
// Talks to any OpenAI-compatible endpoint (vLLM, Ollama, LiteLLM, Azure
// OpenAI, etc.) via the standard Chat Completions API using fetch — no
// extra npm dependency needed.
//
//   INTERNAL_LLM_BASE_URL   — required, e.g. https://llm.corp.com/v1
//   INTERNAL_LLM_API_KEY    — optional; many internal servers don't need one
//
// The "internal/" prefix is stripped before the model name is sent to the
// server so callers can use "internal/llama-3" and the server receives
// "llama-3".

import type {
    StreamChatParams,
    StreamChatResult,
    NormalizedToolCall,
    NormalizedToolResult,
} from "./types";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function baseURL(): string {
    const url = process.env.INTERNAL_LLM_BASE_URL?.trim();
    if (!url) {
        throw new Error(
            "INTERNAL_LLM_BASE_URL is not configured. " +
                "Set this environment variable to point at your internal " +
                "OpenAI-compatible endpoint (e.g. https://llm.corp.com/v1).",
        );
    }
    return url.replace(/\/$/, ""); // strip trailing slash
}

function apiKey(override?: string | null): string {
    // Fall back to "none" — many internal servers accept any non-empty string.
    return (
        override?.trim() ||
        process.env.INTERNAL_LLM_API_KEY?.trim() ||
        "none"
    );
}

function resolveModelName(model: string): string {
    return model.startsWith("internal/") ? model.slice("internal/".length) : model;
}

function authHeaders(keyOverride?: string | null): Record<string, string> {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey(keyOverride)}`,
    };
}

// ---------------------------------------------------------------------------
// Shared types (plain objects, no SDK dependency)
// ---------------------------------------------------------------------------

type ChatMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string | null; tool_calls?: ToolCallObject[] }
    | { role: "tool"; tool_call_id: string; content: string };

type ToolCallObject = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

type ToolDefinition = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
};

// SSE chunk shape for chat completions streaming
type CompletionChunk = {
    choices: {
        delta: {
            content?: string | null;
            tool_calls?: {
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
            }[];
        };
        finish_reason?: string | null;
    }[];
};

// Non-streaming completion response shape
type CompletionResponse = {
    choices: {
        message: { content?: string | null };
    }[];
};

// ---------------------------------------------------------------------------
// SSE parser (mirrors the approach in openai.ts)
// ---------------------------------------------------------------------------

function extractSseJson(buffer: string): { events: unknown[]; rest: string } {
    const events: unknown[] = [];
    const chunks = buffer.split(/\n\n/);
    const rest = chunks.pop() ?? "";
    for (const chunk of chunks) {
        const dataLines = chunk
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
        for (const data of dataLines) {
            if (!data || data === "[DONE]") continue;
            try {
                events.push(JSON.parse(data));
            } catch {
                // incomplete — stays buffered
            }
        }
    }
    return { events, rest };
}

// ---------------------------------------------------------------------------
// streamInternal
// ---------------------------------------------------------------------------

export async function streamInternal(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const {
        model,
        systemPrompt,
        tools = [],
        callbacks = {},
        runTools,
        apiKeys,
    } = params;
    const maxIter = params.maxIterations ?? 10;
    const actualModel = resolveModelName(model);
    const url = `${baseURL()}/chat/completions`;

    const openaiTools: ToolDefinition[] = tools.map((t) => ({
        type: "function",
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        },
    }));

    const history: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...params.messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        })),
    ];

    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        const response = await fetch(url, {
            method: "POST",
            headers: authHeaders(apiKeys?.internal),
            body: JSON.stringify({
                model: actualModel,
                messages: history,
                tools: openaiTools.length > 0 ? openaiTools : undefined,
                stream: true,
            }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(
                `Internal LLM request failed (${response.status}): ${text || response.statusText}`,
            );
        }

        if (!response.body) throw new Error("Internal LLM response had no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantText = "";
        const pendingCalls: Record<
            number,
            { id: string; name: string; args: string }
        > = {};

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const { events, rest } = extractSseJson(buffer);
            buffer = rest;

            for (const event of events as CompletionChunk[]) {
                const choice = event.choices?.[0];
                if (!choice) continue;

                const delta = choice.delta;

                if (delta.content) {
                    assistantText += delta.content;
                    fullText += delta.content;
                    callbacks.onContentDelta?.(delta.content);
                }

                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!pendingCalls[idx]) {
                            pendingCalls[idx] = {
                                id: tc.id ?? "",
                                name: tc.function?.name ?? "",
                                args: "",
                            };
                            if (tc.function?.name) {
                                callbacks.onToolCallStart?.({
                                    id: tc.id ?? "",
                                    name: tc.function.name,
                                    input: {},
                                });
                            }
                        } else {
                            if (tc.id) pendingCalls[idx].id = tc.id;
                            if (tc.function?.name)
                                pendingCalls[idx].name += tc.function.name;
                        }
                        if (tc.function?.arguments) {
                            pendingCalls[idx].args += tc.function.arguments;
                        }
                    }
                }

                if (
                    choice.finish_reason === "stop" ||
                    choice.finish_reason === "tool_calls"
                ) {
                    break;
                }
            }
        }

        const toolCallList = Object.values(pendingCalls);
        if (toolCallList.length === 0 || !runTools) break;

        history.push({
            role: "assistant",
            content: assistantText || null,
            tool_calls: toolCallList.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.args },
            })),
        });

        const normalizedCalls: NormalizedToolCall[] = toolCallList.map((tc) => ({
            id: tc.id,
            name: tc.name,
            input: (() => {
                try {
                    return JSON.parse(tc.args || "{}") as Record<string, unknown>;
                } catch {
                    return {};
                }
            })(),
        }));

        const results: NormalizedToolResult[] = await runTools(normalizedCalls);

        for (const result of results) {
            history.push({
                role: "tool",
                tool_call_id: result.tool_use_id,
                content: result.content,
            });
        }
    }

    return { fullText };
}

// ---------------------------------------------------------------------------
// completeInternalText
// ---------------------------------------------------------------------------

export async function completeInternalText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { internal?: string | null };
}): Promise<string> {
    const actualModel = resolveModelName(params.model);
    const url = `${baseURL()}/chat/completions`;

    const messages: ChatMessage[] = [];
    if (params.systemPrompt) {
        messages.push({ role: "system", content: params.systemPrompt });
    }
    messages.push({ role: "user", content: params.user });

    const response = await fetch(url, {
        method: "POST",
        headers: authHeaders(params.apiKeys?.internal),
        body: JSON.stringify({
            model: actualModel,
            messages,
            max_tokens: params.maxTokens ?? 512,
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `Internal LLM request failed (${response.status}): ${text || response.statusText}`,
        );
    }

    const json = (await response.json()) as CompletionResponse;
    return json.choices[0]?.message?.content ?? "";
}
