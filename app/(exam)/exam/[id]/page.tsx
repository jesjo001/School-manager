import { StudentExam } from '@/components/pages/student-exam'

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <StudentExam id={id} />
}
