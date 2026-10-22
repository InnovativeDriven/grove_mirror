"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
    ChevronDown,
    ChevronRight,
    Folder,
    FolderOpen,
    FolderPlus,
    Loader2,
    Upload,
} from "lucide-react";
import {
    DocIcon,
    formatBytes,
    formatDate,
    DOC_NAME_COL_W,
    CHECK_W,
    treeControlCellStyle,
    treeNameCellStyle,
} from "@/app/components/projects/ProjectPageParts";
import { RowActions, closeRowActionMenus } from "@/app/components/shared/RowActions";
import { DocViewModal } from "@/app/components/shared/DocViewModal";
import {
    listTemplateDocuments,
    uploadTemplateDocument,
    deleteDocument,
    getDocumentUrl,
    downloadDocumentsZip,
    listTemplateFolders,
    createTemplateFolder,
    renameTemplateFolder,
    moveTemplateSubfolder,
    deleteTemplateFolder,
    moveTemplateDocument,
} from "@/app/lib/mikeApi";
import type { MikeDocument, TemplateFolder } from "@/app/components/shared/types";

export default function TemplatesPage() {
    const [docs, setDocs] = useState<MikeDocument[]>([]);
    const [folders, setFolders] = useState<TemplateFolder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    const [viewingDoc, setViewingDoc] = useState<MikeDocument | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [actionsOpen, setActionsOpen] = useState(false);
    const actionsRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Folder state
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
    const [creatingFolderIn, setCreatingFolderIn] = useState<string | null | undefined>(undefined);
    const [newFolderName, setNewFolderName] = useState("");
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
    const [renameFolderValue, setRenameFolderValue] = useState("");
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
    const [dragOverRoot, setDragOverRoot] = useState(false);
    const [uploadDragOver, setUploadDragOver] = useState(false);
    const newFolderInputRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const [docsData, foldersData] = await Promise.all([
                listTemplateDocuments(),
                listTemplateFolders(),
            ]);
            setDocs(docsData);
            setFolders(foldersData);
            setExpandedFolderIds(new Set(foldersData.map((f) => f.id)));
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
    const filtered = q ? docs.filter(d => d.filename.toLowerCase().includes(q)) : docs;
    const allSelected = filtered.length > 0 && filtered.every(d => selectedIds.includes(d.id));
    const someSelected = !allSelected && filtered.some(d => selectedIds.includes(d.id));

    function toggleAll() {
        if (allSelected) setSelectedIds([]);
        else setSelectedIds(filtered.map(d => d.id));
    }
    function toggleOne(id: string) {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }

    function hasMovePayload(dt: DataTransfer) {
        return Array.from(dt.types).some(t => t === "application/mike-doc" || t === "application/mike-folder");
    }
    function hasFilePayload(dt: DataTransfer) {
        return Array.from(dt.types).includes("Files");
    }
    function wouldCreateCycle(movingId: string, targetId: string): boolean {
        let cur: TemplateFolder | undefined = folders.find(f => f.id === targetId);
        while (cur) {
            if (cur.id === movingId) return true;
            if (!cur.parent_folder_id) break;
            cur = folders.find(f => f.id === cur!.parent_folder_id);
        }
        return false;
    }
    function getDescendantFolderIds(rootId: string): Set<string> {
        const result = new Set<string>();
        const queue = [rootId];
        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const f of folders) {
                if (f.parent_folder_id === current) {
                    result.add(f.id);
                    queue.push(f.id);
                }
            }
        }
        return result;
    }
    function toggleFolder(id: string) {
        setExpandedFolderIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    const handleUpload = async (files: File[]) => {
        if (!files.length) return;
        setUploading(true);
        setError(null);
        try {
            const uploaded = await Promise.all(files.map(f => uploadTemplateDocument(f)));
            setDocs(prev => [...uploaded, ...prev]);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (docId: string) => {
        setDeletingIds(prev => new Set(prev).add(docId));
        try {
            await deleteDocument(docId);
            setDocs(prev => prev.filter(d => d.id !== docId));
            setSelectedIds(prev => prev.filter(x => x !== docId));
            if (viewingDoc?.id === docId) setViewingDoc(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setDeletingIds(prev => { const next = new Set(prev); next.delete(docId); return next; });
        }
    };

    const handleDownload = async (doc: MikeDocument) => {
        try {
            const { url, filename } = await getDocumentUrl(doc.id);
            const a = document.createElement("a");
            a.href = url; a.download = filename; a.click();
        } catch (e) { setError((e as Error).message); }
    };

    const handleDownloadSelected = async () => {
        setActionsOpen(false);
        const ids = [...selectedIds];
        if (ids.length === 1) {
            const doc = docs.find(d => d.id === ids[0]);
            if (doc) await handleDownload(doc);
            return;
        }
        try {
            const blob = await downloadDocumentsZip(ids);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob); a.download = "templates.zip"; a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) { setError((e as Error).message); }
    };

    const handleDeleteSelected = async () => {
        const ids = [...selectedIds];
        setActionsOpen(false);
        setSelectedIds([]);
        await Promise.all(ids.map(id => handleDelete(id)));
    };

    const handleRemoveSelectedFromFolder = async () => {
        const ids = selectedIds.filter(id => docs.find(d => d.id === id)?.template_folder_id != null);
        setActionsOpen(false);
        if (!ids.length) return;
        setDocs(prev => prev.map(d => ids.includes(d.id) ? { ...d, template_folder_id: null } : d));
        await Promise.all(ids.map(id => moveTemplateDocument(id, null).catch(() => {})));
    };

    async function handleCreateFolder(parentId: string | null) {
        const trimmed = newFolderName.trim();
        setCreatingFolderIn(undefined);
        setNewFolderName("");
        if (!trimmed) return;
        try {
            const folder = await createTemplateFolder(trimmed, parentId ?? undefined);
            setFolders(prev => [...prev, folder]);
            if (parentId) {
                setExpandedFolderIds(prev => { const next = new Set(prev); next.add(parentId); return next; });
            }
        } catch (e) { setError((e as Error).message); }
    }

    async function handleRenameFolder(folderId: string) {
        const trimmed = renameFolderValue.trim();
        setRenamingFolderId(null);
        setRenameFolderValue("");
        if (!trimmed) return;
        setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: trimmed } : f));
        try {
            await renameTemplateFolder(folderId, trimmed);
        } catch (e) { setError((e as Error).message); load(); }
    }

    async function handleDeleteFolder(folderId: string) {
        const childIds = getDescendantFolderIds(folderId);
        setDocs(prev => prev.map(d =>
            (d.template_folder_id === folderId || (d.template_folder_id != null && childIds.has(d.template_folder_id)))
                ? { ...d, template_folder_id: null } : d
        ));
        setFolders(prev => prev.filter(f => f.id !== folderId && !childIds.has(f.id)));
        setExpandedFolderIds(prev => {
            const next = new Set(prev);
            next.delete(folderId);
            childIds.forEach(id => next.delete(id));
            return next;
        });
        try {
            await deleteTemplateFolder(folderId);
        } catch (e) { setError((e as Error).message); load(); }
    }

    async function handleRemoveDocFromFolder(docId: string) {
        setDocs(prev => prev.map(d => d.id === docId ? { ...d, template_folder_id: null } : d));
        try {
            await moveTemplateDocument(docId, null);
        } catch (e) { setError((e as Error).message); load(); }
    }

    async function handleDropOnFolder(targetFolderId: string | null, dt: DataTransfer) {
        const docId = dt.getData("application/mike-doc");
        const subfolderId = dt.getData("application/mike-folder");
        if (docId) {
            const doc = docs.find(d => d.id === docId);
            if (!doc || (doc.template_folder_id ?? null) === targetFolderId) return;
            setDocs(prev => prev.map(d => d.id === docId ? { ...d, template_folder_id: targetFolderId } : d));
            try { await moveTemplateDocument(docId, targetFolderId); }
            catch (e) { setError((e as Error).message); load(); }
        } else if (subfolderId && subfolderId !== targetFolderId) {
            if (targetFolderId !== null && wouldCreateCycle(subfolderId, targetFolderId)) return;
            const folder = folders.find(f => f.id === subfolderId);
            if (!folder || (folder.parent_folder_id ?? null) === targetFolderId) return;
            setFolders(prev => prev.map(f => f.id === subfolderId ? { ...f, parent_folder_id: targetFolderId } : f));
            try { await moveTemplateSubfolder(subfolderId, targetFolderId); }
            catch (e) { setError((e as Error).message); load(); }
        }
    }

    function renderFolderInput(parentId: string | null, depth: number) {
        if (creatingFolderIn !== parentId) return null;
        return (
            <div ref={newFolderInputRef} className="flex items-center h-10 pr-8 border-b border-gray-50" key={`new-folder-${parentId ?? "root"}`}>
                <div
                    className={`sticky left-0 z-[60] ${CHECK_W} bg-white p-2 flex items-center justify-center self-stretch`}
                    style={treeControlCellStyle(depth)}
                >
                    <ChevronRight className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                </div>
                <div className={`sticky left-8 z-[60] ${DOC_NAME_COL_W} bg-white p-2`} style={treeNameCellStyle(depth)}>
                    <div className="flex items-center gap-1.5">
                        <FolderPlus className="h-4 w-4 text-amber-400 shrink-0" />
                        <input
                            autoFocus
                            className="flex-1 min-w-0 text-sm text-gray-800 bg-transparent outline-none border-b border-gray-300"
                            placeholder="Folder name"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === "Enter") void handleCreateFolder(parentId);
                                if (e.key === "Escape") { setCreatingFolderIn(undefined); setNewFolderName(""); }
                            }}
                            onBlur={() => void handleCreateFolder(parentId)}
                        />
                    </div>
                </div>
                <div className="ml-auto w-16 shrink-0" />
                <div className="w-20 shrink-0" />
                <div className="w-28 shrink-0" />
                <div className="w-28 shrink-0" />
                <div className="w-8 shrink-0" />
            </div>
        );
    }

    function renderLevel(parentId: string | null, depth: number) {
        const childFolders = folders
            .filter(f => f.parent_folder_id === parentId)
            .sort((a, b) => a.name.localeCompare(b.name));
        const childDocs = docs.filter(d => (d.template_folder_id ?? null) === parentId);

        return (
            <>
                {childDocs.map(doc => {
                    const isSelected = selectedIds.includes(doc.id);
                    const rowBg = isSelected ? "bg-gray-50" : "bg-white";
                    return (
                        <div
                            key={`doc-${doc.id}`}
                            draggable={true}
                            onDragStart={e => {
                                e.dataTransfer.setData("application/mike-doc", doc.id);
                                e.dataTransfer.effectAllowed = "move";
                            }}
                            onClick={() => setViewingDoc(doc)}
                            className="group flex items-center h-10 pr-8 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                        >
                            <div
                                className={`sticky left-0 z-[60] ${CHECK_W} p-2 flex items-center justify-center ${rowBg} group-hover:bg-gray-50 self-stretch`}
                                style={treeControlCellStyle(depth)}
                                onClick={e => e.stopPropagation()}
                            >
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleOne(doc.id)}
                                    onClick={e => e.stopPropagation()}
                                    className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                                />
                            </div>
                            <div
                                className={`sticky left-8 z-[60] ${DOC_NAME_COL_W} ${rowBg} p-2 group-hover:bg-gray-50`}
                                style={treeNameCellStyle(depth)}
                            >
                                <div className="flex items-center gap-2">
                                    {doc.status === "processing" ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-gray-400 shrink-0" />
                                    ) : (
                                        <DocIcon fileType={doc.file_type} />
                                    )}
                                    <span className="text-sm text-gray-800 truncate" title={doc.filename}>{doc.filename}</span>
                                </div>
                            </div>
                            <div className="ml-auto w-16 shrink-0 text-xs text-gray-500 uppercase">
                                {doc.file_type ?? <span className="text-gray-300">—</span>}
                            </div>
                            <div className="w-20 shrink-0 text-xs text-gray-500">
                                {doc.size_bytes != null ? formatBytes(doc.size_bytes) : <span className="text-gray-300">—</span>}
                            </div>
                            <div className="w-28 shrink-0 text-xs text-gray-500">
                                {doc.created_at ? formatDate(doc.created_at) : <span className="text-gray-300">—</span>}
                            </div>
                            <div className="w-28 shrink-0 text-xs text-gray-500">
                                {doc.updated_at ? formatDate(doc.updated_at) : <span className="text-gray-300">—</span>}
                            </div>
                            <div className="w-8 shrink-0 flex justify-end" onClick={e => e.stopPropagation()}>
                                {doc.status !== "processing" && (
                                    <RowActions
                                        onDownload={() => handleDownload(doc)}
                                        onRemoveFromFolder={doc.template_folder_id ? () => handleRemoveDocFromFolder(doc.id) : undefined}
                                        onDelete={() => handleDelete(doc.id)}
                                        deleting={deletingIds.has(doc.id)}
                                    />
                                )}
                            </div>
                        </div>
                    );
                })}

                {childFolders.map(folder => {
                    const isExpanded = expandedFolderIds.has(folder.id);
                    const isRenaming = renamingFolderId === folder.id;
                    return (
                        <div key={`folder-${folder.id}`}>
                            <div
                                draggable={!isRenaming}
                                onDragStart={e => {
                                    if (isRenaming) { e.preventDefault(); return; }
                                    e.dataTransfer.setData("application/mike-folder", folder.id);
                                    e.dataTransfer.effectAllowed = "move";
                                    e.stopPropagation();
                                }}
                                onDragOver={e => {
                                    if (!hasMovePayload(e.dataTransfer)) return;
                                    e.preventDefault(); e.stopPropagation();
                                    setDragOverFolderId(folder.id);
                                }}
                                onDragLeave={e => { e.stopPropagation(); setDragOverFolderId(null); }}
                                onDrop={async e => {
                                    if (!hasMovePayload(e.dataTransfer)) return;
                                    e.preventDefault(); e.stopPropagation();
                                    setDragOverFolderId(null); setDragOverRoot(false);
                                    await handleDropOnFolder(folder.id, e.dataTransfer);
                                }}
                                onClick={() => toggleFolder(folder.id)}
                                className={`group flex items-center h-10 pr-8 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors select-none ${dragOverFolderId === folder.id ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}
                            >
                                <div
                                    className={`sticky left-0 z-[60] ${CHECK_W} p-2 flex items-center justify-center ${dragOverFolderId === folder.id ? "bg-blue-50" : "bg-white"} group-hover:bg-gray-50 self-stretch`}
                                    style={treeControlCellStyle(depth)}
                                >
                                    {isExpanded
                                        ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                        : <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                    }
                                </div>
                                <div
                                    className={`sticky left-8 z-[60] ${DOC_NAME_COL_W} p-2 ${dragOverFolderId === folder.id ? "bg-blue-50" : "bg-white"} group-hover:bg-gray-50`}
                                    style={treeNameCellStyle(depth)}
                                >
                                    <div className="flex items-center gap-1.5">
                                        {isExpanded
                                            ? <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                                            : <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                                        }
                                        {isRenaming ? (
                                            <input
                                                autoFocus
                                                className="flex-1 min-w-0 text-sm text-gray-800 bg-transparent outline-none"
                                                value={renameFolderValue}
                                                onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
                                                onChange={e => setRenameFolderValue(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === "Enter") void handleRenameFolder(folder.id);
                                                    if (e.key === "Escape") setRenamingFolderId(null);
                                                }}
                                                onBlur={() => void handleRenameFolder(folder.id)}
                                                onClick={e => e.stopPropagation()}
                                            />
                                        ) : (
                                            <span className="text-sm text-gray-800 truncate">{folder.name}</span>
                                        )}
                                    </div>
                                </div>
                                <div className="ml-auto w-16 shrink-0 text-xs text-gray-300">—</div>
                                <div className="w-20 shrink-0 text-sm text-gray-300">—</div>
                                <div className="w-28 shrink-0 text-sm text-gray-300">—</div>
                                <div className="w-28 shrink-0 text-sm text-gray-300">—</div>
                                <div className="w-8 shrink-0 flex justify-end" onClick={e => e.stopPropagation()}>
                                    <RowActions
                                        onRename={() => {
                                            closeRowActionMenus();
                                            setRenameFolderValue(folder.name);
                                            setRenamingFolderId(folder.id);
                                        }}
                                        onNewSubfolder={() => {
                                            setCreatingFolderIn(folder.id);
                                            setNewFolderName("");
                                            setExpandedFolderIds(prev => { const next = new Set(prev); next.add(folder.id); return next; });
                                        }}
                                        onDelete={() => handleDeleteFolder(folder.id)}
                                    />
                                </div>
                            </div>
                            {isExpanded && renderLevel(folder.id, depth + 1)}
                        </div>
                    );
                })}

                {renderFolderInput(parentId, depth)}
            </>
        );
    }

    const hasDocsInFolders = selectedIds.some(id => docs.find(d => d.id === id)?.template_folder_id != null);
    const isEmpty = docs.length === 0 && folders.length === 0 && creatingFolderIn === undefined;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                <h1 className="text-lg font-semibold text-gray-900">Templates</h1>
                <div className="flex items-center gap-3">
                    {selectedIds.length > 0 && (
                        <div ref={actionsRef} className="relative">
                            <button
                                onClick={() => setActionsOpen(v => !v)}
                                className="flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors"
                            >
                                Actions
                                <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                            {actionsOpen && (
                                <div className="absolute top-full right-0 mt-1 w-44 rounded-lg border border-gray-100 bg-white shadow-lg z-[120] overflow-hidden">
                                    <button
                                        onClick={handleDownloadSelected}
                                        className="w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                                    >
                                        Download
                                    </button>
                                    {hasDocsInFolders && (
                                        <button
                                            onClick={handleRemoveSelectedFromFolder}
                                            className="w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                                        >
                                            Remove from folder
                                        </button>
                                    )}
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
                    <button
                        onClick={() => { setCreatingFolderIn(null); setNewFolderName(""); }}
                        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        <FolderPlus className="h-3.5 w-3.5" />
                        Add Folder
                    </button>
                    <input
                        type="text"
                        placeholder="Search…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="h-8 w-48 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:border-gray-400"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
                    >
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Upload
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".docx,.doc"
                        className="hidden"
                        onChange={e => {
                            const files = Array.from(e.target.files ?? []);
                            if (files.length) handleUpload(files);
                            e.target.value = "";
                        }}
                    />
                </div>
            </div>

            {error && (
                <div className="mx-6 mt-3 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600 flex items-center justify-between shrink-0">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="ml-3 underline text-red-500 hover:text-red-700">Dismiss</button>
                </div>
            )}

            {/* Table */}
            <div className="w-full flex-1 min-h-0 overflow-x-auto">
                <div className="min-w-max flex min-h-full flex-col">
                    {/* Column headers */}
                    <div className="flex items-center h-8 pr-8 border-b border-gray-200 text-xs text-gray-500 font-medium select-none shrink-0">
                        <div className={`sticky left-0 z-[60] ${CHECK_W} relative bg-white flex items-center justify-center self-stretch before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-white`}>
                            <input
                                type="checkbox"
                                checked={allSelected}
                                ref={el => { if (el) el.indeterminate = someSelected; }}
                                onChange={toggleAll}
                                className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                            />
                        </div>
                        <div className={`sticky left-8 z-[60] ${DOC_NAME_COL_W} bg-white pl-2 text-left`}>Name</div>
                        <div className="ml-auto w-16 shrink-0 text-left">Type</div>
                        <div className="w-20 shrink-0 text-left">Size</div>
                        <div className="w-28 shrink-0 text-left">Created</div>
                        <div className="w-28 shrink-0 text-left">Updated</div>
                        <div className="w-8 shrink-0" />
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                        </div>
                    ) : q ? (
                        /* Flat search results */
                        filtered.length === 0 ? (
                            <div className="flex items-center justify-center h-40">
                                <p className="text-sm text-gray-400">No templates match your search</p>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col">
                                {filtered.map(doc => {
                                    const isSelected = selectedIds.includes(doc.id);
                                    const rowBg = isSelected ? "bg-gray-50" : "bg-white";
                                    return (
                                        <div
                                            key={`search-doc-${doc.id}`}
                                            onClick={() => setViewingDoc(doc)}
                                            className="group flex items-center h-10 pr-8 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                                        >
                                            <div
                                                className={`sticky left-0 z-[60] ${CHECK_W} p-2 flex items-center justify-center ${rowBg} group-hover:bg-gray-50 self-stretch`}
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleOne(doc.id)}
                                                    onClick={e => e.stopPropagation()}
                                                    className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                                                />
                                            </div>
                                            <div className={`sticky left-8 z-[60] ${DOC_NAME_COL_W} ${rowBg} p-2 group-hover:bg-gray-50`}>
                                                <div className="flex items-center gap-2">
                                                    <DocIcon fileType={doc.file_type} />
                                                    <span className="text-sm text-gray-800 truncate" title={doc.filename}>{doc.filename}</span>
                                                </div>
                                            </div>
                                            <div className="ml-auto w-16 shrink-0 text-xs text-gray-500 uppercase">
                                                {doc.file_type ?? <span className="text-gray-300">—</span>}
                                            </div>
                                            <div className="w-20 shrink-0 text-xs text-gray-500">
                                                {doc.size_bytes != null ? formatBytes(doc.size_bytes) : <span className="text-gray-300">—</span>}
                                            </div>
                                            <div className="w-28 shrink-0 text-xs text-gray-500">
                                                {doc.created_at ? formatDate(doc.created_at) : <span className="text-gray-300">—</span>}
                                            </div>
                                            <div className="w-28 shrink-0 text-xs text-gray-500">
                                                {doc.updated_at ? formatDate(doc.updated_at) : <span className="text-gray-300">—</span>}
                                            </div>
                                            <div className="w-8 shrink-0 flex justify-end" onClick={e => e.stopPropagation()}>
                                                <RowActions
                                                    onDownload={() => handleDownload(doc)}
                                                    onRemoveFromFolder={doc.template_folder_id ? () => handleRemoveDocFromFolder(doc.id) : undefined}
                                                    onDelete={() => handleDelete(doc.id)}
                                                    deleting={deletingIds.has(doc.id)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    ) : (
                        /* Folder tree with drag-drop */
                        <div
                            className={`flex-1 flex flex-col min-h-0 relative transition-colors ${
                                dragOverRoot ? "ring-2 ring-inset ring-blue-300 bg-blue-50/30" :
                                uploadDragOver ? "bg-blue-50" : ""
                            }`}
                            onDragOver={e => {
                                if (hasFilePayload(e.dataTransfer)) {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "copy";
                                    setUploadDragOver(true);
                                } else if (hasMovePayload(e.dataTransfer)) {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                    setDragOverRoot(true);
                                }
                            }}
                            onDragLeave={e => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                    setUploadDragOver(false);
                                    setDragOverRoot(false);
                                }
                            }}
                            onDrop={async e => {
                                if (hasFilePayload(e.dataTransfer)) {
                                    e.preventDefault();
                                    setUploadDragOver(false);
                                    const files = Array.from(e.dataTransfer.files);
                                    if (files.length) handleUpload(files);
                                } else if (hasMovePayload(e.dataTransfer)) {
                                    e.preventDefault();
                                    setDragOverRoot(false);
                                    await handleDropOnFolder(null, e.dataTransfer);
                                }
                            }}
                        >
                            {isEmpty ? (
                                <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-4">
                                    <p className="text-sm text-gray-400">No templates yet — upload a file to get started</p>
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="mt-1 text-sm font-medium text-gray-700 underline hover:text-gray-900"
                                    >
                                        Upload template
                                    </button>
                                </div>
                            ) : (
                                renderLevel(null, 0)
                            )}
                            {uploadDragOver && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <p className="text-blue-500 font-semibold text-base">Drop files to upload as templates</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <DocViewModal
                doc={viewingDoc}
                onClose={() => setViewingDoc(null)}
                onDelete={doc => handleDelete(doc.id)}
            />
        </div>
    );
}
