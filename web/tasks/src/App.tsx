import { useState, useEffect, useCallback } from "react";
import {
  fetchTasks,
  fetchHistory,
  completeTask,
  cancelTask,
  type Task,
  type ArchivedTask,
  type Agent,
} from "./api";
import { TaskList } from "./components/TaskList";
import { HistoryList } from "./components/HistoryList";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        sendData: (data: string) => void;
      };
    };
  }
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [history, setHistory] = useState<ArchivedTask[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [inFlightIds, setInFlightIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchTasks();
      setTasks(data.tasks);
      setAgents(data.agents);
      setInFlightIds(data.inFlightIds);
      setLastUpdated(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchHistory(50);
      setHistory(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    loadTasks();

    const interval = setInterval(loadTasks, 60000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  useEffect(() => {
    if (showHistory) {
      loadHistory();
    }
  }, [showHistory, loadHistory]);

  const handleComplete = async (id: string) => {
    try {
      await completeTask(id);
      await loadTasks();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelTask(id);
      await loadTasks();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleChat = (task: Task) => {
    if (!task.threadId) return;
    const data = JSON.stringify({
      action: "chat",
      agentId: task.owner,
      threadId: task.threadId,
      taskTitle: task.title,
    });
    window.Telegram?.WebApp?.sendData(data);
  };

  const getOwnerName = (ownerId: string) => {
    if (ownerId === "user") return "You";
    const agent = agents.find((a) => a.id === ownerId);
    return agent?.name ?? ownerId;
  };

  const activeCount = tasks.filter((t) => t.status === "active").length;
  const waitingCount = tasks.filter((t) => t.status === "waiting").length;

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0e1117] text-white">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <header className="mb-8 flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-blue-500/20">
            <svg
              className="h-7 w-7 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Nova Tasks</h1>
            <p className="mt-0.5 text-sm text-gray-400">
              {activeCount} active, {waitingCount} waiting
            </p>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {!showHistory ? (
          <>
            <TaskList
              tasks={tasks}
              inFlightIds={inFlightIds}
              getOwnerName={getOwnerName}
              onComplete={handleComplete}
              onCancel={handleCancel}
              onChat={handleChat}
            />

            <button
              onClick={() => setShowHistory(true)}
              className="mt-6 w-full text-center text-sm text-gray-500 hover:text-gray-400 transition-colors"
            >
              View history
            </button>
          </>
        ) : (
          <>
            <div className="mb-6">
              <button
                onClick={() => setShowHistory(false)}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Back to tasks
              </button>
            </div>

            <h2 className="mb-4 text-lg font-semibold text-gray-300">History</h2>

            <HistoryList tasks={history} getOwnerName={getOwnerName} />
          </>
        )}

        {lastUpdated && (
          <p className="mt-8 text-center text-xs text-gray-500">
            Last updated {lastUpdated.toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}
