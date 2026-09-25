export function useDialogFocus(options?: { onEscape?: () => void }) {
  const dialogEl = ref<HTMLElement | null>(null)
  let previous: HTMLElement | null = null

  function focusable() {
    const root = dialogEl.value
    if (!root) return []
    return [...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((el) => !el.closest('[hidden]'))
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      options?.onEscape?.()
      return
    }
    if (event.key !== 'Tab') return
    const nodes = focusable()
    if (!nodes.length) {
      event.preventDefault()
      return
    }
    const first = nodes[0]!
    const last = nodes[nodes.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onMounted(() => {
    previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogEl.value?.focus()
  })

  onUnmounted(() => {
    previous?.focus()
  })

  return { dialogEl, onKeydown }
}
