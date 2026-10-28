import { apiRequest } from './http'
import type { Invoice, Paginated } from './types'

export type InvoiceFilters = { q?: string; status?: string; page?: number; limit?: number }

export type InvoiceInput = { studentId: string; amount: number; dueDate: string; term?: string; items?: { label: string; amount: number }[] }

export const listInvoices = (filters: InvoiceFilters = {}) =>
  apiRequest<Paginated<Invoice>>('/api/invoices', { query: filters as Record<string, string | number> })

export const createInvoice = (input: InvoiceInput) =>
  apiRequest<Invoice>('/api/invoices', { method: 'POST', body: input })

/* -------------------------------- payments ------------------------------- */

export type InitializePaymentInput = { invoiceId: string }

export type InitializePaymentResult = {
  reference: string
  authorizationUrl: string
  amount: number
  /** `false` when Paystack keys are not configured (local dev simulation). */
  live: boolean
}

export type PaymentRecord = {
  id: string
  invoiceId: string
  paystackRef: string
  amount: number
  paidAt: string
}

export const initializePayment = (input: InitializePaymentInput) =>
  apiRequest<InitializePaymentResult>('/api/payments/initialize', { method: 'POST', body: input })

export const verifyPayment = (reference: string) =>
  apiRequest<{ invoice: Invoice; payment: PaymentRecord }>('/api/payments/verify', { query: { reference } })

export const listPayments = () => apiRequest<PaymentRecord[]>('/api/payments')
