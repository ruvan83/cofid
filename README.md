# CoFID Recipe Nutrition Calculator, zero-backend edition

This package already includes the full McCance and Widdowson CoFID 2021 dataset that you uploaded.
You can use it immediately without running the importer first.

## What is included now

- Static browser app, no backend required
- Full imported CoFID dataset bundled into:
  - `app/data/meta.json`
  - `app/data/foods.json`
  - `app/data/meta.js`
  - `app/data/foods.js`
- Type-ahead ingredient search across the bundled food database
- Visual result cards, macro bars, per 100 g comparison bars, and ingredient energy contribution bars
- Fallback embedded dataset files so the app can still open directly from `index.html`

## Folder structure

- `app/index.html`, the static application
- `app/assets/app.js`, search, calculation, and visual rendering logic
- `app/assets/styles.css`, styling
- `app/data/`, bundled dataset files used by the browser
- `scripts/prepare_cofid_static.py`, importer for rebuilding the dataset from a workbook later

## Immediate use

### Option 1, simplest
Open `app/index.html` directly in your browser.

This works because the package includes `meta.js` and `foods.js` as an embedded fallback.

### Option 2, cleaner local testing
Serve the `app` folder locally:

```bash
cd app
python -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000
```

## Rebuild the dataset later

If you receive a newer official workbook, rebuild the dataset like this:

```bash
python -m pip install pandas openpyxl
cd cofid_zero_backend_app
python scripts/prepare_cofid_static.py --cofid /path/to/cofid.xlsx
```

That regenerates both the JSON files used in normal hosting and the JS fallback files used for direct file opening.

## What to deploy

Deploy only the contents of `app/`.
Do not deploy `scripts/`.

Production files:
- `index.html`
- `assets/styles.css`
- `assets/app.js`
- `data/meta.json`
- `data/foods.json`
- `data/meta.js`
- `data/foods.js`

## Free hosting option 1, GitHub Pages

### Create the repository

```bash
cd cofid_zero_backend_app
git init
git add .
git commit -m "Initial CoFID static app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cofid-recipe-app.git
git push -u origin main
```

### Publish

The cleanest approach is to publish the `app` folder contents at the repository root.
If you keep the current folder structure, either use a GitHub Actions workflow or move the `app` contents to root before pushing.

### Enable Pages

1. Open the repository on GitHub.
2. Go to **Settings**.
3. Open **Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Choose `main`.
6. Choose the publishing folder.
7. Save.

After deployment, GitHub will publish a URL like:

```text
https://YOUR_USERNAME.github.io/cofid-recipe-app/
```

## Free hosting option 2, Cloudflare Pages

1. Push the project to GitHub.
2. Log in to Cloudflare.
3. Open **Workers & Pages**.
4. Create a new **Pages** project.
5. Connect the GitHub repository.
6. Use these settings:
   - Framework preset: None
   - Build command: leave blank
   - Build output directory: `app`
7. Deploy.

You can also use Direct Upload and upload the `app` folder.

## Free hosting option 3, Netlify

### Manual deploy

1. Log in to Netlify.
2. Open the deploy page.
3. Drag the `app` folder into the deploy area.

### Git deploy

1. Import the GitHub repository into Netlify.
2. Set:
   - Build command: leave blank
   - Publish directory: `app`
3. Deploy.

## Free hosting option 4, Vercel

1. Push the project to GitHub.
2. Import the repository into Vercel.
3. Set:
   - Framework preset: Other
   - Build command: leave blank
   - Output directory: `app`
4. Deploy.

## Recommended hosting order

If your target is zero-cost static hosting with low operational friction:

1. GitHub Pages
2. Cloudflare Pages
3. Netlify
4. Vercel

## What the visual results show

The app renders:
- summary cards for key outputs
- macro split bar for protein, fat, and carbohydrate
- per 100 g comparison bars
- ingredient contribution bars for total recipe energy
- full nutrient tables for total recipe, per 100 g, and per serving

## Hard limits you should not ignore

This stays cheap because it is static.
The moment you add login, per-user saved recipes, private data, or server-side processing, your zero-cost assumption becomes fragile.

Also, CoFID matching is only as good as the chosen food entry. Wrong match, wrong nutrition.
# cofid
# cofid
