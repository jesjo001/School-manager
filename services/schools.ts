import { apiRequest, apiUpload } from './http'
import type { School } from './types'

export const listSchools = () => apiRequest<School[]>('/api/schools')

export const switchSchool = (schoolId: string) =>
  apiRequest<{ school: School }>('/api/schools/switch', { method: 'POST', body: { schoolId } })

export const updateSchool = (patch: Partial<Pick<School, 'name' | 'location' | 'brandColor' | 'logo'>>) =>
  apiRequest<School>('/api/schools', { method: 'PATCH', body: patch })

export function uploadSchoolLogo(file: File) {
  const form = new FormData()
  form.append('file', file)
  return apiUpload<{ url: string }>('/api/schools/logo', form)
}
