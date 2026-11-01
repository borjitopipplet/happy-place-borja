import { RecipientPicker } from "@/components/recipient-picker";

/** Choix fait en validant une idée : la publier en actualité, et pour qui. null = ne pas publier. */
export type PublishChoice = { scope: "all" | "teams"; teams: string[] } | null;

export function PublishAsNewsOption({
  id,
  value,
  onChange,
  teams,
}: {
  id: string;
  value: PublishChoice;
  onChange: (v: PublishChoice) => void;
  teams: string[];
}) {
  return (
    <div className="space-y-xs">
      <label className="flex min-h-11 cursor-pointer items-center gap-xs font-label-sm text-label-sm text-on-surface-variant">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={value !== null}
          onChange={(e) => onChange(e.target.checked ? { scope: "all", teams: [] } : null)}
        />
        Publier aussi en actualité
      </label>
      {value && (
        <div className="rounded-md border border-outline-variant p-sm">
          <RecipientPicker
            name={`publish-${id}`}
            scope={value.scope}
            onScopeChange={(scope) => onChange({ ...value, scope })}
            value={value.teams}
            onChange={(t) => onChange({ ...value, teams: t })}
            teams={teams}
          />
        </div>
      )}
    </div>
  );
}
