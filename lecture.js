/* =========================================================================
   GIVEDIS OS — Mode « consultation seule » par lien + mot de passe
   -------------------------------------------------------------------------
   Propriétaire : à chaque envoi sur le Drive, l'appli dépose aussi une COPIE
   CHIFFRÉE (AES-256-GCM, clé dérivée du mot de passe par PBKDF2) dans le
   fichier « givedis-os-lecture.json », lisible par toute personne ayant le lien.
   Sans le mot de passe, ce fichier est illisible.
   Le mot de passe n'est jamais envoyé nulle part : il reste dans ce navigateur.

   Consultation : …/givedis-os/?lire=<ID du fichier>&k=<clé d'API Google>
   La personne tape le mot de passe, consulte, et l'appli se met à jour
   toute seule chaque minute. Aucun compte n'est nécessaire.
   À charger APRÈS le script principal : <script src="lecture.js"></script>
   ========================================================================= */
(function(){
  'use strict';

  var params = new URLSearchParams(location.search);
  var RO = params.has('lire');
  var FICHIER_LECTURE = 'givedis-os-lecture.json';
  var CLE_MDP = 'gos_ro_mdp';
  var ITERATIONS = 250000;

  /* ---------------- Chiffrement (commun) ---------------- */
  var enc = new TextEncoder(), dec = new TextDecoder();
  function b64(buf){
    var o = new Uint8Array(buf), s = '', P = 0x8000;
    for(var i = 0; i < o.length; i += P) s += String.fromCharCode.apply(null, o.subarray(i, i + P));
    return btoa(s);
  }
  function deb64(s){
    var b = atob(s), o = new Uint8Array(b.length);
    for(var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i);
    return o;
  }
  function cle(mdp, sel, iter){
    return crypto.subtle.importKey('raw', enc.encode(mdp), 'PBKDF2', false, ['deriveKey'])
      .then(function(base){
        return crypto.subtle.deriveKey({name:'PBKDF2', salt:sel, iterations:iter, hash:'SHA-256'},
          base, {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']);
      });
  }
  function chiffrer(texte, mdp){
    var sel = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    return cle(mdp, sel, ITERATIONS)
      .then(function(k){ return crypto.subtle.encrypt({name:'AES-GCM', iv:iv}, k, enc.encode(texte)); })
      .then(function(c){
        return JSON.stringify({v:1, kdf:'PBKDF2-SHA256', iter:ITERATIONS, sel:b64(sel), iv:b64(iv),
                               data:b64(c), maj:new Date().toISOString()});
      });
  }
  function dechiffrer(paquet, mdp){
    return cle(mdp, deb64(paquet.sel), paquet.iter || ITERATIONS)
      .then(function(k){ return crypto.subtle.decrypt({name:'AES-GCM', iv:deb64(paquet.iv)}, k, deb64(paquet.data)); })
      .then(function(b){ return dec.decode(b); });
  }
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch(e){} }

  /* ======================= CÔTÉ PROPRIÉTAIRE ======================= */
  if(!RO){
    function confLecture(){
      DB.settings.lecture = DB.settings.lecture || {fileId:null, apiKey:'', maj:null};
      return DB.settings.lecture;
    }

    /* Synchro toujours active : relance la session Google pendant le clic qui enregistre */
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

    /* Après chaque envoi sur le Drive, met à jour la copie chiffrée */
    var envoyerOrig = window.gEnvoyer;
    window.gEnvoyer = function(){
      return envoyerOrig.apply(this, arguments).then(function(r){
        return publier(false).catch(function(e){ console.warn('Copie de consultation :', e); }).then(function(){ return r; });
      });
    };

    var enPublication = false;
    function publier(manuel){
      var mdp = lsGet(CLE_MDP);
      if(!mdp){ if(manuel) toast('Définissez d\'abord un mot de passe', 'bad'); return Promise.resolve(); }
      if(!gConnecte()) return Promise.reject(new Error('Non connecté à Google'));
      if(enPublication) return Promise.resolve();
      enPublication = true;
      var conf = confLecture();
      var copie = JSON.parse(JSON.stringify(DB));
      if(copie.settings){ delete copie.settings.google; delete copie.settings.lecture; }
      var entete = {Authorization:'Bearer ' + G.token};

      return chiffrer(JSON.stringify(copie), mdp).then(function(contenu){
        var form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(conf.fileId ? {} : {name:FICHIER_LECTURE, mimeType:'application/json'})], {type:'application/json'}));
        form.append('file', new Blob([contenu], {type:'application/json'}));
        var url = 'https://www.googleapis.com/upload/drive/v3/files' +
                  (conf.fileId ? '/' + conf.fileId : '') + '?uploadType=multipart&fields=id';
        return fetch(url, {method: conf.fileId ? 'PATCH' : 'POST', headers:entete, body:form});
      }).then(function(r){
        if(r.status === 404 && conf.fileId){ conf.fileId = null; throw new Error('Fichier de consultation introuvable, il sera recréé'); }
        if(!r.ok) throw new Error('Envoi de la copie impossible (' + r.status + ')');
        return r.json();
      }).then(function(f){
        var nouveau = !conf.fileId;
        conf.fileId = f.id;
        conf.maj = new Date().toISOString();
        if(!nouveau) return;
        /* Lecture ouverte à toute personne ayant le lien (le contenu reste chiffré) */
        return fetch('https://www.googleapis.com/drive/v3/files/' + f.id + '/permissions', {
          method:'POST', headers:Object.assign({'Content-Type':'application/json'}, entete),
          body: JSON.stringify({role:'reader', type:'anyone'})
        }).then(function(r){
          if(!r.ok) throw new Error('Partage du fichier impossible (' + r.status + ')');
          save();                                   /* garde l'ID du fichier (navigateur + sauvegarde Drive) */
        });
      }).then(function(){
        if(manuel) toast('Copie de consultation publiée', 'ok');
        var c = document.getElementById('roCarte'); if(c) c.outerHTML = carteDePartage();
      }).finally(function(){ enPublication = false; });
    }

    /* --- Carte dans Données › Drive --- */
    var vueDrive = VIEWS['data:drive'];
    if(typeof vueDrive === 'function'){
      VIEWS['data:drive'] = function(){ return vueDrive.apply(this, arguments) + carteDePartage(); };
    }

    function carteDePartage(){
      var conf = confLecture(), gconf = gConf();
      var mdp = !!lsGet(CLE_MDP);
      var lien = conf.fileId && conf.apiKey
        ? location.origin + location.pathname + '?lire=' + encodeURIComponent(conf.fileId) + '&k=' + encodeURIComponent(conf.apiKey)
        : '';
      var etapes = [
        ['Mot de passe', mdp],
        ['Clé d\'API Google', !!conf.apiKey],
        ['Copie publiée', !!conf.fileId],
        ['Synchronisation automatique', !!gconf.auto]
      ].map(function(e){ return '<span class="tag ' + (e[1] ? 'ok' : 'mute') + '" style="margin-right:6px">' + (e[1] ? '✓ ' : '○ ') + e[0] + '</span>'; }).join('');

      return '<div class="card" id="roCarte" style="margin-top:16px">' +
        '<div class="card-h"><h3>Partager en consultation seule</h3></div>' +
        '<p class="hint">La personne ouvre le lien, tape le mot de passe et voit toute l\'appli, sans pouvoir rien modifier. Aucun compte n\'est nécessaire.</p>' +
        '<div style="margin:10px 0">' + etapes + '</div>' +

        '<label class="hint" style="display:block;margin-top:12px">Mot de passe de consultation' + (mdp ? ' (défini sur cet appareil)' : '') + '</label>' +
        '<div style="display:flex;gap:8px;margin:6px 0"><input id="roMdp" type="password" autocomplete="new-password" placeholder="' + (mdp ? '•••••••• — saisir pour changer' : '10 caractères minimum') + '" style="flex:1">' +
        '<button class="btn" onclick="roDefinirMdp()">' + (mdp ? 'Changer' : 'Définir') + '</button></div>' +

        '<label class="hint" style="display:block;margin-top:12px">Clé d\'API Google (Google Cloud › Identifiants)</label>' +
        '<div style="display:flex;gap:8px;margin:6px 0"><input id="roCle" value="' + esc(conf.apiKey || '') + '" placeholder="AIza…" style="flex:1">' +
        '<button class="btn ghost" onclick="roDefinirCle()">Enregistrer</button></div>' +

        '<div class="btnrow" style="margin-top:12px">' +
          '<button class="btn" onclick="roPublier()">Publier maintenant</button>' +
          (gconf.auto ? '' : '<button class="btn ghost" onclick="roActiverAuto()">Activer la synchronisation automatique</button>') +
        '</div>' +
        (conf.maj ? '<p class="hint" style="margin-top:8px">Dernière publication : ' + new Date(conf.maj).toLocaleString('fr-FR') + '</p>' : '') +

        (lien
          ? '<label class="hint" style="display:block;margin-top:12px">Lien à envoyer (le mot de passe, transmettez-le à part : SMS ou téléphone)</label>' +
            '<div style="display:flex;gap:8px;margin:6px 0"><input id="roLien" readonly value="' + esc(lien) + '" style="flex:1" onclick="this.select()">' +
            '<button class="btn" onclick="roCopierLien()">Copier</button></div>'
          : '') +
        (!mdp && conf.fileId ? '<div class="note" style="margin-top:8px">⚠ Mot de passe non défini sur cet appareil : la copie de consultation ne sera pas mise à jour depuis ici. Ressaisissez le même mot de passe.</div>' : '') +
        '<div class="note" style="margin-top:8px">La copie est mise à jour à chaque envoi automatique sur le Drive, quelques secondes après vos modifications. Changer le mot de passe bloque aussitôt l\'accès avec l\'ancien.</div>' +
      '</div>';
    }

    window.roDefinirMdp = function(){
      var v = (document.getElementById('roMdp') || {}).value || '';
      if(v.length < 10){ toast('10 caractères minimum', 'bad'); return; }
      lsSet(CLE_MDP, v);
      toast('Mot de passe enregistré sur cet appareil', 'ok');
      roPublier();
    };
    window.roDefinirCle = function(){
      var v = ((document.getElementById('roCle') || {}).value || '').trim();
      confLecture().apiKey = v; save();
      toast('Clé enregistrée', 'ok'); render();
    };
    window.roPublier = function(){
      var p = gConnecte() ? Promise.resolve() : gConnexion(false);
      p.then(function(){ return publier(true); })
       .catch(function(e){ toast(e.message || 'Connexion Google impossible', 'bad'); render(); });
    };
    window.roActiverAuto = function(){
      gConf().auto = true; save();
      toast('Synchronisation automatique activée', 'ok'); render();
    };
    window.roCopierLien = function(){
      var el = document.getElementById('roLien'); if(!el) return;
      el.select();
      (navigator.clipboard ? navigator.clipboard.writeText(el.value) : Promise.reject())
        .then(function(){ toast('Lien copié', 'ok'); })
        .catch(function(){ document.execCommand('copy'); toast('Lien copié', 'ok'); });
    };
    render();
    return;
  }

  /* ======================= CÔTÉ CONSULTATION ======================= */
  var FILE_ID = params.get('lire');
  var API_KEY = params.get('k') || '';
  var URL_FICHIER = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(FILE_ID);
  var RAFRAICHIR_MS = 60 * 1000;
  var CLE_SESSION = 'gos_ro_session_' + FILE_ID;

  var mdp = null, dernierModif = null, donnees = null;

  /* --- 1. Verrou : rien n'est jamais écrit --- */
  var setItemOrig = Storage.prototype.setItem;
  Storage.prototype.setItem = function(k){ if(k === LS) return; return setItemOrig.apply(this, arguments); };
  var getItemOrig = Storage.prototype.getItem;
  Storage.prototype.getItem = function(k){ if(k === LS) return donnees; return getItemOrig.apply(this, arguments); };

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
  window.save = function(){};

  NAV.performance.tabs = NAV.performance.tabs.filter(function(t){ return t.id !== 'reglages'; });
  NAV.data.tabs = NAV.data.tabs.filter(function(t){ return t.id === 'rapports'; });
  var goOrig = window.go;
  window.go = function(space, tab){
    if(space === 'data' && tab && tab !== 'rapports') return goOrig('pilotage', 'dashboard');
    return goOrig.apply(this, arguments);
  };

  var motif = new RegExp('\\b(' + BLOQUEES.join('|') + ')\\s*\\(');
  function verrouiller(){
    document.querySelectorAll('[onclick],[onchange],[oninput],[onsubmit]').forEach(function(el){
      var code = (el.getAttribute('onclick') || '') + (el.getAttribute('onchange') || '') +
                 (el.getAttribute('oninput') || '') + (el.getAttribute('onsubmit') || '');
      if(!motif.test(code)) return;
      if(el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'LABEL') el.style.display = 'none';
      else el.disabled = true;
    });
    document.querySelectorAll('#main .card').forEach(function(c){
      if(c.style.display === 'none' || c.querySelector('table')) return;
      var bloque = Array.prototype.some.call(c.querySelectorAll('[onclick],[onchange],[oninput]'),
        function(e){ return e.style.display === 'none' || e.disabled; });
      if(bloque) c.style.display = 'none';
    });
    document.querySelectorAll('#main table input, #main table select, #main table textarea, #modalIn input, #modalIn select, #modalIn textarea')
      .forEach(function(el){ if(!el.disabled) el.disabled = true; });
  }
  new MutationObserver(verrouiller).observe(document.body, {childList:true, subtree:true});

  /* Tant que rien n'est déchiffré, on n'affiche aucune donnée locale */
  donnees = null; load();
  if(SPACE === 'data' && TAB !== 'rapports') goOrig('pilotage', 'dashboard'); else render();

  /* --- 2. Bandeau et écran du mot de passe --- */
  var css = document.createElement('style');
  css.textContent =
    '#roBar{position:sticky;top:0;z-index:999;display:flex;align-items:center;gap:10px;flex-wrap:wrap;' +
    'padding:8px 16px;background:#1e5fb8;color:#fff;font:600 13px/1.3 system-ui,sans-serif}' +
    '#roBar .sp{flex:1}#roBar button{background:#fff;color:#1e5fb8;border:0;border-radius:6px;padding:5px 10px;font-weight:600;cursor:pointer}' +
    '#roVoile{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(6,14,30,.94);padding:16px}' +
    '#roVoile form{background:#fff;color:#14213d;max-width:400px;width:100%;border-radius:14px;padding:24px;text-align:center;font:15px/1.5 system-ui,sans-serif}' +
    '#roVoile h2{margin:0 0 6px;font-size:20px}#roVoile p{margin:0 0 16px;color:#4a5568}' +
    '#roVoile input[type=password]{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e0;border-radius:8px;font-size:15px;margin-bottom:10px;color:#14213d;background:#fff}' +
    '#roVoile label{display:flex;gap:6px;align-items:center;justify-content:center;font-size:13px;color:#4a5568;margin-bottom:14px}' +
    '#roVoile button{background:#1e5fb8;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600;font-size:15px;cursor:pointer;width:100%}' +
    '#roVoile button:disabled{opacity:.6}' +
    '#roVoile .err{color:#c53030;margin-top:12px;font-size:13px;min-height:1em}';
  document.head.appendChild(css);

  var barre = document.createElement('div');
  barre.id = 'roBar';
  barre.innerHTML = '<span>👁 Consultation seule</span><span class="sp"></span><span id="roMaj"></span>' +
                    '<button id="roBtn" type="button">Actualiser</button><button id="roQuit" type="button">Verrouiller</button>';
  document.body.insertBefore(barre, document.body.firstChild);
  document.getElementById('roBtn').onclick = function(){ rafraichir(true); };
  document.getElementById('roQuit').onclick = function(){
    try{ sessionStorage.removeItem(CLE_SESSION); localStorage.removeItem(CLE_SESSION); }catch(e){}
    location.reload();
  };

  var voile = document.createElement('div');
  voile.id = 'roVoile';
  voile.innerHTML = '<form autocomplete="on"><h2>GIVEDIS OS</h2><p>Accès en consultation seule</p>' +
    '<input type="password" id="roMdp" placeholder="Mot de passe" autocomplete="current-password" required>' +
    '<label><input type="checkbox" id="roSouv"> Se souvenir sur cet appareil</label>' +
    '<button type="submit" id="roOk">Consulter</button><div class="err" id="roErr"></div></form>';
  document.body.appendChild(voile);
  voile.querySelector('form').onsubmit = function(e){
    e.preventDefault();
    var v = document.getElementById('roMdp').value;
    if(!v) return;
    ouvrir(v, document.getElementById('roSouv').checked);
  };

  function erreur(msg){
    voile.style.display = 'flex';
    document.getElementById('roErr').textContent = msg;
    document.getElementById('roOk').disabled = false;
    document.getElementById('roOk').textContent = 'Consulter';
  }
  function majBandeau(){
    var el = document.getElementById('roMaj'); if(!el || !dernierModif) return;
    var d = new Date(dernierModif);
    el.textContent = 'Données du ' + d.toLocaleDateString('fr-FR') + ' à ' +
      d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  }

  if(!FILE_ID || !API_KEY){ erreur('Lien de consultation incomplet. Demandez un nouveau lien.'); document.getElementById('roOk').disabled = true; return; }

  /* --- 3. Lecture du fichier chiffré --- */
  function lire(suffixe){
    return fetch(URL_FICHIER + suffixe + '&key=' + encodeURIComponent(API_KEY), {cache:'no-store'})
      .then(function(r){
        if(r.status === 404) throw new Error('Données introuvables : le lien n\'est plus valable.');
        if(r.status === 403 || r.status === 400) throw new Error('Accès refusé par Google (clé d\'API ou partage du fichier).');
        if(!r.ok) throw new Error('Lecture impossible (' + r.status + ').');
        return r;
      });
  }
  function telecharger(){
    return Promise.all([
      lire('?fields=modifiedTime').then(function(r){ return r.json(); }),
      lire('?alt=media').then(function(r){ return r.json(); })
    ]);
  }
  function appliquer(meta, txt){
    JSON.parse(txt);
    var premier = !dernierModif;
    donnees = txt;
    dernierModif = meta.modifiedTime;
    load();
    if(SPACE === 'data' && TAB !== 'rapports') goOrig('pilotage', 'dashboard'); else render();
    majBandeau();
    if(!premier) toast('Données mises à jour', 'ok');
  }

  function ouvrir(motDePasse, souvenir){
    var b = document.getElementById('roOk'); b.disabled = true; b.textContent = 'Ouverture…';
    document.getElementById('roErr').textContent = '';
    telecharger().then(function(res){
      return dechiffrer(res[1], motDePasse)
        .catch(function(){ throw new Error('Mot de passe incorrect.'); })
        .then(function(txt){
          mdp = motDePasse;
          try{
            sessionStorage.setItem(CLE_SESSION, motDePasse);
            if(souvenir) localStorage.setItem(CLE_SESSION, motDePasse);
          }catch(e){}
          appliquer(res[0], txt);
          voile.style.display = 'none';
        });
    }).catch(function(e){
      try{ sessionStorage.removeItem(CLE_SESSION); localStorage.removeItem(CLE_SESSION); }catch(x){}
      erreur(e.message);
    });
  }

  var enCours = false;
  function rafraichir(force){
    if(!mdp || enCours) return;
    enCours = true;
    lire('?fields=modifiedTime').then(function(r){ return r.json(); }).then(function(meta){
      if(!force && meta.modifiedTime === dernierModif) return;
      return lire('?alt=media').then(function(r){ return r.json(); }).then(function(paquet){
        return dechiffrer(paquet, mdp).then(function(txt){ appliquer(meta, txt); }, function(){
          /* le mot de passe a été changé par le propriétaire */
          mdp = null;
          try{ sessionStorage.removeItem(CLE_SESSION); localStorage.removeItem(CLE_SESSION); }catch(e){}
          donnees = null; load(); render();
          erreur('Le mot de passe a changé. Saisissez le nouveau.');
        });
      });
    }).catch(function(e){ toast(e.message, 'bad'); })
      .then(function(){ enCours = false; });
  }

  setInterval(function(){ if(!document.hidden) rafraichir(false); }, RAFRAICHIR_MS);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) rafraichir(false); });

  /* Ouverture automatique si le mot de passe est mémorisé */
  var memo = null;
  try{ memo = sessionStorage.getItem(CLE_SESSION) || localStorage.getItem(CLE_SESSION); }catch(e){}
  if(memo) ouvrir(memo, false);
  else setTimeout(function(){ var i = document.getElementById('roMdp'); if(i) i.focus(); }, 100);
})();
