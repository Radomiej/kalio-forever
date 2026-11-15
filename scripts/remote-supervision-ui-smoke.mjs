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
  await page.locator('.graph-canvas svg').waitFor();
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
  const instanceId='fixture-host';
  const summary={id:'fixture-session',title:'Fixture session',active:true,updatedAt:1};
  const approval={id:'fixture-approval',sessionId:summary.id,toolName:'Fixture tool',args:{},
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
    messages:[{id:'fixture-message',role:'assistant',content:'Hydrated after reconnect',createdAt:1}],
    graph:{available:false,reason:'no_architecture_run'}}});
  await paired.getByText('Hydrated after reconnect',{exact:true}).waitFor();
  await detailError.waitFor({state:'hidden'});
  await paired.getByRole('navigation',{name:'Widoki Remote'}).getByRole('button',{name:/^Zgody/}).click();
  const approve=paired.getByRole('button',{name:'Zatwierdź raz'});
  await approve.click();
  const waiting=paired.getByText('Oczekiwanie na hosta',{exact:true});
  await waiting.waitFor();
  frame('approval.rejected',{requestId:'foreign',reason:'instance_offline'});
  // The terminal reply for the real request must still be accepted after the foreign reply.
  frame('approval.rejected',{requestId:approvalId,reason:'instance_offline'});
  await waiting.waitFor({state:'hidden'});
  if(await approve.isDisabled())throw new Error('Correlated rejection left the approval disabled');
  await status.filter({hasText:/decyzja odrzucona/i}).waitFor();
  if(await paired.getByText('Rozstrzygnięto',{exact:true}).count())throw new Error('Relay rejection was shown as settlement');
  console.log('Paired Remote recovery smoke passed at 390px');

}finally{if(browser)await browser.close();server.kill('SIGTERM');}
