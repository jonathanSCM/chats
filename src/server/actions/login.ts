"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/server/auth";
import type { ActionState } from "./types";

export async function loginAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
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
