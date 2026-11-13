/* =========================================================================
   GIVEDIS OS — Portefeuilles par exercice + objectifs au %
   -------------------------------------------------------------------------
   À charger après reunion.js : <script src="portefeuilles.js"></script>

   • Données › Portefeuilles : chaque début d'année, nouveau portefeuille par
     commercial (tableau du patron importé, ou répartition à la main).
     Trame Excel à télécharger, aperçu gains / pertes, validation, envoi aux
     commerciaux (appli de saisie). Portefeuille « Agence » = équipe Magasin.
     Données : DB.portefeuilles[AAAA] = {statut, affect:{clientId: commercialId}}

   • Pilotage › Objectifs : base = CA de l'année d'avant des clients du nouveau
     portefeuille (« à portefeuille égal »), un % de progression par commercial,
     objectifs annuels et mensuels calculés tout seuls (saisonnalité N-1).
     Données : DB.objectifs.reglage[AAAA][commercialId]
   ========================================================================= */
(function(){
  'use strict';
  if(typeof NAV === 'undefined' || typeof VIEWS === 'undefined'){ console.warn('portefeuilles.js : GIVEDIS OS introuvable'); return; }
  var RO = !!window.GOS_RO;

  /* ---------- Outils ---------- */
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  function sum(a){ return a.reduce(function(s, x){ return s + (+x || 0); }, 0); }
  function anneeCourante(){ return +todayISO().slice(0, 4); }
  function cibles(){ return DB.commerciaux.filter(function(c){ return c.actif !== false; }); }
  function arrondi(n){ return Math.round(n); }
  function garderScroll(fn){ var y = window.scrollY; fn(); requestAnimationFrame(function(){ window.scrollTo(0, y); }); }
  function margeClient(c, m, com, y){ var ca = caClientMois(c, m); return ca ? ca * (tauxClient(c, m, com, y) || 0) / 100 : 0; }

  /* Portefeuille « Agence » : un membre de l'équipe Magasin (suivi seul). */
  function agence(creer){
    var a = DB.commerciaux.find(function(c){ return c.id === 'agence'; });
    if(!a && creer){ a = {id:'agence', nom:'Agence', actif:true, equipe:'magasin'}; DB.commerciaux.push(a); }
    return a || null;
  }

  /* ====================== Application au 1er janvier ====================== */
  /* Le portefeuille validé de l'année en cours devient le portefeuille « courant ». */
  function appliquer(){
    if(RO) return false;
    var p = pfAnnee(anneeCourante());
    if(!pfActif(p) || p.statut !== 'valide' || p.applique) return false;
    DB.clients.forEach(function(c){ var v = p.affect[c.id]; if(v) c.commercial = v; });
    p.applique = new Date().toISOString();
    save();
    return true;
  }
  try{ if(appliquer()) setTimeout(function(){ toast('Portefeuilles ' + anneeCourante() + ' appliqués', 'ok'); }, 800); }catch(e){}

  /* ====================== Données › Portefeuilles ====================== */
  if(!RO) NAV.data.tabs.splice(Math.max(0, NAV.data.tabs.findIndex(function(t){ return t.id === 'compta'; }) + 1), 0, {id:'portefeuilles', label:'Portefeuilles'});

  var PF = {
    y: String(lsGet('gos_pf_y') || (new Date().getMonth() >= 9 ? anneeCourante() + 1 : anneeCourante())),
    q: '', com: '', vue: 'tous', imp: null
  };
  window.pfSet = function(k, v){ PF[k] = v; if(k === 'y') lsSet('gos_pf_y', v); garderScroll(render); };

  function brouillon(y, creer){
    DB.portefeuilles = DB.portefeuilles || {};
    var p = DB.portefeuilles[y];
    if(!p && creer){
      p = DB.portefeuilles[y] = {statut:'brouillon', affect:{}, creeLe:new Date().toISOString()};
      DB.clients.forEach(function(c){ p.affect[c.id] = commercialDe(c, +y - 1); });
    }
    if(p){
      p.affect = p.affect || {};
      /* clients créés depuis : rattachés à leur commercial actuel */
      DB.clients.forEach(function(c){ if(!p.affect[c.id]) p.affect[c.id] = commercialDe(c, +y - 1); });
    }
    return p || null;
  }

  /* Synthèse par portefeuille : base N-1 à portefeuille égal, gains et pertes. */
  function synthese(y, p){
    var yP = String(+y - 1), ms = monthsOfYear(yP);
    var par = {};
    cibles().forEach(function(c){ par[c.id] = {c:c, n:0, actifs:0, base:0, avant:0, gagnes:0, perdus:0, caGagne:0, caPerdu:0}; });
    DB.clients.forEach(function(cl){
      var neuf = p.affect[cl.id] || cl.commercial, ancien = commercialDe(cl, yP);
      var ca = sum(ms.map(function(m){ return caClientMois(cl, m); }));
      if(par[neuf]){ par[neuf].n++; if(ca > 0) par[neuf].actifs++; par[neuf].base += ca; }
      if(par[ancien]) par[ancien].avant += ca;
      if(neuf !== ancien){
        if(par[neuf]){ par[neuf].gagnes++; par[neuf].caGagne += ca; }
        if(par[ancien]){ par[ancien].perdus++; par[ancien].caPerdu += ca; }
      }
    });
    return Object.values(par).filter(function(x){ return x.n || x.avant || x.c.actif !== false; });
  }

  function etiquetteStatut(p){
    if(!p) return '<span class="tag mute">pas commencé</span>';
    if(p.statut === 'valide') return '<span class="tag ok">validé' + (p.applique ? ' · appliqué' : '') + '</span>' + (p.envoyeLe ? ' <span class="tag info">envoyé au terrain</span>' : '');
    if(p.statut === 'historique') return '<span class="tag mute">historique (photo de l\'année)</span>';
    return '<span class="tag warn">brouillon</span>';
  }

  VIEWS['data:portefeuilles'] = function(){
    var y = PF.y, yP = String(+y - 1), p = brouillon(y, false);
    var annees = [anneeCourante(), anneeCourante() + 1].map(String);
    Object.keys(DB.portefeuilles || {}).forEach(function(k){ if(annees.indexOf(k) < 0) annees.push(k); });
    annees.sort().reverse();
    var modifiable = p && p.statut === 'brouillon';
    var ag = agence(false);

    var h = '<div class="card" style="background:linear-gradient(135deg,var(--panel),var(--panel2))">' +
      '<div class="card-h" style="flex-wrap:wrap;gap:10px"><div><div class="eyebrow">Données</div><h2 style="font-size:25px;margin:2px 0 6px">Portefeuilles ' + y + '</h2>' + etiquetteStatut(p) + '</div>' +
      '<div class="btnrow"><select style="width:auto" onchange="pfSet(\'y\', this.value)">' +
        annees.map(function(a){ return '<option value="' + a + '" ' + (a === y ? 'selected' : '') + '>Exercice ' + a + '</option>'; }).join('') + '</select></div></div>' +
      '<p class="hint">Chaque début d\'année, le patron répartit les clients entre les commerciaux. Préparez ici le portefeuille ' + y + ' : importez son tableau (ou la trame ci-dessous une fois remplie), ajustez à la main, puis validez. ' +
      'Les chiffres de ' + yP + ' et d\'avant restent rattachés au commercial de l\'époque. Le portefeuille validé s\'applique tout seul au 1er janvier ' + y + '.</p></div>';

    if(!p){
      h += '<div class="card"><div class="empty"><div class="big">◫</div><p>Aucun portefeuille ' + y + ' pour le moment.<br>On part du portefeuille ' + yP + ' : chaque client reste chez son commercial actuel tant que vous ne le déplacez pas.</p>' +
        '<button class="btn" onclick="pfCommencer()">Préparer le portefeuille ' + y + '</button></div></div>';
      return h;
    }

    /* Synthèse */
    var syn = synthese(y, p);
    h += '<div class="card"><div class="card-h"><h3>Synthèse par portefeuille</h3>' +
      (ag ? '' : (modifiable ? '<button class="btn ghost sm" onclick="pfCreerAgence()">+ Créer le portefeuille Agence</button>' : '')) + '</div>' +
      '<div class="tw"><table><thead><tr><th>Portefeuille</th><th class="num">Clients</th><th class="num">dont actifs en ' + yP + '</th><th class="num">CA ' + yP + ' à portefeuille égal</th><th class="num">CA ' + yP + ' réalisé</th><th class="num">Gagnés</th><th class="num">Perdus</th><th>Écart</th></tr></thead><tbody>' +
      syn.map(function(x){
        var d = x.base - x.avant;
        return '<tr><td><strong>' + esc(x.c.nom) + '</strong>' + (equipeDe(x.c) === 'magasin' ? ' <span class="tag mute">magasin</span>' : '') + '</td>' +
          '<td class="num mono">' + x.n + '</td><td class="num mono">' + x.actifs + '</td>' +
          '<td class="num mono" style="font-weight:700">' + eur(x.base) + '</td><td class="num mono" style="color:var(--ink3)">' + eur(x.avant) + '</td>' +
          '<td class="num mono">' + (x.gagnes ? '+' + x.gagnes + '<div class="hint">' + eur(x.caGagne) + '</div>' : '0') + '</td>' +
          '<td class="num mono">' + (x.perdus ? '−' + x.perdus + '<div class="hint">' + eur(x.caPerdu) + '</div>' : '0') + '</td>' +
          '<td><span class="tag ' + (d > 0 ? 'ok' : d < 0 ? 'bad' : 'mute') + '">' + (d > 0 ? '+' : d < 0 ? '−' : '') + eur(Math.abs(d)) + '</span></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="hint" style="margin-top:8px">« À portefeuille égal » : ce que les clients du portefeuille ' + y + ' ont acheté en ' + yP + ', quel que soit le commercial de l\'époque. C\'est la base des objectifs ' + y + ' (Pilotage › Objectifs).</p>' +
      '<div class="btnrow" style="margin-top:14px">' +
        (modifiable ? '<button class="btn" onclick="pfValider()">Valider le portefeuille ' + y + '</button>' : '') +
        (p.statut === 'valide' ? '<button class="btn ghost" onclick="pfRouvrir()">Repasser en brouillon</button>' : '') +
        (p.statut === 'valide' ? '<button class="btn ghost" onclick="pfEnvoyer()">Envoyer aux commerciaux (appli de saisie)</button>' : '') +
        (modifiable ? '<button class="btn ghost sm danger" onclick="pfAbandonner()">Abandonner ce brouillon</button>' : '') +
      '</div></div>';

    /* Trame + import */
    if(modifiable){
      h += '<div class="card"><div class="card-h"><h3>Tableau du patron</h3></div>' +
        '<div class="grid g2" style="align-items:start">' +
          '<div><div class="lab">1. Trame à remplir</div><p class="hint" style="margin:6px 0 10px">Fichier Excel avec tous les clients, leur commercial ' + yP + ', leur CA ' + yP + ' et une colonne « Commercial ' + y + ' » à compléter. Écrire le prénom du commercial, ou « Agence ».</p>' +
            '<button class="btn ghost" onclick="pfTrame()">Télécharger la trame ' + y + '</button></div>' +
          '<div><div class="lab">2. Importer le tableau rempli</div><p class="hint" style="margin:6px 0 10px">La trame remplie ou le tableau du patron (Excel ou CSV) : il faut une colonne client et une colonne commercial. Vous vérifiez avant d\'appliquer.</p>' +
            '<input type="file" accept=".xlsx,.xls,.csv" onchange="pfLire(this.files[0]); this.value=\'\'"></div>' +
        '</div>' + importHtml(y, p) + '</div>';
    }

    /* Répartition client par client */
    h += repartitionHtml(y, yP, p, modifiable);
    return h;
  };

  function repartitionHtml(y, yP, p, modifiable){
    var ms = monthsOfYear(yP);
    var lignes = DB.clients.map(function(c){
      return {c:c, ancien:commercialDe(c, yP), neuf:p.affect[c.id] || c.commercial, ca:sum(ms.map(function(m){ return caClientMois(c, m); }))};
    });
    if(PF.q){ var q = normKey(PF.q); lignes = lignes.filter(function(l){ return l.c.nomKey.indexOf(q) >= 0; }); }
    if(PF.com) lignes = lignes.filter(function(l){ return l.neuf === PF.com || l.ancien === PF.com; });
    if(PF.vue === 'changes') lignes = lignes.filter(function(l){ return l.neuf !== l.ancien; });
    if(PF.vue === 'actifs') lignes = lignes.filter(function(l){ return l.ca > 0; });
    if(PF.vue === 'prospects') lignes = lignes.filter(function(l){ return estProspect(l.c); });
    lignes.sort(function(a, b){ return b.ca - a.ca || a.c.nom.localeCompare(b.c.nom); });
    var opts = cibles();
    return '<div class="card"><div class="card-h"><h3>Répartition client par client · ' + lignes.length + '</h3></div>' +
      '<div class="grid g3" style="margin-bottom:12px">' +
        '<div><label class="f">Recherche</label><input id="pfq" value="' + esc(PF.q) + '" placeholder="Nom du client" oninput="PF_Q(this.value)"></div>' +
        '<div><label class="f">Commercial</label><select onchange="pfSet(\'com\', this.value)"><option value="">Tous</option>' +
          opts.map(function(c){ return '<option value="' + c.id + '" ' + (PF.com === c.id ? 'selected' : '') + '>' + esc(c.nom) + '</option>'; }).join('') + '</select></div>' +
        '<div><label class="f">Afficher</label><select onchange="pfSet(\'vue\', this.value)">' +
          [['tous','Tous les clients'],['changes','Changements seulement'],['actifs','Clients avec chiffre en ' + yP],['prospects','Prospects']].map(function(o){
            return '<option value="' + o[0] + '" ' + (PF.vue === o[0] ? 'selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '</div>' +
      (lignes.length ? '<div class="tw"><table><thead><tr><th>Client</th><th class="num">CA ' + yP + '</th><th>Commercial ' + yP + '</th><th>Commercial ' + y + '</th></tr></thead><tbody>' +
        lignes.slice(0, 300).map(function(l){
          var change = l.neuf !== l.ancien;
          return '<tr' + (change ? ' style="background:rgba(224,138,30,.07)"' : '') + '><td><strong>' + esc(l.c.nom) + '</strong>' + (estProspect(l.c) ? ' <span class="tag warn">prospect</span>' : '') + (l.c.reseau ? '<div class="hint">' + esc(l.c.reseau) + '</div>' : '') + '</td>' +
            '<td class="num mono">' + (l.ca ? eur(l.ca) : '—') + '</td><td>' + esc(whoName(l.ancien)) + '</td>' +
            '<td>' + (modifiable
              ? '<select style="width:auto" onchange="pfAffecter(\'' + l.c.id + '\', this.value)">' +
                  opts.map(function(c){ return '<option value="' + c.id + '" ' + (c.id === l.neuf ? 'selected' : '') + '>' + esc(c.nom) + '</option>'; }).join('') + '</select>'
              : esc(whoName(l.neuf))) +
              (change ? ' <span class="tag warn">change</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        (lignes.length > 300 ? '<p class="hint" style="margin-top:8px">300 premiers clients affichés sur ' + lignes.length + ' : affinez la recherche.</p>' : '')
      : emptyState('◇', 'Aucun client pour ce filtre.')) + '</div>';
  }
  var minuterieQ = null;
  window.PF_Q = function(v){ PF.q = v; clearTimeout(minuterieQ); minuterieQ = setTimeout(function(){ renderKeep('pfq'); }, 250); };

  /* ---------- Actions ---------- */
  window.pfCommencer = function(){ if(RO) return; brouillon(PF.y, true); save(); toast('Portefeuille ' + PF.y + ' en préparation', 'ok'); render(); };
  window.pfCreerAgence = function(){
    if(RO) return;
    agence(true); save(); toast('Portefeuille Agence créé (équipe Magasin)', 'ok'); render();
  };
  window.pfAffecter = function(id, com){
    var p = brouillon(PF.y, false); if(!p || p.statut !== 'brouillon') return;
    p.affect[id] = com; p.majLe = new Date().toISOString();
    save(); garderScroll(render);
  };
  window.pfAbandonner = function(){
    if(!confirm('Abandonner le brouillon du portefeuille ' + PF.y + ' ? Les clients restent chez leur commercial actuel.')) return;
    delete DB.portefeuilles[PF.y]; save(); render();
  };
  window.pfValider = function(){
    var y = PF.y, yP = String(+y - 1), p = brouillon(y, false); if(!p) return;
    var chg = DB.clients.filter(function(c){ return p.affect[c.id] && p.affect[c.id] !== commercialDe(c, yP); }).length;
    var maintenant = +y <= anneeCourante();
    if(!confirm('Valider le portefeuille ' + y + ' (' + chg + ' client' + (chg > 1 ? 's changent' : ' change') + ' de commercial) ?\n\n' +
      (maintenant ? 'Il s\'applique tout de suite.' : 'Il s\'appliquera tout seul au 1er janvier ' + y + '. D\'ici là, rien ne change dans les écrans ' + yP + '.'))) return;
    /* Photo de l'année précédente, pour que son historique reste juste. */
    if(!pfAnnee(yP)){
      var photo = {};
      DB.clients.forEach(function(c){ photo[c.id] = commercialDe(c, yP); });
      DB.portefeuilles[yP] = {statut:'historique', affect:photo, creeLe:new Date().toISOString()};
    }
    p.statut = 'valide'; p.valideLe = new Date().toISOString(); delete p.applique;
    save();
    if(maintenant) appliquer();
    toast('Portefeuille ' + y + ' validé', 'ok'); render();
  };
  window.pfRouvrir = function(){
    var p = pfAnnee(PF.y); if(!p) return;
    if(!confirm('Repasser le portefeuille ' + PF.y + ' en brouillon pour le modifier ?')) return;
    p.statut = 'brouillon'; delete p.applique; save(); render();
  };

  /* ---------- Trame Excel ---------- */
  window.pfTrame = function(){
    if(typeof XLSX === 'undefined'){ toast('Bibliothèque Excel non chargée', 'bad'); return; }
    var y = PF.y, yP = String(+y - 1), p = brouillon(y, true), ms = monthsOfYear(yP);
    var rows = DB.clients.map(function(c){
      return {c:c, ca:sum(ms.map(function(m){ return caClientMois(c, m); }))};
    }).sort(function(a, b){ return b.ca - a.ca || a.c.nom.localeCompare(b.c.nom); });
    var aoa = [['Client', 'Réseau', 'Département', 'Statut', 'Commercial ' + yP, 'CA ' + yP, 'Commercial ' + y]];
    rows.forEach(function(r){
      aoa.push([r.c.nom, r.c.reseau || '', r.c.dept || '', estProspect(r.c) ? 'Prospect' : 'Client',
        whoName(commercialDe(r.c, yP)), Math.round(r.ca), whoName(p.affect[r.c.id] || r.c.commercial)]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{wch:38}, {wch:14}, {wch:8}, {wch:10}, {wch:16}, {wch:12}, {wch:18}];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Portefeuilles ' + y);
    var aide = XLSX.utils.aoa_to_sheet([
      ['Mode d\'emploi'],
      ['Compléter la colonne « Commercial ' + y + ' » avec le prénom du commercial (' + cibles().map(function(c){ return c.nom; }).join(', ') + ') ou « Agence ».'],
      ['Ne pas modifier la colonne « Client ».'],
      ['Puis importer le fichier dans GIVEDIS OS › Données › Portefeuilles.']
    ]);
    XLSX.utils.book_append_sheet(wb, aide, 'Mode d\'emploi');
    XLSX.writeFile(wb, 'givedis-trame-portefeuilles-' + y + '.xlsx');
    save();
    toast('Trame téléchargée', 'ok');
  };

  /* ---------- Import du tableau ---------- */
  function trouverCom(val){
    var k = normKey(val); if(!k) return null;
    if(/^(agence|magasin|comptoir)\b/.test(k)) return agence(false) ? 'agence' : '__agence__';
    var cs = cibles();
    var hit = cs.find(function(c){ return normKey(c.nom) === k || c.id === k.replace(/ /g, '_'); });
    if(hit) return hit.id;
    hit = cs.find(function(c){ var n = normKey(c.nom); return (' ' + k + ' ').indexOf(' ' + n + ' ') >= 0 || (' ' + n + ' ').indexOf(' ' + k + ' ') >= 0; });
    return hit ? hit.id : null;
  }
  function trouverClient(nom, y){
    var k = normKey(nom); if(!k) return null;
    var l = DB.clients.filter(function(c){ return c.nomKey === k; });
    if(l.length <= 1) return l[0] || null;
    var yP = String(+y - 1), ms = monthsOfYear(yP);
    return l.sort(function(a, b){ return sum(ms.map(function(m){ return caClientMois(b, m); })) - sum(ms.map(function(m){ return caClientMois(a, m); })); })[0];
  }
  window.pfLire = function(f){
    if(!f) return;
    if(typeof XLSX === 'undefined'){ toast('Bibliothèque Excel non chargée', 'bad'); return; }
    f.arrayBuffer().then(function(buf){
      var wb = XLSX.read(buf, {type:'array'});
      var ws = wb.Sheets[wb.SheetNames[0]];
      var aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:false});
      var iH = aoa.findIndex(function(r){ return r.filter(function(x){ return String(x).trim(); }).length >= 2; });
      if(iH < 0) throw new Error('Tableau vide');
      var head = aoa[iH].map(function(x){ return String(x).trim(); });
      var rows = aoa.slice(iH + 1).filter(function(r){ return r.some(function(x){ return String(x).trim(); }); });
      var nk = head.map(normKey);
      var colCli = nk.findIndex(function(h){ return /client|raison|enseigne|agence client|compte/.test(h); });
      if(colCli < 0) colCli = 0;
      var candidats = nk.map(function(h, i){ return {h:h, i:i}; }).filter(function(x){ return x.i !== colCli && /commercial|portefeuille|vendeur|attribu|affect|responsable/.test(x.h); });
      var avecAnnee = candidats.filter(function(x){ return x.h.indexOf(PF.y) >= 0; });
      var colCom = (avecAnnee[0] || candidats[candidats.length - 1] || {i: head.length > 1 ? head.length - 1 : 1}).i;
      PF.imp = {fichier:f.name, head:head, rows:rows, cli:colCli, com:colCom};
      render();
    }).catch(function(e){ toast('Lecture impossible : ' + e.message, 'bad'); });
  };
  window.pfImpCol = function(k, v){ if(PF.imp){ PF.imp[k] = +v; render(); } };
  window.pfImpAnnuler = function(){ PF.imp = null; render(); };

  function analyseImport(y){
    var I = PF.imp, ok = [], inconnus = [], comsInconnus = {}, vides = 0;
    I.rows.forEach(function(r){
      var nom = String(r[I.cli] || '').trim(), vc = String(r[I.com] || '').trim();
      if(!nom) return;
      if(!vc){ vides++; return; }
      var com = trouverCom(vc);
      if(!com){ comsInconnus[vc] = (comsInconnus[vc] || 0) + 1; return; }
      var c = trouverClient(nom, y);
      if(!c){ inconnus.push(nom); return; }
      ok.push({c:c, com:com});
    });
    return {ok:ok, inconnus:inconnus, comsInconnus:comsInconnus, vides:vides};
  }
  function importHtml(y, p){
    var I = PF.imp; if(!I) return '';
    var a = analyseImport(y);
    var chg = a.ok.filter(function(x){ return (x.com === '__agence__' ? 'agence' : x.com) !== (p.affect[x.c.id] || x.c.commercial); }).length;
    var sel = function(k){ return '<select style="width:auto" onchange="pfImpCol(\'' + k + '\', this.value)">' +
      I.head.map(function(h, i){ return '<option value="' + i + '" ' + (I[k] === i ? 'selected' : '') + '>' + esc(h || 'Colonne ' + (i + 1)) + '</option>'; }).join('') + '</select>'; };
    var ci = Object.keys(a.comsInconnus);
    return '<div class="note" style="margin-top:16px">' +
      '<div style="margin-bottom:10px"><strong>' + esc(I.fichier) + '</strong> · ' + I.rows.length + ' lignes</div>' +
      '<div class="grid g2" style="margin-bottom:10px"><div><label class="f">Colonne client</label>' + sel('cli') + '</div><div><label class="f">Colonne commercial ' + y + '</label>' + sel('com') + '</div></div>' +
      '<div>✓ <strong>' + a.ok.length + '</strong> clients reconnus, dont <strong>' + chg + '</strong> changent de portefeuille.</div>' +
      (a.vides ? '<div>○ ' + a.vides + ' lignes sans commercial : ignorées (le client garde son portefeuille actuel).</div>' : '') +
      (a.inconnus.length ? '<div style="margin-top:6px">⚠ ' + a.inconnus.length + ' clients introuvables dans GIVEDIS OS (ignorés) : <span class="hint">' + a.inconnus.slice(0, 25).map(esc).join(', ') + (a.inconnus.length > 25 ? '…' : '') + '</span></div>' : '') +
      (ci.length ? '<div style="margin-top:6px">⚠ Commerciaux non reconnus (lignes ignorées) : ' + ci.map(function(k){ return '<strong>' + esc(k) + '</strong> (' + a.comsInconnus[k] + ')'; }).join(', ') +
        '. Ajoutez la personne dans Données › Équipe, ou corrigez le tableau.</div>' : '') +
      '<div class="btnrow" style="margin-top:12px"><button class="btn" onclick="pfImpAppliquer()"' + (a.ok.length ? '' : ' disabled') + '>Appliquer au portefeuille ' + y + '</button>' +
      '<button class="btn ghost" onclick="pfImpAnnuler()">Annuler</button></div></div>';
  }
  window.pfImpAppliquer = function(){
    var y = PF.y, p = brouillon(y, true); if(!PF.imp || !p || p.statut !== 'brouillon') return;
    var a = analyseImport(y), n = 0;
    if(a.ok.some(function(x){ return x.com === '__agence__'; })) agence(true);
    a.ok.forEach(function(x){
      var com = x.com === '__agence__' ? 'agence' : x.com;
      if(p.affect[x.c.id] !== com){ p.affect[x.c.id] = com; n++; }
    });
    p.source = PF.imp.fichier; p.majLe = new Date().toISOString();
    PF.imp = null; save();
    toast(n + ' client' + (n > 1 ? 's' : '') + ' réaffecté' + (n > 1 ? 's' : '') + '. Vérifiez puis validez.', 'ok');
    render();
  };

  /* ---------- Envoi à l'appli de saisie ---------- */
  window.pfEnvoyer = function(){
    var y = PF.y, yP = String(+y - 1), p = pfAnnee(y);
    if(!p || p.statut !== 'valide') return;
    if(typeof FBS === 'undefined' || !FBS.user){ toast('Activez d\'abord la synchro terrain (Données › Synchro terrain)', 'bad'); return; }
    var envois = Object.keys(FBS_NOMS).map(function(uid){
      var nom = FBS_NOMS[uid];
      var co = DB.commerciaux.find(function(c){ return normKey(c.nom) === normKey(nom); });
      return co ? {uid:uid, co:co} : null;
    }).filter(Boolean);
    if(!envois.length){ toast('Aucun commercial terrain reconnu', 'bad'); return; }
    var detail = envois.map(function(e){
      var n = DB.clients.filter(function(c){ return (p.affect[c.id] || c.commercial) === e.co.id; }).length;
      return e.co.nom + ' : ' + n + ' clients';
    }).join('\n');
    if(!confirm('Remplacer le portefeuille de chaque commercial dans l\'appli de saisie par le portefeuille ' + y + ' ?\n\n' + detail +
      '\n\nLeurs visites ne sont pas touchées. Pour un client repris d\'un collègue, ils verront qui le suivait et la dernière visite.')) return;
    var jobs = envois.map(function(e){
      var liste = DB.clients.filter(function(c){ return (p.affect[c.id] || c.commercial) === e.co.id; })
        .sort(function(a, b){ return a.nom.localeCompare(b.nom); })
        .map(function(c){
          var o = {client:c.nom};
          var avant = commercialDe(c, yP);
          if(avant && avant !== e.co.id){
            o.avant = whoName(avant);
            var lv = lastVisitOf(c.id);
            if(lv){ o.derniereVisite = lv.date || ''; o.dernierCR = String(lv.compteRendu || '').slice(0, 200); o.dernierResultat = lv.resultat || ''; }
          }
          return o;
        });
      return FBS.db.collection('portefeuilles').doc(e.uid)
        .set({uid:e.uid, commercial:e.co.nom, clients:liste, exercice:y, updatedAt:new Date().toISOString()});
    });
    Promise.all(jobs).then(function(){
      p.envoyeLe = new Date().toISOString(); save();
      toast('Portefeuilles ' + y + ' envoyés aux commerciaux', 'ok'); render();
    }).catch(function(e){ toast('Envoi impossible : ' + e.message, 'bad'); });
  };

  /* ====================== Objectifs au % ====================== */
  function reglages(y){
    DB.objectifs.reglage = DB.objectifs.reglage || {};
    DB.objectifs.reglage[y] = DB.objectifs.reglage[y] || {};
    return DB.objectifs.reglage[y];
  }
  function reglage(y, com){
    var r = reglages(y);
    r[com] = r[com] || {pctCa:null, pctMarge:null, repartition:'saison', manuel:{}, pilote:{}};
    r[com].manuel = r[com].manuel || {};
    r[com].pilote = r[com].pilote || {};   /* champs (ca / marge) calculés par cet écran */
    return r[com];
  }
  /* Base N-1 à portefeuille égal : CA et marge, mois par mois. */
  function base(y, com){
    var yP = String(+y - 1);
    var cls = DB.clients.filter(function(c){ return commercialPrevu(c, y) === com; });
    var ca = monthsOfYear(yP).map(function(m){ return sum(cls.map(function(c){ return caClientMois(c, m); })); });
    var mg = monthsOfYear(yP).map(function(m){ return sum(cls.map(function(c){ return margeClient(c, m, com, yP); })); });
    return {ca:ca, marge:mg, totCa:sum(ca), totMarge:sum(mg), clients:cls.length, sansCa:cls.filter(function(c){ return !monthsOfYear(yP).some(function(m){ return caClientMois(c, m) > 0; }); }).length};
  }
  /* Répartit un total annuel sur 12 mois, en respectant les mois fixés à la main. */
  function repartir(total, poids, manuel, actuels){
    var ms = Object.keys(actuels);
    var fixe = 0, libres = [];
    ms.forEach(function(m, i){ if(manuel[m]) fixe += +actuels[m] || 0; else libres.push(i); });
    var reste = Math.max(0, total - fixe);
    var pTot = sum(libres.map(function(i){ return poids[i]; }));
    var out = {};
    ms.forEach(function(m, i){
      if(manuel[m]) out[m] = +actuels[m] || 0;
      else out[m] = pTot > 0 ? arrondi(reste * poids[i] / pTot) : arrondi(reste / (libres.length || 1));
    });
    /* L'écart d'arrondi va sur le plus gros mois libre : le total tombe juste. */
    if(libres.length){
      var ecart = reste - sum(libres.map(function(i){ return out[ms[i]]; }));
      var gros = libres.reduce(function(a, i){ return out[ms[i]] > out[ms[a]] ? i : a; }, libres[0]);
      out[ms[gros]] += ecart;
    }
    return out;
  }
  /* Écrit les objectifs annuel + mensuels d'un commercial à partir de son réglage. */
  function calculer(y, com){
    var r = reglage(y, com), b = base(y, com), ms = monthsOfYear(y);
    DB.objectifs.annuel[com] = DB.objectifs.annuel[com] || {};
    DB.objectifs.mensuel[com] = DB.objectifs.mensuel[com] || {};
    var an = DB.objectifs.annuel[com][y] || {ca:0, marge:0};
    var ca = r.pctCa != null && r.pctCa !== '' ? arrondi(b.totCa * (1 + r.pctCa / 100)) : (+an.ca || 0);
    var mg = r.pctMarge != null && r.pctMarge !== '' ? arrondi(b.totMarge * (1 + r.pctMarge / 100)) : (+an.marge || 0);
    /* Seuls les champs pilotés ici sont réécrits : un objectif saisi ailleurs reste intact. */
    if(!r.pilote.ca) ca = +an.ca || 0;
    if(!r.pilote.marge) mg = +an.marge || 0;
    DB.objectifs.annuel[com][y] = {ca:ca, marge:mg};
    var egal = r.repartition === 'egale';
    var pCa = egal || !b.totCa ? ms.map(function(){ return 1; }) : b.ca;
    var pMg = egal || !b.totMarge ? (egal || !b.totCa ? ms.map(function(){ return 1; }) : b.ca) : b.marge;
    var actCa = {}, actMg = {};
    ms.forEach(function(m){ var o = DB.objectifs.mensuel[com][m] || {}; actCa[m] = o.ca; actMg[m] = o.marge; });
    var manCa = {}, manMg = {};
    Object.keys(r.manuel).forEach(function(m){ if(r.manuel[m].ca) manCa[m] = 1; if(r.manuel[m].marge) manMg[m] = 1; });
    var oCa = repartir(ca, pCa, manCa, actCa), oMg = repartir(mg, pMg, manMg, actMg);
    ms.forEach(function(m){
      var o = Object.assign({}, DB.objectifs.mensuel[com][m] || {});
      if(r.pilote.ca) o.ca = oCa[m];
      if(r.pilote.marge) o.marge = oMg[m];
      if(o.ca != null || o.marge != null) DB.objectifs.mensuel[com][m] = o;
    });
  }

  var OBJ = {com:null};
  window.objPct = function(com, champ, val){
    if(RO) return;
    var y = YEAR, r = reglage(y, com), v = String(val).replace(',', '.').trim();
    r[champ] = v === '' ? null : +v;
    r.pilote[champ === 'pctCa' ? 'ca' : 'marge'] = true;
    calculer(y, com); save(); garderScroll(render);
  };
  window.objMontant = function(com, champ, val){
    if(RO) return;
    var y = YEAR, b = base(y, com), r = reglage(y, com), v = parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
    var tot = champ === 'ca' ? b.totCa : b.totMarge;
    if(isNaN(v)) return;
    r.pilote[champ] = true;
    if(tot > 0) r[champ === 'ca' ? 'pctCa' : 'pctMarge'] = Math.round((v / tot - 1) * 1000) / 10;
    else {
      r[champ === 'ca' ? 'pctCa' : 'pctMarge'] = null;
      DB.objectifs.annuel[com] = DB.objectifs.annuel[com] || {};
      var an = DB.objectifs.annuel[com][y] || {ca:0, marge:0}; an[champ] = arrondi(v); DB.objectifs.annuel[com][y] = an;
    }
    calculer(y, com); save(); garderScroll(render);
  };
  window.objRepart = function(com, v){ if(RO) return; reglage(YEAR, com).repartition = v; calculer(YEAR, com); save(); garderScroll(render); };
  window.objMoisFixer = function(com, m, champ, val){
    if(RO) return;
    var y = YEAR, r = reglage(y, com), v = parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
    r.manuel[m] = r.manuel[m] || {};
    DB.objectifs.mensuel[com] = DB.objectifs.mensuel[com] || {};
    var o = DB.objectifs.mensuel[com][m] || {};
    if(isNaN(v)){ delete r.manuel[m][champ]; }
    else { r.manuel[m][champ] = true; r.pilote[champ] = true; o[champ] = arrondi(v); DB.objectifs.mensuel[com][m] = o; }
    calculer(y, com); save(); garderScroll(render);
  };
  window.objMoisAuto = function(com){
    if(RO) return;
    reglage(YEAR, com).manuel = {}; calculer(YEAR, com); save(); toast('Mois recalculés', 'ok'); garderScroll(render);
  };
  window.objCom = function(com){ OBJ.com = com; garderScroll(render); };

  function carteObjectifs(){
    var y = YEAR, yP = String(+y - 1), coms = AVEC_OBJ();
    if(!coms.length) return '';
    var p = pfAnnee(y);
    var src = p ? (p.statut === 'brouillon' ? 'portefeuille ' + y + ' (brouillon)' : 'portefeuille ' + y) : 'portefeuille actuel';
    var lignes = coms.map(function(c){
      var b = base(y, c.id), r = reglage(y, c.id), an = (DB.objectifs.annuel[c.id] || {})[y] || {ca:0, marge:0};
      return {c:c, b:b, r:r, an:an};
    });
    var t = lignes.reduce(function(a, l){ a.bca += l.b.totCa; a.bmg += l.b.totMarge; a.ca += +l.an.ca || 0; a.mg += +l.an.marge || 0; return a; }, {bca:0, bmg:0, ca:0, mg:0});
    var pctTxt = function(o, b){ return b ? ((o / b - 1) * 100 >= 0 ? '+' : '') + ((o / b - 1) * 100).toLocaleString('fr-FR', {maximumFractionDigits:1}) + ' %' : '—'; };
    var inp = function(val, on, w){ return RO ? '<span class="mono">' + esc(val) + '</span>' :
      '<input value="' + esc(val) + '" style="width:' + (w || 90) + 'px;text-align:right" onchange="' + on + '">'; };

    var h = '<div class="card" style="border-left:4px solid var(--acc)">' +
      '<div class="card-h"><div><div class="eyebrow">Base : CA ' + yP + ' à portefeuille égal · ' + esc(src) + '</div><h3>Objectifs ' + y + ' au % de progression</h3></div>' +
      (p ? '' : '<button class="btn ghost sm" onclick="go(\'data\',\'portefeuilles\')">Préparer le portefeuille ' + y + '</button>') + '</div>' +
      '<p class="hint" style="margin-bottom:12px">Pour chaque commercial : ce que les clients de son portefeuille ' + y + ' ont acheté en ' + yP + '. Tapez un % (ou directement un objectif en €) : l\'objectif annuel et les 12 mois se calculent tout seuls, selon la saisonnalité ' + yP + ' de ses clients.</p>' +
      '<div class="tw"><table><thead><tr><th>Commercial</th><th class="num">Clients</th>' +
        '<th class="num">CA ' + yP + '</th><th class="num">% CA</th><th class="num">Objectif CA ' + y + '</th>' +
        '<th class="num">Marge ' + yP + '</th><th class="num">% marge</th><th class="num">Objectif marge ' + y + '</th><th>Répartition</th></tr></thead><tbody>' +
      lignes.map(function(l){
        var id = l.c.id;
        return '<tr><td><strong>' + esc(l.c.nom) + '</strong></td>' +
          '<td class="num mono">' + l.b.clients + (l.b.sansCa ? '<div class="hint">' + l.b.sansCa + ' sans CA ' + yP + '</div>' : '') + '</td>' +
          '<td class="num mono">' + eur(l.b.totCa) + '</td>' +
          '<td class="num">' + inp(l.r.pctCa != null ? String(l.r.pctCa).replace('.', ',') : '', 'objPct(\'' + id + '\',\'pctCa\',this.value)', 70) + ' %</td>' +
          '<td class="num">' + inp(l.an.ca ? num(l.an.ca) : '', 'objMontant(\'' + id + '\',\'ca\',this.value)', 110) + ' €' + (l.r.pctCa == null && l.an.ca ? '<div class="hint">' + pctTxt(l.an.ca, l.b.totCa) + '</div>' : '') + '</td>' +
          '<td class="num mono">' + eur(l.b.totMarge) + '</td>' +
          '<td class="num">' + inp(l.r.pctMarge != null ? String(l.r.pctMarge).replace('.', ',') : '', 'objPct(\'' + id + '\',\'pctMarge\',this.value)', 70) + ' %</td>' +
          '<td class="num">' + inp(l.an.marge ? num(l.an.marge) : '', 'objMontant(\'' + id + '\',\'marge\',this.value)', 110) + ' €</td>' +
          '<td>' + (RO ? (l.r.repartition === 'egale' ? 'égale' : 'saisonnalité') :
            '<select style="width:auto" onchange="objRepart(\'' + id + '\', this.value)"><option value="saison"' + (l.r.repartition !== 'egale' ? ' selected' : '') + '>Saisonnalité ' + yP + '</option><option value="egale"' + (l.r.repartition === 'egale' ? ' selected' : '') + '>12 parts égales</option></select>') + '</td></tr>';
      }).join('') + '</tbody>' +
      '<tfoot style="border-top:2px solid var(--line2)"><tr><td style="font-weight:700">Équipe</td><td></td><td class="num mono">' + eur(t.bca) + '</td><td class="num mono">' + pctTxt(t.ca, t.bca) + '</td>' +
        '<td class="num mono" style="font-weight:700">' + eur(t.ca) + '</td><td class="num mono">' + eur(t.bmg) + '</td><td class="num mono">' + pctTxt(t.mg, t.bmg) + '</td><td class="num mono" style="font-weight:700">' + eur(t.mg) + '</td><td></td></tr></tfoot></table></div>';

    /* Détail mensuel d'un commercial */
    var cur = lignes.find(function(l){ return l.c.id === OBJ.com; }) || lignes[0];
    var ms = monthsOfYear(y), msP = monthsOfYear(yP), mens = DB.objectifs.mensuel[cur.c.id] || {};
    var man = cur.r.manuel || {};
    var cell = function(m, champ){
      var o = mens[m] || {}, v = o[champ], est = man[m] && man[m][champ];
      return '<td class="num">' + (RO ? '<span class="mono">' + (v ? num(v) : '—') + '</span>' :
        '<input value="' + (v ? num(v) : '') + '" style="width:92px;text-align:right' + (est ? ';border-color:var(--warn);background:rgba(224,138,30,.08)' : '') + '" title="' + (est ? 'Fixé à la main' : 'Calculé') + '" onchange="objMoisFixer(\'' + cur.c.id + '\',\'' + m + '\',\'' + champ + '\',this.value)">') + '</td>';
    };
    h += '<div style="margin-top:18px"><div class="card-h" style="padding:0;margin-bottom:8px"><h3 style="font-size:15px">Détail par mois</h3>' +
      '<div class="btnrow"><select style="width:auto" onchange="objCom(this.value)">' + lignes.map(function(l){ return '<option value="' + l.c.id + '"' + (l.c.id === cur.c.id ? ' selected' : '') + '>' + esc(l.c.nom) + '</option>'; }).join('') + '</select>' +
      (!RO && Object.keys(man).some(function(m){ return man[m].ca || man[m].marge; }) ? '<button class="btn ghost sm" onclick="objMoisAuto(\'' + cur.c.id + '\')">Tout recalculer</button>' : '') + '</div></div>' +
      '<div class="tw"><table><thead><tr><th></th>' + ms.map(function(m){ return '<th class="num">' + monthLabel(m).split(' ')[0] + '</th>'; }).join('') + '<th class="num">Total</th></tr></thead><tbody>' +
      '<tr style="color:var(--ink3)"><td>CA ' + yP + '</td>' + cur.b.ca.map(function(v){ return '<td class="num mono">' + (v ? num(v) : '—') + '</td>'; }).join('') + '<td class="num mono">' + num(cur.b.totCa) + '</td></tr>' +
      '<tr><td><strong>Objectif CA</strong></td>' + ms.map(function(m){ return cell(m, 'ca'); }).join('') + '<td class="num mono" style="font-weight:700">' + num(sum(ms.map(function(m){ return (mens[m] || {}).ca; }))) + '</td></tr>' +
      '<tr style="color:var(--ink3)"><td>Marge ' + yP + '</td>' + cur.b.marge.map(function(v){ return '<td class="num mono">' + (v ? num(v) : '—') + '</td>'; }).join('') + '<td class="num mono">' + num(cur.b.totMarge) + '</td></tr>' +
      '<tr><td><strong>Objectif marge</strong></td>' + ms.map(function(m){ return cell(m, 'marge'); }).join('') + '<td class="num mono" style="font-weight:700">' + num(sum(ms.map(function(m){ return (mens[m] || {}).marge; }))) + '</td></tr>' +
      '</tbody></table></div>' +
      (RO ? '' : '<p class="hint" style="margin-top:8px">Un mois corrigé à la main (encadré orange) reste fixe : les autres mois se réajustent pour garder l\'objectif annuel. Videz la case pour le rendre automatique.</p>') +
      '</div>' +
      (agence(false) ? '<p class="hint" style="margin-top:10px">Le portefeuille Agence fait partie de l\'équipe Magasin : suivi sans objectif ni prime.</p>' : '') +
      '</div>';
    return h;
  }
  var vueObj = VIEWS['pilotage:objectifs'];
  VIEWS['pilotage:objectifs'] = function(){
    var h = vueObj.apply(this, arguments);
    if(!AVEC_OBJ().length) return h;
    return carteObjectifs() + h;
  };

  /* ====================== Tableau de bord : N-1 à portefeuille égal ====================== */
  var vueDash = VIEWS['pilotage:dashboard'];
  VIEWS['pilotage:dashboard'] = function(){
    var h = vueDash.apply(this, arguments);
    var y = YEAR, p = pfAnnee(y);
    if(!pfActif(p)) return h;
    var yP = String(+y - 1), mk = dashMonth(), ms = monthsOfYear(y).filter(function(m){ return m <= mk; });
    var lignes = ACTIFS().map(function(c){
      var cls = DB.clients.filter(function(cl){ return commercialDe(cl, y) === c.id; });
      var n = sum(ms.map(function(m){ return sum(cls.map(function(cl){ return caClientMois(cl, m); })); }));
      var n1 = sum(ms.map(function(m){ return sum(cls.map(function(cl){ return caClientMois(cl, yP + m.slice(4)); })); }));
      return {c:c, n:n, n1:n1};
    });
    var carte = '<div class="card"><div class="card-h"><div><div class="eyebrow">Janvier → ' + monthLabel(mk).split(' ')[0] + ' · détail clients (fichiers compta)</div><h3>Évolution à portefeuille égal</h3></div></div>' +
      '<p class="hint" style="margin-bottom:10px">Mêmes clients sur les deux années : ceux du portefeuille ' + y + ' de chaque commercial, comparés à ce qu\'ils avaient acheté en ' + yP + ' (quel que soit le commercial de l\'époque).</p>' +
      '<div class="tw"><table><thead><tr><th>Commercial</th><th class="num">Cumul ' + y + '</th><th class="num">Mêmes clients ' + yP + '</th><th>Évolution</th></tr></thead><tbody>' +
      lignes.map(function(l){ return '<tr><td><strong>' + esc(l.c.nom) + '</strong></td><td class="num mono">' + eur(l.n) + '</td><td class="num mono" style="color:var(--ink3)">' + eur(l.n1) + '</td><td>' + evoTag(evo(l.n, l.n1)) + '</td></tr>'; }).join('') +
      '</tbody></table></div></div>';
    var marque = '<div class="card">\n    <div class="card-h"><h3>Top 10 clients';
    var i = h.indexOf(marque);
    return i >= 0 ? h.slice(0, i) + carte + h.slice(i) : h + carte;
  };

  /* Retour sur l'onglet après un rechargement. */
  try{
    if(SPACE === 'data' && lsGet('gos_tab') === 'portefeuilles' && NAV.data.tabs.some(function(t){ return t.id === 'portefeuilles'; })){ TAB = 'portefeuilles'; render(); }
    else if(SPACE === 'pilotage' && (TAB === 'objectifs' || TAB === 'dashboard')) render();
    else renderShell();
  }catch(e){}
})();
