export type MetricValue = {
  value?: number | string;
  labels?: Record<string, string | number>;
  metricName?: string;
};

export type HttpMetric = {
  name?: string;
  help?: string;
  type?: string;
  values?: MetricValue[];
};

export type AvailableMongo = {
  available: true;
  dataBytes: number;
  indexBytes: number;
  usedBytes: number;
  limitBytes: number;
  usedPercent: number;
  collections: number;
  indexes: number;
  documents: number;
  registeredUsersEstimate: number;
};

export type AvailableRedis = {
  available: true;
  usedBytes: number;
  peakUsedBytes: number | null;
  limitBytes: number;
  connectionLimit: number;
  providerMaxMemoryBytes: number | null;
  usedPercent: number;
  keys: number;
  connectedClients: number | null;
  commandsProcessed: number | null;
  operationsPerSecond: number | null;
  networkInputBytes: number | null;
  networkOutputBytes: number | null;
};

export type MetricsSnapshot = {
  generatedAt: string;
  process: {
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  mongodb: AvailableMongo | { available: false };
  redis: AvailableRedis | { available: false };
  http: HttpMetric[];
};

export type HttpSummary = {
  requests: number;
  errors: number;
  averageLatency: number | null;
  p95Latency: number | null;
  routes: { method: string; route: string; requests: number; errors: number; averageLatency: number | null }[];
};

export function summarizeHttp(metrics: HttpMetric[]): HttpSummary {
  const requestsMetric = metrics.find((metric) => metric.name === "lumen_http_requests_total");
  const durationMetric = metrics.find((metric) => metric.name === "lumen_http_request_duration_seconds");
  const routes = new Map<string, { method: string; route: string; requests: number; errors: number; sum: number; count: number }>();
  let requests = 0;
  let errors = 0;

  for (const item of requestsMetric?.values ?? []) {
    const amount = Number(item.value ?? 0);
    const method = String(item.labels?.method ?? "—");
    const route = String(item.labels?.route ?? "rota desconhecida");
    const status = Number(item.labels?.status ?? 0);
    const key = `${method} ${route}`;
    const row = routes.get(key) ?? { method, route, requests: 0, errors: 0, sum: 0, count: 0 };
    row.requests += amount;
    if (status >= 500) row.errors += amount;
    requests += amount;
    if (status >= 500) errors += amount;
    routes.set(key, row);
  }

  let durationSum = 0;
  let durationCount = 0;
  const buckets = new Map<number, number>();
  for (const item of durationMetric?.values ?? []) {
    const value = Number(item.value ?? 0);
    const le = item.labels?.le;
    if (le !== undefined) {
      const limit = le === "+Inf" ? Number.POSITIVE_INFINITY : Number(le);
      buckets.set(limit, (buckets.get(limit) ?? 0) + value);
      continue;
    }
    const metricName = item.metricName ?? "";
    if (metricName.endsWith("_sum")) {
      durationSum += value;
      const key = `${String(item.labels?.method ?? "—")} ${String(item.labels?.route ?? "rota desconhecida")}`;
      const row = routes.get(key);
      if (row) row.sum += value;
    }
    if (metricName.endsWith("_count")) {
      durationCount += value;
      const key = `${String(item.labels?.method ?? "—")} ${String(item.labels?.route ?? "rota desconhecida")}`;
      const row = routes.get(key);
      if (row) {
        row.count += value;
      }
    }
  }

  const p95Target = durationCount * 0.95;
  let cumulative = 0;
  let p95Latency: number | null = null;
  for (const [limit, count] of [...buckets.entries()].sort(([a], [b]) => a - b)) {
    cumulative += count;
    if (cumulative >= p95Target) {
      p95Latency = Number.isFinite(limit) ? limit : null;
      break;
    }
  }

  const routeRows = [...routes.values()]
    .map(({ method, route, requests: routeRequests, errors: routeErrors, sum, count }) => ({
      method,
      route,
      requests: routeRequests,
      errors: routeErrors,
      averageLatency: count > 0 ? sum / count : null,
    }))
    .sort((a, b) => b.requests - a.requests);

  return {
    requests,
    errors,
    averageLatency: durationCount > 0 ? durationSum / durationCount : null,
    p95Latency,
    routes: routeRows,
  };
}

export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: index === 0 ? 0 : 1 }).format(value / 1024 ** index)} ${units[index]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  if (days) return `${days}d ${hours}h ${minutes}min`;
  if (hours) return `${hours}h ${minutes}min`;
  if (minutes) return `${minutes}min ${secs}s`;
  return `${secs}s`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${formatNumber(value, 1)}%`;
}

export function formatLatency(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  return seconds < 1 ? `${formatNumber(seconds * 1000, 1)} ms` : `${formatNumber(seconds, 2)} s`;
}

export function humanizeMetric(name: string): string {
  const labels: Record<string, string> = {
    process_cpu_user_seconds_total: "CPU · tempo de usuário",
    process_cpu_system_seconds_total: "CPU · tempo de sistema",
    process_resident_memory_bytes: "Processo · memória residente",
    process_virtual_memory_bytes: "Processo · memória virtual",
    process_start_time_seconds: "Processo · início",
    process_open_fds: "Processo · arquivos abertos",
    process_max_fds: "Processo · limite de arquivos",
    nodejs_eventloop_lag_seconds: "Node.js · atraso do event loop",
    nodejs_heap_size_total_bytes: "Node.js · heap total",
    nodejs_heap_size_used_bytes: "Node.js · heap utilizado",
    nodejs_external_memory_bytes: "Node.js · memória externa",
    nodejs_active_handles: "Node.js · conexões ativas",
    nodejs_active_requests: "Node.js · requisições ativas",
  };
  if (labels[name]) return labels[name];
  return name.replace(/^lumen_/, "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("pt-BR"));
}
