import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ErrorSummary, Field, FormActions, Modal, TextArea } from "@/components/manage/crud-ui";
import { rejectionSchema, validate, type FieldErrors } from "@/lib/manage-schemas";
import { BrandHeader } from "@/components/brand-header";
import { Icon } from "@/components/icon";
import { Tour } from "@/components/tour";
import { traiterTourSteps, tourKey } from "@/lib/tours";
import { ProposalsToConfirm } from "@/components/blocker-proposals";
import { RecipientPicker, forWhomText } from "@/components/recipient-picker";
import { daysSince, LATE_AFTER_DAYS, STALE_BLOCKER_DAYS } from "@/lib/delays";
import { AttachmentLink } from "@/components/attachment-link";
import { CharCounter, SubmissionPreview, rejectionErrorMessage } from "@/components/expandable-card";
import { SubmissionReader } from "@/components/submission-reader";
import { NewsMediaEditor } from "@/components/news-media";
import { emptyMedia, linkErrors, mediaFromNews, toNewsLinks, type MediaDraft } from "@/lib/news-media";
import {
  fetchNews,
  fetchEditableNewsIds,
  fetchTeamNames,
  fetchBlockers,
  updateBlockerStatus,
  fetchSubmissions,
  REJECTION_CATEGORIES,
  type Submission,
  saveDraftNews,
  publishDraftNews,
  deleteDraftNews,
  reviewSubmission,
  timeAgo,
} from "@/lib/dashboard";

export const Route = createFileRoute("/_authenticated/a-traiter")({
  head: () => ({
    meta: [
      { title: "À traiter — Happy Place" },
      {
        name: "description",
        content: "Les idées en attente et les actualités à rédiger ou publier.",
      },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (context.role !== "admin" && context.role !== "manager") throw redirect({ to: "/" });
  },
  component: ATraiter,
});

function ATraiter() {
  const qc = useQueryClient();
  const { role, email, user } = Route.useRouteContext();
  const isAdmin = role === "admin";
  const myEmail = (email ?? "").toLowerCase();
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const myName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    myEmail;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editingNewsId, setEditingNewsId] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaDraft>(emptyMedia);
  const [showLinkErrs, setShowLinkErrs] = useState(false);
  const [editingPublished, setEditingPublished] = useState(false);
  const publishedEditRef = useRef(false);
  const [newsScope, setNewsScope] = useState<"all" | "teams">("all");
  const [newsTeams, setNewsTeams] = useState<string[]>([]);
  const teamNames = useQuery({ queryKey: ["teams", "names"], queryFn: fetchTeamNames, retry: false });
  const newsLinkErrs = showLinkErrs ? linkErrors(media.links) : {};
  const [rejecting, setRejecting] = useState<Submission | null>(null);
  const [reading, setReading] = useState<Submission | null>(null);
  const [rejectForm, setRejectForm] = useState({ rejection_category: "", rejection_note: "" });
  const [rejectErrors, setRejectErrors] = useState<FieldErrors>({});

  const news = useQuery({ queryKey: ["news"], queryFn: fetchNews, retry: false });
  const editableIds = useQuery({ queryKey: ["news", "editable"], queryFn: fetchEditableNewsIds, retry: false });
  const submissions = useQuery({
    queryKey: ["submissions"],
    queryFn: fetchSubmissions,
    retry: false,
  });
  const onError = (e: unknown) => toast.error((e as Error).message);
  const blockers = useQuery({ queryKey: ["blockers"], queryFn: fetchBlockers, retry: false });
  const STALE_DAYS = STALE_BLOCKER_DAYS;
  const myTeams = useQuery({
    queryKey: ["manager_teams", "mine", email],
    enabled: role === "manager" && !!email,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_teams")
        .select("team, allowed_users!inner(email)")
        .eq("allowed_users.email", (email ?? "").toLowerCase());
      if (error) throw error;
      return (data ?? []).map((t) => t.team);
    },
  });
  const canEditBlocker = (team?: string | null) =>
    isAdmin || (role === "manager" && !!team && (myTeams.data ?? []).includes(team));
  const stale = (blockers.data ?? [])
    .filter((b) => Date.now() - new Date(b.updated_at).getTime() > STALE_DAYS * 86400000)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const setBlocker = useMutation({
    mutationFn: updateBlockerStatus,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blockers"] }),
    onError,
  });

  const saveDraft = useMutation({
    mutationFn: saveDraftNews,
    onSuccess: () => {
      setTitle("");
      setBody("");
      setEditingNewsId(null);
      setMedia(emptyMedia());
      setShowLinkErrs(false);
      setNewsScope("all");
      setNewsTeams([]);
      toast.success(publishedEditRef.current ? "Actualité corrigée" : "Brouillon enregistré");
      publishedEditRef.current = false;
      setEditingPublished(false);
      qc.invalidateQueries({ queryKey: ["news"] });
    },
    onError,
  });

  const publishDraft = useMutation({
    mutationFn: publishDraftNews,
    onSuccess: () => {
      toast.success("Actualité publiée");
      qc.invalidateQueries({ queryKey: ["news"] });
    },
    onError,
  });

  const removeDraft = useMutation({
    mutationFn: (n: { id: string; image_path?: string | null }) => deleteDraftNews(n.id, n.image_path),
    onSuccess: () => {
      toast.success("Brouillon supprimé");
      qc.invalidateQueries({ queryKey: ["news"] });
    },
    onError,
  });

  // Décision différée de 8 s : le temps d'annuler. Si on quitte la page, les décisions en cours partent tout de suite.
  type ReviewVars = Parameters<typeof reviewSubmission>[0];
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, { vars: ReviewVars; timer: ReturnType<typeof setTimeout> }>());
  const unpend = (id: string) =>
    setPendingIds((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });

  // Chaque décision a son propre suivi : plusieurs envois peuvent se chevaucher sans se perdre.
  async function send(vars: ReviewVars) {
    timers.current.delete(vars.id);
    try {
      await reviewSubmission(vars);
    } catch (e) {
      toast.error(rejectionErrorMessage(e));
    } finally {
      unpend(vars.id);
      qc.invalidateQueries({ queryKey: ["submissions"] });
    }
  }

  useEffect(() => {
    const current = timers.current;
    const flush = () => {
      for (const { vars, timer } of current.values()) {
        clearTimeout(timer);
        reviewSubmission(vars).catch(() => {});
      }
      current.clear();
    };
    // Fermeture de l'onglet ou rechargement : on prévient, puis on envoie ce qui reste.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!current.size) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", flush);
      const hadPending = current.size > 0;
      flush();
      if (hadPending) qc.invalidateQueries({ queryKey: ["submissions"] });
    };
  }, [qc]);

  function decide(vars: ReviewVars, label: string) {
    setPendingIds((p) => new Set(p).add(vars.id));
    setReading(null);
    setRejecting(null);
    const timer = setTimeout(() => void send(vars), 8000);
    timers.current.set(vars.id, { vars, timer });
    toast(label, {
      duration: 8000,
      action: {
        label: "Annuler",
        onClick: () => {
          clearTimeout(timer);
          timers.current.delete(vars.id);
          unpend(vars.id);
        },
      },
    });
  }

  function copyEmail(email: string) {
    navigator.clipboard
      ?.writeText(email)
      .then(() => toast.success("Email copié"))
      .catch(() => toast.error("Copie impossible : sélectionne l'adresse à la main."));
  }

  function startReject(s: Submission) {
    setReading(null);
    setRejecting(s);
    setRejectErrors({});
    setRejectForm({ rejection_category: "", rejection_note: "" });
  }

  // Les plus anciennes d'abord ; celles qu'on vient de décider (annulables) disparaissent de la liste.
  const waiting = (submissions.data ?? [])
    .filter((s) => !pendingIds.has(s.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Admin : une équipe sans manager ne devrait pas exister (la base l'interdit désormais), on le signale quand même.
  const teamsWithoutManager = useQuery({
    queryKey: ["teams", "without-manager"],
    enabled: isAdmin,
    retry: false,
    queryFn: async () => {
      const [t, m] = await Promise.all([
        supabase.from("teams").select("name, is_reserved"),
        supabase.from("manager_teams").select("team"),
      ]);
      if (t.error) throw t.error;
      if (m.error) throw m.error;
      const covered = new Set((m.data ?? []).map((r) => r.team));
      return (t.data ?? []).filter((x) => !x.is_reserved && !covered.has(x.name)).map((x) => x.name);
    },
  });
  // Personne ne décide sa propre idée : il y a toujours au moins deux admins, donc un autre peut la traiter.
  const isOwnIdea = (s: Submission) => (s.submitted_by_email ?? "").toLowerCase() === myEmail;
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    // Première visite de cette page pour ce rôle : la visite s'ouvre seule, une fois.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!localStorage.getItem(tourKey("traiter", role))) timer = setTimeout(() => setTourOpen(true), 1500);
    } catch {
      /* stockage indisponible : la visite reste accessible par le bouton */
    }
    return () => clearTimeout(timer);
  }, [role]);
  function closeTour() {
    setTourOpen(false);
    try {
      localStorage.setItem(tourKey("traiter", role), "1");
    } catch {
      /* ignoré */
    }
  }

  const visibleDrafts = news.data?.filter((n) => n.status === "brouillon") ?? [];
  const drafts = visibleDrafts.length;

  return (
    <div className="bg-background text-on-surface font-body-md min-h-screen flex flex-col">
      <BrandHeader />
      <Tour steps={traiterTourSteps(role)} open={tourOpen} onClose={closeTour} />
      <main className="flex-grow w-full max-w-interface mx-auto p-sm md:p-md space-y-md">
        <div className="mb-lg flex flex-wrap items-end justify-between gap-sm">
          <h1 className="font-headline-lg text-headline-lg text-primary">À traiter</h1>
          <button
            type="button"
            onClick={() => setTourOpen(true)}
            className="inline-flex min-h-11 items-center gap-xs rounded-md px-sm font-label-md text-label-md text-primary underline-offset-2 hover:underline"
          >
            <Icon name="help" /> Visite guidée
          </button>
        </div>
        {isAdmin && (teamsWithoutManager.data?.length ?? 0) > 0 && (
          <p role="alert" className="rounded-md bg-error-container p-sm font-body-sm text-body-sm text-on-error-container">
            Équipes sans manager : {teamsWithoutManager.data!.join(", ")}. Leurs idées et leurs propositions n'ont personne pour les traiter.
          </p>
        )}
        <div className="bento-grid">
          <section
            id="tour-traiter-news"
            className="col-span-12 lg:col-span-8 bg-surface-container-lowest border border-outline-variant p-md flex flex-col gap-md"
          >
            <div className="flex items-center justify-between border-b border-outline-variant pb-sm">
              <h2 className="font-headline-sm text-headline-sm text-primary">
                Actualités à rédiger
              </h2>
              <span className="font-label-sm text-label-sm text-on-surface-variant">
                {drafts} brouillon{drafts > 1 ? "s" : ""} en attente
              </span>
            </div>
            <form
              className="space-y-md"
              onSubmit={(e) => {
                e.preventDefault();
                if (!title.trim()) return;
                setShowLinkErrs(true);
                if (Object.keys(linkErrors(media.links)).length) {
                  toast.error("Corrige les liens invalides avant d'enregistrer.");
                  return;
                }
                if (newsScope === "teams" && newsTeams.length === 0) {
                  toast.error("Choisis au moins une équipe, ou « Tout le cabinet ».");
                  return;
                }
                saveDraft.mutate({
                  recipient_teams: newsScope === "all" ? [] : newsTeams,
                  links: toNewsLinks(media.links),
                  media,
                  id: editingNewsId ?? undefined,
                  title: title.trim(),
                  body,
                  author: myName,
                  author_email: myEmail,
                });
              }}
            >
              <div className="space-y-xs">
                <label htmlFor="news-title" className="font-label-md text-label-md text-on-surface-variant block">
                  Titre
                </label>
                <input
                  id="news-title"
                  className="min-h-11 w-full bg-transparent border-b border-outline-variant focus:border-primary focus:outline-none transition-colors font-headline-sm text-headline-sm px-0 py-xs"
                   placeholder="Saisis un titre…"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-xs">
                <label htmlFor="news-body" className="font-label-md text-label-md text-on-surface-variant block">
                  Contenu
                </label>
                <textarea
                  id="news-body"
                  className="w-full bg-card border border-outline-variant focus:border-primary focus:outline-none p-sm font-body-md"
                   placeholder="Rédige l'actualité…"
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
              <RecipientPicker
                name="news-recipients"
                scope={newsScope}
                onScopeChange={setNewsScope}
                value={newsTeams}
                onChange={setNewsTeams}
                teams={teamNames.data ?? []}
              />
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-sm">
                <NewsMediaEditor
                  value={media}
                  onChange={setMedia}
                  linkErrs={newsLinkErrs}
                  disabled={saveDraft.isPending}
                  title={title}
                />
                <div className="flex items-center gap-sm">
                  {editingNewsId && (
                    <button
                      type="button"
                      className="min-h-11 px-xs font-label-sm text-label-sm text-on-surface-variant hover:text-primary"
                      onClick={() => {
                        setEditingNewsId(null);
                        setTitle("");
                        setBody("");
                        setMedia(emptyMedia());
                        setShowLinkErrs(false);
                        setNewsScope("all");
                        setNewsTeams([]);
                        setEditingPublished(false);
                        publishedEditRef.current = false;
                      }}
                    >
                      Annuler
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={saveDraft.isPending}
                    className="min-h-11 rounded-md px-lg py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
                  >
                    {saveDraft.isPending ? "Enregistrement…" : editingPublished ? "Enregistrer les corrections" : "Enregistrer le brouillon"}
                  </button>
                </div>
              </div>
            </form>
            <div className="mt-md pt-md border-t border-outline-variant">
              {visibleDrafts.length > 0 && (
                <>
                  <h3 className="font-label-md text-label-md text-on-surface-variant mb-sm">
                    BROUILLONS
                  </h3>
                  <div className="space-y-xs mb-md">
                    {visibleDrafts.map((n) => {
                      const own = (n.author_email ?? "").toLowerCase() === myEmail;
                      const allowed = isAdmin || own;
                      return (
                        <div
                          key={n.id}
                          className="flex items-center justify-between gap-sm p-sm bg-surface-container"
                        >
                          <div className="flex items-center gap-md min-w-0">
                            <Icon name="draft" className="text-on-surface-variant" />
                            <div className="min-w-0">
                              <p className="font-body-md text-primary flex items-center gap-xs">
                                <span className="truncate">{n.title}</span>
                                <span className="shrink-0 border border-outline-variant px-xs font-label-sm text-label-sm text-on-surface-variant">
                                  Brouillon
                                </span>
                              </p>
                              <p className="text-xs text-on-surface-variant uppercase font-label-sm">
                                Créé {timeAgo(n.created_at)} • Par {n.author} • {forWhomText(n.recipient_teams)}
                              </p>
                            </div>
                          </div>
                          {allowed && (
                            <div className="flex items-center gap-sm shrink-0">
                              <button
                                type="button"
                                className="min-h-11 px-xs font-label-sm text-label-sm text-on-surface-variant hover:text-primary"
                                onClick={() => {
                                  setEditingPublished(false);
                                  publishedEditRef.current = false;
                                  setEditingNewsId(n.id);
                                  setTitle(n.title);
                                  setBody(n.body ?? "");
                                  setMedia(mediaFromNews(n));
                                  setShowLinkErrs(false);
                                  setNewsTeams(n.recipient_teams ?? []);
                                  setNewsScope(n.recipient_teams?.length ? "teams" : "all");
                                }}
                              >
                                Modifier
                              </button>
                              <button
                                type="button"
                                className="min-h-11 px-xs font-label-sm text-label-sm text-error"
                                disabled={removeDraft.isPending}
                                onClick={() => {
                                  if (window.confirm(`Supprimer le brouillon « ${n.title} » ?`))
                                    removeDraft.mutate(n);
                                }}
                              >
                                Supprimer
                              </button>
                              <button
                                type="button"
                                className="min-h-11 rounded-md px-sm bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
                                disabled={publishDraft.isPending}
                                onClick={() => {
                                  if (window.confirm(`Publier l'actualité « ${n.title} » ? Elle sera visible par tous.`))
                                    publishDraft.mutate(n.id);
                                }}
                              >
                                Publier
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {(() => {
                const mine = (news.data ?? []).filter(
                  (n) => n.status === "publiée" && (editableIds.data ?? []).includes(n.id),
                );
                if (!mine.length) return null;
                return (
                  <>
                    <h3 className="font-label-md text-label-md text-on-surface-variant mb-sm mt-md">
                      Publiées, à corriger si besoin
                    </h3>
                    <p className="mb-sm font-body-sm text-body-sm text-on-surface-variant">
                      {isAdmin ? "Toutes les actualités publiées." : "Les tiennes et celles des managers de tes équipes."}
                    </p>
                    <ul className="space-y-xs">
                      {mine.slice(0, 6).map((n) => (
                        <li
                          key={n.id}
                          className="flex flex-wrap items-center justify-between gap-sm rounded-md bg-surface-container p-sm"
                        >
                          <div className="min-w-0">
                            <p className="font-body-md text-primary wrap-anywhere">{n.title}</p>
                            <p className="font-label-sm text-label-sm text-on-surface-variant">
                              Publiée {timeAgo(n.created_at)} • Par {n.author} • {forWhomText(n.recipient_teams)}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="min-h-11 rounded-md border border-primary px-sm font-label-md text-label-md text-primary hover:bg-surface-container-high"
                            onClick={() => {
                              publishedEditRef.current = true;
                              setEditingPublished(true);
                              setEditingNewsId(n.id);
                              setTitle(n.title);
                              setBody(n.body ?? "");
                              setMedia(mediaFromNews(n));
                              setShowLinkErrs(false);
                              setNewsTeams(n.recipient_teams ?? []);
                              setNewsScope(n.recipient_teams?.length ? "teams" : "all");
                              document.getElementById("news-title")?.scrollIntoView({ block: "center" });
                            }}
                          >
                            Corriger
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                );
              })()}
            </div>
          </section>

          {/* Pending Submissions */}
          <section
            id="tour-traiter-ideas"
            className="col-span-12 lg:col-span-4 min-w-0 bg-surface-container-lowest border border-outline-variant p-md flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-outline-variant pb-sm mb-md">
              <h2 className="font-headline-sm text-headline-sm text-primary">
                Idées en attente
              </h2>
              <div className="bg-tertiary-fixed text-on-tertiary-fixed px-xs py-1 rounded-full font-label-sm text-label-sm">
                {waiting.length} en attente
              </div>
            </div>
            <div className="space-y-sm flex-grow min-w-0">
              {submissions.isError && (
                <p className="text-body-sm text-error">
                  Les soumissions sont indisponibles.
                </p>
              )}
              {waiting.length === 0 && !submissions.isError && (
                <p className="text-body-sm text-on-surface-variant italic">
                  Aucune idée en attente. Bravo, la file est vide.
                </p>
              )}
              {waiting.map((s, idx) => (
                <div
                  key={s.id}
                  className="p-sm border border-outline-variant bg-card space-y-sm min-w-0 overflow-hidden"
                >
                  <div className="flex items-center gap-sm">
                    <div className="w-8 h-8 rounded-full bg-secondary-fixed flex items-center justify-center">
                      <Icon name="person" className="text-sm" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-body-sm text-primary font-bold wrap-anywhere">{s.author_name}</p>
                      <p className="text-xs text-on-surface-variant font-label-sm wrap-anywhere">
                        {s.team} · {forWhomText(s.recipient_teams)}
                      </p>
                    </div>
                    <span className="text-xs text-on-surface-variant font-label-sm whitespace-nowrap">
                      {timeAgo(s.created_at)}
                    </span>
                  </div>
                  {daysSince(s.created_at) > LATE_AFTER_DAYS && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-error-container px-sm py-0.5 font-label-sm text-label-sm text-on-error-container">
                      <span aria-hidden="true" className="size-2 rounded-full bg-error" />
                      En retard · {daysSince(s.created_at)} jours
                    </span>
                  )}
                  {s.submitted_by_email && (
                    <div className="flex items-center gap-xs font-label-sm text-label-sm text-on-surface-variant">
                      <span className="min-w-0 wrap-anywhere">{s.submitted_by_email}</span>
                      <button
                        type="button"
                        onClick={() => copyEmail(s.submitted_by_email!)}
                        aria-label={`Copier l'email de ${s.author_name}`}
                        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-primary hover:bg-surface-container"
                      >
                        <Icon name="content_copy" />
                      </button>
                    </div>
                  )}
                  <SubmissionPreview content={s.content} onOpen={() => setReading(s)} />
                  <AttachmentLink path={s.attachment_path} name={s.attachment_name} />
                  {isOwnIdea(s) ? (
                    <p className="rounded-md bg-surface-container p-xs font-label-sm text-label-sm text-on-surface-variant">
                      C'est ton idée : un autre manager de l'équipe ou un admin la traite.
                    </p>
                  ) : (
                  <div id={idx === 0 ? "tour-decision" : undefined} className="flex gap-xs pt-xs">
                    <button
                      onClick={() => startReject(s)}
                      className="min-h-11 flex-1 rounded-md border border-primary text-primary font-label-md text-label-md hover:bg-surface-container transition-colors"
                    >
                      REFUSER
                    </button>
                    <button
                      onClick={() => decide({ id: s.id, status: "validée" }, "Idée validée")}
                      className="min-h-11 flex-1 rounded-md bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-colors"
                    >
                      VALIDER
                    </button>
                  </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <ProposalsToConfirm email={myEmail} />

          <section
            id="tour-traiter-stale"
            className="col-span-12 bg-surface-container-lowest border border-outline-variant rounded-md p-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-xs border-b border-outline-variant pb-sm mb-md">
              <h2 className="font-headline-sm text-headline-sm text-primary">
                Points bloquants sans mise à jour depuis plus de {STALE_DAYS} jours
              </h2>
              <span className="font-label-sm text-label-sm text-on-surface-variant">{stale.length} à relancer</span>
            </div>
            {blockers.isError && <p className="text-body-sm text-error">Les points bloquants sont indisponibles.</p>}
            {!blockers.isLoading && !blockers.isError && stale.length === 0 && (
              <p className="text-body-sm text-on-surface-variant italic">
                Tous les points bloquants ont été mis à jour cette semaine. Bravo.
              </p>
            )}
            <ul className="space-y-xs">
              {stale.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-outline-variant bg-card p-sm"
                >
                  <div className="min-w-0">
                    <p className="font-body-md font-bold text-primary wrap-anywhere">{b.title}</p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant">
                      {b.team ?? b.department} · {b.status} · mis à jour {timeAgo(b.updated_at)}
                    </p>
                  </div>
                  {canEditBlocker(b.team) ? (
                    <select
                      aria-label={`Statut de ${b.title}`}
                      value={b.status}
                      onChange={(e) => setBlocker.mutate({ id: b.id, status: e.target.value })}
                      className="min-h-11 rounded-md border border-outline-variant bg-card px-xs font-label-sm text-primary"
                    >
                      <option>OUVERT</option>
                      <option>EN COURS</option>
                      <option>SURVEILLANCE</option>
                      <option disabled={b.status === "OUVERT"}>RÉSOLU</option>
                    </select>
                  ) : (
                    <span className="font-label-sm text-label-sm text-on-surface-variant">
                      {b.team ? `À relancer auprès du manager de l'équipe ${b.team}` : "À relancer auprès d'un admin"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
      <SubmissionReader
        submission={reading}
        onClose={() => setReading(null)}
        onReject={reading && reading.status === "en attente" && !isOwnIdea(reading) ? () => startReject(reading) : undefined}
        onApprove={
          reading && reading.status === "en attente" && !isOwnIdea(reading)
            ? () => decide({ id: reading.id, status: "validée" }, "Idée validée")
            : undefined
        }
      />
      {rejecting && (
        <Modal title="Refuser la soumission" onClose={() => setRejecting(null)}>
          <form
            noValidate
            className="space-y-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const res = validate(rejectionSchema, rejectForm);
              if (!res.ok) return setRejectErrors(res.errors);
              setRejectErrors({});
              decide({ id: rejecting.id, status: "refusée", ...res.data }, "Idée refusée");
            }}
          >
            <p className="max-h-48 overflow-y-auto border border-outline-variant bg-surface-container-low p-xs text-body-sm italic text-on-surface-variant whitespace-pre-line wrap-anywhere">“{rejecting.content}”</p>
            <ErrorSummary errors={rejectErrors} />
            <Field label="Motif du refus" error={rejectErrors.rejection_category}>
              <select
                className="w-full border border-outline-variant bg-card p-xs text-body-sm"
                value={rejectForm.rejection_category}
                onChange={(e) => setRejectForm({ ...rejectForm, rejection_category: e.target.value })}
              >
                <option value="">— Choisir un motif —</option>
                {REJECTION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Raison du refus (obligatoire)" error={rejectErrors.rejection_note}>
              <TextArea
                rows={4}
                value={rejectForm.rejection_note}
                placeholder="Explique au collaborateur pourquoi sa soumission est refusée…"
                onChange={(e) => setRejectForm({ ...rejectForm, rejection_note: e.target.value })}
              />
              <CharCounter value={rejectForm.rejection_note} max={500} />
            </Field>
            <FormActions pending={false} onCancel={() => setRejecting(null)} />
          </form>
        </Modal>
      )}
    </div>
  );
}
