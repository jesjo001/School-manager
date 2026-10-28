import AppShell from '@/components/AppShell'
import { RoleGuard } from '@/components/RoleGuard'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <RoleGuard>{children}</RoleGuard>
    </AppShell>
  )
}
