import { useState, useEffect, useCallback } from 'react'
import { api, Professional } from '../lib/api'
import { IconStar, IconPlus, IconEdit, IconTrash, IconClose } from '../components/Icon'

const PRESET_COLORS = ['#7C3D6E', '#2D6E7C', '#2D7C3D', '#7C6E2D', '#6E2D7C', '#2D3D7C']

type ProfForm = Omit<Professional, 'id'>

function computeInitials(name: string): string {
  return name
    .split(' ')
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar
          key={i}
          className={`w-3.5 h-3.5 ${i <= Math.round(rating) ? 'text-amber-400' : 'text-gray-200'}`}
        />
      ))}
      <span className="text-xs text-gray-500 ml-1 font-medium">{rating.toFixed(1)}</span>
    </div>
  )
}

function ProfessionalModal({
  professional,
  onSave,
  onClose,
}: {
  professional: Professional | null
  onSave: (data: ProfForm) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<ProfForm>(
    professional
      ? { ...professional }
      : {
          name: '',
          specialty: '',
          initials: '',
          color: '#7C3D6E',
          rating: 5.0,
          appointments_count: 0,
          services_count: 0,
          active: true,
        },
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleNameChange(name: string) {
    setForm((f) => ({
      ...f,
      name,
      initials: f.initials || computeInitials(name),
    }))
  }

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
            {professional ? 'Editar Profissional' : 'Novo Profissional'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Preview avatar */}
          <div className="flex justify-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-md"
              style={{ background: form.color }}
            >
              {form.initials || '??'}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome completo</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ex: Dra. Sofia Mendes"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Especialidade</label>
              <input
                className="input"
                value={form.specialty}
                onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
                placeholder="Ex: Dermatologista"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Iniciais (avatar)</label>
              <input
                className="input"
                value={form.initials}
                onChange={(e) =>
                  setForm((f) => ({ ...f, initials: e.target.value.toUpperCase().slice(0, 3) }))
                }
                maxLength={3}
                placeholder="SM"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-2">Cor do avatar</label>
            <div className="flex gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, color }))}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110 focus:outline-none"
                  style={{
                    background: color,
                    outline: form.color === color ? `2px solid ${color}` : 'none',
                    outlineOffset: '2px',
                  }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Avaliação (1–5)</label>
            <input
              type="number"
              className="input"
              value={form.rating}
              min={1}
              max={5}
              step={0.1}
              onChange={(e) => setForm((f) => ({ ...f, rating: Number(e.target.value) }))}
            />
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

export function Profissionais() {
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ open: boolean; professional: Professional | null }>({
    open: false,
    professional: null,
  })

  const loadProfessionals = useCallback(async () => {
    try {
      const data = await api.getProfessionals()
      setProfessionals(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProfessionals() }, [loadProfessionals])

  function openCreate() {
    setModal({ open: true, professional: null })
  }

  function openEdit(prof: Professional) {
    setModal({ open: true, professional: prof })
  }

  function closeModal() {
    setModal({ open: false, professional: null })
  }

  async function handleDelete(id: number) {
    if (!confirm('Remover este profissional?')) return
    await api.deleteProfessional(id)
    loadProfessionals()
  }

  async function handleSave(data: ProfForm) {
    if (modal.professional) {
      await api.updateProfessional(modal.professional.id, data)
    } else {
      await api.createProfessional(data)
    }
    await loadProfessionals()
  }

  return (
    <div className="space-y-5 animate-fade-in pb-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profissionais</h1>
          <p className="text-sm text-gray-400 mt-0.5">Equipe da clínica</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-1.5">
          <IconPlus className="w-4 h-4" />
          Novo Profissional
        </button>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card min-h-[200px]">
              <div className="skeleton h-16 w-16 rounded-full mx-auto mb-3" />
              <div className="skeleton h-4 w-32 mx-auto mb-2" />
              <div className="skeleton h-3 w-24 mx-auto" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 stagger">
          {professionals.map((prof) => (
            <div
              key={prof.id}
              className="card group relative hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
            >
              <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <button
                  onClick={() => openEdit(prof)}
                  className="p-1.5 text-gray-300 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                >
                  <IconEdit className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(prof.id)}
                  className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex flex-col items-center text-center pt-2 pb-1">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold mb-3 shadow-md transition-transform duration-200 group-hover:scale-105"
                  style={{ background: prof.color }}
                >
                  {prof.initials}
                </div>
                <p className="font-semibold text-gray-900 text-sm">{prof.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 mb-2">{prof.specialty}</p>
                <Stars rating={prof.rating} />
              </div>

              <div className="flex justify-around border-t border-gray-50 mt-4 pt-4">
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">{prof.appointments_count}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Atendimentos</p>
                </div>
                <div className="w-px bg-gray-100" />
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">{prof.services_count}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Serviços</p>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={openCreate}
            className="card border-dashed border-2 border-gray-200 flex flex-col items-center justify-center gap-2 min-h-[200px] hover:border-primary/40 hover:bg-primary/3 transition-all duration-200 group"
          >
            <div className="w-10 h-10 rounded-full border-2 border-dashed border-gray-300 group-hover:border-primary/50 flex items-center justify-center transition-colors">
              <IconPlus className="w-5 h-5 text-gray-400 group-hover:text-primary/60 transition-colors" />
            </div>
            <p className="text-sm text-gray-400 group-hover:text-gray-600 transition-colors">
              Adicionar profissional
            </p>
          </button>
        </div>
      )}

      {modal.open && (
        <ProfessionalModal
          professional={modal.professional}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  )
}
