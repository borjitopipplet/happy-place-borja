import type { TourStep } from "@/components/tour";
import type { AppRole } from "@/lib/auth";

/** Une visite par rôle et par page : chacun ne voit que ce qu'il peut vraiment faire. */
export const tourKey = (page: "accueil" | "traiter", role: AppRole) => `hp-visite-v2-${page}-${role}`;

export function accueilTourSteps(role: AppRole): TourStep[] {
  const staff = role === "manager" || role === "admin";
  const steps: TourStep[] = [
    {
      target: "#tour-new-idea",
      title: "Une idée pour le cabinet ?",
      body:
        role === "collaborateur"
          ? "Écris-la ici. Ton manager la reçoit, et tu retrouves sa réponse plus bas, dans « Mes idées »."
          : role === "manager"
            ? "Toi aussi, tu peux proposer une idée : choisis l'une de tes équipes et pour qui elle est. Elle arrive dans « À traiter »."
            : "Tu peux aussi proposer une idée. Elle est rattachée à l'équipe « Admin » et arrive dans « À traiter ».",
    },
  ];
  if (staff) {
    steps.push({
      target: "#tour-nav-traiter",
      title: "Ton espace « À traiter »",
      body:
        role === "manager"
          ? "C'est ton poste de travail : les idées de tes équipes à valider ou refuser, les actualités à rédiger et les points bloquants à confirmer. Une visite dédiée t'y attend."
          : "C'est le poste de travail : toutes les idées à valider ou refuser, les actualités à rédiger, les points bloquants à confirmer ou à relancer. Une visite dédiée t'y attend.",
    });
  }
  if (role === "admin") {
    steps.push({
      target: "#tour-nav-data",
      title: "Gérer les données",
      body: "Actualités, soumissions, points bloquants, indicateurs et utilisateurs autorisés : tout se modifie ici. C'est réservé aux admins.",
    });
  }
  steps.push({
    target: "#tour-news",
    title: "Les actualités du cabinet",
    body: staff
      ? "Ce qui est publié, avec « Pour : … » et un filtre par équipe. Tu rédiges et publies depuis « À traiter »."
      : "Ce qui a été décidé et publié, avec pour qui. Filtre par équipe, et clique sur une actualité pour la lire en entier.",
  });
  steps.push({
    target: "#tour-blockers",
    title: "Les points bloquants",
    body:
      role === "admin"
        ? "Tu changes le statut de chaque point directement ici. Un point OUVERT passe d'abord par EN COURS avant d'être RÉSOLU. « Proposer » sert à en suggérer un."
        : role === "manager"
          ? "Ce qui freine les équipes. Tu changes le statut de ceux de tes équipes (c'est toi qui valides qu'ils sont résolus) et tu peux en proposer un."
          : "Ce qui freine les équipes en ce moment. Un blocage que tu vois ? Propose-le : le manager de ton équipe le confirme.",
  });
  if (role === "admin") {
    steps.push({
      target: "#tour-indicators",
      title: "Les indicateurs",
      body: "Tu mets à jour le NPS ici. Les autres indicateurs se règlent dans « Gérer les données ».",
    });
  }
  steps.push({
    target: "#tour-my-ideas",
    title: "Mes idées",
    body: "Chaque idée s'ouvre pour montrer son statut, qui a décidé et, si elle est refusée, le motif.",
  });
  steps.push({
    target: "#tour-account",
    title: "Ton compte",
    body: "Tu peux te déconnecter ou changer de rôle ici. Tu peux relancer cette visite à tout moment.",
  });
  return steps;
}

export function traiterTourSteps(role: AppRole): TourStep[] {
  const admin = role === "admin";
  return [
    {
      target: "#tour-traiter-ideas",
      title: "Les idées en attente",
      body: admin
        ? "Les idées de tout le cabinet, les plus anciennes d'abord. « En retard » signale plus de 7 jours sans réponse. Copie l'email de la personne pour la contacter."
        : "Les idées de tes équipes, les plus anciennes d'abord. « En retard » signale plus de 7 jours sans réponse. Copie l'email de la personne pour la contacter : tu peux lire son idée, pas la modifier.",
    },
    {
      target: "#tour-decision",
      title: "Valider ou refuser",
      body: "« Valider » publie l'idée dans les demandes validées. « Refuser » demande un motif et une raison, que la personne lira. Après chaque décision, tu as 8 secondes pour annuler.",
    },
    {
      target: "#tour-traiter-news",
      title: "Rédiger une actualité",
      body: admin
        ? "Titre, contenu, pour qui, média ou lien. Elle reste en brouillon jusqu'à « Publier ». Tu gères tous les brouillons."
        : "Titre, contenu, pour qui, média ou lien. Elle reste en brouillon jusqu'à « Publier ». Tu gères tes propres brouillons.",
    },
    {
      target: "#tour-traiter-proposals",
      title: "Points bloquants à confirmer",
      body: admin
        ? "Les propositions de tous les collaborateurs. Ajuste la priorité puis « Confirmer », ou « Refuser » avec une raison obligatoire."
        : "Les propositions des collaborateurs de ton équipe. Ajuste la priorité puis « Confirmer », ou « Refuser » avec une raison obligatoire, que la personne lira.",
    },
    {
      target: "#tour-traiter-stale",
      title: "À relancer",
      body: admin
        ? "Les points bloquants sans mise à jour depuis plus de 7 jours. Change leur statut ici pour les remettre à jour."
        : "Les points bloquants sans mise à jour depuis plus de 7 jours. Tu changes le statut de ceux de tes équipes ; pour les autres, tu relances le manager concerné.",
    },
  ];
}
