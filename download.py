"""Download Wikipedia hourly pageviews and build data/views.parquet, surviving wifi cut-outs.

Robust by design:
  - every hour is saved separately (data/hours/YYYYMMDD-HH.parquet) as soon as it's done,
    so a crash or cut-out loses at most the hour in progress;
  - re-running skips hours already done, and resumes half-downloaded files where they stopped;
  - each download retries with increasing waits; a corrupt or truncated file is deleted and retried;
  - raw files are deleted after filtering, so disk use stays small.

Each hourly file is filtered to English Wikipedia (desktop `en` + mobile `en.m`, added together),
non-article pages are dropped (INTERFACES.md section 0), and only the top --top pages are kept.

TIP: if the venue wifi is bad, run this in Google Colab (fast datacentre internet), then download
just the small data/views.parquet. See the README section at the bottom of this docstring.

Usage:
    python download.py --start "2026-10-15 00:00" --end "2026-10-24 23:00"     # downloads + combines
    python download.py --start ... --end ... --workers 2                         # gentler on bad wifi
    python download.py --combine-only                                            # just rebuild views.parquet

Colab:
    !pip -q install pandas pyarrow requests
    !python download.py --start "2026-10-15 00:00" --end "2026-10-24 23:00" --workers 4
    from google.colab import files; files.download("data/views.parquet")
"""
from __future__ import annotations

import argparse
import gzip
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import requests

BASE_URL = "https://dumps.wikimedia.org/other/pageviews"
EXCLUDE_PREFIXES = (
    "Special:", "File:", "File_talk:", "User:", "User_talk:", "Talk:", "Wikipedia:", "Wikipedia_talk:",
    "Portal:", "Portal_talk:", "Category:", "Category_talk:", "Template:", "Template_talk:", "Help:",
    "Help_talk:", "Draft:", "Draft_talk:", "Module:", "MediaWiki:", "TimedText:",
)
EXCLUDE_EXACT = {"Main_Page", "-"}
HEADERS = {"User-Agent": "OxHack-student-project (hackathon; caching research)"}


def file_url(base: str, hour: pd.Timestamp) -> str:
    return f"{base}/{hour:%Y}/{hour:%Y-%m}/pageviews-{hour:%Y%m%d-%H}0000.gz"


def download(url: str, dest: Path, tries: int = 8) -> None:
    """Download with resume (HTTP Range) and retries with increasing waits."""
    part = dest.with_suffix(dest.suffix + ".partial")
    for attempt in range(1, tries + 1):
        try:
            have = part.stat().st_size if part.exists() else 0
            headers = dict(HEADERS, **({"Range": f"bytes={have}-"} if have else {}))
            with requests.get(url, headers=headers, stream=True, timeout=(10, 60)) as r:
                if r.status_code == 404:
                    raise FileNotFoundError(url)
                if r.status_code == 416:            # we already have the whole file
                    part.rename(dest)
                    return
                r.raise_for_status()
                if have and r.status_code != 206:   # server ignored Range: start again
                    have = 0
                expected = r.headers.get("Content-Length")
                expected = have + int(expected) if expected is not None else None
                with open(part, "ab" if have else "wb") as fh:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        fh.write(chunk)
            size = part.stat().st_size
            if expected is not None and size < expected:
                raise IOError(f"short read {size}/{expected}")
            part.rename(dest)
            return
        except FileNotFoundError:
            raise
        except Exception as e:  # network drop, timeout, short read...
            wait = min(5 * 2 ** (attempt - 1), 120)
            print(f"  retry {attempt}/{tries} for {dest.name} in {wait}s ({type(e).__name__}: {e})")
            time.sleep(wait)
    raise RuntimeError(f"gave up on {url}")


def filter_file(raw: Path, hour: pd.Timestamp, top: int) -> pd.DataFrame:
    """Parse one hourly file: 'domain title views bytes' per line."""
    df = pd.read_csv(raw, sep=" ", header=None, names=["domain", "page", "views", "bytes"], usecols=[0, 1, 2],
                     dtype=str, quoting=3, on_bad_lines="skip", compression="gzip", engine="c",
                     keep_default_na=False)
    df = df[df["domain"].isin(["en", "en.m"])]
    df = df.assign(views=pd.to_numeric(df["views"], errors="coerce")).dropna(subset=["views"])  # skip malformed lines
    df = df[~df["page"].isin(EXCLUDE_EXACT) & ~df["page"].str.startswith(EXCLUDE_PREFIXES)]
    out = df.groupby("page", sort=False)["views"].sum()
    out = out[out >= 5].nlargest(top)
    return pd.DataFrame({"hour": hour, "page": out.index.astype(str), "views": out.to_numpy().astype("int64")})


def do_hour(hour: pd.Timestamp, base: str, work: Path, top: int) -> str:
    done = work / "hours" / f"{hour:%Y%m%d-%H}.parquet"
    if done.exists():
        return "skip"
    raw = work / "raw" / f"pageviews-{hour:%Y%m%d-%H}0000.gz"
    for attempt in range(3):
        if not raw.exists():
            download(file_url(base, hour), raw)
        try:
            df = filter_file(raw, hour, top)
            break
        except (EOFError, OSError, zlib.error, gzip.BadGzipFile, pd.errors.ParserError) as e:
            print(f"  {raw.name} is corrupt ({type(e).__name__}); deleting and downloading again")
            raw.unlink(missing_ok=True)
    else:
        raise RuntimeError(f"{raw.name} kept arriving corrupt")
    tmp = done.with_suffix(".tmp")
    df.to_parquet(tmp, index=False)
    tmp.rename(done)                                     # atomic: a half-written file never looks done
    raw.unlink(missing_ok=True)
    return f"{len(df):,} pages"


def combine(work: Path, start: pd.Timestamp | None, end: pd.Timestamp | None) -> None:
    files = sorted((work / "hours").glob("*.parquet"))
    if not files:
        raise SystemExit("no finished hours yet")
    df = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    df = df.sort_values(["hour", "page"]).reset_index(drop=True)
    df.to_parquet(work / "views.parquet", index=False)
    have = set(pd.DatetimeIndex(df["hour"].unique()))
    lo = start if start is not None else min(have)
    hi = end if end is not None else max(have)
    missing = [h for h in pd.date_range(lo, hi, freq="h") if h not in have]
    (work / "missing_hours.txt").write_text("".join(f"{h:%Y-%m-%d %H:%M:%S}\n" for h in missing))
    print(f"wrote {work / 'views.parquet'}: {len(df):,} rows, {len(have)} hours "
          f"({min(have)} to {max(have)}), {len(missing)} missing")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", help='first hour, UTC, e.g. "2026-10-15 00:00"')
    ap.add_argument("--end", help='last hour, UTC, e.g. "2026-10-24 23:00"')
    ap.add_argument("--out", default="data")
    ap.add_argument("--top", type=int, default=150_000, help="pages kept per hour")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--base-url", default=BASE_URL)
    ap.add_argument("--combine-only", action="store_true")
    args = ap.parse_args()

    work = Path(args.out)
    (work / "hours").mkdir(parents=True, exist_ok=True)
    (work / "raw").mkdir(parents=True, exist_ok=True)
    start = pd.Timestamp(args.start) if args.start else None
    end = pd.Timestamp(args.end) if args.end else None
    if args.combine_only:
        combine(work, start, end)
        return
    if start is None or end is None:
        raise SystemExit("--start and --end are required (or use --combine-only)")

    hours = list(pd.date_range(start, end, freq="h"))
    # Newest first: the most recent days are the test period, so get those early.
    hours.sort(reverse=True)
    failed = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(do_hour, h, args.base_url, work, args.top): h for h in hours}
        for i, fut in enumerate(as_completed(futures), start=1):
            h = futures[fut]
            try:
                print(f"[{i}/{len(hours)}] {h}: {fut.result()}")
            except Exception as e:
                failed.append(h)
                print(f"[{i}/{len(hours)}] {h}: FAILED ({e})")
    if failed:
        print(f"{len(failed)} hours failed; just run the same command again to retry them")
    combine(work, start, end)


if __name__ == "__main__":
    main()
