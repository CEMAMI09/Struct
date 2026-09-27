import { THEME_STORAGE_KEY, type ColorMode } from '~/composables/useTheme'

function readStoredTheme(): ColorMode | null {
  try {
    const match = document.cookie.match(/(?:^|; )struct-theme=(dark|light)/)
    if (match?.[1] === 'light' || match?.[1] === 'dark') return match[1]
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* ignore */
  }
  return null
}

export default defineNuxtPlugin(() => {
  const { mode, setMode } = useTheme()
  if (!import.meta.client) return
  const stored = readStoredTheme()
  if (stored && stored !== mode.value) setMode(stored)
  else document.documentElement.dataset.theme = mode.value
})
