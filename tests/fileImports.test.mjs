import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadSourceFile, ATOMIC_FILE_SOURCES } from '../src/lib/fileImports.js'

function fakeClient({failedBatch = -1, finalizeError = false, lostResponse = false, cancelFails = false} = {}) {
  const state = {live:['old'], staged:[], history:0, batch:0, settled:0, finalized:false, cancelled:false, calls:[]}
  const client = {
    from(table) {
      assert.equal(table,'file_import_rows')
      return { async upsert(rows) {
        const batch = state.batch++
        await new Promise(resolve=>setTimeout(resolve,batch === 0 ? 10 : 1))
        state.settled++
        if (batch === failedBatch) return {error:{message:'Batch rejected'}}
        state.staged.push(...rows)
        return {error:null}
      }}
    },
    async rpc(name,args) {
      state.calls.push(name)
      if(name==='begin_file_import') return {data:{status:'staging'},error:null}
      if(name==='finalize_file_import') {
        assert.equal(state.settled,state.batch)
        if(finalizeError) return {error:{message:'Source changed while uploading'}}
        state.live=state.staged.sort((a,b)=>a.row_index-b.row_index).map(row=>row.payload)
        state.finalized=true;state.history++
        if(lostResponse) return {error:{message:'Network response lost'}}
        return {data:state.live.length,error:null}
      }
      if(name==='cancel_file_import') {
        assert.equal(state.settled,state.batch)
        if(cancelFails)return {error:{message:'Network unavailable'}}
        if(state.finalized)return {data:{status:'committed',row_count:state.live.length}}
        state.cancelled=true;state.staged=[]
        return {data:{status:'cancelled'}}
      }
      throw Error('Unexpected RPC '+name)
    },
  }
  return {client,state}
}
const input={source:'PR',records:[{pr_no:'PR1'},{pr_no:'PR2'},{pr_no:'PR3'}],importId:'test',batchSize:1,concurrency:3}
test('all remaining sources use the staged importer',()=>{
  assert.deepEqual([...ATOMIC_FILE_SOURCES],['PRF','PR','PO','MTR','MRN','PENDING_PAYMENTS','TRANSACTIONS'])
})
test('successful upload commits only after all batches complete',async()=>{
  const {client,state}=fakeClient()
  assert.equal(await uploadSourceFile(client,input),3)
  assert.deepEqual(state.live,input.records)
  assert.equal(state.history,1)
  assert.equal(state.cancelled,false)
})
test('a failed batch settles siblings and preserves live data',async()=>{
  const {client,state}=fakeClient({failedBatch:1})
  await assert.rejects(uploadSourceFile(client,input),/Existing live data was preserved/)
  assert.deepEqual(state.live,['old']);assert.equal(state.history,0);assert.equal(state.finalized,false);assert.equal(state.cancelled,true)
})
test('validation/concurrency failure preserves live data',async()=>{
  const {client,state}=fakeClient({finalizeError:true})
  await assert.rejects(uploadSourceFile(client,input),/Source changed.*Existing live data was preserved/)
  assert.deepEqual(state.live,['old']);assert.equal(state.history,0)
})
test('lost finalization response recovers committed state without a second replacement',async()=>{
  const {client,state}=fakeClient({lostResponse:true})
  assert.equal(await uploadSourceFile(client,input),3)
  assert.deepEqual(state.live,input.records);assert.equal(state.history,1)
  assert.equal(state.calls.filter(name=>name==='finalize_file_import').length,1)
})
test('unknown finalization outcome asks to check history instead of claiming preservation',async()=>{
  const {client}=fakeClient({lostResponse:true,cancelFails:true})
  await assert.rejects(uploadSourceFile(client,input),/Could not confirm whether the upload completed/)
})
test('empty and unsupported uploads never reach the server',async()=>{
  const {client,state}=fakeClient()
  await assert.rejects(uploadSourceFile(client,{...input,records:[]}),/usable rows/)
  await assert.rejects(uploadSourceFile(client,{...input,source:'AGEING'}),/supported source/)
  assert.deepEqual(state.calls,[])
})
