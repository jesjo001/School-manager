import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'CampusFlow',
  description:
    'CampusFlow — a multi-tenant school management workspace for proprietors, administrators, teachers, and students, featuring student records, attendance, fees, staff, and a polished CBT exam experience.',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'CampusFlow',
    description: 'The work of school, made lighter.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
