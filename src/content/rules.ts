export interface RulesSection {
  heading: string
  lead?: string
  bullets: readonly string[]
}

export const RULES_TITLE = 'Rank is the bid'

export const RULES_LEAD =
  'Youbid is a public leaderboard. You pay for a URL or @handle. Opening checkout does nothing to the board. Rank moves only after a verified payment settles.'

export const RULES_SECTIONS: readonly RulesSection[] = [
  {
    heading: 'Bidding',
    bullets: [
      'Whole US dollars, $2 minimum, $1 steps.',
      'Every live amount falls 3% a day. Rank is current balance, then who settled first.',
      'A listing drops off when it falls below $2. Stop paying and you slide; keep paying and you stay.',
      'A bid below first place still lands at whatever rank that amount can buy. A whale who keeps paying still holds #1.',
      'To raise an existing listing, enter the same URL or @handle and pay the difference to the current amount.',
      'Only the visitor who first paid a listing can raise it while it is still on the board.',
    ],
  },
  {
    heading: 'Page-one takeover',
    lead:
      'Takeover is a three-hour lock on the first page. It sits in front of the ranked list instead of replacing it. Only one can run at a time.',
    bullets: [
      'The price is a falling auction. Right after a takeover ends — or if none has run yet — it costs four times current first place.',
      'Over the next 24 hours that price slides down to just above first place (1.2×).',
      'Then it sits there until someone buys. A new first-place bid raises the whole curve.',
      'If a takeover payment arrives while another is still live, it does not steal the slot.',
    ],
  },
  {
    heading: 'Identity and clicks',
    bullets: [
      'Use a public URL or an X handle. Invite links are rejected. Query strings are stripped.',
      'Two apps on the same host stay separate. Paths do not share a bid.',
      'Clicks leave through a sponsored outbound and are counted on the board.',
    ],
  },
  {
    heading: 'Refunds',
    bullets: [
      'A refund lowers that listing’s current balance in proportion to the refunded principal. We do not invent a new number.',
      'A listing refunded to zero, or decayed below $2, leaves the board. Someone else can then bid that identity.',
      'A full refund on a takeover ends the lease early.',
    ],
  },
]

export function rulesMarkdown(origin: string): string {
  const sections = RULES_SECTIONS.map((section) => {
    const body = section.lead ? `${section.lead}\n\n` : ''
    const bullets = section.bullets.map((bullet) => `- ${bullet}`).join('\n')
    return `## ${section.heading}\n\n${body}${bullets}`
  })
  return [
    `# Youbid rules: ${RULES_TITLE}`,
    `> ${RULES_LEAD}`,
    ...sections,
    `## Canonical pages\n\n- [Rules](${origin}/rules)\n- [Board](${origin}/)\n- [Live stats](${origin}/stats)`,
    '',
  ].join('\n\n')
}
