"""Rassemble les pages lues avec WebFetch pendant la session Claude Code en cours.

Claude Code garde l'historique de chaque session dans ~/.claude/projects/<dossier>/<session>.jsonl.
Ce script y retrouve chaque appel WebFetch et sa réponse, garde ceux qui portent sur une page de
tools/sources.json (ou une page suivante du même rayon) et les écrit dans tools/work/fetches.json.

Les lectures s'ajoutent à celles déjà enregistrées : lancer ce script après chaque série de pages lues,
pour que rien ne se perde si l'historique de la session est compacté en cours de route.

Usage :
  python3 tools/dump.py --reset              # début d'un relevé : repartir d'une liste vide
  python3 tools/dump.py                      # après chaque série de lectures WebFetch
  python3 tools/dump.py --since 2026-11-03T05:00:00Z --transcript chemin/vers/session.jsonl
"""
import argparse, glob, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402


def page_key(url):
    return (url or "").split("?")[0].split("#")[0].rstrip("/")


def transcripts():
    files = glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True)
    return sorted(files, key=os.path.getmtime)


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
    ap.add_argument("--transcript", action="append", help="historique de session à lire (par défaut le plus récent)")
    ap.add_argument("--reset", action="store_true", help="vider tools/work/fetches.json avant d'ajouter")
    a = ap.parse_args()
    dest = os.path.join(lib.WORK, "fetches.json")
    os.makedirs(lib.WORK, exist_ok=True)
    if a.reset:
        with open(dest, "w", encoding="utf-8") as fh:
            json.dump([], fh)
        print("tools/work/fetches.json vidé")
        return
    paths = a.transcript or transcripts()[-1:]
    if not paths:
        sys.exit("Aucun historique de session trouvé dans ~/.claude/projects.")
    rows = []
    for p in paths:
        rows += read(p, a.since)
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
    pages = {page_key(r["url"]) for r in allrows}
    todo = [x["url"] for x in lib.load_sources()["pages"] if page_key(x["url"]) not in pages]
    print(f"{len(added)} lectures ajoutées, {len(allrows)} au total ({ok} avec une réponse JSON).")
    print(f"pages de la liste encore à lire : {len(todo)}")
    for u in todo[:60]:
        print("   ", u)


if __name__ == "__main__":
    main()
