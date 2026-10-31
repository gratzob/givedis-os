/* =====================================================================
   GIVEDIS OS — Module « Analyse » + « Compte rendu mensuel »
   À charger APRÈS le script principal :  <script src="analyse.js"></script>
   Utilise les fonctions et données existantes (DB, YEAR, stats, objMois,
   ytd, objAn, calcPrime, caClientMois, tauxClient, nouveauxDuMois…).
   Aucune donnée existante n'est modifiée. Seul ajout : DB.comptesRendus
   (commentaires du responsable, par mois et par commercial).
   ===================================================================== */
(function(){
  if(typeof NAV === 'undefined' || typeof VIEWS === 'undefined'){ console.warn('analyse.js : GIVEDIS OS introuvable'); return; }

  /* ---------- Onglets ---------- */
  const tabs = NAV.pilotage.tabs;
  const iRel = tabs.findIndex(t => t.id === 'relances');
  if(!tabs.some(t => t.id === 'analyse'))
    tabs.splice(iRel >= 0 ? iRel + 1 : tabs.length, 0,
      {id:'analyse', label:'Analyse'}, {id:'compterendu', label:'Compte rendu mensuel'});

  /* ---------- Réglages (mémorisés sur ce navigateur) ---------- */
  const AN_DEF = {com:'', mk:'', seuil:15, seuilMarge:30, baisseMarge:5, joursVisite:60, filtre:'', q:'',
                  crMk:'', crCom:'', crPrime:true};
  let AN = Object.assign({}, AN_DEF);
  try{ Object.assign(AN, JSON.parse(localStorage.getItem('gos_an') || '{}')); }catch(e){}
  const anSave = () => { try{ localStorage.setItem('gos_an', JSON.stringify(AN)); }catch(e){} };
  window.AN = AN;
  window.anSet = (k, v) => { AN[k] = v; anSave(); render(); };

  /* ---------- Outils mois ---------- */
  const addM = (mk, n) => { let [y,m] = mk.split('-').map(Number); m += n;
    while(m < 1){ m += 12; y--; } while(m > 12){ m -= 12; y++; }
    return y + '-' + String(m).padStart(2,'0'); };
  const rangeM = (from, to) => { const r = []; let m = from; while(m <= to){ r.push(m); m = addM(m,1); } return r; };
  const sum = a => a.reduce((s,x) => s + (+x||0), 0);
  const varPct = (a, b) => b > 0 ? (a - b) / b * 100 : null;
  const sgn = n => (n > 0 ? '+' : '') ;

  /* Mois pour lesquels on a le détail client (fichier compta importé). */
  function moisDetail(){
    const s = new Set();
    DB.clients.forEach(c => Object.entries(c.caByMonth || {}).forEach(([m,v]) => { if(v !== null && v !== '') s.add(m); }));
    return [...s].sort();
  }
  /* Dernier mois avec détail client ≤ mk */
  function dernierDetail(mk){
    const ms = moisDetail().filter(m => m <= mk);
    return ms.length ? ms[ms.length - 1] : null;
  }
  /* Taille de la fenêtre de comparaison : 3 mois si l'historique le permet. */
  function fenetre(M){
    const set = new Set(moisDetail());
    let n = 0, m = M;
    while(set.has(m) && n < 6){ n++; m = addM(m,-1); }
    return Math.max(1, Math.min(3, Math.floor(n/2)));
  }

  /* ---------- Moteur d'analyse ---------- */
  function nouveauxIndex(){
    const idx = {};
    DB.commerciaux.forEach(co => monthsOfYear(YEAR).forEach(m => {
      try{ nouveauxDuMois(co.id, m).forEach(c => { if(!idx[c.id]) idx[c.id] = m; }); }catch(e){}
    }));
    return idx;
  }

  function analyser(M, com){
    const n = fenetre(M);
    const rec = rangeM(addM(M, -(n-1)), M);
    const prev = rangeM(addM(M, -(2*n-1)), addM(M, -n));
    const yearM = monthsOfYear(YEAR).filter(m => m <= M);
    const nvIdx = nouveauxIndex();
    const auj = todayISO();

    const visParClient = {};
    DB.visites.forEach(v => { (visParClient[v.clientId] = visParClient[v.clientId] || []).push(v); });
    Object.values(visParClient).forEach(a => a.sort((x,y) => (y.date||'').localeCompare(x.date||'')));

    const debutFen = prev[0] + '-01';
    const rows = DB.clients.filter(c => !com || c.commercial === com).map(c => {
      const caM = m => caClientMois(c, m);
      const cRec = sum(rec.map(caM)), cPrev = sum(prev.map(caM));
      const margeOf = ms => sum(ms.map(m => caM(m) * (tauxClient(c, m) || 0) / 100));
      const tRec = cRec > 0 ? margeOf(rec) / cRec * 100 : null;
      const tPrev = cPrev > 0 ? margeOf(prev) / cPrev * 100 : null;
      const achats = yearM.filter(m => caM(m) > 0);
      const lastBuy = achats.length ? achats[achats.length - 1] : null;
      const ytdCA = sum(yearM.map(caM));
      const vis = visParClient[c.id] || [];
      const lastVis = vis[0] || null;
      const visFen = vis.filter(v => (v.date||'') >= debutFen && (v.date||'') <= auj).length;
      const visAn = vis.filter(v => (v.date||'').startsWith(String(YEAR))).length;
      const nvM = nvIdx[c.id] || null;
      const yoyRec = sum(rec.map(m => caM(addM(m,-12))));

      let statut;
      if(nvM && nvM >= prev[0]) statut = 'nouveau';
      else if(!lastBuy) statut = 'inactif';
      else if(lastBuy <= addM(M, -2) && (cPrev > 0 || cRec === 0)) statut = 'decroche';
      else if(cPrev === 0 && cRec > 0) statut = 'progression';
      else {
        const v = varPct(cRec, cPrev);
        statut = v > AN.seuil ? 'progression' : v < -AN.seuil ? 'recul' : 'stable';
      }
      return {c, rec:cRec, prev:cPrev, delta:cRec - cPrev, var:varPct(cRec, cPrev), tRec, tPrev,
        lastBuy, ytd:ytdCA, nbMoisAchat:achats.length, vis, lastVis,
        joursVis: lastVis ? daysSince(lastVis.date) : null, visFen, visAn, nvM,
        yoy: yoyRec > 0 ? varPct(cRec, yoyRec) : null, statut};
    }).filter(r => r.statut !== 'inactif' || r.ytd > 0);

    const by = s => rows.filter(r => r.statut === s);
    const cats = {};
    ['progression','stable','recul','decroche','nouveau'].forEach(s => {
      const l = by(s); cats[s] = {n:l.length, rec:sum(l.map(r=>r.rec)), delta:sum(l.map(r=>r.delta))};
    });

    const hausses = rows.filter(r => r.delta > 0 && r.statut !== 'nouveau').sort((a,b) => b.delta - a.delta).slice(0,10);
    const baisses = rows.filter(r => r.delta < 0).sort((a,b) => a.delta - b.delta).slice(0,10);
    const baisseTot = -sum(rows.filter(r => r.delta < 0).map(r => r.delta));

    const alertesMarge = rows.filter(r => r.rec >= 300 && r.tRec !== null && (
        r.tRec < AN.seuilMarge || (r.tPrev !== null && r.tPrev - r.tRec >= AN.baisseMarge)))
      .sort((a,b) => ((a.tRec - (a.tPrev ?? a.tRec)) - (b.tRec - (b.tPrev ?? b.tRec))));

    const urgents = rows.filter(r => (r.statut === 'recul' || r.statut === 'decroche') &&
        (r.joursVis === null || r.joursVis > AN.joursVisite))
      .sort((a,b) => a.delta - b.delta);
    const sansRetour = rows.filter(r => r.visFen >= 4 && ['stable','recul','decroche'].includes(r.statut) && r.rec < 1500)
      .sort((a,b) => b.visFen - a.visFen);
    const ytdSorted = rows.filter(r => r.ytd > 0).sort((a,b) => b.ytd - a.ytd);
    const nTop = Math.max(5, Math.ceil(ytdSorted.length * 0.2));
    const jamaisVus = ytdSorted.slice(0, nTop).filter(r => r.visAn === 0);

    /* concentration par commercial */
    const conc = DB.commerciaux.filter(co => !com || co.id === com).map(co => {
      const l = rows.filter(r => r.c.commercial === co.id && r.ytd > 0).sort((a,b) => b.ytd - a.ytd);
      const tot = sum(l.map(r => r.ytd));
      const t5 = tot ? sum(l.slice(0,5).map(r => r.ytd)) / tot * 100 : 0;
      const t10 = tot ? sum(l.slice(0,10).map(r => r.ytd)) / tot * 100 : 0;
      return {co, tot, n:l.length, t5, t10, top:l.slice(0,5), risque: t5 > 50 ? 'bad' : t5 > 35 ? 'warn' : 'ok'};
    });

    /* nouveaux clients : recommande-t-il ? */
    const nvs = rows.filter(r => r.nvM && r.nvM < M);
    const fideles = nvs.filter(r => r.nbMoisAchat >= 2);
    const nv = {n:nvs.length, fideles:fideles.length, unique:nvs.length - fideles.length,
      taux: nvs.length ? fideles.length / nvs.length * 100 : 0,
      aRelancer: nvs.filter(r => r.nbMoisAchat < 2).sort((a,b) => b.ytd - a.ytd)};

    const res = {M, n, rec, prev, rows, cats, hausses, baisses, baisseTot, alertesMarge, urgents, sansRetour, jamaisVus, conc, nv, com};
    res.bilan = bilan(res);
    return res;
  }

  /* ---------- Bilan rédigé ---------- */
  function bilan(a){
    const per = a.n === 1 ? monthLabel(a.M) + ' comparé à ' + monthLabel(a.prev[0])
      : 'les ' + a.n + ' derniers mois (' + monthLabel(a.rec[0]) + ' → ' + monthLabel(a.M) + ') comparés aux ' + a.n + ' précédents';
    const ok = [], ko = [], prio = [];
    const C = a.cats;
    const totRec = sum(a.rows.map(r => r.rec)), totPrev = sum(a.rows.map(r => r.prev));
    const vt = varPct(totRec, totPrev);
    if(vt !== null) (vt >= 0 ? ok : ko).push(`CA clients ${vt >= 0 ? 'en hausse' : 'en baisse'} de ${pct(Math.abs(vt))} (${eur(totRec)} contre ${eur(totPrev)}).`);
    if(C.progression.n) ok.push(`${C.progression.n} client${C.progression.n>1?'s':''} en progression, pour ${sgn(C.progression.delta)}${eur(C.progression.delta)}.`);
    if(C.nouveau.n) ok.push(`${C.nouveau.n} nouveau${C.nouveau.n>1?'x':''} client${C.nouveau.n>1?'s':''} sur la période (${eur(C.nouveau.rec)} de CA).`);
    if(a.nv.n && a.nv.taux >= 50) ok.push(`${pct(a.nv.taux)} des nouveaux clients de l'année ont recommandé.`);
    if(a.hausses[0]) ok.push(`Plus forte hausse : ${a.hausses[0].c.nom} (${sgn(a.hausses[0].delta)}${eur(a.hausses[0].delta)}).`);

    if(C.recul.n) ko.push(`${C.recul.n} client${C.recul.n>1?'s':''} en recul, pour ${eur(C.recul.delta)}.`);
    if(C.decroche.n) ko.push(`${C.decroche.n} client${C.decroche.n>1?'s':''} sans commande depuis 2 mois ou plus (${eur(C.decroche.delta)}).`);
    if(a.baisses.length >= 3 && a.baisseTot > 0){
      const p3 = -sum(a.baisses.slice(0,3).map(r => r.delta)) / a.baisseTot * 100;
      if(p3 >= 30) ko.push(`3 clients concentrent ${pct(p3)} de la baisse : ${a.baisses.slice(0,3).map(r => r.c.nom).join(', ')}.`);
    }
    if(a.alertesMarge.length) ko.push(`${a.alertesMarge.length} client${a.alertesMarge.length>1?'s':''} avec une marge sous ${AN.seuilMarge} % ou en forte baisse.`);
    a.conc.filter(c => c.risque === 'bad').forEach(c => ko.push(`${c.co.nom} : forte dépendance, ses 5 premiers clients font ${pct(c.t5)} du CA.`));
    if(a.nv.n && a.nv.taux < 50) ko.push(`Seuls ${pct(a.nv.taux)} des nouveaux clients ont recommandé (${a.nv.unique} sur une seule commande).`);
    if(a.jamaisVus.length) ko.push(`${a.jamaisVus.length} gros client${a.jamaisVus.length>1?'s':''} jamais visité${a.jamaisVus.length>1?'s':''} cette année.`);

    a.urgents.slice(0,3).forEach(r => prio.push(`Visiter ${r.c.nom} (${r.statut === 'decroche' ? 'décroché' : 'en recul'}, ${r.joursVis === null ? 'jamais visité' : 'dernière visite il y a ' + r.joursVis + ' j'}).`));
    a.alertesMarge.slice(0,2).forEach(r => prio.push(`Revoir les prix de ${r.c.nom} (marge ${pct(r.tRec)}).`));
    a.nv.aRelancer.slice(0,2).forEach(r => prio.push(`Relancer ${r.c.nom}, nouveau client sans 2e commande.`));
    return {per, ok, ko, prio};
  }

  /* ---------- Rendu : petits éléments ---------- */
  const LBL = {progression:'En progression', stable:'Stable', recul:'En recul', decroche:'Décroché', nouveau:'Nouveau', inactif:'Inactif'};
  const CLS = {progression:'ok', stable:'info', recul:'warn', decroche:'bad', nouveau:'mute', inactif:'mute'};
  const ICO = {progression:'🟢', stable:'🔵', recul:'🟠', decroche:'🔴', nouveau:'⚪'};
  const tagS = s => `<span class="tag ${CLS[s]}">${LBL[s]}</span>`;
  const tagV = v => v === null ? '<span class="tag mute">—</span>'
    : `<span class="tag ${v > AN.seuil ? 'ok' : v < -AN.seuil ? 'bad' : 'info'}">${sgn(v)}${pct(v)}</span>`;
  const lnk = r => `<a href="#" onclick="anFiche('${r.c.id}');return false" style="color:inherit;text-decoration:underline dotted">${esc(r.c.nom)}</a>`;
  const comCol = () => AN.com ? '' : '<th>Commercial</th>';
  const comTd = r => AN.com ? '' : `<td>${esc(whoName(r.c.commercial))}</td>`;
  const vide = t => `<tr><td colspan="9" class="hint" style="text-align:center;padding:14px">${t}</td></tr>`;

  function tableDelta(l, titre){
    return `<div class="tw"><table><thead><tr><th>#</th><th>${titre}</th>${comCol()}<th class="num">Avant</th><th class="num">Récent</th><th class="num">Écart</th><th>Var.</th></tr></thead><tbody>
      ${l.length ? l.map((r,i) => `<tr><td>${i+1}</td><td>${lnk(r)}</td>${comTd(r)}<td class="num">${eur(r.prev)}</td><td class="num">${eur(r.rec)}</td>
        <td class="num" style="color:var(${r.delta>=0?'--ok':'--bad'},inherit);font-weight:600">${sgn(r.delta)}${eur(r.delta)}</td><td>${tagV(r.var)}</td></tr>`).join('') : vide('Aucun client')}
    </tbody></table></div>`;
  }

  function selects(){
    const ms = moisDetail().filter(m => m.startsWith(String(YEAR)));
    return `<div class="btnrow" style="gap:8px;flex-wrap:wrap;align-items:center">
      <select style="width:auto" onchange="anSet('com',this.value)">
        <option value="">Toute l'équipe</option>
        ${DB.commerciaux.map(c => `<option value="${c.id}" ${AN.com===c.id?'selected':''}>${esc(c.nom)}</option>`).join('')}
      </select>
      <select style="width:auto" onchange="anSet('mk',this.value)">
        ${ms.slice().reverse().map(m => `<option value="${m}" ${anMois()===m?'selected':''}>${monthLabel(m)}</option>`).join('')}
      </select>
      <button class="btn ghost sm" onclick="anReglages()">⚙ Seuils</button>
    </div>`;
  }
  function anMois(){
    const ms = moisDetail().filter(m => m.startsWith(String(YEAR)) && m <= dashMonth());
    if(AN.mk && ms.includes(AN.mk)) return AN.mk;
    return ms.length ? ms[ms.length - 1] : null;
  }

  /* ---------- Vue Analyse ---------- */
  VIEWS['pilotage:analyse'] = () => {
    const M = anMois();
    if(!M) return `<div class="card">${emptyState('📊', "Aucun chiffre client pour l'exercice " + YEAR + ". Importe le fichier compta (Données → Chiffres compta) pour activer l'analyse.")}</div>`;
    const a = analyser(M, AN.com);
    window.__AN_LAST = a;
    const C = a.cats;

    const kpi = s => `<div class="kpi ${s==='progression'?'ok':s==='recul'||s==='decroche'?'bad':'info'}" style="cursor:pointer;${AN.filtre===s?'outline:2px solid var(--accent,#4d9bff)':''}" onclick="anSet('filtre', AN.filtre==='${s}'?'':'${s}');setTimeout(()=>document.getElementById('anListe')?.scrollIntoView({behavior:'smooth'}),60)">
        <div class="lab">${ICO[s]} ${LBL[s]}</div><div class="val">${C[s].n}</div>
        <div class="sub">${eur(C[s].rec)} récents · <b>${sgn(C[s].delta)}${eur(C[s].delta)}</b></div></div>`;

    const liste = a.rows.filter(r => r.statut !== 'inactif')
      .filter(r => !AN.filtre || r.statut === AN.filtre)
      .filter(r => !AN.q || normKey(r.c.nom).includes(normKey(AN.q)))
      .sort((x,y) => AN.filtre === 'progression' ? y.delta - x.delta : x.delta - y.delta);

    return `
    <div class="card" style="background:linear-gradient(135deg,var(--panel),var(--panel2))">
      <div class="card-h" style="flex-wrap:wrap;gap:10px"><div>
        <div class="eyebrow">Analyse clients · ${AN.com ? esc(whoName(AN.com)) : "Toute l'équipe"}</div>
        <h2 style="font-size:24px;margin:2px 0">${monthLabel(M)}</h2>
        <p class="hint">Comparaison : ${a.bilan.per}. Détail client disponible jusqu'à ${monthLabel(moisDetail().slice(-1)[0])}.</p>
      </div>${selects()}</div>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-h"><h3>✅ Ce qui va</h3></div>
        ${a.bilan.ok.length ? '<ul style="margin:0;padding-left:18px;line-height:1.7">' + a.bilan.ok.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<p class="hint">Rien de marquant.</p>'}</div>
      <div class="card"><div class="card-h"><h3>⚠️ Ce qui ne va pas</h3></div>
        ${a.bilan.ko.length ? '<ul style="margin:0;padding-left:18px;line-height:1.7">' + a.bilan.ko.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<p class="hint">Aucun signal négatif.</p>'}</div>
    </div>
    ${a.bilan.prio.length ? `<div class="note warn" style="margin-top:16px"><b>Priorités :</b> ${a.bilan.prio.map(esc).join(' · ')}</div>` : ''}

    <div class="grid g-auto" style="margin-top:16px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      ${['progression','stable','recul','decroche','nouveau'].map(kpi).join('')}
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-h"><h3>📈 Ce qui tire le CA vers le haut</h3></div>${tableDelta(a.hausses, 'Client')}</div>
      <div class="card"><div class="card-h"><h3>📉 Ce qui tire le CA vers le bas</h3></div>${tableDelta(a.baisses, 'Client')}</div>
    </div>

    <div class="card" style="margin-top:16px"><div class="card-h"><h3>💶 Alertes marge</h3>
      <span class="hint">taux sous ${AN.seuilMarge} % ou en baisse de ${AN.baisseMarge} pts et plus (clients ≥ 300 € sur la période)</span></div>
      <div class="tw"><table><thead><tr><th>Client</th>${comCol()}<th class="num">CA récent</th><th>Var. CA</th><th class="num">Marge avant</th><th class="num">Marge récente</th><th class="num">Écart</th></tr></thead><tbody>
      ${a.alertesMarge.length ? a.alertesMarge.slice(0,15).map(r => `<tr><td>${lnk(r)}</td>${comTd(r)}<td class="num">${eur(r.rec)}</td><td>${tagV(r.var)}</td>
        <td class="num">${r.tPrev===null?'—':pct(r.tPrev)}</td><td class="num"><span class="tag ${r.tRec<AN.seuilMarge?'bad':'warn'}">${pct(r.tRec)}</span></td>
        <td class="num">${r.tPrev===null?'—':sgn(r.tRec-r.tPrev)+num(r.tRec-r.tPrev)+' pts'}</td></tr>`).join('') : vide('Aucune alerte marge 👍')}
      </tbody></table></div></div>

    <div class="card" style="margin-top:16px"><div class="card-h"><h3>🚗 Visites × CA</h3></div>
      <div class="grid g3">
        <div><h4 style="margin:0 0 8px">🔴 À visiter en urgence <span class="tag bad">${a.urgents.length}</span></h4>
          <p class="hint" style="margin-top:0">En recul ou décroché, pas de visite depuis plus de ${AN.joursVisite} j.</p>
          <div class="tw"><table><tbody>${a.urgents.length ? a.urgents.slice(0,12).map(r => `<tr><td>${lnk(r)}<div class="hint">${esc(whoName(r.c.commercial))} · ${r.joursVis===null?'jamais visité':r.joursVis+' j'}</div></td><td class="num">${eur(r.delta)}</td></tr>`).join('') : vide('Aucun')}</tbody></table></div></div>
        <div><h4 style="margin:0 0 8px">🟠 Beaucoup de visites, peu de retour <span class="tag warn">${a.sansRetour.length}</span></h4>
          <p class="hint" style="margin-top:0">4 visites ou plus sur la période, sans progression.</p>
          <div class="tw"><table><tbody>${a.sansRetour.length ? a.sansRetour.slice(0,12).map(r => `<tr><td>${lnk(r)}<div class="hint">${esc(whoName(r.c.commercial))} · ${r.visFen} visites</div></td><td class="num">${eur(r.rec)}</td></tr>`).join('') : vide('Aucun')}</tbody></table></div></div>
        <div><h4 style="margin:0 0 8px">⚪ Gros clients jamais visités <span class="tag info">${a.jamaisVus.length}</span></h4>
          <p class="hint" style="margin-top:0">Dans les 20 % premiers clients, aucune visite en ${YEAR}.</p>
          <div class="tw"><table><tbody>${a.jamaisVus.length ? a.jamaisVus.slice(0,12).map(r => `<tr><td>${lnk(r)}<div class="hint">${esc(whoName(r.c.commercial))}</div></td><td class="num">${eur(r.ytd)}</td></tr>`).join('') : vide('Aucun 👍')}</tbody></table></div></div>
      </div>
      <p class="hint" style="margin-bottom:0">Pour planifier ces actions, va dans <a href="#" onclick="go('pilotage','relances');return false">Relances & dormants</a>.</p>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-h"><h3>🎯 Dépendance aux gros clients</h3><span class="hint">CA cumulé ${YEAR}</span></div>
        ${a.conc.map(c => `<div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center"><b>${esc(c.co.nom)}</b>
          <span class="tag ${c.risque}">${c.risque==='bad'?'Risque élevé':c.risque==='warn'?'À surveiller':'Bien réparti'}</span></div>
          <div class="sub hint">${c.n} clients actifs · ${eur(c.tot)}</div>
          <div class="hint" style="margin-top:6px">Top 5 : ${pct(c.t5)}</div><div class="bar"><i class="${c.risque==='ok'?'ok':'bad'}" style="width:${Math.min(100,c.t5)}%"></i></div>
          <div class="hint" style="margin-top:6px">Top 10 : ${pct(c.t10)}</div><div class="bar"><i style="width:${Math.min(100,c.t10)}%"></i></div>
          <div class="hint" style="margin-top:6px">${c.top.map(r => esc(r.c.nom)).join(' · ')}</div></div>`).join('')}
      </div>
      <div class="card"><div class="card-h"><h3>🌱 Nouveaux clients : ont-ils recommandé ?</h3></div>
        <div class="grid g3" style="margin-bottom:12px">
          <div class="kpi info"><div class="lab">Nouveaux ${YEAR}</div><div class="val">${a.nv.n}</div></div>
          <div class="kpi ok"><div class="lab">Ont recommandé</div><div class="val">${a.nv.fideles}</div><div class="sub">${pct(a.nv.taux)}</div></div>
          <div class="kpi bad"><div class="lab">Une seule commande</div><div class="val">${a.nv.unique}</div></div>
        </div>
        <div class="tw" style="max-height:260px;overflow:auto"><table><thead><tr><th>À relancer</th>${comCol()}<th>Ouvert</th><th class="num">CA</th></tr></thead><tbody>
          ${a.nv.aRelancer.length ? a.nv.aRelancer.slice(0,30).map(r => `<tr><td>${lnk(r)}</td>${comTd(r)}<td>${monthLabel(r.nvM)}</td><td class="num">${eur(r.ytd)}</td></tr>`).join('') : vide('Tous ont recommandé 👍')}
        </tbody></table></div>
      </div>
    </div>

    <div class="card" id="anListe" style="margin-top:16px"><div class="card-h" style="flex-wrap:wrap;gap:8px"><h3>Tous les clients <span class="tag mute">${liste.length}</span></h3>
      <div class="chiprow">${['','progression','stable','recul','decroche','nouveau'].map(s => `<span class="chip ${AN.filtre===s?'on':''}" onclick="anSet('filtre','${s}')">${s?ICO[s]+' '+LBL[s]:'Tous'}</span>`).join('')}</div>
      <input placeholder="Rechercher un client…" value="${esc(AN.q)}" style="width:200px" onchange="anSet('q',this.value)"></div>
      <div class="tw" style="max-height:520px;overflow:auto"><table><thead><tr><th>Client</th>${comCol()}<th>Statut</th><th class="num">Avant</th><th class="num">Récent</th><th class="num">Écart</th><th>Var.</th><th class="num">Marge</th><th class="num">Cumul ${YEAR}</th><th>Dernière visite</th></tr></thead><tbody>
        ${liste.length ? liste.map(r => `<tr style="cursor:pointer" onclick="anFiche('${r.c.id}')"><td>${esc(r.c.nom)}</td>${comTd(r)}<td>${tagS(r.statut)}</td>
          <td class="num">${eur(r.prev)}</td><td class="num">${eur(r.rec)}</td><td class="num">${sgn(r.delta)}${eur(r.delta)}</td><td>${tagV(r.var)}</td>
          <td class="num">${r.tRec===null?'—':pct(r.tRec)}</td><td class="num">${eur(r.ytd)}</td><td>${r.lastVis?fdate(r.lastVis.date):'<span class="hint">jamais</span>'}</td></tr>`).join('') : vide('Aucun client')}
      </tbody></table></div>
    </div>`;
  };

  /* ---------- Fiche client ---------- */
  window.anFiche = id => {
    const a = window.__AN_LAST || analyser(anMois(), '');
    let r = a.rows.find(x => x.c.id === id);
    if(!r){ const tmp = analyser(a.M, ''); r = tmp.rows.find(x => x.c.id === id); }
    if(!r) return;
    const c = r.c;
    const ms = monthsOfYear(YEAR).filter(m => m <= a.M);
    const vals = ms.map(m => caClientMois(c, m));
    const max = Math.max(1, ...vals);
    const W = 520, H = 140, bw = W / ms.length;
    const svg = `<svg viewBox="0 0 ${W} ${H+22}" style="width:100%;height:auto">
      ${vals.map((v,i) => { const h = v / max * H; const recent = a.rec.includes(ms[i]);
        return `<rect x="${i*bw+4}" y="${H-h}" width="${bw-8}" height="${h}" rx="3" fill="${recent?'#4d9bff':'#4d9bff66'}"><title>${monthLabel(ms[i])} : ${eur(v)}</title></rect>
        <text x="${i*bw+bw/2}" y="${H+15}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">${monthLabel(ms[i]).split(' ')[0]}</text>`; }).join('')}
    </svg>`;
    const diag = ({
      progression: `En progression de ${r.var===null?'—':pct(r.var)} (${sgn(r.delta)}${eur(r.delta)}). Client à consolider.`,
      stable: `Stable (${r.var===null?'—':sgn(r.var)+pct(r.var)}). ${r.joursVis>AN.joursVisite||r.joursVis===null?'Pas vu depuis longtemps : une visite de suivi entretiendrait la relation.':'Suivi régulier en place.'}`,
      recul: `En recul de ${pct(Math.abs(r.var||0))} (${eur(r.delta)}). ${r.joursVis===null||r.joursVis>AN.joursVisite?'Aucune visite récente : à visiter rapidement.':'Visité récemment : identifier la cause (prix, concurrence, chantier terminé).'}`,
      decroche: `Plus de commande depuis ${monthLabel(r.lastBuy)}. ${r.joursVis===null?'Jamais visité.':'Dernière visite il y a '+r.joursVis+' j.'} Client à reconquérir.`,
      nouveau: `Nouveau client (${monthLabel(r.nvM)}). ${r.nbMoisAchat>=2?'A déjà recommandé.':'Pas encore de 2e commande : à relancer.'}`,
      inactif: 'Aucun achat cette année.'
    })[r.statut];
    const margeAlert = r.tRec !== null && (r.tRec < AN.seuilMarge || (r.tPrev !== null && r.tPrev - r.tRec >= AN.baisseMarge));
    openModal(`
      <div class="card-h"><div><div class="eyebrow">${esc(whoName(c.commercial))}${c.reseau?' · '+esc(c.reseau):''}</div>
        <h2 style="margin:2px 0">${esc(c.nom)}</h2></div><button class="btn ghost sm" onclick="closeModal()">✕</button></div>
      <div style="margin:6px 0 12px">${tagS(r.statut)} ${margeAlert?'<span class="tag bad">Marge à surveiller</span>':''}</div>
      <div class="note ${CLS[r.statut]==='bad'?'warn':CLS[r.statut]==='ok'?'ok':''}">${esc(diag)}</div>
      <div class="grid g4" style="margin:14px 0">
        <div class="kpi"><div class="lab">Cumul ${YEAR}</div><div class="val" style="font-size:20px">${eur(r.ytd)}</div></div>
        <div class="kpi"><div class="lab">Récent / avant</div><div class="val" style="font-size:20px">${eur(r.rec)}</div><div class="sub">avant ${eur(r.prev)}</div></div>
        <div class="kpi"><div class="lab">Marge</div><div class="val" style="font-size:20px">${r.tRec===null?'—':pct(r.tRec)}</div><div class="sub">avant ${r.tPrev===null?'—':pct(r.tPrev)}</div></div>
        <div class="kpi"><div class="lab">Visites ${YEAR}</div><div class="val" style="font-size:20px">${r.visAn}</div><div class="sub">${r.lastVis?'dernière '+fdate(r.lastVis.date):'jamais'}</div></div>
      </div>
      <h4 style="margin:0 0 6px">CA mensuel ${YEAR}</h4>${svg}
      <h4 style="margin:14px 0 6px">Dernières visites</h4>
      <div class="tw"><table><thead><tr><th>Date</th><th>Type</th><th>Résultat</th><th>Compte rendu</th></tr></thead><tbody>
        ${r.vis.length ? r.vis.slice(0,6).map(v => `<tr><td>${fdate(v.date)}</td><td>${esc(v.type||'')}</td><td>${esc(v.resultat||'')}</td><td class="hint">${esc((v.compteRendu||'').slice(0,90))}</td></tr>`).join('') : vide('Aucune visite enregistrée')}
      </tbody></table></div>`);
  };

  window.anReglages = () => openModal(`
    <div class="card-h"><h3>Seuils de l'analyse</h3><button class="btn ghost sm" onclick="closeModal()">✕</button></div>
    <div class="grid g2">
      <div class="field"><label class="f">Progression / recul à partir de (%)</label><input type="number" id="an_s" value="${AN.seuil}"></div>
      <div class="field"><label class="f">Marge minimale (%)</label><input type="number" id="an_m" value="${AN.seuilMarge}"></div>
      <div class="field"><label class="f">Baisse de marge alertée (points)</label><input type="number" id="an_b" value="${AN.baisseMarge}"></div>
      <div class="field"><label class="f">Visite urgente au-delà de (jours)</label><input type="number" id="an_j" value="${AN.joursVisite}"></div>
    </div>
    <div class="btnrow" style="margin-top:12px"><button class="btn" onclick="
      AN.seuil=+an_s.value||15;AN.seuilMarge=+an_m.value||30;AN.baisseMarge=+an_b.value||5;AN.joursVisite=+an_j.value||60;
      localStorage.setItem('gos_an',JSON.stringify(AN));closeModal();render()">Enregistrer</button>
      <button class="btn ghost" onclick="Object.assign(AN,{seuil:15,seuilMarge:30,baisseMarge:5,joursVisite:60});localStorage.setItem('gos_an',JSON.stringify(AN));closeModal();render()">Valeurs par défaut</button></div>`);

  /* =====================================================================
     COMPTE RENDU MENSUEL
     ===================================================================== */
  function crMois(){
    const ms = monthsOfYear(YEAR).filter(m => m <= dashMonth());
    if(AN.crMk && ms.includes(AN.crMk)) return AN.crMk;
    /* par défaut : le dernier mois terminé */
    const cur = curMonth();
    const def = ms.filter(m => m < cur);
    return def.length ? def[def.length-1] : ms[ms.length-1];
  }
  const crCle = (mk, com) => mk + '|' + com;
  window.crComment = (mk, com, val) => {
    DB.comptesRendus = DB.comptesRendus || {};
    DB.comptesRendus[crCle(mk, com)] = val;
    try{ save(); toast('Commentaire enregistré', 'ok'); }catch(e){}
  };
  const crGet = (mk, com) => ((DB.comptesRendus || {})[crCle(mk, com)] || '');

  function crData(com, mk){
    const y = mk.slice(0,4), mo = +mk.slice(5,7);
    const s = stats(com, mk);
    const o = objMois(com, mk) || {ca:0, marge:0};
    const sPrev = stats(com, addM(mk,-1));
    const sN1 = stats(com, addM(mk,-12));
    const cum = ytd(com, y, mo), cum1 = ytd(com, String(+y-1), mo);
    const oa = objAn(com, y) || {ca:0};
    const vis = DB.visites.filter(v => v.commercial === com && monthKey(v.date) === mk);
    const parType = {}, parRes = {};
    vis.forEach(v => { parType[v.type||'Autre'] = (parType[v.type||'Autre']||0)+1; parRes[v.resultat||'—'] = (parRes[v.resultat||'—']||0)+1; });
    const Md = dernierDetail(mk);
    const a = Md ? analyser(Md, com) : null;
    const top = Md ? DB.clients.filter(c => c.commercial === com).map(c => ({c, ca:caClientMois(c, Md)}))
      .filter(x => x.ca > 0).sort((x,z) => z.ca - x.ca).slice(0,5) : [];
    let prime = null; try{ prime = calcPrime(com, mk); }catch(e){}
    let nvx = []; try{ nvx = nouveauxDuMois(com, mk); }catch(e){}
    const synth = synthese({s, o, sPrev, sN1, cum, cum1, oa, a, vis, nvx});
    return {com, nom:whoName(com), mk, s, o, sPrev, sN1, cum, cum1, oa, vis, parType, parRes, Md, a, top, prime, nvx, synth};
  }

  function synthese(d){
    const pts = [], vig = [], prio = [];
    const att = d.o.ca ? d.s.ca / d.o.ca * 100 : null;
    if(att !== null) (att >= 100 ? pts : vig).push(`Objectif du mois ${att >= 100 ? 'atteint' : 'non atteint'} : ${pct(att)} (${eur(d.s.ca)} pour ${eur(d.o.ca)}).`);
    const vN1 = varPct(d.s.ca, d.sN1.ca);
    if(vN1 !== null) (vN1 >= 0 ? pts : vig).push(`CA ${vN1 >= 0 ? 'en hausse' : 'en baisse'} de ${pct(Math.abs(vN1))} par rapport au même mois de l'an dernier.`);
    const vC = varPct(d.cum.ca, d.cum1.ca);
    if(vC !== null) (vC >= 0 ? pts : vig).push(`Cumul depuis janvier : ${eur(d.cum.ca)}, soit ${sgn(vC)}${pct(vC)} sur un an.`);
    if(d.oa.ca){ const aa = d.cum.ca / d.oa.ca * 100; pts.push(`${pct(aa)} de l'objectif annuel déjà réalisé.`); }
    if(d.s.txmarge) (d.s.txmarge >= AN.seuilMarge ? pts : vig).push(`Taux de marge du mois : ${pct(d.s.txmarge)}.`);
    if(d.nvx.length) pts.push(`${d.nvx.length} nouveau${d.nvx.length>1?'x':''} client${d.nvx.length>1?'s':''} ouvert${d.nvx.length>1?'s':''}.`);
    if(d.a){
      const C = d.a.cats;
      if(C.recul.n || C.decroche.n) vig.push(`${C.recul.n} client(s) en recul et ${C.decroche.n} décroché(s) (${eur(C.recul.delta + C.decroche.delta)}).`);
      if(d.a.alertesMarge.length) vig.push(`${d.a.alertesMarge.length} client(s) avec une marge à surveiller.`);
      d.a.bilan.prio.forEach(p => prio.push(p));
    }
    return {pts, vig, prio};
  }

  function crCarte(d, editable){
    const att = d.o.ca ? d.s.ca / d.o.ca * 100 : 0;
    const vN1 = varPct(d.s.ca, d.sN1.ca), vM1 = varPct(d.s.ca, d.sPrev.ca), vC = varPct(d.cum.ca, d.cum1.ca);
    const li = l => l.length ? '<ul style="margin:0;padding-left:18px;line-height:1.7">' + l.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<p class="hint">—</p>';
    const C = d.a ? d.a.cats : null;
    return `<div class="card" style="margin-top:16px">
      <div class="card-h"><div><div class="eyebrow">Compte rendu · ${monthLabel(d.mk)}</div><h2 style="margin:2px 0">${esc(d.nom)}</h2></div>
        <button class="btn sm" onclick="crPDF('${d.com}')">⬇ PDF ${esc(d.nom)}</button></div>
      <div class="grid g4">
        <div class="kpi ${att>=100?'ok':'bad'}"><div class="lab">CA du mois</div><div class="val">${eur(d.s.ca)}</div><div class="sub">objectif ${eur(d.o.ca)} · ${pct(att)}</div>
          <div class="bar"><i class="${att>=100?'ok':'bad'}" style="width:${Math.min(100,att)}%"></i></div></div>
        <div class="kpi info"><div class="lab">Marge</div><div class="val">${eur(d.s.marge)}</div><div class="sub">taux ${pct(d.s.txmarge)}</div></div>
        <div class="kpi"><div class="lab">Évolution</div><div class="val" style="font-size:20px">${vN1===null?'—':sgn(vN1)+pct(vN1)}</div><div class="sub">vs ${monthLabel(addM(d.mk,-12))} · ${vM1===null?'—':sgn(vM1)+pct(vM1)} vs mois préc.</div></div>
        <div class="kpi"><div class="lab">Cumul ${d.mk.slice(0,4)}</div><div class="val" style="font-size:20px">${eur(d.cum.ca)}</div><div class="sub">${vC===null?'':sgn(vC)+pct(vC)+' vs N-1 · '}${d.oa.ca?pct(d.cum.ca/d.oa.ca*100)+' obj. annuel':''}</div></div>
      </div>
      <div class="grid g3" style="margin-top:14px">
        <div><h4 style="margin:0 0 6px">Activité</h4>
          <p style="margin:0">${d.vis.length} visites · ${d.nvx.length} nouveau(x) client(s)</p>
          <p class="hint" style="margin:4px 0 0">${Object.entries(d.parType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>esc(k)+' : '+v).join(' · ') || '—'}</p>
          <p class="hint" style="margin:4px 0 0">${Object.entries(d.parRes).sort((a,b)=>b[1]-a[1]).map(([k,v])=>esc(k)+' : '+v).join(' · ')}</p></div>
        <div><h4 style="margin:0 0 6px">Top 5 clients ${d.Md?'('+monthLabel(d.Md)+')':''}</h4>
          ${d.top.length ? d.top.map((x,i) => `<div style="display:flex;justify-content:space-between"><span>${i+1}. ${esc(x.c.nom)}</span><b>${eur(x.ca)}</b></div>`).join('') : '<p class="hint">Détail client non disponible</p>'}</div>
        <div><h4 style="margin:0 0 6px">Portefeuille</h4>
          ${C ? ['progression','stable','recul','decroche','nouveau'].map(s => `<div style="display:flex;justify-content:space-between"><span>${ICO[s]} ${LBL[s]}</span><b>${C[s].n}</b></div>`).join('') : '<p class="hint">—</p>'}</div>
      </div>
      ${d.Md && d.Md !== d.mk ? `<p class="note" style="margin-top:12px">Le détail par client s'arrête à ${monthLabel(d.Md)} (dernier fichier compta importé). Les chiffres du mois viennent de la saisie et des chiffres officiels.</p>` : ''}
      <div class="grid g3" style="margin-top:14px">
        <div><h4 style="margin:0 0 6px">✅ Points forts</h4>${li(d.synth.pts)}</div>
        <div><h4 style="margin:0 0 6px">⚠️ Points de vigilance</h4>${li(d.synth.vig)}</div>
        <div><h4 style="margin:0 0 6px">🎯 Priorités du mois suivant</h4>${li(d.synth.prio)}</div>
      </div>
      ${AN.crPrime && d.prime ? `<div style="margin-top:14px"><h4 style="margin:0 0 6px">Prime estimée : ${eur(d.prime.total)}</h4>
        <div class="chiprow">${(d.prime.lignes||[]).filter(l => l.actif).map(l => `<span class="tag ${(l.montant_du||0)>0?'ok':'mute'}">${esc(l.label)} : ${eur(l.montant_du||0)}</span>`).join(' ')}</div></div>` : ''}
      <div style="margin-top:14px"><label class="f">Commentaire du responsable (repris dans le PDF)</label>
        <textarea rows="3" ${editable?'':'disabled'} placeholder="Ton avis sur le mois, le contexte, les actions engagées…" onchange="crComment('${d.mk}','${d.com}',this.value)">${esc(crGet(d.mk, d.com))}</textarea></div>
    </div>`;
  }

  VIEWS['pilotage:compterendu'] = () => {
    const mk = crMois();
    const coms = DB.commerciaux.filter(c => c.actif !== false && (!AN.crCom || c.id === AN.crCom));
    const datas = coms.map(c => crData(c.id, mk));
    window.__CR_LAST = {mk, datas};
    const tot = {ca:sum(datas.map(d=>d.s.ca)), obj:sum(datas.map(d=>d.o.ca)), marge:sum(datas.map(d=>d.s.marge)), vis:sum(datas.map(d=>d.vis.length))};
    return `
    <div class="card" style="background:linear-gradient(135deg,var(--panel),var(--panel2))">
      <div class="card-h" style="flex-wrap:wrap;gap:10px"><div>
        <div class="eyebrow">Compte rendu mensuel pour la direction</div>
        <h2 style="font-size:24px;margin:2px 0">${monthLabel(mk)}</h2>
        <p class="hint">Relis, ajoute ton commentaire, puis exporte en PDF.</p></div>
        <div class="btnrow" style="gap:8px;flex-wrap:wrap;align-items:center">
          <select style="width:auto" onchange="anSet('crMk',this.value)">${monthsOfYear(YEAR).filter(m => m <= dashMonth()).reverse().map(m => `<option value="${m}" ${m===mk?'selected':''}>${monthLabel(m)}</option>`).join('')}</select>
          <select style="width:auto" onchange="anSet('crCom',this.value)"><option value="">Toute l'équipe</option>
            ${DB.commerciaux.map(c => `<option value="${c.id}" ${AN.crCom===c.id?'selected':''}>${esc(c.nom)}</option>`).join('')}</select>
          <label class="hint" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" style="width:auto" ${AN.crPrime?'checked':''} onchange="anSet('crPrime',this.checked)"> Inclure les primes</label>
          <button class="btn" onclick="crPDF()">⬇ Exporter ${AN.crCom ? 'le PDF' : 'le PDF équipe'}</button>
        </div></div>
    </div>
    ${!AN.crCom && datas.length > 1 ? `<div class="grid g4" style="margin-top:16px">
      <div class="kpi ${tot.ca>=tot.obj?'ok':'bad'}"><div class="lab">CA équipe</div><div class="val">${eur(tot.ca)}</div><div class="sub">objectif ${eur(tot.obj)} · ${pct(tot.obj?tot.ca/tot.obj*100:0)}</div></div>
      <div class="kpi info"><div class="lab">Marge équipe</div><div class="val">${eur(tot.marge)}</div><div class="sub">taux ${pct(tot.ca?tot.marge/tot.ca*100:0)}</div></div>
      <div class="kpi"><div class="lab">Visites</div><div class="val">${tot.vis}</div></div>
      <div class="kpi"><div class="lab">Nouveaux clients</div><div class="val">${sum(datas.map(d=>d.nvx.length))}</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Commentaire général (page équipe)</h3></div>
        <textarea rows="3" placeholder="Synthèse globale du mois pour la direction…" onchange="crComment('${mk}','_equipe',this.value)">${esc(crGet(mk,'_equipe'))}</textarea></div>` : ''}
    ${datas.map(d => crCarte(d, true)).join('')}`;
  };

  /* ---------- Export PDF ---------- */
  const P = {
    eur: n => Math.round(Number(n)||0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' EUR',
    pct: n => (Math.round((Number(n)||0)*10)/10).toString().replace('.', ',') + ' %',
    v: n => n === null || !isFinite(n) ? '-' : (n > 0 ? '+' : '') + (Math.round(n*10)/10).toString().replace('.', ',') + ' %'
  };
  const T = s => clean(String(s).replace(/€/g,'EUR').replace(/[’]/g,"'").replace(/→/g,'->').replace(/[  ]/g,' '));

  function pdfBloc(doc, y, titre){
    if(y > 262){ doc.addPage(); y = 18; }
    doc.setFontSize(11); doc.setFont(undefined,'bold'); doc.setTextColor(31,51,82);
    doc.text(T(titre), 14, y); doc.setFont(undefined,'normal'); doc.setTextColor(40,40,40);
    return y + 3;
  }
  function pdfTexte(doc, y, lignes, puce){
    doc.setFontSize(9); doc.setTextColor(40,40,40);
    lignes.forEach(l => {
      const w = doc.splitTextToSize(T((puce ? '- ' : '') + l), 180);
      if(y + w.length*4.4 > 285){ doc.addPage(); y = 18; }
      doc.text(w, 14, y); y += w.length * 4.4 + 1;
    });
    return y;
  }
  function pdfKpis(doc, y, items){
    const w = (182 - (items.length-1)*4) / items.length;
    items.forEach((it, i) => {
      const x = 14 + i*(w+4);
      doc.setFillColor(244,248,255); doc.roundedRect(x, y, w, 22, 2, 2, 'F');
      doc.setFillColor(...(it.c === 'ok' ? [46,160,90] : it.c === 'bad' ? [210,70,70] : [77,155,255])); doc.rect(x, y, 1.6, 22, 'F');
      doc.setFontSize(7.5); doc.setTextColor(110,120,140); doc.text(T(it.l).toUpperCase(), x+4, y+5.5);
      doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(20,30,50); doc.text(T(it.v), x+4, y+13);
      doc.setFont(undefined,'normal'); doc.setFontSize(7.5); doc.setTextColor(110,120,140);
      doc.text(doc.splitTextToSize(T(it.s||''), w-6)[0] || '', x+4, y+18.5);
    });
    return y + 28;
  }

  function pdfCommercial(doc, d, premier){
    if(!premier) doc.addPage();
    pdfHead(doc, 'Compte rendu mensuel - ' + monthLabel(d.mk), d.nom + ' - edite le ' + fdate(todayISO()));
    const att = d.o.ca ? d.s.ca / d.o.ca * 100 : 0;
    let y = pdfKpis(doc, 40, [
      {l:'CA du mois', v:P.eur(d.s.ca), s:'obj. ' + P.eur(d.o.ca) + ' - ' + P.pct(att), c: att >= 100 ? 'ok' : 'bad'},
      {l:'Marge', v:P.eur(d.s.marge), s:'taux ' + P.pct(d.s.txmarge)},
      {l:'Visites', v:String(d.vis.length), s:d.nvx.length + ' nouveau(x) client(s)'},
      {l:'Cumul ' + d.mk.slice(0,4), v:P.eur(d.cum.ca), s: d.oa.ca ? P.pct(d.cum.ca/d.oa.ca*100) + ' obj. annuel' : ''}
    ]);
    y = pdfBloc(doc, y, 'Indicateurs');
    doc.autoTable({startY:y, head:[['Indicateur','Valeur','Comparaison']], body:[
      ['CA du mois', P.eur(d.s.ca), 'objectif ' + P.eur(d.o.ca) + ' (' + P.pct(att) + ')'],
      ['vs mois precedent', P.eur(d.sPrev.ca), P.v(varPct(d.s.ca, d.sPrev.ca))],
      ['vs meme mois N-1', P.eur(d.sN1.ca), P.v(varPct(d.s.ca, d.sN1.ca))],
      ['Marge / taux', P.eur(d.s.marge), P.pct(d.s.txmarge)],
      ['Cumul depuis janvier', P.eur(d.cum.ca), 'N-1 : ' + P.eur(d.cum1.ca) + ' (' + P.v(varPct(d.cum.ca, d.cum1.ca)) + ')'],
      ['Objectif annuel', P.eur(d.oa.ca), d.oa.ca ? P.pct(d.cum.ca/d.oa.ca*100) + ' realise' : '-'],
      ['Visites', String(d.vis.length), T(Object.entries(d.parType).map(([k,v]) => k + ' ' + v).join(', ') || '-')],
      ['Resultats des visites', '', T(Object.entries(d.parRes).map(([k,v]) => k + ' ' + v).join(', ') || '-')],
      ['Nouveaux clients', String(d.nvx.length), T(d.nvx.slice(0,6).map(c => c.nom).join(', '))]
    ], ...TBL, columnStyles:{0:{fontStyle:'bold', cellWidth:45}, 1:{cellWidth:32, halign:'right'}}});
    y = doc.lastAutoTable.finalY + 8;

    if(d.a){
      const C = d.a.cats;
      y = pdfBloc(doc, y, 'Portefeuille clients' + (d.Md !== d.mk ? ' (detail compta jusqu\'a ' + monthLabel(d.Md) + ')' : ''));
      doc.autoTable({startY:y, head:[['Statut','Clients','CA recent','Ecart']], body:
        ['progression','stable','recul','decroche','nouveau'].map(s => [T(LBL[s]), String(C[s].n), P.eur(C[s].rec), (C[s].delta>0?'+':'') + P.eur(C[s].delta)]),
        ...TBL, columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'}}});
      y = doc.lastAutoTable.finalY + 6;
      const lignes = [];
      d.top.forEach((x,i) => lignes.push(['Top ' + (i+1), T(x.c.nom), P.eur(x.ca)]));
      d.a.hausses.slice(0,3).forEach(r => lignes.push(['En hausse', T(r.c.nom), '+' + P.eur(r.delta)]));
      d.a.baisses.slice(0,5).forEach(r => lignes.push([r.statut === 'decroche' ? 'Decroche' : 'En baisse', T(r.c.nom), P.eur(r.delta)]));
      d.a.alertesMarge.slice(0,3).forEach(r => lignes.push(['Marge', T(r.c.nom), P.pct(r.tRec) + (r.tPrev !== null ? ' (avant ' + P.pct(r.tPrev) + ')' : '')]));
      if(lignes.length){
        if(y > 240){ doc.addPage(); y = 18; }
        doc.autoTable({startY:y, head:[['','Client','Montant']], body:lignes, ...TBL, columnStyles:{0:{cellWidth:28, fontStyle:'bold'}, 2:{halign:'right'}}});
        y = doc.lastAutoTable.finalY + 8;
      }
    }

    y = pdfBloc(doc, y, 'Synthese'); y += 3;
    if(d.synth.pts.length){ doc.setFont(undefined,'bold'); doc.setFontSize(9); doc.text('Points forts', 14, y); doc.setFont(undefined,'normal'); y = pdfTexte(doc, y+4.5, d.synth.pts, true) + 1; }
    if(d.synth.vig.length){ if(y > 278){ doc.addPage(); y = 18; } doc.setFont(undefined,'bold'); doc.setFontSize(9); doc.text('Points de vigilance', 14, y); doc.setFont(undefined,'normal'); y = pdfTexte(doc, y+4.5, d.synth.vig, true) + 1; }
    if(d.synth.prio.length){ if(y > 278){ doc.addPage(); y = 18; } doc.setFont(undefined,'bold'); doc.setFontSize(9); doc.text('Priorites du mois suivant', 14, y); doc.setFont(undefined,'normal'); y = pdfTexte(doc, y+4.5, d.synth.prio, true) + 1; }

    if(AN.crPrime && d.prime){
      y = pdfBloc(doc, y + 3, 'Prime estimee : ' + P.eur(d.prime.total));
      doc.autoTable({startY:y, head:[['Critere','Realise','Cible','Montant']], body:(d.prime.lignes||[]).filter(l => l.actif).map(l =>
        [T(l.label), l.valeur === undefined ? '-' : (l.type === 'ca' || l.type === 'marge' ? P.eur(l.valeur) : T(String(Math.round(l.valeur*10)/10))),
         l.cible === undefined ? '-' : (l.type === 'ca' || l.type === 'marge' ? P.eur(l.cible) : T(String(l.cible))), P.eur(l.montant_du || 0)]),
        ...TBL, columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'}}});
      y = doc.lastAutoTable.finalY + 8;
    }
    const com = crGet(d.mk, d.com);
    if(com){ y = pdfBloc(doc, y + 2, 'Commentaire du responsable'); y = pdfTexte(doc, y + 3, com.split('\n'), false); }
  }

  window.crPDF = (seul) => {
    if(!window.jspdf){ toast('Bibliothèque PDF non chargée', 'bad'); return; }
    const {jsPDF} = window.jspdf; const doc = new jsPDF();
    const mk = crMois();
    const coms = seul ? [seul] : DB.commerciaux.filter(c => c.actif !== false && (!AN.crCom || c.id === AN.crCom)).map(c => c.id);
    const datas = coms.map(c => crData(c, mk));
    let premier = true;
    if(datas.length > 1){
      pdfHead(doc, 'Compte rendu mensuel equipe - ' + monthLabel(mk), 'Edite le ' + fdate(todayISO()));
      const t = {ca:sum(datas.map(d=>d.s.ca)), obj:sum(datas.map(d=>d.o.ca)), marge:sum(datas.map(d=>d.s.marge)),
        n1:sum(datas.map(d=>d.sN1.ca)), cum:sum(datas.map(d=>d.cum.ca)), cum1:sum(datas.map(d=>d.cum1.ca)), oa:sum(datas.map(d=>d.oa.ca))};
      let y = pdfKpis(doc, 40, [
        {l:'CA equipe', v:P.eur(t.ca), s:'obj. ' + P.eur(t.obj) + ' - ' + P.pct(t.obj ? t.ca/t.obj*100 : 0), c: t.ca >= t.obj ? 'ok' : 'bad'},
        {l:'Marge', v:P.eur(t.marge), s:'taux ' + P.pct(t.ca ? t.marge/t.ca*100 : 0)},
        {l:'vs N-1', v:P.v(varPct(t.ca, t.n1)), s:'mois de ' + monthLabel(addM(mk,-12))},
        {l:'Cumul', v:P.eur(t.cum), s:P.v(varPct(t.cum, t.cum1)) + ' vs N-1' + (t.oa ? ' - ' + P.pct(t.cum/t.oa*100) + ' obj.' : '')}
      ]);
      y = pdfBloc(doc, y, 'Par commercial');
      doc.autoTable({startY:y, head:[['Commercial','CA mois','Objectif','Atteinte','vs N-1','Marge','Cumul','Evol. cumul','Visites','Nvx']],
        body: datas.map(d => [T(d.nom), P.eur(d.s.ca), P.eur(d.o.ca), P.pct(d.o.ca ? d.s.ca/d.o.ca*100 : 0), P.v(varPct(d.s.ca, d.sN1.ca)),
          P.pct(d.s.txmarge), P.eur(d.cum.ca), P.v(varPct(d.cum.ca, d.cum1.ca)), String(d.vis.length), String(d.nvx.length)]),
        ...TBL, styles:{fontSize:7.8, cellPadding:2}});
      y = doc.lastAutoTable.finalY + 8;
      y = pdfBloc(doc, y, 'Synthese equipe'); y += 3;
      const all = [];
      datas.forEach(d => { d.synth.pts.slice(0,2).forEach(p => all.push(d.nom + ' : ' + p)); d.synth.vig.slice(0,2).forEach(p => all.push(d.nom + ' : ' + p)); });
      y = pdfTexte(doc, y, all, true);
      const ce = crGet(mk, '_equipe');
      if(ce){ y = pdfBloc(doc, y + 4, 'Commentaire du responsable'); pdfTexte(doc, y + 3, ce.split('\n'), false); }
      premier = false;
    }
    datas.forEach(d => { pdfCommercial(doc, d, premier); premier = false; });
    const n = doc.getNumberOfPages();
    for(let i = 1; i <= n; i++){ doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(150,150,150); doc.text('GIVEDIS OS - page ' + i + ' / ' + n, 196, 290, {align:'right'}); }
    doc.save('givedis-compte-rendu-' + mk + (datas.length === 1 ? '-' + datas[0].com : '-equipe') + '.pdf');
    toast('Compte rendu généré', 'ok');
  };

  /* Si l'utilisateur était déjà sur un onglet ajouté, on rafraîchit. */
  try{ if(TAB === 'analyse' || TAB === 'compterendu') render(); else renderShell(); }catch(e){}
})();
