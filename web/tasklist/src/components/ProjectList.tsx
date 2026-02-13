import type { Project, Task, Agent } from '../api'
import { ProjectItem } from './ProjectItem'

interface ProjectListProps {
  projects: Project[]
  tasks: Task[]
  agents: Agent[]
  onUpdateProjectStatus: (id: string, status: 'active' | 'completed' | 'cancelled') => void
  onUpdatePhaseStatus: (projectId: string, phaseId: string, status: 'pending' | 'in_progress' | 'review' | 'done') => void
  onEditProject?: (project: Project) => void
}

export function ProjectList({ projects, tasks, agents, onUpdateProjectStatus, onUpdatePhaseStatus, onEditProject }: ProjectListProps) {
  const draft = projects.filter(p => p.status === 'draft')
  const active = projects.filter(p => p.status === 'active')
  const completed = projects.filter(p => p.status === 'completed')
  const cancelled = projects.filter(p => p.status === 'cancelled')

  // Sort active projects: those with review phases first
  const sortedActive = [...active].sort((a, b) => {
    const aHasReview = a.phases.some(p => p.status === 'review')
    const bHasReview = b.phases.some(p => p.status === 'review')
    if (aHasReview && !bHasReview) return -1
    if (!aHasReview && bHasReview) return 1
    return 0
  })

  const renderProjectItem = (project: Project) => (
    <ProjectItem
      key={project.id}
      project={project}
      tasks={tasks}
      agents={agents}
      onUpdateProjectStatus={onUpdateProjectStatus}
      onUpdatePhaseStatus={onUpdatePhaseStatus}
      onEditProject={onEditProject}
    />
  )

  return (
    <div className="space-y-6">
      {sortedActive.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            Active
            <span className="text-gray-500">({sortedActive.length})</span>
          </h2>
          <div className="space-y-2">
            {sortedActive.map(renderProjectItem)}
          </div>
        </section>
      )}

      {draft.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
            Draft
            <span className="text-gray-500">({draft.length})</span>
          </h2>
          <div className="space-y-2">
            {draft.map(renderProjectItem)}
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
            {completed.map(renderProjectItem)}
          </div>
        </section>
      )}

      {cancelled.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            Cancelled
            <span className="text-gray-500">({cancelled.length})</span>
          </h2>
          <div className="space-y-2">
            {cancelled.map(renderProjectItem)}
          </div>
        </section>
      )}

      {projects.length === 0 && (
        <div className="py-12 text-center text-gray-500">
          No projects found.
        </div>
      )}
    </div>
  )
}
