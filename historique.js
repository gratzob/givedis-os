/* =====================================================================
   GIVEDIS OS — Historique compta (fichier global, tous les clients)
   ---------------------------------------------------------------------
   Données › Historique compta : import du fichier de la compta qui donne,
   pour une année, les ventes de TOUS les clients GIVEDIS (feuille de
   détail : date, code client, nom, total HT, achat).

   Rangement : DB.historique[AAAA] = {fichier, importeLe, ca, achat, …,
   clients: {nomKey: {nom, codes, ca:{MM}, mca:{MM}, ach:{MM}}}}
   (ca = CA HT ; mca = part du CA dont l'achat est connu ; ach = achats).

   Le fichier global fait foi pour l'année : il COMPLÈTE le détail déjà
   importé (fiches du magasin…) sans jamais compter deux fois. Pour chaque
   client, la part du fichier global qui n'est pas déjà sur une fiche est
   portée par une fiche « virtuelle » (jamais enregistrée dans DB.clients),
   utilisée uniquement par la fiche client et la comparaison N / N-1.
   Les petits clients détaillés par le magasin mais regroupés par la compta
   sous « Ventes comptant comptoir » sont déduits de cette ligne.

   Rien ne change pour les chiffres officiels, objectifs, primes et
   tableaux de bord : ils ne lisent pas DB.historique.
   ===================================================================== */
(function(){
  'use strict';
  var RO = !!window.GOS_RO;
  var HIST_COM = '__hist';
  var MM = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  var r2 = function(n){ return Math.round(n * 100) / 100; };
  var somme = function(a){ return a.reduce(function(s, x){ return s + (+x || 0); }, 0); };

  /* ---------------- Lecture des données rangées ---------------- */
  function annees(){
    var h = (typeof DB !== 'undefined' && DB && DB.historique) || {};
    return Object.keys(h).filter(function(y){ return /^\d{4}$/.test(y) && h[y] && h[y].clients; }).sort();
  }
  function annee(y){
    var h = (DB && DB.historique) || {};
    var x = h[String(y)];
    return x && x.clients ? x : null;
  }

  /* ---------------- Fiches virtuelles (reste non détaillé) ----------------
     Recalculées à chaque rendu (render vide le cache). */
  var CACHE = null;
  function reelles(k){
    return (typeof fichesDuNom === 'function' ? fichesDuNom(k) : DB.clients.filter(function(c){ return c.nomKey === k; }))
      .filter(function(c){ return !c.__hist; });
  }
  function achatFiche(f, m, ca, tauxRepli){
    var t = (f.margeByMonth || {})[m];
    if(t == null || t === '') t = f.margeDefaut;
    if(t == null || t === '') t = tauxRepli;
    return ca * (1 - (+t || 0) / 100);
  }
  function construire(){
    var parNom = {};                     /* nomKey → fiche virtuelle */
    annees().forEach(function(y){
      var H = annee(y);
      var cles = Object.keys(H.clients);
      var dansFichier = {}; cles.forEach(function(k){ dansFichier[k] = 1; });

      /* Clients détaillés par ailleurs (magasin) mais absents du fichier global :
         la compta les range sous « Ventes comptant comptoir ». */
      var comptoir = cles.filter(function(k){ return /comptant/.test(k) && /comptoir/.test(k); })
        .sort(function(a, b){ return somme(MM.map(function(x){ return H.clients[b].ca[x]; })) - somme(MM.map(function(x){ return H.clients[a].ca[x]; })); })[0] || null;
      var horsFichier = {};              /* MM → {ca, ach} */
      if(comptoir){
        DB.clients.forEach(function(c){
          if(c.__hist || dansFichier[c.nomKey]) return;
          MM.forEach(function(x){
            var m = y + '-' + x, v = (c.caByMonth || {})[m];
            if(v == null || v === '' || !+v) return;
            var o = horsFichier[x] || (horsFichier[x] = {ca:0, ach:0});
            o.ca += +v; o.ach += achatFiche(c, m, +v, null);
          });
        });
      }

      cles.forEach(function(k){
        var hc = H.clients[k];
        var v = parNom[k] || (parNom[k] = {
          id: 'hist-' + k.replace(/ /g, '_'), nom: hc.nom, nomKey: k, commercial: HIST_COM,
          __hist: true, enCompta: true, source: 'historique', codes: [],
          caByMonth: {}, margeByMonth: {}, contact: {}, reseau: '', dept: '', dateOuverture: ''
        });
        (hc.codes || []).forEach(function(cd){ if(v.codes.indexOf(cd) < 0) v.codes.push(cd); });
        var fs = reelles(k);
        MM.forEach(function(x){
          var m = y + '-' + x;
          var hca = +(hc.ca[x] || 0), hmca = +((hc.mca || {})[x] || 0), hach = +((hc.ach || {})[x] || 0);
          var tauxH = hmca ? (hmca - hach) / hmca * 100 : null;   /* taux du client ce mois-là */
          var achH = hach + (hca - hmca) * (1 - (tauxH === null ? 0 : tauxH) / 100);
          var realCA = 0, realAch = 0;
          fs.forEach(function(f){
            var ca = typeof caClientMois === 'function' ? caClientMois(f, m) : +((f.caByMonth || {})[m] || 0);
            if(!ca) return;
            realCA += ca; realAch += achatFiche(f, m, ca, tauxH === null ? 0 : tauxH);
          });
          if(k === comptoir && horsFichier[x]){ realCA += horsFichier[x].ca; realAch += horsFichier[x].ach; }
          var reste = hca - realCA;
          if(Math.abs(reste) < 0.5) return;
          var resteAch = achH - realAch;
          var t = (reste - resteAch) / reste * 100;
          if(!isFinite(t) || Math.abs(t) > 100) t = tauxH === null ? null : tauxH;
          v.caByMonth[m] = r2(reste);
          if(t !== null) v.margeByMonth[m] = r2(t);
        });
      });
    });
    var liste = Object.keys(parNom).map(function(k){ return parNom[k]; })
      .filter(function(v){ return Object.keys(v.caByMonth).length; });
    var idx = {}; liste.forEach(function(v){ idx[v.nomKey] = v; });
    return {liste: liste, idx: idx};
  }
  function cache(){
    if(!CACHE) CACHE = annees().length ? construire() : {liste: [], idx: {}};
    return CACHE;
  }
  var renderOrig = window.render;
  if(typeof renderOrig === 'function'){
    window.render = function(){ CACHE = null; return renderOrig.apply(this, arguments); };
  }

  /* Libellé de la fiche virtuelle partout où un nom de commercial s'affiche. */
  var whoOrig = window.whoName;
  if(typeof whoOrig === 'function'){
    window.whoName = function(id){ return id === HIST_COM ? 'Autres ventes (compta globale)' : whoOrig.apply(this, arguments); };
  }

  /* ---------------- Clients regroupés (même nom) ----------------
     Un client GIVEDIS = toutes ses fiches (magasin, itinérants) + la part du
     fichier global. Sur un exercice y, le client appartient à :
       1. le magasin, s'il a une fiche magasin avec du chiffre sur y (règle magasin) ;
       2. sinon la fiche qui fait le plus de chiffre sur y ;
       3. sinon la fiche la plus récemment active.
     Utilisé seulement quand un historique est importé. */
  var GRP = {};
  function caAn(f, y){ return somme(MM.map(function(x){ return caClientMois(f, y + '-' + x); })); }
  function dernierMois(f){
    var d = ''; Object.keys(f.caByMonth || {}).forEach(function(m){ if(+f.caByMonth[m] > 0 && m > d) d = m; }); return d;
  }
  function estMagF(f, y){ return typeof equipeDe === 'function' && equipeDe(comObj(commercialDe(f, y))) === 'magasin'; }
  function groupes(y){
    y = String(y);
    if(GRP[y]) return GRP[y];
    var parNom = {};
    DB.clients.forEach(function(c){ (parNom[c.nomKey] = parNom[c.nomKey] || {fiches:[], virt:null}).fiches.push(c); });
    cache().liste.forEach(function(v){ (parNom[v.nomKey] = parNom[v.nomKey] || {fiches:[], virt:null}).virt = v; });
    Object.keys(parNom).forEach(function(k){
      var g = parNom[k], fs = g.fiches;
      if(!fs.length){ g.owner = null; return; }
      if(fs.length === 1){ g.owner = fs[0]; return; }
      var n = fs.map(function(f){ return {f: f, ca: caAn(f, y), mag: estMagF(f, y), der: dernierMois(f)}; });
      var mag = n.filter(function(x){ return x.mag && x.ca > 0; });
      var act = n.filter(function(x){ return x.ca > 0; });
      var pick = (mag.length ? mag : act.length ? act : n).slice().sort(function(a, b){
        return (b.ca - a.ca) || (b.der > a.der ? 1 : b.der < a.der ? -1 : 0); })[0];
      g.owner = pick.f;
    });
    return (GRP[y] = parNom);
  }
  function groupeDe(c, y){ return groupes(y)[c.nomKey] || {fiches:[c], virt:null, owner:c}; }
  function toutes(g){ return g.virt ? g.fiches.concat([g.virt]) : g.fiches; }
  function tauxF(f, m){
    var t = (f.margeByMonth || {})[m];
    if(t != null && t !== '') return {t: +t, repli: false};
    if(f.margeDefaut != null && f.margeDefaut !== '') return {t: +f.margeDefaut, repli: false};
    if(f.__hist) return null;
    try{ var y = m.slice(0, 4); return {t: +tauxClient(f, m, commercialDe(f, y), y) || 0, repli: true}; }catch(e){ return null; }
  }

  /* Périmètre constant : CA N-1 des clients du portefeuille de l'exercice yN. */
  var PERIM = {};
  function perimetre(yN){
    yN = String(yN);
    if(PERIM[yN]) return PERIM[yN];
    var yP = String(+yN - 1), out = {}, G = groupes(yN);
    Object.keys(G).forEach(function(k){
      var g = G[k]; if(!g.owner) return;
      var com = commercialDe(g.owner, yN) || g.owner.commercial;
      var o = out[com] || (out[com] = {});
      toutes(g).forEach(function(f){
        MM.forEach(function(x){
          var m = yP + '-' + x, ca = caClientMois(f, m); if(!ca) return;
          var r = o[m] || (o[m] = {ca:0, marge:0});
          var t = tauxF(f, m);
          r.ca += ca; r.marge += t ? ca * t.t / 100 : 0;
        });
      });
    });
    return (PERIM[yN] = out);
  }

  /* Base égale (règle magasin) : quand un commercial prend une commande en yN chez un client
     qui appartient à quelqu'un d'autre (ex. client du magasin), ce CA compte pour lui en yN.
     Pour comparer à base égale, le même montant est retiré du N-1 du propriétaire et ajouté
     au N-1 du commercial, mois par mois (mois yN au chiffre officiel uniquement). */
  var AJUST = {};
  function ajustement(yN){
    yN = String(yN);
    if(AJUST[yN]) return AJUST[yN];
    var yP = String(+yN - 1), out = {}, G = groupes(yN), off = {};
    var estOff = function(com, m){ var k = com + '|' + m; if(!(k in off)){ try{ off[k] = stats(com, m).source === 'officiel'; }catch(e){ off[k] = false; } } return off[k]; };
    var add = function(com, m, ca, mg){ var o = out[com] || (out[com] = {}); var r = o[m] || (o[m] = {ca:0, marge:0}); r.ca += ca; r.marge += mg; };
    Object.keys(G).forEach(function(k){
      var g = G[k]; if(!g.owner || g.fiches.length < 2) return;
      var own = commercialDe(g.owner, yN) || g.owner.commercial;
      g.fiches.forEach(function(f){
        var fc = commercialDe(f, yN) || f.commercial; if(!fc || fc === own) return;
        MM.forEach(function(x){
          var m = yN + '-' + x, v = +((f.caByMonth || {})[m]) || 0; if(!v) return;
          if(!estOff(fc, m) || !estOff(own, m)) return;
          var t = tauxF(f, m), mg = t ? v * t.t / 100 : 0;
          add(own, yP + '-' + x, -v, -mg); add(fc, yP + '-' + x, v, mg);
        });
      });
    });
    return (AJUST[yN] = out);
  }

  var renderOrig2 = window.render;
  window.render = function(){ GRP = {}; PERIM = {}; AJUST = {}; return renderOrig2.apply(this, arguments); };

  window.HIST = {
    COM: HIST_COM,
    annees: annees,
    annee: annee,
    a: function(y){ return !!annee(y); },
    actif: function(){ return annees().length > 0; },
    virtuelles: function(){ return cache().liste; },
    virtuelle: function(k){ return cache().idx[k] || null; },
    vider: function(){ CACHE = null; GRP = {}; PERIM = {}; AJUST = {}; },
    /* Fiche qui porte le client sur l'exercice y (les autres fiches du même nom y sont additionnées). */
    proprio: function(c, y){ return groupeDe(c, y).owner; },
    estProprio: function(c, y){ return groupeDe(c, y).owner === c; },
    fichesGroupe: function(c, y){ return groupeDe(c, y).fiches; },
    /* CA du client entier sur un mois, porté par sa fiche propriétaire (0 pour les autres fiches). */
    caGroupe: function(c, m, y){
      var g = groupeDe(c, y); if(g.owner !== c) return 0;
      return somme(toutes(g).map(function(f){ return caClientMois(f, m); }));
    },
    caGroupeAn: function(c, y, yRef){
      var g = groupeDe(c, yRef || y);
      return somme(toutes(g).map(function(f){ return caAn(f, y); }));
    },
    moisGroupe: function(c, y){
      var g = groupeDe(c, y), s = {};
      toutes(g).forEach(function(f){ Object.keys(f.caByMonth || {}).forEach(function(m){ s[m] = (s[m] || 0) + (+f.caByMonth[m] || 0); }); });
      return s;
    },
    /* Taux de marge du client entier sur un mois : moyenne pondérée des taux connus ; null si tous sont des taux de repli. */
    tauxGroupe: function(c, m, y){
      var g = groupeDe(c, y), ca = 0, mg = 0;
      toutes(g).forEach(function(f){ var v = caClientMois(f, m); if(!v) return; var t = tauxF(f, m); if(t && !t.repli){ ca += v; mg += v * t.t / 100; } });
      return ca ? {t: mg / ca * 100, repli: false} : null;
    },
    /* {ca, marge} N-1 (mois mP) des clients que com a en portefeuille sur yN. */
    n1Com: function(com, mP, yN){
      var r = (perimetre(yN)[com] || {})[mP] || {ca:0, marge:0}, a = (ajustement(yN)[com] || {})[mP] || {ca:0, marge:0};
      return {ca: r.ca + a.ca, marge: r.marge + a.marge};
    },
    /* Part de l'ajustement « base égale » dans le N-1 de com (mois mP). */
    ajustN1: function(com, mP, yN){ var a = (ajustement(yN)[com] || {})[mP]; return a ? {ca: a.ca, marge: a.marge} : {ca:0, marge:0}; }
  };

  /* ---------------- Lecture du fichier ---------------- */
  function nb(v){
    if(typeof v === 'number') return v;
    var x = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
    return isNaN(x) ? 0 : x;
  }
  function vide(v){ return v == null || String(v).trim() === ''; }
  function dateMois(v){
    if(v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0');
    if(typeof v === 'number' && v > 20000 && v < 60000){
      var d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      if(!isNaN(d)) return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    }
    var s = String(v == null ? '' : v).trim(), m = s.match(/^(\d{4})[-\/](\d{1,2})/);
    if(m) return m[1] + '-' + String(m[2]).padStart(2, '0');
    m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
    if(m){ var an = m[3].length === 2 ? '20' + m[3] : m[3]; return an + '-' + String(m[2]).padStart(2, '0'); }
    return null;
  }
  function lireFichier(wb){
    var t = null;
    wb.SheetNames.some(function(nom){
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[nom], {header:1, blankrows:false});
      for(var r = 0; r < Math.min(rows.length, 10); r++){
        var e = Array.from(rows[r] || [], function(x){ return normKey(x); });
        var iD = e.findIndex(function(h){ return h && h.indexOf('date') >= 0; });
        var iK = e.findIndex(function(h){ return h && h.indexOf('code') >= 0; });
        var iN = e.findIndex(function(h){ return h && (h === 'nom' || h.indexOf('raison sociale') >= 0 || (h.indexOf('client') >= 0 && h.indexOf('code') < 0)); });
        var iC = e.findIndex(function(h){ return h && h.indexOf('total ht') >= 0; });
        var iA = e.findIndex(function(h){ return h && h.indexOf('achat') >= 0; });
        if(iD >= 0 && iN >= 0 && iC >= 0){ t = {rows: rows, debut: r + 1, iD: iD, iK: iK, iN: iN, iC: iC, iA: iA, feuille: nom}; return true; }
      }
      return false;
    });
    if(!t) throw new Error('Feuille de détail introuvable : il faut des colonnes Date, Nom (client), Total HT et, si possible, Code client et Achat.');
    var lignes = [], ignorees = 0;
    t.rows.slice(t.debut).forEach(function(r){
      var nom = String(r[t.iN] == null ? '' : r[t.iN]).trim(), mk = dateMois(r[t.iD]);
      if(!nom || !mk){ if(nom || !vide(r[t.iD])) ignorees++; return; }
      var ca = nb(r[t.iC]), achV = t.iA >= 0 ? r[t.iA] : null;
      lignes.push({mk: mk, nom: nom, code: t.iK >= 0 ? String(r[t.iK] == null ? '' : r[t.iK]).trim() : '',
        ca: ca, ach: vide(achV) ? null : nb(achV)});
    });
    if(!lignes.length) throw new Error('Aucune ligne de vente lisible dans « ' + t.feuille + ' ».');
    var ans = {};
    lignes.forEach(function(l){ var y = l.mk.slice(0, 4); ans[y] = (ans[y] || 0) + 1; });
    var ys = Object.keys(ans).sort();
    var maj = ys.slice().sort(function(a, b){ return ans[b] - ans[a]; })[0];
    return {lignes: lignes, ignorees: ignorees, feuille: t.feuille, annees: ys, parAnnee: ans, annee: maj,
      avecCode: t.iK >= 0, avecAchat: t.iA >= 0};
  }

  /* Synthèse d'une année du fichier : ce qui sera enregistré + contrôles. */
  function synthese(lu, y){
    var L = lu.lignes.filter(function(l){ return l.mk.slice(0, 4) === y; });
    var cl = {}, codes = {}, mois = {}, tot = {ca:0, mca:0, ach:0}, avoirs = {n:0, ca:0}, sansAchat = {n:0, ca:0};
    L.forEach(function(l){
      var k = normKey(l.nom), x = l.mk.slice(5, 7);
      var c = cl[k] || (cl[k] = {noms:{}, codes:{}, ca:{}, mca:{}, ach:{}, lignes:0});
      c.noms[l.nom] = (c.noms[l.nom] || 0) + Math.abs(l.ca);
      if(l.code) c.codes[l.code] = 1;
      c.ca[x] = (c.ca[x] || 0) + l.ca; c.lignes++;
      var mo = mois[x] || (mois[x] = {ca:0, mca:0, ach:0});
      mo.ca += l.ca; tot.ca += l.ca;
      if(l.ach !== null && (l.ach || !l.ca)){
        c.mca[x] = (c.mca[x] || 0) + l.ca; c.ach[x] = (c.ach[x] || 0) + l.ach;
        mo.mca += l.ca; mo.ach += l.ach; tot.mca += l.ca; tot.ach += l.ach;
      } else if(l.ca){ sansAchat.n++; sansAchat.ca += l.ca; }
      if(l.ca < 0){ avoirs.n++; avoirs.ca += l.ca; }
      if(l.code){ var o = codes[l.code] || (codes[l.code] = {}); o[normKey(l.nom)] = l.nom; }
    });
    var clients = {};
    Object.keys(cl).forEach(function(k){
      var c = cl[k];
      if(!Object.keys(c.ca).some(function(x){ return Math.abs(c.ca[x]) >= 0.005; })) return;   /* client à 0 € sur l'année */
      var nom = Object.keys(c.noms).sort(function(a, b){ return c.noms[b] - c.noms[a]; })[0];
      var rond = function(o){ var s = {}; Object.keys(o).forEach(function(x){ if(Math.abs(o[x]) >= 0.005) s[x] = r2(o[x]); }); return s; };
      clients[k] = {nom: nom, codes: Object.keys(c.codes).sort(), ca: rond(c.ca), mca: rond(c.mca), ach: rond(c.ach), lignes: c.lignes};
    });
    var multiNoms = Object.keys(codes).filter(function(cd){ return Object.keys(codes[cd]).length > 1; })
      .map(function(cd){ return [cd, Object.keys(codes[cd]).map(function(k){ return codes[cd][k]; })]; });
    /* Rapprochement avec les fiches existantes (même nom) */
    var rap = {ok:0, okCA:0, absents:[], absCA:0, magasin:0, itin:0, mixte:0};
    Object.keys(clients).forEach(function(k){
      var fs = DB.clients.filter(function(c){ return c.nomKey === k; });
      var t = somme(MM.map(function(x){ return clients[k].ca[x]; }));
      if(!fs.length){ rap.absents.push([clients[k].nom, t]); rap.absCA += t; return; }
      rap.ok++; rap.okCA += t;
      var mag = fs.some(function(f){ return equipeDe(comObj(f.commercial)) === 'magasin'; });
      var iti = fs.some(function(f){ return equipeDe(comObj(f.commercial)) !== 'magasin'; });
      if(mag && iti) rap.mixte++; else if(mag) rap.magasin++; else rap.itin++;
    });
    rap.absents.sort(function(a, b){ return b[1] - a[1]; });
    return {annee: y, lignes: L.length, clients: clients, nbClients: Object.keys(clients).length,
      nbCodes: Object.keys(codes).length, mois: mois, tot: tot, avoirs: avoirs, sansAchat: sansAchat,
      multiNoms: multiNoms, rap: rap,
      autres: lu.annees.filter(function(a){ return a !== y; }).map(function(a){ return [a, lu.parAnnee[a]]; })};
  }

  /* ---------------- Écran Données › Historique compta ---------------- */
  var HI = {lu: null, fichier: '', annee: '', err: ''};
  window.HI = HI;

  window.histCharger = function(input){
    var f = input.files && input.files[0];
    if(!f) return;
    var r = new FileReader();
    r.onload = function(e){
      try{
        var wb = XLSX.read(new Uint8Array(e.target.result), {type:'array', cellDates:true});
        HI.lu = lireFichier(wb); HI.fichier = f.name; HI.annee = HI.lu.annee; HI.err = '';
      }catch(err){ HI.lu = null; HI.fichier = f.name; HI.err = err.message; }
      input.value = '';
      render();
    };
    r.onerror = function(){ HI.err = 'Lecture du fichier impossible'; render(); };
    r.readAsArrayBuffer(f);
  };
  window.histAnnee = function(y){ HI.annee = String(y); render(); };
  window.histAnnuler = function(){ HI.lu = null; HI.fichier = ''; HI.err = ''; render(); };

  function construireEnregistrement(S){
    var mois = {};
    Object.keys(S.mois).forEach(function(x){ mois[x] = {ca: r2(S.mois[x].ca), mca: r2(S.mois[x].mca), ach: r2(S.mois[x].ach)}; });
    return {
      fichier: HI.fichier, importeLe: new Date().toISOString(),
      ca: r2(S.tot.ca), mca: r2(S.tot.mca), achat: r2(S.tot.ach), lignes: S.lignes, nbClients: S.nbClients,
      mois: mois, clients: S.clients,
      alertes: {multiNoms: S.multiNoms, avoirs: {n: S.avoirs.n, ca: r2(S.avoirs.ca)}, sansAchat: {n: S.sansAchat.n, ca: r2(S.sansAchat.ca)}}
    };
  }
  window.histValider = function(){
    if(RO || !HI.lu) return;
    var y = HI.annee;
    if(!/^\d{4}$/.test(y)){ toast('Choisissez l\'année à importer.', 'bad'); return; }
    var S = synthese(HI.lu, y);
    if(!S.nbClients){ toast('Aucun client sur ' + y + ' dans ce fichier.', 'bad'); return; }
    DB.historique = DB.historique || {};
    if(DB.historique[y] && !confirm('Un historique ' + y + ' existe déjà (' + (DB.historique[y].fichier || 'fichier') + '). Le remplacer par ce fichier ?')) return;
    DB.historique[y] = construireEnregistrement(S);
    HIST.vider();
    save();
    toast('Historique ' + y + ' importé : ' + S.nbClients + ' clients, ' + eur(S.tot.ca), 'ok');
    HI.lu = null; HI.fichier = '';
    render();
  };
  window.histSupprimer = function(y){
    if(RO || !DB.historique || !DB.historique[y]) return;
    if(!confirm('Retirer l\'historique ' + y + ' ? Les fiches clients et la comparaison reviendront au détail importé par commercial.')) return;
    delete DB.historique[y];
    HIST.vider();
    save();
    toast('Historique ' + y + ' retiré', 'ok');
    render();
  };
  window.histExport = function(y){
    var H = annee(y); if(!H || typeof XLSX === 'undefined') return;
    var data = Object.keys(H.clients).map(function(k){
      var c = H.clients[k], row = {'Client': c.nom, 'Code(s)': (c.codes || []).join(', ')};
      var fs = DB.clients.filter(function(f){ return f.nomKey === k; });
      row['Fiche(s) GIVEDIS OS'] = fs.length ? fs.map(function(f){ return whoName(f.commercial); }).join(' + ') : 'aucune';
      MM.forEach(function(x, i){ row[moisCourt(i)] = Math.round(c.ca[x] || 0); });
      var ca = somme(MM.map(function(x){ return c.ca[x]; })), mca = somme(MM.map(function(x){ return (c.mca || {})[x]; })), ach = somme(MM.map(function(x){ return (c.ach || {})[x]; }));
      row['CA ' + y] = Math.round(ca); row['Marge'] = mca ? Math.round(mca - ach) : '';
      row['Taux %'] = mca ? Math.round((mca - ach) / mca * 1000) / 10 : '';
      return row;
    }).sort(function(a, b){ return b['CA ' + y] - a['CA ' + y]; });
    var ws = XLSX.utils.json_to_sheet(data), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clients ' + y);
    XLSX.writeFile(wb, 'historique-givedis-' + y + '.xlsx');
  };

  function moisCourt(i){ return ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'][i]; }
  function taux(ca, ach){ return ca ? (ca - ach) / ca * 100 : null; }

  function vuePreview(){
    if(HI.err) return '<div class="card"><div class="card-h"><h3>' + esc(HI.fichier) + '</h3><button class="btn ghost sm" onclick="histAnnuler()">Retirer</button></div>' +
      '<p class="note warn">Fichier illisible : ' + esc(HI.err) + '</p></div>';
    if(!HI.lu) return '';
    var y = HI.annee, S = synthese(HI.lu, y), T = S.tot, tx = taux(T.mca, T.ach);
    var existe = annee(y);
    var ms = MM.filter(function(x){ return S.mois[x]; });
    return '<div class="card">' +
      '<div class="card-h" style="flex-wrap:wrap;gap:10px"><div><h3 style="margin:0">' + esc(HI.fichier) + '</h3>' +
        '<p class="hint" style="margin:4px 0 0">Feuille « ' + esc(HI.lu.feuille) + ' » · ' + num(HI.lu.lignes.length) + ' lignes lues' + (HI.lu.ignorees ? ' · ' + HI.lu.ignorees + ' ignorée(s)' : '') + '</p></div>' +
        '<div class="btnrow" style="gap:8px;align-items:center">' +
          '<label class="hint">Année</label><select style="width:auto" onchange="histAnnee(this.value)">' +
            HI.lu.annees.map(function(a){ return '<option value="' + a + '"' + (a === y ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select>' +
          '<button class="btn" onclick="histValider()">' + (existe ? 'Remplacer l\'historique ' : 'Importer l\'historique ') + esc(y) + '</button>' +
          '<button class="btn ghost sm" onclick="histAnnuler()">Annuler</button></div></div>' +
      (existe ? '<p class="note warn">Un historique ' + esc(y) + ' est déjà enregistré (' + esc(existe.fichier || '') + ', ' + eur(existe.ca) + ') : il sera remplacé.</p>' : '') +
      (S.autres.length ? '<p class="note">Le fichier contient aussi ' + S.autres.map(function(a){ return a[1] + ' ligne(s) de ' + a[0]; }).join(', ') + ' : seules les lignes de ' + esc(y) + ' sont importées.</p>' : '') +
      '<div class="grid g-auto" style="margin:12px 0;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' +
        '<div class="kpi info"><div class="lab">CA HT ' + esc(y) + '</div><div class="val">' + eur(T.ca) + '</div><div class="sub">' + num(S.lignes) + ' lignes de vente</div></div>' +
        '<div class="kpi"><div class="lab">Achats</div><div class="val">' + eur(T.ach) + '</div><div class="sub">' + (HI.lu.avecAchat ? 'colonne achat lue' : 'pas de colonne achat') + '</div></div>' +
        '<div class="kpi ok"><div class="lab">Marge</div><div class="val">' + (T.mca ? eur(T.mca - T.ach) : '—') + '</div><div class="sub">' + (tx === null ? 'taux inconnu' : 'taux ' + pct(tx)) + (S.sansAchat.n ? ' · hors lignes sans achat' : '') + '</div></div>' +
        '<div class="kpi"><div class="lab">Clients</div><div class="val">' + S.nbClients + '</div><div class="sub">' + (HI.lu.avecCode ? S.nbCodes + ' codes compta' : 'sans code client') + '</div></div>' +
        '<div class="kpi ' + (S.rap.absents.length ? 'warn' : 'ok') + '"><div class="lab">Rattachés à une fiche</div><div class="val">' + S.rap.ok + ' / ' + S.nbClients + '</div><div class="sub">' + eur(S.rap.okCA) + ' (' + pct(T.ca ? S.rap.okCA / T.ca * 100 : 0) + ' du CA)</div></div>' +
      '</div>' +
      '<div class="tw" style="margin-bottom:12px"><table><thead><tr><th>Mois</th>' + ms.map(function(x){ return '<th class="num">' + moisCourt(+x - 1) + '</th>'; }).join('') + '<th class="num">Total</th></tr></thead><tbody>' +
        '<tr><td>CA HT</td>' + ms.map(function(x){ return '<td class="num mono">' + eur(S.mois[x].ca) + '</td>'; }).join('') + '<td class="num mono"><strong>' + eur(T.ca) + '</strong></td></tr>' +
        '<tr><td>Taux de marge</td>' + ms.map(function(x){ var t = taux(S.mois[x].mca, S.mois[x].ach); return '<td class="num mono">' + (t === null ? '—' : pct(t)) + '</td>'; }).join('') + '<td class="num mono">' + (tx === null ? '—' : pct(tx)) + '</td></tr>' +
      '</tbody></table></div>' +
      '<div class="grid g2" style="gap:12px">' +
        '<div class="card" style="background:var(--bg2);margin:0"><div class="eyebrow">Rapprochement avec les fiches</div>' +
          '<p class="hint" style="margin:6px 0">Rattachement par nom de client, comme le reste de l\'appli. ' + S.rap.magasin + ' clients sur une fiche magasin, ' + S.rap.itin + ' sur une fiche itinérant, ' + S.rap.mixte + ' sur les deux.</p>' +
          (S.rap.absents.length ? '<p class="hint" style="margin:6px 0"><strong>' + S.rap.absents.length + ' client(s) sans fiche</strong> (' + eur(S.rap.absCA) + ') : ils comptent dans les totaux et apparaissent dans la comparaison, sans fiche créée. ' +
            esc(S.rap.absents.slice(0, 8).map(function(a){ return a[0] + ' ' + eur(a[1]); }).join(' · ')) + (S.rap.absents.length > 8 ? '…' : '') + '</p>' : '') +
        '</div>' +
        '<div class="card" style="background:var(--bg2);margin:0"><div class="eyebrow">Points de contrôle</div>' +
          '<p class="hint" style="margin:6px 0">' +
            (S.avoirs.n ? S.avoirs.n + ' ligne(s) négative(s) (avoirs, ' + eur(S.avoirs.ca) + ') : déduites du CA du client.<br>' : '') +
            (S.sansAchat.n ? S.sansAchat.n + ' ligne(s) sans coût d\'achat (' + eur(S.sansAchat.ca) + ') : exclues du calcul du taux de marge.<br>' : '') +
            (S.multiNoms.length ? S.multiNoms.length + ' code(s) avec plusieurs noms : ' + esc(S.multiNoms.map(function(m){ return m[0] + ' (' + m[1].join(' / ') + ')'; }).join(' · ')) + '. Chaque nom reste rattaché à sa propre fiche.' : 'Aucun code client avec plusieurs noms.') +
          '</p></div>' +
      '</div></div>';
  }

  function vueListe(){
    var ys = annees().slice().reverse();
    if(!ys.length) return '<div class="card"><p class="hint" style="margin:0">Aucun historique importé pour l\'instant.</p></div>';
    return '<div class="card"><div class="card-h"><h3>Historiques enregistrés</h3></div><div class="tw"><table>' +
      '<thead><tr><th>Année</th><th>Fichier</th><th>Importé le</th><th class="num">CA HT</th><th class="num">Marge</th><th class="num">Clients</th><th></th></tr></thead><tbody>' +
      ys.map(function(y){
        var H = annee(y), t = taux(H.mca, H.achat);
        return '<tr><td><strong>' + y + '</strong></td><td>' + esc(H.fichier || '—') + '</td><td>' + (H.importeLe ? fdate(H.importeLe.slice(0, 10)) : '—') + '</td>' +
          '<td class="num mono">' + eur(H.ca) + '</td><td class="num mono">' + (H.mca ? eur(H.mca - H.achat) + ' · ' + pct(t) : '—') + '</td><td class="num">' + (H.nbClients || Object.keys(H.clients).length) + '</td>' +
          '<td style="white-space:nowrap"><button class="btn ghost sm" onclick="histExport(\'' + y + '\')">⬇ Excel</button> ' +
          (RO ? '' : '<button class="btn ghost sm" onclick="histSupprimer(\'' + y + '\')">Retirer</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  VIEWS['data:historique'] = function(){
    return '<div class="card" style="background:linear-gradient(135deg,var(--panel),var(--panel2))">' +
      '<div class="eyebrow">Historique complet</div>' +
      '<h2 style="font-size:23px;margin-bottom:6px">Historique compta — tous les clients GIVEDIS</h2>' +
      '<p class="hint">Le fichier de la compta qui donne, pour une année, les ventes de tous les clients (feuille de détail : date, code client, nom, total HT, achat). ' +
      'Il alimente les <strong>fiches clients</strong> (CA et marge mois par mois) et la <strong>comparaison N / N-1</strong> de l\'onglet Analyse. ' +
      'Pour l\'année importée, le fichier global fait foi : il complète le détail déjà importé (magasin) sans rien compter deux fois. ' +
      'Les chiffres officiels, objectifs, primes et tableaux de bord ne changent pas.</p></div>' +
      (RO ? '' : '<div class="card"><div class="card-h"><h3>Déposer le fichier</h3></div>' +
        '<input type="file" id="fHist" accept=".xlsx,.xls" onchange="histCharger(this)">' +
        '<p class="hint" style="margin-top:10px">Rien n\'est enregistré tant que vous n\'avez pas cliqué sur « Importer ». Réimporter la même année remplace l\'historique précédent.</p></div>') +
      vuePreview() + vueListe();
  };

  if(!RO && typeof NAV !== 'undefined' && NAV.data && !NAV.data.tabs.some(function(t){ return t.id === 'historique'; })){
    var i = NAV.data.tabs.findIndex(function(t){ return t.id === 'compta'; });
    NAV.data.tabs.splice(i + 1, 0, {id:'historique', label:'Historique compta'});
  }

  window.__HIST_TEST = {lireFichier: lireFichier, synthese: synthese, construire: construire};

  /* Retour sur l'onglet après un rechargement ; sinon on remet l'affichage à jour
     (fiches et comparaison tiennent compte de l'historique). */
  try{
    if(SPACE === 'data' && localStorage.getItem('gos_tab') === 'historique' && NAV.data.tabs.some(function(t){ return t.id === 'historique'; })){ TAB = 'historique'; render(); }
    else if(annees().length && SPACE === 'pilotage' && TAB === 'analyse') render();
    else renderShell();
  }catch(e){}
})();
