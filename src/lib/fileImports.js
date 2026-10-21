export const ATOMIC_FILE_SOURCES = new Set(['PRF', 'PR', 'PO', 'MTR', 'MRN', 'PENDING_PAYMENTS', 'TRANSACTIONS'])

// Staging is private to the uploader; only the final RPC can replace live data.
export async function uploadSourceFile(client, {
  source, records, originalRows = records?.length, fileName = '', sourceDate = null,
  importId = crypto.randomUUID(), batchSize = 400, concurrency = 3,
}, onProgress = () => {}) {
  if (!ATOMIC_FILE_SOURCES.has(source) || !Array.isArray(records) || !records.length || records.length > 500000 || !Number.isInteger(originalRows) || originalRows < records.length) {
    throw new Error('Choose a supported source file with usable rows before uploading.')
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid upload batch settings.')
  let finalizeRequested = false
  try {
    onProgress('Preparing upload…')
    const started = await client.rpc('begin_file_import', {
      p_import_id: importId, p_source: source, p_expected_rows: records.length,
      p_original_rows: originalRows, p_file_name: fileName, p_source_date: sourceDate,
    })
    if (started.error) throw started.error
    if (started.data?.status === 'committed') {
      if (Number(started.data.row_count) !== records.length) throw new Error('Upload confirmation count does not match the file.')
      return records.length
    }
    for (let start = 0; start < records.length; start += batchSize * concurrency) {
      const batches = []
      for (let offset = 0; offset < batchSize * concurrency && start + offset < records.length; offset += batchSize) {
        const index = start + offset
        const batch = records.slice(index, index + batchSize).map((payload, row) => ({ import_id: importId, row_index: index + row, payload }))
        batches.push(client.from('file_import_rows').upsert(batch, { onConflict: 'import_id,row_index' }))
      }
      // Wait for every in-flight batch before cancelling a failed upload.
      const results = await Promise.allSettled(batches)
      const failure = results.find(result => result.status === 'rejected' || result.value.error)
      if (failure) throw failure.status === 'rejected' ? failure.reason : failure.value.error
      onProgress('Uploading data… ' + Math.min(records.length, start + batchSize * concurrency).toLocaleString() + ' / ' + records.length.toLocaleString())
    }
    onProgress('Checking and applying update…')
    finalizeRequested = true
    const finished = await client.rpc('finalize_file_import', { p_import_id: importId })
    if (finished.error) throw finished.error
    if (Number(finished.data) !== records.length) throw new Error('Upload confirmation count does not match the file.')
    return records.length
  } catch (error) {
    // Cancellation locks the same manifest as finalization. A lost success response
    // is recovered as committed; it never deletes an already committed upload.
    let cancelled
    try { cancelled = await client.rpc('cancel_file_import', { p_import_id: importId }) } catch {}
    if (!cancelled?.error && cancelled?.data?.status === 'committed') {
      if (Number(cancelled.data.row_count) === records.length) return records.length
      throw new Error('The upload completed with an unexpected count. Refresh upload history before retrying.')
    }
    if (finalizeRequested && (cancelled?.error || !['cancelled', 'missing'].includes(cancelled?.data?.status))) {
      throw new Error('Could not confirm whether the upload completed. Refresh upload history before retrying.')
    }
    throw new Error((error?.message || 'Upload failed.') + ' Existing live data was preserved.')
  }
}
