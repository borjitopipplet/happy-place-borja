// Lancer : node --test supabase/functions/ameliorer-texte/garde-fou.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifierProposition } from "./garde-fou.ts";

const ok = (source: string, titre: string, texte: string) => {
  const v = verifierProposition(source, { titre, texte });
  assert.deepEqual(v, { ok: true }, JSON.stringify(v));
};
const ko = (source: string, titre: string, texte: string, attendu: RegExp) => {
  const v = verifierProposition(source, { titre, texte });
  assert.equal(v.ok, false, "aurait dû être refusé");
  if (!v.ok) assert.ok(v.problemes.some((p) => attendu.test(p)), v.problemes.join(" | "));
};

// --- Reformulations fidèles : doivent passer ---

test("clients ajoutés, reformulation fidèle", () =>
  ok(
    "cette semaine on a ajouté 3 nouveaux clients : Decathlon, Leroy Merlin et la Mairie de Lyon",
    "Trois nouveaux clients rejoignent le cabinet",
    "Bonne nouvelle : cette semaine, 3 nouveaux clients nous ont fait confiance. Decathlon, Leroy Merlin et la Mairie de Lyon rejoignent la liste. Merci à toutes celles et ceux qui ont rendu ça possible !",
  ));

test("idée simple sans chiffres", () =>
  ok(
    "proposer une machine à café dans la salle de réunion du 2e étage",
    "Une machine à café en salle de réunion",
    "Et si on installait une machine à café dans la salle de réunion du 2e étage ? Les réunions seraient plus conviviales. C'est une petite idée, mais elle pourrait faire du bien à tout le monde.",
  ));

test("source en espagnol, sortie en français, nombre recopié", () =>
  ok(
    "esta semana hemos cerrado 12 contratos con el equipo RH",
    "12 contrats signés par l'équipe RH",
    "Belle semaine pour l'équipe RH : 12 contrats ont été signés. Bravo à toute l'équipe pour ce travail !",
  ));

test("milliers avec espace et pourcentage présents dans la source", () =>
  ok(
    "le chiffre d'affaires du T3 est de 1 500 000 €, soit +8 % par rapport à l'an dernier",
    "Un beau T3",
    "Le chiffre d'affaires du T3 atteint 1 500 000 €, soit +8 % par rapport à l'an dernier. Merci à tous pour cet effort collectif.",
  ));

test("nombre en lettres équivalent au chiffre de la source", () =>
  ok("on accueille 2 stagiaires", "Deux stagiaires nous rejoignent", "Nous accueillons deux stagiaires. Pensez à leur faire bon accueil !"));

// --- Inventions : doivent être refusées ---

test("chiffre inventé", () =>
  ko(
    "on a ajouté des clients cette semaine",
    "Nouveaux clients",
    "Cette semaine, 5 nouveaux clients nous ont rejoints. Bravo à tous !",
    /Nombre.*5/,
  ));

test("pourcentage inventé", () =>
  ko(
    "on a signé 3 clients",
    "3 nouveaux clients",
    "3 nouveaux clients signés, de quoi faire grimper l'activité de 20 % !",
    /Nombre.*20|Pourcentage/,
  ));

test("nom propre inventé", () =>
  ko(
    "nouveau client dans la grande distribution",
    "Un nouveau client",
    "Un nouveau client nous rejoint : Carrefour fait désormais confiance au cabinet.",
    /Carrefour/,
  ));

test("prénom inventé en début de phrase", () =>
  ko(
    "un nouveau collègue arrive dans l'équipe compta",
    "Bienvenue dans l'équipe compta",
    "Julien rejoint l'équipe compta. Bienvenue à lui !",
    /Julien/,
  ));

test("date inventée", () =>
  ko(
    "la formation Excel est confirmée",
    "Formation Excel confirmée",
    "La formation Excel est confirmée pour mardi. Inscrivez-vous vite !",
    /mardi/,
  ));

test("montant inventé", () =>
  ko(
    "on a gagné l'appel d'offres de la région",
    "Appel d'offres gagné",
    "On a gagné l'appel d'offres de la région, un contrat de 200 000 €.",
    /Nombre|Montant/,
  ));

test("quantité en lettres inventée", () =>
  ko(
    "plusieurs clients nous ont rejoints",
    "Des clients en plus",
    "Une dizaine de clients nous ont rejoints, c'est un record !",
    /quantité/,
  ));

test("lien inventé", () =>
  ko(
    "inscriptions ouvertes pour l'afterwork",
    "Afterwork : inscriptions ouvertes",
    "Les inscriptions pour l'afterwork sont ouvertes sur https://exemple.fr/afterwork.",
    /Lien/,
  ));

test("texte trop long", () =>
  ko("idée", "Une idée", Array(130).fill("mot").join(" "), /dépasse/));
