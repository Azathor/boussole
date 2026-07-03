import { useState, useEffect, useMemo, useRef } from "react";
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
  X,
} from "lucide-react";

const TIMEFRAMES = [
  { key: "4h", label: "4H" },
  { key: "1d", label: "Jour" },
  { key: "1w", label: "Semaine" },
  { key: "1m", label: "Mois" },
  { key: "1y", label: "Année" },
];

const FILTERS = [
  { key: "ALL", label: "Tous" },
  { key: "EQUITY", label: "Actions" },
  { key: "ETF", label: "ETF" },
  { key: "CRYPTOCURRENCY", label: "Crypto" },
  { key: "INDEX", label: "Indices" },
];

const ALLOWED_TYPES = new Set(["EQUITY", "ETF", "CRYPTOCURRENCY", "INDEX", "MUTUALFUND"]);

function typeLabel(quoteType) {
  switch (quoteType) {
    case "EQUITY":
      return "Action";
    case "ETF":
      return "ETF";
    case "CRYPTOCURRENCY":
      return "Crypto";
    case "INDEX":
      return "Indice";
    case "MUTUALFUND":
      return "Fonds";
    default:
      return quoteType || "Actif";
  }
}

const AVATAR_PAIRS = [
  ["#4FD8EA", "#B084F5"],
  ["#34D9A0", "#4FD8EA"],
  ["#F5B942", "#F2607A"],
  ["#B084F5", "#F2607A"],
  ["#34D9A0", "#F5B942"],
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function avatarGradient(symbol) {
  const [a, b] = AVATAR_PAIRS[Math.abs(hashStr(symbol)) % AVATAR_PAIRS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

// ---------- network helpers ----------

async function fetchWithTimeout(url, ms = 5000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("http_" + res.status);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

async function fetchJSON(url) {
  const attempts = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  ];
  let lastErr;
  for (const attemptUrl of attempts) {
    try {
      return await fetchWithTimeout(attemptUrl, 5000);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function searchYahoo(q) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    q
  )}&quotesCount=12&newsCount=0`;
  return fetchJSON(url);
}

// ---------- mode démo (repli si une source de données est indisponible) ----------

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

function paramsFor(tf) {
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

// ---------- search modal (façon TradingView, plein écran sur mobile) ----------

function SearchModal({ query, setQuery, onClose, onSelect }) {
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const data = await searchYahoo(query.trim());
        const quotes = (data.quotes || [])
          .filter((q) => ALLOWED_TYPES.has(q.quoteType) && q.symbol)
          .map((q) => ({
            symbol: q.symbol,
            name: q.longname || q.shortname || q.symbol,
            quoteType: q.quoteType,
            exchange: q.exchDisp || q.exchange || "",
          }));
        setResults(quotes);
      } catch (e) {
        setResults([]);
        setError("Recherche indisponible pour le moment.");
      } finally {
        setLoading(false);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [query, retryTick]);

  const filtered = activeFilter === "ALL" ? results : results.filter((r) => r.quoteType === activeFilter);

  function handleSubmit(e) {
    e.preventDefault();
    if (filtered.length > 0) {
      onSelect(filtered[0]);
    } else if (query.trim()) {
      onSelect({ symbol: query.trim().toUpperCase(), name: query.trim(), quoteType: "EQUITY" });
    }
  }

  return (
    <div className="bsl-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bsl-modal">
        <form className="bsl-modal-head" onSubmit={handleSubmit}>
          <Search size={17} color="var(--text-dim)" />
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            placeholder="TotalEnergies, bitcoin, AAPL…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="bsl-modal-clear" onClick={() => setQuery("")}>
              Effacer
            </button>
          )}
          <button type="button" className="bsl-modal-close" onClick={onClose} aria-label="Fermer">
            <X size={16} />
          </button>
        </form>

        <div className="bsl-modal-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`bsl-filter-pill ${activeFilter === f.key ? "active" : ""}`}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="bsl-modal-list">
          {query.trim().length < 2 ? (
            <div className="bsl-modal-empty">Tape le nom ou le symbole d'un actif (2 caractères min.)</div>
          ) : loading ? (
            <div className="bsl-modal-empty">
              <Loader2 size={16} className="bsl-spin" style={{ verticalAlign: "middle", marginRight: 8 }} />
              Recherche…
            </div>
          ) : error ? (
            <div className="bsl-modal-empty">
              {error}
              <br />
              <button type="button" className="bsl-retry-btn" onClick={() => setRetryTick((n) => n + 1)}>
                Réessayer
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bsl-modal-empty">Aucun résultat pour « {query} ».</div>
          ) : (
            filtered.map((r) => (
              <button key={r.symbol + r.exchange} type="button" className="bsl-result-row" onClick={() => onSelect(r)}>
                <span className="bsl-avatar" style={{ background: avatarGradient(r.symbol) }}>
                  {r.symbol.slice(0, 2)}
                </span>
                <span className="bsl-result-main">
                  <span className="bsl-result-sym">{r.symbol}</span>
                  <span className="bsl-result-name">{r.name}</span>
                </span>
                <span className="bsl-result-meta">
                  <span className="bsl-result-exch">{r.exchange}</span>
                  <span className={`bsl-type-pill ${r.quoteType}`}>{typeLabel(r.quoteType)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- main component ----------

export default function App() {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState(null); // { symbol, name, quoteType }
  const [timeframe, setTimeframe] = useState("1d");
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [news, setNews] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [demoActive, setDemoActive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    if (!selected) return;
    loadAsset(selected);
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

  async function loadAsset(asset) {
    setLoading(true);
    setError(null);
    const { interval, range, slice, demoN } = paramsFor(timeframe);
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
      setSeries(downsample(points, 150));
      setDemoActive(false);
      setLastUpdate(new Date());
    } catch (err) {
      setSeries(generateDemoSeries(asset.symbol + timeframe, demoN));
      setDemoActive(true);
      setError("Source de données indisponible pour cet actif — affichage en mode démo.");
    } finally {
      setLoading(false);
    }
  }

  async function loadNews(asset) {
    setNewsLoading(true);
    setNewsError(null);
    try {
      const term = `${asset.name} ${asset.symbol}`;
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

  function handleSelect(item) {
    setSelected({ symbol: item.symbol, name: item.name, quoteType: item.quoteType });
    setQuery(`${item.name} (${item.symbol})`);
    setSearchOpen(false);
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

  return (
    <div className="bsl-app">
      <style>{`
        .bsl-app {
          --bg-panel: rgba(19,26,61,0.55);
          --bg-panel-2: rgba(15,20,48,0.75);
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
          max-width: 880px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .bsl-app * { box-sizing: border-box; }

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

        .bsl-topbar { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
        .bsl-topbar-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .bsl-brand { display: flex; align-items: center; gap: 10px; }
        .bsl-brand-icon {
          width: 34px; height: 34px; border-radius: 50%;
          background: linear-gradient(135deg, var(--cyan), var(--purple));
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          box-shadow: 0 0 22px rgba(79,216,234,0.35);
        }
        .bsl-brand h1 { font-family: var(--font-display); font-size: 16px; margin: 0; letter-spacing: 0.02em; font-weight: 600; }
        .bsl-brand span { display: block; font-size: 10.5px; color: var(--text-dim); margin-top: 1px; }

        .bsl-status-chip {
          display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim);
          padding: 6px 11px; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid var(--border);
          white-space: nowrap; flex-shrink: 0;
        }
        .bsl-status-chip .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); flex-shrink: 0; }
        .bsl-status-chip.live .dot { background: var(--buy); box-shadow: 0 0 8px var(--buy); }
        .bsl-status-chip.demo .dot { background: var(--neutral); box-shadow: 0 0 8px var(--neutral); }

        .bsl-search-trigger {
          display: flex; align-items: center; gap: 8px; width: 100%;
          background: var(--bg-panel-2); border: 1px solid var(--border); border-radius: 12px;
          padding: 12px 14px; color: var(--text-dim); font-size: 14px; cursor: pointer; text-align: left;
          transition: border-color 0.15s; min-height: 46px;
        }
        .bsl-search-trigger:hover, .bsl-search-trigger:focus-visible { border-color: rgba(79,216,234,0.4); outline: none; }
        .bsl-search-trigger .val { color: var(--text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .bsl-modal-overlay {
          position: fixed; inset: 0; background: rgba(4,6,18,0.72); backdrop-filter: blur(6px);
          z-index: 60; display: flex; justify-content: center; padding: 8vh 16px 16px;
        }
        .bsl-modal {
          width: min(640px, 100%); max-height: 78vh; display: flex; flex-direction: column;
          background: var(--bg-panel-2); border: 1px solid var(--border); border-radius: 16px;
          backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
          box-shadow: 0 50px 90px -20px rgba(0,0,0,0.65); overflow: hidden;
        }
        @media (max-width: 640px) {
          .bsl-modal-overlay { padding: 0; padding-top: env(safe-area-inset-top); }
          .bsl-modal { width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
        }
        .bsl-modal-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
        .bsl-modal-head input {
          flex: 1; background: transparent; border: none; color: var(--text); font-size: 16px;
          font-family: var(--font); min-width: 0;
        }
        .bsl-modal-head input:focus { outline: none; }
        .bsl-modal-clear { background: transparent; border: none; color: var(--text-dim); font-size: 12px; cursor: pointer; padding: 6px; }
        .bsl-modal-clear:hover { color: var(--text); }
        .bsl-modal-close {
          background: rgba(255,255,255,0.06); border: none; border-radius: 8px; width: 30px; height: 30px;
          display: flex; align-items: center; justify-content: center; color: var(--text-dim); cursor: pointer; flex-shrink: 0;
        }
        .bsl-modal-close:hover { background: rgba(255,255,255,0.1); color: var(--text); }

        .bsl-modal-filters { display: flex; gap: 6px; padding: 10px 16px; flex-wrap: nowrap; overflow-x: auto; border-bottom: 1px solid var(--border); scrollbar-width: none; }
        .bsl-modal-filters::-webkit-scrollbar { display: none; }
        .bsl-filter-pill {
          background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--text-dim);
          font-size: 12.5px; padding: 7px 14px; border-radius: 999px; cursor: pointer; font-family: var(--font);
          transition: all 0.15s; flex-shrink: 0; min-height: 34px;
        }
        .bsl-filter-pill:hover { border-color: rgba(79,216,234,0.4); }
        .bsl-filter-pill.active { background: linear-gradient(120deg, var(--cyan), var(--purple)); border-color: transparent; color: #08101f; font-weight: 700; }

        .bsl-modal-list { overflow-y: auto; flex: 1; -webkit-overflow-scrolling: touch; }
        .bsl-modal-empty { padding: 44px 20px; text-align: center; color: var(--text-dim); font-size: 13px; }
        .bsl-retry-btn {
          margin-top: 10px; background: rgba(79,216,234,0.1); border: 1px solid rgba(79,216,234,0.3); color: var(--cyan);
          font-size: 12.5px; padding: 8px 16px; border-radius: 999px; cursor: pointer; font-family: var(--font);
        }
        .bsl-retry-btn:hover { background: rgba(79,216,234,0.18); }
        .bsl-result-row {
          display: flex; width: 100%; align-items: center; gap: 12px; padding: 13px 16px; cursor: pointer;
          border: none; background: transparent; border-bottom: 1px solid rgba(255,255,255,0.03);
          transition: background 0.12s; text-align: left; font-family: var(--font); min-height: 56px;
        }
        .bsl-result-row:hover, .bsl-result-row:focus-visible, .bsl-result-row:active { background: rgba(255,255,255,0.05); outline: none; }
        .bsl-avatar {
          width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-weight: 700; font-size: 12px; color: #08101f; flex-shrink: 0;
        }
        .bsl-result-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .bsl-result-sym { font-family: var(--font-mono); font-weight: 600; font-size: 13.5px; color: var(--text); }
        .bsl-result-name { font-size: 12px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bsl-result-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
        .bsl-result-exch { font-size: 10.5px; color: var(--text-dim); }

        .bsl-timeframes { display: flex; gap: 6px; padding: 0 2px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
        .bsl-timeframes::-webkit-scrollbar { display: none; }
        .bsl-timeframes button {
          background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-dim); font-size: 13px;
          padding: 8px 15px; border-radius: 999px; cursor: pointer; font-family: var(--font); transition: all 0.15s;
          flex-shrink: 0; min-height: 38px;
        }
        .bsl-timeframes button:hover { transform: translateY(-1px); }
        .bsl-timeframes button.active { background: linear-gradient(120deg, var(--cyan), var(--purple)); border-color: transparent; color: #08101f; font-weight: 700; }
        .bsl-timeframes button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }

        .bsl-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        @media (max-width: 560px) { .bsl-stats { grid-template-columns: repeat(2, 1fr); } }
        .bsl-stat { padding: 13px 14px; }
        .bsl-stat-label { font-size: 10px; letter-spacing: 0.08em; color: var(--text-dim); text-transform: uppercase; }
        .bsl-stat-value { font-family: var(--font-mono); font-size: 18px; font-weight: 600; margin-top: 6px; }
        .bsl-stat-value.buy { color: var(--buy); }
        .bsl-stat-value.sell { color: var(--sell); }
        .bsl-stat-value.neutral { color: var(--neutral); }

        .bsl-error { background: rgba(242,96,122,0.1); border: 1px solid var(--sell); color: var(--text); padding: 10px 14px; border-radius: 10px; font-size: 13px; }

        .bsl-grid-2 { display: grid; grid-template-columns: 1.5fr 1fr; gap: 14px; }
        @media (max-width: 700px) { .bsl-grid-2 { grid-template-columns: 1fr; } }

        .bsl-chart-panel, .bsl-signal-panel, .bsl-news-panel, .bsl-detail-panel { padding: 16px; }
        .bsl-panel-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; gap: 10px; flex-wrap: wrap; }
        .bsl-panel-head h3 { font-family: var(--font-display); font-size: 14px; margin: 0; font-weight: 600; }
        .bsl-panel-head .sub { font-size: 11px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .bsl-type-pill {
          font-size: 9.5px; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
          background: rgba(176,132,245,0.14); color: var(--purple); border: 1px solid rgba(176,132,245,0.3);
        }
        .bsl-type-pill.CRYPTOCURRENCY { background: rgba(52,217,160,0.12); color: var(--buy); border-color: rgba(52,217,160,0.3); }

        .bsl-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 44px 18px; color: var(--text-dim); text-align: center; gap: 10px; }
        .bsl-loading { display: flex; align-items: center; justify-content: center; padding: 44px 0; color: var(--text-dim); gap: 8px; }
        .bsl-spin { animation: bsl-spin 1s linear infinite; }
        @keyframes bsl-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .bsl-spin { animation: none; } }

        .bsl-signal-panel { display: flex; flex-direction: column; align-items: center; text-align: center; }
        .bsl-ring { width: 140px; height: 140px; }
        .bsl-ring-signal { font-size: 16px; font-weight: 700; font-family: var(--font-display); }
        .bsl-ring-conf { font-size: 9.5px; fill: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; }
        .bsl-legend { list-style: none; margin: 14px 0 0; padding: 0; width: 100%; display: flex; flex-direction: column; gap: 9px; text-align: left; }
        .bsl-legend li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
        .bsl-legend .dotc { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .bsl-legend .verdict { margin-left: auto; font-size: 10.5px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }

        .bsl-news-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; }
        .bsl-news-list li { display: flex; flex-direction: column; gap: 4px; padding: 12px 0; border-top: 1px solid var(--border); font-size: 13px; }
        .bsl-news-list li:first-child { border-top: none; padding-top: 0; }
        .bsl-news-list .meta-row { display: flex; gap: 8px; align-items: center; font-size: 11px; color: var(--text-dim); }
        .bsl-news-list .time { font-family: var(--font-mono); }
        .bsl-news-list .domain { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bsl-news-list a { color: var(--text); text-decoration: none; transition: color 0.15s; display: flex; align-items: flex-start; gap: 6px; }
        .bsl-news-list a:hover, .bsl-news-list a:focus-visible { color: var(--cyan); }
        .bsl-news-list a svg { flex-shrink: 0; margin-top: 3px; opacity: 0.6; }
        .bsl-news-empty { color: var(--text-dim); font-size: 12px; padding: 6px 0; }

        .bsl-factors { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
        .bsl-factors li { display: flex; gap: 8px; align-items: flex-start; border-top: 1px solid var(--border); padding-top: 10px; }
        .bsl-factors li:first-child { border-top: none; padding-top: 0; }
        .bsl-factor-text .lbl { font-size: 12px; font-weight: 600; color: var(--text); display: block; margin-bottom: 2px; }
        .bsl-factor-text .det { font-size: 12px; color: var(--text-dim); line-height: 1.45; }

        .bsl-footer { font-size: 10.5px; color: var(--text-dim); line-height: 1.5; padding: 2px 4px 0; }
      `}</style>

      <div className="bsl-panel bsl-topbar">
        <div className="bsl-topbar-row">
          <div className="bsl-brand">
            <div className="bsl-brand-icon">
              <Plus size={16} color="#08101f" strokeWidth={3} />
            </div>
            <div>
              <h1>Boussole</h1>
              <span>Radar actions &amp; crypto</span>
            </div>
          </div>
          <span className={`bsl-status-chip ${demoActive ? "demo" : selected ? "live" : ""}`}>
            <span className="dot" />
            {demoActive ? "Mode démo" : selected ? "En direct" : "En attente"}
          </span>
        </div>
        <button type="button" className="bsl-search-trigger" onClick={() => setSearchOpen(true)}>
          <Search size={16} />
          <span className="val">{query || "Rechercher une action, un ETF, une crypto…"}</span>
        </button>
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
            <span className="sub">
              {selected ? (
                <>
                  {selected.name} · {selected.symbol}
                  <span className={`bsl-type-pill ${selected.quoteType}`}>{typeLabel(selected.quoteType)}</span>
                </>
              ) : (
                "En attente"
              )}
            </span>
          </div>
          {!selected ? (
            <div className="bsl-empty">
              <Search size={26} color="var(--text-dim)" />
              <p>Recherche une action, un ETF ou une crypto pour afficher son cours.</p>
            </div>
          ) : loading ? (
            <div className="bsl-loading"><Loader2 size={18} className="bsl-spin" /> Chargement…</div>
          ) : series.length > 0 ? (
            <div style={{ height: 230, marginTop: 10 }}>
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
                  <XAxis dataKey="time" tickFormatter={(t) => formatTick(t, timeframe)} stroke="var(--text-dim)" fontSize={10} tickLine={false} minTickGap={26} />
                  <YAxis domain={["auto", "auto"]} stroke="var(--text-dim)" fontSize={10} tickLine={false} tickFormatter={(v) => fmtPrice(v)} width={46} />
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
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={12} />
                    <span>{a.title}</span>
                  </a>
                  <span className="meta-row">
                    <span className="domain">{a.domain}</span>
                    {a.date && <span className="time">· {a.date.toLocaleDateString("fr-FR")}</span>}
                  </span>
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
        Recherche unifiée (actions, ETF, crypto) via Yahoo Finance — sans clé API, avec double repli réseau pour
        plus de fiabilité. Si une source de données est temporairement indisponible, l'application bascule
        automatiquement en <strong>mode démo</strong> clairement indiqué. Ceci reste un outil informatif, pas un
        conseil financier.
      </div>

      {searchOpen && (
        <SearchModal
          query={query}
          setQuery={setQuery}
          onClose={() => setSearchOpen(false)}
          onSelect={handleSelect}
        />
      )}
    </div>
  );
}
