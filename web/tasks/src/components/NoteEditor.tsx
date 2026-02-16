import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { marked } from "marked";
import { fetchNote, updateNote } from "../api";

interface Props {
  agent: string;
  slug: string;
}

export function NoteEditor({ agent, slug }: Props) {
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef(content);
  const originalRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    fetchNote(agent, slug)
      .then((note) => {
        setContent(note.content);
        originalRef.current = note.content;
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [agent, slug]);

  const save = useCallback(async () => {
    if (contentRef.current === originalRef.current) return;
    try {
      await updateNote(agent, slug, contentRef.current);
      originalRef.current = contentRef.current;
    } catch (err) {
      setError((err as Error).message);
    }
  }, [agent, slug]);

  // Debounced auto-save: 1s after last keystroke
  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(), 1000);
  }, [save]);

  // Flush on unmount / page hide
  useEffect(() => {
    const flush = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (contentRef.current !== originalRef.current) {
        navigator.sendBeacon(
          `/api/notes/${agent}/${slug}`,
          new Blob([JSON.stringify({ content: contentRef.current })], { type: "application/json" }),
        );
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", flush);
    };
  }, [agent, slug]);

  const handleBlur = useCallback(async () => {
    await save();
    setEditing(false);
  }, [save]);

  const lastTapRef = useRef(0);
  const handleDoubleTap = useCallback((e: React.MouseEvent) => {
    // Let links open in external browser instead of triggering edit
    const target = e.target as HTMLElement;
    if (target.tagName === "A" || target.closest("a")) {
      const anchor = (target.tagName === "A" ? target : target.closest("a")) as HTMLAnchorElement;
      e.preventDefault();
      window.Telegram?.WebApp?.openLink?.(anchor.href) ?? window.open(anchor.href, "_blank");
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 400) {
      setEditing(true);
    }
    lastTapRef.current = now;
  }, []);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  const html = useMemo(() => marked.parse(content), [content]);

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
        {error && (
          <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {editing ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              scheduleSave();
            }}
            onBlur={handleBlur}
            className="w-full min-h-[80vh] rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-gray-200 font-mono resize-y focus:outline-none focus:border-blue-500/50 placeholder-gray-600"
            placeholder="Write your note..."
          />
        ) : (
          <div
            onClick={handleDoubleTap}
            className="min-h-[80vh] rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-gray-200 prose prose-invert prose-sm max-w-none cursor-text"
            dangerouslySetInnerHTML={{ __html: html as string }}
          />
        )}
        <p className="mt-2 text-center text-xs text-gray-600">Double-tap to edit</p>
      </div>
    </div>
  );
}
