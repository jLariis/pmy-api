# Panel Sync — Subsidiary+Day Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In the experimental panel, replace the free-text ID input (route/consolidated modes) with Sucursal + Día selectors that fetch a pickable list.

**Architecture:** Frontend-only in `app-pmy`. Pure label/date helper (Vitest-tested) + two thin service wrappers over existing list endpoints + page wiring. Existing `compareByRoute`/`compareByConsolidated` and `CompareTable` unchanged.

**Tech Stack:** Next.js (App Router), Vitest.

## Global Constraints

- **Repo `app-pmy`** only. Run tests with `cd /c/PMY/app-pmy && npx vitest run <frag>`; type-check with `npx tsc --noEmit`. NO `next dev` (8GB RAM).
- **No backend changes.** Reuse `GET package-dispatch/subsidiary/:id?from&to`, `GET consolidated?subsidiaryId&fromDate&toDate`, `GET subsidiaries`, and existing compare endpoints.
- **Defensive field access:** list responses may be the full entity or a lighter response shape — helpers must tolerate missing fields.

---

## File Structure
- `lib/tracking/picker-options.ts` — pure helpers: `toDayRange`, `buildRouteOption`, `buildConsolidatedOption`.
- `lib/tracking/picker-options.test.ts` — Vitest.
- `lib/services/tracking-sync.ts` — add `PickerOption`, `listRoutesBySubsidiaryDay`, `listConsolidatedsBySubsidiaryDay`.
- `app/dev/tracking-sync/page.tsx` — subsidiary+day+list UI for batch modes.

---

## Task 1: Pure picker-options helper (TDD)

**Files:**
- Create: `lib/tracking/picker-options.ts`
- Test: `lib/tracking/picker-options.test.ts`

**Interfaces:**
- Produces: `toDayRange(day: string): { from: string; to: string }`; `buildRouteOption(route: any): { id: string; label: string }`; `buildConsolidatedOption(cons: any): { id: string; label: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/tracking/picker-options.test.ts
import { describe, it, expect } from "vitest";
import { toDayRange, buildRouteOption, buildConsolidatedOption } from "./picker-options";

describe("toDayRange", () => {
  it("returns the same day as from and to (YYYY-MM-DD)", () => {
    expect(toDayRange("2026-08-16")).toEqual({ from: "2026-08-16", to: "2026-08-16" });
  });
});

describe("buildRouteOption", () => {
  it("uses driverName/totalPackages/date when present", () => {
    const o = buildRouteOption({ id: "r1", routeDate: "2026-08-16T00:00:00Z", totalPackages: 12, driverName: "Juan" });
    expect(o.id).toBe("r1");
    expect(o.label).toContain("2026-08-16");
    expect(o.label).toContain("12");
    expect(o.label).toContain("Juan");
  });
  it("falls back to shipments length + first driver name + createdAt, and short id when nothing else", () => {
    const o = buildRouteOption({ id: "abcdef123456", shipments: [{}, {}], drivers: [{ name: "Ana" }], createdAt: "2026-08-15T10:00:00Z" });
    expect(o.label).toContain("2026-08-15");
    expect(o.label).toContain("2");
    expect(o.label).toContain("Ana");
    const bare = buildRouteOption({ id: "abcdef123456" });
    expect(bare.label).toContain("abcdef"); // short id fallback
  });
});

describe("buildConsolidatedOption", () => {
  it("labels with date, type/name and package count", () => {
    const o = buildConsolidatedOption({ id: "c1", date: "2026-08-16T00:00:00Z", type: "ordinario", numberOfPackages: 30 });
    expect(o.id).toBe("c1");
    expect(o.label).toContain("2026-08-16");
    expect(o.label).toContain("ordinario");
    expect(o.label).toContain("30");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /c/PMY/app-pmy && npx vitest run lib/tracking/picker-options`
Expected: FAIL — cannot find module `./picker-options`.

- [ ] **Step 3: Implement**

```ts
// lib/tracking/picker-options.ts
export interface PickerOption { id: string; label: string; }

/** Un día → rango [from,to] con el mismo día (formato YYYY-MM-DD). */
export function toDayRange(day: string): { from: string; to: string } {
  const d = (day || "").slice(0, 10);
  return { from: d, to: d };
}

function shortDate(...candidates: (string | undefined | null)[]): string {
  const raw = candidates.find((c) => !!c);
  return raw ? String(raw).slice(0, 10) : "—";
}

function shortId(id: string): string {
  return (id || "").slice(0, 6) || "—";
}

export function buildRouteOption(route: any): PickerOption {
  const id = route?.id ?? "";
  const date = shortDate(route?.routeDate, route?.startTime, route?.createdAt);
  const count = route?.totalPackages ?? route?.shipments?.length ?? 0;
  const driver = route?.driverName ?? route?.drivers?.[0]?.name ?? "—";
  const label = `${date} · ${count} guías · ${driver}` + (date === "—" && count === 0 ? ` · ${shortId(id)}` : "");
  return { id, label };
}

export function buildConsolidatedOption(cons: any): PickerOption {
  const id = cons?.id ?? "";
  const date = shortDate(cons?.date, cons?.createdAt);
  const name = cons?.name ?? cons?.type ?? shortId(id);
  const count = cons?.numberOfPackages ?? cons?.shipmentCounts?.total ?? 0;
  return { id, label: `${date} · ${name} · ${count} guías` };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /c/PMY/app-pmy && npx vitest run lib/tracking/picker-options`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit** (in `app-pmy`)

```bash
git -C /c/PMY/app-pmy add lib/tracking/picker-options.ts lib/tracking/picker-options.test.ts
git -C /c/PMY/app-pmy commit -m "feat(tracking-sync): pure picker-option/date helpers"
```

---

## Task 2: Service wrappers for list-by-subsidiary+day

**Files:**
- Modify: `lib/services/tracking-sync.ts`

**Interfaces:**
- Consumes: `axiosConfig`, `toDayRange`, `buildRouteOption`, `buildConsolidatedOption`.
- Produces: `PickerOption` (re-export), `listRoutesBySubsidiaryDay(subsidiaryId, day)`, `listConsolidatedsBySubsidiaryDay(subsidiaryId, day)`.

- [ ] **Step 1: Add the wrappers**

```ts
// append to lib/services/tracking-sync.ts
import { toDayRange, buildRouteOption, buildConsolidatedOption, type PickerOption } from "../tracking/picker-options";
export type { PickerOption };

/** Rutas (salidas a ruta) de una sucursal en un día, como opciones para el desplegable. */
export const listRoutesBySubsidiaryDay = async (subsidiaryId: string, day: string): Promise<PickerOption[]> => {
  const { from, to } = toDayRange(day);
  const res = await axiosConfig.get<any>(`package-dispatch/subsidiary/${subsidiaryId}`, { params: { from, to, limit: 200 } });
  const items: any[] = Array.isArray(res.data) ? res.data : res.data?.data ?? res.data?.items ?? [];
  return items.map(buildRouteOption);
};

/** Consolidados de una sucursal en un día, como opciones para el desplegable. */
export const listConsolidatedsBySubsidiaryDay = async (subsidiaryId: string, day: string): Promise<PickerOption[]> => {
  const { from, to } = toDayRange(day);
  const res = await axiosConfig.get<any>(`consolidated`, { params: { subsidiaryId, fromDate: from, toDate: to } });
  const items: any[] = Array.isArray(res.data) ? res.data : res.data?.data ?? res.data?.items ?? [];
  return items.map(buildConsolidatedOption);
};
```

> Note: `getPackageDispatchs` returns a `Paginated<>` shape; the wrapper reads `res.data.data`/`.items`/array defensively. Verify the actual key by inspecting `lib/services/pagination.ts` (`Paginated<T>`); if it exposes `.data`, the first fallback already covers it.

- [ ] **Step 2: Type-check**

Run: `cd /c/PMY/app-pmy && npx tsc --noEmit`
Expected: no errors in `tracking-sync.ts`.

- [ ] **Step 3: Commit** (in `app-pmy`)

```bash
git -C /c/PMY/app-pmy add lib/services/tracking-sync.ts
git -C /c/PMY/app-pmy commit -m "feat(tracking-sync): list routes/consolidateds by subsidiary+day"
```

---

## Task 3: Page — subsidiary + day + list picker

**Files:**
- Modify: `app/dev/tracking-sync/page.tsx`

**Interfaces:**
- Consumes: `getSubsidiaries` (`lib/services/subsidiaries.ts`), `listRoutesBySubsidiaryDay`, `listConsolidatedsBySubsidiaryDay`, `compareByRoute`, `compareByConsolidated`, `CompareTable`, `PickerOption`.

- [ ] **Step 1: Rewrite the page to add the picker for batch modes**

Keep "Por guía" exactly as-is (free-text tracking). For "route"/"consolidated" modes render: a Sucursal `<select>` (from `getSubsidiaries()`), a Fecha `<input type="date">` (default today), a **Buscar** button that loads `options`, then a results `<select>`; choosing an option runs the matching compare and shows `<CompareTable>`.

```tsx
// app/dev/tracking-sync/page.tsx
"use client";
import { useEffect, useState } from "react";
import { CompareTable } from "@/components/tracking-sync/compare-table";
import {
  compareByTracking, compareByRoute, compareByConsolidated, applyCorrections,
  listRoutesBySubsidiaryDay, listConsolidatedsBySubsidiaryDay,
  type CompareResult, type PickerOption,
} from "@/lib/services/tracking-sync";
import { getSubsidiaries } from "@/lib/services/subsidiaries";
import type { Subsidiary } from "@/lib/types";

type Mode = "tracking" | "route" | "consolidated";
const today = () => new Date().toISOString().slice(0, 10);

export default function TrackingSyncPage() {
  const [mode, setMode] = useState<Mode>("tracking");
  const [rows, setRows] = useState<CompareResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Por guía
  const [tracking, setTracking] = useState("");

  // Por ruta / consolidado
  const [subs, setSubs] = useState<Subsidiary[]>([]);
  const [subsidiaryId, setSubsidiaryId] = useState("");
  const [day, setDay] = useState(today());
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    getSubsidiaries().then(setSubs).catch(() => setSubs([]));
  }, []);

  const runTracking = async () => {
    if (!tracking.trim()) return;
    setLoading(true); setError(null);
    try { setRows([await compareByTracking(tracking.trim())]); }
    catch (e: any) { setError(e?.response?.data?.message ?? e?.message ?? "Error"); setRows([]); }
    finally { setLoading(false); }
  };

  const search = async () => {
    if (!subsidiaryId) { setError("Elige una sucursal"); return; }
    setSearching(true); setError(null); setOptions([]); setSelectedId(""); setRows([]);
    try {
      const opts = mode === "route"
        ? await listRoutesBySubsidiaryDay(subsidiaryId, day)
        : await listConsolidatedsBySubsidiaryDay(subsidiaryId, day);
      setOptions(opts);
      if (opts.length === 0) setError("Sin resultados para esa sucursal y día");
    } catch (e: any) { setError(e?.response?.data?.message ?? e?.message ?? "Error listando"); }
    finally { setSearching(false); }
  };

  const pick = async (id: string) => {
    setSelectedId(id);
    if (!id) { setRows([]); return; }
    setLoading(true); setError(null);
    try {
      setRows(mode === "route" ? await compareByRoute(id) : await compareByConsolidated(id));
    } catch (e: any) { setError(e?.response?.data?.message ?? e?.message ?? "Error"); setRows([]); }
    finally { setLoading(false); }
  };

  const onApply = async (shipmentIds: string[]) => {
    if (shipmentIds.length === 0) return;
    await applyCorrections(shipmentIds);
    if (mode === "tracking") await runTracking();
    else if (selectedId) await pick(selectedId);
  };

  const switchMode = (m: Mode) => { setMode(m); setRows([]); setOptions([]); setSelectedId(""); setError(null); };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Sincronización FedEx (experimental)</h1>
        <p className="text-sm text-muted-foreground">
          Compara nuestro estatus contra FedEx en vivo. Corrección manual (solo estatus, no genera cobros).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["tracking", "route", "consolidated"] as Mode[]).map((m) => (
          <button key={m} onClick={() => switchMode(m)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${mode === m ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`}>
            {m === "tracking" ? "Por guía" : m === "route" ? "Por salida a ruta" : "Por consolidado"}
          </button>
        ))}
      </div>

      {mode === "tracking" ? (
        <div className="flex gap-2">
          <input className="border rounded-lg px-3 py-1.5 text-sm w-80" placeholder="Número de guía"
            value={tracking} onChange={(e) => setTracking(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runTracking()} />
          <button onClick={runTracking} disabled={loading} className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-sm disabled:opacity-50">
            {loading ? "Consultando…" : "Consultar FedEx ahora"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <select className="border rounded-lg px-3 py-1.5 text-sm" value={subsidiaryId} onChange={(e) => setSubsidiaryId(e.target.value)}>
              <option value="">Sucursal…</option>
              {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="date" className="border rounded-lg px-3 py-1.5 text-sm" value={day} onChange={(e) => setDay(e.target.value)} />
            <button onClick={search} disabled={searching} className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-sm disabled:opacity-50">
              {searching ? "Buscando…" : "Buscar"}
            </button>
          </div>
          {options.length > 0 && (
            <select className="border rounded-lg px-3 py-1.5 text-sm w-full max-w-xl" value={selectedId} onChange={(e) => pick(e.target.value)}>
              <option value="">{mode === "route" ? "Elige una salida a ruta…" : "Elige un consolidado…"}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}
        </div>
      )}

      {error && <div className="text-sm text-red-600">{error}</div>}
      {loading && rows.length === 0 && <div className="text-sm text-muted-foreground">Consultando FedEx…</div>}
      {rows.length > 0 && <CompareTable rows={rows} onApply={onApply} />}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd /c/PMY/app-pmy && npx tsc --noEmit`
Expected: no errors in `page.tsx` (verify `Subsidiary` has `id`/`name`; adjust import path if the type lives elsewhere).

- [ ] **Step 3: Commit** (in `app-pmy`)

```bash
git -C /c/PMY/app-pmy add app/dev/tracking-sync/page.tsx
git -C /c/PMY/app-pmy commit -m "feat(tracking-sync): subsidiary+day pickers for route/consolidated modes"
```

---

## Self-Review Notes
- **Spec coverage:** helpers (§4.2) → T1; service wrappers (§4.1) → T2; page UI subsidiary+day+list (§4.3) → T3; single day (§2) → `toDayRange`; no backend (§2) → only reused endpoints; testing via Vitest + tsc, no `next dev` (§5) → each task.
- **Type consistency:** `PickerOption` defined in `picker-options.ts` (T1), re-exported by `tracking-sync.ts` (T2), consumed by page (T3); `toDayRange`/`buildRouteOption`/`buildConsolidatedOption` names stable across T1–T2.
- **Deferred/known:** list responses read defensively (array | `.data` | `.items`); `Subsidiary` type import verified in T3.
