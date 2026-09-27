import { noteAuthCallback, pendingAuthRedirect } from '~/utils/postAuthRedirect'

export default defineNuxtPlugin({
  name: 'post-auth-redirect',
  enforce: 'pre',
  order: -30,
  setup(nuxtApp) {
    noteAuthCallback(window.location.search, window.location.hash)

    nuxtApp.hook('app:mounted', () => {
      const destination = pendingAuthRedirect(window.location.pathname)
      if (!destination) return

      const supabase = useSupabaseClient()
      const started = Date.now()
      const finish = async () => {
        while (Date.now() - started < 4000) {
          const { data } = await supabase.auth.getSession()
          if (data.session) {
            window.location.replace(destination)
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 40))
        }
        globalThis.sessionStorage.removeItem('struct-post-auth')
      }
      void finish()
    })
  },
})
