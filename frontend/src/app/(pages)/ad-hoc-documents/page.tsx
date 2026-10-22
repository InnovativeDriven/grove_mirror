"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import {
    DocIcon,
    DocVersionHistory,
    formatBytes,
    formatDate,
    DOC_NAME_COL_W,
    CHECK_W,
} from "@/app/components/projects/ProjectPageParts";
import { RowActions } from "@/app/components/shared/RowActions";
import { DocViewModal } from "@/app/components/shared/DocViewModal";
import {
    listStandaloneDocuments,
    renameStandaloneDocument,
    deleteDocument,
    getDocumentUrl,
    downloadDocumentsZip,
    listDocumentVersions,
    uploadDocumentVersion,
    renameDocumentVersion,
    type MikeDocumentVersion,
} from "@/app/lib/mikeApi";
import type { MikeDocument } from "@/app/components/shared/types";

export default function AdHocDocumentsPage() {
    const [docs, setDocs] = useState<MikeDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    const [viewingDoc, setViewingDoc] = useState<MikeDocument | null>(null);
    const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
    const [viewingVersionLabel, setViewingVersionLabel] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [actionsOpen, setActionsOpen] = useState(false);
    const actionsRef = useRef<HTMLDivElement>(null);

    // Per-row rename state
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");

    // Per-row version history state
    const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
    const [versionsMap, setVersionsMap] = useState<Record<string, MikeDocumentVersion[]>>({});
    const [versionsLoading, setVersionsLoading] = useState<Set<string>>(new Set());

    // Hidden file input for uploading new versions
    const uploadVersionRef = useRef<HTMLInputElement>(null);
    const uploadVersionForDoc = useRef<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await listStandaloneDocuments();
            setDocs(data);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (actionsRef.current && !actionsRef.current.contains(e.target as Node))
                setActionsOpen(false);
        }
        if (actionsOpen) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [actionsOpen]);

    const q = search.toLowerCase().trim();
    const filtered = q ? docs.filter((d) => d.filename.toLowerCase().includes(q)) : docs;

    const allSelected = filtered.length > 0 && filtered.every((d) => selectedIds.includes(d.id));
    const someSelected = !allSelected && filtered.some((d) => selectedIds.includes(d.id));

    function toggleAll() {
        if (allSelected) setSelectedIds([]);
        else setSelectedIds(filtered.map((d) => d.id));
    }

    function toggleOne(id: string) {
        setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    }

    const handleDelete = async (docId: string) => {
        setDeletingIds((prev) => new Set(prev).add(docId));
        try {
            await deleteDocument(docId);
            setDocs((prev) => prev.filter((d) => d.id !== docId));
            setSelectedIds((prev) => prev.filter((x) => x !== docId));
            if (viewingDoc?.id === docId) setViewingDoc(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setDeletingIds((prev) => { const next = new Set(prev); next.delete(docId); return next; });
        }
    };

    const handleDownload = async (doc: MikeDocument) => {
        try {
            const { url, filename } = await getDocumentUrl(doc.id);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.click();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const handleDownloadSelected = async () => {
        setActionsOpen(false);
        const ids = [...selectedIds];
        if (ids.length === 1) {
            const doc = docs.find((d) => d.id === ids[0]);
            if (doc) await handleDownload(doc);
            return;
        }
        try {
            const blob = await downloadDocumentsZip(ids);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "documents.zip";
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const handleDeleteSelected = async () => {
        const ids = [...selectedIds];
        setActionsOpen(false);
        setSelectedIds([]);
        await Promise.all(ids.map((id) => handleDelete(id)));
    };

    const startRename = (doc: MikeDocument) => {
        setRenamingId(doc.id);
        setRenameValue(doc.filename);
    };

    const commitRename = async (docId: string) => {
        const trimmed = renameValue.trim();
        setRenamingId(null);
        if (!trimmed) return;
        try {
            const updated = await renameStandaloneDocument(docId, trimmed);
            setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, filename: updated.filename } : d));
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const loadVersions = async (docId: string) => {
        setVersionsLoading((prev) => new Set(prev).add(docId));
        try {
            const { versions } = await listDocumentVersions(docId);
            setVersionsMap((prev) => ({ ...prev, [docId]: versions }));
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setVersionsLoading((prev) => { const next = new Set(prev); next.delete(docId); return next; });
        }
    };

    const toggleVersions = async (docId: string) => {
        if (expandedVersions.has(docId)) {
            setExpandedVersions((prev) => { const next = new Set(prev); next.delete(docId); return next; });
            return;
        }
        setExpandedVersions((prev) => new Set(prev).add(docId));
        if (!versionsMap[docId]) await loadVersions(docId);
    };

    const handleDownloadVersion = async (docId: string, versionId: string, filename: string) => {
        try {
            const { url } = await getDocumentUrl(docId, versionId);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.click();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const handleRenameVersion = async (docId: string, versionId: string, displayName: string | null) => {
        try {
            const updated = await renameDocumentVersion(docId, versionId, displayName);
            setVersionsMap((prev) => ({
                ...prev,
                [docId]: (prev[docId] ?? []).map((v) =>
                    v.id === versionId ? { ...v, display_name: updated.display_name } : v
                ),
            }));
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const handleUploadNewVersion = (docId: string) => {
        uploadVersionForDoc.current = docId;
        uploadVersionRef.current?.click();
    };

    const handleVersionFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        const docId = uploadVersionForDoc.current;
        e.target.value = "";
        if (!file || !docId) return;
        try {
            await uploadDocumentVersion(docId, file);
            const [versionData, fresh] = await Promise.all([
                listDocumentVersions(docId),
                listStandaloneDocuments(),
            ]);
            setVersionsMap((prev) => ({ ...prev, [docId]: versionData.versions }));
            setDocs(fresh);
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const openDoc = (doc: MikeDocument) => {
        setViewingDoc(doc);
        setViewingVersionId(null);
        setViewingVersionLabel(null);
    };

    const openDocVersion = (doc: MikeDocument, versionId: string, versionLabel: string) => {
        setViewingDoc(doc);
        setViewingVersionId(versionId);
        setViewingVersionLabel(versionLabel);
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                <h1 className="text-lg font-semibold text-gray-900">Ad-Hoc Documents</h1>
                <div className="flex items-center gap-3">
                    {selectedIds.length > 0 && (
                        <div ref={actionsRef} className="relative">
                            <button
                                onClick={() => setActionsOpen((v) => !v)}
                                className="flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors"
                            >
                                Actions
                                <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                            {actionsOpen && (
                                <div className="absolute top-full right-0 mt-1 w-40 rounded-lg border border-gray-100 bg-white shadow-lg z-[120] overflow-hidden">
                                    <button
                                        onClick={handleDownloadSelected}
                                        className="w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                                    >
                                        Download
                                    </button>
                                    <button
                                        onClick={handleDeleteSelected}
                                        className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 transition-colors"
                                    >
                                        Delete
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    <input
                        type="text"
                        placeholder="Search…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 w-48 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:border-gray-400"
                    />
                </div>
            </div>

            {error && (
                <div className="mx-6 mt-3 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600 flex items-center justify-between shrink-0">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="ml-3 underline text-red-500 hover:text-red-700">
                        Dismiss
                    </button>
                </div>
            )}

            {/* Hidden file input for uploading a new document version */}
            <input
                ref={uploadVersionRef}
                type="file"
                accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt"
                className="hidden"
                onChange={handleVersionFileChange}
            />

            {/* Document list */}
            <div className="flex-1 overflow-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-4">
                        <p className="text-sm text-gray-400">
                            {q
                                ? "No documents match your search"
                                : "No ad-hoc documents yet — drafts created in the Assistant will appear here"}
                        </p>
                    </div>
                ) : (
                    <div className="px-6 py-2">
                        {/* Column headers */}
                        <div className="flex items-center gap-3 px-2 py-1.5 text-xs font-medium text-gray-400 border-b border-gray-100 select-none">
                            <div
                                className={`${CHECK_W} flex items-center justify-center`}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                                    onChange={toggleAll}
                                    className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                                />
                            </div>
                            <span className={DOC_NAME_COL_W}>Name</span>
                            <span className="w-20 shrink-0">Type</span>
                            <span className="w-24 shrink-0">Size</span>
                            <span className="w-20 shrink-0">Version</span>
                            <span className="w-32 shrink-0">Created</span>
                            <span className="w-32 shrink-0">Updated</span>
                            <span className="flex-1" />
                        </div>

                        {/* Document rows */}
                        {filtered.map((doc) => {
                            const isSelected = selectedIds.includes(doc.id);
                            const isRenaming = renamingId === doc.id;
                            const isExpanded = expandedVersions.has(doc.id);
                            const versionNum = doc.latest_version_number;
                            const hasVersions = typeof versionNum === "number" && versionNum > 1;

                            return (
                                <div key={doc.id}>
                                    {/* Main row */}
                                    <div
                                        className={`flex items-center gap-3 px-2 py-2 rounded-md group cursor-pointer ${isSelected ? "bg-gray-50" : "hover:bg-gray-50"}`}
                                        onClick={() => { if (!isRenaming) openDoc(doc); }}
                                    >
                                        {/* Checkbox */}
                                        <div
                                            className={`${CHECK_W} flex items-center justify-center shrink-0`}
                                            onClick={(e) => { e.stopPropagation(); toggleOne(doc.id); }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleOne(doc.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                                            />
                                        </div>

                                        {/* Name */}
                                        <div className={`${DOC_NAME_COL_W} flex items-center gap-2 min-w-0`}>
                                            <DocIcon fileType={doc.file_type} />
                                            {isRenaming ? (
                                                <input
                                                    autoFocus
                                                    value={renameValue}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onChange={(e) => setRenameValue(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") { e.preventDefault(); void commitRename(doc.id); }
                                                        else if (e.key === "Escape") setRenamingId(null);
                                                    }}
                                                    onBlur={() => void commitRename(doc.id)}
                                                    className="min-w-0 flex-1 border-b border-gray-300 bg-transparent text-sm text-gray-800 outline-none focus:border-gray-500"
                                                />
                                            ) : (
                                                <span className="truncate text-sm text-gray-800" title={doc.filename}>
                                                    {doc.filename}
                                                </span>
                                            )}
                                            {doc.status === "processing" && (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 shrink-0" />
                                            )}
                                        </div>

                                        {/* Type */}
                                        <span className="w-20 shrink-0 text-xs text-gray-500 uppercase">
                                            {doc.file_type ?? "—"}
                                        </span>

                                        {/* Size */}
                                        <span className="w-24 shrink-0 text-xs text-gray-500">
                                            {doc.size_bytes != null ? formatBytes(doc.size_bytes) : "—"}
                                        </span>

                                        {/* Version — click to expand history */}
                                        <div
                                            className="w-20 shrink-0"
                                            onClick={(e) => { e.stopPropagation(); if (hasVersions) toggleVersions(doc.id); }}
                                        >
                                            {hasVersions ? (
                                                <button className="flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-800 transition-colors">
                                                    {isExpanded
                                                        ? <ChevronDown className="h-3 w-3" />
                                                        : <ChevronRight className="h-3 w-3" />}
                                                    V{versionNum}
                                                </button>
                                            ) : (
                                                <span className="text-xs text-gray-500">
                                                    {typeof versionNum === "number" ? `V${versionNum}` : "—"}
                                                </span>
                                            )}
                                        </div>

                                        {/* Created */}
                                        <span className="w-32 shrink-0 text-xs text-gray-500">
                                            {doc.created_at ? formatDate(doc.created_at) : "—"}
                                        </span>

                                        {/* Updated */}
                                        <span className="w-32 shrink-0 text-xs text-gray-500">
                                            {doc.updated_at ? formatDate(doc.updated_at) : "—"}
                                        </span>

                                        {/* 3-dot menu */}
                                        <div
                                            className="flex-1 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <RowActions
                                                onRename={() => startRename(doc)}
                                                onDownload={() => handleDownload(doc)}
                                                onShowAllVersions={hasVersions ? () => toggleVersions(doc.id) : undefined}
                                                onUploadNewVersion={() => handleUploadNewVersion(doc.id)}
                                                onDelete={() => handleDelete(doc.id)}
                                                deleting={deletingIds.has(doc.id)}
                                            />
                                        </div>
                                    </div>

                                    {/* Version history expansion */}
                                    {isExpanded && (
                                        <DocVersionHistory
                                            docId={doc.id}
                                            filename={doc.filename}
                                            loading={versionsLoading.has(doc.id)}
                                            versions={versionsMap[doc.id] ?? []}
                                            onDownloadVersion={handleDownloadVersion}
                                            onOpenVersion={(versionId, label) =>
                                                openDocVersion(doc, versionId, label)
                                            }
                                            onRenameVersion={(versionId, displayName) =>
                                                handleRenameVersion(doc.id, versionId, displayName)
                                            }
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Doc viewer modal */}
            {viewingDoc && (
                <DocViewModal
                    doc={viewingDoc}
                    versionId={viewingVersionId}
                    versionLabel={viewingVersionLabel}
                    onClose={() => { setViewingDoc(null); setViewingVersionId(null); setViewingVersionLabel(null); }}
                    onDelete={(doc) => handleDelete(doc.id)}
                />
            )}
        </div>
    );
}
