/* =====================================================================
   GIVEDIS OS — Détail client de l'écart mensuel avec N-1
   À charger APRÈS historique.js : au clic sur un mois du tableau
   « Écart avec N-1 » du tableau de bord, liste les clients qui
   expliquent l'écart (même base que le tableau : périmètre constant,
   base égale). Lecture seule : ce module n'enregistre rien.
   ===================================================================== */
(function(){
  var ED = {coms: [], m: '', filtre: '', q: ''};
  var sum = function(a){ return a.reduce(function(s, x){ return s + (+x || 0); }, 0); };
  var sgn = function(v){ return v >= 0 ? '+' : '−'; };
  var eurS = function(v){ return sgn(v) + eur(Math.abs(v)); };
  var LBL = {hausse:'En hausse', baisse:'En baisse', nouveau:'Nouveau ce mois', perdu:'Sans achat ce mois', stable:'Stable', autre:'Client d\'un autre portefeuille'};
  var CLS = {hausse:'ok', baisse:'bad', nouveau:'info', perdu:'bad', stable:'mute', autre:'mute'};

  /* Affichage : les commandes prises par un autre commercial chez le client sont montrées dans
     la colonne de l'année en cours (« dont … ») plutôt que retirées de l'année précédente.
     L'écart est le même (base égale), et l'année précédente reste le vrai chiffre du client. */
  function statut(r){
    if(r.proprio !== r.com) return 'autre';
    if(!r.pA) return 'nouveau';
    if(!r.nA) return 'perdu';
    var v = (r.nA - r.pA) / r.pA * 100;
    return v > 5 ? 'hausse' : v < -5 ? 'baisse' : 'stable';
  }

  /* Sans historique compta : comparaison fiche par fiche (chiffres de l'époque). */
  function detailSimple(com, mN){
    var mP = (+mN.slice(0,4) - 1) + mN.slice(4), yP = mP.slice(0,4), yN = mN.slice(0,4), out = [];
    DB.clients.forEach(function(c){
      var n = commercialDe(c, yN) === com ? caClientMois(c, mN) : 0;
      var p = commercialDe(c, yP) === com ? caClientMois(c, mP) : 0;
      if(Math.abs(n) >= 0.5 || Math.abs(p) >= 0.5) out.push({id: c.id, nom: c.nom, com: com, proprio: com, n: n, p: p, autres: []});
    });
    return out;
  }

  function donnees(){
    var mN = ED.m, mP = (+mN.slice(0,4) - 1) + mN.slice(4), avecHist = !!(window.HIST && HIST.detailMois && HIST.a(mP.slice(0,4)));
    var rows = [], tot = {n:0, p:0}, nonDetail = false, frac = 1;
    ED.coms.forEach(function(com){
      var st = stats(com, mN), f = 1;
      try{ f = fracStade(com, mN); }catch(e){}
      frac = Math.min(frac, f);
      tot.n += (typeof statsC === 'function' ? statsC(com, mN) : st).ca;
      tot.p += (typeof statsN1 === 'function' ? statsN1(com, mP) : stats(com, mP)).ca * f;
      if(st.source !== 'officiel') nonDetail = true;
      (avecHist ? HIST.detailMois(com, mN) : detailSimple(com, mN)).forEach(function(r){ r.p *= f; rows.push(r); });
    });
    /* Plusieurs personnes affichées ensemble : une commande d'un commercial chez un client d'une autre
       personne de la liste serait comptée deux fois (chez l'un et chez l'autre) : on la retire. */
    if(ED.coms.length > 1 && avecHist && HIST.interne){
      var it = HIST.interne(ED.coms, mN); tot.n -= it.ca; tot.p -= it.ca * frac;
      rows = rows.filter(function(r){ return !(r.proprio !== r.com && ED.coms.indexOf(r.proprio) >= 0); });
      rows.forEach(function(r){
        var dedans = r.autres.filter(function(a){ return ED.coms.indexOf(a.com) >= 0; });
        r.n -= sum(dedans.map(function(a){ return a.ca; }));
        r.autres = r.autres.filter(function(a){ return ED.coms.indexOf(a.com) < 0; });
      });
    }
    rows.forEach(function(r){
      /* detailMois : n du propriétaire inclut déjà les commandes des autres (« dont ») */
      if(r.proprio !== r.com){ r.pA = 0; r.nA = r.n; r.ecart = r.n - r.p; }
      else { r.pA = r.p; r.nA = r.n; r.ecart = r.n - r.p; }
      r.var = r.proprio === r.com && r.pA ? r.ecart / r.pA * 100 : null; r.statut = statut(r);
    });
    rows.sort(function(a, b){ return Math.abs(b.ecart) - Math.abs(a.ecart); });
    var reste = (tot.n - tot.p) - sum(rows.map(function(r){ return r.ecart; }));
    return {rows: rows, tot: tot, reste: reste, nonDetail: nonDetail, frac: frac, avecHist: avecHist, mP: mP};
  }

  function ouvrir(){
    var D = donnees(), mN = ED.m, plusieurs = ED.coms.length > 1;
    var noms = ED.coms.map(function(c){ return whoName(c); }).join(' + ');
    var groupes = ['hausse','nouveau','baisse','perdu','stable','autre'].map(function(s){
      var l = D.rows.filter(function(r){ return r.statut === s; });
      return {s: s, nb: l.length, ecart: sum(l.map(function(r){ return r.ecart; }))};
    });
    var liste = D.rows.filter(function(r){ return !ED.filtre || r.statut === ED.filtre; })
      .filter(function(r){ return !ED.q || normKey(r.nom).indexOf(normKey(ED.q)) >= 0; });
    var ecartTot = D.tot.n - D.tot.p;
    var lignes = liste.slice(0, 400).map(function(r){
      var dont = r.autres.length ? '<div class="hint" title="Commandes prises par un autre commercial chez ce client : comptées dans son CA à lui, et ici pour comparer à base égale">dont ' +
        esc(r.autres.map(function(a){ return whoName(a.com) + ' ' + eur(a.ca); }).join(', ')) + '</div>' : '';
      var chez = r.proprio !== r.com ? ' <span class="tag mute" title="Client du portefeuille ' + esc(whoName(r.proprio)) + ' : la commande compte dans le CA de ' + esc(whoName(r.com)) + ' et n\'entre pas dans son écart (base égale)">client ' + esc(whoName(r.proprio)) + '</span>' : '';
      return '<tr><td><a href="#" onclick="clientModal(\'' + esc(r.id) + '\');return false">' + esc(r.nom) + '</a>' + chez + '</td>' +
        (plusieurs ? '<td>' + esc(whoName(r.com)) + '</td>' : '') +
        '<td class="num mono" style="color:var(--ink3)">' + (r.proprio !== r.com ? '—' : eur(r.pA)) + '</td><td class="num mono">' + eur(r.nA) + dont + '</td>' +
        '<td class="num mono" style="color:var(--' + (r.ecart >= 0 ? 'ok' : 'bad') + ');font-weight:600">' + eurS(r.ecart) + '</td>' +
        '<td>' + (r.var === null ? '<span class="tag mute">—</span>' : evoTag(r.var)) + '</td>' +
        '<td><span class="tag ' + CLS[r.statut] + '">' + LBL[r.statut] + '</span></td></tr>';
    }).join('');

    openModal(
      '<div class="card-h" style="padding:0;margin-bottom:10px"><div><div class="eyebrow">' + esc(noms) + ' · d\'où vient l\'écart</div>' +
      '<h3 style="margin:0">' + esc(monthLabel(mN)) + ' face à ' + esc(monthLabel(D.mP)) + '</h3></div>' +
      '<button class="btn ghost sm" onclick="closeModal()">✕</button></div>' +
      '<div class="grid g-auto" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin-bottom:12px">' +
        '<div class="kpi info"><div class="lab">CA ' + mN.slice(0,4) + '</div><div class="val">' + eur(D.tot.n) + '</div><div class="sub">' + D.mP.slice(0,4) + (D.frac < 1 ? ' au même stade' : '') + ' : ' + eur(D.tot.p) + '</div></div>' +
        '<div class="kpi ' + (ecartTot >= 0 ? 'ok' : 'bad') + '"><div class="lab">Écart</div><div class="val">' + eurS(ecartTot) + '</div><div class="sub">' + evoTag(evo(D.tot.n, D.tot.p)) + '</div></div>' +
        groupes.filter(function(g){ return g.nb; }).map(function(g){
          return '<div class="kpi ' + (CLS[g.s] === 'ok' ? 'ok' : CLS[g.s] === 'bad' ? 'bad' : 'info') + '" style="cursor:pointer;' + (ED.filtre === g.s ? 'outline:2px solid var(--accent,#4d9bff)' : '') + '" onclick="ecartFiltre(\'' + g.s + '\')">' +
            '<div class="lab">' + LBL[g.s] + '</div><div class="val">' + g.nb + '</div><div class="sub">' + eurS(g.ecart) + '</div></div>';
        }).join('') +
      '</div>' +
      (D.nonDetail ? '<p class="note warn">Une partie de ce mois n\'a pas encore de chiffre officiel (saisie hebdo ou import en attente) : le détail par client peut être incomplet.</p>' : '') +
      (Math.abs(D.reste) >= 1 ? '<p class="hint">Écart non rattaché à un client : <strong>' + eurS(D.reste) + '</strong> (différence entre le chiffre officiel du mois et le détail par client de la compta).</p>' : '') +
      '<div class="card-h" style="padding:0;margin:6px 0 8px;gap:8px;flex-wrap:wrap"><span class="hint">' + liste.length + ' client' + (liste.length > 1 ? 's' : '') +
        (ED.filtre ? ' · ' + LBL[ED.filtre] + ' <a href="#" onclick="ecartFiltre(\'\');return false">(tout afficher)</a>' : ' · du plus gros écart au plus petit') + '</span>' +
        '<input id="edq" placeholder="Rechercher un client…" value="' + esc(ED.q) + '" style="width:190px" oninput="ecartRecherche(this.value)"></div>' +
      '<div class="tw" style="max-height:52vh;overflow:auto"><table><thead><tr><th>Client</th>' + (plusieurs ? '<th>Commercial</th>' : '') +
        '<th class="num">' + D.mP.slice(0,4) + '</th><th class="num">' + mN.slice(0,4) + '</th><th class="num">Écart</th><th>Var.</th><th>Statut</th></tr></thead><tbody>' +
        (lignes || '<tr><td colspan="7" class="hint" style="text-align:center;padding:14px">Aucun client</td></tr>') + '</tbody></table></div>' +
      (liste.length > 400 ? '<p class="hint">400 premiers affichés sur ' + liste.length + '.</p>' : '') +
      '<p class="hint" style="margin-bottom:0">« dont » : commandes prises par un autre commercial chez le client, comptées dans son CA à lui mais montrées ici pour comparer à base égale. Même base que le tableau : ' + (D.avecHist ? D.mP.slice(0,4) + ' à périmètre constant (clients du portefeuille ' + mN.slice(0,4) + ', toutes fiches et fichier compta global), à base égale' : 'chiffres de l\'époque, fiche par fiche') +
        (D.frac < 1 ? ' ; mois en cours : ' + D.mP.slice(0,4) + ' ramené au même stade' : '') + '. Clic sur un client : sa fiche.</p>'
    );
    var m = document.getElementById('modalIn'); if(m) m.classList.add('fc-wide');
  }

  window.ecartDetail = function(coms, m){ ED.coms = coms; ED.m = m; ED.filtre = ''; ED.q = ''; ouvrir(); };
  window.ecartFiltre = function(s){ ED.filtre = ED.filtre === s ? '' : s; ouvrir(); };
  window.ecartRecherche = function(q){
    ED.q = q; ouvrir();
    var i = document.getElementById('edq'); if(i){ i.focus(); i.setSelectionRange(q.length, q.length); }
  };
})();
