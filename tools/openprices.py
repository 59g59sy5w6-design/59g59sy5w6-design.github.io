"""Open Prices (Open Food Facts) : prix relevés en magasin par des contributeurs, publiés en données ouvertes.

Chaque prix vient d'une photo de ticket de caisse ou d'étiquette, avec sa date et son magasin. Licence ODbL :
citer « Open Prices » et partager les modifications sous la même licence.
Fichier quotidien (Parquet) : https://www.data.gouv.fr/fr/datasets/open-prices

Usage :
  python3 tools/openprices.py --stats                    # couverture par enseigne (tools/work/openprices_stats.json)
  python3 tools/openprices.py --near 48.85,2.51,7        # magasins à moins de 7 km d'un point (tools/work/openprices_near.json)
"""
import argparse, collections, datetime, json, os, re, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

URL = "https://www.data.gouv.fr/api/1/datasets/r/49716ed5-aacf-4692-8b2d-3cc6d15bf1d1"
ENSEIGNES = {
    "leclerc": r"leclerc",
    "auchan": r"auchan",
    "intermarche": r"intermarch",
    "u": r"\b(super u|hyper u|u express|marche u|marché u|systeme u|système u|magasins u)\b",
    "carrefour": r"carrefour",
    "monoprix": r"monoprix",
    "lidl": r"\blidl\b",
    "aldi": r"\baldi\b",
}
IDF = ("75", "77", "78", "91", "92", "93", "94", "95")


def load():
    import pandas as pd  # noqa: F401  (installé par le workflow)
    import pyarrow.parquet as pq
    os.makedirs(lib.WORK, exist_ok=True)
    path = os.path.join(lib.WORK, "openprices.parquet")
    if not os.path.exists(path):
        urllib.request.urlretrieve(URL, path)
    return pq.read_table(path).to_pandas()


def pick(cols, *words):
    for w in words:
        for c in cols:
            if w in c.lower():
                return c
    return None


def stats():
    df = load()
    cols = list(df.columns)
    c_name = pick(cols, "osm_name", "display_name", "location_name", "name")
    c_city = pick(cols, "city")
    c_post = pick(cols, "postcode")
    c_country = pick(cols, "country")
    out = {"columns": cols, "rows": int(len(df)), "name_col": c_name, "city_col": c_city, "postcode_col": c_post, "country_col": c_country}
    if "currency" in df.columns:
        df = df[df["currency"] == "EUR"]
    if c_country:
        out["countries"] = df[c_country].astype(str).value_counts().head(8).to_dict()
        df = df[df[c_country].astype(str).str.lower().isin(["france", "fr"])]
    df = df.copy()
    df["d"] = df["date"].astype(str).str[:10]
    today = datetime.date.today()
    d30, d90 = str(today - datetime.timedelta(days=30)), str(today - datetime.timedelta(days=90))
    names = df[c_name].astype(str).str.lower() if c_name else None
    cat = json.load(open(os.path.join(lib.ROOT, "data", "catalog.json"), encoding="utf-8"))
    eans = {p["ean"] for p in cat["products"] if p.get("ean")}
    out["catalog_eans"] = len(eans)
    out["enseignes"] = {}
    for ens, rx in ENSEIGNES.items():
        sub = df[names.str.contains(rx, regex=True)] if names is not None else df.iloc[0:0]
        recent = sub[sub["d"] >= d90]
        info = {
            "prix": int(len(sub)), "prix_90j": int(len(recent)), "prix_30j": int((sub["d"] >= d30).sum()),
            "magasins_90j": int(recent[c_name].nunique()) if c_name else 0,
            "produits_90j": int(recent["product_code"].dropna().nunique()) if "product_code" in recent else 0,
            "dernier": str(sub["d"].max()) if len(sub) else None,
            "preuves": sub["proof_type"].astype(str).value_counts().to_dict() if "proof_type" in sub else {},
            "catalogue_ean_90j": int(recent["product_code"].astype(str).isin(eans).sum()) if "product_code" in recent else 0,
        }
        if c_post:
            idf = recent[recent[c_post].astype(str).str[:2].isin(IDF)]
            info["idf_prix_90j"] = int(len(idf))
            info["idf_magasins_90j"] = int(idf[c_name].nunique()) if c_name else 0
        top = []
        if c_name and len(recent):
            g = recent.groupby(c_name)
            for name, n in g.size().sort_values(ascending=False).head(8).items():
                rows = recent[recent[c_name] == name]
                top.append({"magasin": name, "ville": str(rows[c_city].iloc[0]) if c_city else None,
                            "cp": str(rows[c_post].iloc[0])[:2] if c_post else None, "prix_90j": int(n),
                            "produits": int(rows["product_code"].dropna().nunique()), "dernier": str(rows["d"].max())})
        info["top_magasins"] = top
        out["enseignes"][ens] = info
    json.dump(out, open(os.path.join(lib.WORK, "openprices_stats.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
    for ens, i in out["enseignes"].items():
        print(f"{ens:12} {i['prix_90j']:6} prix sur 90 jours, {i['magasins_90j']:4} magasins, {i['produits_90j']:5} produits, dernier {i['dernier']}")


def near(spec):
    import math
    lat0, lon0, km = (float(x) for x in spec.split(","))
    df = load()
    df = df[df["location_osm_address_country_code"].astype(str).str.lower() == "fr"].copy()
    df = df[df["location_osm_lat"].notna() & df["location_osm_lon"].notna()]
    rad = math.radians
    def dist(lat, lon):
        dlat, dlon = rad(lat - lat0), rad(lon - lon0)
        h = math.sin(dlat / 2) ** 2 + math.cos(rad(lat0)) * math.cos(rad(lat)) * math.sin(dlon / 2) ** 2
        return 6371 * 2 * math.asin(math.sqrt(h))
    locs = df.groupby("location_id").agg(lat=("location_osm_lat", "first"), lon=("location_osm_lon", "first"))
    locs["km"] = [dist(a, b) for a, b in zip(locs["lat"], locs["lon"])]
    keep = locs[locs["km"] <= km]
    df["d"] = df["date"].astype(str).str[:10]
    d90 = str(datetime.date.today() - datetime.timedelta(days=90))
    out = []
    for lid, row in keep.sort_values("km").iterrows():
        sub = df[df["location_id"] == lid]
        name = str(sub["location_osm_display_name"].iloc[0])
        ens = next((e for e, rx in ENSEIGNES.items() if re.search(rx, name.lower())), None)
        out.append({"location_id": int(lid), "enseigne": ens, "magasin": name.split(",")[0], "ville": str(sub["location_osm_address_city"].iloc[0]),
                    "km": round(float(row["km"]), 1), "prix": int(len(sub)), "prix_90j": int((sub["d"] >= d90).sum()),
                    "produits": int(sub["product_code"].dropna().nunique()), "dernier": str(sub["d"].max()), "premier": str(sub["d"].min())})
    json.dump(out, open(os.path.join(lib.WORK, "openprices_near.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for o in out:
        print(f"{o['km']:5} km  {str(o['enseigne']):12} {o['magasin'][:40]:40} {o['ville'][:22]:22} {o['prix']:5} prix ({o['prix_90j']} sur 90 j), {o['produits']} produits, du {o['premier']} au {o['dernier']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--stats", action="store_true")
    ap.add_argument("--near", help="lat,lon,km")
    a = ap.parse_args()
    if a.stats:
        stats()
    if a.near:
        near(a.near)
