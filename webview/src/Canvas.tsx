import { useEffect, useCallback, useMemo } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  NodeMouseHandler,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { AgentSession } from './bridge'
import AgentNode from './AgentNode'

const nodeTypes = { agent: AgentNode }

const STATUS_COLOR: Record<string, string> = {
  running: '#22c55e',
  blocked: '#eab308',
  done: '#3b82f6',
  errored: '#ef4444',
  stopped: '#6b7280',
}

const COLS = 4
const COL_W = 220
const ROW_H = 130

function buildEdges(sessions: AgentSession[]): Edge[] {
  return sessions
    .filter((s) => s.parentId)
    .map((s) => ({
      id: `${s.parentId}-${s.id}`,
      source: s.parentId as string,
      target: s.id,
      style: { stroke: '#3b82f6', strokeWidth: 1.5, strokeDasharray: '5 3' },
      animated: s.status === 'running',
    }))
}

interface Props {
  sessions: AgentSession[]
  selectedId: string | null
  onSelect: (id: string) => void
  onSpawn: () => void
}

export default function Canvas({ sessions, selectedId, onSelect, onSpawn }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentSession>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  useEffect(() => {
    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]))
      return sessions.map((s, i) => {
        const existing = prevMap.get(s.id)
        const position = existing?.position ?? {
          x: (i % COLS) * COL_W + 20,
          y: Math.floor(i / COLS) * ROW_H + 20,
        }
        return {
          id: s.id,
          type: 'agent',
          position,
          selected: s.id === selectedId,
          data: s,
        }
      })
    })
    setEdges(buildEdges(sessions))
  }, [sessions, selectedId, setNodes, setEdges])

  const onNodeClick: NodeMouseHandler = useCallback(
    (_e, node: Node<AgentSession>) => onSelect(node.id),
    [onSelect]
  )

  const minimapNodeColor = useCallback(
    (n: Node) => STATUS_COLOR[(n.data as AgentSession)?.status] ?? '#6b7280',
    []
  )

  const proOptions = useMemo(() => ({ hideAttribution: true }), [])

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        proOptions={proOptions}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={null}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="#1f2937"
          gap={24}
          size={1.5}
        />
        <Controls className="!bg-gray-900 !border-gray-700" />
        <MiniMap
          style={{
            background: '#0a0e1a',
            border: '1px solid #1f2937',
          }}
          nodeColor={minimapNodeColor}
          maskColor="rgba(10,14,26,0.7)"
        />
      </ReactFlow>

      {sessions.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
          <p className="text-5xl mb-3 opacity-20">◎</p>
          <p className="text-sm text-gray-600">No agents online.</p>
          <p className="text-xs text-gray-700 mt-1">Tap + to spawn one.</p>
        </div>
      )}

      <button
        onClick={onSpawn}
        className="absolute bottom-6 right-6 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-95 flex items-center justify-center text-2xl font-light shadow-xl transition-all z-10"
        title="Spawn new agent (⌘N)"
      >
        +
      </button>
    </div>
  )
}
