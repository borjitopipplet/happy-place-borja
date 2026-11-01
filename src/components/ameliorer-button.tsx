import { useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { ameliorerTexte, type Amelioration } from "@/lib/ameliorer";

/**
 * Petit bouton « Améliorer » placé sous un champ de texte : transforme quelques mots en titre + texte.
 * Le résultat remplace le contenu du formulaire ; « Revenir à mon texte » restaure la saisie d'origine
 * tant que la proposition n'a pas été retouchée.
 */
export function AmeliorerButton({
  titre,
  texte,
  onApply,
  disabled,
}: {
  titre: string;
  texte: string;
  onApply: (v: Amelioration) => void;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<Amelioration | null>(null);
  const applied = useRef<string | null>(null);

  // Le retour arrière n'est proposé que si le texte est encore celui de l'assistant.
  const canUndo = original !== null && applied.current === texte;
  const tooShort = texte.trim().length < 5;

  async function improve() {
    setLoading(true);
    setError(null);
    try {
      const before = { titre, texte };
      const result = await ameliorerTexte({ titre: titre.trim() || undefined, texte });
      applied.current = result.texte;
      setOriginal(before);
      onApply(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function undo() {
    if (!original) return;
    onApply(original);
    setOriginal(null);
    applied.current = null;
  }

  return (
    <div className="min-w-0 space-y-xs">
      <div className="flex flex-wrap items-center gap-xs">
        <button
          type="button"
          onClick={improve}
          disabled={disabled || loading || tooShort}
          title={tooShort ? "Écris d'abord quelques mots" : "Transformer ton texte en une courte actualité"}
          className="inline-flex min-h-11 items-center gap-xs rounded-md px-sm font-label-md text-label-md text-primary hover:bg-surface-container disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
        >
          <Icon name="auto_awesome" className={loading ? "animate-pulse" : ""} />
          {loading ? "Rédaction…" : "Améliorer"}
        </button>
        {canUndo && !loading && (
          <button
            type="button"
            onClick={undo}
            className="inline-flex min-h-11 items-center gap-xs rounded-md px-sm font-label-sm text-label-sm text-on-surface-variant underline-offset-2 hover:underline"
          >
            <Icon name="undo" /> Revenir à mon texte
          </button>
        )}
      </div>
      <p aria-live="polite" className="font-label-sm text-label-sm text-error empty:hidden">
        {error}
      </p>
    </div>
  );
}
