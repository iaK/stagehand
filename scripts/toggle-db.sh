#!/bin/bash
# Toggle between real and fresh app.db for testing the setup wizard.
# Usage: ./scripts/toggle-db.sh

DB="$HOME/.stagehand/app.db"
BAK="$HOME/.stagehand/app.db.bak"

if [ -f "$DB" ] && [ ! -f "$BAK" ]; then
  mv "$DB" "$BAK"
  echo "Stashed app.db → app.db.bak (fresh install mode)"
elif [ ! -f "$DB" ] && [ -f "$BAK" ]; then
  mv "$BAK" "$DB"
  echo "Restored app.db.bak → app.db (normal mode)"
elif [ -f "$DB" ] && [ -f "$BAK" ]; then
  echo "Both app.db and app.db.bak exist — resolving by swapping them"
  mv "$DB" "$DB.tmp"
  mv "$BAK" "$DB"
  mv "$DB.tmp" "$BAK"
  echo "Swapped app.db ↔ app.db.bak"
else
  echo "No app.db or app.db.bak found at ~/.stagehand/"
fi
