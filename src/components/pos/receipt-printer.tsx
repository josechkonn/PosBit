"use client";

import { forwardRef } from "react";
import { fmt, fmtDateTime } from "@/lib/format";

interface ReceiptProps {
  ventaNumero: string;
  fecha: string;
  clienteNombre: string;
  cajeroNombre?: string;
  tipoPago: string;
  monedaCodigo: string;
  monedaSimbolo: string;
  items: Array<{
    producto_nombre: string;
    cantidad: number;
    precio_unit: number;
    subtotal: number;
  }>;
  subtotal: number;
  impuesto: number;
  descuento: number;
  total: number;
  empresaNombre?: string;
  empresaRif?: string;
  empresaDireccion?: string;
}

export const ReceiptPrinter = forwardRef<HTMLDivElement, ReceiptProps>(
  (
    {
      ventaNumero,
      fecha,
      clienteNombre,
      cajeroNombre = "Administrador",
      tipoPago,
      monedaCodigo,
      monedaSimbolo,
      items,
      subtotal,
      impuesto,
      descuento,
      total,
      empresaNombre = "PosBit",
      empresaRif = "J-12345678-9",
      empresaDireccion = "Centro, Ciudad",
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className="hidden print:block text-black bg-white"
        style={{
          width: "80mm", // Standard thermal printer width
          margin: "0 auto",
          padding: "0",
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: "12px",
          lineHeight: "1.2",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "10px" }}>
          <h2 style={{ margin: "0 0 5px 0", fontSize: "16px", fontWeight: "bold" }}>{empresaNombre}</h2>
          <div style={{ fontSize: "11px" }}>RIF: {empresaRif}</div>
          <div style={{ fontSize: "11px", marginBottom: "5px" }}>{empresaDireccion}</div>
          <div style={{ borderBottom: "1px dashed #000", margin: "5px 0" }}></div>
          <div style={{ fontSize: "14px", fontWeight: "bold" }}>NOTA DE ENTREGA</div>
          <div style={{ borderBottom: "1px dashed #000", margin: "5px 0" }}></div>
        </div>

        {/* Info */}
        <div style={{ marginBottom: "10px", fontSize: "11px" }}>
          <div><strong>Factura:</strong> {ventaNumero}</div>
          <div><strong>Fecha:</strong> {fmtDateTime(fecha)}</div>
          <div><strong>Cliente:</strong> {clienteNombre || "Consumidor Final"}</div>
          <div><strong>Cajero:</strong> {cajeroNombre}</div>
          <div><strong>Condición:</strong> {tipoPago}</div>
        </div>

        <div style={{ borderBottom: "1px dashed #000", margin: "5px 0" }}></div>

        {/* Items Header */}
        <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: "50%", paddingBottom: "3px" }}>DESCRIPCIÓN</th>
              <th style={{ textAlign: "center", width: "15%", paddingBottom: "3px" }}>CANT</th>
              <th style={{ textAlign: "right", width: "35%", paddingBottom: "3px" }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index}>
                <td style={{ paddingBottom: "3px", verticalAlign: "top" }}>
                  {item.producto_nombre}
                  <div style={{ fontSize: "9px" }}>{monedaSimbolo}{fmt(item.precio_unit, monedaCodigo)} c/u</div>
                </td>
                <td style={{ textAlign: "center", paddingBottom: "3px", verticalAlign: "top" }}>{item.cantidad}</td>
                <td style={{ textAlign: "right", paddingBottom: "3px", verticalAlign: "top" }}>
                  {monedaSimbolo}{fmt(item.subtotal, monedaCodigo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ borderBottom: "1px dashed #000", margin: "5px 0" }}></div>

        {/* Totals */}
        <div style={{ marginLeft: "auto", width: "100%", fontSize: "12px", marginTop: "5px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
            <span>Subtotal:</span>
            <span>{monedaSimbolo}{fmt(subtotal, monedaCodigo)}</span>
          </div>
          {descuento > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
              <span>Descuento:</span>
              <span>-{monedaSimbolo}{fmt(descuento, monedaCodigo)}</span>
            </div>
          )}
          {impuesto > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
              <span>Impuesto:</span>
              <span>{monedaSimbolo}{fmt(impuesto, monedaCodigo)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "14px", marginTop: "5px" }}>
            <span>TOTAL:</span>
            <span>{monedaSimbolo}{fmt(total, monedaCodigo)}</span>
          </div>
        </div>

        <div style={{ borderBottom: "1px dashed #000", margin: "10px 0" }}></div>

        {/* Footer */}
        <div style={{ textAlign: "center", fontSize: "11px", marginTop: "10px" }}>
          <div>¡Gracias por su compra!</div>
          <div>Sistema de Punto de Venta PRO</div>
        </div>

        {/* Page cut helper for printers */}
        <div style={{ height: "40px" }}></div>
      </div>
    );
  }
);
ReceiptPrinter.displayName = "ReceiptPrinter";
