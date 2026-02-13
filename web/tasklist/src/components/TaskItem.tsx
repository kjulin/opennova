import { useState, useRef, useEffect } from 'react'
import type { Task } from '../api'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Markdown } from './Markdown'

interface TaskItemProps {
  task: Task
  assigneeName: string
  creatorName: string
  onToggle: (id: string) => void
  onDismiss: (id: string) => void
  onStatusChange?: (id: string, status: 'open' | 'review' | 'done' | 'dismissed') => void
  onRemarks: (id: string, remarks: string) => void
  onTitle: (id: string, title: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
}

export function TaskItem({ task, assigneeName, creatorName, onToggle, onDismiss, onStatusChange, onRemarks, onTitle, onArchive, onDelete }: TaskItemProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [remarks, setRemarks] = useState(task.remarks ?? '')
  const [title, setTitle] = useState(task.title)
  const [isEditingRemarks, setIsEditingRemarks] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const remarksRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditingRemarks && remarksRef.current) {
      const textarea = remarksRef.current
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }
  }, [isEditingRemarks])

  useEffect(() => {
    if (isEditingTitle && titleRef.current) {
      titleRef.current.focus()
      titleRef.current.select()
    }
  }, [isEditingTitle])

  useEffect(() => {
    setRemarks(task.remarks ?? '')
  }, [task.remarks])

  useEffect(() => {
    setTitle(task.title)
  }, [task.title])

  const isCompleted = task.status === 'done'
  const isDismissed = task.status === 'dismissed'
  const isInProgress = task.status === 'in_progress'
  const isReview = task.status === 'review'
  const isFailed = task.status === 'failed'
  const isResolved = isCompleted || isDismissed || isFailed

  const saveTitle = () => {
    const trimmed = title.trim()
    if (trimmed && trimmed !== task.title) {
      onTitle(task.id, trimmed)
    } else {
      setTitle(task.title)
    }
    setIsEditingTitle(false)
  }

  return (
    <div
      className={`rounded-xl border border-white/5 bg-[#161b22] transition-all hover:border-white/10 hover:bg-[#1c2129] ${
        isResolved ? 'opacity-60' : ''
      }`}
    >
      <div
        className="flex cursor-pointer items-center gap-4 px-4 py-3.5"
        onClick={() => !isEditingTitle && setIsOpen(!isOpen)}
      >
        <div onClick={e => e.stopPropagation()} className="flex items-center">
          <Checkbox
            checked={isCompleted}
            disabled={isDismissed || isInProgress || isReview || isFailed}
            onCheckedChange={() => onToggle(task.id)}
            className="h-5 w-5 rounded-md border-gray-600 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500 disabled:opacity-40"
          />
        </div>

        <div className="min-w-0 flex-1">
          {isEditingTitle ? (
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onClick={e => e.stopPropagation()}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  saveTitle()
                } else if (e.key === 'Escape') {
                  setTitle(task.title)
                  setIsEditingTitle(false)
                }
              }}
              className="w-full bg-transparent text-sm font-medium text-gray-100 border-b border-blue-500 outline-none py-0.5"
            />
          ) : (
            <p
              onDoubleClick={e => {
                e.stopPropagation()
                setIsEditingTitle(true)
              }}
              className={`text-sm font-medium leading-tight ${
                isCompleted
                  ? 'text-gray-400 line-through'
                  : isDismissed || isFailed
                    ? 'text-gray-500 line-through'
                    : 'text-gray-100'
              }`}
              title="Double-click to edit"
            >
              {task.title}
            </p>
          )}
        </div>

        {isInProgress && (
          <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-400">
            In Progress
          </span>
        )}

        {isReview && (
          <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400">
            Review
          </span>
        )}

        {isFailed && (
          <span className="rounded-md bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-orange-400">
            Failed
          </span>
        )}

        {isDismissed && (
          <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-400">
            Dismissed
          </span>
        )}

        <span className="text-xs text-gray-500">{assigneeName}</span>

        {isCompleted && (
          <button
            onClick={e => {
              e.stopPropagation()
              onArchive(task.id)
            }}
            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-500/10 transition-colors"
          >
            Archive
          </button>
        )}

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
            From {creatorName}
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
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b949e]">
              Remarks
            </label>
            {isEditingRemarks ? (
              <textarea
                ref={remarksRef}
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                onClick={e => e.stopPropagation()}
                onBlur={() => {
                  if (remarks !== (task.remarks ?? '')) {
                    onRemarks(task.id, remarks)
                  }
                  setIsEditingRemarks(false)
                }}
                className="w-full rounded-lg bg-[#0d1117] border border-blue-500 px-3 py-2.5 text-sm leading-relaxed text-[#c9d1d9] focus:outline-none resize-none"
                rows={3}
                placeholder="Add remarks..."
              />
            ) : (
              <div
                onClick={e => {
                  e.stopPropagation()
                  setIsEditingRemarks(true)
                }}
                className="rounded-lg bg-[#0d1117] px-3 py-2.5 text-sm text-[#c9d1d9] cursor-pointer border border-transparent hover:border-[#30363d] min-h-[2.5rem]"
              >
                {task.remarks ? <Markdown>{task.remarks}</Markdown> : <span className="text-gray-500 italic">Click to add remarks...</span>}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            {task.threadId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={e => {
                  e.stopPropagation()
                  const data = JSON.stringify({
                    action: 'chat',
                    agentId: task.assignee,
                    threadId: task.threadId,
                    taskTitle: task.title
                  })
                  window.Telegram?.WebApp?.sendData(data)
                }}
                className="mt-1 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
              >
                Chat about this
              </Button>
            )}
            {isReview && onStatusChange && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={e => {
                    e.stopPropagation()
                    onStatusChange(task.id, 'done')
                  }}
                  className="mt-1 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                >
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={e => {
                    e.stopPropagation()
                    onStatusChange(task.id, 'open')
                  }}
                  className="mt-1 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                >
                  Request Changes
                </Button>
              </>
            )}
            {task.status === 'open' && onStatusChange && (
              <Button
                variant="ghost"
                size="sm"
                onClick={e => {
                  e.stopPropagation()
                  onStatusChange(task.id, 'review')
                }}
                className="mt-1 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
              >
                Mark for Review
              </Button>
            )}
            {!isCompleted && !isReview && (
              <Button
                variant="ghost"
                size="sm"
                onClick={e => {
                  e.stopPropagation()
                  onDismiss(task.id)
                }}
                className={`mt-1 text-xs ${
                  isDismissed
                    ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10'
                    : 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
                }`}
              >
                {isDismissed ? 'Restore task' : 'Dismiss task'}
              </Button>
            )}
            {isCompleted && (
              <Button
                variant="ghost"
                size="sm"
                onClick={e => {
                  e.stopPropagation()
                  onArchive(task.id)
                }}
                className="mt-1 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-500/10"
              >
                Archive
              </Button>
            )}
            {confirmDelete ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={e => {
                    e.stopPropagation()
                    setConfirmDelete(false)
                  }}
                  className="mt-1 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-500/10"
                >
                  Cancel
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={e => {
                    e.stopPropagation()
                    onDelete(task.id)
                  }}
                  className="mt-1 text-xs text-red-500 hover:text-red-400 hover:bg-red-500/10"
                >
                  Confirm delete
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={e => {
                  e.stopPropagation()
                  setConfirmDelete(true)
                }}
                className="mt-1 text-xs text-gray-500 hover:text-gray-400 hover:bg-gray-500/10"
              >
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
