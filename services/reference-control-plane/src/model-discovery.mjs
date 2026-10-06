// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Finding the model server a person already runs.
//
// Owner, 2026-10-06. The simple interface ends a first visit at "NOESAR needs a model to answer",
// and the page that connects one asks for a base URL, a model id, a priority and the modes. Someone
// who has Ollama or LM Studio running knows none of that, and should not need to.
//
// What this does: asks a short, fixed list of well-known ports whether they answer the
// OpenAI-compatible `GET /v1/models`, and reports who answered and what each one serves.
//
// What it never does: take an address from a request. The hosts come from the installation — a
// built-in list, the default gateway of the machine this runs on (which is the host, when this runs
// in a container), and `NOESAR_MODEL_DISCOVERY_HOSTS` set by whoever installed it. Every candidate
// must pass the same check a provider's base URL passes (`validate`, loopback or private network
// only), so it cannot propose an address the gateway would then refuse. A discovery that accepted a
// URL would be a request forwarder with a friendly name.

/** The servers people run for themselves, with the port each one listens on by default. */
export const DISCOVERY_PORTS = Object.freeze([
  Object.freeze({ port: 11434, name: 'Ollama' }),
  Object.freeze({ port: 1234, name: 'LM Studio' }),
  Object.freeze({ port: 8080, name: 'llama.cpp' }),
  Object.freeze({ port: 8000, name: 'vLLM' }),
]);

const BUILT_IN_HOSTS = Object.freeze(['127.0.0.1', 'host.docker.internal']);
const HOST_SHAPE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const MODELS_PER_SERVER = 50;
const MAX_BODY_CHARS = 1_000_000;

/** `NOESAR_MODEL_DISCOVERY_HOSTS`: names or IPv4 addresses, comma or space separated. Anything else is dropped. */
export function parseHosts(value) {
  return String(value ?? '').split(/[\s,]+/).map((item) => item.trim()).filter((item) => item && HOST_SHAPE.test(item));
}

/**
 * The default gateway from the text of `/proc/net/route`. In a container that address is the
 * machine the container runs on, which is where a person's Ollama is. Null when there is none or the
 * text is not what this expects (any system without that file).
 */
export function defaultGateway(routeText) {
  for (const line of String(routeText ?? '').split('\n').slice(1)) {
    const [, destination, gateway, flags] = line.trim().split(/\s+/);
    // Destination 0 is the default route; flag bit 2 is "has a gateway".
    if (destination !== '00000000' || !/^[0-9A-Fa-f]{8}$/.test(gateway ?? '')) continue;
    if (!(Number.parseInt(flags, 16) & 2)) continue;
    // The address is stored little-endian: 0100A8C0 is 192.168.0.1.
    const bytes = gateway.match(/../g).map((pair) => Number.parseInt(pair, 16)).reverse();
    if (bytes.join('.') !== '0.0.0.0') return bytes.join('.');
  }
  return null;
}

/** The hosts to ask, in order, without repeats. */
export function discoveryHosts({ env = {}, routeText = null } = {}) {
  const hosts = [...BUILT_IN_HOSTS];
  const gateway = defaultGateway(routeText);
  if (gateway) hosts.push(gateway);
  hosts.push(...parseHosts(env.NOESAR_MODEL_DISCOVERY_HOSTS));
  return [...new Set(hosts)];
}

/**
 * Ask every host on every port, all at once, and report who answered with a list of models.
 *
 * `validate(baseUrl)` throws for an address the gateway would refuse; such a candidate is skipped,
 * not reported. A host that is down, slow or answers with something that is not a model list is
 * not an error — it is simply not there.
 */
export async function discoverModelServers({ hosts, ports = DISCOVERY_PORTS, fetchImpl = globalThis.fetch, timeoutMs = 1500, validate = () => {} } = {}) {
  const candidates = [];
  for (const host of hosts ?? []) {
    for (const entry of ports) {
      const baseUrl = `http://${host}:${entry.port}/v1`;
      try { validate(baseUrl); } catch { continue; }
      candidates.push({ baseUrl, host, port: entry.port, name: entry.name });
    }
  }
  const asked = await Promise.all(candidates.map(async (candidate) => {
    try {
      const response = await fetchImpl(`${candidate.baseUrl}/models`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response?.ok) return null;
      const text = await response.text();
      if (text.length > MAX_BODY_CHARS) return null;
      const data = JSON.parse(text)?.data;
      if (!Array.isArray(data)) return null;
      const models = data.map((item) => item?.id ?? item?.name).filter((id) => typeof id === 'string' && id).slice(0, MODELS_PER_SERVER);
      // A server with no models is reported, with an empty list: "found it, it has nothing to run"
      // is a different thing to tell a person from "found nothing".
      return { ...candidate, models };
    } catch { return null; }
  }));
  return asked.filter(Boolean);
}
