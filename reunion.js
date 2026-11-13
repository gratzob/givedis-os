/* =========================================================================
   GIVEDIS OS — Réunion hebdomadaire + « Le Mot de la Direction »
   -------------------------------------------------------------------------
   À charger APRÈS lecture.js et analyse.js : <script src="reunion.js"></script>

   • Une fiche par semaine (lundi → vendredi) : Mot de la Direction, sujets,
     point chiffré (calculé tout seul), compte rendu, suivi des actions de la
     réunion précédente et plan d'action de la semaine suivante. Export PDF.
     Données : DB.reunions (sauvegardées comme le reste : navigateur + Drive).

   • Le Mot de la Direction est écrit uniquement par le patron, depuis le lien
     de consultation, avec son mot de passe de consultation habituel.
     Il est rangé en ligne (Firebase, collection « direction », un document par
     semaine) et recopié ici dans DB.direction. Dans GIVEDIS OS, il se lit
     mais ne se modifie pas.
     Le compte Firebase « direction@givedis.app » est créé et tenu à jour tout
     seul : son mot de passe est celui de la consultation.
   ========================================================================= */
(function(){
  'use strict';
  if(typeof NAV === 'undefined' || typeof VIEWS === 'undefined'){ console.warn('reunion.js : GIVEDIS OS introuvable'); return; }

  var RO = new URLSearchParams(location.search).has('lire');
  var DIR_EMAIL = 'direction@givedis.app';
  var COLL = 'direction';
  var CLE_DIR_OK = 'gos_dir_ok';
  var STATUTS = [
    {v:'afaire',  l:'À faire',  k:'mute'},
    {v:'encours', l:'En cours', k:'info'},
    {v:'fait',    l:'Fait',     k:'ok'},
    {v:'pasfait', l:'Pas fait', k:'bad'}
  ];

  /* ---------- Onglet ---------- */
  var tabs = NAV.pilotage.tabs;
  if(!tabs.some(function(t){ return t.id === 'reunion'; })){
    var iCr = tabs.findIndex(function(t){ return t.id === 'compterendu'; });
    tabs.splice(iCr >= 0 ? iCr + 1 : tabs.length, 0, {id:'reunion', label:'Réunion hebdomadaire'});
  }

  /* ---------- Outils ---------- */
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch(e){} }
  function txt(s){ return s ? esc(s).replace(/\n/g, '<br>') : '<span class="hint">—</span>'; }
  function reunions(){ if(!DB.reunions) DB.reunions = []; return DB.reunions; }
  function reunionDe(w){ return (DB.reunions || []).find(function(r){ return r.semaine === w; }) || null; }
  function precedente(w){
    return (DB.reunions || []).filter(function(r){ return r.semaine < w; })
      .sort(function(a, b){ return b.semaine.localeCompare(a.semaine); })[0] || null;
  }
  function statut(v){ return STATUTS.find(function(s){ return s.v === v; }) || STATUTS[0]; }
  function sur(){ return SPACE === 'pilotage' && TAB === 'reunion'; }
  function rafraichirSiVisible(){
    if(!sur()) return;
    var modal = document.getElementById('modal');
    if(modal && modal.classList.contains('on')) return;
    var a = document.activeElement;
    if(a && a.closest && a.closest('#main') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    render();
  }

  var SEL = lsGet('gos_reu_sem') || '';
  function semaineChoisie(){ return SEL || semaineCourante(); }
  window.reuChoisir = function(w){
    if(!w) return;
    SEL = w; lsSet('gos_reu_sem', w); render();
  };

  /* =================== Mot de la Direction : stockage en ligne =================== */
  var APP = null, PERSIST = null;
  function appDir(){
    if(!APP){
      APP = firebase.initializeApp(FBS_CONF, 'givedis-direction');
      PERSIST = APP.auth().setPersistence(firebase.auth.Auth.Persistence.NONE).catch(function(){});
    }
    return APP;
  }
  function firebaseOk(){ return typeof firebase !== 'undefined' && typeof FBS_CONF !== 'undefined'; }
  function messageAuth(e){
    var c = (e && e.code) || '';
    if(c.indexOf('network') >= 0) return 'Pas de réseau.';
    if(c === 'auth/too-many-requests') return 'Trop d\'essais : réessayez dans quelques minutes.';
    if(c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation')
      return 'Firebase refuse la création automatique du compte. Créez-le à la main : Firebase › Authentication › Ajouter un utilisateur, e-mail ' + DIR_EMAIL + ', mot de passe = le mot de passe de consultation.';
    if(c === 'auth/email-already-in-use')
      return 'Le compte ' + DIR_EMAIL + ' existe déjà avec un autre mot de passe. Supprimez-le dans Firebase › Authentication, puis rouvrez GIVEDIS OS : il sera recréé avec le mot de passe de consultation.';
    if(c === 'permission-denied') return 'Règles Firebase à compléter (voir la note ci-dessous).';
    return (e && e.message) || 'Erreur inconnue.';
  }
  function mots(){
    if(RO && MOTS_LIVE) return MOTS_LIVE;
    return DB.direction || {};
  }

  /* ---------- Côté GIVEDIS OS (Julien) ---------- */
  var DIR = {etat:'', msg:''};          /* compte Direction */
  var LECT = {etat:'', msg:''};         /* lecture des mots */
  var unsubDir = null;

  function empreinte(s){
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode('gos-direction|' + s))
      .then(function(b){ return Array.from(new Uint8Array(b)).map(function(x){ return x.toString(16).padStart(2, '0'); }).join(''); });
  }
  /* Crée le compte Direction, ou aligne son mot de passe sur celui de la consultation. */
  function syncCompte(mdp, ancien){
    if(RO || !firebaseOk() || !mdp) return Promise.resolve();
    var auth = appDir().auth();
    DIR = {etat:'encours', msg:''}; rafraichirSiVisible();
    return PERSIST
      .then(function(){ return auth.signInWithEmailAndPassword(DIR_EMAIL, mdp); })
      .catch(function(){
        return auth.createUserWithEmailAndPassword(DIR_EMAIL, mdp).catch(function(e2){
          if(e2 && e2.code === 'auth/email-already-in-use' && ancien && ancien !== mdp){
            return auth.signInWithEmailAndPassword(DIR_EMAIL, ancien)
              .then(function(cred){ return cred.user.updatePassword(mdp); });
          }
          throw e2;
        });
      })
      .then(function(){ return empreinte(mdp); })
      .then(function(h){ lsSet(CLE_DIR_OK, h); DIR = {etat:'ok', msg:''}; })
      .catch(function(e){ DIR = {etat:'erreur', msg:messageAuth(e)}; })
      .then(function(){ return auth.signOut().catch(function(){}); })
      .then(function(){ rafraichirSiVisible(); });
  }
  window.gosDirectionSync = function(mdp, ancien){ return syncCompte(mdp, ancien); };

  function ecouterDirection(){
    if(unsubDir){ try{ unsubDir(); }catch(e){} unsubDir = null; }
    if(typeof FBS === 'undefined' || !FBS.db || !FBS.user) return;
    LECT = {etat:'connexion', msg:''};
    unsubDir = FBS.db.collection(COLL).onSnapshot(function(snap){
      var m = {};
      snap.docs.forEach(function(d){
        var x = d.data() || {};
        if(x.texte) m[d.id] = {texte:String(x.texte), maj:x.maj || '', auteur:x.auteur || 'Direction'};
      });
      LECT = {etat:'ok', msg:''};
      if(JSON.stringify(m) !== JSON.stringify(DB.direction || {})){
        var neuf = Object.keys(m).some(function(k){ return !(DB.direction || {})[k] || DB.direction[k].texte !== m[k].texte; });
        DB.direction = m; save();
        if(neuf && FBS.premierPassage) toast('Nouveau Mot de la Direction', 'ok');
      }
      rafraichirSiVisible();
    }, function(e){ LECT = {etat:'erreur', msg:messageAuth(e)}; rafraichirSiVisible(); });
    FBS.unsub.push(function(){ if(unsubDir){ try{ unsubDir(); }catch(e){} unsubDir = null; } });
  }

  if(!RO){
    if(typeof window.fbsEcouter === 'function'){
      var ecouterOrig = window.fbsEcouter;
      window.fbsEcouter = function(){ var r = ecouterOrig.apply(this, arguments); ecouterDirection(); return r; };
    }
    if(typeof FBS !== 'undefined' && FBS.user) ecouterDirection();
    /* Compte Direction tenu à jour au démarrage, si le mot de passe de consultation a changé. */
    var mdpLocal = lsGet('gos_ro_mdp');
    if(mdpLocal && firebaseOk()){
      empreinte(mdpLocal).then(function(h){
        if(h !== lsGet(CLE_DIR_OK)) syncCompte(mdpLocal, null);
        else DIR = {etat:'ok', msg:''};
      });
    }
  }

  /* ---------- Côté consultation (le patron) ---------- */
  var MOTS_LIVE = null, RO_DIR = {etat:'off', msg:''}, unsubRo = null, BROUILLON = {};
  function roConnecter(mdp){
    if(!RO || !mdp || !firebaseOk()) return;
    var a = appDir();
    RO_DIR = {etat:'connexion', msg:''}; rafraichirSiVisible();
    PERSIST.then(function(){ return a.auth().signInWithEmailAndPassword(DIR_EMAIL, mdp); })
      .then(function(){
        RO_DIR = {etat:'ok', msg:''};
        if(unsubRo){ try{ unsubRo(); }catch(e){} }
        unsubRo = a.firestore().collection(COLL).onSnapshot(function(snap){
          MOTS_LIVE = {};
          snap.docs.forEach(function(d){
            var x = d.data() || {};
            if(x.texte) MOTS_LIVE[d.id] = {texte:String(x.texte), maj:x.maj || '', auteur:x.auteur || 'Direction'};
          });
          rafraichirSiVisible();
        }, function(e){ RO_DIR = {etat:'erreur', msg:messageAuth(e)}; rafraichirSiVisible(); });
        rafraichirSiVisible();
      })
      .catch(function(e){
        var c = (e && e.code) || '';
        RO_DIR = {etat:'erreur', msg: (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials')
          ? 'L\'écriture n\'est pas encore activée. Julien doit ouvrir GIVEDIS OS une fois sur son poste pour l\'activer.'
          : messageAuth(e)};
        rafraichirSiVisible();
      });
  }
  if(RO){
    window.addEventListener('gos:ro-ouvert', function(e){ roConnecter(e.detail && e.detail.mdp); });
    window.addEventListener('gos:ro-ferme', function(){
      if(unsubRo){ try{ unsubRo(); }catch(x){} unsubRo = null; }
      MOTS_LIVE = null; RO_DIR = {etat:'off', msg:''};
      if(APP) APP.auth().signOut().catch(function(){});
    });
    if(window.GOS_RO_MDP) roConnecter(window.GOS_RO_MDP);
  }

  window.dirBrouillon = function(w, v){ BROUILLON[w] = v; };
  window.dirPublier = function(w){
    if(!RO || RO_DIR.etat !== 'ok'){ toast('Écriture indisponible pour le moment', 'bad'); return; }
    var el = document.getElementById('dirTexte');
    var t = ((el ? el.value : BROUILLON[w]) || '').trim();
    var ref = appDir().firestore().collection(COLL).doc(w);
    var p;
    if(!t){
      if(!mots()[w]){ toast('Le mot est vide', 'bad'); return; }
      if(!confirm('Effacer le Mot de la Direction de cette semaine ?')) return;
      p = ref.delete();
    } else {
      p = ref.set({semaine:w, texte:t, auteur:'Direction', maj:new Date().toISOString()});
    }
    var b = document.getElementById('dirBtn'); if(b){ b.disabled = true; b.textContent = 'Envoi…'; }
    p.then(function(){ delete BROUILLON[w]; toast(t ? 'Mot publié' : 'Mot effacé', 'ok'); if(b) b.blur(); render(); })
     .catch(function(e){ toast('Envoi impossible : ' + messageAuth(e), 'bad'); if(b){ b.disabled = false; b.textContent = 'Publier le mot'; } });
  };

  /* =================== Fiche de réunion : saisie (Julien) =================== */
  function participantsDefaut(){
    return ['Julien'].concat(ACTIFS().map(function(c){ return c.nom; })).join(', ');
  }
  function jourDans(w){
    var b = semaineBornes(w), t = isoLocal(new Date());
    return (t >= b.lun && t <= b.ven) ? t : b.lun;
  }
  window.reuCreer = function(w){
    if(RO || reunionDe(w)) return;
    var date = jourDans(w);
    var jour = new Date(date + 'T12:00:00').getDay();      /* lundi-mardi : on revoit la semaine passée */
    reunions().push({
      id: uid(), semaine: w, date: date, participants: participantsDefaut(),
      sujets: '', compteRendu: '', commentaireChiffres: '',
      semaineRevue: (jour === 1 || jour === 2) ? semaineDecalee(w, -1) : w,
      actions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    save(); toast('Réunion créée', 'ok'); render();
  };
  window.reuMaj = function(w, champ, val, rafraichir){
    if(RO) return;
    var r = reunionDe(w); if(!r) return;
    r[champ] = val; r.updatedAt = new Date().toISOString();
    save();
    if(rafraichir) render();
  };
  function action(w, id){
    var r = reunionDe(w); if(!r) return null;
    return (r.actions || []).find(function(a){ return a.id === id; }) || null;
  }
  window.reuAction = function(w, id, champ, val, rafraichir){
    if(RO) return;
    var a = action(w, id); if(!a) return;
    a[champ] = val;
    var r = reunionDe(w); r.updatedAt = new Date().toISOString();
    save();
    if(rafraichir) render();
  };
  window.reuAjoutAction = function(w){
    if(RO) return;
    var r = reunionDe(w); if(!r) return;
    r.actions = r.actions || [];
    var id = uid();
    r.actions.push({id:id, texte:'', responsable:'', echeance:semaineBornes(semaineDecalee(w, 1)).ven, statut:'afaire'});
    save(); render();
    setTimeout(function(){ var el = document.getElementById('act_' + id); if(el) el.focus(); }, 40);
  };
  window.reuSupprAction = function(w, id){
    if(RO) return;
    var r = reunionDe(w); if(!r) return;
    r.actions = (r.actions || []).filter(function(a){ return a.id !== id; });
    save(); render();
  };
  window.reuReporter = function(w){
    if(RO) return;
    var r = reunionDe(w), p = precedente(w); if(!r || !p) return;
    r.actions = r.actions || [];
    var deja = new Set(r.actions.map(function(a){ return a.reportDe; }).filter(Boolean));
    var n = 0;
    (p.actions || []).filter(function(a){ return a.statut !== 'fait' && a.texte && !deja.has(a.id); }).forEach(function(a){
      r.actions.push({id:uid(), texte:a.texte, responsable:a.responsable || '', echeance:semaineBornes(semaineDecalee(w, 1)).ven,
        statut: a.statut === 'encours' ? 'encours' : 'afaire', reportDe:a.id});
      n++;
    });
    save(); toast(n ? n + ' action' + (n > 1 ? 's reportées' : ' reportée') : 'Rien à reporter', n ? 'ok' : null); render();
  };
  window.reuSupprimer = function(w){
    if(RO) return;
    if(!confirm('Supprimer la fiche de réunion de la ' + semaineLabel(w) + ' ?\nLe Mot de la Direction n\'est pas effacé.')) return;
    DB.reunions = reunions().filter(function(r){ return r.semaine !== w; });
    save(); toast('Fiche supprimée'); render();
  };

  /* =================== Point chiffré (calculé) =================== */
  function pointChiffre(w){
    var mk = weekToMonth(w), aujourd = isoLocal(new Date());
    var lignes = ACTIFS().map(function(c){
      var vs = visitesSemaine(w, c.id);
      var prosp = vs.filter(estVisiteProspection);
      var dev = vs.filter(function(v){ return v.resultat === 'Devis émis' || v.resultat === 'Devis établi'; });
      var cde = vs.filter(function(v){ return ['Commande','Vente','Prise de commande'].indexOf(v.resultat) >= 0; });
      var hebdo = DB.semaines.find(function(s){ return s.commercial === c.id && s.week === w; });
      var st = stats(c.id, mk), ob = objMois(c.id, mk);
      return {
        c: c, rdv: vs.length, prosp: prosp.length,
        potentiel: prosp.reduce(function(s, v){ return s + (+(v.prospection || {}).potentiel || 0); }, 0),
        devisN: dev.length, devisM: dev.reduce(function(s, v){ return s + (+v.montantDevis || 0); }, 0),
        cdeN: cde.length, cdeM: cde.reduce(function(s, v){ return s + (+v.montantCommande || 0); }, 0),
        caSem: hebdo ? +hebdo.ca || 0 : null,
        caMois: st.ca, objMois: suiviSeul(c) ? 0 : (+ob.ca || 0),
        retard: DB.visites.filter(function(v){ return v.commercial === c.id && v.relance && v.relanceDate && v.relanceDate < aujourd; }).length
      };
    });
    var t = lignes.reduce(function(a, l){
      ['rdv','prosp','potentiel','devisN','devisM','cdeN','cdeM','caMois','objMois','retard'].forEach(function(k){ a[k] += l[k]; });
      if(l.caSem != null){ a.caSem = (a.caSem || 0) + l.caSem; }
      return a;
    }, {rdv:0, prosp:0, potentiel:0, devisN:0, devisM:0, cdeN:0, cdeM:0, caSem:null, caMois:0, objMois:0, retard:0});
    return {mk: mk, lignes: lignes, t: t};
  }
  function tableChiffres(w){
    var p = pointChiffre(w);
    var att = function(ca, ob){ if(!ob) return '<span class="tag mute">—</span>'; var a = ca / ob * 100; return '<span class="tag ' + (a >= 100 ? 'ok' : a >= 80 ? 'warn' : 'bad') + '">' + pct(a) + '</span>'; };
    var ligne = function(l, total){
      var s = total ? ' style="font-weight:700"' : '';
      return '<tr>' +
        '<td' + s + '>' + (total ? 'Total' : '<strong>' + esc(l.c.nom) + '</strong>') + '</td>' +
        '<td class="num mono"' + s + '>' + l.rdv + '</td>' +
        '<td class="num mono">' + l.prosp + (l.potentiel ? '<div class="hint">pot. ' + eur(l.potentiel) + '</div>' : '') + '</td>' +
        '<td class="num mono">' + l.devisN + (l.devisM ? '<div class="hint">' + eur(l.devisM) + '</div>' : '') + '</td>' +
        '<td class="num mono">' + l.cdeN + (l.cdeM ? '<div class="hint">' + eur(l.cdeM) + '</div>' : '') + '</td>' +
        '<td class="num mono">' + (l.caSem == null ? '<span class="hint">non saisi</span>' : eur(l.caSem)) + '</td>' +
        '<td class="num mono"' + s + '>' + eur(l.caMois) + '</td>' +
        '<td class="num mono" style="color:var(--ink3)">' + (l.objMois ? eur(l.objMois) : '—') + '</td>' +
        '<td>' + att(l.caMois, l.objMois) + '</td>' +
        '<td class="num mono">' + (l.retard ? '<span class="tag bad">' + l.retard + '</span>' : '0') + '</td></tr>';
    };
    return '<div class="tw"><table>' +
      '<thead><tr><th>Commercial</th><th class="num">RDV</th><th class="num">Prospection</th><th class="num">Devis</th><th class="num">Commandes</th>' +
      '<th class="num">CA semaine</th><th class="num">CA ' + esc(monthLabel(p.mk)) + '</th><th class="num">Objectif</th><th>Atteinte</th><th class="num">Relances en retard</th></tr></thead>' +
      '<tbody>' + p.lignes.map(function(l){ return ligne(l, false); }).join('') + '</tbody>' +
      '<tfoot style="border-top:2px solid var(--line2)">' + ligne(p.t, true) + '</tfoot></table></div>' +
      '<p class="hint" style="margin-top:8px">RDV, devis et commandes : visites saisies du lundi au vendredi (montants pour information, hors CA). CA semaine : écran Saisie hebdo. CA du mois : chiffres officiels ou saisie hebdo, à date.</p>';
  }
  function prospectionSemaine(w){
    var vs = visitesSemaine(w).filter(estVisiteProspection).sort(function(a, b){ return (a.date || '').localeCompare(b.date || ''); });
    if(!vs.length) return '<p class="hint">Aucune visite de prospection sur cette semaine.</p>';
    return '<div class="tw"><table><thead><tr><th>Date</th><th>Commercial</th><th>Prospect</th><th class="num">Potentiel</th><th>Achats · fournisseur</th><th>Prochaine visite</th></tr></thead><tbody>' +
      vs.map(function(v){
        var p = v.prospection || {};
        return '<tr><td class="mono">' + fdate(v.date) + '</td><td>' + esc(whoName(v.commercial)) + '</td>' +
          '<td><strong>' + esc(v.clientNom) + '</strong>' + (v.ville ? '<div class="hint">📍 ' + esc(v.ville) + '</div>' : '') +
          '<div class="hint">' + esc(v.resultat || '') + '</div></td>' +
          '<td class="num mono">' + (p.potentiel ? eur(p.potentiel) : '—') + '</td>' +
          '<td style="max-width:260px">' + (p.achats ? esc(p.achats) : '<span class="hint">—</span>') + (p.fournisseur ? '<div class="hint">chez ' + esc(p.fournisseur) + '</div>' : '') + '</td>' +
          '<td style="max-width:260px;color:var(--ink2)">' + (p.planAction ? esc(p.planAction) : '<span class="hint">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* =================== Affichage =================== */
  function responsables(){
    return ['Julien'].concat(ACTIFS().map(function(c){ return c.nom; })).concat(['Équipe', 'Direction']);
  }
  function selResp(w, a, prev){
    var opts = responsables(); if(a.responsable && opts.indexOf(a.responsable) < 0) opts.push(a.responsable);
    return '<select onchange="reuAction(\'' + w + '\',\'' + a.id + '\',\'responsable\',this.value)">' +
      '<option value="">—</option>' + opts.map(function(o){ return '<option ' + (o === a.responsable ? 'selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
  }
  function selStatut(w, a){
    return '<select onchange="reuAction(\'' + w + '\',\'' + a.id + '\',\'statut\',this.value,true)">' +
      STATUTS.map(function(s){ return '<option value="' + s.v + '" ' + (s.v === (a.statut || 'afaire') ? 'selected' : '') + '>' + s.l + '</option>'; }).join('') + '</select>';
  }
  function tableActions(w, r, edit, vide){
    var as = (r && r.actions) || [];
    if(!as.length) return '<p class="hint">' + vide + '</p>';
    if(!edit){
      return '<div class="tw"><table><thead><tr><th>Action</th><th>Responsable</th><th>Échéance</th><th>Statut</th></tr></thead><tbody>' +
        as.map(function(a){ var s = statut(a.statut);
          return '<tr><td>' + txt(a.texte) + (a.reportDe ? ' <span class="tag mute">reportée</span>' : '') + '</td><td>' + esc(a.responsable || '—') + '</td>' +
            '<td class="mono">' + (a.echeance ? fdate(a.echeance) : '—') + '</td><td><span class="tag ' + s.k + '">' + s.l + '</span></td></tr>'; }).join('') +
        '</tbody></table></div>';
    }
    return '<div class="tw"><table><thead><tr><th style="min-width:280px">Action</th><th>Responsable</th><th>Échéance</th><th>Statut</th><th></th></tr></thead><tbody>' +
      as.map(function(a){
        return '<tr><td><textarea id="act_' + a.id + '" rows="2" style="width:100%;min-height:42px" placeholder="Ce qui doit être fait…" ' +
            'onchange="reuAction(\'' + w + '\',\'' + a.id + '\',\'texte\',this.value)">' + esc(a.texte || '') + '</textarea>' +
            (a.reportDe ? '<span class="tag mute">reportée</span>' : '') + '</td>' +
          '<td>' + selResp(w, a) + '</td>' +
          '<td><input type="date" value="' + esc(a.echeance || '') + '" onchange="reuAction(\'' + w + '\',\'' + a.id + '\',\'echeance\',this.value)"></td>' +
          '<td>' + selStatut(w, a) + '</td>' +
          '<td><button class="btn ghost sm" title="Retirer l\'action" onclick="reuSupprAction(\'' + w + '\',\'' + a.id + '\')">✕</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function carteMot(w){
    var m = mots()[w];
    var quand = m && m.maj ? 'Publié le ' + new Date(m.maj).toLocaleString('fr-FR', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
    var corps;
    if(RO && RO_DIR.etat === 'ok'){
      var val = BROUILLON[w] != null ? BROUILLON[w] : (m ? m.texte : '');
      corps =
        '<textarea id="dirTexte" rows="6" style="width:100%;min-height:130px;font-size:15px;line-height:1.5" placeholder="Votre message à l\'équipe pour cette semaine…" ' +
          'oninput="dirBrouillon(\'' + w + '\', this.value)">' + esc(val) + '</textarea>' +
        '<div class="btnrow" style="margin-top:10px;align-items:center">' +
          '<button class="btn" id="dirBtn" onclick="dirPublier(\'' + w + '\')">' + (m ? 'Mettre à jour le mot' : 'Publier le mot') + '</button>' +
          (quand ? '<span class="hint">' + quand + '</span>' : '') + '</div>';
    } else {
      corps = m
        ? '<div style="font-size:15.5px;line-height:1.6;color:var(--ink);white-space:normal">' + txt(m.texte) + '</div>' +
          (quand ? '<p class="hint" style="margin-top:10px">— ' + esc(m.auteur || 'Direction') + ' · ' + quand + '</p>' : '')
        : '<p class="hint">' + (RO ? '' : 'Le patron n\'a pas encore écrit son mot pour cette semaine. ') + 'Rien pour le moment.</p>';
      if(RO && RO_DIR.etat === 'connexion') corps += '<p class="hint" style="margin-top:8px">Ouverture de l\'écriture…</p>';
      if(RO && RO_DIR.etat === 'erreur') corps += '<div class="note warn" style="margin-top:10px">' + esc(RO_DIR.msg) + '</div>';
    }
    return '<div class="card" style="border-left:4px solid var(--acc);background:linear-gradient(135deg,#fff,var(--panel2))">' +
      '<div class="card-h"><div><div class="eyebrow">' + esc(semaineLabel(w)) + '</div><h3>🖋 Le Mot de la Direction</h3></div>' +
      (RO ? '' : '<span class="tag mute" title="Seul le patron peut écrire ce mot, depuis le lien de consultation">écrit par la Direction</span>') + '</div>' +
      corps + '</div>';
  }

  function noteEtat(){
    if(RO) return '';
    var lignes = [];
    if(!lsGet('gos_ro_mdp'))
      lignes.push('Pour que le patron puisse écrire le Mot de la Direction, définissez d\'abord le mot de passe de consultation (Données › Google Drive).');
    else if(DIR.etat === 'encours') lignes.push('Activation de l\'écriture pour le patron…');
    else if(DIR.etat === 'erreur') lignes.push('Écriture du patron : ' + DIR.msg);
    if(typeof FBS !== 'undefined' && !FBS.user)
      lignes.push('La synchro terrain n\'est pas activée sur ce poste : le Mot de la Direction ne peut pas arriver ici (Données › Synchro terrain).');
    if(LECT.etat === 'erreur')
      lignes.push('Lecture du Mot de la Direction : ' + LECT.msg +
        ' Ajoutez dans Firebase › Firestore › Règles, à l\'intérieur de « match /databases/{database}/documents { … } » :<pre style="white-space:pre-wrap;font-size:12px;margin:8px 0 0;background:var(--bg2);padding:8px;border-radius:8px">' +
        esc("match /direction/{semaine} {\n  allow read: if request.auth != null && request.auth.token.email in ['julien@givedis.app', 'direction@givedis.app'];\n  allow write: if request.auth != null && request.auth.token.email == 'direction@givedis.app';\n}") + '</pre>');
    if(!lignes.length) return '';
    return '<div class="note warn" style="margin-top:12px">' + lignes.map(function(l){ return '<div style="margin:3px 0">' + (l.indexOf('<pre') >= 0 ? l : esc(l)) + '</div>'; }).join('') + '</div>';
  }

  function semainesProposees(w){
    var s = new Set([semaineCourante(), semaineDecalee(semaineCourante(), 1), w]);
    (DB.reunions || []).forEach(function(r){ s.add(r.semaine); });
    Object.keys(mots()).forEach(function(k){ if(/^\d{4}-W\d{2}$/.test(k)) s.add(k); });
    return Array.from(s).sort().reverse();
  }

  VIEWS['pilotage:reunion'] = function(){
    var w = semaineChoisie(), r = reunionDe(w), prev = precedente(w), edit = !RO && !!r;
    var cour = semaineCourante();
    var entete =
      '<div class="card" style="background:linear-gradient(135deg,var(--panel),var(--panel2))">' +
        '<div class="card-h" style="flex-wrap:wrap;gap:10px">' +
          '<div><div class="eyebrow">Réunion hebdomadaire</div><h2 style="font-size:25px;margin:2px 0 0">' + esc(semaineLabel(w)) + '</h2>' +
            (w === cour ? '<span class="tag ok" style="margin-top:6px">semaine en cours</span>' : '') + '</div>' +
          '<div class="btnrow" style="align-items:center">' +
            '<select style="width:auto" onchange="reuChoisir(this.value)">' +
              semainesProposees(w).map(function(x){ var rr = reunionDe(x), mm = mots()[x];
                return '<option value="' + x + '" ' + (x === w ? 'selected' : '') + '>' + esc(semaineLabel(x, true)) + (rr ? ' ✓' : '') + (mm ? ' 🖋' : '') + '</option>'; }).join('') +
            '</select>' +
            '<input type="week" style="width:auto" title="Autre semaine" value="' + w + '" onchange="reuChoisir(this.value)">' +
            (w !== cour ? '<button class="btn ghost sm" onclick="reuChoisir(\'' + cour + '\')">Cette semaine</button>' : '') +
            (r ? '<button class="btn sm" onclick="reuPdf(\'' + w + '\')">Export PDF</button>' : '') +
          '</div>' +
        '</div>' +
        (RO ? '' : '<p class="hint">Chaque modification est enregistrée dès que vous quittez le champ. ✓ = fiche existante · 🖋 = mot de la Direction.</p>') +
        noteEtat() +
      '</div>';

    var html = entete + carteMot(w);

    if(!r){
      html += '<div class="card"><div class="empty"><div class="big">◷</div>' +
        '<p>' + (RO ? 'Pas encore de compte rendu de réunion pour cette semaine.' : 'Aucune fiche de réunion pour cette semaine.') + '</p>' +
        (RO ? '' : '<button class="btn" onclick="reuCreer(\'' + w + '\')">Créer la réunion de cette semaine</button>') +
        '</div></div>';
      if(prev && !RO) html += '<div class="card"><div class="card-h"><h3>Plan d\'action de la dernière réunion</h3><span class="hint">' + esc(semaineLabel(prev.semaine)) + '</span></div>' +
        tableActions(prev.semaine, prev, false, 'Aucune action.') + '</div>';
      return html;
    }

    /* Informations */
    html += '<div class="card"><div class="card-h"><h3>Réunion</h3>' +
      (edit ? '<button class="btn ghost sm danger" onclick="reuSupprimer(\'' + w + '\')">Supprimer la fiche</button>' : '') + '</div>' +
      (edit
        ? '<div class="grid g3">' +
            '<div><label class="f">Date de la réunion</label><input type="date" value="' + esc(r.date || '') + '" onchange="reuMaj(\'' + w + '\',\'date\',this.value)"></div>' +
            '<div style="grid-column:span 2"><label class="f">Participants</label><input value="' + esc(r.participants || '') + '" placeholder="Julien, Clément, Lorris…" onchange="reuMaj(\'' + w + '\',\'participants\',this.value)"></div>' +
          '</div>' +
          '<div style="margin-top:12px"><label class="f">Sujets abordés</label>' +
            '<textarea rows="4" style="width:100%" placeholder="Un sujet par ligne : point marché, nouveau produit, organisation…" onchange="reuMaj(\'' + w + '\',\'sujets\',this.value)">' + esc(r.sujets || '') + '</textarea></div>'
        : '<div class="grid g3"><div><div class="lab">Date</div><div>' + fdate(r.date) + '</div></div>' +
            '<div style="grid-column:span 2"><div class="lab">Participants</div><div>' + txt(r.participants) + '</div></div></div>' +
          '<div style="margin-top:12px"><div class="lab">Sujets abordés</div><div style="margin-top:4px">' + txt(r.sujets) + '</div></div>') +
      '</div>';

    /* Suivi des actions de la réunion précédente */
    if(prev){
      var ouvertes = (prev.actions || []).filter(function(a){ return a.statut !== 'fait' && a.texte; }).length;
      html += '<div class="card"><div class="card-h"><div><div class="eyebrow">' + esc(semaineLabel(prev.semaine)) + '</div><h3>Suivi du plan d\'action précédent</h3></div>' +
        (edit && ouvertes ? '<button class="btn ghost sm" onclick="reuReporter(\'' + w + '\')">Reporter les ' + ouvertes + ' action' + (ouvertes > 1 ? 's' : '') + ' non faite' + (ouvertes > 1 ? 's' : '') + '</button>' : '') + '</div>' +
        (edit ? '<p class="hint" style="margin-bottom:10px">Mettez à jour le statut de chaque action promise la semaine dernière.</p>' : '') +
        tableActions(prev.semaine, prev, edit, 'Aucune action n\'avait été prévue.') + '</div>';
    }

    /* Point chiffré */
    var sr = r.semaineRevue || w;
    var choixRevue = [semaineDecalee(w, -1), w].concat((r.semaineRevue && [semaineDecalee(w, -1), w].indexOf(r.semaineRevue) < 0) ? [r.semaineRevue] : []);
    html += '<div class="card"><div class="card-h"><div><div class="eyebrow">Point chiffré</div><h3>' + esc(semaineLabel(sr)) + '</h3></div>' +
      (edit ? '<select style="width:auto" onchange="reuMaj(\'' + w + '\',\'semaineRevue\',this.value,true)">' +
        choixRevue.map(function(x){ return '<option value="' + x + '" ' + (x === sr ? 'selected' : '') + '>Semaine revue : ' + esc(semaineLabel(x, true)) + '</option>'; }).join('') + '</select>' : '') +
      '</div>' + tableChiffres(sr) +
      (edit
        ? '<div style="margin-top:12px"><label class="f">Commentaire sur les chiffres</label><textarea rows="3" style="width:100%" placeholder="Ce qu\'on retient des chiffres de la semaine…" onchange="reuMaj(\'' + w + '\',\'commentaireChiffres\',this.value)">' + esc(r.commentaireChiffres || '') + '</textarea></div>'
        : (r.commentaireChiffres ? '<div style="margin-top:12px"><div class="lab">Commentaire</div><div style="margin-top:4px">' + txt(r.commentaireChiffres) + '</div></div>' : '')) +
      '</div>';

    /* Prospection de la semaine revue */
    html += '<div class="card"><div class="card-h"><h3>Prospection de la semaine</h3><span class="hint">' + esc(semaineLabel(sr, true)) + '</span></div>' +
      prospectionSemaine(sr) + '</div>';

    /* Compte rendu */
    html += '<div class="card"><div class="card-h"><h3>Compte rendu</h3></div>' +
      (edit
        ? '<textarea rows="8" style="width:100%" placeholder="Ce qui s\'est dit, les décisions prises…" onchange="reuMaj(\'' + w + '\',\'compteRendu\',this.value)">' + esc(r.compteRendu || '') + '</textarea>'
        : '<div style="line-height:1.6">' + txt(r.compteRendu) + '</div>') +
      '</div>';

    /* Plan d'action */
    html += '<div class="card"><div class="card-h"><div><div class="eyebrow">' + esc(semaineLabel(semaineDecalee(w, 1))) + '</div><h3>Plan d\'action pour la semaine prochaine</h3></div>' +
      (edit ? '<button class="btn sm" onclick="reuAjoutAction(\'' + w + '\')">+ Ajouter une action</button>' : '') + '</div>' +
      tableActions(w, r, edit, edit ? 'Aucune action pour le moment. Ajoutez la première.' : 'Aucune action prévue.') + '</div>';

    return html;
  };

  /* =================== Export PDF =================== */
  window.reuPdf = function(w){
    var r = reunionDe(w); if(!r) return;
    if(!window.jspdf){ toast('Bibliothèque PDF non chargée', 'bad'); return; }
    var doc = new window.jspdf.jsPDF();
    var pt = function(x){ return clean(String(x == null ? '' : x).replace(/→/g, '-').replace(/[·•]/g, '-').replace(/[’‘]/g, "'").replace(/[«»“”]/g, '"').replace(/€/g, 'EUR')).replace(/\s+/g, ' ').trim(); };
    pdfHead(doc, 'Reunion hebdomadaire', pt(semaineLabel(w)));
    var y = 42;
    function place(h){ if(y + h > 280){ doc.addPage(); y = 18; } }
    function titre(t){
      place(14);
      doc.setFillColor(31,51,82); doc.rect(14, y - 4.5, 182, 7, 'F');
      doc.setTextColor(255,255,255); doc.setFontSize(10); doc.setFont(undefined, 'bold');
      doc.text(pt(t), 16, y); doc.setFont(undefined, 'normal'); doc.setTextColor(30,30,30);
      y += 8;
    }
    function texte(s, taille){
      /* pt() retire les retours à la ligne et les caractères spéciaux : on découpe d'abord par paragraphe. */
      var t = taille || 9.5, h = t * 0.45;
      doc.setFontSize(t);
      String(s == null || s === '' ? '-' : s).replace(/\r/g, '').split('\n').forEach(function(par){
        var lignes = par.trim() ? doc.splitTextToSize(pt(par), 180) : [''];
        lignes.forEach(function(l){ place(h + 1); doc.text(l, 15, y); y += h; });
      });
      y += 4;
    }
    var texteBrut = texte;
    doc.setFontSize(9); doc.setTextColor(90,90,90);
    doc.text(pt('Date : ' + fdate(r.date) + '   -   Participants : ' + (r.participants || '-')), 14, y); y += 8;
    doc.setTextColor(30,30,30);

    var m = mots()[w];
    titre('Le Mot de la Direction');
    texteBrut(m ? m.texte : 'Pas de mot cette semaine.', 10.5);

    titre('Sujets abordes'); texteBrut(r.sujets);

    var sr = r.semaineRevue || w, p = pointChiffre(sr);
    titre('Point chiffre - ' + semaineLabel(sr));
    var lig = function(l, tot){ return [tot ? 'Total' : pt(l.c.nom), String(l.rdv), String(l.prosp) + (l.potentiel ? ' (' + pt(eur(l.potentiel)) + ')' : ''),
      String(l.devisN), String(l.cdeN), l.caSem == null ? '-' : pt(eur(l.caSem)), pt(eur(l.caMois)), l.objMois ? pt(eur(l.objMois)) : '-',
      l.objMois ? pt(pct(l.caMois / l.objMois * 100)) : '-', String(l.retard)]; };
    doc.autoTable(Object.assign({startY: y, margin:{left:14, right:14},
      head: [['Commercial','RDV','Prospection','Devis','Cdes','CA sem.','CA ' + pt(monthLabel(p.mk)),'Objectif','Atteinte','Relances retard']],
      body: p.lignes.map(function(l){ return lig(l, false); }).concat([lig(p.t, true)])}, TBL, {styles:{fontSize:7.8, cellPadding:2}}));
    y = doc.lastAutoTable.finalY + 6;
    if(r.commentaireChiffres){ texteBrut(r.commentaireChiffres); }

    var vs = visitesSemaine(sr).filter(estVisiteProspection);
    if(vs.length){
      titre('Prospection de la semaine');
      doc.autoTable(Object.assign({startY: y, margin:{left:14, right:14},
        head: [['Date','Commercial','Prospect','Potentiel','Achats / fournisseur','Prochaine visite']],
        body: vs.map(function(v){ var q = v.prospection || {}; return [fdate(v.date), pt(whoName(v.commercial)), pt(v.clientNom + (v.ville ? ' - ' + v.ville : '')),
          q.potentiel ? pt(eur(q.potentiel)) : '-', pt((q.achats || '-') + (q.fournisseur ? ' / ' + q.fournisseur : '')), pt(q.planAction || '-')]; })}, TBL, {styles:{fontSize:7.6, cellPadding:2}}));
      y = doc.lastAutoTable.finalY + 6;
    }

    titre('Compte rendu'); texteBrut(r.compteRendu);

    var prev = precedente(w);
    var tblActions = function(as){
      doc.autoTable(Object.assign({startY: y, margin:{left:14, right:14},
        head: [['Action','Responsable','Echeance','Statut']],
        body: as.map(function(a){ return [pt(a.texte || '-'), pt(a.responsable || '-'), a.echeance ? fdate(a.echeance) : '-', pt(statut(a.statut).l)]; })},
        TBL, {styles:{fontSize:8, cellPadding:2}, columnStyles:{0:{cellWidth:100}}}));
      y = doc.lastAutoTable.finalY + 6;
    };
    if(prev && (prev.actions || []).length){ titre('Suivi du plan d\'action precedent (' + semaineLabel(prev.semaine, true) + ')'); tblActions(prev.actions); }
    titre('Plan d\'action pour la semaine prochaine');
    if((r.actions || []).length) tblActions(r.actions); else texte('Aucune action.');

    var n = doc.getNumberOfPages();
    for(var i = 1; i <= n; i++){ doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(150,150,150); doc.text('GIVEDIS OS - reunion ' + w + ' - page ' + i + ' / ' + n, 196, 290, {align:'right'}); }
    doc.save('givedis-reunion-' + w + '.pdf');
    toast('PDF de la réunion généré', 'ok');
  };

  /* Retour sur l'onglet après un rechargement. */
  try{
    if(SPACE === 'pilotage' && lsGet('gos_tab') === 'reunion'){ TAB = 'reunion'; render(); }
    else renderShell();
  }catch(e){}
})();
