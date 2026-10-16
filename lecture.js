/* =========================================================================
   GIVEDIS OS — Mode « consultation seule »
   -------------------------------------------------------------------------
   Lien de consultation : …/givedis-os/?lecture=<ID du fichier Drive>&c=<ID client OAuth>
   - La personne se connecte avec SON compte Google, en lecture seule
     (scope drive.readonly) : Google interdit toute écriture sur le fichier.
   - Les données sont relues sur le Drive toutes les minutes et à chaque retour
     sur l'onglet : la consultation reste à jour.
   - Côté propriétaire (sans ?lecture), ajoute une carte « Partager en
     consultation seule » à l'écran Données › Drive, et relance la connexion
     Google au besoin pour que la synchro automatique ne s'arrête pas.
   À charger APRÈS le script principal : <script src="lecture.js"></script>
   ========================================================================= */
(function(){
  'use strict';

  var params = new URLSearchParams(location.search);
  var RO = params.has('lecture');

  /* ======================= CÔTÉ PROPRIÉTAIRE ======================= */
  if(!RO){
    /* 1. Synchro toujours active : si la sauvegarde auto est activée mais que la
          session Google a expiré, on la relance pendant le clic qui enregistre. */
    var saveOrig = window.save;
    window.save = function(){
      var r = saveOrig.apply(this, arguments);
      try{
        var conf = DB.settings && DB.settings.google;
        if(conf && conf.auto && !gConnecte() && gOrigineValide()){
          gConnexion(true).then(function(){ gAuto(); }).catch(function(){});
        }
      }catch(e){}
      return r;
    };

    /* 2. Carte de partage dans Données › Drive */
    var vueDrive = VIEWS['data:drive'];
    if(typeof vueDrive === 'function'){
      VIEWS['data:drive'] = function(){ return vueDrive.apply(this, arguments) + carteDePartage(); };
    }

    window.roActiverAuto = function(){
      var conf = gConf(); conf.auto = true;
      save(); toast('Synchronisation automatique activée', 'ok'); render();
    };
    window.roCopierLien = function(){
      var el = document.getElementById('roLien'); if(!el) return;
      el.select();
      (navigator.clipboard ? navigator.clipboard.writeText(el.value) : Promise.reject())
        .then(function(){ toast('Lien copié', 'ok'); })
        .catch(function(){ document.execCommand('copy'); toast('Lien copié', 'ok'); });
    };
    render();                                  /* réaffiche avec la carte (et l'écran Drive, défini après le démarrage) */
    return;
  }

  function carteDePartage(){
    var conf = gConf();
    var base = location.origin + location.pathname;
    var lien = conf.fileId
      ? base + '?lecture=' + encodeURIComponent(conf.fileId) + '&c=' + encodeURIComponent(gClientId())
      : '';
    return '<div class="card" style="margin-top:16px">' +
      '<div class="card-h"><h3>Partager en consultation seule</h3></div>' +
      (lien
        ? '<p class="hint">La personne qui ouvre ce lien voit toute l\'appli, sans pouvoir rien modifier. Elle se connecte avec son compte Google, qui doit avoir accès au fichier <b>' + esc(GFILE) + '</b> en tant que <b>Lecteur</b>.</p>' +
          '<div style="display:flex;gap:8px;margin:10px 0"><input id="roLien" readonly value="' + esc(lien) + '" style="flex:1" onclick="this.select()">' +
          '<button class="btn" onclick="roCopierLien()">Copier</button></div>'
        : '<p class="hint">Connectez-vous et faites une première sauvegarde sur le Drive pour obtenir le lien.</p>') +
      (conf.auto
        ? '<div class="note">Synchronisation automatique active : chaque modification est envoyée sur le Drive quelques secondes après, et la consultation la récupère dans la minute.</div>'
        : '<div class="note">⚠ La synchronisation automatique est désactivée : la consultation ne montrera que la dernière sauvegarde manuelle. <button class="btn ghost" onclick="roActiverAuto()">Activer</button></div>') +
      '<div class="note" style="margin-top:8px">Pour donner l\'accès : dans Google Drive, partagez le fichier <b>' + esc(GFILE) + '</b> avec l\'adresse Gmail de la personne (rôle Lecteur). Dans Google Cloud, ajoutez cette adresse aux utilisateurs test et le champ d\'application <code>drive.readonly</code> à l\'écran de consentement.</div>' +
    '</div>';
  }

  /* ======================= CÔTÉ CONSULTATION ======================= */
  var FILE_ID = params.get('lecture');
  var CLIENT_ID = params.get('c') || (typeof gClientId === 'function' ? gClientId() : '');
  var SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
  var API = 'https://www.googleapis.com/drive/v3/files/';
  var RAFRAICHIR_MS = 60 * 1000;

  var jeton = null, expire = 0, client = null, dernierModif = null, dernierCharge = null, donnees = null;

  /* --- 1. Verrou : rien n'est jamais écrit, ni dans le navigateur ni sur le Drive --- */
  var setItemOrig = Storage.prototype.setItem;
  Storage.prototype.setItem = function(k){ if(k === LS) return; return setItemOrig.apply(this, arguments); };
  var getItemOrig = Storage.prototype.getItem;
  Storage.prototype.getItem = function(k){
    if(k === LS) return donnees;               /* les données viennent du Drive, pas du navigateur */
    return getItemOrig.apply(this, arguments);
  };

  var BLOQUEES = ['saveNewClient','addClientModal','delClient','delVisite','closeRelance',
    'saveObjAnnuels','copierObjectifs','saveObjMensuels','saveSemaine','delSemaine','saveConfRdv',
    'saveOfficiels','addNouveauClient','saveNouveaux','savePrimeRules','addCritere','delCritere',
    'savePrimeRulesSilent','rentaToggle','rentaTout','rentaDefaut','saveTauxMarge','saveRenta',
    'runImport','importPastedJson','importJsonFile','importPasted2','importXlsx','importCsv','ingestVisites','ingestJson',
    'restoreAll','wipe','addCom','saveComs','delCom','readLogo','removeLogo','toggleLogoBg',
    'chargerCompta','comptaMaj','comptaRetirer','comptaVider','validerCompta',
    'gSeConnecter','gSauvegarder','gRestaurer','gDeconnecter','gMajReglages','gEnvoyer','gAuto','gPreparer','gConnexion'];
  var avertiA = 0;
  BLOQUEES.forEach(function(n){
    if(typeof window[n] !== 'function') return;
    window[n] = function(){
      if(Date.now() - avertiA > 1500){ avertiA = Date.now(); toast('Consultation seule : modification impossible', 'bad'); }
      return Promise.resolve();
    };
  });
  window.save = function(){};                  /* silencieux : certaines vues l'appellent en s'affichant */

  /* Navigation : on retire les écrans de saisie, d'import et de réglages */
  NAV.performance.tabs = NAV.performance.tabs.filter(function(t){ return t.id !== 'reglages'; });
  NAV.data.tabs = NAV.data.tabs.filter(function(t){ return t.id === 'rapports'; });
  var goOrig = window.go;
  window.go = function(space, tab){
    if(space === 'data' && tab && tab !== 'rapports') return goOrig('pilotage', 'dashboard');
    return goOrig.apply(this, arguments);
  };
  if(SPACE === 'data' && TAB !== 'rapports') goOrig('pilotage', 'dashboard'); else render();

  /* Masque les boutons et désactive les champs qui déclenchent une modification */
  var motif = new RegExp('\\b(' + BLOQUEES.join('|') + ')\\s*\\(');
  function verrouiller(racine){
    (racine || document).querySelectorAll('[onclick],[onchange],[oninput],[onsubmit]').forEach(function(el){
      var code = (el.getAttribute('onclick') || '') + (el.getAttribute('onchange') || '') +
                 (el.getAttribute('oninput') || '') + (el.getAttribute('onsubmit') || '');
      if(!motif.test(code)) return;
      if(el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'LABEL') el.style.display = 'none';
      else el.disabled = true;
    });
    /* Un formulaire de saisie (carte sans tableau dont le bouton a été retiré) disparaît entièrement */
    document.querySelectorAll('#main .card').forEach(function(c){
      if(c.style.display === 'none' || c.querySelector('table')) return;
      var bloque = Array.prototype.some.call(c.querySelectorAll('[onclick],[onchange],[oninput]'),
        function(e){ return e.style.display === 'none' || e.disabled; });
      if(bloque) c.style.display = 'none';
    });
    /* Les champs dans les tableaux et les fiches (fenêtre modale) servent à la saisie : figés */
    document.querySelectorAll('#main table input, #main table select, #main table textarea, #modalIn input, #modalIn select, #modalIn textarea')
      .forEach(function(el){ if(!el.disabled) el.disabled = true; });
  }
  new MutationObserver(function(){ verrouiller(); }).observe(document.body, {childList:true, subtree:true});

  /* --- 2. Bandeau et écran de connexion --- */
  var css = document.createElement('style');
  css.textContent =
    '#roBar{position:sticky;top:0;z-index:999;display:flex;align-items:center;gap:10px;flex-wrap:wrap;' +
    'padding:8px 16px;background:#1e5fb8;color:#fff;font:600 13px/1.3 system-ui,sans-serif}' +
    '#roBar .sp{flex:1}#roBar button{background:#fff;color:#1e5fb8;border:0;border-radius:6px;padding:5px 10px;font-weight:600;cursor:pointer}' +
    '#roVoile{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(10,20,40,.72);padding:16px}' +
    '#roVoile .bx{background:#fff;color:#14213d;max-width:420px;width:100%;border-radius:14px;padding:24px;text-align:center;font:15px/1.5 system-ui,sans-serif}' +
    '#roVoile h2{margin:0 0 8px;font-size:20px}#roVoile p{margin:0 0 16px;color:#4a5568}' +
    '#roVoile button{background:#1e5fb8;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600;font-size:15px;cursor:pointer}' +
    '#roVoile .err{color:#c53030;margin-top:12px;font-size:13px}';
  document.head.appendChild(css);

  var barre = document.createElement('div');
  barre.id = 'roBar';
  barre.innerHTML = '<span>👁 Consultation seule</span><span class="sp"></span><span id="roMaj"></span>' +
                    '<button id="roBtn" type="button">Actualiser</button>';
  document.body.insertBefore(barre, document.body.firstChild);
  document.getElementById('roBtn').onclick = function(){ connecte() ? rafraichir(true) : demanderJeton(); };

  var voile = document.createElement('div');
  voile.id = 'roVoile';
  voile.innerHTML = '<div class="bx"><h2>GIVEDIS OS</h2><p>Accès en consultation seule. Connectez-vous avec le compte Google auquel le fichier a été partagé.</p>' +
                    '<button id="roCnx" type="button">Se connecter avec Google</button><div class="err" id="roErr"></div></div>';
  document.body.appendChild(voile);
  document.getElementById('roCnx').onclick = demanderJeton;

  function erreur(msg){
    voile.style.display = 'flex';
    document.getElementById('roErr').textContent = msg;
  }
  function majBandeau(){
    var el = document.getElementById('roMaj'); if(!el) return;
    if(!dernierModif){ el.textContent = ''; return; }
    var d = new Date(dernierModif);
    el.textContent = 'Données du ' + d.toLocaleDateString('fr-FR') + ' à ' +
      d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
    document.getElementById('roBtn').textContent = connecte() ? 'Actualiser' : 'Reconnecter';
  }

  if(!FILE_ID || !CLIENT_ID){ erreur('Lien de consultation incomplet. Demandez un nouveau lien.'); return; }

  /* --- 3. Connexion Google en lecture seule --- */
  function connecte(){ return !!jeton && Date.now() < expire; }

  function chargerGis(){
    if(window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise(function(ok, ko){
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = ok; s.onerror = function(){ ko(new Error('Bibliothèque Google inaccessible.')); };
      document.head.appendChild(s);
    });
  }
  var pret = chargerGis().then(function(){
    client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: function(rep){
        if(rep.error){ erreur('Connexion refusée (' + rep.error + ').'); return; }
        jeton = rep.access_token;
        expire = Date.now() + (rep.expires_in - 60) * 1000;
        rafraichir(true);
      },
      error_callback: function(e){ erreur('Connexion interrompue' + (e && e.type ? ' (' + e.type + ')' : '') + '.'); }
    });
  }).catch(function(e){ erreur(e.message); });

  function demanderJeton(){
    if(!client){ pret.then(function(){ if(client) client.requestAccessToken(); }); return; }
    client.requestAccessToken();
  }

  /* --- 4. Lecture du fichier et rafraîchissement --- */
  function appel(suffixe){
    return fetch(API + encodeURIComponent(FILE_ID) + suffixe, {headers:{Authorization:'Bearer ' + jeton}})
      .then(function(r){
        if(r.status === 401){ jeton = null; throw new Error('Session Google expirée : cliquez sur Reconnecter.'); }
        if(r.status === 403 || r.status === 404) throw new Error("Ce compte Google n'a pas accès au fichier. Demandez à ce qu'il vous soit partagé en tant que Lecteur.");
        if(!r.ok) throw new Error('Lecture impossible (' + r.status + ').');
        return r;
      });
  }

  var enCours = false;
  function rafraichir(force){
    if(!connecte() || enCours) { majBandeau(); return; }
    enCours = true;
    appel('?fields=modifiedTime&supportsAllDrives=true').then(function(r){ return r.json(); })
      .then(function(meta){
        if(!force && meta.modifiedTime === dernierModif) return;
        return appel('?alt=media&supportsAllDrives=true').then(function(r){ return r.text(); }).then(function(txt){
          JSON.parse(txt);                       /* vérifie le contenu avant de l'afficher */
          donnees = txt;
          var premier = !dernierModif;
          dernierModif = meta.modifiedTime;
          dernierCharge = Date.now();
          load();
          if(premier && SPACE === 'data' && TAB !== 'rapports'){ goOrig('pilotage', 'dashboard'); }
          else render();
          voile.style.display = 'none';
          if(!premier) toast('Données mises à jour', 'ok');
        });
      })
      .catch(function(e){ if(!dernierModif) erreur(e.message); else toast(e.message, 'bad'); })
      .then(function(){ enCours = false; majBandeau(); });
  }

  setInterval(function(){ if(!document.hidden) rafraichir(false); }, RAFRAICHIR_MS);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) rafraichir(false); });
})();
