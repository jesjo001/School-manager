import { apiRequest } from './http'
import type { AttendanceDay, AttendanceRecord } from './types'

export const getAttendance = (classId: string, date: string) =>
  apiRequest<AttendanceDay | null>('/api/attendance', { query: { classId, date } })

export const saveAttendance = (classId: string, date: string, records: AttendanceRecord[]) =>
  apiRequest<AttendanceDay>('/api/attendance', { method: 'POST', body: { classId, date, records } })
