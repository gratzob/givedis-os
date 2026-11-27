/* =========================================================================
   GIVEDIS OS — Synchronisation Drive dans les deux sens
   -------------------------------------------------------------------------
   Avant : chaque appareil ENVOYAIT sa copie complète sur le Drive, sans
   jamais récupérer celle des autres. Le dernier qui envoyait écrasait tout.

   Maintenant :
   • Chaque appareil retient (dans son navigateur) la version du fichier
     Drive qu'il a déjà intégrée.
   • Toutes les minutes et au retour sur l'onglet, il regarde si le Drive a
     changé depuis. Si oui :
       – rien en attente d'envoi ici → il reprend la version du Drive telle
         quelle (modifications et suppressions comprises) ;
       – des modifications en attente ici → fusion prudente par identifiant :
         tout ce qui est ici est gardé, ce qui manque est ajouté, chaque
         réunion garde sa version la plus récente. Les règles de prime ne sont
         pas touchées ; les montants des visites ne touchent pas au CA.
   • Avant chaque envoi, il vérifie que le Drive n'a pas été modifié par un
     autre appareil entretemps ; sinon il fusionne d'abord. Il n'écrase plus
     jamais le travail de l'autre appareil.
   • Première fois sur un appareil : toujours une fusion (jamais de remplacement).
   Les réglages Google et de consultation restent propres à chaque appareil.
   À charger en dernier (après sauvegarde.js).
   ========================================================================= */
(function(){
  'use strict';
  if(window.GOS_RO) return;
  if(typeof gEnvoyer !== 'function' || typeof gConf !== 'function'){ console.warn('sync-drive.js : Drive introuvable'); return; }

  var CLE_VU = 'gos_drive_vu';
  var vu = function(){ try{ return localStorage.getItem(CLE_VU) || ''; }catch(e){ return ''; } };
  var setVu = function(t){ try{ if(t) localStorage.setItem(CLE_VU, t); }catch(e){} };
  var conf = function(){ return (DB && DB.settings && DB.settings.google) || null; };
  var actif = function(){ var c = conf(); return !!(c && c.auto && c.fileId && gOrigineValide() && gConnecte()); };

  function meta(){
    var c = conf();
    return fetch('https://www.googleapis.com/drive/v3/files/' + c.fileId + '?fields=id,modifiedTime,trashed',
      {headers: {Authorization: 'Bearer ' + G.token}})
      .then(function(r){ if(!r.ok) throw new Error('Drive (' + r.status + ')'); return r.json(); });
  }
  function telecharger(){
    var c = conf();
    return fetch('https://www.googleapis.com/drive/v3/files/' + c.fileId + '?alt=media',
      {headers: {Authorization: 'Bearer ' + G.token}})
      .then(function(r){ if(!r.ok) throw new Error('Téléchargement Drive (' + r.status + ')'); return r.json(); });
  }
  function valide(d){ return d && d.schema && Array.isArray(d.clients) && Array.isArray(d.commerciaux); }
  function viderCaches(){
    try{ if(window.HIST && HIST.vider) HIST.vider(); }catch(e){}
    try{ VIS_CA_IDX = null; }catch(e){}
  }
  function saisieEnCours(){
    var el = document.activeElement;
    return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
      (el.tagName === 'INPUT' && !/^(button|submit|checkbox|radio|file)$/.test(el.type || '')));
  }
  function modalOuverte(){ var m = document.getElementById('modal'); return !!(m && m.classList.contains('on')); }

  /* Reprend la version du Drive (rien d'autre en attente ici). */
  function adopter(data, t){
    var g = conf(), lecture = DB.settings && DB.settings.lecture;
    DB = data;
    DB.settings = DB.settings || {};
    DB.settings.google = g;
    if(lecture) DB.settings.lecture = lecture; else delete DB.settings.lecture;
    try{ localStorage.setItem(LS, JSON.stringify(DB)); }catch(e){}
    setVu(t);
    viderCaches();
    if(!modalOuverte()) render();
    toast('Données mises à jour depuis le Drive (autre appareil)', 'ok');
  }

  /* Fusion prudente, par identifiant : tout ce qui est ici est gardé tel quel ; ce qui n'existe
     qu'en face est ajouté ; chaque réunion garde sa version la plus récente. Les montants des
     visites ne touchent jamais au CA des clients. Les règles de prime d'ici ne bougent pas. */
  var copie = function(x){ return JSON.parse(JSON.stringify(x)); };
  function completer(loc, dist, n){        /* ajoute les clés absentes ici, récursivement */
    Object.keys(dist || {}).forEach(function(k){
      var a = loc[k], b = dist[k];
      if(a === undefined){ loc[k] = copie(b); n.autres++; }
      else if(a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) completer(a, b, n);
    });
  }
  function fusion(R){
    var n = {clients:0, visites:0, semaines:0, rdvs:0, reunions:0, autres:0};
    var remap = {};
    /* commerciaux */
    (R.commerciaux || []).forEach(function(c){
      if(c && c.id && !DB.commerciaux.some(function(x){ return x.id === c.id; })){ DB.commerciaux.push(copie(c)); n.autres++; }
    });
    /* clients : même identifiant, sinon même nom chez le même commercial */
    var parId = {}; DB.clients.forEach(function(c){ parId[c.id] = c; });
    var parNom = {}; DB.clients.forEach(function(c){ parNom[(c.nomKey || normKey(c.nom)) + '|' + c.commercial] = c; });
    (R.clients || []).forEach(function(c){
      if(!c || !c.id) return;
      var ici = parId[c.id] || parNom[(c.nomKey || normKey(c.nom)) + '|' + c.commercial];
      if(!ici){ var x = copie(c); DB.clients.push(x); parId[x.id] = x; n.clients++; return; }
      if(ici.id !== c.id) remap[c.id] = ici.id;
      ['caByMonth', 'margeByMonth'].forEach(function(f){
        if(!c[f]) return; ici[f] = ici[f] || {};
        Object.keys(c[f]).forEach(function(m){ if(ici[f][m] === undefined){ ici[f][m] = c[f][m]; n.autres++; } });
      });
      ['reseau','dept','dateOuverture','premiereCommande','margeDefaut'].forEach(function(f){
        if((ici[f] === undefined || ici[f] === null || ici[f] === '') && c[f] != null && c[f] !== '') ici[f] = c[f];
      });
    });
    /* listes à identifiant */
    [['visites','visites'], ['semaines','semaines'], ['rdvs','rdvs']].forEach(function(t){
      var cle = t[0]; DB[cle] = DB[cle] || [];
      var ids = {}; DB[cle].forEach(function(x){ if(x && x.id) ids[x.id] = 1; if(x && x.fsId) ids['fs:' + x.fsId] = 1; });
      (R[cle] || []).forEach(function(x){
        if(!x || !x.id || ids[x.id] || (x.fsId && ids['fs:' + x.fsId])) return;
        var y = copie(x); if(y.clientId && remap[y.clientId]) y.clientId = remap[y.clientId];
        DB[cle].push(y); ids[y.id] = 1; n[t[1]]++;
      });
    });
    /* réunions : la plus récente gagne */
    DB.reunions = DB.reunions || [];
    (R.reunions || []).forEach(function(r){
      if(!r || !r.semaine) return;
      var i = DB.reunions.findIndex(function(x){ return x.semaine === r.semaine; });
      if(i < 0){ DB.reunions.push(copie(r)); n.reunions++; }
      else if(String(r.updatedAt || '') > String(DB.reunions[i].updatedAt || '')){ DB.reunions[i] = copie(r); n.reunions++; }
    });
    /* le reste : on complète sans rien écraser */
    ['officiels','objectifs','portefeuilles','comptesRendus','direction','historique'].forEach(function(k){
      if(R[k] && typeof R[k] === 'object'){ DB[k] = DB[k] || {}; completer(DB[k], R[k], n); }
    });
    if(R.settings){
      var st = {}; Object.keys(R.settings).forEach(function(k){ if(k !== 'google' && k !== 'lecture') st[k] = R.settings[k]; });
      DB.settings = DB.settings || {}; completer(DB.settings, st, n);
    }
    return n;
  }
  var sansReglages = function(x){ var s = x.settings; var y = {}; Object.keys(x).forEach(function(k){ y[k] = x[k]; });
    if(s){ y.settings = {}; Object.keys(s).forEach(function(k){ if(k !== 'google' && k !== 'lecture') y.settings[k] = s[k]; }); } return JSON.stringify(y); };
  function fusionner(data, t){
    var n = fusion(data);
    /* Ce qui est ici et manque au Drive (ex. une réunion plus récente ici) doit repartir. */
    var aEnvoyer = sansReglages(DB) !== sansReglages(data);
    setVu(t);
    viderCaches();
    var l = [];
    if(n.reunions) l.push(n.reunions + ' réunion' + (n.reunions > 1 ? 's' : ''));
    if(n.visites) l.push(n.visites + ' visite' + (n.visites > 1 ? 's' : ''));
    if(n.clients) l.push(n.clients + ' client' + (n.clients > 1 ? 's' : ''));
    if(n.semaines) l.push(n.semaines + ' saisie' + (n.semaines > 1 ? 's' : ''));
    if(n.rdvs) l.push(n.rdvs + ' RDV');
    if(n.autres) l.push(n.autres + ' autre' + (n.autres > 1 ? 's' : '') + ' élément' + (n.autres > 1 ? 's' : ''));
    if(l.length){
      save();                                    /* repartira sur le Drive avec tout */
      if(!modalOuverte() && !saisieEnCours()) render();
      toast('Ajouté depuis le Drive (autre appareil) : ' + l.join(', '), 'ok');
    } else if(aEnvoyer && !gEnAttente()) save();
    return n;
  }

  /* Intègre la version du Drive si elle a changé depuis la dernière fois. */
  var enCours = null;
  function integrer(forcerFusion){
    if(enCours) return enCours;
    enCours = meta().then(function(m){
      if(!m || m.trashed || !m.modifiedTime || m.modifiedTime === vu()) return false;
      return telecharger().then(function(data){
        if(!valide(data)) throw new Error('Fichier Drive illisible');
        if(!vu() || forcerFusion || gEnAttente()) fusionner(data, m.modifiedTime);
        else adopter(data, m.modifiedTime);
        return true;
      });
    }).finally(function(){ enCours = null; });
    return enCours;
  }

  /* Vérification régulière (onglet visible, pas pendant une saisie ni un envoi). */
  function verifier(){
    if(document.hidden || !actif() || G.busy || saisieEnCours()) return;
    integrer(false).catch(function(e){ console.warn('Synchro Drive :', e.message); });
  }
  setInterval(verifier, 60 * 1000);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) setTimeout(verifier, 800); });
  window.addEventListener('focus', function(){ setTimeout(verifier, 800); });
  /* Première vérification dès que la connexion Google est là. */
  var essais = 0, depart = setInterval(function(){
    if(actif()){ clearInterval(depart); verifier(); }
    else if(++essais > 120) clearInterval(depart);
  }, 2000);

  /* Avant chaque envoi : intégrer ce qu'un autre appareil aurait mis entretemps.
     Après : retenir la version envoyée. */
  var envoyerOrig = window.gEnvoyer;
  window.gEnvoyer = function(){
    var self = this, args = arguments;
    if(!actif() || G.busy) return envoyerOrig.apply(self, args);
    return integrer(true)
      .catch(function(e){ console.warn('Synchro Drive avant envoi :', e.message); })
      .then(function(){ return envoyerOrig.apply(self, args); })
      .then(function(r){
        return meta().then(function(m){ if(m && m.modifiedTime) setVu(m.modifiedTime); return r; })
          .catch(function(){ return r; });
      });
  };

  window.GOS_SYNC = {verifier: verifier, integrer: integrer, vu: vu};
})();
