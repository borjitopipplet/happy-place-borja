import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { getThemePref, setThemePref, THEME_EVENT, type ThemePref } from "@/lib/theme";

const ORDER: ThemePref[] = ["system", "light", "dark"];
const LABEL: Record<ThemePref, string> = { system: "Système", light: "Clair", dark: "Sombre" };
const ICON: Record<ThemePref, string> = { system: "brightness_auto", light: "light_mode", dark: "dark_mode" };

/** Bouton de thème : Système, Clair ou Sombre. Chaque clic passe au suivant. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  // Lu après le premier rendu : le serveur ne connaît pas le choix gardé dans le navigateur.
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    const sync = () => setPref(getThemePref());
    sync();
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
  return (
    <button
      type="button"
      onClick={() => setThemePref(next)}
      aria-label={`Thème : ${LABEL[pref].toLowerCase()}. Passer à : ${LABEL[next].toLowerCase()}`}
      className={`inline-flex min-h-11 items-center gap-xs rounded-md px-xs font-label-sm text-label-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
    >
      <Icon name={ICON[pref]} />
      <span>{LABEL[pref]}</span>
    </button>
  );
}
