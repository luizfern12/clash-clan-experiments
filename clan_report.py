#!/usr/bin/env python3
"""Relatório de membros de um clan via RoyaleAPI proxy.

Uso: python3 clan_report.py #TAG_DO_CLAN

Somente leitura - não executa nenhuma ação no clan.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

PROXY_BASE = "https://proxy.royaleapi.dev/v1"
USER_AGENT = "clash-royale-poc/0.1"
ROLE_NOME = {
    "leader": "líder",
    "coLeader": "co-líder",
    "elder": "ancião",
    "member": "membro",
}


def get_token() -> str:
    token = os.environ.get("ROYALE_API_TOKEN")
    if token:
        return token.strip()
    with open(os.path.join(os.path.dirname(__file__), "AGENTS.md")) as f:
        match = re.search(r"^Token: (\S+)", f.read(), re.MULTILINE)
    if not match:
        sys.exit("Token não encontrado: defina ROYALE_API_TOKEN ou a linha Token no AGENTS.md")
    return match.group(1)


def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"{PROXY_BASE}{path}",
        headers={
            "Authorization": f"Bearer {get_token()}",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as err:
        sys.exit(f"Erro HTTP {err.code} em {path}: {err.read().decode(errors='replace')}")


def normalize_tag(tag: str) -> str:
    return tag.strip().upper().lstrip("#")


def encode_tag(tag: str) -> str:
    return "%23" + normalize_tag(tag)


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit(f"Uso: {sys.argv[0]} #TAG_DO_CLAN")

    clan_tag = encode_tag(sys.argv[1])
    clan = api_get(f"/clans/{clan_tag}")
    log = api_get(f"/clans/{clan_tag}/riverracelog")

    races = sorted(log.get("items", []), key=lambda r: r.get("createdDate", ""), reverse=True)[:8]

    fame_por_guerra = {normalize_tag(m["tag"]): [] for m in clan["memberList"]}
    for guerra in races:
        nosso = next(
            (s for s in guerra.get("standings", []) if normalize_tag(s.get("clan", {}).get("tag", "")) == normalize_tag(clan["tag"])),
            None,
        )
        if nosso is None:
            continue
        por_participante = {normalize_tag(p["tag"]): p.get("fame", 0) for p in nosso.get("clan", {}).get("participants", [])}
        for tag in fame_por_guerra:
            fame_por_guerra[tag].append(por_participante.get(tag, 0))

    print(f"\nClan: {clan['name']} ({clan['tag']})")
    print(f"Guerras analisadas: {len(races)} (últimas 8 do rio)\n")

    cabecalho = f"{'Jogador':<22} {'Cargo':<9} {'Média 4':>8} {'Média 8':>8} {'Part. 4/8':>9}"
    print(cabecalho)
    print("-" * len(cabecalho))

    promocoes = []
    for m in sorted(clan["memberList"], key=lambda x: x.get("clanRank", 0)):
        tag = normalize_tag(m["tag"])
        fame = fame_por_guerra[tag]
        media4 = sum(fame[:4]) / 4 if len(fame) >= 4 else None
        media8 = sum(fame) / 8 if len(fame) >= 8 else None
        part4 = 4 - fame[:4].count(0) if len(fame) >= 4 else None
        part8 = len(fame) - fame.count(0) if len(fame) >= 8 else None

        def fmt(v):
            return f"{v:.0f}" if v is not None else "-"

        def fmtp(v):
            return f"{v}" if v is not None else "-"

        participacao = f"{fmtp(part4)}/{part8}" if part8 is not None else f"{fmtp(part4)}/-"
        print(
            f"{m['name'][:22]:<22} {ROLE_NOME.get(m['role'], m['role']):<9} "
            f"{fmt(media4):>8} {fmt(media8):>8} {participacao:>9}"
        )

        if m["role"] == "member" and media4 is not None and media4 > 2500:
            promocoes.append(f"  - {m['name']} (membro, média 4 = {media4:.0f}) -> PROMOVER A ANCIÃO")
        elif m["role"] == "elder" and media8 is not None and media8 > 2500:
            promocoes.append(f"  - {m['name']} (ancião, média 8 = {media8:.0f}) -> PROMOVER A CO-LÍDER")

    if promocoes:
        print("\nAVISOS DE PROMOÇÃO:")
        for p in promocoes:
            print(p)
    else:
        print("\nNenhum aviso de promoção.")


if __name__ == "__main__":
    main()
