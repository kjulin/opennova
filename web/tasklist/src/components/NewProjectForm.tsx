import { useState } from 'react'
import type { Agent } from '../api'
import { Button } from '@/components/ui/button'

interface Phase {
  title: string
  description: string
}

interface NewProjectFormProps {
  agents: Agent[]
  onAdd: (data: { title: string; description: string; lead: string; phases: Phase[] }) => void
  onCancel: () => void
}

export function NewProjectForm({ agents, onAdd, onCancel }: NewProjectFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [lead, setLead] = useState('')
  const [phases, setPhases] = useState<Phase[]>([{ title: '', description: '' }])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !lead) return

    const validPhases = phases.filter(p => p.title.trim())
    if (validPhases.length === 0) return

    onAdd({
      title: title.trim(),
      description: description.trim(),
      lead,
      phases: validPhases.map(p => ({
        title: p.title.trim(),
        description: p.description.trim(),
      })),
    })
  }

  const addPhase = () => {
    setPhases([...phases, { title: '', description: '' }])
  }

  const removePhase = (index: number) => {
    if (phases.length > 1) {
      setPhases(phases.filter((_, i) => i !== index))
    }
  }

  const updatePhase = (index: number, field: 'title' | 'description', value: string) => {
    const newPhases = [...phases]
    newPhases[index] = { ...newPhases[index]!, [field]: value }
    setPhases(newPhases)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-white/10 bg-[#161b22] p-4 space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
          Project Title
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          placeholder="Enter project title..."
          required
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
          Description
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="w-full rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500 resize-none"
          rows={2}
          placeholder="What is this project about?"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
          Project Lead
        </label>
        <select
          value={lead}
          onChange={e => setLead(e.target.value)}
          className="w-full rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          required
        >
          <option value="">Select lead agent...</option>
          {agents.map(agent => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium uppercase tracking-wider text-[#8b949e]">
            Phases
          </label>
          <button
            type="button"
            onClick={addPhase}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + Add Phase
          </button>
        </div>
        <div className="space-y-3">
          {phases.map((phase, index) => (
            <div key={index} className="rounded-lg bg-[#0d1117] border border-[#30363d] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-6">{index + 1}.</span>
                <input
                  type="text"
                  value={phase.title}
                  onChange={e => updatePhase(index, 'title', e.target.value)}
                  className="flex-1 bg-transparent text-sm text-gray-100 focus:outline-none"
                  placeholder="Phase title..."
                />
                {phases.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePhase(index)}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <input
                type="text"
                value={phase.description}
                onChange={e => updatePhase(index, 'description', e.target.value)}
                className="w-full bg-transparent text-xs text-gray-400 focus:outline-none pl-6"
                placeholder="Phase description..."
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-300"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white"
          disabled={!title.trim() || !lead || !phases.some(p => p.title.trim())}
        >
          Create Project
        </Button>
      </div>
    </form>
  )
}
