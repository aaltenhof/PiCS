
const DATAPIPE_ID   = "Rcnn6TF27ps9";
const TRIAL_FILE    = "trials.csv";
const INTRO_VIDEO   = "intro_video.mp4";
const EXIT_VIDEO    = "exit_video.mp4";
const HALFWAY_VIDEO = "zib_half_packed.mp4";
const HALFWAY_AFTER = 8;   // plays after this many experimental trials (8 of 12)
const STIM_DIR      = "selected_stim/";
const LABEL_AUDIO   = "audio/sample/labels/";
const SUPPORT_AUDIO = "audio/sample/support/";
const CUE_PICK_ONE  = SUPPORT_AUDIO + "pick_one.wav";
const CUE_TO_SORT   = SUPPORT_AUDIO + "to_sort.wav";

// "Can you pick all the sibus?" — always the target's (matched) label
const SELECT_AUDIO   = label => `${LABEL_AUDIO}${label}/select_${label}.wav`;
const SELECT_END     = [1, 2, 3].map(n => `audio/sort/end/to_sample${n}.wav`);
const SELECT_HOLD_MS = 2500;   // how long the filled box sits before moving on

const PRACTICE_DIR  = "audio/practice/";
const PRAC_INTRO    = PRACTICE_DIR + "practice_intro.wav";
const PRAC_SAMPLE   = PRACTICE_DIR + "practice_sample.wav";
const PRAC_SEL_DIR  = PRACTICE_DIR + "selection/";
const PRAC_SEL_INST = PRAC_SEL_DIR + "instructions.wav";
const PRAC_SELECT   = set => `${PRAC_SEL_DIR}select_${set}.wav`;
const PRAC_STIM     = "selected_stim/practice/";
const PRAC_TRIAL    = {
    trial_id: "practice",
    trial_type: "practice",
    stim_type: "practice",
    prac_set: "dogs",
    a_stim: "corgi.png",
    b_stim: "pom.png",
    x_stim: "golden.png"
};

const BOX_IMG       = "selected_stim/box_open.png";

const SHUFFLE_TRIALS   = true;   // shuffle experimental trials, but keep sample and select together
const AVOID_CAT_RUN    = true;   // no two consecutive trials from the same stim_type
const RANDOMIZE_MATCH  = true;   // balanced matched/unmatched assignment of the label
const MAX_MATCHED_RUN  = 2;      // cap consecutive matched (or unmatched) trials
const RANDOMIZE_SIDE   = true;   // randomize which side B sits on

var jsPsych = initJsPsych({
    on_trial_finish: function () { stopAudio(); }
});

var study_id = "PiCS";
var participant_id = "";
var participant_age = "";

var today = new Date();
var dd = String(today.getDate()).padStart(2, '0');
var mm = String(today.getMonth() + 1).padStart(2, '0');
var yyyy = today.getFullYear();
const session_date = mm + '/' + dd + '/' + yyyy;
const session_time = today.toLocaleTimeString();

jsPsych.data.addProperties({
    study_id: study_id,
    session_date: session_date,
    session_time: session_time
});

// load trials
const REQUIRED_COLUMNS = [
    "trial_id", "trial_type", "stim_type",
    "a_stim", "b_stim", "x_stim", "matched_label", "unmatched_label"
];

function asBool(v) {
    return /^(true|1|yes|t)$/i.test(String(v).trim());
}

function loadTrials(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url + "?v=" + Date.now(), {   
            download: true,                      
            header: true,                        
            skipEmptyLines: true,
            transformHeader: h => h.trim(),
            complete: results => {
                const rows = results.data;
                if (!rows.length) return reject(new Error(`${url} has no trials in it.`));

                const missing = REQUIRED_COLUMNS.filter(c => !(c in rows[0]));
                if (missing.length) {
                    return reject(new Error(`${url} is missing column(s): ${missing.join(", ")}`));
                }

                const seen = new Set();
                for (let i = 0; i < rows.length; i++) {
                    const r = rows[i];
                    if (seen.has(r.trial_id)) {
                        return reject(new Error(`Duplicate trial_id "${r.trial_id}" in ${url}`));
                    }
                    seen.add(r.trial_id);
                    if (!["practice", "experimental"].includes(r.trial_type)) {
                        return reject(new Error(
                            `Row ${i + 2}: trial_type must be "practice" or "experimental", got "${r.trial_type}"`));
                    }
                }

                resolve(rows.map(r => Object.assign({}, r, {
                    force_matched: r.force_matched === "" || r.force_matched === undefined
                        ? undefined : asBool(r.force_matched)
                })));
            },
            error: err => reject(new Error(`Couldn't load ${url} — ${err.message}`))
        });
    });
}


function shuffle(array) {
    let currentIndex = array.length;
    array = array.slice();
    while (currentIndex != 0) {
        let randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

function shuffleNoRepeats(array, sameFn) {
    for (let attempt = 0; attempt < 300; attempt++) {
        const s = shuffle(array);
        let ok = true;
        for (let i = 1; i < s.length; i++) {
            if (sameFn(s[i], s[i - 1])) { ok = false; break; }
        }
        if (ok) return s;
    }
    console.warn("PiCS: couldn't avoid category repeats; using a plain shuffle.");
    return shuffle(array);
}

// half matched label, half not and make sure they don't come back to back to back
function balancedFlags(n, maxRun) {
    const pool = Array.from({ length: n }, (_, i) => i < Math.floor(n / 2));
    for (let attempt = 0; attempt < 500; attempt++) {
        const s = shuffle(pool);
        let run = 1, ok = true;
        for (let i = 1; i < s.length; i++) {
            run = s[i] === s[i - 1] ? run + 1 : 1;
            if (run > maxRun) { ok = false; break; }
        }
        if (ok) return s;
    }
    console.warn("PiCS: couldn't satisfy MAX_MATCHED_RUN; using a plain shuffle.");
    return shuffle(pool);
}


function buildRunList(bank) {
    const practice = bank.filter(t => t.trial_type === "practice");
    let experimental = bank.filter(t => t.trial_type === "experimental");

    if (SHUFFLE_TRIALS) {
        experimental = AVOID_CAT_RUN
            ? shuffleNoRepeats(experimental, (a, b) => a.stim_type === b.stim_type)
            : shuffle(experimental);
    }

    const flags = RANDOMIZE_MATCH
        ? balancedFlags(experimental.length, MAX_MATCHED_RUN)
        : experimental.map(() => true);

    let expIdx = 0;
    return [...practice, ...experimental].map((t, i) => {
        const matched = t.trial_type === "practice"
            ? (t.force_matched !== undefined ? t.force_matched : true)
            : flags[expIdx++];

        return Object.assign({}, t, {
            run_order: i + 1,
            matched: matched,
            label: matched ? t.matched_label : t.unmatched_label,
            label_audio: matched ? t.matched_audio : t.unmatched_audio,
            b_side: RANDOMIZE_SIDE ? (Math.random() < 0.5 ? "left" : "right") : "left"
        });
    });
}


function triadDir(t) {
    if (t.trial_type === "practice") return t.prac_set ? `${PRAC_STIM}${t.prac_set}/` : PRAC_STIM;
    const n = String(t.trial_id).replace(/\D/g, "") || "1";
    return `${STIM_DIR}${t.stim_type}/triad${n}/`;
}

function stimSrc(t, file) {
    return triadDir(t) + file;
}

function labelSrc(label, file) { return `${LABEL_AUDIO}${label}/${file}`; }

function stimImg(t, file, cls = "") {
    return `<img class="stim ${cls}" src="${stimSrc(t, file)}" alt=""
              onerror="this.outerHTML='<div class=\\'stim stim-missing ${cls}\\'>${file}</div>'">`;
}

const AUDIO_CACHE = new Map();
const FETCH_TIMEOUT_MS = 8000;   // a stalled request must never park a trial

async function loadBuffer(src) {
    if (AUDIO_CACHE.has(src)) return AUDIO_CACHE.get(src);
    const ctx  = jsPsych.pluginAPI.audioContext();
    const ctrl = new AbortController();
    const bail = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(src, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        AUDIO_CACHE.set(src, buf);
        return buf;
    } finally {
        clearTimeout(bail);
    }
}

/* Web Audio rather than <audio>: sample-accurate, and the gain ramps put a
   ~8ms fade on each end, which kills the click you get when a clip starts or
   stops on a non-zero sample. */
let CURRENT_AUDIO = null;

// Only ever one clip in flight. Anything still sounding is faded out and
// stopped before the next starts, so nothing can bleed across a trial edge.
function stopAudio() {
    if (!CURRENT_AUDIO) return;
    const { source, gain, ctx, resolve } = CURRENT_AUDIO;
    CURRENT_AUDIO = null;
    try {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.02);
        source.onended = null;
        source.stop(now + 0.03);
    } catch (e) { /* already stopped */ }
    if (resolve) resolve(false);
}

/* iOS puts the AudioContext into "interrupted" (or "suspended") after video
   playback, Siri, a notification, or a screen lock, and it does not recover on
   its own. While it's out, ctx.currentTime stops advancing, so a scheduled clip
   never fires onended and every await below it stalls forever. Any touch is a
   user gesture, so spend every one of them on a resume. */
let AUDIO_WATCHDOG_WIRED = false;

function wireAudioWatchdog() {
    if (AUDIO_WATCHDOG_WIRED) return;
    const ctx = jsPsych.pluginAPI.audioContext();
    if (!ctx) return;
    AUDIO_WATCHDOG_WIRED = true;
    const kick = () => { if (ctx.state !== "running") ctx.resume().catch(() => {}); };
    if (ctx.addEventListener) {
        ctx.addEventListener("statechange", () => {
            console.warn("PiCS audio context →", ctx.state);
            kick();
        });
    }
    document.addEventListener("pointerdown", kick, true);
    document.addEventListener("touchstart",  kick, true);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });
}

/* opts.cueAt / opts.onCue fire a callback partway through the clip, so a
   visual can be timed to a word rather than to the end of the file. */
async function playAudio(src, opts = {}) {
    const ctx = jsPsych.pluginAPI.audioContext();
    if (!ctx) return playAudioFallback(src);
    wireAudioWatchdog();
    stopAudio();
    try {
        // resume() itself can hang on an interrupted iOS context
        if (ctx.state !== "running") {
            await Promise.race([ctx.resume().catch(() => {}), pause(400)]);
        }
        const buf = await loadBuffer(src);

        // a second call may have landed while this one was decoding
        stopAudio();

        const source = ctx.createBufferSource();
        source.buffer = buf;
        const gain = ctx.createGain();
        source.connect(gain).connect(ctx.destination);

        const t = ctx.currentTime;
        const d = buf.duration;
        const f = Math.min(0.008, d / 4);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(1, t + f);
        gain.gain.setValueAtTime(1, t + d - f);
        gain.gain.linearRampToValueAtTime(0, t + d);

        source.start(t);
        console.log(`PiCS audio played (${d.toFixed(2)}s): ${src}`);

        if (opts.onCue && opts.cueAt != null) {
            const cueMs = Math.max(0, Math.min(opts.cueAt, d) * 1000);
            setTimeout(() => {
                // don't fire if this clip was cut short
                if (CURRENT_AUDIO && CURRENT_AUDIO.source === source) opts.onCue();
            }, cueMs);
        }

        return new Promise(resolve => {
            let done = false;
            const finish = ok => {
                if (done) return;
                done = true;
                clearTimeout(guard);
                if (CURRENT_AUDIO && CURRENT_AUDIO.source === source) CURRENT_AUDIO = null;
                resolve(ok);
            };
            // if onended never arrives, move on anyway rather than sit dead
            const guard = setTimeout(() => {
                console.warn(`PiCS audio TIMED OUT — ${src}`);
                try { source.onended = null; source.stop(); } catch (e) { /* gone */ }
                if (ctx.state !== "running") ctx.resume().catch(() => {});
                finish(false);
            }, (d + 1.5) * 1000);
            CURRENT_AUDIO = { source, gain, ctx, resolve: () => finish(false) };
            source.onended = () => finish(true);
        });
    } catch (e) {
        console.warn(`PiCS audio FAILED — ${src} — ${e.message}`);
        return false;
    }
}

function playAudioFallback(src) {
    return new Promise(resolve => {
        const a = new Audio(src);
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        a.addEventListener("ended", finish, { once: true });
        a.addEventListener("error", () => {
            console.warn("PiCS audio FAILED —", src);
            finish();
        });
        const p = a.play();
        if (p && p.catch) p.catch(() => finish());
    });
}

function pause(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/* ==========================================================================
   Preloading

   Two caches are in play. jsPsychPreload warms the *browser* cache, which is
   what <img> and <video> read from — that half works. But playAudio goes
   through loadBuffer, which reads AUDIO_CACHE, a separate map jsPsychPreload
   never touches. So audio has to be warmed here or every clip is a live fetch
   with a child waiting on it.
   ========================================================================== */

// single source of truth: both the jsPsychPreload node and warmAudio use these
function audioManifest(runList) {
    const fixed = [CUE_PICK_ONE, CUE_TO_SORT, PRAC_INTRO, PRAC_SAMPLE,
                   PRAC_SEL_INST, PRAC_SELECT(PRAC_TRIAL.prac_set)].concat(SELECT_END);
    const perTrial = runList.flatMap(t => [
        labelSrc(t.matched_label,   t.a_audio),
        labelSrc(t.matched_label,   t.matched_audio),
        labelSrc(t.matched_label,   t.matched_audio_also),
        labelSrc(t.unmatched_label, t.unmatched_audio),
        labelSrc(t.unmatched_label, t.unmatched_audio_called),
        SELECT_AUDIO(t.matched_label)
    ]);
    return [...new Set(fixed.concat(perTrial).filter(Boolean))];
}

function imageManifest(runList) {
    const prac = [PRAC_TRIAL.a_stim, PRAC_TRIAL.b_stim, PRAC_TRIAL.x_stim]
        .map(f => stimSrc(PRAC_TRIAL, f));
    const exp = runList.flatMap(t => [t.a_stim, t.b_stim, t.x_stim].map(f => stimSrc(t, f)));
    return [...new Set([BOX_IMG].concat(prac).concat(exp).filter(Boolean))];
}

/* Decodes every clip into AUDIO_CACHE up front. Failures are collected, never
   thrown — one bad filename shouldn't kill a session that's otherwise fine,
   and the researcher sees the list before a child is in the room. */
async function warmAudio(paths, onProgress, concurrency = 6) {
    const queue  = paths.slice();
    const failed = [];
    let done = 0;

    const worker = async () => {
        while (queue.length) {
            const src = queue.shift();
            try {
                await loadBuffer(src);
            } catch (e) {
                const why = e.name === "AbortError" ? "timed out" : (e.message || e);
                failed.push(`${src} — ${why}`);
            }
            if (onProgress) onProgress(++done, paths.length);
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
    if (failed.length) console.warn("PiCS audio preload failures:\n" + failed.join("\n"));
    return failed;
}

/* Runs after the ID screen, so the researcher's tap has already given the
   AudioContext a user gesture to resume on, and before the intro video, so
   nothing loads while the child is watching. */
function createWarmupTrial(runList) {
    const paths = audioManifest(runList);

    return {
        type: jsPsychHtmlButtonResponse,
        css_classes: ["researcher"],
        choices: [],
        stimulus: `
          <div class="rsrch-kicker">Loading audio</div>
          <h1 class="rsrch-title">PiCS</h1>
          <div style="width:min(420px,70vw);height:10px;border-radius:5px;
                      background:rgba(0,0,0,.12);overflow:hidden;margin:18px auto 10px">
            <div id="warm-bar" style="width:0%;height:100%;background:#3aa76d;
                                      transition:width 120ms linear"></div>
          </div>
          <p class="rsrch-note" id="warm-count">0 / ${paths.length}</p>
          <div id="warm-fail" style="display:none;max-width:min(640px,86vw);margin:18px auto 0;
                                     text-align:left;font-size:13px;line-height:1.5;
                                     color:#a33;max-height:34vh;overflow:auto"></div>
          <button id="warm-go" class="rsrch-btn rsrch-btn-go hidden"
                  style="display:none;margin-top:18px">Continue anyway</button>`,
        data: { task: "audio_warmup" },
        on_load: async function () {
            wireAudioWatchdog();
            const ctx = jsPsych.pluginAPI.audioContext();
            if (ctx && ctx.state !== "running") await Promise.race([ctx.resume().catch(() => {}), pause(400)]);

            const bar   = document.getElementById("warm-bar");
            const count = document.getElementById("warm-count");
            const t0    = performance.now();

            const failed = await warmAudio(paths, (done, total) => {
                bar.style.width = Math.round((done / total) * 100) + "%";
                count.textContent = `${done} / ${total}`;
            });

            const finish = () => jsPsych.finishTrial({
                task: "audio_warmup",
                rt: Math.round(performance.now() - t0),
                audio_files: paths.length,
                audio_cached: AUDIO_CACHE.size,
                audio_failed: failed.length,
                audio_failed_list: failed.join(" | ")
            });

            if (!failed.length) { finish(); return; }

            // something's missing or misnamed — stop here rather than find out mid-trial
            const box = document.getElementById("warm-fail");
            const go  = document.getElementById("warm-go");
            count.textContent = `${paths.length - failed.length} / ${paths.length} loaded`;
            box.innerHTML = `<strong>${failed.length} file(s) failed:</strong><br>` +
                            failed.map(f => f.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("<br>");
            box.style.display = "block";
            go.style.display  = "inline-block";
            go.classList.remove("hidden");
            go.addEventListener("click", finish, { once: true });
        }
    };
}

function showFatal(err) {
    document.body.innerHTML =
        `<div class="fatal">
           <div class="rsrch-kicker">Can't start</div>
           <p class="fatal-msg">${String(err.message || err)}</p>
           <p class="rsrch-note">Fix it and reload. Nothing was recorded.</p>
         </div>`;
    console.error(err);
}


const id_screen = {
    type: jsPsychSurveyHtmlForm,
    css_classes: ["researcher"],
    preamble: `<div class="rsrch-kicker">Researcher setup</div>
               <h1 class="rsrch-title">PiCS</h1>`,
    html: `<div class="field">
             <label for="participant_id">Participant ID</label>
             <input type="text" id="participant_id" name="participant_id"
                    autocomplete="off" autocapitalize="characters"
                    spellcheck="false" required>
           </div>
           <div class="field">
             <label for="participant_age">Age</label>
             <input type="text" id="participant_age" name="participant_age"
                    autocomplete="off" inputmode="decimal"
                    spellcheck="false" required>
           </div>`,
    autofocus: "participant_id",
    button_label: "Continue",
    data: { task: "id_entry" },
    on_finish: function (data) {
        participant_id  = String(data.response.participant_id).trim();
        participant_age = String(data.response.participant_age).trim();
        jsPsych.data.addProperties({
            participant_id: participant_id,
            participant_age: participant_age
        });
    }
};

const intro_video = {
    type: jsPsychHtmlButtonResponse,
    css_classes: ["child"],
    choices: [],
    stimulus: `
      <div id="video-stage" class="video-wrap pre-play">
        <video id="intro-vid" playsinline webkit-playsinline preload="auto"
               src="${INTRO_VIDEO}"></video>
        <button id="play-btn" class="play-btn" aria-label="Play">
          <svg viewBox="0 0 100 100" width="88" height="88" aria-hidden="true">
            <polygon points="34,20 82,50 34,80" fill="#fff"/>
          </svg>
        </button>
        <button id="go-btn" class="go-btn hidden">Let's go!</button>
        <div id="vid-overlay" class="tap-overlay hidden"></div>
      </div>`,
    data: { task: "intro_video" },
    on_load: function () {
        const stage   = document.getElementById("video-stage");
        const vid     = document.getElementById("intro-vid");
        const play    = document.getElementById("play-btn");
        const go      = document.getElementById("go-btn");
        const overlay = document.getElementById("vid-overlay");
        const t0      = performance.now();

        const revealGo = () => {
            go.classList.remove("hidden");
            go.classList.add("pop");
        };

        const MEDIA_ERR = {
            1: "aborted",
            2: "network error",
            3: "decode error — file is there but the codec isn't Safari-friendly",
            4: "not found, or not a format Safari can play"
        };

        go.addEventListener("click", () => {
            jsPsych.finishTrial({ task: "intro_video", rt: Math.round(performance.now() - t0) });
        });

        play.addEventListener("click", () => {
            stage.classList.remove("pre-play");
            play.remove();
            vid.play();
        }, { once: true });

        vid.addEventListener("ended", () => {
            console.log("PiCS: video ended", vid.videoWidth + "x" + vid.videoHeight);
            revealGo();
        });

        vid.addEventListener("error", () => {
            const code = vid.error ? vid.error.code : "?";
            const why  = MEDIA_ERR[code] || "unknown";
            console.error(`PiCS: video failed (code ${code}: ${why})\n  tried: ${vid.currentSrc || INTRO_VIDEO}`);
            overlay.innerHTML =
                `<div style="text-align:center;font-size:20px;padding:0 8vw">
                   Video didn't load (code ${code}: ${why})<br>
                   <span style="font-size:14px;opacity:.7">${vid.currentSrc || INTRO_VIDEO}</span><br>
                   <span style="font-size:16px">Tap to continue anyway</span>
                 </div>`;
            overlay.classList.remove("hidden");
            overlay.addEventListener("click", revealGo, { once: true });
        });
    }
};

// intake is assembled in the runner now — the audio warm-up sits between the
// ID screen and the intro video, and it needs the run list to know what to load.


function trialData(t, task) {
    return {
        task: task,
        trial_id: t.trial_id,
        run_order: t.run_order,
        phase: t.trial_type,          // "practice" | "experimental"
        is_practice: t.trial_type === "practice",
        stim_type: t.stim_type,
        triad_dir: triadDir(t),
        a_stim: t.a_stim, b_stim: t.b_stim, x_stim: t.x_stim,
        matched: t.matched,
        matched_label: t.matched_label,
        unmatched_label: t.unmatched_label,
        label: t.label,
        b_side: t.b_side
    };
}

function createSampleTrial(t) {
    const leftIsB   = t.b_side === "left";
    const leftStim  = leftIsB ? t.b_stim : t.x_stim;
    const rightStim = leftIsB ? t.x_stim : t.b_stim;

    return {
        type: jsPsychHtmlButtonResponse,
        css_classes: ["child"],
        choices: [],
        stimulus: `
          <div class="sample-stage">
            <div class="target-slot">${stimImg(t, t.a_stim, "target")}</div>
            <div class="choice-row hidden" id="choice-row">
              <button class="choice-btn" id="choice-left">${stimImg(t, leftStim)}</button>
              <button class="choice-btn" id="choice-right">${stimImg(t, rightStim)}</button>
            </div>
          </div>`,
        data: trialData(t, "sample"),
        on_load: async function () {
            const row  = document.getElementById("choice-row");
            const btnL = document.getElementById("choice-left");
            const btnR = document.getElementById("choice-right");

            if (t.trial_type === "practice") {
                await playAudio(PRAC_INTRO);
                await playAudio(PRAC_SAMPLE);
            } else {
                // "It's called a sibu!" then "Sibu!"
                await playAudio(labelSrc(t.matched_label, t.a_audio));
                await playAudio(labelSrc(t.matched_label, t.matched_audio));
                await playAudio(CUE_PICK_ONE);
            }

            row.classList.remove("hidden");
            const t0 = performance.now();

            const respond = async (isLeft, btn, other) => {
                const rt = Math.round(performance.now() - t0);
                btnL.disabled = true;
                btnR.disabled = true;
                other.classList.add("dimmed");
                btn.classList.add("chosen");

                const sampled       = isLeft === leftIsB ? "B" : "X";
                const sampledStim   = isLeft ? leftStim : rightStim;
                const unsampled     = sampled === "B" ? "X" : "B";
                const unsampledStim = isLeft ? rightStim : leftStim;
                // practice has no labels, so it goes straight to the next cue
                const isPractice  = t.trial_type === "practice";
                const heardLabel  = isPractice ? null : (t.matched ? t.matched_label : t.unmatched_label);
                const heardFile   = isPractice ? null : (t.matched ? t.matched_audio : t.unmatched_audio);
                const framingFile = isPractice ? null : (t.matched ? t.matched_audio_also : t.unmatched_audio_called);

                if (!isPractice) {
                    // matched: "It's ALSO called a sibu! Sibu!"
                    // unmatched: "It's called a dern! Dern!"
                    await playAudio(labelSrc(heardLabel, framingFile));
                    await playAudio(labelSrc(heardLabel, heardFile));
                }
                await playAudio(CUE_TO_SORT);

                jsPsych.finishTrial({
                    rt: rt,
                    sampled: sampled,
                    sampled_stim: sampledStim,
                    sampled_side: isLeft ? "left" : "right",
                    unsampled: unsampled,
                    unsampled_stim: unsampledStim,
                    heard_label: heardLabel,
                    heard_framing_audio: isPractice ? null : labelSrc(heardLabel, framingFile),
                    heard_label_audio: isPractice ? null : labelSrc(heardLabel, heardFile)
                });
            };

            btnL.addEventListener("click", () => respond(true,  btnL, btnR), { once: true });
            btnR.addEventListener("click", () => respond(false, btnR, btnL), { once: true });
        }
    };
}

/* Measure where each object is, measure where it's going, then fly a clone
   between the two so the child sees it travel into the box rather than vanish
   and reappear. Every chip is placed before any is measured, so objects
   flying together don't aim at a box that reflows under them. */
function flyToBox(items, boxItems) {
    if (!items.length) return Promise.resolve();

    const legs = items.map(item => {
        const source = item.querySelector("img, .stim-missing");
        return { item, source, from: source.getBoundingClientRect() };
    });

    // put the chips in place but invisible, so we can measure their targets
    legs.forEach(l => {
        l.chip = l.source.cloneNode(true);
        l.chip.classList.add("box-chip");
        l.chip.style.visibility = "hidden";
        l.chip.style.animation = "none";
        boxItems.appendChild(l.chip);
    });

    legs.forEach(l => {
        const to = l.chip.getBoundingClientRect();
        l.item.style.visibility = "hidden";

        const flier = l.source.cloneNode(true);
        flier.className = "flier";
        flier.style.left   = l.from.left + "px";
        flier.style.top    = l.from.top + "px";
        flier.style.width  = l.from.width + "px";
        flier.style.height = l.from.height + "px";
        document.body.appendChild(flier);
        l.flier = flier;

        l.dx = (to.left + to.width / 2) - (l.from.left + l.from.width / 2);
        l.dy = (to.top + to.height / 2) - (l.from.top + l.from.height / 2);
        l.scale = to.width / l.from.width;
    });

    requestAnimationFrame(() => requestAnimationFrame(() => {
        legs.forEach(l => {
            l.flier.style.transform = `translate(${l.dx}px, ${l.dy}px) scale(${l.scale})`;
        });
    }));

    return new Promise(resolve => {
        setTimeout(() => {
            // reveal the chip first, drop the flier a frame later, and never
            // restore pop-in — re-enabling it would replay the entrance
            // animation and read as a flicker
            legs.forEach(l => { l.chip.style.visibility = ""; });
            requestAnimationFrame(() => legs.forEach(l => l.flier.remove()));
            // the originals stay hidden for good. Restoring visibility here
            // would let .placed fade them from opacity 1 to 0 in the row,
            // which reads as the object blinking back into place.
            legs.forEach(l => l.item.classList.add("placed"));
            resolve();
        }, 1300);
    });
}

/* Selection-screen styles live here rather than in index.html so the layout
   can't silently go missing. Colours come from the same --go variables as
   the other green buttons. */
const SELECT_CSS = `
  .select-stage { position: fixed; inset: 0; }
  .select-stage .sel-row {
    position: absolute; left: 0; right: 0; top: 40%;
    transform: translateY(-50%);
    display: flex; justify-content: center; align-items: center; gap: 5vw;
  }
  .select-stage .sel-item {
    border: 6px solid transparent; border-radius: 22px; padding: 10px;
    touch-action: manipulation; -webkit-tap-highlight-color: transparent;
    transition: border-color .15s, opacity .4s, filter .4s;
  }
  .select-stage .sel-item.picked   { border-color: var(--go, #3aa76d); }
  .select-stage .sel-item.unpicked { opacity: .35; filter: grayscale(1); }

  .select-stage .sel-box {
    position: absolute; left: 3vw; bottom: 3vh;
    width: 190px; margin: 0; padding: 0;
  }
  .select-stage .sel-box .box-img { width: 100%; height: auto; display: block; }
  .select-stage .sel-box .box-items {
    position: absolute; left: 0; right: 0; top: auto; bottom: 50%;
    display: flex; justify-content: center; align-items: flex-end;
  }
  .select-stage .sel-box .box-chip { width: 88px; height: 88px; }
  .select-stage .sel-box .box-chip + .box-chip { margin-left: -36px; }

  .select-stage .done-btn {
    position: absolute; right: 3vw; bottom: 4vh;
    min-width: 200px; min-height: 90px; padding: 0 40px;
    font: inherit; font-size: 28px; font-weight: 700; letter-spacing: -0.01em;
    color: #fff; background: var(--go, #3aa76d);
    border: none; border-radius: 999px;
    box-shadow: 0 8px 0 var(--go-deep, #2b7d51), 0 14px 32px var(--go-glow, rgba(58,167,109,.35));
    touch-action: manipulation; -webkit-tap-highlight-color: transparent;
    transition: opacity .3s;
  }
  .select-stage .done-btn:active {
    transform: translateY(4px);
    box-shadow: 0 4px 0 var(--go-deep, #2b7d51), 0 8px 20px var(--go-glow, rgba(58,167,109,.35));
  }
  .select-stage .done-btn:disabled    { opacity: .35; box-shadow: none; }
  .select-stage .done-btn.done-hidden { opacity: 0; pointer-events: none; }
`;

function injectSelectCss() {
    if (document.getElementById("select-css")) return;
    const el = document.createElement("style");
    el.id = "select-css";
    el.textContent = SELECT_CSS;
    document.head.appendChild(el);
}

function createSelectTrial(t, isLast, withInstructions = false) {
    // row positions are decided fresh each trial, independent of the sample
    const rowOrder   = shuffle(["A", "B", "X"]);
    const stimOf     = { A: t.a_stim, B: t.b_stim, X: t.x_stim };
    const isPractice = t.trial_type === "practice";
    const prompt     = isPractice ? PRAC_SELECT(t.prac_set) : SELECT_AUDIO(t.matched_label);
    // the last trial hands off to the exit video
    const endAudio   = isLast ? null : SELECT_END[Math.floor(Math.random() * SELECT_END.length)];

    const items = rowOrder.map(k =>
        `<div class="sort-item sel-item" id="item-${k}">${stimImg(t, stimOf[k])}</div>`).join("");

    return {
        type: jsPsychHtmlButtonResponse,
        css_classes: ["child"],
        choices: [],
        stimulus: `
          <div class="select-stage">
            <div class="sel-box">
              <img class="box-img" src="${BOX_IMG}" alt="">
              <div class="box-items" id="box-items-0"></div>
            </div>
            <div class="item-row sel-row" id="item-row">${items}</div>
            <button class="done-btn" id="done-btn" disabled>Done</button>
          </div>`,
        data: trialData(t, "select"),
        on_load: async function () {
            const itemRow = document.getElementById("item-row");
            const done    = document.getElementById("done-btn");
            const picks   = [];   // in tap order
            const pickRts = [];
            let open = false;

            // objects are on screen but locked until the prompt finishes
            await pause(400);
            if (withInstructions) {
                await playAudio(PRAC_SEL_INST);
                await pause(300);
            }
            await playAudio(prompt);

            const t0 = performance.now();
            open = true;
            itemRow.classList.add("active");
            done.disabled = false;

            // one tap selects and locks; there is no way to unselect
            rowOrder.forEach(k => {
                const el = document.getElementById("item-" + k);
                el.addEventListener("click", () => {
                    if (!open) return;
                    picks.push(k);
                    pickRts.push(Math.round(performance.now() - t0));
                    el.classList.add("picked");
                }, { once: true });
            });

            await new Promise(resolve => done.addEventListener("click", resolve, { once: true }));
            const rt = Math.round(performance.now() - t0);
            open = false;
            done.disabled = true;
            done.classList.add("done-hidden");
            itemRow.classList.remove("active");

            rowOrder.filter(k => !picks.includes(k))
                .forEach(k => document.getElementById("item-" + k).classList.add("unpicked"));
            await pause(400);

            await flyToBox(picks.map(k => document.getElementById("item-" + k)),
                           document.getElementById("box-items-0"));

            await pause(SELECT_HOLD_MS);
            if (endAudio) await playAudio(endAudio);

            jsPsych.finishTrial({
                rt: rt,
                row_order: rowOrder.join(""),
                prompt_audio: prompt,
                selected: ["A", "B", "X"].filter(k => picks.includes(k)).join(""),
                n_selected: picks.length,
                click_order: picks.join(""),
                click_rts: pickRts.join(" "),
                end_audio: endAudio
            });
        }
    };
}


/* A full-screen video that plays itself and moves on when it ends. Used for
   the halfway break and the exit. Autoplay is allowed here because the child
   has already interacted with the page many times. */
function createVideoTrial(src, task) {
    return {
        type: jsPsychHtmlButtonResponse,
        css_classes: ["child"],
        choices: [],
        stimulus: `
          <div class="video-wrap">
            <video id="vid-${task}" playsinline webkit-playsinline preload="auto"
                   src="${src}"></video>
            <div id="ov-${task}" class="tap-overlay hidden"></div>
          </div>`,
        data: { task: task },
        on_load: function () {
            const vid     = document.getElementById("vid-" + task);
            const overlay = document.getElementById("ov-" + task);

            let finished = false;
            const done = () => {
                if (finished) return;
                finished = true;
                jsPsych.finishTrial({ task: task });
            };

            vid.addEventListener("ended", done);
            vid.addEventListener("error", () => {
                const code = vid.error ? vid.error.code : "?";
                console.warn(`PiCS: ${task} failed (code ${code}) — ${vid.currentSrc || src}`);
                done();
            });

            const attempt = vid.play();
            if (attempt && attempt.catch) attempt.catch(err => {
                console.warn(`PiCS: ${task} autoplay blocked (${err.name}) — falling back to tap.`);
                overlay.textContent = "Tap to continue";
                overlay.classList.remove("hidden");
                overlay.addEventListener("click", () => {
                    overlay.classList.add("hidden");
                    vid.play();
                }, { once: true });
            });
        }
    };
}

const exit_video = createVideoTrial(EXIT_VIDEO, "exit_video");

/* Explicit output columns. jsPsych's own bookkeeping (trial_index,
   plugin_version, time_elapsed, preload results...) is dropped, and the
   ordering mirrors trials.csv minus the audio filename columns. */
const OUT_COLUMNS = [
    "participant_id", "participant_age", "study_id", "session_date", "session_time",
    "run_order", "con_trial_num", "task",
    "trial_id", "trial_type", "stim_type",
    "a_stim", "b_stim", "x_stim",
    "matched", "matched_label", "unmatched_label", "heard_label",
    "b_side", "sampled", "sampled_stim", "sampled_side", "unsampled",
    "row_order", "selected", "n_selected", "click_order", "click_rts",
    "rt", "time_elapsed"
];

function csvCell(v) {
    if (v === null || v === undefined) return "";
    const str = String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildDataString() {
    const rows = jsPsych.data.get()
        .filter([{ task: "sample" }, { task: "select" }])
        .values()
        .map(d => Object.assign({}, d, { trial_type: d.phase }));

    // numbered over the rows actually emitted, so practice starts at 1 rather
    // than going negative off the back of run_order 0
    rows.forEach((d, i) => { d.con_trial_num = i + 1; });

    const lines = rows.map(d => OUT_COLUMNS.map(c => csvCell(d[c])).join(","));
    return [OUT_COLUMNS.join(",")].concat(lines).join("\n");
}

const save_data = {
    type: jsPsychPipe,
    action: "save",
    experiment_id: DATAPIPE_ID,
    filename: () => `${participant_id || "noID"}.csv`,
    data_string: buildDataString
};

const save_node = {
    timeline: [save_data],
    conditional_function: () => DATAPIPE_ID !== null
};

const local_save_node = {
    timeline: [{
        type: jsPsychHtmlButtonResponse,
        css_classes: ["researcher"],
        stimulus: `<div class="rsrch-kicker">No DataPipe ID set</div>
                   <p class="rsrch-note">Data was not uploaded. Download it instead.</p>`,
        choices: ["Download CSV"],
        button_html: c => `<button class="rsrch-btn rsrch-btn-go">${c}</button>`,
        on_finish: () => {
            const blob = new Blob([buildDataString()], { type: "text/csv" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${participant_id || "noID"}.csv`;
            a.click();
        }
    }],
    conditional_function: () => DATAPIPE_ID === null
};

const end_screen = {
    type: jsPsychHtmlButtonResponse,
    css_classes: ["researcher"],
    stimulus: () => `<div class="rsrch-kicker">Session complete</div>
                     <div class="id-readout">${participant_id}</div>
                     <p class="rsrch-note">Safe to close.</p>`,
    choices: []
};


document.addEventListener('DOMContentLoaded', async () => {

    injectSelectCss();

    let bank;
    try {
        bank = await loadTrials(TRIAL_FILE);
    } catch (err) {
        showFatal(err);          
        return;
    }

    const runList = buildRunList(bank);
    console.log("PiCS run list:", runList);

    jsPsych.data.addProperties({
        n_trials: runList.length,
        user_agent: navigator.userAgent
    });

    // images and video only — audio is warmed into AUDIO_CACHE by the warm-up
    // node instead, since jsPsychPreload fills a cache playAudio never reads
    const preload = {
        type: jsPsychPreload,
        video: [INTRO_VIDEO, EXIT_VIDEO, HALFWAY_VIDEO],
        images: imageManifest(runList),
        continue_after_error: true,
        show_detailed_errors: true
    };

    const timeline = [preload, id_screen, createWarmupTrial(runList), intro_video];

    // hand-coded practice: no labels
    const practice = Object.assign({}, PRAC_TRIAL, { run_order: 0, matched: null, b_side: "left" });
    timeline.push(createSampleTrial(practice));
    timeline.push(createSelectTrial(practice, false, true));

    runList.forEach((t, i) => {
        timeline.push(createSampleTrial(t));
        timeline.push(createSelectTrial(t, i === runList.length - 1));
        // Zib's box is two-thirds full — a break, not an end
        if (i === HALFWAY_AFTER - 1 && i < runList.length - 1) {
            timeline.push(createVideoTrial(HALFWAY_VIDEO, "halfway_video"));
        }
    });

    timeline.push(exit_video, save_node, local_save_node, end_screen);

    jsPsych.run(timeline);
});
