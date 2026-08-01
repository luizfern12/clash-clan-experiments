#!/usr/bin/env python3
"""POC: hello world against the Clash Royale API via the RoyaleAPI proxy."""

import json
import os
import re
import sys
import urllib.error
import urllib.request

PROXY_BASE = "https://proxy.royaleapi.dev/v1"
CARDS_ENDPOINT = f"{PROXY_BASE}/cards"


def get_token() -> str:
    token = os.environ.get("ROYALE_API_TOKEN")
    if token:
        return token.strip()
    with open(os.path.join(os.path.dirname(__file__), "AGENTS.md")) as f:
        match = re.search(r"^Token: (\S+)", f.read(), re.MULTILINE)
    if not match:
        sys.exit("No token found: set ROYALE_API_TOKEN or add a Token line to AGENTS.md")
    return match.group(1)


def main() -> int:
    req = urllib.request.Request(
        CARDS_ENDPOINT,
        headers={
            "Authorization": f"Bearer {get_token()}",
            "User-Agent": "clash-royale-poc/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as err:
        sys.exit(f"Hello Clash Royale: FAILED ({err.code}) {err.read().decode(errors='replace')}")

    cards = data.get("items", [])
    print("Hello Clash Royale! Proxy works.")
    print(f"  {len(cards)} cards fetched via {PROXY_BASE}")
    for card in cards[:3]:
        print(f"  - {card.get('name')} ({card.get('id')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
