/* =====================================================================
   GIVEDIS OS — Module « Analyse » v2
   À charger APRÈS analyse.js : remplace la vue de l'onglet Pilotage →
   Analyse. Le « Compte rendu mensuel » d'analyse.js n'est pas modifié.
   • Statuts : comparaison à N-1 (sinon corrigée de la saison), à jours
     ouvrés égaux, au-delà des variations habituelles du client ;
     rythme d'achat propre à chaque client (décroché / perdu).
   • Prédictif : score de risque, commande attendue, tendance 12 mois,
     projection de l'exercice, effet mesuré des visites.
   • Contrôle : test sur le passé et indice de fiabilité.
   • Seule écriture : les seuils, dans DB.settings.analyseV2 (bouton
     « Seuils »), pour que tous les postes voient la même chose.
   Version précédente : branche « sauvegarde-2026-11-26 » du dépôt.
   ===================================================================== */
(function(){
  if(typeof NAV === 'undefined' || typeof VIEWS === 'undefined' || typeof DB === 'undefined'){
    console.warn('analyse-v2.js : GIVEDIS OS introuvable'); return;
  }

  /* ---------- Onglet : remplace la vue « Analyse » ---------- */
  const tabs = NAV.pilotage.tabs;
  if(!tabs.some(t => t.id === 'analyse')){
    const i = tabs.findIndex(t => t.id === 'relances');
    tabs.splice(i >= 0 ? i + 1 : tabs.length, 0, {id:'analyse', label:'Analyse'});
  }

  /* ---------- Réglages (enregistrés avec les données) ---------- */
  const DEF = {
    seuil:15,        /* % d'écart pour parler de progression / recul            */
    seuilEur:300,    /* … et au moins ce montant en € sur la période             */
    zMin:1,          /* … et un écart supérieur aux variations habituelles (×σ)  */
    seuilMarge:30,   /* marge plancher (%)                                       */
    baisseMarge:5,   /* baisse vs sa propre marge des 12 mois d'avant (pts)      */
    ecartReseau:5,   /* écart sous la marge de son réseau (pts)                  */
    joursVisite:60,  /* au-delà, la visite manque                                */
    seuilRisque:30   /* score à partir duquel un client est « à risque » (calé par le test sur le passé) */
  };
  const R = Object.assign({}, DEF);
  /* Relu à chaque affichage : les données peuvent arriver de la synchronisation après le chargement du script. */
  const lireReglages = () => Object.assign(R, DEF, ((DB && DB.settings) || {}).analyseV2 || {});
  const S = {com:'', mk:'', filtre:'', q:'', bt:null, btCom:null};
  window.AN2 = {R, S};
  window.an2Set = (k, v) => { S[k] = v; if(k === 'com' || k === 'mk') S.bt = null; render(); };

  /* ---------- Outils ---------- */
  const addM = (mk, n) => { let [y,m] = mk.split('-').map(Number); m += n;
    while(m < 1){ m += 12; y--; } while(m > 12){ m -= 12; y++; }
    return y + '-' + String(m).padStart(2,'0'); };
  const rangeM = (from, to) => { const r = []; let m = from; while(m <= to){ r.push(m); m = addM(m,1); } return r; };
  const diffM = (a, b) => { const [ya,ma] = a.split('-').map(Number), [yb,mb] = b.split('-').map(Number); return (yb-ya)*12 + (mb-ma); };
  const sum = a => a.reduce((s,x) => s + (+x||0), 0);
  const mean = a => a.length ? sum(a) / a.length : 0;
  const median = a => { if(!a.length) return null; const s = a.slice().sort((x,y)=>x-y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k-1]+s[k])/2; };
  const quant = (a, q) => { const s = a.slice().sort((x,y)=>x-y); if(!s.length) return null; const p = (s.length-1)*q, b = Math.floor(p); return s[b] + (s[Math.min(b+1,s.length-1)] - s[b]) * (p - b); };
  const std = a => { if(a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map(x => (x-m)*(x-m))) / (a.length - 1)); };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sgn = n => (n > 0 ? '+' : '');
  const js = v => esc(JSON.stringify(String(v)));
  const finMois = mk => { const [y,m] = mk.split('-').map(Number); return mk + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2,'0'); };

  /* Jours ouvrés (lundi-vendredi, hors jours fériés français). */
  /* Historique compta importé (Données › Historique compta) : chaque client est analysé
     en entier (toutes ses fiches + la part du fichier global) sur la fiche qui le porte
     sur l'exercice ; les autres fiches du même nom ne sont pas comptées deux fois. */
  const GRP_ON = () => !!(window.HIST && HIST.actif && HIST.actif());
  const caA = (c, m, y) => GRP_ON() ? HIST.caGroupe(c, m, y || m.slice(0,4)) : caClientMois(c, m);

  const JO_CACHE = {};
  function paques(y){
    const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
      h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
      mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;
    return Date.UTC(y, mo-1, da);
  }
  function feries(y){
    const p = paques(y), j = 86400000, iso = t => new Date(t).toISOString().slice(0,10);
    return new Set([y+'-01-01', iso(p + j), y+'-05-01', y+'-05-08', iso(p + 39*j), iso(p + 50*j),
      y+'-07-14', y+'-08-15', y+'-11-01', y+'-11-11', y+'-12-25']);
  }
  function jo(mk){
    if(JO_CACHE[mk]) return JO_CACHE[mk];
    const [y,m] = mk.split('-').map(Number), F = feries(y);
    let n = 0;
    for(let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++){
      const t = new Date(Date.UTC(y, m-1, d)), w = t.getUTCDay();
      if(w !== 0 && w !== 6 && !F.has(t.toISOString().slice(0,10))) n++;
    }
    return (JO_CACHE[mk] = n || 1);
  }
  const joS = ms => sum(ms.map(jo));

  /* Mois pour lesquels un fichier compta a été importé. */
  function moisDetail(){
    const s = new Set();
    DB.clients.concat(GRP_ON() ? HIST.virtuelles() : []).forEach(c => Object.entries(c.caByMonth || {}).forEach(([m,v]) => { if(v !== null && v !== '') s.add(m); }));
    return [...s].sort();
  }

  /* ---------- Contexte d'un calcul au mois M (rien après M) ---------- */
  function ctx(M){
    const all = moisDetail();
    const known = all.filter(m => m <= M), K = new Set(known);
    let cons = 0, m = M; while(K.has(m) && cons < 36){ cons++; m = addM(m,-1); }
    const n = cons >= 6 ? 3 : Math.max(1, Math.floor(cons/2));
    const rec = rangeM(addM(M, -(n-1)), M), prev = rangeM(addM(M, -(2*n-1)), addM(M, -n));
    const rec1 = rec.map(x => addM(x,-12)), prev1 = prev.map(x => addM(x,-12));
    const H = rangeM(addM(M,-23), M);
    /* Équipe entière, mois par mois : sert au coefficient de saison */
    const team = {};
    const teamCA = x => { if(team[x] === undefined) team[x] = K.has(x) ? sum(DB.clients.map(c => caA(c, x, M.slice(0,4)))) : null; return team[x]; };
    const yoyOK = rec1.every(x => K.has(x));
    let saison = null;
    if(rec1.every(x => K.has(x)) && prev1.every(x => K.has(x))){
      const a = sum(rec1.map(teamCA)) / joS(rec1), b = sum(prev1.map(teamCA)) / joS(prev1);
      if(a > 0 && b > 0) saison = clamp(a / b, 0.5, 2);
    }
    /* Indice de saison par mois calendaire (si les 12 mois sont connus) */
    let idxS = null;
    const parMM = {};
    H.filter(x => K.has(x)).forEach(x => { const v = teamCA(x); if(v > 0) (parMM[x.slice(5)] = parMM[x.slice(5)] || []).push(v / jo(x)); });
    if(Object.keys(parMM).length === 12){
      const moy = mean(Object.values(parMM).map(mean));
      idxS = {}; Object.keys(parMM).forEach(k => { idxS[k] = clamp(mean(parMM[k]) / moy, 0.3, 3); });
    }
    /* Ancienne fenêtre (onglet Analyse actuel) pour comparer les statuts */
    let c6 = 0; m = M; while(K.has(m) && c6 < 6){ c6++; m = addM(m,-1); }
    const nV1 = Math.max(1, Math.min(3, Math.floor(c6/2)));
    const finM = finMois(M), auj = todayISO();
    const refDate = auj < finM ? auj : finM;
    const visPar = {};
    DB.visites.forEach(v => { if(v.date && v.date <= finM) (visPar[v.clientId] = visPar[v.clientId] || []).push(v); });
    Object.values(visPar).forEach(a => a.sort((x,y) => y.date.localeCompare(x.date)));
    return {M, K, known, cons, n, rec, prev, rec1, prev1, H, yoyOK, saison, idxS, joRec:joS(rec), joPrev:joS(prev), joRec1:joS(rec1),
      nV1, recV1: rangeM(addM(M,-(nV1-1)), M), prevV1: rangeM(addM(M,-(2*nV1-1)), addM(M,-nV1)),
      finM, refDate, visPar, repli:{}, lastKnown: all[all.length-1]};
  }

  /* Taux de marge d'un client sur un mois, en signalant s'il est estimé. */
  function taux(c, m, X){
    if(GRP_ON()){ const g = HIST.tauxGroupe(c, m, X.M.slice(0,4)); if(g) return g; }
    const o = typeof origineTaux === 'function' ? origineTaux(c, m) : 'mois';
    if(o !== 'repli') return {t: +tauxClient(c, m) || 0, repli:false};
    const k = (c.commercial||'') + '|' + m.slice(0,4);
    if(X.repli[k] === undefined){ try{ X.repli[k] = +tauxClient(c, m) || 0; }catch(e){ X.repli[k] = 0; } }
    return {t: X.repli[k], repli:true};
  }

  const joursEntre = (a, b) => { const x = new Date(a), y = new Date(b); return isNaN(x) || isNaN(y) ? null : Math.floor((y - x) / 86400000); };

  /* ---------- Statut « ancienne méthode » (pour comparer) ---------- */
  function statutV1(c, X){
    const M = X.M, seuil = (window.AN && +window.AN.seuil) || 15;
    const caM = m => caA(c, m, X.M.slice(0,4));
    const cRec = sum(X.recV1.map(caM)), cPrev = sum(X.prevV1.map(caM));
    const yearM = monthsOfYear(M.slice(0,4)).filter(m => m <= M);
    const achats = yearM.filter(m => caM(m) > 0);
    const lastBuy = achats.length ? achats[achats.length-1] : null;
    let nvM = null; try{ nvM = moisNouveau(c, M.slice(0,4)); }catch(e){}
    if(nvM && nvM >= X.prevV1[0]) return 'nouveau';
    if(!lastBuy) return 'inactif';
    if(lastBuy <= addM(M,-2) && (cPrev > 0 || cRec === 0)) return 'decroche';
    if(cPrev === 0 && cRec > 0) return 'progression';
    const v = cPrev > 0 ? (cRec - cPrev) / cPrev * 100 : null;
    return v > seuil ? 'progression' : v < -seuil ? 'recul' : 'stable';
  }

  /* ---------- Calcul d'un client ---------- */
  function ligne(c, X){
    const M = X.M, K = X.K, yA = M.slice(0,4);
    if(GRP_ON() && !HIST.estProprio(c, yA)) return null;   /* compté sur la fiche qui porte le client */
    const ser = {};
    X.H.forEach(m => { ser[m] = K.has(m) ? caA(c, m, yA) : null; });
    /* Dernier achat, même au-delà de 24 mois */
    let lastBuy = null, firstBuy = null;
    Object.entries(GRP_ON() ? HIST.moisGroupe(c, yA) : (c.caByMonth || {})).forEach(([m,v]) => { if(m <= M && +v > 0){ if(!lastBuy || m > lastBuy) lastBuy = m; if(!firstBuy || m < firstBuy) firstBuy = m; } });
    X.H.forEach(m => { if(ser[m] > 0){ if(!lastBuy || m > lastBuy) lastBuy = m; if(!firstBuy || m < firstBuy) firstBuy = m; } });
    if(!lastBuy) return null;                    /* jamais acheté : prospect */
    if(diffM(lastBuy, M) > 35) return null;      /* rien depuis 3 ans : hors analyse */

    /* Commandes exceptionnelles : plafonnées pour ne pas fausser les statuts */
    const kH = X.H.filter(m => K.has(m));
    const pos = kH.map(m => ser[m]).filter(v => v > 0);
    let cap = Infinity;
    if(pos.length >= 6){ const md = median(pos), q1 = quant(pos,.25), q3 = quant(pos,.75); cap = Math.max(md*3, q3 + 3*(q3-q1)); }
    const affaires = kH.filter(m => ser[m] > cap && ser[m] >= 1000);
    const mdPos = pos.length ? median(pos) : 0;
    /* Le mois exceptionnel est remplacé par un mois habituel (médiane) pour les statuts */
    const serC = {}; X.H.forEach(m => { serC[m] = ser[m] === null ? null : (affaires.includes(m) ? mdPos : ser[m]); });
    const sR = ms => sum(ms.map(m => ser[m] || 0)), sC = ms => sum(ms.map(m => serC[m] || 0));

    /* Rythme d'achat */
    const pm = kH.filter(m => ser[m] > 0);
    const debut = firstBuy > X.H[0] ? firstBuy : X.H[0];
    const span = kH.filter(m => m >= debut).length || 1;
    const p = clamp(pm.length / span, 0.02, 0.97);
    const gaps = []; for(let i = 1; i < pm.length; i++) gaps.push(diffM(pm[i-1], pm[i]));
    const cycle = Math.max(1, gaps.length ? median(gaps) : 6);   /* un seul achat : rythme inconnu, 6 mois par défaut */
    const depuis = diffM(lastBuy, M);
    if(pm.length <= 1 && depuis >= 12) return null;  /* achat unique il y a plus d'un an : client ponctuel, hors analyse */
    const pSil = Math.pow(1 - p, depuis);       /* chance qu'un client actif reste aussi longtemps sans commander */
    const prochaine = addM(lastBuy, Math.max(1, Math.round(cycle)));

    /* Nouveau : 1re commande connue, précédée d'au moins 6 mois connus sans achat */
    const avant = rangeM(addM(firstBuy,-12), addM(firstBuy,-1)).filter(m => K.has(m)).length;
    const nvM = firstBuy >= addM(M,-11) && avant >= 6 ? firstBuy : null;

    /* Comparaisons (CA plafonné, ramené au jour ouvré) */
    const recR = sR(X.rec), prevR = sR(X.prev), recC = sC(X.rec), prevC = sC(X.prev);
    const n1C = X.yoyOK ? sC(X.rec1) : null, n1R = X.yoyOK ? sR(X.rec1) : null;
    let base = null, attendu = null;
    if(n1C > 0){ base = 'n1'; attendu = n1C / X.joRec1 * X.joRec; }
    else if(prevC > 0){ base = X.saison ? 'saison' : 'seq'; attendu = prevC / X.joPrev * (X.saison || 1) * X.joRec; }
    const deltaRef = attendu !== null ? recC - attendu : null;
    const varRef = attendu > 0 ? recC / attendu - 1 : null;
    const sigma = std(kH.map(m => serC[m]));
    const se = sigma * Math.sqrt(2 * X.n);
    const z = deltaRef === null ? 0 : se > 0 ? deltaRef / se : (deltaRef ? Math.sign(deltaRef) * 9 : 0);
    const signif = Math.abs(z) >= R.zMin && Math.abs(deltaRef || 0) >= R.seuilEur;

    let statut, reprise = false;
    if(nvM && nvM >= X.prev[0]) statut = 'nouveau';
    else if(depuis >= Math.max(6, Math.min(18, Math.ceil(3 * cycle)))) statut = 'perdu';
    else if(depuis >= Math.max(2, Math.min(12, Math.ceil(1.5 * cycle))) && pSil < 0.25) statut = 'decroche';
    else if(varRef === null){ statut = recC > 0 ? 'progression' : 'stable'; reprise = recC > 0; }
    else if(base !== 'n1' && cycle > X.n) statut = 'stable';   /* achats trop espacés pour comparer deux périodes courtes */
    else if(varRef * 100 > R.seuil && signif && z > 0) statut = 'progression';
    else if(varRef * 100 < -R.seuil && signif && z < 0) statut = 'recul';
    else statut = 'stable';
    const retard = !['perdu','decroche','nouveau'].includes(statut) && pm.length >= 3 && depuis > Math.round(cycle);

    /* Volumes glissants */
    const d12 = rangeM(addM(M,-11), M), p12 = rangeM(addM(M,-23), addM(M,-12));
    const ca12 = sR(d12), k12 = d12.filter(m => K.has(m)).length;
    const ca12p = sR(p12), k12p = p12.filter(m => K.has(m)).length;
    const caPerdu = statut === 'perdu' ? sum(rangeM(addM(lastBuy,-11), lastBuy).map(m => caA(c, m, yA))) : 0;

    /* Tendance sur 12 mois (régression, CA par jour ouvré) */
    /* Pour un client qui achète par à-coups, on lisse sur son rythme (ex. trimestre) */
    const w = clamp(Math.round(cycle), 1, 6);
    const pts = d12.filter(m => rangeM(addM(m,-(w-1)), m).every(x => K.has(x) && X.H.includes(x))).map(m => {
      const f = rangeM(addM(m,-(w-1)), m);
      return {x: diffM(d12[0], m), y: sum(f.map(x => serC[x] / jo(x) * 21 / (X.idxS && w === 1 ? X.idxS[x.slice(5)] : 1))) / w};
    });
    let tendance = null;
    if(pts.length >= 6){
      const mx = mean(pts.map(q => q.x)), my = mean(pts.map(q => q.y));
      const den = sum(pts.map(q => (q.x-mx)*(q.x-mx)));
      if(my > 0 && den > 0) tendance = clamp(sum(pts.map(q => (q.x-mx)*(q.y-my))) / den * 12 / my * 100, -100, 300);
    }

    /* Marge : seulement les taux réellement saisis */
    const marge = ms => { let ca = 0, mg = 0, est = 0;
      ms.forEach(m => { const v = ser[m] || 0; if(v <= 0) return; const t = taux(c, m, X); if(t.repli) est += v; else { ca += v; mg += v * t.t / 100; } });
      return {ca, mg, est, t: ca > 0 ? mg / ca * 100 : null}; };
    const mRec = marge(X.rec), mPrev = marge(X.prev), mHist = marge(rangeM(addM(X.rec[0],-12), addM(X.rec[0],-1)));

    /* Visites (jusqu'à la fin de M) */
    const vis = GRP_ON() ? HIST.fichesGroupe(c, yA).flatMap(f => X.visPar[f.id] || []).sort((a, b) => b.date.localeCompare(a.date)) : (X.visPar[c.id] || []);
    const lastVis = vis[0] || null;
    const joursVis = lastVis ? joursEntre(lastVis.date, X.refDate) : null;
    const dV = m => m + '-01';
    const visRec = vis.filter(v => v.date >= dV(X.rec[0])).length;
    const vis6 = vis.filter(v => v.date >= dV(addM(M,-5))).length;
    const vis12 = vis.filter(v => v.date >= dV(addM(M,-11))).length;

    /* Potentiel prouvé : meilleure année glissante observée */
    let pot = ca12;
    for(let i = 11; i < X.H.length; i++) pot = Math.max(pot, sR(X.H.slice(i-11, i+1)));
    if(kH.length < 12) pot = Math.max(pot, Math.max(0, ...rangeM(addM(M,-21), M).map((m,i,a) => i >= 2 ? sR(a.slice(i-2,i+1)) * 4 : 0)));

    /* Fiabilité */
    const cv = mean(kH.map(m => serC[m])) > 0 ? sigma / mean(kH.map(m => serC[m])) : 0;
    let confiance = kH.length >= 18 && pm.length >= 4 ? 'bonne' : kH.length < 9 || pm.length < 2 ? 'faible' : 'moyenne';
    if(confiance === 'bonne' && cv > 2) confiance = 'moyenne';

    /* Score de risque */
    let score = null, raisons = [];
    if(statut !== 'perdu' && statut !== 'nouveau'){
      const comp = {
        silence: clamp((1 - pSil - 0.5) / 0.45, 0, 1),
        tendance: tendance !== null && tendance < 0 ? clamp(-tendance / 50, 0, 1) : 0,
        ecart: statut === 'recul' ? clamp(-(varRef || 0) * 2, 0, 1) : 0,
        marge: mRec.t !== null && mHist.t !== null ? clamp((mHist.t - mRec.t) / 10, 0, 1) : 0,
        visite: joursVis === null ? 0.6 : joursVis > R.joursVisite ? clamp(0.5 + (joursVis - R.joursVisite) / 120, 0, 1) : 0
      };
      const W = {silence:.35, tendance:.25, ecart:.2, marge:.1, visite:.1};
      score = Math.round(100 * sum(Object.keys(W).map(k => W[k] * comp[k])));
      const L = {silence:`pas de commande depuis ${depuis} mois (habituel : tous les ${num(cycle)} mois)`,
        tendance:`tendance ${tendance === null ? '' : pct(tendance)} sur un an`, ecart:`écart de ${pct((varRef||0)*100)}`,
        marge:`marge en baisse`, visite: joursVis === null ? 'jamais visité' : `pas vu depuis ${joursVis} j`};
      raisons = Object.keys(W).filter(k => comp[k] >= 0.3).sort((a,b) => W[b]*comp[b] - W[a]*comp[a]).map(k => L[k]);
      raisons.comp = comp;
    }

    return {c, ser, serC, cap, affaires, statut, reprise, retard, prochaine, cycle, depuis, p, pSil, lastBuy, firstBuy, nvM,
      recR, prevR, recC, prevC, n1R, base, attendu, deltaRef, varRef, z, signif,
      delta: recR - prevR, varSeq: prevR > 0 ? (recR - prevR) / prevR * 100 : null,
      varN1: n1R > 0 ? (recR - n1R) / n1R * 100 : null,
      ca12, k12, ca12p, k12p, caPerdu, tendance, mRec, mPrev, mHist, vis, lastVis, joursVis, visRec, vis6, vis12,
      pot, confiance, cv, nbAchats:pm.length, score, raisons, caRisque: score === null ? 0 : score / 100 * ca12,
      v1: statutV1(c, X)};
  }

  /* ---------- Moteur ---------- */
  function analyser(M, com, light){
    const X = ctx(M);
    const y = M.slice(0,4);
    const rows = DB.clients.filter(c => !com || commercialDe(c, y) === com).map(c => ligne(c, X)).filter(Boolean);
    const res = {M, com, X, rows};
    if(light) return res;

    const by = s => rows.filter(r => r.statut === s);
    const cats = {};
    ['progression','stable','recul','decroche','perdu','nouveau'].forEach(s => {
      const l = by(s); cats[s] = {n:l.length, rec:sum(l.map(r => r.recR)), delta:sum(l.map(r => r.deltaRef || 0)),
        perdu:sum(l.map(r => r.caPerdu))};
    });
    res.cats = cats;
    const actifs = rows.filter(r => r.statut !== 'perdu');
    res.hausses = actifs.filter(r => r.deltaRef > 0 && r.statut !== 'nouveau').sort((a,b) => b.deltaRef - a.deltaRef).slice(0,10);
    res.baisses = actifs.filter(r => r.deltaRef < 0).sort((a,b) => a.deltaRef - b.deltaRef).slice(0,10);
    res.perdus = by('perdu').sort((a,b) => b.caPerdu - a.caPerdu);
    res.urgents = actifs.filter(r => r.score >= R.seuilRisque).sort((a,b) => b.caRisque - a.caRisque);
    res.caRisque = sum(res.urgents.map(r => r.caRisque));
    res.attendues = actifs.filter(r => r.retard).sort((a,b) => b.ca12 - a.ca12);

    /* Marge : comparée à son réseau, à son passé, au plancher */
    const ref = {};
    actifs.forEach(r => { if(r.mRec.ca > 0){ const k = r.c.reseau || '—'; (ref[k] = ref[k] || {ca:0, mg:0, n:0}); ref[k].ca += r.mRec.ca; ref[k].mg += r.mRec.mg; ref[k].n++; } });
    const tot = Object.values(ref).reduce((a,b) => ({ca:a.ca+b.ca, mg:a.mg+b.mg}), {ca:0, mg:0});
    const refDe = r => { const g = ref[r.c.reseau || '—']; return g && g.n >= 3 ? g.mg / g.ca * 100 : tot.ca ? tot.mg / tot.ca * 100 : null; };
    res.alertesMarge = actifs.filter(r => r.recR >= 300 && r.mRec.t !== null).map(r => {
      const rf = refDe(r), why = [];
      if(r.mRec.t < R.seuilMarge) why.push(`sous ${R.seuilMarge} %`);
      if(r.mHist.t !== null && r.mHist.t - r.mRec.t >= R.baisseMarge) why.push(`${num(r.mHist.t - r.mRec.t)} pts sous ses 12 mois d'avant`);
      if(rf !== null && rf - r.mRec.t >= R.ecartReseau) why.push(`${num(rf - r.mRec.t)} pts sous ${r.c.reseau ? 'son réseau' : "l'équipe"}`);
      return Object.assign(r, {margeRef: rf, margeWhy: why});
    }).filter(r => r.margeWhy.length).sort((a,b) => (a.mRec.t - (a.margeRef ?? a.mRec.t)) - (b.mRec.t - (b.margeRef ?? b.mRec.t)));
    const caTot = sum(actifs.map(r => r.mRec.ca + r.mRec.est));
    res.partEstimee = caTot ? sum(actifs.map(r => r.mRec.est)) / caTot * 100 : 0;

    /* Visites */
    res.effet = effetVisites(rows, X);
    res.sansRetour = actifs.filter(r => r.visNets && r.visNets.length >= 3 && mean(r.visNets) <= 0 && !['progression','nouveau'].includes(r.statut))
      .sort((a,b) => b.visNets.length - a.visNets.length);
    const parCA = actifs.filter(r => r.ca12 > 0).sort((a,b) => b.ca12 - a.ca12);
    res.jamaisVus = parCA.slice(0, Math.max(5, Math.ceil(parCA.length * 0.2))).filter(r => r.vis12 === 0);
    res.sousExploites = actifs.filter(r => r.pot - r.ca12 >= Math.max(2000, 0.3 * r.pot) && r.vis6 <= 1)
      .sort((a,b) => (b.pot - b.ca12) - (a.pot - a.ca12));

    /* Concentration sur 12 mois glissants */
    res.conc = DB.commerciaux.filter(co => co.actif !== false && (!com || co.id === com)).map(co => {
      const l = actifs.filter(r => commercialDe(r.c, y) === co.id && r.ca12 > 0).sort((a,b) => b.ca12 - a.ca12);
      const t = sum(l.map(r => r.ca12));
      const t5 = t ? sum(l.slice(0,5).map(r => r.ca12)) / t * 100 : 0, t10 = t ? sum(l.slice(0,10).map(r => r.ca12)) / t * 100 : 0;
      return {co, tot:t, n:l.length, t5, t10, top:l.slice(0,5), risque: t5 > 50 ? 'bad' : t5 > 35 ? 'warn' : 'ok'};
    }).filter(x => x.n);

    /* Nouveaux clients des 12 derniers mois */
    const nvs = rows.filter(r => r.nvM && r.nvM < M);
    const fid = nvs.filter(r => r.nbAchats >= 2);
    res.nv = {n:nvs.length, fideles:fid.length, unique:nvs.length - fid.length, taux: nvs.length ? fid.length / nvs.length * 100 : 0,
      aRelancer: nvs.filter(r => r.nbAchats < 2).sort((a,b) => b.ca12 - a.ca12)};

    /* Projection de l'exercice */
    res.proj = projections(com);

    /* Comparaison avec l'onglet actuel */
    res.changes = rows.filter(r => r.v1 !== r.statut && !(r.v1 === 'inactif' && r.statut === 'perdu'));
    res.bilan = bilan(res);
    return res;
  }

  /* ---------- Effet mesuré des visites ----------
     Pour chaque visite au mois m : CA de m à m+2 moins CA de m-3 à m-1,
     moins l'évolution moyenne des clients non visités sur la même période. */
  function effetVisites(rows, X){
    const K = X.K;
    const E = X.H.filter(m => m >= addM(X.H[0],3) && addM(m,2) <= X.M && rangeM(addM(m,-3), addM(m,2)).every(x => K.has(x)));
    const apres = (r, m) => sum(rangeM(m, addM(m,2)).map(x => r.serC[x] || 0));
    const avant = (r, m) => sum(rangeM(addM(m,-3), addM(m,-1)).map(x => r.serC[x] || 0));
    const visM = {};
    rows.forEach(r => { visM[r.c.id] = new Set(r.vis.map(v => monthKey(v.date))); });
    const baseline = {};
    E.forEach(m => {
      const fen = rangeM(addM(m,-3), addM(m,2));
      const l = rows.filter(r => !fen.some(x => visM[r.c.id].has(x)) && (r.serC[addM(m,-1)] !== null)).map(r => apres(r,m) - avant(r,m));
      baseline[m] = l.length ? mean(l) : 0;
    });
    const Es = new Set(E), parCom = {}, parType = {};
    const add = (o, k, net, cmd) => { o[k] = o[k] || {n:0, nets:[], cmd:0}; o[k].n++; o[k].nets.push(net); if(cmd) o[k].cmd++; };
    rows.forEach(r => {
      const vus = new Set(); r.visNets = [];
      r.vis.forEach(v => {
        const m = monthKey(v.date);
        if(!Es.has(m) || vus.has(m)) return; vus.add(m);
        const net = apres(r,m) - avant(r,m) - baseline[m];
        const cmd = (r.ser[m] || 0) > 0 || (r.ser[addM(m,1)] || 0) > 0;
        add(parCom, v.commercial || r.c.commercial || '—', net, cmd);
        add(parType, v.type || 'Autre', net, cmd);
        if(m >= addM(X.M,-8)) r.visNets.push(net);
      });
    });
    const fin = o => Object.entries(o).map(([k,v]) => ({k, n:v.n, net:mean(v.nets), med:median(v.nets), cmd:v.n ? v.cmd/v.n*100 : 0}))
      .filter(x => x.n >= 3).sort((a,b) => b.n - a.n);
    /* Fréquence de visite et évolution sur un an */
    const B = [['0 visite', 0, 0], ['1-2 visites', 1, 2], ['3-5 visites', 3, 5], ['6 et plus', 6, 1e9]];
    const freq = B.map(([lab, a, b]) => {
      const l = rows.filter(r => r.statut !== 'nouveau' && r.k12 >= 10 && r.k12p >= 10 && r.ca12p > 0 && r.vis12 >= a && r.vis12 <= b)
        .map(r => (r.ca12 / r.ca12p - 1) * 100);
      return {lab, n:l.length, med:median(l)};
    });
    return {mois:E.length, parCom:fin(parCom), parType:fin(parType), freq};
  }

  /* ---------- Projection fin d'exercice par commercial ---------- */
  function projections(com){
    const y = String(YEAR), cur = curMonth();
    const coms = ACTIFS().filter(c => !com || c.id === com);
    const st = {}, S_ = (co, m) => { const k = co + '|' + m; if(!st[k]){ try{ st[k] = stats(co, m); }catch(e){ st[k] = {ca:0, frac:1, source:'vide'}; } } return st[k]; };
    const out = coms.map(co => {
      const id = co.id, ms = monthsOfYear(y);
      const lc = [addM(cur,-3), addM(cur,-2), addM(cur,-1)];
      /* N-1 sur la même base que le tableau de bord (périmètre constant) */
      const P_ = m => { try{ return typeof statsN1 === 'function' ? statsN1(id, m) : S_(id, m); }catch(e){ return S_(id, m); } };
      const den = sum(lc.map(m => P_(addM(m,-12)).ca));
      const ratio = den > 0 ? clamp(sum(lc.map(m => S_(id, m).ca)) / den, 0.6, 1.4) : null;
      const moy = mean(lc.map(m => S_(id, m).ca)), joMoy = mean(lc.map(jo));
      const prevoir = m => { const n1 = P_(addM(m,-12)).ca; return ratio !== null && n1 > 0 ? n1 * ratio : moy * jo(m) / (joMoy || 21); };
      let realise = 0, projete = 0, restants = 0;
      ms.forEach(m => {
        if(m < cur){ const v = S_(id, m).ca; realise += v; projete += v; }
        else if(m === cur){
          const s = S_(id, m), v = s.ca; realise += v;
          let f = 1; try{ f = fracStade(id, m); }catch(e){}
          const p = f >= 0.15 && f < 1 ? v / f : null;
          projete += Math.max(v, p !== null ? p : prevoir(m)); restants += 1 - (f || 0);
        } else { projete += prevoir(m); restants++; }
      });
      const obj = (objAn(id, y) || {}).ca || 0;
      /* Devis émis sur 90 jours, sans commande derrière */
      const lim = new Date(Date.now() - 90*86400000).toISOString().slice(0,10);
      const dv = DB.visites.filter(v => v.commercial === id && v.resultat === 'Devis émis' && (v.date||'') >= lim).filter(v =>
        !DB.visites.some(w => w.clientId === v.clientId && w.resultat === 'Commande' && (w.date||'') > v.date));
      return {co, realise, projete, obj, att: obj ? projete / obj * 100 : null, ratio,
        besoin: obj && restants > 0 ? Math.max(0, obj - realise) / restants : null, rythme: moy,
        devis: dv.length, devisCA: sum(dv.map(v => +v.ca || 0)), so: typeof suiviSeul === 'function' && suiviSeul(id)};
    });
    return {y, cur, coms: out, passe: y < cur.slice(0,4)};
  }

  /* ---------- Test sur le passé ----------
     On se place à un mois passé Mb, avec uniquement les données connues alors,
     et on regarde si les clients signalés ont vraiment baissé dans les 3 mois suivants. */
  function backtest(com){
    const all = moisDetail(), last = all[all.length-1];
    if(!last) return {points:[], msg:'Aucun historique.'};
    const K = new Set(all);
    const cands = all.filter(m => addM(m,3) <= last && rangeM(addM(m,-11), addM(m,3)).every(x => K.has(x))).slice(-6);
    if(!cands.length) return {points:[], msg:"Il faut au moins 15 mois d'historique compta continu pour tester sur le passé."};
    const seuils = [30,40,50,60,70];
    const acc = {v1:{tp:0,fp:0,fn:0}, base:{n:0, baisse:0}}; seuils.forEach(s => acc['s'+s] = {tp:0,fp:0,fn:0});
    const points = cands.map(Mb => {
      const a = analyser(Mb, com, true);
      let n = 0, b = 0;
      a.rows.forEach(r => {
        if(r.statut === 'perdu' || r.statut === 'nouveau') return;
        const moy = r.ca12 / Math.max(1, r.k12);
        if(moy < 100) return;
        const fut = sum(rangeM(addM(Mb,1), addM(Mb,3)).map(m => caA(r.c, m, Mb.slice(0,4))));
        const baisse = fut < 0.5 * moy * 3;
        n++; if(baisse) b++;
        const f1 = r.v1 === 'recul' || r.v1 === 'decroche';
        const tally = (o, f) => { if(f && baisse) o.tp++; else if(f) o.fp++; else if(baisse) o.fn++; };
        tally(acc.v1, f1); seuils.forEach(s => tally(acc['s'+s], r.score >= s));
      });
      acc.base.n += n; acc.base.baisse += b;
      return {Mb, n, b};
    });
    const met = o => { const pr = o.tp + o.fp ? o.tp / (o.tp + o.fp) * 100 : null, rc = o.tp + o.fn ? o.tp / (o.tp + o.fn) * 100 : null;
      return {pr, rc, f1: pr && rc ? 2*pr*rc/(pr+rc) : 0, sig: o.tp + o.fp}; };
    const res = {points, base: acc.base.n ? acc.base.baisse / acc.base.n * 100 : 0, n: acc.base.n, v1: met(acc.v1),
      seuils: seuils.map(s => Object.assign({s}, met(acc['s'+s])))};
    res.conseil = res.seuils.slice().sort((a,b) => b.f1 - a.f1)[0];
    return res;
  }
  window.an2Backtest = () => {
    S.bt = 'calc'; render();
    setTimeout(() => { try{ lireReglages(); S.bt = backtest(S.com); }catch(e){ S.bt = {points:[], msg:'Erreur : ' + e.message}; } render(); }, 30);
  };

  /* ---------- Bilan rédigé ---------- */
  function bilan(a){
    const X = a.X, ok = [], ko = [], prio = [], C = a.cats;
    const base = X.yoyOK ? 'même période ' + (+a.M.slice(0,4) - 1) : X.saison ? 'période précédente, corrigée de la saison' : 'période précédente';
    const per = (X.n === 1 ? monthLabel(a.M) : 'les ' + X.n + ' derniers mois (' + monthLabel(X.rec[0]) + ' → ' + monthLabel(a.M) + ')')
      + ', comparés à la ' + base + ', à nombre de jours ouvrés égal';
    const act = a.rows.filter(r => r.statut !== 'perdu' && r.attendu !== null);
    const tR = sum(act.map(r => r.recC)), tA = sum(act.map(r => r.attendu));
    if(tA > 0){ const v = (tR / tA - 1) * 100; (v >= 0 ? ok : ko).push(`CA clients ${v >= 0 ? 'au-dessus' : 'en dessous'} de l'attendu de ${pct(Math.abs(v))} (${eur(tR)} pour ${eur(tA)} attendus).`); }
    if(C.progression.n) ok.push(`${C.progression.n} client${C.progression.n>1?'s':''} en vraie progression (au-delà de leurs variations habituelles).`);
    if(C.nouveau.n) ok.push(`${C.nouveau.n} vrai${C.nouveau.n>1?'s':''} nouveau${C.nouveau.n>1?'x':''} client${C.nouveau.n>1?'s':''} sur la période (${eur(C.nouveau.rec)}).`);
    a.proj.coms.filter(p => p.obj && p.att >= 100).forEach(p => ok.push(`${p.co.nom} : projection ${eur(p.projete)}, soit ${pct(p.att)} de l'objectif ${a.proj.y}.`));
    if(C.recul.n) ko.push(`${C.recul.n} client${C.recul.n>1?'s':''} en vrai recul (${eur(C.recul.delta)} par rapport à l'attendu).`);
    if(C.decroche.n) ko.push(`${C.decroche.n} client${C.decroche.n>1?'s':''} décroché${C.decroche.n>1?'s':''} par rapport à leur rythme d'achat habituel.`);
    if(C.perdu.n) ko.push(`${C.perdu.n} client${C.perdu.n>1?'s':''} perdu${C.perdu.n>1?'s':''}, qui faisaient ${eur(C.perdu.perdu)} sur leur dernière année.`);
    if(a.urgents.length) ko.push(`${a.urgents.length} client${a.urgents.length>1?'s':''} à risque, pour environ ${eur(a.caRisque)} de CA annuel menacé.`);
    a.proj.coms.filter(p => p.obj && p.att !== null && p.att < 100).forEach(p => ko.push(`${p.co.nom} : projection ${eur(p.projete)}, soit ${pct(p.att)} de l'objectif ${a.proj.y}${p.besoin ? ` (il faudrait ${eur(p.besoin)} par mois, contre ${eur(p.rythme)} ces 3 derniers mois)` : ''}.`));
    if(a.alertesMarge.length) ko.push(`${a.alertesMarge.length} client${a.alertesMarge.length>1?'s':''} avec une marge anormale (plancher, historique ou réseau).`);
    a.conc.filter(c => c.risque === 'bad').forEach(c => ko.push(`${c.co.nom} : ses 5 premiers clients font ${pct(c.t5)} de son CA sur 12 mois.`));
    if(a.jamaisVus.length) ko.push(`${a.jamaisVus.length} gros client${a.jamaisVus.length>1?'s':''} sans visite depuis 12 mois.`);
    a.urgents.slice(0,3).forEach(r => prio.push(`${r.c.nom} : ${r.raisons.slice(0,2).join(', ') || 'risque élevé'} (${eur(r.caRisque)} en jeu).`));
    a.attendues.slice(0,2).forEach(r => prio.push(`Relancer ${r.c.nom} : commande attendue en ${monthLabel(r.prochaine)}.`));
    a.alertesMarge.slice(0,2).forEach(r => prio.push(`Revoir les prix de ${r.c.nom} (marge ${pct(r.mRec.t)}).`));
    a.perdus.slice(0,1).forEach(r => prio.push(`Reconquérir ${r.c.nom} (${eur(r.caPerdu)} sur sa dernière année).`));
    return {per, ok, ko, prio};
  }

  /* ---------- Rendu ---------- */
  const LBL = {progression:'En progression', stable:'Stable', recul:'En recul', decroche:'Décroché', perdu:'Perdu', nouveau:'Nouveau', inactif:'Inactif'};
  const CLS = {progression:'ok', stable:'info', recul:'warn', decroche:'bad', perdu:'bad', nouveau:'mute', inactif:'mute'};
  const ICO = {progression:'🟢', stable:'🔵', recul:'🟠', decroche:'🔴', perdu:'⚫', nouveau:'⚪'};
  const tagS = s => `<span class="tag ${CLS[s]||'mute'}">${LBL[s]||s}</span>`;
  const tagV = v => v === null || v === undefined || !isFinite(v) ? '<span class="tag mute">—</span>'
    : `<span class="tag ${v > R.seuil ? 'ok' : v < -R.seuil ? 'bad' : 'info'}">${sgn(v)}${pct(v)}</span>`;
  const tagC = c => `<span class="tag ${c === 'bonne' ? 'ok' : c === 'faible' ? 'bad' : 'info'}" title="Fiabilité du statut">${c}</span>`;
  const tagR = s => s === null ? '<span class="tag mute">—</span>' : `<span class="tag ${s >= 70 ? 'bad' : s >= R.seuilRisque ? 'warn' : 'mute'}">${s}</span>`;
  const lnk = r => `<a href="#" onclick="an2Fiche(${js(r.c.id)});return false" style="color:inherit;text-decoration:underline dotted">${esc(r.c.nom)}</a>`;
  const vide = (t, n) => `<tr><td colspan="${n||9}" class="hint" style="text-align:center;padding:14px">${t}</td></tr>`;
  const comTd = r => S.com ? '' : `<td>${esc(whoName(commercialDe(r.c, S.mk.slice(0,4)) || r.c.commercial))}</td>`;
  const comTh = () => S.com ? '' : '<th>Commercial</th>';
  const ul = l => l.length ? '<ul style="margin:0;padding-left:18px;line-height:1.7">' + l.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<p class="hint">Rien de marquant.</p>';
  const BASE = {n1:'vs N-1', saison:'vs avant, corrigé saison', seq:'vs avant'};

  /* Un mois est incomplet s'il est en cours, ou si son CA fait moins de 40 % de la médiane des 6 mois d'avant. */
  function moisIncomplet(m){
    if(m >= curMonth()) return true;
    const tot = x => sum(DB.clients.map(c => caA(c, x)));
    const K = new Set(moisDetail());
    const av = rangeM(addM(m,-6), addM(m,-1)).filter(x => K.has(x)).map(tot);
    return av.length >= 3 && tot(m) < 0.4 * median(av);
  }
  function anMois(){
    const ms = moisDetail().filter(m => m <= dashMonth());
    if(S.mk && ms.includes(S.mk)) return S.mk;
    const ok = ms.filter(m => !moisIncomplet(m));
    return ok.length ? ok[ok.length-1] : ms.length ? ms[ms.length-1] : null;
  }

  VIEWS['pilotage:analyse'] = () => {
    lireReglages();
    const M = anMois();
    if(!M) return `<div class="card">${emptyState('📊', "Aucun chiffre client importé : l'analyse v2 a besoin du fichier compta.")}</div>`;
    S.mk = M;
    const t0 = performance.now();
    const a = analyser(M, S.com);
    window.__AN2_LAST = a;
    const X = a.X, C = a.cats;
    const ms = moisDetail().filter(m => m <= dashMonth()).reverse();

    const kpi = s => `<div class="kpi ${CLS[s] === 'ok' ? 'ok' : CLS[s] === 'bad' || s === 'recul' ? 'bad' : 'info'}" style="cursor:pointer;${S.filtre===s?'outline:2px solid var(--accent,#4d9bff)':''}"
        onclick="an2Set('filtre', AN2.S.filtre===${js(s)}?'':${js(s)});setTimeout(()=>document.getElementById('an2Liste')?.scrollIntoView({behavior:'smooth'}),60)">
        <div class="lab">${ICO[s]} ${LBL[s]}</div><div class="val">${C[s].n}</div>
        <div class="sub">${s === 'perdu' ? eur(C[s].perdu) + ' sur leur dernière année' : eur(C[s].rec) + ' récents' + (s !== 'nouveau' ? ` · <b>${sgn(C[s].delta)}${eur(C[s].delta)}</b>` : '')}</div></div>`;

    const liste = a.rows.filter(r => !S.filtre || r.statut === S.filtre)
      .filter(r => !S.q || normKey(r.c.nom).includes(normKey(S.q)))
      .sort((x,y) => S.filtre === 'perdu' ? y.caPerdu - x.caPerdu : (y.score ?? -1) - (x.score ?? -1) || (x.deltaRef||0) - (y.deltaRef||0));

    const P = a.proj;
    const tableDelta = (l) => `<div class="tw"><table><thead><tr><th>Client</th>${comTh()}<th class="num">Récent</th><th class="num">Attendu</th><th class="num">Écart</th><th>Base</th><th>Fiab.</th></tr></thead><tbody>
      ${l.length ? l.map(r => `<tr><td>${lnk(r)}${r.affaires.length ? ' <span class="tag mute" title="Commande exceptionnelle neutralisée dans le calcul">affaire</span>' : ''}</td>${comTd(r)}
        <td class="num">${eur(r.recC)}</td><td class="num">${eur(r.attendu)}</td>
        <td class="num" style="color:var(${r.deltaRef>=0?'--ok':'--bad'},inherit);font-weight:600">${sgn(r.deltaRef)}${eur(r.deltaRef)}</td>
        <td class="hint">${BASE[r.base]||'—'}</td><td>${tagC(r.confiance)}</td></tr>`).join('') : vide('Aucun client', 7)}</tbody></table></div>`;

    const bt = S.bt;
    const btHtml = bt === 'calc' ? '<p class="hint">Calcul en cours…</p>'
      : !bt ? `<p class="hint" style="margin-top:0">On se replace à des mois passés, avec seulement les données connues à l'époque, et on regarde si les clients signalés ont vraiment baissé de moitié ou plus dans les 3 mois suivants. On compare aussi à l'ancienne règle de l'onglet Analyse.</p>
        <button class="btn sm" onclick="an2Backtest()">▶ Lancer le test sur le passé</button>`
      : !bt.points.length ? `<p class="hint">${esc(bt.msg||'Pas assez d\'historique.')}</p>`
      : `<p class="hint" style="margin-top:0">${bt.points.length} mois testés (${bt.points.map(p => monthLabel(p.Mb)).join(', ')}) · ${num(bt.n)} situations client · ${pct(bt.base)} ont réellement chuté (taux de base).</p>
        <div class="tw"><table><thead><tr><th>Règle</th><th class="num">Signalés</th><th class="num">Justes (précision)</th><th class="num">Chutes repérées (rappel)</th></tr></thead><tbody>
        <tr><td>Ancienne règle (recul ou décroché)</td><td class="num">${num(bt.v1.sig)}</td><td class="num">${bt.v1.pr===null?'—':pct(bt.v1.pr)}</td><td class="num">${bt.v1.rc===null?'—':pct(bt.v1.rc)}</td></tr>
        ${bt.seuils.map(s => `<tr style="${s.s===bt.conseil.s?'font-weight:600':''}"><td>Score v2 ≥ ${s.s}${s.s===R.seuilRisque?' (réglage actuel)':''}${s.s===bt.conseil.s?' ✓ meilleur équilibre':''}</td><td class="num">${num(s.sig)}</td><td class="num">${s.pr===null?'—':pct(s.pr)}</td><td class="num">${s.rc===null?'—':pct(s.rc)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="hint">Précision : part des clients signalés qui ont vraiment chuté. Rappel : part des chutes réelles qui avaient été signalées. Une règle utile a une précision nettement au-dessus du taux de base.</p>`;

    const E = a.effet;
    return `
    <div class="card" style="background:linear-gradient(135deg,var(--panel),var(--panel2))">
      <div class="card-h" style="flex-wrap:wrap;gap:10px"><div>
        <div class="eyebrow">Analyse clients · ${S.com ? esc(whoName(S.com)) : "Toute l'équipe"}</div>
        <h2 style="font-size:24px;margin:2px 0">${monthLabel(M)}</h2>
        ${moisIncomplet(M) ? `<p class="note warn" style="margin:6px 0">Ce mois semble incomplet (en cours ou import partiel) : les statuts seront faussés. Choisis plutôt le dernier mois complet.</p>` : ''}
        <p class="hint">Comparaison : ${esc(a.bilan.per)}.</p>
        <p class="hint" style="margin:2px 0 0">Historique compta continu : ${X.cons} mois${X.cons < 15 ? ' (la comparaison N-1 et le test sur le passé demandent 15 mois et plus)' : ''}
          · ${X.saison ? 'coefficient de saison ' + pct(X.saison*100) : 'pas de coefficient de saison'}
          · marges réellement saisies sur ${pct(100 - a.partEstimee)} du CA récent · calcul ${Math.round(performance.now() - t0)} ms</p>
      </div>
      <div class="btnrow" style="gap:8px;flex-wrap:wrap;align-items:center">
        <select style="width:auto" onchange="an2Set('com',this.value)"><option value="">Toute l'équipe</option>
          ${DB.commerciaux.map(c => `<option value="${esc(c.id)}" ${S.com===c.id?'selected':''}>${esc(c.nom)}</option>`).join('')}</select>
        <select style="width:auto" onchange="an2Set('mk',this.value)">${ms.map(m => `<option value="${m}" ${M===m?'selected':''}>${monthLabel(m)}</option>`).join('')}</select>
        <button class="btn ghost sm" onclick="an2Reglages()">⚙ Seuils</button>
      </div></div>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-h"><h3>✅ Ce qui va</h3></div>${ul(a.bilan.ok)}</div>
      <div class="card"><div class="card-h"><h3>⚠️ Ce qui ne va pas</h3></div>${ul(a.bilan.ko)}</div>
    </div>
    ${a.bilan.prio.length ? `<div class="note warn" style="margin-top:16px"><b>Priorités :</b> ${a.bilan.prio.map(esc).join(' · ')}</div>` : ''}

    <div class="grid g-auto" style="margin-top:16px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      ${['progression','stable','recul','decroche','perdu','nouveau'].map(kpi).join('')}
    </div>

    <div class="card" style="margin-top:16px"><div class="card-h"><h3>🔮 Projection de l'exercice ${P.y}</h3>
      <span class="hint">${P.passe ? 'exercice terminé : chiffres réalisés' : 'réalisé + mois restants estimés (même mois N-1 × tendance des 3 derniers mois, sinon rythme récent)'}</span></div>
      <div class="tw"><table><thead><tr><th>Commercial</th><th class="num">Réalisé</th><th class="num">Projection</th><th class="num">Objectif</th><th>Atteinte</th><th class="num">Besoin / mois</th><th class="num">Rythme 3 mois</th><th class="num">Devis en attente (90 j)</th></tr></thead><tbody>
      ${P.coms.length ? P.coms.map(p => `<tr><td>${esc(p.co.nom)}${p.so?' <span class="tag mute">suivi seul</span>':''}</td><td class="num">${eur(p.realise)}</td><td class="num"><b>${eur(p.projete)}</b></td>
        <td class="num">${p.obj?eur(p.obj):'—'}</td><td>${p.att===null?'<span class="tag mute">—</span>':`<span class="tag ${p.att>=100?'ok':p.att>=90?'warn':'bad'}">${pct(p.att)}</span>`}</td>
        <td class="num">${p.besoin===null?'—':eur(p.besoin)}</td><td class="num">${eur(p.rythme)}</td><td class="num">${p.devis}${p.devisCA?' · '+eur(p.devisCA):''}</td></tr>`).join('') : vide('Aucun commercial', 8)}
      </tbody></table></div>
      <p class="hint" style="margin-bottom:0">Les devis ne sont pas comptés dans la projection : ils sont affichés à part, comme réserve possible.</p></div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-h"><h3>🚨 Clients à risque <span class="tag bad">${a.urgents.length}</span></h3><span class="hint">score ≥ ${R.seuilRisque} · ${eur(a.caRisque)} en jeu</span></div>
        <div class="tw" style="max-height:420px;overflow:auto"><table><thead><tr><th>Client</th>${comTh()}<th>Score</th><th class="num">En jeu</th><th>Pourquoi</th></tr></thead><tbody>
        ${a.urgents.length ? a.urgents.slice(0,25).map(r => `<tr><td>${lnk(r)}</td>${comTd(r)}<td>${tagR(r.score)}</td><td class="num">${eur(r.caRisque)}</td><td class="hint">${esc(r.raisons.slice(0,2).join(' · '))}</td></tr>`).join('') : vide('Aucun client à risque 👍', 5)}
        </tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>⏰ Commandes attendues <span class="tag warn">${a.attendues.length}</span></h3><span class="hint">en retard sur leur rythme habituel</span></div>
        <div class="tw" style="max-height:420px;overflow:auto"><table><thead><tr><th>Client</th>${comTh()}<th>Attendue</th><th>Rythme</th><th class="num">CA 12 mois</th></tr></thead><tbody>
        ${a.attendues.length ? a.attendues.slice(0,25).map(r => `<tr><td>${lnk(r)}</td>${comTd(r)}<td>${monthLabel(r.prochaine)}</td><td class="hint">tous les ${num(r.cycle)} mois</td><td class="num">${eur(r.ca12)}</td></tr>`).join('') : vide('Aucune', 5)}
        </tbody></table></div></div>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-h"><h3>📈 Au-dessus de l'attendu</h3></div>${tableDelta(a.hausses)}</div>
      <div class="card"><div class="card-h"><h3>📉 En dessous de l'attendu</h3></div>${tableDelta(a.baisses)}</div>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-h"><h3>⚫ Clients perdus <span class="tag bad">${a.perdus.length}</span></h3><span class="hint">plus de commande depuis 6 mois ou 3 fois leur rythme</span></div>
        <div class="tw" style="max-height:360px;overflow:auto"><table><thead><tr><th>Client</th>${comTh()}<th>Dernier achat</th><th class="num">CA dernière année</th><th>Dernière visite</th></tr></thead><tbody>
        ${a.perdus.length ? a.perdus.slice(0,30).map(r => `<tr><td>${lnk(r)}</td>${comTd(r)}<td>${monthLabel(r.lastBuy)}</td><td class="num">${eur(r.caPerdu)}</td><td>${r.lastVis?fdate(r.lastVis.date):'<span class="hint">jamais</span>'}</td></tr>`).join('') : vide('Aucun client perdu 👍', 5)}
        </tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>💶 Alertes marge <span class="tag warn">${a.alertesMarge.length}</span></h3><span class="hint">taux saisis uniquement · clients ≥ 300 €</span></div>
        <div class="tw" style="max-height:360px;overflow:auto"><table><thead><tr><th>Client</th>${comTh()}<th class="num">Marge</th><th class="num">Avant</th><th class="num">Réf.</th><th>Motif</th></tr></thead><tbody>
        ${a.alertesMarge.length ? a.alertesMarge.slice(0,30).map(r => `<tr><td>${lnk(r)}</td>${comTd(r)}<td class="num"><span class="tag bad">${pct(r.mRec.t)}</span></td>
          <td class="num">${r.mHist.t===null?'—':pct(r.mHist.t)}</td><td class="num">${r.margeRef===null?'—':pct(r.margeRef)}</td><td class="hint">${esc(r.margeWhy.join(' · '))}</td></tr>`).join('') : vide('Aucune alerte marge 👍', 6)}
        </tbody></table></div>
        ${a.partEstimee > 20 ? `<p class="note" style="margin-bottom:0">${pct(a.partEstimee)} du CA récent n'a qu'un taux de marge estimé : ces clients sont exclus des alertes. Saisir les taux réels rendra cette section plus complète.</p>` : ''}</div>
    </div>

    <div class="card" style="margin-top:16px"><div class="card-h"><h3>🚗 Effet mesuré des visites</h3>
      <span class="hint">CA des 3 mois à partir de la visite moins les 3 mois d'avant, corrigé de l'évolution des clients non visités · ${E.mois} mois exploitables</span></div>
      ${E.mois ? `<div class="grid g3">
        <div><h4 style="margin:0 0 8px">Par commercial</h4><div class="tw"><table><thead><tr><th>Commercial</th><th class="num">Visites</th><th class="num">Effet moyen</th><th class="num">Cde ≤ 1 mois</th></tr></thead><tbody>
          ${E.parCom.length ? E.parCom.map(x => `<tr><td>${esc(whoName(x.k))}</td><td class="num">${x.n}</td><td class="num" style="color:var(${x.net>=0?'--ok':'--bad'},inherit)">${sgn(x.net)}${eur(x.net)}</td><td class="num">${pct(x.cmd)}</td></tr>`).join('') : vide('Pas assez de visites', 4)}</tbody></table></div></div>
        <div><h4 style="margin:0 0 8px">Par type de visite</h4><div class="tw"><table><thead><tr><th>Type</th><th class="num">Visites</th><th class="num">Effet moyen</th><th class="num">Cde ≤ 1 mois</th></tr></thead><tbody>
          ${E.parType.length ? E.parType.map(x => `<tr><td>${esc(x.k)}</td><td class="num">${x.n}</td><td class="num" style="color:var(${x.net>=0?'--ok':'--bad'},inherit)">${sgn(x.net)}${eur(x.net)}</td><td class="num">${pct(x.cmd)}</td></tr>`).join('') : vide('Pas assez de visites', 4)}</tbody></table></div></div>
        <div><h4 style="margin:0 0 8px">Fréquence de visite et évolution sur un an</h4><div class="tw"><table><thead><tr><th>Visites / 12 mois</th><th class="num">Clients</th><th class="num">Évolution médiane</th></tr></thead><tbody>
          ${E.freq.map(f => `<tr><td>${f.lab}</td><td class="num">${f.n}</td><td class="num">${f.med===null?'—':sgn(f.med)+pct(f.med)}</td></tr>`).join('')}</tbody></table></div>
          <p class="hint">Lien observé, pas une preuve : on visite aussi plus souvent les clients qui vont bien.</p></div>
      </div>` : '<p class="hint">Il faut au moins 6 mois de compta continus autour des visites pour mesurer leur effet.</p>'}
      <div class="grid g3" style="margin-top:14px">
        <div><h4 style="margin:0 0 8px">🟠 Visites sans effet mesuré <span class="tag warn">${a.sansRetour.length}</span></h4>
          <p class="hint" style="margin-top:0">3 visites ou plus ces 8 derniers mois, effet moyen nul ou négatif.</p>
          <div class="tw"><table><tbody>${a.sansRetour.length ? a.sansRetour.slice(0,12).map(r => `<tr><td>${lnk(r)}<div class="hint">${r.visNets.length} visites · effet ${sgn(mean(r.visNets))}${eur(mean(r.visNets))}</div></td><td class="num">${eur(r.ca12)}</td></tr>`).join('') : vide('Aucun', 2)}</tbody></table></div></div>
        <div><h4 style="margin:0 0 8px">⚪ Gros clients non visités <span class="tag info">${a.jamaisVus.length}</span></h4>
          <p class="hint" style="margin-top:0">Dans les 20 % premiers sur 12 mois, aucune visite depuis 12 mois.</p>
          <div class="tw"><table><tbody>${a.jamaisVus.length ? a.jamaisVus.slice(0,12).map(r => `<tr><td>${lnk(r)}<div class="hint">${esc(whoName(r.c.commercial))}</div></td><td class="num">${eur(r.ca12)}</td></tr>`).join('') : vide('Aucun 👍', 2)}</tbody></table></div></div>
        <div><h4 style="margin:0 0 8px">💎 Sous-exploités <span class="tag info">${a.sousExploites.length}</span></h4>
          <p class="hint" style="margin-top:0">Ont déjà acheté bien plus sur 12 mois qu'aujourd'hui, et peu visités (≤ 1 en 6 mois).</p>
          <div class="tw"><table><tbody>${a.sousExploites.length ? a.sousExploites.slice(0,12).map(r => `<tr><td>${lnk(r)}<div class="hint">meilleure année ${eur(r.pot)} · aujourd'hui ${eur(r.ca12)}</div></td><td class="num">+${eur(r.pot - r.ca12)}</td></tr>`).join('') : vide('Aucun', 2)}</tbody></table></div></div>
      </div>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-h"><h3>🎯 Dépendance aux gros clients</h3><span class="hint">CA des 12 derniers mois</span></div>
        ${a.conc.map(c => `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:center"><b>${esc(c.co.nom)}</b>
          <span class="tag ${c.risque}">${c.risque==='bad'?'Risque élevé':c.risque==='warn'?'À surveiller':'Bien réparti'}</span></div>
          <div class="sub hint">${c.n} clients actifs · ${eur(c.tot)}</div>
          <div class="hint" style="margin-top:6px">Top 5 : ${pct(c.t5)}</div><div class="bar"><i class="${c.risque==='ok'?'ok':'bad'}" style="width:${Math.min(100,c.t5)}%"></i></div>
          <div class="hint" style="margin-top:6px">Top 10 : ${pct(c.t10)}</div><div class="bar"><i style="width:${Math.min(100,c.t10)}%"></i></div></div>`).join('') || '<p class="hint">—</p>'}</div>
      <div class="card"><div class="card-h"><h3>🌱 Nouveaux clients des 12 derniers mois</h3></div>
        <p class="hint" style="margin-top:0">Vrais nouveaux : première commande précédée d'au moins 6 mois connus sans achat (la règle des primes, elle, n'est pas changée).</p>
        <div class="grid g3" style="margin-bottom:12px">
          <div class="kpi info"><div class="lab">Nouveaux</div><div class="val">${a.nv.n}</div></div>
          <div class="kpi ok"><div class="lab">Ont recommandé</div><div class="val">${a.nv.fideles}</div><div class="sub">${pct(a.nv.taux)}</div></div>
          <div class="kpi bad"><div class="lab">Une seule commande</div><div class="val">${a.nv.unique}</div></div></div>
        <div class="tw" style="max-height:240px;overflow:auto"><table><thead><tr><th>À relancer</th>${comTh()}<th>1re commande</th><th class="num">CA</th></tr></thead><tbody>
          ${a.nv.aRelancer.length ? a.nv.aRelancer.slice(0,30).map(r => `<tr><td>${lnk(r)}</td>${comTd(r)}<td>${monthLabel(r.nvM)}</td><td class="num">${eur(r.ca12)}</td></tr>`).join('') : vide('Tous ont recommandé 👍', 4)}
        </tbody></table></div></div>
    </div>

    <div class="card" style="margin-top:16px"><div class="card-h"><h3>🧪 Fiabilité : test sur le passé</h3></div>${btHtml}</div>

    <div class="card" id="an2Liste" style="margin-top:16px"><div class="card-h" style="flex-wrap:wrap;gap:8px"><h3>Tous les clients <span class="tag mute">${liste.length}</span></h3>
      <div class="chiprow">${['','progression','stable','recul','decroche','perdu','nouveau'].map(s => `<span class="chip ${S.filtre===s?'on':''}" onclick="an2Set('filtre',${js(s)})">${s?ICO[s]+' '+LBL[s]:'Tous'}</span>`).join('')}</div>
      <input placeholder="Rechercher un client…" value="${esc(S.q)}" style="width:200px" onchange="an2Set('q',this.value)"></div>
      <div class="tw" style="max-height:560px;overflow:auto"><table><thead><tr><th>Client</th>${comTh()}<th>Statut</th><th>Fiab.</th><th>Risque</th><th class="num">Récent</th><th class="num">Attendu</th><th>Écart</th><th class="num">Tendance</th><th class="num">Marge</th><th class="num">CA 12 mois</th><th>Prochaine cde</th><th>Dernière visite</th></tr></thead><tbody>
        ${liste.length ? liste.slice(0,400).map(r => `<tr style="cursor:pointer" onclick="an2Fiche(${js(r.c.id)})"><td>${esc(r.c.nom)}</td>${comTd(r)}<td>${tagS(r.statut)}</td>
<td>${tagC(r.confiance)}</td><td>${tagR(r.score)}</td>
          <td class="num">${eur(r.recC)}</td><td class="num">${r.attendu===null?'—':eur(r.attendu)}</td><td>${tagV(r.varRef===null?null:r.varRef*100)}</td>
          <td class="num">${r.tendance===null?'—':sgn(r.tendance)+pct(r.tendance)}</td><td class="num">${r.mRec.t===null?'<span class="hint">estimée</span>':pct(r.mRec.t)}</td>
          <td class="num">${eur(r.ca12)}</td><td>${r.statut==='perdu'?'—':monthLabel(r.prochaine)}</td><td>${r.lastVis?fdate(r.lastVis.date):'<span class="hint">jamais</span>'}</td></tr>`).join('') : vide('Aucun client', 13)}
      </tbody></table></div>
      ${liste.length > 400 ? `<p class="hint">400 premiers affichés sur ${liste.length} : utilise les filtres ou la recherche.</p>` : ''}
    </div>`;
  };

  /* ---------- Fiche client v2 ---------- */
  window.an2Fiche = id => {
    const a = window.__AN2_LAST; if(!a) return;
    const r = a.rows.find(x => x.c.id === id); if(!r) return;
    const X = a.X, c = r.c, ms = X.H;
    const vals = ms.map(m => r.ser[m]);
    const max = Math.max(1, ...vals.map(v => v || 0));
    const W = 560, H = 140, bw = W / ms.length;
    const svg = `<svg viewBox="0 0 ${W} ${H+22}" style="width:100%;height:auto">
      ${vals.map((v,i) => { const m = ms[i]; if(v === null) return `<rect x="${i*bw+3}" y="${H-4}" width="${bw-6}" height="4" fill="currentColor" opacity=".15"><title>${monthLabel(m)} : pas de fichier compta</title></rect>`;
        const h = Math.max(0, v) / max * H, rec = X.rec.includes(m), aff = r.affaires.includes(m);
        return `<rect x="${i*bw+3}" y="${H-h}" width="${bw-6}" height="${h}" rx="2" fill="${aff ? '#f0a030' : rec ? '#4d9bff' : '#4d9bff66'}"><title>${monthLabel(m)} : ${eur(v)}${aff ? ' (commande exceptionnelle)' : ''}</title></rect>
        ${i % 3 === 0 ? `<text x="${i*bw+bw/2}" y="${H+15}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".6">${monthLabel(m)}</text>` : ''}`; }).join('')}
    </svg>`;
    const comp = r.raisons.comp;
    const NOMS = {silence:'Silence anormal', tendance:'Tendance', ecart:'Écart à l\'attendu', marge:'Marge', visite:'Visite'};
    openModal(`
      <div class="card-h"><div><div class="eyebrow">${esc(whoName(c.commercial))}${c.reseau?' · '+esc(c.reseau):''}</div>
        <h2 style="margin:2px 0">${esc(c.nom)}</h2></div><button class="btn ghost sm" onclick="closeModal()">✕</button></div>
      <div style="margin:6px 0 12px">${tagS(r.statut)} ${tagC(r.confiance)} ${r.score!==null?'risque '+tagR(r.score):''}</div>
      <div class="grid g4" style="margin:10px 0">
        <div class="kpi"><div class="lab">CA 12 mois</div><div class="val" style="font-size:20px">${eur(r.ca12)}</div><div class="sub">année d'avant ${r.k12p?eur(r.ca12p):'—'}</div></div>
        <div class="kpi"><div class="lab">Récent / attendu</div><div class="val" style="font-size:20px">${eur(r.recC)}</div><div class="sub">attendu ${r.attendu===null?'—':eur(r.attendu)} · ${BASE[r.base]||'—'}</div></div>
        <div class="kpi"><div class="lab">Rythme d'achat</div><div class="val" style="font-size:20px">${num(r.cycle)} mois</div><div class="sub">dernier ${monthLabel(r.lastBuy)} · prochain ${r.statut==='perdu'?'—':monthLabel(r.prochaine)}</div></div>
        <div class="kpi"><div class="lab">Marge récente</div><div class="val" style="font-size:20px">${r.mRec.t===null?'—':pct(r.mRec.t)}</div><div class="sub">12 mois d'avant ${r.mHist.t===null?'—':pct(r.mHist.t)}</div></div>
      </div>
      <h4 style="margin:0 0 6px">CA mensuel sur 24 mois</h4>${svg}
      <p class="hint">En bleu vif : période analysée. En orange : commande exceptionnelle, comptée comme un mois habituel pour le calcul des statuts.</p>
      <div class="grid g2" style="margin-top:10px">
        <div><h4 style="margin:0 0 6px">Lecture</h4><ul style="margin:0;padding-left:18px;line-height:1.7">
          <li>Achète ${pct(r.p*100)} des mois. ${r.depuis ? `Sans commande depuis ${r.depuis} mois : un client actif à ce rythme n'a que ${pct(r.pSil*100)} de chances de rester aussi longtemps sans commander.` : 'A commandé le mois analysé.'}</li>
          <li>Tendance sur 12 mois : ${r.tendance===null?'pas assez de données':sgn(r.tendance)+pct(r.tendance)+' par an'}.</li>
          <li>Écart à l'attendu : ${r.deltaRef===null?'—':sgn(r.deltaRef)+eur(r.deltaRef)} ${r.signif?'(au-delà de ses variations habituelles)':'(dans ses variations habituelles)'}.</li>
          <li>${r.vis12} visite${r.vis12>1?'s':''} sur 12 mois${r.visNets && r.visNets.length ? `, effet moyen mesuré ${sgn(mean(r.visNets))}${eur(mean(r.visNets))}` : ''}.</li>
          <li>Meilleure année observée : ${eur(r.pot)}.</li></ul></div>
        <div><h4 style="margin:0 0 6px">Composantes du risque</h4>
          ${comp ? Object.keys(NOMS).map(k => `<div class="hint" style="margin-top:6px">${NOMS[k]} : ${Math.round(comp[k]*100)} %</div><div class="bar"><i class="${comp[k]>=.5?'bad':''}" style="width:${Math.round(comp[k]*100)}%"></i></div>`).join('') : '<p class="hint">Non calculé pour un client perdu ou nouveau.</p>'}</div>
      </div>`);
  };

  /* ---------- Réglages : enregistrés dans DB.settings.analyseV2 ---------- */
  const CH = [['seuil','Progression / recul à partir de (%)'],['seuilEur','… et d\'au moins (€ sur la période)'],['zMin','… et au-delà des variations habituelles (× écart-type)'],
    ['seuilMarge','Marge minimale (%)'],['baisseMarge','Baisse vs ses 12 mois d\'avant (pts)'],['ecartReseau','Écart sous son réseau (pts)'],
    ['joursVisite','Visite manquante au-delà de (jours)'],['seuilRisque','Client à risque à partir du score']];
  window.an2Reglages = () => openModal(`
    <div class="card-h"><h3>Seuils de l'analyse v2</h3><button class="btn ghost sm" onclick="closeModal()">✕</button></div>
    <p class="hint">Enregistrés avec les données : ils s'appliquent sur tous les postes.</p>
    <div class="grid g2">${CH.map(([k,l]) => `<div class="field"><label class="f">${l}</label><input type="number" step="any" id="an2_${k}" value="${R[k]}"></div>`).join('')}</div>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" onclick="AN2.apply()">Appliquer</button>
      <button class="btn ghost" onclick="AN2.reset()">Valeurs par défaut</button></div>`);
  const enregistrer = () => {
    DB.settings = DB.settings || {};
    DB.settings.analyseV2 = Object.assign({}, R);
    try{ save(); toast('Seuils enregistrés', 'ok'); }catch(e){}
  };
  window.AN2.apply = () => { CH.forEach(([k]) => { const v = +document.getElementById('an2_' + k).value; if(isFinite(v)) R[k] = v; }); enregistrer(); S.bt = null; closeModal(); render(); };
  window.AN2.reset = () => { Object.assign(R, DEF); enregistrer(); S.bt = null; closeModal(); render(); };

  /* Accès pour les tests */
  window.AN2.analyser = analyser; window.AN2.backtest = backtest; window.AN2.jo = jo;
})();
