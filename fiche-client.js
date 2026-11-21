/* ==========================================================================
   GIVEDIS OS — Fiche client détaillée
   --------------------------------------------------------------------------
   Remplace la fiche courte (clientModal). Un client GIVEDIS = toutes les
   fiches qui portent le même nom : la fiche du propriétaire (portefeuille)
   et, le cas échéant, celles des commerciaux qui y ont pris des commandes.
   Rien n'est fusionné dans les données : la fiche additionne pour l'affichage.

   Règle magasin : un client attribué au magasin appartient au magasin. Les
   commandes prises par un commercial comptent dans son CA, jamais comme
   nouveau compte (voir ficheMagasinDe / moisNouveau dans index.html).
   ========================================================================== */
(function(){
  'use strict';
  var RO = new URLSearchParams(location.search).has('lire');
  var FC = {id:null, y:null, chart:null};

  /* ---------- styles ---------- */
  var st = document.createElement('style');
  st.textContent =
    '.modal-in.fc-wide{width:min(1080px,100%);padding:24px 26px}' +
    '.fc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;padding-bottom:14px;border-bottom:2px solid var(--line2);margin-bottom:16px}' +
    '.fc-head h3{font-size:26px;line-height:1.1;margin:2px 0 6px}' +
    '.fc-meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--ink2)}' +
    '.fc-meta b{color:var(--ink);font-weight:600}' +
    '.fc-owner{text-align:right;min-width:200px}' +
    '.fc-owner .lab{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink3)}' +
    '.fc-owner .nm{font-size:19px;font-weight:700;color:var(--acc-deep);margin:2px 0 6px}' +
    '.fc-sec{margin:22px 0 10px;display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}' +
    '.fc-sec h4{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--acc-deep);margin:0}' +
    '.fc-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}' +
    '.fc-kpis .kpi{padding:12px 14px}.fc-kpis .val{font-size:22px}.fc-kpis .sub{font-size:12px}' +
    '@media(max-width:900px){.fc-kpis{grid-template-columns:repeat(2,1fr)}.fc-owner{text-align:left}}' +
    '.fc-chart{position:relative;height:230px;margin:6px 0 4px}' +
    '.fc-t td,.fc-t th{padding:7px 9px;font-size:13px}' +
    '.fc-t tfoot td{font-weight:700;border-top:2px solid var(--line2);background:#f1f5fa}' +
    '.fc-t tr.fut td{color:var(--ink3)}' +
    '.fc-up{color:#16743f}.fc-dn{color:#a92a3c}' +
    '.fc-part{display:inline-block;height:8px;border-radius:4px;background:var(--acc);vertical-align:middle;margin-right:6px}' +
    '.fc-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}' +
    '.fc-foot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:22px;padding-top:14px;border-top:1px solid var(--line)}';
  document.head.appendChild(st);

  /* ---------- outils ---------- */
  function sum(a){ return a.reduce(function(s, v){ return s + (+v || 0); }, 0); }
  function moisCourts(){ return ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.']; }
  function evo(n, p){ return p ? (n - p) / Math.abs(p) * 100 : null; }
  function evoHtml(n, p){
    var e = evo(n, p);
    if(e === null) return n ? '<span class="hint">nouveau</span>' : '<span class="hint">—</span>';
    return '<span class="' + (e >= 0 ? 'fc-up' : 'fc-dn') + '">' + (e >= 0 ? '+' : '') + pct(e) + '</span>';
  }
  function ecartHtml(d){ return d ? '<span class="' + (d >= 0 ? 'fc-up' : 'fc-dn') + '">' + (d > 0 ? '+' : '') + eur(d) + '</span>' : '—'; }
  function mgTxt(b){ return b.inconnue ? '—' : eur(b.mg) + (b.partielle ? ' *' : ''); }
  function txTxt(b){ return b.taux === null ? '—' : pct(b.taux); }
  function estMag(com){ return equipeDe(comObj(com)) === 'magasin'; }

  /* Toutes les fiches du même client (même nom). */
  function fichesDe(c){ return DB.clients.filter(function(x){ return x.nomKey === c.nomKey; }); }

  /* Dernier mois de l'exercice y à prendre en compte. */
  function limite(y){
    var now = todayISO().slice(0,4);
    if(y < now) return y + '-12';
    if(y > now) return null;
    return curMonth();
  }

  function caFiche(f, m){ return caClientMois(f, m); }
  /* Même ordre de priorité que tauxClient (index.html) ; le taux de repli,
     coûteux à calculer, est mis en cache le temps d'une fiche. */
  var REPLI = {};
  function taux(f, m){
    var mm = (f.margeByMonth || {})[m];
    if(mm != null && mm !== '') return +mm;
    if(f.margeDefaut != null && f.margeDefaut !== '') return +f.margeDefaut;
    var y = m.slice(0,4), com = commercialDe(f, y) || f.commercial, k = com + '|' + y;
    if(!(k in REPLI)){ var t = tauxMargeRenta(com, y); REPLI[k] = t ? t : null; } /* 0 = aucune marge connue */
    return REPLI[k];
  }
  /* Marge d'une fiche sur un mois : null si aucun taux n'est connu. */
  function margeFiche(f, m){
    var ca = caFiche(f, m); if(!ca) return 0;
    var t = taux(f, m);
    return t === null ? null : ca * t / 100;
  }
  /* Somme CA / marge / CA dont la marge est connue, sur des fiches et des mois. */
  function bloc(fs, ms){
    var r = {ca:0, mg:0, caMg:0};
    fs.forEach(function(f){ ms.forEach(function(m){
      var ca = caFiche(f, m); if(!ca) return;
      var mg = margeFiche(f, m);
      r.ca += ca; if(mg !== null){ r.mg += mg; r.caMg += ca; }
    }); });
    r.taux = r.caMg ? r.mg / r.caMg * 100 : null;
    r.inconnue = r.ca && !r.caMg;          /* aucune marge connue */
    r.partielle = r.caMg && r.caMg < r.ca; /* marge connue sur une partie du CA */
    return r;
  }
  function tauxEstime(fs, ms){
    return fs.some(function(f){ return ms.some(function(m){ return caFiche(f, m) && origineTaux(f, m) === 'repli' && taux(f, m) !== null; }); });
  }

  /* Propriétaire sur l'exercice y : le magasin s'il a une fiche dans la compta,
     sinon la fiche qui porte le plus de chiffre (y et y-1). */
  function proprio(fs, y, defaut){
    var ens = fs.filter(enCompta);
    var mag = ens.find(function(f){ return estMag(commercialDe(f, y)); });
    if(mag) return mag;
    if(ens.length <= 1) return ens[0] || defaut;
    var ms = monthsOfYear(y).concat(monthsOfYear(String(+y - 1)));
    return ens.slice().sort(function(a, b){
      return sum(ms.map(function(m){ return caFiche(b, m); })) - sum(ms.map(function(m){ return caFiche(a, m); }));
    })[0];
  }

  /* ---------- calcul de la fiche ---------- */
  function calcul(c, y){
    REPLI = {};
    var yP = String(+y - 1), fs = fichesDe(c);
    var own = proprio(fs, y, c);
    var lim = limite(y), msN = monthsOfYear(y), msP = monthsOfYear(yP);
    var nbM = lim ? +lim.slice(5,7) : 0;
    var caM = function(m){ return sum(fs.map(function(f){ return caFiche(f, m); })); };

    var mois = msN.map(function(m, i){
      var futur = !lim || m > lim;
      var bn = futur ? bloc([], []) : bloc(fs, [m]), bp = bloc(fs, [msP[i]]);
      return {i:i, m:m, mP:msP[i], futur:futur, n: bn.ca, p: bp.ca, bn:bn, bp:bp};
    });
    var stade = mois.filter(function(x){ return !x.futur; });
    var BN = bloc(fs, stade.map(function(x){ return x.m; })),
        BPs = bloc(fs, stade.map(function(x){ return x.mP; })),
        BP = bloc(fs, msP);
    var K = {
      caN: BN.ca, caPstade: BPs.ca, caP: BP.ca,
      mgN: BN.mg, mgPstade: BPs.mg, mgP: BP.mg,
      BN: BN, BPs: BPs, BP: BP,
      moisCdeN: stade.filter(function(x){ return x.n > 0; }).length,
      moisCdeP: mois.filter(function(x){ return x.p > 0; }).length,
      moisCdePstade: stade.filter(function(x){ return x.p > 0; }).length
    };
    K.tauxN = BN.taux; K.tauxP = BPs.taux;
    K.partielle = !!(BN.partielle || BPs.partielle || BP.partielle);
    K.panierN = K.moisCdeN ? K.caN / K.moisCdeN : 0;
    K.panierP = K.moisCdePstade ? K.caPstade / K.moisCdePstade : 0;
    K.estime = tauxEstime(fs, msN.concat(msP));

    /* Qui a fait le chiffre, par commercial (exercice y et y-1). */
    var parCom = {};
    fs.forEach(function(f){
      var com = commercialDe(f, y);
      var r = parCom[com] || (parCom[com] = {com:com, n:0, p:0, mois:0, fiches:[]});
      r.fiches.push(f);
      stade.forEach(function(x){ if(caFiche(f, x.m) > 0) r.mois++; });
      r.p += sum(msP.map(function(m){ return caFiche(f, m); }));
    });
    Object.keys(parCom).forEach(function(k){
      var r = parCom[k]; r.b = bloc(r.fiches, stade.map(function(x){ return x.m; })); r.n = r.b.ca;
    });
    var ownCom = commercialDe(own, y);
    var repart = Object.keys(parCom).map(function(k){ return parCom[k]; })
      .filter(function(r){ return r.n || r.p || r.com === ownCom; })
      .sort(function(a, b){ return (b.com === ownCom) - (a.com === ownCom) || b.n - a.n; });

    /* Historique annuel. */
    var ans = {};
    fs.forEach(function(f){ Object.keys(f.caByMonth || {}).forEach(function(m){ if(/^\d{4}-\d{2}$/.test(m)) ans[m.slice(0,4)] = 1; }); });
    ans[y] = 1;
    var histo = Object.keys(ans).sort().map(function(a){
      var ms = monthsOfYear(a), la = limite(a);
      var msA = ms.filter(function(m){ return la && m <= la; });
      var b = bloc(fs, msA), ca = b.ca;
      /* même stade l'année d'avant (utile pour l'exercice en cours) */
      var prevStade = sum(msA.map(function(m){ return caM(String(+a - 1) + m.slice(4)); }));
      var qui = {};
      fs.forEach(function(f){ var v = sum(msA.map(function(m){ return caFiche(f, m); })); if(v){ var k = commercialDe(f, a); qui[k] = (qui[k] || 0) + v; } });
      return {an:a, ca:ca, b:b, prevStade:prevStade, enCours: !!(la && la < a + '-12'), proprio: commercialDe(proprio(fs, a, own), a), qui:qui};
    });
    histo.forEach(function(h, i){ h.prev = i ? (h.enCours ? h.prevStade : histo[i - 1].ca) : null; });

    /* Activité terrain (toutes fiches). */
    var ids = {}; fs.forEach(function(f){ ids[f.id] = 1; });
    var vs = DB.visites.filter(function(v){ return ids[v.clientId]; })
      .sort(function(a, b){ return (b.date || '').localeCompare(a.date || ''); });
    var vsN = vs.filter(function(v){ return String(v.date || '').slice(0,4) === y; });
    var T = {
      visitesN: vsN.length,
      devisN: vsN.filter(function(v){ return +v.montantDevis; }),
      cdesN: vsN.filter(function(v){ return +v.montantCommande; }),
      relances: vs.filter(function(v){ return v.relance; }),
      derniere: vs[0] || null
    };

    /* Dernière commande en compta (tous exercices). */
    var derCde = null;
    fs.forEach(function(f){ Object.keys(f.caByMonth || {}).forEach(function(m){ if(+f.caByMonth[m] > 0 && (!derCde || m > derCde)) derCde = m; }); });

    /* Statut. */
    var statut;
    if(!fs.some(enCompta)) statut = {t:'Prospect', k:'warn', d:'absent du fichier compta'};
    else {
      var trois = [];
      if(lim){ var d0 = new Date(+lim.slice(0,4), +lim.slice(5,7) - 1, 1);
        for(var j = 0; j < 3; j++){ var d = new Date(d0.getFullYear(), d0.getMonth() - j, 1); trois.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); } }
      var recent = sum(trois.map(caM));
      var nv = moisNouveau(own, y);
      if(!K.caN && !K.caP) statut = {t:'Inactif', k:'mute', d:'aucun chiffre sur ' + yP + ' ni ' + y};
      else if(lim && !recent) statut = {t:'Dormant', k:'bad', d:'aucune commande depuis 3 mois'};
      else if(nv && !K.caP) statut = {t:'Nouveau client', k:'info', d:'depuis ' + monthLabel(nv)};
      else {
        var e = evo(K.caN, K.caPstade);
        statut = e === null ? {t:'Actif', k:'ok', d:'pas de chiffre ' + yP + ' au même stade'}
          : e > 5 ? {t:'En progression', k:'ok', d:'+' + pct(e) + ' vs ' + yP}
          : e < -5 ? {t:'En recul', k:'bad', d:pct(e) + ' vs ' + yP}
          : {t:'Stable', k:'info', d:(e >= 0 ? '+' : '') + pct(e) + ' vs ' + yP};
      }
    }

    var ouvert = fs.map(function(f){ return f.dateOuverture; }).filter(Boolean).sort()[0] || '';
    var contact = (own.contact && (own.contact.nom || own.contact.tel || own.contact.email)) ? own.contact
      : (fs.map(function(f){ return f.contact; }).find(function(x){ return x && (x.nom || x.tel || x.email); }) || null);

    return {c:c, y:y, yP:yP, fs:fs, own:own, ownCom:ownCom, lim:lim, nbM:nbM, mois:mois, K:K,
      repart:repart, histo:histo, vs:vs, T:T, derCde:derCde, statut:statut, ouvert:ouvert, contact:contact,
      reseau: own.reseau || (fs.find(function(f){ return f.reseau; }) || {}).reseau || '',
      dept: own.dept || (fs.find(function(f){ return f.dept; }) || {}).dept || ''};
  }

  /* ---------- affichage ---------- */
  function noteMarge(K){
    var t = [];
    if(K.partielle) t.push('* marge calculée sur la partie du CA dont le taux est connu (taux absent pour certains mois)');
    if(K.estime) t.push('une partie de la marge utilise le taux de repli');
    return t.length ? '<p class="hint" style="margin-top:6px">' + t.join(' ; ') + '.</p>' : '';
  }
  function stadeTxt(D){
    if(!D.lim) return 'exercice à venir';
    return D.nbM === 12 ? 'exercice complet' : 'janv. → ' + moisCourts()[D.nbM - 1];
  }
  function html(D){
    var K = D.K, y = D.y, yP = D.yP;
    var autres = D.repart.filter(function(r){ return r.com !== D.ownCom && r.n; });
    var ownMag = estMag(D.ownCom);
    var ys = exercices().slice().sort();

    var h = '<div class="fc-head"><div>' +
      '<div class="eyebrow">Fiche client · exercice ' + esc(y) + ' · ' + esc(stadeTxt(D)) + '</div>' +
      '<h3>' + esc(D.own.nom) + '</h3>' +
      '<div class="fc-meta">' +
        (D.reseau ? '<span>Réseau <b>' + esc(D.reseau) + '</b></span>' : '') +
        (D.dept ? '<span>Dépt <b>' + esc(D.dept) + '</b></span>' : '') +
        (D.ouvert ? '<span>Ouvert le <b>' + fdate(D.ouvert) + '</b></span>' : '') +
        (D.derCde ? '<span>Dernière commande <b>' + monthLabel(D.derCde) + '</b></span>' : '') +
        (D.T.derniere ? '<span>Dernière visite <b>' + fdate(D.T.derniere.date) + '</b></span>' : '') +
      '</div>' +
      (D.contact ? '<div class="fc-meta" style="margin-top:6px">Contact <b>' + esc(((D.contact.prenom || '') + ' ' + (D.contact.nom || '')).trim() || '—') + '</b>' +
        (D.contact.tel ? '<span>' + esc(D.contact.tel) + '</span>' : '') + (D.contact.email ? '<span>' + esc(D.contact.email) + '</span>' : '') + '</div>' : '') +
      '</div>' +
      '<div class="fc-owner"><div class="lab">Client de</div><div class="nm">' + esc(whoName(D.ownCom)) + '</div>' +
        '<span class="tag ' + D.statut.k + '" title="' + esc(D.statut.d) + '">' + esc(D.statut.t) + '</span> ' +
        (ownMag ? '<span class="tag mute">Magasin</span>' : '') +
        (autres.length ? '<div class="hint" style="margin-top:8px">Commandes prises aussi par <b>' + autres.map(function(r){ return esc(whoName(r.com)); }).join(', ') + '</b></div>' : '') +
        '<div style="margin-top:10px"><select style="width:auto" onchange="fcAnnee(this.value)">' +
          ys.map(function(a){ return '<option value="' + a + '"' + (a === y ? ' selected' : '') + '>Exercice ' + a + '</option>'; }).join('') +
        '</select></div>' +
      '</div></div>';

    /* Chiffres clés */
    var dCA = K.caN - K.caPstade;
    h += '<div class="fc-kpis">' +
      '<div class="kpi ' + (K.caPstade ? (dCA >= 0 ? 'ok' : 'bad') : '') + '"><div class="lab">CA ' + y + (D.nbM < 12 ? ' à date' : '') + '</div><div class="val">' + eur(K.caN) + '</div>' +
        '<div class="sub">' + (K.caPstade ? ecartHtml(dCA) + ' · ' + evoHtml(K.caN, K.caPstade) + ' vs ' + yP : 'pas de chiffre ' + yP + ' au même stade') + '</div></div>' +
      '<div class="kpi"><div class="lab">CA ' + yP + ' au même stade</div><div class="val">' + eur(K.caPstade) + '</div><div class="sub">' + esc(stadeTxt(D)) + '</div></div>' +
      '<div class="kpi info"><div class="lab">CA ' + yP + ' complet</div><div class="val">' + eur(K.caP) + '</div><div class="sub">' + K.moisCdeP + ' mois avec commande</div></div>' +
      '<div class="kpi"><div class="lab">Marge ' + y + (D.nbM < 12 && D.lim ? ' à date' : '') + '</div><div class="val">' + mgTxt(K.BN) + '</div>' +
        '<div class="sub">' + (K.tauxN !== null ? 'taux ' + pct(K.tauxN) : 'taux inconnu') + (K.tauxP !== null ? ' · ' + yP + ' ' + pct(K.tauxP) : '') + '</div></div>' +
      '<div class="kpi"><div class="lab">Marge ' + yP + ' au même stade</div><div class="val">' + mgTxt(K.BPs) + '</div><div class="sub">' +
        (K.BN.inconnue || K.BPs.inconnue ? 'comparaison impossible' : ecartHtml(K.mgN - K.mgPstade) + ' en ' + y) + '</div></div>' +
      '<div class="kpi"><div class="lab">Mois avec commande</div><div class="val">' + K.moisCdeN + ' / ' + D.nbM + '</div><div class="sub">' + yP + ' même stade : ' + K.moisCdePstade + '</div></div>' +
      '<div class="kpi"><div class="lab">Commande moyenne / mois</div><div class="val">' + eur(K.panierN) + '</div><div class="sub">' + yP + ' : ' + eur(K.panierP) + '</div></div>' +
      '<div class="kpi"><div class="lab">Visites ' + y + '</div><div class="val">' + D.T.visitesN + '</div><div class="sub">' + D.T.relances.length + ' relance' + (D.T.relances.length > 1 ? 's' : '') + ' ouverte' + (D.T.relances.length > 1 ? 's' : '') + '</div></div>' +
      '</div>' +
      noteMarge(K);

    /* Mois par mois */
    h += '<div class="fc-sec"><h4>Mois par mois</h4><span class="hint">CA et marge, tous commerciaux confondus</span></div>' +
      '<div class="fc-chart"><canvas id="fcChart"></canvas></div>' +
      '<div class="tw"><table class="fc-t"><thead><tr><th>Mois</th><th class="num">CA ' + y + '</th><th class="num">CA ' + yP + '</th><th class="num">Écart</th><th>Évol.</th>' +
      '<th class="num">Marge ' + y + '</th><th class="num">Taux ' + y + '</th><th class="num">Marge ' + yP + '</th><th class="num">Taux ' + yP + '</th></tr></thead><tbody>' +
      D.mois.map(function(x){
        return '<tr class="' + (x.futur ? 'fut' : '') + '"><td>' + moisCourts()[x.i] + '</td>' +
          '<td class="num mono">' + (x.futur ? '—' : x.n ? eur(x.n) : '<span class="hint">0 €</span>') + '</td>' +
          '<td class="num mono">' + (x.p ? eur(x.p) : '<span class="hint">0 €</span>') + '</td>' +
          '<td class="num mono">' + (x.futur ? '' : ecartHtml(x.n - x.p)) + '</td>' +
          '<td>' + (x.futur ? '' : evoHtml(x.n, x.p)) + '</td>' +
          '<td class="num mono">' + (x.futur || !x.n ? '—' : mgTxt(x.bn)) + '</td>' +
          '<td class="num mono">' + (x.futur || !x.n ? '—' : txTxt(x.bn)) + '</td>' +
          '<td class="num mono">' + (x.p ? mgTxt(x.bp) : '—') + '</td>' +
          '<td class="num mono">' + (x.p ? txTxt(x.bp) : '—') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total' + (D.nbM < 12 && D.lim ? ' ' + y + ' à date' : '') + '</td>' +
      '<td class="num mono">' + eur(K.caN) + '</td><td class="num mono">' + eur(K.caP) + '</td>' +
      '<td class="num mono">' + ecartHtml(K.caN - K.caPstade) + '</td><td>' + evoHtml(K.caN, K.caPstade) + '</td>' +
      '<td class="num mono">' + mgTxt(K.BN) + '</td><td class="num mono">' + txTxt(K.BN) + '</td>' +
      '<td class="num mono">' + mgTxt(K.BP) + '</td><td class="num mono">' + txTxt(K.BP) + '</td></tr></tfoot></table></div>' +
      (D.nbM < 12 && D.lim ? '<p class="hint" style="margin-top:6px">L\'écart et l\'évolution du total comparent ' + y + ' à date avec ' + yP + ' au même stade (' + esc(stadeTxt(D)) + ').</p>' : '');

    /* Qui a fait le chiffre */
    var totR = sum(D.repart.map(function(r){ return r.n; }));
    h += '<div class="fc-sec"><h4>Qui a fait le chiffre</h4><span class="hint">exercice ' + y + (D.nbM < 12 && D.lim ? ' à date' : '') + '</span></div>' +
      '<div class="tw"><table class="fc-t"><thead><tr><th>' + 'Commercial / vendeur</th><th>Rôle</th><th class="num">CA ' + y + '</th><th>Part</th><th class="num">Marge</th><th class="num">Mois avec cde</th><th class="num">CA ' + yP + '</th></tr></thead><tbody>' +
      D.repart.map(function(r){
        var part = totR ? r.n / totR * 100 : 0;
        var role = r.com === D.ownCom ? '<span class="tag ok">Propriétaire</span>'
          : ownMag ? '<span class="tag info" title="Client du magasin : CA compté pour le commercial, jamais nouveau compte">Commandes chez un client magasin</span>'
          : '<span class="tag mute">Commandes hors portefeuille</span>';
        return '<tr><td><strong>' + esc(whoName(r.com)) + '</strong>' + (estMag(r.com) ? ' <span class="tag mute">magasin</span>' : '') + '</td><td>' + role + '</td>' +
          '<td class="num mono">' + eur(r.n) + '</td>' +
          '<td><div class="fc-bar"><span class="fc-part" style="width:' + Math.max(2, Math.round(part)) + 'px;max-width:100px"></span>' + pct(part) + '</div></td>' +
          '<td class="num mono">' + mgTxt(r.b) + '</td><td class="num mono">' + r.mois + '</td><td class="num mono">' + eur(r.p) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (ownMag && autres.length ? '<p class="hint" style="margin-top:6px">Le client reste au magasin. Les commandes prises par les commerciaux comptent dans leur CA du mois, jamais comme nouveau compte.</p>' : '');

    /* Historique */
    h += '<div class="fc-sec"><h4>Historique par année</h4></div>' +
      '<div class="tw"><table class="fc-t"><thead><tr><th>Exercice</th><th>Client de</th><th class="num">CA</th><th>Évol.</th><th class="num">Marge</th><th class="num">Taux</th><th>Chiffre fait par</th></tr></thead><tbody>' +
      D.histo.slice().reverse().map(function(a){
        var qui = Object.keys(a.qui).sort(function(p, q){ return a.qui[q] - a.qui[p]; });
        return '<tr><td><strong>' + a.an + '</strong>' + (a.enCours ? ' <span class="tag mute">en cours</span>' : '') + '</td>' +
          '<td>' + esc(whoName(a.proprio)) + '</td>' +
          '<td class="num mono">' + eur(a.ca) + '</td><td>' + (a.prev === null ? '<span class="hint">—</span>' : evoHtml(a.ca, a.prev) + (a.enCours ? ' <span class="hint">même stade</span>' : '')) + '</td>' +
          '<td class="num mono">' + mgTxt(a.b) + '</td><td class="num mono">' + txTxt(a.b) + '</td>' +
          '<td class="hint">' + (qui.length ? qui.map(function(k){ return esc(whoName(k)) + ' ' + pct(a.ca ? a.qui[k] / a.ca * 100 : 0); }).join(' · ') : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="hint" style="margin-top:6px">Exercice en cours : CA jusqu\'au mois en cours, comparé à l\'année d\'avant au même stade.</p>';

    /* Activité terrain */
    var sD = sum(D.T.devisN.map(function(v){ return v.montantDevis; })), sC = sum(D.T.cdesN.map(function(v){ return v.montantCommande; }));
    h += '<div class="fc-sec"><h4>Activité terrain</h4><span class="hint">montants de l\'appli de visites, pour information : ils ne comptent pas dans le CA</span></div>' +
      '<div class="fc-kpis" style="margin-bottom:12px">' +
        '<div class="kpi info"><div class="lab">Visites ' + y + '</div><div class="val">' + D.T.visitesN + '</div><div class="sub">' + D.vs.length + ' au total</div></div>' +
        '<div class="kpi"><div class="lab">Devis ' + y + '</div><div class="val">' + D.T.devisN.length + '</div><div class="sub">' + eur(sD) + '</div></div>' +
        '<div class="kpi ok"><div class="lab">Commandes ' + y + '</div><div class="val">' + D.T.cdesN.length + '</div><div class="sub">' + eur(sC) + '</div></div>' +
        '<div class="kpi ' + (D.T.relances.length ? 'bad' : '') + '"><div class="lab">Relances ouvertes</div><div class="val">' + D.T.relances.length + '</div><div class="sub">' +
          (D.T.relances.length ? D.T.relances.map(function(v){ return v.relanceDate ? fdate(v.relanceDate) : 'non datée'; }).slice(0,3).join(' · ') : 'rien en attente') + '</div></div>' +
      '</div>' +
      (D.vs.length ? '<div class="tw"><table class="fc-t"><thead><tr><th>Date</th><th>Par</th><th>Type</th><th>Résultat</th><th>Compte rendu</th></tr></thead><tbody>' +
        D.vs.slice(0, 15).map(function(v){
          return '<tr><td class="mono">' + fdate(v.date) + '</td><td>' + esc(whoName(v.commercial)) + '</td><td>' + esc(v.type || '—') + '</td>' +
            '<td><span class="tag ' + tagResultat(v.resultat) + '">' + esc(v.resultat || '—') + '</span>' +
              (+v.montantCommande ? '<div class="hint">cde ' + eur(v.montantCommande) + '</div>' : +v.montantDevis ? '<div class="hint">devis ' + eur(v.montantDevis) + '</div>' : '') + '</td>' +
            '<td style="color:var(--ink2)">' + esc(v.compteRendu || '—') + (typeof prospHtml === 'function' ? prospHtml(v) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' + (D.vs.length > 15 ? '<p class="hint" style="margin-top:6px">15 dernières visites affichées sur ' + D.vs.length + '.</p>' : '')
        : '<p class="hint">Aucune visite pour ce client.</p>');

    /* Pied */
    var cf = D.c;
    h += '<div class="fc-foot"><div class="btnrow">' +
        '<button class="btn" onclick="fcPdf()">Export PDF</button>' +
        '<button class="btn ghost" onclick="closeModal()">Fermer</button></div>' +
      (RO ? '' : '<div class="btnrow"><button class="btn danger sm" onclick="delClient(\'' + cf.id + '\')"' +
        ' title="Supprime uniquement la fiche ouverte et ses visites">Supprimer la fiche ' + esc(whoName(cf.commercial)) + '</button></div>') +
      '</div>';
    return h;
  }

  function graphe(D){
    var el = document.getElementById('fcChart');
    if(!el || typeof Chart === 'undefined') return;
    if(FC.chart){ try{ FC.chart.destroy(); }catch(e){} }
    FC.chart = new Chart(el, {type:'bar',
      data:{labels: moisCourts(), datasets:[
        {label:'CA ' + D.yP, data: D.mois.map(function(x){ return Math.round(x.p); }), backgroundColor:'#c3cedb', borderRadius:3},
        {label:'CA ' + D.y, data: D.mois.map(function(x){ return x.futur ? null : Math.round(x.n); }), backgroundColor:'#1f5a96', borderRadius:3}
      ]},
      options:{responsive:true, maintainAspectRatio:false,
        plugins:{legend:{position:'top', align:'end', labels:{boxWidth:12}},
          tooltip:{callbacks:{label:function(t){ return t.dataset.label + ' : ' + eur(t.raw); }}}},
        scales:{y:{beginAtZero:true, ticks:{callback:function(v){ return eur(v); }}}, x:{grid:{display:false}}}}});
  }

  /* ---------- ouverture ---------- */
  function ouvrir(){
    var c = clientById(FC.id); if(!c) return;
    var D = calcul(c, FC.y);
    openModal(html(D));
    document.getElementById('modalIn').classList.add('fc-wide');
    setTimeout(function(){ graphe(D); }, 0);
  }
  window.clientModal = function(id){
    FC.id = id; FC.y = String(YEAR || todayISO().slice(0,4));
    ouvrir();
    var m = document.getElementById('modalIn'); if(m) m.scrollTop = 0;
  };
  window.fcAnnee = function(y){ FC.y = String(y); ouvrir(); };

  var openOrig = window.openModal, closeOrig = window.closeModal;
  window.openModal = function(h){
    var m = document.getElementById('modalIn'); if(m) m.classList.remove('fc-wide');
    if(FC.chart){ try{ FC.chart.destroy(); }catch(e){} FC.chart = null; }
    return openOrig(h);
  };
  window.closeModal = function(){
    var m = document.getElementById('modalIn'); if(m) m.classList.remove('fc-wide');
    if(FC.chart){ try{ FC.chart.destroy(); }catch(e){} FC.chart = null; }
    return closeOrig();
  };

  /* ---------- export PDF ---------- */
  window.fcPdf = function(){
    var c = clientById(FC.id); if(!c) return;
    if(!window.jspdf){ toast('Bibliothèque PDF non chargée', 'bad'); return; }
    var D = calcul(c, FC.y), K = D.K, y = D.y, yP = D.yP;
    var doc = new window.jspdf.jsPDF();
    /* jsPDF (police standard) ne connaît ni l'espace fine ni l'euro : on écrit « 14 600 EUR ». */
    var e2 = function(n){ return (Math.round(+n || 0)).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ').replace('\u2212', '-') + ' EUR'; };
    var st2 = function(){ return clean(stadeTxt(D).replace('\u2192', 'a')); };
    var p2 = function(n){ return n === null || n === undefined || !isFinite(n) ? '-' : clean(pct(n)); };
    var mg2 = function(b){ return b.inconnue ? '-' : e2(b.mg) + (b.partielle ? ' *' : ''); };
    var tx2 = function(b){ return b.taux === null ? '-' : p2(b.taux); };
    var ev = function(n, p){ var e = evo(n, p); return e === null ? '-' : (e >= 0 ? '+' : '') + p2(e); };
    var after = function(){ return doc.lastAutoTable.finalY + 8; };
    var titre = function(t, yy){ doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(22,63,107); doc.text(clean(t), 14, yy); doc.setFont(undefined, 'normal'); doc.setTextColor(30,30,30); return yy + 3; };

    pdfHead(doc, 'Fiche client - ' + D.own.nom, 'Exercice ' + y + ' (' + st2() + ') - edite le ' + fdate(todayISO()));
    doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.text(clean(D.own.nom), 14, 42);
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    var autres = D.repart.filter(function(r){ return r.com !== D.ownCom && r.n; });
    var l1 = ['Client de : ' + whoName(D.ownCom) + (estMag(D.ownCom) ? ' (magasin)' : ''), 'Statut : ' + D.statut.t + ' (' + D.statut.d + ')'];
    var l2 = [D.reseau && 'Reseau : ' + D.reseau, D.dept && 'Dept : ' + D.dept, D.ouvert && 'Ouvert le ' + fdate(D.ouvert),
      D.derCde && 'Derniere commande : ' + monthLabel(D.derCde), D.T.derniere && 'Derniere visite : ' + fdate(D.T.derniere.date)].filter(Boolean);
    doc.text(clean(l1.join('   |   ')), 14, 48);
    doc.text(clean(l2.join('   |   ')), 14, 53);
    var yy = 58;
    if(autres.length){ doc.text(clean('Commandes prises aussi par : ' + autres.map(function(r){ return whoName(r.com); }).join(', ')), 14, yy); yy += 5; }

    doc.autoTable(Object.assign({startY: yy + 2,
      head:[['Indicateur', y + (D.nbM < 12 ? ' a date' : ''), yP + ' meme stade', 'Ecart', yP + ' complet']],
      body:[
        ['CA', e2(K.caN), e2(K.caPstade), ev(K.caN, K.caPstade), e2(K.caP)],
        ['Marge', mg2(K.BN), mg2(K.BPs), K.BN.inconnue || K.BPs.inconnue ? '-' : e2(K.mgN - K.mgPstade), mg2(K.BP)],
        ['Taux de marge', tx2(K.BN), tx2(K.BPs), K.tauxN !== null && K.tauxP !== null ? (K.tauxN - K.tauxP >= 0 ? '+' : '') + clean((K.tauxN - K.tauxP).toLocaleString('fr-FR', {maximumFractionDigits:1})) + ' pt' : '-', tx2(K.BP)],
        ['Mois avec commande', K.moisCdeN + ' / ' + D.nbM, String(K.moisCdePstade), '', String(K.moisCdeP)],
        ['Commande moyenne / mois', e2(K.panierN), e2(K.panierP), ev(K.panierN, K.panierP), '']
      ]}, TBL, {columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'}}}));

    yy = titre('Mois par mois', after());
    doc.autoTable(Object.assign({startY: yy,
      head:[['Mois', 'CA ' + y, 'CA ' + yP, 'Ecart', 'Evol.', 'Marge ' + y, 'Taux ' + y, 'Marge ' + yP]],
      body: D.mois.map(function(x){
        return [clean(moisCourts()[x.i]), x.futur ? '-' : e2(x.n), e2(x.p), x.futur ? '' : e2(x.n - x.p), x.futur ? '' : ev(x.n, x.p),
          x.futur || !x.n ? '-' : mg2(x.bn), x.futur || !x.n ? '-' : tx2(x.bn), x.p ? mg2(x.bp) : '-'];
      }),
      foot:[['Total', e2(K.caN), e2(K.caP), e2(K.caN - K.caPstade), ev(K.caN, K.caPstade), mg2(K.BN), tx2(K.BN), mg2(K.BP)]],
      footStyles:{fillColor:[230,236,243], textColor:[22,63,107], fontStyle:'bold', fontSize:8.5}},
      TBL, {columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right'}}}));
    var dec = 0;
    if(D.nbM < 12 && D.lim){ doc.setFontSize(7.5); doc.setTextColor(110,120,140);
      doc.text(clean('Ecart et evolution du total : ' + y + ' a date compare a ' + yP + ' au meme stade (' + st2() + ').'), 14, doc.lastAutoTable.finalY + 4); doc.setTextColor(30,30,30); dec = 4; }

    var totR = sum(D.repart.map(function(r){ return r.n; }));
    yy = titre('Qui a fait le chiffre - ' + y, after() + dec);
    doc.autoTable(Object.assign({startY: yy,
      head:[['Commercial / vendeur', 'Role', 'CA ' + y, 'Part', 'Marge', 'CA ' + yP]],
      body: D.repart.map(function(r){
        return [clean(whoName(r.com)), r.com === D.ownCom ? 'Proprietaire' : estMag(D.ownCom) ? 'Commandes chez un client magasin' : 'Commandes hors portefeuille',
          e2(r.n), p2(totR ? r.n / totR * 100 : 0), mg2(r.b), e2(r.p)];
      })}, TBL, {columnStyles:{2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'}}}));

    yy = titre('Historique par annee', after());
    doc.autoTable(Object.assign({startY: yy,
      head:[['Exercice', 'Client de', 'CA', 'Evol.', 'Marge', 'Taux']],
      body: D.histo.slice().reverse().map(function(a){
        return [a.an + (a.enCours ? ' (en cours)' : ''), clean(whoName(a.proprio)), e2(a.ca), a.prev === null ? '-' : ev(a.ca, a.prev) + (a.enCours ? ' (meme stade)' : ''), mg2(a.b), tx2(a.b)];
      })}, TBL, {columnStyles:{2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'}}}));

    yy = titre('Activite terrain ' + y + ' (montants pour information, hors CA)', after());
    var sD = sum(D.T.devisN.map(function(v){ return v.montantDevis; })), sC = sum(D.T.cdesN.map(function(v){ return v.montantCommande; }));
    doc.autoTable(Object.assign({startY: yy,
      head:[['Visites', 'Devis', 'Commandes', 'Relances ouvertes']],
      body:[[String(D.T.visitesN), D.T.devisN.length + ' - ' + e2(sD), D.T.cdesN.length + ' - ' + e2(sC), String(D.T.relances.length)]]}, TBL));
    if(D.vs.length){
      doc.autoTable(Object.assign({startY: after() - 4,
        head:[['Date', 'Par', 'Type', 'Resultat', 'Compte rendu']],
        body: D.vs.slice(0, 10).map(function(v){ return [fdate(v.date), clean(whoName(v.commercial)), clean(v.type || '-'), clean(v.resultat || '-'), clean(v.compteRendu || '-')]; }),
        columnStyles:{4:{cellWidth:80}}}, TBL));
    }
    if(K.partielle || K.estime){ doc.setFontSize(7.5); doc.setTextColor(110,120,140);
      var nt = []; if(K.partielle) nt.push('* marge calculee sur la partie du CA dont le taux est connu'); if(K.estime) nt.push('une partie de la marge utilise le taux de repli');
      doc.text(clean(nt.join(' ; ') + '.'), 14, Math.min(285, doc.lastAutoTable.finalY + 6)); }

    var n = doc.getNumberOfPages();
    for(var i = 1; i <= n; i++){ doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(140,150,170);
      doc.text('GIVEDIS OS - fiche client - page ' + i + ' / ' + n, 196, 290, {align:'right'}); }
    doc.save('givedis-fiche-' + normKey(D.own.nom).replace(/ /g, '-').slice(0, 40) + '-' + y + '.pdf');
    toast('Fiche PDF générée', 'ok');
  };

  /* Accès pour les tests. */
  window.__ficheCalcul = function(id, y){ var c = clientById(id); return c ? calcul(c, String(y || YEAR)) : null; };
})();
