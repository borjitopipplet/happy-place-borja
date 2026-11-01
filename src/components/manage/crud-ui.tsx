import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type { FieldErrors } from "@/lib/manage-schemas";

export function ManageIcon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`material-symbols-outlined ${className}`}>
      {name}
    </span>
  );
}

const inputBase =
  "min-h-11 w-full bg-card border border-outline-variant focus:border-primary focus:outline-none p-sm font-body-md text-on-surface";

/**
 * Étiquette + champ + message d'erreur. L'étiquette est liée au premier champ (input, select, textarea)
 * trouvé dans les enfants, et l'erreur lui est rattachée (aria-describedby). Quand il n'y a pas de
 * champ simple (sélecteur de fichier, éditeur de média), le bloc est un groupe nommé par l'étiquette.
 */
export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const uid = useId();
  const errId = `${uid}-err`;
  const controls: unknown[] = [TextInput, TextArea, Select, "input", "select", "textarea"];
  const nodes = Children.toArray(children);
  const idx = nodes.findIndex((n) => isValidElement(n) && controls.includes(n.type));
  let controlId: string | undefined;
  if (idx >= 0) {
    const el = nodes[idx] as ReactElement<{ id?: string }>;
    controlId = el.props.id ?? uid;
    nodes[idx] = cloneElement(el, {
      id: controlId,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? errId : undefined,
    } as Record<string, unknown>);
  }
  const labelClass = "font-label-sm text-label-sm text-on-surface-variant uppercase block";
  return (
    <div
      className="space-y-xs"
      role={controlId ? undefined : "group"}
      aria-labelledby={controlId ? undefined : `${uid}-label`}
    >
      {controlId ? (
        <label htmlFor={controlId} className={labelClass}>
          {label}
        </label>
      ) : (
        <span id={`${uid}-label`} className={labelClass}>
          {label}
        </span>
      )}
      {nodes}
      {error ? (
        <p id={errId} role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Fenêtre de dialogue : Échap ferme, le focus entre dans la fenêtre à l'ouverture, Tab y reste,
 * et le focus revient à l'élément qui l'avait ouverte à la fermeture.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const first =
      dialog?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea') ??
      dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();
    return () => previous?.focus?.();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-sm md:p-lg"
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-2xl bg-surface-container-lowest border border-outline p-md space-y-md focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-outline-variant pb-sm">
          <h2 className="font-headline-sm text-headline-sm text-primary">{title}</h2>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="inline-flex size-11 items-center justify-center rounded-md text-on-surface-variant hover:text-primary hover:bg-surface-container"
          >
            <ManageIcon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FormActions({
  pending,
  onCancel,
  submitLabel = "ENREGISTRER",
}: {
  pending?: boolean;
  onCancel: () => void;
  submitLabel?: string;
}) {
  return (
    <div className="flex justify-end gap-xs pt-sm">
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 rounded-md px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container"
      >
        ANNULER
      </button>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-md px-lg py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
      >
        {pending ? "…" : submitLabel}
      </button>
    </div>
  );
}

export function ErrorSummary({ errors }: { errors: FieldErrors }) {
  const count = Object.keys(errors).length;
  if (!count) return null;
  return (
    <div role="alert" className="text-body-sm text-error border border-error/40 bg-error-container/30 p-sm wrap-anywhere">
      <p>{count} champ{count > 1 ? "s" : ""} à corriger avant l'enregistrement.</p>
      <ul className="mt-xs list-disc pl-md">
        {Object.entries(errors).map(([k, m]) => (
          <li key={k}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

export function RowActions({
  onEdit,
  onDelete,
  deleting,
}: {
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
}) {
  return (
    <div className="flex gap-xs shrink-0">
      <button
        type="button"
        onClick={onEdit}
        className="min-h-11 rounded-md px-sm border border-outline text-primary font-label-sm text-label-sm hover:bg-surface-container"
      >
        MODIFIER
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="min-h-11 rounded-md px-sm border border-error text-error font-label-sm text-label-sm hover:bg-error-container disabled:opacity-50"
      >
        SUPPRIMER
      </button>
    </div>
  );
}

export function ConfirmDelete({
  label,
  onCancel,
  onConfirm,
  pending,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <Modal title="Confirmer la suppression" onClose={onCancel}>
      <p className="font-body-md text-on-surface">
        Supprimer définitivement <strong className="text-primary">{label}</strong> ? Cette action est
        irréversible.
      </p>
      <div className="flex justify-end gap-xs pt-sm">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-md px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container"
        >
          ANNULER
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="min-h-11 rounded-md px-lg py-xs bg-error text-on-error font-label-md text-label-md disabled:opacity-50"
        >
          {pending ? "SUPPRESSION…" : "SUPPRIMER"}
        </button>
      </div>
    </Modal>
  );
}
