# Operaciones de venta · monday buy

App estilo **monday Vibe** para las operaciones **PRESUPUESTAR** y **CARGAR VENTA**, migrada
desde el prototipo `presupuestar-monday-buy.html` a React + TypeScript + Vite.

**Versión 1 (esta): sólo prototipado.** Los datos salen de `src/data/mock.ts`.
La versión 2 reemplaza ese módulo por la capa de servicio contra los boards de monday.

## Correr el proyecto

Requiere Node.js 18+ (hoy no está instalado en esta máquina).

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build
```

## Flujo

| Paso       | Vista           | Operación        |
| ---------- | --------------- | ---------------- |
| `inicio`   | `InicioView`    | ambas            |
| `cliente`  | `ClienteView`   | ambas            |
| `productos`| `ProductosView` | PRESUPUESTAR     |
| `emision`  | `EmisionView`   | PRESUPUESTAR     |
| `venta`    | `VentaView`     | CARGAR VENTA     |

`ClienteView` bifurca según el tipo de operación elegido en `inicio`.

## Shell de monday

`AppShell` reproduce el chrome real de monday.com y monta la app Vibe en el lugar del tablero
(`Personas`, dentro de la carpeta `Adm Clientes`):

- **Header global** (66px): marca, «Ver planes», buscador y acciones de cuenta.
- **Rail de iconos** (80px): Inicio · CRM (activo) · Sidekick · Agentes · Tools · Tomador · Favoritos.
- **Panel de workspace** (312px por defecto): selector `La Batea` y árbol de carpetas/tableros.
  Se arrastra desde el separador (220–560px, también con ← → cuando tiene foco) y se cierra con
  el botón `«`; al cerrarlo la app ocupa todo el ancho y reaparece un botón `»` para volver.

El logo de monday es una aproximación en CSS: no se incluye el asset original de la marca.

## Arquitectura

```
src/
  data/mock.ts        Datos de prototipo (único punto a sustituir por la API)
  types.ts            Modelo de dominio
  lib/                Reglas puras: totales, crédito, cobertura, fechas, formato
  state/              appState (reducer) · context · hooks · AppProvider
  hooks/              useClickOutside
  components/layout/  Shell de monday: header + rail de iconos + panel de workspace redimensionable
  components/ui/      UI reutilizable (Dropdown, Stepper, Donut…)
  features/           Una carpeta por paso del flujo
  styles/             CSS del prototipo, dividido en base / layout / components / views
```

Decisiones que sostienen el rendimiento y la claridad:

- **Nada derivado se guarda en el estado.** Totales, IVA, rentabilidad, crédito y fecha de
  vencimiento se calculan con funciones puras de `lib/selectors.ts` memoizadas con `useMemo`.
- **`state` y `dispatch` viajan en contextos distintos**, así los componentes que sólo despachan
  acciones no se re-renderizan cuando cambia el estado.
- **`AppProvider.tsx` exporta sólo el componente**, y los hooks viven en `hooks.ts`. React Fast
  Refresh exige que un módulo con componentes no exporte nada más: si se mezclan, cualquier cambio
  en el árbol de estado degrada el HMR a un reload completo y se pierde el estado de la app.
- **CSS plano con las clases del prototipo**: sin runtime de estilos, el look queda 1:1 con el HTML
  original y los tokens viven en `:root`.
- **Sin `alert()`**: los errores de búsqueda se muestran inline y los botones inválidos se
  deshabilitan en lugar de interrumpir al usuario.

## Pendiente para la v2 (capa de servicio)

- Reemplazar `src/data/mock.ts` por queries a monday (`monday.api` / SDK) manteniendo los tipos de
  `src/types.ts`.
- Persistir el presupuesto y la venta (hoy el estado vive sólo en memoria).
- Generación real del PDF y envío por Gmail/Outlook (hoy el visor es una maqueta y el log se
  construye en el cliente).
- Paginación real del listado de presupuestos (`PRESUPUESTOS_TOTAL` está fijo en 12).
