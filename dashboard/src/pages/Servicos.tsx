import { useState, useEffect, useCallback } from 'react'
import { api, Service } from '../lib/api'
import { IconPlus, IconEdit, IconTrash, IconChevronDown, IconClock, IconClose } from '../components/Icon'

const PRESET_CATEGORIES = ['Faciais & Limpeza', 'Rejuvenescimento', 'Laser & Luz']

interface ServiceForm {
  category: string
  name: string
  duration: number
  price: number
  active: boolean
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`toggle-track ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`}
    >
      <span className={`toggle-thumb ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

function ServiceModal({
  service,
  defaultCategory,
  onSave,
  onClose,
}: {
  service: Service | null
  defaultCategory: string
  onSave: (data: ServiceForm) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<ServiceForm>(
    service
      ? { category: service.category, name: service.name, duration: service.duration, price: service.price, active: service.active }
      : { category: defaultCategory, name: '', duration: 60, price: 0, active: true },
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {service ? 'Editar Serviço' : 'Novo Serviço'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Categoria</label>
            <input
              list="svc-categories"
              className="input"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Ex: Faciais & Limpeza"
              required
            />
            <datalist id="svc-categories">
              {PRESET_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome do Serviço</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Limpeza de pele profunda"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Duração (min)</label>
              <input
                type="number"
                className="input"
                value={form.duration}
                min={15}
                step={15}
                onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Preço (R$)</label>
              <input
                type="number"
                className="input"
                value={form.price}
                min={0}
                step={0.01}
                onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
                required
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Serviço ativo</span>
            <Toggle checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function Servicos() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [modal, setModal] = useState<{ open: boolean; service: Service | null; defaultCategory: string }>({
    open: false,
    service: null,
    defaultCategory: '',
  })

  const loadServices = useCallback(async () => {
    try {
      const data = await api.getServices()
      setServices(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadServices() }, [loadServices])

  const categories = [...new Set(services.map((s) => s.category))]

  function openCreate(defaultCategory = '') {
    setModal({ open: true, service: null, defaultCategory })
  }

  function openEdit(svc: Service) {
    setModal({ open: true, service: svc, defaultCategory: svc.category })
  }

  function closeModal() {
    setModal({ open: false, service: null, defaultCategory: '' })
  }

  async function handleToggleActive(svc: Service) {
    await api.updateService(svc.id, { active: !svc.active })
    loadServices()
  }

  async function handleDelete(id: number) {
    if (!confirm('Remover este serviço?')) return
    await api.deleteService(id)
    loadServices()
  }

  async function handleSave(data: ServiceForm) {
    if (modal.service) {
      await api.updateService(modal.service.id, data)
    } else {
      await api.createService(data)
    }
    await loadServices()
  }

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in pb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Serviços</h1>
            <p className="text-sm text-gray-400 mt-0.5">Gerencie os serviços oferecidos pela clínica</p>
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-5">
              <div className="skeleton h-4 w-40" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in pb-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Serviços</h1>
          <p className="text-sm text-gray-400 mt-0.5">Gerencie os serviços oferecidos pela clínica</p>
        </div>
        <button onClick={() => openCreate()} className="btn-primary flex items-center gap-1.5">
          <IconPlus className="w-4 h-4" />
          Novo Serviço
        </button>
      </div>

      <div className="space-y-3 stagger">
        {categories.map((cat) => {
          const catServices = services.filter((s) => s.category === cat)
          const activeCount = catServices.filter((s) => s.active).length
          const isOpen = !collapsed[cat]

          return (
            <div key={cat} className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                <button
                  onClick={() => setCollapsed((p) => ({ ...p, [cat]: !p[cat] }))}
                  className="flex items-center gap-2 text-left flex-1"
                >
                  <span className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}>
                    <IconChevronDown className="w-4 h-4" />
                  </span>
                  <span className="font-semibold text-gray-800">{cat}</span>
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 font-medium">
                    {catServices.length} serviço{catServices.length !== 1 ? 's' : ''}
                  </span>
                  <span className="badge bg-emerald-100 text-emerald-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse-soft" />
                    {activeCount} ativo{activeCount !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => openCreate(cat)}
                    className="btn-ghost py-1 px-2 text-xs"
                  >
                    + Serviço
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="divide-y divide-gray-50">
                  {catServices.map((svc) => (
                    <div
                      key={svc.id}
                      className="flex items-center justify-between px-5 py-3.5 hover:bg-surface-2 transition-colors duration-150 group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium transition-colors ${svc.active ? 'text-gray-800' : 'text-gray-400'}`}>
                          {svc.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-5 shrink-0">
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <IconClock className="w-3.5 h-3.5" />
                          {svc.duration} min
                        </div>
                        <span className="text-xs text-gray-500 font-medium w-24 text-right">
                          R$ {svc.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                        <span className={`badge ${svc.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                          {svc.active ? '● Ativo' : '○ Inativo'}
                        </span>
                        <Toggle checked={svc.active} onChange={() => handleToggleActive(svc)} />
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button
                            onClick={() => openEdit(svc)}
                            className="p-1.5 text-gray-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                          >
                            <IconEdit />
                          </button>
                          <button
                            onClick={() => handleDelete(svc.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <IconTrash />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-400 text-center pt-2">
        Os serviços ativos são compartilhados com o agente Lara automaticamente.
      </p>

      {modal.open && (
        <ServiceModal
          service={modal.service}
          defaultCategory={modal.defaultCategory}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  )
}
