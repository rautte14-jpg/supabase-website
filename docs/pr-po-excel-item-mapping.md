# PR/PO Excel item mapping integration

This mapping is **independent of** the two daily Simplix syncs.

## Where to upload
PR & PO Tracker → **Excel PO-to-item mapping** → Upload PR / PO Excel.

The importer reads **Purchase Requisitions**, with the actual column labels from row 2. The first item record is row 3. It preserves the original Excel row number and all nonblank Item IDs, including rows where PO numbers are missing. Rows are stored in `erp_po_excel_rows` using a unique `(batch_id,source_row)` key, avoiding accidental collapse of repeated PR/PO/item combinations.

A new import is staged under a fresh UUID in `erp_po_excel_batches`. Only after all rows have been written does `complete_po_excel_batch(uuid)` check the expected row count and atomically mark the batch complete. PR details always read **the most recently completed** batch, never a partial stage.

## Provenance and interpretation
- **Simplix:** PR descriptions, workflow/status, requested items/quantities/prices, PO status, goods-receipt references and dates.
- **Excel:** PR–PO–item association, tracker `Quantity`, `Received Date` (column Y), `Received Qty` (column Z), `Balance Qty` (column AA), supplier and delivery status. The uploaded tracker is the accepted authority for item-level received quantities and Received All / partial / cancelled positions. Excel received dates are shown as Excel dates, alongside separate Simplix PO receipt dates/references.
- **Do not** treat Excel `Quantity` as verified PO ordered quantity without a confirmed ERP quantity definition.
- **Do not** assign a PO-level Simplix receipt date to each item or infer received quantity from a Simplix receipt event. **Received All** in Excel confirms the full tracked quantity was received unless the numeric Received Qty or Balance Qty contradicts it; discrepancies trigger review.
- **Do not** sum repeated PR/PO/item rows automatically. They are shown separately and flagged in the PR overlay. Original workbook row numbers support investigation.
- **Do not** sum `PO Value` down Excel item rows. It may repeat and may be a PO-level total.
- **Do not** merge new Excel rows into `erp_pr_line_items`; the PR line table remains Simplix-managed.
- If the Excel PO/item mapping contradicts Simplix PR/PO records, show review flags rather than forcing a match.

## Implementation
- `src/PrPoExcelUpload.jsx`: upload and staged import, per-row provenance, status/progress.
- `src/PrDetailOverlayComplete.jsx`: Excel PO-to-Item Mapping section **inside** each clicked PR detail, crosschecking item codes and PO numbers against synced Simplix.
- `public.erp_po_excel_batches`: import registry, completed batch selection.
- `public.erp_po_excel_rows`: source-preserved row-level mapping.
- `public.complete_po_excel_batch(uuid)`: authenticated, security-invoker count check and activation.
- Read and write permissions require signed-in users. Import belongs to uploader UID; completed batches are readable by other signed-in staff.
- The 2026 Simplix sync commands are unaffected.

## Deployment
Merge frontend changes, deploy the current GitHub main to Cloudflare, sign in and upload the workbook from the PR & PO Tracker. Existing Excel data uploaded **to this chat** is not automatically present on the live website; it needs uploading through the control once deployed.

The importer does not automatically add rows from a chat attachment, a GitHub commit, or the older `procurement_records` table.

## Receipt status upgrade (9 Nov 2026)

For an item row with Excel delivery status **Received All**, treat the item as **Fully Received** and balance 0, using the Excel tracked quantity if Received Qty is blank. Where Received Qty equals tracked quantity and Balance Qty is zero, also classify as Fully Received. Where quantities conflict with Received All, show a review warning rather than silently replacing values. Part-received and cancelled lines remain distinct. Procurement Snapshot reports item-row counts, including cancelled exclusions from active outstanding; it does not add quantities across different units.

After the revised site is deployed, **upload the Excel workbook again** using the existing uploader to populate the new `excel_received_date` column. Prior completed uploads remain valid, but their received dates are null until reimported. The existing Simplix receipt events and dates are unchanged.
