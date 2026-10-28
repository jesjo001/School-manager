import AppShell from '@/components/AppShell'
import { RoleGuard } from '@/components/RoleGuard'

/** The CBT player keeps the same shell/chrome as the rest of the workspace. */
export default function ExamLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <RoleGuard>{children}</RoleGuard>
    </AppShell>
  )
}
