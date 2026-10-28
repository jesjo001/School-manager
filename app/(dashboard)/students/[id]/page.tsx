import { StudentProfile } from '@/components/pages/student-profile'

export default async function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <StudentProfile id={id} />
}
