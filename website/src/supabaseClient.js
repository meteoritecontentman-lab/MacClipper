import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://ccnuqjmqmylergzatpua.supabase.co'
const supabaseKey = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Rdcitk793uU54mzZFlwc-g_Gndh-orm'
export const supabaseURL = supabaseUrl
export const supabasePublishableKey = supabaseKey
export const supabase = createClient(supabaseUrl, supabaseKey, {
	auth: {
		detectSessionInUrl: true,
		flowType: 'pkce',
		persistSession: true,
		storage: window.localStorage
	}
})