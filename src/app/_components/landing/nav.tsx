import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export function Nav() {
  return (
    <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
      <Logo />
      <nav className="flex items-center gap-6">
        <a href="#como-funciona" className="hidden text-sm text-ink-muted hover:text-ink sm:inline">
          Cómo funciona
        </a>
        <a href="#faq" className="hidden text-sm text-ink-muted hover:text-ink sm:inline">
          FAQ
        </a>
        <Link href="/login" className="hidden text-sm text-ink-muted hover:text-ink sm:inline">
          Iniciar sesión
        </Link>
        <Link href="/signup">
          <Button size="sm">Empieza gratis</Button>
        </Link>
      </nav>
    </header>
  );
}
