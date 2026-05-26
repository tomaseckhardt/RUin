import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  ''

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Chybí VITE_SUPABASE_URL nebo VITE_SUPABASE_ANON_KEY (případně VITE_SUPABASE_PUBLISHABLE_KEY).',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})
