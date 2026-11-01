// Thème de l'interface : « système » (par défaut), « clair » ou « sombre ».
// Le choix est gardé dans le navigateur ; le script de __root.tsx applique le même calcul avant le premier affichage.
export type ThemePref = "system" | "light" | "dark";

const KEY = "hp-theme";
export const THEME_EVENT = "hp-theme";

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* stockage indisponible : le choix vaut pour cette page seulement */
  }
  applyTheme(pref);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Script injecté dans le <head> : même règle que applyTheme, exécutée avant le premier affichage. */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,m=matchMedia('(prefers-color-scheme: dark)');function p(){try{var v=localStorage.getItem('${KEY}');return v==='light'||v==='dark'?v:'system'}catch(e){return'system'}}function a(){var v=p();d.classList.toggle('dark',v==='dark'||(v==='system'&&m.matches))}a();m.addEventListener('change',a);addEventListener('storage',a)})();`;
