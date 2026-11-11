import type { CollectionName, NetworkSnapshot } from '../model/collections';
import { CUSTOMER_HIDDEN_TEXT } from './customerPrivacy';
import { isPoleType } from './outsidePlant';

/**
 * Phase 16: one search over the network, used by the browser's search box and by the server's
 * `GET /search`, so both give the same answer. It only reads what is recorded: a hit names the
 * field that matched and the value as written. Nothing is worked out from position or guessed.
 */

export const SEARCH_KINDS = [
  'equipment',
  'pole',
  'cable',
  'core',
  'customer',
  'ont',
  'fault',
  'splitter',
  'closure',
  'duct',
  'span',
  'zone',
  'ponPort',
  'odfPort',
  'building',
  'slackLoop',
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  equipment: 'Equipment',
  pole: 'Poles',
  cable: 'Cables',
  core: 'Fibres',
  customer: 'Customers',
  ont: 'ONTs',
  fault: 'Faults',
  splitter: 'Splitters',
  closure: 'Closures',
  duct: 'Ducts',
  span: 'Spans',
  zone: 'Zones',
  ponPort: 'PON ports',
  odfPort: 'ODF ports',
  building: 'Buildings',
  slackLoop: 'Slack loops',
};

export const isSearchKind = (value: string): value is SearchKind => (SEARCH_KINDS as readonly string[]).includes(value);

export interface SearchHit {
  kind: SearchKind;
  /** The record the hit belongs to. A fibre belongs to its cable; a port to its OLT or ODF. */
  collection: CollectionName;
  id: string;
  /** The part inside the record: a fibre number, a PON port id or an ODF port id. */
  part?: string;
  /** The name as recorded, or the id when there is none. */
  label: string;
  /** Which field matched, in plain words, and its value exactly as written. */
  matched: { field: string; value: string };
  /** A few words of context (kind, area, status), only from recorded fields. */
  detail?: string;
  score: number;
}

export interface SearchOptions {
  kinds?: readonly SearchKind[];
  /** Hits per page (default 50). */
  limit?: number;
  /** Hits to skip, for paging (default 0). */
  offset?: number;
}

export interface SearchResult {
  query: string;
  total: number;
  offset: number;
  limit: number;
  hits: SearchHit[];
}

export type SearchableData = Partial<
  Pick<NetworkSnapshot, 'equipment' | 'cables' | 'customers' | 'faults' | 'splitters' | 'closures' | 'ducts' | 'spans' | 'zones' | 'onts' | 'buildings' | 'slackLoops'>
>;

export const SEARCH_DEFAULT_LIMIT = 50;
export const SEARCH_MAX_LIMIT = 500;
export const SEARCH_MAX_QUERY = 200;

/** Exact match beats a match at the start, which beats one inside. Ids, tags and serials weigh most. */
const EXACT = 100;
const PREFIX = 60;
const INSIDE = 30;

type Field = [label: string, value: unknown, weight?: number];

/**
 * A value as recorded, or undefined. A value hidden for this person's role (Phase 12) is not a value:
 * it is never matched or shown, so a search cannot find a customer by a name the reader may not see.
 */
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() && !v.includes(CUSTOMER_HIDDEN_TEXT) ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined;

/** The best match of one query among a record's fields, or undefined. */
function bestMatch(fields: readonly Field[], q: string): { field: string; value: string; score: number } | undefined {
  let best: { field: string; value: string; score: number } | undefined;
  for (const [field, raw, weight = 1] of fields) {
    const value = text(raw);
    if (!value) continue;
    const lower = value.toLowerCase();
    const at = lower.indexOf(q);
    if (at < 0) continue;
    const base = lower.length === q.length ? EXACT : at === 0 ? PREFIX : INSIDE;
    const score = base * weight;
    if (!best || score > best.score) best = { field, value, score };
  }
  return best;
}

const joinDetail = (...parts: unknown[]): string | undefined => {
  const kept = parts.map(text).filter((p): p is string => !!p);
  return kept.length ? kept.join(' · ') : undefined;
};

/** "CBL-01/5", "CBL-01:5", "CBL-01#5", "CBL-01 core 5", "Main road line fibre 12". */
const CORE_QUERY = /^(.+?)\s*(?:[/:#]|\s(?:core|fibre|fiber|f)\s*)\s*(\d{1,3})$/i;

/** Splits "OLT-01/PON-3", "OLT-01 / 0/1/3" or "ODF-1/P1/12" into a record part and a port part. */
const splitFirst = (q: string): [string, string] | undefined => {
  const at = q.indexOf('/');
  if (at <= 0 || at >= q.length - 1) return undefined;
  return [q.slice(0, at).trim(), q.slice(at + 1).trim()];
};

const KIND_ORDER = new Map(SEARCH_KINDS.map((k, i) => [k, i]));

/**
 * Every hit for `query`, best first, a page at a time. The total counts every hit, so a screen can
 * say "showing 50 of 1,240". Empty or blank queries find nothing.
 */
export function searchNetwork(data: SearchableData, query: string, options: SearchOptions = {}): SearchResult {
  const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, Math.floor(options.limit ?? SEARCH_DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const trimmed = query.trim().slice(0, SEARCH_MAX_QUERY);
  const q = trimmed.toLowerCase();
  if (!q) return { query: trimmed, total: 0, offset, limit, hits: [] };
  const wanted = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
  const want = (kind: SearchKind) => !wanted || wanted.has(kind);
  const hits: SearchHit[] = [];
  const push = (hit: Omit<SearchHit, 'score'>, score: number) => hits.push({ ...hit, score });

  for (const eq of data.equipment ?? []) {
    const pole = isPoleType(eq.type);
    const kind: SearchKind = pole ? 'pole' : 'equipment';
    if (want(kind)) {
      const m = bestMatch(
        [
          ['ID', eq.id, 1.2],
          ['Tag (QR)', eq.tagCode, 1.2],
          ['Serial number', eq.serialNumber, 1.2],
          ['Name', eq.name, 1.1],
          ['Pole number', eq.poleNumber, 1.1],
          ["Owner's pole number", eq.ownerPoleNumber, 1.1],
          ['Model', eq.model],
          ['Make', eq.manufacturer],
          ['IP address', eq.ipAddress],
          ['Site', eq.site],
          ['Area', eq.area, 0.5],
          ['Street', eq.street, 0.5],
        ],
        q,
      );
      if (m) push({ kind, collection: 'equipment', id: eq.id, label: eq.name || eq.id, matched: m, detail: joinDetail(eq.type, eq.area, eq.status) }, m.score);
    }
    if (want('ponPort')) {
      const [oltPart, portPart] = splitFirst(q) ?? [];
      const oltNamed = oltPart !== undefined && (eq.id.toLowerCase() === oltPart || eq.name.toLowerCase() === oltPart);
      for (const pon of eq.ponPorts ?? []) {
        const fields: Field[] = [
          ['PON port', pon.id, 1.1],
          ['Slot/card/port', pon.slotCardPort],
          ['Address on the OLT', pon.vendorAddress],
        ];
        const m = bestMatch(fields, q) ?? (oltNamed && portPart ? bestMatch(fields, portPart) : undefined);
        if (m && (m.score >= PREFIX || oltNamed)) {
          push({ kind: 'ponPort', collection: 'equipment', id: eq.id, part: pon.id, label: `${eq.name} · ${pon.id}`, matched: m, detail: joinDetail('PON port', pon.status) }, m.score + (oltNamed ? 20 : 0));
        }
      }
    }
    if (want('odfPort')) {
      const [frontPart, portPart] = splitFirst(q) ?? [];
      const odfNamed = frontPart !== undefined && (eq.id.toLowerCase() === frontPart || eq.name.toLowerCase() === frontPart);
      for (const panel of eq.odfPanels ?? []) {
        for (const port of panel.ports) {
          const fields: Field[] = [
            ['ODF port', port.id, 1.1],
            ['Adapter label', port.label, 1.1],
            ['Panel and adapter', `${panel.label}/${port.number}`, 1.1],
            ['Panel and adapter', `${panel.label} ${port.number}`, 1.1],
            ['Panel and adapter', `${panel.label}-${port.number}`, 1.1],
          ];
          const m = bestMatch(fields, q) ?? (odfNamed && portPart ? bestMatch(fields, portPart) : undefined);
          // A bare number matches every adapter; only exact panel or label words count alone.
          if (m && (m.score >= EXACT || odfNamed)) {
            push({ kind: 'odfPort', collection: 'equipment', id: eq.id, part: port.id, label: `${eq.name} · ${panel.label} adapter ${port.number}`, matched: m, detail: joinDetail('ODF port', port.status) }, m.score + (odfNamed ? 20 : 0));
          }
        }
      }
    }
  }

  const coreQuery = CORE_QUERY.exec(trimmed);
  for (const cable of data.cables ?? []) {
    if (want('cable')) {
      const m = bestMatch(
        [
          ['ID', cable.id, 1.2],
          ['Name', cable.name, 1.1],
          ['Model', cable.model],
          ['Make', cable.manufacturer],
          ['Owner', cable.owner, 0.5],
        ],
        q,
      );
      if (m) push({ kind: 'cable', collection: 'cables', id: cable.id, label: cable.name || cable.id, matched: m, detail: joinDetail(cable.type, cable.fiberCount > 0 ? `${cable.fiberCount} fibres` : 'fibres not recorded', cable.status) }, m.score);
    }
    if (want('core') && coreQuery) {
      const named = coreQuery[1].trim().toLowerCase();
      const number = Number(coreQuery[2]);
      if ((cable.id.toLowerCase() === named || cable.name.toLowerCase() === named) && number >= 1 && number <= cable.fiberCount) {
        const core = cable.cores.find((c) => c.coreNumber === number);
        push(
          {
            kind: 'core',
            collection: 'cables',
            id: cable.id,
            part: String(number),
            label: `${cable.name} · fibre ${number}`,
            matched: { field: 'Cable and fibre', value: `${cable.id} fibre ${number}` },
            // A fibre with no record of its own says so; its state is never filled in.
            detail: core ? joinDetail('Fibre', core.status) : 'Fibre · no record for this fibre yet',
          },
          EXACT * 1.3,
        );
      }
    }
  }

  for (const c of data.customers ?? []) {
    if (!want('customer')) break;
    const m = bestMatch(
      [
        ['ID', c.id, 1.2],
        ['ONT serial', c.ontSerialNumber, 1.2],
        ['Name', c.name, 1.1],
        ['IP address', c.ipAddress],
        ['Address', c.address, 0.6],
        ['Building', c.building, 0.6],
        ['Flat', c.flatNumber, 0.5],
        ['Area', c.area, 0.5],
      ],
      q,
    );
    if (m) push({ kind: 'customer', collection: 'customers', id: c.id, label: text(c.name) ?? c.id, matched: m, detail: joinDetail(c.area, c.status) }, m.score);
  }

  const simple = <R extends { id: string }>(
    kind: SearchKind,
    collection: CollectionName,
    list: readonly R[] | undefined,
    fields: (r: R) => Field[],
    label: (r: R) => string | undefined,
    detail: (r: R) => string | undefined,
  ) => {
    if (!want(kind)) return;
    for (const r of list ?? []) {
      const m = bestMatch([['ID', r.id, 1.2], ...fields(r)], q);
      if (m) push({ kind, collection, id: r.id, label: label(r) || r.id, matched: m, detail: detail(r) }, m.score);
    }
  };

  simple('ont', 'onts', data.onts, (o) => [['Serial number', o.serialNumber, 1.2], ['Address on the OLT', o.onuAddress], ['Model', o.model], ['Make', o.vendor]], (o) => o.serialNumber, (o) => joinDetail('ONT', o.model, o.status));
  simple('fault', 'faults', data.faults, (f) => [['Title', f.title, 1.1]], (f) => f.title, (f) => joinDetail(f.severity, f.status));
  simple('splitter', 'splitters', data.splitters, (s) => [['Name', s.name, 1.1], ['Model', s.model], ['Make', s.manufacturer]], (s) => s.name, (s) => joinDetail(`Splitter ${s.ratio}`, s.status));
  simple('closure', 'closures', data.closures, (c) => [['Name', c.name, 1.1], ['Area', c.area, 0.5]], (c) => c.name, (c) => joinDetail(c.closureType, c.area));
  simple('duct', 'ducts', data.ducts, (d) => [['Name', d.name, 1.1], ['Owner', d.ownerName, 0.6], ['Material', d.material, 0.5]], (d) => d.name, (d) => joinDetail('Duct', d.status));
  simple('span', 'spans', data.spans, (s) => [['Name', s.name, 1.1]], (s) => s.name, (s) => joinDetail('Span', s.status));
  simple('zone', 'zones', data.zones, (z) => [['Name', z.name, 1.1], ['Area code', z.areaCode, 1.1]], (z) => z.name, (z) => joinDetail('Zone', z.areaCode, z.status));
  simple('building', 'buildings', data.buildings, (b) => [['Name', b.name, 1.1], ['Address', b.address, 0.6]], (b) => b.name, (b) => joinDetail('Building', b.kind));
  simple('slackLoop', 'slackLoops', data.slackLoops, (s) => [['Name', s.name, 1.1]], (s) => s.name, (s) => joinDetail('Slack loop', `${s.lengthMeters} m`));

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0) ||
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }) ||
      a.id.localeCompare(b.id) ||
      (a.part ?? '').localeCompare(b.part ?? '', undefined, { numeric: true }),
  );
  return { query: trimmed, total: hits.length, offset, limit, hits: hits.slice(offset, offset + limit) };
}

/** The record a hit stands for, as a `collection:id` key (a fibre or port stands for its cable or box). */
export const searchHitKey = (hit: Pick<SearchHit, 'collection' | 'id'>): string => `${hit.collection}:${hit.id}`;
