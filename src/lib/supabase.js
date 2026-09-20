import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://cqimpmvaobrnpejokuvx.supabase.co'

const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_tAoik_yGhIhp3VCE2qnf4g_GAviUG_B'

export const supabase = createClient(supabaseUrl, supabaseKey)
