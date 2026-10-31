"""Rassemble les pages lues avec WebFetch pendant la session Claude Code en cours.

Claude Code garde l'historique de chaque session dans ~/.claude/projects/<dossier>/<session>.jsonl, et celui des
sous-agents dans les sous-dossiers subagents/. Ce script y retrouve chaque appel WebFetch et sa réponse, garde ceux
qui portent sur une page de tools/sources.json (ou une page suivante du même rayon) et les écrit dans
tools/work/fetches.json.

Les lectures s'ajoutent à celles déjà enregistrées : lancer ce script après chaque série de pages lues,
pour que rien ne se perde si l'historique de la session est compacté en cours de route.

Les pages à lire sont celles des enseignes que le robot GitHub ne peut pas lire (réglage « robot » à false dans
tools/sources.json) : le script les affiche à la fin, une par ligne, avec l'url et le prompt à passer à WebFetch.

Les pages sont groupées en lots (champ lot de tools/sources.json, un univers ou deux ; lib.LOTS) : --lot limite la
liste affichée aux lots demandés, séparés par des virgules (tools/lots/<lot>.md donne le texte prêt pour une tâche
planifiée). --list affiche seulement les pages du lot encore sans lecture, en JSON lignes (url, prompt, lot), sans lire
aucun historique. --all-since lit tous les historiques modifiés depuis cette date, sous-agents compris, quand les
lectures ont été faites par plusieurs agents.

Usage :
  python3 tools/dump.py --reset              # début d'un relevé : repartir d'une liste vide
  python3 tools/dump.py                      # après chaque série de lectures WebFetch
  python3 tools/dump.py --reset --lot frais-1
  python3 tools/dump.py --list --lot frais-1
  python3 tools/dump.py --all-since 2026-11-03T05:00:00Z --lot frais-1
  python3 tools/dump.py --since 2026-11-03T05:00:00Z --transcript chemin/vers/session.jsonl
"""
import argparse, datetime, glob, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402


def page_key(url):
    return (url or "").split("?")[0].split("#")[0].rstrip("/")


def transcripts(since=None):
    """Les historiques de session, du plus ancien au plus récent (sous-agents compris) ; avec since, seulement ceux
    modifiés depuis cette date."""
    files = glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True)
    if since:
        files = [f for f in files if os.path.getmtime(f) >= since.timestamp()]
    return sorted(files, key=os.path.getmtime)


def parse_date(s):
    """Date ISO (UTC si aucun fuseau n'est écrit), ou None."""
    if not s:
        return None
    d = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)


def read(path, since):
    uses, out = {}, []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            m = o.get("message") or {}
            c = m.get("content")
            if not isinstance(c, list):
                continue
            for b in c:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use" and b.get("name") == "WebFetch":
                    uses[b["id"]] = b.get("input") or {}
                elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses:
                    cc = b.get("content")
                    if isinstance(cc, list):
                        cc = "".join(x.get("text", "") for x in cc if isinstance(x, dict))
                    ts = o.get("timestamp") or ""
                    if since and ts < since:
                        continue
                    inp = uses[b["tool_use_id"]]
                    out.append({"url": inp.get("url", ""), "prompt": inp.get("prompt", ""), "text": cc or "", "ts": ts})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="", help="ne garder que les lectures faites après cette date ISO (UTC)")
    ap.add_argument("--all-since", default="", help="lire tous les historiques modifiés depuis cette date ISO, sous-agents compris")
    ap.add_argument("--transcript", action="append", help="historique de session à lire (par défaut le plus récent)")
    ap.add_argument("--reset", action="store_true", help="vider tools/work/fetches.json avant d'ajouter")
    ap.add_argument("--lot", default="", help="lots à afficher (frais-1, epicerie-2...), séparés par des virgules ; tous par défaut")
    ap.add_argument("--list", action="store_true", help="afficher seulement les pages du lot encore sans lecture (url, prompt, lot), en JSON lignes")
    a = ap.parse_args()
    lots = {x.strip() for x in a.lot.split(",") if x.strip()}
    unknown = lots - set(lib.LOTS)
    if unknown:
        sys.exit(f"lot inconnu : {', '.join(sorted(unknown))} (lots : {', '.join(lib.LOTS)})")
    dest = os.path.join(lib.WORK, "fetches.json")
    os.makedirs(lib.WORK, exist_ok=True)
    if a.list:
        rows = json.load(open(dest, encoding="utf-8")) if os.path.exists(dest) and not a.reset else []
        for x in todo(rows, lots):
            print(json.dumps({"url": x["url"], "prompt": x["prompt"], "lot": x.get("lot")}, ensure_ascii=False))
        return
    if a.reset:
        with open(dest, "w", encoding="utf-8") as fh:
            json.dump([], fh)
        print("tools/work/fetches.json vidé")
        show_todo([], lots)
        return
    all_since = parse_date(a.all_since)
    since = a.since or (all_since.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") if all_since else "")
    paths = list(a.transcript or [])
    if all_since:
        paths += [p for p in transcripts(all_since) if p not in paths]
    elif not paths:
        paths = transcripts()[-1:]
    if not paths:
        sys.exit("Aucun historique de session trouvé dans ~/.claude/projects.")
    rows = []
    for p in paths:
        rows += read(p, since)
    sp = lambda t: " ".join(str(t or "").split())
    known = {page_key(x["url"]): sp(x["prompt"]) for x in lib.load_sources()["pages"]}
    # une page de la liste ne compte que lue avec son prompt ; ses pages suivantes sont gardées telles quelles
    rows = [r for r in rows if lib.route(r["url"]) and not r["prompt"].startswith("List every")
            and known.get(page_key(r["url"]), sp(r["prompt"])) == sp(r["prompt"])]
    old = json.load(open(dest, encoding="utf-8")) if os.path.exists(dest) else []
    seen = {(r["url"], r["prompt"], r["ts"]) for r in old}
    added = [r for r in rows if (r["url"], r["prompt"], r["ts"]) not in seen]
    allrows = old + added
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(allrows, fh, ensure_ascii=False, indent=0)
    ok = sum(1 for r in allrows if lib.parse_json(r["text"]) not in (None, [], {}))
    print(f"{len(added)} lectures ajoutées ({len(paths)} historiques lus), {len(allrows)} au total ({ok} avec une réponse JSON).")
    show_todo(allrows, lots)


def mine(lots=()):
    """Les pages à lire par Claude (enseignes dont le réglage robot vaut false), limitées aux lots demandés."""
    src = lib.load_sources()
    robot = src.get("robot") or {}
    return [x for x in src["pages"] if robot.get(x["retailer"]) is False and (not lots or x.get("lot") in lots)]


def todo(rows, lots=()):
    """Celles qui n'ont pas encore de lecture avec des produits."""
    done = {page_key(r["url"]) for r in rows if lib.parse_json(r["text"]) not in (None, [], {})}
    return [x for x in mine(lots) if page_key(x["url"]) not in done]


def show_todo(rows, lots=()):
    """Pages à lire par Claude qui n'ont pas encore de lecture avec des produits, avec l'url et le prompt exacts."""
    pages = mine(lots)
    rest = todo(rows, lots)
    tried = {page_key(r["url"]) for r in rows}
    print(f"pages à lire par Claude ({', '.join(sorted({x['retailer'] for x in pages}))}{', lots ' + ', '.join(sorted(lots)) if lots else ''}) : {len(pages)}, encore sans lecture : {len(rest)}")
    for x in rest:
        print(json.dumps({"url": x["url"], "prompt": x["prompt"], "lot": x.get("lot"), "deja_essayee": page_key(x["url"]) in tried}, ensure_ascii=False))


if __name__ == "__main__":
    main()
