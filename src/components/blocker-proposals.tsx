import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorSummary, Field, FormActions, Modal, TextArea, TextInput } from "@/components/manage/crud-ui";
import { Icon } from "@/components/icon";
import {
  decideBlockerProposal,
  fetchBlockerProposals,
  proposeBlocker,
  SEVERITY_LABELS,
  timeAgo,
  type Blocker,
} from "@/lib/dashboard";

const SEVERITIES = ["critical", "warning", "info"] as const;

function SeveritySelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-11 w-full rounded-md border border-outline-variant bg-card px-sm font-body-md text-primary"
    >
      {SEVERITIES.map((s) => (
        <option key={s} value={s}>
          Priorité {SEVERITY_LABELS[s].toLowerCase()}
        </option>
      ))}
    </select>
  );
}

/** Formulaire « Proposer un point bloquant » : la priorité est une suggestion, le manager confirme. */
export function ProposeBlockerModal({
  managerTeams,
  onClose,
}: {
  managerTeams: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", description: "", severity: "warning", team: managerTeams[0] ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: proposeBlocker,
    onSuccess: () => {
      toast.success("Proposition envoyée. Le manager de ton équipe la confirmera.");
      qc.invalidateQueries({ queryKey: ["blocker_proposals"] });
      onClose();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (form.title.trim().length < 5) errs.title = "5 caractères minimum";
    if (form.title.trim().length > 120) errs.title = "120 caractères maximum";
    if (form.description.length > 1000) errs.description = "1 000 caractères maximum";
    if (managerTeams.length > 1 && !form.team) errs.team = "Choisis une équipe";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    send.mutate({
      title: form.title.trim(),
      description: form.description.trim(),
      severity: form.severity,
      team: managerTeams.length ? form.team : undefined,
    });
  }

  return (
    <Modal title="Proposer un point bloquant" onClose={onClose}>
      <form onSubmit={submit} className="space-y-sm" noValidate>
        <ErrorSummary errors={errors} />
        <Field label="Titre" error={errors.title}>
          <TextInput
            value={form.title}
            maxLength={120}
            placeholder="Ce qui bloque, en une phrase"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Détails (optionnel)" error={errors.description}>
          <TextArea
            rows={4}
            value={form.description}
            placeholder="Depuis quand, qui est concerné, ce que ça empêche…"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Priorité suggérée">
          <SeveritySelect label="Priorité suggérée" value={form.severity} onChange={(v) => setForm({ ...form, severity: v })} />
        </Field>
        {managerTeams.length > 1 && (
          <Field label="Équipe" error={errors.team}>
            <select
              value={form.team}
              onChange={(e) => setForm({ ...form, team: e.target.value })}
              className="min-h-11 w-full rounded-md border border-outline-variant bg-surface px-sm font-body-md"
            >
              {managerTeams.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
        )}
        <FormActions pending={send.isPending} submitLabel="ENVOYER" onCancel={onClose} />
      </form>
    </Modal>
  );
}

/** Les propositions de l'utilisateur et la réponse reçue (en attente, ou refusée avec sa raison). */
export function MyBlockerProposals({ email }: { email: string }) {
  const q = useQuery({ queryKey: ["blocker_proposals"], queryFn: fetchBlockerProposals, retry: false });
  const mine = (q.data ?? []).filter((b) => (b.proposed_by_email ?? "") === email.toLowerCase());
  if (!mine.length) return null;
  return (
    <div className="mt-md border-t border-outline-variant pt-sm">
      <h3 className="font-label-md text-label-md text-on-surface-variant mb-xs">Mes propositions</h3>
      <ul className="space-y-xs">
        {mine.map((b) => (
          <li key={b.id} className="rounded-md border border-outline-variant bg-card p-sm">
            <div className="flex flex-wrap items-center justify-between gap-xs">
              <p className="font-body-md font-bold text-primary wrap-anywhere">{b.title}</p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-sm py-0.5 font-label-sm text-label-sm text-primary">
                <span
                  aria-hidden="true"
                  className={`size-2 rounded-full ${b.status === "REFUSÉ" ? "bg-error" : "bg-on-tertiary-fixed"}`}
                />
                {b.status === "REFUSÉ" ? "Refusée" : "En attente de confirmation"}
              </span>
            </div>
            {b.status === "REFUSÉ" && (
              <p className="mt-xs rounded-md bg-error-container p-xs text-body-sm text-on-error-container wrap-anywhere">
                {b.decided_by_name ? `${b.decided_by_name} : ` : ""}
                {b.decision_note}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Côté manager / admin : confirmer (avec la priorité de son choix) ou refuser (raison obligatoire). */
export function ProposalsToConfirm() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["blocker_proposals"], queryFn: fetchBlockerProposals, retry: false });
  const pending = (q.data ?? []).filter((b) => b.status === "PROPOSÉ");
  const [severity, setSeverity] = useState<Record<string, string>>({});
  const [refusing, setRefusing] = useState<Blocker | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");

  const decide = useMutation({
    mutationFn: decideBlockerProposal,
    onSuccess: (_d, v) => {
      toast.success(v.status === "OUVERT" ? "Point bloquant confirmé" : "Proposition refusée");
      setRefusing(null);
      qc.invalidateQueries({ queryKey: ["blocker_proposals"] });
      qc.invalidateQueries({ queryKey: ["blockers"] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  return (
    <section id="tour-traiter-proposals" className="col-span-12 bg-surface-container-lowest border border-outline-variant rounded-md p-md">
      <div className="flex flex-wrap items-center justify-between gap-xs border-b border-outline-variant pb-sm mb-md">
        <h2 className="font-headline-sm text-headline-sm text-primary">Points bloquants à confirmer</h2>
        <span className="font-label-sm text-label-sm text-on-surface-variant">{pending.length} en attente</span>
      </div>
      {q.isError && <p className="text-body-sm text-error">Les propositions sont indisponibles.</p>}
      {!q.isLoading && !q.isError && pending.length === 0 && (
        <p className="text-body-sm text-on-surface-variant italic">Aucune proposition en attente.</p>
      )}
      <ul className="space-y-xs">
        {pending.map((b) => {
          const sev = severity[b.id] ?? b.severity;
          return (
            <li key={b.id} className="space-y-xs rounded-md border border-outline-variant bg-card p-sm">
              <div className="min-w-0">
                <p className="font-body-md font-bold text-primary wrap-anywhere">{b.title}</p>
                {b.description && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-line wrap-anywhere">
                    {b.description}
                  </p>
                )}
                <p className="font-label-sm text-label-sm text-on-surface-variant">
                  Proposé par l'équipe {b.proposed_team} · priorité suggérée : {SEVERITY_LABELS[b.severity]?.toLowerCase()}
                  {b.created_at ? ` · ${timeAgo(b.created_at)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-xs">
                <div className="min-w-44 flex-1 sm:max-w-56">
                  <SeveritySelect
                    label={`Priorité de ${b.title}`}
                    value={sev}
                    onChange={(v) => setSeverity({ ...severity, [b.id]: v })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRefusing(b);
                    setNote("");
                    setNoteError("");
                  }}
                  className="min-h-11 rounded-md border border-primary px-md font-label-md text-label-md text-primary hover:bg-surface-container"
                >
                  Refuser
                </button>
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: b.id, status: "OUVERT", severity: sev })}
                  className="inline-flex min-h-11 items-center gap-xs rounded-md bg-primary px-md font-label-md text-label-md text-on-primary disabled:opacity-50"
                >
                  <Icon name="check" /> Confirmer
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {refusing && (
        <Modal title="Refuser la proposition" onClose={() => setRefusing(null)}>
          <form
            noValidate
            className="space-y-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return setNoteError("La raison est obligatoire : elle sera lue par la personne qui a proposé.");
              if (note.trim().length > 500) return setNoteError("500 caractères maximum");
              decide.mutate({ id: refusing.id, status: "REFUSÉ", severity: refusing.severity, decision_note: note });
            }}
          >
            <p className="rounded-md bg-surface-container p-xs text-body-sm italic text-on-surface-variant wrap-anywhere">
              “{refusing.title}”
            </p>
            <Field label="Raison du refus (obligatoire)" error={noteError}>
              <TextArea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <FormActions pending={decide.isPending} submitLabel="REFUSER" onCancel={() => setRefusing(null)} />
          </form>
        </Modal>
      )}
    </section>
  );
}
