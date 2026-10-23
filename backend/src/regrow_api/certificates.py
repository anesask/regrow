"""Impact certificate metadata and images, built from live escrow state (the NFT's tokenURI points here)."""

import json
from datetime import UTC, datetime
from html import escape

from web3 import Web3

from .config import settings
from .oracle import CHAIN_DIR, OracleError, _w3

STATUS = ["Active", "Paused", "Failed", "Completed"]
TIERS = [(10_000, "Forest"), (1_000, "Grove"), (100, "Sapling"), (0, "Seedling")]
USD = 10**6
# ReGrow mark (same path as app/src/lib/brand.ts), 1417.5 units square
MARK = "M 55.9 432.7 C 91.5 348.4 142.6 272.6 207.6 207.6 C 272.6 142.6 348.4 91.5 432.7 55.8 C 520.1 18.9 612.8 0.2 708.4 0.2 C 804 0.2 896.8 18.9 984.1 55.8 C 1068.4 91.5 1144.2 142.6 1209.2 207.6 C 1274.3 272.6 1325.3 348.4 1361 432.7 C 1397.9 520.1 1416.6 612.8 1416.6 708.4 C 1416.6 796.8 1400.6 882.7 1369 964.2 C 1364.4 976 1353.1 983.8 1340.4 983.8 C 1318.9 983.8 1304.1 962.2 1311.9 942.1 C 1339.3 871.5 1354.7 794.9 1355.5 714.8 C 1359.1 350.6 1068 58.6 703.7 61.2 C 351.5 63.8 65.3 349 61.3 700.8 C 57.2 1056.8 348.9 1353.7 705 1355.6 C 752.4 1355.8 798.6 1350.9 843.1 1341.5 C 852.2 1339.5 860.1 1333.7 864.2 1325.4 C 864.2 1325.3 864.3 1325.2 864.3 1325.2 C 872.9 1307.2 850.7 1239.1 849.3 1236 C 830.2 1194.2 793.2 1171.9 745.6 1174.9 C 713.5 1176.8 681.6 1182.3 649.5 1184.5 C 592.3 1188.4 541.8 1170.8 500.1 1131.3 C 453.1 1086.9 422.5 1032.8 410.3 968.9 C 407.9 956.6 406.1 944.2 406.9 931 C 407.4 921 418.9 916.1 426.6 922.3 C 457.2 946.9 493.5 952 531.3 953.3 C 565 954.4 598.7 955.3 632.3 957.8 C 732.6 965.3 789.2 1044 812.8 1110.7 C 812.8 1110.8 812.7 1111 812.5 1111.3 C 810.9 1113.1 808.1 1113.1 806.2 1111.6 C 790.1 1097.8 774.1 1083.7 757.5 1070.5 C 722.4 1042.7 640.7 1025.4 579.1 1015.4 C 658.6 1031.6 776.8 1073.1 833.7 1186.1 C 838.3 1195.2 842.9 1204.9 851.4 1212 C 854.2 1214.3 858.5 1213.1 859.5 1209.7 C 859.5 1209.6 859.6 1209.5 859.6 1209.4 C 876.3 1131 862.2 1062 800.1 1006.3 C 756.5 967.1 706.1 937.5 660 901.9 C 607.8 861.6 563.5 815 532.7 755.7 C 439.4 576.6 512.1 319.3 616.9 202.7 C 626.6 191.9 636.4 180.7 650.5 172.2 C 654.8 169.6 660.3 172.8 660.2 177.8 C 658.2 259.8 700.2 319.9 753.3 374.4 C 796.1 418.3 840.9 460.2 883.8 504 C 930.3 551.5 969.5 604.2 990.6 668.3 C 1024.1 769.8 1011.1 869.6 977.7 968.2 C 975.3 975.3 973 982.5 970 989.4 C 966.1 998.4 952.8 995.5 952.9 985.7 L 952.9 985.4 C 953.1 900.3 942.2 817 906.6 738.7 C 877.7 675 832.6 622.7 785.8 571.7 C 730.9 511.7 638.5 357.2 636.1 348.1 C 634.9 358.1 650.3 420.7 660.2 441.7 C 684.8 493.6 715.1 546.3 752 589.5 C 822.4 672 879.4 754.1 897.2 863.5 C 911.5 951.2 905.2 1098.4 901.4 1164.4 C 900.2 1185.3 903.6 1206.3 911.1 1225.9 C 930.6 1276.8 932.1 1319 915.7 1351.8 C 910.4 1362.2 902.8 1370.9 894.7 1377.9 C 878.6 1392 858.8 1401 837.8 1404.8 C 795.4 1412.7 752.2 1416.6 708.4 1416.6 C 612.8 1416.6 520 1397.9 432.7 1360.9 C 348.3 1325.2 272.6 1274.2 207.6 1209.2 C 142.5 1144.1 91.5 1068.4 55.8 984.1 C 18.9 896.7 0.2 804 0.2 708.4 C 0.2 612.8 18.9 520.1 55.9 432.7 Z M 55.9 432.7"


def _contracts():
    addresses = json.loads((CHAIN_DIR / "addresses.json").read_text())
    w3 = _w3()

    def c(name: str):
        abi = json.loads((CHAIN_DIR / f"{name}.abi.json").read_text())
        return w3.eth.contract(address=Web3.to_checksum_address(addresses[name]), abi=abi)

    return c("RestorationEscrow"), c("ImpactCertificate")


def cert_ref(token_id: int) -> str:
    """Public reference for links (/certificate/<ref>): not a sequential number. Same formula as certificateRef() in
    app/src/lib/contracts.ts. Token ids are public on-chain anyway; this only keeps links from being enumerable."""
    addr = json.loads((CHAIN_DIR / "addresses.json").read_text())["ImpactCertificate"].lower()
    return Web3.keccak(text=f"{addr}:{token_id}").hex().removeprefix("0x")[:12]


def resolve(cert_id: str) -> int:
    """Token id from a numeric id (ERC-721 tokenURI) or a 12-character reference."""
    if cert_id.isdigit():
        return int(cert_id)
    _, cert = _contracts()
    for token_id in range(1, cert.functions.totalSupply().call() + 1):
        if cert_ref(token_id) == cert_id:
            return token_id
    raise OracleError("certificate not found")


def tier(amount_usd: float) -> str:
    return next(name for floor, name in TIERS if amount_usd >= floor)


def status_label(plot_status: str, next_milestone: int, total: int) -> str:
    if plot_status == "Completed":
        return "Verified restored"
    if plot_status in ("Paused", "Failed"):
        return plot_status
    return "Funded" if next_milestone == 0 else f"Recovering · {next_milestone}/{total}"


def certificate(token_id: int, plots_by_chain: dict[int, dict]) -> dict:
    escrow, cert = _contracts()
    plot_id, funder, minted_at = cert.functions.certs(token_id).call()
    if funder == "0x0000000000000000000000000000000000000000":
        raise OracleError("certificate not found")
    plot = escrow.functions.getPlot(plot_id).call()
    pos = escrow.functions.positionOf(plot_id, funder).call()
    reports = escrow.functions.getReports(plot_id).call()  # (exists, executed, challenged, scoreBps, fractionBps, …)
    # Plot tuple order follows IRestorationEscrow.Plot
    (_, _, status, next_ms, _, _, milestones, total_funded, _, _, released, refunded, _, name, _) = plot
    amount = pos[0] / USD
    meta = plots_by_chain.get(plot_id, {})
    return {
        "tokenId": token_id,
        "ref": cert_ref(token_id),
        "plotId": plot_id,
        "plotKey": meta.get("id"),
        "plotName": name,
        "funder": funder,
        "amount": amount,
        "share": pos[0] / total_funded if total_funded else 0,
        "tier": tier(amount),
        "status": STATUS[status],
        "statusLabel": status_label(STATUS[status], next_ms, len(milestones)),
        "milestonesDone": next_ms,
        "milestonesTotal": len(milestones),
        "fractions": [r[4] / 10_000 if r[1] else None for r in reports],
        "releasedShare": released / total_funded if total_funded else 0,
        "refundedShare": refunded / total_funded if total_funded else 0,
        "mintedAt": minted_at,
        "severity": meta.get("severity", {}).get("class"),
        "areaHa": meta.get("areaHa"),
    }


def by_funder(funder: str, plots_by_chain: dict[int, dict]) -> list[dict]:
    _, cert = _contracts()
    ids = cert.functions.certificatesOf(Web3.to_checksum_address(funder)).call()
    return [certificate(i, plots_by_chain) for i in ids]


def all_certificates(plots_by_chain: dict[int, dict]) -> list[dict]:
    _, cert = _contracts()
    return [certificate(i, plots_by_chain) for i in range(1, cert.functions.totalSupply().call() + 1)]


def metadata(c: dict) -> dict:
    base = settings.public_url.rstrip("/")
    return {
        "name": f"ReGrow Impact Certificate #{c['tokenId']}",
        "description": (
            f"Funding for verified post-wildfire recovery of {c['plotName']} (Manavgat, Türkiye). Payouts are released "
            "only when Sentinel-2 satellite evidence shows recovery against unburned control forest. Soulbound."
        ),
        "image": f"{base}/api/certificates/{c['tokenId']}/image.svg",
        "external_url": f"{base}/certificate/{c['ref']}",
        "attributes": [
            {"trait_type": "Plot", "value": c["plotName"]},
            {"trait_type": "Tier", "value": c["tier"]},
            {"trait_type": "Status", "value": c["statusLabel"]},
            {"trait_type": "Funded (FLZ)", "display_type": "number", "value": round(c["amount"], 2)},
            {"trait_type": "Milestones", "value": f"{c['milestonesDone']}/{c['milestonesTotal']}"},
            {"trait_type": "Since", "display_type": "date", "value": c["mintedAt"]},
        ],
    }


def image_svg(c: dict) -> str:
    """Certificate artwork: clean, typographic, colour keyed to status."""
    accent = {"Completed": "#36b883", "Paused": "#e7b04a", "Failed": "#ef7a68"}.get(c["status"], "#6cd2a4")
    done, total = c["milestonesDone"], c["milestonesTotal"]

    def bar(i: int, f: float | None) -> str:
        if f is None:
            fill, op = "#ffffff", 0.15  # not settled yet
        elif f == 0:
            fill, op = "#ef7a68", 0.9  # missed: tranche refunded
        else:
            fill, op = "#36b883", 0.35 + 0.65 * f  # paid, opacity by share earned
        return f'<rect x="{60 + i * 52}" y="452" width="44" height="6" rx="3" fill="{fill}" opacity="{op:.2f}"/>'

    bars = "".join(bar(i, f) for i, f in enumerate(c["fractions"]))
    since = datetime.fromtimestamp(c["mintedAt"], UTC).strftime("%d %b %Y")
    name = escape(c["plotName"])
    funder = f"{c['funder'][:6]}…{c['funder'][-4:]}"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 600" width="480" height="600">
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b3326"/><stop offset="1" stop-color="#05221a"/></linearGradient>
  <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#ffffff" stroke-opacity="0.04"/></pattern>
</defs>
<rect width="480" height="600" rx="28" fill="url(#g)"/>
<rect width="480" height="600" rx="28" fill="url(#grid)"/>
<rect x="18" y="18" width="444" height="564" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.10"/>
<g transform="translate(60 64)">
  <path transform="translate(0 1) scale(0.0212)" d="{MARK}" fill="{accent}"/>
  <text x="40" y="24" fill="#ffffff" font-family="Instrument Sans, Helvetica, Arial, sans-serif" font-size="22" font-weight="600" letter-spacing="-0.4">ReGrow</text>
</g>
<text x="420" y="88" text-anchor="end" fill="#ffffff" fill-opacity="0.55" font-family="IBM Plex Mono, Menlo, monospace" font-size="12" letter-spacing="1.5">#{c["tokenId"]:04d}</text>
<text x="60" y="170" fill="{accent}" font-family="IBM Plex Mono, Menlo, monospace" font-size="12" letter-spacing="2.4">IMPACT CERTIFICATE · {escape(c["tier"].upper())}</text>
<text x="60" y="222" fill="#ffffff" font-family="Instrument Sans, Helvetica, Arial, sans-serif" font-size="38" font-weight="600" letter-spacing="-1">{name}</text>
<text x="60" y="252" fill="#ffffff" fill-opacity="0.6" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="15">Manavgat wildfire scar · Antalya, Türkiye</text>
<line x1="60" y1="300" x2="420" y2="300" stroke="#ffffff" stroke-opacity="0.12"/>
<text x="60" y="336" fill="#ffffff" fill-opacity="0.5" font-family="IBM Plex Mono, Menlo, monospace" font-size="11" letter-spacing="1.6">FUNDED</text>
<text x="60" y="370" fill="#ffffff" font-family="Instrument Sans, Helvetica, Arial, sans-serif" font-size="30" font-weight="600" letter-spacing="-0.6">{c["amount"]:,.0f} <tspan font-size="16" fill-opacity="0.6">FLZ</tspan></text>
<text x="250" y="336" fill="#ffffff" fill-opacity="0.5" font-family="IBM Plex Mono, Menlo, monospace" font-size="11" letter-spacing="1.6">STATUS</text>
<text x="250" y="370" fill="{accent}" font-family="Instrument Sans, Helvetica, Arial, sans-serif" font-size="20" font-weight="600">{escape(c["statusLabel"])}</text>
<text x="60" y="436" fill="#ffffff" fill-opacity="0.5" font-family="IBM Plex Mono, Menlo, monospace" font-size="11" letter-spacing="1.6">MILESTONES SETTLED {done}/{total}</text>
{bars}
<line x1="60" y1="500" x2="420" y2="500" stroke="#ffffff" stroke-opacity="0.12"/>
<text x="60" y="534" fill="#ffffff" fill-opacity="0.55" font-family="IBM Plex Mono, Menlo, monospace" font-size="11">{funder} · since {since}</text>
<text x="420" y="534" text-anchor="end" fill="#ffffff" fill-opacity="0.55" font-family="IBM Plex Mono, Menlo, monospace" font-size="11">soulbound · testnet</text>
</svg>"""
