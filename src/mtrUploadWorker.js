import * as XLSX from 'xlsx'
import { normalizeSheetRows, mapRows } from './importers.js'

self.onmessage = (event) => {
  try {
    const buffer = event.data?.buffer
    const workbook = XLSX.read(buffer, {
      type: 'array',
      cellDates: true,
      dense: true,
      cellStyles: false,
      cellFormula: false,
      cellHTML: false,
      bookDeps: false,
      bookFiles: false,
      bookProps: false,
      bookVBA: false,
    })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: true,
      blankrows: false,
    })
    const rows = normalizeSheetRows(matrix)
    const mapped = mapRows('MTR', rows)
    self.postMessage({ ok: true, sheetName, rowsFound: rows.length, mapped })
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || String(error) })
  }
}
