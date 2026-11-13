"use client";

import { useEffect, useState } from "react";

// The footer's theme choice (ADR 0035). "System" follows the device's light or dark setting; "Light" and "Dark" are kept in
// this browser's localStorage and set data-theme on <html>, which globals.css's color-scheme rules read. THEME_SCRIPT
// applies a kept choice before the first paint, so a dark page never flashes light.
export const THEME_KEY = "theme";
const CHOICES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;
type Choice = (typeof CHOICES)[number]["value"];

export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function apply(choice: Choice) {
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage blocked (a private window): the choice still holds for this page.
  }
}

export function ThemeToggle() {
  // null until mounted: the server cannot know the kept choice, so no button is marked pressed in the first HTML.
  const [choice, setChoice] = useState<Choice | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setChoice(t === "light" || t === "dark" ? t : "system");
  }, []);
  return (
    <div role="group" aria-label="Color theme" className="mt-4 flex w-fit border border-white/40">
      {CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          aria-pressed={choice === c.value}
          onClick={() => {
            apply(c.value);
            setChoice(c.value);
          }}
          className={`inline-flex min-h-11 items-center px-3 text-[14px] font-semibold ${
            choice === c.value ? "bg-page text-navy" : "text-white/85 hover:text-white hover:underline"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
