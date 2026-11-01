import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import sharkLogo from "@/assets/bigger-boat-shark.png";
import { supabase } from "@/integrations/supabase/client";
import { fetchOwnRole, signOut } from "@/lib/auth";
import { NotificationPrefsModal } from "@/components/notification-prefs";

const navLink =
  "inline-flex min-h-11 items-center border-b-2 border-transparent px-xs py-1 font-label-md text-label-md text-on-primary/80 hover:text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-primary";
const ROLE_LABEL = { admin: "Admin", manager: "Manager", collaborateur: "Collaborateur" } as const;
const navActive = { className: "border-on-primary text-on-primary" };

export function BrandHeader() {
  // Version élèves : lien « Changer de rôle » visible dès qu'on est connecté.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);

  useEffect(() => {
    const apply = (session: { user?: { email?: string | null } } | null) => {
      setSignedIn(!!session);
      setEmail(session?.user?.email ?? "");
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Le rôle décide des liens de navigation : « À traiter » n'existe que pour manager et admin.
  const role = useQuery({
    queryKey: ["own_role", email],
    queryFn: () => fetchOwnRole(email),
    enabled: signedIn && !!email,
    staleTime: 5 * 60 * 1000,
  });
  const isStaff = role.data === "manager" || role.data === "admin";
  const showNav = signedIn && !!role.data && pathname !== "/choisir-role" && pathname !== "/auth";

  return (
    <header className="bg-primary text-on-primary">
      <div className="mx-auto flex min-h-16 w-full max-w-interface flex-wrap items-center justify-between gap-x-md gap-y-xs px-sm py-xs md:px-md">
        <div className="flex min-w-0 flex-wrap items-center gap-x-lg gap-y-xs">
          <Link to="/" className="flex min-h-11 min-w-0 items-center gap-sm" aria-label="Bigger Boat — accueil">
            {/* Pastille blanche dans les deux thèmes : le logo est foncé sur fond transparent */}
            <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded-md bg-white">
              <img src={sharkLogo} alt="" width={1024} height={1024} className="h-8 w-10 object-contain" />
            </span>
            <span className="font-label-md text-lg font-bold uppercase">Bigger Boat</span>
          </Link>
          {showNav && isStaff && (
            <nav aria-label="Navigation principale" className="flex flex-wrap items-center gap-md">
              <Link to="/" activeOptions={{ exact: true }} activeProps={navActive} className={navLink}>
                Accueil
              </Link>
              <Link id="tour-nav-traiter" to="/a-traiter" activeProps={navActive} className={navLink}>
                À traiter
              </Link>
              {role.data === "admin" && (
                <Link id="tour-nav-data" to="/manage/news" activeProps={navActive} className={navLink}>
                  Gérer les données
                </Link>
              )}
            </nav>
          )}
        </div>
        <div id="tour-account" className="flex items-center gap-md">
          {signedIn && pathname !== "/choisir-role" && (
            <Link
              to="/choisir-role"
              className="inline-flex min-h-11 items-center font-label-sm text-label-sm text-on-primary underline-offset-2 hover:underline"
            >
              Changer de rôle
            </Link>
          )}
          {showNav && (
            <>
              <span className="hidden font-label-sm text-label-sm text-on-primary/80 md:inline">
                {email} · {ROLE_LABEL[role.data ?? "collaborateur"]}
              </span>
              <button
                type="button"
                onClick={() => setPrefsOpen(true)}
                className="inline-flex min-h-11 items-center font-label-sm text-label-sm text-on-primary underline-offset-2 hover:underline"
              >
                Notifications
              </button>
              <button
                type="button"
                onClick={() => signOut()}
                className="min-h-11 rounded-md border border-on-primary/60 px-sm font-label-md text-label-md text-on-primary hover:bg-on-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-primary"
              >
                Déconnexion
              </button>
            </>
          )}
          {!showNav && <span className="font-label-sm text-label-sm text-on-primary/80">Happy Place</span>}
        </div>
      </div>
      {prefsOpen && email && (
        <NotificationPrefsModal email={email.toLowerCase()} role={role.data} onClose={() => setPrefsOpen(false)} />
      )}
    </header>
  );
}
