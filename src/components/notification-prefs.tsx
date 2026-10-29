import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Modal } from "@/components/manage/crud-ui";
import { supabase } from "@/integrations/supabase/client";

/** Préférences de notification. Le résumé hebdomadaire est une option, désactivée par défaut. */
export function NotificationPrefsModal({ email, onClose }: { email: string; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ["notification_preferences", email];
  const prefs = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("weekly_summary")
        .eq("email", email)
        .maybeSingle();
      if (error) throw error;
      return data?.weekly_summary ?? false;
    },
    retry: false,
  });
  const save = useMutation({
    mutationFn: async (weekly: boolean) => {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ email, weekly_summary: weekly }, { onConflict: "email" });
      if (error) throw error;
      return weekly;
    },
    onSuccess: (weekly) => {
      qc.setQueryData(key, weekly);
      toast.success(weekly ? "Résumé hebdomadaire activé" : "Résumé hebdomadaire désactivé");
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  return (
    <Modal title="Notifications" onClose={onClose}>
      <div className="space-y-sm">
        <label className="flex min-h-11 items-start gap-sm font-body-md">
          <input
            type="checkbox"
            className="mt-1 size-5"
            checked={prefs.data ?? false}
            disabled={prefs.isLoading || prefs.isError || save.isPending}
            onChange={(e) => save.mutate(e.target.checked)}
          />
          <span>
            <span className="block font-bold text-primary">Recevoir un résumé hebdomadaire par email</span>
            <span className="block text-body-sm text-on-surface-variant">
              Une fois par semaine : ce qui t'attend dans l'application. Désactivé par défaut.
            </span>
          </span>
        </label>
        {prefs.isError && <p className="text-body-sm text-error">Tes préférences sont indisponibles.</p>}
        <p className="rounded-md bg-surface-container p-xs text-body-sm text-on-surface-variant">
          L'envoi automatique n'est pas encore en service : ton choix est enregistré pour le jour où il le sera.
        </p>
      </div>
    </Modal>
  );
}
