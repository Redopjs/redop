"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <Button
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="size-9 rounded-md border border-redop-border bg-transparent text-redop-ink hover:bg-redop-soft"
      onClick={toggleTheme}
      size="icon"
      type="button"
      variant="ghost"
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
