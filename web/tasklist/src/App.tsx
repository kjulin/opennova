import { useState, useEffect, useCallback } from "react";
import {
  fetchTasks,
  updateTaskStatus,
  updateTaskRemarks,
  createTask,
  archiveTask,
  type Task,
  type Agent,
} from "./api";
import { TaskList } from "./components/TaskList";
import { NewTaskForm } from "./components/NewTaskForm";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
      };
    };
  }
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMyTasksOnly, setShowMyTasksOnly] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchTasks();
      setTasks(data.tasks);
      setAgents(data.agents);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    loadTasks();
  }, [loadTasks]);

  const handleToggle = async (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const newStatus = task.status === 'done' ? 'open' : 'done';
    try {
      await updateTaskStatus(id, newStatus as 'done' | 'dismissed');
      await loadTasks();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDismiss = async (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const newStatus = task.status === 'dismissed' ? 'open' : 'dismissed';
    try {
      await updateTaskStatus(id, newStatus as 'done' | 'dismissed');
      await loadTasks();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRemarks = async (id: string, remarks: string) => {
    try {
      await updateTaskRemarks(id, remarks);
      await loadTasks();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAddTask = async (data: { title: string; assignee: string; rationale: string; instructions: string }) => {
    try {
      await createTask(data);
      await loadTasks();
      setShowNewForm(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await archiveTask(id);
      await loadTasks();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const filteredTasks = showMyTasksOnly
    ? tasks.filter(t => t.assignee === 'user')
    : tasks;

  const totalCount = tasks.length;
  const completedCount = tasks.filter(t => t.status === 'done').length;
  const myTaskCount = tasks.filter(t => t.assignee === 'user').length;

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
            <h1 className="text-2xl font-bold tracking-tight">Task Manager</h1>
            <p className="mt-0.5 text-sm text-gray-400">
              {completedCount} of {totalCount} tasks completed
            </p>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="mb-6 flex items-center gap-3">
          <div className="flex flex-1 items-center rounded-xl bg-[#161b22] p-1">
            <button
              onClick={() => setShowMyTasksOnly(false)}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                !showMyTasksOnly
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              All Tasks
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/15 px-1.5 text-xs">
                {totalCount}
              </span>
            </button>
            <button
              onClick={() => setShowMyTasksOnly(true)}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                showMyTasksOnly
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              My Tasks
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/15 px-1.5 text-xs">
                {myTaskCount}
              </span>
            </button>
          </div>
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={showNewForm ? 'M6 18L18 6M6 6l12 12' : 'M12 4v16m8-8H4'} />
            </svg>
          </button>
        </div>

        {showNewForm && (
          <div className="mb-6">
            <NewTaskForm
              agents={agents}
              onAdd={handleAddTask}
              onCancel={() => setShowNewForm(false)}
            />
          </div>
        )}

        <TaskList
          tasks={filteredTasks}
          agents={agents}
          onToggle={handleToggle}
          onDismiss={handleDismiss}
          onRemarks={handleRemarks}
          onArchive={handleArchive}
        />
      </div>
    </div>
  );
}
