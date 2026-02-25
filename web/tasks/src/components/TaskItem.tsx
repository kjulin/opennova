import { useState } from "react";
import type { Task, Resource } from "../api";

interface TaskItemProps {
  task: Task;
  isInFlight: boolean;
  ownerName: string;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  onRunNow: (id: string) => void;
  onStart: (id: string) => void;
  onChat: (task: Task) => void;
  onDeliverFile: (task: Task, resource: Resource) => void;
}

export function TaskItem({
  task,
  isInFlight,
  ownerName,
  onComplete,
  onCancel,
  onRunNow,
  onStart,
  onChat,
  onDeliverFile,
}: TaskItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const completedSteps = task.steps.filter((s) => s.done).length;
  const totalSteps = task.steps.length;
  return (
    <div className="rounded-xl border border-white/5 bg-[#161b22] transition-all hover:border-white/10 hover:bg-[#1c2129]">
      <div
        className="flex cursor-pointer items-center gap-4 px-4 py-3.5"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight text-gray-100">
            <span className="text-gray-500">#{task.id}</span> {task.title}
          </p>
          {totalSteps > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              {completedSteps}/{totalSteps} steps
            </p>
          )}
        </div>

        {task.status === "draft" && (
          <span className="rounded-md bg-gray-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Draft
          </span>
        )}

        {isInFlight && (
          <span className="rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-400 animate-pulse">
            Running
          </span>
        )}

        <span className="text-xs text-gray-500">{ownerName}</span>

        <svg
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>

      {isOpen && (
        <div className="border-t border-[#2d333b] px-4 pb-4 pt-3 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
              Description
            </label>
            <div className="rounded-lg bg-[#0d1117] px-3 py-2.5 text-sm text-[#c9d1d9]">
              {task.description ? (
                <>
                  <div
                    className={descExpanded ? "" : "line-clamp-3"}
                  >
                    {task.description}
                  </div>
                  {task.description.length > 150 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDescExpanded(!descExpanded);
                      }}
                      className="mt-1 text-xs text-blue-400 hover:text-blue-300"
                    >
                      {descExpanded ? "Show less" : "Show more"}
                    </button>
                  )}
                </>
              ) : (
                <span className="text-gray-500 italic">No description</span>
              )}
            </div>
          </div>

          {task.steps.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
                Steps
              </label>
              <div className="rounded-lg bg-[#0d1117] px-3 py-2.5 text-sm text-[#c9d1d9] space-y-1">
                {task.steps.map((step, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          step.done ? "text-emerald-400" : "text-gray-500"
                        }
                      >
                        {step.done ? "\u2713" : "\u25CB"}
                      </span>
                      <span className={step.done ? "text-gray-400" : ""}>
                        {step.title}
                      </span>
                      {step.taskId && (
                        <span className="text-blue-400 text-xs">#{step.taskId}</span>
                      )}
                      {step.details && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedSteps((prev) => {
                              const next = new Set(prev);
                              if (next.has(i)) {
                                next.delete(i);
                              } else {
                                next.add(i);
                              }
                              return next;
                            });
                          }}
                          className="ml-auto text-gray-500 hover:text-gray-400 text-xs"
                        >
                          {expandedSteps.has(i) ? "hide" : "details"}
                        </button>
                      )}
                    </div>
                    {step.details && expandedSteps.has(i) && (
                      <div className="ml-6 mt-1 text-xs text-gray-400 whitespace-pre-wrap">
                        {step.details}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {task.resources.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
                Resources
              </label>
              <div className="rounded-lg bg-[#0d1117] px-3 py-2.5 text-sm text-[#c9d1d9] space-y-1.5">
                {task.resources.map((resource, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-gray-500 text-xs shrink-0">
                      {resource.type === "url" ? "\uD83D\uDD17" : "\uD83D\uDCC4"}
                    </span>
                    {resource.type === "url" ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.Telegram?.WebApp?.openLink?.(resource.value) ??
                            window.open(resource.value, "_blank");
                        }}
                        className="text-blue-400 hover:text-blue-300 truncate text-left"
                      >
                        {resource.label || resource.value}
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeliverFile(task, resource);
                        }}
                        className="text-blue-400 hover:text-blue-300 truncate text-left"
                      >
                        {resource.label || resource.value.split("/").pop() || resource.value}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {task.status === "draft" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(task.id);
                }}
                className="rounded-lg px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
              >
                Start
              </button>
            )}

            {task.status === "active" && task.owner !== "user" && !isInFlight && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRunNow(task.id);
                }}
                className="rounded-lg px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 transition-colors"
              >
                Work now
              </button>
            )}

            {task.threadId && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onChat(task);
                }}
                className="rounded-lg px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
              >
                Chat
              </button>
            )}

            {task.status === "active" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onComplete(task.id);
                }}
                className="rounded-lg px-3 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
              >
                Complete
              </button>
            )}

            {confirmCancel ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmCancel(false);
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-500/10 transition-colors"
                >
                  Keep
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel(task.id);
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                >
                  Confirm Cancel
                </button>
              </>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmCancel(true);
                }}
                className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:text-gray-400 hover:bg-gray-500/10 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
