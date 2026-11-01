import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Modal, TextInput } from "@/components/manage/crud-ui";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";

type Prefs = { delivery_email: string | null; confirm_submissions: boolean; review_mode: string };
const DEFAULTS: Prefs = {
  delivery_email: null,
  confirm_submissions: true,
  review_mode: "quotidien",
};
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const STATUS_LABEL: Record<string, string> = {
  "à envoyer": "En file",
  "en cours": "En cours d'envoi",
  envoyé: "Envoyé",
  simulé: "Simulé",
  échec: "Échec",
};

const dateFr = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

/**
 * Notifications par email. Les comptes de l'app n'ont pas d'adresse réelle : chacun indique
 * où recevoir ses emails. Sans adresse, les emails sont seulement simulés et restent lisibles ici.
 */
export function NotificationPrefsModal({
  email,
  role,
  onClose,
}: {
  email: string;
  role: AppRole | null | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const key = ["notification_preferences", email];
  const isStaff = role === "manager" || role === "admin";

  const prefs = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Prefs> => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("delivery_email, confirm_submissions, review_mode")
        .eq("email", email)
        .maybeSingle();
      if (error) throw error;
      return data ?? DEFAULTS;
    },
    retry: false,
  });

  const emails = useQuery({
    queryKey: ["email_outbox", email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_outbox")
        .select("id, subject, body, status, note, created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<Prefs>) => {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ email, ...patch }, { onConflict: "email" });
      if (error) throw error;
      return patch;
    },
    onSuccess: (patch) => {
      qc.setQueryData<Prefs>(key, (old) => ({ ...(old ?? DEFAULTS), ...patch }));
      toast.success("Préférences enregistrées");
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string>();
  useEffect(() => {
    setAddress(prefs.data?.delivery_email ?? "");
  }, [prefs.data?.delivery_email]);

  function saveAddress(e: FormEvent) {
    e.preventDefault();
    const value = address.trim().toLowerCase();
    if (value && !EMAIL_RE.test(value)) {
      setAddressError("Adresse email invalide.");
      return;
    }
    setAddressError(undefined);
    save.mutate({ delivery_email: value || null });
  }

  const p = prefs.data ?? DEFAULTS;
  const disabled = prefs.isLoading || prefs.isError || save.isPending;

  return (
    <Modal title="Notifications" onClose={onClose}>
      <div className="space-y-md">
        {prefs.isError && (
          <p className="text-body-sm text-error">Tes préférences sont indisponibles.</p>
        )}

        <form onSubmit={saveAddress} className="space-y-xs">
          <label
            htmlFor="notif-address"
            className="block font-label-sm text-label-sm uppercase text-on-surface-variant"
          >
            Adresse de réception
          </label>
          <p className="text-body-sm text-on-surface-variant">
            Ton compte Happy Place n'a pas d'adresse réelle : indique où recevoir tes emails. Sans
            adresse, ils sont seulement simulés et tu les retrouves en bas de cette fenêtre.
          </p>
          <div className="flex flex-wrap gap-xs">
            <TextInput
              id="notif-address"
              type="email"
              autoComplete="email"
              placeholder="prenom.nom@exemple.fr"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-invalid={addressError ? true : undefined}
              aria-describedby={addressError ? "notif-address-err" : undefined}
              disabled={disabled}
              className="min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={disabled}
              className="min-h-11 rounded-md bg-primary px-md font-label-md text-label-md text-on-primary disabled:opacity-50"
            >
              Enregistrer
            </button>
          </div>
          {addressError && (
            <p id="notif-address-err" role="alert" className="text-body-sm text-error">
              {addressError}
            </p>
          )}
        </form>

        <label className="flex min-h-11 items-start gap-sm font-body-md">
          <input
            type="checkbox"
            className="mt-1 size-5"
            checked={p.confirm_submissions}
            disabled={disabled}
            onChange={(e) => save.mutate({ confirm_submissions: e.target.checked })}
          />
          <span>
            <span className="block font-bold text-primary">Accusé d'envoi</span>
            <span className="block text-body-sm text-on-surface-variant">
              Un email quand j'envoie une idée ou que je propose un point bloquant.
            </span>
          </span>
        </label>

        {isStaff && (
          <fieldset className="space-y-xs">
            <legend className="font-label-sm text-label-sm uppercase text-on-surface-variant">
              Ce que j'ai à traiter
            </legend>
            {[
              {
                value: "quotidien",
                title: "Un résumé chaque matin à 8 h",
                hint: "Uniquement ce qui attend encore ta décision.",
              },
              {
                value: "immédiat",
                title: "Un email par élément",
                hint: "Dès qu'une idée ou une proposition arrive.",
              },
            ].map((o) => (
              <label key={o.value} className="flex min-h-11 items-start gap-sm font-body-md">
                <input
                  type="radio"
                  name="review_mode"
                  className="mt-1 size-5"
                  checked={p.review_mode === o.value}
                  disabled={disabled}
                  onChange={() => save.mutate({ review_mode: o.value })}
                />
                <span>
                  <span className="block font-bold text-primary">{o.title}</span>
                  <span className="block text-body-sm text-on-surface-variant">{o.hint}</span>
                </span>
              </label>
            ))}
            <p className="text-body-sm text-on-surface-variant">
              Chaque lundi à 8 h, un rappel liste aussi ce qui attend depuis plus de 7 jours.
            </p>
          </fieldset>
        )}

        <p className="rounded-md bg-surface-container p-xs text-body-sm text-on-surface-variant">
          Toujours envoyés : la décision sur tes idées (validée, refusée, publiée en actualité) et
          sur tes propositions de points bloquants (confirmée, refusée, résolue).
        </p>

        <section
          aria-labelledby="notif-recent"
          className="space-y-xs border-t border-outline-variant pt-sm"
        >
          <h3
            id="notif-recent"
            className="font-label-sm text-label-sm uppercase text-on-surface-variant"
          >
            Mes derniers emails
          </h3>
          {emails.isLoading && <p className="text-body-sm text-on-surface-variant">Chargement…</p>}
          {emails.isError && (
            <p className="text-body-sm text-error">Impossible de charger tes emails.</p>
          )}
          {emails.data?.length === 0 && (
            <p className="text-body-sm text-on-surface-variant">Aucun email pour l'instant.</p>
          )}
          <ul className="space-y-xs">
            {emails.data?.map((m) => (
              <li key={m.id}>
                <details className="rounded-md border border-outline-variant">
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-sm px-xs py-1 font-body-md">
                    <span className="min-w-0 flex-1 font-bold text-primary">{m.subject}</span>
                    <span className="text-body-sm text-on-surface-variant">
                      {dateFr(m.created_at)} · {STATUS_LABEL[m.status] ?? m.status}
                    </span>
                  </summary>
                  <div className="space-y-xs border-t border-outline-variant p-xs">
                    {m.note && <p className="text-body-sm text-on-surface-variant">{m.note}</p>}
                    <p className="whitespace-pre-wrap break-words text-body-sm">{m.body}</p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}
