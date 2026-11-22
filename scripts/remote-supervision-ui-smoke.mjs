import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const root=process.cwd();
const require=createRequire(resolve(root,'package.json'));
const {chromium}=process.env.KALIO_REMOTE_WORKSPACE_PLAYWRIGHT === '1'
  ? createRequire(resolve(root,'../e2e/package.json'))('@playwright/test')
  : require('playwright');
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
const port=probe.address().port;await new Promise(done=>probe.close(done));
const vite=resolve(dirname(require.resolve('vite/package.json')),'bin/vite.js');
const server=spawn(process.execPath,[vite,'preview','--host','127.0.0.1','--port',String(port)],{cwd:root,stdio:'inherit'});
let browser;
try{
  const origin='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<100;i++){try{const response=await fetch(origin);if(response.ok){ready=true;break;}}catch(error){if(server.exitCode!==null)throw error;}await new Promise(done=>setTimeout(done,100));}
  if(!ready)throw new Error('Preview readiness deadline');
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin,{waitUntil:'networkidle'});
  if(await page.getByRole('button',{name:'Podgląd demo'}).count())throw new Error('Demo should only appear in the menu');
  if(await page.getByRole('textbox',{name:'Kod jednorazowy'}).count())throw new Error('Pairing form should be closed by default');
  await page.getByRole('button',{name:'Połącz instancję'}).click();
  await page.getByRole('dialog',{name:'Połącz instancję'}).getByRole('textbox',{name:'Kod jednorazowy'}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Menu Remote'}).click();
  await page.getByRole('button',{name:'Podgląd demo'}).click();
  await page.locator('.preview-banner').waitFor();
  if(await page.locator('textarea,[contenteditable=true]').count())throw new Error('Unexpected conversation editing surface');
  await mkdir(resolve(root,'test-results'),{recursive:true});
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:844});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Horizontal overflow at '+width);
    if(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+1))throw new Error('Page scrolls instead of its content at '+width);
    const nav=await page.getByRole('navigation',{name:'Widoki Remote'}).boundingBox();
    if(!nav||nav.y+nav.height>844)throw new Error('Navigation below the viewport at '+width);
  }
  await page.setViewportSize({width:390,height:844});
  const png=await page.screenshot({path:resolve(root,'test-results/remote-mobile.png'),fullPage:true});
  console.log('KALIO_SCREENSHOT_BEGIN');const b=png.toString('base64');for(let i=0;i<b.length;i+=12000)console.log('KALIO_SCREENSHOT_CHUNK '+b.slice(i,i+12000));console.log('KALIO_SCREENSHOT_END');
  async function captureView(label) {
    const png=await page.screenshot({path:resolve(root,'test-results/remote-'+label+'.png'),fullPage:true});
    console.log('KALIO_VIEW_BEGIN '+label);
    const b=png.toString('base64');
    for(let i=0;i<b.length;i+=12000)console.log('KALIO_VIEW_CHUNK '+b.slice(i,i+12000));
    console.log('KALIO_VIEW_END');
  }
  await page.getByRole('button',{name:/Review authentication flow/}).click();
  await page.getByRole('button',{name:'Graf',exact:true}).click();
  await page.locator('.remote-graph-steps>li').first().waitFor();
  await page.setViewportSize({width:768,height:844});
  await page.locator('.graph-canvas svg').waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.locator('.remote-graph-steps>li').first().waitFor();
  await captureView('graph');
  await page.getByRole('button',{name:'Wróć do rozmowy'}).click();
  await page.getByRole('button',{name:'Wróć do sesji'}).click();
  await page.getByRole('button',{name:'Filtry sesji'}).click();
  await page.getByRole('textbox',{name:'Szukaj sesji'}).fill('Mobile relay');
  await page.getByRole('button',{name:'Pokaż wyniki'}).click();
  if(await page.locator('.session-row').count()!==1)throw new Error('Session filter was not applied');
  await page.getByRole('button',{name:'Zgody',exact:true}).click();
  await page.getByRole('heading',{name:'Zgody',exact:true}).waitFor();
  await page.getByText('Nic nie czeka na Twoją decyzję',{exact:true}).waitFor();
  await captureView('approvals');
  if(errors.length)throw new Error(errors.join('; '));

  // Drive the real UI against protocol fixtures on the same device socket.
  const paired=await browser.newPage({viewport:{width:390,height:844}});
  await paired.clock.install();
  await paired.clock.install();
  const instanceId='fixture-host';
  const summary={id:'fixture-session',title:'Fixture session',active:true,updatedAt:1};
  const verificationPath='C:/workspace/'+ 'long-directory-'.repeat(18) +'file.ts';
  const approval={id:'fixture-approval',sessionId:summary.id,toolName:'fs_read',args:{path:verificationPath},
    requestedAt:1,revision:'r1',argsSha256:'a'.repeat(64),decisionAvailable:true};
  let wire;
  let watchId;
  let approvalId;
  const frame=(type,fields={})=>wire.send(JSON.stringify({v:1,type,instanceId,...fields}));
  const snapshot=sequence=>frame('snapshot',{sequence,payload:{instance:{id:instanceId,name:'Fixture host'},sessions:[summary],approvals:[approval]}});
  await paired.route('**/v1/pair',route=>route.fulfill({json:{v:1,instanceId,deviceId:'fixture-device',token:'fixture-token'}}));
  await paired.routeWebSocket('**/v1/device',socket=>{
    wire=socket;
    socket.onMessage(raw=>{
      const request=JSON.parse(raw);
      if(request.type==='auth'){frame('auth.accepted');snapshot(9);}
      if(request.type==='session.watch'){
        watchId=request.requestId;
        frame('session.snapshot',{requestId:watchId,payload:{session:null,error:'projection_failed'}});
      }
      if(request.type==='approval.decide')approvalId=request.requestId;
    });
  });
  await paired.goto(origin);
  await paired.getByRole('button',{name:'Połącz instancję',exact:true}).click();
  await paired.getByRole('textbox',{name:'Adres Relay'}).fill(origin);
  await paired.getByRole('textbox',{name:'Kod jednorazowy'}).fill('fixture-code');
  await paired.getByRole('button',{name:'Połącz',exact:true}).click();
  await paired.getByRole('button',{name:/Fixture session/}).click();
  const status=paired.locator('.notice');
  await status.waitFor();
  await paired.getByRole('button',{name:'Zamknij komunikat'}).click();
  const detailError=paired.locator('.session-detail').getByText(/Nie udało się wczytać sesji/);
  await detailError.waitFor();
  const previousWatch=watchId;
  frame('instance.offline');
  await paired.getByText('Offline',{exact:true}).waitFor();
  frame('instance.online');
  snapshot(1);
  await paired.getByText('Online',{exact:true}).waitFor();
  await status.waitFor();
  if(!watchId||watchId===previousWatch)throw new Error('Selected session was not rewatched after the host returned');
  frame('session.snapshot',{requestId:watchId,payload:{session:summary,
    messages:[{id:'fixture-prompt',role:'user',content:'Verify this file',createdAt:1},
      {id:'fixture-message',role:'assistant',content:'Hydrated after reconnect',createdAt:1},
      {id:'fixture-tool',role:'tool_result',content:JSON.stringify({path:verificationPath}),createdAt:1}],
    graph:{available:false,reason:'no_architecture_run'}}});
  await paired.getByText('Hydrated after reconnect',{exact:true}).waitFor();
  await detailError.waitFor({state:'hidden'});
  for(const width of [320,390]){
    await paired.setViewportSize({width,height:844});
    const detail=await paired.locator('.detail-panel').boundingBox();
    assert.ok(detail && Math.abs(detail.x)<1 && Math.abs(detail.width-width)<1, 'Mobile detail reaches both edges');
    await paired.locator('.from-user').getByText('Verify this file',{exact:true}).waitFor();
    await paired.locator('.tool-message dd').getByText(verificationPath,{exact:true}).waitFor();
    assert.ok(await paired.locator('.messages').evaluate(node=>node.scrollWidth<=node.clientWidth+1), 'Long tool path wraps');
  }
  await paired.screenshot({ path: resolve(root, 'test-results/remote-thread-390.png') });
  await paired.getByRole('navigation',{name:'Widoki Remote'}).getByRole('button',{name:/^Zgody/}).click();
  await paired.locator('.approval-card dd').getByText(verificationPath,{exact:true}).waitFor();
  await paired.locator('.approval-meta').getByText('Szczegóły techniczne',{exact:true}).waitFor();
  await paired.screenshot({ path: resolve(root, 'test-results/remote-approval-card-390.png') });
  const approve=paired.getByRole('button',{name:'Zatwierdź',exact:true});
  await approve.click();
  const waiting=paired.locator('.approval-card').getByText('Wysyłanie…',{exact:true});
  await waiting.waitFor();
  frame('approval.rejected',{requestId:'foreign',reason:'instance_offline'});
  // The terminal reply for the real request must still be accepted after the foreign reply.
  frame('approval.rejected',{requestId:approvalId,reason:'instance_offline'});
  await waiting.waitFor({state:'hidden'});
  if(await approve.isDisabled())throw new Error('Correlated rejection left the approval disabled');
  await status.filter({hasText:/decyzja odrzucona/i}).waitFor();
  if(await paired.getByText('Rozstrzygnięto',{exact:true}).count())throw new Error('Relay rejection was shown as settlement');
  console.log('Paired Remote recovery smoke passed at 390px');

  // Expiration must update the UI without another relay frame or user action.
  snapshot(2);
  await approve.waitFor({state:'visible'});
  await paired.clock.fastForward(16_000);
  await paired.locator('.approval-card').waitFor({state:'hidden'});
  await paired.locator('.stale-banner').waitFor();
  snapshot(2);
  await paired.clock.fastForward(1_000);
  assert.equal(await paired.locator('.approval-card').count(),0,'An old snapshot restored an expired approval');
  snapshot(3);
  await approve.waitFor({state:'visible'});
  await approve.click();
  await waiting.waitFor();
  frame('approval.result',{requestId:approvalId,payload:{approvalId:approval.id,status:'settled'}});
  await paired.locator('.approval-card').waitFor({state:'hidden'});
  snapshot(4);
  await paired.clock.fastForward(1_000);
  assert.equal(await paired.locator('.approval-card').count(),0,'A snapshot restored a host-settled approval');
  console.log('Remote approval freshness and settlement smoke passed');


  const restored=await browser.newPage({viewport:{width:320,height:844}});
  let vault=['stale','keeper'].map(instanceId=>({relayUrl:origin,name:instanceId,pair:{
    v:1,instanceId,deviceId:'device-'+instanceId,token:'fixture-token-'+instanceId,
  }}));
  let failWrite=true;
  let writes=0;
  const opened=[];
  const closed=[];
  await restored.exposeFunction('readTestVault',()=>({value:JSON.stringify(vault)}));
  await restored.exposeFunction('writeTestVault',value=>{
    writes++;
    if(failWrite)throw new Error('fixture write failure');
    vault=JSON.parse(value);
  });
  await restored.addInitScript(()=>{
    window.androidBridge={};
    window.Capacitor={
      PluginHeaders:[{name:'RemoteVault',methods:[{name:'read',rtype:'promise'},{name:'write',rtype:'promise'}]}],
      nativePromise:(_plugin,method,input)=>method==='read'?window.readTestVault():window.writeTestVault(input.value),
    };
  });
  await restored.routeWebSocket('**/v1/device',socket=>{
    let instanceId;
    socket.onClose(()=>{if(instanceId)closed.push(instanceId);});
    socket.onMessage(raw=>{
      const request=JSON.parse(raw);
      if(request.type!=='auth')return;
      instanceId=request.instanceId;
      opened.push(instanceId);
      const send=(type,fields={})=>socket.send(JSON.stringify({v:1,type,instanceId,...fields}));
      send('auth.accepted');
      if(instanceId==='stale')send('instance.offline');
      else send('snapshot',{sequence:1,payload:{instance:{id:instanceId,name:instanceId},sessions:[],approvals:[]}});
    });
  });
  await restored.goto(origin);
  const openMenu=()=>restored.getByRole('button',{name:'Menu Remote'}).click();
  const openForget=()=>restored.getByRole('button',{name:'Zapomnij instancję',exact:true}).click();
  const confirm=restored.getByRole('dialog',{name:'Zapomnij instancję'});
  await restored.getByText('Instancja niedostępna',{exact:true}).waitFor();
  await openMenu();
  await restored.getByRole('button',{name:/^stale/}).click();
  await openMenu();
  await openForget();
  await confirm.getByText('stale',{exact:true}).waitFor();
  if(await confirm.evaluate(element=>element.scrollWidth>element.clientWidth+1))throw new Error('Forget dialog overflows at 320px');
  await confirm.getByRole('button',{name:'Anuluj'}).click();
  await confirm.waitFor({state:'hidden'});
  if(writes!==0||closed.length!==0)throw new Error('Cancel changed a pairing');
  await openForget();
  await confirm.getByRole('button',{name:'Usuń z urządzenia'}).click();
  await confirm.getByRole('alert').waitFor();
  if(vault.length!==2||closed.length!==0)throw new Error('Failed save removed a pairing or closed a socket');
  failWrite=false;
  const keeperBefore=vault[1];
  await confirm.getByRole('button',{name:'Usuń z urządzenia'}).click();
  await restored.getByText('Usunięto instancję z tego urządzenia.',{exact:true}).waitFor();
  await restored.getByText('Online',{exact:true}).waitFor();
  assert.equal(writes,2);
  assert.deepEqual(vault,[keeperBefore],'Removal modified other credentials');
  await openMenu();
  if(await restored.getByRole('button',{name:/^stale/}).count())throw new Error('Forgotten host remains in the menu');
  await restored.keyboard.press('Escape');
  if(closed.join(',')!=='stale')throw new Error('Expected only the forgotten host socket to close');
  opened.length=0;
  await restored.reload();
  await restored.getByText('Online',{exact:true}).waitFor();
  await openMenu();
  if(opened.join(',')!=='keeper'||await restored.getByRole('button',{name:/^stale/}).count())throw new Error('Reload reconnected the forgotten host');
  console.log('Forget host smoke passed at 320px with simulated Android vault');

}finally{if(browser)await browser.close();server.kill('SIGTERM');}
