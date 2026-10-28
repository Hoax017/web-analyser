# Web Analyser

[English](README.md) | **Français**

Analyseur réseau desktop, visuel et intelligent : capture le trafic d'un vrai Chrome, le stocke dans SQLite et
reconstruit le graphe des flux de données entre requêtes (ex. `token` de `/login` réutilisé par `/me`).

Stack : Tauri v2 (Rust + SQLite), React + TypeScript strict (ni `any` ni `@ts-ignore`), Tailwind / shadcn/ui,
React Flow, agent Playwright pilotant Chrome. Toutes les données restent en local.

![Workspace](docs/screenshots/workspace.png)

## Fonctionnalités

- **Projets** : liste des sessions d'analyse enregistrées, création + démarrage de capture en un clic.

  ![Accueil](docs/screenshots/home.png)

- **Graphe interactif** : canvas infini (zoom, pan), disposition en couches ou en cercle, recentrage, « Voir à
  partir de… » (clic droit) pour isoler un nœud et ses descendants. Les requêtes identiques sont fusionnées en un
  seul nœud avec compteur.
- **Corrélation automatique** : détection des valeurs (tokens JWT, identifiants, UUID…) renvoyées par une réponse
  puis réinjectées dans une requête suivante (en-tête, paramètre d'URL, segment de chemin, corps). Survolez la
  bulle d'un lien pour voir les variables qui transitent ; liens éditables, créables et supprimables à la main.

  ![Infobulle d'un lien](docs/screenshots/link-tooltip.png)

- **Recherche globale** dans les URLs, valeurs de requêtes et de réponses (FTS5) ; les nœuds correspondants sont
  mis en évidence, et l'option « Filtrer le graphe » masque les autres.

  ![Recherche](docs/screenshots/search.png)

- **Liste des requêtes** virtualisée (milliers d'entrées), volet redimensionnable, requêtes identiques empilées
  avec onglets par occurrence, filtres d'affichage glob (ex. `/_nuxt/*.js`).
- **Vue détaillée** : en-têtes, paramètres, corps, réponse complète, flux de données entrants/sortants et
  commande `curl` POSIX prête à copier pour rejouer la requête.

  ![Détail d'une requête](docs/screenshots/request-detail.png)
  ![Flux de données](docs/screenshots/request-flow.png)

- **Navigateur au choix** : Chrome piloté par Playwright ou votre vrai Chrome via CDP (voir ci-dessous).

  ![Réglages du navigateur](docs/screenshots/browser-settings.png)

> ⚠️ Les captures contiennent des données sensibles (cookies, tokens, mots de passe saisis). Elles sont stockées
> uniquement dans le dossier de données de l'application (`%APPDATA%\dev.webanalyser.app` sous Windows) et ne
> sont jamais envoyées ailleurs.

## Téléchargement

La CI GitHub Actions ([`build.yml`](.github/workflows/build.yml)) produit à chaque push les installeurs
macOS (`.dmg`, Apple Silicon et Intel), Windows (`-setup.exe` NSIS et `.msi`) et Linux (`.AppImage`, `.deb`,
`.rpm`), disponibles en artefacts du workflow. Pousser un tag `v*` (ex. `git tag v0.1.0 && git push --tags`)
crée un brouillon de release GitHub avec ces fichiers.

- **Node.js ≥ 20** et **Google Chrome** doivent être installés : l'agent de capture (embarqué dans l'app) est
  exécuté avec le `node` du système (surchargeable via la variable `WEB_ANALYSER_NODE`).
- Les binaires ne sont pas signés : sur macOS, clic droit → Ouvrir (ou `xattr -cr "/Applications/Web Analyser.app"`) ;
  sur Windows, SmartScreen → « Informations complémentaires » → « Exécuter quand même ».

## Prérequis

- Node.js ≥ 20, Rust stable, Google Chrome installé.
- `npm install`

## Lancement

```bash
npm run tauri dev      # compile l'agent de capture, lance Vite et l'app Tauri
npm run build:agent && npm run tauri build -- --no-bundle   # exe release dans src-tauri/target/release
npm run typecheck      # TypeScript strict (front + agent)
npm run lint           # ESLint : `any` et `@ts-ignore` interdits
cd src-tauri && cargo test
```

Navigateur de capture (bouton « Navigateur » de l'accueil ou roue crantée du workspace), réglage global stocké en SQLite :

- **Chrome piloté** : Playwright lance Chrome avec un profil dédié (comportement par défaut).
- **Mon vrai Chrome** : connexion CDP à votre Chrome (`http://127.0.0.1:9222` par défaut). Si rien n'écoute, l'app
  peut l'ouvrir elle-même (`--remote-debugging-port` + dossier de profil persistant) ; sinon lancez-le à la main avec
  la commande affichée dans les réglages. Depuis Chrome 136, le débogage est refusé sur le profil par défaut
  « User Data » : utilisez un dossier dédié. Arrêter la capture ne ferme pas ce Chrome.

Filtres d'affichage (icône entonnoir) : motifs glob par projet (ex. `/_nuxt/*.js`) testés sur le chemin et l'URL ;
les requêtes masquées restent en base et continuent d'alimenter la corrélation.

## Architecture

```
capture-agent/            Agent Node + Playwright (process enfant, NDJSON stdin/stdout)
  src/protocol.ts           Contrat agent <-> Rust (miroir de src-tauri/src/capture/protocol.rs)
  src/session.ts            Lancement/connexion Chrome, écoute requestfinished/requestfailed
src-tauri/src/
  commands/                 Commandes Tauri (projets, requêtes, graphe, capture)
  db/                       SQLite : migrations, projets, requêtes (+ FTS5 trigram), liens, positions
  correlation/              Détection des flux : extraction de valeurs, inférence de type (JWT, UUID…)
  capture/                  Cycle de vie de l'agent, insertion + corrélation en direct, événements
  error.rs                  AppError sérialisé { kind, message } vers le front
src/
  types/                    Modèle de domaine + table typée des commandes IPC
  lib/tauri.ts, api/        `command()` typé, AppError côté front, wrappers d'API
  stores/                   Zustand : capture, liste paginée, graphe, workspace
  features/home/            Liste des projets, création + démarrage de capture
  features/workspace/
    TopBar.tsx              Accueil, recherche globale, pause/reprise
    request-list/           Liste virtualisée à défilement infini
    request-detail/         Vue détaillée (headers, query, body, réponse, flux)
    graph/                  React Flow : nœuds, liens avec bulle/infobulle, éditeur de liens, dagre
  components/ui/            Composants style shadcn/ui
```

## Pistes suivantes

- Embarquer Node.js (sidecar) pour ne plus dépendre d'une installation système.
- Filtres (méthode, statut, domaine), export HAR.
- Corrélation assistée par IA en complément du moteur heuristique.
