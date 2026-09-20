// Injected exclusively by preview:ui. This module is not an application import.
export function previewToolbarHtml() {
  return `<style>
#local-preview-tools{position:relative;z-index:1000;background:#272923;color:#faf8f2;border-bottom:1px solid #575b50;font:13px/1.5 system-ui,sans-serif;padding:8px 20px}
#local-preview-tools summary{cursor:pointer;display:flex;gap:12px;align-items:center;flex-wrap:wrap;min-height:28px}
#local-preview-tools summary strong{color:#d7e9bb}#local-preview-tools summary span{color:#dbdcd6}
#local-preview-tools .preview-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:8px}
#local-preview-tools button{border:1px solid #6c7066;background:#3d4037;color:#fff;border-radius:6px;padding:7px 12px;font:inherit;cursor:pointer;min-height:36px}
#local-preview-tools button:hover,#local-preview-tools button:focus-visible{background:#535a45;outline:2px solid #d0e2b4;outline-offset:2px}
#local-preview-tools small{display:block;color:#c6c9c0;margin-top:7px}#local-preview-tools [role=status]{margin:0;color:#ffe4ac}
@media(min-width:1180px){body:has(.app-shell) #local-preview-tools{margin-left:240px}body:has(.app-shell.is-sidebar-collapsed) #local-preview-tools{margin-left:76px}}
@media(max-width:640px){#local-preview-tools{padding:6px 12px}#local-preview-tools summary{gap:5px 10px}#local-preview-tools .preview-actions{gap:6px}#local-preview-tools button{min-height:40px;padding:6px 9px}}
</style>
<aside id="local-preview-tools" aria-label="本地沙盒演示身份"><details open><summary><strong>本地沙盒 · 不连接线上</strong><span id="preview-current-role">当前身份：游客</span><span>演示身份入口 ▾</span></summary><div class="preview-actions"><button type="button" data-preview-role="owner">演示军团管理员</button><button type="button" data-preview-role="reviewer">演示审核员</button><button type="button" data-preview-role="guest">游客浏览</button><span role="status" id="preview-login-status"></span></div><small>无需注册或真实密码。管理员创建 / 编辑 → 审核员核验 / 发布。刷新保留数据，重启此预览服务后重置。</small></details></aside>
<script type="module">
const bar=document.getElementById('local-preview-tools');
const labels={owner:'演示军团管理员',reviewer:'演示审核员',guest:'游客'};
let expiryTimer;
function syncRoleLabel(){
 clearTimeout(expiryTimer);
 let role='guest';
 try{
  const stored=localStorage.getItem('access_token');
  const payload=JSON.parse(atob((stored||'').split('.')[1]?.replace(/-/g,'+').replace(/_/g,'/')||''));
  const remaining=Number(payload.exp)*1000-Date.now();
  if(payload.kind==='access'&&['owner','reviewer'].includes(payload.role)&&Number.isFinite(remaining)&&remaining>0){
   role=payload.role;
   expiryTimer=setTimeout(syncRoleLabel,Math.min(remaining+25,2147483647));
  }
 }catch{}
 document.getElementById('preview-current-role').textContent='当前身份：'+labels[role];
}
window.addEventListener('auth:changed',syncRoleLabel);
window.addEventListener('storage',syncRoleLabel);
syncRoleLabel();
async function switchRole(role,legacy=false){
 const notice=document.getElementById('preview-login-status');const buttons=bar.querySelectorAll('button');buttons.forEach(button=>button.disabled=true);notice.textContent='正在切换本地身份…';
 try{
  const response=await fetch('/api/_preview/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})});const data=await response.json();if(!response.ok)throw new Error(data.detail||'切换失败');
  localStorage.removeItem('access_token');localStorage.removeItem('refresh_token');
  if(data.access){localStorage.setItem('access_token',data.access);localStorage.setItem('refresh_token',data.refresh);}
  const target=new URL(location.href);target.searchParams.delete('previewRole');
  if(!legacy){target.pathname=role==='reviewer'?'/corporations/review':role==='owner'?'/corporations/manage':'/corporations';target.search='';target.hash='';}
  location.replace(target.pathname+target.search+target.hash);
 }catch(error){notice.textContent=error.message;buttons.forEach(button=>button.disabled=false);}
}
bar.querySelectorAll('[data-preview-role]').forEach(button=>button.addEventListener('click',()=>switchRole(button.dataset.previewRole)));
const legacyRole=new URLSearchParams(location.search).get('previewRole');
if(legacyRole&&({user:'owner',admin:'reviewer',guest:'guest',owner:'owner',reviewer:'reviewer'})[legacyRole])switchRole(({user:'owner',admin:'reviewer',guest:'guest',owner:'owner',reviewer:'reviewer'})[legacyRole],true);
</script>`;
}
