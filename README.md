# Boussole — Radar actions & crypto

Recherche une action, un ETF ou une crypto, visualise son cours (4H / jour / semaine / mois / année) et obtiens une
synthèse d'aide à la décision (Achat / Vente / Neutre) avec sa justification détaillée : tendance (moyennes
mobiles), RSI, momentum, position du prix, et ton des actualités récentes.

⚠️ **Ceci est un outil informatif, pas un conseil financier.** Les signaux sont générés par des règles simples et
transparentes (voir `src/App.jsx`), pas par un modèle prédictif — à combiner avec ta propre recherche.

## Sources de données (publiques, sans clé API)

- **Crypto** : [CoinGecko](https://www.coingecko.com/en/api)
- **Actions / ETF** : Yahoo Finance (API non officielle)
- **Actualités & sentiment** : [GDELT Project](https://www.gdeltproject.org/)

Si une source est temporairement indisponible (limite de taux, panne), l'app bascule automatiquement en **mode
démo** avec des données simulées, toujours clairement indiqué à l'écran.

## Développement local

Prérequis : [Node.js](https://nodejs.org/) version 18 ou plus.

```bash
npm install
npm run dev
```

Ouvre ensuite l'URL affichée dans le terminal (en général `http://localhost:5173`).

## Build de production

```bash
npm run build
npm run preview   # pour tester le build localement
```

## Déploiement sur GitHub Pages

Voir les instructions pas à pas fournies séparément. Un workflow GitHub Actions
(`.github/workflows/deploy.yml`) est déjà inclus : chaque `push` sur `main` reconstruit et republie le site
automatiquement.

⚠️ Pense à adapter `base` dans `vite.config.js` avec le nom exact de ton dépôt GitHub.

## Stack technique

- [Vite](https://vitejs.dev/) + [React 18](https://react.dev/)
- [Recharts](https://recharts.org/) pour le graphique
- [Lucide](https://lucide.dev/) pour les icônes
