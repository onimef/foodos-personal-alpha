
const cfg = window.FOODOS_CONFIG || {};
let sb = null;
let session = null;
let householdId = null;
let personId = null;
let currentMeal = null;
let currentCookSession = null;
let currentPrepared = null;
let currentItem = null;
let lastEventId = null;

const MEALS = [
  {id:'chicken-rice',name:'Chicken & Rice Bowls',mins:35,uses:[
    {food:'Chicken breast',qty:1,unit:'lb'},
    {food:'Rice',qty:2,unit:'cups'},
    {food:'Broccoli',qty:1,unit:'count'}
  ],reasonCodes:['OWN_ALL_INGREDIENTS','USES_SOON_ITEM','HIGH_PROTEIN']},
  {id:'eggs-rice',name:'Eggs & Rice Bowl',mins:12,uses:[
    {food:'Eggs',qty:3,unit:'count'},
    {food:'Rice',qty:1,unit:'cups'}
  ],reasonCodes:['OWN_ALL_INGREDIENTS','FAST']}
];

function configured(){
  return !!(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);
}

async function init(){
  if(!configured()){
    document.getElementById('configWarning').classList.remove('hidden');
    document.getElementById('configWarning').textContent='Cloud configuration is not connected yet. Add your Supabase URL and publishable key to config.js after running the included database migration.';
    document.getElementById('connectionState').textContent='Needs cloud config';
    return;
  }
  sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {data:{session:s}} = await sb.auth.getSession();
  session=s;
  sb.auth.onAuthStateChange((_event,s)=>{session=s;routeAuth();});
  await routeAuth();
}

async function routeAuth(){
  if(!session){
    document.getElementById('nav').classList.add('hidden');
    show('auth', false);
    document.getElementById('connectionState').textContent='Signed out';
    return;
  }
  document.getElementById('connectionState').textContent='Cloud connected';
  const {data,error}=await sb.from('household_members').select('household_id,person_id').eq('user_id',session.user.id).limit(1).maybeSingle();
  if(error){return fail(error.message);}
  if(!data){
    document.getElementById('nav').classList.add('hidden'); show('bootstrap',false); return;
  }
  householdId=data.household_id; personId=data.person_id;
  document.getElementById('nav').classList.remove('hidden');
  await refreshAll();
  show('today');
}

async function requestMagicLink(){
  if(!configured()) return fail('Cloud configuration is required first.');
  const email=document.getElementById('email').value.trim();
  if(!email)return fail('Enter your email.');
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin+window.location.pathname}});
  if(error)return fail(error.message);
  document.getElementById('authMsg').innerHTML='<div class="ok">Sign-in link sent. Open it on this device.</div>';
}

async function createHousehold(){
  const name=document.getElementById('householdName').value.trim()||'Home';
  const person=document.getElementById('personName').value.trim()||'Me';
  const {data,error}=await sb.rpc('create_household',{p_household_name:name,p_person_name:person});
  if(error)return fail(error.message);
  householdId=data.household_id; personId=data.person_id;
  document.getElementById('nav').classList.remove('hidden');
  await refreshAll(); show('today'); toast('Household created');
}

function show(id,nav=true){
  document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('on',x.id===id));
  document.querySelectorAll('nav button[data-nav]').forEach(x=>x.classList.toggle('on',x.dataset.nav===id));
  window.scrollTo(0,0);
}

async function addFood(){
  const food=document.getElementById('foodName').value.trim();
  const quantity=Number(document.getElementById('foodQty').value);
  const unit=document.getElementById('foodUnit').value;
  const storage=document.getElementById('foodStorage').value;
  const confidence=document.getElementById('foodConfidence').value;
  if(!food||!(quantity>0))return fail('Enter a food and quantity.');
  const {data,error}=await sb.rpc('record_inventory_event',{
    p_household_id:householdId,p_event_type:'MANUAL_ADD',p_food_name:food,
    p_quantity_delta:quantity,p_unit:unit,p_storage_location:storage,
    p_confidence:confidence,p_metadata:{source:'manual'}
  });
  if(error)return fail(error.message);
  lastEventId=data;
  await refreshAll(); show('kitchen'); toast(`${food} added`);
}

async function getInventory(){
  const {data,error}=await sb.from('inventory_projection').select('*').eq('household_id',householdId).order('food_name');
  if(error)throw error;
  return data||[];
}

async function getPrepared(){
  const {data,error}=await sb.from('prepared_food_projection').select('*').eq('household_id',householdId).gt('servings_remaining',0).order('created_at',{ascending:false});
  if(error)throw error;
  return data||[];
}

async function refreshAll(){
  if(!householdId)return;
  try{
    const [inv,prep,ev]=await Promise.all([
      getInventory(),getPrepared(),
      sb.from('inventory_events').select('id,event_type,food_name,quantity_delta,unit,confidence,created_at,reverses_event_id').eq('household_id',householdId).order('created_at',{ascending:false}).limit(12)
    ]);
    renderInventory(inv); renderPrepared(prep); renderEvents(ev.data||[]);
  }catch(e){fail(e.message)}
}

function renderInventory(inv){
  const el=document.getElementById('inventory');
  el.innerHTML=inv.length?inv.map((i,idx)=>`<div class="card row" onclick="openItemByIndex(${idx})"><div><b>${esc(i.food_name)}</b><div class="muted">${esc(i.storage_location||'Location unknown')}</div><span class="tag ${i.confidence==='UNKNOWN'?'unknown':''}">${esc(i.confidence)}</span></div><div class="qty">${fmt(i.quantity)} ${esc(i.unit)} ›</div></div>`).join(''):'<div class="empty">No known food yet.</div>';
  window._inv=inv;
}
function renderPrepared(prep){
  document.getElementById('todayPrepared').innerHTML=prep.length?prep.map((p,idx)=>`<div class="card row" onclick="openPreparedByIndex(${idx})"><div><b>${esc(p.name)}</b><div class="muted">${esc(p.storage_location)}</div></div><span>${fmt(p.servings_remaining)} servings ›</span></div>`).join(''):'<div class="card muted">No prepared food yet.</div>';
  window._prep=prep;
}
function renderEvents(events){
  document.getElementById('events').innerHTML=events.length?`<div class="card">${events.map(e=>`<div class="item"><b>${esc(e.event_type)}</b> · ${esc(e.food_name)}<div class="muted">${e.quantity_delta>0?'+':''}${fmt(e.quantity_delta)} ${esc(e.unit)} · ${esc(e.confidence)}</div></div>`).join('')}</div>`:'<div class="empty">No inventory changes yet.</div>';
}

async function recommend(){
  const inv=await getInventory(), prep=await getPrepared();
  const feasible=MEALS.filter(m=>mealFeasible(m,inv));
  let html='';
  if(prep.length){
    const p=prep[0];
    html+=`<div class="card hero"><span class="tag">PREPARED ALREADY</span><h3>${esc(p.name)}</h3><p class="muted">${fmt(p.servings_remaining)} servings available. No cooking.</p><button class="btn secondary full" onclick="openPreparedById('${p.prepared_food_id}')">Eat This</button></div>`;
  }
  if(feasible.length){
    currentMeal=feasible.sort((a,b)=>scoreMeal(b,inv)-scoreMeal(a,inv))[0];
    await saveRecommendation(currentMeal);
    html+=`<div class="card hero"><span class="tag">BEST FIT</span><h3>${esc(currentMeal.name)}</h3><p class="muted">${currentMeal.mins} min</p><button class="btn primary full" onclick="startCook()">Make This</button><button class="btn ghost full" onclick="openWhy()">Why this?</button></div>`;
  }else if(!prep.length){
    html=`<div class="card"><h3>Not enough known food yet.</h3><p class="muted">Add groceries and I’ll make a decision from what is actually in your kitchen.</p><button class="btn primary full" onclick="show('add')">Add food</button></div>`;
  }
  document.getElementById('rec').innerHTML=html; show('recommend');
}
function mealFeasible(meal,inv){
  return meal.uses.every(u=>{const x=inv.find(i=>same(i.food_name,u.food)&&i.unit===u.unit);return x&&Number(x.quantity)>=u.qty;});
}
function scoreMeal(meal,inv){
  let s=100-meal.mins;
  if(meal.reasonCodes.includes('USES_SOON_ITEM'))s+=20;
  if(meal.reasonCodes.includes('HIGH_PROTEIN'))s+=8;
  return s;
}
async function saveRecommendation(meal){
  await sb.from('recommendations').insert({
    household_id:householdId,person_id:personId,recipe_key:meal.id,title:meal.name,
    reason_codes:meal.reasonCodes,status:'PRESENTED'
  });
}
function openWhy(){
  document.getElementById('whyTitle').textContent=currentMeal.name;
  const map={OWN_ALL_INGREDIENTS:'You already have everything.',USES_SOON_ITEM:'Uses food that should be prioritized.',PREPARED_ALREADY:'It is already prepared.',FAST:'It is fast.',HIGH_PROTEIN:'It aligns with your configured protein priority.',LOW_INCREMENTAL_COST:'Low additional cost.'};
  document.getElementById('whyReasons').innerHTML=currentMeal.reasonCodes.map(c=>`<div class="card">${esc(map[c]||c)}</div>`).join('');
  show('why');
}

async function startCook(){
  if(!currentMeal)return;
  const {data,error}=await sb.from('cook_sessions').insert({
    household_id:householdId,person_id:personId,recipe_key:currentMeal.id,title:currentMeal.name,
    expected_use:currentMeal.uses,status:'STARTED'
  }).select('id').single();
  if(error)return fail(error.message);
  currentCookSession=data.id;
  document.getElementById('cookTitle').textContent=currentMeal.name;
  document.getElementById('cookUse').innerHTML=currentMeal.uses.map(u=>`<div class="item row"><span>${esc(u.food)}</span><b>${u.qty} ${esc(u.unit)}</b></div>`).join('');
  show('cook');
}

async function completeCook(){
  if(!currentCookSession)return fail('No active cook session.');
  const {error}=await sb.rpc('complete_cook_session',{
    p_session_id:currentCookSession,p_actual_use:currentMeal.uses
  });
  if(error)return fail(error.message);
  await refreshAll(); show('postcook');
}

async function finalizeLeftovers(){
  const servings=Math.max(0,Number(document.getElementById('leftovers').value));
  const storage=document.getElementById('leftStorage').value;
  const {data,error}=await sb.rpc('create_leftovers',{
    p_session_id:currentCookSession,p_servings:servings,p_storage_location:storage
  });
  if(error)return fail(error.message);
  await refreshAll(); show('today'); toast(servings?`${servings} servings saved`:'No leftovers saved');
}

async function openPreparedByIndex(idx){return openPreparedById(window._prep[idx].prepared_food_id)}
async function openPreparedById(id){
  const prep=await getPrepared();
  currentPrepared=prep.find(p=>p.prepared_food_id===id);
  if(!currentPrepared)return fail('Prepared food not found.');
  document.getElementById('preparedTitle').textContent=currentPrepared.name;
  document.getElementById('preparedQty').textContent=fmt(currentPrepared.servings_remaining);
  show('prepared');
}
async function eatOne(){
  if(!currentPrepared)return;
  const {data,error}=await sb.rpc('eat_prepared_food',{p_prepared_food_id:currentPrepared.prepared_food_id,p_servings:1});
  if(error)return fail(error.message);
  lastEventId=data?.event_id||null;
  await refreshAll();
  const prep=await getPrepared();
  currentPrepared=prep.find(p=>p.prepared_food_id===currentPrepared.prepared_food_id)||{...currentPrepared,servings_remaining:0};
  document.getElementById('preparedQty').textContent=fmt(currentPrepared.servings_remaining);
  toast(`Logged 1 serving · ${fmt(currentPrepared.servings_remaining)} remaining`);
}

function openItemByIndex(idx){
  currentItem=window._inv[idx];
  document.getElementById('itemTitle').textContent=currentItem.food_name;
  document.getElementById('itemConfidence').textContent=currentItem.confidence;
  document.getElementById('itemQty').textContent=quantityLanguage(currentItem);
  document.getElementById('itemWhy').textContent=currentItem.explanation||'Derived from your household inventory event history.';
  show('item');
}
function openCorrection(){
  document.getElementById('correctTitle').textContent=`How much ${currentItem.food_name} is there?`;
  document.getElementById('correctQty').value=Number(currentItem.quantity);
  show('correct');
}
async function saveCorrection(){
  const actual=Number(document.getElementById('correctQty').value);
  if(!(actual>=0))return fail('Enter a valid quantity.');
  const {data,error}=await sb.rpc('correct_inventory_quantity',{
    p_household_id:householdId,p_food_name:currentItem.food_name,p_unit:currentItem.unit,
    p_actual_quantity:actual,p_storage_location:currentItem.storage_location
  });
  if(error)return fail(error.message);
  lastEventId=data;
  await refreshAll(); show('kitchen'); toast(`${currentItem.food_name} updated`);
}

async function undoLast(){
  if(!lastEventId)return toast('Nothing to undo.');
  const {error}=await sb.rpc('reverse_inventory_event',{p_event_id:lastEventId});
  if(error)return fail(error.message);
  lastEventId=null; await refreshAll(); toast('Last change undone');
}

function quantityLanguage(i){
  const q=fmt(i.quantity);
  if(i.confidence==='VERIFIED')return `${q} ${i.unit}`;
  if(i.confidence==='CALCULATED')return `${q} ${i.unit} calculated`;
  if(i.confidence==='ESTIMATED')return `About ${q} ${i.unit}`;
  return `Quantity uncertain`;
}
function same(a,b){return String(a).trim().toLowerCase()===String(b).trim().toLowerCase()}
function fmt(n){return Math.round(Number(n)*100)/100}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function toast(t){document.getElementById('toastText').textContent=t;document.getElementById('toast').classList.add('on');setTimeout(()=>document.getElementById('toast').classList.remove('on'),5000)}
function fail(t){document.getElementById('authMsg').innerHTML=`<div class="error">${esc(t)}</div>`;toast(t)}

if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
init();
