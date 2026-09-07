'use client';
import { AuthGate } from '../auth-gate';
import { StudentLearning } from '../student-learning';
export default function LearningPage() {
  return (
    <AuthGate requiredRole="student">
      <StudentLearning />
    </AuthGate>
  );
}
