const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES] }));
const root = path.resolve(__dirname, '..');
const mock = `window.testEvents=[];window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'test-user'}}}}),onAuthStateChange:()=>{}},from:table=>{const q={select:()=>q,eq:()=>q,limit:()=>q,order:()=>q,gt:()=>q,maybeSingle:async()=>({data:{household_id:'test-household',person_id:'test-person'}}),then:resolve=>Promise.resolve({data:[],error:null}).then(resolve)};return q;},rpc:async(name,args)=>{window.testEvents.push({name,args});await new Promise(r=>setTimeout(r,50));return {data:'test-event',error:null};}})};`;

(async () => {
  const server = http.createServer((req,res)=>{
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = path.resolve(root,'.'+(name==='/'?'/index.html':name));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    try {
      const types={'.js':'application/javascript','.html':'text/html','.png':'image/png','.webmanifest':'application/manifest+json'};
      res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));
    }catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(process.env.FOODOS_TEST_BROWSER?{executablePath:process.env.FOODOS_TEST_BROWSER}:{})}).catch(error=>{server.close();throw error;});
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  try {
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',r=>r.fulfill({contentType:'application/javascript',body:mock}));
    await page.route('**/config.js',r=>r.fulfill({contentType:'application/javascript',body:'window.FOODOS_CONFIG={SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"test-fixture"};'}));
    let responseMode='match';let calls=0;let release;
    await page.route('https://world.openfoodfacts.org/api/v3/product/**',async r=>{
      calls++;
      if(responseMode==='delayed')await new Promise(resolve=>release=resolve);
      if(responseMode==='offline'){await r.abort();return;}
      if(responseMode==='missing'){await r.fulfill({status:404,body:'{}'});return;}
      const name=responseMode==='malicious'?'<img src=x onerror=alert(1)>':'Sample cereal';
      await r.fulfill({contentType:'application/json',body:JSON.stringify({code:'3017620422003',product:responseMode==='nameless'?{brands:'Sample'}:{product_name:name,brands:'Sample brand',quantity:'250 g'}})});
    });
    await page.goto(origin);await page.getByText('Cloud connected',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Scan barcode or add manually',exact:true}).click();
    const barcode=page.locator('#foodBarcode'),lookup=page.getByRole('button',{name:'Look up product',exact:true});
    const events=()=>page.evaluate(()=>window.testEvents);
    async function look(code='3017620422003'){await barcode.fill(code);await lookup.click();await page.waitForFunction(()=>!document.getElementById('barcodeLookup').disabled);}
    await look('3017620422004');assert.match(await page.locator('#barcodeStatus').innerText(),/invalid check digit/);assert.equal(calls,0);
    await look();assert.equal(await page.locator('#foodName').inputValue(),'Sample cereal');assert.equal((await events()).length,0);
    assert.equal(await page.locator('#foodQty').inputValue(),'');assert.equal(await page.locator('#foodStorage').inputValue(),'');
    await page.locator('#foodQty').fill('2');await page.locator('#foodUnit').selectOption('count');
    await page.getByRole('button',{name:'Confirm & add to Kitchen',exact:true}).click();assert.equal((await events()).length,0);
    await page.locator('#foodStorage').selectOption('Pantry');await page.getByRole('button',{name:'Confirm & add to Kitchen',exact:true}).click();assert.equal((await events()).length,0);
    await page.locator('#foodReviewed').check();await page.locator('#foodQty').fill('3');assert.equal(await page.locator('#foodReviewed').isChecked(),false);
    await page.locator('#foodReviewed').check();
    await page.locator('#toast').waitFor({state:'hidden'});
    await page.screenshot({path:path.join(root,'../FoodOS_v0.2.2_Barcode_Preview.png'),fullPage:true});
    await page.evaluate(()=>{addFood();addFood();});await page.locator('#kitchen.on').waitFor();
    let saved=await events();assert.equal(saved.length,1);assert.equal(saved[0].name,'record_inventory_event');
    assert.equal(saved[0].args.p_household_id,'test-household');assert.equal(saved[0].args.p_metadata.barcode,'3017620422003');assert.equal(saved[0].args.p_metadata.product_lookup.status,'matched');assert.equal(saved[0].args.p_quantity_delta,3);
    await page.getByRole('button',{name:'+ Add food',exact:true}).click();responseMode='missing';await look();assert.equal(await page.locator('#foodName').inputValue(),'');
    await page.locator('#foodName').fill('My actual food');await page.locator('#foodQty').fill('1');await page.locator('#foodStorage').selectOption('Freezer');await page.locator('#foodReviewed').check();
    await page.getByRole('button',{name:'Confirm & add to Kitchen',exact:true}).click();await page.locator('#kitchen.on').waitFor();saved=await events();assert.equal(saved[1].args.p_metadata.product_lookup.status,'not_found');assert.equal(saved[1].args.p_food_name,'My actual food');
    await page.getByRole('button',{name:'+ Add food',exact:true}).click();responseMode='offline';await look();assert.match(await page.locator('#barcodeStatus').innerText(),/unavailable/);assert.equal(await page.locator('#foodName').inputValue(),'');
    responseMode='nameless';await look();assert.match(await page.locator('#barcodeStatus').innerText(),/No named product/);
    responseMode='delayed';await barcode.fill('3017620422003');await lookup.click();await page.waitForFunction(()=>document.getElementById('barcodeLookup').disabled);await barcode.fill('12345670');release();await page.waitForTimeout(100);assert.equal(await page.locator('#foodName').inputValue(),'');
    responseMode='malicious';await look();assert.equal(await page.locator('#barcodeDetails img').count(),0);assert.match(await page.locator('#barcodeDetails').innerText(),/<img/);
    const decoded=await page.evaluate(async()=>{const reader=new ZXingBrowser.BrowserMultiFormatReader();return (await reader.decodeFromImageUrl('/tests/fixtures/ean13.png')).getText();});assert.equal(decoded,'3017620422003');
    // Exercise scanner UI success and cancellation after camera permission resolves late.
    await page.evaluate(()=>{window.realReader=ZXingBrowser.BrowserMultiFormatReader;ZXingBrowser.BrowserMultiFormatReader=class{async decodeFromConstraints(c,v,callback){const controls={stop:()=>window.cameraStops=(window.cameraStops||0)+1};callback({getText:()=> '3017620422003'},null,controls);return controls;}};});
    responseMode='match';await page.getByRole('button',{name:'Scan with camera',exact:true}).click();await page.waitForFunction(()=>document.getElementById('foodName').value==='Sample cereal');assert.equal(await page.locator('#barcodeCamera').isVisible(),false);
    await page.evaluate(()=>{ZXingBrowser.BrowserMultiFormatReader=class{decodeFromConstraints(){return new Promise(r=>window.finishCamera=()=>r({stop:()=>window.cameraStops=(window.cameraStops||0)+1}));}};});
    await page.getByRole('button',{name:'Scan with camera',exact:true}).click();await page.getByRole('button',{name:'Stop camera',exact:true}).click();await page.evaluate(()=>window.finishCamera());assert.equal(await page.locator('#barcodeCamera').isVisible(),false);assert.equal(await page.locator('#barcodeScan').isEnabled(),true);
    await page.evaluate(()=>{ZXingBrowser.BrowserMultiFormatReader=class{async decodeFromConstraints(){throw new Error('NotAllowedError');}};});
    await page.getByRole('button',{name:'Scan with camera',exact:true}).click();await page.getByText(/Camera could not start/).waitFor();assert.equal(await page.locator('#barcodeScan').isEnabled(),true);
    await page.getByRole('button',{name:'Clear barcode',exact:true}).click();await page.locator('#foodName').fill('Manual carrots');await page.locator('#foodQty').fill('1');await page.locator('#foodStorage').selectOption('Fridge');await page.locator('#foodReviewed').check();
    await page.getByRole('button',{name:'Confirm & add to Kitchen',exact:true}).click();await page.locator('#kitchen.on').waitFor();saved=await events();assert.deepEqual(saved.at(-1).args.p_metadata,{source:'manual'});
    assert.deepEqual(pageErrors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    const cacheContext=await browser.newContext({serviceWorkers:'allow'});
    const cachePage=await cacheContext.newPage();
    await cachePage.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',r=>r.fulfill({contentType:'application/javascript',body:mock}));
    await cachePage.goto(origin+'/smoke.html');
    await cachePage.evaluate(async()=>{await caches.open('foodos-alpha-v02');await caches.open('other-app-cache');});
    await cachePage.goto(origin);
    await cachePage.evaluate(async()=>{await navigator.serviceWorker.ready;});
    await cachePage.waitForFunction(async()=>!(await caches.keys()).includes('foodos-alpha-v02'));
    assert.equal(await cachePage.evaluate(async()=>(await caches.keys()).includes('other-app-cache')),true);
    await cachePage.reload();await cachePage.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await cacheContext.setOffline(true);await cachePage.reload();
    await cachePage.evaluate(()=>show('add'));
    assert.equal(await cachePage.getByRole('button',{name:'Scan with camera',exact:true}).isVisible(),true);
    assert.equal(await cachePage.evaluate(()=>!!window.ZXingBrowser&&!!window.FoodOSBarcode),true);
    await cacheContext.close();
    console.log('PASS: matched, unknown, offline, invalid, nameless, stale and unsafe lookup; confirmation/RPC metadata; real EAN decoding; camera success/cancel/denial; manual fallback; mobile layout. No live data used.');
    console.log('PASS: double-save protection; old FoodOS cache retired; unrelated cache preserved; barcode scripts available offline.');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
