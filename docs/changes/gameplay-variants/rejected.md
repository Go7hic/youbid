# Rejected variants

← [overview](overview.md)

Reasons, so the same arguments are not reopened later.

## Payouts to the displaced

Playability 5 · Payment pull 5 · **Rejected**

**Mechanic.** A share of the outbidder's payment goes to the person they just pushed down. Early entrants have positive expected value, so they recruit, and the loop goes viral.

**Why it looks good.** Both axes are a 5. That is not a hallucination. It turns a zero-sum rank fight into a positive-sum investment game. Players recruit because new money helps everyone already in. On-chain products have shown this shape is extremely sticky.

**Why it is rejected.** "Early money profits from later money" is, in most jurisdictions, gambling, a pyramid, or an unregistered security. This project **already takes real Stripe payments**. It is not an anonymous on-chain contract. The downside is not a fine. It is a frozen Stripe account, frozen funds, and personal legal exposure.

Risk and reward are asymmetric. Upside is growth. Downside is losing every way to get paid, plus legal consequences.

**When it can be reconsidered.** Only after written legal advice on the specific payout structure, and only with informed consent from the payer. "Other people do this" is not a basis. Most of those products do not take fiat, or they are already living with the legal outcome.

Do not implement before that. Do not "try it small." There is no safe small version. The classification depends on the structure, not the scale.

## Negative bids (pay to push someone else down)

Playability 4 · Payment pull 4 · **Rejected**

**Mechanic.** Pay to lower someone else's rank instead of raising your own.

**Why it is rejected.** That is a paid harassment tool. Youbid listings are real products and real X accounts. Letting an anonymous visitor pay to suppress a named target produces abuse and reputation damage immediately. The only thing this product sells is a board people believe.

`canRaiseListing` already lets only the owner raise their own listing. That constraint is correct. Do not open a hole in it.

## User-created categories

**Mechanic.** The open version of [category boards](variant-2-categories.md). Visitors create their own categories.

**Why it is rejected.** It collapses into one category per person and everyone is first. Once "first place" is free, the reason to pay is gone. The category set stays small and platform-owned. See the design decision in variant 2.
