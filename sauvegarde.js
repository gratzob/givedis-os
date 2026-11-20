/* =========================================================================
   GIVEDIS OS — « Tout est sur le Drive »
   -------------------------------------------------------------------------
   Même système qu'avant (navigateur + fichier givedis-os.json sur le Drive),
   avec ce qui manquait pour que rien ne reste en route :
   1. Les textes longs des réunions s'enregistrent pendant la frappe, sans
      attendre qu'on quitte le champ.
   2. Quand la connexion Google a expiré, elle est renouvelée au premier clic
      ou à la première touche, et les modifications en attente partent aussitôt.
      Elle est aussi renouvelée un peu AVANT d'expirer.
   3. En quittant l'onglet ou la page, le champ en cours est enregistré et
      l'envoi en attente part tout de suite.
   4. Un voyant permanent dit si le Drive est à jour.
   À charger en dernier (après lecture.js, reunion.js, portefeuilles.js).
   ========================================================================= */
(function(){
  'use strict';
  if(window.GOS_RO) return;                       /* mode consultation : rien à envoyer */

  function conf(){ return (typeof DB !== 'undefined' && DB && DB.settings && DB.settings.google) || null; }
  function actif(){ var c = conf(); return !!(c && c.auto && gOrigineValide()); }
  function heure(iso){
    try{ return new Date(iso).toLocaleString('fr-FR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}); }
    catch(e){ return ''; }
  }

  /* ---------------- Voyant ---------------- */
  var css = document.createElement('style');
  css.textContent =
    '#gosSync{position:fixed;left:14px;bottom:14px;z-index:900;cursor:pointer;font-size:12px;' +
    'box-shadow:0 4px 14px rgba(0,0,0,.12);border-radius:999px;user-select:none}' +
    '#gosSync .tag{padding:6px 12px;font-size:12px;white-space:nowrap}' +
    '@media print{#gosSync{display:none}}';
  document.head.appendChild(css);
  var voyant = document.createElement('div');
  voyant.id = 'gosSync';
  document.body.appendChild(voyant);

  function etat(){
    var c = conf();
    if(!gOrigineValide()) return null;
    if(!c) return ['warn', '⚠️ Drive pas encore configuré', 'Cliquez pour connecter le Drive'];
    if(!c.auto) return gEnAttente() ? ['warn', '⚠️ Envoi automatique Drive désactivé', 'Réglages Google Drive'] : null;
    if(G.busy) return ['info', '⏳ Envoi sur le Drive…', ''];
    if(G.err && gEnAttente()) return ['bad', '⚠️ Drive : ' + G.err, 'Cliquez pour réessayer'];
    if(gEnAttente()){
      return gConnecte()
        ? ['info', '⏳ Modifications en attente d\'envoi', '']
        : ['warn', '⚠️ Drive non connecté · modifications en attente', 'Cliquez pour reconnecter et envoyer'];
    }
    if(!c.fileId && !c.last) return ['warn', '⚠️ Drive pas encore configuré', 'Cliquez pour connecter le Drive'];
    return ['ok', '☁️ Drive à jour' + (c.last ? ' · ' + heure(c.last) : ''), 'Tout est enregistré sur le Drive'];
  }
  window.gIndicateur = function(){
    var e = etat();
    if(!e){ voyant.style.display = 'none'; return; }
    voyant.style.display = '';
    voyant.title = e[2] || '';
    voyant.innerHTML = '<span class="tag ' + e[0] + '">' + esc(e[1]) + '</span>';
    var g = document.getElementById('gEtat'); if(g) g.innerHTML = gBadge();
  };
  voyant.addEventListener('click', function(){
    var c = conf();
    if(!c || !c.auto || !c.fileId){ go('data', 'drive'); return; }
    if(gConnecte()){ G.err = null; gAuto(0); return; }
    renouveler(true);
  });

  /* ---------------- Renouvellement de la connexion ----------------
     Google n'ouvre sa fenêtre que pendant un geste de l'utilisateur :
     on profite donc du premier clic / de la première touche. */
  var derniereTentative = 0;
  function renouveler(force){
    if(!actif() || !G.pret || !G.tokenClient) return;
    var c = conf(); if(!c.fileId) return;            /* jamais connecté sur ce poste : écran Drive */
    if(!force && Date.now() - derniereTentative < 90 * 1000) return;
    derniereTentative = Date.now();
    var p;
    if(gConnecte()){
      /* encore valide mais bientôt périmé : on en demande un neuf sans attendre */
      p = new Promise(function(ok, ko){
        G.resolve = ok; G.reject = ko;
        try{ G.tokenClient.requestAccessToken({prompt:''}); }catch(e){ G.resolve = G.reject = null; ko(e); }
      });
    } else {
      p = gConnexion(true);
    }
    p.then(function(){ G.err = null; if(gEnAttente()) gAuto(0); gIndicateur(); })
     .catch(function(){ gIndicateur(); });
  }
  function surGeste(){
    if(!actif()) return;
    var bientot = !!G.token && Date.now() > G.expire - 8 * 60 * 1000;   /* moins de ~10 min restantes */
    if(gConnecte() && !bientot){
      if(gEnAttente() && !G.busy && !gTimer) gAuto();
      return;
    }
    if(gEnAttente() || bientot) renouveler(false);
  }
  document.addEventListener('pointerdown', surGeste, true);
  document.addEventListener('keydown', surGeste, true);

  /* ---------------- Enregistrement pendant la frappe ----------------
     Les champs de la réunion hebdomadaire n'enregistraient qu'en quittant
     le champ : un compte rendu tapé puis la page fermée était perdu. */
  var FRAPPE = /^\s*(reuMaj|reuAction)\(/;
  var minuteurs = new WeakMap();
  document.addEventListener('input', function(ev){
    var el = ev.target;
    if(!el || !(el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|)$/.test(el.type || '')))) return;
    var h = el.getAttribute('onchange') || '';
    if(!FRAPPE.test(h) || /,\s*true\s*\)\s*;?\s*$/.test(h)) return;   /* jamais ceux qui redessinent l'écran */
    clearTimeout(minuteurs.get(el));
    minuteurs.set(el, setTimeout(function(){
      if(document.body.contains(el)) el.dispatchEvent(new Event('change'));
    }, 1200));
  }, true);

  /* ---------------- En quittant l'onglet ou la page ---------------- */
  function vider(){
    var el = document.activeElement;
    var texte = el && (el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && /^(text|search|number|email|tel|url|)$/.test(el.type || '')));
    if(texte && el.getAttribute('onchange')){
      try{ el.dispatchEvent(new Event('change')); }catch(e){}
    }
    if(gEnAttente() && gConnecte() && actif()){
      clearTimeout(gTimer); gTimer = null;
      gEnvoyer().catch(function(){});
    }
  }
  document.addEventListener('visibilitychange', function(){
    if(document.hidden) vider();
    else surRetour();
  });
  window.addEventListener('pagehide', vider);

  function surRetour(){
    gIndicateur();
    if(gEnAttente() && gConnecte() && actif() && !G.busy) gAuto(500);
  }

  /* ---------------- Démarrage ---------------- */
  /* Bibliothèques Google chargées d'avance : le premier clic suffit pour reconnecter. */
  if(actif() && conf().fileId){ gPreparer().then(gIndicateur).catch(gIndicateur); }
  /* Le voyant se tient à jour (heure du dernier envoi, expiration). */
  setInterval(gIndicateur, 30 * 1000);
  gIndicateur();
})();
