"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  formatBytes,
  formatDuration,
  formatLatency,
  formatNumber,
  formatPercent,
  humanizeMetric,
  HttpMetric,
  MetricsSnapshot,
  summarizeHttp,
} from "@/lib/metrics";

type Sample = { at: number; requests: number; totalRequests: number; rss: number; heap: number; mongo: number | null; redis: number | null };

async function fetchMetrics(token: string): Promise<MetricsSnapshot> {
  const response = await fetch("/api/metrics", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Falha ao carregar as métricas.", { cause: response.status });
  return body as MetricsSnapshot;
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  switch (name) {
    case "pulse": return <svg {...common}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>;
    case "server": return <svg {...common}><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" /></svg>;
    case "database": return <svg {...common}><ellipse cx="12" cy="5" rx="8.5" ry="3" /><path d="M3.5 5v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V5M3.5 12v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-7" /></svg>;
    case "activity": return <svg {...common}><path d="M3 3v18h18M7 14l4-4 4 3 5-7" /></svg>;
    case "clock": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "lock": return <svg {...common}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
    case "arrow": return <svg {...common}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
    case "logout": return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg>;
    case "refresh": return <svg {...common}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" /></svg>;
    default: return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
  }
}

function MiniChart({ values, color, label }: { values: number[]; color: string; label: string }) {
  const width = 320;
  const height = 94;
  const safe = values.length ? values : [0];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const span = max - min || 1;
  const points = safe.map((value, index) => `${safe.length === 1 ? width : (index / (safe.length - 1)) * width},${height - 8 - ((value - min) / span) * (height - 16)}`).join(" ");
  const first = points.split(" ")[0].split(",")[0];
  const last = points.split(" ").at(-1)?.split(",")[0] ?? String(width);
  const area = `${first},${height} ${points} ${last},${height}`;
  return <svg className="mini-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
    <defs><linearGradient id={`fill-${color.replace("#", "")}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".18" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
    <path d={`M ${area} Z`} fill={`url(#fill-${color.replace("#", "")})`} />
    <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function Progress({ value, tone = "green" }: { value: number; tone?: "green" | "amber" | "blue" }) {
  return <div className="progress-track"><div className={`progress-value ${tone}`} style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} /></div>;
}

function Stat({ label, value, note, icon }: { label: string; value: string; note?: string; icon?: string }) {
  return <div className="stat"><div className="stat-label">{icon && <span className="stat-icon"><Icon name={icon} size={15} /></span>}{label}</div><strong className="stat-value">{value}</strong>{note && <span className="stat-note">{note}</span>}</div>;
}

export function Dashboard() {
  const [token, setToken] = useState("");
  const [inputToken, setInputToken] = useState("");
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(10);
  const [showRaw, setShowRaw] = useState(false);
  const lock = useRef(false);

  const request = useCallback(async (currentToken: string, initial = false) => {
    if (lock.current) return;
    lock.current = true;
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const next = await fetchMetrics(currentToken);
      const summary = summarizeHttp(next.http ?? []);
      const now = Date.now();
      setSnapshot(next);
      setError("");
      setLastUpdated(now);
      setSecondsUntilRefresh(10);
      setSamples((previous) => {
        let requestRate = 0;
        const last = previous.at(-1);
        if (last && summary.requests >= last.totalRequests) {
          const elapsed = (now - last.at) / 1000;
          if (elapsed > 0) requestRate = (summary.requests - last.totalRequests) / elapsed;
        }
        return [...previous, {
          at: now,
          requests: requestRate,
          totalRequests: summary.requests,
          rss: next.process.rssBytes,
          heap: next.process.heapUsedBytes,
          mongo: next.mongodb.available ? next.mongodb.usedBytes : null,
          redis: next.redis.available ? next.redis.usedBytes : null,
        }].slice(-60);
      });
    } catch (cause) {
      const failure = cause as Error & { cause?: number };
      setError(failure.cause === 401 ? "Token inválido. Confira o token e entre novamente." : failure.message || "Não foi possível atualizar as métricas.");
      if (failure.cause === 401) {
        setToken("");
        setSnapshot(null);
        setSamples([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      lock.current = false;
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    const initialRefresh = window.setTimeout(() => void request(token, true), 0);
    let seconds = 10;
    const interval = window.setInterval(() => {
      seconds = seconds <= 1 ? 10 : seconds - 1;
      setSecondsUntilRefresh(seconds);
      if (seconds === 10) void request(token);
    }, 1_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [token, request]);

  const http = useMemo(() => summarizeHttp(snapshot?.http ?? []), [snapshot]);
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextToken = inputToken.trim();
    if (!nextToken) return;
    setError("");
    setSamples([]);
    setLoading(true);
    setToken(nextToken);
    setInputToken("");
  }

  function logout() {
    setToken("");
    setSnapshot(null);
    setSamples([]);
    setError("");
    setLastUpdated(null);
  }

  if (!snapshot) {
    return <main className="login-screen">
      <div className="login-orb orb-one" /><div className="login-orb orb-two" />
      <section className="login-card">
        <div className="brand-mark"><Image src="/lumen-cyberpunk-logo.png" width={256} height={256} alt="Logo Lumen" priority /></div>
        <div className="eyebrow">LUMEN · OBSERVABILIDADE</div>
        <h1>Visibilidade clara.<br /><span>Operação tranquila.</span></h1>
        <p className="login-copy">Acesse o monitoramento da API Lumen com seu token de métricas.</p>
        <form onSubmit={handleLogin} className="login-form">
          <label htmlFor="metrics-token">Token de métricas</label>
          <div className="input-wrap"><Icon name="lock" size={17} /><input id="metrics-token" type="password" autoComplete="off" placeholder="Cole seu METRICS_TOKEN" value={inputToken} onChange={(event) => setInputToken(event.target.value)} required autoFocus /></div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button-primary login-button" type="submit" disabled={loading || !inputToken.trim()}>{loading ? <><span className="spinner" />Validando acesso</> : <>Acessar dashboard <Icon name="arrow" size={17} /></>}</button>
        </form>
        <div className="secure-note"><span className="secure-dot" />Seu token fica somente nesta aba e não é salvo.</div>
      </section>
      <div className="login-foot"><span>AMBIENTE DE MONITORAMENTO</span><span>API LUMEN <b>·</b> v1</span></div>
    </main>;
  }

  const mongo = snapshot.mongodb;
  const redis = snapshot.redis;
  const memoryPercent = snapshot.process.heapTotalBytes > 0 ? snapshot.process.heapUsedBytes / snapshot.process.heapTotalBytes * 100 : 0;
  const errorsPercent = http.requests > 0 ? http.errors / http.requests * 100 : 0;
  const nodeMetrics = (snapshot.http as HttpMetric[]).filter((metric) => metric.name && !metric.name.startsWith("lumen_http_") && metric.values?.length);
  const latestRequestRate = samples.length > 1 ? samples.at(-1)?.requests ?? 0 : 0;
  const systemHealthy = mongo.available && redis.available && errorsPercent < 5;
  const statusLabel = error ? "Conexão instável" : systemHealthy ? "Tudo operacional" : "Atenção necessária";

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="side-brand"><div className="brand-mark small"><Image src="/lumen-cyberpunk-logo.png" width={128} height={128} alt="" /></div><span>lumen<span className="brand-dot">.</span></span></div>
      <div className="side-label">MONITORAMENTO</div>
      <a className="nav-link active" href="#visao-geral"><span className="nav-icon"><Icon name="activity" /></span><span>Visão geral</span><span className="nav-active-dot" /></a>
      <a className="nav-link" href="#recursos"><span className="nav-icon"><Icon name="server" /></span><span>Infraestrutura</span></a>
      <a className="nav-link" href="#requisicoes"><span className="nav-icon"><Icon name="pulse" /></span><span>Requisições</span></a>
      <div className="side-bottom"><div className="side-status"><span className={`status-dot ${systemHealthy ? "green" : "amber"}`} /><div><strong>{statusLabel}</strong><span>API Lumen · produção</span></div></div><button className="logout-button" onClick={logout}><Icon name="logout" size={17} />Sair do painel</button><div className="side-version">LUMEN MONITOR <span>v1.0</span></div></div>
    </aside>

    <section className="main-area" id="visao-geral">
      <header className="topbar"><div className="breadcrumb"><span>Monitoramento</span><span className="crumb-sep">/</span><strong>Visão geral</strong></div><div className="topbar-right"><span className="live-pill"><i /> AO VIVO</span><div className="topbar-separator" /><span className="updated-label">{lastUpdated ? `Atualizado às ${new Date(lastUpdated).toLocaleTimeString("pt-BR")}` : "Conectando…"}</span><button className="icon-button" title="Atualizar agora" aria-label="Atualizar agora" onClick={() => void request(token)} disabled={refreshing}><Icon name="refresh" size={17} /></button><button className="avatar" title="Sessão protegida"><Icon name="lock" size={15} /></button></div></header>

      <div className="content-wrap">
        <div className="page-heading"><div><div className="eyebrow">CENTRAL DE OPERAÇÕES <span className="heading-line" /></div><h1>Visão geral</h1><p>Acompanhe a saúde e o desempenho da sua API em tempo real.</p></div><div className="refresh-chip"><span className={`refresh-indicator ${refreshing ? "spinning" : ""}`}><Icon name="refresh" size={14} /></span><span>Próxima atualização em <b>{secondsUntilRefresh}s</b></span></div></div>

        {error && <div className="notice warning" role="status"><span className="notice-symbol">!</span><div><strong>Falha ao atualizar</strong><span>{error}</span></div><button onClick={() => void request(token)}>Tentar novamente</button></div>}

        <section className="overview-grid" aria-label="Resumo da API">
          <article className="overview-card overview-highlight"><div className="card-topline"><span>DISPONIBILIDADE</span><span className="overview-icon mint"><Icon name="pulse" /></span></div><div className="availability-value"><span className={`availability-dot ${systemHealthy ? "" : "amber"}`} /><strong>{systemHealthy ? "Operacional" : "Verificar serviços"}</strong></div><div className="card-foot"><span>MongoDB e Redis</span><span className={`tiny-status ${systemHealthy ? "positive" : "caution"}`}>{mongo.available && redis.available ? "AMBOS ONLINE" : "VERIFICAR"}</span></div></article>
          <article className="overview-card"><div className="card-topline"><span>REQUISIÇÕES TOTAIS</span><span className="overview-icon blue"><Icon name="activity" /></span></div><div className="overview-number">{formatNumber(http.requests)}</div><div className="card-foot"><span>Desde o início do processo</span><span className="metric-note">{formatNumber(latestRequestRate, 1)} req/s</span></div></article>
          <article className="overview-card"><div className="card-topline"><span>ERROS HTTP 5XX</span><span className="overview-icon coral"><span className="error-mark">!</span></span></div><div className="overview-number">{formatNumber(http.errors)}</div><div className="card-foot"><span>Respostas com falha</span><span className={`tiny-status ${errorsPercent < 1 ? "positive" : "caution"}`}>{formatPercent(errorsPercent)} DO TOTAL</span></div></article>
          <article className="overview-card"><div className="card-topline"><span>LATÊNCIA MÉDIA</span><span className="overview-icon violet"><Icon name="clock" /></span></div><div className="overview-number">{formatLatency(http.averageLatency)}</div><div className="card-foot"><span>Percentil 95</span><span className="metric-note">{formatLatency(http.p95Latency)}</span></div></article>
        </section>

        <section className="chart-grid" aria-label="Tendências recentes">
          <article className="panel chart-panel"><div className="panel-heading"><div><div className="section-kicker">TRÁFEGO</div><h2>Ritmo de requisições</h2></div><span className="range-tag">ÚLTIMOS 10 MIN</span></div><div className="chart-stat-row"><strong>{formatNumber(latestRequestRate, 1)} <small>req/s</small></strong><span className="chart-caption">{samples.length > 1 ? `Taxa nesta coleta · ${samples.length} amostras` : "Aguardando próxima amostra para calcular tendência"}</span></div><div className="chart-wrap"><div className="chart-axis"><span>{formatNumber(Math.max(...samples.map((sample) => sample.requests), 0), 1)}</span><span>{formatNumber(Math.max(...samples.map((sample) => sample.requests), 0) / 2, 1)}</span><span>0</span></div><div className="chart-lines"><i /><i /><i /><MiniChart values={samples.map((sample) => sample.requests)} color="#04c4d9" label="Taxa de requisições por segundo" /></div></div><div className="chart-xaxis"><span>{samples.length ? new Date(samples[0].at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span><span>Atualizações a cada 10 segundos</span><span>agora</span></div></article>
          <article className="panel chart-panel"><div className="panel-heading"><div><div className="section-kicker">PROCESSO NODE.JS</div><h2>Uso de memória</h2></div><span className="range-tag">RSS</span></div><div className="chart-stat-row"><strong>{formatBytes(snapshot.process.rssBytes)}</strong><span className="chart-caption">Memória residente do processo</span></div><div className="chart-wrap memory-chart"><div className="chart-axis"><span>{formatBytes(Math.max(...samples.map((sample) => sample.rss), snapshot.process.rssBytes))}</span><span>{formatBytes(Math.max(...samples.map((sample) => sample.rss), snapshot.process.rssBytes) / 2)}</span><span>0</span></div><div className="chart-lines"><i /><i /><i /><MiniChart values={samples.map((sample) => sample.rss)} color="#a778ff" label="Memória residente do processo ao longo do tempo" /></div></div><div className="chart-xaxis"><span>{samples.length ? new Date(samples[0].at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span><span>Heap {formatPercent(memoryPercent)} utilizado</span><span>agora</span></div></article>
        </section>

        <section className="section-block" id="recursos"><div className="section-title"><div><div className="section-kicker">CAMADA DE DADOS</div><h2>Infraestrutura</h2></div><span className="section-subtitle">Saúde e consumo dos serviços conectados</span></div><div className="resource-grid">
          <article className="panel resource-card"><div className="resource-head"><span className="resource-icon mongo-icon"><Icon name="database" /></span><div><h3>MongoDB</h3><span className={`service-state ${mongo.available ? "online" : "offline"}`}><i />{mongo.available ? "Conectado" : "Indisponível"}</span></div><span className="resource-menu">···</span></div>{mongo.available ? <><div className="usage-heading"><span>Armazenamento utilizado</span><strong>{formatPercent(mongo.usedPercent)}</strong></div><Progress value={mongo.usedPercent} tone={mongo.usedPercent >= 85 ? "amber" : "green"} /><div className="usage-values"><strong>{formatBytes(mongo.usedBytes)}</strong><span>de {formatBytes(mongo.limitBytes)}</span></div><div className="resource-divider" /><div className="resource-stats"><Stat label="Documentos" value={formatNumber(mongo.documents)} /><Stat label="Coleções" value={formatNumber(mongo.collections)} /><Stat label="Índices" value={formatNumber(mongo.indexes)} /></div><div className="resource-foot">Usuários cadastrados <strong>~{formatNumber(mongo.registeredUsersEstimate)}</strong></div></> : <Unavailable />}</article>

          <article className="panel resource-card"><div className="resource-head"><span className="resource-icon redis-icon"><Icon name="server" /></span><div><h3>Redis</h3><span className={`service-state ${redis.available ? "online" : "offline"}`}><i />{redis.available ? "Conectado" : "Indisponível"}</span></div><span className="resource-menu">···</span></div>{redis.available ? <><div className="usage-heading"><span>Memória utilizada</span><strong>{formatPercent(redis.usedPercent)}</strong></div><Progress value={redis.usedPercent} tone={redis.usedPercent >= 85 ? "amber" : "blue"} /><div className="usage-values"><strong>{formatBytes(redis.usedBytes)}</strong><span>de {formatBytes(redis.limitBytes)}</span></div><div className="resource-divider" /><div className="resource-stats"><Stat label="Chaves" value={formatNumber(redis.keys)} /><Stat label="Conexões" value={`${formatNumber(redis.connectedClients)} / ${formatNumber(redis.connectionLimit)}`} /><Stat label="Operações/s" value={formatNumber(redis.operationsPerSecond)} /></div><div className="resource-foot">Pico de memória <strong>{formatBytes(redis.peakUsedBytes)}</strong></div></> : <Unavailable />}</article>

          <article className="panel resource-card process-card"><div className="resource-head"><span className="resource-icon process-icon"><Icon name="pulse" /></span><div><h3>Processo da API</h3><span className="service-state online"><i />Em execução</span></div><span className="resource-menu">···</span></div><div className="process-big"><strong>{formatDuration(snapshot.process.uptimeSeconds)}</strong><span>tempo ativo</span></div><div className="heap-block"><div className="usage-heading"><span>Heap utilizado</span><strong>{formatPercent(memoryPercent)}</strong></div><Progress value={memoryPercent} tone="green" /><div className="usage-values"><strong>{formatBytes(snapshot.process.heapUsedBytes)}</strong><span>de {formatBytes(snapshot.process.heapTotalBytes)}</span></div></div><div className="resource-divider" /><div className="resource-stats process-stats"><Stat label="RSS" value={formatBytes(snapshot.process.rssBytes)} /><Stat label="Memória externa" value={formatBytes(snapshot.process.externalBytes)} /><Stat label="Métricas coletadas" value={formatNumber(snapshot.http.length)} /></div></article>
        </div></section>

        <section className="section-block" id="requisicoes"><div className="section-title"><div><div className="section-kicker">API</div><h2>Requisições HTTP</h2></div><span className="section-subtitle">Volume e duração por rota</span></div><article className="panel requests-panel"><div className="table-toolbar"><div className="table-legend"><span><i className="legend-dot green" />Sucesso e demais respostas</span><span><i className="legend-dot coral" />Erros 5xx</span></div><span className="table-total">{formatNumber(http.routes.length)} {http.routes.length === 1 ? "rota" : "rotas"}</span></div>{http.routes.length ? <div className="table-scroll"><table><thead><tr><th>MÉTODO</th><th>ROTA</th><th>REQUISIÇÕES</th><th>ERROS 5XX</th><th>LATÊNCIA MÉDIA</th></tr></thead><tbody>{http.routes.map((route) => <tr key={`${route.method}-${route.route}`}><td><span className={`method-badge method-${route.method.toLowerCase()}`}>{route.method}</span></td><td className="route-name">{route.route}</td><td><span className="table-number">{formatNumber(route.requests)}</span></td><td><span className={route.errors ? "error-count" : "muted-count"}>{formatNumber(route.errors)}</span></td><td>{formatLatency(route.averageLatency)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><div className="empty-icon"><Icon name="activity" size={22} /></div><strong>Aguardando tráfego</strong><span>As rotas aparecerão aqui após receberem requisições.</span></div>}</article>

          <article className="panel raw-panel"><button className="raw-toggle" aria-expanded={showRaw} onClick={() => setShowRaw((value) => !value)}><span><span className="raw-chevron">{showRaw ? "−" : "+"}</span><span><strong>Métricas detalhadas</strong><small>Dados adicionais do processo retornados pela API</small></span></span><span className="raw-count">{nodeMetrics.length} séries</span></button>{showRaw && <div className="table-scroll raw-table-scroll">{nodeMetrics.length ? <table><thead><tr><th>MÉTRICA</th><th>TIPO</th><th>DESCRIÇÃO</th><th>VALOR(ES)</th></tr></thead><tbody>{nodeMetrics.map((metric) => <MetricRows key={metric.name} metric={metric} />)}</tbody></table> : <div className="empty-state compact">Sem métricas adicionais nesta coleta.</div>}</div>}</article>
        </section>

        <footer className="footer"><span><span className="footer-mark"><Icon name="pulse" size={13} /></span> LUMEN MONITOR</span><span>Dados coletados pela API · intervalo de {10} segundos · {formatNumber(samples.length)} amostras nesta sessão</span></footer>
      </div>
    </section>
  </main>;
}

function Unavailable() {
  return <div className="unavailable"><span className="unavailable-icon">!</span><strong>Serviço indisponível</strong><span>Não foi possível obter os dados nesta coleta.</span></div>;
}

function MetricRows({ metric }: { metric: HttpMetric }) {
  const values = metric.values ?? [];
  return <>
    <tr><td className="metric-row-name">{humanizeMetric(metric.name ?? "Métrica")}</td><td><span className="type-pill">{metric.type ?? "—"}</span></td><td className="metric-help">{metric.help ?? "—"}</td><td>{formatNumber(Number(values[0]?.value ?? 0), 2)}{values.length > 1 ? ` · +${values.length - 1} séries` : ""}</td></tr>
  </>;
}
