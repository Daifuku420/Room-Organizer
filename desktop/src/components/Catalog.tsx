import { useEffect, useState } from "react";
import { api } from "../api";
import { mmToCm } from "../geometry";
import type { CatalogItem } from "../types";

/**
 * Browse and search the shared furniture catalog. Debounced so typing
 * doesn't fire a request per keystroke; the category list is fetched once,
 * since it changes only when someone re-runs the importer.
 */
export function CatalogPanel({ onAdd }: { onAdd: (item: CatalogItem) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listCatalogCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      api
        .searchCatalog(query, category)
        .then((found) => {
          setItems(found);
          setError("");
        })
        .catch((e) => setError(`Search failed. ${e instanceof Error ? e.message : ""}`));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, category]);

  return (
    <>
      <div className="field">
        <label htmlFor="catalog-q">Search catalogue</label>
        <input
          id="catalog-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="name or brand…"
        />
      </div>

      <div className="field">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}

      {items.length === 0 && !error && (
        <p className="hint">Nothing matches yet — try a different search.</p>
      )}

      {items.map((item) => (
        <div key={item.id} className="catalog-item">
          <div className="catalog-item-meta">
            <span className="name">{item.name}</span>
            <span className="dims">
              {item.source} · {mmToCm(item.width_mm)}×{mmToCm(item.depth_mm)} cm
              {item.price_cents != null &&
                ` · ${(item.price_cents / 100).toFixed(0)} ${item.currency}`}
            </span>
          </div>
          <button onClick={() => onAdd(item)}>Add</button>
        </div>
      ))}
    </>
  );
}
