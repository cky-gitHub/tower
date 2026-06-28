import { memo, useState, useEffect } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import type { AgentSession } from './bridge'

export const STATUS_COLOR: Record<string, string> = {
  running: '#22c55e',
  blocked: '#eab308',
  done: '#3b82f6',
  errored: '#ef4444',
  stopped: '#6b7280',
}

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function ElapsedClock({ createdAt, active }: { createdAt: number; active: boolean }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return <span>{elapsed(now - createdAt)}</span>
}

function AgentNode({ data, selected }: NodeProps<AgentSession>) {
  const color = STATUS_COLOR[data.status] ?? '#6b7280'
  const isRunning = data.status === 'running'

  return (
    <div
      className={`agent-node${isRunning ? ' agent-node--running' : ''}${selected ? ' agent-node--selected' : ''}`}
      style={{ '--glow': color, borderColor: color } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Top} style={{ background: color, border: 'none' }} />

      {/* Status dot + title */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color, boxShadow: isRunning ? `0 0 6px ${color}` : undefined }}
        />
        <span className="text-xs font-semibold truncate flex-1 leading-tight">{data.title}</span>
      </div>

      {/* Last message preview */}
      {data.lastMessage && (
        <p className="text-[10px] text-gray-400 truncate leading-snug mb-2">{data.lastMessage}</p>
      )}

      {/* Footer: status · provider · time */}
      <div className="flex items-center justify-between gap-1">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ color, border: `1px solid ${color}40`, background: `${color}10` }}
        >
          {data.status}
        </span>
        <span className="text-[10px] text-gray-600 capitalize">{data.provider}</span>
        <span className="text-[10px] text-gray-600">
          <ElapsedClock createdAt={data.createdAt} active={isRunning} />
        </span>
      </div>

      {data.acuConsumed != null && data.acuConsumed > 0 && (
        <p className="text-[10px] text-gray-700 mt-1">{data.acuConsumed} ACU</p>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: color, border: 'none' }} />
    </div>
  )
}

export default memo(AgentNode)
