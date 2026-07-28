import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/server/db/client";
import { authConfig } from "./config";

// Config completa (Node runtime): agrega el provider de credenciales, que
// necesita Prisma/bcrypt. Solo se usa en el route handler de /api/auth,
// nunca en middleware.
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Sobrescribe el jwt "edge-safe" de authConfig: este sí puede tocar la
    // DB (corre en Node, no en el middleware). En cada request que no sea
    // el login mismo, refresca rol/organización desde la DB — así, si el
    // dueño quita a alguien del equipo o le cambia el rol, se refleja de
    // inmediato en vez de esperar a que el JWT expire solo (hasta 30 días).
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = user.role;
        token.organizationId = user.organizationId;
        return token;
      }

      if (!token.sub) return token;

      const dbUser = await prisma.user.findUnique({
        where: { id: token.sub },
        select: { role: true, organizationId: true },
      });

      if (!dbUser) {
        // El usuario fue eliminado: invalida el token en vez de dejarlo
        // "vivo" con datos viejos.
        return {};
      }

      token.role = dbUser.role;
      token.organizationId = dbUser.organizationId;
      return token;
    },
  },
});
