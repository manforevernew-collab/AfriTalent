import { supabase } from './supabase'

const EMPTY = { people: [], businesses: [], jobs: [] }

// Site-wide search: people (with ratings), businesses and jobs.
// Falls back to public tables if the search function isn't live yet.
export async function searchDirectory(q, limit = 5, types = ['people', 'businesses', 'jobs']) {
  const term = (q || '').trim()
  if (term.length < 2) return EMPTY
  const { data, error } = await supabase.rpc('search_directory', { p_q: term, p_limit: limit, p_types: types })
  if (!error && data) return { ...EMPTY, ...data }

  const like = `%${term.replace(/[%_\\]/g, m => `\\${m}`)}%`
  const [biz, jobs] = await Promise.all([
    types.includes('businesses')
      ? supabase.from('companies').select('id, name, category, city, country, logo_url, verified, rating, review_count').or(`name.ilike.${like},category.ilike.${like}`).limit(limit)
      : { data: [] },
    types.includes('jobs')
      ? supabase.from('jobs').select('id, title, company, location').eq('is_active', true).ilike('title', like).limit(limit)
      : { data: [] },
  ])
  return { people: [], businesses: biz.data || [], jobs: jobs.data || [], fallback: true }
}
