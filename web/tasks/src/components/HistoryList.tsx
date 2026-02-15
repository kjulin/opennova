import type { ArchivedTask } from "../api";

interface HistoryListProps {
  tasks: ArchivedTask[];
  getOwnerName: (id: string) => string;
}

export function HistoryList({ tasks, getOwnerName }: HistoryListProps) {
  if (tasks.length === 0) {
    return <div className="py-12 text-center text-gray-500">No history.</div>;
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="rounded-xl border border-white/5 bg-[#161b22] px-4 py-3 opacity-60"
        >
          <div className="flex items-center gap-3">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                task.status === "done" ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            <p className="flex-1 text-sm text-gray-400 line-through">
              {task.title}
            </p>
            <span className="text-xs text-gray-500">
              {getOwnerName(task.owner)}
            </span>
            <span className="text-xs text-gray-600">
              {new Date(task.archivedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
