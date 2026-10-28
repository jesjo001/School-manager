/**
 * Transitional demo dataset.
 *
 * These arrays are what the original Lovable prototype rendered while every
 * screen was still backed by `localStorage`. They are re-exported by
 * `@/services/school` so existing pages compile unchanged during the migration;
 * Phase 6 replaces each usage with the real `/api/*` calls in this same folder
 * and this file is then deleted.
 */
import type { ClassRow, Exam, Invoice, School, Staff, Student } from './types'

export const schools: School[] = [
  { id: 'school-1', name: 'The Oakbridge School', location: 'Lekki, Lagos', brandColor: '#7479e8', logo: 'O', studentCount: 842, feesCollected: 38450000 },
  { id: 'school-2', name: 'Cedarfield Academy', location: 'Ikeja, Lagos', brandColor: '#4f9c91', logo: 'C', studentCount: 526, feesCollected: 22180000 },
]

export const students: Student[] = [
  { id: 'ST-2401', name: 'Amara Okafor', class: 'JSS 2', section: 'A', gender: 'Female', avatar: 'AO', status: 'Active', attendance: 96, feeBalance: 0, guardians: ['Chinedu Okafor'], examScores: [82, 91, 87] },
  { id: 'ST-2402', name: 'Tunde Adebayo', class: 'SS 1', section: 'B', gender: 'Male', avatar: 'TA', status: 'Active', attendance: 91, feeBalance: 85000, guardians: ['Bisi Adebayo'], examScores: [75, 88, 79] },
  { id: 'ST-2403', name: 'Zainab Bello', class: 'JSS 3', section: 'A', gender: 'Female', avatar: 'ZB', status: 'Active', attendance: 98, feeBalance: 45000, guardians: ['Sani Bello'], examScores: [94, 89, 96] },
  { id: 'ST-2404', name: 'Femi Adekunle', class: 'SS 2', section: 'A', gender: 'Male', avatar: 'FA', status: 'Active', attendance: 84, feeBalance: 120000, guardians: ['Kemi Adekunle'], examScores: [67, 73, 80] },
  { id: 'ST-2405', name: 'Ngozi Eze', class: 'JSS 1', section: 'C', gender: 'Female', avatar: 'NE', status: 'Active', attendance: 93, feeBalance: 0, guardians: ['Ifeanyi Eze'], examScores: [88, 92, 90] },
  { id: 'ST-2406', name: 'Kelechi Nwosu', class: 'SS 1', section: 'B', gender: 'Male', avatar: 'KN', status: 'On leave', attendance: 88, feeBalance: 35000, guardians: ['Ada Nwosu'], examScores: [71, 85, 77] },
  { id: 'ST-2407', name: 'Chiamaka Umeh', class: 'JSS 2', section: 'A', gender: 'Female', avatar: 'CU', status: 'Active', attendance: 97, feeBalance: 0, guardians: ['Paul Umeh'], examScores: [90, 93, 89] },
  { id: 'ST-2408', name: 'Seyi Balogun', class: 'SS 3', section: 'B', gender: 'Male', avatar: 'SB', status: 'Active', attendance: 89, feeBalance: 65000, guardians: ['Morenike Balogun'], examScores: [78, 84, 81] },
]

export const staff: Staff[] = [
  { id: 'SF-101', name: 'Mrs. Folake Adeyemi', role: 'Head of School', subjects: ['Leadership'], classes: ['All'], status: 'Active', avatar: 'FA' },
  { id: 'SF-102', name: 'Mr. David Okoro', role: 'Teacher', subjects: ['Mathematics', 'Further Maths'], classes: ['SS 1', 'SS 2'], status: 'Active', avatar: 'DO' },
  { id: 'SF-103', name: 'Ms. Esther Danjuma', role: 'Teacher', subjects: ['English Language'], classes: ['JSS 2', 'JSS 3'], status: 'Active', avatar: 'ED' },
  { id: 'SF-104', name: 'Mr. Ibrahim Musa', role: 'Bursar', subjects: ['Finance'], classes: ['All'], status: 'Active', avatar: 'IM' },
  { id: 'SF-105', name: 'Mrs. Kemi Oladipo', role: 'Teacher', subjects: ['Biology', 'Basic Science'], classes: ['JSS 1', 'SS 1'], status: 'On leave', avatar: 'KO' },
]

export const classList: ClassRow[] = [
  { id: 'CLS-01', name: 'JSS 1', sections: 3, sectionList: ['A', 'B', 'C'], studentCount: 104, teacher: 'Mrs. Kemi Oladipo', subjects: ['English', 'Mathematics', 'Basic Science'] },
  { id: 'CLS-02', name: 'JSS 2', sections: 2, sectionList: ['A', 'B'], studentCount: 96, teacher: 'Ms. Esther Danjuma', subjects: ['English', 'Mathematics', 'Social Studies'] },
  { id: 'CLS-03', name: 'JSS 3', sections: 3, sectionList: ['A', 'B', 'C'], studentCount: 112, teacher: 'Mr. Joseph Obi', subjects: ['English', 'Mathematics', 'Basic Technology'] },
  { id: 'CLS-04', name: 'SS 1', sections: 2, sectionList: ['A', 'B'], studentCount: 88, teacher: 'Mr. David Okoro', subjects: ['Mathematics', 'Biology', 'Economics'] },
  { id: 'CLS-05', name: 'SS 2', sections: 2, sectionList: ['A', 'B'], studentCount: 91, teacher: 'Mrs. Aisha Bello', subjects: ['Chemistry', 'Physics', 'Government'] },
]

export const invoices: Invoice[] = [
  { id: 'INV-2041', student: 'Tunde Adebayo', amount: 85000, dueDate: '2025-04-18', status: 'Overdue' },
  { id: 'INV-2042', student: 'Zainab Bello', amount: 45000, dueDate: '2025-04-24', status: 'Pending' },
  { id: 'INV-2043', student: 'Femi Adekunle', amount: 120000, dueDate: '2025-04-16', status: 'Overdue' },
  { id: 'INV-2044', student: 'Ngozi Eze', amount: 96000, dueDate: '2025-04-30', status: 'Paid' },
]

export const exams: Exam[] = [
  { id: 'EX-2025-018', title: 'Mid-term Mathematics', subject: 'Mathematics', class: 'JSS 2', status: 'Live', date: 'Today · 10:30 AM', duration: 45, participants: 64, questions: 30 },
  { id: 'EX-2025-017', title: 'English Language — Comprehension', subject: 'English', class: 'SS 1', status: 'Scheduled', date: 'Tomorrow · 9:00 AM', duration: 60, participants: 42, questions: 25 },
  { id: 'EX-2025-016', title: 'Basic Science Quiz', subject: 'Basic Science', class: 'JSS 1', status: 'Completed', date: '12 Apr · 11:00 AM', duration: 30, participants: 98, questions: 20 },
]
