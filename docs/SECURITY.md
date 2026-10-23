# Security and threat model

ReGrow is a testnet prototype handling test money only. This document lists what we protect against, how, and what is
still open. Report issues privately to the maintainer before opening a public issue.

## Trust assumptions

| Actor | Can | Cannot |
|---|---|---|
| Oracle committee (k of n signers) | Sign one evidence-set commitment (Merkle root + IPFS CID) | Change a committed score; move funds; act alone below the threshold |
| Relayer (any address) | Submit signed commitments and Merkle-proven reports; pay gas | Invent or alter a score; it holds no role |
| Guardian | Resume a paused plot *before* the pause expires; fail a paused plot; rule on challenges | Resume after expiry; change parameters; move funds |
| Plot manager | Create plots; set a plot's area once | Change existing plots or areas |
| Admin (TimelockController) | Change roles and bounded parameters after a public delay | Act instantly; exceed parameter bounds; withdraw the replanting pool |
| Anyone | Fund, relay proven data, execute settled milestones, expire pauses, claim overdue, challenge with a bond | Bypass the challenge window or proofs |

## Threats and mitigations

| # | Threat | Mitigation | Status |
|---|---|---|---|
| 1 | Oracle key compromise | k-of-n EIP-712 signatures, ordered and distinct; keys rotatable via the timelock; relayer separated | Implemented |
| 2 | Replay of an old commitment | Signature binds root, CID hash, sequential nonce, chain id and contract address | Implemented |
| 3 | Score altered after commitment | Reports require a Merkle proof against a committed root | Implemented |
| 4 | Admin redirects funds or changes rules | Admin is a timelock; bounded config; deployer renounces admin; pool has no withdraw | Implemented |
| 5 | Funds frozen by an unresolved pause | `expirePause` callable by anyone after `maxPause` | Implemented |
| 6 | Oracle stops reporting | `claimOverdue` callable by anyone after a milestone's due date | Implemented |
| 7 | Wrong report | Challenge with bond during the window; guardian ruling | Implemented |
| 8 | Evidence file swapped on the server | Per-file keccak-256 in the Merkle leaf; IPFS CID of the bundle on-chain; browser verification | Implemented |
| 9 | Re-entrancy / non-standard tokens | `ReentrancyGuard`, `SafeERC20`, checks-effects-interactions | Implemented |
| 10 | Contract funders (DAOs, Safes) blocked | Certificates minted without the ERC-721 receiver callback (soulbound) | Fixed |
| 11 | Late funders capturing earlier refunds | Per-unit refund accumulator with per-position debt (rounded up), plus a per-settlement catch-up rate for units deposited since the last settlement, so each funder class gets back exactly what it had at risk | Fixed after invariant testing, see below |
| 12 | Rounding drains or traps funds | Last milestone settles the exact remainder; fuzz test: payouts + refunds = funded (≤ 3 units of dust) | Implemented |
| 13 | Double counting of impact | Recovery units issued once, non-transferable, retired once with a public record | Implemented |
| 14 | Admin passcode brute force | 10 failed attempts per IP per 10 minutes, then 429 | Implemented |
| 15 | API abuse / injection | Strict schemas (ids, addresses, ranges), size caps, rate limits, security headers | Implemented |
| 16 | Steward photo fraud | GPS inside plot, capture date after fire, perceptual-hash duplicates, optional AI review | Implemented |
| 17 | Demo-wallet gas drain | 5 requests per IP per hour, 300 per day, only wallets below the fee threshold | Implemented |
| 18 | Replaying a resolved disturbance to re-pause a plot | Each disturbance finding can pause a plot once | Fixed |
| 19 | Stalling payouts by re-submitting a pending report (restarting its window) | A pending report can only be replaced from a newer dataset | Fixed |
| 20 | Replaying a report that a guardian struck down | The rejected report is blocked; only a corrected score can be submitted | Fixed |
| 21 | A false-alarm pause making the next milestone overdue | Resuming a plot moves the remaining deadlines by the length of the pause | Fixed |

## Known limitations

- `challengeBond` may be set to 0 by the timelock, which would make stalling challenges free; rounding dust of a few
  units per plot stays in the escrow.

- In the prototype two of the three oracle keys run on one server. Production requires independent signer organisations
  and hardware-backed keys (HSM / KMS).
- The guardian is a single address in the demo; production would use a multisig.
- No external audit. The contracts are not upgradeable by design; fixes require redeployment.
- Evidence files are served by the API and pinned by CID; production should pin with several independent IPFS nodes.

## Testing

- `contracts/`: 45 Foundry tests. Unit and adversarial tests cover timelock flow, signature replay, removed oracles,
  malleable signatures, proofs for the wrong plot or kind, exact window and pause boundaries, double execution and
  claims, soulbound transfers by every path, and 1-unit and odd deposits. A 256-run conservation fuzz test and a
  stateful invariant suite (`test/Invariants.t.sol`: random funding, late deposits, reports, challenges, pauses,
  expiries, overdue claims, refunds, unit issue and retirement; 128 runs x 128 calls by default, also passed at
  500 x 200) check exact token conservation, that no funder ever gets back more than they deposited, monotonic
  settlement and one-time issuance. Slither reports no high or medium findings.
- Invariant testing found four real bugs, all fixed with regression tests (threats 11, 18, 19 and 20 above; 21 was
  a design gap closed at the same time). The most serious: after a late deposit, an early refund-choosing funder could
  be refunded more than they deposited, paid from later funders.
- `backend/`: 22 tests, including evidence-hash integrity, admin lockout, schema rejection and rate limits.
- `app/e2e/`: browser flows for funding and payout, failure and refund, the full cycle with unit retirement, and
  in-browser evidence verification.
