import { useState, useEffect } from 'react'
import { api, ClinicConfig } from '../lib/api'

const EMPTY_CONFIG: ClinicConfig = {
  name: '',
  segment: '',
  address: '',
  phone: '',
  hours: '',
  timezone: '',
  agent_name: '',
}

export function Configuracoes() {
  const [form, setForm] = useState<ClinicConfig>(EMPTY_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => setForm(cfg))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.updateConfig(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  function field(key: keyof ClinicConfig) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    }
  }

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in pb-8 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        </div>
        <div className="card space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in pb-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="text-sm text-gray-400 mt-0.5">Configurações da clínica e do agente</p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        <div className="card space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Clínica</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nome</label>
                <input className="input" {...field('name')} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Segmento</label>
                <input className="input" {...field('segment')} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Endereço</label>
                <input className="input" {...field('address')} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Telefone</label>
                <input className="input" placeholder="+55 11 99999-9999" {...field('phone')} />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Agente {form.agent_name && `"${form.agent_name}"`}
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nome do agente</label>
                <input className="input" placeholder="Ex: Lara" {...field('agent_name')} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Horário de atendimento</label>
                <input
                  className="input"
                  placeholder="Ex: segunda a sábado, das 9h às 19h"
                  {...field('hours')}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Fuso horário</label>
                <input
                  className="input"
                  placeholder="Ex: America/Sao_Paulo"
                  {...field('timezone')}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            <div className="text-sm">
              {error && <span className="text-red-500">{error}</span>}
              {saved && <span className="text-emerald-600 font-medium">✓ Salvo com sucesso</span>}
            </div>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
