"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/server/auth";
import { getClientIp, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { ActionState } from "./types";

export async function loginAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ip = await getClientIp();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();

  const byIp = rateLimit(`login:ip:${ip}`, { limit: 15, windowMs: 5 * 60 * 1000 });
  if (!byIp.allowed) return { error: rateLimitMessage(byIp.retryAfterSec) };

  if (email) {
    const byEmail = rateLimit(`login:email:${email}`, { limit: 5, windowMs: 15 * 60 * 1000 });
    if (!byEmail.allowed) return { error: rateLimitMessage(byEmail.retryAfterSec) };
  }

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Correo o contraseña incorrectos" };
    }
    throw error; // NEXT_REDIRECT debe propagarse
  }
}
