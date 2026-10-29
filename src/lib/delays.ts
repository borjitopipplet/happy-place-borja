/** Délais d'alerte, les mêmes partout : plus de 7 jours (calendaires) sans réponse ou sans mise à jour. */
export const LATE_AFTER_DAYS = 7;
export const STALE_BLOCKER_DAYS = 7;

export function daysSince(iso: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / 86400000);
}
