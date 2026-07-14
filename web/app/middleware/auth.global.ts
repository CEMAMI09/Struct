export default defineNuxtRouteMiddleware(async (to) => {
  const user = useSupabaseUser()
  const publicRoutes = ['/login', '/signup', '/confirm']
  const isPublic = publicRoutes.some((r) => to.path === r || to.path.startsWith(r + '/'))

  if (!user.value && !isPublic) {
    return navigateTo('/login')
  }

  if (user.value && (to.path === '/login' || to.path === '/signup')) {
    return navigateTo('/dashboard')
  }

  if (user.value && to.path === '/') {
    return navigateTo('/dashboard')
  }
})
