import { NextResponse, type NextRequest } from 'next/server'
import {
  ROLE_HOME,
  SESSION_COOKIE,
  verifySessionToken,
  type DbRole,
} from '@/lib/session-token'

/**
 * Route protection (defence in depth alongside the UI RoleGuard):
 *
 *  - no/invalid session → redirect to /auth
 *  - signed-in user landing on /auth or /onboarding → their role home
 *  - wrong role for a path → their role home (mirrors components/RoleGuard.tsx)
 *
 * The real enforcement for data access happens in `lib/tenant.ts` on every API
 * route; this only keeps the browser out of screens the session cannot use.
 */
const PERMITTED: Record<DbRole, string[]> = {
  student: ['/', '/dashboard', '/exams', '/exam/', '/results', '/settings'],
  teacher: [
    '/',
    '/dashboard',
    '/students',
    '/classes',
    '/attendance',
    '/exams',
    '/exam/',
    '/grading',
    '/results',
    '/settings',
  ],
  admin: [
    '/',
    '/dashboard',
    '/students',
    '/classes',
    '/staff',
    '/attendance',
    '/fees',
    '/exams',
    '/exam/',
    '/grading',
    '/results',
    '/settings',
  ],
  proprietor: [
    '/',
    '/dashboard',
    '/students',
    '/classes',
    '/staff',
    '/attendance',
    '/fees',
    '/exams',
    '/exam/',
    '/grading',
    '/results',
    '/settings',
  ],
}

function isPermitted(role: DbRole, pathname: string): boolean {
  // Learners never reach the exam builder (same rule as the UI guard).
  if (role === 'student' && pathname === '/exams/new') return false
  return PERMITTED[role].some((path) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path),
  )
}

function redirectTo(req: NextRequest, pathname: string) {
  const url = req.nextUrl.clone()
  url.pathname = pathname
  url.search = ''
  return NextResponse.redirect(url)
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySessionToken(token) : null

  if (!session) {
    // The entry screens stay reachable; everything else needs a session.
    if (pathname === '/auth' || pathname === '/onboarding') return NextResponse.next()
    return redirectTo(req, '/auth')
  }

  // Already signed in: the entry screens have nothing to offer.
  if (pathname === '/auth' || pathname === '/onboarding') {
    return redirectTo(req, ROLE_HOME[session.role])
  }

  if (!isPermitted(session.role, pathname)) {
    return redirectTo(req, ROLE_HOME[session.role])
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/auth',
    '/onboarding',
    '/dashboard/:path*',
    '/students/:path*',
    '/classes/:path*',
    '/staff/:path*',
    '/attendance/:path*',
    '/fees/:path*',
    '/exams/:path*',
    '/exam/:path*',
    '/grading/:path*',
    '/results/:path*',
    '/settings/:path*',
  ],
}
