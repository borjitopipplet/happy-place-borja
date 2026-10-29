import { useState } from "react";
import { AttachmentLink } from "@/components/attachment-link";
import { Linkify } from "@/components/linkify";
import { Icon } from "@/components/icon";
import { timeAgo, type Decision, type Submission } from "@/lib/dashboard";

const STATUS: Record<string, { label: string; dot: string }> = {
  "en attente": { label: "En attente", dot: "bg-on-tertiary-fixed" },
  validée: { label: "Validée", dot: "bg-success" },
  refusée: { label: "Refusée", dot: "bg-error" },
};

/** Statut = pastille + mot (jamais la couleur seule). */
export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, dot: "bg-outline" };
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-container px-sm py-0.5 font-label-sm text-label-sm text-primary">
      <span aria-hidden="true" className={`size-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function forWhom(s: Submission) {
  const to = s.recipient_teams ?? [];
  return `Pour : ${to.length ? to.join(", ") : "tout le cabinet"}`;
}

/** « Mes idées » : chaque idée s'ouvre pour montrer le texte complet, le statut et, si refusée, le motif. */
export function MyIdeas({ items, decisions = {} }: { items: Submission[]; decisions?: Record<string, Decision> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ul className="space-y-xs">
      {items.map((s) => {
        const isOpen = open.has(s.id);
        const panelId = `idea-${s.id}`;
        return (
          <li key={s.id} className="min-w-0 overflow-hidden rounded-md border border-outline-variant bg-card">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(s.id)}
              className="flex w-full items-start gap-sm p-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Icon name={isOpen ? "expand_less" : "expand_more"} className="mt-0.5 text-on-surface-variant" />
              <span className="min-w-0 flex-1">
                <span
                  className={`block font-body-sm text-body-sm text-primary wrap-anywhere ${isOpen ? "" : "line-clamp-2"}`}
                >
                  {s.content}
                </span>
                <span className="mt-1 block font-label-sm text-label-sm text-on-surface-variant">
                  {forWhom(s)} · {timeAgo(s.created_at)}
                </span>
              </span>
              <StatusPill status={s.status} />
            </button>
            {isOpen && (
              <div id={panelId} className="space-y-xs border-t border-outline-variant p-sm">
                <p className="whitespace-pre-line font-body-sm text-body-sm text-on-surface wrap-anywhere">
                  <Linkify text={s.content} />
                </p>
                <AttachmentLink path={s.attachment_path} name={s.attachment_name} />
                {decisions[s.id] && (
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    {s.status === "validée" ? "Validée" : "Refusée"}
                    {decisions[s.id].is_automatic || !decisions[s.id].changed_by_name
                      ? ""
                      : ` par ${decisions[s.id].changed_by_name}`}{" "}
                    le {new Date(decisions[s.id].changed_at).toLocaleDateString("fr-FR")}
                  </p>
                )}
                {s.status === "refusée" && s.rejection_category && (
                  <div className="rounded-md bg-error-container p-xs text-body-sm text-on-error-container wrap-anywhere">
                    <p className="font-bold">Motif : {s.rejection_category}</p>
                    {s.rejection_note && (
                      <p className="whitespace-pre-line">
                        Raison : <Linkify text={s.rejection_note} />
                      </p>
                    )}
                  </div>
                )}
                {s.status === "en attente" && (
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    Ton manager a reçu ton idée. Tu verras ici sa réponse.
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
