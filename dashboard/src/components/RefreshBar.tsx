import { useEffect, useState } from 'react'
import { IconRefresh } from './Icon'

interface Props {
  refetch: () => void
  lastUpdated: Date | null
  loading: boolean
}

export function RefreshBar({ refetch, lastUpdated, loading }: Props) {
  const [label, setLabel] = useState('')

  useEffect(() => {
    if (!lastUpdated) return
    const update = () => {
      const secs = Math.round((Date.now() - lastUpdated.getTime()) / 1000)
      if (secs < 5)   setLabel('agora mesmo')
      else if (secs < 60) setLabel(`há ${secs}s`)
      else setLabel(`há ${Math.round(secs / 60)}min`)
    }
    update()
    const id = setInterval(update, 5_000)
    return () => clearInterval(id)
  }, [lastUpdated])

  return (
    <button
      onClick={refetch}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
      title="Atualizar dados"
    >
      <span className={loading ? 'animate-spin' : ''}>
        <IconRefresh className="w-3.5 h-3.5" />
      </span>
      {label && <span className="hidden sm:inline">Atualizado {label}</span>}
    </button>
  )
}
