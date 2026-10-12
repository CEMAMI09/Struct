import { noteAuthCallback, pendingAuthRedirect } from '~/utils/postAuthRedirect'

export default defineNuxtPlugin({
  name: 'post-auth-redirect',
  enforce: 'pre',
  order: -30,
  setup(nuxtApp) {
    noteAuthCallback(window.location.search, window.location.hash)
    const transition=useState('auth-return-pending',()=>false)
    transition.value=window.location.pathname!=='/confirm'&&!!pendingAuthRedirect(window.location.pathname)

    nuxtApp.hook('app:mounted', () => {
      if(window.location.pathname==='/confirm')return
      const destination = pendingAuthRedirect(window.location.pathname)
      if (!destination) return

      const supabase = useSupabaseClient()
      const started = Date.now()
      const finish = async () => {
        while (Date.now() - started < 4000) {
          const { data } = await supabase.auth.getSession()
          if (data.session) {
            await navigateTo(destination,{replace:true})
            transition.value=false
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 40))
        }
        globalThis.sessionStorage.removeItem('struct-post-auth')
        transition.value=false
      }
      void finish()
    })
  },
})
