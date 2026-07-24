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
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-2/60 hover:text-ink"
      title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
      {isDark ? "Modo claro" : "Modo oscuro"}
    </button>
  );
}
