import type { Verdict } from './db'

/**
 * WHEN IS A VIDEO CLEARED TO POST.
 *
 * ⚠️ EVERY ASSIGNED REVIEWER MUST HAVE APPROVED. One `changes_needed` means not cleared, however
 * many approvals sit beside it. This is not a vote and it is not an average: the objection is the
 * signal, and the whole reason for more than one reviewer is that one of them notices what the
 * others did not. A later approval does not overwrite an earlier objection — nothing here can,
 * because each verdict is its own row and this function only ever reads them.
 *
 * ⚠️ AND AN UNASSIGNED VIDEO IS NOT CLEARED. Zero assignments means nobody has been asked, which
 * must not read the same as everybody said yes — `every()` on an empty array is `true`, which is
 * exactly how "cleared to post" would end up on a video no human has opened.
 */
export type Assignment = { video_id: string; reviewer_id: string; verdict: Verdict }

export type Clearance = {
  assigned: number
  decided: number
  approved: number
  changesNeeded: number
  /** Every assigned reviewer approved. The only state in which posting is not overriding someone. */
  cleared: boolean
  /** Someone approved and someone else did not. Shown as disagreement, never resolved into a label. */
  disagreement: boolean
}

export function clearance(assignments: Assignment[]): Clearance {
  const approved = assignments.filter((a) => a.verdict === 'approved').length
  const changesNeeded = assignments.filter((a) => a.verdict === 'changes_needed').length
  return {
    assigned: assignments.length,
    decided: approved + changesNeeded,
    approved,
    changesNeeded,
    cleared: assignments.length > 0 && approved === assignments.length,
    disagreement: approved > 0 && changesNeeded > 0,
  }
}

/** "1 of 2 reviewers finished" — said plainly, because a part-done review is the normal state. */
export function progressLabel(c: Clearance): string {
  if (c.assigned === 0) return 'nobody assigned'
  if (c.decided === c.assigned) return `all ${c.assigned} finished`
  return `${c.decided} of ${c.assigned} reviewer${c.assigned === 1 ? '' : 's'} finished`
}
