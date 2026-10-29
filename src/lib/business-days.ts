/** Nombre de jours ouvrés (lundi à vendredi) écoulés depuis une date. Les jours fériés ne sont pas comptés. */
export function businessDaysSince(iso: string, now: Date = new Date()): number {
  const start = new Date(iso);
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let n = 0;
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const d = cursor.getDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

/** Une idée en attente depuis plus de 5 jours ouvrés est signalée « en retard ». */
export const LATE_AFTER_BUSINESS_DAYS = 5;
