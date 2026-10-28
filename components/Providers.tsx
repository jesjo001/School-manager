'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ErrorBoundary } from '@/components/error-boundary'
import { AppProvider } from '@/contexts/AppContext'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppProvider>
          <ErrorBoundary>{children}</ErrorBoundary>
        </AppProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
