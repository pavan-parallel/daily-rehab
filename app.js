(() => {
  'use strict';
  const data = window.REHAB_DATA;
  const catalog = data.catalog;
  const sessions = catalog.sessions;
  const library = Object.fromEntries(data.exercises.map(e => [e.id, e]));
  const sources = Object.fromEntries(data.sources.map(s => [s.id, s]));
  const support = Object.fromEntries((catalog.support_movements || []).map(m => [m.id, m]));
  const media = Object.fromEntries((Array.isArray(data.media) ? data.media : data.media?.assets || []).map(m => [m.id, m]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = () => 'Complete plan';
  const areaLabel = value => ({trunk:'Back & trunk',achilles:'Achilles',ankle:'Ankle',shoulder_press:'Shoulder · press',shoulder_pull:'Shoulder · pull',shoulder_control:'Shoulder · control'}[value] || value.charAt(0).toUpperCase() + value.slice(1));
  const shortFocus = {'upper-a':'Horizontal press, pull & shoulder control','lower-a':'Squat, hinge & straight-knee calf','upper-b':'Inclined press, vertical pull & rotation','lower-b':'Single-leg strength, calf & hip range','upper-c':'Press, unilateral pull & rotation','lower-c':'Lateral movement, posterior chain & trunk'};
  const freshState = (sessionId = 'upper-a') => ({sessionId,baseDose:'established',areaOverrides:{},slotOverrides:{}});
  const getSession = id => sessions.find(s => s.id === id) || sessions[0];
  const getSlot = id => sessions.flatMap(s => s.slots).find(s => s.id === id);
  const secondsLabel = seconds => seconds >= 60 ? `${Math.floor(seconds / 60)}${seconds % 60 ? ':' + String(seconds % 60).padStart(2,'0') : ''} min` : `${seconds} sec`;
  const roundedMinutes = seconds => Math.ceil(seconds / 300) * 5;
  const approximate = seconds => `About ${roundedMinutes(seconds)} min`;
  function normalizeState(candidate) {
    const result = clone(candidate);
    for (const [id, override] of Object.entries(result.slotOverrides)) {
      Object.keys(override).forEach(key => {if (override[key] == null || override[key] === '' || (key === 'omitted' && override[key] === false)) delete override[key];});
      if (override.optionId === getSlot(id)?.default_option_id) delete override.optionId;
      if (!Object.keys(override).length) delete result.slotOverrides[id];
    }
    return result;
  }
  function parseRoute(hash, currentId = 'upper-a') {
    const id = String(hash || '').replace(/^#/, '');
    if (id === 'session') return {sessionId:getSession(currentId).id,anchor:true,unknown:false};
    if (!id) return {sessionId:sessions[0].id,anchor:false,unknown:false};
    if (sessions.some(s => s.id === id)) return {sessionId:id,anchor:false,unknown:false};
    return {sessionId:sessions[0].id,anchor:false,unknown:true};
  }
  function resolveSlot(slot, state) {
    const override = state.slotOverrides[slot.id] || {};
    const optionId = override.optionId || slot.default_option_id;
    if (!slot.option_ids.includes(optionId)) throw new Error(`Invalid option for ${slot.id}`);
    const exercise = library[optionId];
    if (!exercise) throw new Error(`Missing exercise ${optionId}`);
    const dose = override.dose || state.areaOverrides[slot.owner_area] || state.baseDose;
    const effortDose = override.effortDose || dose;
    if (!['reentry','established'].includes(dose) || !['reentry','established'].includes(effortDose)) throw new Error('Invalid dose or effort');
    const sets = override.sets ?? exercise.sets[dose];
    if (!Number.isInteger(sets) || sets < exercise.sets.reentry || sets > exercise.sets.established) throw new Error(`Invalid set count for ${exercise.name}`);
    const t = exercise.timing;
    const work = sets * exercise.reps_max * t.seconds_per_rep_or_cycle * t.side_multiplier;
    const sideChange = sets * t.side_switch_seconds_per_pair;
    const rest = Math.max(0, sets - 1) * t.rest_between_set_pairs_or_bilateral_sets_seconds;
    const omitted = override.omitted === true;
    const seconds = omitted ? 0 : work + sideChange + rest + t.setup_seconds + t.ramp_up_seconds;
    return {slot,exercise,dose,effortDose,sets,omitted,seconds,parts:omitted?{work:0,sideChange:0,rest:0,setup:0,ramp:0}:{work,sideChange,rest,setup:t.setup_seconds,ramp:t.ramp_up_seconds}};
  }
  function calculateSession(sessionId, state) {
    const session = getSession(sessionId);
    const slots = session.slots.map(slot => resolveSlot(slot,state));
    const parts = slots.reduce((sum,item) => {Object.keys(sum).forEach(k => sum[k] += item.parts[k]); return sum;},{work:0,sideChange:0,rest:0,setup:0,ramp:0});
    const workSeconds = slots.reduce((sum,item) => sum + item.seconds,0);
    const seconds = session.prepare_seconds + workSeconds + session.finish_seconds + session.contingency_seconds;
    return {session,slots,parts,workSeconds,seconds,omitted:slots.filter(s => s.omitted)};
  }
  function validate(candidate) {
    try {
      if (!sessions.some(s => s.id === candidate.sessionId)) throw new Error('Unknown session');
      if (!['reentry','established'].includes(candidate.baseDose)) throw new Error('Invalid base dose');
      const owners = new Set(sessions.flatMap(s => s.slots.map(slot => slot.owner_area)));
      for (const [owner, dose] of Object.entries(candidate.areaOverrides)) if (!owners.has(owner) || !['reentry','established'].includes(dose)) throw new Error('Invalid area override');
      for (const id of Object.keys(candidate.slotOverrides)) if (!getSlot(id)) throw new Error('Unknown exercise override');
      const all = sessions.map(s => calculateSession(s.id,candidate));
      const over = all.filter(s => s.seconds > catalog.max_minutes * 60 + .001);
      if (over.length) return {ok:false,message:over.map(s => `${s.session.title} would need about ${Math.ceil(s.seconds/60)} minutes`).join('; ') + '. Your current setup has not changed.'};
      return {ok:true,all};
    } catch (error) { return {ok:false,message:error.message + '. Your current setup has not changed.'}; }
  }
  function diffStates(before, after) {
    return sessions.map(session => {
      const old = calculateSession(session.id,before), next = calculateSession(session.id,after);
      const changes = next.slots.map((item,i) => ({before:old.slots[i],after:item})).filter(({before:a,after:b}) => a.exercise.id !== b.exercise.id || a.sets !== b.sets || a.exercise.rir[a.effortDose] !== b.exercise.rir[b.effortDose] || a.omitted !== b.omitted);
      return {session,changes,beforeSeconds:old.seconds,afterSeconds:next.seconds};
    }).filter(s => s.changes.length);
  }
  function omissionSummary(resolved) {
    if (!resolved.omitted.length) return '';
    const names = resolved.omitted.map(item => item.exercise.name);
    const back = resolved.omitted.some(item => item.exercise.family === 'back_extension');
    const abs = resolved.omitted.some(item => item.slot.is_trunk && item.exercise.family !== 'back_extension');
    const retainedTrunk = resolved.slots.some(item => !item.omitted && item.slot.is_trunk && item.exercise.family !== 'back_extension');
    return `Left out: ${names.join('; ')}. Coverage is reduced.${back?` Direct back-extension work is reduced.${retainedTrunk?' The retained abs/trunk exercise remains.':''}`:''}${abs?' A dedicated abs/trunk exercise is left out.':''} No replacement is required.`;
  }
  function mediaFor(exercise) {
    return media[exercise.media_id || exercise.media_ids?.[0] || exercise.id] || null;
  }
  function localMediaPath(asset) {
    const path=asset?.photo_path;
    if(!path || /^(?:[a-z]+:|\/|\.\.)/i.test(path))return null;
    return path.replace(/^web\//,'');
  }
  function thumbnailPath(asset) {
    const path=asset?.thumbnail_path;
    if(path && !/^(?:[a-z]+:|\/|\.\.)/i.test(path))return path.replace(/^web\//,'');
    return localMediaPath(asset);
  }
  function cropGeometry(asset) {
    const crop=asset?.crop, imageWidth=asset?.image_width, imageHeight=asset?.image_height;
    if(!crop || ![crop.x,crop.y,crop.width,crop.height,imageWidth,imageHeight].every(Number.isFinite))return null;
    if(imageWidth<=0 || imageHeight<=0 || crop.x<0 || crop.y<0 || crop.width<=0 || crop.height<=0 || crop.x+crop.width>1 || crop.y+crop.height>1)return null;
    return {ratio:imageWidth*crop.width/(imageHeight*crop.height),width:100/crop.width,height:100/crop.height,left:-100*crop.x/crop.width,top:-100*crop.y/crop.height};
  }
  function photoFrame(asset,isThumb=false,alt='') {
    const crop=cropGeometry(asset),original=localMediaPath(asset);
    const path=crop&&original?original:isThumb?thumbnailPath(asset):original;
    if(!path)return '';
    const image=`src="${escape(path)}" alt="${escape(isThumb?'':alt)}" loading="lazy"`;
    if(!crop||!original)return `<img ${image}>`;
    return `<span class="photo-frame"><span class="photo-crop" style="--photo-ratio:${crop.ratio};aspect-ratio:${crop.ratio}"><img ${image} style="width:${crop.width}%;height:${crop.height}%;left:${crop.left}%;top:${crop.top}%"></span></span>`;
  }
  window.REHAB_ENGINE = {freshState,normalizeState,parseRoute,resolveSlot,calculateSession,validate,diffStates,omissionSummary,mediaFor,localMediaPath,thumbnailPath,cropGeometry,photoFrame,doseMarkup,printMarkup,sessionBreakdown,coverageNames};
  if (typeof document === 'undefined') return;

  const $ = selector => document.querySelector(selector);
  const offlineCopy=location.protocol==='file:';
  const panel = $('#panel');
  const opens = new Set();
  const route = parseRoute(location.hash);
  let routeNotice = route.unknown;
  let state = freshState(route.sessionId);
  let draft = null, context = null, opener = null, returnSlot = null, announceTimer;
  const announce = text => {clearTimeout(announceTimer);$('#announcement').textContent='';announceTimer=setTimeout(() => $('#announcement').textContent=text,25);};
  const roleMarkup = exercise => (exercise.roles || []).map(role=>`<span class="role-pill ${String(role).toLowerCase()}">${escape(role)}</span>`).join('');
  const shoulderPress = exercise => exercise.owner_area === 'shoulder_press' || /^(ua_floor_press|ub_press|uc_push)/.test(exercise.id);
  const shoulderReminder = () => '<p class="shoulder-note"><strong>Shoulder check</strong> · If painful catching, giving way or a meaningful loss of normal arm function returns, stop the provoking movement and arrange a physiotherapy assessment before resuming demanding pressing. Comfortable cuff work does not establish readiness to press.</p>';
  function doseMarkup(resolved) {
    const e=resolved.exercise, reps=e.reps_min===e.reps_max?e.reps_min:`${e.reps_min}–${e.reps_max}`;
    const together=/both (arms|legs|wrists|hands) together/i.exec(e.side_execution || '')?.[0];
    return `${resolved.sets} × ${reps}${e.rep_unit==='cycles'?' cycles':''}${e.timing.side_multiplier===2?' each side':together?` · ${together}`:''}`;
  }
  function effortMarkup(resolved){return `${resolved.exercise.rir[resolved.effortDose]} good reps left`;}
  function sideMarkup(exercise) {
    const pattern=exercise.side_execution || '';
    if (/both arms together/i.test(pattern)) return 'Both arms together.';
    if (/both legs together/i.test(pattern)) return 'Both legs together.';
    if (exercise.side_independent) return 'Work each side separately. Choose the load, repetitions and comfortable range for that side.';
    if (/alternating/i.test(pattern)) return 'Alternate sides. The displayed repetitions are for each side.';
    if (/unilateral/i.test(pattern)) return 'Work one side at a time; complete both sides.';
    if (/bilateral trunk/i.test(pattern)) return 'Move the trunk in one controlled repetition.';
    if (pattern) return pattern.charAt(0).toUpperCase()+pattern.slice(1)+'.';
    return exercise.timing.side_multiplier===2?'Complete both sides as prescribed.':'';
  }
  function restMarkup(resolved) {
    const t=resolved.exercise.timing;
    if (resolved.sets>=2 && t.side_multiplier===2 && t.side_switch_seconds_per_pair>0) return `${secondsLabel(t.side_switch_seconds_per_pair)} to rest & switch sides · ${secondsLabel(t.rest_between_set_pairs_or_bilateral_sets_seconds)} after pair`;
    if (resolved.sets>1) return `Rest ${secondsLabel(t.rest_between_set_pairs_or_bilateral_sets_seconds)} ${t.side_multiplier===2?'after both sides':'between sets'}`;
    if (t.side_switch_seconds_per_pair) return `${secondsLabel(t.side_switch_seconds_per_pair)} to rest & switch sides · one set per side`;
    return 'One working set';
  }
  function thumbnailMarkup(exercise) {
    const asset=mediaFor(exercise),frame=photoFrame(asset,true);
    if(frame)return `<span class="row-visual has-image" aria-hidden="true">${frame}</span>`;
    return '<span class="row-visual photo-unavailable"><span>See<br>demonstration</span></span>';
  }
  function figureMarkup(exercise) {
    const asset=mediaFor(exercise),path=localMediaPath(asset);
    if(!path)return '';
    const creator=asset.credit?.name||asset.creator||'Source photo';
    const creditURL=asset.credit?.url||asset.credit_url||asset.source_url;
    const credit=creditURL?`<a href="${escape(creditURL)}" target="_blank" rel="noopener noreferrer">Photo: ${escape(creator)} ↗</a>`:`Photo: ${escape(creator)}`;
    return `<figure class="demo reference-photo"><div class="figure-title">Exercise reference<span>${escape(creator)}</span></div>${photoFrame(asset,false,asset.photo_alt||`Reference photo for ${exercise.name.toLowerCase()}.`)}<figcaption>${asset.caption?`<p>${escape(asset.caption)}</p>`:''}<span class="photo-credit">${credit}</span></figcaption></figure>`;
  }
  function demonstrationMarkup(exercise) {
    const reference=mediaFor(exercise)?.reference;
    if(!reference?.url)return '';
    const exact=reference.match==='exact';
    const isVideo=/(?:youtube\.com|youtu\.be|vimeo\.com)/i.test(reference.url);
    const label=isVideo?(exact?'Watch demonstration':'Watch movement guide'):'Open technique reference';
    return `<div class="watch-reference"><a class="watch-button" href="${escape(reference.url)}" target="_blank" rel="noopener noreferrer"><span class="play-icon" aria-hidden="true">▶</span><span>${label}<small>${escape(reference.label||'Source demonstration')} · opens externally</small></span><span aria-hidden="true">↗</span></a>${reference.variant_note?`<p class="reference-note">${escape(reference.variant_note)}</p>`:''}</div>`;
  }
  function referenceMarkup(exercise) {
    const ids=[...new Set([exercise.reference_source_id,...(exercise.background_source_ids||exercise.source_ids||[]),...(exercise.evidence_ids||[])].filter(Boolean))];
    const links=ids.map(id=>sources[id]).filter(Boolean);
    if(!links.length)return '';
    return `<details class="detail-notes"><summary>Why this is included <span aria-hidden="true">+</span></summary><p>These references support the movement family and training principles. The dose and order are a synthesis for this plan.</p><ul>${links.map(s=>`<li><a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.title||s.description||s.id)} ↗</a></li>`).join('')}</ul></details>`;
  }
  function rampMarkup(exercise) {
    const protocol=catalog.ramp_protocols[exercise.ramp_protocol_id];
    if(!protocol)return '';
    return `<section class="ramp-card" aria-label="Warm-up sets before this lift"><div><span class="ramp-dot" aria-hidden="true"></span><h4>Before your working sets</h4></div><p>Rehearse this lift with light loads first.</p><ol>${protocol.sets_or_pairs.map(r=>`<li><strong>${r.reps_per_side} reps${r.side_multiplier===2?' each side':''}</strong><span>${r.side_switch_seconds?`${secondsLabel(r.side_switch_seconds)} to change sides · `:''}rest ${secondsLabel(r.rest_after_seconds)} afterward</span></li>`).join('')}</ol></section>`;
  }
  function failureMarkup(resolved) {
    const policy=resolved.exercise.failure_policy;
    if(!policy?.eligible)return '';
    const active=resolved.effortDose==='established' && resolved.sets===resolved.exercise.sets.established;
    return `<details class="detail-notes"><summary>Optional final-set effort <span aria-hidden="true">+</span></summary><p>${active?'This is an eligible machine option; the ordinary target remains above.':'Keep the displayed reserve. This optional choice only applies after the exercise and dose are familiar.'}</p><p>${escape(policy.criteria)}</p><p>${escape(policy.scope)}</p><p>Optional 0–1 good reps left on that one final set only. No forced repetitions. Skip this choice with recurring symptoms, unfamiliar setup or newly increased range. This is a fatigue-management proposal, not a proven injury-prevention threshold.</p></details>`;
  }
  function exerciseMarkup(resolved,index) {
    const e=resolved.exercise,slot=resolved.slot,ordinal=String(index+1).padStart(2,'0');
    if(resolved.omitted)return `<li class="omitted-row" id="slot-${slot.id}"><span class="exercise-number" aria-hidden="true">${ordinal}</span><div><h3>${escape(e.name)}</h3><p>Left out for this visit</p></div><button class="restore-button" data-action="restore" data-id="${slot.id}">Restore</button></li>`;
    const cues=[...new Set((e.cues || []).filter(Boolean))].slice(0,3);
    const fullDose=resolved.sets<e.sets.established?`<span class="full-dose-hint">Plan: ${e.sets.established} ${e.timing.side_multiplier===2?'sets each side':'sets'}</span>`:'';
    const extra=e.instructions && !cues.includes(e.instructions)?`<p>${escape(e.instructions)}</p>`:'';
    return `<li><details class="exercise" id="slot-${slot.id}" data-disclosure="${slot.id}" ${opens.has(slot.id)?'open':''}><summary>${thumbnailMarkup(e)}<span><span class="exercise-role"><span class="exercise-number">${ordinal}</span>${roleMarkup(e)}</span><span class="exercise-title">${escape(e.name)}</span><span class="dose-line">${escape(doseMarkup(resolved))}</span><span class="rest-line">${escape(restMarkup(resolved))} · ${escape(effortMarkup(resolved))}</span>${fullDose}${e.sets.established<library[slot.default_option_id].sets.established?`<span class="full-dose-hint">This option reduces direct sets: ${e.sets.established} instead of ${library[slot.default_option_id].sets.established} in the plan.</span>`:''}</span><span class="exercise-arrow" aria-hidden="true">+</span></summary><div class="exercise-body">${rampMarkup(e)}${figureMarkup(e)}${demonstrationMarkup(e)}<ul class="cue-list primary-cues">${cues.map(c=>`<li>${escape(c)}</li>`).join('')}</ul>${sideMarkup(e)?`<p class="side-note">${escape(sideMarkup(e))}</p>`:''}${shoulderPress(e)||slot.owner_area==='shoulder_press'?shoulderReminder():''}<p class="purpose-line"><strong>Purpose</strong> · ${e.primary_functions.map(escape).join(' · ')}</p><div class="exercise-actions"><button class="outline-button" data-action="adjust" data-id="${slot.id}">Sets & effort <span aria-hidden="true">↗</span></button><button class="outline-button" data-action="swap" data-id="${slot.id}">Swap exercise <span aria-hidden="true">⇄</span></button></div><details class="detail-notes"><summary>Setup & technique <span aria-hidden="true">+</span></summary>${extra}<p>${escape(e.timing.work_unit_definition)}</p>${e.timing.within_pair_description?`<p>${escape(e.timing.within_pair_description)}</p>`:''}${e.equipment?.length?`<p><strong>Equipment:</strong> ${e.equipment.map(escape).join(', ')}.</p>`:''}${e.constraints?.length?`<ul>${e.constraints.map(c=>`<li>${escape(c)}</li>`).join('')}</ul>`:''}${e.stop_rule?`<p><strong>If the response changes:</strong> ${escape(e.stop_rule)}</p>`:''}</details><details class="detail-notes"><summary>Progress or make it easier <span aria-hidden="true">+</span></summary><p>${escape(e.progression)}</p><p>${escape(e.regression)}</p><p>Sets, effort, range, support and load are separate choices. Change one demand at a time.</p></details>${failureMarkup(resolved)}${referenceMarkup(e)}<button class="leave-button" data-action="omit" data-id="${slot.id}">Leave out this visit</button></div></details></li>`;
  }
  function supportMarkup(ref) {
    const e=typeof ref==='string'?{name:ref}:support[ref.movement_id] || ref;
    const dose=typeof ref==='object'?(ref.dose||e.dose):'';
    if(!e.id||e.dose_kind==='transition')return `<li class="transition-row"><span aria-hidden="true">→</span><div><strong>${escape(e.name)}</strong><span>${escape(dose)}</span></div></li>`;
    return `<li><details class="support-movement"><summary>${thumbnailMarkup(e)}<span class="support-row-copy"><strong>${escape(e.name)}</strong><span>${escape(dose)}</span></span><span class="support-plus" aria-hidden="true">+</span></summary><div>${figureMarkup(e)}${demonstrationMarkup(e)}<ul class="cue-list primary-cues">${(e.cues||[]).slice(0,3).map(c=>`<li>${escape(c)}</li>`).join('')}</ul><p class="panel-small">${escape(e.stop_rule||'Use an easy comfortable range; stop a provoking movement.')}</p>${referenceMarkup(e)}</div></details></li>`;
  }
  function sessionBreakdown(resolved) {
    const strength=resolved.slots.filter(item=>item.slot.time_category!=='rehab').reduce((sum,item)=>sum+item.seconds,0);
    const rehab=resolved.slots.filter(item=>item.slot.time_category==='rehab').reduce((sum,item)=>sum+item.seconds,0);
    return {strength,rehab,warmup:resolved.session.prepare_seconds,mobility:resolved.session.finish_seconds,buffer:resolved.session.contingency_seconds};
  }
  function coverageNames(resolved) {
    return [...new Set(resolved.slots.filter(item=>!item.omitted&&item.slot.time_category==='rehab').flatMap(item=>item.slot.rehab_focus||[areaLabel(item.slot.owner_area)]))];
  }
  function render(focusHeading=false) {
    state=normalizeState(state);
    const r=calculateSession(state.sessionId,state),s=r.session,index=sessions.findIndex(v=>v.id===s.id),breakdown=sessionBreakdown(r);
    const hasAdjustments=Object.keys(state.areaOverrides).length || Object.keys(state.slotOverrides).length;
    $('#desktop-days').innerHTML=sessions.map((v,i)=>`<button class="day-link" data-action="day" data-id="${v.id}" aria-current="${v.id===s.id}"><span class="day-number">${String(i+1).padStart(2,'0')}</span><span>${v.title}</span>${v.id===s.id?'<span class="selected-mark" aria-hidden="true">●</span>':'<span class="day-chevron" aria-hidden="true">›</span>'}</button>`).join('');
    const omission=omissionSummary(r), coverage=coverageNames(r);
    let section='',train='';
    r.slots.forEach((item,i)=>{const category=item.slot.time_category==='rehab'?'rehab':'strength';if(category!==section){if(section)train+='</ol></section>';section=category;train+=`<section class="training-section ${category}-section"><div class="section-heading"><div><span class="section-symbol ${category}" aria-hidden="true">${category==='rehab'?'◎':'↗'}</span><h2>${category==='rehab'?'Targeted rehab':'Strength & core'}</h2></div><span>${Math.ceil(breakdown[category]/60)} min total</span></div><ol class="exercise-list">`;}train+=exerciseMarkup(item,i);});if(section)train+='</ol></section>';
    $('#session').innerHTML=`${routeNotice?'<p class="modified-note" role="status">That session link was not recognized. Showing Upper A; choose any session below.</p>':''}
      <div class="session-topline"><p class="eyebrow">YOUR TRAINING PLAN</p><button class="text-link" data-action="guide">How it works <span aria-hidden="true">↗</span></button></div>
      <div class="page-heading"><h1 id="session-title" tabindex="-1">${s.title}</h1><span class="session-position">SESSION ${index+1} OF 6</span></div>
      <p class="session-focus">${escape(shortFocus[s.id])}.</p>
      <nav class="mobile-session-picker" aria-label="Choose a session">${['upper','lower'].map(type=>`<div class="session-picker-row"><span>${type==='upper'?'Upper':'Lower'}</span>${sessions.filter(v=>v.type===type||v.id.startsWith(type)).map(v=>`<button data-action="day" data-id="${v.id}" aria-label="${v.title}" aria-current="${v.id===s.id}">${v.title.split(' ').at(-1)}</button>`).join('')}</div>`).join('')}</nav>
      <button class="compact-overview" data-action="timing" aria-label="See session time breakdown"><span><small>SESSION</small><strong>${roundedMinutes(r.seconds)} <em>min</em></strong></span><span class="rehab-time"><small>TARGETED REHAB</small><strong>${Math.ceil(breakdown.rehab/60)} <em>min</em></strong></span><span class="time-detail">Includes rests<br>& setup <b aria-hidden="true">›</b></span></button>
      ${hasAdjustments?'<div class="adjusted-bar"><span>Adjusted for this visit</span><button data-action="reset-confirm">Reset changes</button></div>':''}
      ${omission?`<p class="modified-note">${escape(omission)}</p>`:''}
      <section class="training-section warmup-section"><div class="section-heading"><div><span class="section-symbol warmup" aria-hidden="true">↝</span><h2>Warm-up</h2><span class="start-here">START HERE</span></div><span>${Math.ceil(s.prepare_seconds/60)} min</span></div><div class="prep-block"><ul class="prep-list">${s.prepare.map(supportMarkup).join('')}</ul><p class="block-note">Easy movement first. Light warm-up sets for each main lift are shown in its exercise card.</p></div></section>
      ${train}
      <section class="training-section mobility-section"><div class="section-heading"><div><span class="section-symbol mobility" aria-hidden="true">⌁</span><h2>Mobility</h2></div><span>${Math.ceil(s.finish_seconds/60)} min</span></div><div class="finish-block"><ul class="prep-list">${s.finish.map(supportMarkup).join('')}</ul><p class="block-note">Use a comfortable range. Do not force a stretch.</p></div></section>
      <button class="coverage-card" data-action="coverage"><span class="coverage-icon" aria-hidden="true">◎</span><span><strong>Rehab coverage</strong><span>${escape(coverage.length?coverage.join(' · '):'See coverage across your six sessions')}</span></span><span class="coverage-chevron" aria-hidden="true">›</span></button>
      <button class="progress-card" data-action="progression"><span class="progress-card-icon" aria-hidden="true">↗</span><span><strong>Make the same plan stronger</strong><span>When to add reps, load or range</span></span><span aria-hidden="true">›</span></button>
      <div class="next-session"><div><span>UP NEXT</span><strong>${sessions[(index+1)%6].title}</strong><p>Rest when you need to. Pick up here.</p></div><button data-action="day" data-id="${sessions[(index+1)%6].id}" aria-label="Open ${sessions[(index+1)%6].title}">Next session <span aria-hidden="true">→</span></button></div>
      <div class="session-tools"><button class="inline-action" data-action="print">Print session <span aria-hidden="true">↗</span></button>${offlineCopy?'<span class="offline-badge">Offline copy</span>':'<a class="inline-action" href="daily-rehab-offline.zip" download>Keep an offline copy <span aria-hidden="true">↓</span></a>'}</div><p class="session-footnote">One plan, six sessions, your own pace.<br>Temporary adjustments reset when you refresh. Nothing is recorded.</p>`;
    if(focusHeading)$('#session-title').focus({preventScroll:true});
  }
  function showPanel(title,body,kicker='Daily rehab',nextContext=null) {
    if(!panel.open)opener=document.activeElement;
    context=nextContext;$('#panel-title').textContent=title;$('#panel-kicker').textContent=kicker;$('#panel-body').innerHTML=body;
    if(!panel.open)panel.showModal();panel.scrollTop=0;panel.querySelector('.close-button').focus({preventScroll:true});
  }
  function closePanel(){draft=null;context=null;panel.close();}
  panel.addEventListener('close',()=>{draft=null;context=null;const target=opener?.isConnected?opener:(returnSlot?document.querySelector(`#slot-${returnSlot} summary, #slot-${returnSlot} button`):$('#session-title'));target?.focus({preventScroll:true});returnSlot=null;});
  panel.addEventListener('cancel',()=>{draft=null;context=null;});
  panel.addEventListener('click',event=>{if(event.target===panel){const b=panel.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)closePanel();}});
  function formFooter(){return '<section class="change-preview" aria-label="Changes before applying"><h3>What will change</h3><p id="draft-summary" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p><div id="draft-changes"></div></section><div id="draft-error" class="form-error" role="alert"></div><div class="dialog-estimate"><span id="draft-session-name">Current session estimate</span><strong id="draft-time"></strong></div><button class="apply-button" id="apply-changes" data-action="apply">Apply for this visit</button><p class="apply-note">For this open tab only. Refreshing starts from the default setup.</p>';}
  function changeMarkup(item) {
    const a=item.before,b=item.after;
    const before=a.omitted?'Left out':`${doseMarkup(a)} · ${effortMarkup(a)}`;
    const after=b.omitted?'Left out':`${doseMarkup(b)} · ${effortMarkup(b)}`;
    return `<li><strong>${escape(b.exercise.name)}</strong>${a.exercise.id!==b.exercise.id?`<span>Replaces ${escape(a.exercise.name)}</span>`:''}<span>Before: ${escape(before)}</span><span>After: ${escape(after)}</span></li>`;
  }
  function updateDraftPreview(){
    if(!draft)return;draft=normalizeState(draft);const result=validate(draft);
    $('#draft-error').textContent=result.ok?'':result.message;$('#apply-changes').disabled=!result.ok;
    try {
      $('#draft-time').textContent=approximate(calculateSession(state.sessionId,draft).seconds);
      const changes=diffStates(state,draft);
      const count=changes.reduce((total,item)=>total+item.changes.length,0);
      $('#draft-summary').textContent=count?`${count} exercise change${count===1?'':'s'} across ${changes.length} session${changes.length===1?'':'s'}. Review before applying.`:'No exercise doses or choices will change.';
      $('#draft-changes').innerHTML=changes.length?changes.map(c=>`<details class="change-session" ${context?.type!=='setup'||c.session.id===state.sessionId?'open':''}><summary>${escape(c.session.title)} · ${c.changes.length} exercise${c.changes.length===1?'':'s'}<span>${approximate(c.beforeSeconds)} → ${approximate(c.afterSeconds)}</span></summary><ul>${c.changes.map(changeMarkup).join('')}</ul></details>`).join(''):'<p class="panel-small">Your current exercises and doses stay the same.</p>';
    }catch(error){$('#draft-time').textContent='Unavailable';$('#draft-changes').textContent=error.message;}
    if(context?.type==='adjust'){
      const r=resolveSlot(getSlot(context.slotId),draft),effort=$('#slot-effort');
      if(effort)effort.textContent=`${effortMarkup(r)}. Changing sets alone keeps this effort target unchanged.`;
    }
    const note=$('#established-note');if(note)note.hidden=draft.baseDose!=='established';
  }
  function showSetup(){showGuide();}
  function showAdjust(slotId,restoring=false){
    const slot=getSlot(slotId);returnSlot=slotId;draft=clone(state);
    if(restoring){draft.slotOverrides[slotId]??={};delete draft.slotOverrides[slotId].omitted;}
    const r=resolveSlot(slot,draft),e=r.exercise,override=draft.slotOverrides[slotId]||{};
    const values=Array.from({length:e.sets.established-e.sets.reentry+1},(_,i)=>i+e.sets.reentry);
    showPanel(restoring?'Adjust & restore':'Adjust this exercise',`<div class="panel-content"><p class="panel-intro">${escape(e.name)}<small>For this exercise in ${getSession(state.sessionId).title} only.</small></p><div class="slot-fields"><label class="field-label" for="slot-sets">Working sets<small>Plan: ${e.sets.established}${e.timing.side_multiplier===2?' per side':''}.</small></label><select id="slot-sets" name="slotSets"><option value="" ${override.sets==null?'selected':''}>Plan (${e.sets[r.dose]})</option>${values.map(v=>`<option value="${v}" ${override.sets===v?'selected':''}>${v} ${v===1?'set':'sets'}</option>`).join('')}</select></div><div class="slot-fields"><label class="field-label" for="slot-effort-dose">Effort<small>Keep good repetitions in reserve.</small></label><select id="slot-effort-dose" name="slotEffort"><option value="" ${!override.effortDose?'selected':''}>Plan (${escape(e.rir.established)} left)</option><option value="reentry" ${override.effortDose==='reentry'?'selected':''}>Easier (${escape(e.rir.reentry)} left)</option></select></div><p class="effort-note" id="slot-effort"></p><details class="detail-notes"><summary>When to increase effort <span aria-hidden="true">+</span></summary><p>First repeat this option, sets, range and support at least three times with stable subsequent function and reliable reserve estimates. Change effort alone. This is a practical guideline.</p><p>Stay within the displayed rep range. Never exceed it just to reach the lower reserve; consider a small load change on a later visit.</p></details>${slot.owner_area==='shoulder_press'?shoulderReminder():''}<p class="panel-small">${escape(e.progression)}</p>${failureMarkup(r)}${formFooter()}</div>`,'For this visit',{type:'adjust',slotId});updateDraftPreview();
  }
  function swapCandidate(slotId,optionId){
    const candidate=clone(draft),e=library[optionId];candidate.slotOverrides[slotId]??={};candidate.slotOverrides[slotId].optionId=optionId;
    const sets=candidate.slotOverrides[slotId].sets;if(sets!=null&&(sets<e.sets.reentry||sets>e.sets.established))delete candidate.slotOverrides[slotId].sets;
    return candidate;
  }
  function showSwap(slotId){
    returnSlot=slotId;draft=clone(state);const slot=getSlot(slotId),current=resolveSlot(slot,draft);
    const purpose={default:'Original exercise',equipment:'Equipment substitute',lower_demand:'Lower-demand version',side_independent:'Separate side dosing',grip_or_position:'Grip or position option'};
    showPanel('Swap exercise',`<div class="panel-content"><p class="panel-intro">Choose one for this slot. It replaces ${escape(current.exercise.name.toLowerCase())}; it does not add another exercise.</p><fieldset class="radio-group"><legend>Available options</legend>${slot.option_ids.map(id=>{const e=library[id],r=resolveSlot(slot,swapCandidate(slotId,id)),delta=r.seconds-current.seconds;return `<label class="choice"><input type="radio" name="slotOption" value="${id}" ${current.exercise.id===id?'checked':''}><span><strong>${escape(e.name)}</strong><small class="swap-kind">${escape(purpose[e.substitution_kind]||'Alternative')} · ${escape(doseMarkup(r))}</small><small>${escape(e.swap_note||e.option_note||'Use this option’s prescribed setup and dose.')}</small><small><strong class="inline-label">Equipment:</strong> ${escape((e.equipment||[]).join(', ')||'See setup notes')}</small><small>${escape(effortMarkup(r))} · ${delta===0?'Same modeled time':`${secondsLabel(Math.abs(delta))} ${delta>0?'longer':'shorter'}`}</small></span></label>`;}).join('')}</fieldset><p class="panel-small">Equipment substitutes and lower-demand versions solve different problems. The selected option uses its own dose, coverage and timing. Leave out the slot if no option suits you.</p><p id="swap-reset-note" class="inline-help"></p>${formFooter()}</div>`,'One slot · one exercise',{type:'swap',slotId});updateDraftPreview();
  }
  function showDays(){showPanel('Choose a session',`<div class="panel-content"><p class="panel-intro">Six sessions. Repeat at your own pace.</p><ol class="session-choices">${sessions.map((s,i)=>`<li><button class="session-choice" data-action="day" data-id="${s.id}" aria-current="${s.id===state.sessionId}"><span class="ordinal">${String(i+1).padStart(2,'0')}</span><span><strong>${s.title}</strong><small>${escape(shortFocus[s.id])}</small></span><span class="check" aria-hidden="true">${s.id===state.sessionId?'●':''}</span></button></li>`).join('')}</ol><p class="panel-small">Rest days do not change the order. Nothing is marked complete when you switch.</p><div class="divider"></div><button class="inline-action" data-action="session-link">Use a link to this session</button><p id="link-note" class="panel-small">Only the public session name goes in the link. Personal choices are not included.</p></div>`,'The rolling sequence');}
  const progressionHTML=()=>`<div class="prose"><p class="panel-intro">Keep the plan. Gradually make its exercises more demanding as your capacity improves.</p><ol class="progression-steps"><li><strong>Choose a repeatable starting load.</strong><p>Follow the listed sets and rep range, with the displayed good reps left. After time away, begin with light loads and use fewer sets where needed.</p></li><li><strong>Build reps, then add load.</strong><p>Reach the top of the rep range on every set for two tolerated visits, with the intended reserve and normal subsequent function. Then use the smallest practical load increase and return toward the lower rep limit.</p></li><li><strong>Change one demand at a time.</strong><p>Keep sets, effort, support and range unchanged when you add load. A deeper range is its own progression; earn it with control and a settled response.</p></li><li><strong>Check the next morning.</strong><p>A meaningful flare or reduced everyday function means hold progression. Use the last tolerated load or range, or reduce sets. Recurring or substantial symptoms warrant assessment.</p></li></ol><h3>Leave good reps in reserve</h3><p>Each exercise shows its effort target. Stop when you could still perform that many clean repetitions. You do not need to take every set to failure. Stay within the displayed rep cap.</p><p>Before reducing the reserve, repeat the same option, sets, range and support for at least three stable visits. This is a practical guideline, separate from the two-visit rep/load rule.</p><h3>Six to eight months, one flexible plan</h3><p>There is no automatic promotion date. Repeat the six sessions at your pace and rest when needed. After a break, choose loads from current ability. Do not catch up on missed sessions.</p><p>Upper and lower sessions can still share grip, shoulder-support and trunk demands. If those areas have not recovered, reduce the overlapping demand or rest.</p><details class="detail-notes"><summary>If a movement feels wrong <span aria-hidden="true">+</span></summary><p>Stop the provoking set. Use a comfortable listed alternative or leave it out. Painful shoulder catching, giving way or meaningful loss of normal arm function warrants assessment before demanding pressing. A painless click alone is not a diagnosis.</p></details></div>`;
  function showProgression(){showPanel('Build over time',`<div class="panel-content">${progressionHTML()}</div>`,'Progression guide');}
  function showGuide(){showPanel('Keep it simple',`<div class="panel-content"><p class="panel-intro">Choose a session, follow the order, and adjust only what you need.</p><div class="guide-sections"><details open><summary>Using the plan<span aria-hidden="true">+</span></summary><div><p>Upper A → Lower A → Upper B → Lower B → Upper C → Lower C, at your pace. Rest whenever needed.</p><p>Preparation, strength, targeted work and mobility share one 90-minute gym budget. Sets are sequential; no supersets are needed.</p><p>Choose loads from current ability. Dumbbell loads mean per hand; barbell loads mean total including the bar.</p></div></details><details><summary>Progress one thing at a time<span aria-hidden="true">+</span></summary><div>${progressionHTML()}</div></details><details><summary>Make a session shorter<span aria-hidden="true">+</span></summary><div><p>Keep prescribed rests. The first suggested reductions for ${getSession(state.sessionId).title} are:</p><ol>${getSession(state.sessionId).shortening_order.map(id=>`<li>${escape(resolveSlot(getSlot(id),state).exercise.name)}</li>`).join('')}</ol><p>Use Leave out and accept reduced coverage. Finish at 90 minutes. Do not carry omitted work forward as debt.</p></div></details><details><summary>An easy home option<span aria-hidden="true">+</span></summary><div><p>Optional · ${escape(catalog.home_option.minutes)} minutes · ${escape(catalog.home_option.purpose.replace(/^Optional /,''))}.</p><ul class="prep-list">${catalog.home_option.moves.map(supportMarkup).join('')}</ul><p>Keep it easy and short of fatigue. ${escape(catalog.home_option.skip_rule||'Skip any provoking movement.')} This does not advance the sequence.</p></div></details></div></div>`,'Your reference');}
  function showTiming(){const r=calculateSession(state.sessionId,state),b=sessionBreakdown(r);showPanel('Your session time',`<div class="panel-content prose"><p class="panel-intro">${approximate(r.seconds)} for this version of ${r.session.title}.</p><dl class="timing-breakdown">${[['Warm-up',b.warmup],['Strength & core',b.strength],['Dedicated targeted rehab',b.rehab],['Mobility',b.mobility],['Normal delay buffer',b.buffer]].map(([name,seconds])=>`<div><dt>${name}</dt><dd>${secondsLabel(seconds)}</dd></div>`).join('')}</dl><p>Strength and rehab each include their own working reps, both sides, between-set rests, equipment setup and any light rehearsal sets. Each exercise is counted once.</p><p>Warm-up, main strength work and mobility are not added to the dedicated rehab total. The estimate uses the top of each rep range; actual sessions vary.</p><p>Do your sets sequentially and take the prescribed rests. If equipment delays take you beyond 90 minutes, leave out a lower-priority movement rather than rushing.</p></div>`,'All time accounted for');}
  function showCoverage(){
    const groups=[['Shoulder',a=>a.startsWith('shoulder')],['Wrist & forearm',a=>a==='wrist'],['Elbow',a=>a==='elbow'],['Knee',a=>a==='knee'],['Achilles & ankle',a=>a==='achilles'||a==='ankle'],['Hip',a=>a==='hip'],['Low back & core',a=>a==='trunk']];
    showPanel('Every area, across the cycle',`<div class="panel-content prose"><p class="panel-intro">Dedicated work is distributed over six sessions. Each visit also includes mobility and core work.</p><div class="coverage-list">${groups.map(([name,match])=>{const entries=sessions.map(s=>({session:s,items:calculateSession(s.id,state).slots.filter(r=>!r.omitted&&match(r.slot.owner_area))})).filter(x=>x.items.length);return `<details><summary><strong>${name}</strong><span>${entries.length} sessions <b aria-hidden="true">+</b></span></summary><div>${entries.map(({session,items})=>`<h3>${session.title}</h3><ul>${items.map(r=>`<li>${escape(r.exercise.name)} <span class="coverage-role">${r.slot.time_category==='rehab'?'Targeted rehab':'Strength & core'}</span></li>`).join('')}</ul>`).join('')}</div></details>`}).join('')}</div><p>The tags describe each exercise’s main role in the plan. Strength exercises can also build tissue capacity, but their time is not counted again as targeted rehab.</p><p>These movements build capacity across regions; they do not isolate or diagnose every tendon. Leaving exercises out reduces the coverage shown here.</p></div>`,'Full-body coverage');
  }
  function showSources(){
    const used=[...new Set([...data.exercises,...Object.values(support)].flatMap(e=>[e.reference_source_id,...(e.source_ids||[]),...(e.evidence_ids||[])].filter(Boolean)))];
    showPanel('Sources & exercise references',`<div class="panel-content prose"><p>This independent plan is informed primarily by E3 Rehab, with selected ATG principles and research on strength, tendon loading and mobility. It is not an official E3 or ATG program.</p><h3>Exercise photos and demonstrations</h3><p>Photos are credited to their original publisher. Each caption identifies the exercise or related variation shown. Follow the selected exercise’s equipment, range, side instructions and cues.</p><p>Photo captions and video notes state meaningful differences from the prescribed variation. Source videos open only when you choose to watch them. Attribution identifies the source; it does not imply an endorsement.</p><h3>Programming and evidence</h3><p>The doses, order, progression and time estimates combine the sources below. Research populations and exercises vary; the exact combined plan has not been tested as a clinical intervention.</p><ul class="source-list">${used.map(id=>sources[id]).filter(Boolean).map(s=>`<li><a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.title||s.description||s.id)} ↗</a></li>`).join('')}</ul></div>`,'The reasoning behind the plan');
  }
  function showPrivacy(){
    showPanel('Nothing to record',`<div class="panel-content prose"><p>No accounts, workout logs, completed-set checkboxes or analytics. Session choices, swaps, effort, sets and omissions stay only in this open page.</p><p>Refreshing returns to the complete plan’s default exercises and doses. A session bookmark contains no adjustments or medical flags. No personal controls write to the URL.</p><p>Exercise photos and instructions load with the site. Videos and references open externally only when you choose them; those websites have their own privacy practices. Hosting services may keep normal operational logs.</p><h3>Keep a copy</h3><p>Download the offline version to keep these instructions independently of this website. Extract the folder and open its index file. Video links still need internet access. You can also print the selected session with its current adjustments.</p>${offlineCopy?'<p class="offline-badge">You are reading your offline copy.</p>':'<a class="offline-link" href="daily-rehab-offline.zip" download>Download offline copy ↓</a>'}</div>`,'Simple, by design');
  }
  function printMarkup(sessionId,selectedState){
    const r=calculateSession(sessionId,selectedState);
    const supportList=items=>`<ul>${items.map(ref=>{const m=support[ref.movement_id]||ref;return `<li><strong>${escape(m.name)}</strong> — ${escape(ref.dose||m.dose)}${m.cues?.length?`<p>${m.cues.slice(0,3).map(escape).join(' ')}</p>`:''}</li>`;}).join('')}</ul>`;
    return `<header class="print-header"><span>daily rehab.</span><h1>${escape(r.session.title)}</h1><p>${approximate(r.seconds)} · ${label(selectedState.baseDose)}${Object.keys(selectedState.slotOverrides).length||Object.keys(selectedState.areaOverrides).length?' with adjustments':''}</p></header><p>Choose a load and range you tolerate. Stop a provoking set; recurring painful catching, giving way or meaningful loss of function warrants assessment.</p>${r.omitted.length?`<p>${escape(omissionSummary(r))}</p>`:''}<h2>Prepare · ${secondsLabel(r.session.prepare_seconds)}</h2>${supportList(r.session.prepare)}<h2>Train</h2>${r.slots.filter(item=>!item.omitted).map((item,i)=>{const e=item.exercise,protocol=catalog.ramp_protocols[e.ramp_protocol_id];return `<section class="print-exercise"><h3>${i+1}. ${escape(e.name)}</h3><p class="print-role">${e.roles.map(escape).join(' · ')}</p><p><strong>${escape(doseMarkup(item))} · ${escape(effortMarkup(item))}</strong></p><p>${escape(restMarkup(item))}</p>${protocol?`<p>Light warm-up sets: ${protocol.sets_or_pairs.map(set=>`${set.reps_per_side} reps${set.side_multiplier===2?' each side':''}; ${set.side_switch_seconds?`${set.side_switch_seconds}s to change sides; `:''}rest ${set.rest_after_seconds}s`).join(' → ')}.</p>`:''}<ul>${(e.cues||[]).slice(0,3).map(c=>`<li>${escape(c)}</li>`).join('')}</ul></section>`;}).join('')}<h2>Finish · ${secondsLabel(r.session.finish_seconds)}</h2>${supportList(r.session.finish)}<p>Next: ${sessions[(sessions.findIndex(s=>s.id===sessionId)+1)%sessions.length].title}. Rest when needed. Six sessions do not mean six consecutive days.</p>`;
  }
  function preparePrintSheet(){
    let sheet=document.getElementById('print-sheet');
    if(!sheet){sheet=document.createElement('article');sheet.id='print-sheet';document.body.appendChild(sheet);}
    sheet.innerHTML=printMarkup(state.sessionId,state);
  }
  function printSession(){preparePrintSheet();window.print();}
  window.addEventListener('beforeprint',preparePrintSheet);
  function applyDraft(){if(!draft)return;const result=validate(draft);if(!result.ok){$('#draft-error').textContent=result.message;return;}const message=context?.type==='swap'?'Exercise replaced.':context?.type==='adjust'?'Exercise adjustment applied.':'Session setup applied.';state=normalizeState(draft);render();const estimate=approximate(calculateSession(state.sessionId,state).seconds);closePanel();announce(`${message} ${estimate}. Choices are temporary.`);}
  function setOmission(slotId,omitted){const next=clone(state);next.slotOverrides[slotId]??={};if(omitted)next.slotOverrides[slotId].omitted=true;else delete next.slotOverrides[slotId].omitted;const result=validate(next);if(!result.ok){returnSlot=slotId;showPanel('Restore needs an adjustment',`<div class="panel-content"><p class="form-error">${escape(result.message)}</p><div class="button-row"><button class="outline-button" data-action="close">Keep left out</button><button class="outline-button" data-action="adjust-restore" data-id="${slotId}">Adjust & restore</button></div></div>`,'Keep the time budget');return;}state=normalizeState(next);if(omitted)opens.delete(slotId);render();document.querySelector(`#slot-${slotId} ${omitted?'button':'summary'}`)?.focus({preventScroll:true});announce(`${omitted?'Exercise left out. Coverage is reduced.':'Exercise restored.'} ${approximate(calculateSession(state.sessionId,state).seconds)}.`);}
  document.addEventListener('toggle',event=>{const key=event.target?.dataset?.disclosure;if(!key)return;if(event.target.open)opens.add(key);else opens.delete(key);},true);
  document.addEventListener('change',event=>{if(!draft)return;const input=event.target;
    if(input.name==='baseDose')draft.baseDose=input.value;
    if(input.dataset.area){if(input.value)draft.areaOverrides[input.dataset.area]=input.value;else delete draft.areaOverrides[input.dataset.area];}
    if(context?.slotId){const id=context.slotId;draft.slotOverrides[id]??={};const override=draft.slotOverrides[id];
      if(input.name==='slotSets'){if(input.value)override.sets=Number(input.value);else delete override.sets;}
      if(input.name==='slotEffort'){if(input.value)override.effortDose=input.value;else delete override.effortDose;}
      if(input.name==='slotDose'){if(input.value)override.dose=input.value;else delete override.dose;const e=resolveSlot(getSlot(id),draft).exercise;const follow=$('#slot-sets option[value=""]');if(follow)follow.textContent=`Follow dose (${e.sets[override.dose||draft.areaOverrides[getSlot(id).owner_area]||draft.baseDose]})`;}
      if(input.name==='slotOption'){const e=library[input.value],reset=override.sets!=null&&(override.sets<e.sets.reentry||override.sets>e.sets.established);override.optionId=input.value;if(reset)delete override.sets;$('#swap-reset-note').textContent=reset?'The old manual set count does not fit this alternative. The new option’s prescribed set count will apply.':'';}
    }updateDraftPreview();
  });
  document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;event.preventDefault();const action=button.dataset.action,id=button.dataset.id;
    if(action==='skip'){ $('#session').focus();$('#session').scrollIntoView({block:'start'});return; }
    if(action==='close')return closePanel();if(action==='choose-day')return showDays();if(action==='setup')return showSetup();if(action==='adjust')return showAdjust(id);if(action==='adjust-restore')return showAdjust(id,true);if(action==='swap')return showSwap(id);if(action==='guide')return showGuide();if(action==='coverage')return showCoverage();if(action==='progression')return showProgression();if(action==='timing')return showTiming();if(action==='print')return printSession();if(action==='sources')return showSources();if(action==='privacy')return showPrivacy();if(action==='apply')return applyDraft();if(action==='omit')return setOmission(id,true);if(action==='restore')return setOmission(id,false);
    if(action==='day'){state.sessionId=getSession(id).id;routeNotice=false;opens.clear();if(panel.open)closePanel();try{history.replaceState(null,'',`#${state.sessionId}`);}catch(_){location.hash=state.sessionId;}render(true);$('#session').scrollIntoView({block:'start'});announce(`${getSession(id).title} selected. ${approximate(calculateSession(state.sessionId,state).seconds)}.`);return;}
    if(action==='session-link'){try{history.replaceState(null,'',`#${state.sessionId}`);}catch(_){location.hash=state.sessionId;}$('#link-note').textContent=`Bookmark or copy the address to open ${getSession(state.sessionId).title}. Reopening starts with the complete plan and default options.`;return;}
    if(action==='reset-confirm'){draft=null;showPanel('Return to the default?',`<div class="panel-content"><p class="panel-intro">This clears dose, effort, set-count, swap and leave-out choices. ${getSession(state.sessionId).title} stays selected.</p><div class="button-row"><button class="outline-button" data-action="close">Keep my changes</button><button class="apply-button" data-action="reset">Reset to plan</button></div></div>`,'Temporary choices');return;}
    if(action==='reset'){state=freshState(state.sessionId);opens.clear();render();closePanel();announce('Default plan restored.');}
  });
  window.addEventListener('hashchange',()=>{const next=parseRoute(location.hash,state.sessionId);if(next.anchor){$('#session').focus();return;}state.sessionId=next.sessionId;routeNotice=next.unknown;opens.clear();if(panel.open)closePanel();render(true);if(routeNotice)announce('Unrecognized session link. Showing Upper A.');});
  render();
})();
