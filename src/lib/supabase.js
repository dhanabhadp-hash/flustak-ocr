import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://iexjsequtqpfjwtrhpsv.supabase.co'
const SUPABASE_KEY = 'sb_publishable_XNTfO857VGR8p8ncJV6eYg_tZNActP2'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

export async function listBatches() {
  const { data, error } = await sb
    .from('batches')
    .select('id, name, created_at, settings, image_thumb')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveBatch({ id, name, cells, settings, thumb }) {
  let batchId = id
  if (batchId) {
    const { error: e1 } = await sb
      .from('batches')
      .update({ name, settings, image_thumb: thumb ?? null })
      .eq('id', batchId)
    if (e1) throw e1
    const { error: e2 } = await sb.from('ledger_rows').delete().eq('batch_id', batchId)
    if (e2) throw e2
  } else {
    const { data, error } = await sb
      .from('batches')
      .insert({ name, settings, image_thumb: thumb ?? null })
      .select('id')
      .single()
    if (error) throw error
    batchId = data.id
  }
  const rows = cells.map((c, i) => ({ batch_id: batchId, row_no: i + 1, cells: c }))
  if (rows.length) {
    const { error } = await sb.from('ledger_rows').insert(rows)
    if (error) throw error
  }
  return batchId
}

export async function loadBatch(id) {
  const { data: b, error } = await sb.from('batches').select('*').eq('id', id).single()
  if (error) throw error
  const { data: rows, error: e2 } = await sb
    .from('ledger_rows')
    .select('row_no, cells')
    .eq('batch_id', id)
    .order('row_no')
  if (e2) throw e2
  return { batch: b, cells: (rows || []).map((r) => r.cells) }
}

export async function deleteBatch(id) {
  const { error } = await sb.from('batches').delete().eq('id', id)
  if (error) throw error
}
