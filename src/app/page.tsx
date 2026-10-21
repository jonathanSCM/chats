import { redirect } from "next/navigation";
import { auth } from "@/server/auth";

// La landing de marketing vive en su propio sitio (rama "landing"); la raíz del CRM
// solo lleva al panel o al inicio de sesión.
export default async function RootPage() {
  const session = await auth();
  redirect(session ? "/dashboard" : "/login");
}
