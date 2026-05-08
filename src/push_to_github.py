#!/usr/bin/env python3
"""
Lance ce script sur ton Mac pour pousser App.jsx sur GitHub.
Usage: python3 push_to_github.py TON_TOKEN
"""
import sys, base64, json, urllib.request, os

TOKEN = sys.argv[1] if len(sys.argv) > 1 else input("Ton token GitHub (ghp_...): ").strip()
REPO  = "jeremylam13/sau-smur-aubagne"
PATH  = "src/App.jsx"

# Chercher App.jsx dans le même dossier que ce script
script_dir = os.path.dirname(os.path.abspath(__file__))
app_path = os.path.join(script_dir, "App.jsx")

if not os.path.exists(app_path):
    print(f"❌ App.jsx introuvable dans {script_dir}")
    print("   Mets App.jsx dans le même dossier que ce script.")
    sys.exit(1)

with open(app_path, "rb") as f:
    content_b64 = base64.b64encode(f.read()).decode()

# Récupérer le SHA actuel du fichier
url_get = f"https://api.github.com/repos/{REPO}/contents/{PATH}"
req = urllib.request.Request(url_get, headers={
    "Authorization": f"token {TOKEN}",
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "sau-deploy"
})
try:
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read())
        sha = data["sha"]
        print(f"✅ Fichier existant trouvé (sha: {sha[:8]}...)")
except Exception as e:
    sha = None
    print(f"⚠️  Fichier absent ou erreur: {e}")

# Pousser le nouveau fichier
body = json.dumps({
    "message": "Fix RETEX: publier + modifier + supprimer",
    "content": content_b64,
    "sha": sha,
}).encode()

req2 = urllib.request.Request(url_get, data=body, method="PUT", headers={
    "Authorization": f"token {TOKEN}",
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "sau-deploy"
})

try:
    with urllib.request.urlopen(req2) as r:
        result = json.loads(r.read())
        print(f"✅ Fichier poussé avec succès !")
        print(f"   Commit: {result['commit']['sha'][:8]}")
        print(f"   Vercel redéploie automatiquement dans 2 minutes.")
except urllib.error.HTTPError as e:
    body_err = e.read().decode()
    print(f"❌ Erreur GitHub API: {e.code} {body_err[:200]}")
