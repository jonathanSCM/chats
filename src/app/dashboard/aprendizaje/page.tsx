import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { LearningClient } from "./_components/learning-client";

export default async function LearningPage() {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/login");
  if (session.user.role !== "OWNER") redirect("/dashboard");

  return (
    <div className="max-w-5xl animate-fade-up">
      <h1 className="mb-1 text-2xl font-bold">Aprendizaje</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Qué está pasando en el proceso comercial: dónde se pierden los leads, cuánto tarda cada
        etapa, qué objeciones aparecen y qué tan rápido se responde.
      </p>
      <LearningClient />
    </div>
  );
}
