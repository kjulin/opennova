import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Agent } from '../api'

interface NewTaskFormProps {
  agents: Agent[]
  onAdd: (task: { title: string; assignee: string; rationale: string; instructions: string }) => void
  onCancel: () => void
}

export function NewTaskForm({ agents, onAdd, onCancel }: NewTaskFormProps) {
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('user')
  const [rationale, setRationale] = useState('')
  const [instructions, setInstructions] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onAdd({ title: title.trim(), assignee, rationale: rationale.trim(), instructions: instructions.trim() })
  }

  const inputClass =
    'w-full rounded-lg border border-[#2d333b] bg-[#0d1117] px-3 py-2.5 text-sm text-[#c9d1d9] placeholder-gray-600 outline-none focus:border-blue-500 transition-colors'

  const assigneeOptions = [
    { id: 'user', name: 'You' },
    ...agents.map(a => ({ id: a.id, name: a.name }))
  ]

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-white/5 bg-[#161b22] p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-200">New Task</h3>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What needs to be done?"
          className={inputClass}
          autoFocus
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
          Assignee
        </label>
        <div className="relative">
          <select
            value={assignee}
            onChange={e => setAssignee(e.target.value)}
            className={`${inputClass} appearance-none pr-10 cursor-pointer`}
          >
            {assigneeOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.name}</option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b949e]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
          Rationale
        </label>
        <textarea
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          placeholder="Why is this task needed?"
          rows={2}
          className={`${inputClass} resize-none`}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
          Instructions
        </label>
        <textarea
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          placeholder="How should this be done?"
          rows={2}
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="submit"
          disabled={!title.trim()}
          className="bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          size="sm"
        >
          Add task
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-200"
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
