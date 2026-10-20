"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza con el DOM ya pintado por el script inline anti-flash
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      className="nav-item flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--sidebar-ink)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-ink-strong)]"
      title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
      <span className="nav-label">{isDark ? "Modo claro" : "Modo oscuro"}</span>
    </button>
  );
}
