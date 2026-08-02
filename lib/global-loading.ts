export const GLOBAL_LOADING_START = 'app:global-loading-start'

export function startGlobalLoading() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(GLOBAL_LOADING_START))
}
