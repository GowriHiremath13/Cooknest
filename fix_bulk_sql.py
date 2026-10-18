
from pathlib import Path
import re

source = Path(r"G:\cooking\bulk_recipes_backup.sql")
output = Path(r"G:\cooking\bulk_recipes_ready.sql")

sql = source.read_text(encoding="utf-8")

pattern = re.compile(
    r"(INSERT INTO Recipe_Ingredients\b[^;]*?\bLIMIT\s+1)"
    r"\s*;",
    re.IGNORECASE
)

matches = list(pattern.finditer(sql))

if len(matches) != 8151:
    print(f"STOP: Expected 8151 matches, found {len(matches)}.")
    print("No output file written.")
    raise SystemExit(1)

fixed, count = pattern.subn(
    r"\1 ON CONFLICT (recipe_id, ingredient_id) DO NOTHING;",
    sql
)

if count != 8151:
    print(f"STOP: Expected 8151 replacements, got {count}.")
    raise SystemExit(1)

output.write_text(fixed, encoding="utf-8")

print(f"Created: {output}")
print(f"Statements updated: {count}")
print("Original and backup files were not modified.")
