import { useId, useRef } from "react";
import { Icon } from "@/components/icon";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

/**
 * Bouton « Joindre un fichier » à la place du champ fichier natif du navigateur.
 * Une fois le fichier choisi : son nom, sa taille et un bouton pour le retirer.
 * onSelect reçoit le fichier ; il renvoie false pour le refuser (le champ est alors vidé).
 */
export function FilePickerButton({
  accept,
  file,
  onSelect,
  label = "Joindre un fichier",
}: {
  accept: string;
  file: File | null;
  onSelect: (f: File | null) => boolean | void;
  label?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  function clear() {
    if (input.current) input.current.value = "";
    onSelect(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-xs">
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        className="peer sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (onSelect(f) === false) e.target.value = "";
        }}
      />
      {file ? (
        <div className="flex min-h-11 min-w-0 max-w-full items-center gap-xs rounded-md border border-primary bg-surface-container px-sm">
          <Icon name="description" className="text-primary" />
          <span className="min-w-0 truncate font-body-sm text-body-sm text-primary">{file.name}</span>
          <span className="shrink-0 font-label-sm text-label-sm text-on-surface-variant">{formatSize(file.size)}</span>
          <button
            type="button"
            onClick={clear}
            aria-label={`Retirer ${file.name}`}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
          >
            <Icon name="close" />
          </button>
        </div>
      ) : (
        <label
          htmlFor={id}
          className="inline-flex min-h-11 cursor-pointer items-center gap-xs rounded-md border border-dashed border-primary px-md font-label-md text-label-md text-primary transition-colors hover:bg-surface-container peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2"
        >
          <Icon name="attach_file" />
          {label}
        </label>
      )}
    </div>
  );
}
