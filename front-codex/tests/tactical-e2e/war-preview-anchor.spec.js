import {test,expect} from '@playwright/test';

for(const delta of [-120,120]) test(`war preview ${delta} keeps cards, close buttons and leaders attached to their stars`,async({page})=>{
  await page.goto('/tests/tactical-e2e/war-preview-anchor-harness.html');
  const map=page.getByRole('group',{name:'局部作战星图'});
  await expect(map.locator('[data-force-id="11"]')).toBeVisible();
  const values=await map.evaluate(async(svg,delta)=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,cx:r.x+r.width/2,cy:r.y+r.height/2}};
    const endpoint=(line,which)=>{
      const p=new DOMPoint(Number(line.getAttribute(`x${which}`)),Number(line.getAttribute(`y${which}`))).matrixTransform(line.getScreenCTM());
      return {x:p.x,y:p.y};
    };
    const read=()=>[[2,'[data-force-id="11"]','.tac-force-close'],[3,'[data-count-system-id="3"]','.tac-count-close']].map(([id,cardSelector,closeSelector])=>{
      const card=rect(svg.querySelector(`${cardSelector}>rect`)),close=rect(svg.querySelector(`${closeSelector}>rect`)),star=rect(svg.querySelector(`[data-system-id="${id}"] .tac-star-dot`));
      const key=id===2?'force-2':'system-count-3';
      const line=[...svg.querySelectorAll('.tac-map-marker-leader')].find(node=>node.dataset.tacMarkerKey===key)||[...svg.querySelectorAll('.tac-map-marker-leader')][id===2?0:1];
      return {card,close,star,from:endpoint(line,1),to:endpoint(line,2),dx:card.cx-star.cx,dy:card.cy-star.cy};
    });
    const before=read(),bounds=svg.getBoundingClientRect();
    for(let index=0;index<4;index++){
      svg.dispatchEvent(new WheelEvent('wheel',{deltaY:delta,bubbles:true,clientX:bounds.x+bounds.width/2,clientY:bounds.y+bounds.height/2}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }
    return {before,after:read(),preview:svg.parentElement.classList.contains('is-wheel-zooming')};
  },delta);
  expect(values.preview).toBe(true);
  expect(values.before[0].dy).toBeLessThan(0);
  expect(values.before[1].dy).toBeGreaterThan(0);
  for(let i=0;i<values.before.length;i++){
    const before=values.before[i],after=values.after[i];
    expect(Math.abs(before.dx)).toBeLessThan(1);
    expect(Math.abs(after.dx-before.dx)).toBeLessThan(1);
    expect(Math.abs(after.dy-before.dy)).toBeLessThan(1);
    expect(Math.abs(after.close.right-after.card.right)).toBeLessThan(1);
    expect(Math.abs(after.close.cy-after.card.cy)).toBeLessThan(1);
    expect(Math.abs(after.from.x-after.card.cx)).toBeLessThan(1);
    expect(Math.min(Math.abs(after.from.y-after.card.y),Math.abs(after.from.y-after.card.bottom))).toBeLessThan(1);
    expect(Math.hypot(after.to.x-after.star.cx,after.to.y-after.star.cy)).toBeLessThan(1);
    expect(Math.abs(after.card.width-before.card.width)).toBeLessThan(1);
  }
});
