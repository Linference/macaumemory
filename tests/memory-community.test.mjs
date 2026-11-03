import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createMemoryStore } from '../server/memory-store.mjs';
const base = path.resolve('output'); fs.mkdirSync(base, { recursive: true });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(base, 'test-memory-'));
  const store = createMemoryStore(dir, { places: [{ id: 'place-1', spotId: 'spot-1', memoryId: 'MM-0001', name: '測試建築', coordinates: [113.54,22.19], gallery: [] }] }, { scenes: [] });
  const curator = store.session(), contributor = store.session();
  t.after(() => { store.close(); if (path.dirname(dir) !== base || !path.basename(dir).startsWith('test-memory-')) throw new Error('Unsafe fixture cleanup'); fs.rmSync(dir, { recursive:true }); });
  return { dir, store, curator, contributor };
}
const story = overrides => ({ placeId:'place-1', title:'街巷記憶', author:'作者', era:'年代不詳', text:'我對這棟建築的記憶。', status:'private', mediaIds:[], ...overrides });
test('stable place aliases and separate ordinary-building coordinates', t => {
  const {store,contributor} = fixture(t); assert.equal(store.place('MM-0001').id,'place-1'); assert.equal(store.place('spot-1').id,'place-1');
  const p = store.createPlace({ name:'普通建築',coordinates:null,summary:'' },contributor); assert.ok(p.memoryId.startsWith('TJ-')); assert.equal(p.coordinates,null);
  assert.throws(()=>store.createPlace({name:'錯誤位置',coordinates:[null,22.19]},contributor));
  assert.throws(()=>store.createPlace({name:'同位置',coordinates:[113.54,22.19]},contributor),/附近已有/);
});
test('first local session is curator and cookies preserve identity', t=>{
 const {store,curator,contributor}=fixture(t); assert.equal(curator.curator,true);assert.equal(contributor.curator,false);assert.equal(store.session(curator.token).id,curator.id);
});
test('publication requires consent and curator approval', t=>{
 const {store,curator,contributor}=fixture(t);assert.throws(()=>store.saveStory(story({status:'pending'}),contributor),/同意/);
 const s=store.saveStory(story({status:'pending',consent:true}),contributor);assert.throws(()=>store.review(s.id,{status:'approved',version:s.version},contributor),/管理員/);
 const approved=store.review(s.id,{status:'approved',version:s.version},curator);assert.equal(approved.status,'approved');
 const withdrawn=store.saveStory(story({version:approved.version}),contributor,s.id);assert.equal(withdrawn.status,'private');
});
test('editing ownership and stale version are enforced, revisions retained',t=>{
 const {store,curator,contributor}=fixture(t);const s=store.saveStory(story(),contributor);
 assert.throws(()=>store.saveStory(story({version:1}),curator,s.id),/自己/);
 store.saveStory(story({text:'修改後的故事',version:1}),contributor,s.id);
 assert.throws(()=>store.saveStory(story({version:1}),contributor,s.id),/重新載入/);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM revisions').get().n,1);
});
test('private stories and media cannot be attached by another identity',t=>{
 const {store,curator,contributor}=fixture(t);const s=store.saveStory(story(),contributor);
 assert.throws(()=>store.savePuzzle({placeId:'place-1',title:'侵入',cards:[{kind:'story',refId:s.id}]},curator),/不可讀取/);
 const m=store.put('media','m1',contributor.id,{url:'/api/memory/media/m1',mime:'image/png',bytes:100});
 assert.throws(()=>store.saveStory(story({mediaIds:[m.id]}),curator),/不屬於/);
});
test('puzzle order, interpretation and relationship confirmation persist',t=>{
 const {store,contributor}=fixture(t);const s=store.saveStory(story(),contributor);
 const p=store.savePuzzle({placeId:'place-1',title:'我的拼圖',interpretation:'自己的解讀',cards:[{kind:'note',note:'先觀察'},{kind:'story',refId:s.id,note:'親身經歷',confirmed:true}]},contributor);
 assert.equal(store.get('puzzle',p.id).cards[1].confirmed,true);assert.equal(p.cards[0].note,'先觀察');
});
test('historical references require source URL and local curator',t=>{
 const {store,curator,contributor}=fixture(t);const k={type:'event',title:'事件資料',text:'有來源的資料',sourceTitle:'機構',sourceUrl:'https://example.org/source',keywords:'街市,工作',placeIds:['place-1']};
 assert.throws(()=>store.saveKnowledge(k,contributor),/管理員/);assert.throws(()=>store.saveKnowledge({...k,sourceUrl:'javascript:alert(1)'},curator),/HTTP/);
 store.saveKnowledge(k,curator);const results=store.suggestions('我的街市工作記憶','place-1');assert.equal(results.length,1);assert.equal(results[0].relationStatus,'待使用者確認');
});
test('teacher classes require membership and only own puzzle submission',t=>{
 const {store,curator,contributor}=fixture(t);const room=store.createClass({title:'探究',question:'這裡有什麼記憶？',placeIds:['place-1']},curator);
 assert.throws(()=>store.submit({classId:room.id,name:'學生',stage:'before',text:'我的問題'},contributor),/加入/);
 store.joinClass(room.code,contributor);const submission=store.submit({classId:room.id,name:'學生',stage:'before',text:'我的問題'},contributor);assert.equal(submission.stage,'before');
 assert.throws(()=>store.submit({classId:room.id,name:'學生',stage:'during',text:'我的觀察',placeId:'other'},contributor),/路線/);
});
test('scene camera validation and version-safe story viewpoints',t=>{
 const {store,curator,contributor}=fixture(t);store.put('media','model1',contributor.id,{url:'/api/memory/media/model1',mime:'application/x-ply',bytes:500,sha256:'a'.repeat(64),splatCount:2});
 const pose={position:[0,0,3],target:[0,0,0],up:[0,1,0],fov:52};
 assert.throws(()=>store.saveScene({placeId:'place-1',modelId:'model1',title:'模型',versionLabel:'首次',camera:{...pose,position:[0,0,0]}},contributor),/方向/);
 assert.throws(()=>store.saveScene({placeId:'place-1',modelId:'model1',title:'模型',versionLabel:'首次',camera:{...pose,up:[0,0,1]}},contributor),/平行/);
 const scene=store.saveScene({placeId:'place-1',modelId:'model1',title:'模型',versionLabel:'首次',camera:pose},contributor);
 const updated=store.saveHotspot(scene.id,{title:'觀察',camera:pose,version:scene.version},contributor);assert.equal(updated.hotspots.length,1);assert.equal(updated.sha256,'a'.repeat(64));
 const other=store.session();assert.throws(()=>store.saveHotspot(scene.id,{title:'他人',camera:pose,version:updated.version},other),/自己/);
 assert.equal(curator.curator,true);
});
test('SQLite contents survive reopening',t=>{
 const {dir,store,contributor}=fixture(t);const s=store.saveStory(story(),contributor);
 const second=createMemoryStore(dir,{places:[]},{scenes:[]});try{assert.equal(second.get('story',s.id).text,s.text);assert.equal(second.session(contributor.token).id,contributor.id);}finally{second.close();}
});
test('submitted puzzle is frozen and feedback belongs to activity teacher',t=>{
 const {store,curator,contributor}=fixture(t);const room=store.createClass({title:'探究',question:'問題',placeIds:['place-1']},curator);store.joinClass(room.code,contributor);
 const p=store.savePuzzle({placeId:'place-1',title:'原版拼圖',interpretation:'原版解讀',cards:[{kind:'note',note:'我的觀察'}]},contributor);
 const s=store.submit({classId:room.id,name:'學生',stage:'after',text:'反思',puzzleId:p.id},contributor);
 store.savePuzzle({placeId:'place-1',title:'新版拼圖',cards:[],version:p.version},contributor,p.id);assert.equal(store.get('submission',s.id).puzzleSnapshot.title,'原版拼圖');
 assert.throws(()=>store.feedback(room.id,{submissionId:s.id,version:s.version,text:'不應允許'},contributor),/教師/);
 assert.equal(store.feedback(room.id,{submissionId:s.id,version:s.version,text:'請補充來源'},curator).teacherFeedback,'請補充來源');
});
