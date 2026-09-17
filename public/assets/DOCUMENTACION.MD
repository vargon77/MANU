# Mapa de ejecución real — `HexEyesApp`

Metodología: solo se registra aquí lo que verifiqué siguiendo llamadas reales (grep de invocaciones, lectura de cada función referenciada, y en dos casos `tsc --noEmit` / `vite build` / servidor `vite` real corriendo). Donde no pude verificar con evidencia de ejecución, uso ⚪. No se propone ninguna corrección en este documento.

**Corrección sobre mí mismo, antes de empezar:** hace dos turnos afirmé que el juego no compilaría por un import roto (`COLORWAYS` en `DataGenerator.ts`). Verifiqué de nuevo ahora: **ya está corregido** en el estado actual (`colorways.ts:13` exporta `COLORWAYS`). Y until ahora asumí que "importado" ≈ "conectado" para `HexCoords`; trazando la llamada real encontré que eso también era impreciso (ver más abajo). Quedan documentados los dos errores.

---

## Hallazgo que precede al mapa: `src/render/layers/types.ts` está corrupto

El archivo contiene **dos copias completas de sí mismo pegadas**, separadas por una línea literal `+++ eye-ingeniere/src/render/layers/types.ts (修改后)` (línea 39) — parece un diff mal aplicado, pegado como si fuera contenido final.

- `tsc --noEmit` falla ahí: `error TS1109: Expression expected`.
- **Pero `vite build` real (con dependencias instaladas) compila sin error** — verificado ejecutando ambos comandos. `esbuild` (lo que usa Vite) es más permisivo que `tsc` y no rompe.
- Levanté el servidor `vite` real y confirmé que `/src/data/DataGenerator.ts` se sirve transformado sin fallo.

Conclusión: es un defecto real (dos definiciones de los mismos tipos/interfaces en un solo archivo), pero **no bloquea lo que ves en `localhost:3000`** — no es la causa del desacuerdo "4000px calculado vs. diminuto observado" de los turnos anteriores. Ese desacuerdo sigue sin explicación confirmada — lo marco ⚪ abajo, no lo doy por resuelto.

---

## FLUJO DE ARRANQUE

| Paso | Línea | Etiqueta | Evidencia |
|---|---|---|---|
| `window.addEventListener('load', ...)` → `new HexEyesApp()` | `main.ts:301-303` | 🟢 | Único punto de entrada; `index.html:102` carga `main.ts` como módulo. |
| `setupCanvas(gridCanvas)` | `main.ts:55, 92-103` | 🟢 | Se ejecuta en el constructor, antes que nada más. Solo configura `grid-canvas`. |
| `lineCanvas`, `satCanvas` (elementos DOM) | `main.ts:48-49` | 🟡 | Se obtienen y se valida que existan (`main.ts:51`), pero **nunca se les llama `setupCanvas`** — nunca se les asigna `width`/`height`/`ctx.scale(dpr)`. Existen en el DOM, no se usan como superficies de dibujo propias (ver "Renderizado"). |
| `initializeData()` | `main.ts:81, 105-129` | 🟢 | Se ejecuta en el constructor. |
| `setupEventListeners()` | `main.ts:82, 131-178` | 🟢 | Se ejecuta en el constructor. |
| `startAnimationLoop()` | `main.ts:83, 214-227` | 🟢 | Arranca el loop de `requestAnimationFrame`. |
| `dispose()` | `main.ts:290-296` | 🟡 | Conectada a `beforeunload` (`main.ts:305-308`), se ejecutaría al cerrar/recargar, pero no aporta al resultado visible mientras la app corre. Dentro de ella: `panController.reset()` sí hace algo (🟢 dentro de este alcance); `camera.reset()` **no se llama** — el estado de cámara no se limpia. |

---

## GENERACIÓN DE DATOS

| Función | Etiqueta | Evidencia |
|---|---|---|
| `generateEyeData(91, 42)` | 🟢 | Llamada real en `main.ts:106`. |
| `generateEyeData()` (cuerpo) | 🟢 | `DataGenerator.ts:200-202` — es un wrapper de una línea que delega a `generateSingleEyeData`. No es lógica duplicada, es un alias directo. |
| `generateSingleEyeData()` | 🟢 | Ejecuta la generación real: `generateSpiralCoords`, `offsetToPixel`, `selectColorway`, `calculateCellContour`, todo dentro de esta función. |
| `calculateCellContour()` | 🟢 (ejecuta) / ⚠️ contenido cuestionable ya reportado | Se ejecuta por cada una de las 91 celdas (`DataGenerator.ts` dentro del loop de `generateSingleEyeData`). Ya se documentó en el turno anterior: devuelve el contorno completo sin fraccionar, pese a que el docblock del archivo (línea 7-13) dice lo contrario. Sigo sin encontrar ninguna ruta donde se fraccione. |
| `selectColorway()` | 🟢 | Se ejecuta por celda; usa `COLORWAYS` — confirmado que existe (corrección al inicio de este documento). |
| `AVAILABLE_SHAPES`, `getShape()` (`shapes.ts`) | 🟢 | Se invoca dentro de `generateSingleEyeData` para elegir `baseShapeId`. |
| `fakeDataGenerator.ts` (todo el archivo) | 🔴 | `main.ts` no lo importa. Ningún archivo en la ruta de ejecución real lo importa (`grep` ya hecho en un turno anterior: solo se referencia a sí mismo). |

---

## ESTADO / TRANSFORMACIONES

| Elemento | Etiqueta | Evidencia |
|---|---|---|
| `CameraState.offset` (get/set) | 🟢 | Leído/escrito constantemente en `render()`, `wheel`, `update()`. |
| `CameraState.zoom` (get/set) | 🟢 | Leído en `render()`; el setter clampa a `[0.1, 3.0]` (`CameraState.ts:50`) — esto sí se ejecuta cada vez que algo asigna `.zoom`. |
| `CameraState.targetZoom` (get/set) | 🟢 | Escrito en `wheel` handler (`main.ts:167`), leído en `update()` (`main.ts:249-251`). |
| `CameraState.update(deltaTimeMs)` | 🔴 | Método existe (`CameraState.ts:69-76`) y hace exactamente el mismo lerp de zoom que `main.ts:249-252` reimplementa a mano. **Nunca se llama** — `main.ts` no invoca `camera.update()` en ningún punto de su propio `update()`. |
| `CameraState.zoomAtPoint(delta, point)` | 🔴 + 🟠 | Método existe (`CameraState.ts:84-97`), implementa zoom-hacia-el-cursor con compensación de offset — la misma lógica que `main.ts:165-172` reimplementa manualmente dentro del handler `wheel`. Nunca se llama. Es simultáneamente huérfano (no se ejecuta) y duplicado (existe otra implementación de lo mismo, la que sí corre). |
| `CameraState.reset()` | 🔴 | No se llama desde ningún punto de `main.ts` (ni siquiera en `dispose()`, que solo resetea `panController`). |
| `CameraState.toJSON()` / `fromJSON()` | 🔴 | No hay ningún punto de `main.ts` que serialice o restaure cámara. Coherente con que `URLSync.ts` tampoco se importa. |
| `UIState` (`ui.selectedCell`, `ui.hoveredCell`, todo el observer) | 🟡 | Se instancia (`main.ts:61`) y queda en `this.state.ui`, pero **ningún handler de `main.ts` lee ni escribe ninguna propiedad de `ui`** en ningún punto — ni `pointerdown`, ni `pointermove`, ni `pointerup`. Modificar `UIState` hoy no cambiaría nada observable. |
| `PanController.onPointerMove()` — valor de retorno | 🔴 | **Este es el hallazgo más importante de esta sección.** El método calcula y `return`ea un `newOffset` correcto (`PanController.ts:96-99, 113`). `main.ts:146` lo llama así: `this.state.panController.onPointerMove(point, camOffset);` — **sin asignar el resultado a ninguna variable**. El valor se calcula y se descarta. Arrastrar el canvas con el mouse presionado **no mueve la cámara mientras se arrastra** — solo el método `private handlePan()` (`main.ts:207-212`) podría aplicar ese delta, pero `handlePan` en sí mismo nunca se llama desde ningún lado. |
| `handlePan()` | 🔴 | Declarado, nunca invocado. |
| `PanController.getVelocity()` | 🟢 | Sí se lee en `pointerup` (`main.ts:153`) y alimenta `InertiaModel`. Esta es la única parte de `PanController` que efectivamente afecta el resultado visible — el arrastre en sí no mueve nada, pero soltar con velocidad sí. |
| `InertiaModel.step()` / `.isSettled` | 🟢 | Se ejecuta en `update()` cuando existe una instancia activa (`main.ts:230-240`). |
| `SnapController.update()` | 🟡 | Se llama cada frame (`main.ts:242-247`), pero el `if (this.state.snapController.isActive)` externo casi siempre es falso, y dentro del propio método, `snapStart`/`snapTarget` solo se fijan en `beginSnap()` — que **nunca se llama**. El método se ejecuta (early-return, `SnapController.ts:108-110`) pero nunca hace nada observable. |
| `SnapController.beginSnap()` | 🔴 | Declarado, nunca invocado desde `main.ts`. |
| `cubicEase` (pasado como `easingFn`) | 🟡 | Se pasa correctamente al constructor (`main.ts:69`), pero como `beginSnap()` nunca corre, esta función nunca llega a ejecutarse. |
| `HexCoords` (instancia) | 🟡 | Se construye y se pasa a `SnapController` (`main.ts:68`). |
| `HexCoords.pixelToOffset()` / `.offsetToPixel()` | 🔴 | Solo se llaman dentro de `SnapController.beginSnap()` (`SnapController.ts:77-78`) — que nunca se invoca. Corrijo aquí algo que dije en un turno anterior: había descrito `HexCoords` como "conectado", lo cual es cierto solo a nivel de construcción de objeto; sus métodos reales nunca ejecutan. |

---

## RENDERIZADO

| Elemento | Etiqueta | Evidencia |
|---|---|---|
| `render()` | 🟢 | Se llama cada frame (`main.ts:220`). |
| `gridLayer.draw(ctx, frameData)` | 🟢 | Se ejecuta dentro del bloque `ctx.save()/translate/scale/restore()` (`main.ts:263-270`) — con transformación de cámara aplicada. |
| `GridLayer.drawShape()` internamente: `evaluateCubicBezier` (`BezierSubdivision.ts`) | 🟢 | Se llama por cada curva de cada celda (`GridLayer.ts:51, 100`). |
| `lineLayer.draw(ctx, frameData)` | 🟢 | Misma sección transformada. |
| `satLayer.draw(ctx, frameData)` | 🟢 (ejecuta) / ⚠️ desalineado | Se llama, pero **fuera** del bloque `ctx.save()/translate/scale/restore()` (`main.ts:272`, después de `ctx.restore()` en la línea 270). `SatelliteLayer.ts:27-28` usa `cell.center.x/y` directamente, en coordenadas de mundo, sin aplicar el offset/zoom de cámara. Mientras `camera.offset` no sea `{0,0}` y `camera.zoom` no sea `1`, los satélites se dibujan desalineados respecto a las celdas que orbitan. |
| `lineCanvas`, `satCanvas` (los `<canvas>` del DOM) | 🔴 | Ya señalado arriba: nunca reciben `setupCanvas`. Todo el dibujo real (grid, líneas, satélites) ocurre sobre el `ctx` de `grid-canvas` (`main.ts:59`, un solo contexto reutilizado para las tres capas). Los otros dos elementos `<canvas>` están en el DOM, apilados por z-index (`index.html:50-58`), pero vacíos — nunca se obtiene su contexto ni se dibuja en ellos. |
| `RenderPipeline.ts`, `SpriteCache.ts` | 🔴 | No importados por `main.ts` ni por ningún archivo en la ruta de ejecución. |
| Tamaño real del ojo en pantalla | ⚪ | Cálculo (`100 × 80 × 0.5 = 4000px` de radio para la celda central) vs. reporte de usuario ("diminuto") siguen sin conciliarse. Ya descarté una hipótesis (que el proyecto no compilara) — sigue sin evidencia de navegador real. No lo clasifico sin ese dato. |

---

## INTERACCIÓN / MOUSE

| Elemento | Etiqueta | Evidencia |
|---|---|---|
| `pointerdown` → `panController.onPointerDown()` | 🟢 | Se ejecuta, guarda estado interno de `PanController`. |
| `pointermove` → `panController.onPointerMove()` (valor descartado) | 🔴 | Ver arriba — se ejecuta pero su resultado no se usa. |
| `pointermove` → `updatePupilTracking(point)` | 🟢 | Sí se ejecuta y sí afecta el resultado visible. |
| `PupilTracker.update()` / `.getCurrentPosition()` (uno por celda, 91 instancias) | 🟢 | Se llama por cada celda en cada `pointermove` (`main.ts:193-201`). Usa `closestPointOnCurveWarmStart` (`PointCurveDistance.ts`) y `evaluateCubicBezier` (`BezierSubdivision.ts`) — ambos 🟢. |
| `pointerup` → `panController.onPointerUp()`, `getVelocity()`, `new InertiaModel()` | 🟢 | Cadena completa se ejecuta y sí afecta el resultado (vía `update()`). |
| `wheel` → zoom manual inline | 🟢 (ejecuta) / 🟠 (duplica `CameraState.zoomAtPoint`) | Ya descrito arriba. |
| `resize` → `setupCanvas(canvas)` | 🟢 | Solo reconfigura `grid-canvas` (mismo problema que en arranque: `lineCanvas`/`satCanvas` nunca se tocan). |

---

## RESULTADO VISIBLE — lista de todo lo que realmente contribuye

Solo esto llega a pantalla, según todo lo trazado arriba: `generateSingleEyeData` (vía el alias `generateEyeData`) → `GridLayer.draw` + `LineLayer.draw` (con transformación de cámara) → `SatelliteLayer.draw` (sin transformación de cámara, posiblemente desalineado) → `PupilTracker` × 91 actualizado por `pointermove`. La cámara se mueve por: inercia tras soltar el mouse, zoom por rueda (reimplementado a mano), y el lerp de zoom en `update()` (reimplementado a mano). **No** se mueve por arrastre directo del mouse (el delta se calcula y se descarta).

---

## Resumen por etiqueta

- 🟢 **Funciona:** arranque completo, generación de datos (vía el alias), `GridLayer`, `LineLayer`, tracking de pupila (×91), inercia, zoom por rueda (reimplementado), lerp de zoom (reimplementado), `getVelocity`.
- 🟡 **Conectado sin aporte:** `UIState` completo, `lineCanvas`/`satCanvas` como elementos DOM, `SnapController.update()` (ejecuta pero no hace nada), `HexCoords` (instancia), `cubicEase`, `dispose()`.
- 🟠 **Duplicado:** zoom-hacia-cursor (`CameraState.zoomAtPoint` vs. handler `wheel` inline), lerp de zoom (`CameraState.update` vs. `main.ts` `update()` inline).
- 🔴 **Huérfano:** `handlePan()`, valor de retorno de `panController.onPointerMove()`, `CameraState.update/zoomAtPoint/reset/toJSON/fromJSON`, `SnapController.beginSnap()`, `HexCoords.pixelToOffset/offsetToPixel`, `fakeDataGenerator.ts`, `RenderPipeline.ts`, `SpriteCache.ts`, y (ya sabido de auditorías previas) `LensDistortion.ts`, `CullingSpatial.ts`, `GridLayout.ts`, `SpiralLayout.ts` (clase), `CellIndexer.ts`.
- ⚪ **Desconocido:** tamaño real del ojo en el navegador (mi cálculo dice 4000px de radio, el usuario reporta "diminuto" — sin captura o `console.log` real no lo resuelvo); si el desalineamiento de `SatelliteLayer` es visible o imperceptible en la práctica (depende de qué tan lejos esté `camera.offset` de `{0,0}` en el momento en que se observa).
