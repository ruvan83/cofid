const state = {
  metadata: null,
  nutrients: [],
  foods: [],
  foodMap: new Map(),
  ingredients: [],
  searchResults: [],
  highlightedIndex: -1,
};

const els = {
  searchInput: document.getElementById('food-search'),
  searchResults: document.getElementById('search-results'),
  ingredientsBody: document.querySelector('#ingredients-table tbody'),
  ingredientSummary: document.getElementById('ingredient-summary'),
  results: document.getElementById('results'),
  servings: document.getElementById('servings'),
  datasetBanner: document.getElementById('dataset-banner'),
  clearBtn: document.getElementById('clear-btn'),
  calculateBtn: document.getElementById('calculate-btn'),
  rowTemplate: document.getElementById('ingredient-row-template'),
  recipeName: document.getElementById('recipe-name'),
};

function debounce(fn, wait = 60) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildSearchIndex(food) {
  const name = normalizeText(food.name);
  const group = normalizeText(food.group);
  const description = normalizeText(food.description);
  const text = `${name} ${group} ${description}`.trim();
  const tokens = Array.from(new Set(text.split(/\s+/).filter((token) => token.length > 1)));
  return {
    ...food,
    _nameNormalized: name,
    _searchText: text,
    _tokens: tokens,
  };
}

function getNutrientDef(key) {
  return state.nutrients.find((nutrient) => nutrient.key === key) || { key, label: key, unit: '' };
}

function getNutrientValue(values, key) {
  return Number(values?.[key] || 0);
}

function loadEmbeddedDataset() {
  const embeddedMeta = window.COFID_EMBEDDED_META;
  const embeddedFoods = window.COFID_EMBEDDED_FOODS;
  if (!embeddedMeta || !Array.isArray(embeddedFoods)) {
    return false;
  }

  state.metadata = embeddedMeta;
  state.nutrients = state.metadata.nutrients || [];
  state.foods = embeddedFoods.map(buildSearchIndex);
  state.foodMap = new Map(state.foods.map((food) => [String(food.food_code), food]));
  renderDatasetBanner();
  return true;
}

async function loadDataset() {
  if (window.location.protocol === 'file:' && loadEmbeddedDataset()) {
    return;
  }

  try {
    const [metaResponse, foodsResponse] = await Promise.all([
      fetch('./data/meta.json'),
      fetch('./data/foods.json'),
    ]);

    if (!metaResponse.ok || !foodsResponse.ok) {
      throw new Error('Could not load dataset files. Run the prepare script first.');
    }

    state.metadata = await metaResponse.json();
    const foods = await foodsResponse.json();
    state.nutrients = state.metadata.nutrients || [];
    state.foods = foods.map(buildSearchIndex);
    state.foodMap = new Map(state.foods.map((food) => [String(food.food_code), food]));
    renderDatasetBanner();
  } catch (error) {
    if (loadEmbeddedDataset()) {
      return;
    }
    throw error;
  }
}

function renderDatasetBanner() {
  const metadata = state.metadata || {};
  const notes = [
    `<div><strong>Dataset:</strong> ${escapeHtml(metadata.source || 'Unknown')}</div>`,
    `<div><strong>Workbook:</strong> ${escapeHtml(metadata.workbook || 'Not set')}</div>`,
    `<div><strong>Foods available:</strong> ${metadata.food_count || 0}</div>`,
    `<div><strong>Nutrients available:</strong> ${state.nutrients.length}</div>`,
  ];

  if (metadata.warning) {
    notes.push(`<div class="notice">${escapeHtml(metadata.warning)}</div>`);
  }

  els.datasetBanner.innerHTML = notes.join('');
}

function scoreFood(food, queryTokens, rawQuery) {
  const normalizedQuery = normalizeText(rawQuery);
  let score = 0;

  if (food._nameNormalized === normalizedQuery) {
    score += 1000;
  }
  if (food._nameNormalized.startsWith(normalizedQuery)) {
    score += 250;
  }
  if (food._searchText.includes(normalizedQuery)) {
    score += 100;
  }

  for (const token of queryTokens) {
    if (food._nameNormalized.startsWith(token)) {
      score += 60;
    }
    if (food._tokens.some((candidate) => candidate.startsWith(token))) {
      score += 25;
    }
    if (food._searchText.includes(token)) {
      score += 10;
    }
  }

  return score;
}

function searchFoods(query, limit = 12) {
  const normalized = normalizeText(query);
  if (normalized.length < 2) {
    return [];
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);

  return state.foods
    .map((food) => ({ food, score: scoreFood(food, tokens, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
    .slice(0, limit)
    .map((entry) => entry.food);
}

function closeResults() {
  state.searchResults = [];
  state.highlightedIndex = -1;
  els.searchResults.hidden = true;
  els.searchResults.innerHTML = '';
}

function renderSearchResults(results) {
  state.searchResults = results;
  state.highlightedIndex = results.length ? 0 : -1;

  if (!results.length) {
    closeResults();
    return;
  }

  els.searchResults.hidden = false;
  els.searchResults.innerHTML = '';

  results.forEach((food, index) => {
    const item = document.createElement('div');
    item.className = `search-result ${index === state.highlightedIndex ? 'active' : ''}`;
    item.dataset.index = String(index);
    item.innerHTML = `
      <strong>${escapeHtml(food.name)}</strong>
      <div class="muted">${escapeHtml(food.group || 'Ungrouped')}${food.description ? `, ${escapeHtml(food.description)}` : ''}</div>
      <div class="muted">Food code: ${escapeHtml(food.food_code)}</div>
    `;
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      addIngredient(food);
    });
    els.searchResults.appendChild(item);
  });
}

function updateHighlightedResult(newIndex) {
  if (!state.searchResults.length) {
    return;
  }
  state.highlightedIndex = (newIndex + state.searchResults.length) % state.searchResults.length;
  Array.from(els.searchResults.children).forEach((child, index) => {
    child.classList.toggle('active', index === state.highlightedIndex);
  });
}

function addIngredient(food) {
  const existing = state.ingredients.find((item) => String(item.food_code) === String(food.food_code));
  if (existing) {
    existing.grams += 100;
  } else {
    state.ingredients.push({
      food_code: food.food_code,
      grams: 100,
    });
  }
  els.searchInput.value = '';
  closeResults();
  renderIngredients();
  calculate();
}

function removeIngredient(foodCode) {
  state.ingredients = state.ingredients.filter((item) => String(item.food_code) !== String(foodCode));
  renderIngredients();
  calculate();
}

function updateIngredientWeight(foodCode, grams) {
  const ingredient = state.ingredients.find((item) => String(item.food_code) === String(foodCode));
  if (!ingredient) {
    return;
  }
  ingredient.grams = Math.max(Number(grams || 0), 0);
}

function renderIngredients() {
  els.ingredientsBody.innerHTML = '';

  if (!state.ingredients.length) {
    els.ingredientSummary.textContent = 'No ingredients added yet.';
    return;
  }

  let totalWeight = 0;

  state.ingredients.forEach((ingredient) => {
    const food = state.foodMap.get(String(ingredient.food_code));
    if (!food) {
      return;
    }
    totalWeight += Number(ingredient.grams || 0);

    const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector('.food-name').textContent = food.name;
    row.querySelector('.food-meta').textContent = `${food.group || 'Ungrouped'} | Food code ${food.food_code}`;

    const gramsInput = row.querySelector('.grams-input');
    gramsInput.value = ingredient.grams;
    gramsInput.addEventListener('input', (event) => {
      updateIngredientWeight(food.food_code, event.target.value);
      renderIngredientSummary();
      calculate();
    });

    row.querySelector('.remove-btn').addEventListener('click', () => {
      removeIngredient(food.food_code);
    });

    els.ingredientsBody.appendChild(row);
  });

  renderIngredientSummary(totalWeight);
}

function renderIngredientSummary(totalWeight = null) {
  if (!state.ingredients.length) {
    els.ingredientSummary.textContent = 'No ingredients added yet.';
    return;
  }

  const resolvedWeight = totalWeight ?? state.ingredients.reduce((sum, item) => sum + Number(item.grams || 0), 0);
  els.ingredientSummary.textContent = `${state.ingredients.length} ingredient${state.ingredients.length === 1 ? '' : 's'}, ${formatNumber(resolvedWeight, 1)} g total`;
}

function buildEmptyTotals() {
  return Object.fromEntries(state.nutrients.map((nutrient) => [nutrient.key, 0]));
}

function calculate() {
  if (!state.ingredients.length) {
    els.results.innerHTML = 'Add ingredients, then calculate.';
    return;
  }

  const totals = buildEmptyTotals();
  const servings = Math.max(Number(els.servings.value || 1), 1);
  const recipeName = els.recipeName.value.trim();
  let totalWeight = 0;
  const missingFoods = [];
  const ingredientBreakdown = [];

  for (const ingredient of state.ingredients) {
    const food = state.foodMap.get(String(ingredient.food_code));
    const grams = Number(ingredient.grams || 0);

    if (!food) {
      missingFoods.push(String(ingredient.food_code));
      continue;
    }

    totalWeight += grams;
    const contributions = {};
    for (const nutrient of state.nutrients) {
      const per100 = Number(food.nutrients?.[nutrient.key] || 0);
      const amount = (per100 * grams) / 100;
      totals[nutrient.key] += amount;
      contributions[nutrient.key] = amount;
    }

    ingredientBreakdown.push({
      food_code: food.food_code,
      name: food.name,
      group: food.group,
      grams,
      contributions,
    });
  }

  const per100g = buildEmptyTotals();
  for (const nutrient of state.nutrients) {
    per100g[nutrient.key] = totalWeight > 0 ? (totals[nutrient.key] / totalWeight) * 100 : 0;
  }

  renderResults({ recipeName, totals, per100g, totalWeight, servings, missingFoods, ingredientBreakdown });
}

function buildNutrientTable(values) {
  const rows = state.nutrients
    .map((nutrient) => {
      const value = values[nutrient.key] || 0;
      return `
        <tr>
          <td>${escapeHtml(nutrient.label)}</td>
          <td>${formatNumber(value)} ${escapeHtml(nutrient.unit)}</td>
        </tr>
      `;
    })
    .join('');

  return `<table><tbody>${rows}</tbody></table>`;
}

function renderSummaryCards(totalWeight, servings, totals, per100g) {
  const cards = [
    { label: 'Total weight', value: `${formatNumber(totalWeight, 1)} g` },
    { label: 'Energy per serving', value: `${formatNumber(getNutrientValue(totals, 'energy_kcal') / servings, 1)} kcal` },
    { label: 'Energy per 100 g', value: `${formatNumber(getNutrientValue(per100g, 'energy_kcal'), 1)} kcal` },
    { label: 'Protein per serving', value: `${formatNumber(getNutrientValue(totals, 'protein_g') / servings, 1)} g` },
  ];

  return `
    <div class="summary-cards">
      ${cards
        .map(
          (card) => `
            <div class="summary-card">
              <div class="summary-label">${escapeHtml(card.label)}</div>
              <div class="summary-value">${escapeHtml(card.value)}</div>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderMacroVisual(totals) {
  const protein = Math.max(getNutrientValue(totals, 'protein_g'), 0);
  const fat = Math.max(getNutrientValue(totals, 'fat_g'), 0);
  const carbs = Math.max(getNutrientValue(totals, 'carbohydrate_g'), 0);
  const total = protein + fat + carbs;
  const safeTotal = total > 0 ? total : 1;

  const segments = [
    { label: 'Protein', value: protein, className: 'macro-protein' },
    { label: 'Fat', value: fat, className: 'macro-fat' },
    { label: 'Carbohydrate', value: carbs, className: 'macro-carb' },
  ];

  return `
    <div class="visual-card">
      <h3>Macro split, grams</h3>
      <div class="macro-stack" aria-label="Macro composition bar">
        ${segments
          .map((segment) => {
            const width = ((segment.value / safeTotal) * 100).toFixed(2);
            return `<div class="macro-segment ${segment.className}" style="width:${width}%"></div>`;
          })
          .join('')}
      </div>
      <div class="macro-legend">
        ${segments
          .map(
            (segment) => `
              <div class="macro-legend-row">
                <span class="legend-swatch ${segment.className}"></span>
                <span>${escapeHtml(segment.label)}</span>
                <strong>${formatNumber(segment.value, 1)} g</strong>
              </div>
            `,
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderDensityVisual(per100g) {
  const protein = Math.max(getNutrientValue(per100g, 'protein_g'), 0);
  const fat = Math.max(getNutrientValue(per100g, 'fat_g'), 0);
  const carbs = Math.max(getNutrientValue(per100g, 'carbohydrate_g'), 0);
  const fibre = Math.max(getNutrientValue(per100g, 'fibre_g'), 0);
  const maxValue = Math.max(protein, fat, carbs, fibre, 1);
  const bars = [
    { key: 'protein_g', label: 'Protein', value: protein },
    { key: 'fat_g', label: 'Fat', value: fat },
    { key: 'carbohydrate_g', label: 'Carbohydrate', value: carbs },
    { key: 'fibre_g', label: 'Fibre', value: fibre },
  ];

  return `
    <div class="visual-card">
      <h3>Per 100 g density</h3>
      <div class="density-bars">
        ${bars
          .map(
            (bar) => `
              <div class="density-row">
                <div class="density-head">
                  <span>${escapeHtml(bar.label)}</span>
                  <strong>${formatNumber(bar.value, 1)} g</strong>
                </div>
                <div class="density-track">
                  <div class="density-fill" style="width:${((bar.value / maxValue) * 100).toFixed(2)}%"></div>
                </div>
              </div>
            `,
          )
          .join('')}
      </div>
      <p class="muted compact">This is a comparison inside this recipe, not a health score.</p>
    </div>
  `;
}

function renderIngredientContribution(ingredientBreakdown, totals) {
  const energyKey = getNutrientDef('energy_kcal').key;
  const totalEnergy = Math.max(getNutrientValue(totals, energyKey), 0);
  const safeTotalEnergy = totalEnergy > 0 ? totalEnergy : 1;
  const sorted = [...ingredientBreakdown].sort(
    (a, b) => getNutrientValue(b.contributions, energyKey) - getNutrientValue(a.contributions, energyKey),
  );

  return `
    <div class="visual-card contribution-card">
      <h3>Ingredient contribution to total energy</h3>
      <div class="contribution-list">
        ${sorted
          .map((item) => {
            const kcal = getNutrientValue(item.contributions, energyKey);
            const width = ((kcal / safeTotalEnergy) * 100).toFixed(2);
            const percent = ((kcal / safeTotalEnergy) * 100).toFixed(1);
            return `
              <div class="contribution-row">
                <div class="contribution-head">
                  <span>${escapeHtml(item.name)}</span>
                  <strong>${formatNumber(kcal, 1)} kcal, ${percent}%</strong>
                </div>
                <div class="density-track">
                  <div class="contribution-fill" style="width:${width}%"></div>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function renderResults({ recipeName, totals, per100g, totalWeight, servings, missingFoods, ingredientBreakdown }) {
  const perServing = Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, value / servings]),
  );

  const title = recipeName ? `Results for ${escapeHtml(recipeName)}` : 'Recipe results';
  const warning = missingFoods.length
    ? `<p class="notice">Some foods could not be resolved from the dataset: ${escapeHtml(missingFoods.join(', '))}</p>`
    : '';

  els.results.innerHTML = `
    <h3>${title}</h3>
    <div class="result-meta">
      <span class="pill">Total weight ${formatNumber(totalWeight, 1)} g</span>
      <span class="pill">Servings ${servings}</span>
      <span class="pill">Ingredients ${state.ingredients.length}</span>
    </div>
    ${warning}
    ${renderSummaryCards(totalWeight, servings, totals, per100g)}
    <div class="visual-grid">
      ${renderMacroVisual(totals)}
      ${renderDensityVisual(per100g)}
    </div>
    ${renderIngredientContribution(ingredientBreakdown, totals)}
    <div class="results-grid">
      <div class="result-card">
        <h3>Total recipe</h3>
        ${buildNutrientTable(totals)}
      </div>
      <div class="result-card">
        <h3>Per 100 g</h3>
        ${buildNutrientTable(per100g)}
      </div>
      <div class="result-card">
        <h3>Per serving</h3>
        ${buildNutrientTable(perServing)}
      </div>
    </div>
  `;
}

function wireEvents() {
  const handleSearch = debounce(() => {
    const query = els.searchInput.value.trim();
    renderSearchResults(searchFoods(query));
  }, 40);

  els.searchInput.addEventListener('input', handleSearch);
  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      updateHighlightedResult(state.highlightedIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      updateHighlightedResult(state.highlightedIndex - 1);
      return;
    }
    if (event.key === 'Enter' && state.highlightedIndex >= 0) {
      event.preventDefault();
      addIngredient(state.searchResults[state.highlightedIndex]);
      return;
    }
    if (event.key === 'Escape') {
      closeResults();
    }
  });

  document.addEventListener('click', (event) => {
    if (!els.searchResults.contains(event.target) && event.target !== els.searchInput) {
      closeResults();
    }
  });

  els.servings.addEventListener('input', calculate);
  els.recipeName.addEventListener('input', debounce(calculate, 80));
  els.clearBtn.addEventListener('click', () => {
    state.ingredients = [];
    renderIngredients();
    calculate();
  });
  els.calculateBtn.addEventListener('click', calculate);
}

async function bootstrap() {
  await loadDataset();
  wireEvents();
  const defaults = ['Chicken breast, roasted', 'Rice, white, boiled'];
  defaults.forEach((name) => {
    const found = state.foods.find((food) => food.name === name);
    if (found) {
      state.ingredients.push({ food_code: found.food_code, grams: 100 });
    }
  });
  renderIngredients();
  calculate();
}

bootstrap().catch((error) => {
  const fileHint = window.location.protocol === 'file:'
    ? '<p class="muted compact">You opened the HTML file directly. This build now supports embedded demo data, but if you replaced the dataset and removed the embedded files, serve the app folder with a static web server.</p>'
    : '';
  els.results.innerHTML = `<div class="empty-state"><strong>Failed to load app:</strong> ${escapeHtml(error.message)}${fileHint}</div>`;
});
