import Link from "next/link";
import { Logo } from "@/components/logo";

export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <Logo size="sm" />
        <div className="flex items-center gap-5 text-xs text-ink-faint">
          <Link href="/terms" className="hover:text-ink-muted">
            Términos
          </Link>
          <Link href="/privacy" className="hover:text-ink-muted">
            Privacidad
          </Link>
          <p className="font-mono">© {new Date().getFullYear()} ZÓCALO</p>
        </div>
      </div>
    </footer>
  );
}
