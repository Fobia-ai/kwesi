#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Kwesi Release Deployment Script
# Usage:
#   ./scripts/deploy.sh          <- Interactive mode with auto-bump
#   ./scripts/deploy.sh <ver>    <- Direct mode (bypass interactive prompt)
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG_JSON="$WORKSPACE_DIR/package.json"
ELECTRON_BUILDER_YML="$WORKSPACE_DIR/electron-builder.yml"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ ! -f "$PKG_JSON" ]; then
  echo -e "${RED}❌ Error: Cannot find package.json at $PKG_JSON${NC}"
  exit 1
fi

CURRENT_VERSION=$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync('$PKG_JSON')).version);")

AUTO_VERSION=$(node -e "
const cur = '$CURRENT_VERSION'.split('.').map(Number);
cur[2]++;
if (cur[2] > 9) {
  cur[2] = 0;
  cur[1]++;
  if (cur[1] > 9) {
    cur[1] = 0;
    cur[0]++;
  }
}
console.log(cur.join('.'));
")

NEW_VERSION=$1

if [ -z "$NEW_VERSION" ]; then
  options=("Auto-bump to $AUTO_VERSION" "Custom version entry")
  selected=0

  draw_menu() {
    tput rc 2>/dev/null || true
    tput ed 2>/dev/null || true
    echo -e "${BLUE}✨ Kwesi Deployment Wizard${NC}"
    echo -e "   Current version:  ${YELLOW}$CURRENT_VERSION${NC}"
    echo -e ""
    echo -e "   Use ${BLUE}↑/↓ Arrow Keys${NC} and press ${GREEN}Enter${NC}:"
    echo -e ""
    for i in "${!options[@]}"; do
      if [ $i -eq $selected ]; then
        echo -e "     ${GREEN}❯ ${options[$i]}${NC}"
      else
        echo -e "       ${NC}${options[$i]}"
      fi
    done
  }

  echo "" ; echo "" ; echo "" ; echo "" ; echo "" ; echo "" ; echo ""
  tput cuu 7 2>/dev/null || true
  tput sc 2>/dev/null || true
  tput civis
  trap "tput cnorm; exit 0" INT TERM EXIT

  while true; do
    draw_menu
    read -rsn1 key
    case "$key" in
      $'\x1b')
        read -rsn2 key
        if [[ $key == "[A" ]]; then
          selected=$(( (selected - 1 + 2) % 2 ))
        elif [[ $key == "[B" ]]; then
          selected=$(( (selected + 1) % 2 ))
        fi
        ;;
      "")
        break
        ;;
    esac
  done

  tput cnorm
  trap - INT TERM EXIT
  echo -e "\r"

  if [ $selected -eq 0 ]; then
    NEW_VERSION=$AUTO_VERSION
    echo -e "Selected: ${GREEN}Auto-bump to $NEW_VERSION${NC}"
  else
    while true; do
      read -p "⌨️  Enter custom version number (X.Y.Z): " custom_input
      if [[ "$custom_input" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        NEW_VERSION=$custom_input
        break
      else
        echo -e "${RED}Invalid format. Please enter numeric version (e.g., 0.2.5)${NC}"
      fi
    done
  fi
fi

if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${RED}❌ Error: Invalid version format '$NEW_VERSION'. Must be X.Y.Z.${NC}"
  exit 1
fi

echo -e "${BLUE}🚀 Initiating Kwesi deployment for v${NEW_VERSION}...${NC}"

IS_GREATER=$(node -e "
function parse(v) { return v.split('.').map(Number); }
const curr = parse('$CURRENT_VERSION');
const next = parse('$NEW_VERSION');
for (let i=0; i<3; i++) {
  if (next[i] > curr[i]) { process.stdout.write('true'); process.exit(0); }
  if (next[i] < curr[i]) { process.stdout.write('false'); process.exit(0); }
}
process.stdout.write('false');
")

if [ "$IS_GREATER" != "true" ]; then
  echo -e "\n${RED}❌ Deployment blocked! Target version ($NEW_VERSION) must be strictly greater than current version ($CURRENT_VERSION).${NC}"
  exit 1
fi

if ! git -C "$WORKSPACE_DIR" diff-index --quiet HEAD --; then
  echo -e "${YELLOW}⚠️  Warning: You have uncommitted local changes. These will be included in the version bump commit.${NC}"
  read -p "Continue with deployment? (y/N): " confirm
  if [[ $confirm != [yY] && $confirm != [yY][eE][sS] ]]; then
    echo -e "${RED}Aborted by user.${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}✅ All checks passed.${NC}"

echo -e "${BLUE}📝 Updating package.json...${NC}"
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$PKG_JSON', 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('$PKG_JSON', JSON.stringify(pkg, null, 2) + '\n');
"
echo -e "   ✅ Version set to ${YELLOW}$NEW_VERSION${NC} in package.json."

echo -e "${BLUE}📤 Committing and pushing version bump...${NC}"
git -C "$WORKSPACE_DIR" add "$PKG_JSON"
git -C "$WORKSPACE_DIR" commit -m "Bump version to $NEW_VERSION

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git -C "$WORKSPACE_DIR" push

echo -e "${BLUE}🏷️  Creating release tag v$NEW_VERSION...${NC}"
git -C "$WORKSPACE_DIR" tag "v$NEW_VERSION"
git -C "$WORKSPACE_DIR" push origin "v$NEW_VERSION"

echo -e "\n${GREEN}🎉 KWESI RELEASE TRIGGERED!${NC}"
echo -e "   Version: ${YELLOW}$NEW_VERSION${NC}"
echo -e "   GitHub Actions: ${BLUE}https://github.com/Fobia-ai/kwesi/actions${NC}\n"
