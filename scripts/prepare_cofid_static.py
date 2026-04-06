from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[1]
APP_DATA_DIR = BASE_DIR / 'app' / 'data'

CANONICAL_NUTRIENTS = {
    'energy_kj': ['ENERGYKJ', 'ENERGY, KJ'],
    'energy_kcal': ['ENERGYKCAL', 'ENERGY, KCAL'],
    'protein_g': ['PROTEIN', 'PROTEIN (G)'],
    'fat_g': ['FAT', 'FAT (G)'],
    'carbohydrate_g': ['CARBOHYDRATE', 'CARBOHYDRATE (G)'],
    'sugars_g': ['TOTALSUGARS', 'TOTAL SUGARS', 'SUGARS'],
    'fibre_g': ['FIBRE', 'AOAC FIBRE', 'FIBRE (G)'],
    'sodium_mg': ['SODIUM', 'SODIUM (MG)'],
    'salt_g': ['SALT'],
    'saturates_g': ['SATURATES', 'SATURATED FATTY ACIDS'],
}


def clean_value(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if value in {'', 'N'}:
            return None
        if value == 'Tr':
            return 0.0
    try:
        value = float(value)
    except Exception:
        return None
    if math.isnan(value):
        return None
    return value



def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    cols = []
    seen: dict[str, int] = {}
    for col in df.columns:
        label = '' if col is None else str(col)
        label = re.sub(r'\s+', ' ', label).strip()
        base = label or 'unnamed'
        count = seen.get(base, 0)
        seen[base] = count + 1
        cols.append(base if count == 0 else f'{base}_{count + 1}')
    df.columns = cols
    return df



def find_col(columns: list[str], candidates: list[str]) -> str | None:
    normalized = {re.sub(r'[^A-Z0-9]+', '', c.upper()): c for c in columns}
    for candidate in candidates:
        key = re.sub(r'[^A-Z0-9]+', '', candidate.upper())
        if key in normalized:
            return normalized[key]
    return None



def read_sheet(path: Path, sheet_name: str) -> pd.DataFrame:
    # The official workbook has the human-readable headers in row 1 and short codes in row 2.
    # For this app we want the row 1 labels, so read from the first row and drop the next two header rows manually.
    df = pd.read_excel(path, sheet_name=sheet_name, header=0)
    if len(df) >= 2:
        df = df.iloc[2:].reset_index(drop=True)
    return normalize_columns(df)



def build_database(cofid_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    
    # Supports both simplified sheet names and the official 2021 workbook sheet names.
    prox_name = 'Proximates'
    factors_name = 'Factors'
    import pandas as pd
    xl = pd.ExcelFile(cofid_path)
    sheet_names = set(xl.sheet_names)
    if prox_name not in sheet_names and '1.3 Proximates' in sheet_names:
        prox_name = '1.3 Proximates'
    if factors_name not in sheet_names and '1.2 Factors' in sheet_names:
        factors_name = '1.2 Factors'

    prox = read_sheet(cofid_path, prox_name)
    factors = read_sheet(cofid_path, factors_name)

    food_code_col = find_col(prox.columns.tolist(), ['Food Code', 'FOODCODE'])
    name_col = find_col(prox.columns.tolist(), ['Food Name', 'NAME'])
    desc_col = find_col(prox.columns.tolist(), ['Description', 'DESC'])
    group_col = find_col(prox.columns.tolist(), ['Group', 'GROUP'])

    if not food_code_col or not name_col:
        raise RuntimeError('Could not detect the expected CoFID columns in the Proximates sheet.')

    merged = prox.copy()
    factor_cols = [c for c in factors.columns if c not in merged.columns and c != food_code_col]
    if food_code_col in factors.columns:
        merged = merged.merge(factors[[food_code_col] + factor_cols], on=food_code_col, how='left')

    canonical = {}
    for key, candidates in CANONICAL_NUTRIENTS.items():
        col = find_col(merged.columns.tolist(), candidates)
        if col:
            canonical[key] = col

    nutrient_defs = []
    for key, col in canonical.items():
        unit = 'g'
        if key.endswith('_kj'):
            unit = 'kJ'
        elif key.endswith('_kcal'):
            unit = 'kcal'
        elif key.endswith('_mg'):
            unit = 'mg'
        nutrient_defs.append({'key': key, 'label': col, 'unit': unit})

    foods = []
    for _, row in merged.iterrows():
        food_code = row.get(food_code_col)
        name = row.get(name_col)
        if pd.isna(food_code) or pd.isna(name):
            continue

        nutrients = {}
        for key, col in canonical.items():
            value = clean_value(row.get(col))
            if value is not None:
                nutrients[key] = value

        foods.append(
            {
                'food_code': int(food_code),
                'name': str(name).strip(),
                'description': '' if desc_col is None or pd.isna(row.get(desc_col)) else str(row.get(desc_col)).strip(),
                'group': '' if group_col is None or pd.isna(row.get(group_col)) else str(row.get(group_col)).strip(),
                'nutrients': nutrients,
            }
        )

    meta = {
        'source': 'McCance and Widdowson CoFID',
        'workbook': cofid_path.name,
        'food_count': len(foods),
        'nutrients': nutrient_defs,
        'warning': (
            'Reference values are typical composition data. Match foods carefully, especially for processed products, '
            'alcoholic drinks, and reformulated branded foods.'
        ),
    }
    return meta, foods



def write_dataset(meta: dict[str, Any], foods: list[dict[str, Any]], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    meta_json = json.dumps(meta, ensure_ascii=False, indent=2)
    foods_json = json.dumps(foods, ensure_ascii=False)
    (out_dir / 'meta.json').write_text(meta_json, encoding='utf-8')
    (out_dir / 'foods.json').write_text(foods_json, encoding='utf-8')
    (out_dir / 'meta.js').write_text('window.COFID_EMBEDDED_META = ' + json.dumps(meta, ensure_ascii=False) + ';\n', encoding='utf-8')
    (out_dir / 'foods.js').write_text('window.COFID_EMBEDDED_FOODS = ' + json.dumps(foods, ensure_ascii=False) + ';\n', encoding='utf-8')



def write_demo_dataset(out_dir: Path) -> None:
    sample = {
        'source': 'Demo dataset',
        'workbook': 'sample_cofid.json',
        'food_count': 5,
        'warning': 'Demo data only. Replace this with the official workbook before trusting results.',
        'nutrients': [
            {'key': 'energy_kj', 'label': 'Energy, kJ', 'unit': 'kJ'},
            {'key': 'energy_kcal', 'label': 'Energy, kcal', 'unit': 'kcal'},
            {'key': 'protein_g', 'label': 'Protein', 'unit': 'g'},
            {'key': 'fat_g', 'label': 'Fat', 'unit': 'g'},
            {'key': 'carbohydrate_g', 'label': 'Carbohydrate', 'unit': 'g'},
            {'key': 'sugars_g', 'label': 'Total sugars', 'unit': 'g'},
            {'key': 'fibre_g', 'label': 'Fibre', 'unit': 'g'},
            {'key': 'sodium_mg', 'label': 'Sodium', 'unit': 'mg'},
            {'key': 'salt_g', 'label': 'Salt', 'unit': 'g'},
            {'key': 'saturates_g', 'label': 'Saturates', 'unit': 'g'},
        ],
    }
    foods = [
        {'food_code': 1001, 'name': 'Chicken breast, roasted', 'description': 'Demonstration row', 'group': 'Meat', 'nutrients': {'energy_kj': 690, 'energy_kcal': 165, 'protein_g': 31.0, 'fat_g': 3.6, 'carbohydrate_g': 0.0, 'sugars_g': 0.0, 'fibre_g': 0.0, 'sodium_mg': 74, 'salt_g': 0.185, 'saturates_g': 1.0}},
        {'food_code': 1002, 'name': 'Rice, white, boiled', 'description': 'Demonstration row', 'group': 'Cereals', 'nutrients': {'energy_kj': 540, 'energy_kcal': 128, 'protein_g': 2.7, 'fat_g': 0.3, 'carbohydrate_g': 28.2, 'sugars_g': 0.1, 'fibre_g': 0.4, 'sodium_mg': 1, 'salt_g': 0.003, 'saturates_g': 0.1}},
        {'food_code': 1003, 'name': 'Broccoli, boiled', 'description': 'Demonstration row', 'group': 'Vegetables', 'nutrients': {'energy_kj': 146, 'energy_kcal': 35, 'protein_g': 3.0, 'fat_g': 0.4, 'carbohydrate_g': 2.7, 'sugars_g': 1.4, 'fibre_g': 3.3, 'sodium_mg': 15, 'salt_g': 0.038, 'saturates_g': 0.1}},
        {'food_code': 1004, 'name': 'Olive oil', 'description': 'Demonstration row', 'group': 'Fats and oils', 'nutrients': {'energy_kj': 3700, 'energy_kcal': 900, 'protein_g': 0.0, 'fat_g': 100.0, 'carbohydrate_g': 0.0, 'sugars_g': 0.0, 'fibre_g': 0.0, 'sodium_mg': 0, 'salt_g': 0.0, 'saturates_g': 14.0}},
        {'food_code': 1005, 'name': 'Tomato, raw', 'description': 'Demonstration row', 'group': 'Vegetables', 'nutrients': {'energy_kj': 74, 'energy_kcal': 18, 'protein_g': 0.9, 'fat_g': 0.2, 'carbohydrate_g': 2.9, 'sugars_g': 2.6, 'fibre_g': 1.2, 'sodium_mg': 5, 'salt_g': 0.013, 'saturates_g': 0.0}},
    ]
    write_dataset(sample, foods, out_dir)



def main() -> None:
    parser = argparse.ArgumentParser(description='Prepare static JSON files for the zero-backend CoFID web app.')
    parser.add_argument('--cofid', default='', help='Path to the official CoFID workbook.')
    parser.add_argument('--out-dir', default=str(APP_DATA_DIR), help='Output directory for meta.json and foods.json.')
    parser.add_argument('--demo', action='store_true', help='Write the bundled demo dataset instead of reading Excel.')
    args = parser.parse_args()

    out_dir = Path(args.out_dir)

    if args.demo:
        write_demo_dataset(out_dir)
        print(f'Wrote demo dataset to {out_dir}')
        return

    if not args.cofid:
        raise SystemExit('Provide --cofid path/to/cofid.xlsx, or use --demo.')

    cofid_path = Path(args.cofid)
    if not cofid_path.exists():
        raise SystemExit(f'CoFID workbook not found: {cofid_path}')

    meta, foods = build_database(cofid_path)
    write_dataset(meta, foods, out_dir)
    print(f'Wrote {len(foods)} foods to {out_dir}')


if __name__ == '__main__':
    main()
