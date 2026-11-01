export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Cette page ne s'est pas chargée</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
      /* Page autonome (sans la feuille de style de l'app) : elle suit aussi le réglage clair/sombre du système */
      @media (prefers-color-scheme: dark) {
        body { background: #0f1626; color: #e8edf5; }
        p { color: #aab4c6; }
        .primary { background: #9db8f0; color: #0f1626; }
        .secondary { background: transparent; color: #e8edf5; border-color: #55637d; }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Cette page ne s'est pas chargée</h1>
      <p>Une erreur s'est produite. Vous pouvez réessayer ou revenir à l'accueil.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Réessayer</button>
        <a class="secondary" href="/">Retour à l'accueil</a>
      </div>
    </div>
  </body>
</html>`;
}
