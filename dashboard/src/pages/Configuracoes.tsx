import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api, FirmConfig, Service } from '../lib/api'
import { Page, PageHeader, Reveal, Section, Skeleton } from '../components/Page'
import { springy } from '../lib/motion'
import { IconCheck, IconScale } from '../components/Icon'

const EMPTY_CONFIG: FirmConfig = {
  name: '', segment: '', address: '', phone: '', hours: '', timezone: '', agent_name: '',
}

export function Configuracoes() {
  const [form, setForm] = useState<FirmConfig>(EMPTY_CONFIG)
  const [areas, setAreas] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getConfig().then(setForm).catch(() => {}).finally(() => setLoading(false))
    api.getServices().then(setAreas).catch(() => {})
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

  function field(key: keyof FirmConfig) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    }
  }

  if (loading) {
    return (
      <Page className="max-w-3xl">
        <PageHeader title="Configurações" subtitle="Dados do escritório e do atendimento automático" />
        <div className="card space-y-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      </Page>
    )
  }

  const atuacao = areas.filter((a) => a.active && a.category === 'Áreas de atuação')

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Configurações" subtitle="Dados do escritório e do atendimento automático" />

      <form onSubmit={handleSave} className="space-y-4">
        <Section title="Escritório" subtitle="aparece no CRM e no contexto do agente">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Nome</label>
              <input className="input" {...field('name')} />
            </div>
            <div>
              <label className="label">Segmento</label>
              <input className="input" placeholder="Ex.: Escritório full service" {...field('segment')} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Endereço</label>
              <input className="input" {...field('address')} />
            </div>
            <div>
              <label className="label">Telefone</label>
              <input className="input" placeholder="+55 11 99999-9999" {...field('phone')} />
            </div>
          </div>
        </Section>

        <Section
          title={`Atendimento automático${form.agent_name ? ` — ${form.agent_name}` : ''}`}
          subtitle="quem recebe o primeiro contato no WhatsApp"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Nome do agente</label>
              <input className="input" placeholder="Ex.: Helena" {...field('agent_name')} />
            </div>
            <div>
              <label className="label">Horário de atendimento</label>
              <input className="input" placeholder="segunda a sexta, das 9h às 18h" {...field('hours')} />
            </div>
            <div>
              <label className="label">Fuso horário</label>
              <input className="input" placeholder="America/Sao_Paulo" {...field('timezone')} />
            </div>
          </div>
        </Section>

        <Reveal className="card sticky bottom-4 flex items-center justify-between gap-4 shadow-lift">
          <div className="text-sm min-h-[20px]">
            <AnimatePresence mode="wait">
              {error && (
                <motion.span
                  key="err"
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-red-600"
                >
                  {error}
                </motion.span>
              )}
              {saved && (
                <motion.span
                  key="ok"
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  transition={springy}
                  className="text-emerald-700 font-medium inline-flex items-center gap-1.5"
                >
                  <IconCheck className="w-4 h-4" /> Salvo
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </Reveal>
      </form>

      {/* Só leitura: as áreas vêm do tenant YAML, quem edita é quem cuida da config. */}
      {atuacao.length > 0 && (
        <Section title="Áreas de atuação" subtitle="o que o agente oferece na triagem" className="mt-4">
          <div className="flex flex-wrap gap-2">
            {atuacao.map((a, i) => (
              <motion.span
                key={a.id}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.04 * i, duration: 0.24 }}
                className="badge bg-primary/8 text-primary"
              >
                <IconScale className="w-3 h-3" />
                {a.name}
              </motion.span>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-line">
            Editadas em <code className="text-slate-500">tenants/juris.yaml</code>. Honorários nunca entram
            no CRM nem no contexto do agente — só são tratados na consulta com o advogado.
          </p>
        </Section>
      )}
    </Page>
  )
}
