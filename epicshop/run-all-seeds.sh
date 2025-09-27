#!/bin/bash
set -e

find exercises -path '*/src/db/seed.ts' | while read -r file; do
  if [ -f "$file" ]; then
    echo "🌱 Seeding $file"
    # we want to run the script from the root of the exercise directory
    # so that paths to the database are resolved correctly.
    dir=$(dirname "$file" | xargs dirname | xargs dirname)
    seed_file=${file#"$dir/"}
    (cd "$dir" && npx tsx "$seed_file")
  fi
done

echo "✅ All seeds completed."
