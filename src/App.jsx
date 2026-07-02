import { useState, useEffect, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Loader2,
  ExternalLink,
  Radio,
} from "lucide-react";

const TIMEFRAMES = [
  { key: "4h", label: "4H" },
  { key: "1d", label: "Jour" },
  { key: "1w", label: "Semaine" },
  { key: "1m", label: "Mois" },
  { key: "1y", label: "Année" },
];

// ---------- network helper ----------

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("http_" + res.status);
    return await res.json();
  } catch (e) {
    // repli via un proxy CORS public si l'appel direct échoue
    const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const res2 = await fetch(proxied);
    if (!res2.ok) throw new Error("proxy_http_" + res2.status);
    return await res2.json();
  }
}

// ---------- mode démo (repli si une source de données est indisponible) ----------

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateDemoSeries(seedStr, n) {
  const rand = mulberry32(hashStr(seedStr));
  const base = 8 + (Math.abs(hashStr(seedStr)) % 4000) / 10;
  let price = base;
  const now = Date.now();
  const stepMs = 45 * 60 * 1000;
  const points = [];
  for (let i = n - 1; i >= 0; i--) {
    const drift = (rand() - 0.48) * 0.035;
    price = Math.max(0.5, price * (1 + drift));
    points.push({ time: now - i * stepMs, price });
  }
  return points;
}

// ---------- helpers ----------

function downsample(points, max) {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function sma(prices, window) {
  const w = Math.min(window, prices.length);
  const slice = prices.slice(-w);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function rsi(prices, period) {
  const p = Math.max(2, Math.min(period, prices.length - 1));
  let gains = 0,
    losses = 0;
  for (let i = prices.length - p; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / p,
    avgLoss = losses / p;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function fmtPrice(v) {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1000) return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 6 });
}

function formatTick(ts, tf) {
  const d = new Date(ts);
  if (tf === "4h" || tf === "1d")
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (tf === "1w") return d.toLocaleDateString("fr-FR", { weekday: "short" });
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

function parseGdeltDate(s) {
  if (!s || s.length < 15) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(
    11,
    13
  )}:${s.slice(13, 15)}Z`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function cryptoParamsFor(tf) {
  switch (tf) {
    case "4h":
      return { days: 1, interval: null, slice: 48, demoN: 32 };
    case "1d":
      return { days: 1, interval: null, slice: null, demoN: 40 };
    case "1w":
      return { days: 7, interval: null, slice: null, demoN: 56 };
    case "1m":
      return { days: 30, interval: "daily", slice: null, demoN: 30 };
    case "1y":
      return { days: 365, interval: "daily", slice: null, demoN: 52 };
    default:
      return { days: 1, interval: null, slice: null, demoN: 40 };
  }
}

function stockParamsFor(tf) {
  switch (tf) {
    case "4h":
      return { interval: "15m", range: "5d", slice: 16, demoN: 16 };
    case "1d":
      return { interval: "5m", range: "1d", slice: null, demoN: 40 };
    case "1w":
      return { interval: "60m", range: "5d", slice: null, demoN: 35 };
    case "1m":
      return { interval: "1d", range: "1mo", slice: null, demoN: 22 };
    case "1y":
      return { interval: "1wk", range: "1y", slice: null, demoN: 52 };
    default:
      return { interval: "1d", range: "1mo", slice: null, demoN: 22 };
  }
}

function computeTechnicalFactors(prices) {
  if (!prices || prices.length < 6) return null;
  const shortW = Math.max(3, Math.floor(prices.length * 0.15));
  const longW = Math.max(shortW + 3, Math.floor(prices.length * 0.4));
  const smaShort = sma(prices, shortW);
  const smaLong = sma(prices, longW);
  const rsiVal = rsi(prices, Math.min(14, Math.floor(prices.length / 2)));
  const first = prices[0],
    last = prices[prices.length - 1];
  const pctChange = ((last - first) / first) * 100;

  let score = 0;
  const factors = [];

  const trendDir = smaShort > smaLong * 1.002 ? 1 : smaShort < smaLong * 0.998 ? -1 : 0;
  score += trendDir;
  factors.push({
    label: "Tendance (moyennes mobiles)",
    detail:
      trendDir > 0
        ? `Moyenne courte (${fmtPrice(smaShort)}) au-dessus de la moyenne longue (${fmtPrice(
            smaLong
          )}) — configuration haussière.`
        : trendDir < 0
        ? `Moyenne courte (${fmtPrice(smaShort)}) en dessous de la moyenne longue (${fmtPrice(
            smaLong
          )}) — configuration baissière.`
        : `Moyennes courte et longue proches (${fmtPrice(smaShort)} vs ${fmtPrice(
            smaLong
          )}) — pas de tendance nette.`,
    dir: trendDir,
  });

  const rsiDir = rsiVal > 70 ? -1 : rsiVal < 30 ? 1 : 0;
  score += rsiDir;
  factors.push({
    label: "RSI (momentum)",
    detail:
      rsiVal > 70
        ? `RSI à ${rsiVal.toFixed(0)} — zone de surachat, risque de repli à court terme.`
        : rsiVal < 30
        ? `RSI à ${rsiVal.toFixed(0)} — zone de survente, rebond possible à court terme.`
        : `RSI à ${rsiVal.toFixed(0)} — momentum neutre, ni surachat ni survente.`,
    dir: rsiDir,
  });

  const momDir = pctChange > 2 ? 1 : pctChange < -2 ? -1 : 0;
  score += momDir;
  factors.push({
    label: "Variation sur la période affichée",
    detail: `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)} % sur l'intervalle sélectionné — ${
      momDir > 0 ? "dynamique positive." : momDir < 0 ? "dynamique négative." : "mouvement limité."
    }`,
    dir: momDir,
  });

  const posDir = last > smaShort * 1.001 ? 1 : last < smaShort * 0.999 ? -1 : 0;
  score += posDir;
  factors.push({
    label: "Prix vs moyenne courte",
    detail: `Prix actuel (${fmtPrice(last)}) ${
      posDir > 0 ? "au-dessus" : posDir < 0 ? "en dessous" : "proche"
    } de sa moyenne courte (${fmtPrice(smaShort)}).`,
    dir: posDir,
  });

  return { factors, score, pctChange, rsiVal };
}

function buildNewsFactor(news, newsLoading, newsError) {
  if (newsLoading) {
    return { dir: 0, factor: { label: "Sentiment des news (GDELT)", detail: "Analyse des actualités en cours…", dir: 0 } };
  }
  if (newsError || !news) {
    return {
      dir: 0,
      factor: {
        label: "Sentiment des news (GDELT)",
        detail: "Couverture médiatique indisponible pour le moment — facteur neutre par défaut.",
        dir: 0,
      },
    };
  }
  const { avgTone, articles } = news;
  if (avgTone == null || articles.length === 0) {
    return {
      dir: 0,
      factor: {
        label: "Sentiment des news (GDELT)",
        detail: "Peu ou pas de couverture médiatique récente détectée — facteur neutre.",
        dir: 0,
      },
    };
  }
  const dir = avgTone > 1 ? 1 : avgTone < -1 ? -1 : 0;
  return {
    dir,
    factor: {
      label: "Sentiment des news (GDELT)",
      detail: `Ton moyen des ${articles.length} derniers articles : ${avgTone.toFixed(1)} (échelle GDELT, positif > 0) — ${
        dir > 0 ? "couverture plutôt positive." : dir < 0 ? "couverture plutôt négative." : "couverture globalement neutre."
      }`,
      dir,
    },
  };
}

// ---------- small components ----------

function SignalRing({ signal, confidencePct }) {
  const color = signal === "Achat" ? "var(--buy)" : signal === "Vente" ? "var(--sell)" : "var(--neutral)";
  const colorDark = signal === "Achat" ? "#0F8F6C" : signal === "Vente" ? "#A83350" : "#B8811F";
  const r = 74;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0.04, confidencePct / 100);
  return (
    <svg viewBox="0 0 180 180" className="bsl-ring">
      <defs>
        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={colorDark} />
        </linearGradient>
      </defs>
      <circle cx="90" cy="90" r={r} fill="none" stroke="var(--border)" strokeWidth="14" />
      <circle
        cx="90"
        cy="90"
        r={r}
        fill="none"
        stroke="url(#ringGrad)"
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`}
        transform="rotate(-90 90 90)"
        style={{ transition: "stroke-dasharray 0.7s cubic-bezier(.4,1.3,.4,1)" }}
      />
      <text x="90" y="84" textAnchor="middle" className="bsl-ring-signal" fill={color}>
        {signal}
      </text>
      <text x="90" y="106" textAnchor="middle" className="bsl-ring-conf">
        confiance {confidencePct}%
      </text>
    </svg>
  );
}

function FactorIcon({ dir }) {
  if (dir > 0) return <ArrowUpRight size={14} color="var(--buy)" />;
  if (dir < 0) return <ArrowDownRight size={14} color="var(--sell)" />;
  return <Minus size={14} color="var(--neutral)" />;
}

function StatCard({ label, value, tone }) {
  return (
    <div className="bsl-panel bsl-stat">
      <div className="bsl-stat-label">{label}</div>
      <div className={`bsl-stat-value ${tone || ""}`}>{value}</div>
    </div>
  );
}

// ---------- main component ----------

export default function App() {
  const [assetType, setAssetType] = useState("crypto");
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [timeframe, setTimeframe] = useState("1d");
  const [series, setSeries] = useState([]);
  const [assetLabel, setAssetLabel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [news, setNews] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [demoActive, setDemoActive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    if (assetType !== "crypto" || !dropdownOpen || query.trim().length < 2) {
      setSuggestions([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    const t = setTimeout(async () => {
      try {
        const data = await fetchJSON(
          `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query.trim())}`
        );
        setSuggestions((data.coins || []).slice(0, 6));
      } catch (e) {
        setSuggestions([]);
        setSearchError("Recherche indisponible pour le moment — réessaie dans un instant.");
      } finally {
        setSearchLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, assetType, dropdownOpen]);

  useEffect(() => {
    if (!selected) return;
    if (selected.kind === "crypto") loadCrypto(selected);
    else loadStock(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, timeframe]);

  useEffect(() => {
    if (!selected) {
      setNews(null);
      return;
    }
    loadNews(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function loadCrypto(asset) {
    setLoading(true);
    setError(null);
    const { days, interval, slice, demoN } = cryptoParamsFor(timeframe);
    try {
      const url = `https://api.coingecko.com/api/v3/coins/${asset.id}/market_chart?vs_currency=usd&days=${days}${
        interval ? `&interval=${interval}` : ""
      }`;
      const data = await fetchJSON(url);
      let points = (data.prices || []).map((p) => ({ time: p[0], price: p[1] }));
      if (slice) points = points.slice(-slice);
      if (points.length === 0) throw new Error("no_data");
      setSeries(downsample(points, 150));
      setDemoActive(false);
      setLastUpdate(new Date());
    } catch (err) {
      setSeries(generateDemoSeries(asset.id + timeframe, demoN));
      setDemoActive(true);
      setError("Source de données crypto indisponible pour le moment — affichage en mode démo.");
    } finally {
      setLoading(false);
    }
  }

  async function loadStock(asset) {
    setLoading(true);
    setError(null);
    const { interval, range, slice, demoN } = stockParamsFor(timeframe);
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        asset.symbol
      )}?interval=${interval}&range=${range}`;
      const data = await fetchJSON(url);
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error("symbole introuvable");
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      let points = timestamps
        .map((t, i) => ({ time: t * 1000, price: closes[i] }))
        .filter((p) => p.price != null);
      if (slice) points = points.slice(-slice);
      if (points.length === 0) throw new Error("aucune donnée renvoyée");
      setAssetLabel(result.meta?.shortName || result.meta?.longName || asset.symbol);
      setSeries(downsample(points, 150));
      setDemoActive(false);
      setLastUpdate(new Date());
    } catch (err) {
      setAssetLabel(asset.symbol);
      setSeries(generateDemoSeries(asset.symbol + timeframe, demoN));
      setDemoActive(true);
      setError("Source de données indisponible pour ce symbole pour le moment — affichage en mode démo.");
    } finally {
      setLoading(false);
    }
  }

  async function loadNews(asset) {
    setNewsLoading(true);
    setNewsError(null);
    try {
      const term = asset.kind === "crypto" ? `${asset.name} crypto` : `${asset.symbol} stock`;
      const encoded = encodeURIComponent(term);
      const artUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encoded}&mode=artlist&maxrecords=6&format=json&sort=datedesc&timespan=3d`;
      const toneUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encoded}&mode=timelinetone&format=json&timespan=7d`;
      const [artData, toneData] = await Promise.all([fetchJSON(artUrl), fetchJSON(toneUrl)]);
      const articles = (artData.articles || []).map((a) => ({
        title: a.title,
        url: a.url,
        domain: a.domain,
        date: parseGdeltDate(a.seendate),
      }));
      const toneSeries = toneData?.timeline?.[0]?.data || [];
      const avgTone = toneSeries.length
        ? toneSeries.reduce((sum, d) => sum + (d.value || 0), 0) / toneSeries.length
        : null;
      setNews({ articles, avgTone });
    } catch (err) {
      setNews(null);
      setNewsError("Actualités indisponibles pour le moment.");
    } finally {
      setNewsLoading(false);
    }
  }

  function handleTypeChange(type) {
    setAssetType(type);
    setSelected(null);
    setSeries([]);
    setQuery("");
    setSuggestions([]);
    setError(null);
    setNews(null);
    setAssetLabel(null);
    setDemoActive(false);
  }

  function selectCrypto(coin) {
    setSelected({ id: coin.id, symbol: (coin.symbol || coin.id).toUpperCase(), name: coin.name, kind: "crypto" });
    setQuery(`${coin.name} (${(coin.symbol || "").toUpperCase()})`);
    setDropdownOpen(false);
    setSuggestions([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (assetType === "crypto") {
      if (suggestions.length > 0) {
        selectCrypto(suggestions[0]);
        return;
      }
      setSearchLoading(true);
      setSearchError(null);
      try {
        const data = await fetchJSON(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`);
        const coins = data.coins || [];
        if (coins.length > 0) selectCrypto(coins[0]);
        else setSearchError("Aucun résultat pour cette recherche.");
      } catch {
        setSearchError("Recherche indisponible — réessaie dans un instant.");
      } finally {
        setSearchLoading(false);
      }
      return;
    }
    const sym = q.toUpperCase();
    setAssetLabel(sym);
    setSelected({ id: sym, symbol: sym, name: sym, kind: "stock" });
    setDropdownOpen(false);
  }

  const prices = useMemo(() => series.map((p) => p.price), [series]);
  const technical = useMemo(() => computeTechnicalFactors(prices), [prices]);
  const newsFactorInfo = useMemo(() => buildNewsFactor(news, newsLoading, newsError), [news, newsLoading, newsError]);

  const combined = useMemo(() => {
    if (!technical) return null;
    const factors = [...technical.factors, newsFactorInfo.factor];
    const score = technical.score + newsFactorInfo.dir;
    const maxAbs = 5;
    let signal = "Neutre";
    if (score >= 2) signal = "Achat";
    else if (score <= -2) signal = "Vente";
    const confidencePct = Math.round((Math.abs(score) / maxAbs) * 100);
    return { signal, score, factors, pctChange: technical.pctChange, rsiVal: technical.rsiVal, maxAbs, confidencePct };
  }, [technical, newsFactorInfo]);

  const currentPrice = prices.length ? prices[prices.length - 1] : null;
  const displayName = assetType === "stock" ? assetLabel || selected?.symbol : selected?.name;

  return (
    <div className="bsl-app">
      <style>{`
        .bsl-app {
          --bg-panel: rgba(19,26,61,0.55);
          --bg-panel-2: rgba(15,20,48,0.65);
          --text: #E8ECFF;
          --text-dim: #8891C4;
          --border: rgba(148,163,255,0.16);
          --cyan: #4FD8EA;
          --purple: #B084F5;
          --buy: #34D9A0;
          --sell: #F2607A;
          --neutral: #F5B942;
          --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          --font-display: "Space Grotesk", var(--font);
          --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

          color: var(--text);
          font-family: var(--font);
          max-width: 1080px;
          margin: 0 auto;
        }
        .bsl-app * { box-sizing: border-box; }
        .bsl-shell { display: grid; grid-template-columns: 220px 1fr; gap: 18px; }
        @media (max-width: 780px) { .bsl-shell { grid-template-columns: 1fr; } }

        .bsl-panel {
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: 16px;
          box-shadow: 0 20px 40px -28px rgba(0,0,0,0.7);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
        }
        .bsl-chart-panel, .bsl-signal-panel, .bsl-news-panel, .bsl-detail-panel {
          transition: box-shadow 0.25s ease, transform 0.25s ease;
        }
        .bsl-chart-panel:hover, .bsl-signal-panel:hover, .bsl-news-panel:hover, .bsl-detail-panel:hover {
          box-shadow: 0 24px 48px -24px rgba(79,216,234,0.18);
        }

        .bsl-sidebar { display: flex; flex-direction: column; gap: 18px; }
        .bsl-brand { display: flex; align-items: center; gap: 10px; padding: 4px 2px; }
        .bsl-brand-icon {
          width: 36px; height: 36px; border-radius: 50%;
          background: linear-gradient(135deg, var(--cyan), var(--purple));
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          box-shadow: 0 0 22px rgba(79,216,234,0.35);
        }
        .bsl-brand h1 { font-family: var(--font-display); font-size: 17px; margin: 0; letter-spacing: 0.02em; font-weight: 600; }
        .bsl-brand span { display: block; font-size: 10.5px; color: var(--text-dim); margin-top: 1px; }

        .bsl-menu-label { font-size: 10.5px; letter-spacing: 0.12em; color: var(--text-dim); text-transform: uppercase; margin: 4px 2px; }
        .bsl-nav { display: flex; flex-direction: column; gap: 4px; }
        .bsl-nav button {
          display: flex; align-items: center; gap: 9px; text-align: left; width: 100%; padding: 9px 10px; border-radius: 10px;
          border: none; background: transparent; color: var(--text-dim); font-family: var(--font); font-size: 13px; cursor: pointer;
          transition: background 0.15s, color 0.15s, transform 0.15s;
        }
        .bsl-nav button:hover { background: rgba(148,163,255,0.06); color: var(--text); transform: translateX(2px); }
        .bsl-nav button .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); flex-shrink: 0; }
        .bsl-nav button.active { background: rgba(148,163,255,0.1); color: var(--text); }
        .bsl-nav button.active .dot { background: var(--cyan); box-shadow: 0 0 8px var(--cyan); }
        .bsl-nav button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 1px; }

        .bsl-status { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .bsl-status-title { font-size: 10.5px; letter-spacing: 0.1em; color: var(--text-dim); text-transform: uppercase; }
        .bsl-status-row { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
        .bsl-bar-track { height: 5px; border-radius: 999px; background: rgba(255,255,255,0.06); overflow: hidden; }
        .bsl-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--cyan), var(--purple)); transition: width 0.4s ease; }
        .bsl-status-foot { font-size: 10.5px; color: var(--text-dim); font-family: var(--font-mono); margin-top: 2px; }
        .bsl-demo-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; letter-spacing: 0.06em; padding: 3px 9px; border-radius: 999px; background: rgba(245,185,66,0.14); color: var(--neutral); border: 1px solid rgba(245,185,66,0.3); width: fit-content; }

        .bsl-content { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .bsl-topbar { padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .bsl-topbar-title h2 { font-family: var(--font-display); font-size: 18px; margin: 0; font-weight: 600; }
        .bsl-topbar-title p { font-size: 11.5px; color: var(--text-dim); margin: 2px 0 0; }
        .bsl-search-wrap { position: relative; display: flex; gap: 8px; flex: 1; max-width: 460px; min-width: 220px; }
        .bsl-search-input { position: relative; flex: 1; }
        .bsl-search-input svg { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-dim); }
        .bsl-search-input input {
          width: 100%; background: var(--bg-panel-2); border: 1px solid var(--border); border-radius: 10px;
          padding: 9px 10px 9px 34px; color: var(--text); font-family: var(--font); font-size: 13px;
          transition: border-color 0.15s;
        }
        .bsl-search-input input:focus-visible { outline: 2px solid var(--cyan); outline-offset: 1px; }
        .bsl-run-btn {
          border: none; border-radius: 999px; padding: 0 18px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em;
          color: #08101f; background: linear-gradient(120deg, var(--cyan), var(--purple)); cursor: pointer;
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .bsl-run-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 20px -8px rgba(79,216,234,0.5); }
        .bsl-run-btn:disabled { opacity: 0.6; cursor: default; }
        .bsl-run-btn:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
        .bsl-dropdown {
          position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: var(--bg-panel-2);
          border: 1px solid var(--border); border-radius: 10px; overflow: hidden; z-index: 5;
          backdrop-filter: blur(18px);
        }
        .bsl-dropdown button {
          display: flex; width: 100%; align-items: center; gap: 10px; padding: 9px 12px; background: transparent;
          border: none; color: var(--text); text-align: left; cursor: pointer; font-size: 13px; font-family: var(--font);
        }
        .bsl-dropdown button:hover, .bsl-dropdown button:focus-visible { background: rgba(255,255,255,0.05); outline: none; }
        .bsl-dropdown img { width: 18px; height: 18px; border-radius: 50%; }
        .bsl-dropdown .sym { color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }
        .bsl-dropdown .msg { padding: 10px 12px; font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 8px; }

        .bsl-timeframes { display: flex; gap: 6px; padding: 0 2px; flex-wrap: wrap; }
        .bsl-timeframes button {
          background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-dim); font-size: 12px;
          padding: 6px 13px; border-radius: 999px; cursor: pointer; font-family: var(--font); transition: all 0.15s;
        }
        .bsl-timeframes button:hover { transform: translateY(-1px); }
        .bsl-timeframes button.active { background: linear-gradient(120deg, var(--cyan), var(--purple)); border-color: transparent; color: #08101f; font-weight: 700; }
        .bsl-timeframes button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }

        .bsl-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        @media (max-width: 640px) { .bsl-stats { grid-template-columns: repeat(2, 1fr); } }
        .bsl-stat { padding: 14px 16px; }
        .bsl-stat-label { font-size: 10.5px; letter-spacing: 0.08em; color: var(--text-dim); text-transform: uppercase; }
        .bsl-stat-value { font-family: var(--font-mono); font-size: 20px; font-weight: 600; margin-top: 6px; }
        .bsl-stat-value.buy { color: var(--buy); }
        .bsl-stat-value.sell { color: var(--sell); }
        .bsl-stat-value.neutral { color: var(--neutral); }

        .bsl-error { background: rgba(242,96,122,0.1); border: 1px solid var(--sell); color: var(--text); padding: 10px 14px; border-radius: 10px; font-size: 13px; }

        .bsl-grid-2 { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; }
        @media (max-width: 780px) { .bsl-grid-2 { grid-template-columns: 1fr; } }

        .bsl-chart-panel, .bsl-signal-panel, .bsl-news-panel, .bsl-detail-panel { padding: 18px; }
        .bsl-panel-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
        .bsl-panel-head h3 { font-family: var(--font-display); font-size: 14px; margin: 0; font-weight: 600; }
        .bsl-panel-head .sub { font-size: 11px; color: var(--text-dim); }

        .bsl-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 50px 20px; color: var(--text-dim); text-align: center; gap: 10px; }
        .bsl-loading { display: flex; align-items: center; justify-content: center; padding: 50px 0; color: var(--text-dim); gap: 8px; }
        .bsl-spin { animation: bsl-spin 1s linear infinite; }
        @keyframes bsl-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .bsl-spin { animation: none; } }

        .bsl-signal-panel { display: flex; flex-direction: column; align-items: center; text-align: center; }
        .bsl-ring { width: 150px; height: 150px; }
        .bsl-ring-signal { font-size: 17px; font-weight: 700; font-family: var(--font-display); }
        .bsl-ring-conf { font-size: 9.5px; fill: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; }
        .bsl-legend { list-style: none; margin: 14px 0 0; padding: 0; width: 100%; display: flex; flex-direction: column; gap: 8px; text-align: left; }
        .bsl-legend li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
        .bsl-legend .dotc { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .bsl-legend .verdict { margin-left: auto; font-size: 10.5px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }

        .bsl-news-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; }
        .bsl-news-list li { display: grid; grid-template-columns: 88px 110px 1fr auto; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--border); font-size: 12.5px; }
        .bsl-news-list li:first-child { border-top: none; }
        .bsl-news-list .time { font-family: var(--font-mono); color: var(--text-dim); font-size: 11px; }
        .bsl-news-list .domain { color: var(--text-dim); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bsl-news-list a { color: var(--text); text-decoration: none; transition: color 0.15s; }
        .bsl-news-list a:hover, .bsl-news-list a:focus-visible { color: var(--cyan); }
        .bsl-news-list .pill { display: flex; align-items: center; justify-content: center; width: 26px; height: 22px; border-radius: 6px; background: rgba(148,163,255,0.08); color: var(--text-dim); }
        @media (max-width: 560px) { .bsl-news-list li { grid-template-columns: 1fr; } .bsl-news-list .time, .bsl-news-list .domain { display: none; } }
        .bsl-news-empty { color: var(--text-dim); font-size: 12px; padding: 6px 0; }

        .bsl-factors { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
        .bsl-factors li { display: flex; gap: 8px; align-items: flex-start; border-top: 1px solid var(--border); padding-top: 10px; }
        .bsl-factors li:first-child { border-top: none; padding-top: 0; }
        .bsl-factor-text .lbl { font-size: 12px; font-weight: 600; color: var(--text); display: block; margin-bottom: 2px; }
        .bsl-factor-text .det { font-size: 12px; color: var(--text-dim); line-height: 1.45; }

        .bsl-footer { font-size: 11px; color: var(--text-dim); line-height: 1.55; padding: 4px 4px 0; }
      `}</style>

      <div className="bsl-shell">
        <div className="bsl-sidebar">
          <div className="bsl-brand">
            <div className="bsl-brand-icon">
              <Plus size={17} color="#08101f" strokeWidth={3} />
            </div>
            <div>
              <h1>Boussole</h1>
              <span>Radar actions &amp; crypto</span>
            </div>
          </div>

          <div>
            <div className="bsl-menu-label">Marché</div>
            <div className="bsl-nav">
              <button className={assetType === "crypto" ? "active" : ""} onClick={() => handleTypeChange("crypto")}>
                <span className="dot" /> Crypto
              </button>
              <button className={assetType === "stock" ? "active" : ""} onClick={() => handleTypeChange("stock")}>
                <span className="dot" /> Action / ETF
              </button>
            </div>
          </div>

          <div>
            <div className="bsl-menu-label">Période</div>
            <div className="bsl-nav">
              {TIMEFRAMES.map((tf) => (
                <button key={tf.key} className={timeframe === tf.key ? "active" : ""} onClick={() => setTimeframe(tf.key)}>
                  <span className="dot" /> {tf.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bsl-panel bsl-status">
            <div className="bsl-status-title">État des données</div>
            <div>
              <div className="bsl-status-row"><span>Marché</span><span>{demoActive ? "démo" : selected ? "en direct" : "—"}</span></div>
              <div className="bsl-bar-track"><div className="bsl-bar-fill" style={{ width: selected ? "100%" : "12%" }} /></div>
            </div>
            <div>
              <div className="bsl-status-row"><span>Actualités</span><span>{news ? "en direct" : "—"}</span></div>
              <div className="bsl-bar-track"><div className="bsl-bar-fill" style={{ width: news ? "100%" : "20%" }} /></div>
            </div>
            {demoActive && <span className="bsl-demo-pill"><Radio size={10} /> Mode démo</span>}
            <div className="bsl-status-foot">
              {lastUpdate ? `Maj ${lastUpdate.toLocaleTimeString("fr-FR")}` : "En attente de recherche"}
            </div>
          </div>
        </div>

        <div className="bsl-content">
          <div className="bsl-panel bsl-topbar">
            <div className="bsl-topbar-title">
              <h2>Panneau d'instruments</h2>
              <p>Recherche & synthèse technique + actualités</p>
            </div>
            <div className="bsl-search-wrap">
              <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, width: "100%" }}>
                <div className="bsl-search-input">
                  <Search size={15} />
                  <input
                    type="text"
                    placeholder={assetType === "crypto" ? "bitcoin, eth, solana…" : "AAPL, MSFT, SPY…"}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setDropdownOpen(true);
                      setSearchError(null);
                    }}
                  />
                  {assetType === "crypto" && dropdownOpen && query.trim().length >= 2 && (
                    <div className="bsl-dropdown">
                      {searchLoading && (
                        <div className="msg"><Loader2 size={13} className="bsl-spin" /> Recherche…</div>
                      )}
                      {!searchLoading && searchError && <div className="msg">{searchError}</div>}
                      {!searchLoading && !searchError && suggestions.length === 0 && (
                        <div className="msg">Appuie sur Entrée pour lancer la recherche.</div>
                      )}
                      {!searchLoading &&
                        suggestions.map((c) => (
                          <button key={c.id} type="button" onClick={() => selectCrypto(c)}>
                            {c.thumb && <img src={c.thumb} alt="" />}
                            <span>{c.name}</span>
                            <span className="sym">{c.symbol?.toUpperCase()}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <button type="submit" className="bsl-run-btn" disabled={searchLoading}>
                  {searchLoading ? "…" : "ANALYSER"}
                </button>
              </form>
            </div>
          </div>

          <div className="bsl-timeframes">
            {TIMEFRAMES.map((tf) => (
              <button key={tf.key} className={timeframe === tf.key ? "active" : ""} onClick={() => setTimeframe(tf.key)}>
                {tf.label}
              </button>
            ))}
          </div>

          {error && <div className="bsl-error">{error}</div>}

          {combined && (
            <div className="bsl-stats">
              <StatCard label="Prix actuel" value={`${fmtPrice(currentPrice)} $`} />
              <StatCard
                label="Variation période"
                value={`${combined.pctChange >= 0 ? "+" : ""}${combined.pctChange.toFixed(2)} %`}
                tone={combined.pctChange >= 0 ? "buy" : "sell"}
              />
              <StatCard label="RSI" value={combined.rsiVal.toFixed(0)} />
              <StatCard
                label="Signal"
                value={combined.signal}
                tone={combined.signal === "Achat" ? "buy" : combined.signal === "Vente" ? "sell" : "neutral"}
              />
            </div>
          )}

          <div className="bsl-grid-2">
            <div className="bsl-panel bsl-chart-panel">
              <div className="bsl-panel-head">
                <h3>Évolution du cours</h3>
                <span className="sub">{displayName ? `${displayName} · ${selected.symbol}` : "En attente"}</span>
              </div>
              {!selected ? (
                <div className="bsl-empty">
                  <Search size={26} color="var(--text-dim)" />
                  <p>Recherche une crypto, une action ou un ETF pour afficher son cours.</p>
                </div>
              ) : loading ? (
                <div className="bsl-loading"><Loader2 size={18} className="bsl-spin" /> Chargement…</div>
              ) : series.length > 0 ? (
                <div style={{ height: 250, marginTop: 10 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="bslFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--cyan)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--purple)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="bslStroke" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="var(--cyan)" />
                          <stop offset="100%" stopColor="var(--purple)" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="time" tickFormatter={(t) => formatTick(t, timeframe)} stroke="var(--text-dim)" fontSize={11} tickLine={false} minTickGap={30} />
                      <YAxis domain={["auto", "auto"]} stroke="var(--text-dim)" fontSize={11} tickLine={false} tickFormatter={(v) => fmtPrice(v)} width={54} />
                      <Tooltip
                        contentStyle={{ background: "var(--bg-panel-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                        labelFormatter={(t) => new Date(t).toLocaleString("fr-FR")}
                        formatter={(v) => [`${fmtPrice(v)} $`, "Prix"]}
                      />
                      <Area type="monotone" dataKey="price" stroke="url(#bslStroke)" strokeWidth={2.2} fill="url(#bslFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bsl-empty"><p>Aucune donnée disponible.</p></div>
              )}
            </div>

            <div className="bsl-panel bsl-signal-panel">
              {!combined ? (
                <div className="bsl-empty">
                  <p>La synthèse apparaîtra ici une fois un actif chargé.</p>
                </div>
              ) : (
                <>
                  <SignalRing signal={combined.signal} confidencePct={combined.confidencePct} />
                  <ul className="bsl-legend">
                    {combined.factors.map((f, i) => (
                      <li key={i}>
                        <span
                          className="dotc"
                          style={{ background: f.dir > 0 ? "var(--buy)" : f.dir < 0 ? "var(--sell)" : "var(--neutral)" }}
                        />
                        {f.label}
                        <span className="verdict">{f.dir > 0 ? "haussier" : f.dir < 0 ? "baissier" : "neutre"}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          <div className="bsl-grid-2">
            <div className="bsl-panel bsl-news-panel">
              <div className="bsl-panel-head">
                <h3>Actualités récentes</h3>
                <span className="sub">source : GDELT</span>
              </div>
              {!selected ? (
                <div className="bsl-news-empty">Sélectionne un actif pour voir les actualités liées.</div>
              ) : newsLoading ? (
                <div className="bsl-news-empty"><Loader2 size={13} className="bsl-spin" style={{ verticalAlign: "middle", marginRight: 6 }} /> Recherche d'articles…</div>
              ) : newsError ? (
                <div className="bsl-news-empty">{newsError}</div>
              ) : news && news.articles.length > 0 ? (
                <ul className="bsl-news-list">
                  {news.articles.slice(0, 5).map((a, i) => (
                    <li key={i}>
                      <span className="time">{a.date ? a.date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                      <span className="domain">{a.domain}</span>
                      <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
                      <span className="pill"><ExternalLink size={12} /></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="bsl-news-empty">Pas d'article récent trouvé pour cet actif.</div>
              )}
            </div>

            <div className="bsl-panel bsl-detail-panel">
              <div className="bsl-panel-head">
                <h3>Justification détaillée</h3>
              </div>
              {!combined ? (
                <div className="bsl-news-empty">—</div>
              ) : (
                <ul className="bsl-factors">
                  {combined.factors.map((f, i) => (
                    <li key={i}>
                      <FactorIcon dir={f.dir} />
                      <div className="bsl-factor-text">
                        <span className="lbl">{f.label}</span>
                        <span className="det">{f.detail}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="bsl-footer">
            Si une source de données (marché ou actualités) est temporairement indisponible — limite de taux,
            panne, blocage réseau — l'application bascule automatiquement en <strong>mode démo</strong> clairement
            indiqué, avec des données simulées. Sources en conditions normales : CoinGecko (crypto), Yahoo Finance
            (actions/ETF), GDELT (actualités) — toutes publiques, sans clé requise. Ceci reste un outil informatif,
            pas un conseil financier.
          </div>
        </div>
      </div>
    </div>
  );
}
