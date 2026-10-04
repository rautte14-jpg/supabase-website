import * as XLSX from 'xlsx'

self.onmessage = (event) => {
  try {
    const workbook = XLSX.read(event.data.buffer, {
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
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    self.postMessage({ ok: true, sheetName, csv })
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || String(error) })
  }
}
