import { createExtension } from "@blocknote/core"
import type { Node } from "prosemirror-model"
import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"

import { marcasEn, tramoLegible } from "@/lib/marcas-de-tiempo"

// Las marcas de tiempo del editor se resaltan como enlaces (con sus datos en el DOM, para abrirlas al tocarlas). Siguen
// siendo texto: se escriben, se copian y las redacta la IA como cualquier otro.
// `activas`: si hay algún video o audio al que llevar; sin eso las marcas quedan como texto. Empieza apagado y se cambia
// con una transacción con la meta `claveMarcas` (true o false).
type Estado = { activas: boolean; decoraciones: DecorationSet }
export const claveMarcas = new PluginKey<Estado>("marcas-de-tiempo")

function decorar(documento: Node, activas: boolean) {
  if (!activas) return DecorationSet.empty
  const decoraciones: Decoration[] = []
  documento.descendants((nodo, posicion) => {
    if (!nodo.isText || !nodo.text) return
    for (const marca of marcasEn(nodo.text)) {
      decoraciones.push(
        Decoration.inline(posicion + marca.inicio, posicion + marca.fin, {
          class: "marca-de-tiempo",
          title: `Ver ${marca.hasta === null ? "desde" : "el tramo"} ${tramoLegible(marca.desde, marca.hasta)}`,
          "data-desde": String(marca.desde),
          ...(marca.hasta !== null && { "data-hasta": String(marca.hasta) }),
          ...(marca.nombre && { "data-nombre": marca.nombre }),
        }),
      )
    }
  })
  return DecorationSet.create(documento, decoraciones)
}

export function marcasDeTiempo() {
  return createExtension({
    key: "marcasDeTiempo",
    prosemirrorPlugins: [
      new Plugin<Estado>({
        key: claveMarcas,
        state: {
          init: () => ({ activas: false, decoraciones: DecorationSet.empty }),
          apply: (tr, anterior, _, nuevo) => {
            const meta: unknown = tr.getMeta(claveMarcas)
            const activas = typeof meta === "boolean" ? meta : anterior.activas
            if (activas === anterior.activas && !tr.docChanged) return anterior
            return { activas, decoraciones: decorar(nuevo.doc, activas) }
          },
        },
        props: { decorations: (state) => claveMarcas.getState(state)?.decoraciones },
      }),
    ],
  })
}
