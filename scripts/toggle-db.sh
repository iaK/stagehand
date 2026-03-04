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
  rm "$DB"
  mv "$BAK" "$DB"
  echo "Removed app.db, restored app.db.bak → app.db"
else
  echo "No app.db or app.db.bak found at ~/.stagehand/"
fi
