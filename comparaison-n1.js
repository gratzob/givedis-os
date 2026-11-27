/* =====================================================================
   GIVEDIS OS — Comparaison N / N-1 par client
   À charger APRÈS analyse-v2.js : ajoute une section en bas de l'onglet
   Pilotage → Analyse.
   • Un « client » regroupe les fiches de même nom (ex. client passé du
     magasin à un itinérant).
   • Quand un commercial n'a pas le détail client de l'année N-1 (fichier
     compta non importé), ses clients sont marqués « Pas de détail N-1 »
     au lieu d'apparaître comme nouveaux. La section se complète seule dès
     que le fichier est importé.
   • Lecture seule : ce module n'enregistre rien.
   ===================================================================== */
(function(){
  if(typeof VIEWS === 'undefined' || typeof VIEWS['pilotage:analyse'] !== 'function'){
    console.warn('comparaison-n1.js : vue Analyse introuvable'); return;
  }

  const N1 = {mode:'cumul', com:'', statut:'', q:'', tri:'ecart', sens:1};
  window.N1 = N1;
  window.n1Set = (k, v) => { if(k === 'tri'){ N1.sens = N1.tri === v ? -N1.sens : 1; } N1[k] = v; render();
    setTimeout(() => document.getElementById('n1Sec')?.scrollIntoView({block:'start'}), 40); };

  /* ---------- Outils ---------- */
  const addM = (mk, n) => { let [y,m] = mk.split('-').map(Number); m += n;
    while(m < 1){ m += 12; y--; } while(m > 12){ m -= 12; y++; }
    return y + '-' + String(m).padStart(2,'0'); };
  const rangeM = (a, b) => { const r = []; let m = a; while(m <= b){ r.push(m); m = addM(m,1); } return r; };
  const sum = a => a.reduce((s,x) => s + (+x||0), 0);
  const sgn = n => (n > 0 ? '+' : '');
  const js = v => esc(JSON.stringify(String(v)));

  /* ---------- Périodes ---------- */
  function periodes(fin){
    const y = fin.slice(0,4);
    const N = N1.mode === 'mois' ? [fin] : N1.mode === 'glissant' ? rangeM(addM(fin,-11), fin)
      : N1.mode === 'annee' ? rangeM(y + '-01', y + '-12') : rangeM(y + '-01', fin);
    const P = N.map(m => addM(m,-12));
    const lib = l => l.length === 1 ? monthLabel(l[0]) : monthLabel(l[0]) + ' → ' + monthLabel(l[l.length-1]);
    return {N, P, libN: lib(N), libP: lib(P), yN: y, yP: String(+y - 1)};
  }

  /* ---------- Détail client disponible en N-1, par commercial ---------- */
  const histA = y => !!(window.HIST && HIST.a(y));
  const liste = () => window.HIST ? DB.clients.concat(HIST.virtuelles()) : DB.clients;
  const estMagC = id => typeof equipeDe === 'function' && equipeDe(comObj(id)) === 'magasin';
  function couverture(P, yP){
    const out = {}, hist = histA(yP);
    DB.commerciaux.forEach(co => {
      const off = sum(P.map(m => { try{ return stats(co.id, m).ca; }catch(e){ return 0; } }));
      const det = sum(DB.clients.filter(c => commercialDe(c, yP) === co.id).map(c => sum(P.map(m => caClientMois(c, m)))));
      out[co.id] = {off, det, taux: off > 0 ? det / off * 100 : null, manque: !hist && off > 0 && det < 0.5 * off, hist};
    });
    return out;
  }

  /* ---------- Regroupement des fiches en clients ---------- */
  function clients(per){
    const L = liste(), byId = {}, par = {};
    L.forEach(c => { byId[c.id] = c; par[c.id] = c.id; });
    const find = x => { while(par[x] !== x){ par[x] = par[par[x]]; x = par[x]; } return x; };
    const union = (a, b) => { if(byId[a] && byId[b]){ const ra = find(a), rb = find(b); if(ra !== rb) par[rb] = ra; } };
    const parNom = {};
    L.forEach(c => { const k = c.nomKey || normKey(c.nom); (parNom[k] = parNom[k] || []).push(c.id); });
    Object.values(parNom).forEach(l => l.slice(1).forEach(id => union(l[0], id)));
    const grp = {};
    L.forEach(c => { const r = find(c.id); (grp[r] = grp[r] || []).push(c); });
    const cov = couverture(per.P, per.yP);
    const out = [];
    Object.values(grp).forEach(fiches => {
      const f = fiches.map(c => ({c, n: sum(per.N.map(m => caClientMois(c, m))), p: sum(per.P.map(m => caClientMois(c, m)))}));
      const caN = sum(f.map(x => x.n)), caP = sum(f.map(x => x.p));
      if(!caN && !caP) return;
      const reel = f.filter(x => !x.c.__hist);
      let main = (reel.length ? reel : f).slice().sort((a, b) => (b.n - a.n) || (b.p - a.p))[0].c;
      /* même propriétaire que le tableau de bord et l'Analyse (règle magasin) */
      if(reel.length && window.HIST && HIST.actif()){ const pr = HIST.proprio(reel[0].c, per.yN); if(pr && !pr.__hist) main = pr; }
      const com = main.__hist ? '' : (commercialDe(main, per.yN) || main.commercial);
      /* N-1 incomplet si une fiche active en N appartient (en N-1) à un commercial sans détail client */
      const incomplet = !histA(per.yP) && f.some(x => x.n > 0 && !x.c.__hist && (cov[commercialDe(x.c, per.yP)] || {}).manque);
      /* client du magasin en N-1, passé chez un itinérant en N */
      const exMag = !!com && !estMagC(com) && reel.some(x => x.p > 0 && estMagC(commercialDe(x.c, per.yP)));
      let statut;
      if(!caP && incomplet) statut = 'sansdetail';
      else if(!caP) statut = 'nouveau';
      else if(!caN) statut = 'perdu';
      else { const v = (caN - caP) / caP * 100; statut = v > 5 ? 'hausse' : v < -5 ? 'baisse' : 'stable'; }
      const actives = reel.filter(x => x.n || x.p);
      out.push({id: main.id, nom: main.nom, com, exMag, sansFiche: !reel.length, codes: (f.find(x => x.c.__hist) || {c:{}}).c.codes || [],
        fiches: actives.map(x => x.c), caN, caP, ecart: caN - caP,
        var: caP > 0 ? (caN - caP) / caP * 100 : null, statut, incomplet: incomplet && caP > 0, fusion: actives.length > 1,
        coms: (() => {   /* commercial(aux) en N-1 → en N */
          const de = [...new Set(reel.filter(x => x.p).map(x => whoName(commercialDe(x.c, per.yP))))];
          const a = [...new Set(reel.filter(x => x.n).map(x => whoName(commercialDe(x.c, per.yN))))];
          if(!de.length && !a.length) return ['sans fiche'];
          if(!de.length) return [a.join(' + ')];
          if(!a.length || de.join() === a.join()) return [de.join(' + ')];
          return [de.join(' + '), a.join(' + ')];
        })()});
    });
    return {rows: out, cov};
  }

  /* Ligne « Tout GIVEDIS » : N-1 du fichier global, N = somme des commerciaux (ou fichier global N s'il existe). */
  function totalGivedis(per){
    if(N1.com || !histA(per.yP)) return '';
    const H = HIST.annee(per.yP), mo = m => +(((H.mois || {})[m.slice(5,7)] || {}).ca || 0);
    const p = sum(per.P.map(mo));
    const n = histA(per.yN) ? sum(per.N.map(m => +(((HIST.annee(per.yN).mois || {})[m.slice(5,7)] || {}).ca || 0)))
      : sum(per.N.map(m => sum(DB.commerciaux.map(c => { try{ return stats(c.id, m).ca; }catch(e){ return 0; } }))));
    return `<tfoot><tr><td><strong>Tout GIVEDIS</strong></td><td class="num"><strong>${eur(p)}</strong></td><td class="num"><strong>${eur(n)}</strong></td>
      <td>${vTag(p > 0 ? (n - p) / p * 100 : null)}</td><td><span class="hint">${per.yP} : fichier global · ${per.yN} : ${histA(per.yN) ? 'fichier global' : 'chiffres des commerciaux'}</span></td></tr></tfoot>`;
  }

  /* ---------- Rendu ---------- */
  const LBL = {hausse:'En hausse', baisse:'En baisse', stable:'Stable', nouveau:'Nouveau', perdu:'Perdu', sansdetail:'Pas de détail N-1'};
  const CLS = {hausse:'ok', baisse:'bad', stable:'info', nouveau:'mute', perdu:'bad', sansdetail:'warn'};
  const tagS = s => `<span class="tag ${CLS[s]}">${LBL[s]}</span>`;
  const vTag = v => v === null ? '<span class="tag mute">—</span>' : `<span class="tag ${v > 5 ? 'ok' : v < -5 ? 'bad' : 'info'}">${sgn(v)}${pct(v)}</span>`;

  function section(){
    const fin = (window.AN2 && AN2.S && AN2.S.mk) || null;
    if(!fin) return '';
    const per = periodes(fin);
    const {rows, cov} = clients(per);
    window.__N1_LAST = {per, rows};
    const vis = rows.filter(r => !N1.com || r.com === N1.com);
    const comparables = vis.filter(r => r.statut !== 'sansdetail');
    const tN = sum(comparables.map(r => r.caN)), tP = sum(comparables.map(r => r.caP));
    const nb = s => vis.filter(r => r.statut === s).length;
    const liste = vis.filter(r => !N1.statut || r.statut === N1.statut)
      .filter(r => !N1.q || normKey(r.nom).includes(normKey(N1.q)));
    const key = {client: r => normKey(r.nom), com: r => whoName(r.com), p: r => r.caP, n: r => r.caN, ecart: r => r.ecart, var: r => r.var ?? -1e9}[N1.tri] || (r => r.ecart);
    liste.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * N1.sens; });
    window.__N1_LISTE = liste;
    const th = (k, t, cls) => `<th class="${cls||''}" style="cursor:pointer;white-space:nowrap" onclick="n1Set('tri',${js(k)})">${t}${N1.tri===k?(N1.sens>0?' ▲':' ▼'):''}</th>`;
    const comsActifs = DB.commerciaux.filter(c => c.actif !== false);
    const manque = comsActifs.filter(c => cov[c.id] && cov[c.id].manque);

    return `
    <div class="card" id="n1Sec" style="margin-top:16px">
      <div class="card-h" style="flex-wrap:wrap;gap:10px"><div>
        <h3 style="margin:0">📅 Comparaison N / N-1 par client</h3>
        <p class="hint" style="margin:4px 0 0">${per.libN} comparé à ${per.libP} · mois de fin : celui choisi en haut de l'onglet</p></div>
        <div class="btnrow" style="gap:8px;flex-wrap:wrap;align-items:center">
          <select style="width:auto" onchange="n1Set('mode',this.value)">
            <option value="cumul" ${N1.mode==='cumul'?'selected':''}>Cumul depuis janvier</option>
            <option value="glissant" ${N1.mode==='glissant'?'selected':''}>12 mois glissants</option>
            <option value="mois" ${N1.mode==='mois'?'selected':''}>Mois seul</option>
            <option value="annee" ${N1.mode==='annee'?'selected':''}>Année complète</option></select>
          <select style="width:auto" onchange="n1Set('com',this.value)"><option value="">Toute l'équipe</option>
            ${comsActifs.map(c => `<option value="${esc(c.id)}" ${N1.com===c.id?'selected':''}>${esc(c.nom)}</option>`).join('')}</select>
          <button class="btn sm" onclick="n1Export()">⬇ Excel</button>
        </div></div>

      <div class="tw" style="margin-bottom:12px"><table><thead><tr><th>Commercial</th><th class="num">${per.yP} (chiffres du mois)</th><th class="num">${per.yN}</th><th>Évolution</th><th>Détail client ${per.yP}</th></tr></thead><tbody>
        ${comsActifs.filter(c => !N1.com || c.id === N1.com).map(c => { const v = cov[c.id] || {}; const n = sum(per.N.map(m => { try{ return stats(c.id, m).ca; }catch(e){ return 0; } }));
          return `<tr><td>${esc(c.nom)}</td><td class="num">${eur(v.off)}</td><td class="num">${eur(n)}</td><td>${vTag(v.off > 0 ? (n - v.off) / v.off * 100 : null)}</td>
          <td>${v.hist ? '<span class="tag ok" title="Données › Historique compta">fichier global</span>' : v.taux === null ? '<span class="hint">—</span>' : v.manque ? `<span class="tag warn">manquant (${pct(v.taux)})</span>` : v.taux < 95 ? `<span class="tag info">partiel (${pct(v.taux)})</span>` : '<span class="tag ok">complet</span>'}</td></tr>`; }).join('')}
      </tbody>${totalGivedis(per)}</table></div>
      ${manque.length ? `<p class="note warn">Détail client ${per.yP} manquant pour ${manque.map(c => esc(c.nom)).join(' et ')} : leurs clients sans fiche ${per.yP} sont marqués « Pas de détail N-1 » et exclus des totaux ci-dessous. Importe le fichier compta ${per.yP} pour compléter : la section se mettra à jour seule.</p>` : ''}

      <div class="grid g-auto" style="margin:12px 0;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        <div class="kpi info"><div class="lab">Clients comparables</div><div class="val">${comparables.length}</div><div class="sub">${eur(tP)} → ${eur(tN)} · ${vTag(tP ? (tN - tP) / tP * 100 : null)}</div></div>
        ${['hausse','baisse','stable','nouveau','perdu','sansdetail'].map(s => `<div class="kpi ${CLS[s]==='ok'?'ok':CLS[s]==='bad'?'bad':'info'}" style="cursor:pointer;${N1.statut===s?'outline:2px solid var(--accent,#4d9bff)':''}" onclick="n1Set('statut', N1.statut===${js(s)}?'':${js(s)})">
          <div class="lab">${LBL[s]}</div><div class="val">${nb(s)}</div><div class="sub">${eur(sum(vis.filter(r => r.statut === s).map(r => r.ecart)))}</div></div>`).join('')}
      </div>

      <div class="card-h" style="flex-wrap:wrap;gap:8px;padding:0;margin-bottom:8px"><span class="hint">${liste.length} client${liste.length>1?'s':''}${N1.statut ? ' · filtre : ' + LBL[N1.statut] + ' <a href="#" onclick="n1Set(\'statut\',\'\');return false">(retirer)</a>' : ''}</span>
        <input placeholder="Rechercher un client…" value="${esc(N1.q)}" style="width:200px" onchange="n1Set('q',this.value)"></div>
      <div class="tw" style="max-height:560px;overflow:auto"><table><thead><tr>
        ${th('client','Client')}${N1.com ? '' : th('com','Commercial')}${th('p', per.yP, 'num')}${th('n', per.yN, 'num')}${th('ecart','Écart','num')}${th('var','Var.')}<th>Statut</th></tr></thead><tbody>
        ${liste.length ? liste.slice(0,500).map(r => `<tr>
          <td>${esc(r.nom)}${r.exMag ? ' <span class="tag info" title="Client du magasin en ' + per.yP + ', chez ' + esc(whoName(r.com)) + ' en ' + per.yN + '">ex-magasin</span>' : ''}${r.sansFiche ? ' <span class="tag mute" title="Présent seulement dans le fichier compta global ' + esc(r.codes.join(', ')) + '">sans fiche</span>' : ''}${r.fusion ? ` <span class="tag mute" title="${esc(r.fiches.map(c => c.nom + ' (' + whoName(c.commercial) + ')').join(' + '))}">${r.fiches.length} fiches</span>` : ''}${r.incomplet ? ' <span class="tag warn" title="Une partie du N-1 peut manquer">N-1 partiel</span>' : ''}</td>
          ${N1.com ? '' : `<td>${esc(r.coms.join(' → '))}</td>`}
          <td class="num">${eur(r.caP)}</td><td class="num">${eur(r.caN)}</td>
          <td class="num" style="color:var(${r.ecart>=0?'--ok':'--bad'},inherit);font-weight:600">${sgn(r.ecart)}${eur(r.ecart)}</td>
          <td>${vTag(r.var)}</td><td>${tagS(r.statut)}</td></tr>`).join('')
          : `<tr><td colspan="7" class="hint" style="text-align:center;padding:14px">Aucun client</td></tr>`}
      </tbody></table></div>
      ${liste.length > 500 ? `<p class="hint">500 premiers affichés sur ${liste.length} : l'export Excel contient tout.</p>` : ''}
      <p class="hint" style="margin-bottom:0">Les fiches de même nom sont additionnées (client passé du magasin à un itinérant).${histA(per.yP) ? ' ' + per.yP + ' : chiffre complet de chaque client, issu du fichier compta global (Données › Historique compta). « ex-magasin » : client du magasin en ' + per.yP + ', passé chez un itinérant.' : ''}${N1.mode === 'annee' ? ' Année complète : ' + per.yN + ' est en cours, ses derniers mois ne sont pas finis.' : ''}</p>
    </div>`;
  }

  /* ---------- Export Excel (liste filtrée) ---------- */
  window.n1Export = () => {
    const a = window.__N1_LAST, l = window.__N1_LISTE; if(!a || !l) return;
    const data = l.map(r => ({
      'Client': r.nom, 'Commercial': r.coms.join(' → '), 'Fiches': r.fiches.map(c => c.nom).join(' + '),
      ['CA ' + a.per.yP]: Math.round(r.caP), ['CA ' + a.per.yN]: Math.round(r.caN), 'Écart €': Math.round(r.ecart),
      'Variation %': r.var === null ? '' : Math.round(r.var * 10) / 10, 'Statut': LBL[r.statut],
      'Remarque': [r.incomplet ? 'N-1 partiel' : '', r.exMag ? 'ex-magasin' : '', r.sansFiche ? 'sans fiche (fichier global)' : ''].filter(Boolean).join(', '),
      'Code(s) compta': r.codes.join(', ')}));
    const nom = 'comparaison-' + a.per.yN + '-' + a.per.yP + '-' + a.per.N[a.per.N.length-1] + '.xlsx';
    if(typeof XLSX === 'undefined'){ toast('Export Excel indisponible', 'bad'); return; }
    const ws = XLSX.utils.json_to_sheet(data), wb = XLSX.utils.book_new();
    ws['!cols'] = [{wch:38},{wch:20},{wch:50},{wch:12},{wch:12},{wch:12},{wch:11},{wch:18},{wch:28},{wch:16}];
    XLSX.utils.book_append_sheet(wb, ws, 'N vs N-1');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Période ' + a.per.yN, a.per.libN], ['Période ' + a.per.yP, a.per.libP],
      ['Note', 'Fiches de même nom additionnées. « Pas de détail N-1 » : détail client de l\'année précédente non importé pour ce commercial.']]), 'Infos');
    XLSX.writeFile(wb, nom);
  };

  /* ---------- Greffe sur la vue Analyse ---------- */
  const base = VIEWS['pilotage:analyse'];
  VIEWS['pilotage:analyse'] = () => { const h = base(); let s = ''; try{ s = section(); }catch(e){ console.error(e); s = `<div class="card" style="margin-top:16px"><p class="hint">Comparaison N / N-1 indisponible : ${esc(e.message)}</p></div>`; } return h + s; };
  window.N1.section = section; window.N1.clients = clients; window.N1.periodes = periodes;
})();
