import { useState } from 'react'
import { round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import { getCotizacionDolar } from '@/services/monday'
import { useApp } from '@/state/hooks'
import type { Producto } from '@/types'

/**
 * Convierte un producto en dólares a pesos con la tasa dada, PRESERVANDO el precio original en USD
 * (`precioUsd`) para la auditoría de la venta, y dejando la moneda en "Pesos".
 *
 * La conversión usa `precioBase` (el precio de lista en dólares SIN redondear): así el resultado en
 * pesos conserva el tercer decimal del dólar (55,803 × 1510 = 84.262,53, no 84.258,00 que daría al
 * convertir el dólar ya redondeado a 55,80). Sólo el importe final en pesos se redondea a 2 dec.
 */
const aPesos = (producto: Producto, tasa: number): Producto => {
  const usd = producto.precioBase ?? producto.precio
  return {
    ...producto,
    precioUsd: producto.precio,
    precio: round2(usd * tasa),
    precioBase: undefined,
    moneda: 'Pesos',
  }
}

/**
 * Selección de producto con conversión bimonetaria. Si el producto está en dólares (columna
 * `color_mm4kwdj6` = "Dolares"), se guarda su precio original en USD y se convierte a pesos con la
 * TASA DE CAMBIO GLOBAL leída al iniciar la app, de modo que el input de "Precio" ya muestra la
 * moneda local. Sólo si la tasa global aún no llegó se cae a la cotización del board (fallback).
 */
export function useCotizacionProducto() {
  const { tasaCambio, operacion } = useApp()
  const [seleccionado, setSeleccionado] = useState<Producto | null>(null)
  const [convirtiendo, setConvirtiendo] = useState(false)

  const elegir = async (producto: Producto | null) => {
    // Pesos (o sin producto): flujo normal, sin conversión.
    if (!producto || !esDolar(producto.moneda)) {
      setSeleccionado(producto)
      return
    }
    /* PRESUPUESTAR es BIMONETARIO: un producto en dólares se presupuesta en su moneda original,
       sin convertir a pesos. La conversión sólo corre en la VENTA, que es mono-moneda (ARS). */
    if (operacion === 'PRESUPUESTAR') {
      setSeleccionado(producto)
      return
    }
    // Dólares con la tasa global ya disponible: conversión inmediata, en memoria.
    if (tasaCambio && tasaCambio > 0) {
      setSeleccionado(aPesos(producto, tasaCambio))
      return
    }
    // Fallback: la tasa global no llegó todavía → se pide la cotización del board.
    setConvirtiendo(true)
    setSeleccionado(producto)
    try {
      const cotizacion = await getCotizacionDolar()
      setSeleccionado((prev) =>
        prev && prev.id === producto.id ? aPesos(producto, cotizacion) : prev,
      )
    } catch {
      /* Si falla la cotización, queda el precio base para no bloquear la carga. */
    } finally {
      setConvirtiendo(false)
    }
  }

  return { seleccionado, setSeleccionado, elegir, convirtiendo }
}
