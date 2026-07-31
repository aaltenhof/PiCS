
const DATAPIPE_ID   = null;              
const TRIAL_FILE    = "trials.csv";
const INTRO_VIDEO   = "intro_video.mp4";
const EXIT_VIDEO    = "exit_video.mp4";
const STIM_DIR      = "selected_stim/";
const LABEL_AUDIO   = "audio/sample/labels/";
const SUPPORT_AUDIO = "audio/sample/support/";
const CUE_PICK_ONE  = SUPPORT_AUDIO + "pick_one.wav";
const CUE_TO_SORT   = SUPPORT_AUDIO + "to_sort.wav";

const SORT_DIR      = "audio/sort/";
const SORT_ZIB      = SORT_DIR + "instructions/zib/zib_choice_1.wav";
const SORT_FIRST    = SORT_DIR + "instructions/zib/first_trial.wav";
const SORT_ITEM1    = SORT_DIR + "instructions/item1/your_turn.wav";
const SORT_ITEM2    = SORT_DIR + "instructions/item2/next_one.wav";
const SORT_END      = [1, 2, 3].map(n => `${SORT_DIR}end/to_sample${n}.wav`);

const BOX_IMG       = "selected_stim/box_open.png";
const N_BOXES       = 3;

const SHUFFLE_TRIALS   = true;   // shuffle experimental trials, but keep sample and sort together
const AVOID_CAT_RUN    = true;   // no two consecutive trials from the same stim_type
const RANDOMIZE_MATCH  = true;   // balanced matched/unmatched assignment of the label
const MAX_MATCHED_RUN  = 2;      // cap consecutive matched (or unmatched) trials
const RANDOMIZE_SIDE   = true;   // randomize which side B sits on

var jsPsych = initJsPsych();

var study_id = "PiCS";
var participant_id = "";

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
    "trial_id", "trial_type", "block_ID", "stim_type",
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
                    block_ID: r.block_ID === "" ? null : Number(r.block_ID),
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
    const n = String(t.trial_id).replace(/\D/g, "") || "1";
    return `${STIM_DIR}${t.stim_type}/triad${n}/`;
}

function stimSrc(t, file) { return triadDir(t) + file; }

function labelSrc(label, file) { return `${LABEL_AUDIO}${label}/${file}`; }

function stimImg(t, file, cls = "") {
    return `<img class="stim ${cls}" src="${stimSrc(t, file)}" alt=""
              onerror="this.outerHTML='<div class=\\'stim stim-missing ${cls}\\'>${file}</div>'">`;
}

const AUDIO_CACHE = new Map();

async function loadBuffer(src) {
    if (AUDIO_CACHE.has(src)) return AUDIO_CACHE.get(src);
    const ctx = jsPsych.pluginAPI.audioContext();
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    AUDIO_CACHE.set(src, buf);
    return buf;
}

/* Web Audio rather than <audio>: sample-accurate, and the gain ramps put a
   ~8ms fade on each end, which kills the click you get when a clip starts or
   stops on a non-zero sample. */
async function playAudio(src) {
    const ctx = jsPsych.pluginAPI.audioContext();
    if (!ctx) return playAudioFallback(src);
    try {
        if (ctx.state !== "running") await ctx.resume();
        const buf = await loadBuffer(src);

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
        return new Promise(resolve => { source.onended = () => resolve(true); });
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
           </div>`,
    autofocus: "participant_id",
    button_label: "Continue",
    data: { task: "id_entry" },
    on_finish: function (data) {
        participant_id = String(data.response.participant_id).trim();
        jsPsych.data.addProperties({ participant_id: participant_id });
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

const intake = { timeline: [id_screen, intro_video] };


function trialData(t, task) {
    return {
        task: task,
        trial_id: t.trial_id,
        run_order: t.run_order,
        con_trial_num: (t.run_order - 1) * 2 + (task === "sample" ? 1 : 2),
        trial_type: t.trial_type,
        is_practice: t.trial_type === "practice",
        block_ID: t.block_ID,
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

            await playAudio(labelSrc(t.matched_label, t.a_audio));
            await playAudio(CUE_PICK_ONE);

            row.classList.remove("hidden");
            const t0 = performance.now();

            const respond = async (isLeft, btn, other) => {
                const rt = Math.round(performance.now() - t0);
                btnL.disabled = true;
                btnR.disabled = true;
                other.classList.add("dimmed");
                btn.classList.add("chosen");

                const sampled     = isLeft === leftIsB ? "B" : "X";
                const sampledStim = isLeft ? leftStim : rightStim;
                const heardLabel  = t.matched ? t.matched_label : t.unmatched_label;
                const heardFile   = t.matched ? t.matched_audio : t.unmatched_audio;

                await playAudio(labelSrc(heardLabel, heardFile));
                await playAudio(CUE_TO_SORT);

                jsPsych.finishTrial({
                    rt: rt,
                    sampled: sampled,
                    sampled_stim: sampledStim,
                    sampled_side: isLeft ? "left" : "right",
                    heard_label: heardLabel
                });
            };

            btnL.addEventListener("click", () => respond(true,  btnL, btnR), { once: true });
            btnR.addEventListener("click", () => respond(false, btnR, btnL), { once: true });
        }
    };
}

function createSortTrial(t, isFirst, isLast) {
    // top-row positions and A's box are decided fresh each trial
    const rowOrder  = shuffle(["A", "B", "X"]);
    const firstUp   = Math.random() < 0.5 ? "B" : "X";
    const secondUp  = firstUp === "B" ? "X" : "B";
    const aBox      = Math.floor(Math.random() * N_BOXES);
    // first trial gets its own opener; the last hands off to the exit video
    const zibAudio  = isFirst ? SORT_FIRST : SORT_ZIB;
    const endAudio  = isLast ? null : SORT_END[Math.floor(Math.random() * SORT_END.length)];

    const stimOf = { A: t.a_stim, B: t.b_stim, X: t.x_stim };

    const items = rowOrder.map(k =>
        `<div class="sort-item" id="item-${k}">${stimImg(t, stimOf[k])}</div>`).join("");

    const boxes = Array.from({ length: N_BOXES }, (_, i) =>
        `<button class="box" id="box-${i}">
           <img class="box-img" src="${BOX_IMG}" alt="">
           <div class="box-items" id="box-items-${i}"></div>
         </button>`).join("");

    return {
        type: jsPsychHtmlButtonResponse,
        css_classes: ["child"],
        choices: [],
        stimulus: `
          <div class="sort-stage">
            <div class="item-row">${items}</div>
            <div class="box-row" id="box-row">${boxes}</div>
          </div>`,
        data: trialData(t, "sort"),
        on_load: async function () {
            const boxRow = document.getElementById("box-row");
            const boxEls = Array.from({ length: N_BOXES }, (_, i) => document.getElementById("box-" + i));

            const lockBoxes = on => {
                boxEls.forEach(el => { el.disabled = !on; });
                boxRow.classList.toggle("active", on);
            };
            lockBoxes(false);

            const place = (key, boxIdx) => {
                const item = document.getElementById("item-" + key);
                const img  = item.querySelector("img, .stim-missing").cloneNode(true);
                img.classList.add("box-chip");
                document.getElementById("box-items-" + boxIdx).appendChild(img);
                item.classList.remove("highlighted");
                item.classList.add("placed");
            };

            // only ever called after the prompt audio has finished
            const awaitBox = () => new Promise(resolve => {
                const t0 = performance.now();
                lockBoxes(true);
                const handlers = [];
                boxEls.forEach((el, i) => {
                    const h = () => {
                        lockBoxes(false);
                        boxEls.forEach((e, j) => e.removeEventListener("click", handlers[j]));
                        resolve({ box: i, rt: Math.round(performance.now() - t0) });
                    };
                    handlers.push(h);
                    el.addEventListener("click", h);
                });
            });

            const zibOk = await playAudio(zibAudio);
            if (!zibOk && zibAudio !== SORT_ZIB) await playAudio(SORT_ZIB);

            place("A", aBox);
            await pause(1400);

            document.getElementById("item-" + firstUp).classList.add("highlighted");
            await playAudio(SORT_ITEM1);
            const r1 = await awaitBox();
            place(firstUp, r1.box);
            await pause(500);

            document.getElementById("item-" + secondUp).classList.add("highlighted");
            await playAudio(SORT_ITEM2);
            const r2 = await awaitBox();
            place(secondUp, r2.box);
            await pause(500);

            if (endAudio) await playAudio(endAudio);

            const sampleRow = jsPsych.data.get()
                .filter({ task: "sample", run_order: t.run_order }).values()[0] || {};

            jsPsych.finishTrial({
                rt: r1.rt + r2.rt,
                row_order: rowOrder.join(""),
                a_box: aBox,
                item1: firstUp,
                item1_stim: stimOf[firstUp],
                item1_box: r1.box,
                item1_rt: r1.rt,
                item1_with_a: r1.box === aBox,
                item2: secondUp,
                item2_stim: stimOf[secondUp],
                item2_box: r2.box,
                item2_rt: r2.rt,
                item2_with_a: r2.box === aBox,
                zib_audio: zibAudio,
                sampled: sampleRow.sampled,
                sampled_with_a: sampleRow.sampled
                    ? (sampleRow.sampled === firstUp ? r1.box === aBox : r2.box === aBox)
                    : null,
                end_audio: endAudio
            });
        }
    };
}


const exit_video = {
    type: jsPsychHtmlButtonResponse,
    css_classes: ["child"],
    choices: [],
    stimulus: `
      <div class="video-wrap">
        <video id="exit-vid" playsinline webkit-playsinline preload="auto"
               src="${EXIT_VIDEO}"></video>
        <div id="exit-overlay" class="tap-overlay hidden"></div>
      </div>`,
    data: { task: "exit_video" },
    on_load: function () {
        const vid     = document.getElementById("exit-vid");
        const overlay = document.getElementById("exit-overlay");

        let finished = false;
        const done = () => {
            if (finished) return;
            finished = true;
            jsPsych.finishTrial({ task: "exit_video" });
        };

        vid.addEventListener("ended", done);
        vid.addEventListener("error", () => {
            const code = vid.error ? vid.error.code : "?";
            console.warn(`PiCS: exit video failed (code ${code}) — ${vid.currentSrc || EXIT_VIDEO}`);
            done();
        });

        const attempt = vid.play();
        if (attempt && attempt.catch) attempt.catch(err => {
            console.warn(`PiCS: exit video autoplay blocked (${err.name}) — falling back to tap.`);
            overlay.textContent = "Tap to continue";
            overlay.classList.remove("hidden");
            overlay.addEventListener("click", () => {
                overlay.classList.add("hidden");
                vid.play();
            }, { once: true });
        });
    }
};

const save_data = {
    type: jsPsychPipe,
    action: "save",
    experiment_id: DATAPIPE_ID,
    filename: () => `PiCS_${participant_id || "noID"}_${Date.now()}.csv`,
    data_string: () => jsPsych.data.get().csv()
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
        on_finish: () => jsPsych.data.get().localSave(
            "csv", `PiCS_${participant_id || "noID"}_${Date.now()}.csv`)
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

    const preload = {
        type: jsPsychPreload,
        video: [INTRO_VIDEO, EXIT_VIDEO],
        images: runList.flatMap(t => [t.a_stim, t.b_stim, t.x_stim].map(f => stimSrc(t, f))),
        audio: [CUE_PICK_ONE, CUE_TO_SORT, SORT_ZIB, SORT_FIRST, SORT_ITEM1, SORT_ITEM2]
            .concat(SORT_END)
            .concat(runList.flatMap(t => [
            labelSrc(t.matched_label, t.a_audio),
            labelSrc(t.matched_label, t.matched_audio),
            labelSrc(t.unmatched_label, t.unmatched_audio)
            ])),
        continue_after_error: true,
        show_detailed_errors: true
    };

    const timeline = [preload, intake];

    runList.forEach((t, i) => {
        timeline.push(createSampleTrial(t));
        timeline.push(createSortTrial(t, i === 0, i === runList.length - 1));
    });

    timeline.push(exit_video, save_node, local_save_node, end_screen);

    jsPsych.run(timeline);
});
