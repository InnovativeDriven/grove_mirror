import crypto from "crypto";
import { createServerSupabase } from "./supabase";
import type { UserApiKeys } from "./llm";

type Db = ReturnType<typeof createServerSupabase>;

const BUILTIN_PROVIDERS = ["claude", "gemini", "openai"] as const;
type BuiltinProvider = (typeof BUILTIN_PROVIDERS)[number];

// "internal" is only included in PROVIDERS when INTERNAL_LLM_BASE_URL is set.
// This means on deployments without it, nothing changes for existing users.
const INTERNAL_PROVIDER = "internal" as const;
type InternalProvider = typeof INTERNAL_PROVIDER;

export type ApiKeyProvider = BuiltinProvider | InternalProvider;
export type ApiKeySource = "user" | "env" | null;
export type ApiKeyStatus = Record<ApiKeyProvider, boolean> & {
    sources: Record<ApiKeyProvider, ApiKeySource>;
};

type EncryptedKeyRow = {
    provider: ApiKeyProvider;
    encrypted_key: string;
    iv: string;
    auth_tag: string;
};

// Dynamically include "internal" only when the base URL env var is configured.
function getProviders(): ApiKeyProvider[] {
    return [
        ...BUILTIN_PROVIDERS,
        ...(process.env.INTERNAL_LLM_BASE_URL?.trim() ? [INTERNAL_PROVIDER] : []),
    ];
}

function envApiKey(provider: ApiKeyProvider): string | null {
    if (provider === "claude") {
        return (
            process.env.ANTHROPIC_API_KEY?.trim() ||
            process.env.CLAUDE_API_KEY?.trim() ||
            null
        );
    }
    if (provider === "openai") {
        return process.env.OPENAI_API_KEY?.trim() || null;
    }
    if (provider === "gemini") {
        return process.env.GEMINI_API_KEY?.trim() || null;
    }
    if (provider === "internal") {
        // Internal endpoints often don't require a real key — fall back to
        // "none" so the provider is treated as available when the base URL
        // is set, even if no explicit API key is configured.
        return process.env.INTERNAL_LLM_API_KEY?.trim() || "none";
    }
    return null;
}

export function hasEnvApiKey(provider: ApiKeyProvider): boolean {
    return !!envApiKey(provider);
}

function encryptionKey(): Buffer {
    const secret = process.env.USER_API_KEYS_ENCRYPTION_SECRET;
    if (!secret) {
        throw new Error("USER_API_KEYS_ENCRYPTION_SECRET is not configured");
    }
    return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value: string): Omit<EncryptedKeyRow, "provider"> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
    ]);
    return {
        encrypted_key: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        auth_tag: cipher.getAuthTag().toString("base64"),
    };
}

function decrypt(row: EncryptedKeyRow): string | null {
    try {
        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            encryptionKey(),
            Buffer.from(row.iv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(row.encrypted_key, "base64")),
            decipher.final(),
        ]);
        return decrypted.toString("utf8");
    } catch (err) {
        console.error("[user-api-keys] failed to decrypt stored key", {
            provider: row.provider,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

function isProvider(value: string): value is ApiKeyProvider {
    return (getProviders() as string[]).includes(value);
}


export function normalizeApiKeyProvider(value: string): ApiKeyProvider | null {
    return isProvider(value) ? value : null;
}

export async function getUserApiKeyStatus(
    userId: string,
    db: Db = createServerSupabase(),
): Promise<ApiKeyStatus> {
    const status = Object.fromEntries(
        getProviders().map((p) => [p, false]),
    ) as Record<ApiKeyProvider, boolean>;
    const sources = Object.fromEntries(
        getProviders().map((p) => [p, null]),
    ) as Record<ApiKeyProvider, ApiKeySource>;
    const fullStatus = { ...status, sources } as ApiKeyStatus;

    for (const provider of getProviders()) {
        if (hasEnvApiKey(provider)) {
            fullStatus[provider] = true;
            fullStatus.sources[provider] = "env";
        }
    }

    const { data, error } = await db
        .from("user_api_keys")
        .select("provider")
        .eq("user_id", userId);
    if (error) throw error;

    for (const row of data ?? []) {
        const provider = normalizeApiKeyProvider(String(row.provider));
        if (provider && !fullStatus[provider]) {
            fullStatus[provider] = true;
            fullStatus.sources[provider] = "user";
        }
    }

    return fullStatus;
}

export async function getUserApiKeys(
    userId: string,
    db: Db = createServerSupabase(),
): Promise<UserApiKeys> {
    const apiKeys = Object.fromEntries(
        getProviders().map((p) => [p, envApiKey(p)]),
    ) as UserApiKeys;

    const { data, error } = await db
        .from("user_api_keys")
        .select("provider, encrypted_key, iv, auth_tag")
        .eq("user_id", userId);
    if (error) throw error;

    for (const row of (data ?? []) as EncryptedKeyRow[]) {
        const provider = normalizeApiKeyProvider(row.provider);
        if (!provider) continue;
        if (apiKeys[provider]?.trim()) continue;
        apiKeys[provider] = decrypt(row);
    }

    return apiKeys;
}
export async function saveUserApiKey(
    userId: string,
    provider: ApiKeyProvider,
    value: string | null,
    db: Db = createServerSupabase(),
): Promise<void> {
    const normalized = value?.trim() || null;
    if (!normalized) {
        const { error } = await db
            .from("user_api_keys")
            .delete()
            .eq("user_id", userId)
            .eq("provider", provider);
        if (error) throw error;
        return;
    }

    const { error } = await db.from("user_api_keys").upsert(
        {
            user_id: userId,
            provider,
            ...encrypt(normalized),
            updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
    );
    if (error) throw error;
}
