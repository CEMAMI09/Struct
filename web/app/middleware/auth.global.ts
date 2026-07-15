export default defineNuxtRouteMiddleware(async (to) => {
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()
  const publicRoutes = ['/', '/login', '/signup', '/confirm']
  const isPublic = publicRoutes.some((r) => to.path === r || to.path.startsWith(r + '/'))

  // Prefer reactive user; fall back to session so post-login navigations don't bounce
  let loggedIn = !!user.value
  if (!loggedIn) {
    const { data } = await supabase.auth.getSession()
    loggedIn = !!data.session?.user
  }

  if (!loggedIn && !isPublic) {
    return navigateTo('/login')
  }

  if (loggedIn && (to.path === '/login' || to.path === '/signup')) {
    return navigateTo('/dashboard')
  }

  // Logged-in users may still visit the marketing landing at /
})
