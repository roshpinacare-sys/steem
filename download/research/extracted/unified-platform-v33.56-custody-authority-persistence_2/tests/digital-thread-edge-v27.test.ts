import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../src/contracts/crypto.js';
import { DigitalThread, type ThreadEdge, type ThreadNode } from '../src/platform/digital-thread.js';
const now='2026-07-17T10:00:00.000Z';
function node(id:string,tenant='tenant-1'):ThreadNode{return{nodeId:id,tenantId:tenant,kind:'MISSION',subject:'subject',payloadDigest:sha256(id),createdAt:now};}
function edge(id:string,from:string,to:string,tenant='tenant-1'):ThreadEdge{return{edgeId:id,tenantId:tenant,fromNodeId:from,toNodeId:to,relation:'SUPPORTS',createdAt:now};}

test('node validation, idempotency and conflict branches are closed',()=>{
  const thread=new DigitalThread();
  for(const bad of [{...node('x'),nodeId:''},{...node('x'),tenantId:''},{...node('x'),kind:'BAD' as ThreadNode['kind']},{...node('x'),payloadDigest:'bad'},{...node('x'),createdAt:'bad'}])assert.throws(()=>thread.addNode(bad));
  const digest=thread.addNode(node('n1'));assert.equal(thread.addNode(node('n1')),digest);assert.throws(()=>thread.addNode({...node('n1'),subject:'changed'}),/conflict/);
});

test('edge validation, endpoints, tenant isolation, self edges, idempotency and conflicts are closed',()=>{
  const thread=new DigitalThread();thread.addNode(node('a'));thread.addNode(node('b'));thread.addNode(node('foreign','tenant-2'));
  for(const bad of [{...edge('e','a','b'),edgeId:''},{...edge('e','a','b'),tenantId:''},{...edge('e','a','b'),relation:'BAD' as ThreadEdge['relation']},{...edge('e','a','b'),createdAt:'bad'}])assert.throws(()=>thread.addEdge(bad));
  assert.throws(()=>thread.addEdge(edge('missing','a','none')),/endpoint_missing/);assert.throws(()=>thread.addEdge(edge('cross','a','foreign')),/cross_tenant/);assert.throws(()=>thread.addEdge(edge('self','a','a')),/self_edge/);
  const digest=thread.addEdge(edge('valid','a','b'));assert.equal(thread.addEdge(edge('valid','a','b')),digest);assert.throws(()=>thread.addEdge({...edge('valid','a','b'),relation:'REQUIRES'}),/conflict/);
});

test('snapshots are tenant-bound, sorted and reject root, node, edge and integrity tampering',()=>{
  const thread=new DigitalThread();thread.addNode(node('b'));thread.addNode(node('a'));thread.addNode(node('z','tenant-2'));thread.addEdge(edge('e','a','b'));
  const snapshot=thread.snapshot('tenant-1');assert.deepEqual(snapshot.nodes.map(n=>n.nodeId),['a','b']);assert.equal(DigitalThread.fromSnapshot(snapshot,'tenant-1').verify('tenant-1').ok,true);
  assert.throws(()=>DigitalThread.fromSnapshot({...snapshot,root:sha256('bad')},'tenant-1'),/root_invalid/);
  const badNode={...snapshot,nodes:[{...snapshot.nodes[0]!,tenantId:'tenant-2'},...snapshot.nodes.slice(1)]};const nodeRoot={...badNode,root:sha256({nodes:badNode.nodes,edges:badNode.edges})};assert.throws(()=>DigitalThread.fromSnapshot(nodeRoot,'tenant-1'),/node_invalid/);
  const badEdge={...snapshot,edges:[{...snapshot.edges[0]!,tenantId:'tenant-2'}]};const edgeRoot={...badEdge,root:sha256({nodes:badEdge.nodes,edges:badEdge.edges})};assert.throws(()=>DigitalThread.fromSnapshot(edgeRoot,'tenant-1'),/edge_invalid/);

});

test('tamper API is test-only, detects changed nodes and rejects unknown nodes',()=>{
  const thread=new DigitalThread();thread.addNode(node('n'));
  delete process.env.NODE_ENV;assert.throws(()=>thread.unsafeTamperNodeForTest('n','changed'),/unsafe_test_api/);
  process.env.NODE_ENV='test';assert.throws(()=>thread.unsafeTamperNodeForTest('missing','changed'),/not_found/);thread.unsafeTamperNodeForTest('n','changed');assert.equal(thread.verify('tenant-1').ok,false);delete process.env.NODE_ENV;
});
