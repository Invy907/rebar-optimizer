'use client'

import { GLOBAL_LOADING_START } from '@/lib/global-loading'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { GlobalLoadingOverlay } from '@/components/global-loading-overlay'

function isInternalNavigationHref(href: string, pathname: string) {
  if (
    href.startsWith('#') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:')
  ) {
    return false
  }

  if (href.startsWith('http://') || href.startsWith('https://')) {
    try {
      const url = new URL(href)
      if (url.origin !== window.location.origin) return false
      return url.pathname + url.search !== pathname
    } catch {
      return false
    }
  }

  try {
    const url = new URL(href, window.location.href)
    const current = window.location.pathname + window.location.search
    const next = url.pathname + url.search
    return next !== current
  } catch {
    return false
  }
}

export function GlobalNavigationLoader() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(false)
  }, [pathname, searchParams])

  useEffect(() => {
    const start = () => setLoading(true)

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest('a[href]')
      if (!anchor || anchor.getAttribute('target') === '_blank') return
      if (anchor.hasAttribute('download')) return

      const href = anchor.getAttribute('href')
      if (!href || !isInternalNavigationHref(href, pathname)) return

      setLoading(true)
    }

    window.addEventListener(GLOBAL_LOADING_START, start)
    document.addEventListener('click', handleClick, true)
    return () => {
      window.removeEventListener(GLOBAL_LOADING_START, start)
      document.removeEventListener('click', handleClick, true)
    }
  }, [pathname])

  if (!loading) return null
  return <GlobalLoadingOverlay />
}
