import type { H3Event } from 'h3'
import { serverSupabaseClient } from '#supabase/server'

export async function requireOrgWriter(event: H3Event, orgId: string) {
  const supabase = await serverSupabaseClient(event)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    throw createError({ statusCode: 401, message: 'Not authenticated' })
  }

  const { data: membership, error: memberError } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (memberError) {
    throw createError({ statusCode: 500, message: memberError.message })
  }

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw createError({
      statusCode: 403,
      message: 'Viewers can only read — ask an org admin to make changes',
    })
  }

  return { supabase, user }
}
