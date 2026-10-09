import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { fmt } from "@/lib/format";

interface SeccionTabla {
  titulo: string;
  columnas: string[];
  filas: (string | number)[][];
}

interface MonedaReporte {
  moneda: { codigo: string; simbolo: string; es_base: boolean };
  [key: string]: any;
}

function money(v: number | string, codigo: string): string {
  return fmt(v, codigo);
}

function toSecciones(active: string, md: MonedaReporte): SeccionTabla[] {
  const codigo = md.moneda.codigo;
  const secciones: SeccionTabla[] = [];

  if (active === "ventas") {
    const r = md.resumen;
    if (r) {
      secciones.push({
        titulo: "Resumen de Ventas",
        columnas: ["Concepto", "Valor"],
        filas: [
          ["Total Ventas", money(r.total, codigo)],
          ["Subtotal", money(r.subtotal, codigo)],
          ["Impuestos (IVA 16%)", money(r.impuesto || 0, codigo)],
          ["N° Transacciones", r.count],
          ["Ticket Promedio", money(r.count > 0 ? r.total / r.count : 0, codigo)],
        ],
      });
    }
    if (md.ventasPorMetodo?.length) {
      secciones.push({
        titulo: "Ventas por Método de Pago",
        columnas: ["Método", "N° Ventas", "Total"],
        filas: md.ventasPorMetodo.map((m: any) => [m.nombre || "Sin método", m.count, money(m.total, codigo)]),
      });
    }
    if (md.ventasDiarias?.length) {
      secciones.push({
        titulo: "Ventas por Día",
        columnas: ["Fecha", "N° Ventas", "Total"],
        filas: md.ventasDiarias.map((d: any) => [d.fecha, d.count, money(d.total, codigo)]),
      });
    }
  } else if (active === "compras") {
    const r = md.resumen;
    if (r) {
      secciones.push({
        titulo: "Resumen de Compras",
        columnas: ["Concepto", "Valor"],
        filas: [
          ["Total Compras", money(r.total, codigo)],
          ["Subtotal", money(r.subtotal, codigo)],
          ["N° Órdenes", r.count],
          ["Promedio por Orden", money(r.count > 0 ? r.total / r.count : 0, codigo)],
        ],
      });
    }
    if (md.comprasPorProveedor?.length) {
      secciones.push({
        titulo: "Compras por Proveedor",
        columnas: ["Proveedor", "N° Órdenes", "Total"],
        filas: md.comprasPorProveedor.map((p: any) => [p.nombre, p.count, money(p.total, codigo)]),
      });
    }
    if (md.comprasMensuales?.length) {
      secciones.push({
        titulo: "Compras por Mes",
        columnas: ["Mes", "N° Órdenes", "Total"],
        filas: md.comprasMensuales.map((c: any) => [c.mes, c.count, money(c.total, codigo)]),
      });
    }
  } else if (active === "inventario") {
    const productos = md.productos || [];
    secciones.push({
      titulo: "Inventario de Productos",
      columnas: ["Código", "Producto", "Categoría", "Marca", "Existencias", "Costo", "Precio", "Moneda"],
      filas: productos.map((p: any) => [
        p.codigo,
        p.nombre,
        p.categoria_nombre || "",
        p.marca_nombre || "",
        p.stock,
        // costo_base está en la moneda de COMPRA del producto y precio_base en
        // la de VENTA; pueden ser distintas (moneda_costo_codigo vs moneda_codigo)
        money(p.costo_base, p.moneda_costo_codigo || p.moneda_codigo || codigo),
        money(p.precio_base, p.moneda_codigo || codigo),
        p.moneda_codigo || codigo,
      ]),
    });
    if (md.stockBajo?.length) {
      secciones.push({
        titulo: "Productos con Bajo Existencias",
        columnas: ["Código", "Producto", "Categoría", "Existencias", "Existencias Mínimas"],
        filas: md.stockBajo.map((p: any) => [p.codigo, p.nombre, p.categoria_nombre || "", p.stock, p.stock_minimo]),
      });
    }
    if (md.movimientosKardex?.length) {
      secciones.push({
        titulo: "Últimos Movimientos (30 días)",
        columnas: ["Fecha", "Producto", "Tipo", "Motivo", "Cantidad", "Saldo"],
        filas: md.movimientosKardex.map((k: any) => [
          String(k.fecha).slice(0, 10),
          k.producto_nombre,
          k.tipo,
          k.motivo || "",
          k.cantidad,
          k.saldo_actual,
        ]),
      });
    }
  } else if (active === "finanzas") {
    const r = md.rentabilidad;
    if (r) {
      secciones.push({
        titulo: "Resumen Financiero",
        columnas: ["Concepto", "Valor"],
        filas: [
          ["Ingresos por Ventas", money(r.ingresos, codigo)],
          ["Costo de Mercancía Vendida", money(r.costos, codigo)],
          ["Ganancia Bruta", money(r.gananciaBruta, codigo)],
          ["Cuentas por Cobrar", money(md.cuentasPorCobrar || 0, codigo)],
        ],
      });
    }
  } else if (active === "tops") {
    if (md.topProductos?.length) {
      secciones.push({
        titulo: "Los 10 productos más vendidos",
        columnas: ["#", "Producto", "Código", "Cantidad", "Ingresos"],
        filas: md.topProductos.map((p: any, i: number) => [i + 1, p.nombre, p.codigo, `${p.cantidad_vendida} uds.`, money(p.total_ingresos, codigo)]),
      });
    }
    if (md.topProductosRentables?.length) {
      secciones.push({
        titulo: "Los 10 productos más rentables",
        columnas: ["#", "Producto", "Ganancia"],
        filas: md.topProductosRentables.map((p: any, i: number) => [i + 1, p.nombre, money(p.ganancia, codigo)]),
      });
    }
    if (md.mejoresClientes?.length) {
      secciones.push({
        titulo: "Mejores Clientes",
        columnas: ["#", "Cliente", "Transacciones", "Total Comprado"],
        filas: md.mejoresClientes.map((c: any, i: number) => [i + 1, c.cliente_nombre, c.transacciones, money(c.total_comprado, codigo)]),
      });
    }
  }

  return secciones;
}

function tituloTab(active: string): string {
  const map: Record<string, string> = {
    ventas: "Reporte de Ventas",
    compras: "Reporte de Compras",
    inventario: "Reporte de Inventario",
    finanzas: "Reporte Financiero",
    tops: "Los 10 productos",
  };
  return map[active] || "Reporte";
}

export function exportarReportePDF(data: Record<string, MonedaReporte>, active: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const titulo = tituloTab(active);
  const fechaGenerado = new Date().toLocaleString("es-BO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let firstPage = true;
  let y = 0;

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  const header = () => {
    if (!firstPage) doc.addPage();
    firstPage = false;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(17, 24, 39);
    doc.text("PosBit", margin, 48);
    doc.setFontSize(13);
    doc.setTextColor(107, 114, 128);
    doc.text(`${titulo} - ${fechaGenerado}`, margin, 68);
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, 80, pageWidth - margin, 80);
    y = 96;
  };
  header();

  const codigos = Object.keys(data);
  codigos.forEach((codigo, idx) => {
    const md = data[codigo];
    const secciones = toSecciones(active, md);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`Moneda: ${md.moneda.codigo}${md.moneda.es_base ? " (Base)" : ""}`, margin, y + 4);
    y += 20;

    secciones.forEach((seccion) => {
      const needsPage = y > doc.internal.pageSize.getHeight() - 160;
      if (needsPage) {
        doc.addPage();
        y = 48;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(17, 24, 39);
      doc.text(seccion.titulo, margin, y + 6);

      autoTable(doc, {
        startY: y + 14,
        margin: { left: margin, right: margin },
        head: [seccion.columnas],
        body: seccion.filas,
        styles: { fontSize: 8.5, cellPadding: 5 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        theme: "grid",
      });
      y = (doc as any).lastAutoTable.finalY + 28;
    });

    if (idx < codigos.length - 1) {
      doc.addPage();
      firstPage = false;
      y = 48;
    }
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text(`Página ${i} de ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 20, { align: "center" });
  }

  doc.save(`reporte-${active}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function exportarReporteExcel(data: Record<string, MonedaReporte>, active: string) {
  const wb = XLSX.utils.book_new();
  const titulo = tituloTab(active);

  Object.keys(data).forEach((codigo) => {
    const md = data[codigo];
    const secciones = toSecciones(active, md);
    const prefijo = md.moneda.codigo;

    secciones.forEach((seccion) => {
      const name = `${prefijo} - ${seccion.titulo}`.slice(0, 31);
      const aoa: (string | number)[][] = [[`${titulo} - ${seccion.titulo}`]];
      aoa.push([`Moneda: ${md.moneda.codigo}`, `Generado: ${new Date().toLocaleString("es-BO")}`]);
      aoa.push([]);
      aoa.push(seccion.columnas);
      seccion.filas.forEach((fila) => aoa.push(fila));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = seccion.columnas.map(() => ({ wch: 24 }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
  });

  XLSX.writeFile(wb, `reporte-${active}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
