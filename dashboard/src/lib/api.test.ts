/**
 * Checagem da regra de follow-up — a promessa do produto é que ninguém some,
 * e é esta função que decide quem entra na fila. Roda sem framework:
 *
 *   node --test src/lib/api.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { followUpBucket, STALE_DAYS, type Lead, type MotivoPerda } from './api.ts'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function lead(over: Partial<Lead> = {}): Lead {
  return {
    phone: '5511900000000@s.whatsapp.net',
    nome: 'Fulano',
    status: 'qualificado',
    motivo_perda: '',
    motivo_perda_detalhe: '',
    qualified: true,
    created_at: daysAgo(30),
    last_contact: daysAgo(30),
    ...over,
  }
}

test('lead recente ainda não entra na fila', () => {
  assert.equal(followUpBucket(lead({ last_contact: daysAgo(STALE_DAYS - 1) })), null)
})

test('faixas por dias parados', () => {
  assert.equal(followUpBucket(lead({ last_contact: daysAgo(STALE_DAYS) })), 'quente')
  assert.equal(followUpBucket(lead({ last_contact: daysAgo(7) })),  'quente')
  assert.equal(followUpBucket(lead({ last_contact: daysAgo(8) })),  'esfriando')
  assert.equal(followUpBucket(lead({ last_contact: daysAgo(20) })), 'esfriando')
  assert.equal(followUpBucket(lead({ last_contact: daysAgo(21) })), 'frio')
})

test('cliente fechado sai da fila, por mais parado que esteja', () => {
  assert.equal(followUpBucket(lead({ status: 'cliente', last_contact: daysAgo(90) })), null)
})

test('perdido por silêncio volta para a fila; perdido com motivo real, não', () => {
  const perdido = (motivo: MotivoPerda) =>
    followUpBucket(lead({ status: 'perdido', motivo_perda: motivo, last_contact: daysAgo(40) }))

  assert.equal(perdido('sem_resposta'), 'sem_resposta')
  assert.equal(perdido('fora_area_atuacao'), null)
  assert.equal(perdido('buscou_outro_escritorio'), null)
})

test('lead sem contato registrado não quebra nem entra na fila', () => {
  assert.equal(followUpBucket(lead({ last_contact: null })), null)
  assert.equal(followUpBucket(lead({ last_contact: 'data-invalida' })), null)
})
