import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorSummary, Field, FormActions, Modal, TextArea, TextInput } from "@/components/manage/crud-ui";
import { rejectionSchema, submissionSchema, validate, type FieldErrors } from "@/lib/manage-schemas";
import { BrandHeader } from "@/components/brand-header";
import { Icon } from "@/components/icon";
import { MyBlockerProposals, ProposeBlockerModal } from "@/components/blocker-proposals";
import { RecipientPicker, forWhomText } from "@/components/recipient-picker";
import { MyIdeas } from "@/components/my-ideas";
import { Tour } from "@/components/tour";
import { accueilTourSteps, tourKey } from "@/lib/tours";
import { CharCounter, rejectionErrorMessage } from "@/components/expandable-card";
import { SubmissionReader } from "@/components/submission-reader";
import { NewsReader } from "@/components/news-reader";
import { DepartureNotices } from "@/components/departure-notices";
import { NewsImage, NewsLinks } from "@/components/news-media";
import { BlockerArchive, ValidatedSubmissions } from "@/components/dashboard-extras";
import { Button } from "@/components/ui/button";
import {
  fetchBlockers,
  fetchTeamNames,
  fetchDecisions,
  ATTACHMENT_TYPES,
  fetchMetrics,
  deltaText,
  fetchNews,
  fetchSubmissions,
  fetchMySubmissions,
  exportMyRecentSubmissions,
  REJECTION_CATEGORIES,
  type News,
  type Submission,
  saveDraftNews,
  publishDraftNews,
  deleteDraftNews,
  reviewSubmission,
  submitIdea,
  timeAgo,
  updateBlockerStatus,
  updateMetric,
  TREND_LABELS,
  type Metric,
  type SubmissionInput,
} from "@/lib/dashboard";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Happy Place — Actualités et vue d'ensemble" },
      {
        name: "description",
        content:
          "Pilotez les missions de recrutement IT et digital, les propositions des équipes, les alertes opérationnelles et les indicateurs du cabinet.",
      },
      { property: "og:title", content: "Happy Place — Vue d'ensemble" },
      {
        property: "og:description",
        content:
          "Suivez l'activité du cabinet, les missions de recrutement, les alertes et les indicateurs clés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ManagerSpace,
});

function trendText(m: Metric | undefined) {
  return m ? TREND_LABELS[m.trend] : "";
}

function metricOf(metrics: Metric[] | undefined, key: string) {
  return metrics?.find((m) => m.key === key);
}

function formatMetric(m: Metric | undefined, fallback: string) {
  if (!m) return fallback;
  const v = Number(m.value);
  const formatted = m.unit === "%" ? v.toFixed(1) : v.toLocaleString("fr-FR");
  return `${formatted}${m.unit ?? ""}`;
}

function metricLabel(metric: Metric | undefined, fallback: string) {
  if (!metric) return fallback;
  if (metric.key === "training_kpi") return "Taux de placement";
  if (metric.key === "active_users") return "Missions actives";
  return metric.label;
}

function ManagerSpace() {
  const qc = useQueryClient();
  const { role, email, user } = Route.useRouteContext();
  const isAdmin = role === "admin";
  const canReview = role === "admin" || role === "manager";
  const myEmail = (email ?? "").toLowerCase();
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const myName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    myEmail;
  const [nps, setNps] = useState<string>("");
  const [submissionForm, setSubmissionForm] = useState<SubmissionInput | null>(null);
  const [submissionErrors, setSubmissionErrors] = useState<FieldErrors>({});
  const myTeams = useQuery({
    queryKey: ["manager_teams", "mine", email],
    enabled: role === "manager" && !!email,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_teams")
        .select("team, allowed_users!inner(email)")
        .eq("allowed_users.email", (email ?? "").toLowerCase());
      if (error) throw error;
      return (data ?? []).map((t) => t.team).sort();
    },
  });
  const profile = useQuery({
    queryKey: ["profile", myEmail],
    enabled: !!myEmail,
    queryFn: async () => {
      const { data, error } = await supabase.from("allowed_users").select("first_name, last_name").eq("email", myEmail).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const firstName = profile.data?.first_name ?? "";
  const fullName = [profile.data?.first_name, profile.data?.last_name].filter(Boolean).join(" ") || myName;
  const teamNames = useQuery({ queryKey: ["teams", "names"], queryFn: fetchTeamNames, retry: false });
  const [recipientScope, setRecipientScope] = useState<"all" | "teams">("all");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [reading, setReading] = useState<Submission | null>(null);
  const [readingNews, setReadingNews] = useState<News | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const news = useQuery({ queryKey: ["news"], queryFn: fetchNews, retry: false });
  const mine = useQuery({
    queryKey: ["submissions", "mine", email],
    queryFn: () => fetchMySubmissions(email ?? ""),
    enabled: !!email,
    retry: false,
  });
  const myIds = (mine.data ?? []).map((m) => m.id);
  const decisions = useQuery({
    queryKey: ["decisions", myIds],
    queryFn: () => fetchDecisions(myIds),
    enabled: myIds.length > 0,
    retry: false,
  });
  const blockers = useQuery({ queryKey: ["blockers"], queryFn: fetchBlockers, retry: false });
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: fetchMetrics, retry: false });
  const onError = (e: unknown) => toast.error((e as Error).message);

  const exportReport = useMutation({
    mutationFn: () => {
      if (!email) throw new Error("Votre adresse e-mail est indisponible.");
      return exportMyRecentSubmissions(email);
    },
    onSuccess: (count) => {
      if (count === 0) {
        toast.info("Aucune soumission en attente ou validée sur les 30 derniers jours.");
        return;
      }
      toast.success(`${count} soumission${count > 1 ? "s" : ""} exportée${count > 1 ? "s" : ""} au format CSV.`);
    },
    onError,
  });

  const submit = useMutation({
    mutationFn: (input: SubmissionInput) => submitIdea({
      author_name: input.author_name,
      team: input.team,
      content: input.content,
      recipient_teams: input.recipient_teams,
    }, attachment),
    onSuccess: () => {
      setSubmissionForm(null);
      setAttachment(null);
      setSubmissionErrors({});
      toast.success("Soumission envoyée");
      qc.invalidateQueries({ queryKey: ["submissions"] });
    },
    onError: (e: unknown) => toast.error(rejectionErrorMessage(e)),
  });

  const setBlocker = useMutation({
    mutationFn: updateBlockerStatus,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blockers"] }),
    onError,
  });

  const saveMetric = useMutation({
    mutationFn: updateMetric,
    onSuccess: () => {
      toast.success("KPI mis à jour");
      qc.invalidateQueries({ queryKey: ["metrics"] });
    },
    onError,
  });

  const published = news.data?.filter((n) => n.status === "publiée") ?? [];
  const [newsTeam, setNewsTeam] = useState("");
  const [newsLimit, setNewsLimit] = useState(4);
  const filteredNews = published.filter(
    (n) => !newsTeam || !n.recipient_teams?.length || n.recipient_teams.includes(newsTeam),
  );
  const shownNews = filteredNews.slice(0, newsLimit);
  const npsMetric = metricOf(metrics.data, "nps");

  function sendSubmission(e: React.FormEvent) {
    e.preventDefault();
    if (!submissionForm) return;
    // Collaborators: team is set server-side from their account
    // Admin: always the « Admin » team (set server-side); manager: one of their teams
    const team = role === "collaborateur" ? "auto" : role === "admin" ? "Admin" : submissionForm.team;
    if (recipientScope === "teams" && !submissionForm.recipient_teams?.length) {
      setSubmissionErrors({ recipient_teams: "Choisis au moins une équipe, ou « Tout le cabinet »." });
      return;
    }
    const result = validate(submissionSchema, {
      ...submissionForm,
      author_name: fullName,
      team,
      status: "en attente",
      recipient_teams: recipientScope === "all" ? [] : submissionForm.recipient_teams,
    });
    if (!result.ok) {
      setSubmissionErrors(result.errors);
      return;
    }
    setSubmissionErrors({});
    submit.mutate(result.data);
  }

  const [proposeOpen, setProposeOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    // Première visite : la visite guidée s'ouvre seule, une fois.
    // Petit délai : l'en-tête et les listes doivent être affichés pour que les bulles trouvent leur cible.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!localStorage.getItem(tourKey("accueil", role))) timer = setTimeout(() => setTourOpen(true), 1500);
    } catch {
      /* stockage indisponible : la visite reste accessible par le bouton */
    }
    return () => clearTimeout(timer);
  }, []);
  function closeTour() {
    setTourOpen(false);
    try {
      localStorage.setItem(tourKey("accueil", role), "1");
    } catch {
      /* ignoré */
    }
  }
  const tourSteps = accueilTourSteps(role);

  return (
    <div className="bg-background text-on-surface font-body-md min-h-screen flex flex-col">
      <BrandHeader />
      <Tour steps={tourSteps} open={tourOpen} onClose={closeTour} />
      <main className="flex-grow w-full max-w-interface mx-auto p-sm md:p-md space-y-md">
        {email && <DepartureNotices email={email} />}
        <div className="flex flex-col gap-sm md:flex-row md:items-end md:justify-between">
          <div className="space-y-xs">
            <h1 className="font-headline-lg text-headline-lg text-primary">
              {firstName ? `Bonjour, ${firstName}` : "Bonjour"}
            </h1>
            <p className="font-body-md text-on-surface-variant">Voici ce qui bouge au cabinet.</p>
          </div>
          <div className="flex flex-wrap items-center gap-xs">
            <button
              id="tour-new-idea"
              type="button"
              onClick={() => {
                setSubmissionErrors({});
                const only = role === "manager" && myTeams.data?.length === 1 ? myTeams.data[0] : "";
                setRecipientScope("all");
                setSubmissionForm({ author_name: "", team: only, content: "", status: "en attente", recipient_teams: [] });
              }}
              className="inline-flex min-h-11 items-center gap-xs rounded-md bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Icon name="add" /> Soumettre une idée
            </button>
            <Button
              type="button"
              variant="outline"
              disabled={exportReport.isPending}
              onClick={() => exportReport.mutate()}
              className="h-auto min-h-11 rounded-md border-primary bg-transparent px-md py-xs font-label-md text-label-md text-primary shadow-none hover:bg-surface-container"
            >
              <Icon name="file_download" /> {exportReport.isPending ? "Export en cours…" : "Exporter le rapport"}
            </Button>
            <button
              type="button"
              onClick={() => setTourOpen(true)}
              className="inline-flex min-h-11 items-center gap-xs rounded-md px-sm font-label-md text-label-md text-primary underline-offset-2 hover:underline"
            >
              <Icon name="help" /> Visite guidée
            </button>
          </div>
        </div>

        <div className="bento-grid">
          {/* Actualités publiées */}
          <section
            id="tour-news"
            className="col-span-12 bg-surface-container-lowest border border-outline-variant p-md flex flex-col gap-md"
          >
            <div className="flex items-center justify-between border-b border-outline-variant pb-sm">
              <h2 className="font-headline-sm text-headline-sm text-primary">
                Actualités du cabinet
              </h2>
            </div>
            <div>
              <div className="mb-sm flex flex-wrap items-center justify-between gap-xs">
                <h3 className="font-label-md text-label-md text-on-surface-variant">Publiées récemment</h3>
                <label className="flex items-center gap-xs font-label-sm text-label-sm text-on-surface-variant">
                  Équipe
                  <select
                    id="tour-news-filter"
                    value={newsTeam}
                    onChange={(e) => {
                      setNewsTeam(e.target.value);
                      setNewsLimit(4);
                    }}
                    className="min-h-11 rounded-md border border-outline-variant bg-card px-xs font-body-sm text-primary"
                  >
                    <option value="">Toutes les équipes</option>
                    {(teamNames.data ?? []).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="space-y-xs">
                {news.isLoading && (
                  <p className="text-body-sm text-on-surface-variant">Chargement…</p>
                )}
                {news.isError && (
                  <p className="text-body-sm text-error">
                    Les actualités sont indisponibles.
                  </p>
                )}
                {shownNews.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    onClick={() => setReadingNews(n)}
                    aria-haspopup="dialog"
                    className="w-full text-left p-sm bg-surface-container hover:bg-surface-container-high transition-colors cursor-pointer group min-w-0 overflow-hidden space-y-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {n.image_path && <NewsImage path={n.image_path} alt={n.title} />}
                    <div className="flex items-center justify-between gap-sm min-w-0">
                    <div className="flex items-center gap-md min-w-0">
                      <Icon name="article" className="text-on-surface-variant" />
                      <div className="min-w-0">
                        <p className="font-body-md text-primary group-hover:underline wrap-anywhere">{n.title}</p>
                        <p className="text-xs text-on-surface-variant uppercase font-label-sm">
                          Publiée {timeAgo(n.created_at)} • Par {n.author} • {forWhomText(n.recipient_teams)}
                        </p>
                      </div>
                    </div>
                    {isAdmin && <Icon name="edit" className="text-on-surface-variant" />}
                    </div>
                    <NewsLinks links={n.links} />
                  </button>
                ))}
                {!news.isLoading && filteredNews.length === 0 && (
                  <p className="text-body-sm text-on-surface-variant italic">Aucune actualité pour cette équipe.</p>
                )}
                {filteredNews.length > newsLimit && (
                  <button
                    type="button"
                    onClick={() => setNewsLimit((n) => n + 4)}
                    className="min-h-11 rounded-md border border-primary px-md font-label-md text-label-md text-primary hover:bg-surface-container"
                  >
                    Afficher plus
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Mes idées */}
          {mine.data && mine.data.length > 0 && (
            <section
              id="tour-my-ideas"
              className="col-span-12 min-w-0 bg-surface-container-lowest border border-outline-variant rounded-md p-md"
            >
              <h2 className="font-headline-sm text-headline-sm text-primary border-b border-outline-variant pb-sm mb-md">
                Mes idées
              </h2>
              <MyIdeas items={mine.data} decisions={decisions.data} />
            </section>
          )}

          <ValidatedSubmissions
            role={role}
            email={myEmail}
            managerTeams={myTeams.data ?? []}
            onRead={setReading}
          />

          {/* Points Bloquants */}
          <section
            id="tour-blockers"
            className="col-span-12 md:col-span-7 bg-surface-container-lowest border border-outline-variant p-md"
          >
            <div className="flex items-center justify-between mb-md">
              <div className="flex items-center gap-sm">
                <h2 className="font-headline-sm text-headline-sm text-primary">Points Bloquants</h2>
                <span className="text-xs bg-error-container text-on-error-container px-xs py-1 font-label-sm">
                  PRIORITÉ HAUTE
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-xs">
              <button
                id="tour-blocker-propose"
                type="button"
                onClick={() => setProposeOpen(true)}
                className="inline-flex min-h-11 items-center gap-xs rounded-md border border-primary px-sm font-label-md text-label-md text-primary hover:bg-surface-container"
              >
                <Icon name="add" /> Proposer
              </button>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setArchiveOpen(true)}
                className="min-h-11 px-xs text-primary font-label-sm text-label-sm underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Voir l'archive
              </button>
              </div>
            </div>
            <div className="space-y-sm">
              {blockers.isError && (
                <p className="text-body-sm text-error">
                  Les points bloquants sont indisponibles.
                </p>
              )}
              {blockers.data?.length === 0 && (
                <p className="text-body-sm text-on-surface-variant italic">
                  Aucun point bloquant en cours.
                </p>
              )}
              {blockers.data?.map((b) => {
                const critical = b.severity === "critical";
                return (
                  <div
                    key={b.id}
                    className={`${critical ? "accent-bar " : ""}bg-card border border-outline-variant p-sm flex items-start justify-between`}
                  >
                    <div className="flex gap-md">
                      <Icon
                        name={critical ? "error" : "warning"}
                        className={
                          critical
                            ? "text-error mt-1 [font-variation-settings:'FILL'_1]"
                            : "text-secondary mt-1"
                        }
                      />
                      <div>
                        <p className="font-body-md text-primary font-bold">{b.title}</p>
                        <p className="text-body-sm text-on-surface-variant">{b.description}</p>
                        <div className="flex items-center gap-sm mt-xs">
                          <span className="text-xs font-label-sm bg-surface-container-highest px-xs py-0.5">
                            {b.department}
                          </span>
                          <span className="text-xs font-label-sm text-on-surface-variant">
                            Mis à jour {timeAgo(b.updated_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {isAdmin ? (
                    <select
                      aria-label={`Statut de ${b.title}`}
                      value={b.status}
                      onChange={(e) => setBlocker.mutate({ id: b.id, status: e.target.value })}
                      className={`min-h-11 rounded-md border border-outline-variant bg-card px-xs text-xs font-label-sm cursor-pointer focus-visible:ring-2 focus-visible:ring-primary ${critical ? "text-error" : "text-on-surface-variant"}`}
                    >
                      <option>OUVERT</option>
                      <option>EN COURS</option>
                      <option>SURVEILLANCE</option>
                      <option
                        disabled={b.status === "OUVERT"}
                        title={b.status === "OUVERT" ? "Passe d'abord par EN COURS" : undefined}
                      >
                        RÉSOLU
                      </option>
                    </select>
                    ) : (
                      <span className={`shrink-0 font-label-sm text-label-sm ${critical ? "text-error" : "text-on-surface-variant"}`}>
                        {b.status}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {email && <MyBlockerProposals email={email} />}
          </section>

          {/* Indicateurs */}
          <section
            id="tour-indicators"
            className="col-span-12 md:col-span-5 bg-surface-container-lowest border border-outline-variant rounded-md p-md flex flex-col gap-sm"
          >
            <h2 className="font-headline-sm text-headline-sm text-primary">Indicateurs</h2>
            <div className="grid grid-cols-2 gap-sm">
              {[
                { key: "training_kpi", fallback: "Taux de placement" },
                { key: "active_users", fallback: "Missions actives" },
              ].map(({ key, fallback }) => {
                const m = metricOf(metrics.data, key);
                const delta = deltaText(m);
                return (
                  <div key={key} className="rounded-md bg-secondary-fixed p-sm">
                    <p className="font-label-sm text-label-sm text-on-surface-variant">{metricLabel(m, fallback)}</p>
                    <p className="font-display text-3xl font-black text-primary [font-stretch:75%]">
                      {formatMetric(m, "—")}
                    </p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant">
                      {trendText(m)}
                      {delta && ` · ${delta}`}
                    </p>
                  </div>
                );
              })}
            </div>
            {isAdmin && (
              <div className="space-y-xs border-t border-outline-variant pt-sm">
                <label htmlFor="nps-input" className="font-label-sm text-label-sm text-on-surface-variant block">
                  Modifier le NPS candidats
                </label>
                <div className="flex gap-xs">
                  <input
                    id="nps-input"
                    className="min-h-11 flex-grow rounded-md bg-card border border-outline-variant p-xs font-label-md focus:outline-none focus:border-primary"
                    type="number"
                    value={nps !== "" ? nps : (npsMetric?.value ?? "")}
                    onChange={(e) => setNps(e.target.value)}
                  />
                  <button
                    onClick={() =>
                      saveMetric.mutate({
                        key: "nps",
                        value: Number(nps !== "" ? nps : (npsMetric?.value ?? 0)),
                      })
                    }
                    disabled={saveMetric.isPending}
                    className="min-h-11 rounded-md bg-primary text-on-primary px-sm font-label-md text-label-md disabled:opacity-50"
                  >
                    Mettre à jour
                  </button>
                </div>
                <p className="font-label-sm text-label-sm text-on-surface-variant">
                  {npsMetric
                    ? `Tendance : ${trendText(npsMetric)}${deltaText(npsMetric) ? ` · ${deltaText(npsMetric)}` : ""}`
                    : "Mis à jour à partir des retours candidats."}
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
      {proposeOpen && <ProposeBlockerModal managerTeams={role === "manager" ? (myTeams.data ?? []) : []} onClose={() => setProposeOpen(false)} />}
      <BlockerArchive open={archiveOpen} onClose={() => setArchiveOpen(false)} />
      <NewsReader news={readingNews} onClose={() => setReadingNews(null)} />
      <SubmissionReader submission={reading} onClose={() => setReading(null)} />
      {submissionForm && (
        <Modal title="Soumettre une idée" onClose={() => setSubmissionForm(null)}>
          <form onSubmit={sendSubmission} className="space-y-sm" noValidate>
            <ErrorSummary errors={submissionErrors} />
            <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
              <div>
                <p className="font-label-md text-label-md text-on-surface-variant">Nom</p>
                <p className="mt-1 min-h-11 rounded-md bg-surface-container px-sm py-xs font-body-md text-primary">{fullName}</p>
              </div>
              <div>
                <p className="font-label-md text-label-md text-on-surface-variant">Email de contact</p>
                <p className="mt-1 min-h-11 rounded-md bg-surface-container px-sm py-xs font-body-md text-primary wrap-anywhere">{email}</p>
              </div>
            </div>
            {role === "manager" && (
              <Field label="Équipe" error={submissionErrors.team}>
                <select
                  required
                  value={submissionForm.team}
                  onChange={(e) => setSubmissionForm({ ...submissionForm, team: e.target.value })}
                  className="w-full border border-outline-variant bg-surface px-sm py-xs font-body-md"
                >
                  <option value="">Choisis une de tes équipes</option>
                  {myTeams.data?.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
            )}
            {role === "admin" && (
              <p className="text-body-sm text-on-surface-variant">Équipe : Admin</p>
            )}
            <RecipientPicker
              name="idea-recipients"
              scope={recipientScope}
              onScopeChange={setRecipientScope}
              value={submissionForm.recipient_teams ?? []}
              onChange={(v) => setSubmissionForm({ ...submissionForm, recipient_teams: v })}
              teams={teamNames.data ?? []}
              error={submissionErrors.recipient_teams}
            />
            <Field label="Proposition" error={submissionErrors.content}>
              <TextArea
                rows={5}
                value={submissionForm.content}
                placeholder="Décris l'amélioration proposée pour le cabinet…"
                onChange={(e) => setSubmissionForm({ ...submissionForm, content: e.target.value })}
              />
              <CharCounter value={submissionForm.content} max={2000} min={5} />
            </Field>
            <Field label="Pièce jointe (optionnelle : PDF, PNG ou JPG, 20 Mo max)" error={submissionErrors.attachment}>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
                className="block w-full text-body-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && !(f.type in ATTACHMENT_TYPES)) {
                    setSubmissionErrors({ ...submissionErrors, attachment: "Seuls les fichiers PDF, PNG et JPG sont acceptés." });
                    e.target.value = ""; setAttachment(null); return;
                  }
                  if (f && f.size > 20 * 1024 * 1024) {
                    setSubmissionErrors({ ...submissionErrors, attachment: "Le fichier dépasse 20 Mo." });
                    e.target.value = ""; setAttachment(null); return;
                  }
                  const { attachment: _a, ...rest } = submissionErrors;
                  setSubmissionErrors(rest);
                  setAttachment(f);
                }}
              />
            </Field>
            <FormActions
              pending={submit.isPending}
              submitLabel="ENVOYER"
              onCancel={() => setSubmissionForm(null)}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}
