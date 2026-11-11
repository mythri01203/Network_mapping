import { oltChassisSchema } from '../model/schemas';
import type { Equipment, OltChassis } from '../model/types';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice } from './command';
import { checkedFiberChange } from './fiberCommands';

/**
 * Phase 10: saves an OLT's chassis (shelves, slots, cards and which PON ports sit on each card), or
 * removes it with `null`. The fiber rules judge the result: broken data (a port on two cards, a card
 * naming a port the OLT does not have) is refused; a PON port on no card is a warning to accept.
 * The older free-text rack, shelf and slot fields are never changed here.
 */
export function saveOltChassis(data: NetworkData, oltId: string, chassis: OltChassis | null, ctx: CommandContext = {}): CommandResult<Equipment> {
  const olt = data.equipment.find((e) => e.id === oltId);
  if (!olt || olt.type !== 'OLT') return fail('OLT Missing', `OLT ${oltId} was not found.`);
  let updated: Equipment;
  if (chassis === null) {
    const { chassis: _old, ...rest } = olt;
    updated = rest;
  } else {
    const parsed = oltChassisSchema.safeParse(chassis);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail('Not saved', `The chassis could not be saved: ${issue?.path.join(' ') || 'value'} ${issue?.message ?? 'is not valid'}. Nothing was saved.`);
    }
    updated = { ...olt, chassis: parsed.data };
  }
  const shelves = chassis?.shelves.length ?? 0;
  const cards = chassis?.shelves.reduce((n, s) => n + s.slots.filter((x) => x.card).length, 0) ?? 0;
  return checkedFiberChange(
    data,
    { equipment: data.equipment.map((e) => (e.id === oltId ? updated : e)) },
    updated,
    {
      notice: notice('success', 'Chassis saved', chassis ? `${olt.name}: ${shelves} shelf(s), ${cards} card(s) recorded.` : `${olt.name}: the chassis record was removed.`),
      audit: [
        {
          action: chassis ? 'OLT_CHASSIS_SAVED' : 'OLT_CHASSIS_REMOVED',
          details: chassis ? `${oltId}: ${shelves} shelf(s), ${cards} card(s)` : `${oltId}: chassis record removed`,
          assetId: oltId,
          assetType: 'Equipment',
        },
      ],
    },
    ctx,
  );
}
