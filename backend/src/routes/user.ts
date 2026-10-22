import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { DEFAULT_TABULAR_MODEL, resolveModel, completeText } from "../lib/llm";
import { getUserModelSettings } from "../lib/userSettings";
import {
  type ApiKeyStatus,
  getUserApiKeyStatus,
  hasEnvApiKey,
  normalizeApiKeyProvider,
  saveUserApiKey,
} from "../lib/userApiKeys";
import { DEFAULT_CLASSIFICATION_PROMPT } from "../lib/classificationPrompt";

export const userRouter = Router();

// Close any unclosed brackets/braces/strings left by a truncated LLM response.
function repairTruncatedJson(s: string): string {
  const open: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") open.push(ch === "{" ? "}" : "]");
    else if ((ch === "}" || ch === "]") && open.length) open.pop();
  }
  // If we ended inside a string, close it
  let result = s;
  if (inString) result += '"';
  // Close any incomplete property value — drop a trailing comma or colon
  result = result.replace(/,\s*$/, "").replace(/:\s*$/, ': null');
  // Close all open containers in reverse order
  for (let i = open.length - 1; i >= 0; i--) result += open[i];
  return result;
}

const MONTHLY_CREDIT_LIMIT = 999999;

type UserProfileRow = {
  display_name: string | null;
  organisation: string | null;
  message_credits_used: number;
  credits_reset_date: string;
  tier: string;
  tabular_model: string;
};

function serializeProfile(
  row: UserProfileRow,
  apiKeyStatus?: ApiKeyStatus,
) {
  const creditsUsed = row.message_credits_used ?? 0;
  return {
    displayName: row.display_name,
    organisation: row.organisation,
    messageCreditsUsed: creditsUsed,
    creditsResetDate: row.credits_reset_date,
    creditsRemaining: Math.max(MONTHLY_CREDIT_LIMIT - creditsUsed, 0),
    tier: row.tier || "Free",
    tabularModel: resolveModel(row.tabular_model, DEFAULT_TABULAR_MODEL),
    ...(apiKeyStatus ? { apiKeyStatus } : {}),
  };
}

function validateProfilePayload(body: unknown):
  | {
      ok: true;
      update: {
        display_name?: string | null;
        organisation?: string | null;
        tabular_model?: string;
        updated_at: string;
      };
    }
  | { ok: false; detail: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, detail: "Expected a JSON object" };
  }

  const raw = body as Record<string, unknown>;
  const allowedFields = new Set([
    "displayName",
    "organisation",
    "tabularModel",
  ]);
  const invalidField = Object.keys(raw).find((key) => !allowedFields.has(key));
  if (invalidField) {
    return { ok: false, detail: `Unsupported profile field: ${invalidField}` };
  }

  const update: {
    display_name?: string | null;
    organisation?: string | null;
    tabular_model?: string;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };

  if ("displayName" in raw) {
    if (raw.displayName !== null && typeof raw.displayName !== "string") {
      return { ok: false, detail: "displayName must be a string or null" };
    }
    update.display_name = raw.displayName?.trim() || null;
  }

  if ("organisation" in raw) {
    if (raw.organisation !== null && typeof raw.organisation !== "string") {
      return { ok: false, detail: "organisation must be a string or null" };
    }
    update.organisation = raw.organisation?.trim() || null;
  }

  if ("tabularModel" in raw) {
    if (typeof raw.tabularModel !== "string") {
      return { ok: false, detail: "tabularModel must be a string" };
    }
    const resolved = resolveModel(raw.tabularModel, "");
    if (!resolved) {
      return { ok: false, detail: "Unsupported tabularModel" };
    }
    update.tabular_model = resolved;
  }

  return { ok: true, update };
}

async function ensureProfileRow(
  db: ReturnType<typeof createServerSupabase>,
  userId: string,
) {
  const { error } = await db
    .from("user_profiles")
    .upsert(
      { user_id: userId },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  return error;
}

async function loadProfile(
  db: ReturnType<typeof createServerSupabase>,
  userId: string,
  options: { repairMissing?: boolean } = {},
) {
  let { data, error } = await db
    .from("user_profiles")
    .select(
      "display_name, organisation, message_credits_used, credits_reset_date, tier, tabular_model",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) {
    if (!options.repairMissing) {
      return { data: null, error: new Error("Profile not found") };
    }

    const ensureError = await ensureProfileRow(db, userId);
    if (ensureError) return { data: null, error: ensureError };

    const created = await db
      .from("user_profiles")
      .select(
        "display_name, organisation, message_credits_used, credits_reset_date, tier, tabular_model",
      )
      .eq("user_id", userId)
      .single();
    if (created.error) return { data: null, error: created.error };
    data = created.data;
  }

  let row = data as UserProfileRow;
  if (row.credits_reset_date && new Date() > new Date(row.credits_reset_date)) {
    const creditsResetDate = new Date();
    creditsResetDate.setDate(creditsResetDate.getDate() + 30);
    const { data: resetData, error: resetError } = await db
      .from("user_profiles")
      .update({
        message_credits_used: 0,
        credits_reset_date: creditsResetDate.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select(
        "display_name, organisation, message_credits_used, credits_reset_date, tier, tabular_model",
      )
      .single();

    if (resetError) return { data: null, error: resetError };
    row = resetData as UserProfileRow;
  }

  return { data: serializeProfile(row), error: null };
}

// POST /user/profile
userRouter.post("/profile", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const error = await ensureProfileRow(db, userId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.json({ ok: true });
});

// GET /user/profile
userRouter.get("/profile", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { data, error } = await loadProfile(db, userId, {
    repairMissing: true,
  });
  if (error) return void res.status(500).json({ detail: error.message });
  const apiKeyStatus = await getUserApiKeyStatus(userId, db);
  res.json({ ...data, apiKeyStatus });
});

// PATCH /user/profile
userRouter.patch("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const parsed = validateProfilePayload(req.body);
  if (!parsed.ok) return void res.status(400).json({ detail: parsed.detail });

  const db = createServerSupabase();
  const ensureError = await ensureProfileRow(db, userId);
  if (ensureError)
    return void res.status(500).json({ detail: ensureError.message });

  const { error: updateError } = await db
    .from("user_profiles")
    .update(parsed.update)
    .eq("user_id", userId);
  if (updateError)
    return void res.status(500).json({ detail: updateError.message });

  const { data, error } = await loadProfile(db, userId);
  if (error) return void res.status(500).json({ detail: error.message });
  const apiKeyStatus = await getUserApiKeyStatus(userId, db);
  res.json({ ...data, apiKeyStatus });
});

// GET /user/api-keys
userRouter.get("/api-keys", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const status = await getUserApiKeyStatus(userId, db);
  res.json(status);
});

// PUT /user/api-keys/:provider
userRouter.put("/api-keys/:provider", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const provider = normalizeApiKeyProvider(req.params.provider);
  if (!provider)
    return void res.status(400).json({ detail: "Unsupported provider" });

  // The internal provider is always configured via server env vars — its
  // base URL and key are infrastructure-level settings, not user credentials.
  // Block any attempt to override it from the browser.
  if (provider === "internal") {
    return void res.status(409).json({
      detail:
        "The internal provider is configured by the server environment and cannot be changed from the browser.",
    });
  }

  const apiKey =
    typeof req.body?.api_key === "string" ? req.body.api_key : null;
  const db = createServerSupabase();
  try {
    if (hasEnvApiKey(provider)) {
      return void res.status(409).json({
        detail:
          "This provider is configured by the server environment and cannot be changed from the browser.",
      });
    }
    await saveUserApiKey(userId, provider, apiKey, db);
    const status = await getUserApiKeyStatus(userId, db);
    res.json(status);
  } catch (err) {
    console.error("[user/api-keys] save failed", {
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ detail: "Failed to save API key" });
  }
});

const TAXONOMY_EXTRACTOR_PROMPT = `You are a parser. You will be given the full text of a document-classification prompt. Somewhere inside it is a taxonomy: a list of categories organized into groups. Extract that taxonomy.
The taxonomy may be written in different styles:
– Group headers may be wrapped in square brackets, e.g. [M&A Deal Documents], OR written as plain lines, e.g. M&A Deal Documents (often beneath a heading like "Categories").
– A category may carry a scope note in brackets, usually after a dash, e.g. Purchase Agreement — [asset or stock purchase agreement]. The scope note is NOT part of the category name.
– There is usually instruction text before the taxonomy (preamble) and sometimes after it, like an "Output format" or "Rules" section (postamble).
Return ONLY valid JSON — no markdown, no code fences, no commentary — in this shape:
{ "preamble": "...", "groups": [ { "name": "<no brackets>", "types": [ { "name": "<name only, scope removed>", "scope": "<inner text or empty>" } ] } ], "postamble": "..." }
Rules: preserve original order; a group header introduces categories beneath it until the next header; strip brackets from group names; put only the category name in name and the scope note's text in scope; do NOT treat preamble/postamble lines or headings like "Categories", "Inputs", "Output format" as categories; don't invent, merge, dedupe, reorder, or rephrase; empty strings where absent.`;

// POST /user/classification-prompt/parse
userRouter.post("/classification-prompt/parse", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : null;
  if (!prompt) return void res.status(400).json({ detail: "prompt is required" });

  const db = createServerSupabase();
  const { tabular_model, api_keys } = await getUserModelSettings(userId, db);

  try {
    const raw = await completeText({
      model: tabular_model,
      systemPrompt: TAXONOMY_EXTRACTOR_PROMPT,
      user: prompt,
      maxTokens: 8192,
      apiKeys: api_keys,
    });

    // Strip code fences, then find the outermost JSON object
    let jsonStr = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    if (!jsonStr.startsWith("{")) {
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON object found in model response");
      jsonStr = match[0];
    }

    // Attempt to parse; if the output was truncated, patch it closed and retry
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      jsonStr = repairTruncatedJson(jsonStr);
      parsed = JSON.parse(jsonStr);
    }

    res.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[classification/parse]", msg);
    res.status(500).json({ detail: msg });
  }
});

// GET /user/classification-prompt
// Returns the user's classification prompt and saved taxonomy groups/types.
userRouter.get("/classification-prompt", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();

  const { data, error } = await db
    .from("classification")
    .select("id, prompt")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return void res.status(500).json({ detail: error.message });

  let prompt = DEFAULT_CLASSIFICATION_PROMPT;
  let classificationId: string | null = null;

  if (data) {
    prompt = data.prompt;
    classificationId = data.id;
  } else {
    const { data: inserted, error: insertError } = await db
      .from("classification")
      .insert({ user_id: userId, prompt: DEFAULT_CLASSIFICATION_PROMPT })
      .select("id")
      .single();
    if (insertError) return void res.status(500).json({ detail: insertError.message });
    classificationId = inserted.id;
  }

  // Fetch saved taxonomy groups + types
  let groups: object[] = [];
  if (classificationId) {
    const { data: groupRows } = await db
      .from("classification_groups")
      .select("id, group_name, display_order")
      .eq("classification_id", classificationId)
      .order("display_order");

    if (groupRows && groupRows.length > 0) {
      const groupIds = groupRows.map((g) => g.id);
      const { data: typeRows } = await db
        .from("classification_types")
        .select("id, classification_group_id, type_name, display_order")
        .in("classification_group_id", groupIds)
        .order("display_order");

      groups = groupRows.map((g) => ({
        id: g.id,
        group_name: g.group_name,
        display_order: g.display_order,
        types: (typeRows ?? [])
          .filter((t) => t.classification_group_id === g.id)
          .sort((a, b) => a.display_order - b.display_order),
      }));
    }
  }

  res.json({ prompt, groups });
});

// POST /user/classification-prompt/taxonomy
// Replaces all saved groups and types for the current user.
userRouter.post("/classification-prompt/taxonomy", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const groups = req.body?.groups;
  if (!Array.isArray(groups)) return void res.status(400).json({ detail: "groups array is required" });

  const db = createServerSupabase();

  // Get or create the classification row
  let { data: classRow } = await db
    .from("classification")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!classRow) {
    const { data: inserted, error: insertErr } = await db
      .from("classification")
      .insert({ user_id: userId, prompt: DEFAULT_CLASSIFICATION_PROMPT })
      .select("id")
      .single();
    if (insertErr) return void res.status(500).json({ detail: insertErr.message });
    classRow = inserted;
  }

  const classificationId = classRow.id;

  // Delete existing types first, then groups
  const { data: existingGroups } = await db
    .from("classification_groups")
    .select("id")
    .eq("classification_id", classificationId);

  if (existingGroups && existingGroups.length > 0) {
    const groupIds = existingGroups.map((g) => g.id);
    await db.from("classification_types").delete().in("classification_group_id", groupIds);
    await db.from("classification_groups").delete().eq("classification_id", classificationId);
  }

  if (groups.length === 0) return void res.json({ groups: [] });

  // Batch insert groups
  const groupInserts = groups.map((g: { name?: string }, i: number) => ({
    classification_id: classificationId,
    group_name: typeof g.name === "string" ? g.name.trim() : "",
    display_order: i,
  }));

  const { data: insertedGroups, error: groupErr } = await db
    .from("classification_groups")
    .insert(groupInserts)
    .select("id, group_name, display_order");

  if (groupErr) return void res.status(500).json({ detail: groupErr.message });

  // Batch insert all types (use display_order to match back to source groups)
  const typeInserts = (insertedGroups ?? []).flatMap((grp) => {
    const srcGroup = groups[grp.display_order] as { types?: { name?: string }[] };
    const types = Array.isArray(srcGroup?.types) ? srcGroup.types : [];
    return types.map((t, ti) => ({
      classification_group_id: grp.id,
      type_name: typeof t.name === "string" ? t.name.trim() : "",
      display_order: ti,
    }));
  });

  if (typeInserts.length > 0) {
    const { error: typeErr } = await db
      .from("classification_types")
      .insert(typeInserts);
    if (typeErr) return void res.status(500).json({ detail: typeErr.message });
  }

  res.json({ ok: true, groupCount: groups.length });
});

// PUT /user/classification-prompt
userRouter.put("/classification-prompt", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : null;
  if (!prompt) return void res.status(400).json({ detail: "prompt is required" });

  const db = createServerSupabase();

  const { error } = await db
    .from("classification")
    .upsert(
      { user_id: userId, prompt },
      { onConflict: "user_id" },
    );
  if (error) return void res.status(500).json({ detail: error.message });

  res.json({ prompt });
});

// DELETE /user/account
userRouter.delete("/account", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
});
