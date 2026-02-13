import { useState, useEffect, useCallback } from "react";
import {
  fetchTasks,
  fetchArchivedTasks,
  fetchProjects,
  updateTaskStatus,
  updateTaskRemarks,
  updateTaskTitle,
  updateProjectStatus,
  updateProjectFull,
  updatePhaseStatus,
  createTask,
  createProject,
  archiveTask,
  deleteTask,
  type Task,
  type ArchivedTask,
  type Agent,
  type Project,
} from "./api";
import { TaskList } from "./components/TaskList";
import { ArchivedTaskList } from "./components/ArchivedTaskList";
import { NewTaskForm } from "./components/NewTaskForm";
import { ProjectForm } from "./components/NewProjectForm";
import { ProjectList } from "./components/ProjectList";

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

type MainView = "tasks" | "projects";

export default function App() {
  const [mainView, setMainView] = useState<MainView>("tasks");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<ArchivedTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMyTasksOnly, setShowMyTasksOnly] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchTasks();
      setTasks(data.tasks);
      setAgents(data.agents);
      setLastUpdated(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchProjects();
      setProjects(data.projects);
      // Merge agents from projects API if not already loaded
      if (data.agents.length > 0) {
        setAgents(prev => {
          const existingIds = new Set(prev.map(a => a.id));
          const newAgents = data.agents.filter(a => !existingIds.has(a.id));
          return [...prev, ...newAgents];
        });
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadArchivedTasks = useCallback(async () => {
    try {
      const archived = await fetchArchivedTasks(7);
      setArchivedTasks(archived);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    loadTasks();
    loadProjects();

    // Poll for updates every minute
    const interval = setInterval(() => {
      loadTasks();
      loadProjects();
    }, 60000);
    return () => clearInterval(interval);
  }, [loadTasks, loadProjects]);

  useEffect(() => {
    if (showArchived) {
      loadArchivedTasks();
    }
  }, [showArchived, loadArchivedTasks]);

  const handleToggle = async (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const newStatus = task.status === 'done' ? 'open' : 'done';
    try {
      await updateTaskStatus(id, newStatus);
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
      await updateTaskStatus(id, newStatus);
      await loadTasks();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleStatusChange = async (id: string, status: 'open' | 'review' | 'done' | 'dismissed') => {
    try {
      await updateTaskStatus(id, status);
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

  const handleTitle = async (id: string, title: string) => {
    try {
      await updateTaskTitle(id, title);
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

  const handleDelete = async (id: string) => {
    try {
      await deleteTask(id);
      await loadTasks();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleProjectSubmit = async (data: { title: string; description: string; lead: string; phases: { id?: string; title: string; description: string }[] }) => {
    try {
      if (editingProject) {
        await updateProjectFull(editingProject.id, data);
      } else {
        await createProject(data);
      }
      await loadProjects();
      setShowProjectForm(false);
      setEditingProject(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleEditProject = (project: Project) => {
    setEditingProject(project);
    setShowProjectForm(true);
  };

  const handleUpdateProjectStatus = async (id: string, status: 'active' | 'completed' | 'cancelled') => {
    try {
      await updateProjectStatus(id, status);
      await loadProjects();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleUpdatePhaseStatus = async (projectId: string, phaseId: string, status: 'pending' | 'in_progress' | 'review' | 'done') => {
    try {
      await updatePhaseStatus(projectId, phaseId, status);
      await loadProjects();
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
  const activeProjectCount = projects.filter(p => p.status === 'active').length;
  const reviewCount = projects.filter(p => p.phases.some(ph => ph.status === 'review')).length;

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
            <h1 className="text-2xl font-bold tracking-tight">Nova Dashboard</h1>
            <p className="mt-0.5 text-sm text-gray-400">
              {completedCount}/{totalCount} tasks · {activeProjectCount} active projects
            </p>
          </div>
        </header>

        {/* Main view toggle: Tasks / Projects */}
        <div className="mb-6 flex items-center rounded-xl bg-[#161b22] p-1">
          <button
            onClick={() => { setMainView("tasks"); setShowArchived(false); }}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
              mainView === "tasks"
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Tasks
            <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/15 px-1.5 text-xs">
              {totalCount}
            </span>
          </button>
          <button
            onClick={() => setMainView("projects")}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
              mainView === "projects"
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Projects
            <span className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs ${
              reviewCount > 0 ? 'bg-amber-500/30 text-amber-300' : 'bg-white/15'
            }`}>
              {projects.length}
            </span>
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {mainView === "tasks" && (
          <>
            {!showArchived ? (
              <>
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex flex-1 items-center rounded-xl bg-[#161b22] p-1">
                    <button
                      onClick={() => setShowMyTasksOnly(false)}
                      className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                        !showMyTasksOnly
                          ? 'bg-gray-700 text-white'
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
                          ? 'bg-gray-700 text-white'
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
                  onStatusChange={handleStatusChange}
                  onRemarks={handleRemarks}
                  onTitle={handleTitle}
                  onArchive={handleArchive}
                  onDelete={handleDelete}
                />

                <button
                  onClick={() => setShowArchived(true)}
                  className="mt-6 w-full text-center text-sm text-gray-500 hover:text-gray-400 transition-colors"
                >
                  View archived tasks (last 7 days)
                </button>
              </>
            ) : (
              <>
                <div className="mb-6 flex items-center gap-3">
                  <button
                    onClick={() => setShowArchived(false)}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to tasks
                  </button>
                </div>

                <h2 className="mb-4 text-lg font-semibold text-gray-300">Archived Tasks (Last 7 Days)</h2>

                <ArchivedTaskList tasks={archivedTasks} agents={agents} />
              </>
            )}
          </>
        )}

        {mainView === "projects" && (
          <>
            <div className="mb-6 flex justify-end">
              <button
                onClick={() => {
                  setEditingProject(null);
                  setShowProjectForm(!showProjectForm);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={showProjectForm ? 'M6 18L18 6M6 6l12 12' : 'M12 4v16m8-8H4'} />
                </svg>
              </button>
            </div>

            {showProjectForm && (
              <div className="mb-6">
                <ProjectForm
                  agents={agents}
                  project={editingProject ?? undefined}
                  onSubmit={handleProjectSubmit}
                  onCancel={() => {
                    setShowProjectForm(false);
                    setEditingProject(null);
                  }}
                />
              </div>
            )}

            {reviewCount > 0 && (
              <div className="mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-400">
                {reviewCount} project{reviewCount > 1 ? 's' : ''} waiting for your review
              </div>
            )}
            <ProjectList
              projects={projects}
              tasks={tasks}
              agents={agents}
              onUpdateProjectStatus={handleUpdateProjectStatus}
              onUpdatePhaseStatus={handleUpdatePhaseStatus}
              onEditProject={handleEditProject}
              onToggleTask={handleToggle}
              onDismissTask={handleDismiss}
              onStatusChangeTask={handleStatusChange}
              onRemarksTask={handleRemarks}
              onTitleTask={handleTitle}
              onArchiveTask={handleArchive}
              onDeleteTask={handleDelete}
            />
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
