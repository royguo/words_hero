'use client';
import { AuthGate } from '../auth-gate';
import { StudentManager } from '../student-manager';
export default function StudentsPage() {
  return (
    <AuthGate>
      <StudentManager />
    </AuthGate>
  );
}
