import { useState } from 'react'
import type { ArchivedTask, Agent } from '../api'
import { Markdown } from './Markdown'

interface ArchivedTaskListProps {
  tasks: ArchivedTask[]
  agents: Agent[]
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function ArchivedTaskItem({ task, assigneeName, creatorName }: { task: ArchivedTask; assigneeName: string; creatorName: string }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="rounded-xl border border-white/5 bg-[#161b22] opacity-60">
      <div
        className="flex cursor-pointer items-center gap-4 px-4 py-3.5"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="h-5 w-5 flex items-center justify-center text-gray-500">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight text-gray-400 line-through">
            {task.title}
          </p>
        </div>

        <span className="text-xs text-gray-500">{relativeTime(task.archivedAt)}</span>

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
        <div className="border-t border-[#2d333b] px-4 pb-4 pt-3 space-y-3">
          <p className="text-xs text-gray-500">
            From {creatorName} · Assigned to {assigneeName}
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
              Rationale
            </label>
            <div className="rounded-lg bg-[#0d1117] px-3 py-2.5 text-sm text-[#c9d1d9]">
              <Markdown>{task.rationale}</Markdown>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
              Instructions
            </label>
            <div className="rounded-lg bg-[#0d1117] px-3 py-2.5 text-sm text-[#c9d1d9]">
              <Markdown>{task.instructions}</Markdown>
            </div>
          </div>
          {task.remarks && (
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
                Remarks
              </label>
              <div className="rounded-lg bg-[#0d1117] px-3 py-2.5 text-sm text-[#c9d1d9]">
                <Markdown>{task.remarks}</Markdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ArchivedTaskList({ tasks, agents }: ArchivedTaskListProps) {
  const getAgentName = (agentId: string) => {
    if (agentId === 'user') return 'You'
    const agent = agents.find(a => a.id === agentId)
    return agent?.name ?? agentId
  }

  if (tasks.length === 0) {
    return (
      <div className="py-12 text-center text-gray-500">
        No archived tasks in the last 7 days.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {tasks.map(task => (
        <ArchivedTaskItem
          key={task.id}
          task={task}
          assigneeName={getAgentName(task.assignee)}
          creatorName={getAgentName(task.agentId)}
        />
      ))}
    </div>
  )
}
