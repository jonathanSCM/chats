import type { NextAuthConfig } from "next-auth";

// Config edge-safe: sin providers que toquen Prisma/Node APIs.
// Usada tanto en middleware (Edge Runtime) como base de la config completa.
export const authConfig: NextAuthConfig = {
  // Necesario detrás de un reverse proxy (Coolify/Traefik, Nginx, etc.):
  // sin esto, Auth.js rechaza el host con un error genérico de
  // "problema de configuración del servidor" que no dice la causa real.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = user.role;
        token.organizationId = user.organizationId;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as string;
        session.user.organizationId = token.organizationId as string | null;
      }
      return session;
    },
  },
};
