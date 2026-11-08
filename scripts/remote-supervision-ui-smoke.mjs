import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=process.cwd();
const require=createRequire(resolve(root,'package.json'));
const {chromium}=require('playwright');
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
const port=probe.address().port;await new Promise(done=>probe.close(done));
const server=spawn(process.platform==='win32'?'npm.cmd':'npm',['run','preview','--','--host','127.0.0.1','--port',String(port)],{cwd:root,stdio:'inherit'});
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
  console.log('Initial accessibility labels:',await page.locator('button').allTextContents());
  await page.getByRole('button',{name:/Open labeled preview|Podgląd demonstracyjny|Podgląd demo|Otwórz podgląd|Otwórz demo/i}).click();
  await page.locator('.preview-banner').waitFor();
  if(await page.locator('textarea,[contenteditable=true]').count())throw new Error('Unexpected conversation editing surface');
  await mkdir(resolve(root,'test-results'),{recursive:true});
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:844});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Horizontal overflow at '+width);
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
  await page.getByRole('button',{name:/^Graph$/}).click();
  await page.locator('.graph-canvas svg').waitFor();
  await captureView('graph');
  await page.getByRole('button',{name:/^Zatwierdzenia/}).click();
  await page.locator('.approval-list').waitFor();
  await captureView('approvals');
  if(errors.length)throw new Error(errors.join('; '));
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
