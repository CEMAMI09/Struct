export type ColorMode = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'struct-theme'

export function useTheme() {
  const themeCookie = useCookie<ColorMode | null>(THEME_STORAGE_KEY, {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    path: '/',
    default: () => null,
  })

  const mode = useState<ColorMode>(THEME_STORAGE_KEY, () =>
    themeCookie.value === 'light' ? 'light' : 'dark',
  )

  function setMode(next: ColorMode) {
    mode.value = next
    themeCookie.value = next
    if (!import.meta.client) return
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* ignore quota or private mode */
    }
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', next === 'light' ? '#f5f6f8' : '#5617fc')
  }

  return { mode, setMode }
}
