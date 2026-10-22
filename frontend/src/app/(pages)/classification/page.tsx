"use client";

import { useState, useEffect, useRef } from "react";
import { Save, RotateCcw, Loader2, Check, Cpu, Trash2, GripVertical, X } from "lucide-react";
import {
    getClassificationPrompt,
    updateClassificationPrompt,
    parseClassificationPrompt,
    saveClassificationTaxonomy,
    type ClassificationTaxonomy,
    type TaxonomyGroupFromDB,
} from "@/app/lib/mikeApi";

const GROUP_HEADER_COLORS = [
    { bg: "#96131D", fg: "#ffffff" },
    { bg: "#3A547C", fg: "#ffffff" },
    { bg: "#0c0b35", fg: "#ffffff" },
    { bg: "#B5B3AE", fg: "#1a1a1a" },
    { bg: "#3B166B", fg: "#ffffff" },
    { bg: "#2A68B3", fg: "#ffffff" },
    { bg: "#84ab43", fg: "#ffffff" },
    { bg: "#2F6476", fg: "#ffffff" },
];

function dbGroupsToTaxonomy(groups: TaxonomyGroupFromDB[]): ClassificationTaxonomy["groups"] {
    return [...groups]
        .sort((a, b) => a.display_order - b.display_order)
        .map((g) => ({
            name: g.group_name,
            types: [...g.types]
                .sort((a, b) => a.display_order - b.display_order)
                .map((t) => ({ name: t.type_name, scope: "" })),
        }));
}


function reconstructPrompt(taxonomy: ClassificationTaxonomy): string {
    const lines: string[] = [];
    if (taxonomy.preamble.trim()) lines.push(taxonomy.preamble.trim());
    for (const group of taxonomy.groups) {
        lines.push("");
        lines.push(group.name);
        lines.push("");
        for (const type of group.types) {
            lines.push(type.scope ? `${type.name} — [${type.scope}]` : type.name);
        }
    }
    if (taxonomy.postamble.trim()) {
        lines.push("");
        lines.push(taxonomy.postamble.trim());
    }
    return lines.join("\n");
}

export default function ClassificationPage() {
    const [prompt, setPrompt] = useState("");
    const [savedPrompt, setSavedPrompt] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [taxonomy, setTaxonomy] = useState<ClassificationTaxonomy | null>(null);
    const [parsing, setParsing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);
    const [taxonomySourcePrompt, setTaxonomySourcePrompt] = useState("");
    const [newTypeInputs, setNewTypeInputs] = useState<Record<number, string>>({});

    const [dragging, setDragging] = useState<{ gi: number; ti: number } | null>(null);
    const [dragOver, setDragOver] = useState<{ gi: number; ti: number } | null>(null);

    const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        getClassificationPrompt()
            .then(({ prompt: p, groups }) => {
                setPrompt(p);
                setSavedPrompt(p);
                if (groups.length > 0) {
                    setTaxonomy({
                        preamble: "",
                        postamble: "",
                        groups: dbGroupsToTaxonomy(groups),
                    });
                    setTaxonomySourcePrompt(p);
                }
            })
            .catch(() => setError("Failed to load classification prompt."))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); }, []);

    async function handleSave() {
        if (saving || !prompt.trim()) return;
        setSaving(true);
        setError(null);
        try {
            await updateClassificationPrompt(prompt.trim());
            setSavedPrompt(prompt.trim());
            setJustSaved(true);
            savedTimerRef.current = setTimeout(() => setJustSaved(false), 2500);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save. Please try again.");
        } finally {
            setSaving(false);
        }
    }

    function handleReset() {
        setPrompt(savedPrompt);
        setError(null);
    }

    async function handleParse() {
        if (parsing || !prompt.trim()) return;
        setParsing(true);
        setParseError(null);
        try {
            const result = await parseClassificationPrompt(prompt);
            setTaxonomy(result);
            setTaxonomySourcePrompt(prompt);
            setNewTypeInputs({});
            saveClassificationTaxonomy(result.groups).catch((err) =>
                console.error("[classification] taxonomy save failed:", err)
            );
        } catch (err) {
            setParseError(err instanceof Error ? err.message : "Failed to parse prompt.");
        } finally {
            setParsing(false);
        }
    }

    function updateTaxonomyOnly(updated: ClassificationTaxonomy) {
        setTaxonomy(updated);
        saveClassificationTaxonomy(updated.groups).catch((err) =>
            console.error("[classification] taxonomy save failed:", err)
        );
    }

    function deleteType(gi: number, ti: number) {
        if (!taxonomy) return;
        updateTaxonomyOnly({
            ...taxonomy,
            groups: taxonomy.groups.map((g, i) =>
                i === gi ? { ...g, types: g.types.filter((_, j) => j !== ti) } : g
            ),
        });
    }

    function deleteGroup(gi: number) {
        if (!taxonomy) return;
        updateTaxonomyOnly({ ...taxonomy, groups: taxonomy.groups.filter((_, i) => i !== gi) });
    }

    function addType(gi: number) {
        if (!taxonomy) return;
        const name = (newTypeInputs[gi] ?? "").trim();
        if (!name) return;
        updateTaxonomyOnly({
            ...taxonomy,
            groups: taxonomy.groups.map((g, i) =>
                i === gi ? { ...g, types: [...g.types, { name, scope: "" }] } : g
            ),
        });
        setNewTypeInputs((prev) => ({ ...prev, [gi]: "" }));
    }

    function handleDrop(targetGi: number, targetTi: number) {
        if (!taxonomy || !dragging || dragging.gi !== targetGi || dragging.ti === targetTi) return;
        const types = [...taxonomy.groups[targetGi].types];
        const [item] = types.splice(dragging.ti, 1);
        const insertAt = dragging.ti < targetTi ? targetTi - 1 : targetTi;
        types.splice(insertAt, 0, item);
        updateTaxonomyOnly({
            ...taxonomy,
            groups: taxonomy.groups.map((g, i) => (i === targetGi ? { ...g, types } : g)),
        });
        setDragging(null);
        setDragOver(null);
    }

    function applyTaxonomyToPrompt() {
        if (!taxonomy) return;
        const reconstructed = reconstructPrompt(taxonomy);
        setPrompt(reconstructed);
        setTaxonomySourcePrompt(reconstructed);
    }

    const isDirty = prompt !== savedPrompt;
    const taxonomyStale = taxonomy !== null && prompt !== taxonomySourcePrompt;
    const totalTypes = taxonomy?.groups.reduce((s, g) => s + g.types.length, 0) ?? 0;

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="overflow-y-auto h-full">
            <div className="max-w-5xl mx-auto px-6 py-8">
                {/* Header */}
                <div className="mb-5">
                    <h1 className="text-xl font-semibold text-gray-900">Classification Prompt</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        This prompt is used when classifying documents. Edit it to customize how documents are categorized for your workflow.
                    </p>
                </div>

                {error && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </div>
                )}

                {/* Prompt editor */}
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full h-64 resize-none rounded-lg border border-gray-200 p-4 text-sm text-gray-800 font-mono leading-relaxed focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                />

                {/* Editor toolbar */}
                <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleReset}
                            disabled={!isDirty || saving}
                            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Revert
                        </button>
                        <button
                            onClick={handleParse}
                            disabled={parsing || !prompt.trim()}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {parsing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Cpu className="h-3.5 w-3.5" />
                            )}
                            {parsing ? "Parsing…" : "Parse Taxonomy"}
                        </button>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={saving || !isDirty}
                        className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {saving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : justSaved ? (
                            <Check className="h-3.5 w-3.5" />
                        ) : (
                            <Save className="h-3.5 w-3.5" />
                        )}
                        {saving ? "Saving…" : justSaved ? "Saved" : "Save"}
                    </button>
                </div>

                {parseError && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {parseError}
                    </div>
                )}

                {/* Taxonomy */}
                {taxonomy && (
                    <div className="mt-8">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-sm font-semibold text-gray-700">
                                Taxonomy
                                <span className="ml-2 font-normal text-gray-400">
                                    {taxonomy.groups.length} groups · {totalTypes} types
                                </span>
                            </h2>
                            <div className="flex items-center gap-3">
                                {taxonomyStale && (
                                    <span className="text-xs text-amber-600">
                                        Prompt edited — re-parse to refresh
                                    </span>
                                )}
                                <button
                                    onClick={applyTaxonomyToPrompt}
                                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                                >
                                    Apply to Prompt
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {taxonomy.groups.map((group, gi) => (
                                <div
                                    key={gi}
                                    className="rounded-xl overflow-hidden border border-gray-200 shadow-sm"
                                >
                                    {/* Group header */}
                                    {(() => {
                                        const hc = GROUP_HEADER_COLORS[gi % GROUP_HEADER_COLORS.length];
                                        return (
                                            <div
                                                className="px-4 py-3 flex items-center justify-between"
                                                style={{ backgroundColor: hc.bg }}
                                            >
                                                <span className="font-semibold text-sm" style={{ color: hc.fg }}>
                                                    {group.name}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <span
                                                        className="h-6 min-w-6 px-1.5 rounded-full flex items-center justify-center text-xs font-medium"
                                                        style={{ backgroundColor: "rgba(0,0,0,0.15)", color: hc.fg }}
                                                    >
                                                        {group.types.length}
                                                    </span>
                                                    <button
                                                        onClick={() => deleteGroup(gi)}
                                                        className="transition-colors"
                                                        style={{ color: hc.fg, opacity: 0.7 }}
                                                        onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                                                        onMouseLeave={e => (e.currentTarget.style.opacity = "0.7")}
                                                        title="Remove group"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Type rows */}
                                    <div className="bg-white divide-y divide-gray-100">
                                        {group.types.map((type, ti) => {
                                            const isOver =
                                                dragOver?.gi === gi && dragOver?.ti === ti;
                                            const isDraggingThis =
                                                dragging?.gi === gi && dragging?.ti === ti;
                                            return (
                                                <div
                                                    key={ti}
                                                    draggable
                                                    onDragStart={() => setDragging({ gi, ti })}
                                                    onDragOver={(e) => {
                                                        e.preventDefault();
                                                        setDragOver({ gi, ti });
                                                    }}
                                                    onDragLeave={() => setDragOver(null)}
                                                    onDrop={(e) => {
                                                        e.preventDefault();
                                                        handleDrop(gi, ti);
                                                    }}
                                                    onDragEnd={() => {
                                                        setDragging(null);
                                                        setDragOver(null);
                                                    }}
                                                    className={`flex items-center gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing group transition-colors select-none ${
                                                        isDraggingThis
                                                            ? "opacity-40"
                                                            : isOver
                                                              ? "bg-gray-50 border-t-2 border-t-blue-300"
                                                              : "hover:bg-gray-50"
                                                    }`}
                                                >
                                                    <GripVertical className="h-4 w-4 text-gray-300 shrink-0" />
                                                    <span
                                                        className="flex-1 text-sm text-gray-700 min-w-0 truncate"
                                                        title={type.scope ? `${type.name} — ${type.scope}` : type.name}
                                                    >
                                                        {type.name}
                                                    </span>
                                                    <button
                                                        onClick={() => deleteType(gi, ti)}
                                                        className="shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                                        title="Remove type"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            );
                                        })}

                                        {/* Add type row */}
                                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                                            <input
                                                type="text"
                                                placeholder="+ Add a type…"
                                                value={newTypeInputs[gi] ?? ""}
                                                onChange={(e) =>
                                                    setNewTypeInputs((prev) => ({
                                                        ...prev,
                                                        [gi]: e.target.value,
                                                    }))
                                                }
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") addType(gi);
                                                }}
                                                className="flex-1 bg-transparent text-sm text-gray-500 placeholder-gray-400 outline-none"
                                            />
                                            <button
                                                onClick={() => addType(gi)}
                                                disabled={!(newTypeInputs[gi] ?? "").trim()}
                                                className="text-sm font-medium text-gray-500 hover:text-gray-900 disabled:opacity-30 transition-colors"
                                            >
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
