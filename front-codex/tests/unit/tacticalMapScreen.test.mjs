import test from 'node:test';
import assert from 'node:assert/strict';
import { boundsOf, screenNodes, layoutSystemLabels, moveTarget, compactTopology, layoutOverviewCards, rectanglesOverlap } from '../../src/utils/tacticalMapScreen.js';
import {layoutTopology} from '../../src/utils/tacticalMapLayout.js';

test('projection moves points while never mutating static world coordinates', () => {
  const world = [{system_id:1,px:20,py:40}];
  assert.deepEqual(screenNodes(world,{panX:10,panY:20,zoom:2})[0],{system_id:1,px:50,py:100});
  assert.equal(world[0].px,20);
  assert.deepEqual(boundsOf(world),{minX:20,maxX:20,minY:40,maxY:40});
});
test('label collision budget prioritizes selection without overlapping any other labels', () => {
  const nodes = Array.from({length:40},(_,i)=>({system_id:i+1,zh_name:'测试长星系名称'+i,px:200+(i%5)*4,py:200+Math.floor(i/5)*4}));
  const labels = layoutSystemLabels(nodes,{selectedId:19,width:1000,height:600});
  assert.ok(labels.some(x=>x.system_id===19));
  assert.ok(labels.length<10);
  for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) {
    const a=labels[i],b=labels[j];
    assert.ok(!(a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y));
  }
});
test('drag only picks legal nearest targets and refuses visually ambiguous hits', () => {
  const nodes = [{system_id:1,px:90,py:100},{system_id:2,px:100,py:100},{system_id:3,px:112,py:100}];
  assert.equal(moveTarget(nodes,{x:100,y:100},new Set([2,3])).system_id,2);
  assert.equal(moveTarget(nodes,{x:106,y:100},new Set([2,3])),null);
  assert.equal(moveTarget(nodes,{x:80,y:100},new Set([3])),null);
});

test('name density is optional and hovered names survive crowded placement', () => {
  const nodes=Array.from({length:8},(_,i)=>({system_id:i+1,zh_name:`星系${i+1}`,px:100+i*100,py:200}));
  const sparse=layoutSystemLabels(nodes,{width:1000,height:600,step:4});
  assert.equal(sparse.length,2);
  assert.equal(layoutSystemLabels(nodes,{width:1000,height:600,step:4,showAll:true}).length,8);
  const crowded=[{system_id:1,name:'选中的名字',px:200,py:200},{system_id:2,name:'悬停的名字',px:200,py:200}];
  const labels=layoutSystemLabels(crowded,{width:1000,height:600,hoveredId:2,occupied:[{x:0,y:0,width:1000,height:600}]});
  assert.ok(labels.some(label=>label.system_id===2));
});
test('compact topology gives 128 static systems unique positions independent of array order', () => {
  const nodes=Array.from({length:128},(_,i)=>({system_id:i+1}));
  const edges=nodes.slice(1).map(n=>({system_id:n.system_id-1,destination_system_id:n.system_id}));
  const a=compactTopology(layoutTopology(nodes,edges));
  const b=compactTopology(layoutTopology([...nodes].reverse(),[...edges].reverse()));
  assert.deepEqual(a,b);
  assert.equal(new Set(a.map(n=>[n.px,n.py].join(':'))).size,128);
  assert.ok(boundsOf(a).maxX<3000);
});

test('25 constellation overview cards fit the free area without overlap at desktop and tablet sizes',()=>{
  for(const width of [1320,960,740]) {
    const viewport={width,height:950,padding:{left:30,right:320,top:175,bottom:220}};
    const cards=layoutOverviewCards(Array.from({length:25},(_,i)=>({system_id:i+1})),viewport);
    assert.equal(cards.length,25);
    const boxes=cards.map(card=>({x:card.px-card.cardWidth/2,y:card.py-card.cardHeight/2,width:card.cardWidth,height:card.cardHeight}));
    for(let i=0;i<boxes.length;i++) {
      assert.ok(boxes[i].x>=30 && boxes[i].x+boxes[i].width<=width-320);
      assert.ok(boxes[i].y>=175 && boxes[i].y+boxes[i].height<=730);
      for(let j=i+1;j<boxes.length;j++) assert.ok(!rectanglesOverlap(boxes[i],boxes[j]));
    }
  }
});
