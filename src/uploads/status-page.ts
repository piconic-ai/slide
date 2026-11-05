export const statusPage = `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Slide アップロード受領票</title>
<style>body{font:17px system-ui;max-width:800px;margin:6vh auto;padding:24px;background:#f4f6fa;color:#152439}input,button{font:inherit;padding:12px;border:1px solid #aab6c9;border-radius:6px}input{width:95%}button{margin-top:12px;background:#153b70;color:white;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:20px;border-radius:8px}label{display:block;margin:18px 0 8px}p{line-height:1.6}</style>
<h1>Slide アップロード受領票</h1><p>GitHub Actions から非公開で送った資料の commit と受領済みファイルを確認できます。アップロードだけでは資料は公開されません。</p>
<label for="receipt-file">非公開の受領票 JSON を読み込む</label><input id="receipt-file" type="file" accept="application/json"><form id="receipt"><label for="deployment">Deployment ID</label><input id="deployment" required autocomplete="off"><label for="credential">このアップロード専用の認証情報</label><input id="credential" type="password" required autocomplete="off"><button>受領票を確認</button><button type="button" id="preview">スライドをプレビュー</button></form>
<p>認証情報はこのページ内だけで保持し、アップロード開始から24時間で期限が切れます。このアップロード専用の認証情報であり、GitHub ログインとは異なります。</p><pre id="result" role="status">Deployment ID と認証情報、または受領票 JSON で状態を確認してください。</pre>
<iframe id="slide-preview" title="非公開スライドのプレビュー" sandbox="allow-scripts" referrerpolicy="no-referrer" style="display:none;width:100%;height:65vh;border:1px solid #aab6c9"></iframe><p>現在のプレビューは HTML 単体で完結する資料に対応しています。相対パスの画像・CSS・JS は読み込みません。</p><script>
const id = location.pathname.split('/')[2]; if(id) document.querySelector('#deployment').value=id;
document.querySelector('#receipt-file').addEventListener('change', async event => {
 try {const data=JSON.parse(await event.target.files[0].text()); document.querySelector('#deployment').value=data.deploymentId; document.querySelector('#credential').value=data.credential; document.querySelector('#receipt').requestSubmit();} catch {document.querySelector('#result').textContent='受領票 JSON を読み込めませんでした。'}
});
document.querySelector('#preview').addEventListener('click',async () => {
 const frame=document.querySelector('#slide-preview');
 try {const response=await fetch('/api/uploads/'+encodeURIComponent(document.querySelector('#deployment').value)+'/content/index.html',{headers:{Authorization:'Bearer '+document.querySelector('#credential').value}}); if(!response.ok) throw new Error(); frame.srcdoc=await response.text(); frame.style.display='block';} catch {document.querySelector('#result').textContent='プレビューを読み込めませんでした。認証情報と ready 状態を確認してください。'}
});
document.querySelector('#receipt').addEventListener('submit', async event => {
 event.preventDefault(); const result=document.querySelector('#result'); result.textContent='確認しています…';
 try { const response=await fetch('/api/uploads/'+encodeURIComponent(document.querySelector('#deployment').value),{headers:{Authorization:'Bearer '+document.querySelector('#credential').value}}); const data=await response.json(); result.textContent=JSON.stringify(data,null,2); } catch {result.textContent='サービスに接続できませんでした。もう一度お試しください。'}
});</script></html>`
