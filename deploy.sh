#!/bin/bash
# ═══════════════════════════════════════════════════════
# DÉPLOIEMENT SAU / SMUR Aubagne → GitHub + Vercel
# Exécute ce script UNE SEULE FOIS depuis le dossier sau-app/
# ═══════════════════════════════════════════════════════

set -e

echo ""
echo "══════════════════════════════════════════"
echo "  DÉPLOIEMENT SAU/SMUR Aubagne"
echo "══════════════════════════════════════════"
echo ""

# ── 1. Vérifier les outils ────────────────────────────
check_tool() {
  if ! command -v $1 &>/dev/null; then
    echo "❌ '$1' manquant. Installe-le et relance."
    exit 1
  fi
}
check_tool git
check_tool node
check_tool npm

echo "✅ Outils OK"

# ── 2. Demander les infos ─────────────────────────────
echo ""
read -p "Ton nom d'utilisateur GitHub : " GITHUB_USER
read -p "Ton token GitHub (Settings → Developer settings → Personal access tokens → Fine-grained) : " GITHUB_TOKEN
read -p "Ton token Vercel (vercel.com → Settings → Tokens) : " VERCEL_TOKEN

REPO_NAME="sau-smur-aubagne"
echo ""
echo "→ Création du repo GitHub '$REPO_NAME'..."

# ── 3. Créer le repo GitHub ───────────────────────────
RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/user/repos \
  -d "{\"name\":\"$REPO_NAME\",\"private\":false,\"description\":\"SAU SMUR Aubagne - Application médicale\"}")

REPO_URL=$(echo $RESPONSE | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('clone_url',''))" 2>/dev/null)

if [ -z "$REPO_URL" ]; then
  # Repo existe peut-être déjà
  REPO_URL="https://github.com/$GITHUB_USER/$REPO_NAME.git"
  echo "⚠️  Repo existant ou déjà créé, on continue..."
else
  echo "✅ Repo GitHub créé : $REPO_URL"
fi

# ── 4. Push sur GitHub ────────────────────────────────
echo "→ Push du code sur GitHub..."

# Configurer git si nécessaire
git config --global user.email "deploy@sau-aubagne.fr" 2>/dev/null || true
git config --global user.name "SAU Aubagne Deploy" 2>/dev/null || true

cd "$(dirname "$0")"

if [ ! -d ".git" ]; then
  git init
  git add .
  git commit -m "🚀 Initial deployment - SAU/SMUR Aubagne"
  git branch -M main
  git remote add origin "https://$GITHUB_USER:$GITHUB_TOKEN@${REPO_URL#https://}"
  git push -u origin main
else
  git add .
  git commit -m "🔄 Update" 2>/dev/null || echo "Rien à committer"
  git push
fi

echo "✅ Code pushé sur GitHub"

# ── 5. Créer le projet Vercel ─────────────────────────
echo "→ Création du projet sur Vercel..."

VERCEL_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  https://api.vercel.com/v10/projects \
  -d "{
    \"name\": \"$REPO_NAME\",
    \"framework\": \"vite\",
    \"gitRepository\": {
      \"type\": \"github\",
      \"repo\": \"$GITHUB_USER/$REPO_NAME\"
    },
    \"buildCommand\": \"npm run build\",
    \"outputDirectory\": \"dist\"
  }")

PROJECT_ID=$(echo $VERCEL_RESPONSE | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
  echo "⚠️  Projet peut-être déjà existant sur Vercel"
else
  echo "✅ Projet Vercel créé : $PROJECT_ID"
fi

# ── 6. Déclencher le déploiement ─────────────────────
echo "→ Déclenchement du déploiement..."

DEPLOY_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.vercel.com/v13/deployments" \
  -d "{
    \"name\": \"$REPO_NAME\",
    \"gitSource\": {
      \"type\": \"github\",
      \"repoId\": \"$GITHUB_USER/$REPO_NAME\",
      \"ref\": \"main\"
    },
    \"projectId\": \"$PROJECT_ID\"
  }")

DEPLOY_URL=$(echo $DEPLOY_RESPONSE | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('url',''))" 2>/dev/null)

echo ""
echo "══════════════════════════════════════════"
echo "  ✅ DÉPLOIEMENT LANCÉ !"
echo ""
echo "  🌐 Ton application sera disponible sur :"
echo "  https://$REPO_NAME.vercel.app"
echo ""
echo "  (attends 2-3 minutes le temps du build)"
echo "══════════════════════════════════════════"
echo ""
