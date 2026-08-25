/* KEYDROP 汎用アクセス解析トラッカー（新サイト v3 横断）
 * 取得するもの：ページ閲覧(pv) / 要素クリック(click・どこがどれだけ踏まれたか) /
 *              フロー段階(step) / 離脱(exit・滞在秒)。端末・流入元も付与。
 * 使い方：<script src="kd-track.js"></script> のあと KDT.init({page:'top',area:''});
 *   フロー側は段階遷移で KDT.step('select',2) を呼ぶ。クリックは自動捕捉。
 * 内部テストは ?internal=1 で selftest_ セッションになり集計から自動除外。
 */
(function(){
  var SB='https://ckrxttbnawkclshczsia.supabase.co';
  var KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcnh0dGJuYXdrY2xzaGN6c2lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4Nzg1NTAsImV4cCI6MjA4NzQ1NDU1MH0.kDC_UDVWvcrS97wzqQ3NXP79ewjgYwF4vSFdV7y06S8';
  var PAGE='', AREA='', t0=(window.performance&&performance.now)?performance.now():Date.now(), exited=false;

  function internal(){ try{
    var s=location.search||'';
    if(/[?&]internal=1/.test(s)) localStorage.setItem('kd_internal','1');
    if(/[?&]internal=0/.test(s)) localStorage.removeItem('kd_internal');
    return localStorage.getItem('kd_internal')==='1';
  }catch(e){ return false; } }
  function sid(){ try{
    var k='kd_evsid', v=sessionStorage.getItem(k), int=internal();
    if(!v || (int && v.indexOf('selftest_')!==0)){ v=(int?'selftest_':'fs_')+Date.now().toString(36)+Math.random().toString(36).slice(2,8); sessionStorage.setItem(k,v); }
    return v;
  }catch(e){ return 'fs_x'; } }
  function device(){ var u=navigator.userAgent||'';
    return /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(u)?'tablet'
         :(/Mobile|iPhone|iPod|Android|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(u)?'mobile':'pc'); }
  function source(){ try{
    var kk='kd_ev_src', cached=sessionStorage.getItem(kk); if(cached) return cached;
    var qp=new URLSearchParams(location.search), s=(qp.get('utm_source')||'').toLowerCase().trim();
    if(!s){ var r=''; try{ r=document.referrer?new URL(document.referrer).hostname.replace(/^www\./,''):''; }catch(e){}
      if(!r) s='direct'; else if(/google\./.test(r)) s='google'; else if(/yahoo\./.test(r)) s='yahoo';
      else if(/insta/.test(r)) s='instagram'; else if(/face|fb\./.test(r)) s='facebook'; else if(/t\.co|twitter|x\.com/.test(r)) s='x';
      else if(/line\./.test(r)) s='line'; else if(/keydrop\.jp/.test(r)) s='internal'; else s=r||'referral'; }
    if(/insta/.test(s)) s='instagram'; if(/face|fb/.test(s)) s='facebook';
    try{ sessionStorage.setItem(kk,s);
      sessionStorage.setItem('kd_ev_camp',(qp.get('utm_campaign')||qp.get('utm_content')||'').toLowerCase().trim().slice(0,80));
      var rh=''; try{ rh=document.referrer?new URL(document.referrer).hostname.replace(/^www\./,''):''; }catch(e2){}
      sessionStorage.setItem('kd_ev_refhost',rh.slice(0,80));
    }catch(e3){}
    return s;
  }catch(e){ return 'unknown'; } }

  function send(kind,target,extra){ try{
    var body={ session_id:sid(), page:PAGE, kind:kind, target:(target||'').slice(0,120),
      area:AREA, device:device(), ref:source(),
      ref_host:(sessionStorage.getItem('kd_ev_refhost')||''), utm_campaign:(sessionStorage.getItem('kd_ev_camp')||''),
      ua:(navigator.userAgent||'').slice(0,200) };
    if(extra){ for(var k in extra){ if(extra[k]!=null) body[k]=extra[k]; } }
    fetch(SB+'/rest/v1/kd_events',{ method:'POST', keepalive:true,
      headers:{ apikey:KEY, Authorization:'Bearer '+KEY, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body:JSON.stringify(body) }).catch(function(){});
  }catch(e){} }

  function labelOf(el){ try{
    var t=el.getAttribute('data-kd'); if(t) return t.trim();
    if(el.id) return '#'+el.id;
    var al=el.getAttribute('aria-label'); if(al) return al.trim().slice(0,40);
    var tx=(el.textContent||'').replace(/\s+/g,' ').trim(); if(tx) return tx.slice(0,40);
    var img=el.querySelector&&el.querySelector('img[alt]'); if(img&&img.alt) return '['+img.alt.trim().slice(0,30)+']';
    return el.tagName ? el.tagName.toLowerCase() : 'el';
  }catch(e){ return 'el'; } }

  function onClick(e){ try{
    var el=e.target; var hit=null;
    for(var i=0;i<6 && el && el!==document.body;i++){
      if(el.matches && el.matches('a,button,[role=button],[data-kd],[onclick],summary,.cta,.card')){ hit=el; break; }
      el=el.parentElement;
    }
    if(!hit) return;
    send('click', labelOf(hit));
  }catch(err){} }

  function onExit(){ if(exited) return; exited=true;
    var dwell=Math.max(0, Math.round(((window.performance&&performance.now)?performance.now():Date.now())-t0));
    send('exit', PAGE, { dwell_ms: dwell });
  }

  window.KDT={
    init:function(opts){ try{
      opts=opts||{};
      PAGE=opts.page || (document.body&&document.body.getAttribute('data-kd-page')) || (location.pathname.split('/').pop()||'top').replace(/\.html$/,'') || 'top';
      AREA=(opts.area!=null?opts.area:(document.body&&document.body.getAttribute('data-kd-area')))||'';
      send('pv', PAGE);
      document.addEventListener('click', onClick, true);
      window.addEventListener('pagehide', onExit);
      document.addEventListener('visibilitychange', function(){ if(document.visibilityState==='hidden') onExit(); });
    }catch(e){} },
    step:function(name,no){ send('step', name, (no!=null?{step_no:no}:null)); },
    event:function(kind,target,extra){ send(kind,target,extra); },
    setArea:function(a){ AREA=a||''; }
  };
})();
