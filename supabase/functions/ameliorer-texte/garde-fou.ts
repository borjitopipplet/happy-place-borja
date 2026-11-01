// Garde-fou : le texte proposé par l'IA ne doit contenir aucune information absente du texte source.
// On vérifie ce qui se vérifie mécaniquement : nombres, noms propres, dates et moments, montants,
// adresses email et liens. Tout élément nouveau fait échouer la vérification.
// Module sans dépendance : utilisé par la fonction (Deno) et par les tests (Node).

export type Proposition = { titre: string; texte: string };
export type Verdict = { ok: true } | { ok: false; problemes: string[] };

export const MAX_MOTS_TEXTE = 110;
export const MAX_CAR_TITRE = 90;

/** Minuscules, sans accents, apostrophes unifiées. */
export function normaliser(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`]/g, "'")
    .toLowerCase();
}

const MOTS_NOMBRES: Record<string, string> = {
  deux: "2", trois: "3", quatre: "4", cinq: "5", six: "6", sept: "7", huit: "8", neuf: "9", dix: "10",
  onze: "11", douze: "12", treize: "13", quatorze: "14", quinze: "15", seize: "16", vingt: "20",
  trente: "30", quarante: "40", cinquante: "50", soixante: "60", cent: "100", cents: "100",
  mille: "1000", million: "1000000", millions: "1000000", milliard: "1000000000", milliards: "1000000000",
  // Mots qui expriment une quantité ou une évolution chiffrée.
  double: "x2", doubler: "x2", doublé: "x2", triple: "x3", tripler: "x3", moitie: "1/2",
  dizaine: "~10", dizaines: "~10", douzaine: "~12", vingtaine: "~20", trentaine: "~30",
  centaine: "~100", centaines: "~100", millier: "~1000", milliers: "~1000",
  record: "record", records: "record", pourcent: "%",
  // Source en espagnol ou en anglais (« très » est exclu : il devient « tres » une fois normalisé).
  dos: "2", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10", veinte: "20",
  cien: "100", ciento: "100", mil: "1000",
  two: "2", three: "3", four: "4", five: "5", seven: "7", eight: "8", nine: "9", ten: "10", twenty: "20",
  hundred: "100", thousand: "1000",
};

// Équivalents espagnols et anglais des mots de temps, pour une source écrite dans une autre langue.
const TEMPS_TRADUITS: Record<string, string[]> = {
  semana: ["semaine"], semanas: ["semaines", "semaine"], week: ["semaine"], weeks: ["semaines"],
  mes: ["mois"], meses: ["mois"], month: ["mois"], months: ["mois"],
  ano: ["annee", "an", "ans"], anos: ["annees", "ans"], year: ["annee", "an"], years: ["annees", "ans"],
  hoy: ["aujourd'hui", "aujourdhui"], today: ["aujourd'hui", "aujourdhui"],
  ayer: ["hier"], yesterday: ["hier"], manana: ["demain", "matin"], tomorrow: ["demain"],
  tarde: ["soir"], noche: ["soir"], trimestre: ["trimestre"], quarter: ["trimestre"],
  lunes: ["lundi"], martes: ["mardi"], miercoles: ["mercredi"], jueves: ["jeudi"], viernes: ["vendredi"],
  sabado: ["samedi"], domingo: ["dimanche"], monday: ["lundi"], tuesday: ["mardi"], wednesday: ["mercredi"],
  thursday: ["jeudi"], friday: ["vendredi"], saturday: ["samedi"], sunday: ["dimanche"],
  enero: ["janvier"], febrero: ["fevrier"], marzo: ["mars"], abril: ["avril"], mayo: ["mai"], junio: ["juin"],
  julio: ["juillet"], agosto: ["aout"], septiembre: ["septembre"], octubre: ["octobre"], noviembre: ["novembre"],
  diciembre: ["decembre"], january: ["janvier"], february: ["fevrier"], march: ["mars"], april: ["avril"],
  may: ["mai"], june: ["juin"], july: ["juillet"], august: ["aout"], september: ["septembre"],
  october: ["octobre"], november: ["novembre"], december: ["decembre"],
};

// Moments et dates : un texte qui parle de « demain » ou de « mars » sans que la source le dise invente.
const MOTS_TEMPS = new Set([
  "hier", "demain", "aujourd'hui", "aujourdhui", "semaine", "semaines", "mois", "annee", "annees", "an", "ans",
  "trimestre", "semestre", "matin", "soir", "week-end", "weekend", "bientot", "prochainement", "recemment",
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
  "janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
]);

// Mots courants qui peuvent ouvrir une phrase avec une majuscule sans être des noms propres.
const DEBUTS_COURANTS = new Set(
  (
    "a au aux avec apres avant ainsi alors attention aussi bonne bonnes bon bons belle beau bel bravo bienvenue bienvenu " +
    "bref c ca ce cela ces cet cette ceci chaque chez chers cher comme comment concretement cote d dans de des desormais " +
    "deja depuis du elle elles en encore enfin ensemble entre et etape felicitations grace gros grande grand grandes " +
    "grands hello ici il ils j je jusqu l la le les leur leurs lui m ma merci mes moins mon n ne ni nos notre nous " +
    "nouveau nouvelle nouvelles nouveaux on ou oui par parce parmi pas petit petite petites petits plus pour pourquoi " +
    "prochaine prochain prochaines prochains qu quand que quel quelle quelles quels qui quoi resultat s sa sans se ses " +
    "si son sous sur t ta te tes ton tous tout toute toutes toi tu un une vos votre vous voici voila y " +
    "objectif idee idees proposition projet equipe equipes cabinet client clients collaborateur collaborateurs " +
    "collegues collegue info infos annonce actualite actualites rappel point question suggestion amelioration " +
    "changement changements mise lancement arrivee arrivees nouveaute nouveautes besoin envie but pourquoi place " +
    "objectifs chantier semaine mois annee super joli jolie grosse sympa cool vraiment " +
    // Verbes courants en début de phrase (impératifs, invitations).
    "pensez venez rejoignez inscrivez hesitez rendez retrouvez decouvrez notez partagez profitez passez " +
    "contactez faites dites allez parlons rejoignons partageons ecrivez envoyez participez reservez " +
    "c'est voici place"
  ).split(/\s+/),
);

const ELISION = /^(?:qu|[ldjmnstc])'/;

function motsNormalises(s: string): Set<string> {
  const out = new Set<string>();
  for (const brut of normaliser(s).split(/[^\p{L}\p{N}'-]+/u)) {
    if (!brut) continue;
    const m = brut.replace(ELISION, "");
    out.add(m);
    for (const part of m.split("-")) if (part) out.add(part);
  }
  return out;
}

/** Nombres écrits en chiffres (« 1 500 », « 2,5 », « 20 % »), ramenés à une forme comparable. */
function nombres(s: string): Set<string> {
  const out = new Set<string>();
  const re = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;
  for (const m of s.match(re) ?? []) {
    const v = m.replace(/[ \u00a0\u202f]/g, "").replace(",", ".");
    out.add(String(Number(v)));
  }
  return out;
}

/** Nombres et quantités écrits en lettres, ramenés à la même forme que les chiffres. */
function quantitesEnLettres(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of motsNormalises(s)) if (m in MOTS_NOMBRES) out.add(MOTS_NOMBRES[m]);
  return out;
}

const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RE_LIEN = /\b(?:https?:\/\/|www\.)[^\s)]+/gi;

/** Mots qui commencent par une majuscule, avec un indicateur « en début de phrase ». */
function motsAvecMajuscule(s: string): { mot: string; debut: boolean }[] {
  const out: { mot: string; debut: boolean }[] = [];
  let debut = true;
  for (const brut of s.split(/(\s+)/)) {
    if (!brut.trim()) continue;
    const propre = brut.replace(/^[«"“(\[]+/, "").replace(/[»"”)\],;:!?.…]+$/, "");
    const sansElision = propre.replace(/^(?:[Qq]u|[LlDdJjMmNnSsTtCc])['’]/, "");
    if (/^\p{Lu}/u.test(sansElision)) out.push({ mot: sansElision, debut });
    debut = /[.!?…:]["»”)]*$/.test(brut);
  }
  return out;
}

export function verifierProposition(source: string, p: Proposition): Verdict {
  const problemes: string[] = [];
  const sortie = `${p.titre}\n${p.texte}`;

  if (!p.titre.trim()) problemes.push("Le titre est vide.");
  if (!p.texte.trim()) problemes.push("Le texte est vide.");
  if (p.titre.length > MAX_CAR_TITRE) problemes.push(`Le titre dépasse ${MAX_CAR_TITRE} caractères.`);
  const nbMots = p.texte.trim().split(/\s+/).filter(Boolean).length;
  if (nbMots > MAX_MOTS_TEXTE) problemes.push(`Le texte dépasse ${MAX_MOTS_TEXTE} mots (${nbMots}).`);

  // 1. Nombres et quantités : tout ce qui est chiffré dans la sortie doit l'être dans la source.
  const nbSource = new Set([...nombres(source), ...quantitesEnLettres(source)]);
  for (const n of [...nombres(sortie), ...quantitesEnLettres(sortie)]) {
    if (!nbSource.has(n)) problemes.push(`Nombre ou quantité absent de la source : « ${n} ».`);
  }
  if (/%|pour ?cent/i.test(sortie) && !/%|pour ?cent/i.test(source)) problemes.push("Pourcentage absent de la source.");
  for (const devise of ["€", "$", "£"]) {
    if (sortie.includes(devise) && !source.includes(devise)) problemes.push(`Montant (${devise}) absent de la source.`);
  }
  if (/\beuros?\b/i.test(sortie) && !/\beuros?\b|€/i.test(source)) problemes.push("Montant en euros absent de la source.");

  // 2. Moments et dates.
  const motsSource = motsNormalises(source);
  const tempsSource = new Set(motsSource);
  for (const m of motsSource) for (const fr of TEMPS_TRADUITS[m] ?? []) tempsSource.add(fr);
  for (const m of motsNormalises(sortie)) {
    if (MOTS_TEMPS.has(m) && !tempsSource.has(m)) problemes.push(`Indication de temps absente de la source : « ${m} ».`);
  }

  // 3. Emails et liens.
  const srcNorm = normaliser(source);
  for (const e of sortie.match(RE_EMAIL) ?? []) {
    if (!srcNorm.includes(normaliser(e))) problemes.push(`Adresse email absente de la source : « ${e} ».`);
  }
  for (const l of sortie.match(RE_LIEN) ?? []) {
    const nettoye = l.replace(/[.,;:!?]+$/, "");
    if (!srcNorm.includes(normaliser(nettoye))) problemes.push(`Lien absent de la source : « ${nettoye} ».`);
  }

  // 4. Noms propres : un mot à majuscule doit figurer dans la source (sauf mot courant en début de phrase).
  const signales = new Set<string>();
  const majuscules = [...motsAvecMajuscule(p.titre), ...motsAvecMajuscule(p.texte)];
  for (const { mot, debut } of majuscules) {
    const parts = normaliser(mot).split("-").filter(Boolean);
    if (parts.every((x) => motsSource.has(x))) continue;
    if (parts.every((x) => x in MOTS_NOMBRES || MOTS_TEMPS.has(x))) continue; // déjà vérifiés plus haut
    if (debut && parts.length === 1 && DEBUTS_COURANTS.has(parts[0])) continue;
    if (!signales.has(mot)) {
      signales.add(mot);
      problemes.push(`Nom propre ou mot absent de la source : « ${mot} ».`);
    }
  }

  return problemes.length ? { ok: false, problemes: [...new Set(problemes)] } : { ok: true };
}

// Exporté pour les tests.
export const _interne = { nombres, quantitesEnLettres, motsAvecMajuscule, motsNormalises };
