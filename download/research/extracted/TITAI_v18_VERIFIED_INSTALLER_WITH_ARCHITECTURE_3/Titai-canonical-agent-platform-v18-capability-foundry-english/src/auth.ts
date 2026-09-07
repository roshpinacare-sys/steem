import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        // Import lazily so this module stays edge-safe where possible.
        const { checkRateLimit } = await import("@/lib/rate-limit");
        if (
          !checkRateLimit(`login:${parsed.data.email.toLowerCase()}`, {
            limit: 10,
            windowMs: 60_000,
          })
        ) {
          return null; // brute-force guard per account
        }
        const { db, schema } = await import("@/lib/db");
        const { verifyPassword } = await import("@/lib/auth/password");
        const { eq } = await import("drizzle-orm");
        const user = db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, parsed.data.email.toLowerCase()))
          .get();
        if (!user) return null;
        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "member";
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
});
