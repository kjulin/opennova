import type { Task, Agent } from '../api'
import { TaskItem } from './TaskItem'

interface TaskListProps {
  tasks: Task[]
  agents: Agent[]
  onToggle: (id: string) => void
  onDismiss: (id: string) => void
  onRemarks: (id: string, remarks: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
}

export function TaskList({ tasks, agents, onToggle, onDismiss, onRemarks, onArchive, onDelete }: TaskListProps) {
  const pending = tasks.filter(t => t.status === 'open')
  const inProgress = tasks.filter(t => t.status === 'in_progress')
  const completed = tasks.filter(t => t.status === 'done')
  const failed = tasks.filter(t => t.status === 'failed')
  const dismissed = tasks.filter(t => t.status === 'dismissed')

  const getAgentName = (agentId: string) => {
    if (agentId === 'user') return 'You'
    const agent = agents.find(a => a.id === agentId)
    return agent?.name ?? agentId
  }

  const renderTaskItem = (task: Task) => (
    <TaskItem
      key={task.id}
      task={task}
      assigneeName={getAgentName(task.assignee)}
      creatorName={getAgentName(task.agentId)}
      onToggle={onToggle}
      onDismiss={onDismiss}
      onRemarks={onRemarks}
      onArchive={onArchive}
      onDelete={onDelete}
    />
  )

  return (
    <div className="space-y-6">
      {inProgress.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            In Progress
            <span className="text-gray-500">({inProgress.length})</span>
          </h2>
          <div className="space-y-2">
            {inProgress.map(renderTaskItem)}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Pending
            <span className="text-gray-500">({pending.length})</span>
          </h2>
          <div className="space-y-2">
            {pending.map(renderTaskItem)}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Completed
            <span className="text-gray-500">({completed.length})</span>
          </h2>
          <div className="space-y-2">
            {completed.map(renderTaskItem)}
          </div>
        </section>
      )}

      {failed.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
            Failed
            <span className="text-gray-500">({failed.length})</span>
          </h2>
          <div className="space-y-2">
            {failed.map(renderTaskItem)}
          </div>
        </section>
      )}

      {dismissed.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            Dismissed
            <span className="text-gray-500">({dismissed.length})</span>
          </h2>
          <div className="space-y-2">
            {dismissed.map(renderTaskItem)}
          </div>
        </section>
      )}

      {tasks.length === 0 && (
        <div className="py-12 text-center text-gray-500">
          No tasks found.
        </div>
      )}
    </div>
  )
}
