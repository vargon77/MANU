--- PLAN_IMPLEMENTACION_V2.md (原始)


+++ PLAN_IMPLEMENTACION_V2.md (修改后)
# Plan de Implementación — Motor Hexagonal de Ojos (V2 Mejorado)

## Análisis del Código Original

### Algoritmos Clave Identificados

1. **Subdivisión de Bézier (`he`)**: Algoritmo recursivo que encuentra raíces del polinomio derivado para distancia punto-curva
2. **Distancia Punto-Bézier (`wa`)**: Usa subdivisión adaptativa + muestreo en candidatos críticos
3. **Spiral Layout (`ja`, `ms`)**: Espiral con radio variable según función de easing cúbica
4. **Repulsión Solver**: 8 iteraciones máx, con peso basado en tamaño relativo y estado de borde
5. **Snap Controller**: Easing cúbico `Vn(t)` con búsqueda de celda más cercana en offset grid
6. **Inertia Model**: Decaimiento exponencial `exp(-dt/$a)` con $a=325ms

### Constantes de Tuning Críticas (documentadas por función)

```typescript
// Spiral layout
const SPIRAL_STEP_BASE = 0.005;        // se - paso base angular
const SPIRAL_GROWTH_MIN = 1.85;        // rn - crecimiento mínimo
const SPIRAL_GROWTH_MAX = 0.35;        // Js - crecimiento máximo en centro
const SPIRAL_EASING_POWER = 0.165;     // bn - poder de interpolación

// Camera / Zoom
const ZOOM_FOCUS_ALPHA = 0.85;         // Xe - alpha de foco
const ZOOM_PAN_DAMPING = 1.9;          // He - damping de paneo
const ZOOM_EDGE_BOOST = 2.15;          // ta - boost en bordes

// Repulsion solver
const REPULSION_ITERATIONS = 8;        // número fijo de iteraciones
const REPULSION_RADIUS_PADDING = 10;   // Ye - padding entre celdas
const REPULSION_WEIGHT_BASE = 0.5;     // Ka - peso base de repulsión

// Snap / Inertia
const INERTIA_DECAY_MS = 325;          // $a - tiempo de decaimiento
const SNAP_DURATION_MS = 600;          // be - duración del snap
const SNAP_THRESHOLD_PX = 0.5;         // tolerancia de snap

// Bezier distance
const BEZIER_COARSE_STEPS = 6;         // profundidad de subdivisión inicial
const BEZIER_REFINE_DEFAULT = 4;       // iteraciones de refinamiento local
```

---

## Arquitectura Propuesta (Híbrida WASM/JS)

### Capa 1: Núcleo Matemático (TypeScript puro)
- Coordenadas hexagonales odd-row offset
- Subdivisión de Bézier (réplica exacta de `he`)
- Distancia punto-curva (réplica de `wa` + `ns`)
- Spiral layout con parámetros configurables

### Capa 2: Física / Interacción (TypeScript)
- RepulsionSolver con 8 iteraciones y pesos documentados
- SnapController con easing cúbico `Vn(t)`
- InertiaModel con decaimiento exponencial configurable

### Capa 3: Render (Canvas2D + SpriteCache existente)
- RenderPipeline orquestando 3 capas (Grid, Satellite, Line)
- Offscreen canvas caching para celdas fuera de foco

### Capa 4: WASM Bridge (diferida, solo si profiling lo exige)
- Interface para cargar `animation_renderer.wasm`
- Métodos: `createInstance`, `destroyInstance`, `writeGeometry`, `getRequiredBufferSize`

---

## Estructura de Carpetas Nutrida

```
hex-eyes-engine/
├── public/
│   └── assets/
│       ├── shapes.json              # Catálogo propio (no el original)
│       ├── colorways.json           # Paletas propias
│       └── fonts/                   # Fuentes libres (no Milling Triplex)
├── src/
│   ├── main.ts                      # Bootstrap + loop rAF
│   ├── core/
│   │   ├── types.ts                 # Tipos compartidos (Vec2, OffsetCoord, etc.)
│   │   ├── EyeInstance.ts           # Entidad con estado visual
│   │   ├── AnimationClock.ts        # DeltaTime clamped (max 100ms)
│   │   └── Constants.ts             # [NUEVO] Constantes de tuning documentadas
│   ├── math/
│   │   ├── HexCoords.ts             # [CLASE] odd-row offset, flat-top
│   │   ├── BezierSubdivision.ts     # [UTIL] he() replicado exacto
│   │   ├── PointCurveDistance.ts    # [UTIL] wa() + ns() replicados
│   │   └── SpiralMath.ts            # [UTIL] ja(), ms(), Wa() replicados
│   ├── physics/
│   │   ├── RepulsionSolver.ts       # [UTIL] 8 iteraciones, pesos documentados
│   │   ├── SnapController.ts        # [CLASE] Vn(t) easing, búsqueda de celda
│   │   └── InertiaModel.ts          # [CLASE] exp(-dt/325),收敛 threshold
│   ├── grid/
│   │   ├── GridLayout.ts            # [CLASE] genera Sn[] (celdas visibles)
│   │   ├── CullingSpatial.ts        # [UTIL] calcula Qn (radio visible)
│   │   └── CellIndexer.ts           # [UTIL] ds() índice col,row → linear
│   ├── render/
│   │   ├── SpriteCache.ts           # ✅ Ya entregado
│   │   ├── RenderPipeline.ts        # [CLASE] orquestador de capas
│   │   └── layers/
│   │       ├── GridLayer.ts         # Dibuja Sn[] con cache offscreen
│   │       ├── SatelliteLayer.ts    # Textos + iconos satélites
│   │       └── LineLayer.ts         # Líneas de tracking (pupil -> eye)
│   ├── interaction/
│   │   ├── PanController.ts         # pointer events → camera offset
│   │   ├── WheelHandler.ts          # wheel → pan + inertial queue
│   │   └── TouchGestures.ts         # pinch-zoom (si aplica)
│   ├── state/
│   │   ├── CameraState.ts           # offset, zoom, targetZoom
│   │   ├── UIState.ts               # hoveredCell, selectedCell, isPanelOpen
│   │   ├── URLSync.ts               # ?swatch=shape-colorway
│   │   └── FocusOverlay.ts          # blur/saturate radial gradient
│   ├── wasm/
│   │   ├── WasmBridge.ts            # [DIFERIDA] interface genérica
│   │   └── AnimationRenderer.ts     # [DIFERIDA] bindings específicos
│   └── data/
│       ├── shapes.ts                # Catálogo propio
│       ├── colorways.ts             # Paletas propias
│       └── rarity.ts                # Distribución de rareza propia
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## Contratos Técnicos Mejorados (con firmas reales)

### 0. Tipos Compartidos — `core/types.ts`

```typescript
export interface Vec2 { x: number; y: number; }
export interface OffsetCoord { col: number; row: number; }

export interface ColorwayDef {
  id: string;
  name: string;
  hex: string;
  rarityWeight: number; // 0..1
}

export interface CubicBezier {
  p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2;
  /** [OPT] Puntos pre-muestreados para acelerar distancia */
  samples?: Vec2[];
}

export type ShapeId = string;

export interface EyeVisualState {
  shapeId: ShapeId;
  colorway: ColorwayDef;
  animFrame: number;
  pupilAngleRad: number;
  pupilOffset01: number;
}

export interface CellPlacement extends OffsetCoord {
  center: Vec2;
  scale01: number;
  alpha01: number;
  edgePress01: number;  // [NUEVO] factor de presión de borde (para repulsión)
  nx: number; ny: number; // [NUEVO] normal hacia el centro (para repulsión)
}

export interface ClosestPointResult {
  point: Vec2;
  t: number;
  distance: number;
  curveIndex: number;  // [NUEVO] índice de curva en path compuesto
}
```

---

### 1. Math — Coordenadas Hexagonales

**`math/HexCoords.ts`** — **[CLASE]**
Referencia: Red Blob Games "odd-row offset, flat-top" + implementación original `ds()`, `Se()`.

```typescript
export interface HexCoordsConfig {
  hexSize: number;  // radio exterior en píxeles
}

export declare class HexCoords implements IHexCoords {
  constructor(config: HexCoordsConfig);

  /** [MÉTODO] [FUNCIÓN PURA] offsetToPixel: (col,row) → (x,y) en píxeles */
  offsetToPixel(coord: OffsetCoord): Vec2;

  /** [MÉTODO] [FUNCIÓN PURA] pixelToOffset: (x,y) → (col,row)
   * Complejidad O(1): evalúa ≤4 candidatos cercanos, no recorre el grid.
   * Réplica exacta de lógica en Se(): round(-bt/o), parity check, snap a celda.
   */
  pixelToOffset(point: Vec2): OffsetCoord;

  /** [MÉTODO] [FUNCIÓN PURA] Distancia en "pasos de celda" (no píxeles) */
  hexDistance(a: OffsetCoord, b: OffsetCoord): number;

  /** [MÉTODO] [FUNCIÓN PURA] Máximo 6 vecinos directos */
  neighbors(coord: OffsetCoord): OffsetCoord[];

  /** [NUEVO] [MÉTODO] Índice linear para array plano (réplica de ds()) */
  toIndex(coord: OffsetCoord, gridWidth: number): number;

  /** [NUEVO] [MÉTODO] Parity check: ¿fila impar? (usado en offset x) */
  isOddRow(row: number): boolean;
}
```

**Criterio de aceptación Fase 1:**
- Round-trip `offsetToPixel(pixelToOffset(p))`误差 < 0.5px
- `neighbors(c).length === 6` para celdas interiores
- `toIndex(col,row,width)` coincide con fórmula original `(row % G + G) % G * vt + (col % vt + vt) % vt`

---

### 2. Math — Bézier Subdivision (Réplica Exacta de `he()`)

**`math/BezierSubdivision.ts`** — **[UTILIDAD]**
Algoritmo: Subdivisión recursiva de De Casteljau para encontrar raíces del polinomio derivado.
Referencia: Implementación original `he(e,h,F,k,G)` líneas 174-200 de eyes_grid.min.js.

```typescript
/**
 * [FUNCIÓN PURA] Réplica exacta de he() del original.
 * Encuentra valores t críticos donde la derivada de distancia cambia de signo.
 * @param coeffs - 6 coeficientes del polinomio derivado (pre-calculados en wa())
 * @param tMin - límite inferior del intervalo
 * @param tMax - límite superior del intervalo
 * @param depth - profundidad actual (máx 6 en original)
 * @param out - array acumulador de valores t críticos
 */
declare function findCriticalTValues(
  coeffs: Float64Array,
  tMin: number,
  tMax: number,
  depth: number,
  out: number[]
): void;

/**
 * [FUNCIÓN PURA] Evaluación de Bézier cúbica en t (De Casteljau directo)
 * Invariante: t=0 → p0, t=1 → p3 (exacto salvo epsilon FP)
 */
declare function evaluateCubicBezier(curve: CubicBezier, t: number): Vec2;

/**
 * [FUNCIÓN PURA] Subdivisión real en dos mitades (retorna ambas curvas)
 * Usado en refinamiento local post-muestreo grueso
 */
declare function subdivideCubicBezier(curve: CubicBezier, t: number): [CubicBezier, CubicBezier];
```

**Criterio de aceptación:**
- `findCriticalTValues` con profundidad 6 produce ≤64 valores t (2^6)
- `evaluateCubicBezier(t=0)` retorna exactamente `p0` (error < 1e-10)
- Subdivisión en t=0.5 produce dos curvas que concatenadas equivalen a la original

---

### 3. Math — Distancia Punto-Curva (Réplica de `wa()` + `ns()`)

**`math/PointCurveDistance.ts`** — **[UTILIDAD]**
Método: Muestreo en críticos (vía `findCriticalTValues`) + evaluación directa + refinamiento local.
Referencia: `wa(e,h,F,k,G)` líneas 206-230, `ns(e,h,F)` líneas 232-245.

```typescript
export interface ClosestPointResult {
  point: Vec2;
  t: number;
  distance: number;
  curveIndex: number;
}

/**
 * [FUNCIÓN PURA] Réplica de wa(): distancia mínima punto a Bézier.
 * @param curve - 8 coeficientes [x0,y0,x1,y1,x2,y2,x3,y3]
 * @param px - coordenada x del punto
 * @param py - coordenada y del punto
 * @param result - objeto mutable para evitar allocs (patrón original)
 * @param curveIndex - índice para path compuesto
 */
declare function closestPointOnBezier(
  curve: Float64Array | CubicBezier,
  px: number,
  py: number,
  result: ClosestPointResult,
  curveIndex: number
): void;

/**
 * [FUNCIÓN PURA] Réplica de ns(): mínimo sobre N curvas (contorno completo)
 * @param curves - array de curvas (cada una 8 números o CubicBezier)
 * @param px, py - punto objetivo
 * @returns resultado con curveIndex válido
 */
declare function closestPointOnPath(
  curves: Array<Float64Array | CubicBezier>,
  px: number,
  py: number
): ClosestPointResult;
```

**Criterio cuantitativo:**
- Error <2% del radio real sobre círculo aproximado por 4 curvas Bézier
- Complejidad O(curves × 2^depth) con depth=6 → ~384 evaluaciones máx por frame por celda

---

### 4. Math — Spiral Layout (Réplica de `ja()`, `ms()`, `Wa()`)

**`math/SpiralMath.ts`** — **[UTILIDAD]**
Genera secuencia de radios para posicionamiento espiral con easing cúbico.

```typescript
export interface SpiralConfig {
  stepBase: number;      // se = 0.005
  growthMin: number;     // rn = 1.85
  growthMax: number;     // Js = 0.35
  easingPower: number;   // bn = 0.165
}

/**
 * [CLASE] Genera y cachea secuencia de radios espiral.
 * Réplica de ja(t,o): genera Bn[] hasta cubrir radio t con paso o.
 */
export declare class SpiralGenerator {
  constructor(config: SpiralConfig);

  /** [MÉTODO] Genera secuencia hasta maxRadius, retorna radio total cubierto */
  generate(maxRadius: number, stepHint: number): number;

  /** [MÉTODO] [FUNCIÓN PURA] Interpola radio en parámetro t (réplica de Wa()) */
  radiusAt(t: number): number;

  /** [MÉTODO] [FUNCIÓN PURA] Factor de crecimiento en s (réplica de ms()) */
  growthFactor(s: number): number;

  /** [GETTER] Secuencia cacheada Bn[] */
  readonly radii: number[];
}
```

**Criterio:**
- `generate(wo/Vt, Ye/c)` produce mismo length que original (~50000 máx)
- `radiusAt(t)` monótona creciente, continua por tramos lineales
- `growthFactor(0) === growthMax`, `growthFactor(1) === growthMin`

---

### 5. Physics — Repulsion Solver (8 iteraciones, pesos documentados)

**`physics/RepulsionSolver.ts`** — **[UTILIDAD]**
Réplica exacta del bucle de repulsión en Cs() líneas ~1330-1360.

```typescript
export interface RepulsionBody {
  x: number; y: number;   // posición (mutada in-place)
  radius: number;          // radio base
  scale: number;           // factor de escala (para peso)
  edgePress: number;       // 0..1, presión de borde (para peso)
  nx: number; ny: number;  // normal hacia centro (fallback si overlap central)
}

/**
 * [FUNCIÓN] Muta bodies in-place (evita allocs por frame).
 * Réplica exacta: 8 iteraciones máx, early-out si !moved.
 * Peso K = clamp(0.5 + 4*(r.s - e.s) + 2*(e.press - r.press), 0, 1)
 *
 * @param bodies - array mutable (se modifica directamente)
 * @param cellSize - tamaño base de celda (para calcular overlap threshold)
 * @param padding - Ye = 10, padding extra entre celdas
 * @returns true si hubo movimiento en última iteración
 */
declare function resolveOverlaps(
  bodies: RepulsionBody[],
  cellSize: number,
  padding: number
): boolean;
```

**Criterio:**
- Post-resolución, overlap <2% de suma de radios para cualquier par
- Early-out en iteración <8 si ningún movimiento (optimización original)
- Peso K calculado exactamente como fórmula original

---

### 6. Physics — Snap Controller (Easing cúbico `Vn(t)`)

**`physics/SnapController.ts`** — **[CLASE]**
Réplica de `Se()` líneas 570-640 + `Ms()` tween manager.

```typescript
export interface SnapConfig {
  coords: IHexCoords;
  easingFn: (t: number) => number;  // Vn(t) por defecto
  durationMs: number;                // be = 600
  thresholdPx: number;               // 0.5
}

export interface ISnapController {
  /** [MÉTODO] Inicia snap desde posición actual a celda más cercana */
  beginSnap(currentX: number, currentY: number): void;

  /** [MÉTODO] Actualiza tween, retorna {x,y} o null si completado/inactivo */
  update(deltaTimeMs: number, nowMs: number): Vec2 | null;

  /** [GETTER] ¿Hay snap activo? */
  readonly isActive: boolean;

  /** [MÉTODO] Cancela snap pendiente (limpia zn timeout) */
  cancel(): void;
}

/**
 * [FUNCIÓN PURA] Easing cúbico original Vn(t)
 * t < 0.5 ? 4t³ : 1 - (-2t+2)³/2
 */
declare function cubicEaseInOut(t: number): number;
```

**Criterio:**
- Resultado nunca fuera del segmento `[snapStart, snapTarget]`
- Converge en exactly `durationMs` (600ms por defecto)
- `isActive === false` después de `durationMs` desde `beginSnap`

---

### 7. Physics — Inertia Model (Decaimiento exponencial)

**`physics/InertiaModel.ts`** — **[CLASE]**
Réplica de lógica en `pointermove` + `Ps` lines ~930-970.

```typescript
export interface InertiaConfig {
  decayMs: number;        // $a = 325
  threshold: number;      // Ka = 0.02, threshold de settled
  maxSampleAge: number;   // 80ms, descarta samples viejos
}

export interface IInertiaModel {
  /** [MÉTODO] Agrega sample de velocidad (dx/dt, dy/dt) */
  addSample(dx: number, dy: number, dt: number, timestamp: number): void;

  /** [MÉTODO] Step de decaimiento: v *= exp(-dt/decayMs), retorna desplazamiento */
  step(deltaTimeMs: number): Vec2;

  /** [GETTER] ¿Velocidad < threshold? */
  readonly isSettled: boolean;

  /** [MÉTODO] Reset inmediato (usada al iniciar nuevo drag) */
  reset(): void;
}
```

**Criterio:**
- Decaimiento monótono, sin cambio de signo por error numérico
- `isSettled === true` cuando `hypot(vx,vy) < threshold`
- Samples >80ms antiguos son descartados (evita inercia "fantasma")

---

### 8. Grid — Layout Generator (Réplica de bucle principal en `Cs()`)

**`grid/GridLayout.ts`** — **[CLASE]**
Genera array `Sn[]` de celdas visibles con todos los campos calculados.

```typescript
export interface GridLayoutConfig {
  viewportWidth: number;
  viewportHeight: number;
  hexSize: number;
  spiral: SpiralGenerator;
  lensStrength: number;    // Xe = 0.85
  edgeBoost: number;       // ta = 2.15
}

export interface GridCell extends OffsetCoord {
  pi: number;              // índice linear (ds())
  x: number; y: number;    // posición final en pantalla
  s: number;               // scale01
  alpha: number;           // alpha01 (por culling/edge)
  edge: boolean;           // ¿está en borde de viewport?
  press: number;           // edgePress01
  nx: number; ny: number;  // normal hacia centro
  boostT: number;          // factor de boost por lente
  g: number;               // parámetro espiral (0..1)
}

export declare class GridLayout {
  constructor(config: GridLayoutConfig);

  /**
   * [MÉTODO] Genera Sn[] para camera offset/zoom dados.
   * Réplica de bucle en Cs() líneas ~1200-1330.
   */
  computeCells(
    cameraX: number,
    cameraY: number,
    zoom: number
  ): GridCell[];

  /** [MÉTODO] Aplica repulsión in-place sobre cells generados */
  applyRepulsion(cells: GridCell[], iterations?: number): void;

  /** [GETTER] Última celda central (qo,Ko) */
  readonly centerCell: OffsetCoord | null;
}
```

**Criterio:**
- `computeCells` produce mismo count que original para viewport dado
- Celdas ordenadas por `s` ascendente (profundidad, línea ~1419)
- After repulsion, ningún par con overlap >2% radios

---

### 9. Render — Pipeline + Layers

**`render/RenderPipeline.ts`** — **[CLASE]**

```typescript
export interface FrameData {
  cells: GridCell[];
  eyeStates: Map<string, EyeVisualState>;  // key: "col,row"
  cursorScreenPos: Vec2 | null;
  hoveredCell: OffsetCoord | null;
  selectedCell: OffsetCoord | null;
  timeMs: number;
}

export interface IRenderPipeline {
  /** [MÉTODO] Un llamado por rAF, orquesta todas las capas */
  renderFrame(frameData: FrameData): void;

  /** [MÉTODO] Limpieza de caches (resize, dispose) */
  invalidateCache(): void;
}
```

**`render/layers/*.ts`** — **[CLASE]**

```typescript
export interface IRenderLayer {
  /** [MÉTODO] Dibuja en ctx 2D, asume transform ya aplicado */
  draw(ctx: CanvasRenderingContext2D, frameData: FrameData): void;
}

// GridLayer: dibuja celdas Sn[] con sprite caching
// SatelliteLayer: textos + iconos satélites (ze(), K())
// LineLayer: líneas de tracking (pupil -> eye, ro())
```

**Criterio de fase 4:**
- Frame budget: <10ms render puro con 500 celdas (medido con performance.now())
- Sin allocs por frame (reuso de Path2D, OffscreenCanvas)
- Heap estable en DevTools tras 60s de animación

---

## Fases Revisadas (con criterios medibles)

| Fase | Entregable | Criterio de Aceptación Cuantitativo |
|---|---|---|
| **0** | Este documento + Constants.ts | Todas las constantes documentadas con valor original + comentario de función |
| **1** | HexCoords.ts, BezierSubdivision.ts, PointCurveDistance.ts, SpiralMath.ts | Round-trip error <0.5px; `evaluateCubicBezier(0)===p0`; `growthFactor(0)=0.35` |
| **2** | RepulsionSolver.ts, SnapController.ts, InertiaModel.ts | Overlap <2%; snap converge en 600ms; decaimiento exponencial correcto |
| **3** | GridLayout.ts | Genera Sn[] con count dentro de ±5% vs original para mismo viewport |
| **4** | RenderPipeline + layers | <10ms/frame con 500 celdas; 0 allocs por frame (verificado con profiler) |
| **5** | Orquestación completa (main.ts, state/*) | 60fps sostenidos 60s; heap estable ±2MB; sin memory leak |
| **6** (diferida) | WASM Bridge | Solo si profiling muestra CPU-bound >8ms en JS puro |

---

## Reglas de Implementación

1. **Nombres descriptivos, no ofuscados**: En lugar de `he`, `wa`, `ns` → `findCriticalTValues`, `closestPointOnBezier`, `closestPointOnPath`
2. **Comentarios de trazabilidad**: Cada función incluye comentario `// Réplica de [funcOriginal] líneas X-Y en eyes_grid.min.js`
3. **Tests unitarios obligatorios**: Cada contrato tiene test que verifica invariantes matemáticos (no solo "corre sin error")
4. **Zero allocs por frame**: Todos los arrays temporales son reutilizables (patrón `result` mutable, `Float64Array` cacheadas)
5. **Constants.ts único punto de verdad**: Si hay que ajustar tuning, se cambia solo ahí, no disperso en código

---

## Próximo Paso Inmediato

**Fase 0**: Crear estructura de carpetas + `core/Constants.ts` con todas las constantes documentadas + `core/types.ts` con tipos mejorados.

¿Procedo con Fase 0?
