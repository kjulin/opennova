import type { Task } from "../api";
import { TaskItem } from "./TaskItem";

interface TaskListProps {
  tasks: Task[];
  inFlightIds: string[];
  getOwnerName: (id: string) => string;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  onChat: (task: Task) => void;
}

export function TaskList({
  tasks,
  inFlightIds,
  getOwnerName,
  onComplete,
  onCancel,
  onChat,
}: TaskListProps) {
  const active = tasks.filter((t) => t.status === "active");
  const waiting = tasks.filter((t) => t.status === "waiting");

  return (
    <div className="space-y-6">
      {waiting.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Waiting for Input
            <span className="text-gray-500">({waiting.length})</span>
          </h2>
          <div className="space-y-2">
            {waiting.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                isInFlight={inFlightIds.includes(task.id)}
                ownerName={getOwnerName(task.owner)}
                onComplete={onComplete}
                onCancel={onCancel}
                onChat={onChat}
              />
            ))}
          </div>
        </section>
      )}

      {active.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            Active
            <span className="text-gray-500">({active.length})</span>
          </h2>
          <div className="space-y-2">
            {active.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                isInFlight={inFlightIds.includes(task.id)}
                ownerName={getOwnerName(task.owner)}
                onComplete={onComplete}
                onCancel={onCancel}
                onChat={onChat}
              />
            ))}
          </div>
        </section>
      )}

      {tasks.length === 0 && (
        <div className="py-12 text-center text-gray-500">No tasks.</div>
      )}
    </div>
  );
}
