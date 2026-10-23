"""Quarterly composites around the damage detected in winter 2021/22, for the AI damage analysis (step 14).

67 of the 71 burned cells whose check-ins detected damage were caught in Q1 2022 (backtest, step 08). Step 14 shows the
model each cell just before (Q4 2021) and after (Q1 and Q2 2022) that quarter. Same method as step 01 (median of
clear Sentinel-2 L2A observations at 20 m), only over quarters instead of summers.

Output: cache/composites/2021Q4.tif, 2022Q1.tif, 2022Q2.tif
Usage: uv run python pipeline/14a_quarterly_composites.py [quarter ...]
"""

import importlib.util
import subprocess
import sys
from pathlib import Path

import pystac_client

QUARTERS = {"2021Q4": ("2021-10-01", "2021-12-31"), "2022Q1": ("2022-01-01", "2022-03-31"), "2022Q2": ("2022-04-01", "2022-06-30")}


def step01():
    spec = importlib.util.spec_from_file_location("fetch01", Path(__file__).with_name("01_fetch_composites.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    import rioxarray  # noqa: F401  (registers .rio accessor)

    quarters = sys.argv[1:] or list(QUARTERS)
    if len(quarters) > 1:  # one process per quarter: Planetary Computer tokens expire after about an hour
        for q in quarters:
            subprocess.run([sys.executable, __file__, q], check=True)
        return
    mod = step01()
    mod.PERIODS[quarters[0]] = QUARTERS[quarters[0]]
    mod.build(pystac_client.Client.open(mod.STAC_URL), quarters[0])


if __name__ == "__main__":
    main()
