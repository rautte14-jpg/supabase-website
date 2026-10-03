import { useEffect } from 'react'

const clean = (v) => String(v ?? '').trim()

export default function MtrNavPlacement() {
  useEffect(() => {
    let disposed = false

    const move = () => {
      if (disposed) return
      const leaves = [...document.querySelectorAll('nav *')].filter((el) => el.children.length === 0)
      const mtrText = leaves.find((el) => clean(el.textContent) === 'MTR Tracker')
      if (!mtrText) return

      const mtrItem = mtrText.closest('a,button,li,div')
      if (!mtrItem) return

      const procurementLabel = leaves.find((el) => clean(el.textContent) === 'Procurement')
      const materialsLabel = leaves.find((el) => clean(el.textContent) === 'Materials')
      if (!procurementLabel || !materialsLabel) return

      const procurementContainer = procurementLabel.parentElement
      const materialsContainer = materialsLabel.parentElement
      if (!procurementContainer || !materialsContainer) return

      // Find the procurement group content area by walking to the shared sidebar structure.
      const procurementGroup = procurementLabel.closest('section,div')
      const materialsGroup = materialsLabel.closest('section,div')
      if (!procurementGroup || !materialsGroup || procurementGroup === materialsGroup) return

      // Insert MTR as the final item in Procurement, immediately before Materials group.
      const parent = materialsGroup.parentElement
      if (!parent) return
      if (mtrItem.parentElement !== procurementGroup) {
        procurementGroup.appendChild(mtrItem)
      }
    }

    move()
    const id = window.setInterval(move, 800)
    return () => { disposed = true; window.clearInterval(id) }
  }, [])

  return null
}
