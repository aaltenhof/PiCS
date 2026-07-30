
const DATAPIPE_ID   = null;              
const TRIAL_FILE    = "trials.csv";
const INTRO_VIDEO   = "intro_video.mp4";
const STIM_DIR      = "selected/stimuli/";
const AUDIO_DIR     = "audio/";

const SHUFFLE_TRIALS   = true;   // shuffle experimental trials, but keep sample and sort together
const AVOID_CAT_RUN    = true;   // no two consecutive trials from the same stim_type
const RANDOMIZE_MATCH  = true;   // balanced matched/unmatched assignment of the label
const MAX_MATCHED_RUN  = 2;      // cap consecutive matched (or unmatched) trials
const RANDOMIZE_SIDE   = true;   // randomize which side B sits on
const RESEARCHER_SKIP  = true;   

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


function stimImg(file, cls = "") {
    return `<img class="stim ${cls}" src="${STIM_DIR}${file}" alt="${file}"
              onerror="this.outerHTML='<div class=\\'stim stim-missing ${cls}\\'>${file}</div>'">`;
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

const start_and_intro = {
    type: jsPsychHtmlButtonResponse,
  css_classes: ["child"],
      stimulus: function () {
          return `
            <div id="video-stage" class="video-wrap">
              <video id="intro-vid" playsinline webkit-playsinline preload="auto"
                    src="${INTRO_VIDEO}"></video>
              ${RESEARCHER_SKIP ? '<button id="skip-vid" class="skip-btn">skip</button>' : ''}
            </div>`;
      },
    choices: ["Let's go!"],
    button_html: () => `<button id="go-btn" class="go-btn hidden">Let's go!</button>`,
    response_ends_trial: true,
    data: { task: "session_start" },
    on_load: function () {
        const vid   = document.getElementById("intro-vid");
        const go    = document.getElementById("go-btn");
        const skip  = document.getElementById("skip-vid");

        const revealGo = () => {
            go.classList.remove("hidden");
            go.classList.add("pop");
        };

        vid.play();

        vid.addEventListener("ended", revealGo);
        vid.addEventListener("error", () => {
            console.warn("PiCS: intro video failed to load.");
            revealGo();
        });

        if (skip) skip.addEventListener("click", revealGo);
    }
};

const intake = { timeline: [id_screen, start_and_intro] };



//To-Do: Sample ans sorts
function trialData(t, task) {
    return {
        task: task,                                    // "sample" | "sort"
        trial_id: t.trial_id,                          // which trial (from CSV)
        run_order: t.run_order,                        // where it landed
        con_trial_num: (t.run_order - 1) * 2 + (task === "sample" ? 1 : 2),
        trial_type: t.trial_type,
        is_practice: t.trial_type === "practice",
        block_ID: t.block_ID,
        stim_type: t.stim_type,
        a_stim: t.a_stim, b_stim: t.b_stim, x_stim: t.x_stim,
        matched: t.matched,
        label: t.label,
        matched_label: t.matched_label,
        unmatched_label: t.unmatched_label,
        b_side: t.b_side
    };
}

function createSampleTrial(t) {
    const left  = t.b_side === "left" ? t.b_stim : t.x_stim;
    const right = t.b_side === "left" ? t.x_stim : t.b_stim;

    return {
        type: jsPsychHtmlButtonResponse,
        css_classes: ["child"],
        stimulus: `
          <div class="target-row">${stimImg(t.a_stim, "target")}</div>
          <div class="label-plate">${t.label}</div>`,
        choices: [left, right],
        button_html: choice => `<button class="choice-btn">${stimImg(choice)}</button>`,
        data: trialData(t, "sample"),
        on_finish: function (data) {
            const chosen = data.response === 0 ? left : right;
            data.sampled = chosen === t.b_stim ? "B" : "X";
            data.sampled_stim = chosen;
        }
    };
}

function createSortTrial(t) {
    return {
        type: jsPsychHtmlButtonResponse,
        css_classes: ["child"],
        stimulus: `
          <div class="label-plate">Which ones are the ${t.label}?</div>
          <div class="sort-row">
            ${stimImg(t.a_stim)}${stimImg(t.b_stim)}${stimImg(t.x_stim)}
          </div>`,
        choices: ["Done"],
        button_html: choice => `<button class="go-btn go-btn-small">${choice}</button>`,
        data: trialData(t, "sort")
    };
}


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
        video: [INTRO_VIDEO],
        // Add these later:
        // images: runList.flatMap(t => [t.a_stim, t.b_stim, t.x_stim].map(f => STIM_DIR + f)),
        // audio:  runList.flatMap(t => [t.a_audio, t.label_audio, t.transition_audio]
        //                              .map(f => AUDIO_DIR + f)),
        continue_after_error: true,
        show_detailed_errors: true
    };

    const timeline = [preload, intake];

    for (const t of runList) {
        timeline.push(createSampleTrial(t));
        timeline.push(createSortTrial(t));
    }

    timeline.push(save_node, local_save_node, end_screen);

    jsPsych.run(timeline);
});
