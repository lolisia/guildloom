/**
 * Clear XP distribution among the active party.
 *
 * The bounty total is split as evenly as possible: every member gets
 * `floor(total / members)` and the remaining units are handed out one each in
 * the given order. Callers pass the leader first (then the remaining members
 * by `joined_at`), so the leader receives the first leftover unit.
 */

/**
 * Split `total` XP across `memberIds`.
 *
 * Returns an empty object when there are no members. Duplicate ids are counted
 * once (first occurrence order is kept) so the shares always add up to `total`.
 */
export function splitClearXp(
  total: number,
  memberIds: readonly number[],
): Record<number, number> {
  const shares: Record<number, number> = {};
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) {
    return shares;
  }

  const base = Math.floor(total / ids.length);
  let remaining = total - base * ids.length;

  for (const id of ids) {
    const extra = remaining > 0 ? 1 : 0;
    remaining -= extra;
    shares[id] = base + extra;
  }

  return shares;
}
