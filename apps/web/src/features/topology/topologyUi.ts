import type { LogicalNode, NodeCounts } from '@fibergis/shared';

/** Network mapping Phase 14: small helpers for the topology screens. */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 customers · 1 splitter · 1 missing link", leaving out what is zero (customers always shown). */
export function countsText(c: NodeCounts, logical: boolean): string {
  return [
    plural(c.customers, 'customer'),
    c.onts ? plural(c.onts, 'ONT') : undefined,
    c.splitters ? plural(c.splitters, 'splitter') : undefined,
    c.gaps ? plural(c.gaps, 'missing link') : undefined,
    logical && c.mismatches ? `${plural(c.mismatches, 'ONT record')} not matching` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The tree without the logical layer (services and "no service recorded"). */
export function withoutLogical(nodes: readonly LogicalNode[]): LogicalNode[] {
  return nodes.filter((n) => n.layer !== 'logical').map((n) => (n.children.length ? { ...n, children: withoutLogical(n.children) } : n));
}
