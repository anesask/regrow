# ReGrow

Satellite-verified, pay-for-results restoration of wildfire scars, with refunds at every check that is not met.

- **Track:** Carbon Markets & Emissions Transparency (secondary: Climate Data & Environmental Monitoring)
- **Event:** IEEE ClimateChain Global Hackathon 2026
- **Team:** Anes Mulalić (solo)
- **Live app:** [regrow.living](https://regrow.living)
- **Code:** [github.com/anesask/regrow](https://github.com/anesask/regrow)
- **Contracts:** [Base Sepolia](https://sepolia.basescan.org/address/0x60ECDc95624841ba339E99662735B80915e2eba1)
- **Version:** 1.0, October 2026

## Abstract

After a wildfire, funding for restoration arrives quickly, but evidence that the land actually recovers rarely does.
Some common post-fire practices (salvage logging, new roads, terracing) can even harm forests that would regenerate on
their own. ReGrow is a results-based finance layer for burned land: funders lock money per 64-hectare plot in a smart
contract; Sentinel-2 satellite data measures each plot's recovery against unburned control forest every quarter and
every summer; an oracle committee commits each evidence set on-chain as a Merkle root; and the contract pays local
stewards only the share of each tranche the evidence earns, refunding the rest immediately. Plots that recover can
issue non-transferable, retire-once **Verified Recovery Units**.

We built and tested the full system on the 2021 Manavgat fire in Antalya, Türkiye (56,663 ha, the largest in Turkish
records at the time). A backtest of the contract rules on every burned forest cell of the fire (534 cells, 34,176 ha,
2021-2026) shows that **87.5% of funds would have reached stewards for verified recovery and 12.5% would have been
refunded**, that **quarterly check-ins flag 56% of eventual failures within the first year**, and that slopes damaged
after the fire were **8.5 times more likely** to still be failing five years later. Every plot is measured against its
own matched control forest; a placebo test on 1,760 healthy forest cells flags only 0.34% as damaged.

All figures in this paper are either measured by the open ReGrow pipeline and contracts (with the script that produced
them) or cited from a named source. Money in the prototype is test money on a test network.

## 1. Problem

| Issue | Evidence |
|---|---|
| Scale | In 2021 Türkiye recorded ≈203,000 ha burned, mostly Turkish red pine (*Pinus brutia*) (Tavşanoğlu & Pausas, *Science* 2022). The Manavgat fire alone burned 56,663 ha (GTÜ mapping via Bianet, 12 Aug 2021). |
| Unverified outcomes | Post-fire donations typically fund planting; survival and recovery are rarely measured and reported to funders. |
| Harmful practice | Salvage logging, road building and terracing can damage natural regeneration and soils (Tavşanoğlu & Pausas 2022). |
| Trust in nature finance | Forest credits face criticism for over-crediting, weak counterfactuals and double counting. |
| Long feedback loops | Typical restoration funding gives funders one verdict after several years and no way to recover money from failure. |

## 2. Design goals

1. **Pay for verified outcomes**, including natural regeneration, not for activity.
2. **Separate weather from recovery** with unburned control forest.
3. **Shorten the loop**: evidence every quarter, payouts and refunds at each settlement.
4. **No single point of trust**: no single key can decide a payout, change a score, or redirect funds.
5. **Anyone can verify** every result from public data, in a browser.
6. **No double counting** of impact claims.
7. **Usable without crypto knowledge**.

## 3. System overview

![System overview](architecture.png)

Components: Solidity contracts (Foundry, OpenZeppelin 5.7), a Python pipeline (steps 01-10), a FastAPI service (data,
oracle committee signing and relaying, certificate metadata, AI reports, photo check, demo-wallet gas), and a React
application in English, German and Turkish.

Funders lock FLZ per plot in `RestorationEscrow`. The pipeline turns Sentinel-2 imagery into one evidence set; the oracle
committee signs its Merkle root (2 of 3), and a relayer without any role submits each milestone with its Merkle proof.
After a public challenge window the escrow pays stewards the earned share and refunds the rest. Completed plots issue
Verified Recovery Units in `RecoveryRegistry`; every funder holds a soulbound `ImpactCertificate`.

### 3.1 AI, advisory and checked
AI explains results; it never decides a payout. Each plot page carries a progress report in English, German and Turkish,
written by a language model (gpt-5) from a facts sheet built only from the published pipeline output. Every number in the
text must appear in that facts sheet; a report with any other number is rejected and rewritten, and all eight plot
reports passed. Visitors can ask questions about a plot (gpt-5-mini) under the same rule: an answer whose figures do not
match the evidence is not shown. Live AI spend is capped per day. At a steward check-in an AI look at the photo is
advisory only and cannot reject it. A vision model was also tested for detecting damage from before/after imagery; it
could not separate failing from recovering slopes (section 10), so payouts rely on the satellite signal alone.

## 4. Satellite method

### 4.1 Data and composites
Sentinel-2 Level-2A surface reflectance (Microsoft Planetary Computer), 20 m, UTM 36N. Per-pixel cloud, shadow, cirrus
and snow masking with the scene classification layer; per-pixel median composites. Annual composites use the same
season every year (pre-fire 15 Jun-27 Jul 2021; post-fire 15 Aug-30 Sep 2021; recovery Jun-Sep 2022-2026). Quarterly
composites (2020 Q3-2026 Q3) are computed at 60 m from cloud-optimised overviews; they match the 20 m summer composite
within about ±0.01 NBR. The +1000 reflectance offset of processing baseline 04.00 (from 25 Jan 2022) is removed.

### 4.2 Indices, severity and perimeter
NDVI = (B08 − B04)/(B08 + B04); NBR = (B08 − B12)/(B08 + B12); dNBR = NBR_pre − NBR_post. Severity classes follow Key &
Benson. Water and bare ground are masked by pre-fire NDVI; dNBR > 0.27 is closed (200 m), hole-filled, and the largest
region is the fire.

| Fire area | Value |
|---|---|
| ReGrow perimeter (20 m) | **59,234 ha** |
| Reported (GTÜ) | 56,663 ha (+4.5%) |
| ReGrow vs NASA MODIS MCD64A1 on a 500 m grid | 59,075 ha vs 58,525 ha; **IoU 0.89**; 94% of ours confirmed by MODIS, 95% of MODIS by ours |
| Severity inside perimeter | low 12,988 ha · moderate-low 12,492 ha · moderate-high 10,229 ha · high 12,464 ha |

### 4.3 Recovery score
For a 64 ha cell (800 × 800 m) and period *t*:

```
RR_t  = (NBR_t − NBR_post) / (NBR_pre − NBR_post)
adj_t = RR_t − (NBR_twins,t − NBR_twins,pre) / (NBR_pre − NBR_post)
```

`adj` removes the change seen in the cell's own **matched controls**: the K = 10 unburned forest cells (2-20 km
outside the scar, pre-fire NDVI ≥ 0.45, dNBR < 0.05) nearest to it in Mahalanobis distance over pre-fire NBR, pre-fire
NDVI, elevation, slope and northness (Copernicus DEM GLO-30). Matching uses only pre-fire information. Quarterly
check-ins and the quarterly chart use three regional controls and a same-season pre-fire baseline (e.g. winter vs
winter 2020/21); over three months slow drift does not matter.

**Why matching (method v3).** Versions 1-2 used the same three regional controls for every plot, selected partly for
being stable over time. That is selection on the outcome: by 2026 all unburned forest had greened by +0.053 NBR, the
three controls by +0.032, so regional greening was under-corrected. Burned cells also differ from unburned forest in
terrain (standardised mean difference of elevation −1.19, slope −0.71). After matching, all |SMD| ≤ 0.11. Switching
lowered median 2026 recovery from 71% to 64%; 18% of cells changed outcome, all towards less payout (67 restored →
partial, 30 partial → failed). Results are stable for K = 5, 10, 20 (median 63.6-64.3%).

### 4.4 Uncertainty
Each recovery verdict reports the per-pixel spread, a 95% interval (effective sample size n/9 for spatially correlated
pixels) and the margin to the target. Example: Salur slope, 2026: **75.0% ± 1.9%** against a 60% target (confident).
One verdict in the demo set (Güzelyalı, 2023) is within measurement noise of its target (±4.5%); graded payouts make
this fair: it is paid 87% of that tranche (26.2 / 30), and an error of 4.5 points would move that by 15 points
(4.5 / 30), not 100.

**Placebo test.** Each of the 1,760 unburned forest donor cells is treated as if it were a funded plot, with twins drawn
from donors at least 3 km away, and the disturbance rule is applied to 2021-2026. 6 cells are flagged (0.34%, an upper
bound on false alarms, since some may be real clearing). Their net NBR change has a standard deviation of 0.036, about
±7 recovery points for the median burned cell: the noise floor of the method (`pipeline/11_matched_controls.py`).

**Independent check against Hansen/UMD Global Forest Change** (GFC v1.13, 30 m, loss to 2025;
`pipeline/12_hansen.py`). GFC records only the first loss year of a pixel, so inside the scar the fire is "2021" and
later logging of those pixels is invisible; we test where it can see. (a) 94% of GFC's 2021 forest loss in the study
area lies inside our perimeter, and the share of forest GFC marks as lost rises with our severity class: 1% unburned,
3.5% low, 19% moderate-low, 49% moderate-high, 84% high. (b) On unburned forest, our year-over-year drop signal ranks
the 58 cells that GFC shows as cleared (>= 10% of the cell, 2022-2025) with ROC-AUC 0.95. The flag threshold of 0.15
is cautious: 50% precision, 5% recall, 0.18% of healthy cells paused; 0.10 would give 74% precision and 24% recall at
0.29%. (c) On burned cells, trees that survived the fire were lost in 2022-2025 on 20.9 ha per cell where quarterly
check-ins flagged damage vs 5.7 ha where they passed (AUC 0.88). Failed cells are mostly moderate-low severity
(76 of 85): there, failed cells lost 19.1 ha of surviving trees vs 3.8 ha for restored ones, so failures reflect real
loss after the fire (delayed mortality or logging), not a measurement artifact of small burn losses.

**Cross-sensor check** (`pipeline/13_landsat.py`). The same seasonal composites and recovery score, against the same
matched controls, rebuilt from Landsat 8/9 Collection 2 Level-2 (30 m, QA_PIXEL cloud mask) for all 534 burned cells.
Burn loss: r = 0.995. Recovery 2023: r = 0.993, median absolute difference 3.2 points, same pass/fail at the 30%
target for 96.3% of cells. Recovery 2026: r = 0.993, 1.8 points, 96.8% at the 60% target. The score measures the land,
not the instrument.

### 4.5 Quarterly check-ins
A check-in passes if the plot's NBR did not fall more than 0.10 below the previous quarter, net of the control forest's
change (which removes seasonal greening and browning). Across the demo plots, healthy slopes scored −0.13 to +0.03 and
slopes cleared or terraced in winter 2021/22 scored +0.12 to +0.20. Quarters too cloudy to judge pass and are labelled
inconclusive in the evidence.

## 5. Contract mechanism

### 5.1 Schedule and graded payouts
| Milestone | Evidence | Rule | Share |
|---|---|---|---|
| Start | Baseline severity 2021 | always | 15% |
| 4 check-ins | Quarterly composites, Q4 2021-Q3 2022 | net drop ≤ 0.10 | 4 × 5% |
| Early recovery | Summer 2023 | graded adj ÷ 0.30; plot fails below 0.15 | 30% |
| Sustained recovery | Summer 2026 | graded adj ÷ 0.60; plot fails below 0.30 | 35% |

At each settlement the steward receives `min(score/target, 1)` of the tranche; the shortfall is released for refunds
immediately. Tranches are cumulative (`totalFunded × settledBps / 10000`), so late deposits are handled and the last
milestone settles the exact remainder. Refunds use a per-unit accumulator: funders claim whenever refunds exist, and a
late funder never shares earlier refunds. Funders choose at deposit between pro-rata refunds and the replanting pool.

### 5.2 Failure, pauses and deadlines
- A recovery score below half its target fails the plot; everything unreleased is refunded.
- A committed disturbance finding pauses payouts. The finding states what changed, not who did it. The guardian
  (forest authority with an independent reviewer) may resume, e.g. for approved works, only before the pause expires (30 days in
  production); after that **anyone** can expire it, which fails the plot and opens refunds.
- If a milestone is not reported by its due date, anyone can fail the plot and open refunds.

### 5.3 Oracle committee and evidence commitments
The pipeline writes one canonical JSON evidence file per finding (inputs, scene IDs, thresholds, uncertainty, pipeline
commit) and builds a Merkle tree over all findings, leaf =
`keccak256(keccak256(abi.encode(kind, plotId, idx, scoreBps, evidenceHash)))`. The evidence bundle (30 KB, gzip,
deterministic) is addressed by its IPFS CIDv1. Oracle signers sign `DatasetCommit(root, cid, nonce)` (EIP-712, bound
to chain and contract); `oracleThreshold` distinct, ordered signatures are required. Afterwards **anyone** can submit a
report with a Merkle proof; the contract rejects any score or hash not in a committed set. A relayer pays gas but holds
no role.

### 5.4 Disputes
During a configurable challenge window anyone can challenge a report by posting a bond. The guardian upholds the
challenge (report removed, bond returned) or rejects it (bond to the replanting pool, report executable).

### 5.5 Governance
The admin role is an OpenZeppelin `TimelockController` (2-day delay in production): role and parameter changes are
public and delayed. Parameters are bounded in code (challenge window ≤ 14 days; pause 1 min-90 days; fee ≤ 5%;
threshold ≤ number of oracles). The deployer renounces admin. The replanting pool is a contract with no withdraw
function: it can only reinvest into plots, through the timelock.

**Role of the public forest authority.** Burned forest in Türkiye is state land and must by law be restored as forest
(Constitution Art. 169, Forest Law 6831); the General Directorate of Forestry (OGM) is responsible, usually working with
forest-village co-operatives under contract. ReGrow is designed to sit inside that system, not beside it: the forest
authority holds `PLOT_MANAGER_ROLE` (only it opens plots, naming the steward and the method: natural regeneration or
planting) and shares `GUARDIAN_ROLE` with an independent reviewer (pause and dispute rulings). Stewards are the
co-operatives it already works with; funds would be collected through OGM or a licensed foundation. ReGrow gives the
authority outside money tied to measured results and a public record for national reporting. OGM is the intended
partner; no partnership exists yet, and test accounts hold these roles in the prototype.

### 5.6 Certificates and Verified Recovery Units
Each funder receives a soulbound ERC-721 certificate whose metadata reflects live escrow state. When a plot completes,
`RecoveryRegistry.issue` creates **Verified Recovery Units** exactly once from on-chain data: `areaHa × min(final
score, 100%)`, with a 20% buffer withheld against reversal. Units are allocated pro-rata to funders, cannot be
transferred, and can be retired once with a public beneficiary and purpose. Each unit therefore has exactly one
claimant: double counting is excluded by construction.

## 6. Results: backtest on the Manavgat fire

The contract rules were applied to every burned forest cell (pre-fire NDVI ≥ 0.45, dNBR ≥ 0.27, inside the perimeter)
using real 2021-2026 data, as if each had been funded with 1,000 FLZ (`pipeline/08_backtest.py`).

| Metric | Result |
|---|---|
| Cells / area | 534 cells · 34,176 ha |
| Funds paid to stewards on evidence | **87.5%** |
| Funds refunded | **12.5%** |
| Outcomes | 313 fully restored · 136 partially · 85 failed |
| Eventual failures flagged by a year-one check-in | **56%** (48 of 85), 1-4 years before the 2023/2026 verdicts |
| Cells not failed that missed one check-in | 23 (5.1%; cost: one 5% tranche) |
| Failure rate after post-fire vegetation loss vs untouched | **67.6% vs 8.0% (8.5×)** |

**Early warning.** A gradient-boosted classifier using only data available by the end of 2022 (severity, pre-fire NDVI,
2022 summer recovery, quarterly recovery and drops) predicts which slopes will not be restored by 2026 with out-of-fold
**ROC-AUC 0.97**, precision 77% and recall 79% at a 0.5 threshold. A one-variable baseline (2022 summer recovery) scores
as well (AUC 0.98). We report this honestly: the early signal is robust, and the first year of data predicts
the next four.

## 7. Measured benefits

| Area | Benefit | Measure |
|---|---|---|
| **Environment** | Pays to protect natural regeneration, the cheapest and most effective recovery for fire-adapted pine | Burned forest cells reached a median 64% recovery vs matched controls by 2026 |
| | Detects harmful post-fire intervention early | Damaged slopes 8.5× more likely to fail; 56% of failures flagged in year one |
| | Covers the whole burn scar with free data | 34,176 ha analysed at 64 ha resolution, 5 summers + 25 quarters |
| **Funders** | Results every season instead of one verdict after years | First check-in result 3 months after funding; 7 settlements over the period |
| | Money back without waiting for the project to end | Shortfalls refunded at each settlement; backtest: 12.5% returned |
| | Fair under measurement noise | Graded payouts; 95% intervals published per verdict |
| **Stewards (local teams)** | Early, regular income for protection work | 35% of each plot's funds within year one (15% + 4 × 5%) if no damage |
| | Clear, objective rules | Thresholds and evidence published before payment |
| **Transparency & integrity** | Every score bound to a committed evidence set | 57 findings under one Merkle root; proof depth 6 |
| | Independent verification in a browser | File hash → Merkle proof → on-chain commitment → on-chain report |
| | No single point of trust | 2-of-3 oracle signatures, timelocked admin, bounded parameters, open disputes |
| **Carbon & nature markets** | No double counting | VRUs issued once, non-transferable, retire-once with public record |
| | Conservative accounting | 20% buffer; score-weighted area; uncertainty disclosed |
| **Cost** | Cheap to run on a layer-2 chain | Per plot lifecycle ≈ 1.8 M gas (create 0.31 M; 7 × (report 0.11 M + settle 0.09 M); issue 0.12 M); one dataset commit ≈ 0.14 M gas for all plots; fund ≈ 0.31 M gas per first deposit |
| **Accessibility** | Usable without a crypto wallet | Demo wallet with sponsored fees; certificates and supporters pages |

Assumption for an indicative fee figure: at 0.01 gwei effective gas price, 1.8 M gas costs 0.000018 ETH per plot
lifecycle, i.e. a few cents at typical ETH prices. Actual layer-2 fees vary with data-availability costs.

## 8. Security and trust analysis

| Threat | Mitigation | Status |
|---|---|---|
| Oracle key theft | k-of-n committee signatures; relayer has no role; keys rotatable through the timelock | Implemented (2 of 3) |
| Score manipulation after the fact | Reports must prove membership in a signed Merkle root | Implemented |
| Admin abuse (redirect funds, change rules) | Timelock admin, bounded config, deployer renounces, reinvest-only replanting pool | Implemented |
| Frozen funds | Pause expiry and oracle deadline are callable by anyone | Implemented |
| Wrong verdict | Open challenge with bond; guardian ruling; graded payouts limit damage | Implemented |
| Evidence tampering | keccak-256 per file; IPFS CID of the bundle; scene IDs for re-derivation | Implemented |
| Re-entrancy, token handling | ReentrancyGuard, SafeERC20, checks-effects-interactions | Implemented |
| Contract funders blocked | Soulbound certificate minted without receiver callback | Fixed (found by tests) |
| API abuse | Rate limits, admin lockout, strict schemas, security headers | Implemented |
| Steward photo fraud | GPS-in-polygon, capture date, perceptual-hash duplicates, advisory AI look | Implemented |
| AI text that misstates results | Every figure checked against the plot's facts sheet; unverified text is not shown; AI never decides a payout | Implemented |

Testing: 45 contract tests, including adversarial unit tests, a 256-run conservation fuzz test (steward + pool +
claimable refunds = funded) and a stateful invariant suite that found four real bugs, all fixed with regression tests;
31 API tests; 4 browser end-to-end flows (fund and payout, failure and refund, full cycle with unit issuance and
retirement, in-browser evidence verification).

## 9. Scalability

The method needs only free Sentinel-2 data and a burn date, so it applies to any burned area. Per-cell processing at
60 m for 25 quarters of the whole Manavgat scar took about 20 minutes on a laptop, streaming from Planetary Computer. One dataset commitment covers any
number of findings, and per-plot on-chain costs are constant.

## 10. Limitations

- NBR measures vegetation cover, not species composition, tree survival or carbon stock.
- 20 m pixels do not resolve small-scale planting; 64 ha cells average about 1,600 pixels.
- Matched controls cover terrain and pre-fire vegetation, not soil or local rainfall; quarterly check-ins still use
  three regional controls.
- In this prototype two of the three oracle keys run on one server; production requires independent signers.
- The demo compresses time: 2021-2026 history is replayed through the contract.
- Recovery Units are a transparent impact claim, not a certified carbon credit.
- A vision model shown before/after images of flagged and recovering slopes saw the terracing campaign of winter
  2021/22 on both alike and could not tell which slopes lost their regrowth (`pipeline/14_ai_damage.py`).

## 11. Roadmap

Independent oracle organisations and community auditors; damage-type labels (terracing, logging, re-burn) from
higher-resolution imagery, with any model and prompt hashed into the evidence; pinning to IPFS by multiple parties; account
abstraction (sponsored transactions) instead of a fee faucet; pilots with Türkiye's General Directorate of Forestry
(OGM) and coastal municipalities; tourism funding ("restore the forest you holidayed in"); other fire scars.

## References

- Tavşanoğlu, Ç. & Pausas, J. G. (2022), *Science*, on post-fire restoration policy in Türkiye.
- Gebze Technical University burned-area mapping, via Bianet, 12 August 2021.
- Key, C. H. & Benson, N. C. (2006). Landscape Assessment, in FIREMON. USDA Forest Service RMRS-GTR-164-CD.
- Giglio, L. et al. MODIS Collection 6.1 burned area product MCD64A1 (NASA LP DAAC), via Microsoft Planetary Computer.
- Copernicus Sentinel-2 Level-2A, via Microsoft Planetary Computer.

## Appendix: reproduce the results

```bash
cd backend && uv sync --group pipeline
uv run python pipeline/01_fetch_composites.py && uv run python pipeline/02_burn_map.py
uv run python pipeline/03_cells.py && uv run python pipeline/04_select_and_score.py
uv run python pipeline/05_thumbnails.py && uv run python pipeline/06_pulse.py && uv run python pipeline/06_pulse.py --cells
uv run python pipeline/07_milestones.py && uv run python pipeline/08_backtest.py
uv run python pipeline/09_dataset.py && uv run python pipeline/10_validate.py
cd ../contracts && ./install-deps.sh && forge test
```

## Appendix: live deployment

Base Sepolia (chain ID 84532), deployed at block 49210145; challenge window 120 s; oracle committee 2 of 3.

| Contract | Address |
|---|---|
| `Filiz` | [`0x87B6Cb7071b790b4827b39C4097376D5406BF430`](https://sepolia.basescan.org/address/0x87B6Cb7071b790b4827b39C4097376D5406BF430) |
| `ImpactCertificate` | [`0x0b7EAED1528D7873600D8Ea9E4f7131E8c5CfB93`](https://sepolia.basescan.org/address/0x0b7EAED1528D7873600D8Ea9E4f7131E8c5CfB93) |
| `RecoveryRegistry` | [`0xC4106404F625e15517B7a4d07C680B6500E720fe`](https://sepolia.basescan.org/address/0xC4106404F625e15517B7a4d07C680B6500E720fe) |
| `ReplantingPool` | [`0xb8a8761852EBf406F9FCD175C5196E96268B83Bd`](https://sepolia.basescan.org/address/0xb8a8761852EBf406F9FCD175C5196E96268B83Bd) |
| `RestorationEscrow` | [`0x60ECDc95624841ba339E99662735B80915e2eba1`](https://sepolia.basescan.org/address/0x60ECDc95624841ba339E99662735B80915e2eba1) |
| `TimelockController` | [`0x428C88fDf280Ad92836a881D093077543d6C8235`](https://sepolia.basescan.org/address/0x428C88fDf280Ad92836a881D093077543d6C8235) |
