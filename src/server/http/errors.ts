import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "@/server/auth/guards";

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Datos inválidos", details: error.issues }, { status: 400 });
  }
  console.error(error);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}
