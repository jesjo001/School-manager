'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useApp } from '@/contexts/AppContext'

/**
 * UI-side role guard — the exact route table the original `WorkspaceRoute`
 * enforced. It is defence-in-depth only: the real enforcement lives in
 * `middleware.ts` (session cookie) and in `withTenant` on every API handler.
 */
const permitted: Record<string, string[]> = {
  Student: ['/', '/dashboard', '/exams', '/exam/', '/results', '/settings'],
  Teacher: ['/', '/dashboard', '/students', '/classes', '/attendance', '/exams', '/exam/', '/grading', '/results', '/settings'],
  Admin: ['/', '/dashboard', '/students', '/classes', '/staff', '/attendance', '/fees', '/exams', '/exam/', '/grading', '/results', '/settings'],
  Proprietor: ['/', '/dashboard', '/students', '/classes', '/staff', '/attendance', '/fees', '/exams', '/exam/', '/grading', '/results', '/settings'],
}

export function RoleGuard({ children }: { children: React.ReactNode }) {
  const { role } = useApp()
  const path = usePathname()
  const router = useRouter()

  const allowed =
    (permitted[role] ?? []).some((r) => path === r || (r !== '/' && path.startsWith(r))) &&
    !(role === 'Student' && path === '/exams/new')

  useEffect(() => {
    if (!allowed) router.replace('/')
  }, [allowed, router])

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-xl bg-secondary" />
        <p className="text-xs text-muted-foreground">Returning you to your workspace…</p>
      </div>
    )
  }

  return <>{children}</>
}
