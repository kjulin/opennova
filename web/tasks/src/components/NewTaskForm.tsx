import { useState } from "react";
import type { Agent } from "../api";

interface NewTaskFormProps {
  agents: Agent[];
  onSubmit: (data: { title: string; description: string; owner: string }) => void;
  onCancel: () => void;
}

export function NewTaskForm({ agents, onSubmit, onCancel }: NewTaskFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState(agents[0]?.id ?? "user");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({ title: title.trim(), description: description.trim(), owner });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-white/10 bg-[#161b22] p-4 space-y-4"
    >
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done?"
          className="w-full rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          autoFocus
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Context and details..."
          rows={3}
          className="w-full rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
          Assign to
        </label>
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="w-full rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="user">You</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-gray-300 hover:bg-gray-500/10 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create Task
        </button>
      </div>
    </form>
  );
}
