import { prisma } from "@/server/db/client";

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos/diacríticos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Compartido entre signup.ts (primera cuenta) y admin.ts (organizaciones nuevas dadas de alta por el superadmin). */
export async function uniqueOrgSlug(base: string): Promise<string> {
  const root = slugify(base) || "empresa";
  let candidate = root;
  let suffix = 1;

  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${root}-${suffix}`;
  }

  return candidate;
}
