import { useState } from 'react'
import type { Project, Task, Agent } from '../api'
import { Button } from '@/components/ui/button'
import { Markdown } from './Markdown'
import { TaskItem } from './TaskItem'

interface ProjectItemProps {
  project: Project
  tasks: Task[]
  agents: Agent[]
  isRunning?: boolean
  onUpdateProjectStatus: (id: string, status: 'active' | 'completed' | 'cancelled') => void
  onUpdatePhaseStatus: (projectId: string, phaseId: string, status: 'pending' | 'in_progress' | 'review' | 'done') => void
  onEditProject?: (project: Project) => void
  onRunReview?: (projectId: string) => void
  onToggleTask?: (id: string) => void
  onDismissTask?: (id: string) => void
  onStatusChangeTask?: (id: string, status: 'open' | 'review' | 'done' | 'dismissed') => void
  onRemarksTask?: (id: string, remarks: string) => void
  onTitleTask?: (id: string, title: string) => void
  onArchiveTask?: (id: string) => void
  onDeleteTask?: (id: string) => void
  onChatTask?: (taskId: string, agentId: string) => Promise<{ threadId: string; agentId: string } | null>
}

export function ProjectItem({ project, tasks, agents, isRunning, onUpdateProjectStatus, onUpdatePhaseStatus, onEditProject, onRunReview, onToggleTask, onDismissTask, onStatusChangeTask, onRemarksTask, onTitleTask, onArchiveTask, onDeleteTask, onChatTask }: ProjectItemProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set())

  const isDraft = project.status === 'draft'

  const getAgentName = (agentId: string) => {
    if (agentId === 'user') return 'You'
    const agent = agents.find(a => a.id === agentId)
    return agent?.name ?? agentId
  }

  const currentPhase = project.phases.find(p => p.status === 'review' || p.status === 'in_progress')
  const hasReviewPhases = project.phases.some(p => p.status === 'review')

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-500/10 text-gray-400'
      case 'active': return 'bg-blue-500/10 text-blue-400'
      case 'completed': return 'bg-emerald-500/10 text-emerald-400'
      case 'cancelled': return 'bg-red-500/10 text-red-400'
      default: return 'bg-gray-500/10 text-gray-400'
    }
  }

  const getPhaseStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-gray-500'
      case 'in_progress': return 'bg-blue-500'
      case 'review': return 'bg-amber-500'
      case 'done': return 'bg-emerald-500'
      default: return 'bg-gray-500'
    }
  }

  const togglePhase = (phaseId: string) => {
    const newExpanded = new Set(expandedPhases)
    if (newExpanded.has(phaseId)) {
      newExpanded.delete(phaseId)
    } else {
      newExpanded.add(phaseId)
    }
    setExpandedPhases(newExpanded)
  }

  const getTasksForPhase = (phaseId: string) => {
    return tasks.filter(t => t.projectId === project.id && t.phaseId === phaseId)
  }

  const isResolved = project.status === 'completed' || project.status === 'cancelled'

  return (
    <div
      className={`rounded-xl border border-white/5 bg-[#161b22] transition-all hover:border-white/10 hover:bg-[#1c2129] ${
        isResolved ? 'opacity-60' : ''
      } ${hasReviewPhases ? 'border-amber-500/30' : ''}`}
    >
      <div
        className="flex cursor-pointer items-center gap-4 px-4 py-3.5"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium leading-tight ${isResolved ? 'text-gray-400' : 'text-gray-100'}`}>
            {project.title}
          </p>
          {currentPhase && (
            <p className="mt-1 text-xs text-gray-500">
              {currentPhase.status === 'review' ? '⚠️ ' : ''}{currentPhase.title}
            </p>
          )}
        </div>

        <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${getStatusColor(project.status)}`}>
          {project.status}
        </span>

        <span className="text-xs text-gray-500">{getAgentName(project.lead)}</span>

        <svg
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isOpen && (
        <div className="border-t border-[#2d333b] px-4 pb-4 pt-3 space-y-4">
          <div className="rounded-lg bg-[#0d1117] px-3 py-2.5 text-sm text-[#c9d1d9]">
            {project.description ? <Markdown>{project.description}</Markdown> : <span className="text-gray-500 italic">No description</span>}
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
              Phases
            </label>
            <div className="space-y-2">
              {project.phases.map((phase) => {
                const phaseTasks = getTasksForPhase(phase.id)
                const isPhaseExpanded = expandedPhases.has(phase.id)

                return (
                  <div key={phase.id} className={`rounded-lg border ${phase.status === 'review' ? 'border-amber-500/30 bg-amber-500/5' : 'border-[#2d333b] bg-[#0d1117]'}`}>
                    <div
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                      onClick={() => togglePhase(phase.id)}
                    >
                      <span className={`h-2 w-2 rounded-full ${getPhaseStatusColor(phase.status)}`} />
                      <span className="flex-1 text-sm text-gray-200">{phase.title}</span>
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">{phase.status.replace('_', ' ')}</span>
                      {phaseTasks.length > 0 && (
                        <span className="text-[10px] text-gray-500">({phaseTasks.length} tasks)</span>
                      )}
                      <svg
                        className={`h-3 w-3 text-gray-500 transition-transform ${isPhaseExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>

                    {isPhaseExpanded && (
                      <div className="border-t border-[#2d333b] px-3 py-2 space-y-2">
                        <div className="text-xs text-gray-400 whitespace-pre-wrap">
                          <Markdown>{phase.description}</Markdown>
                        </div>

                        {phaseTasks.length > 0 && (
                          <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                            <p className="text-[10px] uppercase tracking-wide text-gray-500">Linked Tasks</p>
                            {phaseTasks.map(task => (
                              <TaskItem
                                key={task.id}
                                task={task}
                                assigneeName={getAgentName(task.assignee)}
                                creatorName={getAgentName(task.agentId)}
                                onToggle={onToggleTask ?? (() => {})}
                                onDismiss={onDismissTask ?? (() => {})}
                                onStatusChange={onStatusChangeTask}
                                onRemarks={onRemarksTask ?? (() => {})}
                                onTitle={onTitleTask ?? (() => {})}
                                onArchive={onArchiveTask ?? (() => {})}
                                onDelete={onDeleteTask ?? (() => {})}
                                onChat={onChatTask}
                              />
                            ))}
                          </div>
                        )}

                        {project.status === 'active' && (
                          <div className="mt-2 flex gap-2">
                            {phase.status === 'review' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onUpdatePhaseStatus(project.id, phase.id, 'done')
                                  }}
                                  className="text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                                >
                                  Approve
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onUpdatePhaseStatus(project.id, phase.id, 'in_progress')
                                  }}
                                  className="text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                >
                                  Request Changes
                                </Button>
                              </>
                            )}
                            {phase.status === 'in_progress' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onUpdatePhaseStatus(project.id, phase.id, 'done')
                                }}
                                className="text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                              >
                                Mark Complete
                              </Button>
                            )}
                            {phase.status === 'done' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onUpdatePhaseStatus(project.id, phase.id, 'in_progress')
                                }}
                                className="text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                              >
                                Reopen
                              </Button>
                            )}
                            {phase.status === 'pending' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onUpdatePhaseStatus(project.id, phase.id, 'in_progress')
                                }}
                                className="text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                              >
                                Start Phase
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {project.artifacts.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
                Artifacts
              </label>
              <div className="space-y-1">
                {project.artifacts.map((artifact, i) => (
                  <p key={i} className="text-xs text-gray-400 font-mono">{artifact}</p>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {project.status === 'draft' && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onUpdateProjectStatus(project.id, 'active')
                  }}
                  className="text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                >
                  Start Project
                </Button>
                {onEditProject && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditProject(project)
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                  >
                    Edit
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onUpdateProjectStatus(project.id, 'cancelled')
                  }}
                  className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  Cancel
                </Button>
              </>
            )}
            {project.status === 'active' && (
              <>
                {onRunReview && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isRunning}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRunReview(project.id)
                    }}
                    className={`text-xs ${
                      isRunning
                        ? 'text-gray-500 cursor-not-allowed'
                        : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                    }`}
                  >
                    {isRunning ? (
                      <span className="flex items-center gap-1.5">
                        <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Running...
                      </span>
                    ) : (
                      'Run Review'
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onUpdateProjectStatus(project.id, 'cancelled')
                  }}
                  className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  Cancel Project
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
