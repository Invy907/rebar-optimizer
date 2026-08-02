'use client'

import { GlobalNavigationLoader } from '@/components/global-navigation-loader'
import { Suspense } from 'react'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <GlobalNavigationLoader />
      </Suspense>
      {children}
    </>
  )
}
