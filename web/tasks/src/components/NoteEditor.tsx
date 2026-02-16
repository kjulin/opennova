import { useState, useEffect, useCallback } from "react";
import { fetchNote, updateNote, deleteNoteApi } from "../api";

interface Props {
  agent: string;
  slug: string;
}

export function NoteEditor({ agent, slug }: Props) {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetchNote(agent, slug)
      .then((note) => {
        setContent(note.content);
        setTitle(note.title);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [agent, slug]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateNote(agent, slug, content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [agent, slug, content]);

  const handleDelete = useCallback(async () => {
    setError(null);
    try {
      await deleteNoteApi(agent, slug);
      window.Telegram?.WebApp?.close();
      window.location.hash = "";
    } catch (err) {
      setError((err as Error).message);
    }
  }, [agent, slug]);

  const handleClose = () => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.close();
    } else {
      window.location.hash = "";
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0e1117] text-white">
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={handleClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">{title}</h1>
            <p className="text-xs text-gray-500">{agent}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Editor */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full min-h-[60vh] rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-gray-200 font-mono resize-y focus:outline-none focus:border-blue-500/50 placeholder-gray-600"
          placeholder="Write your note..."
        />

        {/* Actions */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : saved ? "Saved" : "Save"}
          </button>

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-xl px-4 py-2.5 text-sm text-gray-500 hover:text-red-400 transition-colors"
            >
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                className="rounded-xl bg-red-600/20 border border-red-500/30 px-4 py-2.5 text-sm text-red-400 hover:bg-red-600/30 transition-colors"
              >
                Confirm delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl px-3 py-2.5 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
