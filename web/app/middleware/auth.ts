export default defineNuxtRouteMiddleware(async () => {
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  let loggedIn = !!user.value
  if (!loggedIn) {
    const { data } = await supabase.auth.getSession()
    loggedIn = !!data.session?.user
  }

  if (!loggedIn) {
    return navigateTo('/login')
  }
})
