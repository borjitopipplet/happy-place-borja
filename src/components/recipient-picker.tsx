/** « Pour qui ? » : tout le cabinet, ou une ou plusieurs équipes. */
export function RecipientPicker({
  scope,
  onScopeChange,
  value,
  onChange,
  teams,
  error,
  name,
}: {
  scope: "all" | "teams";
  onScopeChange: (s: "all" | "teams") => void;
  value: string[];
  onChange: (v: string[]) => void;
  teams: string[];
  error?: string;
  name: string;
}) {
  return (
    <fieldset className="space-y-xs">
      <legend className="font-label-md text-label-md text-on-surface-variant">Pour qui ?</legend>
      <label className="flex min-h-11 items-center gap-xs font-body-md">
        <input type="radio" name={name} checked={scope === "all"} onChange={() => onScopeChange("all")} />
        Tout le cabinet
      </label>
      <label className="flex min-h-11 items-center gap-xs font-body-md">
        <input type="radio" name={name} checked={scope === "teams"} onChange={() => onScopeChange("teams")} />
        Une ou plusieurs équipes
      </label>
      {scope === "teams" && (
        <div className="grid grid-cols-1 gap-x-sm sm:grid-cols-2">
          {teams.map((t) => (
            <label key={t} className="flex min-h-11 items-center gap-xs font-body-md">
              <input
                type="checkbox"
                checked={value.includes(t)}
                onChange={(e) => onChange(e.target.checked ? [...value, t] : value.filter((x) => x !== t))}
              />
              {t}
            </label>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function forWhomText(teams: string[] | undefined) {
  return `Pour : ${teams?.length ? teams.join(", ") : "tout le cabinet"}`;
}
