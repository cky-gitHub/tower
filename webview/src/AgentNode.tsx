import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import type { AgentSession } from './bridge'

const STATUS_COLOR: Record<string, string> = {
  running: '#22c55e',
  blocked: '#eab308',
  done: '#3b82f6',
  errored: '#ef4444',
  stopped: '#6b7280',
}

function AgentNode({ data, selected }: NodeProps<AgentSession>) {
  const color = STATUS_COLOR[data.status] ?? '#6b7280'
  const isRunning = data.status === 'running'

  return (
    <div
      className={`agent-node${isRunning ? ' agent-node--running' : ''}${selected ? ' agent-node--selected' : ''}`}
      style={
        {
          '--glow': color,
          borderColor: color,
        } as React.CSSProperties
      }
    >
      <Handle type="target" position={Position.Top} style={{ background: color, border: 'none' }} />

      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-semibold truncate flex-1 leading-tight">{data.title}</span>
      </div>

      {data.lastMessage && (
        <p className="text-[10px] text-gray-400 truncate leading-snug mb-1">{data.lastMessage}</p>
      )}

      <div className="flex items-center justify-between mt-0.5">
        <span
          className="text-[10px] px-1 py-0.5 rounded"
          style={{ color, border: `1px solid ${color}50` }}
        >
          {data.status}
        </span>
        <span className="text-[10px] text-gray-600 capitalize">{data.provider}</span>
        {data.acuConsumed != null && (
          <span className="text-[10px] text-gray-600">{data.acuConsumed} ACU</span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: color, border: 'none' }} />
    </div>
  )
}

export default memo(AgentNode)
