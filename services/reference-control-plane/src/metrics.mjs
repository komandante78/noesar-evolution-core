// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Prometheus text-format metrics.
//
// Route labels are normalised before use: an identifier in a path would make
// label cardinality grow without bound, which turns a metrics endpoint into a
// memory leak.
const DURATION_BUCKETS = Object.freeze([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeRoute(pathname) {
  const segments = String(pathname ?? '/').split('/').filter(Boolean);
  const normalized = segments.map((segment) => {
    if (UUID.test(segment)) return ':id';
    if (/^\d+$/.test(segment)) return ':n';
    if (segment.length > 24) return ':id';
    return segment;
  });
  const route = `/${normalized.join('/')}`;
  return route.length > 120 ? '/other' : route;
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labelString(labels) {
  const entries = Object.entries(labels).filter(([, value]) => value !== null && value !== undefined);
  if (!entries.length) return '';
  return `{${entries.map(([name, value]) => `${name}="${escapeLabel(value)}"`).join(',')}}`;
}

export class Metrics {
  constructor({ buildInfo = {}, maxSeries = 2000 } = {}) {
    this.buildInfo = buildInfo;
    this.maxSeries = maxSeries;
    this.counters = new Map();
    this.gauges = new Map();
    this.histogram = { buckets: new Map(), sum: 0, count: 0 };
    this.startedAt = Date.now();
  }

  #key(name, labels) { return `${name}${labelString(labels)}`; }

  increment(name, labels = {}, amount = 1) {
    const key = this.#key(name, labels);
    if (!this.counters.has(key) && this.counters.size >= this.maxSeries) return;
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  setGauge(name, value, labels = {}) {
    this.gauges.set(this.#key(name, labels), Number(value));
  }

  observeHttp({ route, status, seconds }) {
    const normalized = normalizeRoute(route);
    this.increment('noesar_http_requests_total', { route: normalized, status: String(status) });
    this.histogram.sum += seconds;
    this.histogram.count += 1;
    for (const bucket of DURATION_BUCKETS) {
      if (seconds <= bucket) {
        const key = String(bucket);
        this.histogram.buckets.set(key, (this.histogram.buckets.get(key) ?? 0) + 1);
      }
    }
  }

  render() {
    const lines = [];
    lines.push('# HELP noesar_up 1 when the control plane is serving.');
    lines.push('# TYPE noesar_up gauge');
    lines.push('noesar_up 1');
    lines.push('# HELP noesar_build_info Build metadata as labels; the value is always 1.');
    lines.push('# TYPE noesar_build_info gauge');
    lines.push(`noesar_build_info${labelString(this.buildInfo)} 1`);
    lines.push('# HELP noesar_process_uptime_seconds Seconds since the process started.');
    lines.push('# TYPE noesar_process_uptime_seconds gauge');
    lines.push(`noesar_process_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(3)}`);

    const counterNames = new Map();
    for (const key of this.counters.keys()) {
      const name = key.split('{')[0];
      if (!counterNames.has(name)) counterNames.set(name, []);
      counterNames.get(name).push(key);
    }
    for (const [name, keys] of [...counterNames].sort()) {
      lines.push(`# TYPE ${name} counter`);
      for (const key of keys.sort()) lines.push(`${key} ${this.counters.get(key)}`);
    }

    const gaugeNames = new Map();
    for (const key of this.gauges.keys()) {
      const name = key.split('{')[0];
      if (!gaugeNames.has(name)) gaugeNames.set(name, []);
      gaugeNames.get(name).push(key);
    }
    for (const [name, keys] of [...gaugeNames].sort()) {
      lines.push(`# TYPE ${name} gauge`);
      for (const key of keys.sort()) lines.push(`${key} ${this.gauges.get(key)}`);
    }

    lines.push('# HELP noesar_http_request_duration_seconds Request latency.');
    lines.push('# TYPE noesar_http_request_duration_seconds histogram');
    for (const bucket of DURATION_BUCKETS) {
      lines.push(`noesar_http_request_duration_seconds_bucket{le="${bucket}"} ${this.histogram.buckets.get(String(bucket)) ?? 0}`);
    }
    lines.push(`noesar_http_request_duration_seconds_bucket{le="+Inf"} ${this.histogram.count}`);
    lines.push(`noesar_http_request_duration_seconds_sum ${this.histogram.sum.toFixed(6)}`);
    lines.push(`noesar_http_request_duration_seconds_count ${this.histogram.count}`);
    return `${lines.join('\n')}\n`;
  }
}
