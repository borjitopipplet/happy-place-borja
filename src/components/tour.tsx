import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type TourStep = { target: string; title: string; body: string };

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 6;
const BUBBLE_W = 320;

/**
 * Visite guidée : des bulles ancrées sur les vrais boutons.
 * Les étapes dont la cible n'est pas à l'écran sont ignorées.
 */
export function Tour({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [visible, setVisible] = useState<TourStep[]>([]);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const step = visible[index];

  // À l'ouverture seulement : ne garder que les étapes dont la cible existe.
  // Les pages recréent la liste à chaque rendu : la lire via une ref évite de revenir à l'étape 1.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  useEffect(() => {
    if (!open) return;
    setVisible(stepsRef.current.filter((s) => document.querySelector(s.target)));
    setIndex(0);
  }, [open]);

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.target);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    document.querySelector(step.target)?.scrollIntoView({ block: "center", behavior: "auto" });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step, measure]);

  // Focus dans la bulle, Échap pour fermer, Tab reste dans la bulle.
  useEffect(() => {
    if (!open || !step) return;
    const bubble = bubbleRef.current;
    bubble?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !bubble) return;
      const f = bubble.querySelectorAll<HTMLElement>("button:not(:disabled)");
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, step, onClose]);

  if (!open || !step || !rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(BUBBLE_W, vw - 24);
  const below = rect.top + rect.height + 190 < vh || rect.top < 200;
  const top = below ? rect.top + rect.height + PAD + 12 : Math.max(12, rect.top - PAD - 12 - 170);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), vw - width - 12);
  const arrowLeft = Math.min(Math.max(16, rect.left + rect.width / 2 - left - 8), width - 32);
  const last = index === visible.length - 1;

  return (
    <div className="fixed inset-0 z-[100]" role="presentation">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed rounded-md shadow-[0_0_0_9999px_rgba(18,32,58,0.55)] outline-2 outline-on-primary"
        style={{
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
        }}
      />
      <div
        ref={bubbleRef}
        role="dialog"
        aria-label={`Visite guidée, étape ${index + 1} sur ${visible.length}`}
        className="fixed rounded-md bg-card p-md text-card-foreground shadow-lg"
        style={{ top, left, width }}
      >
        <span
          aria-hidden="true"
          className={`absolute size-4 rotate-45 bg-card ${below ? "-top-2" : "-bottom-2"}`}
          style={{ left: arrowLeft }}
        />
        <p className="font-label-sm text-label-sm text-on-surface-variant">
          Étape {index + 1} sur {visible.length}
        </p>
        <h2 className="mt-1 font-headline-sm text-headline-sm text-primary">{step.title}</h2>
        <p className="mt-xs font-body-sm text-body-sm text-on-surface">{step.body}</p>
        <div className="mt-md flex flex-wrap items-center justify-between gap-xs">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 px-xs font-label-sm text-label-sm text-on-surface-variant underline-offset-2 hover:underline"
          >
            Passer la visite
          </button>
          <div className="flex gap-xs">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex(index - 1)}
                className="min-h-11 rounded-md border border-primary px-sm font-label-md text-label-md text-primary"
              >
                Précédent
              </button>
            )}
            <button
              type="button"
              data-autofocus
              onClick={() => (last ? onClose() : setIndex(index + 1))}
              className="min-h-11 rounded-md bg-primary px-sm font-label-md text-label-md text-on-primary"
            >
              {last ? "Terminer" : "Suivant"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
