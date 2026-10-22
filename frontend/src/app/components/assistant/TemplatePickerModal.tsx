"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Loader2, Search, X } from "lucide-react";
import { DocIcon, formatBytes } from "@/app/components/projects/ProjectPageParts";
import { listTemplateDocuments, listTemplateFolders } from "@/app/lib/mikeApi";
import type { MikeDocument, TemplateFolder } from "../shared/types";

interface Props {
    open: boolean;
    onClose: () => void;
    onSelect: (template: MikeDocument) => void;
}

export function TemplatePickerModal({ open, onClose, onSelect }: Props) {
    const [templates, setTemplates] = useState<MikeDocument[]>([]);
    const [folders, setFolders] = useState<TemplateFolder[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<MikeDocument | null>(null);
    const [search, setSearch] = useState("");
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!open) {
            setSelected(null);
            setSearch("");
            return;
        }
        setLoading(true);
        Promise.all([listTemplateDocuments(), listTemplateFolders()])
            .then(([docs, flds]) => { setTemplates(docs); setFolders(flds); })
            .catch(() => { setTemplates([]); setFolders([]); })
            .finally(() => setLoading(false));
    }, [open]);

    if (!open) return null;

    const q = search.toLowerCase();
    const filtered = q
        ? templates.filter((t) => t.filename.toLowerCase().includes(q))
        : templates;

    function toggleFolder(id: string) {
        setExpandedFolderIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function renderLevel(parentId: string | null, depth: number) {
        const childFolders = folders
            .filter((f) => f.parent_folder_id === parentId)
            .sort((a, b) => a.name.localeCompare(b.name));
        const childDocs = templates.filter(
            (t) => (t.template_folder_id ?? null) === parentId,
        );
        const indent = depth * 16;

        return (
            <>
                {childDocs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                            setSelected((prev) => (prev?.id === t.id ? null : t))
                        }
                        style={{ paddingLeft: 16 + indent }}
                        className={`w-full flex items-center gap-2.5 pr-4 py-2.5 text-xs text-left transition-colors border-b border-gray-50 ${
                            selected?.id === t.id
                                ? "bg-gray-50"
                                : "hover:bg-gray-50"
                        }`}
                    >
                        <DocIcon fileType={t.file_type} />
                        <span className="flex-1 truncate text-gray-800">
                            {t.filename}
                        </span>
                        <span className="shrink-0 text-gray-400">
                            {t.size_bytes != null ? formatBytes(t.size_bytes) : ""}
                        </span>
                    </button>
                ))}
                {childFolders.map((folder) => {
                    const isExpanded = expandedFolderIds.has(folder.id);
                    return (
                        <div key={folder.id}>
                            <button
                                type="button"
                                onClick={() => toggleFolder(folder.id)}
                                style={{ paddingLeft: 12 + indent }}
                                className="w-full flex items-center gap-2 pr-4 py-2.5 text-xs text-left hover:bg-gray-50 transition-colors border-b border-gray-50 select-none"
                            >
                                {isExpanded ? (
                                    <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" />
                                ) : (
                                    <ChevronRight className="h-3 w-3 text-gray-400 shrink-0" />
                                )}
                                {isExpanded ? (
                                    <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                ) : (
                                    <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                )}
                                <span className="flex-1 truncate text-gray-700 font-medium">
                                    {folder.name}
                                </span>
                            </button>
                            {isExpanded && renderLevel(folder.id, depth + 1)}
                        </div>
                    );
                })}
            </>
        );
    }

    function handleUse() {
        if (!selected) return;
        onSelect(selected);
        onClose();
    }

    const hasContent = templates.length > 0 || folders.length > 0;

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col h-[480px]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-4 shrink-0 border-b border-gray-100">
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <span>Assistant</span>
                        <span>›</span>
                        <span>Select template</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Search */}
                <div className="px-4 pt-3 pb-2 shrink-0">
                    <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1">
                        <Search className="h-3 w-3 text-gray-400 shrink-0" />
                        <input
                            type="text"
                            placeholder="Search templates…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="flex-1 bg-transparent text-xs text-gray-700 placeholder:text-gray-400 outline-none"
                            autoFocus
                        />
                        {search && (
                            <button
                                onClick={() => setSearch("")}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        )}
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                        </div>
                    ) : !hasContent ? (
                        <p className="px-4 py-8 text-sm text-center text-gray-400">
                            No templates found — upload one on the Templates page
                        </p>
                    ) : q ? (
                        filtered.length === 0 ? (
                            <p className="px-4 py-8 text-sm text-center text-gray-400">
                                No templates match your search
                            </p>
                        ) : (
                            filtered.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() =>
                                        setSelected((prev) =>
                                            prev?.id === t.id ? null : t,
                                        )
                                    }
                                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs text-left transition-colors border-b border-gray-50 ${
                                        selected?.id === t.id
                                            ? "bg-gray-50"
                                            : "hover:bg-gray-50"
                                    }`}
                                >
                                    <DocIcon fileType={t.file_type} />
                                    <span className="flex-1 truncate text-gray-800">
                                        {t.filename}
                                    </span>
                                    <span className="shrink-0 text-gray-400">
                                        {t.size_bytes != null
                                            ? formatBytes(t.size_bytes)
                                            : ""}
                                    </span>
                                </button>
                            ))
                        )
                    ) : (
                        renderLevel(null, 0)
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-end gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleUse}
                        disabled={!selected}
                        className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
                    >
                        Use template
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
